/**
 * Receiving witness for distinct-incrementalization-oracle's unique-selection
 * law. The same grammar/model checks public rows after each applied source
 * transaction. Both unordered and ordered live-query Collections must preserve
 * the colliding selections and their independently changing duplicate support.
 * This tests core's public API; framework render scheduling is outside the law.
 */
import { fc } from '@fast-check/vitest'
import { it } from 'vitest'
import { hash } from '../../../db-ivm/src/hashing/hash.js'
import {
  DISTINCT_REACH_STATES,
  checkDistinctSnapshot,
  distinctCollisionValues,
  distinctHistory,
  distinctReachStates,
} from '../../../db-ivm/tests/distinct-incrementalization-oracle.js'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../oracle-config.js'
import type { DistinctValue } from '../../../db-ivm/tests/distinct-incrementalization-oracle.js'

const PROPERTY = `query.distinct-collisions`
const values = distinctCollisionValues(hash)
declareOracle({ check: [checkDistinctSnapshot], grammar: [distinctHistory] })

for (const ordered of [false, true])
  for (const campaign of [`fixed`, `random`] as const)
    oracleReplayTest(it, ...(campaign === `random` ? [PROPERTY] : []))(
      `preserves public distinct collision rows, ordered=${ordered} (${campaign})`,
      async () => {
        const reach = createOracleReach(PROPERTY, DISTINCT_REACH_STATES)
        await fc.assert(
          fc.asyncProperty(distinctHistory, async (worlds) => {
            reach.beginHistory()
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
                for (
                  let id = 0;
                  id < Math.max(world.length, previous.length);
                  id++
                ) {
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
                checkDistinctSnapshot(
                  query.toArray,
                  world.map((label) => [{ ...values[label]! }, 1]),
                  checkpoint,
                )
                previous = world
              }
              for (const state of distinctReachStates(worlds))
                reach.reach(state)
            }, [
              () => retain.unsubscribe(),
              () => query.cleanup(),
              () => source.cleanup(),
            ])
          }),
          campaign === `fixed`
            ? { numRuns: oracleRuns(100), seed: 2306 }
            : oraclePropertyOptions(100, PROPERTY),
        )
        reach.assertReached()
        process.stdout.write(
          `public distinct ordered=${ordered} ${campaign} reach ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
    )
