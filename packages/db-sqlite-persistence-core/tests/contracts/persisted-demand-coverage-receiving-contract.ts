/**
 * # Receiving contract: persisted demand coverage
 *
 * Law (`docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * glossary entry "persisted demand coverage"): with
 * `initialRender: { strategy: 'network-first', networkTimeoutMs }` on a
 * persisted `syncMode: 'on-demand'` Collection, a demand settles from storage
 * in a later offline session when all three hold:
 *
 * 1. the persisted subset restore has published its rows in the current sync
 *    run;
 * 2. the exact demand has persisted demand coverage, recorded by an earlier
 *    online load of that demand in the same cache generation;
 * 3. the configured wait has passed since the load started, or the demand's
 *    upstream load has failed.
 *
 * Authority: the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * and the campaign oracle `persisted-demand-coverage-campaign-oracle.test.ts`
 * own the law. The judge that compares a record with the law is shared, and
 * this module holds no expected result.
 *
 * ## What this module holds
 *
 * - `RECEIVING_HISTORIES`: each history as data. Session 1 is online and takes
 *   the listed steps. Session 2 setup is the wait and the upstream behavior
 *   (premise control, not an outcome).
 * - `createReceivingSource`: the on-demand source. It records every row write,
 *   delete, and settled load into an event log, and it controls the upstream
 *   behavior the history asks for.
 * - `recordSession1` and `recordSession2`: the production entry points. They
 *   run one session over a host's persistence and return what was recorded.
 *   They never judge the record.
 * - `recordReceivingHistory`: both sessions in one process, for in-process
 *   hosts.
 *
 * Out-of-process hosts (the OPFS page, the Electron renderer, the Cloudflare
 * Durable Object) import this module into their bundle, call the recorders,
 * and report the records back. Their test files pass each record to the
 * shared judge.
 *
 * This module is platform-neutral: it imports only `@tanstack/db` and the
 * persistence core, and it uses no test framework.
 *
 * ## Production path and observations
 *
 * Each session builds a Collection with `persistedCollectionOptions` over the
 * host's persistence and runs the query's `preload()` with the history's wait.
 * Session 1 answers its loads through the source, so the rows in storage come
 * only from the wrapper.
 *
 * Session 2 records two checkpoints of the query: `beforeDeadline` 450 ms
 * after the upstream load is forwarded, and `afterDeadline` after polling up
 * to 2 500 ms for the query to leave `loading`. Each checkpoint carries its
 * elapsed time since the forward, so the judge can decide whether the wait had
 * passed.
 *
 * ## Limits
 *
 * The law covers only the default single-process coordinator, so every host
 * here uses it. A framework host observes its own signal (a hook's readiness
 * or rendered output) and records only what that signal shows. The histories
 * cover one filter and one ordered window.
 */
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { persistedCollectionOptions } from '../../src'
import { A1, A2, A3 } from './persisted-demand-coverage-receiving-histories'
import type { Collection, LoadSubsetOptions } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../src'
import type {
  CoverageRecord,
  OfflineUpstream,
  QueryObservation,
  QuerySpec,
  SourceEvent,
} from '../persisted-demand-coverage-model-oracle'
import type {
  ReceivingHistory,
  Row,
  Session2Upstream,
  Shape,
} from './persisted-demand-coverage-receiving-histories'

// The before-wait checkpoint. It is under half the ordinary wait, so the wait
// has not passed there, and it is late enough for a framework to show a
// settlement that an upstream failure produced: React Suspense holds a fallback
// reveal for about 300 ms.
const CHECKPOINT_MS = 450
const AFTER_DEADLINE_POLL_MS = 2500
const FORWARD_TIMEOUT_MS = 10_000
const COLLECTION_ID = `persisted-demand-coverage-receiver`

export * from './persisted-demand-coverage-receiving-histories'

export type UpstreamBehavior = `hold` | `reject` | `answer-at-once`

export type ReceivingSource = {
  collection: Collection<Row, string, any>
  // Loads the source received, in arrival order.
  received: Array<LoadSubsetOptions>
  pending: () => number
  // Writes rows in one sync transaction, then settles every held load.
  answer: (rows: ReadonlyArray<Row>) => Promise<void>
  write: (rows: ReadonlyArray<Row>) => Promise<void>
  remove: (rows: ReadonlyArray<Row>) => Promise<void>
}

// One checkpoint of the offline query, and the milliseconds since its load
// started (the `preload()` call).
export type ReceivingCheckpoint = {
  observed: QueryObservation
  sinceLoadStartMs: number
}

export const QUERY_NAME = `demand`

export type Session1Record = { events: ReadonlyArray<SourceEvent> }

export type Session2Record = {
  // The loads the offline source received for the query, in arrival order.
  sent: ReadonlyArray<LoadSubsetOptions>
  beforeDeadline: ReceivingCheckpoint
  afterDeadline: ReceivingCheckpoint
}

export type ReceivingSession = {
  persistence: PersistedCollectionPersistence
  close: () => Promise<void>
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function until(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await sleep(10)
  }
  return true
}

/**
 * The upstream behavior a session 2 history asks for. `hold` keeps each load
 * pending, as an offline network does. `reject` rejects it at once, as a
 * fetch does when the device is offline.
 */
export function sourceBehaviorFor(
  upstream: Session2Upstream,
): UpstreamBehavior {
  return upstream === `never-answers` ? `hold` : `reject`
}

/**
 * An on-demand source whose upstream the host controls. Every row write,
 * delete, and settled load goes into `events`, so the judge can replay what
 * the source did. `answer-at-once` writes `answerRows` and resolves, for a
 * framework session that renders through its own hook.
 */
export function createReceivingSource(options: {
  persistence: PersistedCollectionPersistence
  waitMs: number
  behavior: UpstreamBehavior
  events: Array<SourceEvent>
  answerRows?: ReadonlyArray<Row>
}): ReceivingSource {
  const received: Array<LoadSubsetOptions> = []
  const pending: Array<{ load: LoadSubsetOptions; resolve: () => void }> = []
  let apply:
    | ((type: `insert` | `delete`, rows: ReadonlyArray<Row>) => unknown)
    | undefined
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id: COLLECTION_ID,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      initialRender: {
        strategy: `network-first`,
        networkTimeoutMs: options.waitMs,
      },
      persistence: options.persistence,
      sync: {
        sync: (params) => {
          apply = (type, rows) => {
            params.begin()
            for (const value of rows) params.write({ type, value })
            for (const row of rows) {
              options.events.push(
                type === `insert`
                  ? {
                      type: `rows`,
                      rows: [[row.id, { group: row.group, rank: row.rank }]],
                    }
                  : { type: `delete`, id: row.id },
              )
            }
            return params.commit()
          }
          return {
            loadSubset: (load: LoadSubsetOptions) => {
              received.push(plainLoadSnapshot(load))
              if (options.behavior === `reject`) {
                return Promise.reject(new Error(`upstream offline`))
              }
              if (options.behavior === `answer-at-once`) {
                return Promise.resolve(
                  apply?.(`insert`, options.answerRows ?? []),
                ).then(() => {
                  options.events.push({
                    type: `settled`,
                    load: plainLoadSnapshot(load),
                    current: true,
                  })
                })
              }
              return new Promise<void>((resolve) => {
                pending.push({ load, resolve })
              })
            },
          }
        },
      },
    }),
  )
  return {
    collection,
    received,
    pending: () => pending.length,
    answer: async (rows) => {
      await apply?.(`insert`, rows)
      for (const { load, resolve } of pending.splice(0)) {
        options.events.push({
          type: `settled`,
          load: plainLoadSnapshot(load),
          current: true,
        })
        resolve()
      }
    },
    write: async (rows) => {
      await apply?.(`insert`, rows)
    },
    remove: async (rows) => {
      await apply?.(`delete`, rows)
    },
  }
}

// The query's public signal, in the judge's vocabulary. A status the judge
// does not name is a driver error, so it throws rather than being guessed.
export function observeQuery(
  query: ReturnType<typeof queryFor>,
): QueryObservation {
  if (query.status === `ready`) {
    return { status: `ready`, rows: rowIds(query.toArray) }
  }
  if (query.status === `error` || query.status === `loading`) {
    return { status: query.status }
  }
  throw new Error(`unexpected query status ${query.status}`)
}

export function queryFor(shape: Shape, source: Collection<Row, string, any>) {
  return shape === `filter`
    ? createLiveQueryCollection((q) =>
        q.from({ row: source }).where(({ row }) => eq(row.group, `a`)),
      )
    : createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.group, `a`))
          .orderBy(({ row }) => row.rank)
          .limit(2),
      )
}

/** The ids of rows, sorted: the only row form the record keeps. */
export function rowIds(rows: ReadonlyArray<{ id: string }>): Array<string> {
  return rows.map((row) => row.id).sort()
}

// Session 1 is online. Each load is answered by the source, so the rows in
// storage come only from the wrapper.
async function loadAndAnswer(
  source: ReceivingSource,
  query: ReturnType<typeof queryFor>,
  rows: ReadonlyArray<Row>,
): Promise<void> {
  const preloaded = query.preload()
  const state = { settled: false }
  void preloaded.then(
    () => (state.settled = true),
    () => (state.settled = true),
  )
  for (let i = 0; i < 100 && !state.settled; i++) {
    if (source.pending() > 0) await source.answer(rows)
    await sleep(10)
  }
  await preloaded
  // Premise witness: session 1 really loaded the demand online, so the
  // history has coverage to test. This is not a verdict on the law.
  const held = rowIds(query.toArray).join(`,`)
  if (held !== `a1,a2`) {
    throw new Error(`session 1 held ${held}, expected a1,a2`)
  }
}

/**
 * Runs session 1 of a history over `persistence` and returns its source log.
 * The caller owns the persistence and closes it afterwards.
 */
export async function recordSession1(
  persistence: PersistedCollectionPersistence,
  history: ReceivingHistory,
): Promise<Session1Record> {
  const events: Array<SourceEvent> = []
  const source = createReceivingSource({
    persistence,
    waitMs: 0,
    behavior: `hold`,
    events,
  })
  const query = queryFor(history.shape, source.collection)
  const loadRows = history.shape === `filter` ? [A1, A2] : [A1, A2, A3]
  try {
    for (const step of history.session1) {
      if (step.kind === `load`) await loadAndAnswer(source, query, loadRows)
      if (step.kind === `remove`) await source.remove([step.row])
      if (step.kind === `write`) await source.write([step.row])
    }
    await sleep(50)
    return { events }
  } finally {
    await query.cleanup()
    await source.collection.cleanup()
  }
}

/**
 * A transport-safe copy of a load, for hosts that send records out of their
 * bundle (a page, a worker, or a renderer). The IR can hold cycles, which JSON
 * rejects, so the copy keeps each object once per branch and drops a back
 * reference. The demand key and the judge read only the fields the copy keeps.
 */
export function plainLoadSnapshot<T>(
  value: T,
  ancestors = new Set<object>(),
): T {
  if (value === null || typeof value !== `object`) return value
  if (ancestors.has(value)) return undefined as T
  ancestors.add(value)
  const copy = Array.isArray(value)
    ? value.map((item) => plainLoadSnapshot(item, ancestors))
    : Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => typeof item !== `function`)
          .map(([key, item]) => [key, plainLoadSnapshot(item, ancestors)]),
      )
  ancestors.delete(value)
  return copy as T
}

/**
 * The production configuration of a session 2 source: the wait and the
 * upstream behavior the history asks for. Every host builds its session 2
 * source from this, so the configuration is changed in one place.
 */
export function session2SourceOptions(history: ReceivingHistory): {
  waitMs: number
  behavior: UpstreamBehavior
} {
  return {
    waitMs: history.session2.waitMs,
    behavior: sourceBehaviorFor(history.session2.upstream),
  }
}

/**
 * Records the checkpoints of a session 2 query. `observe` reads the host's
 * public signal: the query status and rows for a query host, or the rendered
 * output for a framework. `forwarded` counts the loads the source received.
 * Each checkpoint carries the milliseconds since `loadStartedAt`, the moment
 * the query's load began.
 */
export async function recordCheckpoints(
  observe: () => QueryObservation,
  forwarded: () => number,
  loadStartedAt: number,
): Promise<{
  beforeDeadline: ReceivingCheckpoint
  afterDeadline: ReceivingCheckpoint
}> {
  if (!(await until(() => forwarded() > 0, FORWARD_TIMEOUT_MS))) {
    throw new Error(`session 2 never forwarded an upstream load`)
  }
  const take = (): ReceivingCheckpoint => ({
    observed: observe(),
    sinceLoadStartMs: Date.now() - loadStartedAt,
  })
  await sleep(CHECKPOINT_MS)
  const beforeDeadline = take()
  await until(() => observe().status !== `loading`, AFTER_DEADLINE_POLL_MS)
  const afterDeadline = take()
  return { beforeDeadline, afterDeadline }
}

/** Runs session 2 of a history over `persistence` and returns its record. */
export async function recordSession2(
  persistence: PersistedCollectionPersistence,
  history: ReceivingHistory,
): Promise<Session2Record> {
  const source = createReceivingSource({
    persistence,
    ...session2SourceOptions(history),
    events: [],
  })
  const query = queryFor(history.shape, source.collection)
  try {
    const loadStartedAt = Date.now()
    void query.preload().catch(() => undefined)
    const checkpoints = await recordCheckpoints(
      () => observeQuery(query),
      () => source.received.length,
      loadStartedAt,
    )
    return { sent: [...source.received], ...checkpoints }
  } finally {
    await query.cleanup()
    await source.collection.cleanup()
  }
}

/**
 * Runs both sessions in one process, each over its own session from
 * `openSession`. Session 1 closes before session 2 opens, so session 2 reads
 * what session 1 wrote through storage alone.
 */
export async function recordReceivingHistory(
  history: ReceivingHistory,
  openSession: () => Promise<ReceivingSession>,
): Promise<{ session1: Session1Record; session2: Session2Record }> {
  const first = await openSession()
  let session1: Session1Record
  try {
    session1 = await recordSession1(first.persistence, history)
  } finally {
    await first.close()
  }
  const second = await openSession()
  try {
    return {
      session1,
      session2: await recordSession2(second.persistence, history),
    }
  } finally {
    await second.close()
  }
}

/** The query the history's session 2 reads, as the judge's `QuerySpec`. */
export function querySpecFor(history: ReceivingHistory): QuerySpec {
  return history.shape === `filter`
    ? { group: `a` }
    : { group: `a`, orderByRank: true, limit: 2 }
}

const UPSTREAM: Record<Session2Upstream, OfflineUpstream> = {
  'never-answers': `never answers`,
  'fails-at-once': `fails at once`,
}

/**
 * The judge's records for a history: one per session 2 checkpoint. The
 * premise `waitPassed` is the history's declared wait measured from the load
 * start, so it does not depend on the production configuration. A host run
 * with a different wait is then judged against the declared law.
 */
export function coverageRecords(
  history: ReceivingHistory,
  session1: Session1Record,
  session2: Session2Record,
): { beforeDeadline: CoverageRecord; afterDeadline: CoverageRecord } {
  const build = (checkpoint: ReceivingCheckpoint): CoverageRecord => ({
    events: session1.events,
    queries: {
      [QUERY_NAME]: {
        spec: querySpecFor(history),
        sent: session2.sent,
        observed: checkpoint.observed,
      },
    },
    upstream: UPSTREAM[history.session2.upstream],
    waitPassed: checkpoint.sinceLoadStartMs >= history.session2.waitMs,
  })
  return {
    beforeDeadline: build(session2.beforeDeadline),
    afterDeadline: build(session2.afterDeadline),
  }
}
