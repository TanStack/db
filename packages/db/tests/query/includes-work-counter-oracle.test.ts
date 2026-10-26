import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  inArray,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import {
  SetWindowFindOneLimitError,
  SetWindowRequiresOrderByError,
} from '../../src/errors.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions } from '../../src/types.js'

/**
 * # Does unrelated source size increase correlated include work?
 *
 * Correct rows are not enough for a pushed-down include. An implementation can
 * return the right tree after scanning or delivering every unrelated source
 * row. This oracle protects a bounded work law for indexed correlations:
 *
 * 1. The query returns the complete expected nested result.
 * 2. Adding unmatched link rows does not increase source delivery or reads.
 * 3. Adding indexed join targets does not increase source delivery or reads.
 * 4. Without the target join, unrelated rows at every level still add no work.
 *
 * The reference is relational. It compares each scaled fixture with the same
 * query on a minimal baseline. Exact baseline counts prove that the intended
 * source path ran. The scaled relation, not elapsed time, states the work law.
 * Counters observe both delivered changes and Collection reads so filtering
 * cannot hide a scan through those read methods.
 *
 * The input grammar varies an integer filler count from 1 through 24. Zero is
 * the ablated baseline; negative and fractional counts are invalid fixture
 * sizes. Joined queries vary unrelated links and join targets separately.
 * The join-free query grows every source together. Counts 1, 2, and 3 pin the
 * smallest valid boundary, 24 pins the upper bound, and fixed and random
 * campaigns sample the range.
 *
 * The boundary conditions matter. Collections preload before they receive
 * B-tree indexes. Filler rows never match a selected route. This suite checks
 * source delivery and Collection reads at the preload checkpoint; it does not
 * promise a general runtime bound, count internal index traversal, or cover
 * providers that ignore local indexes.
 */

let nextCollectionId = 0

type TermRow = { id: string; text: string }
type MeaningRow = { id: string; termId: string }
type GroupRow = { id: string; meaningId: string }
type LinkRow = { id: string; groupId: string; targetId: string }

type SourceRows = {
  terms: Array<TermRow>
  meanings: Array<MeaningRow>
  groups: Array<GroupRow>
  links: Array<LinkRow>
}

type FillerCounts = {
  terms: number
  meanings: number
  groups: number
  links: number
}

type WorkScenario = {
  filler: FillerCounts
  joinTargets: boolean
}

type WorkCount = {
  delivered: number
  examined: number
}

type SourceWork = {
  terms: WorkCount
  meanings: WorkCount
  groups: WorkCount
  links: WorkCount
}

type LinkObservation =
  { id: string; text: string } | { id: string; targetId: string }

type WorkObservation = {
  result: Array<{
    id: string
    meanings: Array<{
      id: string
      groups: Array<{
        id: string
        links: Array<LinkObservation>
      }>
    }>
  }>
  sourceWork: SourceWork
}

async function runCleanups(
  cleanups: ReadonlyArray<() => void | Promise<void>>,
  primary?: { error: unknown },
): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.map(async (cleanup) => cleanup()),
  )
  const failures = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason as unknown] : [],
  )
  if (failures.length > 0 && primary) {
    throw new AggregateError(
      [primary.error, ...failures],
      `Oracle and cleanup failed`,
      { cause: primary.error },
    )
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `Oracle cleanup failed`)
  }
}

const noFillers: FillerCounts = {
  terms: 0,
  meanings: 0,
  groups: 0,
  links: 0,
}

function createSourceCollection<T extends { id: string }>(
  name: string,
  initialData: Array<T>,
) {
  return createCollection(
    localOnlyCollectionOptions<T>({
      id: `${name}-${nextCollectionId++}`,
      getKey: (row) => row.id,
      initialData,
    }),
  )
}

// Count both sides of the source boundary. Delivered rows show what enters the
// dataflow graph. entries() visits capture scans and get() calls capture keyed
// reads, so examined work cannot hide behind a filter.
function countSourceWork<T extends object>(collection: Collection<T>) {
  let deliveredRows = 0
  let examinedRows = 0
  let readingEntry = false
  const originalSubscribeChanges = collection.subscribeChanges.bind(collection)
  const originalEntries = collection.entries.bind(collection)
  const originalGet = collection.get.bind(collection)

  collection.subscribeChanges = (callback, options) => {
    return originalSubscribeChanges((changes) => {
      deliveredRows += changes.length
      callback(changes)
    }, options)
  }

  collection.get = (key) => {
    if (!readingEntry) examinedRows++
    return originalGet(key)
  }

  collection.entries = function* () {
    const entries = originalEntries()
    const readNext = () => {
      readingEntry = true
      try {
        return entries.next()
      } finally {
        readingEntry = false
      }
    }

    for (let next = readNext(); !next.done; next = readNext()) {
      examinedRows++
      yield next.value
    }
  }

  return (): WorkCount => ({ delivered: deliveredRows, examined: examinedRows })
}

function createFixtureRows(filler: FillerCounts): SourceRows {
  return {
    terms: [
      { id: `term-0`, text: `selected term` },
      { id: `term-1`, text: `first target` },
      { id: `term-2`, text: `second target` },
      ...Array.from({ length: filler.terms }, (_, index) => ({
        id: `term-filler-${index}`,
        text: `irrelevant target ${index}`,
      })),
    ],
    meanings: [
      { id: `meaning-0`, termId: `term-0` },
      ...Array.from({ length: filler.meanings }, (_, index) => ({
        id: `meaning-filler-${index}`,
        termId: `term-never-selected`,
      })),
    ],
    groups: [
      { id: `group-0`, meaningId: `meaning-0` },
      ...Array.from({ length: filler.groups }, (_, index) => ({
        id: `group-filler-${index}`,
        meaningId: `meaning-never-selected`,
      })),
    ],
    links: [
      // Keep filler links on one existing target key. Only the left-side input
      // grows. The term-filler control probes right-side input growth separately.
      { id: `link-0`, groupId: `group-0`, targetId: `term-1` },
      {
        id: `link-1`,
        groupId: `group-0`,
        targetId: `term-2`,
      },
      ...Array.from({ length: filler.links }, (_, index) => ({
        id: `link-filler-${index}`,
        groupId: `group-never-selected`,
        targetId: `term-1`,
      })),
    ],
  }
}

function observeLink(link: LinkObservation): LinkObservation {
  if (`text` in link) return { id: link.id, text: link.text }
  if (`targetId` in link) return { id: link.id, targetId: link.targetId }

  const exhaustive: never = link
  return exhaustive
}

function observeResult(
  roots: ReadonlyArray<WorkObservation[`result`][number]>,
): WorkObservation[`result`] {
  return roots.map((root) => ({
    id: root.id,
    meanings: root.meanings.map((meaning) => ({
      id: meaning.id,
      groups: meaning.groups.map((group) => ({
        id: group.id,
        links: group.links.map(observeLink),
      })),
    })),
  }))
}

async function observeWork({
  filler,
  joinTargets,
}: WorkScenario): Promise<WorkObservation> {
  const rows = createFixtureRows(filler)
  const sources = {
    terms: createSourceCollection(`work-terms`, rows.terms),
    meanings: createSourceCollection(`work-meanings`, rows.meanings),
    groups: createSourceCollection(`work-groups`, rows.groups),
    links: createSourceCollection(`work-links`, rows.links),
  }
  let cleanupLive: (() => Promise<void>) | undefined
  let primary: { error: unknown } | undefined

  try {
    await Promise.all(Object.values(sources).map((source) => source.preload()))

    // Match the reported boundary: load first, then add a B-tree index on each
    // correlation and join column before constructing the live query.
    sources.terms.createIndex((row) => row.id, { indexType: BTreeIndex })
    sources.meanings.createIndex((row) => row.termId, {
      indexType: BTreeIndex,
    })
    sources.groups.createIndex((row) => row.meaningId, {
      indexType: BTreeIndex,
    })
    sources.links.createIndex((row) => row.groupId, { indexType: BTreeIndex })
    sources.links.createIndex((row) => row.targetId, {
      indexType: BTreeIndex,
    })

    const counters = {
      terms: countSourceWork(sources.terms),
      meanings: countSourceWork(sources.meanings),
      groups: countSourceWork(sources.groups),
      links: countSourceWork(sources.links),
    }

    const live = createLiveQueryCollection((q) =>
      q
        .from({ term: sources.terms })
        .where(({ term }) => eq(term.id, `term-0`))
        .select(({ term }) => ({
          id: term.id,
          meanings: materialize(
            q
              .from({ meaning: sources.meanings })
              .where(({ meaning }) => eq(meaning.termId, term.id))
              .select(({ meaning }) => ({
                id: meaning.id,
                groups: materialize(
                  q
                    .from({ group: sources.groups })
                    .where(({ group }) => eq(group.meaningId, meaning.id))
                    .select(({ group }) => {
                      const selectedLinks = q
                        .from({ link: sources.links })
                        .where(({ link }) => eq(link.groupId, group.id))

                      return {
                        id: group.id,
                        links: joinTargets
                          ? materialize(
                              selectedLinks
                                .innerJoin(
                                  { target: sources.terms },
                                  ({ link, target }) =>
                                    eq(link.targetId, target.id),
                                )
                                .select(({ link, target }) => ({
                                  id: link.id,
                                  text: target.text,
                                })),
                            )
                          : materialize(
                              selectedLinks.select(({ link }) => ({
                                id: link.id,
                                targetId: link.targetId,
                              })),
                            ),
                      }
                    }),
                ),
              })),
          ),
        })),
    )
    cleanupLive = () => live.cleanup()

    await live.preload()
    return {
      result: observeResult(live.toArray),
      sourceWork: {
        terms: counters.terms(),
        meanings: counters.meanings(),
        groups: counters.groups(),
        links: counters.links(),
      },
    }
  } catch (error) {
    primary = { error }
    throw error
  } finally {
    await runCleanups(
      [
        async () => cleanupLive?.(),
        ...Object.values(sources).map((source) => async () => source.cleanup()),
      ],
      primary,
    )
  }
}

function expectedResult({
  joinTargets,
}: Pick<WorkScenario, 'joinTargets'>): WorkObservation[`result`] {
  return [
    {
      id: `term-0`,
      meanings: [
        {
          id: `meaning-0`,
          groups: [
            {
              id: `group-0`,
              links: [
                joinTargets
                  ? { id: `link-0`, text: `first target` }
                  : { id: `link-0`, targetId: `term-1` },
                joinTargets
                  ? {
                      id: `link-1`,
                      text: `second target`,
                    }
                  : {
                      id: `link-1`,
                      targetId: `term-2`,
                    },
              ],
            },
          ],
        },
      ],
    },
  ]
}

const joinedBaselineWork: SourceWork = {
  terms: { delivered: 3, examined: 3 },
  meanings: { delivered: 1, examined: 1 },
  groups: { delivered: 1, examined: 1 },
  links: { delivered: 2, examined: 2 },
}

const joinFreeBaselineWork: SourceWork = {
  terms: { delivered: 1, examined: 1 },
  meanings: { delivered: 1, examined: 1 },
  groups: { delivered: 1, examined: 1 },
  links: { delivered: 2, examined: 2 },
}

let joinedBaselineObservation: WorkObservation
let joinFreeBaselineObservation: WorkObservation

function expectSourceWorkBound(actual: SourceWork, expected: SourceWork): void {
  expect(actual).toEqual(expected)
}

async function expectCorrelatedJoinWorkBound(
  fillerCount: number,
): Promise<void> {
  const baseline = joinedBaselineObservation
  const scaled = await observeWork({
    filler: {
      terms: 0,
      meanings: 0,
      groups: 0,
      links: fillerCount,
    },
    joinTargets: true,
  })
  expect(baseline.result).toEqual(expectedResult({ joinTargets: true }))
  expect(scaled.result).toEqual(baseline.result)
  expect(baseline.sourceWork).toEqual(joinedBaselineWork)

  expectSourceWorkBound(scaled.sourceWork, baseline.sourceWork)
}

async function expectJoinTargetWorkBound(fillerCount: number): Promise<void> {
  const baseline = joinedBaselineObservation
  const scaled = await observeWork({
    filler: {
      terms: fillerCount,
      meanings: 0,
      groups: 0,
      links: 0,
    },
    joinTargets: true,
  })

  expect(baseline.result).toEqual(expectedResult({ joinTargets: true }))
  expect(scaled.result).toEqual(baseline.result)
  expect(baseline.sourceWork).toEqual(joinedBaselineWork)
  expectSourceWorkBound(scaled.sourceWork, baseline.sourceWork)
}

async function expectJoinFreeWorkBound(fillerCount: number): Promise<void> {
  const baseline = joinFreeBaselineObservation
  const scaled = await observeWork({
    filler: {
      terms: fillerCount,
      meanings: fillerCount,
      groups: fillerCount,
      links: fillerCount,
    },
    joinTargets: false,
  })

  expect(baseline.result).toEqual(expectedResult({ joinTargets: false }))
  expect(scaled.result).toEqual(baseline.result)
  expect(baseline.sourceWork).toEqual(joinFreeBaselineWork)
  expectSourceWorkBound(scaled.sourceWork, baseline.sourceWork)
}

function campaigns(fixedSeed: number, property: string, baseRuns = 6) {
  return [
    {
      name: `fixed`,
      options: { numRuns: oracleRuns(baseRuns), seed: fixedSeed },
    },
    {
      name: `random or replayed`,
      options: oraclePropertyOptions(baseRuns, property),
    },
  ]
}

describe(`includes deterministic work-counter oracle`, () => {
  it(`preserves the primary failure and every cleanup failure`, async () => {
    const primary = new Error(`source preload failed`)
    const firstCleanup = new Error(`live query cleanup failed`)
    const secondCleanup = new Error(`source cleanup failed`)
    const attempted: Array<string> = []

    await expect(
      runCleanups(
        [
          () => {
            attempted.push(`live`)
            throw firstCleanup
          },
          () => {
            attempted.push(`source`)
            throw secondCleanup
          },
        ],
        { error: primary },
      ),
    ).rejects.toMatchObject({
      cause: primary,
      errors: [primary, firstCleanup, secondCleanup],
    })
    expect(attempted).toEqual([`live`, `source`])
  })

  it.each([true, false])(
    `retains and rejects extra roots with joinTargets=%s`,
    (joinTargets) => {
      const expected = expectedResult({ joinTargets })
      expect(observeResult(expected)).toEqual(expected)
      const extra = { id: `term-extra`, meanings: [] }
      const faulty = [...expected, extra]
      // The old first-root capture erases this violation.
      expect(observeResult(faulty.slice(0, 1))).toEqual(expected)
      const observed = observeResult(faulty)
      expect(observed).toEqual(faulty)
      expect(() => expect(observed).toEqual(expected)).toThrow()
      expect(observeResult([])).toEqual([])
      expect(() => expect(observeResult([])).toEqual(expected)).toThrow()
    },
  )

  beforeAll(async () => {
    const [joinedBaseline, joinFreeBaseline] = await Promise.all([
      observeWork({ filler: noFillers, joinTargets: true }),
      observeWork({ filler: noFillers, joinTargets: false }),
    ])
    joinedBaselineObservation = joinedBaseline
    joinFreeBaselineObservation = joinFreeBaseline
  })

  it(`rejects extra source reads at the preload checkpoint`, () => {
    const baseline = joinedBaselineObservation
    const faultyWork: SourceWork = {
      ...baseline.sourceWork,
      links: {
        ...baseline.sourceWork.links,
        examined: baseline.sourceWork.links.examined + 1,
      },
    }

    expect(baseline.result).toEqual(expectedResult({ joinTargets: true }))
    expect(() =>
      expectSourceWorkBound(faultyWork, baseline.sourceWork),
    ).toThrow()
  })

  it.each([1, 2, 3])(
    `pins the work bound at the small filler boundary (%i)`,
    expectCorrelatedJoinWorkBound,
  )
  it(`pins the joined-link filler range endpoint`, () =>
    expectCorrelatedJoinWorkBound(24))
  it.each([1, 24])(
    `pins join-target growth at filler count %i`,
    expectJoinTargetWorkBound,
  )
  it.each([1, 24])(
    `pins join-free growth at filler count %i`,
    expectJoinFreeWorkBound,
  )

  for (const campaign of campaigns(1709, `includes-work.correlated-links`)) {
    fcTest.prop([fc.integer({ min: 1, max: 24 })], campaign.options)(
      `a join preserves correlated source pushdown (${campaign.name})`,
      expectCorrelatedJoinWorkBound,
    )
  }

  for (const campaign of campaigns(170_900, `includes-work.join-targets`)) {
    fcTest.prop([fc.integer({ min: 1, max: 24 })], campaign.options)(
      `indexed join-target growth keeps source work flat (${campaign.name})`,
      expectJoinTargetWorkBound,
    )
  }

  for (const campaign of campaigns(17_090, `includes-work.join-free`)) {
    fcTest.prop([fc.integer({ min: 1, max: 24 })], campaign.options)(
      `join-free correlated includes keep source work flat (${campaign.name})`,
      expectJoinFreeWorkBound,
    )
  }
})

/**
 * # Does a parent window bound include work?
 *
 * An ordered parent query shows only the rows in its window. Law 12 of the
 * live-query architecture (Work) says irrelevant rows must not activate
 * unrelated routes. A parent row the window drops is irrelevant to the public
 * snapshot, so the route relation must not activate its bucket, and the
 * include must create no demand for its children. That holds with `distinct`,
 * which reads every parent row before the window, and after `setWindow`
 * narrows a parent that has only an `orderBy`, whether before or after the
 * live query starts. Only the parent's window answers `setWindow`; an include
 * child's own `orderBy` or `limit` must not take it over.
 *
 * A static parent filter (`eq` or `inArray` on the correlation field) may
 * create child demand before the query runs only when no top-K can drop the
 * rows it names: no enclosing query is windowed or a `findOne`, and either the
 * query is neither windowed nor a `findOne`, or it is a `findOne` that shows
 * one row for one named correlation value, with no `offset`, and offset 0 at
 * start if a window was requested before start. Any other window or `findOne`
 * can drop them, including a window `setWindow` requests later, so the static
 * demand must wait for the rows it shows. A `findOne` keeps its compiled limit
 * (1, or 0 for `.limit(0).findOne()`): `setWindow` throws
 * `SetWindowFindOneLimitError` for any other limit. A window is an ordered
 * view, so only an ordered `findOne` has a movable window; an unordered one
 * accepts only its compiled limit at offset 0.
 *
 * ## Model
 *
 * Parents have a rank and a group; children and their include correlate by
 * group, so parents of one group share one active bucket, and every child has
 * one grandchild. The model sorts the shown units by rank and takes the
 * window. A unit is a model-only abstraction: a parent row, or, with
 * `distinct`, one distinct (rank, group) pair, because the selected values
 * then omit the parent id and parents with equal rank and group collapse into
 * one public row. Ranks can tie, so the comparison accepts any member of the
 * tie group at the window edge: the rank sequence must match, every shown row
 * must be a unit with that rank, and no unit may appear twice. The parent is a
 * page (`offset` and `limit`), a `findOne` with or without an `offset`, or an
 * `orderBy` alone, whose window starts unbounded unless `setWindow` requests
 * one before start. Each shown row must carry its group's children in the
 * include form under test:
 *
 * - `materialize` and `collection` (a child Collection): every child;
 * - `ordered`: every child by `n`, descending, with the child's own `orderBy`;
 * - `limited`: the first two of those, with the child's own `limit`;
 * - `findOne`: the first of those, or none;
 * - `nested`: every child with its materialized grandchildren;
 * - `limited-nested`: the first two children with their grandchildren.
 *
 * ## Work
 *
 * The child source Collection is local or on demand. For an on-demand child,
 * the test's `loadSubset` handler stands in for both the sync adapter and the
 * provider: it serves each acquisition attempt from the model's rows by the
 * request data's predicate, keeps a ledger of sent rows, and forwards a later
 * change message only for a sent row or a row a served predicate matches.
 * Work is a model observation: the child rows the local source Collection
 * delivers to the query, or the rows the on-demand handler's acquisitions
 * serve, plus the grandchild rows the local grandchild source delivers.
 * Preload may load only the children of the shown rows' groups and the
 * grandchildren of the shown children. A step may newly load only the groups
 * of rows that entered the window and were not shown before it, the
 * grandchildren of children that entered an include, and the rows the step
 * itself writes, which a local subscription receives whether or not their
 * group is loaded. An on-demand child arrives only through an acquisition, so
 * that path shows routing even for rows the step writes. A query that routes
 * the row after the window, every row in an edge tie group, rows before the
 * window, rows `setWindow` dropped, or rows a static filter names fails.
 *
 * ## Recorded limit: transient top-K rows (#2151)
 *
 * While an index-backed parent top-K refills its window within one graph run,
 * after a held row moves out, a tie group at the window edge loads, or the
 * window moves forward, it can briefly hold a row outside the window it shows
 * once that acquisition completes, and that row's children load. The public
 * snapshot stays correct. A refill checkpoint is a model observation that
 * combines two production facts the harness cannot see directly, an ordered
 * acquisition and whether it completed within the graph run: the parent
 * Collection delivers more change batches to the query than the initial load
 * at preload, or than the step's own parent write. The generated campaigns
 * skip only the work bound at refill checkpoints and still check the rows.
 * Replays pin every known trace and allow exactly the one extra child row
 * each shows, and pinned forward moves allow none. Each generated campaign
 * counts the forward moves its own runs check strictly and requires some.
 *
 * ## Histories
 *
 * Histories insert parents (fresh, or copying an existing rank and group),
 * delete parents, move a parent's rank past every other rank, insert and
 * delete children, and move the parent window with `setWindow`, optionally
 * after a window requested before start. A static child filter on the
 * grandchild correlation field (the child id) may keep only some children.
 * Indexes exist before the live query starts, and every step completes before
 * it is checked.
 */
type WindowParent = { id: string; rank: number; group: string }
type WindowChild = { id: string; group: string; n: number }
type WindowGrandchild = { id: string; childId: string }
type ChildForm =
  | `materialize`
  | `collection`
  | `ordered`
  | `limited`
  | `findOne`
  | `nested`
  | `limited-nested`
type ParentForm = `page` | `findOne` | `orderOnly`

type WindowCommand =
  | { type: `insert-parent`; copy: number | null }
  | { type: `delete-parent`; pick: number }
  | { type: `rank`; pick: number; up: boolean }
  | { type: `insert-child`; pick: number }
  | { type: `delete-child`; pick: number }
  | { type: `move`; offset: number; limit: number }

type WindowCase = {
  parents: number
  groups: number
  // Parents that copy an earlier parent's rank, and its group when `group`.
  copies: Array<{ pick: number; group: boolean }>
  childrenPerGroup: number
  childForm: ChildForm
  childSource: `local` | `on-demand`
  parentForm: ParentForm
  // Groups a static parent filter keeps, by index; one uses `eq`.
  parentFilter: Array<number> | null
  direction: `asc` | `desc`
  distinct: boolean
  offset: number
  limit: number
  history: Array<WindowCommand>
  // A replay of a known transient top-K row: the extra child rows it may load
  // at a checkpoint where the parent's ordered acquisition had not completed.
  overshoot?: number
  // A `findOne` parent skips its `offset` when false. Omitted means true.
  findOneOffset?: boolean
  // A window `setWindow` requests before the live query starts.
  startWindow?: { offset: number; limit: number } | null
  // A static child filter on the grandchild correlation field (the child
  // id), by index into the initial children; the include keeps only those.
  childFilter?: Array<number> | null
}

const windowCommand: fc.Arbitrary<WindowCommand> = fc.oneof(
  fc.record({
    type: fc.constant(`insert-parent` as const),
    copy: fc.option(fc.nat(), { nil: null }),
  }),
  fc.record({ type: fc.constant(`delete-parent` as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant(`rank` as const),
    pick: fc.nat(),
    up: fc.boolean(),
  }),
  fc.record({ type: fc.constant(`insert-child` as const), pick: fc.nat() }),
  fc.record({ type: fc.constant(`delete-child` as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant(`move` as const),
    offset: fc.integer({ min: 0, max: 20 }),
    limit: fc.integer({ min: 1, max: 4 }),
  }),
)

const windowCase: fc.Arbitrary<WindowCase> = fc
  .integer({ min: 8, max: 40 })
  .chain((parents) =>
    fc.record({
      parents: fc.constant(parents),
      // At least half as many groups as parents, so most rows own a group.
      groups: fc.integer({ min: Math.ceil(parents / 2), max: parents }),
      copies: fc.array(fc.record({ pick: fc.nat(), group: fc.boolean() }), {
        maxLength: 4,
      }),
      childrenPerGroup: fc.integer({ min: 1, max: 3 }),
      childForm: fc.constantFrom(
        `materialize` as const,
        `collection` as const,
        `ordered` as const,
        `limited` as const,
        `findOne` as const,
        `nested` as const,
        `limited-nested` as const,
      ),
      childSource: fc.constantFrom(`local` as const, `on-demand` as const),
      parentForm: fc.constantFrom(
        `page` as const,
        `findOne` as const,
        `orderOnly` as const,
      ),
      parentFilter: fc.option(
        fc.uniqueArray(fc.nat({ max: parents - 1 }), {
          minLength: 1,
          maxLength: 6,
        }),
        { nil: null },
      ),
      direction: fc.constantFrom(`asc` as const, `desc` as const),
      distinct: fc.boolean(),
      offset: fc.integer({ min: 0, max: 20 }),
      limit: fc.integer({ min: 1, max: 4 }),
      history: fc.array(windowCommand, { maxLength: 8 }),
      findOneOffset: fc.boolean(),
      startWindow: fc.option(
        fc.record({
          offset: fc.integer({ min: 0, max: 20 }),
          limit: fc.integer({ min: 1, max: 4 }),
        }),
        { nil: null },
      ),
      childFilter: fc.option(
        fc.uniqueArray(fc.nat({ max: 200 }), { minLength: 1, maxLength: 4 }),
        { nil: null },
      ),
    }),
  )
  // A findOne parent has one result row; `distinct` would not change it.
  .map((testCase) =>
    testCase.parentForm === `findOne`
      ? { ...testCase, distinct: false }
      : testCase,
  )

type WindowUnit = { key: string; rank: number; group: string }
type ShownRow = { key: string; rank: number; group: string; kids: unknown }
type ObservedKid = { id: string; grand?: Iterable<{ id: string }> }

/** The rows the window may show: parents, or distinct (rank, group) pairs. */
function windowUnits(
  parents: Iterable<WindowParent>,
  distinct: boolean,
): Array<WindowUnit> {
  const units = new Map<string, WindowUnit>()
  for (const parent of parents) {
    const key = distinct ? `${parent.rank}|${parent.group}` : parent.id
    units.set(key, { key, rank: parent.rank, group: parent.group })
  }
  return [...units.values()]
}

/** A group's include value in the given form, from the model's rows. */
function modelKids(
  group: string,
  form: ChildForm,
  allChildren: ReadonlyMap<string, WindowChild>,
  grandchildren: ReadonlyMap<string, WindowGrandchild>,
  kept: ReadonlySet<string> | undefined,
): unknown {
  const children = new Map(
    [...allChildren].filter(([id]) => !kept || kept.has(id)),
  )
  const grandOf = (childId: string) =>
    [...grandchildren.values()]
      .filter((grandchild) => grandchild.childId === childId)
      .map((grandchild) => grandchild.id)
      .sort()
  const rows = [...children.values()].filter((child) => child.group === group)
  const byN = rows.sort((left, right) => right.n - left.n)
  if (form === `materialize` || form === `collection`) {
    return rows.map((child) => child.id).sort()
  }
  if (form === `nested`) {
    return rows
      .map((child) => ({ id: child.id, grand: grandOf(child.id) }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }
  if (form === `limited-nested`) {
    return byN
      .slice(0, 2)
      .map((child) => ({ id: child.id, grand: grandOf(child.id) }))
  }
  if (form === `findOne`) return byN[0]?.id ?? null
  const ordered = byN.map((child) => child.id)
  return form === `limited` ? ordered.slice(0, 2) : ordered
}

/** The include value a shown row carries, in the model's representation. */
function observeKids(kids: unknown, form: ChildForm): unknown {
  if (form === `findOne`)
    return (kids as { id: string } | undefined)?.id ?? null
  const rows = [
    ...(form === `collection`
      ? (kids as { toArray: Array<ObservedKid> }).toArray
      : (kids as Iterable<ObservedKid>)),
  ]
  if (form === `nested` || form === `limited-nested`) {
    const withGrand = rows.map((row) => ({
      id: row.id,
      grand: [...(row.grand ?? [])].map((grandchild) => grandchild.id).sort(),
    }))
    return form === `nested`
      ? withGrand.sort((left, right) => left.id.localeCompare(right.id))
      : withGrand
  }
  const ids = rows.map((row) => row.id)
  return form === `materialize` || form === `collection` ? ids.sort() : ids
}

/**
 * An on-demand child source. Its provider serves each load from the model's
 * rows by the request's predicate, keeps a ledger of sent rows, and forwards
 * a later change only for a sent row or a row a served predicate matches.
 * `work` counts the rows its loads serve, not forwarded changes.
 */
function createOnDemandChildren(initial: Array<WindowChild>) {
  const truth = new Map(initial.map((child) => [child.id, child]))
  const sent = new Set<string>()
  const wheres: Array<LoadSubsetOptions[`where`]> = []
  let work = 0
  let controls:
    | {
        begin: () => void
        write: (message: {
          type: `insert` | `delete`
          value: WindowChild
        }) => void
        commit: () => unknown
      }
    | undefined
  const matches = (where: LoadSubsetOptions[`where`], row: WindowChild) =>
    where === undefined ||
    evaluateReferenceExpression(
      where as Parameters<typeof evaluateReferenceExpression>[0],
      row,
    ) === true
  const collection = createCollection<WindowChild, string>({
    id: `window-children-on-demand-${nextCollectionId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        controls = { begin, write, commit }
        markReady()
        return {
          loadSubset: (options) => {
            wheres.push(options.where)
            const page = [...truth.values()].filter(
              (row) => !sent.has(row.id) && matches(options.where, row),
            )
            work += page.length
            if (page.length === 0) return true
            begin()
            for (const row of page) {
              sent.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            commit()
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  return {
    collection,
    work: () => work,
    change: (type: `insert` | `delete`, row: WindowChild) => {
      if (type === `insert`) truth.set(row.id, row)
      else truth.delete(row.id)
      const forward =
        type === `delete`
          ? sent.delete(row.id)
          : wheres.some((where) => matches(where, row))
      if (!forward) return
      if (type === `insert`) sent.add(row.id)
      controls!.begin()
      controls!.write({ type, value: row })
      controls!.commit()
    },
  }
}

/**
 * Runs one case and returns how many forward window moves its work bound
 * checked strictly, the reach a generated campaign must show.
 */
async function checkWindowedIncludeWork(testCase: WindowCase): Promise<number> {
  let strictForwardMoves = 0
  const parents = new Map<string, WindowParent>()
  const children = new Map<string, WindowChild>()
  const grandchildren = new Map<string, WindowGrandchild>()
  let nextRank = 0
  let nextChild = 0
  let nextGroup = testCase.groups
  const addChildren = (group: string, count: number) => {
    const added: Array<WindowChild> = []
    for (let index = 0; index < count; index++) {
      const child = { id: `child-${nextChild}`, group, n: nextChild++ }
      children.set(child.id, child)
      added.push(child)
      const grandchild = { id: `grand-${child.id}`, childId: child.id }
      grandchildren.set(grandchild.id, grandchild)
    }
    return added
  }
  for (let group = 0; group < testCase.groups; group++) {
    addChildren(`group-${group}`, testCase.childrenPerGroup)
  }
  for (let index = 0; index < testCase.parents; index++) {
    const parent = {
      id: `parent-${index}`,
      rank: (nextRank += 2),
      group: `group-${index % testCase.groups}`,
    }
    parents.set(parent.id, parent)
  }
  for (const [index, copy] of testCase.copies.entries()) {
    const source = [...parents.values()][copy.pick % parents.size]!
    const group = copy.group ? source.group : `group-${nextGroup++}`
    if (!copy.group) addChildren(group, testCase.childrenPerGroup)
    const parent = { id: `parent-copy-${index}`, rank: source.rank, group }
    parents.set(parent.id, parent)
  }
  const initialChildIds = [...children.keys()]
  const keptChildren = testCase.childFilter
    ? new Set(
        testCase.childFilter.map(
          (index) => initialChildIds[index % initialChildIds.length]!,
        ),
      )
    : undefined
  const filterGroups =
    testCase.parentFilter &&
    testCase.parentFilter.map((index) => `group-${index % testCase.groups}`)
  const keptParents = () =>
    [...parents.values()].filter(
      (parent) => !filterGroups || filterGroups.includes(parent.group),
    )

  const parentSource = createSourceCollection(`window-parents`, [
    ...parents.values(),
  ])
  const onDemand =
    testCase.childSource === `on-demand`
      ? createOnDemandChildren([...children.values()])
      : undefined
  const childSource = (onDemand?.collection ??
    createSourceCollection(`window-children`, [
      ...children.values(),
    ])) as unknown as Collection<WindowChild>
  const grandchildSource = createSourceCollection(`window-grandchildren`, [
    ...grandchildren.values(),
  ])
  let cleanupLive: (() => Promise<void>) | undefined
  let primary: { error: unknown } | undefined
  try {
    await Promise.all(
      [parentSource, grandchildSource, ...(onDemand ? [] : [childSource])].map(
        (source) => source.preload(),
      ),
    )
    parentSource.createIndex((row) => row.rank, { indexType: BTreeIndex })
    childSource.createIndex((row) => row.group, { indexType: BTreeIndex })
    grandchildSource.createIndex((row) => row.childId, {
      indexType: BTreeIndex,
    })
    const localChildWork = onDemand ? undefined : countSourceWork(childSource)
    const childWork = () => onDemand?.work() ?? localChildWork!().delivered
    const grandWork = countSourceWork(grandchildSource)
    // Change batches the parent Collection delivers to the query. More than
    // the step's own parent write (or, at preload, the initial load) means
    // the ordered loader acquired more rows: a refill or a tie load.
    let parentBatches = 0
    const subscribeParents = parentSource.subscribeChanges.bind(parentSource)
    parentSource.subscribeChanges = (callback, options) =>
      subscribeParents((changes) => {
        if (changes.length > 0) parentBatches++
        callback(changes)
      }, options)
    // A checkpoint's work bound, or none where the generated campaign
    // cannot bound a transient top-K row; a replay allows its overshoot.
    const workBound = (bound: number, loads: number) =>
      loads === 0
        ? bound
        : testCase.overshoot === undefined
          ? Number.POSITIVE_INFINITY
          : bound + testCase.overshoot
    const changeChild = async (type: `insert` | `delete`, row: WindowChild) => {
      if (onDemand) {
        onDemand.change(type, row)
        return
      }
      await (
        type === `insert` ? childSource.insert(row) : childSource.delete(row.id)
      ).isPersisted.promise
    }

    const live = createLiveQueryCollection((q) => {
      const grandOf = (childId: unknown) =>
        materialize(
          q
            .from({ grandchild: grandchildSource })
            .where(({ grandchild }) => eq(grandchild.childId, childId))
            .select(({ grandchild }) => ({ id: grandchild.id })),
        )
      const kidsOf = (group: unknown) => {
        const inGroup = q
          .from({ child: childSource })
          .where(({ child }) => eq(child.group, group))
        const groupChildren = keptChildren
          ? inGroup.where(({ child }) =>
              keptChildren.size === 1
                ? eq(child.id, [...keptChildren][0])
                : inArray(child.id, [...keptChildren]),
            )
          : inGroup
        const byN = groupChildren.orderBy(({ child }) => child.n, `desc`)
        switch (testCase.childForm) {
          case `materialize`:
            return materialize(
              groupChildren.select(({ child }) => ({ id: child.id })),
            )
          case `collection`:
            return include(
              groupChildren.select(({ child }) => ({ id: child.id })),
            )
          case `nested`:
            return materialize(
              groupChildren.select(({ child }) => ({
                id: child.id,
                grand: grandOf(child.id),
              })),
            )
          case `limited-nested`:
            return toArray(
              byN.limit(2).select(({ child }) => ({
                id: child.id,
                grand: grandOf(child.id),
              })),
            )
          case `findOne`:
            return materialize(
              byN.select(({ child }) => ({ id: child.id })).findOne(),
            )
          case `limited`:
            return toArray(
              byN.limit(2).select(({ child }) => ({ id: child.id })),
            )
          case `ordered`:
            return toArray(byN.select(({ child }) => ({ id: child.id })))
        }
      }
      const parentRows = q.from({ parent: parentSource })
      const filtered = !filterGroups
        ? parentRows
        : parentRows.where(({ parent }) =>
            filterGroups.length === 1
              ? eq(parent.group, filterGroups[0])
              : inArray(parent.group, filterGroups),
          )
      const ordered = filtered.orderBy(
        ({ parent }) => parent.rank,
        testCase.direction,
      )
      const windowed =
        testCase.parentForm === `orderOnly`
          ? ordered
          : testCase.parentForm === `findOne`
            ? testCase.findOneOffset === false
              ? ordered
              : ordered.offset(testCase.offset)
            : ordered.offset(testCase.offset).limit(testCase.limit)
      const selected = testCase.distinct
        ? windowed
            .select(({ parent }) => ({
              rank: parent.rank,
              group: parent.group,
              kids: kidsOf(parent.group),
            }))
            .distinct()
        : windowed.select(({ parent }) => ({
            id: parent.id,
            rank: parent.rank,
            group: parent.group,
            kids: kidsOf(parent.group),
          }))
      return testCase.parentForm === `findOne`
        ? (selected.findOne() as unknown as typeof selected)
        : selected
    })
    cleanupLive = () => live.cleanup()

    let shown =
      testCase.parentForm === `orderOnly`
        ? { offset: 0, limit: Number.POSITIVE_INFINITY }
        : testCase.parentForm === `findOne`
          ? {
              offset: testCase.findOneOffset === false ? 0 : testCase.offset,
              limit: 1,
            }
          : { offset: testCase.offset, limit: testCase.limit }
    // A findOne's window keeps its compiled limit, 1, and setWindow may move
    // only its offset. A window requested before the live query starts
    // replaces the compiled one before its first load.
    const windowFor = (window: { offset: number; limit: number }) =>
      testCase.parentForm === `findOne` ? { offset: window.offset } : window
    const startWindow = testCase.startWindow
    const startSettled = startWindow
      ? live.utils.setWindow(windowFor(startWindow))
      : true
    if (startWindow) shown = { ...shown, ...windowFor(startWindow) }
    const sign = testCase.direction === `asc` ? 1 : -1
    const sortedUnits = () =>
      windowUnits(keptParents(), testCase.distinct).sort(
        (left, right) => sign * (left.rank - right.rank),
      )
    const shownRows = (): Array<ShownRow> =>
      (
        live.toArray as unknown as Array<{
          id?: string
          rank: number
          group: string
          kids: unknown
        }>
      ).map((row) => ({
        key: testCase.distinct ? `${row.rank}|${row.group}` : row.id!,
        rank: row.rank,
        group: row.group,
        kids: observeKids(row.kids, testCase.childForm),
      }))
    const expectWindow = (label: string): Array<ShownRow> => {
      const units = sortedUnits()
      const actual = shownRows()
      expect(
        actual.map((row) => row.rank),
        `${label}: ranks`,
      ).toEqual(
        units
          .slice(shown.offset, shown.offset + shown.limit)
          .map((unit) => unit.rank),
      )
      const byKey = new Map(units.map((unit) => [unit.key, unit]))
      for (const row of actual) {
        const unit = byKey.get(row.key)
        expect(unit, `${label}: ${row.key} is a unit`).toBeDefined()
        expect([row.rank, row.group], `${label}: ${row.key}`).toEqual([
          unit!.rank,
          unit!.group,
        ])
        expect(row.kids, `${label}: ${row.key} include`).toEqual(
          modelKids(
            row.group,
            testCase.childForm,
            children,
            grandchildren,
            keptChildren,
          ),
        )
      }
      expect(
        new Set(actual.map((row) => row.key)).size,
        `${label}: distinct rows`,
      ).toBe(actual.length)
      return actual
    }
    const childrenOf = (rows: Iterable<ShownRow>) => {
      const groups = new Set([...rows].map((row) => row.group))
      return [...children.values()].filter((child) => groups.has(child.group))
        .length
    }
    // Children whose grandchildren an include shows, by id.
    const shownKids = (rows: Iterable<ShownRow>) =>
      new Set(
        [...rows].flatMap((row) =>
          testCase.childForm === `nested` ||
          testCase.childForm === `limited-nested`
            ? (row.kids as Array<{ id: string }>).map((kid) => kid.id)
            : [],
        ),
      )
    const grandchildrenOf = (kids: ReadonlySet<string>) =>
      [...grandchildren.values()].filter((grandchild) =>
        kids.has(grandchild.childId),
      ).length

    await live.preload()
    if (startSettled !== true) await startSettled
    await new Promise((resolve) => setTimeout(resolve, 0))
    let before = expectWindow(`rows after preload`)
    expect(live.utils.getWindow(), `window after preload`).toEqual(shown)
    const preloadLoads = Math.max(0, parentBatches - 1)
    expect(childWork(), `child rows loaded by preload`).toBeLessThanOrEqual(
      workBound(childrenOf(before), preloadLoads),
    )
    expect(
      grandWork().delivered,
      `grandchild rows loaded by preload`,
    ).toBeLessThanOrEqual(
      workBound(grandchildrenOf(shownKids(before)), preloadLoads),
    )

    let windowBefore: { offset: number; limit: number } | undefined
    for (const [step, command] of testCase.history.entries()) {
      windowBefore = undefined
      const childBefore = childWork()
      const grandBefore = grandWork().delivered
      const batchesBefore = parentBatches
      const ids = [...parents.keys()]
      const childIds = [...children.keys()]
      if (command.type === `insert-parent`) {
        const source =
          command.copy === null || ids.length === 0
            ? undefined
            : parents.get(ids[command.copy % ids.length]!)!
        const group = source?.group ?? `group-${nextGroup++}`
        if (!source) {
          const added = addChildren(group, testCase.childrenPerGroup)
          for (const child of added) await changeChild(`insert`, child)
          await grandchildSource.insert(
            added.map((child) => grandchildren.get(`grand-${child.id}`)!),
          ).isPersisted.promise
        }
        const parent = {
          id: `parent-new-${step}`,
          rank: source?.rank ?? (nextRank += 2) - 1,
          group,
        }
        parents.set(parent.id, parent)
        await parentSource.insert(parent).isPersisted.promise
      } else if (command.type === `delete-parent`) {
        if (ids.length === 0) continue
        const id = ids[command.pick % ids.length]!
        parents.delete(id)
        await parentSource.delete(id).isPersisted.promise
      } else if (command.type === `rank`) {
        if (ids.length === 0) continue
        const id = ids[command.pick % ids.length]!
        // Move the parent past every other rank, so it crosses the window.
        const ranks = [...parents.values()].map((parent) => parent.rank)
        const rank = command.up
          ? Math.max(...ranks) + 1
          : Math.min(...ranks) - 1
        parents.set(id, { ...parents.get(id)!, rank })
        await parentSource.update(id, (draft) => {
          draft.rank = rank
        }).isPersisted.promise
      } else if (command.type === `insert-child`) {
        const groups = [...new Set([...parents.values()].map((p) => p.group))]
        if (groups.length === 0) continue
        const child = {
          id: `child-${nextChild}`,
          group: groups[command.pick % groups.length]!,
          n: nextChild++,
        }
        children.set(child.id, child)
        await changeChild(`insert`, child)
      } else if (command.type === `delete-child`) {
        if (childIds.length === 0) continue
        const child = children.get(childIds[command.pick % childIds.length]!)!
        children.delete(child.id)
        await changeChild(`delete`, child)
      } else {
        windowBefore = shown
        const requested = windowFor({
          offset: command.offset,
          limit: command.limit,
        })
        shown = { ...shown, ...requested }
        const settled = live.utils.setWindow(requested)
        if (settled !== true) await settled
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      const after = expectWindow(`rows after step ${step}`)
      expect(live.utils.getWindow(), `window after step ${step}`).toEqual(shown)
      const beforeKeys = new Set(before.map((row) => row.key))
      const shownGroups = new Set(before.map((row) => row.group))
      // A step may newly load only the groups of rows that entered the
      // window and were not shown before it.
      const loadable = new Set(
        after
          .filter((row) => !beforeKeys.has(row.key))
          .map((row) => row.group)
          .filter((group) => !shownGroups.has(group)),
      )
      const kidsBefore = shownKids(before)
      const kidsEntered = new Set(
        [...shownKids(after)].filter((kid) => !kidsBefore.has(kid)),
      )
      const parentWrite =
        command.type === `insert-parent` ||
        command.type === `delete-parent` ||
        command.type === `rank`
          ? 1
          : 0
      const stepLoads = Math.max(0, parentBatches - batchesBefore - parentWrite)
      if (
        command.type === `move` &&
        command.offset > (windowBefore?.offset ?? 0) &&
        (stepLoads === 0 || testCase.overshoot === 0)
      ) {
        strictForwardMoves++
      }
      // Child rows the step writes reach a local subscription whether or not
      // their group is loaded, so each counts once: a fresh parent's group,
      // or one inserted or deleted child.
      // The grandchild source is always local; a fresh group writes one
      // grandchild per child.
      const freshGroup =
        command.type === `insert-parent` && command.copy === null
          ? testCase.childrenPerGroup
          : 0
      const written = onDemand
        ? 0
        : command.type === `insert-child` || command.type === `delete-child`
          ? 1
          : freshGroup
      expect(
        childWork() - childBefore,
        `child rows loaded by step ${step}`,
      ).toBeLessThanOrEqual(
        workBound(
          [...children.values()].filter((child) => loadable.has(child.group))
            .length + written,
          stepLoads,
        ),
      )
      expect(
        grandWork().delivered - grandBefore,
        `grandchild rows loaded by step ${step}`,
      ).toBeLessThanOrEqual(
        workBound(grandchildrenOf(kidsEntered) + freshGroup, stepLoads),
      )
      before = after
    }
    return strictForwardMoves
  } catch (error) {
    primary = { error }
    throw error
  } finally {
    await runCleanups(
      [
        async () => cleanupLive?.(),
        async () => parentSource.cleanup(),
        async () => childSource.cleanup(),
        async () => grandchildSource.cleanup(),
      ],
      primary,
    )
  }
}

// Enough runs that each dimension appears at the default multiplier; the
// reconstruction check below counts them.
const WINDOW_RUNS = 60

/** A pinned case: its strict forward-move tally is not reach evidence. */
async function expectWindowedIncludeWork(testCase: WindowCase): Promise<void> {
  await checkWindowedIncludeWork(testCase)
}

const pinnedWindowCase: WindowCase = {
  parents: 8,
  groups: 8,
  copies: [],
  childrenPerGroup: 2,
  childForm: `materialize`,
  childSource: `local`,
  parentForm: `page`,
  parentFilter: null,
  direction: `asc`,
  distinct: false,
  offset: 0,
  limit: 2,
  history: [],
}

describe(`includes work under an ordered parent window`, () => {
  it.each([false, true])(
    `loads children only for a late page's parents (distinct=%s)`,
    (distinct) =>
      expectWindowedIncludeWork({
        ...pinnedWindowCase,
        parents: 40,
        groups: 40,
        childrenPerGroup: 3,
        direction: `desc`,
        distinct,
        offset: 20,
        history: [{ type: `move`, offset: 10, limit: 3 }],
      }),
  )

  it.each([`ordered`, `limited`, `limited-nested`] as const)(
    `moves the parent window, not the %s child's`,
    (childForm) =>
      expectWindowedIncludeWork({
        ...pinnedWindowCase,
        childForm,
        history: [{ type: `move`, offset: 3, limit: 2 }],
      }),
  )

  it(`collapses parents whose selected values match under distinct`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      copies: [
        { pick: 1, group: true },
        { pick: 2, group: false },
      ],
      distinct: true,
      limit: 3,
      history: [{ type: `insert-parent`, copy: 3 }],
    }))

  it(`creates no static child demand from a static parent filter`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      childSource: `on-demand`,
      parentFilter: [0, 1, 2, 3, 4],
      offset: 3,
      limit: 1,
    }))

  // On demand, a group's children arrive only through a load, so a fresh
  // parent past the narrowed window must not load them.
  it(`stops routing rows that setWindow drops from an orderBy-only parent`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      childrenPerGroup: 3,
      childSource: `on-demand`,
      parentForm: `orderOnly`,
      history: [
        { type: `move`, offset: 0, limit: 2 },
        { type: `insert-parent`, copy: null },
      ],
    }))

  it(`loads one page of children for a findOne parent`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      childForm: `findOne`,
      parentForm: `findOne`,
      offset: 5,
    }))

  // An include child's orderBy gives the parent no window to move, so an
  // unordered parent rejects setWindow instead of moving the child windows.
  it(`rejects setWindow on an unordered parent with an ordered child`, async () => {
    const parentSource = createSourceCollection(`unordered-parents`, [
      { id: `parent-0`, group: `group-0` },
    ])
    const childSource = createSourceCollection(`unordered-children`, [
      { id: `child-0`, group: `group-0`, n: 0 },
    ])
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parentSource }).select(({ parent }) => ({
        id: parent.id,
        kids: toArray(
          q
            .from({ child: childSource })
            .where(({ child }) => eq(child.group, parent.group))
            .orderBy(({ child }) => child.n)
            .limit(1),
        ),
      })),
    )
    try {
      await live.preload()
      expect(() => live.utils.setWindow({ offset: 0, limit: 1 })).toThrow(
        SetWindowRequiresOrderByError,
      )
    } finally {
      await runCleanups([
        () => live.cleanup(),
        () => parentSource.cleanup(),
        () => childSource.cleanup(),
      ])
    }
  })

  // A window requested before start can drop rows a static filter names,
  // so static child demand must not load their children.
  it(`creates no static child demand under a window requested before start`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      childForm: `ordered`,
      childSource: `on-demand`,
      parentForm: `orderOnly`,
      parentFilter: [0, 1, 2, 3, 4, 5],
      startWindow: { offset: 0, limit: 1 },
    }))

  // A child's static filter names a child whose parent the window drops, so
  // its grandchild demand must wait for the window too.
  it(`creates no static grandchild demand below a windowed parent`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      parents: 10,
      groups: 10,
      childrenPerGroup: 1,
      childForm: `nested`,
      limit: 1,
      childFilter: [5],
    }))

  // A window requested before start that moves a findOne past its one named
  // correlation value drops that row, so its children must not load; one at
  // offset 0 drops nothing, so its static demand still starts at once.
  it(`creates no static child demand for a findOne moved past its named value before start`, () =>
    expectWindowedIncludeWork({
      ...pinnedWindowCase,
      parents: 21,
      groups: 11,
      childrenPerGroup: 1,
      parentForm: `findOne`,
      findOneOffset: false,
      parentFilter: [10],
      startWindow: { offset: 1, limit: 1 },
    }))

  // Forward moves load more parent rows, so the generated campaigns cannot
  // check them strictly; these do, with no overshoot allowed.
  it.each([
    [`local`, false],
    [`local`, true],
    [`on-demand`, false],
    [`on-demand`, true],
  ] as const)(
    `moves the window forward strictly (%s children, distinct=%s)`,
    (childSource, distinct) =>
      expectWindowedIncludeWork({
        ...pinnedWindowCase,
        parents: 40,
        groups: 40,
        childrenPerGroup: 2,
        childSource,
        distinct,
        history: [
          { type: `move`, offset: 20, limit: 2 },
          { type: `move`, offset: 30, limit: 2 },
        ],
        overshoot: 0,
      }),
  )

  // Replays of transient top-K rows (#2151). Each shows the correct
  // rows and loads one child row beyond the bound, at a checkpoint where the
  // parent's ordered acquisition had not completed: a held row moved past every
  // other rank, a tie loaded at the window edge during preload, and a window
  // move while the loader refills. A larger overshoot fails.
  const transient: Array<[string, WindowCase]> = [
    [
      `a desc held row moved to the lowest rank`,
      {
        ...pinnedWindowCase,
        parents: 24,
        groups: 12,
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 1,
        limit: 1,
        history: [{ type: `rank`, pick: 1_257_390_839, up: false }],
      },
    ],
    [
      `an asc held row moved to the highest rank`,
      {
        ...pinnedWindowCase,
        parents: 36,
        groups: 18,
        childrenPerGroup: 1,
        offset: 1,
        limit: 1,
        history: [{ type: `rank`, pick: 0, up: true }],
      },
    ],
    [
      `a tie at the window edge during preload (late page)`,
      {
        ...pinnedWindowCase,
        parents: 38,
        groups: 19,
        copies: [{ pick: 735_689_178, group: false }],
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 17,
        limit: 1,
      },
    ],
    [
      `ties at the window edge during preload (two rows)`,
      {
        ...pinnedWindowCase,
        parents: 33,
        groups: 17,
        copies: [
          { pick: 0, group: false },
          { pick: 0, group: false },
          { pick: 0, group: false },
          { pick: 1_163_054_548, group: false },
        ],
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 3,
        limit: 2,
      },
    ],
    [
      `ties at the window edge during preload (first row)`,
      {
        ...pinnedWindowCase,
        parents: 11,
        groups: 6,
        copies: [
          { pick: 0, group: false },
          { pick: 0, group: false },
          { pick: 1_080_707_742, group: false },
        ],
        childrenPerGroup: 1,
        direction: `desc`,
        offset: 0,
        limit: 1,
      },
    ],
    [
      `a window move while the loader refills`,
      {
        ...pinnedWindowCase,
        parents: 33,
        groups: 17,
        childrenPerGroup: 1,
        offset: 1,
        limit: 2,
        history: [
          { type: `rank`, pick: 29_374_524, up: false },
          { type: `insert-parent`, copy: 5 },
          { type: `move`, offset: 4, limit: 1 },
        ],
      },
    ],
  ]
  it.each(transient)(`bounds a transient top-K row: %s`, (_, testCase) =>
    expectWindowedIncludeWork({ ...testCase, overshoot: 1 }),
  )

  // The same replays fail when no overshoot is allowed, so each one reaches
  // a transient row and the loader-activity observation sees it.
  it.each(transient)(
    `reaches a transient top-K row: %s`,
    async (_, testCase) => {
      await expect(
        checkWindowedIncludeWork({ ...testCase, overshoot: 0 }),
      ).rejects.toThrow(/child rows loaded by/)
    },
  )

  // Reconstruction: the fixed campaign's executed cases reach each premise.
  it(`reaches every window dimension in the executed fixed cases`, () => {
    const cases = fc
      .sample(fc.tuple(windowCase), {
        numRuns: oracleRuns(WINDOW_RUNS),
        seed: 2137,
      })
      .map(([testCase]) => testCase)
    const count = (premise: (testCase: WindowCase) => boolean) =>
      cases.filter(premise).length
    for (const [premise, reached] of [
      [`on-demand child`, count((c) => c.childSource === `on-demand`)],
      [`static filter`, count((c) => c.parentFilter !== null)],
      [`limited-nested`, count((c) => c.childForm === `limited-nested`)],
      [`page parent`, count((c) => c.parentForm === `page`)],
      [`findOne parent`, count((c) => c.parentForm === `findOne`)],
      [
        `orderBy-only parent moved by setWindow`,
        count(
          (c) =>
            c.parentForm === `orderOnly` &&
            c.history.some((command) => command.type === `move`),
        ),
      ],
      [
        `on-demand static filter`,
        count((c) => c.childSource === `on-demand` && c.parentFilter !== null),
      ],
      [
        `findOne parent without offset`,
        count((c) => c.parentForm === `findOne` && c.findOneOffset === false),
      ],
      [
        `orderBy-only parent with a static filter`,
        count((c) => c.parentForm === `orderOnly` && c.parentFilter !== null),
      ],
      [
        `window requested before start`,
        count((c) => c.parentForm !== `findOne` && c.startWindow !== null),
      ],
    ] as const) {
      expect(reached, premise).toBeGreaterThanOrEqual(3)
    }
  })

  for (const campaign of campaigns(
    2137,
    `includes-work.ordered-window`,
    WINDOW_RUNS,
  )) {
    // Reach witness: the campaign's own runs must check some forward
    // window moves strictly. A failing run throws before the tally is read,
    // so shrinking never counts.
    it(
      `a parent window bounds child loading (${campaign.name})`,
      async () => {
        let strictForwardMoves = 0
        await fc.assert(
          fc.asyncProperty(windowCase, async (testCase) => {
            strictForwardMoves += await checkWindowedIncludeWork(testCase)
          }),
          campaign.options,
        )
        expect(
          strictForwardMoves,
          `strictly checked forward moves`,
        ).toBeGreaterThan(0)
      },
      // Each run builds its own Collections; allow time per run.
      oracleRuns(WINDOW_RUNS) * 100,
    )
  }
})

/**
 * # Static demand and window ownership
 *
 * A static parent filter that names one row of a `findOne` with no `offset`
 * leaves the window nothing to drop, so the include may create that child's
 * demand at once: a detail page starts its child acquisition attempt beside
 * its parent acquisition attempt instead of after the parent's rows arrive.
 * Each test's `loadSubset` handler stands in for both the sync adapter and the
 * provider, and records each acquisition attempt in order. Only the query's
 * own window answers `setWindow`; a window inside a `from` or a joined
 * subquery never does.
 */
describe(`static include demand and setWindow ownership`, () => {
  // A window requested before start at offset 0 drops nothing, so it keeps
  // the static demand.
  it.each([null, { offset: 0 }] as const)(
    `starts a findOne detail page's child load beside its parent load (window before start: %o)`,
    async (startWindow) => {
      const calls: Array<string> = []
      let releaseParent!: () => void
      const parentHeld = new Promise<void>((resolve) => {
        releaseParent = resolve
      })
      const parents = createCollection<{ id: string }, string>({
        id: `detail-parents-${nextCollectionId++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                calls.push(`parent`)
                return parentHeld.then(() => {
                  begin()
                  write({ type: `insert`, value: { id: `parent-1` } })
                  commit()
                })
              },
            }
          },
        },
      })
      const children = createCollection<
        { id: string; parentId: string },
        string
      >({
        id: `detail-children-${nextCollectionId++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                calls.push(`child`)
                begin()
                write({
                  type: `insert`,
                  value: { id: `child-1`, parentId: `parent-1` },
                })
                commit()
                return true
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection({
        startSync: false,
        query: (q) =>
          q
            .from({ parent: parents })
            .where(({ parent }) => eq(parent.id, `parent-1`))
            .select(({ parent }) => ({
              id: parent.id,
              kids: toArray(
                q
                  .from({ child: children })
                  .where(({ child }) => eq(child.parentId, parent.id))
                  .select(({ child }) => ({ id: child.id })),
              ),
            }))
            .findOne(),
      })
      if (startWindow) {
        const settled = live.utils.setWindow(startWindow)
        if (settled !== true) void settled.catch(() => {})
      }
      try {
        const ready = live.toArrayWhenReady()
        await new Promise((resolve) => setTimeout(resolve, 0))
        // The child acquisition attempt has started while the parent's is held.
        expect(calls).toEqual([`parent`, `child`])
        releaseParent()
        await ready
        expect(
          (
            live.toArray as unknown as Array<{
              id: string
              kids: Array<{ id: string }>
            }>
          ).map((row) => ({ id: row.id, kids: row.kids.map((kid) => kid.id) })),
        ).toEqual([{ id: `parent-1`, kids: [`child-1`] }])
        expect(calls).toEqual([`parent`, `child`])
      } finally {
        releaseParent()
        await runCleanups([
          () => live.cleanup(),
          () => parents.cleanup(),
          () => children.cleanup(),
        ])
      }
    },
  )

  // A findOne with limit 0 shows no row, so its named correlation value's child must
  // not load.
  it(`starts no child acquisition for a findOne with limit 0`, async () => {
    const calls: Array<string> = []
    const onDemand = <T extends { id: string }>(name: string, rows: Array<T>) =>
      createCollection<T, string>({
        id: `limit-zero-${name}-${nextCollectionId++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                calls.push(name)
                begin()
                for (const value of rows) write({ type: `insert`, value })
                commit()
                return true
              },
            }
          },
        },
      })
    const parents = onDemand(`parent`, [{ id: `parent-1` }])
    const children = onDemand(`child`, [
      { id: `child-1`, parentId: `parent-1` },
    ])
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ parent: parents })
          .where(({ parent }) => eq(parent.id, `parent-1`))
          .select(({ parent }) => ({
            id: parent.id,
            kids: toArray(
              q
                .from({ child: children })
                .where(({ child }) => eq(child.parentId, parent.id)),
            ),
          }))
          .orderBy(({ parent }) => parent.id)
          .limit(0)
          .findOne(),
    })
    try {
      await live.toArrayWhenReady()
      expect(calls).not.toContain(`child`)
      expect(live.toArray).toEqual([])
    } finally {
      await runCleanups([
        () => live.cleanup(),
        () => parents.cleanup(),
        () => children.cleanup(),
      ])
    }
  })

  // A findOne keeps its compiled limit, and setWindow throws for any other
  // limit. An ordered findOne has a movable window; an unordered one is a
  // fixed one-row result that rejects offset moves.
  it(`keeps a findOne's compiled limit and moves only an ordered findOne`, async () => {
    const rows = createSourceCollection(
      `find-one-window-rows`,
      Array.from({ length: 4 }, (_, rank) => ({ id: `row-${rank}`, rank })),
    )
    const one = createLiveQueryCollection((q) =>
      q
        .from({ row: rows })
        .orderBy(({ row }) => row.rank)
        .findOne(),
    )
    const none = createLiveQueryCollection((q) =>
      q
        .from({ row: rows })
        .orderBy(({ row }) => row.rank)
        .limit(0)
        .findOne(),
    )
    const unordered = createLiveQueryCollection((q) =>
      q.from({ row: rows }).findOne(),
    )
    try {
      await Promise.all([one.preload(), none.preload(), unordered.preload()])
      expect(() => one.utils.setWindow({ offset: 0, limit: 3 })).toThrow(
        SetWindowFindOneLimitError,
      )
      for (const window of [{ offset: 2 }, { offset: 1, limit: 1 }]) {
        const settled = one.utils.setWindow(window)
        if (settled !== true) await settled
        expect(one.toArray.map((row) => row.id)).toEqual([
          `row-${window.offset}`,
        ])
        expect(one.utils.getWindow()).toEqual({
          offset: window.offset,
          limit: 1,
        })
      }
      const moved = none.utils.setWindow({ offset: 1 })
      if (moved !== true) await moved
      expect(none.toArray).toEqual([])
      expect(none.utils.getWindow()).toEqual({ offset: 1, limit: 0 })
      expect(() => none.utils.setWindow({ limit: 1 })).toThrow(
        SetWindowFindOneLimitError,
      )
      // A window is an ordered view: an unordered findOne keeps offset 0.
      expect(() => unordered.utils.setWindow({ offset: 1 })).toThrow(
        SetWindowRequiresOrderByError,
      )
      expect(unordered.utils.setWindow({ offset: 0 })).toBe(true)
      expect(unordered.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
    } finally {
      await runCleanups([
        () => one.cleanup(),
        () => none.cleanup(),
        () => unordered.cleanup(),
        () => rows.cleanup(),
      ])
    }
  })

  it.each([`from`, `join`] as const)(
    `rejects setWindow when only a %s subquery has a window`,
    async (placement) => {
      const rows = createSourceCollection(`owner-rows`, [
        { id: `row-0`, rank: 0 },
        { id: `row-1`, rank: 1 },
        { id: `row-2`, rank: 2 },
      ])
      const live = createLiveQueryCollection((q) => {
        const page = q
          .from({ row: rows })
          .orderBy(({ row }) => row.rank)
          .limit(2)
        return placement === `from`
          ? q.from({ page })
          : q
              .from({ row: rows })
              .join({ page }, ({ row, page: paged }) => eq(row.id, paged.id))
      })
      try {
        await live.preload()
        expect(() => live.utils.setWindow({ offset: 1, limit: 2 })).toThrow(
          SetWindowRequiresOrderByError,
        )
      } finally {
        await runCleanups([() => live.cleanup(), () => rows.cleanup()])
      }
    },
  )

  it(`moves the outer window, not a from subquery's`, async () => {
    const rows = createSourceCollection(
      `outer-owner-rows`,
      Array.from({ length: 6 }, (_, rank) => ({ id: `row-${rank}`, rank })),
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({
          page: q
            .from({ row: rows })
            .orderBy(({ row }) => row.rank)
            .limit(4),
        })
        .orderBy(({ page }) => page.rank)
        .limit(2),
    )
    try {
      await live.preload()
      const settled = live.utils.setWindow({ offset: 2, limit: 2 })
      if (settled !== true) await settled
      expect(live.toArray.map((row) => row.id)).toEqual([`row-2`, `row-3`])
    } finally {
      await runCleanups([() => live.cleanup(), () => rows.cleanup()])
    }
  })
})
