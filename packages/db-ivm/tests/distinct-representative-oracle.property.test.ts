/**
 * Receiving driver for the wider distinct owner. Real D2 hashes select a
 * verified four-member collision family. Generated slot worlds are legal
 * nonnegative source relations. Atomic deliveries and unit-split deliveries
 * check the full accumulated output after each graph drain; the shared checker
 * permits representative freedom while rejecting a wrong full-row retraction.
 * Limits: immutable fixture selections, four colliding members plus an anchor,
 * eight slots and twelve random tail worlds; no external source scheduling.
 */
import { fc } from '@fast-check/vitest'
import { it } from 'vitest'
import { D2 } from '../src/d2.js'
import { hash } from '../src/hashing/hash.js'
import { distinct } from '../src/operators/distinct.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import {
  DISTINCT_BUCKET_REACH_STATES,
  checkDistinctRepresentatives,
  distinctBucketHistory,
  distinctBucketReachStates,
  distinctCollisionFamily,
} from './distinct-incrementalization-oracle.js'
import type {
  DistinctBucketHistory,
  DistinctBucketRow,
} from './distinct-incrementalization-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'

const PROPERTY = `ivm.distinct-representatives`
const family = distinctCollisionFamily(hash)

declareOracle({
  check: [checkDistinctRepresentatives],
  grammar: [distinctBucketHistory],
})

function drive(worlds: DistinctBucketHistory, split: boolean) {
  const graph = new D2()
  const input = graph.newInput<[number, DistinctBucketRow]>()
  const reader = input
    .pipe(distinct(([, row]) => family[row.member]))
    .connectReader()
  graph.finalize()
  const output: Weighted<[number, DistinctBucketRow]> = []
  const source = new Map<number, DistinctBucketRow>()
  let previous: Array<DistinctBucketRow> = []
  const check = (checkpoint: string) => {
    for (const message of reader.drain()) output.push(...message.getInner())
    checkDistinctRepresentatives(output, [...source.values()], checkpoint)
  }
  for (const [checkpoint, world] of worlds.entries()) {
    const changes: Weighted<[number, DistinctBucketRow]> = []
    for (const [slot, row] of previous.entries())
      changes.push([[slot, row], -1])
    for (const [slot, row] of world.entries()) changes.push([[slot, row], 1])
    for (const [[slot, row], weight] of changes) {
      if (weight < 0) source.delete(slot)
      else source.set(slot, row)
      input.sendData([[[slot, row], weight]])
      if (split) {
        graph.run()
        check(`${checkpoint}/slot=${slot}/weight=${weight}`)
      }
    }
    graph.run()
    check(String(checkpoint))
    previous = world
  }
}

for (const split of [false, true])
  for (const campaign of [`fixed`, `random`] as const)
    oracleReplayTest(it, ...(campaign === `random` ? [PROPERTY] : []))(
      `conserves full representative contributions, split=${split} (${campaign})`,
      () => {
        const reach = createOracleReach(PROPERTY, DISTINCT_BUCKET_REACH_STATES)
        fc.assert(
          fc.property(distinctBucketHistory, (worlds) => {
            reach.beginHistory()
            drive(worlds, split)
            for (const state of distinctBucketReachStates(worlds))
              reach.reach(state)
          }),
          campaign === `fixed`
            ? { numRuns: oracleRuns(100), seed: 2309 }
            : oraclePropertyOptions(100, PROPERTY),
        )
        reach.assertReached()
        process.stdout.write(
          `distinct representatives split=${split} ${campaign} reach ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
    )

// Small replay of differing unselected fields through the same driver and
// comparison as the generated campaign; no hand-authored expected answer.
oracleReplayTest(it)(
  `retracts the contribution it emitted for an equal selection`,
  () => {
    drive(
      [
        [],
        [
          { member: 0, variant: 0 },
          { member: 0, variant: 1 },
        ],
        [{ member: 0, variant: 1 }],
        [],
      ],
      false,
    )
  },
)
