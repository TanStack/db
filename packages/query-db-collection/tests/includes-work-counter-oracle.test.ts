import { fc, test as fcTest } from '@fast-check/vitest'
import { QueryClient } from '@tanstack/query-core'
import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { queryCollectionOptions } from '../src/query'
import type { Collection } from '@tanstack/db'

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
  reachableTreeRows: number
  sourceRowsDeliveredAtPreload: TreeCounts
  sourceRowsDeliveredAfterTraversal: TreeCounts
  reachableChildCollections: Record<ChildLevel, number>
  reachableChildRows: Record<ChildLevel, number>
}

const branchesPerRoot = 2
const twigsPerBranch = 5
const leavesPerTwig = 10

function createNestedTreeRows(rootCount: number) {
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

  return { roots, branches, twigs, leaves }
}

function createQuerySource<T extends { id: string }>(
  name: string,
  rows: Array<T>,
  queryClient: QueryClient,
) {
  const id = `${name}-${nextCollectionId++}`
  return createCollection(
    queryCollectionOptions<T>({
      id,
      queryClient,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      queryKey: [id],
      queryFn: () => Promise.resolve(rows),
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

function observeReachableTreeShape(roots: NodeCollection) {
  const reachableChildCollections = { branches: 0, twigs: 0, leaves: 0 }
  const reachableChildRows = { branches: 0, twigs: 0, leaves: 0 }
  let reachableTreeRows = roots.size

  const countChildren = (
    collection: NodeCollection,
    level: ChildLevel,
  ): void => {
    const children = collection.toArray
    reachableChildCollections[level]++
    reachableChildRows[level] += children.length
    reachableTreeRows += children.length

    const nextLevel =
      level === `branches` ? `twigs` : level === `twigs` ? `leaves` : undefined
    if (nextLevel === undefined) return

    for (const child of children) {
      countChildren(requireChildren(child, level), nextLevel)
    }
  }

  for (const root of roots.toArray) {
    countChildren(requireChildren(root, `root`), `branches`)
  }

  return { reachableTreeRows, reachableChildCollections, reachableChildRows }
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

function rethrowFirstCleanupError(
  results: ReadonlyArray<{ rejected: boolean; error: unknown }>,
): void {
  const firstRejection = results.find((result) => result.rejected)
  if (firstRejection !== undefined) throw firstRejection.error
}

async function observeNestedTreeShape(
  rootCount: number,
): Promise<NestedTreeShape> {
  const rows = createNestedTreeRows(rootCount)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const sources = {
    roots: createQuerySource(`tree-roots`, rows.roots, queryClient),
    branches: createQuerySource(`tree-branches`, rows.branches, queryClient),
    twigs: createQuerySource(`tree-twigs`, rows.twigs, queryClient),
    leaves: createQuerySource(`tree-leaves`, rows.leaves, queryClient),
  }
  let rootCollection: NodeCollection | undefined

  try {
    const sourceCounters = {
      roots: countDeliveredRows(sources.roots),
      branches: countDeliveredRows(sources.branches),
      twigs: countDeliveredRows(sources.twigs),
      leaves: countDeliveredRows(sources.leaves),
    }

    // This matches the nested result shape in #1634. Each children property
    // remains a live Collection. The public result API exposes the reachable
    // tree, not internal allocation counts, so this oracle constrains reachable
    // cardinality and source delivery rather than claiming to count allocations.
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
    const { reachableTreeRows, reachableChildCollections, reachableChildRows } =
      observeReachableTreeShape(roots)

    return {
      reachableTreeRows,
      sourceRowsDeliveredAtPreload,
      sourceRowsDeliveredAfterTraversal:
        snapshotSourceRowsDelivered(sourceCounters),
      reachableChildCollections,
      reachableChildRows,
    }
  } finally {
    let cleanupRejected = false
    let cleanupError: unknown
    try {
      await runCleanups([
        async () => rootCollection?.cleanup(),
        ...Object.values(sources).map((source) => async () => source.cleanup()),
      ])
    } catch (error) {
      cleanupRejected = true
      cleanupError = error
    }

    let clearRejected = false
    let clearError: unknown
    try {
      queryClient.clear()
    } catch (error) {
      clearRejected = true
      clearError = error
    }

    rethrowFirstCleanupError([
      { rejected: cleanupRejected, error: cleanupError },
      { rejected: clearRejected, error: clearError },
    ])
  }
}

function expectNestedTreeShape(
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

describe(`nested includes reachable-shape oracle`, () => {
  fcTest.prop([fc.integer({ min: 0, max: 20 })], {
    numRuns: 6,
    seed: 1634,
  })(
    `preserves the complete reachable nested tree shape (#1634)`,
    async (rootCount) => {
      expectNestedTreeShape(await observeNestedTreeShape(rootCount), rootCount)
    },
  )

  it(`exposes no nested collections for an empty root query`, async () => {
    expectNestedTreeShape(await observeNestedTreeShape(0), 0)
  })

  it(`pins #1634's reported 20-by-2-by-5-by-10 tree`, async () => {
    // These semantic counters do not claim to measure elapsed time or internal
    // allocations. They pin source delivery at preload and reachable shape.
    expectNestedTreeShape(await observeNestedTreeShape(20), 20)
  })

  it(`does not deliver more source rows while traversing the result`, async () => {
    const observation = await observeNestedTreeShape(20)
    expect(observation.sourceRowsDeliveredAfterTraversal).toEqual(
      observation.sourceRowsDeliveredAtPreload,
    )
  })
})
