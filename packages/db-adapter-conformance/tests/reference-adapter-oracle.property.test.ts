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
  ConformanceRow,
  EagerLiveSourceHistory,
  EagerLiveSourceReachState,
  EagerLiveSourceStep,
  GrammarDomain,
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
 *   12 steps after a startup burst of up to three batches; waits look 0..2 txids ahead, so an off-by-one boundary is
 *   reachable on both sides.
 */

const property = `adapter-conformance.eager-live-source.reference`
const driver = referenceDriver()
const historyArb = eagerLiveSourceHistoryArb(driver)
// The reference adapter declares every capability, so its grammar spreads
// over the most step kinds. Across 20 seeds, 600 histories reached every
// declared state at least 15 times.
const runs = 600
// Timed waits sleep past their timeout, so a campaign takes several seconds.
const campaignTimeoutMs = 120_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, reachStatesFor(driver), {
    minimum: 5,
  })
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
    [`drops-buffered`, `READY-10`],
    [`buffer-before-rows`, `PUB-9`],
    [`replays-per-batch`, `PUB-5`],
    [`ready-before-buffer`, `READY-10 (rows when ready)`],
    [`shows-buffered`, `READY-10/PUB-9`],
    [`merges-updates`, `FID-1`],
    [`dates-as-strings`, `FID-1 (values)`],
    [`bigints-as-numbers`, `FID-1 (values)`],
    [`drops-nulls`, `FID-1 (values)`],
    [`loses-negative-zero`, `FID-1 (values)`],
    [`relabels-inserts`, `PUB-2`],
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
    // rxdb-db-collection rxdb.test.ts, `marks initial sync ready only after
    // its rows are applied`: a document inserted after the initial query read
    // and then patched is buffered; the newer value wins over the older one.
    `RxDB: buffered startup changes apply after the initial rows, in order`,
    [
      {
        kind: `changes`,
        changes: [{ type: `upsert`, row: { id: 2, title: `b` } }],
      },
      {
        kind: `changes`,
        changes: [{ type: `upsert`, row: { id: 2, title: `c` } }],
      },
      { kind: `snapshot`, rows: [{ id: 1, title: `a` }], seen: 0 },
    ],
  ],
  [
    // FID-1: an update without the optional field removes it.
    `an update that omits a field removes it`,
    [
      { kind: `snapshot`, rows: [{ id: 1, title: `a`, note: `x` }] },
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
function withinGrammar(
  history: EagerLiveSourceHistory,
  domain: GrammarDomain,
): boolean {
  // With value kinds every row carries a value; without them none does.
  const valued = (domain.valueKinds ?? []).length > 0
  const row = (r: ConformanceRow) =>
    r.id >= 1 &&
    r.id <= 5 &&
    [`a`, `b`, `c`].includes(r.title) &&
    (!Object.hasOwn(r, `note`) || [`x`, `y`].includes(r.note!)) &&
    Object.hasOwn(r, `value`) === valued
  return (
    history.length >= 1 &&
    history.length <= 15 &&
    history.every((step) => {
      switch (step.kind) {
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
        case `snapshot`:
          return (
            step.rows.length <= 4 &&
            step.rows.every(row) &&
            (step.seen ?? 0) >= 0 &&
            (step.seen ?? 0) <= 3
          )
        default:
          return true
      }
    })
  )
}

// The witnesses above carry no values, so they reconstruct in the grammar
// of the same driver without value kinds. Value witnesses use the full one.
const withoutValues = { ...driver, valueKinds: undefined }

const valueWitnesses: Array<[string, EagerLiveSourceHistory]> = [
  [
    // A random campaign (seed 95028) found this: a synced update that only
    // changes -0 to 0 published no change event, so the event fold kept -0
    // while the Collection held 0. Maintainer decision (2026-10-29): -0 and
    // 0 are distinct row values.
    `FID-1, PUB-2: an update from -0 to 0 publishes a change`,
    [
      {
        kind: `snapshot`,
        rows: [{ id: 5, title: `a`, value: -0 }],
        seen: 0,
      },
      {
        kind: `changes`,
        changes: [{ type: `upsert`, row: { id: 5, title: `a`, value: 0 } }],
      },
    ],
  ],
  [
    // FID-1's named cases: a Date and a bigint beyond 2^53 on the initial
    // load, then an explicit falsy value and a nested object in a change.
    `FID-1: typed values on the load and in a change`,
    [
      {
        kind: `snapshot`,
        rows: [
          { id: 1, title: `a`, value: new Date(Date.UTC(2026, 9, 29)) },
          { id: 2, title: `a`, value: 9_007_199_254_740_993n },
        ],
        seen: 0,
      },
      {
        kind: `changes`,
        changes: [
          { type: `upsert`, row: { id: 1, title: `a`, value: false } },
          {
            type: `upsert`,
            row: { id: 3, title: `b`, value: { nested: { deep: [1] } } },
          },
        ],
      },
    ],
  ],
]

describe(`eager live-source grammar controls`, () => {
  oracleReplayTest(it).each(witnesses)(
    `reconstructs %s`,
    async (_name, history) => {
      expect(withinGrammar(history, withoutValues)).toBe(true)
      const { skipped } = await checkEagerLiveSourceHistory(
        withoutValues,
        history,
      )
      expect(skipped).toBe(0)
    },
  )

  oracleReplayTest(it).each(valueWitnesses)(
    `reconstructs %s`,
    async (_name, history) => {
      expect(withinGrammar(history, driver)).toBe(true)
      const { skipped } = await checkEagerLiveSourceHistory(driver, history)
      expect(skipped).toBe(0)
    },
  )

  // Exclusion: each history ends with one step that is illegal where it
  // stands. The check skips it and leaves the model where it was. A batch
  // before the first ready is legal only with `listen-before-fetch`, so its
  // case runs on a driver that does not declare it.
  const lateListener = {
    ...driver,
    capabilities: new Set(
      [...driver.capabilities].filter((c) => c !== `listen-before-fetch`),
    ),
  }
  oracleReplayTest(it)(
    `excludes a batch before the first ready without listen-before-fetch`,
    async () => {
      const history = [{ kind: `changes` as const, changes: [] }]
      const { skipped } = await checkEagerLiveSourceHistory(
        lateListener,
        history,
      )
      expect(skipped).toBe(1)
    },
  )
  const invalid: Array<[string, EagerLiveSourceHistory]> = [
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
    const { skipped } = await checkEagerLiveSourceHistory(
      withoutValues,
      history,
    )
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
    [`changes`, `change-before-ready`],
  ]
  oracleReplayTest(it).each(ablations)(
    `without %s steps, histories never reach %s`,
    async (kind, lost) => {
      const states = reachStatesFor(driver)
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

  oracleReplayTest(it)(
    `without notes, histories never reach field-removed`,
    async () => {
      const reach = createOracleReach(
        `${property}.ablation`,
        reachStatesFor(driver),
        { replaying: false },
      )
      const plain = (row: { id: number; title: string }) => ({
        id: row.id,
        title: row.title,
      })
      await fc.assert(
        fc.asyncProperty(
          historyArb.map((history) =>
            history.map((step): EagerLiveSourceStep => {
              if (step.kind === `snapshot`) {
                return { ...step, rows: step.rows.map(plain) }
              }
              if (step.kind !== `changes`) return step
              return {
                kind: `changes`,
                changes: step.changes.map((change) =>
                  change.type === `upsert`
                    ? { type: `upsert`, row: plain(change.row) }
                    : change,
                ),
              }
            }),
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
      expect(reach.counts().get(`field-removed`)).toBe(0)
    },
    campaignTimeoutMs,
  )

  // Path ablation: when live changes carry no value and no retouch, no
  // history reaches a
  // value kind on the change path, so the load and change states each need
  // their own deliveries.
  oracleReplayTest(it)(
    `without values in live changes, histories never reach value:date:change`,
    async () => {
      const reach = createOracleReach(
        `${property}.ablation`,
        reachStatesFor(driver),
        { replaying: false },
      )
      await fc.assert(
        fc.asyncProperty(
          historyArb.map((history) =>
            history.map((step): EagerLiveSourceStep => {
              if (step.kind !== `changes`) return step
              return {
                kind: `changes`,
                // A retouch re-delivers a held value, so it goes too.
                changes: step.changes
                  .filter((change) => change.type !== `retouch`)
                  .map((change) => {
                    if (change.type !== `upsert`) return change
                    const { value: _value, ...row } = change.row
                    return { type: `upsert`, row }
                  }),
              }
            }),
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
      expect(reach.counts().get(`value:date:change`)).toBe(0)
      expect(reach.counts().get(`value:date:load`)).toBeGreaterThan(0)
    },
    campaignTimeoutMs,
  )

  // Ablation of the read point: when every fetch reads after all buffered
  // batches, no history reaches a cut whose result missed one.
  oracleReplayTest(it)(
    `with every read after all buffered batches, histories never reach read-missed-change`,
    async () => {
      const reach = createOracleReach(
        `${property}.ablation`,
        reachStatesFor(driver),
        { replaying: false },
      )
      await fc.assert(
        fc.asyncProperty(
          historyArb.map((history) =>
            history.map((step) =>
              step.kind === `snapshot`
                ? { kind: step.kind, rows: step.rows }
                : step,
            ),
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
      expect(reach.counts().get(`read-missed-change`)).toBe(0)
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  check: [checkEagerLiveSourceHistory, eagerLiveSourceProperty],
  model: [eagerLiveSourceModel.step, eagerLiveSourceModel.expected],
  grammar: [historyArb],
})
