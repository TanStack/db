/**
 * The ownership model receives real Query and storage on both Node hosts.
 * Fixed and fresh generated histories share the same driver and comparison.
 * Each host/campaign independently requires each shape, held boundary, operation,
 * and the later-fetch neighbor. Browser receivers import these same parts.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
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
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observePersistedPrecedence } from './persisted-precedence-driver'
import {
  precedenceHistories,
  precedenceReached,
  precedenceStates,
  precedenceViolations,
} from './persisted-precedence-oracle'
import type { PrecedenceHistory } from './persisted-precedence-oracle'

const historyArb: fc.Arbitrary<PrecedenceHistory> = fc.oneof(
  fc
    .tuple(
      fc.record({
        shape: fc.constantFrom(`raw`, `derived`),
        op: fc.constantFrom(`insert`, `update`, `delete`, `upsert`),
        laterFetch: fc.boolean(),
        value: fc.integer({ min: -10, max: 10 }),
      }),
      fc.oneof(
        fc.constant({ phase: `before-result` } as const),
        fc.constant({ phase: `before-fetch` } as const),
        fc.record({
          phase: fc.constant(`during-baseline` as const),
          scanCut: fc.constantFrom(
            `before-read` as const,
            `after-read` as const,
          ),
        }),
      ),
    )
    .map(([history, cut]) => ({ ...history, ...cut })),
  fc.record({
    shape: fc.constantFrom(`raw` as const, `derived` as const),
    phase: fc.constant(`before-restore` as const),
    op: fc.constantFrom(`insert` as const, `upsert` as const),
    laterFetch: fc.boolean(),
    value: fc.integer({ min: -10, max: 10 }),
  }),
  fc.record({
    shape: fc.constantFrom(`raw` as const, `derived` as const),
    origin: fc.constant(`cache` as const),
    phase: fc.constant(`during-baseline` as const),
    scanCut: fc.constantFrom(`before-read` as const, `after-read` as const),
    op: fc.constantFrom(
      `insert` as const,
      `update` as const,
      `delete` as const,
      `upsert` as const,
    ),
    laterFetch: fc.boolean(),
    value: fc.integer({ min: -10, max: 10 }),
  }),
)
declareOracle({
  owns: [`src/query.ts#queryCollectionOptions`],
  grammar: [historyArb, precedenceHistories],
  check: [precedenceViolations],
})
for (const host of [`controlled`, `node-sqlite`] as const)
  describe(`persisted precedence through ${host}`, () => {
    let sequence = 0
    const check = async (
      h: PrecedenceHistory,
      reach: ReturnType<typeof createOracleReach>,
    ) => {
      reach.beginHistory()
      const storage = createStartupHost(host)
      try {
        const observed = await observePersistedPrecedence(
          storage.persistence,
          h,
          `precedence-${host}-${sequence++}`,
        )
        for (const state of precedenceReached(h)) reach.reach(state)
        expect(precedenceViolations(h, observed)).toEqual([])
      } finally {
        storage.close()
      }
    }
    oracleReplayTest(it)(`orders fixed fetch/write histories`, async () => {
      oracleRoute(`fixed history`)
      const reach = createOracleReach(
        `query.precedence.${host}.corpus`,
        precedenceStates,
      )
      for (const h of precedenceHistories) await check(h, reach)
      reach.assertReached()
      console.info(
        `query.precedence.${host}.corpus`,
        Object.fromEntries(reach.counts()),
      )
    })
    it(`rejects a first-result observation that lost the newer inserted row`, async () => {
      oracleRoute(`calibration`)
      const h: PrecedenceHistory = {
        shape: `derived`,
        phase: `before-result`,
        op: `insert`,
        laterFetch: false,
        value: 9,
      }
      const storage = createStartupHost(host)
      try {
        const observed = await observePersistedPrecedence(
          storage.persistence,
          h,
          `precedence-calibration-${host}`,
        )
        expect(precedenceViolations(h, observed)).toEqual([])
        expect(
          precedenceViolations(h, {
            ...observed,
            first: observed.first.filter((row) => row.id !== `new`),
          }).some((v) => v.startsWith(`first:`)),
        ).toBe(true)
      } finally {
        storage.close()
      }
    })
    for (const campaign of [`fixed`, `random`] as const) {
      const property = `query.persisted-write-precedence`
      const register =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      register(
        `orders generated fetch/write histories (${campaign})`,
        async () => {
          const parameters =
            campaign === `fixed`
              ? oracleFixedSeed(2394, { numRuns: oracleRuns(80) })
              : oraclePropertyOptions(80, property)
          oracleRoute(oracleRouteOf(parameters))
          const reach = createOracleReach(
            `query.precedence.${host}.${campaign}`,
            precedenceStates,
          )
          await fc.assert(
            fc.asyncProperty(historyArb, (h) => check(h, reach)),
            parameters,
          )
          reach.assertReached()
          console.info(
            `query.precedence.${host}.${campaign}`,
            Object.fromEntries(reach.counts()),
          )
        },
        60_000,
      )
    }
  })
