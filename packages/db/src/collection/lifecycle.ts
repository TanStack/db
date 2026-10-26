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
import { CleanupQueue } from './cleanup-queue'
import type { Deferred } from '../deferred'
import type { IdleCallbackDeadline } from '../utils/browser-polyfills'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  CollectionConfig,
  CollectionErrorInfo,
  CollectionStatus,
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
  // cannot clear the sync adapter's problem.
  private failureReason: CollectionErrorInfo | null = null
  // A reload's new run reported the failure reason, so its first commit keeps it.
  private failureReasonFromReload = false
  private stoppedError: CollectionErrorInfo | null = null
  // The cause of status `error` or `crashed`, kept so readers see the same
  // object until the sync run ends.
  private statusError: CollectionErrorInfo | null = null
  private requestErrors = new RequestErrors()
  // fail() ends the sync adapter's reporting for its sync run; a reload or
  // cleanup starts a new one.
  private adapterStopped = false
  // A reload's new sync run, until its first commit or its failure.
  private reloadRun: Deferred<void> | undefined
  // A reload is moving the Collection out of `error`.
  private recovering = false
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
      this.stoppedError = describeProblem(error)
      this.events.emitHealthChange()
    } else if (reload && this.status === `error`) {
      // A reload of a failed first load keeps status `error` with the new
      // cause.
      this.statusError = describeProblem(error)
      this.events.emitHealthChange()
    } else {
      this.validateStatusTransition(this.status, `error`)
      this.statusError = describeProblem(error)
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
    this.statusError = describeProblem(error)
    this.setStatus(`crashed`)
  }

  /** The Collection's own problems, as health tree detail. */
  public get problems(): {
    failureReason: CollectionErrorInfo | null
    error: CollectionErrorInfo | null
  } {
    const error = this.statusAllowsError()
      ? this.statusError
      : (this.stoppedError ?? this.requestErrors.problem)
    return { failureReason: error ? null : this.failureReason, error }
  }

  /** The cause of status `error` or `crashed`, as health tree detail. */
  public get statusProblem(): CollectionErrorInfo | null {
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
    this.failureReason = describeProblem(error)
    this.failureReasonFromReload = this.reloading
    this.events.emitHealthChange()
  }

  /** The source synced successfully again. With nothing to clear it does nothing. */
  public reportHealthy(): void {
    if (this.status === `crashed`) return
    this.assertAdapterActive(`reportHealthy`)
    this.assertReady(`reportHealthy`)
    if (!this.failureReason) return
    this.failureReason = null
    this.events.emitHealthChange()
  }

  /** @internal A live query's request failed after initial-query readiness. */
  public reportRequestError(key: string, error: unknown): void {
    if (this.requestErrors.fail(key, error)) this.events.emitHealthChange()
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
          : codedMessage(247, { operation, id: this.id }),
      )
    }
  }

  private assertReady(operation: string): void {
    if (this.status !== `ready`) {
      throw new CollectionStateError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `${operation}() reports on sync after the first ready, but Collection "${this.id}" is ${this.status}. Before the first ready, retry without reporting, or call fail() when the sync adapter stops.`
          : codedMessage(245, { operation, id: this.id, status: this.status }),
      )
    }
  }

  /** Return the cause of status `error` or `crashed` in this sync run, if any. */
  public getSyncError(): unknown {
    return this.statusError?.cause
  }

  public assertCanStartSync(): void {
    if (this.cleaningUp) {
      throw new CollectionStateError(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `Cannot start collection "${this.id}" during cleanup. Restart after cleanup() completes.`
          : codedMessage(209, { id: this.id }),
      )
    }
    // A synchronously finished retirement retains its public promise until
    // settlement. Starting a new sync run assigns later cleanup to that run.
    this.cleanupPromise = null
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
    this.startGCTimer(UNSUBSCRIBED_GC_FLOOR_MS)
  }

  private canGarbageCollect(): boolean {
    return (
      !this.cleaningUp &&
      this.changes.activeSubscribersCount === 0 &&
      !this.sync.hasPendingPreload
    )
  }

  /**
   * Start the garbage collection timer
   * Called when the collection becomes inactive (no subscribers)
   */
  public startGCTimer(minDelay = 0): void {
    if (!this.canGarbageCollect()) return

    const gcTime = this.config.gcTime ?? 300000 // 5 minutes default

    // If gcTime is 0, negative, or non-finite (Infinity, -Infinity, NaN), GC is disabled.
    // Note: setTimeout with Infinity coerces to 0 via ToInt32, causing immediate GC,
    // so we must explicitly check for non-finite values here.
    if (gcTime <= 0 || !Number.isFinite(gcTime)) {
      return
    }

    CleanupQueue.getInstance().schedule(
      this,
      Math.max(gcTime, minDelay),
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
        // Clean up if we still have no subscribers. Keep the callback ID
        // only when cleanup rescheduled itself for a later idle period.
        if (!this.canGarbageCollect()) {
          this.idleCallbackId = null
        } else if (this.performCleanup(deadline)) {
          this.idleCallbackId = null
        }
      },
      { timeout: 1000 },
    )
  }

  /**
   * Perform cleanup operations, optionally in chunks during idle time
   * @returns true if cleanup was completed, false if it was rescheduled
   */
  private performCleanup(deadline?: IdleCallbackDeadline): boolean {
    // Nested cleanup belongs to this retirement, not a new lifecycle turn.
    if (this.cleaningUp) return true
    // If we have a deadline, we can potentially split cleanup into chunks
    // For now, we'll do all cleanup at once but check if we have time
    const hasTime =
      !deadline || deadline.timeRemaining() > 0 || deadline.didTimeout

    if (hasTime) {
      const cleanup = this.beginCleanup()
      // Automatic GC has no caller to receive cleanup rejection. Core still
      // finalizes the lifecycle; adapter diagnostics remain observable through
      // the returned promise for explicit cleanup.
      void cleanup.catch(() => undefined)

      return true
    } else {
      // If we don't have time, reschedule for the next idle period
      this.scheduleIdleCleanup()
      return false
    }
  }

  private beginCleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise

    const completion = createDeferred<void>()
    this.cleanupPromise = completion.promise
    this.cleaningUp = true
    const localFailures: Array<unknown> = []
    let synchronousSyncFailure: { error: unknown } | undefined
    let syncCleanupComplete = true
    let finished = false

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
      if (finished) return
      finished = true
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
    CleanupQueue.getInstance().cancel(this)

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
    // Cancel any pending idle cleanup
    if (this.idleCallbackId !== null) {
      safeCancelIdleCallback(this.idleCallbackId)
      this.idleCallbackId = null
    }

    // Return this exact retirement operation even if an event listener starts
    // a replacement run and cleanup while the first promise is still pending.
    return this.beginCleanup()
  }
}

/** @internal Requests that failed after initial-query readiness, by issuer. */
export class RequestErrors {
  // Each failed request's problem, with the number that orders it among the
  // failures. Two requests that failed with one error share one entry value.
  private readonly failed = new Map<string, [CollectionErrorInfo, number]>()
  private failures = 0
  problem: CollectionErrorInfo | null = null

  /** Returns whether the shown problem changed. */
  fail(key: string, error: unknown): boolean {
    this.failed.delete(key)
    // Two requests that failed with one error show one problem, and it keeps
    // its place among the failures.
    this.failed.set(
      key,
      [...this.failed.values()].find(
        ([problem]) => problem.cause === error,
      ) ?? [describeProblem(error), ++this.failures],
    )
    return this.show()
  }

  /** Returns whether the shown problem changed. */
  settle(key: string): boolean {
    return this.failed.delete(key) && this.show()
  }

  // The newest failure still failing shows.
  private show(): boolean {
    let newest: [CollectionErrorInfo | null, number] = [null, 0]
    for (const entry of this.failed.values())
      if (entry[1] > newest[1]) newest = entry
    const changed = newest[0] !== this.problem
    this.problem = newest[0]
    return changed
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
  const info = {
    name,
    message,
    ...(typeof code === `string` ? { code } : {}),
    at: Date.now(),
  } as CollectionErrorInfo
  // The original value stays available but out of JSON.
  Object.defineProperty(info, `cause`, { value: error, enumerable: false })
  return info
}
