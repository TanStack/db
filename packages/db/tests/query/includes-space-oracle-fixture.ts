import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'

type RootRow = { id: string }
type BranchRow = { id: string; rootId: string }
type TwigRow = { id: string; branchId: string }
type LeafRow = { id: string; twigId: string }

let fixtureId = 0

function createRows(rootCount: number) {
  const roots: Array<RootRow> = []
  const branches: Array<BranchRow> = []
  const twigs: Array<TwigRow> = []
  const leaves: Array<LeafRow> = []

  for (let rootIndex = 0; rootIndex < rootCount; rootIndex++) {
    const rootId = `root-${rootIndex}`
    roots.push({ id: rootId })
    for (let branchIndex = 0; branchIndex < 2; branchIndex++) {
      const branchId = `branch-${rootIndex}-${branchIndex}`
      branches.push({ id: branchId, rootId })
      for (let twigIndex = 0; twigIndex < 5; twigIndex++) {
        const twigId = `twig-${rootIndex}-${branchIndex}-${twigIndex}`
        twigs.push({ id: twigId, branchId })
        for (let leafIndex = 0; leafIndex < 10; leafIndex++) {
          leaves.push({
            id: `leaf-${rootIndex}-${branchIndex}-${twigIndex}-${leafIndex}`,
            twigId,
          })
        }
      }
    }
  }

  return { roots, branches, twigs, leaves }
}

function source<T extends { id: string }>(name: string, rows: Array<T>) {
  return createCollection(
    localOnlyCollectionOptions({
      id: `includes-space-${fixtureId}-${name}`,
      getKey: (row: T) => row.id,
      initialData: rows,
    }),
  )
}

export async function createNestedCollectionFixture(rootCount: number) {
  fixtureId++
  const rows = createRows(rootCount)
  const sources = {
    roots: source(`roots`, rows.roots),
    branches: source(`branches`, rows.branches),
    twigs: source(`twigs`, rows.twigs),
    leaves: source(`leaves`, rows.leaves),
  }

  await Promise.all(
    Object.values(sources).map((collection) => collection.preload()),
  )
  sources.branches.createIndex((row) => row.rootId, { indexType: BTreeIndex })
  sources.twigs.createIndex((row) => row.branchId, { indexType: BTreeIndex })
  sources.leaves.createIndex((row) => row.twigId, { indexType: BTreeIndex })

  const live = createLiveQueryCollection((q) =>
    q.from({ root: sources.roots }).select(({ root }) => ({
      id: root.id,
      branches: q
        .from({ branch: sources.branches })
        .where(({ branch }) => eq(branch.rootId, root.id))
        .select(({ branch }) => ({
          id: branch.id,
          twigs: q
            .from({ twig: sources.twigs })
            .where(({ twig }) => eq(twig.branchId, branch.id))
            .select(({ twig }) => ({
              id: twig.id,
              leaves: q
                .from({ leaf: sources.leaves })
                .where(({ leaf }) => eq(leaf.twigId, twig.id))
                .select(({ leaf }) => ({ id: leaf.id })),
            })),
        })),
    })),
  )

  return {
    live,
    expectedFacadeCount: rootCount + rootCount * 2 + rootCount * 2 * 5,
    cleanup: async () => {
      const results = await Promise.allSettled([
        live.cleanup(),
        ...Object.values(sources).map((collection) => collection.cleanup()),
      ])
      const rejection = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === `rejected`,
      )
      if (rejection) throw rejection.reason
    },
  }
}
