import { QueryClient } from '@tanstack/query-core'
import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression'
import { queryCollectionOptions } from '../src/query'
import type { Collection } from '@tanstack/db'

/**
 * The live-query architecture's nested propagation and initial-demand laws
 * require a preloaded Query-backed tree to expose every reachable descendant.
 *
 * A deterministic four-level tree supplies the value model: traverse parent
 * links from the selected roots to compute reachable rows and child collection
 * counts. Source Collection change counters record rows delivered before and
 * after public traversal. A bounded root-count matrix varies scale.
 *
 * The oracle checks both complete nested values and work bounds. Correct rows
 * alone would allow duplicate source delivery; low counters alone could hide
 * missing descendants. The eager matrix makes every source row reachable. A
 * separate on-demand witness adds disconnected branches and checks acquisition
 * attempts, Query provider calls, delivered rows, and the public tree at
 * preload. Its controlled provider evaluates the requested predicate against
 * its rows; the oracle does not measure provider scans, internal index
 * traversal, facade allocations, or elapsed time.
 */

let nextCollectionId = 0

type RootRow = { id: string; value: string }
type BranchRow = { id: string; parentId: string; value: string }
type TwigRow = { id: string; parentId: string; value: string }
type LeafRow = { id: string; parentId: string; value: string }

type TreeCounts = {
  roots: number
  branches: number
  twigs: number
  leaves: number
}

type ChildLevel = Exclude<keyof TreeCounts, 'roots'>

type TreeEntry = {
  level: keyof TreeCounts
  parentId: string | null
  id: string
  value: string
}

type NodeRow = {
  id: string
  value: string
  children?: NodeCollection
}

type NodeCollection = Pick<
  Collection<NodeRow, string | number>,
  'cleanup' | 'preload' | 'size' | 'toArray'
>

type NestedTreeShape = {
  entries: Array<TreeEntry>
  reachableTreeRows: number
  sourceRowsDeliveredAtPreload: TreeCounts
  sourceRowsDeliveredAfterTraversal: TreeCounts
  providerCallsAtPreload: TreeCounts
  providerCallsAfterTraversal: TreeCounts
  acquisitionAttemptsAtPreload: TreeCounts
  acquisitionAttemptsAfterTraversal: TreeCounts
  reachableChildCollections: Record<ChildLevel, number>
  reachableChildRows: Record<ChildLevel, number>
}

const branchesPerRoot = 2
const twigsPerBranch = 5
const leavesPerTwig = 10

function createNestedTreeRows(rootCount: number, irrelevantBranchCount = 0) {
  const roots: Array<RootRow> = []
  const branches: Array<BranchRow> = []
  const twigs: Array<TwigRow> = []
  const leaves: Array<LeafRow> = []

  for (let rootIndex = 0; rootIndex < rootCount; rootIndex++) {
    const rootId = `root-${rootIndex}`
    roots.push({ id: rootId, value: rootId })

    for (let branchIndex = 0; branchIndex < branchesPerRoot; branchIndex++) {
      const branchId = `branch-${rootIndex}-${branchIndex}`
      branches.push({ id: branchId, parentId: rootId, value: branchId })

      for (let twigIndex = 0; twigIndex < twigsPerBranch; twigIndex++) {
        const twigId = `twig-${rootIndex}-${branchIndex}-${twigIndex}`
        twigs.push({ id: twigId, parentId: branchId, value: twigId })

        for (let leafIndex = 0; leafIndex < leavesPerTwig; leafIndex++) {
          const leafId = `leaf-${rootIndex}-${branchIndex}-${twigIndex}-${leafIndex}`
          leaves.push({ id: leafId, parentId: twigId, value: leafId })
        }
      }
    }
  }

  // No root has this key. The extra branch and descendants cannot reach the
  // selected public tree, but can expose unneeded source delivery or demand.
  for (
    let branchIndex = 0;
    branchIndex < irrelevantBranchCount;
    branchIndex++
  ) {
    const branchId = `irrelevant-branch-${branchIndex}`
    const twigId = `irrelevant-twig-${branchIndex}`
    branches.push({ id: branchId, parentId: `root-outside`, value: branchId })
    twigs.push({ id: twigId, parentId: branchId, value: twigId })
    leaves.push({
      id: `irrelevant-leaf-${branchIndex}`,
      parentId: twigId,
      value: `irrelevant-leaf-${branchIndex}`,
    })
  }

  return { roots, branches, twigs, leaves }
}

function createQuerySource<T extends { id: string }>(
  name: string,
  rows: Array<T>,
  queryClient: QueryClient,
  onProviderCall: () => void = () => {},
  onDemand = false,
) {
  const id = `${name}-${nextCollectionId++}`
  return createCollection(
    queryCollectionOptions<T>({
      id,
      queryClient,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      queryKey: [id],
      syncMode: onDemand ? `on-demand` : `eager`,
      startSync: true,
      queryFn: (context) => {
        onProviderCall()
        if (!onDemand) return Promise.resolve(rows)
        const where = context.meta?.loadSubsetOptions?.where
        if (where === undefined) {
          throw new Error(`On-demand tree source received no predicate`)
        }
        return Promise.resolve(
          rows.filter((row) => evaluateReferenceExpression(where, row)),
        )
      },
      getKey: (row) => row.id,
    }),
  )
}

function countDeliveredRows<T extends object>(collection: Collection<T>) {
  let deliveredRows = 0
  const originalSubscribeChanges = collection.subscribeChanges.bind(collection)

  collection.subscribeChanges = (callback, options) => {
    return originalSubscribeChanges((changes) => {
      deliveredRows += changes.length
      callback(changes)
    }, options)
  }

  return () => deliveredRows
}

function expectedTreeCounts(rootCount: number): TreeCounts {
  const branches = rootCount * branchesPerRoot
  const twigs = branches * twigsPerBranch

  return {
    roots: rootCount,
    branches,
    twigs,
    leaves: twigs * leavesPerTwig,
  }
}

function requireChildren(row: NodeRow, level: string): NodeCollection {
  if (row.children === undefined) {
    throw new Error(`Expected ${level} row ${row.id} to have children`)
  }
  return row.children
}

function observeReachableTreeShape(
  roots: NodeCollection,
  rootRows: ReadonlyArray<NodeRow>,
) {
  const entries: Array<TreeEntry> = rootRows.map(({ id, value }) => ({
    level: `roots`,
    parentId: null,
    id,
    value,
  }))
  const reachableChildCollections = { branches: 0, twigs: 0, leaves: 0 }
  const reachableChildRows = { branches: 0, twigs: 0, leaves: 0 }
  let reachableTreeRows = roots.size

  const countChildren = (
    collection: NodeCollection,
    level: ChildLevel,
    parentId: string,
  ): void => {
    const children = collection.toArray
    for (const { id, value } of children) {
      entries.push({ level, parentId, id, value })
    }
    reachableChildCollections[level]++
    reachableChildRows[level] += children.length
    reachableTreeRows += children.length

    const nextLevel =
      level === `branches` ? `twigs` : level === `twigs` ? `leaves` : undefined
    if (nextLevel === undefined) return

    for (const child of children) {
      countChildren(requireChildren(child, level), nextLevel, child.id)
    }
  }

  for (const root of rootRows) {
    countChildren(requireChildren(root, `root`), `branches`, root.id)
  }

  return {
    entries,
    reachableTreeRows,
    reachableChildCollections,
    reachableChildRows,
  }
}

function expectedTreeEntries(rootCount: number): Array<TreeEntry> {
  // Source foreign keys are the authority, not the nested query's routes.
  // Build a separate world so source writes cannot alter the expected values.
  const rows = createNestedTreeRows(rootCount)
  return [
    ...rows.roots.map((row) => ({
      ...row,
      level: `roots` as const,
      parentId: null,
    })),
    ...rows.branches.map((row) => ({ ...row, level: `branches` as const })),
    ...rows.twigs.map((row) => ({ ...row, level: `twigs` as const })),
    ...rows.leaves.map((row) => ({ ...row, level: `leaves` as const })),
  ]
}

function canonicalTreeEntries(entries: Array<TreeEntry>): Array<string> {
  // No orderBy is requested. Sort for comparison, retaining duplicate entries.
  return entries
    .map(({ level, parentId, id, value }) =>
      JSON.stringify([level, parentId, id, value]),
    )
    .sort()
}

function expectTreeEntries(entries: Array<TreeEntry>, rootCount: number): void {
  expect(canonicalTreeEntries(entries)).toEqual(
    canonicalTreeEntries(expectedTreeEntries(rootCount)),
  )
}

function snapshotSourceRowsDelivered(
  sourceCounters: Record<keyof TreeCounts, () => number>,
): TreeCounts {
  return {
    roots: sourceCounters.roots(),
    branches: sourceCounters.branches(),
    twigs: sourceCounters.twigs(),
    leaves: sourceCounters.leaves(),
  }
}

async function checkNestedTreeShape(
  rootCount: number,
  verify: (observation: NestedTreeShape) => void,
  transformRootRows: (
    rows: ReadonlyArray<NodeRow>,
  ) => ReadonlyArray<NodeRow> = (rows) => rows,
  irrelevantBranchCount = 0,
  onDemandChildren = false,
): Promise<void> {
  const rows = createNestedTreeRows(rootCount, irrelevantBranchCount)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const providerCalls = { roots: 0, branches: 0, twigs: 0, leaves: 0 }
  const acquisitionAttempts = { roots: 0, branches: 0, twigs: 0, leaves: 0 }
  const sources = {
    roots: createQuerySource(`tree-roots`, rows.roots, queryClient, () => {
      providerCalls.roots++
    }),
    branches: createQuerySource(
      `tree-branches`,
      rows.branches,
      queryClient,
      () => {
        providerCalls.branches++
      },
      onDemandChildren,
    ),
    twigs: createQuerySource(
      `tree-twigs`,
      rows.twigs,
      queryClient,
      () => {
        providerCalls.twigs++
      },
      onDemandChildren,
    ),
    leaves: createQuerySource(
      `tree-leaves`,
      rows.leaves,
      queryClient,
      () => {
        providerCalls.leaves++
      },
      onDemandChildren,
    ),
  }
  let rootCollection: NodeCollection | undefined
  let primaryFailure: unknown
  let failed = false
  const cleanupErrors: Array<unknown> = []

  try {
    if (onDemandChildren) {
      for (const level of [`branches`, `twigs`, `leaves`] as const) {
        const source = sources[level]
        const loadSubset = source._sync.loadSubset.bind(source._sync)
        source._sync.loadSubset = (options) => {
          acquisitionAttempts[level]++
          return loadSubset(options)
        }
      }
    }
    const sourceCounters = {
      roots: countDeliveredRows(sources.roots),
      branches: countDeliveredRows(sources.branches),
      twigs: countDeliveredRows(sources.twigs),
      leaves: countDeliveredRows(sources.leaves),
    }

    // This matches the nested result shape in #1634. Each children property
    // remains a live Collection. The public result API exposes the reachable
    // tree, not internal allocation counts, so this oracle constrains reachable
    // cardinality, edges, values and source delivery, not allocations.
    const roots: NodeCollection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ root: sources.roots }).select(({ root }) => ({
          id: root.id,
          value: root.value,
          children: q
            .from({ branch: sources.branches })
            .where(({ branch }) => eq(branch.parentId, root.id))
            .select(({ branch }) => ({
              id: branch.id,
              value: branch.value,
              children: q
                .from({ twig: sources.twigs })
                .where(({ twig }) => eq(twig.parentId, branch.id))
                .select(({ twig }) => ({
                  id: twig.id,
                  value: twig.value,
                  children: q
                    .from({ leaf: sources.leaves })
                    .where(({ leaf }) => eq(leaf.parentId, twig.id))
                    .select(({ leaf }) => ({
                      id: leaf.id,
                      value: leaf.value,
                    })),
                })),
            })),
        })),
    })
    rootCollection = roots
    await roots.preload()

    const sourceRowsDeliveredAtPreload =
      snapshotSourceRowsDelivered(sourceCounters)
    const providerCallsAtPreload = { ...providerCalls }
    const acquisitionAttemptsAtPreload = { ...acquisitionAttempts }
    const shape = observeReachableTreeShape(
      roots,
      transformRootRows(roots.toArray),
    )

    verify({
      ...shape,
      sourceRowsDeliveredAtPreload,
      sourceRowsDeliveredAfterTraversal:
        snapshotSourceRowsDelivered(sourceCounters),
      providerCallsAtPreload,
      providerCallsAfterTraversal: { ...providerCalls },
      acquisitionAttemptsAtPreload,
      acquisitionAttemptsAfterTraversal: { ...acquisitionAttempts },
    })
  } catch (error) {
    primaryFailure = error
    failed = true
  } finally {
    const results = await Promise.allSettled(
      [
        async () => rootCollection?.cleanup(),
        ...Object.values(sources).map((source) => async () => source.cleanup()),
      ].map(async (cleanup) => cleanup()),
    )
    cleanupErrors.push(
      ...results.flatMap((result) =>
        result.status === `rejected` ? [result.reason] : [],
      ),
    )
    try {
      queryClient.clear()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Nested-tree cleanup failed`, {
      cause: failed ? primaryFailure : cleanupErrors[0],
    })
  }
  if (failed) throw primaryFailure
}

function expectNestedTreeWork(
  observation: NestedTreeShape,
  rootCount: number,
): void {
  const expected = expectedTreeCounts(rootCount)
  expect(observation.reachableTreeRows).toBe(
    Object.values(expected).reduce((sum, count) => sum + count, 0),
  )
  expect(observation.sourceRowsDeliveredAtPreload).toEqual(expected)
  expect(observation.sourceRowsDeliveredAfterTraversal).toEqual(
    observation.sourceRowsDeliveredAtPreload,
  )
  expect(observation.providerCallsAfterTraversal).toEqual(
    observation.providerCallsAtPreload,
  )
  expect(observation.acquisitionAttemptsAfterTraversal).toEqual(
    observation.acquisitionAttemptsAtPreload,
  )
  expect(observation.reachableChildCollections).toEqual({
    branches: expected.roots,
    twigs: expected.branches,
    leaves: expected.twigs,
  })
  expect(observation.reachableChildRows).toEqual({
    branches: expected.branches,
    twigs: expected.twigs,
    leaves: expected.leaves,
  })
}

function expectNestedTreeShape(
  observation: NestedTreeShape,
  rootCount: number,
): void {
  expectNestedTreeWork(observation, rootCount)
  expectTreeEntries(observation.entries, rootCount)
}

function expectIrrelevantBranchWork(
  baseline: NestedTreeShape,
  scaled: NestedTreeShape,
): void {
  // The root uses one eager Query fetch. Each child level uses one on-demand
  // acquisition attempt and one Query provider call for its reachable set.
  const expectedProviderCalls = { roots: 1, branches: 1, twigs: 1, leaves: 1 }
  const expectedAttempts = { roots: 0, branches: 1, twigs: 1, leaves: 1 }
  expect(baseline.providerCallsAtPreload).toEqual(expectedProviderCalls)
  expect(scaled.providerCallsAtPreload).toEqual(expectedProviderCalls)
  expect(baseline.acquisitionAttemptsAtPreload).toEqual(expectedAttempts)
  expect(scaled.acquisitionAttemptsAtPreload).toEqual(expectedAttempts)
  expect(scaled.sourceRowsDeliveredAtPreload).toEqual(
    baseline.sourceRowsDeliveredAtPreload,
  )
  expect(canonicalTreeEntries(scaled.entries)).toEqual(
    canonicalTreeEntries(baseline.entries),
  )
}

describe(`nested includes reachable-shape oracle`, () => {
  // Keep every value from the former fixed-seed sample (2, 3, 4, 13, 17),
  // plus nearby sizes. The empty and reported-size endpoints stay explicit.
  it.each([1, 2, 3, 4, 5, 10, 13, 17])(
    `preserves the complete reachable nested tree shape for %i roots`,
    async (rootCount) => {
      await checkNestedTreeShape(rootCount, (observation) =>
        expectNestedTreeShape(observation, rootCount),
      )
    },
  )

  it(`exposes no nested collections for an empty root query`, async () => {
    await checkNestedTreeShape(0, (observation) =>
      expectNestedTreeShape(observation, 0),
    )
  })

  it(`pins the reported 20-by-2-by-5-by-10 tree`, async () => {
    // These semantic counters do not claim to measure elapsed time or internal
    // allocations. They pin source delivery at preload and reachable shape.
    await checkNestedTreeShape(20, (observation) =>
      expectNestedTreeShape(observation, 20),
    )
  })

  it(`does not deliver more source rows while traversing the result`, async () => {
    await checkNestedTreeShape(20, (observation) => {
      expect(observation.sourceRowsDeliveredAfterTraversal).toEqual(
        observation.sourceRowsDeliveredAtPreload,
      )
    })
  })

  it.each([1, 3])(
    `does not acquire or deliver %i disconnected branches at preload`,
    async (irrelevantBranchCount) => {
      const observations: Array<NestedTreeShape> = []
      await checkNestedTreeShape(
        2,
        (observation) => {
          expectNestedTreeShape(observation, 2)
          observations.push(observation)
        },
        (rows) => rows,
        0,
        true,
      )
      await checkNestedTreeShape(
        2,
        (observation) => {
          expectNestedTreeShape(observation, 2)
          observations.push(observation)
        },
        (rows) => rows,
        irrelevantBranchCount,
        true,
      )
      const [baseline, scaled] = observations as [
        NestedTreeShape,
        NestedTreeShape,
      ]
      expectIrrelevantBranchWork(baseline, scaled)

      // An extra acquisition for an unreachable branch could leave the public
      // tree correct. It must still fail this comparison at preload.
      const wrongWork: NestedTreeShape = {
        ...scaled,
        acquisitionAttemptsAtPreload: {
          ...scaled.acquisitionAttemptsAtPreload,
          branches: scaled.acquisitionAttemptsAtPreload.branches + 1,
        },
      }
      expect(() => expectIrrelevantBranchWork(baseline, wrongWork)).toThrow()
    },
  )

  it(`rejects a repeated source row delivery after traversal`, async () => {
    await checkNestedTreeShape(2, (observation) => {
      expectNestedTreeShape(observation, 2)
      const repeatedDelivery: NestedTreeShape = {
        ...observation,
        sourceRowsDeliveredAfterTraversal: {
          ...observation.sourceRowsDeliveredAfterTraversal,
          branches: observation.sourceRowsDeliveredAfterTraversal.branches + 1,
        },
      }
      expect(() => expectNestedTreeWork(repeatedDelivery, 2)).toThrow()
    })
  })

  it.each([`subtree swap`, `value corruption`] as const)(
    `rejects %s even when reachable cardinality and source work agree`,
    async (fault) => {
      await checkNestedTreeShape(2, (observation) =>
        expectNestedTreeShape(observation, 2),
      )
      await checkNestedTreeShape(
        2,
        (observation) => {
          expectNestedTreeWork(observation, 2)
          expect(() => expectTreeEntries(observation.entries, 2)).toThrow()
        },
        (roots) => {
          expect(roots).toHaveLength(2)
          const [first, second] = roots as [NodeRow, NodeRow]
          // Corrupt copied public rows before capture, not expected records or
          // production state. Both branches still use real child Collections.
          return fault === `subtree swap`
            ? [
                { ...first, children: second.children },
                { ...second, children: first.children },
              ]
            : [{ ...first, value: `wrong root value` }, second]
        },
      )
    },
  )
})
