import {
  BTreeIndex,
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
  isUndefined,
  not,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRuns,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression-oracle'
import { queryCollectionOptions } from '../src/query'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

/**
 * # Does an on-demand refetch leave a gap between served ordered pages?
 *
 * ## Contract
 *
 * The ordered loader pages a window through `loadSubset`: a first page
 * (`orderBy`, `limit`), tie requests (`where` equal to a boundary value), and
 * continuation pages that carry both a `cursor` and an `offset`. A provider may
 * honor either encoding (`LoadSubsetOptions`). After a page's request settles,
 * the loader's boundary is the leading order value of the page's last row
 * (ARCHITECTURE.md, "Ordered requests, continuation, and recovery"). The
 * loader then treats every row through that boundary as loaded.
 *
 * If a sync adapter refetches each page alone, a row that now sorts between
 * two served pages is in neither result, and the loader sees no change that
 * would start another load (issue #2136). The LoadSubset contract therefore
 * requires a sync adapter that refetches loaded subsets on its own either to
 * keep each served prefix whole, or to call `invalidateLoadedSubsets()` once
 * the refetched rows apply. Query DB does the second; each ordered loader
 * then re-establishes its window with a bounded repair from the start.
 *
 * Law: after preload, and after a refetch settles and the loader reaches its
 * fixed point, the public window equals the window over the current backend
 * rows. A refetch is either `utils.refetch()` or a Query refetch of the
 * collection's pages, such as `invalidateQueries`. Between those checkpoints
 * the provider may lag the backend, so no window is owed. While an
 * optimistic transaction persists, core holds accepted sync rows back, so
 * the checkpoint for a refetch during it moves to the transaction's release.
 *
 * Coverage law, at the same checkpoints: every backend row from the start of
 * the order through the window's last row is in the source Collection with
 * its current values, and every backend row is when the window is short.
 * The loader treats those rows as loaded, so a missing one would never be
 * requested. The window law sees such a row only once it joins the window;
 * the coverage law sees it while it is latent.
 *
 * Neighboring laws bound how the refetch does its work:
 * - A refetch or invalidation never starts a new full-source request.
 *   Full-source reads can be very expensive, and the repair always has a
 *   bounded read available. Re-running a full-source request that already
 *   existed is allowed.
 * - When the read that repairs a window fails, the window shows its last
 *   result or the right one, never another, and the refetch starts no
 *   full-source request. The loader's automatic retry then restores the
 *   window once the provider recovers.
 *   That retry still reads the full source today; bounded failure recovery
 *   is tracked separately in the coverage map.
 * - Repeating a refetch with an unchanged backend serves no more rows than the
 *   refetch before it, so a refetch's work does not grow with each read.
 * - A refetch or invalidation of an unchanged backend starts one first-page
 *   request for the window's predicate and order, not one per served page.
 * - A provider that honors neither `cursor` nor `offset` breaks the request
 *   contract. Refetch must still settle, and requests must stop growing.
 *
 * Reports (`invalidateLoadedSubsets()`, seen as the Collection's
 * `loadedSubsets:invalidated` event) start a bounded repair in every paging
 * ordered live query on the source, so they must be rare:
 * - A report needs a reason: some ordered request that was answered before
 *   returned different rows when it was answered again in that step. Any
 *   step can meet it. A `loadSubset` call can acquire a released page whose
 *   Query an invalidation marked stale; the call settles on the cached rows,
 *   and Query then refetches the page on its own, which is a refetch the
 *   loader must hear about.
 * - A step reports at most once, including any report its repair could
 *   cause. A report says only that pages may have shifted, so a second one
 *   in the same step would repeat the repair for nothing.
 * - A refetch or invalidation of an unchanged backend never reports.
 * - A full page that only loses rows, or whose rows change only in place,
 *   still starts at the same point and ends at or after its old end. With no
 *   later page, no row can fall outside it, so the refetch does not report. A
 *   visible delete or order change already starts the loader's own repair.
 *   A short last page that loses its last row ends earlier, so it may
 *   report; that costs one repair, not a wrong window.
 * - A page whose end moves earlier reports, because a filtered window can
 *   need a row that now sorts between the page's new and old end. But a
 *   window whose rows are all in its own first page, as after an ordinary
 *   insert into a top-N list, starts no repair: rows the page left out sort
 *   after its end. Then the refetch sends only the refetched Queries. The
 *   loader can judge that only from visible rows: while a persisting
 *   optimistic transaction holds the refetched rows back, it repairs.
 * Each request also carries a Query key that matches its own request data,
 * so a `queryFn` may read either one.
 *
 * Limits:
 * - The generated campaigns use a provider that honors `cursor`. A provider
 *   that honors only `offset` already gets a wrong window at preload under a
 *   joined filter: the loader repeats a continuation offset capped at the
 *   window size. That loader defect is separate from #2136 and is recorded as
 *   open in the coverage map. The named replays still run both encodings.
 * - It does not check the window after a marker flip, even when the provider
 *   is current. The loader used to stop refilling after a joined-side
 *   removal; a named replay now checks that trace, but the campaigns do not
 *   check after flips.
 * - The generated campaigns use an uncapped provider. With a provider that
 *   caps pages, a row whose order changes can drop out of the window after a
 *   refetch even on main, through the loader's own repair. That defect is
 *   separate from #2136 and has an `it.fails` witness. The named replays run
 *   the issue trace with a page cap.
 * - The report laws bound when Query DB reports, not exactly when it must.
 *   Whether a missing report leaves a gap is judged through the window law.
 *   A page whose end moves earlier reports even when every window is inside
 *   its first page; the no-repair law then bounds the cost, not the report. The oracle
 *   does not observe how a repair overlaps in-flight work; the ordered loader
 *   state oracle owns that.
 * - Query DB records a page's rows only after their sync transaction is
 *   accepted, so a later successful retry still sees the change. No public
 *   history distinguishes that from recording earlier: the failed attempt
 *   reports on its own, and the repair it starts reads the provider again.
 *   The application-failure replay checks only the window around a failed
 *   application.
 * - A Query refetch that joins a running `refetch: true` acquisition on the
 *   same Query hash does not report, because the guard cannot tell the two
 *   results apart. No history here reaches it.
 * - It drives one runtime. Follower tabs of a multi-tab persisted collection
 *   do not receive the report (#2174).
 * - Holds write a label change or a delete, and the backend never takes the
 *   write. Optimistic inserts are not modeled, and no window is checked
 *   during a hold, where an optimistic delete can leave a joined window short
 *   (#2148, #2169).
 * - A live query's preload waits until its rows are visible, so the harness
 *   does not await one that starts during a hold until its release.
 * - It checks refetch cost only as relations between reads of the same state.
 *   The cursor-pagination integration oracle owns the zero-call law for a
 *   fresh `createCursorPager` cache.
 * - The provider is controlled: it evaluates each request exactly. It may
 *   return fewer rows than a request's `limit`, as page-capped APIs do; a short
 *   reply does not prove source exhaustion (glossary).
 */

type Item = { id: number; rank: number; label: string }
type Marker = { id: number; itemId: number }

// ## Model
//
// The window is a pure function of the backend rows, the local markers, and
// the query's order and window. A LEFT-joined marker filters rows after the
// provider's order and limit, so the loader must page past a filtered row.
// The model sorts the current backend rows with an independent comparator.
// It shares no production cursor, comparator, or ordering code.
type Scenario = {
  // `ignore` honors neither cursor nor offset. It breaks the request
  // contract and is used only to check that refetch fails fast.
  encoding: `cursor` | `offset` | `ignore`
  // A function Query key derives each key from the request data.
  functionKey: boolean
  // One order term uses unique ranks. Two terms allow rank ties, which the
  // loader resolves with separate tie requests.
  terms: 1 | 2
  // The leading order term: a number, or a mixed-case string under the
  // default locale collation, whose order differs from code-unit order.
  orderKey: `rank` | `label`
  // The most rows the provider returns for one request, if it caps pages.
  pageCap: number | undefined
  limit: number
  offset: number
}

function compareRows(a: Item, b: Item, scenario: Scenario): number {
  const leading =
    scenario.orderKey === `rank`
      ? b.rank - a.rank
      : b.label.localeCompare(a.label)
  return leading || (scenario.terms === 2 ? a.id - b.id : 0)
}

function expectedWindow(
  backend: ReadonlyMap<number, Item>,
  markers: ReadonlySet<number>,
  scenario: Scenario,
): Array<number> {
  return [...backend.values()]
    .filter((row) => markers.has(row.id))
    .sort((a, b) => compareRows(a, b, scenario))
    .slice(scenario.offset, scenario.offset + scenario.limit)
    .map((row) => row.id)
}

// The loader treats every row through its boundary as loaded, and its
// boundary is at or after the window's last row. So every backend row from
// the start of the order through that row must be in the source Collection,
// with its current values. A window shorter than its limit read the whole
// source, so then every backend row must be. The window law alone sees a
// missing row only once a marker makes it a window row; this law sees it
// while it is still latent.
function expectedCoverage(
  backend: ReadonlyMap<number, Item>,
  markers: ReadonlySet<number>,
  scenario: Scenario,
): Array<Item> {
  const rows = [...backend.values()].sort((a, b) => compareRows(a, b, scenario))
  const window = expectedWindow(backend, markers, scenario)
  if (window.length < scenario.limit) return rows
  const end = backend.get(window.at(-1)!)!
  return rows.filter((row) => compareRows(row, end, scenario) <= 0)
}

// ## History grammar
//
// - `upsert` and `delete` change only the backend. The provider sends nothing
//   until the next refetch, like a Query cache that is not refetched.
// - `flip` adds or removes one local marker. Removing a window row's marker
//   makes the loader request another page from the current backend.
// - `invalidate` invalidates the Query cache, which refetches each active page
//   through Query Core rather than `utils.refetch()`. Each page must still read
//   its whole served prefix, and a later `refetch` must still cover the
//   boundary the loader proved at serve time.
// - `refetch` calls `utils.refetch()`, which makes the provider current.
// - `hold` starts an optimistic update (a label change) or delete of a loaded
//   row whose handler waits until `release`. The backend never takes the
//   write, so after release the row shows its synced values again. While the
//   transaction persists, core holds every accepted sync transaction back,
//   so a refetch's rows and its report arrive before they are visible. No
//   window is owed during a hold; the checkpoint moves to its release.
//
// - `observe` starts a second live query, `where id = n`, on the same source.
//   Its own demand can load a row before a refetch does, so a page's result can
//   change while no Collection row changes.
//
// A generated history is one to three rounds. Each round flips markers, which
// makes the loader serve continuation pages, then changes the backend while
// the provider lags, may flip or observe, may invalidate and change the
// backend again, and ends with a refetch. A round may hold an optimistic
// write from its start, or from just before its refetch, and releases it
// after the refetch. Ids come from a small space, so
// inserts often land between served pages and upserts often move a served
// row. Named replays use the same commands in other orders. With one order
// term, the fixture maps a generated rank to `rank * 100 + id`, so ranks stay
// unique.
type Command =
  | { type: `upsert`; id: number; rank: number }
  | { type: `delete`; id: number }
  | { type: `flip`; id: number }
  | { type: `observe`; id: number }
  | { type: `invalidate` }
  | { type: `refetch` }
  | { type: `hold`; kind: `update` | `delete`; id: number }
  | { type: `release` }

type Case = {
  scenario: Scenario
  initial: Array<{ id: number; rank: number; marked: boolean }>
  history: Array<Command>
}

const ids = fc.integer({ min: 0, max: 7 })
const ranks = fc.integer({ min: 0, max: 5 })

const flip: fc.Arbitrary<Command> = fc.record({
  type: fc.constant(`flip` as const),
  id: ids,
})
const flipOrObserve: fc.Arbitrary<Command> = fc.oneof(
  { weight: 3, arbitrary: flip },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant(`observe` as const), id: ids }),
  },
)
const backendChange: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`upsert` as const),
      id: ids,
      rank: ranks,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant(`delete` as const), id: ids }),
  },
)

const caseArbitrary: fc.Arbitrary<Case> = fc.record({
  scenario: fc.record({
    encoding: fc.constant(`cursor` as const),
    functionKey: fc.boolean(),
    terms: fc.constantFrom(1 as const, 2 as const),
    orderKey: fc.constantFrom(`rank` as const, `label` as const),
    // Page caps run in named replays only; see the limits above.
    pageCap: fc.constant(undefined),
    limit: fc.integer({ min: 1, max: 3 }),
    offset: fc.integer({ min: 0, max: 1 }),
  }),
  initial: fc.uniqueArray(
    fc.record({ id: ids, rank: ranks, marked: fc.boolean() }),
    { selector: (row) => row.id, minLength: 2, maxLength: 8 },
  ),
  history: fc
    .array(
      fc.tuple(
        fc.array(flip, { maxLength: 3 }),
        fc.array(backendChange, { minLength: 1, maxLength: 4 }),
        fc.array(flipOrObserve, { maxLength: 2 }),
        fc.option(fc.array(backendChange, { minLength: 1, maxLength: 3 })),
        fc.option(
          fc.record({
            command: fc.record({
              type: fc.constant(`hold` as const),
              kind: fc.constantFrom(`update` as const, `delete` as const),
              id: ids,
            }),
            from: fc.constantFrom(`start` as const, `refetch` as const),
          }),
          { freq: 3 },
        ),
      ),
      { minLength: 1, maxLength: 3 },
    )
    .map((rounds) =>
      rounds.flatMap(([before, changes, after, afterInvalidate, hold]) => [
        ...(hold?.from === `start` ? [hold.command] : []),
        ...before,
        ...changes,
        ...after,
        // An invalidation, then backend changes that a later refetch must
        // cover through the boundary proved before the invalidation.
        ...(afterInvalidate
          ? [{ type: `invalidate` as const }, ...afterInvalidate]
          : []),
        ...(hold?.from === `refetch` ? [hold.command] : []),
        { type: `refetch` as const },
        ...(hold ? [{ type: `release` as const }] : []),
      ]),
    ),
})

// A premise-directed grammar for the first-page skip under a hold. The skip
// reads the local rows past the window's first page, and only another live
// query keeps such rows loaded, so each round observes rows first. Every
// initial row is marked, so the window starts inside its first page. Backend
// changes then move rows ahead of the page's end, a hold starts just before
// the refetch, and its release is the checkpoint. The general grammar rarely
// draws several observations together with a hold.
const heldCaseArbitrary: fc.Arbitrary<Case> = fc
  .record({
    scenario: fc.record({
      encoding: fc.constant(`cursor` as const),
      functionKey: fc.constant(false),
      terms: fc.constantFrom(1 as const, 2 as const),
      orderKey: fc.constant(`rank` as const),
      pageCap: fc.constant(undefined),
      limit: fc.constantFrom(1, 1, 2),
      offset: fc.constant(0),
    }),
    initial: fc.uniqueArray(
      fc.record({
        id: ids,
        rank: fc.integer({ min: 0, max: 2 }),
        marked: fc.constant(true),
      }),
      { selector: (row) => row.id, minLength: 3, maxLength: 5 },
    ),
  })
  .chain(({ scenario, initial }) => {
    // Each round moves one row that no other query keeps loaded (the mover)
    // ahead of the page's end, and puts a new, unmarked row further ahead.
    // The other rows are observed, so they stay loaded past the page. That
    // is the premise under which the skip, reading rows from before the
    // refetch, would keep a window that misses the mover. The hold writes to
    // the observed row that sorts last: the skip leaves rows with pending
    // writes out of its read, so a write near the window ends the read
    // short and hides the premise.
    const initialIds = initial.map((row) => row.id)
    const fixtureOrder = (id: number) => {
      const rank = initial.find((row) => row.id === id)!.rank
      return scenario.terms === 1 ? rank * 100 + id : rank * 100 - id
    }
    const sortsLast = (observed: Array<number>) =>
      observed.reduce((last, id) =>
        fixtureOrder(id) < fixtureOrder(last) ? id : last,
      )
    const newIds = [0, 1, 2, 3, 4, 5, 6, 7].filter(
      (id) => !initialIds.includes(id),
    )
    const round = fc
      .record({
        mover: fc.constantFrom(...initialIds),
        moverRank: fc.integer({ min: 3, max: 4 }),
        arrival: fc.constantFrom(...newIds),
        arrivalRank: fc.integer({ min: 4, max: 5 }),
        flips: fc.array(flip, { maxLength: 1 }),
      })
      .chain((choice) =>
        fc
          .subarray(
            initialIds.filter((id) => id !== choice.mover),
            { minLength: 1 },
          )
          .map((observed): Array<Command> => [
            ...observed.map((id) => ({ type: `observe` as const, id })),
            { type: `upsert`, id: choice.mover, rank: choice.moverRank },
            { type: `upsert`, id: choice.arrival, rank: choice.arrivalRank },
            ...choice.flips,
            { type: `hold`, kind: `update`, id: sortsLast(observed) },
            { type: `refetch` },
            { type: `release` },
          ]),
      )
    return fc.record({
      scenario: fc.constant(scenario),
      initial: fc.constant(initial),
      history: fc
        .array(round, { minLength: 1, maxLength: 2 })
        .map((rounds) => rounds.flat()),
    })
  })

// ## Production driver
//
// A real QueryClient backs an on-demand Query Collection with an eager B-tree
// index. Its query function serves each request from the current backend:
// `where` (including tie requests), then the encoding's continuation, then
// order and limit. A `cursor` provider applies `cursor.whereFrom` and ignores
// `offset` when a cursor is present. An `offset` provider ignores the cursor
// and skips `offset` rows. The marker Collection is a local eager source.
type Run = {
  windowIds: () => Array<number>
  backend: Map<number, Item>
  markers: Set<number>
  apply: (command: Command) => Promise<void>
  requests: Array<LoadSubsetOptions>
  // Rows returned by the provider so far.
  servedRows: () => number
  // Requests whose Query key does not match their request data.
  keyMismatches: () => number
  setEncoding: (encoding: Scenario[`encoding`]) => void
  // Fail every provider request after the next `count` requests, until
  // cleared. A failed request rejects its Query function.
  failAfter: (count: number | undefined) => void
  // The Query cache entries this Collection owns: one per tracked request.
  cachedQueries: () => number
  // Reports that served pages may have shifted (`loadedSubsets:invalidated`
  // events on the source Collection) so far.
  reports: () => number
  // Ordered requests answered again with different rows than their previous
  // answer, so far. A report needs one of these.
  changedReanswers: () => number
  // Make the next change application fail once: a change subscriber throws
  // while the refetched rows commit.
  failNextApplication: () => void
  // Start an optimistic update of a loaded row whose handler waits until the
  // returned release is called. While it persists, the Collection holds
  // every sync transaction back.
  holdUpdate: (id: number) => () => Promise<void>
  // Whether a hold is running. No window is owed until its release.
  holding: () => boolean
  // The source Collection's rows, which the coverage law checks.
  loadedRows: () => ReadonlyMap<number, Item>
  refetch: (opts?: { throwOnError?: boolean }) => Promise<unknown>
  cleanup: () => Promise<Array<unknown>>
}

let collectionSequence = 0

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function startRun(testCase: Case): Promise<Run> {
  const { scenario } = testCase
  const id = `refetch-ordered-prefix-${collectionSequence++}`
  // Letters alternate case, so locale and code-unit orders differ.
  const letters = [`a`, `B`, `c`, `D`, `e`, `F`]
  const toItem = (row: { id: number; rank: number }): Item => ({
    id: row.id,
    rank: scenario.terms === 1 ? row.rank * 100 + row.id : row.rank,
    label:
      (letters[row.rank] ?? `z`) + (scenario.terms === 1 ? String(row.id) : ``),
  })
  const backend = new Map(testCase.initial.map((row) => [row.id, toItem(row)]))
  const markers = new Set(
    testCase.initial.filter((row) => row.marked).map((row) => row.id),
  )
  const requests: Array<LoadSubsetOptions> = []
  let encoding = scenario.encoding
  let servedRows = 0
  let keyMismatches = 0
  const keyFor = (options: LoadSubsetOptions) => {
    const demandKey = getLoadSubsetDemandKey(options)
    return demandKey === undefined ? [id] : [id, demandKey]
  }
  let failFrom: number | undefined
  const answers = new Map<string, string>()
  let changedReanswers = 0
  const serve = (options: LoadSubsetOptions): Array<Item> => {
    const page = answer(options)
    if (options.orderBy) {
      const request = JSON.stringify([
        getLoadSubsetDemandKey(options),
        options.offset,
      ])
      const rows = JSON.stringify(page.map((row) => row.id))
      const previous = answers.get(request)
      if (previous !== undefined && previous !== rows) changedReanswers++
      answers.set(request, rows)
    }
    return page
  }
  const answer = (options: LoadSubsetOptions): Array<Item> => {
    requests.push(options)
    if (failFrom !== undefined && requests.length > failFrom) {
      throw new Error(`provider unavailable`)
    }
    const usesCursor = encoding === `cursor` && options.cursor
    const predicates = [
      options.where,
      usesCursor ? options.cursor!.whereFrom : undefined,
    ].filter((where) => where !== undefined)
    let page = [...backend.values()].filter((row) =>
      predicates.every(
        (where) => evaluateReferenceExpression(where, row) === true,
      ),
    )
    if (options.orderBy) {
      page.sort((a, b) => compareRows(a, b, scenario))
      if (!usesCursor && encoding !== `ignore`) {
        page = page.slice(options.offset ?? 0)
      }
      if (options.limit !== undefined) page = page.slice(0, options.limit)
      if (scenario.pageCap !== undefined) page = page.slice(0, scenario.pageCap)
    }
    servedRows += page.length
    return page.map((row) => ({ ...row }))
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
    },
  })
  const items = createCollection(
    queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: scenario.functionKey ? keyFor : [id],
      syncMode: `on-demand`,
      queryFn: (context) => {
        const options = context.meta!.loadSubsetOptions!
        if (
          scenario.functionKey &&
          JSON.stringify(context.queryKey) !== JSON.stringify(keyFor(options))
        ) {
          keyMismatches++
        }
        return Promise.resolve(serve(options))
      },
      getKey: (row) => row.id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      // A held optimistic write stays persisting until released; the
      // backend does not change.
      onUpdate: async () => {
        await heldWrite
        return { refetch: false }
      },
      onDelete: async () => {
        await heldWrite
        return { refetch: false }
      },
    }),
  )
  let heldWrite: Promise<void> = Promise.resolve()
  // The running hold's release, if any.
  let releaseHold: (() => Promise<void>) | undefined
  const heldPreloads: Array<Promise<void>> = []
  const hold = (kind: `update` | `delete`, rowId: number) => {
    let release!: () => void
    heldWrite = new Promise((resolve) => {
      release = resolve
    })
    const transaction =
      kind === `update`
        ? items.update(rowId, (draft) => {
            draft.label += `!`
          })
        : items.delete(rowId)
    return async () => {
      release()
      await transaction.isPersisted.promise
      await settle()
    }
  }

  let reports = 0
  items.on(`loadedSubsets:invalidated`, () => {
    reports++
  })
  let failApplication = false
  items.subscribeChanges(() => {
    if (!failApplication) return
    failApplication = false
    throw new Error(`change subscriber failed`)
  })

  let markerSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
  const markerCollection = createCollection<Marker, number>({
    id: `${id}-markers`,
    getKey: (marker) => marker.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        markerSync = operations
        operations.begin()
        for (const itemId of markers) {
          operations.write({ type: `insert`, value: { id: itemId, itemId } })
        }
        operations.commit()
        operations.markReady()
      },
    },
  })

  const window = createLiveQueryCollection((q) => {
    const ordered = q
      .from({ item: items })
      .leftJoin({ marker: markerCollection }, ({ item, marker }) =>
        eq(item.id, marker.itemId),
      )
      .where(({ marker }) => not(isUndefined(marker.itemId)))
      .orderBy(
        ({ item }) => (scenario.orderKey === `rank` ? item.rank : item.label),
        `desc`,
      )
    return (
      scenario.terms === 2
        ? ordered.orderBy(({ item }) => item.id, `asc`)
        : ordered
    )
      .offset(scenario.offset)
      .limit(scenario.limit)
      .select(({ item }) => ({ id: item.id }))
  })

  const observers: Array<{ cleanup: () => Promise<void> }> = []
  const apply = async (command: Command): Promise<void> => {
    switch (command.type) {
      case `upsert`:
        backend.set(command.id, toItem(command))
        return
      case `delete`:
        backend.delete(command.id)
        return
      case `flip`: {
        const marked = markers.has(command.id)
        if (marked) markers.delete(command.id)
        else markers.add(command.id)
        markerSync.begin()
        markerSync.write({
          type: marked ? `delete` : `insert`,
          value: { id: command.id, itemId: command.id },
        })
        const receipt = markerSync.commit()
        if (receipt !== true) await receipt
        await settle()
        return
      }
      case `observe`: {
        const observer = createLiveQueryCollection((q) =>
          q
            .from({ item: items })
            .where(({ item }) => eq(item.id, command.id))
            .select(({ item }) => ({ id: item.id })),
        )
        observers.push(observer)
        // A preload waits until its rows are visible, so under a hold it
        // settles only after the release.
        const preload = observer.preload()
        if (releaseHold === undefined) await preload
        else heldPreloads.push(preload)
        await settle()
        return
      }
      case `invalidate`:
        await queryClient.invalidateQueries({ queryKey: [id] })
        await settle()
        return
      case `refetch`:
        await items.utils.refetch()
        await settle()
        return
      // A row that is not loaded cannot take an optimistic write, so the
      // hold is a no-op then.
      case `hold`:
        if (releaseHold === undefined && items.has(command.id)) {
          releaseHold = hold(command.kind, command.id)
          await settle()
        }
        return
      case `release`: {
        const release = releaseHold
        releaseHold = undefined
        await release?.()
        await Promise.all(heldPreloads.splice(0))
        await settle()
        return
      }
    }
  }

  await window.preload()
  await settle()
  return {
    windowIds: () => window.toArray.map((row) => row.id),
    backend,
    markers,
    apply,
    requests,
    servedRows: () => servedRows,
    keyMismatches: () => keyMismatches,
    setEncoding: (next) => {
      encoding = next
    },
    failAfter: (count) => {
      failFrom = count === undefined ? undefined : requests.length + count
    },
    cachedQueries: () =>
      queryClient.getQueryCache().findAll({ queryKey: [id] }).length,
    reports: () => reports,
    changedReanswers: () => changedReanswers,
    failNextApplication: () => {
      failApplication = true
    },
    holdUpdate: (rowId) => hold(`update`, rowId),
    holding: () => releaseHold !== undefined,
    loadedRows: () =>
      new Map(
        items.toArray.map(({ id: rowId, rank, label }) => [
          rowId,
          { id: rowId, rank, label },
        ]),
      ),
    refetch: (opts) => items.utils.refetch(opts),
    cleanup: async () => {
      const failures: Array<unknown> = []
      // A failed history can stop inside a hold. Release it, so its
      // transaction does not outlive this run.
      try {
        await apply({ type: `release` })
      } catch (error) {
        failures.push(error)
      }
      for (const collection of [
        ...observers,
        window,
        items,
        markerCollection,
      ]) {
        try {
          await collection.cleanup()
        } catch (error) {
          failures.push(error)
        }
      }
      queryClient.clear()
      return failures
    },
  }
}

// ## Refinement check
//
// The checkpoints are preload, every invalidation, and every refetch. There the
// public window's
// ordered ids must equal the model's ids. The comparison keeps order, duplicates, and missing
// rows. A failure names its checkpoint, so a loader defect at preload is not
// mistaken for a refetch defect.
//
// The run also records the premise of the gap: a refetch or invalidation of a
// lagging provider after a continuation page was served. The campaigns must
// reach it, and must reach such a refetch while a hold is running.
type Observation = {
  reachedLaggingRefetchAfterContinuation: boolean
  // A refetch of a lagging provider while an optimistic write held sync rows
  // back.
  reachedLaggingRefetchDuringHold: boolean
  // Such a refetch that also reported, so a loader may have judged the skip
  // while the refetched rows were held back.
  reachedReportDuringHold: boolean
  // Reports over the whole run.
  reports: number
}

// A step's reports, checked against the report laws in the contract.
function checkReports(
  command: Command,
  reports: number,
  changedReanswers: number,
  checkpoint: string,
): void {
  if (reports > 1) {
    throw new Error(
      `a ${command.type} at ${checkpoint} reported ${reports} times; expected at most 1`,
    )
  }
  if (reports > 0 && changedReanswers === 0) {
    throw new Error(
      `a ${command.type} at ${checkpoint} reported, but no ordered request returned different rows`,
    )
  }
}

async function checkCase(testCase: Case): Promise<Observation> {
  const run = await startRun(testCase)
  let reachedLaggingRefetchAfterContinuation = false
  let reachedLaggingRefetchDuringHold = false
  let reachedReportDuringHold = false
  let primary: unknown
  const check = (checkpoint: string) => {
    const expected = expectedWindow(run.backend, run.markers, testCase.scenario)
    const actual = run.windowIds()
    if (!sameOrderedIds(actual, expected)) {
      throw new Error(
        `window ${checkpoint} was ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
      )
    }
    const loaded = run.loadedRows()
    const uncovered = expectedCoverage(
      run.backend,
      run.markers,
      testCase.scenario,
    ).filter(
      (row) => JSON.stringify(loaded.get(row.id)) !== JSON.stringify(row),
    )
    if (uncovered.length > 0) {
      throw new Error(
        `coverage ${checkpoint}: rows ${JSON.stringify(uncovered)} sort at or before the window's end but are ${JSON.stringify(uncovered.map((row) => loaded.get(row.id) ?? null))} in the source Collection`,
      )
    }
  }
  // A full-source request names no predicate, order, limit, or cursor. A
  // refetch may re-run one that already existed, but must not start the first.
  const isFullSource = (options: LoadSubsetOptions) =>
    options.where === undefined &&
    options.orderBy === undefined &&
    options.limit === undefined &&
    options.cursor === undefined
  const checkNoNewFullSource = (from: number, checkpoint: string) => {
    if (run.requests.slice(0, from).some(isFullSource)) return
    if (run.requests.slice(from).some(isFullSource)) {
      throw new Error(`a ${checkpoint} started a full-source request`)
    }
  }
  try {
    check(`after preload`)
    let providerCurrent = true
    const history: Array<Command> = [...testCase.history, { type: `refetch` }]
    for (const [step, command] of history.entries()) {
      if (
        (command.type === `refetch` || command.type === `invalidate`) &&
        !providerCurrent &&
        run.requests.some((options) => options.cursor !== undefined)
      ) {
        reachedLaggingRefetchAfterContinuation = true
      }
      if (command.type === `refetch` && !providerCurrent && run.holding()) {
        reachedLaggingRefetchDuringHold = true
      }
      const requestsBefore = run.requests.length
      const reportsBefore = run.reports()
      const reanswersBefore = run.changedReanswers()
      await run.apply(command)
      if (
        command.type === `refetch` &&
        run.holding() &&
        run.reports() > reportsBefore
      ) {
        reachedReportDuringHold = true
      }
      checkReports(
        command,
        run.reports() - reportsBefore,
        run.changedReanswers() - reanswersBefore,
        `step ${step}`,
      )
      if (command.type === `refetch` || command.type === `invalidate`) {
        checkNoNewFullSource(requestsBefore, `${command.type} at step ${step}`)
      }
      if (command.type === `upsert` || command.type === `delete`) {
        providerCurrent = false
      } else if (command.type === `release`) {
        if (providerCurrent) check(`after release at step ${step}`)
      } else if (command.type === `refetch` || command.type === `invalidate`) {
        providerCurrent = true
        if (!run.holding()) check(`after ${command.type} at step ${step}`)
      }
    }
    // Repeat the refetch twice with the backend unchanged. The second read
    // must serve no more rows than the first.
    // A first-page request is ordered and limited, with no cursor.
    const firstPageRequests = (from: number) =>
      run.requests
        .slice(from)
        .filter(
          (options) =>
            options.orderBy !== undefined &&
            options.limit !== undefined &&
            options.cursor === undefined,
        ).length
    const servedBy = async (command: Command) => {
      const before = run.servedRows()
      const requestsBefore = run.requests.length
      const reportsBefore = run.reports()
      await run.apply(command)
      const reports = run.reports() - reportsBefore
      if (reports > 0) {
        throw new Error(
          `a ${command.type} of an unchanged backend reported ${reports} times`,
        )
      }
      // The backend is unchanged, so the loader starts no repair and every
      // first-page request comes from the refetch itself.
      const firstPages = firstPageRequests(requestsBefore)
      if (firstPages > 1) {
        throw new Error(
          `a ${command.type} of an unchanged backend started ${firstPages} first-page requests; expected at most 1`,
        )
      }
      return run.servedRows() - before
    }
    // The first repeat may still settle loader work that the history
    // started, so only later repeats check the first-page law.
    const before = run.servedRows()
    await run.apply({ type: `refetch` })
    const first = run.servedRows() - before
    const second = await servedBy({ type: `refetch` })
    if (second > first) {
      throw new Error(
        `a repeated refetch served ${second} rows after ${first} with an unchanged backend`,
      )
    }
    check(`after repeated refetches`)
    // An invalidation refetches every page at once. It reads the same served
    // prefixes as an explicit refetch, so it serves no more rows.
    const invalidated = await servedBy({ type: `invalidate` })
    if (invalidated > second) {
      throw new Error(
        `an invalidation served ${invalidated} rows; an explicit refetch of the same state served ${second}`,
      )
    }
    check(`after an invalidation of an unchanged backend`)
    if (run.keyMismatches() > 0) {
      throw new Error(
        `${run.keyMismatches()} requests carried a Query key that did not match their request data`,
      )
    }
  } catch (error) {
    primary = error
  }
  const cleanupFailures = await run.cleanup()
  if (primary !== undefined && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primary, ...cleanupFailures],
      `refetch prefix law and cleanup failed`,
      { cause: primary },
    )
  }
  if (primary !== undefined) throw primary
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `refetch prefix cleanup failed`)
  }
  return {
    reachedLaggingRefetchAfterContinuation,
    reachedLaggingRefetchDuringHold,
    reachedReportDuringHold,
    reports: run.reports(),
  }
}

// A history that never settles is a progress failure, not a slow pass. The
// deadline turns it into a counterexample that fast-check can shrink. It is
// generous because a long history runs many settle loops on a loaded machine.
async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`history did not settle within 30 s`)),
          30_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function sameOrderedIds(
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  )
}

const property = `query-db.refetch-ordered-prefix`
const replay = readOracleRunConfig()
const campaigns =
  replay.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : replay.replayProperty === property
      ? ([`replay`] as const)
      : ([] as const)

describe(`query-db on-demand refetch keeps served ordered prefixes whole`, () => {
  it(`the comparison rejects a window with the right size but a stale row`, () => {
    expect(sameOrderedIds([5, 4], [5, 4])).toBe(true)
    expect(sameOrderedIds([4, 1], [5, 4])).toBe(false)
    expect(sameOrderedIds([4, 5], [5, 4])).toBe(false)
    expect(sameOrderedIds([5], [5, 4])).toBe(false)
  })

  // The issue's trace (rank desc, limit 2). Removing rank 10's marker makes
  // the loader serve a continuation after rank 4. The backend then gains
  // rank 5 (marked) and rank 6 (unmarked). The refetched first page ends at
  // 6, the continuation still starts after 4, and rank 5 is in neither.
  it.each([`cursor`, `offset`] as const)(
    `shows a row that moved between two served pages after a refetch (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        // With one order term the fixture rank is `rank * 100 + id`, so
        // rank 0 orders these rows by id: 10, 4, 1, 0.
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `upsert`, id: 6, rank: 0 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // The issue's trace with rank 5 left unmarked. The window over the backend
  // is still [4, 1], so the window law passes even when rank 5 is in no
  // served page. The loader still treats rank 5 as loaded, because it sorts
  // before the window's end; marking it later would never load it. Only the
  // coverage law sees this gap while it is latent.
  it.each([`cursor`, `offset`] as const)(
    `loads a row that moved between two served pages before it joins the window (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `upsert`, id: 6, rank: 0 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // The issue's trace with a provider that returns one row per request. A
  // short reply does not end the order, so the repair must keep reading.
  it.each([`cursor`, `offset`] as const)(
    `shows a moved row after a refetch when the provider caps pages (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: 1,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `upsert`, id: 6, rank: 0 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // Fracture scan witness. A second live query loads row 6 before the
  // refetch, so the refetched first page changes while no Collection row
  // does. A design that waits for a changed Collection row misses the gap.
  it.each([`cursor`, `offset`] as const)(
    `shows a moved row when another live query loaded the page's new row first (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 6, rank: 0 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `observe`, id: 6 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // The gate opens only when a page's keys change. A value change that keeps
  // every page's keys reaches the loader as an update to a row it already
  // sent; when the update moves that row in the order, the existing
  // order-change path repairs the window. Here the first page keeps its keys
  // while its last row's order value moves.
  it.each([`cursor`, `offset`] as const)(
    `repairs when a page keeps its keys but its last row moves (%s encoding)`,
    async (encoding) => {
      await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 2,
          limit: 2,
          offset: 0,
        },
        initial: [
          { id: 0, rank: 6, marked: true },
          { id: 1, rank: 4, marked: true },
          { id: 2, rank: 1, marked: true },
          { id: 3, rank: 0, marked: true },
        ],
        history: [
          { type: `flip`, id: 0 },
          { type: `upsert`, id: 1, rank: 2 },
          { type: `refetch` },
          { type: `upsert`, id: 7, rank: 3 },
          { type: `flip`, id: 7 },
        ],
      })
    },
  )

  // A page with no later page whose end moves earlier in the order. Rows that
  // arrive ahead of the page push its old last row out, but a tie request
  // still holds that row, so the loader sees no delete and still treats rows
  // through the old boundary as loaded. A new row that ties at the page's new
  // end sorts before that boundary and is in neither result. (Found by the
  // ordered-work oracle's refetch-then-signal provider.)
  it.each([`cursor`, `offset`] as const)(
    `shows a row that ties at a page's new, earlier end (%s encoding)`,
    async (encoding) => {
      await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 2,
          limit: 3,
          offset: 0,
        },
        initial: [
          { id: 0, rank: 5, marked: true },
          { id: 1, rank: 5, marked: true },
          { id: 2, rank: 4, marked: true },
          { id: 5, rank: 0, marked: false },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 5 },
          { type: `upsert`, id: 11, rank: 5 },
          { type: `flip`, id: 11 },
        ],
      })
    },
  )

  // A filtered one-page window whose page end moves earlier, with unique
  // order values. Row 4 arrives ahead of the page without a marker, so the
  // window needs a row past the page; row 3 now sorts between the page's
  // new end and the loader's old boundary and is in neither result.
  // (Found by the random campaign.)
  it(`shows a row that lands between a filtered page's new and old end`, async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 1,
        offset: 0,
      },
      initial: [
        { id: 0, rank: 1, marked: true },
        { id: 3, rank: 0, marked: true },
      ],
      history: [
        { type: `upsert`, id: 3, rank: 1 },
        { type: `upsert`, id: 4, rank: 1 },
      ],
    })
  })

  // The same shape while an optimistic update persists. The Collection
  // accepts the refetched rows at once but holds them back until the update
  // settles, so the report arrives while the old rows are still visible.
  // Other live queries hold rows 0, 1 and 2, so row 0 stays after it leaves
  // the page and no delete starts the loader's own repair. Once the rows
  // apply, unmarked row 4 heads the page and row 3 sorts between it and
  // row 0; only a repair after the rows become visible can load row 3.
  it(`shows a row that lands between a page's new and old end while an optimistic update persists`, async () => {
    const scenario: Scenario = {
      encoding: `cursor`,
      functionKey: false,
      orderKey: `rank`,
      pageCap: undefined,
      terms: 1,
      limit: 1,
      offset: 0,
    }
    const run = await startRun({
      scenario,
      initial: [
        { id: 0, rank: 1, marked: true },
        { id: 1, rank: 0, marked: true },
        { id: 2, rank: 0, marked: true },
        { id: 3, rank: 0, marked: true },
      ],
      history: [],
    })
    let primary: unknown
    try {
      for (const id of [0, 1, 2]) await run.apply({ type: `observe`, id })
      await run.apply({ type: `upsert`, id: 3, rank: 1 })
      await run.apply({ type: `upsert`, id: 4, rank: 1 })
      const release = run.holdUpdate(1)
      await run.apply({ type: `refetch` })
      await release()
      expect(run.windowIds()).toEqual(
        expectedWindow(run.backend, run.markers, scenario),
      )
    } catch (error) {
      primary = error
    }
    const failures = await run.cleanup()
    if (primary !== undefined) throw primary
    expect(failures).toEqual([])
  })

  // The ordinary insert into a top-N list. The page's end moves earlier, so
  // Query DB reports, but every window row is in the window's own first page:
  // the refetch must send only the Queries it refetches, with no repair.
  it.each([1, 2] as const)(
    `a refetch of a window inside its first page starts no repair (%i order terms)`,
    async (terms) => {
      const scenario: Scenario = {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms,
        limit: 2,
        offset: 0,
      }
      const run = await startRun({
        scenario,
        initial: [3, 2, 1, 0].map((rank, id) => ({ id, rank, marked: true })),
        history: [],
      })
      let primary: unknown
      try {
        await run.apply({ type: `upsert`, id: 5, rank: 5 })
        await run.apply({ type: `flip`, id: 5 })
        const queries = run.cachedQueries()
        const requestsBefore = run.requests.length
        await run.apply({ type: `refetch` })
        expect(run.windowIds()).toEqual(
          expectedWindow(run.backend, run.markers, scenario),
        )
        expect(run.requests.length - requestsBefore).toBeLessThanOrEqual(
          queries,
        )
      } catch (error) {
        primary = error
      }
      const failures = await run.cleanup()
      if (primary !== undefined) throw primary
      expect(failures).toEqual([])
    },
  )

  // A changed first page whose only later page is empty. The empty
  // continuation still starts where the first page used to end, so a row
  // that now sorts between them is in neither result.
  it(`shows a row that moved before an empty later page`, async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 1,
        offset: 0,
      },
      initial: [
        { id: 0, rank: 0, marked: false },
        { id: 1, rank: 0, marked: false },
      ],
      history: [
        { type: `upsert`, id: 0, rank: 0 },
        { type: `flip`, id: 5 },
        { type: `refetch` },
        { type: `delete`, id: 0 },
        { type: `invalidate` },
        { type: `upsert`, id: 0, rank: 1 },
        { type: `upsert`, id: 5, rank: 0 },
      ],
    })
  })

  // The issue's trace again, but the pages refetch through a Query
  // invalidation instead of `utils.refetch()`. Each page refetches alone, so
  // each must read its own served prefix.
  it.each([`cursor`, `offset`] as const)(
    `shows a row that moved between two served pages after a Query invalidation (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `upsert`, id: 6, rank: 0 },
          { type: `invalidate` },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // A second refetch must still cover the first served boundary. The first
  // refetch inserts rows ahead of it; the backend then gains a row between
  // the new and old ends, which the second refetch must deliver.
  it.each([`cursor`, `offset`] as const)(
    `a second refetch still covers the first served boundary (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: true,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 2,
          limit: 2,
          offset: 0,
        },
        initial: [
          { id: 0, rank: 6, marked: true },
          { id: 1, rank: 4, marked: true },
          { id: 2, rank: 1, marked: true },
          { id: 3, rank: 0, marked: true },
        ],
        history: [
          { type: `flip`, id: 0 },
          { type: `upsert`, id: 7, rank: 5 },
          { type: `refetch` },
          { type: `upsert`, id: 8, rank: 3 },
          { type: `flip`, id: 8 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // A provider that honors neither encoding returns the same page for every
  // continuation. That breaks the request contract, but a refetch must still
  // settle, and the loader must not keep requesting.
  // Pages that keep their start and end at or after their old end, with no
  // later page: no row can fall outside them, so no refetch reports. The
  // delete is visible, so the loader repairs through its own path.
  it.each([
    {
      name: `a one-page window loses a row`,
      initial: [3, 2, 1, 1].map((rank, id) => ({ id, rank, marked: true })),
      history: [{ type: `delete` as const, id: 1 }],
    },
    {
      // Row 1 is unmarked, so the window pages past it; the delete is in
      // the last page.
      name: `the last page of a two-page window loses a row`,
      initial: [
        { id: 0, rank: 4, marked: true },
        { id: 1, rank: 3, marked: false },
        { id: 2, rank: 2, marked: true },
        { id: 3, rank: 1, marked: true },
      ],
      history: [{ type: `delete` as const, id: 2 }],
    },
  ])(`a refetch does not report when $name`, async ({ initial, history }) => {
    const observation = await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 2,
        offset: 0,
      },
      initial,
      history,
    })
    expect(observation.reports).toBe(0)
  })

  // A change subscriber throws while the refetched first page commits, so
  // that page's rows do not apply. The window then shows its last result or
  // the right one, and the next refetch must restore it.
  it(`a refetch whose page application fails keeps the last window until the next refetch`, async () => {
    const scenario: Scenario = {
      encoding: `cursor`,
      functionKey: false,
      orderKey: `rank`,
      pageCap: undefined,
      terms: 1,
      limit: 2,
      offset: 0,
    }
    const run = await startRun({
      scenario,
      initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
      history: [],
    })
    let primary: unknown
    try {
      for (const command of [
        { type: `flip`, id: 10 },
        { type: `upsert`, id: 5, rank: 0 },
        { type: `flip`, id: 5 },
        { type: `upsert`, id: 6, rank: 0 },
      ] as const) {
        await run.apply(command)
      }
      const last = run.windowIds()
      run.failNextApplication()
      await run.refetch({ throwOnError: false })
      await settle()
      const expected = expectedWindow(run.backend, run.markers, scenario)
      expect([last, expected]).toContainEqual(run.windowIds())
      await run.apply({ type: `refetch` })
      expect(run.windowIds()).toEqual(expected)
    } catch (error) {
      primary = error
    }
    const failures = await run.cleanup()
    if (primary !== undefined) throw primary
    expect(failures).toEqual([])
  })

  // A row that arrives ahead moves a one-page window's end earlier, so the
  // refetch must report. The report gate judges a page's end by order, not
  // by how the provider returned it:
  // - Rows without `rank` sort last, so the first page ends on one. An empty
  //   page and a page whose last row has no order value stay distinct.
  // - A provider may return a page's rows in any order. Its last array row
  //   is then not the page's end.
  // These drive the sync boundary directly: the generated campaigns give
  // every row a rank, and their provider returns rows in order.
  it.each([
    {
      name: `from a row without an order value`,
      initial: [{ id: 0, rank: 3 }, { id: 1 }, { id: 2 }],
      arrival: { id: 3, rank: 2 },
      reversed: false,
    },
    {
      name: `when the provider returns the page in reverse order`,
      initial: [
        { id: 0, rank: 10 },
        { id: 1, rank: 4 },
        { id: 2, rank: 1 },
      ],
      arrival: { id: 3, rank: 6 },
      reversed: true,
    },
  ])(
    `a refetch reports a page whose end moves earlier $name`,
    async ({ initial, arrival, reversed }) => {
      type Row = { id: number; rank?: number }
      const backend: Array<Row> = [...initial]
      const queryClient = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      const items = createCollection(
        queryCollectionOptions<Row>({
          id: `refetch-ordered-prefix-unranked-${collectionSequence++}`,
          queryClient,
          queryKey: [`unranked`],
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          queryFn: (ctx) => {
            const options = ctx.meta?.loadSubsetOptions as LoadSubsetOptions
            const offset = options.offset ?? 0
            const page = [...backend]
              .sort(
                (a, b) =>
                  (b.rank ?? -Infinity) - (a.rank ?? -Infinity) || a.id - b.id,
              )
              .slice(offset, offset + options.limit!)
            return reversed ? page.reverse() : page
          },
        }),
      )
      let reports = 0
      items.on(`loadedSubsets:invalidated`, () => {
        reports++
      })
      const orderBy: Array<IR.OrderByClause> = [
        {
          expression: new IR.PropRef([`rank`]),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
            stringSort: `lexical`,
          },
        },
      ]
      try {
        items.startSyncImmediate()
        await items._sync.loadSubset({ orderBy, limit: 2 })
        expect(items.toArray.map((row) => row.id).sort()).toEqual([0, 1])
        backend.push(arrival)
        await items.utils.refetch()
        await settle()
        expect(reports).toBe(1)
      } finally {
        await items.cleanup()
        queryClient.clear()
      }
    },
  )

  it(`a refetch settles when the provider honors neither cursor nor offset`, async () => {
    const run = await startRun({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 1,
        offset: 0,
      },
      // With one order term the fixture rank is `rank * 100 + id`: 3, 2, 1, 0.
      initial: [3, 2, 1, 0].map((id) => ({ id, rank: 0, marked: id === 0 })),
      history: [],
    })
    try {
      expect(run.requests.some((options) => options.cursor)).toBe(true)
      run.setEncoding(`ignore`)
      await run.apply({ type: `upsert`, id: 4, rank: 0 })
      await withDeadline(run.apply({ type: `refetch` }))
      const settled = run.requests.length
      await settle()
      expect(run.requests).toHaveLength(settled)
    } finally {
      await run.cleanup()
    }
  })

  // Fault injection. The refetch's own page requests succeed, but every later
  // request, which is the read that repairs the window, fails. The window
  // shows no other result than its last one or the right one, and the refetch
  // starts no full-source request. Once the provider recovers, the loader's
  // automatic retry restores it.
  it.each([`cursor`, `offset`] as const)(
    `keeps the last window when the repair fails, and the retry restores it (%s encoding)`,
    async (encoding) => {
      const testCase: Case = {
        scenario: {
          encoding,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `upsert`, id: 6, rank: 0 },
        ],
      }
      const run = await startRun(testCase)
      const loggedError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})
      try {
        for (const command of testCase.history) await run.apply(command)
        const before = run.windowIds()
        const requestsBefore = run.requests.length
        // Let each tracked Query refetch once, then fail everything after.
        run.failAfter(run.cachedQueries())
        await run.apply({ type: `refetch` })
        // A failed repair publishes no other window: the result is the last
        // window, or the right one when the refetched pages alone fix it, as
        // they do for a provider that honors only the offset.
        const expected = expectedWindow(
          run.backend,
          run.markers,
          testCase.scenario,
        )
        expect([before, expected]).toContainEqual(run.windowIds())
        expect(
          run.requests
            .slice(requestsBefore)
            .some(
              (options) =>
                options.where === undefined &&
                options.orderBy === undefined &&
                options.limit === undefined &&
                options.cursor === undefined,
            ),
        ).toBe(false)
        // The provider recovers; the loader's automatic retry (250 ms, then
        // 500 ms) restores the window.
        run.failAfter(undefined)
        await new Promise((resolve) => setTimeout(resolve, 900))
        await settle()
        expect(run.windowIds()).toEqual(
          expectedWindow(run.backend, run.markers, testCase.scenario),
        )
      } finally {
        loggedError.mockRestore()
        await run.cleanup()
      }
    },
  )

  // Known loader defects outside #2136. These witnesses fail today and
  // reproduce on main; `it.fails` turns green work into a red signal once the
  // ordered loader is fixed, so the limits above can be removed.
  it.fails(
    `an offset-only provider fills a joined window at preload (known loader defect)`,
    async () => {
      const run = await startRun({
        scenario: {
          encoding: `offset`,
          functionKey: false,
          orderKey: `rank`,
          pageCap: undefined,
          terms: 1,
          limit: 1,
          offset: 0,
        },
        initial: [
          { id: 0, rank: 0, marked: true },
          { id: 1, rank: 0, marked: false },
          { id: 2, rank: 0, marked: false },
        ],
        history: [],
      })
      try {
        expect(run.windowIds()).toEqual([0])
      } finally {
        await run.cleanup()
      }
    },
  )

  // This trace was a known defect: after a joined-side removal the loader
  // stopped refilling. A repair's retirement removed a row the loader had
  // sent, which discarded the repair's boundary, and paging restarted from
  // the start of the order. It now passes.
  it(`a current provider refills a joined window after a marker removal`, async () => {
    const testCase: Case = {
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 2,
        offset: 0,
      },
      initial: [
        { id: 5, rank: 2, marked: true },
        { id: 1, rank: 2, marked: false },
        { id: 3, rank: 2, marked: false },
      ],
      history: [
        { type: `flip`, id: 2 },
        { type: `upsert`, id: 7, rank: 5 },
        { type: `delete`, id: 1 },
        { type: `refetch` },
        { type: `flip`, id: 1 },
        { type: `flip`, id: 7 },
        { type: `upsert`, id: 1, rank: 1 },
        { type: `upsert`, id: 2, rank: 0 },
        { type: `upsert`, id: 6, rank: 1 },
        { type: `upsert`, id: 7, rank: 3 },
        { type: `flip`, id: 2 },
        { type: `refetch` },
        // The provider is current here; removing 7's marker must refill.
        { type: `flip`, id: 7 },
      ],
    }
    const run = await startRun(testCase)
    try {
      for (const command of testCase.history) await run.apply(command)
      expect(run.windowIds()).toEqual(
        expectedWindow(run.backend, run.markers, testCase.scenario),
      )
    } finally {
      await run.cleanup()
    }
  })

  it.fails(
    `a capped provider keeps a moved row in the window after a refetch (known loader defect)`,
    async () => {
      await checkCase({
        scenario: {
          encoding: `cursor`,
          functionKey: false,
          orderKey: `rank`,
          pageCap: 2,
          terms: 1,
          limit: 2,
          offset: 1,
        },
        initial: [
          { id: 0, rank: 1, marked: true },
          { id: 1, rank: 0, marked: false },
        ],
        history: [
          { type: `flip`, id: 7 },
          { type: `upsert`, id: 2, rank: 1 },
          { type: `upsert`, id: 7, rank: 0 },
          { type: `refetch` },
          { type: `delete`, id: 3 },
          { type: `invalidate` },
          { type: `upsert`, id: 3, rank: 1 },
          { type: `upsert`, id: 0, rank: 0 },
        ],
      })
    },
  )

  // Found by the random campaign. A peer query loads row 0's new rank, which
  // starts the loader's own repair. Finishing that repair releases the old
  // tie request, and Query DB removes row 2, which only that request held.
  // The repair still holds every row through its boundary, so that removal
  // must not discard the boundary. When it did, the next marker flip read a
  // new, smaller first page that could not retire the repair's prefix, and
  // every later refetch of an unchanged backend read both.
  it(`a repair that releases another request's row keeps one first page`, async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        terms: 1,
        orderKey: `rank`,
        pageCap: undefined,
        limit: 2,
        offset: 0,
      },
      initial: [
        { id: 1, rank: 0, marked: true },
        { id: 0, rank: 1, marked: true },
        { id: 2, rank: 0, marked: false },
      ],
      history: [
        { type: `upsert`, id: 0, rank: 2 },
        { type: `upsert`, id: 1, rank: 1 },
        { type: `observe`, id: 0 },
        { type: `invalidate` },
        { type: `delete`, id: 2 },
        { type: `upsert`, id: 3, rank: 0 },
        { type: `refetch` },
        { type: `flip`, id: 0 },
        { type: `delete`, id: 4 },
      ],
    })
  })

  // Found by the random campaign at four times the run count. A report's
  // repair at step 10 releases the old tie and continuation Queries, so rows
  // 0, 1 and 2 leave the Collection. Removing 7's marker then leaves a short
  // window. Its continuation pages reacquire those Queries, which Query DB
  // answers synchronously from its cache. The loader must keep paging after
  // each such answer: if it stops, row 0 is never loaded, although a short
  // window treats every row as read. Only the coverage law sees that.
  it(`a short window keeps paging through Queries answered from the cache`, async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        terms: 1,
        orderKey: `rank`,
        pageCap: undefined,
        limit: 2,
        offset: 0,
      },
      initial: [
        { id: 0, rank: 0, marked: false },
        { id: 1, rank: 0, marked: true },
      ],
      history: [
        { type: `upsert`, id: 0, rank: 0 },
        { type: `flip`, id: 7 },
        { type: `invalidate` },
        { type: `upsert`, id: 2, rank: 0 },
        { type: `refetch` },
        { type: `flip`, id: 1 },
        { type: `flip`, id: 3 },
        { type: `upsert`, id: 7, rank: 0 },
        { type: `invalidate` },
        { type: `upsert`, id: 3, rank: 3 },
        { type: `refetch` },
        { type: `flip`, id: 7 },
        { type: `upsert`, id: 3, rank: 3 },
        { type: `refetch` },
      ],
    })
  })

  // A refetch while an optimistic delete persists. The delete is visible, so
  // the loader repairs; that repair's rows and the refetch's rows are held
  // back behind the delete. After the release, removing row 1's marker must
  // page past rows the repair released. Query DB answers those pages from
  // its cache synchronously, and the loader used to stop after one: it
  // treated rows 2 and 7 as loaded, and the window showed [3, 0] instead of
  // [3, 2]. That reproduced with this oracle's report and overlap changes
  // reverted; the fix that resumes a continuation after a synchronous answer
  // closed it. The generated grammar now holds deletes too.
  it(`a refetch during a held optimistic delete keeps the window right after release`, async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        orderKey: `rank`,
        pageCap: undefined,
        terms: 1,
        limit: 2,
        offset: 0,
      },
      initial: [
        { id: 1, rank: 2, marked: true },
        { id: 7, rank: 1, marked: true },
        { id: 0, rank: 0, marked: true },
        { id: 2, rank: 1, marked: true },
        { id: 3, rank: 1, marked: true },
      ],
      history: [
        { type: `observe`, id: 0 },
        { type: `upsert`, id: 7, rank: 0 },
        { type: `hold`, kind: `delete`, id: 0 },
        { type: `refetch` },
        { type: `release` },
        { type: `flip`, id: 1 },
        { type: `hold`, kind: `update`, id: 0 },
        { type: `release` },
      ],
    })
  })

  // Found by the random campaign. A Query invalidation lets another consumer
  // observe row 1 before the backend deletes it, and the final refetch applies
  // while an optimistic update holds source publication back. The public law
  // is unchanged: after release, the ordered window equals the pure backend
  // window, regardless of which consumer previously observed a deleted row.
  it(`a held refetch removes a deleted row owned by an observed query`, async () => {
    await checkCase({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        terms: 1,
        orderKey: `rank`,
        pageCap: undefined,
        limit: 1,
        offset: 1,
      },
      initial: [
        { id: 1, rank: 0, marked: true },
        { id: 0, rank: 0, marked: false },
      ],
      history: [
        { type: `hold`, kind: `update`, id: 0 },
        { type: `upsert`, id: 2, rank: 0 },
        { type: `refetch` },
        { type: `release` },
        { type: `flip`, id: 0 },
        { type: `upsert`, id: 0, rank: 1 },
        { type: `observe`, id: 1 },
        { type: `invalidate` },
        { type: `delete`, id: 1 },
        { type: `hold`, kind: `update`, id: 0 },
        { type: `refetch` },
        { type: `release` },
      ],
    })
  })

  // The premise-directed campaign for the skip under a hold. Its reach
  // witness requires refetches that report while a hold is running.
  it.skipIf(oracleReplayRequested())(
    `generated refetch histories under a hold (fixed campaign)`,
    async () => {
      let reachedReport = 0
      await fc.assert(
        fc.asyncProperty(heldCaseArbitrary, async (testCase) => {
          const observation = await withDeadline(checkCase(testCase))
          if (observation.reachedReportDuringHold) reachedReport++
        }),
        { seed: 20261015, numRuns: oracleRuns(40) },
      )
      expect(reachedReport).toBeGreaterThan(0)
    },
    120_000,
  )

  it.each(campaigns)(
    `generated refetch histories (%s campaign)`,
    async (campaign) => {
      let reached = 0
      let reachedDuringHold = 0
      await fc.assert(
        fc.asyncProperty(caseArbitrary, async (testCase) => {
          const observation = await withDeadline(checkCase(testCase))
          if (observation.reachedLaggingRefetchAfterContinuation) reached++
          if (observation.reachedLaggingRefetchDuringHold) reachedDuringHold++
        }),
        campaign === `fixed`
          ? { seed: 20261013, numRuns: oracleRuns(80) }
          : oraclePropertyOptions(80, property),
      )
      // Positive reach witness: generated histories serve continuation pages
      // before a refetch, which is the premise of the gap.
      if (campaign !== `replay`) {
        expect(reached).toBeGreaterThan(0)
        expect(reachedDuringHold).toBeGreaterThan(0)
      }
    },
    120_000,
  )
})
