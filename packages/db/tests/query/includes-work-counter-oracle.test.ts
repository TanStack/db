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
 *
 * The model is relational: sort the parents by rank, take the window, and
 * attach each shown parent's children. The query must show exactly those
 * rows after preload and after every step.
 *
 * Work is counted as child rows the child Collection delivers to the query.
 * After preload, that count is at most the children of the shown parents plus
 * one parent's children as refill headroom. A step may deliver at most the
 * children of the parents shown before or after it, one changed child, and
 * the same headroom. A query that loads children for every parent before the
 * window delivers the children of `offset + limit` parents, or of every
 * parent with `distinct`, and fails.
 *
 * Histories insert and delete parents, change a parent's rank, insert and
 * delete children, and move the window with `setWindow`. Ranks are unique, so
 * the window order is total. Indexes exist before the live query starts.
 */
type WindowParent = { id: string; rank: number }
type WindowChild = { id: string; parentId: string }

type WindowCommand =
  | { type: `insert-parent` }
  | { type: `delete-parent`; pick: number }
  | { type: `rank`; pick: number; up: boolean }
  | { type: `insert-child`; pick: number }
  | { type: `delete-child`; pick: number }
  | { type: `move`; offset: number; limit: number }

type WindowCase = {
  parents: number
  childrenPerParent: number
  direction: `asc` | `desc`
  distinct: boolean
  offset: number
  limit: number
  history: Array<WindowCommand>
}

const windowCommand: fc.Arbitrary<WindowCommand> = fc.oneof(
  fc.constant({ type: `insert-parent` as const }),
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
    offset: fc.integer({ min: 0, max: 30 }),
    limit: fc.integer({ min: 1, max: 4 }),
  }),
)

const windowCase: fc.Arbitrary<WindowCase> = fc.record({
  parents: fc.integer({ min: 10, max: 60 }),
  childrenPerParent: fc.integer({ min: 1, max: 3 }),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  distinct: fc.boolean(),
  offset: fc.integer({ min: 0, max: 30 }),
  limit: fc.integer({ min: 1, max: 4 }),
  history: fc.array(windowCommand, { maxLength: 8 }),
})

type WindowRow = { id: string; children: Array<string> }

/** The model's window: shown parents in order, each with its child ids. */
function modelWindowRows(
  parents: ReadonlyMap<string, WindowParent>,
  children: ReadonlyMap<string, WindowChild>,
  {
    direction,
    offset,
    limit,
  }: Pick<WindowCase, 'direction'> & {
    offset: number
    limit: number
  },
): Array<WindowRow> {
  const sign = direction === `asc` ? 1 : -1
  return [...parents.values()]
    .sort((left, right) => sign * (left.rank - right.rank))
    .slice(offset, offset + limit)
    .map((parent) => ({
      id: parent.id,
      children: [...children.values()]
        .filter((child) => child.parentId === parent.id)
        .map((child) => child.id)
        .sort(),
    }))
}

async function checkWindowedIncludeWork(testCase: WindowCase): Promise<void> {
  const parents = new Map<string, WindowParent>()
  const children = new Map<string, WindowChild>()
  let nextRank = 0
  let nextChild = 0
  for (let index = 0; index < testCase.parents; index++) {
    const parent = { id: `parent-${index}`, rank: (nextRank += 2) }
    parents.set(parent.id, parent)
    for (let child = 0; child < testCase.childrenPerParent; child++) {
      const row = { id: `child-${nextChild++}`, parentId: parent.id }
      children.set(row.id, row)
    }
  }
  const parentSource = createSourceCollection(`window-parents`, [
    ...parents.values(),
  ])
  const childSource = createSourceCollection(`window-children`, [
    ...children.values(),
  ])
  let cleanupLive: (() => Promise<void>) | undefined
  let primary: { error: unknown } | undefined
  try {
    await Promise.all([parentSource.preload(), childSource.preload()])
    parentSource.createIndex((row) => row.rank, { indexType: BTreeIndex })
    childSource.createIndex((row) => row.parentId, { indexType: BTreeIndex })
    const childWork = countSourceWork(childSource)

    const live = createLiveQueryCollection((q) => {
      const page = q
        .from({ parent: parentSource })
        .orderBy(({ parent }) => parent.rank, testCase.direction)
        .offset(testCase.offset)
        .limit(testCase.limit)
        .select(({ parent }) => ({
          id: parent.id,
          rank: parent.rank,
          children: materialize(
            q
              .from({ child: childSource })
              .where(({ child }) => eq(child.parentId, parent.id))
              .select(({ child }) => ({ id: child.id })),
          ),
        }))
      return testCase.distinct ? page.distinct() : page
    })
    cleanupLive = () => live.cleanup()

    let shown = { offset: testCase.offset, limit: testCase.limit }
    const shownRows = (): Array<WindowRow> =>
      (
        live.toArray as unknown as Array<{
          id: string
          children: Array<{ id: string }>
        }>
      ).map((row) => ({
        id: row.id,
        children: row.children.map((child) => child.id).sort(),
      }))
    const childCount = (parentId: string) =>
      [...children.values()].filter((child) => child.parentId === parentId)
        .length
    const headroom = () => Math.max(0, ...[...parents.keys()].map(childCount))
    const expectWindow = (label: string) => {
      const expected = modelWindowRows(parents, children, {
        direction: testCase.direction,
        ...shown,
      })
      expect(shownRows(), label).toEqual(expected)
      return expected
    }

    await live.preload()
    let before = expectWindow(`rows after preload`)
    expect(
      childWork().delivered,
      `child rows delivered by preload`,
    ).toBeLessThanOrEqual(
      before.reduce((sum, row) => sum + childCount(row.id), 0) + headroom(),
    )

    const sorted = () =>
      [...parents.values()].sort((left, right) => left.rank - right.rank)
    for (const [step, command] of testCase.history.entries()) {
      const deliveredBefore = childWork().delivered
      const ids = [...parents.keys()]
      const childIds = [...children.keys()]
      if (command.type === `insert-parent`) {
        const parent = { id: `parent-new-${step}`, rank: (nextRank += 2) - 1 }
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
        const ranks = sorted().map((parent) => parent.rank)
        const rank = command.up ? ranks.at(-1)! + 1 : ranks[0]! - 1
        nextRank = Math.max(nextRank, rank + 1)
        parents.set(id, { id, rank })
        await parentSource.update(id, (draft) => {
          draft.rank = rank
        }).isPersisted.promise
      } else if (command.type === `insert-child`) {
        if (ids.length === 0) continue
        const row = {
          id: `child-${nextChild++}`,
          parentId: ids[command.pick % ids.length]!,
        }
        children.set(row.id, row)
        await childSource.insert(row).isPersisted.promise
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
      const touched = new Set([...before, ...after].map((row) => row.id))
      expect(
        childWork().delivered - deliveredBefore,
        `child rows delivered by step ${step}`,
      ).toBeLessThanOrEqual(
        [...touched].reduce((sum, id) => sum + childCount(id), 0) +
          1 +
          headroom(),
      )
      before = after
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
        parents: 60,
        childrenPerParent: 3,
        direction: `desc`,
        distinct,
        offset: 30,
        limit: 2,
        history: [{ type: `move`, offset: 10, limit: 3 }],
      }),
  )

  for (const campaign of campaigns(2137, `includes-work.ordered-window`)) {
    fcTest.prop([windowCase], campaign.options)(
      `a parent window bounds child loading (${campaign.name})`,
      checkWindowedIncludeWork,
    )
  }
})
