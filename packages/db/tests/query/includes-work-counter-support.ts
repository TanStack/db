import { expect } from 'vitest'
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
 * Shared fixtures and observers for the includes work-counter oracle. The
 * oracle file, includes-work-counter-oracle.test.ts, owns the work law and
 * declares its checks and model. This module only builds the production
 * observations and the reference expectations that those checks compare, so
 * its own exports reach nothing by themselves.
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

export type SourceWork = {
  terms: WorkCount
  meanings: WorkCount
  groups: WorkCount
  links: WorkCount
}

type LinkObservation =
  { id: string; text: string } | { id: string; targetId: string }

export type WorkObservation = {
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

export async function runCleanups(
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

export const noFillers: FillerCounts = {
  terms: 0,
  meanings: 0,
  groups: 0,
  links: 0,
}

export function createSourceCollection<T extends { id: string }>(
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
export function countSourceWork<T extends object>(collection: Collection<T>) {
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

export function observeResult(
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

export async function observeWork({
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

export function expectedResult({
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

export function expectSourceWorkBound(
  actual: SourceWork,
  expected: SourceWork,
): void {
  expect(actual).toEqual(expected)
}
