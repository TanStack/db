/**
 * Real TrailBase sync and persistence receiving path for the primary lifecycle
 * oracle's retired-work judgment. RecordApi supplies a native stream and gated
 * list per sync run. The old baseline capability calls real hydration first,
 * then withholds its completion. Cleanup therefore occurs inside the exact
 * await added by persisted startup, without holding a database writer lock.
 * The replacement can restore, list, become ready, and process a new event.
 */
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { trailBaseCollectionOptions } from '../src/trailbase'
import { hydrationLifecycleRows } from './lifecycle-hydration-oracle'
import type { Event, ListResponse, RecordApi } from 'trailbase'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  HydrationLifecycleHistory,
  HydrationLifecycleObservation,
  HydrationLifecycleRow,
  HydrationLifecycleSnapshot,
} from './lifecycle-hydration-oracle'

function gate<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => undefined)
  return { resolve, reject, promise }
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await turn()
  }
  throw new Error(`Lifecycle receiving checkpoint was not reached`)
}
function providerSource() {
  let controller!: ReadableStreamDefaultController<Event>
  let cancellations = 0
  const stream = new ReadableStream<Event>({
    start(value) {
      controller = value
    },
    cancel() {
      cancellations++
    },
  })
  return {
    stream,
    get controller() {
      return controller
    },
    get cancellations() {
      return cancellations
    },
    list: gate<ListResponse<HydrationLifecycleRow>>(),
    calls: 0,
  }
}

export async function observeHydrationLifecycle(
  persistence: PersistedCollectionPersistence,
  h: HydrationLifecycleHistory,
  id: string,
  sourceFactory = trailBaseCollectionOptions,
): Promise<HydrationLifecycleObservation> {
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

  const old = providerSource()
  const replacement = providerSource()
  let active = old
  const api = {
    subscribe: () => Promise.resolve(active.stream),
    list: () => {
      active.calls++
      return active.list.promise
    },
  } as unknown as RecordApi<HydrationLifecycleRow>
  const options = sourceFactory({
    id,
    recordApi: api,
    getKey: (row: HydrationLifecycleRow) => row.id,
    parse: {},
    serialize: {},
    syncMode: `eager`,
  })
  const oldHydration = gate<void>()
  const reached: Array<string> = []
  let held = false
  let retired = false
  let obsoleteBegins = 0
  let run = 0
  let currentHydrate: (() => Promise<void>) | undefined
  const receipts: Array<Promise<void> | true> = []
  const reports: Array<string> = []
  const detached = (error: unknown) => {
    reports.push(`detached rejection: ${String(error)}`)
  }
  const browserDetached = (event: PromiseRejectionEvent) =>
    detached(event.reason)
  const nodeEvents =
    typeof process !== `undefined` && typeof process.on === `function`
  if (nodeEvents) process.on(`unhandledRejection`, detached)
  else globalThis.addEventListener(`unhandledrejection`, browserDetached)
  const report = console.error
  console.error = (...args: Array<unknown>) =>
    reports.push(args.map(String).join(` `))
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
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
        ...options.sync,
        sync: (params) => {
          const oldRun = run++ === 0
          const capability = params.metadata!.persistence!
          if (!oldRun) currentHydrate = () => capability.hydrateBaseline()
          return options.sync.sync({
            ...params,
            begin: (...args) => {
              if (oldRun && retired) obsoleteBegins++
              return params.begin(...args)
            },
            commit: (...args) => {
              const receipt = params.commit(...args)
              receipts.push(receipt)
              return receipt
            },
            metadata: {
              ...params.metadata!,
              persistence: {
                ...capability,
                hydrateBaseline: async () => {
                  await capability.hydrateBaseline()
                  if (oldRun) {
                    held = true
                    await oldHydration.promise
                  }
                },
              },
            },
          })
        },
      },
    }),
  )
  let oldPreload = `pending`
  let observation: HydrationLifecycleObservation | undefined
  const oldReady = collection.preload()
  void oldReady.then(
    () => {
      oldPreload = `fulfilled`
    },
    (error: unknown) => {
      oldPreload = error instanceof Error ? error.name : String(error)
    },
  )
  const snapshot = async (): Promise<HydrationLifecycleSnapshot> => {
    const stored = await persistence.adapter.loadResumeSnapshot(
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
    }
  }
  return withOracleCleanup(async () => {
    await until(() => old.calls > 0)
    if (h.oldList === `complete`) {
      old.list.resolve({ records: hydrationLifecycleRows(h.old, 2) })
      await until(() => held)
      await Promise.all(receipts)
      reached.push(`hydration-held-cleanup`)
    }
    retired = true
    await collection.cleanup()
    await until(() => !old.stream.locked)

    let replacementReady: Promise<void> | undefined
    const startReplacement = async () => {
      active = replacement
      replacementReady = collection.preload()
      await until(() => replacement.calls > 0 && currentHydrate !== undefined)
      await currentHydrate!()
    }
    const deliverReplacement = async () => {
      replacement.list.resolve({
        records: hydrationLifecycleRows(h.replacement, 3),
      })
      await replacementReady
      await Promise.all(receipts)
    }
    if (h.resumeAt !== `cleaned-up`) await startReplacement()
    if (h.resumeAt === `replacement-ready`) await deliverReplacement()
    if (h.oldList === `reject`) {
      old.list.reject(new Error(`retired list failure`))
      reached.push(`late-list-rejection`)
    } else oldHydration.resolve()
    // All old provider promises are now settled. A host turn drains their
    // native-stream and async continuation work before public/durable capture.
    await turn()
    await turn()
    reached.push(`resume-${h.resumeAt}`)
    const retiredResume = await snapshot()
    if (h.resumeAt === `cleaned-up`) await startReplacement()
    if (h.resumeAt !== `replacement-ready`) await deliverReplacement()
    const ready = await snapshot()
    reached.push(h.replacement ? `nonempty-replacement` : `empty-replacement`)
    if (h.oldList === `complete`) {
      if (h.replacement & ~h.old) reached.push(`new-row-outside-old-list`)
      if (h.old & ~h.replacement) reached.push(`old-row-omitted`)
    }
    const earlierReceipts = receipts.length
    replacement.controller.enqueue({ Insert: { id: `3`, value: 4 } })
    await until(() => receipts.length > earlierReceipts)
    await Promise.all(receipts)
    const afterEvent = await snapshot()
    observation = {
      retiredResume,
      ready,
      afterEvent,
      oldPreload,
      oldCancelCalls: old.cancellations,
      oldLocked: old.stream.locked,
      replacementLocked: replacement.stream.locked,
      replacementReleasedAfterCleanup: false,
      // Keep append-only diagnostics live through the final cleanup below.
      reports,
      obsoleteBegins,
      reached,
    }
    return observation
  }, [
    () => oldHydration.resolve(),
    () => old.list.resolve({ records: [] }),
    () => replacement.list.resolve({ records: [] }),
    () => collection.cleanup(),
    async () => {
      await turn()
      if (observation)
        observation.replacementReleasedAfterCleanup = !replacement.stream.locked
    },
    () => {
      console.error = report
      if (nodeEvents) process.off(`unhandledRejection`, detached)
      else globalThis.removeEventListener(`unhandledrejection`, browserDetached)
    },
  ])
}
