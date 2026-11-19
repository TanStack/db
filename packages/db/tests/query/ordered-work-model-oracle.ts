/**
 * Definitions of `ordered-work-oracle.property.test.ts`, moved unchanged so
 * that its grammar checks and checker calibrations in
 * `ordered-work-examples.test.ts`, which run no production, can read them:
 * the consumer-parity scenario grammar, the eager-window history grammar and
 * row model, and the optimistic-window case model and its violation check.
 * That oracle file states each law, its authority, and its limits. This
 * module registers no tests.
 */
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { compareAt } from './ordered-comparison-oracle.js'
import type { Row, Scenario } from './ordered-work-support.js'

// The fixed seed of the full-join campaign, which both the campaign and its
// reconstruction census sample.
export const FULL_JOIN_SEED = 2073

// Grammar for the generated consumer-parity law: zero to three middle rows,
// either marker eligibility for middle and last rows, equal versus distinct
// middle ranks, and both order directions. Every combination is legal and the
// exhaustive matrix reconstructs all 64 cells before random sampling. Removing
// middleCount loses empty and refill histories; removing either eligibility
// bit loses matched/underfilled alternatives; removing tied loses the leading
// tie boundary; removing direction loses descending continuation. Counts four
// and 40 are an adjacent fixed range probe and a larger stress probe below.
// Negative counts, duplicate row IDs, and directions other than asc/desc are
// invalid in this grammar.
// "Scenario" is a model-only input description, not a runtime demand state.
export const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  middleCount: fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const),
  middleEligible: fc.boolean(),
  lastEligible: fc.boolean(),
  tied: fc.boolean(),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
})

export const exhaustiveScenarios: ReadonlyArray<Scenario> = (
  [0, 1, 2, 3] as const
).flatMap((middleCount) =>
  [false, true].flatMap((middleEligible) =>
    [false, true].flatMap((lastEligible) =>
      [false, true].flatMap((tied) =>
        ([`asc`, `desc`] as const).map((direction) => ({
          middleCount,
          middleEligible,
          lastEligible,
          tied,
          direction,
        })),
      ),
    ),
  ),
)

export type EagerCommand =
  | { type: `upsert`; id: number; rank: number; eligible: boolean }
  | { type: `delete`; id: number }
  // Changes only the label, so a row outside the window enters the query's
  // input without changing which rows are eligible or their order.
  | { type: `touch`; id: number }
  // Changes only eligibility. The order value stays, so a joined plan sees
  // the row leave or return only through the join.
  | { type: `flip`; id: number }
  // Adds another marker to a row that already has one, so a join matches
  // the row more than once.
  | { type: `dup`; id: number }
  | { type: `delete-visible` }
  // A refetching provider re-runs every request it served and sends the
  // results; any other path skips it.
  | { type: `refetch` }
  // A holding provider answers its oldest held request; `drain` answers
  // every held request, including the ones answers start, until none is
  // left. Any other provider skips both. (Not the glossary's acquisition
  // release, which aborts and unloads.)
  | { type: `answer` }
  // Cleans up the peer while its loads may be held. Its acquisition
  // release aborts each held request and gives the adapter an unload.
  | { type: `release-peer` }
  | { type: `drain` }
  // Moves the first query's window with `setWindow`. The Effect and the peer
  // keep their windows.
  | { type: `move`; offset: number; limit: number }

export type EagerCase = {
  // How rows reach the source: sync writes to an eager source, local-only
  // direct writes, or an on-demand source whose provider serves each
  // request from the rows and installs only what it returns.
  path: `sync` | `local-only` | `on-demand`
  // How an on-demand provider delivers later changes. `forward` sends each
  // change to a row it sent, or to a row that matches a subset it served.
  // `refetch` sends nothing until a refetch, which keeps every served
  // ordered range whole: rows that now sort inside one arrive then, and rows
  // in no range leave. `refetch-signal` also waits for a refetch, but re-runs
  // each served request alone, as query-db-collection does, and then reports
  // `invalidateLoadedSubsets()` when any answer changed. Omitted means
  // `forward`.
  provider?: `forward` | `refetch` | `refetch-signal`
  // When an on-demand provider answers a load. `immediate` answers within
  // the request. `held` answers only at an `answer` or `drain` step, from the
  // rows at that moment, so live changes can arrive while a load is in flight.
  // Initial loads answer immediately. Omitted means `immediate`.
  latency?: `immediate` | `held`
  // What a holding provider does with an aborted or unloaded held request:
  // `cooperative` installs none of its rows and fulfills at once; `late`
  // cannot cancel it, so it answers it anyway. Omitted means `cooperative`.
  cancellation?: `cooperative` | `late`
  // A second live query over the same sources, with its own window: the
  // first `offset + limit + 1` rows. Its window law holds beside the first
  // query's, and the work laws, which count one consumer, do not apply.
  peer?: boolean
  // Where eligibility is decided: a predicate on the ordered source itself,
  // a JavaScript function filter, or a filter on a LEFT-joined marker, where
  // a marker admits its row (`joined`) or excludes it (`anti-joined`). The
  // last three drop rows only after the source's limit. `full-joined` keeps
  // every root row and adds a rootless row for each marker no root row
  // matches; deleting a matched root row leaves its marker behind.
  filter: `source` | `function` | `joined` | `anti-joined` | `full-joined`
  // How a joined plan changes a row's eligibility: by inserting or deleting
  // its marker, or by pointing the row's join key at a marker or at none.
  // A join-key change leaves the row's order value as it was.
  via?: `marker` | `link`
  indexed: boolean
  direction: `asc` | `desc`
  // Where null ranks sort, and a full join's rootless rows with them. The
  // index uses the same placement. Omitted means first, the default.
  nulls?: `first` | `last`
  // Filler rows sort after every domain row. Omitted means 200; a full-join
  // case may have none, so its window can reach the null group.
  fillers?: number
  // Full join only: markers whose id names no root row.
  orphans?: Array<number>
  terms: 1 | 2
  limit: number
  offset: number
  initial: Array<{ id: number; rank: number; eligible: boolean }>
  history: Array<EagerCommand>
}

export const EAGER_FILLER = 200

export function fillerRows(
  direction: `asc` | `desc`,
  count: number = EAGER_FILLER,
): Array<Row> {
  // Eligible rows that sort after every domain row, so a correct window never
  // needs them and a full rescan must deliver them.
  return Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    rank: direction === `asc` ? 100 + index : -100 - index,
    eligible: true,
    label: `filler`,
  }))
}

export function eagerRowOf(maxId: number) {
  return fc.record({
    id: fc.integer({ min: 0, max: maxId }),
    // NaN and null exercise comparator placement outside the integer order.
    rank: fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: 0, max: 15 }) },
      { weight: 1, arbitrary: fc.constant(Number.NaN) },
      { weight: 1, arbitrary: fc.constant(null as unknown as number) },
      { weight: 1, arbitrary: fc.constant(undefined as unknown as number) },
    ),
    eligible: fc.boolean(),
  })
}

export const eagerRow = eagerRowOf(29)

export function eagerHistory(
  flipWeight: number,
  maxId: number,
): fc.Arbitrary<Array<EagerCommand>> {
  return fc.array(
    fc.oneof(
      eagerRowOf(maxId).map((row) => ({ type: `upsert` as const, ...row })),
      fc.record({
        type: fc.constant(`delete` as const),
        id: fc.integer({ min: 0, max: maxId }),
      }),
      fc.record({
        type: fc.constant(`touch` as const),
        id: fc.integer({ min: 0, max: maxId }),
      }),
      {
        weight: flipWeight,
        arbitrary: fc.record({
          type: fc.constant(`flip` as const),
          id: fc.integer({ min: 0, max: maxId }),
        }),
      },
      fc.record({
        type: fc.constant(`dup` as const),
        id: fc.integer({ min: 0, max: maxId }),
      }),
      // Deletes the first visible row, so a repair runs on most histories.
      fc.constant({ type: `delete-visible` as const }),
      fc.constant({ type: `refetch` as const }),
      fc.constant({ type: `answer` as const }),
      fc.record({
        type: fc.constant(`move` as const),
        offset: fc.integer({ min: 0, max: 2 }),
        limit: fc.integer({ min: 1, max: 4 }),
      }),
    ),
    { minLength: 1, maxLength: 12 },
  )
}

// Every dimension, before the campaign exclusion below. Derived campaigns
// start from this and apply the exclusion after their own maps.
export const eagerCaseBase: fc.Arbitrary<EagerCase> = fc.record({
  path: fc.constantFrom(
    `sync` as const,
    `local-only` as const,
    `on-demand` as const,
  ),
  provider: fc.constantFrom(
    `forward` as const,
    `refetch` as const,
    `refetch-signal` as const,
  ),
  latency: fc.constantFrom(`immediate` as const, `held` as const),
  cancellation: fc.constantFrom(`cooperative` as const, `late` as const),
  // One case in four has a peer, so most cases keep the work laws.
  peer: fc.oneof(
    { weight: 3, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  filter: fc.constantFrom(
    `source` as const,
    `function` as const,
    `joined` as const,
    `anti-joined` as const,
    `full-joined` as const,
  ),
  via: fc.constantFrom(`marker` as const, `link` as const),
  indexed: fc.boolean(),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  nulls: fc.constantFrom(`first` as const, `last` as const),
  terms: fc.constantFrom(1 as const, 2 as const),
  limit: fc.integer({ min: 1, max: 3 }),
  offset: fc.integer({ min: 0, max: 1 }),
  initial: fc.uniqueArray(eagerRow, {
    selector: (row) => row.id,
    maxLength: 20,
  }),
  history: eagerHistory(1, 29),
})

// A peer over a refetching on-demand provider can keep a short joined window
// after a refetch (#2155). An indexed plan's trace is kept as a fixed history below,
// but an unindexed one still fails (a peer shows [100] where the model shows
// [100, 101]). Each campaign excludes only a joined, anti-joined, or full-joined
// filter in that pairing, as its last map, until the fix; a source filter
// keeps its peer.
export function withoutPeerRefetch(testCase: EagerCase): EagerCase {
  return testCase.path === `on-demand` &&
    (testCase.provider === `refetch` ||
      testCase.provider === `refetch-signal`) &&
    testCase.peer &&
    testCase.filter !== `source`
    ? { ...testCase, peer: false }
    : testCase
}

export const eagerCase = eagerCaseBase.map(withoutPeerRefetch)

// The premise of the joined-filter law: an indexed single-term plan whose
// filter drops rows after the bounded read.
// A repair before the gap forms reads the whole source for a joined plan, so
// no row can be missing afterwards. These histories therefore insert fresh
// keys (10 to 19), which can land past the bounded prefix, and change initial
// rows (0 to 9) mostly by eligibility alone, so a window row leaves only
// through the join.
export const eagerJoinedHistory: fc.Arbitrary<Array<EagerCommand>> = fc.array(
  fc.oneof(
    {
      weight: 2,
      // Ids 10 to 29: fresh rows, and the root rows of a full join's orphan
      // markers (20 to 29), so an orphan can become matched.
      arbitrary: eagerRowOf(19).map((row) => ({
        type: `upsert` as const,
        ...row,
        id: row.id + 10,
      })),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        type: fc.constant(`flip` as const),
        id: fc.integer({ min: 0, max: 9 }),
      }),
    },
    fc.record({
      type: fc.constant(`dup` as const),
      id: fc.integer({ min: 0, max: 9 }),
    }),
    fc.record({
      type: fc.constant(`touch` as const),
      id: fc.integer({ min: 0, max: 19 }),
    }),
    fc.record({
      type: fc.constant(`delete` as const),
      id: fc.integer({ min: 0, max: 19 }),
    }),
    fc.constant({ type: `delete-visible` as const }),
    fc.constant({ type: `refetch` as const }),
    fc.constant({ type: `answer` as const }),
    fc.record({
      type: fc.constant(`move` as const),
      offset: fc.integer({ min: 0, max: 2 }),
      limit: fc.integer({ min: 1, max: 4 }),
    }),
  ),
  { minLength: 1, maxLength: 8 },
)

// Its histories favor eligibility-only changes: a row inserted past the
// bounded prefix, then a window row leaving only through the join.
export const eagerJoinedCase: fc.Arbitrary<EagerCase> = fc
  .tuple(
    eagerCaseBase,
    fc.constantFrom(
      `joined` as const,
      `anti-joined` as const,
      `full-joined` as const,
    ),
    fc.uniqueArray(eagerRowOf(9), {
      selector: (row) => row.id,
      minLength: 4,
      maxLength: 8,
    }),
    eagerJoinedHistory,
  )
  .map(([testCase, filter, initial, history]) => ({
    ...testCase,
    filter,
    indexed: true,
    terms: 1 as const,
    initial,
    history,
  }))
  .map(withoutPeerRefetch)

// The law's premise directly: eligible rows at distinct ranks, so the bounded
// prefix leaves rows unsent; a fresh row that may land past the prefix; then
// an initial row changes eligibility alone, so it can leave the window only
// through the join. Random commands may follow.
export const gapRank: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 15 }) },
  { weight: 1, arbitrary: fc.constant(Number.NaN) },
  { weight: 1, arbitrary: fc.constant(null as unknown as number) },
  { weight: 1, arbitrary: fc.constant(undefined as unknown as number) },
)

export const eagerJoinedGapCase: fc.Arbitrary<EagerCase> = fc
  .record({
    base: eagerJoinedCase,
    // A null or NaN rank can end the bounded prefix. Neither is an
    // expressible cursor, so the loader takes its prefix fallback there.
    ranks: fc.uniqueArray(gapRank, {
      minLength: 4,
      maxLength: 8,
      selector: String,
    }),
    insertRank: gapRank,
    flipped: fc.nat(7),
    rest: eagerJoinedHistory,
  })
  .map(({ base, ranks, insertRank, flipped, rest }) => ({
    ...base,
    initial: ranks.map((rank, id) => ({ id, rank, eligible: true })),
    history: [
      { type: `upsert` as const, id: 10, rank: insertRank, eligible: true },
      { type: `flip` as const, id: flipped % ranks.length },
      ...rest,
    ],
  }))
  .map(withoutPeerRefetch)

// The full-join law's premise: a window that can reach the null group, where
// rootless rows and root rows with a null rank tie on the first order term.
// Cases favor no filler rows, so a few domain rows fill the window. Initial
// orphan markers (ids 20 to 29) start as rootless rows; root deletes and
// eligibility changes create and remove more.
export const eagerFullJoinCase: fc.Arbitrary<EagerCase> = fc
  .record({
    base: eagerCaseBase,
    fillers: fc.oneof(
      { weight: 3, arbitrary: fc.constant(0) },
      { weight: 1, arbitrary: fc.constant(EAGER_FILLER) },
    ),
    initial: fc.uniqueArray(
      fc.record({ id: fc.nat(9), rank: gapRank, eligible: fc.boolean() }),
      { minLength: 2, maxLength: 8, selector: (row) => row.id },
    ),
    orphans: fc.uniqueArray(fc.integer({ min: 20, max: 29 }), {
      minLength: 1,
      maxLength: 3,
    }),
    history: eagerJoinedHistory,
  })
  .map(({ base, fillers, initial, orphans, history }) => ({
    ...base,
    filter: `full-joined` as const,
    via: `marker` as const,
    indexed: true,
    fillers,
    // Every case has a matched root row with a null rank and at least one
    // orphan marker, so the null group holds both kinds of row.
    initial: [
      ...initial.filter(({ id }) => id !== 9),
      { id: 9, rank: null as unknown as number, eligible: true },
    ],
    orphans,
    history,
  }))
  .map(withoutPeerRefetch)

// The in-flight premise: a holding on-demand provider, and a history that
// first deletes a visible row, so the refill request is in flight while the
// later commands change rows. Releases answer it from the rows at that
// moment, between those changes.
// The proven-report premise: a peer over a signalling refetch provider and a
// source filter, so the peer installs the row after the first query's page.
// Histories upsert rows that tie with the peer's end or sort past both
// windows, then refetch, so a report fires while the first query's own page
// and tie stay the same; later moves check that it owes no repair.
export const eagerProvenReportCase: fc.Arbitrary<EagerCase> = fc
  .record({
    base: eagerCaseBase,
    ranks: fc.uniqueArray(fc.integer({ min: 0, max: 15 }), {
      minLength: 3,
      maxLength: 6,
    }),
    upserts: fc.array(
      fc.record({ id: fc.integer({ min: 10, max: 19 }), offset: fc.nat(3) }),
      { minLength: 1, maxLength: 3 },
    ),
    rest: eagerJoinedHistory,
  })
  .map(({ base, ranks, upserts, rest }) => {
    const sorted = [...ranks].sort((left, right) => left - right)
    const size = base.offset + base.limit
    // Ranks at or after the peer's end, so the first query's page keeps its
    // rows while the peer's answers change.
    const peerEnd = sorted[Math.min(size, sorted.length - 1)]!
    return {
      ...base,
      path: `on-demand` as const,
      provider: `refetch-signal` as const,
      latency: `immediate` as const,
      peer: true,
      filter: `source` as const,
      indexed: true,
      direction: `asc` as const,
      terms: 1 as const,
      initial: sorted.map((rank, id) => ({ id, rank, eligible: true })),
      history: [
        ...upserts.map(({ id, offset }) => ({
          type: `upsert` as const,
          id,
          rank: peerEnd + offset,
          eligible: true,
        })),
        { type: `refetch` as const },
        ...rest,
      ],
    }
  })

export const eagerHeldCase: fc.Arbitrary<EagerCase> = fc
  .tuple(
    eagerCaseBase,
    // A change that lands while the refill is in flight: an eligible row
    // with an id no other command uses (40 to 49), so the forwarding
    // provider always sends it.
    eagerRowOf(9).map((row) => ({
      type: `upsert` as const,
      ...row,
      id: row.id + 40,
      eligible: true,
    })),
    fc.array(
      fc.oneof(
        { weight: 3, arbitrary: eagerHistory(1, 29).map(([first]) => first!) },
        { weight: 2, arbitrary: fc.constant({ type: `answer` as const }) },
        {
          weight: 1,
          arbitrary: fc.constant({ type: `release-peer` as const }),
        },
        {
          weight: 1,
          arbitrary: fc.constant({ type: `delete-visible` as const }),
        },
      ),
      { minLength: 2, maxLength: 10 },
    ),
  )
  .map(([testCase, change, rest]) => ({
    ...testCase,
    path: `on-demand` as const,
    // A forwarding provider sends the delete, and an indexed source filter
    // or a joined filter refills from the provider, so the refill is a held
    // request. An unindexed source filter issues no held request. With the
    // provider fixed, this campaign needs no peer exclusion (#2155 concerns
    // only a refetching provider).
    provider: `forward` as const,
    filter:
      testCase.filter === `function` || testCase.filter === `full-joined`
        ? (`source` as const)
        : testCase.filter,
    indexed:
      testCase.filter === `function` ||
      testCase.filter === `full-joined` ||
      testCase.filter === `source`
        ? true
        : testCase.indexed,
    // One order term, so the refill pages by cursor.
    terms: 1 as const,
    latency: `held` as const,
    // A loaded prefix can hold headroom rows, so three visible deletes make
    // a refill request likely before the change.
    history: [
      { type: `delete-visible` as const },
      { type: `delete-visible` as const },
      { type: `delete-visible` as const },
      change,
      ...rest,
    ],
  }))

export function isJoinedFilter({ filter }: EagerCase): boolean {
  return filter === `joined` || filter === `anti-joined`
}

export function eagerOrder(
  rows: ReadonlyMap<number, Row>,
  { direction, nulls }: EagerCase,
): Array<Row> {
  // Documented order (live-queries guide): nulls first in either direction
  // unless the query asks for them last; NaN is greater than every other
  // non-null value; ties by ascending id. `null` and `undefined` are both
  // nullish, so they tie with each other.
  const position = (rank: number | null | undefined): [number, number] => {
    if (rank == null) return [nulls === `last` ? 3 : 0, 0]
    if (Number.isNaN(rank)) return [direction === `asc` ? 2 : 1, 0]
    return [direction === `asc` ? 1 : 2, direction === `asc` ? rank : -rank]
  }
  return [...rows.values()]
    .filter((row) => row.eligible)
    .sort((left, right) => {
      const [leftGroup, leftValue] = position(left.rank)
      const [rightGroup, rightValue] = position(right.rank)
      return (
        leftGroup - rightGroup || leftValue - rightValue || left.id - right.id
      )
    })
}

export function eagerWindow(
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
): Array<number> {
  return eagerOrder(rows, testCase)
    .slice(testCase.offset, testCase.offset + testCase.limit)
    .map((row) => row.id)
}

/**
 * The visible window agrees with the model. The guide promises order only by
 * the query's `orderBy` terms; rows that tie on every term may appear in any
 * order. A source-filter plan's ties follow the source key, which the model
 * also uses, so its window must match exactly. A joined plan's ties follow the
 * joined result key, so its window must be any valid first `limit` rows: the
 * same order values in sequence, each from an eligible row with that value.
 */
export function expectEagerWindow(
  actual: Array<number>,
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
  label: string,
): void {
  const expected = eagerWindow(rows, testCase)
  if (!isJoinedFilter(testCase) && testCase.filter !== `full-joined`) {
    compareAt(label, () => expect(actual, label).toEqual(expected))
    return
  }
  // `null` and `undefined` tie, so either may come first among nullish rows.
  const rank = (id: number) => {
    const row = rows.get(id)
    return row?.eligible
      ? ((row.rank as number | null | undefined) ?? null)
      : `ineligible ${id}`
  }
  compareAt(label, () =>
    expect(actual.map(rank), label).toEqual(expected.map(rank)),
  )
  compareAt(`${label}: distinct rows`, () =>
    expect(new Set(actual).size, `${label}: distinct rows`).toBe(actual.length),
  )
}

/**
 * Whether a bounded prefix of the source leaves the window short. The prefix
 * is the first `offset + limit` source rows in the query's order. A source
 * filter runs inside the request, so its prefix holds only eligible rows. A
 * joined or function filter drops rows only after the source's limit, so its
 * prefix can hold fewer eligible rows than the window needs.
 */
export function prefixLeavesWindowShort(
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
): boolean {
  const size = testCase.offset + testCase.limit
  const candidates =
    testCase.filter === `source`
      ? rows
      : new Map(
          [...rows].map(([rowId, row]) => [rowId, { ...row, eligible: true }]),
        )
  const prefix = eagerOrder(candidates, testCase).slice(0, size)
  return prefix.filter(({ id }) => rows.get(id)!.eligible).length < size
}

/** Ranks of the last window row and the first row after the window. */
export function boundaryRanks(
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
): Array<number | null> {
  const end = testCase.offset + testCase.limit
  // Generated rows may carry a null rank behind the `number` row type.
  return eagerOrder(rows, testCase)
    .slice(end - 1, end + 1)
    .map((row): number | null => row.rank)
}

export type OptimisticWindowShape = `source` | `joined` | `anti-joined`
export type OptimisticWindowMutation = `update` | `delete`
export type OptimisticWindowConsumer = `collection` | `effect`
export type OptimisticWindowOutcome = `acknowledge` | `rollback`
export type OptimisticWindowExtent = `missing` | `installed` | `non-prefix`
export type OptimisticWindowAcquisition = `required` | `forbidden` | `allowed`
export type OptimisticWindowCheckpoint =
  `initial` | `optimistic` | `settled` | `restored`
export const MAX_OPTIMISTIC_WINDOW_REQUESTS = 8
export const OPTIMISTIC_ACQUISITION_OBSERVATION_TURNS = 8

// The most rows a bounded refill may ask for. An indexed plan pages past
// the window. An unindexed plan grows its prefix to twice the rows it
// installed (ARCHITECTURE.md, "an underfilled unindexed prefix grows"), and
// a request also covers the one row that the pending transaction overlays.
export function refillBound({
  indexed,
  width,
  installedIds,
}: OptimisticWindowCase) {
  return indexed ? width + 2 : 2 * installedIds.length + 1
}

export type OptimisticWindowCase = {
  shape: OptimisticWindowShape
  mutation: OptimisticWindowMutation
  consumer: OptimisticWindowConsumer
  outcome: OptimisticWindowOutcome
  width: 1 | 2
  indexed: boolean
  extent: OptimisticWindowExtent
  installedIds: Array<number>
  acquisition: OptimisticWindowAcquisition
  answerTiming?: `before-settlement` | `after-settlement`
  mutationSource?: `root` | `marker`
  rankMove?: boolean
  rankDeparture?: boolean
  direction?: `asc` | `desc`
}

export type OptimisticWindowPublication = {
  rows: Array<number>
}

export function copyOptimisticWindowPublication(
  publication: OptimisticWindowPublication,
): OptimisticWindowPublication {
  return { rows: [...publication.rows] }
}

export type OptimisticWindowObservation = {
  initial: Array<number>
  immediate: Array<number>
  acquiring: Array<number>
  answerQueued: Array<number>
  settled: Array<number>
  afterAnswer?: Array<number>
  afterRestore?: Array<number>
  afterRestorePublications?: Array<OptimisticWindowPublication>
  rowsAfterFirstTurn: Array<number>
  rowsAfterSecondTurn: Array<number>
  immediatePublications: Array<OptimisticWindowPublication>
  preSettlementPublications: Array<OptimisticWindowPublication>
  publicationsAtSettlement: Array<OptimisticWindowPublication>
  publicationsAfterSettlement: Array<OptimisticWindowPublication>
  attempts: Array<{
    submittedRows: Array<number>
    limit: number | undefined
    direction: string | undefined
    // The request had a limit or a predicate, so it read no full source.
    bounded?: boolean
    appliedReceiptPending: boolean
    providerPending: boolean
  }>
  acquisitionStartedBeforeSettlement?: boolean
  requestHistory?: Array<{
    identity: string
    newRows: number
    phase?: string
    submittedRows?: Array<number>
    limit?: number
    direction?: string
    allowsRejectedRoot?: boolean
    selectedRanks?: Array<number>
  }>
  settlementOutcome: `fulfilled` | `rejected`
}

export function referenceOptimisticWindow(
  testCase: OptimisticWindowCase,
  checkpoint: OptimisticWindowCheckpoint,
): Array<number> {
  // All three predicates accept 1, 2, and 3 in the remote ledger; 4 is the
  // rejected leading root. The model starts from installed keys, applies the
  // one overlay, and recomputes the window without the loader's prefix logic.
  const authoritative =
    (checkpoint === `settled` || checkpoint === `restored`) &&
    testCase.outcome === `acknowledge`
  const installed = authoritative
    ? testCase.rankMove
      ? [1, 2, 3, 4]
      : testCase.mutationSource === `marker`
        ? [1, 2, 3, 4]
        : [1, 2, 4]
    : testCase.installedIds
  const overlayActive = checkpoint === `optimistic`
  const markerDeparturePersisted =
    checkpoint === `settled` &&
    testCase.outcome === `acknowledge` &&
    testCase.mutationSource === `marker`
  return installed
    .filter(
      (id) =>
        id !== 4 &&
        !(
          (overlayActive || markerDeparturePersisted) &&
          id === 3 &&
          (!testCase.rankMove || testCase.rankDeparture)
        ),
    )
    .sort((left, right) => {
      const moved = (overlayActive || authoritative) && testCase.rankMove
      const leftRank = moved && left === 3 ? 0 : left
      const rightRank = moved && right === 3 ? 0 : right
      return rightRank - leftRank
    })
    .slice(0, testCase.width)
}

export function optimisticWindowViolations(
  observation: OptimisticWindowObservation,
  testCase: OptimisticWindowCase,
): Array<string> {
  const violations: Array<string> = []
  const { outcome, width } = testCase
  const optimistic = referenceOptimisticWindow(testCase, `optimistic`)
  const settled = referenceOptimisticWindow(testCase, `settled`)
  const lateAnswer = testCase.answerTiming === `after-settlement`
  const expectedAtSettlement =
    lateAnswer && outcome === `acknowledge` ? optimistic : settled
  const compare = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      violations.push(
        `${label}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`,
      )
    }
  }
  compare(`immediate rows`, observation.immediate, optimistic)
  compare(
    `immediate publications`,
    observation.immediatePublications.map(({ rows }) => rows),
    [optimistic],
  )
  compare(`acquiring rows`, observation.acquiring, optimistic)
  compare(`queued-answer rows`, observation.answerQueued, optimistic)
  compare(
    `first optimistic publication`,
    observation.preSettlementPublications[0]?.rows,
    optimistic,
  )
  compare(
    `other pre-settlement publications`,
    observation.preSettlementPublications.slice(1).map(({ rows }) => rows),
    [],
  )
  compare(`settled rows`, observation.settled, expectedAtSettlement)
  if (lateAnswer)
    compare(`rows after late answer`, observation.afterAnswer, settled)
  if (testCase.mutationSource === `marker` && outcome === `acknowledge`) {
    compare(
      `rows after marker restoration`,
      observation.afterRestore,
      referenceOptimisticWindow(testCase, `restored`),
    )
    compare(
      `marker restoration publications`,
      observation.afterRestorePublications?.map(({ rows }) => rows),
      [referenceOptimisticWindow(testCase, `restored`)],
    )
  }
  compare(
    `rows after first settlement turn`,
    observation.rowsAfterFirstTurn,
    settled,
  )
  compare(
    `rows after second settlement turn`,
    observation.rowsAfterSecondTurn,
    settled,
  )
  const expectedSettledPublications =
    JSON.stringify(optimistic) === JSON.stringify(expectedAtSettlement)
      ? []
      : [expectedAtSettlement]
  compare(
    `settled publications`,
    observation.publicationsAtSettlement
      .slice(observation.preSettlementPublications.length)
      .map(({ rows }) => rows),
    expectedSettledPublications,
  )
  compare(
    `post-settlement publications`,
    observation.publicationsAfterSettlement.map(({ rows }) => rows),
    lateAnswer && outcome === `acknowledge` ? [settled] : [],
  )
  const needsAcquisition = testCase.acquisition === `required`
  if (
    needsAcquisition &&
    observation.acquisitionStartedBeforeSettlement === false
  ) {
    violations.push(`refill acquisition did not start before settlement`)
  }
  if (needsAcquisition && observation.attempts.length === 0) {
    violations.push(`refill acquisition did not start`)
  }
  const refillId = width === 1 ? 2 : 1
  const refillAttempt = observation.attempts.find(({ submittedRows }) =>
    submittedRows.includes(refillId),
  )
  if (needsAcquisition && !refillAttempt) {
    violations.push(`refill answer did not submit row ${refillId}`)
  } else if (
    needsAcquisition &&
    (refillAttempt?.direction !== (testCase.direction ?? `desc`) ||
      refillAttempt.limit === undefined ||
      refillAttempt.limit > refillBound(testCase))
  ) {
    violations.push(`refill used an unbounded provider request`)
  } else if (
    !lateAnswer &&
    refillAttempt &&
    !refillAttempt.appliedReceiptPending
  ) {
    violations.push(`applied receipt was not pending at the queued-answer cut`)
  }
  if (!lateAnswer && refillAttempt && !refillAttempt.providerPending) {
    violations.push(`provider was not pending at the queued-answer cut`)
  }
  if (testCase.acquisition === `forbidden` && observation.attempts.length > 0) {
    violations.push(`refill acquisition started with complete local extent`)
  }
  // A refill the case allows but does not require is still bounded: an
  // ordered read within the refill bound, or a predicate read, never the
  // full source.
  if (testCase.acquisition === `allowed`) {
    for (const attempt of observation.attempts) {
      if (
        attempt.bounded === false ||
        (attempt.direction !== undefined &&
          (attempt.limit === undefined ||
            attempt.limit > refillBound(testCase)))
      ) {
        violations.push(`an allowed refill used an unbounded provider request`)
        break
      }
    }
  }
  const requested = new Set<string>()
  for (const request of observation.requestHistory ?? []) {
    if (request.phase === `pending` && testCase.indexed) {
      const finiteOrdered =
        request.direction === (testCase.direction ?? `desc`) &&
        request.limit !== undefined &&
        request.limit <= width + 2
      const boundaryTie =
        request.direction === undefined &&
        request.selectedRanks !== undefined &&
        new Set(request.selectedRanks).size === 1
      if (!finiteOrdered && !boundaryTie) {
        violations.push(`optimistic acquisition used a broad provider request`)
      }
      if (testCase.shape === `source` && request.allowsRejectedRoot) {
        violations.push(`source refill omitted the source predicate`)
      }
    }
    if (requested.has(request.identity) && request.newRows === 0) {
      violations.push(`repeated an unchanged provider request without progress`)
      break
    }
    requested.add(request.identity)
  }
  compare(
    `settlement outcome`,
    observation.settlementOutcome,
    outcome === `acknowledge` ? `fulfilled` : `rejected`,
  )
  return violations
}
