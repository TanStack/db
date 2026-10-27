import { createCollection } from '@tanstack/db'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { persistedCollectionOptions } from '../src/index.js'
import type {
  PersistedCollectionCoordinator,
  PersistenceAdapter,
} from '../src/index.js'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

/**
 * # Which problems does the persisted wrapper report, and to which sync run?
 *
 * The persisted wrapper does work of its own on behalf of the sync adapter it
 * wraps: it asks the coordinator to acquire and release remote subsets, it
 * refreshes or reacquires them after a scoped recovery, and it releases them
 * when its sync run ends. When that work fails, the wrapper must say what
 * kind of problem it is (glossary: "crash", "sync error", "failure reason")
 * and whose problem it is (glossary: "sync run").
 *
 * ## Laws
 *
 * - **A remote failure is a sync problem, never a crash.** A crash is for a
 *   Collection whose local storage cannot serve reads or admit writes, or
 *   whose internal invariant broke. A coordinator acquisition or release that
 *   rejects is a network or remote-owner failure, and the source keeps
 *   syncing. On a `ready` Collection it is a failure reason
 *   (`reportError()`: still trying); status, rows, and `error` do not change.
 *   Before the first ready, core forbids `reportError()`. None of these
 *   failures keeps the first load from completing, because an on-demand
 *   Collection becomes ready through its sync adapter's `markReady()`. So
 *   none of them is reported before the first ready, and a load that waited
 *   on the failed request receives the rejection itself.
 * - **A throwing `unloadSubset` is an adapter contract breach.** Core's law
 *   (`packages/db/src/collection/subscription.ts`, `releaseAcquisition`;
 *   `reportUncaught`) reports it uncaught and fails no load, replay, or
 *   caller. The wrapper forwards the adapter's `unloadSubset` faithfully, so
 *   the same holds through it, and a returned rejection is the same breach.
 * - **A reload retires the old sync run.** Nothing the retired run's work
 *   does later changes the new run's status or health: not a late release,
 *   refresh, or reacquisition, and not a release that the retired run's
 *   cleanup started. A release that the retired run's cleanup started cannot
 *   reject that cleanup either, because core crashes a Collection whose
 *   retired run's cleanup fails (an accepted design: a failed cleanup is an
 *   adapter contract breach).
 *
 * Authority: the glossary rows "crash", "sync error", "failure reason", and
 * "sync run"; the error-handling guide's "When a Collection crashes" (local
 * storage only); core's adapter-breach law cited above; and the maintainer's
 * decision for this review that a reload's retired run is epoch-fenced.
 *
 * ## The model
 *
 * `expected` derives the observations from the history alone: which request
 * failed, whether the Collection was ready, and whether a reload retired the
 * run that made the request before the failure arrived. It reads no
 * production state.
 *
 * ## The history grammar
 *
 * One on-demand persisted Collection, ready or still loading, with one
 * subscriber that loads one subset. One request of the wrapper's own work is
 * held and later rejected:
 *
 * - `release`: the coordinator release when the subscriber leaves;
 * - `unload-throw` / `unload-reject`: the adapter's own `unloadSubset`
 *   throws or returns a rejection when the subscriber leaves (single-process
 *   coordinator, where the wrapper forwards the lease to the adapter itself);
 * - `refresh-ensure` / `refresh-release`: the one-shot refresh after a scoped
 *   recovery without cache rotation, or its release;
 * - `rotated-ensure`: the reacquisition after a cache-generation rotation;
 * - `rotated-owner-load`: the same reacquisition through the single-process
 *   coordinator, where the adapter's own `loadSubset` answers it and rejects
 *   (the coordinator reports that to the wrapper as the owner's error);
 * - `cleanup-release`: the release that a reload's retirement of the run
 *   starts.
 *
 * The failure arrives in the same sync run (`current`), or after a reload
 * retired that run, before or after the new run's `markReady()`. A run that
 * never became ready cannot have a reload whose new run became ready.
 *
 * ## The comparison
 *
 * After the failure arrives, and again at the end of the history, the driver
 * compares the Collection's status, the messages of its node's `error` and
 * `failureReason`, and the uncaught errors. At the end it also compares the
 * reload's outcome. Rows are outside this comparison: the source writes none.
 *
 * ## Limits
 *
 * The persistence adapter and the routed coordinator are controlled doubles,
 * not SQLite or a Browser or Electron coordinator. A follower that routes
 * demand to another tab, and the coordinator's own retry of a queued ensure
 * (which only warns), are outside this owner.
 */

type Site =
  | `release`
  | `unload-throw`
  | `unload-reject`
  | `refresh-ensure`
  | `refresh-release`
  | `rotated-ensure`
  | `rotated-owner-load`
  | `cleanup-release`
type Timing = `current` | `retired-before-new-ready` | `retired-after-new-ready`
type Readiness = `ready` | `loading`
type History = { site: Site; timing: Timing; readiness: Readiness }

type Row = { id: string; value: string }

const REMOTE_FAILURE = `remote request failed`
const ADAPTER_BREACH = `unloadSubset broke its contract`

type Observation = {
  status: string
  error: string | null
  failureReason: string | null
  uncaught: Array<string>
}

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

// Every site but the adapter's own `unloadSubset` is a remote request.
const REMOTE_SITES: ReadonlySet<Site> = new Set<Site>([
  `release`,
  `refresh-ensure`,
  `refresh-release`,
  `rotated-ensure`,
  `rotated-owner-load`,
  `cleanup-release`,
])

function expected(history: History): {
  afterFailure: Observation
  atEnd: Observation & { reload: `none` | `resolved` }
} {
  const { site, timing, readiness } = history
  // Only the run that made the request may hear about it, and only once it is
  // ready may it carry a failure reason.
  const reportedToItsRun =
    REMOTE_SITES.has(site) && timing === `current` && readiness === `ready`
  const afterFailure: Observation = {
    status: readiness,
    error: null,
    failureReason: reportedToItsRun ? REMOTE_FAILURE : null,
    uncaught:
      site === `unload-throw` || site === `unload-reject`
        ? [ADAPTER_BREACH]
        : [],
  }
  // A reload's new run marks ready by the end of the history, which ends the
  // reload and makes a loading Collection ready. The retired run's failure
  // changes neither.
  const reloaded = timing !== `current`
  return {
    afterFailure,
    atEnd: {
      ...afterFailure,
      status: reloaded ? `ready` : readiness,
      reload: reloaded ? `resolved` : `none`,
    },
  }
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const SITES: ReadonlyArray<Site> = [
  `release`,
  `unload-throw`,
  `unload-reject`,
  `refresh-ensure`,
  `refresh-release`,
  `rotated-ensure`,
  `rotated-owner-load`,
  `cleanup-release`,
]
const histories: Array<History> = []
for (const site of SITES) {
  for (const readiness of [`ready`, `loading`] as const) {
    for (const timing of [
      `current`,
      `retired-before-new-ready`,
      `retired-after-new-ready`,
    ] as const) {
      // A cleanup release only exists once a reload retired the run.
      if (site === `cleanup-release` && timing === `current`) continue
      // A synchronous throw happens before any reload can follow it.
      if (site === `unload-throw` && timing !== `current`) continue
      if (readiness === `loading` && timing === `retired-after-new-ready`)
        continue
      histories.push({ site, timing, readiness })
    }
  }
}

const reachStates = SITES.flatMap((site) =>
  [`current`, `retired`].map((timing) => `${site} failed, ${timing} run`),
).filter(
  (state) =>
    state !== `cleanup-release failed, current run` &&
    state !== `unload-throw failed, retired run`,
)

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// Lets every queued microtask and timer task run.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

// An in-memory persistence adapter with no rows. With `claims`, it manages a
// cache generation that a scoped recovery rotates.
function controlledAdapter(claims: boolean): PersistenceAdapter {
  let storage = 0
  const claim = () => ({
    storageCollectionId: `storage-${storage}`,
    claimId: `claim`,
    expiresAtMs: Date.now() + 60_000,
  })
  return {
    loadSubset: async () => [],
    loadResumeSnapshot: async () => ({
      rows: [],
      keySet: { status: `consistent` },
      collectionMetadata: [],
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }),
    loadCollectionMetadata: async () => [],
    scanRows: async () => [],
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
    markIndexRemoved: async () => {},
    ...(claims
      ? {
          claimCacheGeneration: async () => claim(),
          renewCacheGenerationClaim: async () => Date.now() + 60_000,
          rotateCacheGeneration: async () => {
            storage++
            return claim()
          },
          releaseCacheGenerationClaim: async () => {},
        }
      : {}),
  } as PersistenceAdapter
}

// A coordinator that elects this tab and routes demand through itself. The
// history's target requests are held; every other request succeeds.
function routedCoordinator(
  isTarget: (kind: `ensure` | `release`, options: LoadSubsetOptions) => boolean,
) {
  // Once the history rejects them, later requests (the final cleanup's
  // releases) succeed.
  const held = Object.assign([] as Array<ReturnType<typeof deferred<void>>>, {
    closed: false,
  })
  const coordinator: PersistedCollectionCoordinator = {
    getNodeId: () => `sync-problem-node`,
    subscribe: () => () => {},
    publish: () => {},
    isLeader: () => true,
    ensureLeadership: async () => {},
    requestEnsurePersistedIndex: async () => {},
    requestEnsureRemoteSubset: (_id, options) => hold(`ensure`, options),
    requestReleaseRemoteSubset: (_id, options) => hold(`release`, options),
    registerRemoteSubsetOwner: () => () => {},
    requestApplyCommittedTx: (_id, tx) =>
      Promise.resolve({
        type: `rpc:applyCommittedTx:res`,
        rpcId: tx.txId,
        ok: true,
        term: tx.term,
        seq: tx.seq,
        latestRowVersion: tx.rowVersion,
      }),
  }
  function hold(
    kind: `ensure` | `release`,
    options: LoadSubsetOptions,
  ): Promise<void> {
    if (held.closed || !isTarget(kind, options)) return Promise.resolve()
    const request = deferred()
    held.push(request)
    return request.promise
  }
  return { coordinator, held }
}

function createSource(history: History, id: string) {
  const { site } = history
  const single =
    site === `unload-throw` ||
    site === `unload-reject` ||
    site === `rotated-owner-load`
  const rotation = site === `rotated-ensure` || site === `rotated-owner-load`
  // The original subscriber's subset; a refresh or reacquisition is a copy
  // with `refetch: true`.
  const isRefetch = (options: LoadSubsetOptions) => options.refetch === true
  const routed = routedCoordinator((kind, options) => {
    if (site === `release` || site === `cleanup-release`)
      return kind === `release` && !isRefetch(options)
    if (site === `refresh-release`)
      return kind === `release` && isRefetch(options)
    return kind === `ensure` && isRefetch(options)
  })
  const unloadFailures: Array<ReturnType<typeof deferred<void>>> = []
  const ownerLoads: Array<ReturnType<typeof deferred<void>>> = []
  const runs: Array<Parameters<SyncConfig<Row, string>[`sync`]>[0]> = []
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      persistence: {
        adapter: controlledAdapter(rotation),
        ...(single ? {} : { coordinator: routed.coordinator }),
      },
      sync: {
        sync: (params) => {
          runs.push(params)
          if (runs.length === 1 && history.readiness === `ready`)
            params.markReady()
          const firstRun = runs.length === 1
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              if (
                !firstRun ||
                site !== `rotated-owner-load` ||
                !isRefetch(options)
              )
                return Promise.resolve()
              const load = deferred()
              ownerLoads.push(load)
              return load.promise
            },
            unloadSubset: () => {
              if (!firstRun) return
              if (site === `unload-throw`) throw new Error(ADAPTER_BREACH)
              if (site === `unload-reject`) {
                const unload = deferred()
                unloadFailures.push(unload)
                return unload.promise as unknown as void
              }
            },
            ...(rotation ? { restartAfterScopedRecovery: () => {} } : {}),
          }
        },
      },
    }),
  )
  return {
    collection,
    runs,
    // The held requests, once production made them.
    held: (): Array<ReturnType<typeof deferred<void>>> =>
      site === `rotated-owner-load`
        ? ownerLoads
        : single
          ? unloadFailures
          : routed.held,
  }
}

// Core reports an uncaught error by throwing it from a microtask. This
// records each such error, and each unhandled rejection, instead of letting
// it escape.
function captureUncaught() {
  const uncaught: Array<string> = []
  const record = (error: unknown) =>
    uncaught.push(error instanceof Error ? error.message : String(error))
  const queue = globalThis.queueMicrotask.bind(globalThis)
  const spy = vi
    .spyOn(globalThis, `queueMicrotask`)
    .mockImplementation((task) =>
      queue(() => {
        try {
          task()
        } catch (error) {
          record(error)
        }
      }),
    )
  process.on(`unhandledRejection`, record)
  return {
    uncaught,
    restore: () => {
      spy.mockRestore()
      process.off(`unhandledRejection`, record)
    },
  }
}

function observe(
  collection: ReturnType<typeof createSource>[`collection`],
  uncaught: ReadonlyArray<string>,
): Observation {
  return {
    status: collection.status,
    error: collection.health.error?.message ?? null,
    failureReason: collection.health.failureReason?.message ?? null,
    uncaught: [...uncaught].sort(),
  }
}

describe(`persisted sync problem oracle`, () => {
  const reach = createOracleReach(`persisted-sync-problem.history`, reachStates)
  let historiesRan = 0
  afterAll(() => {
    if (historiesRan === histories.length) reach.assertReached()
  })

  it.each(
    histories.map(
      (history) =>
        [
          `${history.site}, ${history.readiness}, ${history.timing}`,
          history,
        ] as const,
    ),
  )(`%s`, async (name, history) => {
    const source = createSource(history, `sync-problem ${name}`)
    const { collection, runs } = source
    const capture = captureUncaught()
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    const site = history.site
    reach.beginHistory()
    try {
      void collection.preload().catch(() => undefined)
      await settle()
      // A rotation reacquires a retained demand only while its load is the
      // same request; a subscriber replays its demand after the recovery's
      // truncate, as a new request, which the wrapper refreshes instead. So
      // the rotation sites hold one load at the sync layer, as a demand that
      // outlives the truncate.
      const subscription = site.startsWith(`rotated`)
        ? undefined
        : collection.subscribeChanges(() => {}, { includeInitialState: true })
      if (!subscription)
        void Promise.resolve(collection._sync.loadSubset({ limit: 1 })).catch(
          () => undefined,
        )
      await settle()

      // Start the history's request.
      if (site === `release` || site.startsWith(`unload`)) {
        subscription!.unsubscribe()
      } else if (site !== `cleanup-release`) {
        await runs[0]!.metadata!.persistence!.startScopedRecovery!().catch(
          () => undefined,
        )
      }
      await settle()

      // Retire the run that made it.
      let reload: Promise<void> | undefined
      let reloadOutcome = `none`
      if (history.timing !== `current`) {
        reload = collection.reload()
        reload.then(
          () => (reloadOutcome = `resolved`),
          () => (reloadOutcome = `rejected`),
        )
        await settle()
        if (history.timing === `retired-after-new-ready`) {
          runs.at(-1)!.markReady()
          await settle()
        }
      }

      // The requests fail, all with one error value: one failure.
      const held = source.held()
      if (site !== `unload-throw`) {
        expect(held.length, `${name}: the request was made`).toBeGreaterThan(0)
        const failure = new Error(
          site.startsWith(`unload`) ? ADAPTER_BREACH : REMOTE_FAILURE,
        )
        for (const request of held) request.reject(failure)
        Object.assign(held, { closed: true })
      }
      reach.reach(
        `${site} failed, ${history.timing === `current` ? `current` : `retired`} run`,
      )
      await settle()
      const model = expected(history)
      expect(
        observe(collection, capture.uncaught),
        `${name}: after the failure`,
      ).toEqual(model.afterFailure)

      // The new run becomes ready; the reload ends.
      if (history.timing === `retired-before-new-ready`) {
        runs.at(-1)!.markReady()
        await settle()
      }
      expect(
        { ...observe(collection, capture.uncaught), reload: reloadOutcome },
        `${name}: at the end`,
      ).toEqual(model.atEnd)
      historiesRan++
    } finally {
      capture.restore()
      warn.mockRestore()
      consoleError.mockRestore()
      await collection.cleanup().catch(() => undefined)
    }
  })
})
