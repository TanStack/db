import { describe, expect, test, vi } from 'vitest'
import {
  Query,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { flushPromises } from '../utils.js'
import { createScopedSource } from './includes-scope-identity-oracle.js'
import type { crossJoinParentRoutes } from '../../src/query/compiler/parent-routes.js'

/**
 * # Main-correlated outer joins do not multiply a direct joined input by routes
 *
 * ARCHITECTURE.md law 12 says irrelevant rows must not activate unrelated
 * routes when an applicable index exists. A RIGHT or FULL join whose include
 * correlation is on its main source has no child row when that main source is
 * absent, regardless of the joined source's rows. The plain-row model below
 * therefore pairs each main row with matching anchors inside its one parent;
 * FULL also retains a main row with no anchor.
 * The direct joined source has no parent-dependent expression, so adding
 * unrelated joined rows must not increase parent-route assembly. This compares
 * a one-anchor baseline with three anchors; it does not require one particular
 * route implementation or an exact operation count. A joined-correlated RIGHT
 * join is a different case:
 * its unmatched joined rows can belong to a parent and do require routing.
 *
 * The driver uses public Query and Collection APIs. A transparent wrapper
 * counts calls to the compiler's route assembler at preload and after each
 * write; public rows are checked at the same cuts. This finite fixture crosses
 * RIGHT/FULL and eager or on-demand direct sources, with two parents, matched
 * and unmatched sides, and applicable indexes. The history changes a main
 * row's join key, removes a matched row, restores it, and moves the key back.
 * It does not measure index traversal, real-provider delivery, or QueryRef
 * routing, which the primary alias oracle checks for row correctness.
 */

const routeWork = vi.hoisted(() => ({ assemblies: 0 }))
vi.mock('../../src/query/compiler/parent-routes.js', async (importOriginal) => {
  const original = await importOriginal<{
    crossJoinParentRoutes: typeof crossJoinParentRoutes
  }>()
  return {
    ...original,
    crossJoinParentRoutes: (
      ...args: Parameters<typeof original.crossJoinParentRoutes>
    ) => {
      const [input, parentKeyStream, assemble] = args
      return original.crossJoinParentRoutes(
        input,
        parentKeyStream,
        (...values) => {
          routeWork.assemblies++
          return assemble(...values)
        },
      )
    },
  }
})

describe(`direct outer-join route work`, () => {
  type Parent = { id: number }
  type Main = { id: number; parentId: number; anchorId: number }
  type Anchor = { id: number }
  type Kind = `right` | `full`
  type Expected = {
    parentId: number
    mainId: number | undefined
    anchorId: number | undefined
  }

  const sortRows = (rows: Array<Expected>) =>
    rows.sort(
      (a, b) =>
        a.parentId - b.parentId ||
        (a.mainId ?? Infinity) - (b.mainId ?? Infinity) ||
        (a.anchorId ?? Infinity) - (b.anchorId ?? Infinity),
    )

  const model = (
    parents: ReadonlyArray<Parent>,
    mains: ReadonlyArray<Main>,
    anchors: ReadonlyArray<Anchor>,
    kind: Kind,
  ): Array<Expected> =>
    sortRows(
      parents.flatMap((parent) =>
        mains
          .filter((main) => main.parentId === parent.id)
          .flatMap((main): Array<Expected> => {
            const matches = anchors.filter(
              (anchor) => anchor.id === main.anchorId,
            )
            if (matches.length === 0 && kind === `full`) {
              return [
                {
                  parentId: parent.id,
                  mainId: main.id,
                  anchorId: undefined,
                },
              ]
            }
            return matches.map((anchor) => ({
              parentId: parent.id,
              mainId: main.id,
              anchorId: anchor.id,
            }))
          }),
      ),
    )

  for (const kind of [`right`, `full`] as const) {
    for (const mode of [`eager`, `onDemand`] as const) {
      test(`${kind} main correlation with ${mode} sources avoids work from unrelated joined rows`, async () => {
        const parentRows: Array<Parent> = [{ id: 1 }, { id: 2 }]
        const mainRows: Array<Main> = [
          { id: 10, parentId: 1, anchorId: 7 },
          { id: 11, parentId: 1, anchorId: 99 },
        ]
        const observe = async (anchorRows: Array<Anchor>, size: string) => {
          const currentMains = new Map(mainRows.map((row) => [row.id, row]))
          const parents = createScopedSource(
            `route-work-parent-${kind}-${mode}-${size}`,
            parentRows,
            `eager`,
          )
          const mains = createScopedSource(
            `route-work-main-${kind}-${mode}-${size}`,
            mainRows,
            mode,
          )
          const anchors = createScopedSource(
            `route-work-anchor-${kind}-${mode}-${size}`,
            anchorRows,
            mode,
          )
          mains.collection.createIndex((row) => row.parentId, {
            indexType: BasicIndex,
          })
          mains.collection.createIndex((row) => row.anchorId, {
            indexType: BasicIndex,
          })
          anchors.collection.createIndex((row) => row.id, {
            indexType: BasicIndex,
          })
          const live = createLiveQueryCollection({
            query: new Query()
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                rows: toArray(
                  new Query()
                    .from({ main: mains.collection })
                    .join(
                      { anchor: anchors.collection },
                      ({ main, anchor }) => eq(main.anchorId, anchor.id),
                      kind,
                    )
                    .where(({ main }) => eq(main.parentId, parent.id))
                    .select(({ main, anchor }) => ({
                      mainId: main.id,
                      anchorId: anchor.id,
                    })),
                ),
              })),
          })

          return withHistoryCleanup(
            async () => {
              const cuts: Array<{
                cut: string
                rows: Array<Expected>
                assemblies: number
              }> = []
              const check = (cut: string) => {
                const rows = sortRows(
                  live.toArray.flatMap(({ id, rows: children }) =>
                    children.map(({ mainId, anchorId }) => ({
                      parentId: id,
                      mainId,
                      anchorId,
                    })),
                  ),
                )
                expect(rows, `${size} at ${cut}`).toEqual(
                  model(
                    parentRows,
                    [...currentMains.values()],
                    anchorRows,
                    kind,
                  ),
                )
                cuts.push({ cut, rows, assemblies: routeWork.assemblies })
              }
              routeWork.assemblies = 0
              await live.preload()
              check(`preload`)

              const moved = { id: 11, parentId: 1, anchorId: 7 }
              currentMains.set(11, moved)
              routeWork.assemblies = 0
              mains.put(moved)
              await flushPromises()
              check(`main key moves into match`)

              currentMains.delete(10)
              routeWork.assemblies = 0
              mains.remove(10)
              await flushPromises()
              check(`matched main row disappears`)

              const restored = { id: 10, parentId: 1, anchorId: 7 }
              currentMains.set(10, restored)
              routeWork.assemblies = 0
              mains.put(restored)
              await flushPromises()
              check(`matched main row returns`)

              const movedBack = { id: 11, parentId: 1, anchorId: 99 }
              currentMains.set(11, movedBack)
              routeWork.assemblies = 0
              mains.put(movedBack)
              await flushPromises()
              check(`main key moves out of match`)
              return cuts
            },
            () => [
              () => live.cleanup(),
              () => parents.collection.cleanup(),
              () => mains.collection.cleanup(),
              () => anchors.collection.cleanup(),
            ],
          )
        }

        const baseline = await observe([{ id: 7 }], `baseline`)
        const scaled = await observe(
          [{ id: 7 }, { id: 8 }, { id: 9 }],
          `scaled`,
        )
        expect(scaled.map(({ rows }) => rows)).toEqual(
          baseline.map(({ rows }) => rows),
        )
        expect(scaled.map(({ assemblies }) => assemblies)).toEqual(
          baseline.map(({ assemblies }) => assemblies),
        )
      })
    }
  }
})
