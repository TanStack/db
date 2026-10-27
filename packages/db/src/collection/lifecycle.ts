import {
  CollectionInErrorStateError,
  CollectionPreloadAbortedError,
  CollectionStateError,
  InvalidCollectionStatusTransitionError,
} from '../errors'
import {
  safeCancelIdleCallback,
  safeRequestIdleCallback,
} from '../utils/browser-polyfills'
import { runAllCallbacks } from '../utils/callbacks'
import { createDeferred } from '../deferred'
import { codedMessage, devBuild } from '../error-message'
import { CleanupQueue, cleanupNow } from './cleanup-queue'
import type { Deferred } from '../deferred'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  CollectionConfig,
  CollectionErrorInfo,
  CollectionStatus,
  HealthProblem,
} from '../types'
import type { CollectionEventsManager } from './events'
import type { CollectionIndexesManager } from './indexes'
import type { CollectionChangesManager } from './changes'
import type { CollectionSyncManager } from './sync'
import type { CollectionStateManager } from './state'

/**
 * Floor applied to the GC delay of a collection that started syncing before
 * anything subscribed. Adapters build their live query while rendering and
 * subscribe when that render commits. This grace period reduces cleanup
 * during that gap; a later subscriber can still restart sync. Adapters pass
 * a near-zero `gcTime` to make teardown on unmount immediate. Does not apply
 * to the timer armed when the last subscriber leaves, which still honours
 * `gcTime` exactly.
 */
export const UNSUBSCRIBED_GC_FLOOR_MS = 50

/** A Collection's gcTime when its config names none (5 minutes). */
export const DEFAULT_GC_TIME_MS = 300000

export class CollectionLifecycleManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private config: CollectionConfig<TOutput, TKey, TSchema, any>
  private id: string
  private indexes!: CollectionIndexesManager<TOutput, TKey, TSchema, TInput>
  private events!: CollectionEventsManager
  private changes!: CollectionChangesManager<TOutput, TKey, TSchema, TInput>
  private sync!: CollectionSyncManager<TOutput, TKey, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>

  public status: CollectionStatus = `idle`
  public hasBeenReady = false
  public hasReceivedFirstCommit = false
  private readyFailureSink: ((failure: { error: unknown }) => void) | undefined
  public onFirstReadyCallbacks: Array<() => void> = []
  private idleCallbackId: number | null = null
  // After the first ready, the sync adapter's problem is health tree detail:
  // `failureReason` while it still tries, `stoppedError` once it called fail().
  // A live query's request failures are kept apart, so settling a request
  // cannot clear the sync adapter's problem. The failure reason lists every
  // reportError() of its sync run since it began.
  private failureReason: HealthProblem | null = null
  // A reload's new run reported the failure reason, so its first commit keeps it.
  private failureReasonFromReload = false
  private stoppedError: HealthProblem | null = null
  // The cause of status `error` or `crashed`, kept so readers see the same
  // object until the sync run ends.
  private statusError: HealthProblem | null = null
  private requestErrors = new RequestErrors()
  // fail() ends the sync adapter's reporting for its sync run; a reload or
  // cleanup starts a new one.
  private adapterStopped = false
  // A reload's new sync run, until its first commit or its failure.
  private reloadRun: Deferred<void> | undefined
  // A reload is moving the Collection out of `error`.
  private recovering = false
  private gcGraceUntil = 0
  private cleanupConfig: () => void
  private statusRevision = 0
  private cleaningUp = false
  private cleanupPromise: Promise<void> | null = null
  private readonly cleanupStartCallbacks = new Set<() => void>()

  /**
   * Creates a new CollectionLifecycleManager instance
   */
  constructor(
    config: CollectionConfig<TOutput, TKey, TSchema, any>,
    id: string,
    cleanupConfig: () => void = () => {},
  ) {
    this.config = config
    this.id = id
    this.cleanupConfig = cleanupConfig
  }

  setDeps(deps: {
    indexes: CollectionIndexesManager<TOutput, TKey, TSchema, TInput>
    events: CollectionEventsManager
    changes: CollectionChangesManager<TOutput, TKey, TSchema, TInput>
    sync: CollectionSyncManager<TOutput, TKey, TSchema, TInput>
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  }) {
    this.indexes = deps.indexes
    this.events = deps.events
    this.changes = deps.changes
    this.sync = deps.sync
    this.state = deps.state
  }

  /**
   * Validates state transitions to prevent invalid status changes
   */
  public validateStatusTransition(
    from: CollectionStatus,
    to: CollectionStatus,
  ): void {
    if (from === to) {
      // Allow same state transitions
      return
    }
    const validTransitions: Record<
      CollectionStatus,
      Array<CollectionStatus>
    > = {
      idle: [`loading`, `error`, `crashed`, `cleaned-up`],
      loading: [`ready`, `error`, `crashed`, `cleaned-up`],
      // After the first ready only a crash changes the status; a sync
      // problem is health tree detail.
      ready: [`cleaned-up`, `crashed`],
      // A failed first load is final for its sync run. Only a reload leaves
      // it for `ready` (see `recovering`).
      error: [`cleaned-up`, `idle`, `crashed`],
      // Nothing recovers a crash in place; only cleanup leaves it.
      crashed: [`cleaned-up`],
      'cleaned-up': [`loading`, `error`, `crashed`],
    }

    if (
      !validTransitions[from].includes(to) &&
      !(this.recovering && from === `error` && to === `ready`)
    ) {
      throw new InvalidCollectionStatusTransitionError(from, to, this.id)
    }
  }

  /**
   * Safely update the collection status with validation
   * @private
   */
  public setStatus(
    newStatus: CollectionStatus,
    allowReady: boolean = false,
    beforeEmit?: () => void,
  ): void {
    if (newStatus === `ready` && !allowReady) {
      // setStatus('ready') is an internal method that should not be called directly
      // Instead, use markReady to transition to ready triggering the necessary events
      // and side effects.
      throw new CollectionStateError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `You can't directly call "setStatus('ready'). You must use markReady instead.`
          : codedMessage(208),
      )
    }
    this.validateStatusTransition(this.status, newStatus)
    // Only an actual replacement run transfers later cleanup to a new run.
    // Validation, deferred requests and failed admission retain the old promise.
    if (newStatus === `loading`) this.cleanupPromise = null
    const revision = ++this.statusRevision
    const previousStatus = this.status
    this.status = newStatus
    beforeEmit?.()

    // Emit event
    const isCurrent = () => this.statusRevision === revision
    this.events.emitStatusChange(newStatus, previousStatus, isCurrent)
    // The status is part of the health tree. status:change fires first, and
    // the tree is already current when either event fires.
    if (isCurrent()) this.events.emitHealthChange()
  }

  /**
   * Validates that the collection is in a usable state for data operations
   * @private
   */
  public validateCollectionUsable(operation: string): void {
    switch (this.status) {
      case `error`:
      case `crashed`:
        throw new CollectionInErrorStateError(operation, this.id)
      case `cleaned-up`:
        // Automatically restart the collection when operations are called on cleaned-up collections
        this.sync.startSync()
        break
    }
  }

  /**
   * Mark the collection as ready for use
   * This is called by sync implementations to explicitly signal that the collection is ready,
   * providing a more intuitive alternative to using commits for readiness signaling
   * @private - Should only be called by sync implementations
   *
   * `beforeEffects` runs after the status reads `ready` and before status
   * listeners and ready callbacks, so their writes follow it.
   */
  public markReady(beforeEffects?: () => void): void {
    // A crash ended the sync run from core's side; the adapter is not at fault.
    if (this.status === `crashed`) return
    if (this.adapterStopped) {
      // A failed first load is final for its sync run.
      if (this.status === `error`)
        throw new InvalidCollectionStatusTransitionError(
          this.status,
          `ready`,
          this.id,
        )
      this.assertAdapterActive(`markReady`)
    }
    const failure = this.applyReadyTransition(beforeEffects)
    if (!failure) return
    if (this.readyFailureSink) this.readyFailureSink(failure)
    else throw failure.error
  }

  /**
   * @internal Hold ready-effect failures while a sync function runs, whether
   * it calls markReady or commits a truncate. The returned function stops
   * holding them and returns the first one.
   */
  public deferReadyFailures(): () => { error: unknown } | undefined {
    let first: { error: unknown } | undefined
    this.readyFailureSink = (failure) => {
      first ??= failure
    }
    return () => {
      this.readyFailureSink = undefined
      return first
    }
  }

  private applyReadyTransition(
    beforeEffects?: () => void,
  ): { error: unknown } | undefined {
    this.validateStatusTransition(this.status, `ready`)
    // A successful initial sync establishes a ready snapshot, as does a
    // reload of a failed first load.
    if (this.status === `loading` || this.status === `error`) {
      const readyRevision = this.statusRevision + 1
      this.setStatus(`ready`, true, beforeEffects)

      // A status listener can synchronously supersede this transition, even
      // when it restarts the Collection back to ready before returning.
      if (
        (this.status as CollectionStatus) !== `ready` ||
        this.statusRevision !== readyRevision
      ) {
        return undefined
      }

      const readyEffects: Array<() => void> = []

      // Call any registered first ready callbacks (only on first time becoming ready)
      if (!this.hasBeenReady) {
        this.hasBeenReady = true

        // Also mark as having received first commit for backwards compatibility
        this.hasReceivedFirstCommit = true

        readyEffects.push(...this.onFirstReadyCallbacks)
        this.onFirstReadyCallbacks = []
      }
      // Notify dependents when markReady is called, after status is set
      // This ensures live queries get notified when their dependencies become ready
      readyEffects.push(() => this.changes.emitEmptyReadyEvent())
      try {
        runAllCallbacks(readyEffects)
      } catch (error) {
        return { error }
      }
    }
    return undefined
  }

  /**
   * The sync adapter stopped. Before the first ready this fails the sync
   * run's first load; after it, the rows stay and the error shows until a
   * reload. A second fail() in the same sync run changes nothing: the adapter
   * already stopped, and the first error stays.
   */
  public fail(error: unknown): void {
    if (this.status === `crashed` || this.adapterStopped) return
    this.adapterStopped = true
    const reload = this.reloadRun
    this.reloadRun = undefined
    if (reload) this.sync.dropReloadReplacement()
    if (this.status === `ready`) {
      // The rows stay; a reload that failed shows its new error instead.
      this.failureReason = null
      this.stoppedError = problemOf([describeProblem(error)])
      this.events.emitHealthChange()
    } else if (reload && this.status === `error`) {
      // A reload of a failed first load keeps status `error` with the new
      // cause.
      this.statusError = problemOf([describeProblem(error)])
      this.events.emitHealthChange()
    } else {
      this.validateStatusTransition(this.status, `error`)
      this.statusError = problemOf([describeProblem(error)])
      this.setStatus(`error`)
    }
    reload?.reject(error)
  }

  /** Whether the current sync run's adapter called `fail()`. */
  public get stoppedThisRun(): boolean {
    return this.adapterStopped
  }

  /**
   * Whether the current sync run is in its first load: `loading`, or a reload
   * of a failed first load that is not ready yet. A failure now fails that
   * first load.
   */
  public get inFirstLoad(): boolean {
    return (
      this.status === `loading` || (this.reloading && this.status === `error`)
    )
  }

  /** Whether a reload's new sync run is in flight. */
  public get reloading(): boolean {
    return this.reloadRun !== undefined
  }

  /**
   * A reload starts a new sync run while everything visible stays: the rows,
   * the status, and the current problem. The node shows `reloading`.
   */
  public beginReload(): Promise<void> {
    if (this.reloadRun) return this.reloadRun.promise
    const run = createDeferred<void>()
    void run.promise.catch(() => undefined)
    this.reloadRun = run
    this.failureReasonFromReload = false
    this.adapterStopped = false
    this.events.emitHealthChange()
    return run.promise
  }

  /**
   * The reload's first commit replaced the rows: its problems clear, and a
   * failed first load becomes ready.
   */
  public completeReload(beforeEffects?: () => void): void {
    const run = this.reloadRun
    if (!run) return
    this.reloadRun = undefined
    if (!this.failureReasonFromReload) this.failureReason = null
    this.stoppedError = null
    this.requestErrors = new RequestErrors()
    if (this.status === `ready`) this.events.emitHealthChange()
    else {
      // A failed first load, or a reload during the first load, becomes
      // ready with the new run's rows.
      this.statusError = null
      this.recovering = true
      try {
        this.markReady(beforeEffects)
      } catch (error) {
        // A ready callback that throws reaches the adapter's markReady(); the
        // reload succeeded once the status is ready.
        if ((this.status as CollectionStatus) === `ready`) run.resolve()
        else run.reject(error)
        throw error
      } finally {
        this.recovering = false
      }
    }
    run.resolve()
  }

  /** A reload retired the sync run; subscriptions detach its demand. */
  public retireSubscriptionDemand(): void {
    for (const subscription of this.changes.changeSubscriptions) {
      subscription.retireSyncRun()
    }
  }

  /** The reload ended without a commit, for example by cleanup. */
  public abandonReload(error: unknown): void {
    if (!this.endReload(error)) return
    if (this.status !== `cleaned-up`) this.events.emitHealthChange()
  }

  private endReload(error: unknown): boolean {
    const run = this.reloadRun
    if (!run) return false
    this.reloadRun = undefined
    this.sync.dropReloadReplacement()
    run.reject(error)
    return true
  }

  /**
   * Local storage or an internal invariant broke. The Collection can no
   * longer serve reads or accept writes, from any active status. Nothing
   * recovers a crash in place: only cleanup, which discards all state, leaves
   * it.
   */
  public crash(error?: unknown): void {
    if (this.status === `crashed`) return
    this.validateStatusTransition(this.status, `crashed`)
    // A crash ends a reload in flight with it; its status change announces
    // the tree.
    this.endReload(error)
    this.statusError = problemOf([describeProblem(error)])
    this.setStatus(`crashed`)
  }

  /** The Collection's own problems, as health tree detail. */
  public get problems(): {
    failureReason: HealthProblem | null
    error: HealthProblem | null
  } {
    const error = this.statusAllowsError()
      ? this.statusError
      : (this.stoppedError ?? this.requestErrors.problem)
    return { failureReason: error ? null : this.failureReason, error }
  }

  /** The cause of status `error` or `crashed`, as health tree detail. */
  public get statusProblem(): HealthProblem | null {
    return this.statusAllowsError() ? this.statusError : null
  }

  private statusAllowsError(): boolean {
    return this.status === `error` || this.status === `crashed`
  }

  /** The sync adapter still tries after a problem. Status and rows do not change. */
  public reportError(error: unknown): void {
    if (this.status === `crashed`) return
    this.assertAdapterActive(`reportError`)
    this.assertReady(`reportError`)
    // A reload's new run that reports starts its own list: the retired run's
    // failures leave with that run.
    const kept =
      this.reloading && !this.failureReasonFromReload
        ? []
        : (this.failureReason?.errors ?? [])
    // One error value is one failure: one already listed is still open, so
    // it keeps its place and its `at`, and nothing changes.
    if (kept.some((failure) => failure.cause === error)) return
    this.failureReason = problemOf([...kept, describeProblem(error)])
    this.failureReasonFromReload = this.reloading
    this.events.emitHealthChange()
  }

  /**
   * The source synced successfully again. With no error it clears the
   * failure reason; with one it removes the failure whose cause is that
   * value, and the failure reason clears once none is left. With nothing to
   * remove it does nothing.
   */
  public reportHealthy(error?: unknown): void {
    if (this.status === `crashed`) return
    this.assertAdapterActive(`reportHealthy`)
    this.assertReady(`reportHealthy`)
    const listed = this.failureReason?.errors ?? []
    const open =
      error === undefined
        ? []
        : listed.filter((failure) => failure.cause !== error)
    if (open.length === listed.length) return
    this.failureReason = open.length > 0 ? problemOf(open) : null
    this.events.emitHealthChange()
  }

  /**
   * @internal A live query's request failed after initial-query readiness,
   * with each of its failures in failure order.
   */
  public reportRequestError(key: string, errors: Array<unknown>): void {
    if (this.requestErrors.fail(key, errors)) this.events.emitHealthChange()
  }

  /** @internal The failed request settled or was released. */
  public clearRequestError(key: string): void {
    if (this.requestErrors.settle(key)) this.events.emitHealthChange()
  }

  /** fail() ends the sync adapter's reporting for its sync run. */
  private assertAdapterActive(operation: string): void {
    if (this.adapterStopped) {
      throw new CollectionStateError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `${operation}() was called after fail() in the same sync run of Collection "${this.id}". fail() means the sync adapter stopped; a reload starts a new sync run.`
          : codedMessage(259, { operation, id: this.id }),
      )
    }
  }

  private assertReady(operation: string): void {
    if (this.status !== `ready`) {
      throw new CollectionStateError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `${operation}() reports on sync after the first ready, but Collection "${this.id}" is ${this.status}. Before the first ready, retry without reporting, or call fail() when the sync adapter stops.`
          : codedMessage(257, { operation, id: this.id, status: this.status }),
      )
    }
  }

  /** Return the cause of status `error` or `crashed` in this sync run, if any. */
  public getSyncError(): unknown {
    return this.statusError?.cause
  }

  /** Cleanup discards the current projection until a new sync run starts. */
  public hasStartedCleanup(): boolean {
    return this.cleaningUp || this.status === `cleaned-up`
  }

  public assertCanStartSync(): void {
    if (this.cleaningUp) {
      throw new CollectionStateError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `Cannot start collection "${this.id}" during cleanup. Restart after cleanup() completes.`
          : codedMessage(209, { id: this.id }),
      )
    }
  }

  public isCleaningUp(): boolean {
    return this.cleaningUp
  }

  /**
   * Observe the synchronous start of cleanup without treating it as terminal
   * resource settlement. Internal dependents use this to retire work before
   * an asynchronous adapter cleanup publishes `cleaned-up`.
   */
  public onCleanupStart(callback: () => void): () => void {
    this.cleanupStartCallbacks.add(callback)
    if (this.cleaningUp) {
      try {
        callback()
      } catch (error) {
        // Registration did not return its ownership handle. Do not retain an
        // observer that its caller has no way to unsubscribe.
        this.cleanupStartCallbacks.delete(callback)
        throw error
      }
    }
    return () => this.cleanupStartCallbacks.delete(callback)
  }

  /**
   * Start the garbage collection timer for a collection with no subscribers
   * Called when sync starts outside a subscription
   */
  public startGCTimerIfUnsubscribed(): void {
    this.gcGraceUntil = cleanupNow() + UNSUBSCRIBED_GC_FLOOR_MS
    this.startGCTimer(true)
  }

  // A persisting transaction holds the Collection: collecting it would drop
  // the rows the transaction shows and end the sync run its handler may wait on.
  private canGarbageCollect(): boolean {
    return (
      !this.cleaningUp &&
      this.changes.activeSubscribersCount === 0 &&
      !this.sync.hasPendingPreload &&
      !this.state.hasPersistingTransaction()
    )
  }

  /**
   * Renew inactive retention. Settlement keeps the remaining startup/preload
   * handoff; a real last unsubscribe clears it and uses gcTime exactly.
   */
  public startGCTimer(preserveHandoff = false): void {
    if (!preserveHandoff) this.gcGraceUntil = 0
    if (this.status === `idle` || this.status === `cleaned-up`) return
    this.cancelGCTimer()
    if (!this.canGarbageCollect()) return

    const gcTime = this.config.gcTime ?? DEFAULT_GC_TIME_MS

    // If gcTime is 0, negative, or non-finite (Infinity, -Infinity, NaN), GC is disabled.
    // Note: setTimeout with Infinity coerces to 0 via ToInt32, causing immediate GC,
    // so we must explicitly check for non-finite values here.
    if (gcTime <= 0 || !Number.isFinite(gcTime)) {
      return
    }

    CleanupQueue.getInstance().schedule(
      this,
      Math.max(gcTime, this.gcGraceUntil - cleanupNow()),
      () => {
        if (this.canGarbageCollect()) {
          // Schedule cleanup during idle time to avoid blocking the UI thread
          this.scheduleIdleCleanup()
        }
      },
    )
  }

  /**
   * Cancel the garbage collection timer
   * Called when the collection becomes active again
   */
  public cancelGCTimer(): void {
    CleanupQueue.getInstance().cancel(this)
    // Also cancel any pending idle cleanup
    if (this.idleCallbackId !== null) {
      safeCancelIdleCallback(this.idleCallbackId)
      this.idleCallbackId = null
    }
  }

  /**
   * Schedule cleanup to run during browser idle time
   * This prevents blocking the UI thread during cleanup operations
   */
  private scheduleIdleCleanup(): void {
    // Cancel any existing idle callback
    if (this.idleCallbackId !== null) {
      safeCancelIdleCallback(this.idleCallbackId)
    }

    // Schedule cleanup with a timeout of 1 second
    // This ensures cleanup happens even if the browser is busy
    this.idleCallbackId = safeRequestIdleCallback(
      (deadline) => {
        // Keep the callback ID only when cleanup schedules another idle period.
        if (this.canGarbageCollect()) {
          if (!(deadline.timeRemaining() > 0 || deadline.didTimeout)) {
            this.scheduleIdleCleanup()
            return
          }
          // Automatic GC has no caller to receive cleanup rejection. Core still
          // finalizes the lifecycle; explicit cleanup returns adapter diagnostics.
          void this.beginCleanup().catch(() => undefined)
        }
        this.idleCallbackId = null
      },
      { timeout: 1000 },
    )
  }

  private beginCleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise

    const completion = createDeferred<void>()
    this.cleanupPromise = completion.promise
    this.cleaningUp = true
    const localFailures: Array<unknown> = []
    let synchronousSyncFailure: { error: unknown } | undefined
    let syncCleanupComplete = true

    const attempt = (callback: () => void): void => {
      try {
        callback()
      } catch (error) {
        localFailures.push(error)
      }
    }

    // Dependents must stop using the discarded sync run immediately, while
    // the public status and cleanup promise still wait for adapter settlement.
    for (const callback of [...this.cleanupStartCallbacks]) {
      attempt(callback)
    }

    const finish = (syncFailure?: { error: unknown }) => {
      // Sync cleanup either completes synchronously or calls this once after
      // its promise settles. Reentrant callers share cleanupPromise above.
      this.cleaningUp = false
      this.statusError = null
      attempt(() => this.setStatus(`cleaned-up`))

      // Active collection subscriptions still depend on lifecycle events.
      // Once the last subscriber leaves, its GC cleanup clears the handlers.
      if (this.changes.activeSubscribersCount === 0) {
        attempt(() => this.events.cleanup())
      }

      // Keep cleanup observably asynchronous even when every release is
      // synchronous. Existing callers may use this turn to let optimistic
      // settlement finish before starting the next operation.
      const failures = syncFailure
        ? [syncFailure.error, ...localFailures]
        : localFailures
      const failure =
        failures.length === 0
          ? undefined
          : {
              error:
                failures.length === 1
                  ? failures[0]
                  : new AggregateError(
                      failures,
                      devBuild() && process.env.NODE_ENV !== `production`
                        ? syncFailure
                          ? `Adapter cleanup and local teardown both failed`
                          : `Multiple local teardown steps failed`
                        : codedMessage(173, {
                            syncFailure: syncFailure !== undefined,
                          }),
                      { cause: failures[0] },
                    ),
            }
      void Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
          if (this.cleanupPromise === completion.promise) {
            this.cleanupPromise = null
          }
          if (failure) completion.reject(failure.error)
          else completion.resolve()
        })
    }

    // Sync cleanup invalidates the sync run before invoking the adapter. The
    // remaining managers retire their local state synchronously while the
    // adapter's resource-release promise is pending.
    attempt(() => this.cleanupConfig())
    try {
      syncCleanupComplete = this.sync.cleanup(finish)
    } catch (error) {
      synchronousSyncFailure = { error }
    }

    attempt(() => this.state.cleanup())
    attempt(() => this.changes.cleanup())
    attempt(() => this.indexes.cleanup())
    this.hasBeenReady = false
    // Problems belong to the discarded sync run. The cause of a `crashed` or
    // `error` status stays while that status shows; finish() clears it.
    const before = this.problems
    const reloading = this.reloading
    this.adapterStopped = false
    this.failureReason = null
    this.stoppedError = null
    this.requestErrors = new RequestErrors()
    // An abandoned reload announces the tree; otherwise announce dropped
    // problems here, since the status changes only when cleanup settles.
    this.abandonReload(new CollectionPreloadAbortedError())
    const after = this.problems
    if (
      !reloading &&
      (before.error !== after.error ||
        before.failureReason !== after.failureReason)
    )
      this.events.emitHealthChange()
    // Cleanup is not readiness. Sync cleanup rejects pending preload callers;
    // first-ready listeners belong to the discarded run.
    this.onFirstReadyCallbacks = []

    if (syncCleanupComplete) finish(synchronousSyncFailure)
    return completion.promise
  }

  /**
   * Register a callback to be executed when the collection first becomes ready
   * Useful for preloading collections
   * @param callback Function to call when the collection first becomes ready
   */
  public onFirstReady(callback: () => void): () => void {
    // If already ready, call immediately
    if (this.hasBeenReady) {
      callback()
      return () => {}
    }

    this.onFirstReadyCallbacks.push(callback)
    return () => {
      const index = this.onFirstReadyCallbacks.indexOf(callback)
      if (index !== -1) {
        this.onFirstReadyCallbacks.splice(index, 1)
      }
    }
  }

  public cleanup(): Promise<void> {
    this.cancelGCTimer()

    // Return this exact retirement operation even if an event listener starts
    // a replacement run and cleanup while the first promise is still pending.
    return this.beginCleanup()
  }
}

/** @internal Requests that failed after initial-query readiness, by issuer. */
export class RequestErrors {
  // Each failed request's failures, each with the number that orders it
  // among the failures. Two requests that failed with one error share one
  // entry value.
  private readonly failed = new Map<
    string,
    Array<[CollectionErrorInfo, number]>
  >()
  private failures = 0
  problem: HealthProblem | null = null

  /** Returns whether the problem changed. */
  fail(key: string, errors: Array<unknown>): boolean {
    this.failed.delete(key)
    // Two requests that failed with one error are one failure, and it keeps
    // its place among the failures.
    const entries: Array<[CollectionErrorInfo, number]> = []
    for (const error of errors)
      entries.push(
        [...this.failed.values(), entries]
          .flat()
          .find(([failure]) => failure.cause === error) ?? [
          describeProblem(error),
          ++this.failures,
        ],
      )
    this.failed.set(key, entries)
    return this.show()
  }

  /** Returns whether the problem changed. */
  settle(key: string): boolean {
    return this.failed.delete(key) && this.show()
  }

  // The newest failure still failing shows, and the problem lists every
  // failure still failing, oldest first. It stays the same object until
  // that list changes.
  private show(): boolean {
    const errors = [...new Set([...this.failed.values()].flat())]
      .sort((a, b) => a[1] - b[1])
      .map(([failure]) => failure)
    const shown = this.problem?.errors ?? []
    if (
      errors.length === shown.length &&
      errors.every((failure, index) => failure === shown[index])
    )
      return false
    this.problem = errors.length > 0 ? problemOf(errors) : null
    return true
  }
}

/**
 * @internal Orders one source's loads: a request error clears only when a
 * load started after the failure succeeds. A load already in flight cannot
 * cover the data whose request failed.
 */
export class LoadOrder {
  private started = 0
  // Loads started before the latest failure; their success clears nothing.
  private startedBeforeFailure = 0

  track(result: unknown, settle: () => void): void {
    const order = ++this.started
    void Promise.resolve(result).then(
      () => {
        if (order > this.startedBeforeFailure) settle()
      },
      () => {
        this.startedBeforeFailure = this.started
      },
    )
  }
}

/**
 * @internal A health problem: its newest failure's fields, with every
 * failure of its frame listed, oldest first.
 */
export function problemOf(
  errors: ReadonlyArray<CollectionErrorInfo>,
): HealthProblem {
  const newest = errors[errors.length - 1]!
  return withCause({ ...newest, errors }, newest.cause)
}

// The original value stays available but out of JSON.
function withCause<T extends object>(
  info: T,
  cause: unknown,
): T & { cause: unknown } {
  return Object.defineProperty(info, `cause`, {
    value: cause,
    enumerable: false,
  }) as T & { cause: unknown }
}

/** @internal Health tree detail for a problem value. */
export function describeProblem(error: unknown): CollectionErrorInfo {
  // Any value can be a problem. One that cannot describe itself, such as an
  // object without a prototype or a throwing getter, keeps what was read.
  let name = `Error`
  let message = `Collection is in an error state`
  let code: unknown
  try {
    if (error instanceof Error) {
      name = error.name
      message = error.message
    } else if (error !== undefined) message = String(error)
    code = (error as { code?: unknown } | null)?.code
  } catch {
    // The problem still shows, with the generic parts.
  }
  return withCause(
    {
      name,
      message,
      ...(typeof code === `string` ? { code } : {}),
      at: Date.now(),
    },
    error,
  )
}
