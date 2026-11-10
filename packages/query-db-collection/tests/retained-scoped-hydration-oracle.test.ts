/** The scope law receives controlled storage and the real SQLite demand path. */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import {
  observeCachedPeerClaim,
  observeRetainedScopedHydration,
  requestedRetainedScope,
} from './retained-scoped-hydration-driver'
import {
  cachedPeerClaimHistories,
  cachedPeerClaimHistoryArb,
  cachedPeerClaimReached,
  cachedPeerClaimStates,
  cachedPeerClaimViolations,
  scopedHydrationHistories,
  scopedHydrationHistoryArb,
  scopedHydrationReached,
  scopedHydrationStates,
  scopedHydrationViolations,
} from './retained-scoped-hydration-oracle'
import type {
  CachedPeerClaimHistory,
  ScopedHydrationHistory,
} from './retained-scoped-hydration-oracle'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'

declareOracle({
  owns: [`src/query.ts#queryCollectionOptions`],
  grammar: [
    scopedHydrationHistoryArb,
    scopedHydrationHistories,
    cachedPeerClaimHistoryArb,
    cachedPeerClaimHistories,
  ],
  check: [scopedHydrationViolations, cachedPeerClaimViolations],
})
for (const host of [`controlled`, `node-sqlite`] as const)
  describe(`retained scoped hydration through ${host}`, () => {
    let sequence = 0
    async function check(
      h: ScopedHydrationHistory,
      reach?: ReturnType<typeof createOracleReach>,
    ) {
      const storage = createStartupHost(host)
      if (host === `controlled`) {
        // The controlled persistence adapter supplies the same scope predicate
        // that real SQLite evaluates. It returns stored facts, not model rows.
        const adapter: PersistenceAdapter = storage.persistence.adapter
        const loadSubset = adapter.loadSubset
        adapter.loadSubset = async (target, options, context) => {
          const entries = await loadSubset(target, options, context)
          if (!options.where) return entries
          const scope = requestedRetainedScope(options)
          const matching = entries.filter((row) => row.value.scope === scope)
          if (options.limit === undefined) return matching
          return matching
            .sort((a, b) => String(b.key).localeCompare(String(a.key)))
            .slice(0, options.limit)
        }
      }
      return withOracleCleanup(async () => {
        reach?.beginHistory()
        const actual = await observeRetainedScopedHydration(
          storage.persistence,
          h,
          `scoped-${host}-${sequence++}`,
        )
        for (const state of scopedHydrationReached(h)) reach?.reach(state)
        expect(
          scopedHydrationViolations(h, actual),
          JSON.stringify({ h, actual }),
        ).toEqual([])
        return actual
      }, [() => storage.close()])
    }
    oracleReplayTest(it)(
      `revalidates only the acquired retained scope`,
      async () => {
        oracleRoute(`fixed history`)
        const reach = createOracleReach(
          `query.scoped-hydration.${host}.histories`,
          [...scopedHydrationStates],
        )
        for (const h of scopedHydrationHistories) await check(h, reach)
        reach.assertReached()
        process.stdout.write(
          `query.scoped-hydration.${host}.histories ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
      60_000,
    )
    oracleReplayTest(it)(
      `rejects a full-store restore that publishes unrequested saved rows`,
      async () => {
        oracleRoute(`calibration`)
        const h = scopedHydrationHistories[0]!
        const actual = await check(h)
        expect(
          scopedHydrationViolations(h, {
            ...actual,
            first: actual.firstDurable,
          }).some((v) => v.startsWith(`first:`)),
        ).toBe(true)
      },
    )
    for (const campaign of [`fixed`, `random`] as const) {
      const property = `query.retained-scoped-hydration`
      const register =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      register(
        `revalidates generated retained scopes (${campaign})`,
        async () => {
          const parameters =
            campaign === `fixed`
              ? oracleFixedSeed(1481, { numRuns: oracleRuns(60) })
              : oraclePropertyOptions(60, property)
          oracleRoute(oracleRouteOf(parameters))
          const reach = createOracleReach(
            `query.scoped-hydration.${host}.${campaign}`,
            [...scopedHydrationStates],
          )
          await fc.assert(
            fc.asyncProperty(scopedHydrationHistoryArb, async (h) => {
              await check(h, reach)
            }),
            parameters,
          )
          reach.assertReached()
          process.stdout.write(
            `query.scoped-hydration.${host}.${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
          )
        },
        120_000,
      )
    }
    async function checkCached(
      h: CachedPeerClaimHistory,
      reach?: ReturnType<typeof createOracleReach>,
    ) {
      const storage = createStartupHost(host)
      return withOracleCleanup(async () => {
        reach?.beginHistory()
        const actual = await observeCachedPeerClaim(
          storage.persistence,
          h,
          `cached-claim-${host}-${sequence++}`,
        )
        for (const state of cachedPeerClaimReached(h)) reach?.reach(state)
        expect(
          cachedPeerClaimViolations(h, actual),
          JSON.stringify({ h, actual }),
        ).toEqual([])
        return actual
      }, [() => storage.close()])
    }
    oracleReplayTest(it)(
      `keeps a peer value when a cached Query first claims it`,
      async () => {
        oracleRoute(`fixed history`)
        const reach = createOracleReach(
          `query.cached-claim.${host}.histories`,
          [...cachedPeerClaimStates],
        )
        for (const h of cachedPeerClaimHistories) await checkCached(h, reach)
        reach.assertReached()
        process.stdout.write(
          `query.cached-claim.${host}.histories ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
    )
    oracleReplayTest(it)(
      `rejects stale cache overwrite at first claim`,
      async () => {
        oracleRoute(`calibration`)
        const h = cachedPeerClaimHistories[0]!
        const actual = await checkCached(h)
        expect(
          cachedPeerClaimViolations(h, { ...actual, claimed: h.cached }).some(
            (v) => v.startsWith(`claimed:`),
          ),
        ).toBe(true)
      },
    )
    for (const campaign of [`fixed`, `random`] as const) {
      const property = `query.cached-peer-claim`
      const register =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      register(
        `orders generated cached peer claims (${campaign})`,
        async () => {
          const parameters =
            campaign === `fixed`
              ? oracleFixedSeed(1376, { numRuns: oracleRuns(60) })
              : oraclePropertyOptions(60, property)
          oracleRoute(oracleRouteOf(parameters))
          const reach = createOracleReach(
            `query.cached-claim.${host}.${campaign}`,
            [...cachedPeerClaimStates],
          )
          await fc.assert(
            fc.asyncProperty(cachedPeerClaimHistoryArb, async (h) => {
              await checkCached(h, reach)
            }),
            parameters,
          )
          reach.assertReached()
          process.stdout.write(
            `query.cached-claim.${host}.${campaign} ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
          )
        },
        120_000,
      )
    }
  })
