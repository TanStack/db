// Housekeeping transactions during a reload, as an enumerated oracleProperty.
// Each kind is one history; the check owns every judgment the earlier
// example test made, including each kind's reach (see "Reach" below).
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  inArray,
} from '@tanstack/db'
import { expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property'
import { queryCollectionOptions } from '../src/query'
import { createInMemorySyncMetadataApi } from './query-persistence-harness'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

/**
 * A housekeeping transaction is not a snapshot either. Query
 * Collection's retention maintenance commits one: it removes an expired
 * persisted retention entry (`queryCollection:gc:<hash>`) that a released
 * subset left. During a reload of an eager persisted Collection it commits
 * while the new run's Query fetch is held, in two ways:
 *
 * - `expiry-timer`: the entry is still live when the new run starts, so the
 *   new run schedules its expiry, and it expires while the fetch is held.
 * - `expiry-timer-lagging-clock`: as `expiry-timer`, but `Date.now()` lags
 *   the timer clock once the expiry is scheduled, so the expiry timer fires
 *   before `Date.now()` reaches the entry's `expiresAt`. A Node timer can
 *   fire up to a millisecond early by `Date.now()`, and a wall-clock
 *   adjustment can widen that; the driver widens it to `clockLagMs` so every
 *   history meets it. The entry must still expire in that run.
 * - `expiry-at-startup`: the entry appears in the shared persisted metadata
 *   between the runs, as another tab's release writes it, already expired,
 *   so the new run's startup maintenance removes it.
 *
 * Model, from ARCHITECTURE law 16, the reload law (maintainer decision
 * F19: only a snapshot or the run's own truncate replaces the kept rows,
 * and every other write applies on them) and the maintainer decision that
 * a reload ends as a refetch does: while
 * the fetch is held, the rows stay (the expired entry owns no row) and the
 * reload stays in flight. After the fetch lands, the rows equal those of
 * the same history with `utils.refetch()` in place of `reload()`.
 *
 * Reach: a history checks the law only if the new run begins a transaction
 * while the reload waits for its Query result. Every such transaction is
 * housekeeping, since the fetch is held. The driver counts those begins
 * through the current run's sync parameters, whatever options they pass,
 * so the reach does not depend on the repair. A retired run's begin does
 * nothing in core, so it does not count; that includes the old run's own
 * cleanup, which core can invoke after `reload()` and before it starts the
 * new run. Each kind must reach that state.
 *
 * Checkpoint: the driver observes the window when the entry is gone (the
 * housekeeping commit has applied), polling rather than sleeping a fixed
 * time, so a loaded runner cannot move the observation before the expiry.
 * A housekeeping begin marked `snapshot: true` is the mutant: it
 * replaces the kept rows with none.
 *
 * A third kind, `release-at-startup`, reaches the other housekeeping
 * transaction a reload can meet: writing a retention entry when a subset
 * is released. It needs an on-demand Collection, and it is described with
 * its driver below.
 *
 * Limits: releasing a Query's rows (`cleanupQueryInternal`) begins a
 * housekeeping transaction too, but no legal history begins it in the new
 * run while the reload is in flight, so a snapshot there is an equivalent
 * mutant for this grammar. Its callers are the run's own
 * cleanup and the fallback of a subset release. Core invokes a run's
 * cleanup (on cleanup, on a reload's retirement, or after sync entry) only
 * after it has retired that run's callbacks, so that begin does nothing.
 * The fallback runs only for a Collection without a persistence
 * capability: every capability has `scanPersistedRows`, and every observed
 * Query has a persisted retention time (`persistedGcTime`, or the Query's
 * own `gcTime`), so a persisted release writes a retention entry instead.
 * Without persistence, the Collection's metadata is its own, and Query
 * Collection writes no retention entry there (only a persisted release
 * writes one), so a new on-demand run finds none, has no startup maintenance to
 * wait for, and calls `markReady()` inside `sync()`, which completes the
 * reload before any release can reach the run. An
 * eager Collection has no release path: it has no `unloadSubset`, and it
 * does not clean up a Query that Query Core removes.
 */
type Row = { id: number; v: string }
type Kind =
  | `expiry-timer`
  | `expiry-timer-lagging-clock`
  | `expiry-at-startup`
  | `release-at-startup`
const kinds: ReadonlyArray<Kind> = [
  `expiry-timer`,
  `expiry-timer-lagging-clock`,
  `expiry-at-startup`,
  `release-at-startup`,
]
const expiryMs = 100
const clockLagMs = 20
const entryKey = `queryCollection:gc:released-subset`
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

const run = async (kind: Kind, via: `reload` | `refetch`) => {
  const harness = createInMemorySyncMetadataApi<string | number, Row>()
  let release!: () => void
  const fetches: Array<Promise<Array<Row>>> = [
    Promise.resolve([
      { id: 1, v: `a` },
      { id: 2, v: `b` },
      { id: 3, v: `c` },
    ]),
    new Promise((resolve) => {
      release = () =>
        resolve([
          { id: 1, v: `a2` },
          { id: 2, v: `b2` },
          { id: 3, v: `c2` },
        ])
    }),
  ]
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const base = queryCollectionOptions<Row>({
    id: `reload-housekeeping-${kind}-${via}`,
    queryKey: [`reload-housekeeping`, kind, via],
    queryClient: client,
    getKey: (row) => row.id,
    queryFn: () => fetches.shift()!,
  })
  // The run that `reload()` retires; only a later run's begin counts.
  let retiredRun = Infinity
  let runs = 0
  let housekeepingBegins = 0
  const collection = createCollection({
    ...base,
    sync: {
      sync: (params: Parameters<typeof base.sync.sync>[0]) => {
        const run = ++runs
        return base.sync.sync({
          ...params,
          begin: (options?: Parameters<typeof params.begin>[0]) => {
            if (run > retiredRun && run === runs) housekeepingBegins++
            params.begin(options)
          },
          metadata: harness.api,
        })
      },
    },
  })
  const rows = () => new Map(collection.toArray.map((row) => [row.id, row.v]))
  let restoreClock = () => {}
  try {
    if (kind !== `expiry-at-startup`)
      harness.collectionMetadata.set(entryKey, {
        queryHash: `released-subset`,
        mode: `ttl`,
        expiresAt: Date.now() + expiryMs,
      })
    await collection.preload()
    const before = rows()
    if (kind === `expiry-at-startup`)
      harness.collectionMetadata.set(entryKey, {
        queryHash: `released-subset`,
        mode: `ttl`,
        expiresAt: 0,
      })
    retiredRun = runs
    const pending =
      via === `reload`
        ? collection.reload()
        : collection.utils.refetch().then(() => undefined)
    let settled = false
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    )
    await new Promise((resolve) => setTimeout(resolve, expiryMs / 2))
    if (kind === `expiry-timer-lagging-clock`) {
      const now = Date.now.bind(Date)
      const clock = vi
        .spyOn(Date, `now`)
        .mockImplementation(() => now() - clockLagMs)
      restoreClock = () => clock.mockRestore()
    }
    await new Promise((resolve) => setTimeout(resolve, expiryMs / 2))
    // A refetch keeps the run, so its new-run maintenance never comes.
    if (via === `reload`)
      await vi.waitFor(
        () =>
          expect(
            harness.collectionMetadata.has(entryKey),
            `maintenance ran`,
          ).toBe(false),
        { timeout: expiryMs * 10 },
      )
    await flushPromises()
    const during = {
      before,
      rows: rows(),
      reloading: collection.health.reloading,
      settled,
      housekeepingBegins,
      entryRemoved: !harness.collectionMetadata.has(entryKey),
    }
    retiredRun = Infinity
    release()
    await pending
    await flushPromises()
    return {
      during,
      final: rows(),
      reloading: collection.health.reloading,
    }
  } finally {
    restoreClock()
    release()
    await collection.cleanup()
    client.clear()
  }
}

/**
 * `release-at-startup`: a subset released during the reload of an
 * on-demand persisted Collection writes its retention entry in the new
 * run. An on-demand run has no Query of its own and sends no snapshot,
 * so the reload completes at the run's `markReady()` and keeps the rows;
 * the replayed demand's results then apply on them. The run calls
 * `markReady()` once its startup retention maintenance settles. Until then a subset request waits for that
 * maintenance and its release only withdraws the request, so it commits
 * nothing. In the turns after the maintenance settles and before
 * `markReady()`, a request creates an observed Query, and its release
 * writes the retention entry in a housekeeping transaction while the
 * reload is in flight.
 *
 * Model, as for the other kinds: in every turn before the new run's
 * `markReady()`, the rows equal the kept rows and the reload stays in
 * flight. A retention entry owns no row. After the held fetch lands, the
 * rows equal those of the same history with `utils.refetch()` in place of
 * `reload()`.
 *
 * History: a live query holds a demand for three rows, and the first run
 * releases one subset, so its retention entry is live when the new
 * run starts and gives that run startup maintenance. During the reload the
 * driver requests and releases a fresh subset, through a public change
 * subscription, in every microtask turn from `reload()` until the new
 * run's `markReady()`. So the grammar covers every turn of the window,
 * whatever its width. The refetch history makes the same requests and
 * releases for the same number of turns.
 *
 * Reach: a turn reaches the law if its release begins a transaction in
 * the current run before that run's `markReady()`, and the released
 * subset's retention entry then exists. The driver counts those begins
 * whatever options they pass.
 */
const runRelease = async (via: `reload` | `refetch`, turnLimit?: number) => {
  const harness = createInMemorySyncMetadataApi<string | number, Row>()
  let release!: () => void
  const fetches: Array<Promise<Array<Row>>> = [
    Promise.resolve([
      { id: 1, v: `a` },
      { id: 2, v: `b` },
      { id: 3, v: `c` },
    ]),
    new Promise((resolve) => {
      release = () =>
        resolve([
          { id: 1, v: `a2` },
          { id: 2, v: `b2` },
          { id: 3, v: `c2` },
        ])
    }),
  ]
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // The live query's demand is `id IN (1, 2, 3)`. A released subset is
  // `id = n` for an `n` outside it, so the loaded demand does not cover
  // it and it holds no row.
  const base = queryCollectionOptions<Row>({
    id: `reload-housekeeping-release-${via}`,
    queryKey: [`reload-housekeeping`, `release`, via],
    queryClient: client,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    queryFn: (ctx) => {
      const where = ctx.meta?.loadSubsetOptions?.where
      return where?.type === `func` && where.name === `eq`
        ? Promise.resolve([])
        : fetches.shift()!
    },
  })
  let runs = 0
  let currentRunReady = false
  let releasing = false
  let releaseBegins = 0
  const collection = createCollection({
    ...base,
    sync: {
      sync: (params: Parameters<typeof base.sync.sync>[0]) => {
        const syncRun = ++runs
        currentRunReady = false
        return base.sync.sync({
          ...params,
          begin: (options?: Parameters<typeof params.begin>[0]) => {
            if (releasing && syncRun === runs && !currentRunReady)
              releaseBegins++
            params.begin(options)
          },
          markReady: () => {
            if (syncRun === runs) currentRunReady = true
            params.markReady()
          },
          metadata: harness.api,
        })
      },
    },
  })
  const live = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ row: collection })
        .where(({ row }) => inArray(row.id, [1, 2, 3])),
    startSync: true,
  })
  const rows = () => new Map(collection.toArray.map((row) => [row.id, row.v]))
  const retentionEntries = () =>
    [...harness.collectionMetadata.keys()].filter((key) =>
      key.startsWith(`queryCollection:gc:`),
    ).length
  // Request a subset that holds no row, then release it in the same turn.
  const requestAndRelease = (id: number) => {
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: true,
      where: (row) => eq(row.id, id),
    })
    releasing = true
    subscription.unsubscribe()
    releasing = false
  }
  try {
    await live.preload()
    requestAndRelease(99)
    await flushPromises()
    const before = rows()
    const pending =
      via === `reload`
        ? collection.reload()
        : collection.utils.refetch().then(() => undefined)
    let settled = false
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    )
    // One request and release per microtask turn, until the new run's
    // `markReady()` (reload) or for the reload history's turn count.
    const turns: Array<{
      rows: Map<number, string>
      reloading: boolean
      settled: boolean
      reached: boolean
    }> = []
    await new Promise<void>((done) => {
      const turn = () => {
        const windowOpen =
          turnLimit === undefined ? !currentRunReady : turns.length < turnLimit
        if (!windowOpen || turns.length >= 100) return done()
        const begins = releaseBegins
        const entries = retentionEntries()
        requestAndRelease(100 + turns.length)
        turns.push({
          rows: rows(),
          reloading: collection.health.reloading,
          settled,
          reached: releaseBegins > begins && retentionEntries() > entries,
        })
        queueMicrotask(turn)
      }
      turn()
    })
    await flushPromises()
    release()
    await pending
    await flushPromises()
    return { before, turns, final: rows() }
  } finally {
    release()
    await live.cleanup()
    await collection.cleanup()
    client.clear()
  }
}

/**
 * The production driver records, for each kind, what the reload history shows
 * while the new run's work is pending, what it ends with, and what the same
 * history ends with when `utils.refetch()` replaces `reload()`. It records
 * relations and row values, never counts that depend on timing: whether a
 * housekeeping transaction began in the new run, not how many did.
 */
async function recordHousekeeping(
  kind: Kind,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  if (kind === `release-at-startup`) {
    const reload = await runRelease(`reload`)
    observe(`reload turns`, {
      before: reload.before,
      turns: reload.turns,
    })
    observe(`reload end`, { final: reload.final })
    const refetch = await runRelease(`refetch`, reload.turns.length)
    observe(`refetch end`, { final: refetch.final })
    return
  }
  const reload = await run(kind, `reload`)
  observe(`reload during`, {
    before: reload.during.before,
    rows: reload.during.rows,
    reloading: reload.during.reloading,
    settled: reload.during.settled,
    housekeepingBegun: reload.during.housekeepingBegins > 0,
    entryRemoved: reload.during.entryRemoved,
  })
  observe(`reload end`, { final: reload.final, reloading: reload.reloading })
  const refetch = await run(kind, `refetch`)
  observe(`refetch end`, { final: refetch.final })
}

/**
 * The model, from the law above: while the new run's work is pending the
 * reload keeps the rows it held and stays in flight, and it ends with the
 * rows the refetch history ends with and no reload in flight. Rows are
 * compared with the history's own observations, so the model owes relations
 * and flags, not row values.
 */
function modelHousekeeping(kind: Kind) {
  return {
    kind,
    reloadingDuring: true,
    settledDuring: false,
    reloadingAtEnd: false,
    turnBudget: 100,
  }
}

type DuringObservation = {
  before: Map<number, string>
  rows: Map<number, string>
  reloading: boolean
  settled: boolean
  housekeepingBegun: boolean
  entryRemoved: boolean
}
type TurnsObservation = {
  before: Map<number, string>
  turns: Array<{
    rows: Map<number, string>
    reloading: boolean
    settled: boolean
    reached: boolean
  }>
}

function valueAt<T>(
  trace: ReadonlyArray<Observation>,
  checkpoint: string,
): T | undefined {
  return trace.find((entry) => entry.checkpoint === checkpoint)?.value as
    T | undefined
}

/**
 * The check. Reach comes first: a kind checks the law only if its history
 * entered the kind's state, so a history that did not enter it fails under
 * law `declared reach` instead of passing vacuously. This is the earlier
 * per-history reach requirement; an enumerated source runs every kind.
 */
function checkHousekeeping(
  kind: Kind,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelHousekeeping>,
): Verdict {
  const reloadEnd = valueAt<{ final: unknown; reloading?: boolean }>(
    trace,
    `reload end`,
  )
  const refetchEnd = valueAt<{ final: unknown }>(trace, `refetch end`)
  const ending = (): Verdict =>
    !reloadEnd || !refetchEnd
      ? violation(
          refetchEnd ? `reload end` : `refetch end`,
          `the history did not reach its final observation`,
          `trace complete`,
        )
      : (differs(
          `refetch end`,
          `reload ends as a refetch does`,
          reloadEnd.final,
          refetchEnd.final,
          `the reload ends with other rows than the refetch history`,
        ) ?? pass)
  if (kind === `release-at-startup`) {
    const turns = valueAt<TurnsObservation>(trace, `reload turns`)
    if (!turns)
      return violation(
        `reload turns`,
        `the history recorded no turns`,
        `trace complete`,
      )
    if (turns.turns.length >= expected.turnBudget)
      return violation(
        `reload turns`,
        `the new run did not call markReady() within ${expected.turnBudget} turns`,
        `turn budget`,
      )
    if (turns.turns.every((turn) => !turn.reached))
      return violation(
        `reload turns`,
        `no release wrote its retention entry before markReady(), so the history did not enter ${kind}`,
        `declared reach`,
      )
    for (const [index, turn] of turns.turns.entries()) {
      const wrong =
        differs(
          `reload turns`,
          `the rows stay`,
          turn.rows,
          turns.before,
          `turn ${index}: the rows changed while the reload was in flight`,
        ) ??
        differs(
          `reload turns`,
          `the reload stays in flight`,
          turn.reloading,
          expected.reloadingDuring,
          `turn ${index}: the reload left flight early`,
        ) ??
        differs(
          `reload turns`,
          `the reload stays in flight`,
          turn.settled,
          expected.settledDuring,
          `turn ${index}: the reload settled early`,
        )
      if (wrong) return wrong
    }
    return ending()
  }
  const during = valueAt<DuringObservation>(trace, `reload during`)
  if (!during)
    return violation(
      `reload during`,
      `the history recorded no window observation`,
      `trace complete`,
    )
  return (
    differs(
      `reload during`,
      `declared reach`,
      during.housekeepingBegun,
      true,
      `no housekeeping transaction began in the new run while the reload waited, so the history did not enter ${kind}`,
    ) ??
    differs(
      `reload during`,
      `declared reach`,
      during.entryRemoved,
      true,
      `the retention maintenance did not run`,
    ) ??
    differs(
      `reload during`,
      `the rows stay`,
      during.rows,
      during.before,
      `the rows changed while the reload waited`,
    ) ??
    differs(
      `reload during`,
      `the reload stays in flight`,
      during.reloading,
      expected.reloadingDuring,
    ) ??
    differs(
      `reload during`,
      `the reload stays in flight`,
      during.settled,
      expected.settledDuring,
    ) ??
    (reloadEnd
      ? differs(
          `reload end`,
          `the reload ends`,
          reloadEnd.reloading,
          expected.reloadingAtEnd,
        )
      : undefined) ??
    ending()
  )
}

oracleProperty({
  id: `query-db.reload-housekeeping`,
  law: {
    statement: `A housekeeping transaction that commits in the new run while a reload waits for its Query result keeps the rows the reload held and the reload in flight; the reload then ends with the rows of the same history with utils.refetch() in place of reload().`,
    authority: `ARCHITECTURE law 16 (the reload law); maintainer decision F19: only a snapshot or the run's own truncate replaces the kept rows; maintainer decision that a reload ends as a refetch does.`,
    limits: `Four kinds of housekeeping: retention expiry by timer, by timer under a lagging Date.now(), at startup, and a subset release at on-demand startup. Releasing a Query's rows (cleanupQueryInternal) is an equivalent mutant for this grammar, as the prose above explains. One Collection per history, in-memory persistence metadata.`,
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: kinds,
  label: (kind) => kind,
  model: modelHousekeeping,
  driver: recordHousekeeping,
  check: checkHousekeeping,
})
