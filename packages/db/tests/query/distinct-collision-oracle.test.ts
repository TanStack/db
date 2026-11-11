/**
 * Receiving witness for distinct-incrementalization-oracle's unique-selection
 * law. The same grammar/model checks public rows after each applied source
 * transaction. Both unordered and ordered live-query Collections must preserve
 * the colliding selections and their independently changing duplicate support.
 * This tests core's public API; framework render scheduling is outside the law.
 */
import { hash } from '../../../db-ivm/src/hashing/hash.js'
import {
  DISTINCT_REACH_STATES,
  checkDistinctSnapshot,
  distinctCollisionValues,
  distinctReachStates,
  distinctRecipe,
  resolveDistinctRecipe,
} from '../../../db-ivm/tests/distinct-incrementalization-oracle.js'
import {
  checkDistinctCampaign,
  driveDistinctChecked,
} from '../../../db-ivm/tests/distinct-property-oracle.js'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import { declareOracle } from '../oracle-declaration.js'
import { oracleProperty } from '../oracle-config.js'
import type {
  DistinctHistory,
  DistinctRecipe,
  DistinctValue,
} from '../../../db-ivm/tests/distinct-incrementalization-oracle.js'
import type {
  GeneratedHistories,
  OraclePropertyOptions,
} from '../oracle-config.js'

const values = distinctCollisionValues(hash)
declareOracle({
  check: [checkDistinctSnapshot],
  grammar: [distinctRecipe],
})

type Plan = { worlds: DistinctHistory; requiredStates: ReadonlyArray<string> }
type ReceivingOptions = Omit<
  OraclePropertyOptions<DistinctRecipe, ReadonlyArray<string>, Plan>,
  `id` | `histories`
> & {
  histories: Omit<GeneratedHistories<DistinctRecipe>, `runs` | `fixedSeeds`>
}

function receivingOptions(ordered: boolean): ReceivingOptions {
  const constructionStates = new WeakMap<
    DistinctRecipe,
    ReadonlyArray<string>
  >()
  return {
    law: {
      statement: `Public distinct selections retain one of each positive-support value across collision coexistence, duplicate support, removals and reinsertion after each applied source transaction.`,
      authority: `The shared unique-selection law in distinct-incrementalization-oracle.ts and the public distinct contract in docs/guides/live-queries.md.`,
      limits: `The unchanged immutable two-member collision fixture, anchor and support-cycle grammar; ordered and unordered public Collections. No arbitrary payload, framework render schedule or intermediate source publication claim.`,
    },
    histories: {
      arbitrary: distinctRecipe,
      states: [...DISTINCT_REACH_STATES],
      constructed: [
        {
          name: `collision support cycle`,
          enters: [...DISTINCT_REACH_STATES],
          build: (generated) => {
            const recipe = structuredClone(generated)
            constructionStates.set(recipe, DISTINCT_REACH_STATES)
            return recipe
          },
        },
      ],
    },
    // Resolution expands the same support cycle and generated suffix as the
    // old arbitrary. The outer model carries its existing reach obligations;
    // checkDistinctSnapshot retains the independent selected-value judgment.
    resolve: (recipe) => ({
      worlds: resolveDistinctRecipe(recipe),
      requiredStates: constructionStates.get(recipe) ?? [],
    }),
    model: (plan) => plan.requiredStates,
    driver: async ({ worlds }, observe) => {
      const source = createCollection(
        mockSyncCollectionOptions<{
          id: number
          selected: DistinctValue
        }>({
          id: `distinct-collision-source`,
          getKey: (row) => row.id,
          initialData: [],
        }),
      )
      const query = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const selected = q
            .from({ row: source })
            .select(({ row }) => ({
              id: row.selected.id,
              value: row.selected.value,
            }))
            .distinct()
          return ordered
            ? selected.orderBy(({ row }) => row.selected.value)
            : selected
        },
      })
      const retain = query.subscribeChanges(() => {})
      await withOracleCleanup(async () => {
        let previous: Array<number> = []
        for (const [checkpoint, world] of worlds.entries()) {
          source.utils.begin()
          for (let id = 0; id < Math.max(world.length, previous.length); id++) {
            const before = previous[id]
            const after = world[id]
            if (before === after) continue
            if (after === undefined)
              source.utils.write({
                type: `delete`,
                value: { id, selected: { ...values[before!]! } },
              })
            else
              source.utils.write({
                type: before === undefined ? `insert` : `update`,
                value: { id, selected: { ...values[after]! } },
              })
          }
          await source.utils.commit()
          driveDistinctChecked(
            () =>
              checkDistinctSnapshot(
                query.toArray,
                world.map((label) => [{ ...values[label]! }, 1]),
                checkpoint,
              ),
            observe,
          )
          previous = world
        }
        for (const state of distinctReachStates(worlds)) observe(`reach`, state)
      }, [
        () => retain.unsubscribe(),
        () => query.cleanup(),
        () => source.cleanup(),
      ])
    },
    check: checkDistinctCampaign,
  }
}

const unordered = receivingOptions(false)
oracleProperty({
  ...unordered,
  id: `query.distinct-collisions`,
  owns: [
    'src/collection/index.ts#createCollection',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: { ...unordered.histories, runs: 100, fixedSeeds: [2306] },
  check: checkDistinctCampaign,
})
const ordered = receivingOptions(true)
oracleProperty({
  ...ordered,
  id: `query.distinct-collisions-ordered`,
  owns: [
    'src/collection/index.ts#createCollection',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
  ],
  histories: { ...ordered.histories, runs: 100, fixedSeeds: [2306] },
  check: checkDistinctCampaign,
})
