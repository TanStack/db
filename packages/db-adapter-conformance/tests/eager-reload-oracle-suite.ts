/** Registration and campaigns for the unwrapped eager-reload receiving law. */
import fc from 'fast-check'
import { afterAll, expect, it } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
  oracleRuns,
} from '../../db/tests/oracle-config'
import {
  eagerReloadHistories,
  eagerReloadHistoryArb,
  eagerReloadReached,
  eagerReloadStates,
  eagerReloadViolations,
} from './eager-reload-oracle'
import { observeEagerReload } from './eager-reload-driver'
import type { EagerReloadAdapter } from './eager-reload-driver'
import type { EagerReloadHistory } from './eager-reload-oracle'

declareOracle({
  check: [eagerReloadViolations],
  grammar: [eagerReloadHistoryArb],
})

export function registerEagerReloadConformance(
  property: string,
  adapter: EagerReloadAdapter,
) {
  let sequence = 0
  const fixedReach = createOracleReach(`${property}.fixed-histories`, [
    ...eagerReloadStates,
  ])
  afterAll(() => fixedReach.assertReached())
  const check = async (h: EagerReloadHistory, reach = fixedReach) => {
    reach.beginHistory()
    const observed = await observeEagerReload(
      adapter,
      h,
      `${property}-${sequence++}`,
      () => {
        for (const state of eagerReloadReached(h)) reach.reach(state)
      },
    )
    expect(
      eagerReloadViolations(h, observed),
      JSON.stringify({ h, observed }),
    ).toEqual([])
  }
  oracleReplayTest(it).each(eagerReloadHistories)(
    `replaces the complete result: %j`,
    async (h) => {
      oracleRoute(`fixed history`)
      await check(h)
    },
  )
  oracleReplayTest(it)(
    `rejects an inverted snapshot decision on retained rows`,
    async () => {
      oracleRoute(`calibration`)
      const h = eagerReloadHistories.find(
        (candidate) =>
          candidate.previous === 1 &&
          candidate.next === 2 &&
          !candidate.mutation,
      )!
      const observed = await observeEagerReload(
        adapter,
        h,
        `${property}-inverted`,
        undefined,
        true,
      )
      expect(eagerReloadViolations(h, observed)).not.toEqual([])
    },
  )
  for (const campaign of [`fixed`, `random`] as const) {
    const register =
      campaign === `fixed`
        ? oracleReplayTest(it)
        : oracleReplayTest(it, property)
    register(
      `reconciles generated reload histories (${campaign})`,
      async () => {
        const parameters =
          campaign === `fixed`
            ? oracleFixedSeed(2367, { numRuns: oracleRuns(80) })
            : oraclePropertyOptions(80, property)
        oracleRoute(oracleRouteOf(parameters))
        const reach = createOracleReach(`${property}.${campaign}`, [
          ...eagerReloadStates,
        ])
        await fc.assert(
          fc.asyncProperty(eagerReloadHistoryArb, (h) => check(h, reach)),
          parameters,
        )
        reach.assertReached()
        process.stdout.write(
          `${property}.${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
      120_000,
    )
  }
}
