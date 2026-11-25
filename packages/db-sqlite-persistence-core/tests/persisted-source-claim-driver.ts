/**
 * Claim authority crossed with ordinary, diverted and queued source commits.
 * Actual storage writes and held reads establish the FIFO cuts. Host renewal
 * and clock returns place recovery/expiry both during their await and before
 * the caller resumes. Continuation cuts require the row still absent and its
 * receipt pending when authority changes, rather than assuming a microtask
 * count alone establishes that premise. Hosts supply storage, never answers.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import { describeOracleCleanupError } from '../../db/tests/oracle-cleanup'
import type { HydrationPersistenceAdapter } from '../src'
import type { OpenSourceFifoStore } from './persisted-source-fifo-driver'
import type { Todo, TodoSyncParams } from './persisted-support'

export type SourceClaimCut =
  | `live`
  | `expired`
  | `expired-during-baseline`
  | `queued-expired-during-baseline`
  | `queued-recovery-pending`
  | `recovery-pending`
  | `recovery-during-renewal`
  | `ordinary-recovery-during-renewal`
  | `ordinary-recovery-after-renewal`
  | `ordinary-expired-after-renewal`
  | `ordinary-expired-after-live-check`
  | `ordinary-expired-at-turn`
  | `ordinary-recovery-pending`
  | `dependent-recovery-pending`
  | `live-read-error`
export type SourceClaimHistory = {
  cut: SourceClaimCut
  title: string
  elapsed: number
  successors: number
}
export type SourceClaimObservation = {
  cut: SourceClaimCut
  reached: boolean
  requestLocalReadFailed: boolean
  baselineReads: number
  rotations: number
  outcomes: Array<{
    status: string
    name: string | null
    sameReadError: boolean
  }>
  status: string
  shared: { id: string; title: string; detail?: string } | null
  next: string
  nextStatus: string
  executionErrors?: Array<string>
  nextRows: {
    public: Todo | null
    durable: Todo | null
    currentTarget: boolean | null
  }
  cleanupErrors: Array<string>
  browserErrors?: ReadonlyArray<string>
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Source claim checkpoint: ${label}`)),
          5000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
let sequence = 0
export async function runSourceClaimHistory(
  history: SourceClaimHistory,
  open: OpenSourceFifoStore,
): Promise<SourceClaimObservation> {
  const queued = history.cut.startsWith(`queued-`)
  const ordinary = history.cut.startsWith(`ordinary-`)
  const ordinaryAtTurn =
    history.cut === `ordinary-expired-at-turn` ||
    history.cut === `ordinary-recovery-pending`
  const requestLocalFailure = new Error(`request-local hydration read failed`)
  const continuation = {
    recoveryBeforeApplication: false,
    expiryBeforeApplication: false,
  }
  let expiryScheduled = false
  let now = 1_000_000
  const ttl = 120_000
  let measuring = false
  const store = await open(
    `source-claim-${++sequence}`,
    [{ id: `shared`, title: `cached`, detail: `unseen durable field` }],
    undefined,
    {
      now: () => {
        if (
          history.cut === `ordinary-expired-after-live-check` &&
          measuring &&
          !expiryScheduled
        ) {
          expiryScheduled = true
          queueMicrotask(() =>
            queueMicrotask(() => {
              continuation.expiryBeforeApplication =
                collection.get(`shared`) === undefined &&
                !premise.successorsSettled
              now += ttl + history.elapsed
            }),
          )
        }
        return now
      },
      ttl,
    },
  )
  const { adapter } = store
  let currentStorage: string | undefined
  let nextStorage: string | undefined
  if (adapter.claimCacheGeneration) {
    const claim = adapter.claimCacheGeneration.bind(adapter)
    adapter.claimCacheGeneration = async (...args) => {
      const claimed = await claim(...args)
      currentStorage = claimed.storageCollectionId
      return claimed
    }
  }
  const firstEntered = gate(),
    releaseFirst = gate()
  const readEntered = gate(),
    releaseRead = gate()
  const olderDurable = gate(),
    releaseOlder = gate(),
    recovered = gate()
  const renewalEntered = gate(),
    releaseRenewal = gate()
  let holdFirst = true,
    holdRead = true
  let baselineReads = 0,
    rotations = 0
  const premise = {
    heldReadReached: false,
    requestLocalReadFailed: false,
    predecessorDurable: false,
    successorsSettled: false,
  }
  const readError = new Error(`live baseline read failed`)
  let source!: TodoSyncParams
  const receipts: Array<Promise<unknown>> = []
  let read: Promise<unknown> | undefined, recovery: Promise<unknown> | undefined
  let result: SourceClaimObservation | undefined
  let primaryFailure: unknown
  let hasPrimaryFailure = false
  const cleanupFailures: Array<unknown> = []
  const decorate = (
    scope: HydrationPersistenceAdapter,
  ): HydrationPersistenceAdapter => ({
    ...scope,
    loadSubset: async (...args) => {
      const rows = await scope.loadSubset(...args)
      if (holdRead) {
        holdRead = false
        premise.heldReadReached = true
        readEntered.resolve()
        await releaseRead.promise
        if (queued) throw requestLocalFailure
      }
      return rows
    },
    renewCacheGenerationClaim:
      scope.renewCacheGenerationClaim &&
      (async (...args) => {
        const expiration = await scope.renewCacheGenerationClaim!(...args)
        if (
          measuring &&
          (history.cut.endsWith(`recovery-during-renewal`) ||
            history.cut === `ordinary-recovery-after-renewal` ||
            history.cut === `ordinary-expired-after-renewal`)
        ) {
          renewalEntered.resolve()
          await releaseRenewal.promise
          if (
            history.cut === `ordinary-recovery-after-renewal` ||
            history.cut === `ordinary-expired-after-renewal`
          )
            queueMicrotask(() =>
              queueMicrotask(() =>
                queueMicrotask(() => {
                  const before =
                    collection.get(`shared`) === undefined &&
                    !premise.successorsSettled
                  if (history.cut === `ordinary-expired-after-renewal`) {
                    continuation.expiryBeforeApplication = before
                    now += ttl + history.elapsed
                  } else {
                    continuation.recoveryBeforeApplication = before
                    recovery =
                      source.metadata!.persistence!.startScopedRecovery!()
                    void recovery.catch(() => undefined)
                  }
                }),
              ),
            )
        }
        return expiration
      }),
    loadResumeSnapshot: async (...args) => {
      if (measuring && args[1]?.includeRows !== false) {
        baselineReads++
        if (history.cut.endsWith(`expired-during-baseline`))
          now += ttl + history.elapsed
        if (history.cut === `live-read-error`) throw readError
      }
      return scope.loadResumeSnapshot(...args)
    },
    applyCommittedTx: async (...args) => {
      const mutations = args[1].mutations
      if (holdFirst && mutations.some((m) => m.key === `gate`)) {
        holdFirst = false
        firstEntered.resolve()
        await releaseFirst.promise
      }
      await scope.applyCommittedTx(...args)
      if (
        (queued || ordinary) &&
        mutations.some((mutation) => mutation.key === `gate`)
      )
        premise.predecessorDurable = true
      if (mutations.some((mutation) => mutation.key === `next`))
        nextStorage =
          args[0].kind === `managed`
            ? args[0].storageCollectionId
            : args[0].collectionId
      if (mutations.some((m) => m.key === `older`)) {
        premise.predecessorDurable = true
        olderDurable.resolve()
        await releaseOlder.promise
      }
    },
  })
  const root = decorate({
    loadSubset: adapter.loadSubset.bind(adapter),
    loadResumeSnapshot: adapter.loadResumeSnapshot.bind(adapter),
    applyCommittedTx: adapter.applyCommittedTx.bind(adapter),
    renewCacheGenerationClaim: adapter.renewCacheGenerationClaim?.bind(adapter),
  } as HydrationPersistenceAdapter)
  adapter.loadSubset = root.loadSubset
  adapter.loadResumeSnapshot = root.loadResumeSnapshot
  adapter.applyCommittedTx = root.applyCommittedTx
  adapter.renewCacheGenerationClaim = root.renewCacheGenerationClaim
  if (adapter.runInHydrationScope) {
    const hydrate = adapter.runInHydrationScope.bind(adapter)
    adapter.runInHydrationScope = (task) =>
      hydrate((scope) => task(decorate(scope)))
  }
  if (adapter.runInRegularScope) {
    const regular = adapter.runInRegularScope.bind(adapter)
    const after = adapter.runInRegularScope.afterQueuedWork.bind(
      adapter.runInRegularScope,
    )
    adapter.runInRegularScope = Object.assign(
      <T>(task: (scope: HydrationPersistenceAdapter) => Promise<T>) =>
        regular((scope) => task(decorate(scope))),
      { afterQueuedWork: after },
    )
  }
  if (adapter.rotateCacheGeneration) {
    const rotate = adapter.rotateCacheGeneration.bind(adapter)
    adapter.rotateCacheGeneration = async (...args) => {
      rotations++
      const rotated = await rotate(...args)
      currentStorage = rotated.storageCollectionId
      return rotated
    }
  }
  const collection = createCollection(
    persistedCollectionOptions<Todo, string>({
      id: `source-claim-${sequence}`,
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      sync: {
        rowUpdateMode: `partial`,
        sync: (params) => {
          source = params
          params.markReady()
          return {
            loadSubset: () => true,
            restartAfterScopedRecovery: (ready: Promise<void>) =>
              ready.then(() => recovered.resolve()),
          }
        },
      },
      persistence: { adapter },
    }),
  )
  function commit() {
    const receipt = Promise.resolve(source.commit())
    void receipt.catch(() => undefined)
    receipts.push(receipt)
    return receipt
  }
  try {
    collection.startSyncImmediate()
    await bounded(collection.stateWhenReady(), `ready`)
    source.begin()
    source.write({ type: `insert`, value: { id: `gate`, title: `gate` } })
    const first = commit()
    await bounded(firstEntered.promise, `gate write`)
    if (queued || ordinary) {
      // With no outstanding ordinary commit, source work admitted during the
      // held read belongs to its replay queue and carries receipt callbacks.
      releaseFirst.resolve()
      await bounded(first, `queued path ordinary predecessor complete`)
    }
    if (ordinaryAtTurn) {
      source.begin()
      source.write({ type: `insert`, value: { id: `older`, title: `older` } })
      commit()
      await bounded(
        olderDurable.promise,
        `ordinary source turn held after durable predecessor`,
      )
    }
    if (!ordinary) {
      read = Promise.resolve(collection._sync.loadSubset({}))
      void read.catch((error: unknown) => {
        premise.requestLocalReadFailed = error === requestLocalFailure
      })
    }
    if (!queued && !ordinary) {
      // Let demand admission reserve its turn behind the held ordinary write.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      source.begin()
      source.write({ type: `insert`, value: { id: `older`, title: `older` } })
      commit()
      releaseFirst.resolve()
    }
    if (!ordinary) await bounded(readEntered.promise, `held hydration read`)
    if (ordinary) {
      measuring = true
      if (history.cut !== `ordinary-expired-after-live-check`) now += ttl - 100
    }
    const successors = Array.from(
      { length: history.successors },
      (_, index) => {
        source.begin()
        source.write({
          type: `update`,
          value: {
            id:
              history.cut === `live` ||
              history.cut === `dependent-recovery-pending` ||
              index === 0
                ? `shared`
                : `independent-${index}`,
            title: `${history.title}/${index}`,
          },
        })
        return commit()
      },
    )
    void Promise.allSettled(successors).then(() => {
      premise.successorsSettled = true
    })
    if (!queued && !ordinary) {
      releaseRead.resolve()
      await bounded(olderDurable.promise, `older durable before successor turn`)
    }
    const reached =
      (ordinary || premise.heldReadReached) &&
      premise.predecessorDurable &&
      !premise.successorsSettled
    measuring = true
    if (history.cut === `expired` || history.cut === `ordinary-expired-at-turn`)
      now += ttl + history.elapsed
    if (
      history.cut === `recovery-pending` ||
      history.cut === `dependent-recovery-pending` ||
      history.cut === `queued-recovery-pending` ||
      history.cut === `ordinary-recovery-pending`
    ) {
      recovery = source.metadata!.persistence!.startScopedRecovery!()
      void recovery.catch(() => undefined)
    }
    if (!ordinary && history.cut.endsWith(`recovery-during-renewal`))
      now += ttl - 100
    if (queued) releaseRead.resolve()
    releaseOlder.resolve()
    if (
      history.cut.endsWith(`recovery-during-renewal`) ||
      history.cut === `ordinary-recovery-after-renewal` ||
      history.cut === `ordinary-expired-after-renewal`
    ) {
      await bounded(renewalEntered.promise, `claim renewal held`)
      if (
        history.cut !== `ordinary-recovery-after-renewal` &&
        history.cut !== `ordinary-expired-after-renewal`
      ) {
        recovery = source.metadata!.persistence!.startScopedRecovery!()
        void recovery.catch(() => undefined)
      }
      releaseRenewal.resolve()
    }
    const settled = await bounded(
      Promise.allSettled(successors),
      `successor receipt`,
    )
    // Recovery is scheduled after rejecting the commit. Only wait for it if
    // production started it, so a terminal failure remains a recorded result.
    for (
      let i = 0;
      i < 20 && rotations === 0 && collection.status !== `crashed`;
      i++
    )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (rotations) await bounded(recovered.promise, `scoped recovery`)
    if (recovery) await bounded(recovery, `requested recovery`)
    if (queued && read)
      await bounded(
        read.catch(() => undefined),
        `failed queued demand settlement`,
      )
    const row = collection.get(`shared`)
    // Preserve the completed settlement cut before ordinary next use or its
    // durable observation can fail. Later execution diagnostics cannot erase it.
    result = {
      cut: history.cut,
      reached:
        reached &&
        (!queued || premise.requestLocalReadFailed) &&
        (history.cut !== `ordinary-recovery-after-renewal` ||
          continuation.recoveryBeforeApplication) &&
        (!history.cut.startsWith(`ordinary-expired-after-`) ||
          continuation.expiryBeforeApplication),
      requestLocalReadFailed: premise.requestLocalReadFailed,
      baselineReads,
      rotations,
      outcomes: settled.map((outcome) => ({
        status: outcome.status,
        name:
          outcome.status === `rejected` && outcome.reason instanceof Error
            ? outcome.reason.name
            : null,
        sameReadError:
          outcome.status === `rejected` && outcome.reason === readError,
      })),
      status: collection.status,
      shared: row
        ? {
            id: row.id,
            title: row.title,
            ...(row.detail === undefined ? {} : { detail: row.detail }),
          }
        : null,
      next: `not-admitted`,
      nextStatus: collection.status,
      nextRows: { public: null, durable: null, currentTarget: null },
      cleanupErrors: [],
    }
    try {
      if (collection.status === `ready`) {
        source.begin()
        source.write({ type: `insert`, value: { id: `next`, title: `next` } })
        const nextOutcome = (
          await bounded(Promise.allSettled([commit()]), `next source use`)
        )[0]
        result.next = nextOutcome.status
        const nextPublic = collection.get(`next`)
        result.nextRows.public = nextPublic
          ? { id: nextPublic.id, title: nextPublic.title }
          : null
        result.nextRows.currentTarget = nextStorage === currentStorage
        measuring = false
        if (result.next === `fulfilled`)
          result.nextRows.durable =
            (await store.read()).rows.find((value) => value.id === `next`) ??
            null
      }
    } catch (error) {
      result.executionErrors = [describeOracleCleanupError(error)]
    }
    result.nextStatus = collection.status
  } catch (error) {
    hasPrimaryFailure = true
    primaryFailure = error
  } finally {
    releaseFirst.resolve()
    releaseRead.resolve()
    releaseOlder.resolve()
    releaseRenewal.resolve()
    for (const cleanup of [
      () => read?.catch(() => undefined),
      () => Promise.allSettled(receipts),
      () => collection.cleanup(),
      () => store.close(),
    ]) {
      try {
        await bounded(Promise.resolve().then(cleanup), `cleanup`)
      } catch (error) {
        cleanupFailures.push(error)
        result?.cleanupErrors.push(describeOracleCleanupError(error))
      }
    }
  }
  if (hasPrimaryFailure) {
    if (cleanupFailures.length)
      throw new AggregateError(
        [primaryFailure, ...cleanupFailures],
        `Source claim execution and cleanup failed`,
        { cause: primaryFailure },
      )
    throw primaryFailure
  }
  if (!result) throw new Error(`Source claim observation was not recorded`)
  return result
}
