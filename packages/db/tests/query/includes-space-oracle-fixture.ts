import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'

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

function source<T extends { id: string }>(
  name: string,
  rows: Array<T>,
  cleanups: Array<() => Promise<void>>,
) {
  const collection = createCollection(
    localOnlyCollectionOptions({
      id: `includes-space-${fixtureId}-${name}`,
      getKey: (row: T) => row.id,
      initialData: rows,
    }),
  )
  cleanups.push(() => collection.cleanup())
  return collection
}

export async function createNestedCollectionFixture(rootCount: number) {
  fixtureId++
  const rows = createRows(rootCount)
  const cleanups: Array<() => Promise<void>> = []
  let transferred = false
  return withHistoryCleanup(
    async () => {
      const sources = {
        roots: source(`roots`, rows.roots, cleanups),
        branches: source(`branches`, rows.branches, cleanups),
        twigs: source(`twigs`, rows.twigs, cleanups),
        leaves: source(`leaves`, rows.leaves, cleanups),
      }

      await Promise.all(
        Object.values(sources).map((collection) => collection.preload()),
      )
      sources.branches.createIndex((row) => row.rootId, {
        indexType: BTreeIndex,
      })
      sources.twigs.createIndex((row) => row.branchId, {
        indexType: BTreeIndex,
      })
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

      transferred = true
      return {
        live,
        expectedFacadeCount: rootCount + rootCount * 2 + rootCount * 2 * 5,
        cleanup: () =>
          withHistoryCleanup(
            () => Promise.resolve(),
            () => [() => live.cleanup(), ...cleanups],
          ),
      }
    },
    () => (transferred ? [] : cleanups),
  )
}
