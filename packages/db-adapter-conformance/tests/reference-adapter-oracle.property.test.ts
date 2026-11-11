import { describe, expect } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { checkEagerLiveSourceHistory, reachStatesFor } from '../src'
import {
  checkEagerLiveSourceObservations,
  eagerLiveSourceHistories,
  eagerLiveSourceLaw,
  eagerLiveSourceOracle,
  eagerLiveSourceOracleDriver,
  eagerLiveSourceRequiredStates,
} from './eager-live-source-property-oracle'
import { referenceDriver } from './reference-adapter'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  ConformanceRow,
  EagerLiveSourceDriver,
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
 *   requested history. Five constructed histories per recipe retain generated
 *   rows and a generated suffix, preserving the minimum five witnesses per
 *   declared state (ORC-015).
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

describe(`eager live-source oracle campaigns`, () => {
  const property = `adapter-conformance.eager-live-source.reference`
  const driver = referenceDriver()
  const runs = 600
  const campaignTimeoutMs = 120_000

  describe(`eager live-source conformance: reference adapter`, () => {
    const mutants: Array<[ReferenceMutant, string]> = [
      [`ready-before-delivery`, `READY-2 (status)`],
      [`wraps-loading-failure`, `READY-4 (health error cause)`],
      [`failure-clears-rows`, `HEALTH-1 (rows)`],
      [`transient-is-fatal`, `HEALTH-1 (health error)`],
      [`delivery-error-is-fatal`, `HEALTH-1 (health error)`],
      [`never-recovers`, `HEALTH-2 (health failureReason)`],
      [`transient-fails-loading`, `RETRY-1 (status)`],
      [`splits-batch`, `PUB-1 (publication)`],
      [`drops-deletes`, `PUB-3/FID-4 (rows)`],
      // It merges a later delivery, so it also applies one that must be
      // rejected for a duplicate key.
      [`snapshot-merges`, `PUB-7 (rows)`],
      [`leaks-subscription`, `LIFE-2/LIFE-10 (releases per subscription)`],
      [`restart-replays-rows`, `LIFE-2/LIFE-5 (rows)`],
      [`swallows-prompt-failure`, `READY-4 (status)`],
      [`ready-at-restart`, `LIFE-2/LIFE-5 (status)`],
      [`keeps-failed-source`, `LIFE-10 (open provider subscriptions)`],
      [`double-release`, `LIFE-10 (releases per subscription)`],
      [`detached-rejection`, `HEALTH-5`],
      [`logs-failure`, `HEALTH-5`],
      // Its early fulfillment also answers a wait for a retired run's txid
      // before the new run is ready.
      [`wait-off-by-one`, `EVID-1 (awaitTxId 0)`],
      [`retired-evidence-before-ready`, `EVID-2 (awaitTxId 0)`],
      [`forgets-retired-evidence`, `EVID-2 (awaitTxId 0)`],
      [`leaks-waits-after-fail`, `EVID-2 (awaitTxId 0)`],
      [`wait-ignores-timeout`, `EVID-3 (awaitTxId 0)`],
      [`disconnect-fails`, `RECON-1 (health error)`],
      [`renew-resubscribes`, `RENEW-1 (open provider subscriptions)`],
      [`drops-buffered`, `READY-10/PUB-9 (rows)`],
      // It applies buffered batches before the rows, also before a delivery
      // that must write nothing.
      [`buffer-before-rows`, `READY-10/PUB-9 (rows)`],
      [`replays-per-batch`, `PUB-5/PUB-9 (publication)`],
      [`ready-before-buffer`, `READY-10 (rows when ready)`],
      [`shows-buffered`, `READY-10/PUB-9 (rows)`],
      [`merges-updates`, `FID-1 (fields)`],
      [`dates-as-strings`, `FID-1 (values)`],
      [`bigints-as-numbers`, `FID-1 (values)`],
      [`drops-nulls`, `FID-1 (values)`],
      [`loses-negative-zero`, `FID-1 (values)`],
      [`typed-booleans-as-numbers`, `FID-1 (values)`],
      [`commits-malformed-prefix`, `PUB-4 (rows)`],
      [`ignores-malformed`, `PUB-4 (status)`],
      [`relabels-inserts`, `PUB-2 (change events)`],
    ]
    oracleProperty({
      id: property,
      ...eagerLiveSourceOracle(driver),
      check: checkEagerLiveSourceObservations,
      histories: {
        ...eagerLiveSourceHistories(driver),
        runs,
        fixedSeeds: [2118],
      },
      calibrations: [
        ...mutants.map(([name, law]) => ({
          name,
          law,
          driver: eagerLiveSourceOracleDriver(referenceDriver(name)),
        })),
        {
          name: `a constructed history with missing reach observations`,
          law: `constructed reach`,
          corrupt: (observations, history) => {
            const required = eagerLiveSourceRequiredStates(history)
            if (required.length === 0) return undefined
            return observations.filter(
              ({ checkpoint, value }) =>
                checkpoint !== `reach` ||
                !required.includes(value as EagerLiveSourceReachState),
            )
          },
        },
      ],
      timeout: campaignTimeoutMs,
    })
  })

  // The prompt restart's own cut (LIFE-5). A run that reports ready at its
  // start and then receives an empty delivery matches the model at the next
  // cut, so in this history only the synchronous check at the restart rejects
  // it; in a campaign a non-prompt restart rejects it too.
  describe(`eager live-source conformance: prompt restart cut`, () => {
    const promptRestart: EagerLiveSourceHistory = [
      { kind: `fail` },
      { kind: `restart`, prompt: true },
      { kind: `snapshot`, rows: [] },
    ]
    oracleProperty({
      id: `${property}.prompt-restart`,
      ...eagerLiveSourceOracle(driver),
      law: {
        ...eagerLiveSourceLaw,
        limits: `The one prompt-restart history above, through the shared driver and check, on the reference adapter.`,
      },
      check: checkEagerLiveSourceObservations,
      histories: [promptRestart],
      label: () => `a failure, a prompt restart and an empty delivery`,
      calibrations: [
        {
          name: `rejects a run that is ready at its prompt restart`,
          law: `LIFE-5 (prompt restart)`,
          driver: eagerLiveSourceOracleDriver(
            referenceDriver(`ready-at-restart`),
          ),
        },
      ],
      timeout: campaignTimeoutMs,
    })
  })

  // Per-change commits use the same law and generated histories; reversing a
  // batch's distinct keys must fail at its publication checkpoint.
  const perChange = referenceDriver(undefined, { perChange: true })
  oracleProperty({
    id: `${property}.per-change`,
    ...eagerLiveSourceOracle(perChange),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(perChange),
      runs,
      fixedSeeds: [2118],
    },
    calibrations: [
      {
        name: `reverses-batch`,
        law: `PUB-1 (publication)`,
        driver: eagerLiveSourceOracleDriver(
          referenceDriver(`reverses-batch`, { perChange: true }),
        ),
      },
    ],
    timeout: campaignTimeoutMs,
  })

  // Outage thresholds and client-created failure values keep their own
  // receiving variant and all former law-named hostile calibrations.
  const outage = { reportAfter: 3, clientValues: true, reportsRejected: true }
  const thresholdDriver = referenceDriver(undefined, { outage })
  const outageMutants: Array<[ReferenceMutant, string]> = [
    [`stale-outage-value`, `HEALTH-1 (health failureReason)`],
    [`replaces-outage-value`, `RETRY-1 (health failureReason)`],
    [`reports-outage-early`, `HEALTH-1 (health failureReason)`],
    [`outage-count-survives-delivery`, `HEALTH-1 (health failureReason)`],
    [`empty-response-keeps-count`, `HEALTH-1 (health failureReason)`],
    [`empty-response-recovers`, `RETRY-1 (health failureReason)`],
    [`rejected-delivery-fails`, `PUB-4 (health error)`],
    [`wraps-loading-failure`, `READY-4 (health error cause)`],
  ]
  oracleProperty({
    id: `${property}.outage`,
    ...eagerLiveSourceOracle(thresholdDriver),
    check: checkEagerLiveSourceObservations,
    histories: {
      ...eagerLiveSourceHistories(thresholdDriver),
      runs,
      fixedSeeds: [2118],
    },
    calibrations: outageMutants.map(([name, law]) => ({
      name,
      law,
      driver: eagerLiveSourceOracleDriver(referenceDriver(name, { outage })),
    })),
    timeout: campaignTimeoutMs,
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
    const typed = (domain.fieldKinds ?? []).length > 0
    const row = (r: ConformanceRow) =>
      r.id >= 1 &&
      r.id <= 5 &&
      [`a`, `b`, `c`].includes(r.title) &&
      (!Object.hasOwn(r, `note`) || [`x`, `y`].includes(r.note!)) &&
      Object.hasOwn(r, `value`) === valued &&
      Object.hasOwn(r, `typed`) === typed
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
  const withoutValues = {
    ...driver,
    valueKinds: undefined,
    fieldKinds: undefined,
  }
  // The value witnesses carry values but no typed fields.
  const withoutFields = { ...driver, fieldKinds: undefined }

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

  /** A grammar control: the domain its history runs in, the history, and the
   * number of steps the check must skip (0 for reconstruction). */
  type GrammarControl = {
    domain: EagerLiveSourceDriver
    history: EagerLiveSourceHistory
    reconstructs: boolean
    skipped: number
  }
  // Witness rows may hold Dates and bigints, so each history is the control's
  // test name, and `resolve` maps it to its control.
  const grammarControls = new Map<string, GrammarControl>([
    ...witnesses.map(([name, history]): [string, GrammarControl] => [
      `reconstructs ${name}`,
      { domain: withoutValues, history, reconstructs: true, skipped: 0 },
    ]),
    ...valueWitnesses.map(([name, history]): [string, GrammarControl] => [
      `reconstructs ${name}`,
      { domain: withoutFields, history, reconstructs: true, skipped: 0 },
    ]),
    [
      `excludes a batch before the first ready without listen-before-fetch`,
      {
        domain: lateListener,
        history: [{ kind: `changes` as const, changes: [] }],
        reconstructs: false,
        skipped: 1,
      },
    ],
    ...invalid.map(([name, history]): [string, GrammarControl] => [
      `excludes ${name}`,
      { domain: withoutValues, history, reconstructs: false, skipped: 1 },
    ]),
  ])

  // Runs one control through the shared check on the reference adapter. A
  // reconstruction must lie in the generator's domain and skip no step; an
  // exclusion skips exactly its final illegal step.
  async function runGrammarControl({
    domain,
    history,
    reconstructs,
    skipped: expectedSkipped,
  }: GrammarControl): Promise<void> {
    if (reconstructs) expect(withinGrammar(history, domain)).toBe(true)
    const { skipped } = await checkEagerLiveSourceHistory(domain, history)
    expect(skipped).toBe(expectedSkipped)
  }

  // The controls whose test names start with `prefix`, through the shared
  // check on the reference adapter.
  function grammarControlCases(prefix: `reconstructs ` | `excludes `) {
    return {
      law: {
        statement: `Reconstruction: each known adapter witness lies in the history grammar's domain, and the shared check accepts it on the reference adapter without skipping a step. Exclusion: a history that ends with a step illegal where it stands has exactly that step skipped, and the model stays where it was.`,
        authority: `docs/contributing/oracle-rubric.md ORC-004 grammar controls; the shared oracle in src/eager-live-source-oracle.ts.`,
        limits: `The named Neon, TrailBase and RxDB witnesses and the five invalid histories above, on the reference adapter; this judges the grammar and the check, not a published adapter.`,
      },
      histories: [...grammarControls.keys()].filter((name) =>
        name.startsWith(prefix),
      ),
      label: (name: string) => name,
      resolve: (name: string) => grammarControls.get(name)!,
      model: recordedAssertionJudgment,
      driver: (
        plan: GrammarControl,
        observe: (checkpoint: string, value: unknown) => void,
      ) =>
        recordAssertionJudgment(`grammar control`, plan, observe, () =>
          runGrammarControl(plan),
        ),
      timeout: campaignTimeoutMs,
    }
  }

  describe(`eager live-source grammar controls`, () => {
    oracleProperty({
      id: `${property}.reconstruction`,
      ...grammarControlCases(`reconstructs `),
      check: forwardAssertionJudgment,
    })
    oracleProperty({
      id: `${property}.exclusion`,
      ...grammarControlCases(`excludes `),
      check: forwardAssertionJudgment,
    })
  })

  // Ablation judges the grammar rather than a new product law. The same
  // comparison still rejects any product mismatch after the transformation.
  // The lost state must never appear; live-value ablation also retains a
  // constructed date load, so the positive control cannot silently disappear.
  function registerAblation(
    name: string,
    lost: EagerLiveSourceReachState,
    transform: (history: EagerLiveSourceHistory) => EagerLiveSourceHistory,
    retained?: EagerLiveSourceReachState,
  ): void {
    const states = retained === undefined ? [] : [retained]
    const source = eagerLiveSourceHistories(driver, states)
    oracleProperty({
      id: `${property}.ablation.${name}`,
      ...eagerLiveSourceOracle(driver),
      histories: {
        arbitrary: source.arbitrary,
        runs: 100,
        fixedSeeds: [2118],
        states,
        measured: reachStatesFor(driver).filter((state) => state !== retained),
        constructed: source.constructed,
      },
      driver: eagerLiveSourceOracleDriver(driver, transform),
      check: (
        history,
        observations: ReadonlyArray<Observation>,
        requiredStates,
      ) => {
        const judgment = checkEagerLiveSourceObservations(
          history,
          observations,
          requiredStates,
        )
        if (judgment.kind === `violation`) return judgment
        return observations.some(
          ({ checkpoint, value }) => checkpoint === `reach` && value === lost,
        )
          ? violation(
              `grammar ablation`,
              `removing ${name} still reaches ${lost}`,
              `grammar excludes ${lost}`,
            )
          : pass
      },
      timeout: campaignTimeoutMs,
    })
  }

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
  for (const [kind, lost] of ablations) {
    registerAblation(`${kind}.${lost}`, lost, (history) =>
      history.filter((step) => step.kind !== kind),
    )
  }
  const plain = (row: { id: number; title: string }) => ({
    id: row.id,
    title: row.title,
  })
  registerAblation(`notes`, `field-removed`, (history) =>
    history.map((step): EagerLiveSourceStep => {
      if (step.kind === `snapshot`)
        return { ...step, rows: step.rows.map(plain) }
      if (step.kind !== `changes`) return step
      return {
        ...step,
        changes: step.changes.map((change) =>
          change.type === `upsert`
            ? { ...change, row: plain(change.row) }
            : change,
        ),
      }
    }),
  )
  registerAblation(
    `live-values`,
    `value:date:change`,
    (history) =>
      history.map((step): EagerLiveSourceStep => {
        if (step.kind !== `changes`) return step
        return {
          ...step,
          changes: step.changes
            .filter((change) => change.type !== `retouch`)
            .map((change) => {
              if (change.type !== `upsert`) return change
              const { value: _value, ...row } = change.row
              return { ...change, row }
            }),
        }
      }),
    `value:date:load`,
  )
  registerAblation(`read-point`, `read-missed-change`, (history) =>
    history.map((step) =>
      step.kind === `snapshot` ? { kind: step.kind, rows: step.rows } : step,
    ),
  )
})
