import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeAll, describe, expect, it } from 'vitest'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import type { Collection } from '../../src/collection/index.js'

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

function campaigns(fixedSeed: number, property: string) {
  return [
    {
      name: `fixed`,
      options: { numRuns: oracleRuns(6), seed: fixedSeed },
    },
    {
      name: `random or replayed`,
      options: oraclePropertyOptions(6, property),
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
 * An ordered, limited parent query shows only the rows in its window. Law 12
 * of the live-query architecture (Work) says irrelevant rows must not
 * activate unrelated routes. A parent row that `limit` or `offset` drops is
 * irrelevant to the result, so its include must not load child rows. The
 * same holds with `distinct`, which reads every parent row before the window.
 * Only the parent's window answers `setWindow`; an include child's own
 * `orderBy` or `limit` must not take it over.
 *
 * ## Model
 *
 * Parents have a rank and a group; children and their include correlate by
 * group, so parents of one group share their children. The model sorts the
 * shown units by rank and takes the window. A unit is a parent, or, with
 * `distinct`, one distinct (rank, group) pair, because the selected values
 * then omit the parent id and parents with equal rank and group collapse.
 * Ranks can tie, so the comparison accepts any tied units at the window edge:
 * the rank sequence must match, every shown row must be a unit with that
 * rank, and no unit may appear twice. Each shown row must carry its group's
 * children in the include form under test:
 *
 * - `materialize`: every child, in any order;
 * - `ordered`: every child by `n`, descending, with the child's own `orderBy`;
 * - `limited`: the first two of those, with the child's own `limit`;
 * - `nested`: every child with its own materialized grandchildren.
 *
 * ## Work
 *
 * Work is counted as child rows the child Collection delivers to the query.
 * A step may deliver at most the children of the groups of the rows shown
 * before or after it, of the first unit after each window, and of every unit
 * tied with a window edge, plus one changed child. A query that routes even
 * one or two rows before the window to its include delivers extra groups and
 * fails, as does one that loads children for every parent before the window.
 *
 * ## Histories
 *
 * Histories insert parents (fresh, or copying an existing rank and group),
 * delete parents, move a parent's rank past every other rank, insert and
 * delete children, and move the parent window with `setWindow`. Indexes exist
 * before the live query starts, and every step settles before it is checked.
 */
type WindowParent = { id: string; rank: number; group: string }
type WindowChild = { id: string; group: string; n: number }
type WindowGrandchild = { id: string; childId: string }
type ChildForm = `materialize` | `ordered` | `limited` | `nested`

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
  direction: `asc` | `desc`
  distinct: boolean
  offset: number
  limit: number
  history: Array<WindowCommand>
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
        `ordered` as const,
        `limited` as const,
        `nested` as const,
      ),
      direction: fc.constantFrom(`asc` as const, `desc` as const),
      distinct: fc.boolean(),
      offset: fc.integer({ min: 0, max: 20 }),
      limit: fc.integer({ min: 1, max: 4 }),
      history: fc.array(windowCommand, { maxLength: 8 }),
    }),
  )

type WindowUnit = { key: string; rank: number; group: string }
type ShownRow = { key: string; rank: number; group: string; kids: unknown }

/** The rows the window may show: parents, or distinct (rank, group) pairs. */
function windowUnits(
  parents: ReadonlyMap<string, WindowParent>,
  distinct: boolean,
): Array<WindowUnit> {
  const units = new Map<string, WindowUnit>()
  for (const parent of parents.values()) {
    const key = distinct ? `${parent.rank}|${parent.group}` : parent.id
    units.set(key, { key, rank: parent.rank, group: parent.group })
  }
  return [...units.values()]
}

/** A group's include value in the given form, from the model's rows. */
function modelKids(
  group: string,
  form: ChildForm,
  children: ReadonlyMap<string, WindowChild>,
  grandchildren: ReadonlyMap<string, WindowGrandchild>,
): unknown {
  const rows = [...children.values()].filter((child) => child.group === group)
  if (form === `materialize`) return rows.map((child) => child.id).sort()
  if (form === `nested`) {
    return rows
      .map((child) => ({
        id: child.id,
        grand: [...grandchildren.values()]
          .filter((grandchild) => grandchild.childId === child.id)
          .map((grandchild) => grandchild.id)
          .sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }
  const ordered = rows
    .sort((left, right) => right.n - left.n)
    .map((child) => child.id)
  return form === `limited` ? ordered.slice(0, 2) : ordered
}

/** The include value a shown row carries, in the model's representation. */
function observeKids(kids: unknown, form: ChildForm): unknown {
  const rows = [...(kids as Iterable<{ id: string; grand?: unknown }>)]
  if (form === `materialize`) return rows.map((row) => row.id).sort()
  if (form === `nested`) {
    return rows
      .map((row) => ({
        id: row.id,
        grand: [...(row.grand as Iterable<{ id: string }>)]
          .map((grandchild) => grandchild.id)
          .sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }
  return rows.map((row) => row.id)
}

async function checkWindowedIncludeWork(testCase: WindowCase): Promise<void> {
  const parents = new Map<string, WindowParent>()
  const children = new Map<string, WindowChild>()
  const grandchildren = new Map<string, WindowGrandchild>()
  let nextRank = 0
  let nextChild = 0
  let nextGroup = testCase.groups
  const addChildren = (group: string, count: number) => {
    for (let index = 0; index < count; index++) {
      const child = { id: `child-${nextChild}`, group, n: nextChild++ }
      children.set(child.id, child)
      const grandchild = { id: `grand-${child.id}`, childId: child.id }
      grandchildren.set(grandchild.id, grandchild)
    }
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

  const parentSource = createSourceCollection(`window-parents`, [
    ...parents.values(),
  ])
  const childSource = createSourceCollection(`window-children`, [
    ...children.values(),
  ])
  const grandchildSource = createSourceCollection(`window-grandchildren`, [
    ...grandchildren.values(),
  ])
  let cleanupLive: (() => Promise<void>) | undefined
  let primary: { error: unknown } | undefined
  try {
    await Promise.all(
      [parentSource, childSource, grandchildSource].map((source) =>
        source.preload(),
      ),
    )
    parentSource.createIndex((row) => row.rank, { indexType: BTreeIndex })
    childSource.createIndex((row) => row.group, { indexType: BTreeIndex })
    grandchildSource.createIndex((row) => row.childId, {
      indexType: BTreeIndex,
    })
    const childWork = countSourceWork(childSource)

    const live = createLiveQueryCollection((q) => {
      const kidsOf = (group: unknown) => {
        const groupChildren = q
          .from({ child: childSource })
          .where(({ child }) => eq(child.group, group))
        if (testCase.childForm === `materialize`) {
          return materialize(
            groupChildren.select(({ child }) => ({ id: child.id })),
          )
        }
        if (testCase.childForm === `nested`) {
          return materialize(
            groupChildren.select(({ child }) => ({
              id: child.id,
              grand: materialize(
                q
                  .from({ grandchild: grandchildSource })
                  .where(({ grandchild }) => eq(grandchild.childId, child.id))
                  .select(({ grandchild }) => ({ id: grandchild.id })),
              ),
            })),
          )
        }
        const ordered = groupChildren.orderBy(({ child }) => child.n, `desc`)
        return toArray(
          (testCase.childForm === `limited`
            ? ordered.limit(2)
            : ordered
          ).select(({ child }) => ({ id: child.id })),
        )
      }
      const page = q
        .from({ parent: parentSource })
        .orderBy(({ parent }) => parent.rank, testCase.direction)
        .offset(testCase.offset)
        .limit(testCase.limit)
      return testCase.distinct
        ? page
            .select(({ parent }) => ({
              rank: parent.rank,
              group: parent.group,
              kids: kidsOf(parent.group),
            }))
            .distinct()
        : page.select(({ parent }) => ({
            id: parent.id,
            rank: parent.rank,
            group: parent.group,
            kids: kidsOf(parent.group),
          }))
    })
    cleanupLive = () => live.cleanup()

    let shown = { offset: testCase.offset, limit: testCase.limit }
    const sign = testCase.direction === `asc` ? 1 : -1
    const sortedUnits = () =>
      windowUnits(parents, testCase.distinct).sort(
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
          modelKids(row.group, testCase.childForm, children, grandchildren),
        )
      }
      expect(
        new Set(actual.map((row) => row.key)).size,
        `${label}: distinct rows`,
      ).toBe(actual.length)
      return actual
    }
    // Groups a step may load: the shown rows, the first unit after the
    // window, and every unit tied with a window edge.
    const edgeGroups = (window: { offset: number; limit: number }) => {
      const units = sortedUnits()
      const edge = units.slice(window.offset, window.offset + window.limit + 1)
      const edgeRanks = new Set(
        [edge[0], edge.at(-1)].flatMap((unit) => (unit ? [unit.rank] : [])),
      )
      return [...edge, ...units.filter((unit) => edgeRanks.has(unit.rank))].map(
        (unit) => unit.group,
      )
    }
    const childrenOf = (groups: Iterable<string>) => {
      const set = new Set(groups)
      return [...children.values()].filter((child) => set.has(child.group))
        .length
    }

    await live.preload()
    let before = expectWindow(`rows after preload`)
    let windowBefore = shown
    expect(
      childWork().delivered,
      `child rows delivered by preload`,
    ).toBeLessThanOrEqual(
      childrenOf([...before.map((row) => row.group), ...edgeGroups(shown)]),
    )

    for (const [step, command] of testCase.history.entries()) {
      const deliveredBefore = childWork().delivered
      const edgeBefore = edgeGroups(windowBefore)
      const ids = [...parents.keys()]
      const childIds = [...children.keys()]
      if (command.type === `insert-parent`) {
        const source =
          command.copy === null || ids.length === 0
            ? undefined
            : parents.get(ids[command.copy % ids.length]!)!
        const group = source?.group ?? `group-${nextGroup++}`
        if (!source) {
          addChildren(group, testCase.childrenPerGroup)
          await childSource.insert(
            [...children.values()].filter((child) => child.group === group),
          ).isPersisted.promise
          await grandchildSource.insert(
            [...grandchildren.values()].filter(
              (grandchild) => children.get(grandchild.childId)?.group === group,
            ),
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
        await childSource.insert(child).isPersisted.promise
      } else if (command.type === `delete-child`) {
        if (childIds.length === 0) continue
        const id = childIds[command.pick % childIds.length]!
        children.delete(id)
        await childSource.delete(id).isPersisted.promise
      } else {
        shown = { offset: command.offset, limit: command.limit }
        const settled = live.utils.setWindow(shown)
        if (settled !== true) await settled
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      const after = expectWindow(`rows after step ${step}`)
      expect(
        childWork().delivered - deliveredBefore,
        `child rows delivered by step ${step}`,
      ).toBeLessThanOrEqual(
        childrenOf([
          ...[...before, ...after].map((row) => row.group),
          ...edgeBefore,
          ...edgeGroups(shown),
        ]) + 1,
      )
      before = after
      windowBefore = shown
    }
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

describe(`includes work under an ordered parent window`, () => {
  it.each([false, true])(
    `loads children only for a late page's parents (distinct=%s)`,
    (distinct) =>
      checkWindowedIncludeWork({
        parents: 40,
        groups: 40,
        copies: [],
        childrenPerGroup: 3,
        childForm: `materialize`,
        direction: `desc`,
        distinct,
        offset: 20,
        limit: 2,
        history: [{ type: `move`, offset: 10, limit: 3 }],
      }),
  )

  it.each([`ordered`, `limited`, `nested`] as const)(
    `moves the parent window, not the %s child's`,
    (childForm) =>
      checkWindowedIncludeWork({
        parents: 8,
        groups: 8,
        copies: [],
        childrenPerGroup: 2,
        childForm,
        direction: `asc`,
        distinct: false,
        offset: 0,
        limit: 2,
        history: [{ type: `move`, offset: 3, limit: 2 }],
      }),
  )

  it(`collapses parents whose selected values match under distinct`, () =>
    checkWindowedIncludeWork({
      parents: 8,
      groups: 8,
      copies: [
        { pick: 1, group: true },
        { pick: 2, group: false },
      ],
      childrenPerGroup: 2,
      childForm: `materialize`,
      direction: `asc`,
      distinct: true,
      offset: 0,
      limit: 3,
      history: [{ type: `insert-parent`, copy: 3 }],
    }))

  for (const campaign of campaigns(2137, `includes-work.ordered-window`)) {
    fcTest.prop([windowCase], campaign.options)(
      `a parent window bounds child loading (${campaign.name})`,
      checkWindowedIncludeWork,
    )
  }
})
