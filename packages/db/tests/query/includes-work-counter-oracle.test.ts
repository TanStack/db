import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeAll, describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import type { Collection } from '../../src/collection/index.js'

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

type SourceCollections = {
  terms: Collection<TermRow>
  meanings: Collection<MeaningRow>
  groups: Collection<GroupRow>
  links: Collection<LinkRow>
}

type WorkScenario = {
  filler: FillerCounts
  joinTargets: boolean
  afterMount?: (sources: SourceCollections) => Promise<void> | void
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
  | { id: string; text: string }
  | { id: string; targetId: string }

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
): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.map(async (cleanup) => cleanup()),
  )
  const firstRejection = results.find(
    (result): result is PromiseRejectedResult => result.status === `rejected`,
  )
  if (firstRejection !== undefined) throw firstRejection.reason
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

// Count both sides of the source boundary named in #1709's profile. Delivered
// rows show what enters the dataflow graph. entries() visits capture scans and
// get() calls capture keyed reads, so examined work cannot hide behind a filter.
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
      // grows; the term-filler control probes right-side input growth separately.
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

async function observeWork({
  filler,
  joinTargets,
  afterMount,
}: WorkScenario): Promise<WorkObservation> {
  const rows = createFixtureRows(filler)
  const sources = {
    terms: createSourceCollection(`work-terms`, rows.terms),
    meanings: createSourceCollection(`work-meanings`, rows.meanings),
    groups: createSourceCollection(`work-groups`, rows.groups),
    links: createSourceCollection(`work-links`, rows.links),
  }
  let cleanupLive: (() => Promise<void>) | undefined

  try {
    await Promise.all(Object.values(sources).map((source) => source.preload()))

    // Match #1709's reproduction: load first, then add a B-tree index on each
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
    if (afterMount) {
      await afterMount(sources)
      // Let the change propagate through the dataflow graph
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const root = live.toArray[0]!
    return {
      result: [
        {
          id: root.id,
          meanings: root.meanings.map((meaning) => ({
            id: meaning.id,
            groups: meaning.groups.map((group) => ({
              id: group.id,
              links: group.links.map(observeLink),
            })),
          })),
        },
      ],
      sourceWork: {
        terms: counters.terms(),
        meanings: counters.meanings(),
        groups: counters.groups(),
        links: counters.links(),
      },
    }
  } finally {
    await runCleanups([
      async () => cleanupLive?.(),
      ...Object.values(sources).map((source) => async () => source.cleanup()),
    ])
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

// The correlated where bounds the join's left side, so irrelevant left-side
// rows must not add source work: the join drives from the correlation-bounded
// side and lazily loads targets keyed by its rows (#1709).
async function expectBoundedCorrelatedJoinWork(
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
  expect(scaled.sourceWork).toEqual(baseline.sourceWork)
}

describe(`includes deterministic work-counter oracle`, () => {
  beforeAll(async () => {
    const [joinedBaseline, joinFreeBaseline] = await Promise.all([
      observeWork({ filler: noFillers, joinTargets: true }),
      observeWork({ filler: noFillers, joinTargets: false }),
    ])
    joinedBaselineObservation = joinedBaseline
    joinFreeBaselineObservation = joinFreeBaseline
  })

  it.each([1, 2, 3])(
    `keeps left-side source work flat at the small filler boundary (#1709) (%i)`,
    expectBoundedCorrelatedJoinWork,
  )

  fcTest.prop([fc.integer({ min: 1, max: 24 })], {
    numRuns: 6,
    seed: 1709,
  })(
    `a join no longer defeats correlated source pushdown (#1709)`,
    expectBoundedCorrelatedJoinWork,
  )

  it(`joins a late insert into the bounded side lazily without rescanning (#1709 incremental)`, async () => {
    const observed = await observeWork({
      filler: { terms: 5, meanings: 0, groups: 0, links: 12 },
      joinTargets: true,
      afterMount: (sources) => {
        // New link in the selected group pointing at a target that was never
        // loaded: the join must lazily load exactly that target, not rescan.
        sources.links.insert({
          id: `link-late`,
          groupId: `group-0`,
          targetId: `term-filler-3`,
        })
      },
    })

    const links = observed.result[0]!.meanings[0]!.groups[0]!.links
    expect(links).toHaveLength(3)
    expect(links).toContainEqual({
      id: `link-late`,
      text: `irrelevant target 3`,
    })
    expect(observed.sourceWork).toEqual({
      // Mount work plus exactly one lazily loaded join target for the insert
      terms: { delivered: 4, examined: 4 },
      meanings: { delivered: 1, examined: 1 },
      groups: { delivered: 1, examined: 1 },
      // The inserted row arrives as a live update, not an indexed re-read
      links: { delivered: 3, examined: 2 },
    })
  })

  fcTest.prop([fc.integer({ min: 1, max: 24 })], {
    numRuns: 6,
    seed: 170_900,
  })(
    `indexed join-target growth keeps source work flat (#1709 direction control)`,
    async (fillerCount) => {
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
      expect(scaled.sourceWork).toEqual(baseline.sourceWork)
    },
  )

  fcTest.prop([fc.integer({ min: 1, max: 24 })], {
    numRuns: 6,
    seed: 17_090,
  })(
    `join-free correlated includes keep source work flat (#1709 control)`,
    async (fillerCount) => {
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
      expect(scaled.sourceWork).toEqual(baseline.sourceWork)
    },
  )
})
