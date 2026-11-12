import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import {
  isGeneratedOracleCampaign,
  oracleProperty,
  oracleReplayRequested,
} from '../../db/tests/oracle-config.js'
import {
  observeComparison,
  recordedComparison,
} from '../../db/tests/query/ordered-comparison-oracle.js'
import { settle } from './refetch-ordered-prefix-support'
import {
  pageEndStructuralHistories,
  pageEndStructuralStates,
} from './refetch-ordered-prefix-grammar-oracle'
import {
  checkCase,
  expectedWindow,
  startRun,
  withDeadline,
} from './refetch-ordered-prefix-driver-oracle'
import type {
  Case,
  Command,
  Observation,
  Scenario,
} from './refetch-ordered-prefix-driver-oracle'

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
 *   changed its key membership or moved its end earlier in that step. Any
 *   step can meet it. A `loadSubset` call can acquire a released page whose
 *   Query an invalidation marked stale; the call settles on the cached rows,
 *   and Query then refetches the page on its own, which is a refetch the
 *   loader must hear about.
 * - A step reports at most once, including any report its repair could
 *   cause. A report says only that pages may have shifted, so a second one
 *   in the same step would repeat the repair for nothing.
 * - A refetch or invalidation of an unchanged backend never reports.
 * - A page whose key membership and leading-order end stay unchanged never
 *   reports for unrelated payload edits. A full page that only loses rows
 *   and ends at or after its old end keeps its prefix. With no
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
 *   open in the coverage map. The named fixed histories still run both encodings.
 * - It does not check the window after a marker flip, even when the provider
 *   is current. The loader used to stop refilling after a joined-side
 *   removal; a named fixed history now checks that trace, but the campaigns do not
 *   check after flips.
 * - The generated campaigns use an uncapped provider. With a provider that
 *   caps pages, a row whose order changes can drop out of the window after a
 *   refetch even on main, through the loader's own repair. That defect is
 *   separate from #2136 and has an `it.fails` witness. The named fixed histories run
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
 *   The application-failure fixed history checks only the window around a failed
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

// ## History grammar
//
// - `label` changes only a backend label. Under numeric order it is a
//   payload edit, so the report-work comparison must reject a report caused
//   only by that edit. Source coverage still compares its complete value.
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
// row. Named fixed histories use the same commands in other orders. With one order
// term, the fixture maps a generated rank to `rank * 100 + id`, so ranks stay
// unique.
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
    // Page caps run in named fixed histories only; see the limits above.
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

// Construct two finite pages with an unmarked source, so the joined window
// reads past both. The last row of the second page moves earlier without
// changing that page's keys. A fresh row strictly between its old and new end
// is in neither autonomous answer. A delete hold on that boundary row hides
// its visible order update. The shared source-coverage law must see the gap
// after release. Width, offset, key form, order arity, refresh path, row IDs,
// and the gap vary; label-only edits are negative controls for report rarity.
// Numeric order admits finite continuation. The general grammar keeps locale
// order, which instead takes the documented full-source path.
type PageEndInput = {
  terms: 1 | 2
  functionKey: boolean
  refresh: `refetch` | `invalidate`
  gapRank: number
  limit: number
  offset: number
  firstId: number
}

function pageEndCase(
  input: PageEndInput,
  hold: `delete` | `update` | `other-delete` | undefined,
  direction: `earlier` | `later` = `earlier`,
): Case {
  const { terms, functionKey, refresh, gapRank, limit, offset, firstId } = input
  const size = 2 * limit + offset
  const boundary = firstId
  const gap = firstId + size
  return {
    scenario: {
      encoding: `cursor`,
      functionKey,
      terms,
      orderKey: `rank`,
      pageCap: undefined,
      limit,
      offset,
    },
    initial: Array.from({ length: size }, (_, index) => ({
      id: firstId + index,
      rank: index === 0 ? 0 : index < limit ? 6 + index : 20 + index,
      marked: false,
    })),
    history: [
      // A non-order field can change without moving a page or its boundary.
      { type: `label`, id: boundary, label: `payload before hold` },
      { type: refresh },
      ...(hold === undefined
        ? []
        : [
            {
              type: `hold` as const,
              kind: hold === `other-delete` ? (`delete` as const) : hold,
              id: hold === `other-delete` ? firstId + limit : boundary,
            },
          ]),
      { type: `invalidate` },
      { type: `upsert`, id: boundary, rank: direction === `earlier` ? 4 : -1 },
      ...(direction === `earlier`
        ? [{ type: `upsert` as const, id: gap, rank: gapRank }]
        : []),
      { type: refresh },
      { type: `release` },
      { type: `label`, id: gap, label: `payload after release` },
      { type: refresh },
    ],
  }
}

const sameKeyEndInputArbitrary: fc.Arbitrary<PageEndInput> = fc.record({
  terms: fc.constantFrom(1 as const, 2 as const),
  functionKey: fc.boolean(),
  refresh: fc.constantFrom(`refetch` as const, `invalidate` as const),
  gapRank: fc.integer({ min: 1, max: 3 }),
  limit: fc.integer({ min: 1, max: 3 }),
  offset: fc.integer({ min: 0, max: 1 }),
  firstId: fc.integer({ min: 0, max: 16 }),
})
const sameKeyEndCaseArbitrary = sameKeyEndInputArbitrary.map((input) =>
  pageEndCase(input, `delete`),
)

// ## Named fixed histories
//
// Each history below is a regression or a contract example. It runs through
// the generated campaigns' driver and comparison (`checkCase`), and the model
// computes every expected window and source prefix. The generated grammar
// cannot produce these histories: its ids stay below 8, it caps no pages,
// it uses only the cursor encoding, and it composes rounds through a map that
// fast-check cannot invert. A history may also name a premise that it must
// reach (`laggingRefetchAfterContinuation`), or the report count that its
// contract comment fixes (`reports`).
type FixedHistory = {
  name: string
  testCase: Case
  laggingRefetchAfterContinuation?: true
  reports?: number
}

const encodings = [`cursor`, `offset`] as const

const fixedHistories: Array<FixedHistory> = [
  // The issue's trace (rank desc, limit 2). Removing rank 10's marker makes
  // the loader serve a continuation after rank 4. The backend then gains
  // rank 5 (marked) and rank 6 (unmarked). The refetched first page ends at
  // 6, the continuation still starts after 4, and rank 5 is in neither.
  ...encodings.map((encoding): FixedHistory => ({
    name: `shows a row that moved between two served pages after a refetch (${encoding} encoding)`,
    testCase: {
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
    },
    laggingRefetchAfterContinuation: true,
  })),

  // The issue's trace with rank 5 left unmarked. The window over the backend
  // is still [4, 1], so the window law passes even when rank 5 is in no
  // served page. The loader still treats rank 5 as loaded, because it sorts
  // before the window's end; marking it later would never load it. Only the
  // coverage law sees this gap while it is latent.
  ...encodings.map((encoding): FixedHistory => ({
    name: `loads a row that moved between two served pages before it joins the window (${encoding} encoding)`,
    testCase: {
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
    },
    laggingRefetchAfterContinuation: true,
  })),

  // The issue's trace with a provider that returns one row per request. A
  // short reply does not end the order, so the repair must keep reading.
  ...encodings.map((encoding): FixedHistory => ({
    name: `shows a moved row after a refetch when the provider caps pages (${encoding} encoding)`,
    testCase: {
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
    },
    laggingRefetchAfterContinuation: true,
  })),

  // Fracture scan witness. A second live query loads row 6 before the
  // refetch, so the refetched first page changes while no Collection row
  // does. A design that waits for a changed Collection row misses the gap.
  ...encodings.map((encoding): FixedHistory => ({
    name: `shows a moved row when another live query loaded the page's new row first (${encoding} encoding)`,
    testCase: {
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
    },
    laggingRefetchAfterContinuation: true,
  })),

  // Without a hold, a page that keeps its keys also reaches the loader as
  // an order-change update. The held histories below distinguish that path:
  // accepted rows remain private, so the adapter must report the earlier end
  // even while a deleted row hides its own order change.
  ...encodings.map((encoding): FixedHistory => ({
    name: `repairs when a page keeps its keys but its last row moves (${encoding} encoding)`,
    testCase: {
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
    },
  })),

  // A page with no later page whose end moves earlier in the order. Rows that
  // arrive ahead of the page push its old last row out, but a tie request
  // still holds that row, so the loader sees no delete and still treats rows
  // through the old boundary as loaded. A new row that ties at the page's new
  // end sorts before that boundary and is in neither result. (Found by the
  // ordered-work oracle's refetch-then-signal provider.)
  ...encodings.map((encoding): FixedHistory => ({
    name: `shows a row that ties at a page's new, earlier end (${encoding} encoding)`,
    testCase: {
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
    },
  })),

  // A filtered one-page window whose page end moves earlier, with unique
  // order values. Row 4 arrives ahead of the page without a marker, so the
  // window needs a row past the page; row 3 now sorts between the page's
  // new end and the loader's old boundary and is in neither result.
  // (Found by the random campaign.)
  {
    name: `shows a row that lands between a filtered page's new and old end`,
    testCase: {
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
    },
  },

  // A changed first page whose only later page is empty. The empty
  // continuation still starts where the first page used to end, so a row
  // that now sorts between them is in neither result.
  {
    name: `shows a row that moved before an empty later page`,
    testCase: {
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
    },
  },

  // The issue's trace again, but the pages refetch through a Query
  // invalidation instead of `utils.refetch()`. Each page refetches alone, so
  // each must read its own served prefix.
  ...encodings.map((encoding): FixedHistory => ({
    name: `shows a row that moved between two served pages after a Query invalidation (${encoding} encoding)`,
    testCase: {
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
    },
    laggingRefetchAfterContinuation: true,
  })),

  // A second refetch must still cover the first served boundary. The first
  // refetch inserts rows ahead of it; the backend then gains a row between
  // the new and old ends, which the second refetch must deliver.
  ...encodings.map((encoding): FixedHistory => ({
    name: `a second refetch still covers the first served boundary (${encoding} encoding)`,
    testCase: {
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
    },
    laggingRefetchAfterContinuation: true,
  })),

  // A provider that honors neither encoding returns the same page for every
  // continuation. That breaks the request contract, but a refetch must still
  // settle, and the loader must not keep requesting.
  // Pages that keep their start and end at or after their old end, with no
  // later page: no row can fall outside them, so no refetch reports. The
  // delete is visible, so the loader repairs through its own path.
  ...[
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
  ].map(({ name, initial, history }): FixedHistory => ({
    name: `a refetch does not report when ${name}`,
    testCase: {
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
    },
    reports: 0,
  })),

  // Found by the random campaign. A peer query loads row 0's new rank, which
  // starts the loader's own repair. Finishing that repair releases the old
  // tie request, and Query DB removes row 2, which only that request held.
  // The repair still holds every row through its boundary, so that removal
  // must not discard the boundary. When it did, the next marker flip read a
  // new, smaller first page that could not retire the repair's prefix, and
  // every later refetch of an unchanged backend read both.
  {
    name: `a repair that releases another request's row keeps one first page`,
    testCase: {
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
    },
  },

  // Found by the random campaign at four times the run count. A report's
  // repair at step 10 releases the old tie and continuation Queries, so rows
  // 0, 1 and 2 leave the Collection. Removing 7's marker then leaves a short
  // window. Its continuation pages reacquire those Queries, which Query DB
  // answers synchronously from its cache. The loader must keep paging after
  // each such answer: if it stops, row 0 is never loaded, although a short
  // window treats every row as read. Only the coverage law sees that.
  {
    name: `a short window keeps paging through Queries answered from the cache`,
    testCase: {
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
    },
  },

  // A refetch while an optimistic delete persists. The delete is visible, so
  // the loader repairs; that repair's rows and the refetch's rows are held
  // back behind the delete. After the release, removing row 1's marker must
  // page past rows the repair released. Query DB answers those pages from
  // its cache synchronously, and the loader used to stop after one: it
  // treated rows 2 and 7 as loaded, and the window showed [3, 0] instead of
  // [3, 2]. That reproduced with this oracle's report and overlap changes
  // reverted; the fix that resumes a continuation after a synchronous answer
  // closed it. The generated grammar now holds deletes too.
  {
    name: `a refetch during a held optimistic delete keeps the window right after release`,
    testCase: {
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
    },
  },

  // Found by the random campaign. A Query invalidation lets another consumer
  // observe row 1 before the backend deletes it, and the final refetch applies
  // while an optimistic update holds source publication back. The public law
  // is unchanged: after release, the ordered window equals the pure backend
  // window, regardless of which consumer previously observed a deleted row.
  {
    name: `a held refetch removes a deleted row owned by an observed query`,
    testCase: {
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
    },
  },

  // This is the exact reduced CI history. It has no separate expected
  // answer: both the window and latent coverage use the shared model.
  {
    name: `keeps coverage when a held page keeps its key and moves earlier`,
    testCase: {
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        terms: 1,
        orderKey: `rank`,
        pageCap: undefined,
        limit: 1,
        offset: 0,
      },
      initial: [
        { id: 1, rank: 5, marked: false },
        { id: 0, rank: 0, marked: false },
      ],
      history: [
        { type: `hold`, kind: `delete`, id: 0 },
        { type: `upsert`, id: 0, rank: 0 },
        { type: `invalidate` },
        { type: `upsert`, id: 0, rank: 1 },
        { type: `upsert`, id: 2, rank: 0 },
        { type: `refetch` },
        { type: `release` },
        { type: `upsert`, id: 0, rank: 0 },
        { type: `refetch` },
      ],
    },
  },
]

// Each fixed history runs the shared driver and comparison. A premise or
// report count that the history names is checked after the comparison.
async function runFixedHistory(history: FixedHistory): Promise<void> {
  const observation = await checkCase(history.testCase)
  if (history.laggingRefetchAfterContinuation)
    expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
  if (history.reports !== undefined)
    expect(observation.reports).toBe(history.reports)
}

// ## Named fixed procedures
//
// These histories need steps that the command language does not name: an
// optimistic update held across specific applies, the requests that one
// refetch starts, a failed change application, a provider that breaks the
// request contract, or provider failures after a given request. Each runs the
// production driver (`startRun`) and compares the public window with the
// model (`expectedWindow`), or checks the law that its comment states.
type FixedProcedure =
  | { name: string; procedure: `held update between page ends` }
  | { name: string; procedure: `bounded reproof`; terms: 1 | 2 }
  | { name: string; procedure: `failed page application` }
  | { name: string; procedure: `provider ignores both encodings` }
  | {
      name: string
      procedure: `failed repair and retry`
      encoding: `cursor` | `offset`
    }
  | { name: string; procedure: `current provider refill` }

const fixedProcedures: Array<FixedProcedure> = [
  {
    name: `shows a row that lands between a page's new and old end while an optimistic update persists`,
    procedure: `held update between page ends`,
  },
  ...([1, 2] as const).map((terms): FixedProcedure => ({
    name: `a refetch that moves a first page's end proves the window again with bounded reads (${terms} order terms)`,
    procedure: `bounded reproof`,
    terms,
  })),
  {
    name: `a refetch whose page application fails keeps the last window until the next refetch`,
    procedure: `failed page application`,
  },
  {
    name: `a refetch settles when the provider honors neither cursor nor offset`,
    procedure: `provider ignores both encodings`,
  },
  ...encodings.map((encoding): FixedProcedure => ({
    name: `keeps the last window when the repair fails, and the retry restores it (${encoding} encoding)`,
    procedure: `failed repair and retry`,
    encoding,
  })),
  {
    name: `a current provider refills a joined window after a marker removal`,
    procedure: `current provider refill`,
  },
]

// The same shape as the filtered page-end history while an optimistic update
// persists. The Collection
// accepts the refetched rows at once but holds them back until the update
// settles, so the report arrives while the old rows are still visible.
// Other live queries hold rows 0, 1 and 2, so row 0 stays after it leaves
// the page and no delete starts the loader's own repair. Once the rows
// apply, unmarked row 4 heads the page and row 3 sorts between it and
// row 0; only a repair after the rows become visible can load row 3.
async function runHeldUpdateBetweenPageEnds(): Promise<void> {
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
}

// The ordinary insert into a top-N list. The page's end moves earlier, so
// Query DB reports, but every window row is in the window's own first page.
// The tie the loader read belongs to the old end, so its rows prove
// nothing about rows that tie with the new end. The loader proves the
// window again with bounded reads (a repair, or the new end's tie; the
// shape is the loader's choice), reads nothing unbounded, and retires the
// requests it replaces, so the Query count stays the same.
async function runBoundedReproof(terms: 1 | 2): Promise<void> {
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
    const activeBefore = run.activeQueries()
    const requestsBefore = run.requests.length
    await run.apply({ type: `refetch` })
    expect(run.windowIds()).toEqual(
      expectedWindow(run.backend, run.markers, scenario),
    )
    const extra = run.requests.slice(requestsBefore + queries)
    expect(extra.length).toBeGreaterThan(0)
    // Every read is bounded: an ordered prefix with a limit, or a tie
    // that reads equal leading values. None reads the full source.
    for (const request of extra) {
      expect(request.limit !== undefined || request.where !== undefined).toBe(
        true,
      )
    }
    expect(run.activeQueries()).toBe(activeBefore)
  } catch (error) {
    primary = error
  }
  const failures = await run.cleanup()
  if (primary !== undefined) throw primary
  expect(failures).toEqual([])
}

// A change subscriber throws while the refetched first page commits, so
// that page's rows do not apply. The window then shows its last result or
// the right one, and the next refetch must restore it.
async function runFailedPageApplication(): Promise<void> {
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
}

// A provider that honors neither encoding returns the same page for every
// continuation. That breaks the request contract, but a refetch must still
// settle, and the loader must not keep requesting.
async function runProviderIgnoringBothEncodings(): Promise<void> {
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
}

// Fault injection. The refetch's own page requests succeed, but every later
// request, which is the read that repairs the window, fails. The window
// shows no other result than its last one or the right one, and the refetch
// starts no full-source request. Once the provider recovers, the loader's
// automatic retry restores it.
async function runFailedRepairAndRetry(
  encoding: `cursor` | `offset`,
): Promise<void> {
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
  const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
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
    const expected = expectedWindow(run.backend, run.markers, testCase.scenario)
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
}

// This trace was a known defect: after a joined-side removal the loader
// stopped refilling. A repair's retirement removed a row the loader had
// sent, which discarded the repair's boundary, and paging restarted from
// the start of the order. It now passes.
async function runCurrentProviderRefill(): Promise<void> {
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
}

async function runFixedProcedure(history: FixedProcedure): Promise<void> {
  switch (history.procedure) {
    case `held update between page ends`:
      return runHeldUpdateBetweenPageEnds()
    case `bounded reproof`:
      return runBoundedReproof(history.terms)
    case `failed page application`:
      return runFailedPageApplication()
    case `provider ignores both encodings`:
      return runProviderIgnoringBothEncodings()
    case `failed repair and retry`:
      return runFailedRepairAndRetry(history.encoding)
    case `current provider refill`:
      return runCurrentProviderRefill()
  }
}

const property = `query-db.refetch-ordered-prefix`

describe(`query-db on-demand refetch keeps served ordered prefixes whole`, () => {
  // The named fixed histories and procedures replay the generated
  // campaign's law through the same driver and comparison.
  oracleProperty({
    id: `query-db.refetch-ordered-prefix-fixed`,
    law: {
      statement: `After refetch and Query invalidation settle, the public window and source prefix match the current backend rows.`,
      authority: `LoadSubset contract and query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Named regressions that the generated command grammar cannot produce; each is replayed through the same driver and comparison.`,
    },
    owns: [`src/query.ts#queryCollectionOptions`],
    histories: fixedHistories,
    label: ({ name }) => name,
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, () => runFixedHistory(history)),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `query-db.refetch-ordered-prefix-cases`,
    law: {
      statement: `After refetch and Query invalidation settle, the public window and source prefix match the current backend rows.`,
      authority: `LoadSubset contract and query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Named procedures with a held update, request counts, a failed change application, a contract-breaking provider, or provider failures, which the command grammar cannot express; each runs the same production driver and model.`,
    },
    owns: [`src/query.ts#queryCollectionOptions`],
    histories: fixedProcedures,
    label: ({ name }) => name,
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, () => runFixedProcedure(history)),
    check: (_history, _observations, verdict) => verdict,
  })

  const endProperty = `query-db.refetch-held-page-end`
  describe(`generated same-key page shifts`, () => {
    const states = [
      `earlier end during hold`,
      `delete-held gap reported and repaired`,
    ] as const
    let counts = new Map<(typeof states)[number], number>()
    beforeEach(() => {
      counts = new Map(states.map((state) => [state, 0]))
    })
    afterEach(({ task }) => {
      if (
        !isGeneratedOracleCampaign(task.name) ||
        task.result?.state === `fail` ||
        oracleReplayRequested()
      )
        return
      for (const state of states)
        expect(
          counts.get(state),
          `${state} history minimum`,
        ).toBeGreaterThanOrEqual(24)
      console.info(endProperty, task.name, Object.fromEntries(counts))
    })
    oracleProperty({
      id: endProperty,
      law: {
        statement: `A held page whose keys stay the same and end moves earlier preserves the refetched window and source prefix.`,
        authority: `LoadSubset contract and query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
        limits: `The existing controlled Query provider, bounded histories, and public window/source-prefix checkpoints; no new generator dimensions.`,
      },
      // What this oracle owns: the on-demand Query collection's refetch and the ordered
      // prefix it serves (queryCollectionOptions and the loader it builds).
      owns: [`src/query.ts#queryCollectionOptions`],
      histories: {
        arbitrary: sameKeyEndCaseArbitrary,
        runs: 24,
        fixedSeeds: [20261102],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const observation = await withDeadline(checkCase(history))
          if (observation.reachedSameKeyEarlierEndDuringHold)
            counts.set(
              `earlier end during hold`,
              counts.get(`earlier end during hold`)! + 1,
            )
          if (observation.reachedDeleteHeldGapReportAndRepair)
            counts.set(
              `delete-held gap reported and repaired`,
              counts.get(`delete-held gap reported and repaired`)! + 1,
            )
        }),
      check: (_history, _observations, verdict) => verdict,
      timeout: 120_000,
    })
  })

  // These widths and adjacent hold regimes cannot depend on a random seed.
  // Every case still uses the shared model, provider and public comparison.
  // At every width and offset, a delete hold whose boundary moves earlier
  // must reach the reported and repaired gap.
  oracleProperty({
    id: `query-db.refetch-held-page-end-structural`,
    law: {
      statement: `A held page whose keys stay the same and end moves earlier preserves the refetched window and source prefix.`,
      authority: `LoadSubset contract and query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `The 48 structural page-end histories: widths 1 to 3, offsets 0 and 1, a delete, update, other-row delete or no hold, and an earlier or later boundary, with two order terms, a function Query key and explicit refetches.`,
    },
    owns: [`src/query.ts#queryCollectionOptions`],
    histories: {
      enumerated: pageEndStructuralHistories,
      states: pageEndStructuralStates,
    },
    label: ({ limit, offset, hold, direction }) =>
      `same-key boundary shifts preserve coverage across widths and hold regimes: limit ${limit} offset ${offset} hold ${hold} ${direction}`,
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) => {
      const { limit, offset, hold, direction } = history
      let observation: Observation | undefined
      await observeComparison(history, observe, async () => {
        observation = await checkCase(
          pageEndCase(
            {
              limit,
              offset,
              terms: 2,
              functionKey: true,
              refresh: `refetch`,
              gapRank: 2,
              firstId: 3,
            },
            hold === `none` ? undefined : hold,
            direction,
          ),
        )
      })
      if (
        hold === `delete` &&
        direction === `earlier` &&
        observation!.reachedDeleteHeldGapReportAndRepair
      )
        observe(`reach`, `delete-held gap width ${limit} offset ${offset}`)
    },
    check: (_history, _observations, verdict) => verdict,
    timeout: 120_000,
  })

  // The premise-directed campaign for the skip under a hold. Its reach
  // witness requires refetches that report while a hold is running.
  describe(`generated refetch histories under a hold`, () => {
    let reachedReport = 0
    beforeEach(() => {
      reachedReport = 0
    })
    afterEach(({ task }) => {
      if (
        !isGeneratedOracleCampaign(task.name) ||
        task.result?.state === `fail` ||
        oracleReplayRequested()
      )
        return
      expect(
        reachedReport,
        `refetches that report during a hold`,
      ).toBeGreaterThan(0)
    })
    // Keep the original fixed 40-history campaign. Native registration also
    // supplies a fresh campaign over the same grammar and judgment.
    oracleProperty({
      id: `query-db.refetch-held-report`,
      law: {
        statement: `A refetch that reports while optimistic writes hold source rows preserves its source prefix after release.`,
        authority: `LoadSubset contract and query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
        limits: `The existing controlled Query provider, bounded histories, and public window/source-prefix checkpoints; no new generator dimensions.`,
      },
      owns: [`src/query.ts#queryCollectionOptions`],
      histories: {
        arbitrary: heldCaseArbitrary,
        runs: 40,
        fixedSeeds: [20261015],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const observation = await withDeadline(checkCase(history))
          if (observation.reachedReportDuringHold) reachedReport++
        }),
      check: (_history, _observations, verdict) => verdict,
      timeout: 120_000,
    })
  })

  describe(`generated refetch histories`, () => {
    // These are the unchanged premises of the gap and the loader's report skip.
    const states = [
      `reachedLaggingRefetchAfterContinuation`,
      `reachedLaggingRefetchDuringHold`,
      `reachedReportOverFullWindow`,
    ] as const
    let counts = new Map<(typeof states)[number], number>()
    beforeEach(() => {
      counts = new Map(states.map((state) => [state, 0]))
    })
    afterEach(({ task }) => {
      if (
        !isGeneratedOracleCampaign(task.name) ||
        task.result?.state === `fail` ||
        oracleReplayRequested()
      )
        return
      for (const state of states)
        expect(
          counts.get(state),
          `${state} history minimum`,
        ).toBeGreaterThanOrEqual(3)
      console.info(property, task.name, Object.fromEntries(counts))
    })
    oracleProperty({
      id: property,
      law: {
        statement: `After refetch and Query invalidation settle, the public window and source prefix match the current backend rows.`,
        authority: `LoadSubset contract and query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
        limits: `The existing controlled Query provider, bounded histories, and public window/source-prefix checkpoints; no new generator dimensions.`,
      },
      owns: [`src/query.ts#queryCollectionOptions`],
      histories: { arbitrary: caseArbitrary, runs: 80, fixedSeeds: [20261013] },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const observation = await withDeadline(checkCase(history))
          for (const state of states)
            if (observation[state]) counts.set(state, counts.get(state)! + 1)
        }),
      check: (_history, _observations, verdict) => verdict,
      timeout: 120_000,
    })
  })
})
