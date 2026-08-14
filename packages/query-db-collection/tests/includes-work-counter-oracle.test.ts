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
import type { Collection, WithVirtualProps } from '@tanstack/db'

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

type NodeCollection = Collection<
  WithVirtualProps<NodeRow, string | number>,
  string | number
>

type NestedTreeWork = {
  treeRowsConstructed: number
  sourceRowsDelivered: TreeCounts
  childCollectionsCreated: Record<ChildLevel, number>
  childCollectionRows: Record<ChildLevel, number>
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

async function observeNestedTreeWork(
  rootCount: number,
): Promise<NestedTreeWork> {
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
  let roots: ReturnType<typeof createLiveQueryCollection> | undefined

  try {
    const sourceCounters = {
      roots: countDeliveredRows(sources.roots),
      branches: countDeliveredRows(sources.branches),
      twigs: countDeliveredRows(sources.twigs),
      leaves: countDeliveredRows(sources.leaves),
    }

    // This is the root useLiveQuery shape timed by #1634. Each children property
    // remains a live Collection. The timer in the report stops before React's
    // virtualizer mounts any recursive Level consumers, so this oracle measures
    // only the nested collections and rows constructed by the root query.
    roots = createLiveQueryCollection({
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
    await roots.preload()

    const childCollectionsCreated = { branches: 0, twigs: 0, leaves: 0 }
    const childCollectionRows = { branches: 0, twigs: 0, leaves: 0 }
    let treeRowsConstructed = roots.size

    const countChildren = (
      collection: NodeCollection,
      level: ChildLevel,
    ): void => {
      const children = collection.toArray as unknown as ReadonlyArray<NodeRow>
      childCollectionsCreated[level]++
      childCollectionRows[level] += children.length
      treeRowsConstructed += children.length

      const nextLevel =
        level === `branches`
          ? `twigs`
          : level === `twigs`
            ? `leaves`
            : undefined
      if (nextLevel === undefined) return

      for (const child of children) {
        countChildren(requireChildren(child, level), nextLevel)
      }
    }

    for (const root of roots.toArray as unknown as ReadonlyArray<NodeRow>) {
      countChildren(requireChildren(root, `root`), `branches`)
    }

    return {
      treeRowsConstructed,
      sourceRowsDelivered: {
        roots: sourceCounters.roots(),
        branches: sourceCounters.branches(),
        twigs: sourceCounters.twigs(),
        leaves: sourceCounters.leaves(),
      },
      childCollectionsCreated,
      childCollectionRows,
    }
  } finally {
    await roots?.cleanup()
    await Promise.all(Object.values(sources).map((source) => source.cleanup()))
    queryClient.clear()
  }
}

function expectNestedTreeWork(
  observation: NestedTreeWork,
  rootCount: number,
): void {
  const expected = expectedTreeCounts(rootCount)
  expect(observation.treeRowsConstructed).toBe(
    Object.values(expected).reduce((sum, count) => sum + count, 0),
  )
  expect(observation.sourceRowsDelivered).toEqual(expected)
  expect(observation.childCollectionsCreated).toEqual({
    branches: expected.roots,
    twigs: expected.branches,
    leaves: expected.twigs,
  })
  expect(observation.childCollectionRows).toEqual({
    branches: expected.branches,
    twigs: expected.twigs,
    leaves: expected.leaves,
  })
}

describe(`nested includes setup counter oracle`, () => {
  fcTest.prop([fc.integer({ min: 1, max: 20 })], {
    numRuns: 6,
    seed: 1634,
  })(
    `constructs each nested collection inside the root query (#1634)`,
    async (rootCount) => {
      expectNestedTreeWork(await observeNestedTreeWork(rootCount), rootCount)
    },
  )

  it(`pins #1634's reported 20-by-2-by-5-by-10 tree`, async () => {
    // These semantic counters do not claim to measure elapsed time. They pin
    // source delivery and nested collection construction at the timed seam.
    expectNestedTreeWork(await observeNestedTreeWork(20), 20)
  })
})
