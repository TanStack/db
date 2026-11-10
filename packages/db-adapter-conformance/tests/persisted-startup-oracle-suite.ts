/**
 * Receiving registration for persisted-startup-oracle.ts. Every adapter runs
 * its legal grammar through both storage hosts, at fallback (when enabled),
 * the first source result, durability, refresh and
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
  PersistedStartupViolation,
  expectedPersistedStartup,
  expectedStartupFallback,
  persistedStartupCutViolations,
  persistedStartupFallbackViolations,
  persistedStartupViolations,
} from './persisted-startup-oracle'
import { observePersistedStartup } from './persisted-startup-driver'
import { createStartupHost } from './persisted-startup-host'
import type { Arbitrary } from 'fast-check'
import type { PersistedStartupHistory } from './persisted-startup-oracle'
import type { PersistedStartupAdapter } from './persisted-startup-driver'

declareOracle({
  check: [
    persistedStartupCutViolations,
    persistedStartupFallbackViolations,
    persistedStartupViolations,
  ],
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
      oracleRoute(`calibration`)
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
  oracleReplayTest(it)(`rejects a lost persisted fallback`, () => {
    oracleRoute(`calibration`)
    const h = {
      ...histories.find((history) => history.previous !== 0)!,
      initialRender: `network-first` as const,
      response: `after-deadline` as const,
    }
    const saved = expectedStartupFallback(h, adapter.scope)
    expect(
      persistedStartupFallbackViolations(h, adapter.scope, `fallback`, {
        ...saved,
        rows: [],
      }),
    ).not.toEqual([])
    expect(
      persistedStartupCutViolations(h, adapter.scope, `startupDurable`, saved),
    ).not.toEqual([])
  })
  const states = [
    `response-before-restore`,
    `restore-before-response`,
    `network-first-source-result`,
    `network-first-fallback`,
    `empty-result`,
    `empty-baseline`,
    `overlapping-update`,
    `omitted-row`,
    `persisting-mutation`,
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
              if (history.initialRender)
                historyReach.reach(
                  history.response === `after-deadline`
                    ? `network-first-fallback`
                    : `network-first-source-result`,
                )
              if (history.mutation) historyReach.reach(`persisting-mutation`)
              if (history.previous === 0) historyReach.reach(`empty-baseline`)
              if (history.next === 0) historyReach.reach(`empty-result`)
              if (history.next & history.previous)
                historyReach.reach(`overlapping-update`)
              if (history.previous & ~history.next)
                historyReach.reach(`omitted-row`)
              if (history.peer) historyReach.reach(`peer-owner`)
              const responseOrigin = origin(history)
              if (responseOrigin) historyReach.reach(responseOrigin)
            },
            (violations) => expect(violations).toEqual([]),
          )
          expect(
            persistedStartupViolations(history, adapter.scope, observation),
          ).toEqual([])
        } finally {
          storage.close()
        }
      }
      // A source that publishes after fallback but silently loses its durable
      // writes must fail before refresh can repair it. Seed and restore use the
      // real host; only the receiving source's persistence commits are dropped.
      oracleReplayTest(it)(
        `rejects lost source persistence after fallback`,
        async () => {
          oracleRoute(`calibration`)
          const history = histories.find(
            (h) => h.response === `after-deadline`,
          )!
          // Controlled storage models one Collection; use a fresh host for
          // each candidate so the clean run cannot seed the corrupted run.
          const clean = createStartupHost(host)
          try {
            await observePersistedStartup(
              adapter,
              clean.persistence,
              clean.holdBaseline,
              history,
              `clean-persistence-${host}`,
              clean.readRowCount,
            )
          } catch (error) {
            // A broken clean trace is not a calibration candidate. The normal
            // histories judge it; a second fault cannot calibrate that trace.
            if (error instanceof PersistedStartupViolation) return
            throw error
          } finally {
            clean.close()
          }
          const storage = createStartupHost(host)
          try {
            await expect(
              observePersistedStartup(
                {
                  ...adapter,
                  create: (persistence, h, id) =>
                    adapter.create(
                      {
                        ...persistence,
                        adapter: new Proxy(persistence.adapter, {
                          get(target, key) {
                            if (key === `applyCommittedTx`)
                              return async () => {}
                            const value: unknown = Reflect.get(target, key)
                            return typeof value === `function`
                              ? value.bind(target)
                              : value
                          },
                        }),
                      },
                      h,
                      id,
                    ),
                },
                storage.persistence,
                storage.holdBaseline,
                history,
                `lost-persistence-${host}`,
                storage.readRowCount,
              ),
            ).rejects.toThrow(/startupDurable:/)
          } finally {
            storage.close()
          }
        },
      )
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
