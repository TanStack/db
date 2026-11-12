/**
 * Composition for the eager owner's LIFE-2/5 and HEALTH-5 receiving extension.
 * Real provider reads and actual persistence establish the rows. Gates delay
 * only the acknowledgment returned to the adapter, after the underlying
 * receipt applies, and the completion returned by genuine baseline hydration.
 * Those are distinct premises: old code need not call hydrateBaseline.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { hydrationLifecycleRows } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import { startupTurn, untilStartup } from './persisted-startup-driver'
import type { CollectionConfig, SyncConfig } from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type {
  BaselineLifecycleCut,
  BaselineLifecycleHistory,
  BaselineLifecycleObservation,
} from './persisted-baseline-lifecycle-oracle'
import type { HydrationLifecycleRow } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'

export function baselineGate<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}
export interface BaselineLifecycleProvider {
  options: CollectionConfig<
    HydrationLifecycleRow,
    string,
    StandardSchemaV1<HydrationLifecycleRow, HydrationLifecycleRow>
  >
  sessions: () => number
  deliver: (run: number) => void
  fail: (run: number, error: Error) => void
  streamFail?: (run: number, error: Error) => void
  replace: (rows: Array<HydrationLifecycleRow>) => Promise<void>
  event: (row: HydrationLifecycleRow) => Promise<void>
  releases: () => Array<number>
  hookReleases: () => Array<number>
  hookAcquisitions: () => number
  diagnostics: () => Array<{ message: string; error: unknown }>
  dispose: () => Promise<unknown>
}
export type BaselineLifecycleAdapter = (
  h: BaselineLifecycleHistory,
  id: string,
) => Promise<BaselineLifecycleProvider>

export async function observeBaselineLifecycle(
  adapter: BaselineLifecycleAdapter,
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  h: BaselineLifecycleHistory,
  id: string,
  requireHydrateAwait = false,
): Promise<BaselineLifecycleObservation> {
  const seed = createCollection(
    persistedCollectionOptions({
      id,
      getKey: (row: HydrationLifecycleRow) => row.id,
      persistence,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const row of hydrationLifecycleRows(h.previous, 1))
            write({ type: `insert`, value: row })
          commit()
          markReady()
        },
      },
    }),
  )
  await withOracleCleanup(() => seed.preload(), [() => seed.cleanup()])
  const saved = await persistence.adapter.loadResumeSnapshot(
    { kind: `eager`, collectionId: id },
    { includeRows: true },
  )
  const provider = await adapter(h, id)
  const acknowledgment = baselineGate<void>()
  const baseline = baselineGate<void>()
  const underlying: Array<Promise<void> | true> = []
  const replacementReceipts: Array<Promise<void> | true> = []
  let settled = 0
  let baselineCompleted = false
  let hydrateCalls = 0
  let hydrateHeld = false
  let run = 0
  let genuineBaseline: Promise<void> | undefined
  let rejectedIdentity = false
  const error = new Error(`injected source failure`)
  const reports: Array<string> = []
  const oldHold = h.action === `source-fail` ? holdBaseline(id) : undefined
  const oldConsole = { error: console.error, warn: console.warn }
  const diagnostic = (level: `error` | `warn`, args: Array<unknown>) => {
    const text = args.map(String).join(` `)
    reports.push(`${level}: ${text}`)
  }
  console.error = (...args: Array<unknown>) => diagnostic(`error`, args)
  console.warn = (...args: Array<unknown>) => diagnostic(`warn`, args)
  const detached = (reason: unknown) =>
    reports.push(`unhandled rejection: ${String(reason)}`)
  const browserDetached = (event: PromiseRejectionEvent) =>
    detached(event.reason)
  const node =
    typeof process !== `undefined` && typeof process.on === `function`
  if (node) process.on(`unhandledRejection`, detached)
  else globalThis.addEventListener(`unhandledrejection`, browserDetached)
  const wrappedOptions = {
    ...provider.options,
    persistence,
    ...(h.initialRender === `network-first`
      ? {
          initialRender: {
            strategy: `network-first` as const,
            networkTimeoutMs: 60_000,
          },
        }
      : {}),
    sync: {
      ...provider.options.sync,
      sync: (
        params: Parameters<
          SyncConfig<HydrationLifecycleRow, string>[`sync`]
        >[0],
      ) => {
        const old = run++ === 0
        const capability = params.metadata!.persistence!
        if (old)
          genuineBaseline = capability.hydrateBaseline().then(() => {
            baselineCompleted = true
          })
        return provider.options.sync.sync({
          ...params,
          metadata: {
            ...params.metadata!,
            persistence: {
              ...capability,
              hydrateBaseline: async () => {
                await capability.hydrateBaseline()
                if (old) {
                  hydrateCalls++
                  hydrateHeld = true
                  await baseline.promise
                  hydrateHeld = false
                }
              },
            },
          },
          commit: (...args) => {
            const receipt = params.commit(...args)
            if (!old) {
              replacementReceipts.push(receipt)
              return receipt
            }
            underlying.push(receipt)
            const applied = Promise.resolve(receipt).then(() => {
              settled++
            })
            // The plain Promise is a legal SyncAppliedReceipt fallback. It
            // intentionally delays acceptance acknowledgment as well as visible
            // settlement; it does not change the already-applied obligation.
            return applied.then(() => acknowledgment.promise)
          },
          fail: (failure) => {
            if (old) rejectedIdentity = failure === error
            return params.fail(failure)
          },
        })
      },
    },
  }
  const collection = wrappedOptions.schema
    ? createCollection(
        persistedCollectionOptions({
          ...wrappedOptions,
          schema: wrappedOptions.schema,
        }),
      )
    : createCollection(
        persistedCollectionOptions({ ...wrappedOptions, schema: undefined }),
      )
  let oldPreload = `pending`
  const oldReady = collection.preload()
  void oldReady.then(
    () => {
      oldPreload = `fulfilled`
    },
    (failure: unknown) => {
      oldPreload =
        failure === error
          ? error.message
          : failure instanceof Error
            ? failure.name
            : String(failure)
    },
  )
  const snapshot = async (useSaved = false): Promise<BaselineLifecycleCut> => {
    const stored = useSaved
      ? saved
      : await persistence.adapter.loadResumeSnapshot(
          { kind: `eager`, collectionId: id },
          { includeRows: true },
        )
    const sort = (rows: Iterable<HydrationLifecycleRow>) =>
      [...rows]
        .map(({ id: key, value }) => ({ id: key, value }))
        .sort((a, b) => a.id.localeCompare(b.id))
    return {
      rows: sort(collection.values()),
      durable: sort(
        stored.rows.map((row) => row.value as HydrationLifecycleRow),
      ),
      status: collection.status,
      healthError: collection.health.error
        ? collection.health.error.message
        : null,
      failureReason: collection.health.failureReason
        ? collection.health.failureReason.message
        : null,
    }
  }
  const publicSnapshot = (cut: BaselineLifecycleCut) => ({
    rows: cut.rows,
    durable: cut.durable,
    status: cut.status,
  })
  let observation: BaselineLifecycleObservation | undefined
  let cleanup: Promise<unknown> | undefined
  let replacementReady: Promise<unknown> | undefined
  return withOracleCleanup(async () => {
    await untilStartup(
      () => provider.sessions() === 1 && genuineBaseline !== undefined,
    )
    if (oldHold) await untilStartup(oldHold.isHeld)
    else await genuineBaseline
    if (h.action !== `source-fail`) {
      provider.deliver(0)
      await untilStartup(() => underlying.length > 0)
      if (requireHydrateAwait)
        await untilStartup(() => hydrateHeld && hydrateCalls === 1)
      // The provider's finite full read emits all batches before its hydration
      // wait. Allow task delivery, then require every genuine receipt settled.
      for (let turn = 0; turn < 3; turn++) await startupTurn()
      await Promise.all(underlying)
      await untilStartup(() => settled === underlying.length)
    }
    const before = await snapshot(h.action === `source-fail`)
    const candidateHydrateHeld = hydrateHeld
    const reached: Array<string> = []
    if (underlying.length > 0 && settled === underlying.length)
      reached.push(`accepted-before-retirement`)
    let cleanupStartedBeforeRelease = false
    if (h.action === `cleanup`) {
      cleanup = collection.cleanup()
      cleanupStartedBeforeRelease = true
      reached.push(`cleanup-held-continuation`)
    } else if (h.action === `reload`) {
      replacementReady = collection.reload()
      void replacementReady.catch(() => undefined)
      cleanupStartedBeforeRelease = true
      reached.push(`reload-held-continuation`)
    } else if (h.action === `source-fail`) {
      provider.fail(0, error)
      reached.push(`source-failure-held-baseline`)
    } else if (h.action === `stream-fail`) {
      if (!provider.streamFail)
        throw new Error(`Provider has no terminal stream-failure capability`)
      provider.streamFail(0, error)
      reached.push(`stream-failure-held-continuation`)
    } else {
      acknowledgment.reject(error)
      reached.push(`receipt-rejection-held-baseline`)
    }
    // Provider failure is judged while its independent baseline peer remains
    // held. A failed acknowledgment alone has no prompt-failure promise.
    for (let turn = 0; turn < 3; turn++) await startupTurn()
    const failureWhileHeld = {
      status: collection.status,
      identity: rejectedIdentity && collection.health.error?.cause === error,
      reported: rejectedIdentity,
      preload: oldPreload,
    }
    oldHold?.release()
    await genuineBaseline
    baseline.resolve()
    if (h.action !== `receipt-reject`) acknowledgment.resolve()
    if (cleanup) await cleanup
    if (
      h.action === `source-fail` ||
      h.action === `receipt-reject` ||
      h.action === `stream-fail`
    )
      await untilStartup(() => oldPreload !== `pending`)
    await Promise.all(underlying)
    for (let turn = 0; turn < 3; turn++) await startupTurn()
    const resumed = await snapshot()
    const failureIdentity =
      rejectedIdentity && collection.health.error?.cause === error
    if (h.action !== `reload`) {
      await collection.cleanup()
      replacementReady = collection.preload()
      void replacementReady.catch(() => undefined)
      await untilStartup(() => provider.sessions() === 2)
    }
    await untilStartup(() => provider.sessions() === 2)
    await provider.replace(hydrationLifecycleRows(h.replacement, 3))
    provider.deliver(1)
    await replacementReady
    await Promise.all(replacementReceipts)
    const replacement = publicSnapshot(await snapshot())
    if (h.replacement === 0) reached.push(`empty-replacement`)
    if (h.action !== `source-fail`) {
      const delivered = before.rows.filter((row) => row.value === 2)
      if (
        delivered.some((row) => (h.replacement & (1 << Number(row.id))) !== 0)
      )
        reached.push(`replacement-overlap`)
      if (
        delivered.some((row) => (h.replacement & (1 << Number(row.id))) === 0)
      )
        reached.push(`replacement-omits-old`)
    }
    const eventReceipt = replacementReceipts.length
    await provider.event({ id: `3`, value: 4 })
    await untilStartup(() => replacementReceipts.length > eventReceipt)
    await Promise.all(replacementReceipts)
    const afterEvent = publicSnapshot(await snapshot())
    observation = {
      before,
      resumed,
      replacement,
      afterEvent,
      oldPreload,
      releases: [],
      hookReleases: [],
      hookAcquisitions: 0,
      reports,
      providerDiagnostics: [],
      failureIdentity,
      failureWhileHeld,
      cleanupStartedBeforeRelease,
      underlyingReceipts: underlying.length,
      underlyingSettled: settled,
      candidateHydrateCalls: hydrateCalls,
      candidateHydrateHeld,
      baselineCompleted,
      reached,
    }
    return observation
  }, [
    () => oldHold?.uninstall(),
    () => baseline.resolve(),
    () => acknowledgment.resolve(),
    () => provider.deliver(0),
    () => provider.deliver(1),
    () => collection.cleanup(),
    async () => {
      await startupTurn()
      if (observation) {
        observation.releases = provider.releases()
        observation.hookReleases = provider.hookReleases()
        observation.hookAcquisitions = provider.hookAcquisitions()
        observation.providerDiagnostics = provider
          .diagnostics()
          .map((entry) => ({
            message: entry.message,
            causeIsInjected: entry.error === error,
          }))
      }
    },
    () => provider.dispose(),
    () => {
      console.error = oldConsole.error
      console.warn = oldConsole.warn
      if (node) process.off(`unhandledRejection`, detached)
      else globalThis.removeEventListener(`unhandledrejection`, browserDetached)
    },
  ])
}
