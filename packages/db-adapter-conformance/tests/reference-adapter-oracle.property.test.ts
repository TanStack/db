import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  ConformanceViolation,
  checkEagerLiveSourceHistory,
  eagerLiveSourceHistoryArb,
  eagerLiveSourceModel,
  eagerLiveSourceProperty,
  reachStatesFor,
} from '../src'
import { referenceDriver } from './reference-adapter'
import type {
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
  EagerLiveSourceStep,
} from '../src'
import type { ReferenceMutant } from './reference-adapter'

/**
 * # The eager live-source oracle on a conforming adapter
 *
 * The shared oracle in `src/eager-live-source-oracle.ts` states the laws, the
 * model, the history grammar, and the check. This file supplies one production
 * driver: the reference push adapter in `reference-adapter.ts`, which declares
 * every optional capability the oracle checks. A green run here shows that
 * the check accepts a conforming adapter. It says nothing about a published
 * adapter; each one needs its own driver.
 *
 * - **Campaigns.** The same property, grammar, and run budget run with a
 *   fixed seed and without one (ORC-007). A path replay runs only the
 *   requested history. Each campaign fails when fewer than five histories
 *   reach a declared state (ORC-015).
 * - **Calibration.** Hostile mutants of the reference adapter each break one
 *   law, and the fixed campaign must reject each with that law (ORC-006).
 * - **Grammar controls (ORC-004).** Known witnesses from the Neon and
 *   TrailBase suites are rebuilt as histories and replayed through the check
 *   (reconstruction). Nearby invalid histories are skipped without moving the
 *   model (exclusion). Removing each step kind loses the declared state that
 *   only it reaches (ablation). Range: keys 1..5 and three titles let batches
 *   revisit keys and complete deliveries omit held keys; histories hold up to
 *   12 steps; waits look 0..2 txids ahead, so an off-by-one boundary is
 *   reachable on both sides.
 */

const property = `adapter-conformance.eager-live-source.reference`
const driver = referenceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver.capabilities)
// The reference adapter declares every capability, so its grammar spreads
// over the most step kinds. Across 20 seeds, 400 histories reached every
// declared state at least 11 times.
const runs = 400
// Timed waits sleep past their timeout, so a campaign takes several seconds.
const campaignTimeoutMs = 120_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(
    property,
    reachStatesFor(driver.capabilities),
    {
      minimum: 5,
    },
  )
  await fc.assert(eagerLiveSourceProperty(driver, reach), options)
  return reach
}

describe(`eager live-source conformance: reference adapter`, () => {
  oracleReplayTest(it)(
    `conforms on a fixed-seed campaign`,
    async () => {
      const reach = await campaign({ seed: 2118, numRuns: oracleRuns(runs) })
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  oracleReplayTest(it, property)(
    `conforms on a random campaign or a replayed seed`,
    async () => {
      const reach = await campaign(oraclePropertyOptions(runs, property))
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  // Each mutant breaks one law; the check must report that law.
  const mutants: Array<[ReferenceMutant, string]> = [
    [`ready-before-delivery`, `READY-2`],
    [`wraps-loading-failure`, `READY-4`],
    [`failure-clears-rows`, `HEALTH-1`],
    [`transient-is-fatal`, `HEALTH-1`],
    [`never-recovers`, `HEALTH-2`],
    [`transient-fails-loading`, `RETRY-1`],
    [`splits-batch`, `PUB-1`],
    [`drops-deletes`, `PUB-3`],
    [`snapshot-merges`, `PUB-7`],
    [`leaks-subscription`, `LIFE-2`],
    [`restart-replays-rows`, `LIFE-5`],
    [`keeps-failed-source`, `LIFE-10`],
    [`double-release`, `LIFE-10`],
    [`detached-rejection`, `HEALTH-5`],
    [`logs-failure`, `HEALTH-5`],
    [`wait-off-by-one`, `EVID-1`],
    [`wait-ignores-timeout`, `EVID-3`],
    [`disconnect-fails`, `RECON-1`],
    [`renew-resubscribes`, `RENEW-1`],
  ]
  oracleReplayTest(it).each(mutants)(
    `rejects the %s mutant with %s`,
    async (mutant, law) => {
      const result = await fc.check(
        eagerLiveSourceProperty(referenceDriver(mutant)),
        {
          seed: 2118,
          numRuns: runs,
        },
      )
      expect(result.failed).toBe(true)
      expect(result.errorInstance).toBeInstanceOf(ConformanceViolation)
      expect((result.errorInstance as ConformanceViolation).law).toContain(law)
    },
    campaignTimeoutMs,
  )
})

// PUB-1 has two commit granularities. The per-change reference adapter
// commits each change of a batch alone; it must conform, and a variant that
// commits them out of order must be rejected by the per-change comparison.
describe(`eager live-source conformance: per-change commits`, () => {
  oracleReplayTest(it)(
    `the per-change reference adapter conforms`,
    async () => {
      const perChange = referenceDriver(undefined, { perChange: true })
      await fc.assert(eagerLiveSourceProperty(perChange), {
        seed: 2118,
        numRuns: runs,
      })
    },
    campaignTimeoutMs,
  )

  oracleReplayTest(it)(
    `rejects a batch committed out of order with PUB-1`,
    async () => {
      const reversed = referenceDriver(`reverses-batch`, { perChange: true })
      const result = await fc.check(eagerLiveSourceProperty(reversed), {
        seed: 2118,
        numRuns: runs,
      })
      expect(result.failed).toBe(true)
      expect((result.errorInstance as ConformanceViolation).law).toContain(
        `PUB-1`,
      )
    },
    campaignTimeoutMs,
  )
})

// ---------------------------------------------------------------------------
// Grammar controls (ORC-004)
// ---------------------------------------------------------------------------

/**
 * Reconstruction. Each known witness is a history from an existing adapter
 * suite, translated into this grammar's steps. The model must accept every
 * step, and the reference adapter must pass it. A witness cell the grammar
 * cannot express is named with what it lacks.
 */
const witnesses: Array<[string, EagerLiveSourceHistory]> = [
  [
    // neon-pkgs realtime-tanstack collection-options.test.ts:119
    `Neon: installs rows and changes as authoritative state`,
    [
      {
        kind: `snapshot`,
        rows: [
          { id: 1, title: `a` },
          { id: 2, title: `b` },
        ],
      },
      { kind: `wait`, ahead: 1 },
      {
        kind: `changes`,
        changes: [
          { type: `upsert`, row: { id: 1, title: `c` } },
          { type: `delete`, id: 2 },
          { type: `upsert`, row: { id: 3, title: `c` } },
        ],
      },
    ],
  ],
  [
    // collection-options.test.ts:164
    `Neon: remembers a transaction that arrives before awaitTxId`,
    [
      { kind: `snapshot`, rows: [{ id: 1, title: `a` }] },
      {
        kind: `changes`,
        changes: [{ type: `upsert`, row: { id: 1, title: `b` } }],
      },
      { kind: `wait`, ahead: 0 },
    ],
  ],
  [
    // collection-options.test.ts:227, the `connecting` cell
    `Neon: stays ready while the transport reconnects`,
    [
      { kind: `snapshot`, rows: [{ id: 1, title: `a` }] },
      { kind: `disconnect` },
    ],
  ],
  [
    // collection-options.test.ts:243
    `Neon: a provider error before ready is a Collection error`,
    [{ kind: `fail` }],
  ],
  [
    // collection-options.test.ts:255
    `Neon: renews an expiring capability`,
    [{ kind: `renew` }],
  ],
  [
    // collection-options.test.ts:364. Its timeout cell is outside the grammar
    // (EVID-3 is not checked); its cleanup cell is the final retirement.
    `Neon: cleanup rejects a pending wait`,
    [{ kind: `wait`, ahead: 1 }],
  ],
  [
    // trailbase-db-collection lifecycle-oracle.property.test.ts, stream end
    `TrailBase: a stream failure after ready keeps rows and reports`,
    [
      { kind: `snapshot`, rows: [{ id: 1, title: `a` }] },
      {
        kind: `changes`,
        changes: [{ type: `upsert`, row: { id: 2, title: `b` } }],
      },
      { kind: `fail` },
    ],
  ],
  [
    // A retried failure after ready, then a delivery that recovers.
    `retry: a retried failure is reported, then cleared by a delivery`,
    [
      { kind: `snapshot`, rows: [{ id: 1, title: `a` }] },
      { kind: `transient-failure` },
      {
        kind: `changes`,
        changes: [{ type: `upsert`, row: { id: 1, title: `b` } }],
      },
    ],
  ],
  [
    // lifecycle-oracle.property.test.ts, restart fencing
    `TrailBase: a restart is a fresh sync run`,
    [
      { kind: `snapshot`, rows: [{ id: 1, title: `a` }] },
      { kind: `restart` },
      { kind: `snapshot`, rows: [{ id: 2, title: `b` }] },
    ],
  ],
]

/** Whether `history` lies in the generator's domain. */
function withinGrammar(history: EagerLiveSourceHistory): boolean {
  const row = (r: { id: number; title: string }) =>
    r.id >= 1 && r.id <= 5 && [`a`, `b`, `c`].includes(r.title)
  return (
    history.length >= 1 &&
    history.length <= 12 &&
    history.every((step) => {
      switch (step.kind) {
        case `snapshot`:
          return step.rows.length <= 4 && step.rows.every(row)
        case `changes`:
          return (
            step.changes.length <= 3 &&
            step.changes.every((change) =>
              change.type === `upsert`
                ? row(change.row)
                : change.id >= 1 && change.id <= 5,
            )
          )
        case `wait`:
          return step.ahead >= 0 && step.ahead <= 2
        default:
          return true
      }
    })
  )
}

describe(`eager live-source grammar controls`, () => {
  oracleReplayTest(it).each(witnesses)(
    `reconstructs %s`,
    async (_name, history) => {
      expect(withinGrammar(history)).toBe(true)
      const { skipped } = await checkEagerLiveSourceHistory(driver, history)
      expect(skipped).toBe(0)
    },
  )

  // Exclusion: each history ends with one step that is illegal where it
  // stands. The check skips it and leaves the model where it was.
  const invalid: Array<[string, EagerLiveSourceHistory]> = [
    [`a batch before the first ready`, [{ kind: `changes`, changes: [] }]],
    [
      `a second renewal in one sync run`,
      [{ kind: `renew` }, { kind: `renew` }],
    ],
    [
      `a reconnect without a disconnect`,
      [{ kind: `snapshot`, rows: [] }, { kind: `reconnect` }],
    ],
    [
      `a delivery after the provider failed`,
      [{ kind: `fail` }, { kind: `snapshot`, rows: [] }],
    ],
    [
      `a batch while disconnected`,
      [
        { kind: `snapshot`, rows: [] },
        { kind: `disconnect` },
        { kind: `changes`, changes: [] },
      ],
    ],
  ]
  oracleReplayTest(it).each(invalid)(`excludes %s`, async (_name, history) => {
    const { skipped } = await checkEagerLiveSourceHistory(driver, history)
    expect(skipped).toBe(1)
  })

  // Ablation: removing a step kind loses the declared state that only it
  // reaches, so every kind contributes to the laws the campaign enforces.
  const ablations: Array<
    [EagerLiveSourceStep[`kind`], EagerLiveSourceReachState]
  > = [
    [`snapshot`, `first-ready`],
    [`changes`, `change-batch`],
    [`fail`, `failure-after-ready`],
    [`restart`, `restart`],
    [`wait`, `wait-before-evidence-fulfilled`],
    [`disconnect`, `reconnect`],
    [`reconnect`, `reconnect`],
    [`renew`, `renewal`],
    [`transient-failure`, `transient-failure-reported`],
  ]
  oracleReplayTest(it).each(ablations)(
    `without %s steps, histories never reach %s`,
    async (kind, lost) => {
      const states = reachStatesFor(driver.capabilities)
      const reach = createOracleReach(`${property}.ablation`, states, {
        replaying: false,
      })
      await fc.assert(
        fc.asyncProperty(
          historyArb.map((history) =>
            history.filter((step) => step.kind !== kind),
          ),
          async (history) => {
            reach.beginHistory()
            await checkEagerLiveSourceHistory(driver, history, {
              reach: reach.reach,
            })
          },
        ),
        { seed: 2118, numRuns: 100 },
      )
      expect(reach.counts().get(lost)).toBe(0)
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  check: [checkEagerLiveSourceHistory, eagerLiveSourceProperty],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [historyArb],
})
