/**
 * Receiving registration for persisted-startup-oracle.ts. Every adapter runs
 * its legal grammar through both storage hosts, at the same four cuts and
 * reopen. Fixed histories and generated histories share driver and judgment.
 * Each host/campaign enforces its own reach; one cannot cover another's gap.
 */
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
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
  expectedPersistedStartup,
  persistedStartupCutViolations,
  persistedStartupViolations,
} from '../src/persisted-startup-oracle'
import { observePersistedStartup } from './persisted-startup-driver'
import { createStartupHost } from './persisted-startup-host'
import type { Arbitrary } from 'fast-check'
import type { PersistedStartupHistory } from '../src/persisted-startup-oracle'
import type { PersistedStartupAdapter } from './persisted-startup-driver'

declareOracle({
  check: [persistedStartupCutViolations, persistedStartupViolations],
})

export function registerPersistedStartupConformance<
  H extends PersistedStartupHistory,
>({
  property,
  adapter,
  histories,
  arbitrary,
  origins = [],
  origin = () => undefined,
}: {
  property: string
  adapter: PersistedStartupAdapter<H>
  histories: Array<H>
  arbitrary: Arbitrary<H>
  origins?: Array<string>
  origin?: (history: H) => string | undefined
}) {
  // A later refresh must not make a stale startup durable result acceptable.
  oracleReplayTest(it)(
    `rejects stale durability before a later refresh`,
    () => {
      const history = histories[0]!
      const stale = expectedPersistedStartup(
        { ...history, next: history.previous },
        adapter.scope,
      )
      expect(
        persistedStartupCutViolations(
          history,
          adapter.scope,
          `startupDurable`,
          stale,
        ),
      ).not.toEqual([])
    },
  )
  const states = [
    `response-before-restore`,
    `restore-before-response`,
    `empty-result`,
    `overlapping-update`,
    `omitted-row`,
    ...(adapter.scope === `scoped` ? [`peer-owner`] : []),
    ...origins,
  ]
  for (const host of [`controlled`, `node-sqlite`] as const) {
    describe(`${property} through ${host}`, () => {
      const reach = createOracleReach(`${property}.${host}`, states)
      afterAll(() => {
        reach.assertReached()
        process.stdout.write(
          `${property}.${host} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      })
      let sequence = 0
      async function check(history: H, historyReach = reach) {
        historyReach.beginHistory()
        const storage = createStartupHost(host)
        try {
          const observation = await observePersistedStartup(
            adapter,
            storage.persistence,
            storage.holdBaseline,
            history,
            `startup-${host}-${sequence++}`,
            storage.readRowCount,
            () => {
              historyReach.reach(
                history.response === `before-restore`
                  ? `response-before-restore`
                  : `restore-before-response`,
              )
              if (history.next === 0) historyReach.reach(`empty-result`)
              if (history.next & history.previous)
                historyReach.reach(`overlapping-update`)
              if (history.previous & ~history.next)
                historyReach.reach(`omitted-row`)
              if (history.peer) historyReach.reach(`peer-owner`)
              const responseOrigin = origin(history)
              if (responseOrigin) historyReach.reach(responseOrigin)
            },
          )
          expect(
            persistedStartupViolations(history, adapter.scope, observation),
          ).toEqual([])
        } finally {
          storage.close()
        }
      }
      oracleReplayTest(it).each(histories)(
        `reconciles persisted startup: %j`,
        async (history) => {
          oracleRoute(`fixed history`)
          await check(history)
        },
      )
      for (const campaign of [`fixed`, `random`] as const) {
        const register =
          campaign === `fixed`
            ? oracleReplayTest(it)
            : oracleReplayTest(it, property)
        register(
          `reconciles generated startup histories (${campaign})`,
          async () => {
            const parameters =
              campaign === `fixed`
                ? oracleFixedSeed(2367, { numRuns: oracleRuns(80) })
                : oraclePropertyOptions(80, property)
            oracleRoute(oracleRouteOf(parameters))
            const generatedReach = createOracleReach(
              `${property}.${host}.${campaign}`,
              states,
            )
            await fc.assert(
              fc.asyncProperty(arbitrary, (history) =>
                check(history, generatedReach),
              ),
              parameters,
            )
            generatedReach.assertReached()
            process.stdout.write(
              `${property}.${host}.${campaign} ${JSON.stringify(Object.fromEntries(generatedReach.counts()))}\n`,
            )
          },
          60_000,
        )
      }
    })
  }
}
