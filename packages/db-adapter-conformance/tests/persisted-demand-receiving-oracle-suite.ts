/**
 * Receiving suite for the primary persisted demand model. An exact settled
 * demand can resume offline after its own wait or source failure; overlapping,
 * failed and unfinished demand cannot certify it. Authority is the SQLite
 * persistence guide, "On-demand Collections offline". The primary model below
 * owns the expected readiness and row selection; this module adds no policy.
 *
 * This finite grammar crosses six first-run premises and three offline
 * schedules. Ordered windows use only ascending numeric rank, supported by
 * every receiving adapter. Fresh SDKs and real storage close/reopen distinguish
 * durable coverage from a provider cache. Source facts come from the factories'
 * authored service responses, not from adapter-generated resets.
 * Late answers either repeat saved values or change values at the same keys
 * and ranks, including after a differently limited saved window. The primary
 * model replays the delivered rows; provider pages can exceed query demand.
 *
 * Limits: one ordered source, four unique ranks, two-row windows, one default
 * coordinator. No row-count invalidation, live window membership changes,
 * retention expiry, arbitrary filters/cursors, or multi-tab claim. The primary
 * owner retains those laws; receiving extensions remain separately tracked.
 * These provider pages do not establish saved-suffix retention after a
 * nonexhausted prefix; that receiving path needs its own bounded witness.
 */
import { afterAll } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  coverageViolations,
  expectedObservations,
  persistedCoverageRows,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  DemandReceivingCut,
  DemandReceivingHistory,
  DemandReceivingResult,
} from './persisted-demand-receiving-driver'

export const receivingDemandHistories: Array<DemandReceivingHistory> = (
  [`covered`, `empty`, `never`, `overlap`, `pending`, `failed`] as const
).flatMap((first) => [
  { first, second: `held`, waitMs: 0 },
  { first, second: `held`, waitMs: 1000 },
  { first, second: `rejected`, waitMs: 60000 },
])
receivingDemandHistories.push(
  { first: `covered`, second: `held`, waitMs: 0, lateAnswer: true },
  { first: `never`, second: `held`, waitMs: 0, lateAnswer: true },
  { first: `covered`, second: `held`, waitMs: 0, lateAnswer: `changed values` },
  { first: `never`, second: `held`, waitMs: 0, lateAnswer: `changed values` },
  { first: `overlap`, second: `held`, waitMs: 0, lateAnswer: `changed values` },
)
const states = [
  `first covered applied`,
  `first empty applied`,
  `first never requested`,
  `first overlap applied`,
  `first pending acquisition`,
  `first failed acquisition`,
  `closed and reopened storage`,
  `window covered offline`,
  `uncovered offline`,
  `covered load waits for the deadline`,
  `uncovered load fails with its upstream`,
  `restored source rows before deadline`,
  `changed-value late answer supplied after covered reopen`,
] as const
const recordAt = (cut: DemandReceivingCut) => ({
  ...cut.record,
  queries: {
    demand: {
      ...cut.record.queries.demand!,
      waitPassed: (load: LoadSubsetOptions) =>
        cut.waits[cut.record.queries.demand!.sent.indexOf(load)] === true,
    },
  },
})
const rowKey = (rows: ReadonlyArray<unknown>) =>
  JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
    ),
  )

export function registerPersistedDemandReceiving(
  property: string,
  receive: (
    history: DemandReceivingHistory,
    id: string,
  ) => Promise<DemandReceivingResult>,
  options: { owns: ReadonlyArray<string>; path: string },
) {
  let sequence = 0
  const measured = new Map<DemandReceivingHistory, Set<string>>()
  // Wall-clock diagnostics explain a failed receiving cut. They are not
  // semantic observations: determinism compares the before/after wait facts,
  // not host latency or the number of storage scheduling operations.
  const diagnostics = new WeakMap<DemandReceivingHistory, unknown>()
  afterAll(() =>
    console.info(
      `${property} measured enumerated reach`,
      JSON.stringify(
        Object.fromEntries(
          states.map((state) => [
            state,
            [...measured.values()].filter((set) => set.has(state)).length,
          ]),
        ),
      ),
    ),
  )
  oracleProperty({
    id: property,
    owns: options.owns,
    law: {
      statement: `An exact ordered demand whose online load settled with durable rows may settle from those rows after storage close/reopen and its own wait or upstream failure. Overlapping, unfinished, failed and never-requested demand establishes no such coverage. A late online answer replaces saved values at unchanged keys and ranks.`,
      authority: `docs/guides/sqlite-persistence.md#on-demand-collections-offline; packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle.ts`,
      limits: `${options.path}. Six first-run premises, two held-source waits and early source rejection, plus five late answers including changed values and a differently limited saved window. One rank order and finite window; no saved-suffix retention after a nonexhausted prefix, source deletion, retention expiry, changed membership, arbitrary filters/cursors, multi-tab or deployed-service claim.`,
    },
    histories: { enumerated: receivingDemandHistories, states: [...states] },
    label: (h) =>
      `${h.first}, ${h.second}, wait ${h.waitMs}${h.lateAnswer ? `, late answer${h.lateAnswer === `changed values` ? ` with changed values` : ``}` : ``}`,
    model: () => undefined,
    driver: async (history, observe) => {
      const result = await receive(history, `${property}-${sequence++}`)
      const reached = new Set(result.reached)
      for (const cut of result.cuts)
        coverageViolations(recordAt(cut), (state) => reached.add(state))
      measured.set(history, reached)
      // Other primary-model states are legal diagnostics; the common receiver
      // declares only the subset its six premises require on every adapter.
      for (const state of reached)
        if (states.some((declared) => declared === state))
          observe(`reach`, state)
      diagnostics.set(
        history,
        result.cuts.map(({ name, progress, storage }) => ({
          name,
          progress,
          storage,
        })),
      )
      observe(`result`, {
        ...result,
        cuts: result.cuts.map(
          ({ progress: _progress, storage: _storage, ...cut }) => cut,
        ),
      })
    },
    check: (history, trace) => {
      const result = trace.find((item) => item.checkpoint === `result`)
        ?.value as DemandReceivingResult | undefined
      if (!result)
        return violation(
          `result`,
          `Missing receiving record`,
          `persisted demand coverage`,
        )
      const actual = { result, diagnostics: diagnostics.get(history) }
      const expectedSaved = persistedCoverageRows(
        result.beforeStartupEvents,
        { group: `a` },
        true,
      )
      if (rowKey(result.beforeStartup) !== rowKey(expectedSaved))
        return violation(
          `reopen before startup`,
          `Saved rows differ from authored provider facts`,
          `persisted demand durability`,
          { expected: expectedSaved, actual },
        )
      for (const cut of result.cuts) {
        const record = recordAt(cut)
        const failures = coverageViolations(record)
        if (failures.length)
          return violation(
            cut.name,
            failures.join(`; `),
            `persisted demand coverage`,
            { expected: expectedObservations(record), actual },
          )
        const sourceWindow = persistedCoverageRows(
          record.events,
          { group: `a`, orderByRank: true, limit: 2 },
          true,
        )
        if (rowKey(cut.sourceWindow) !== rowKey(sourceWindow))
          return violation(
            cut.name,
            `Restored source rows differ from authored provider facts`,
            `persisted demand publication`,
            { expected: sourceWindow, actual },
          )
        const expected = expectedObservations(record).demand!
        // Readiness and row selection come from the same primary model. Its
        // value projection additionally rejects a graph that keeps old values
        // under unchanged keys after the online answer has applied.
        if (
          expected.status === `ready` &&
          rowKey(cut.queryRows ?? []) !== rowKey(sourceWindow)
        )
          return violation(
            cut.name,
            `Live-query rows differ from authored provider facts`,
            `persisted demand publication`,
            { expected: sourceWindow, actual },
          )
        const preload =
          expected.status === `ready`
            ? `fulfilled`
            : expected.status === `error`
              ? `rejected`
              : `pending`
        if (cut.preload !== preload)
          return violation(
            cut.name,
            `Expected preload ${preload}, observed ${cut.preload}`,
            `persisted demand coverage`,
            { expected: preload, actual },
          )
        const durable = persistedCoverageRows(
          record.events,
          { group: `a` },
          true,
        )
        if (rowKey(cut.durable) !== rowKey(durable))
          return violation(
            cut.name,
            `Durable rows differ from authored provider facts`,
            `persisted demand durability`,
            { expected: durable, actual },
          )
      }
      if (result.requests.length !== 2 || result.requests[1]! < 1)
        return violation(
          `receiving premise`,
          `Missing actual offline provider acquisition`,
          `persisted demand coverage`,
        )
      const errors = [...result.cleanupErrors, ...(result.browserErrors ?? [])]
      return errors.length
        ? violation(`receiving cleanup`, errors.join(`; `), `receiving cleanup`)
        : pass
    },
    calibrations: [
      {
        name: `late online values replace the saved live-query values`,
        history: {
          enumerated: `covered, held, wait 0, late answer with changed values`,
        },
        law: `persisted demand publication`,
        difference: `Live-query rows differ from authored provider facts`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandReceivingResult),
                    cuts: (item.value as DemandReceivingResult).cuts.map(
                      (cut) =>
                        cut.name !== `late provider answer applied`
                          ? cut
                          : {
                              ...cut,
                              queryRows: cut.queryRows?.map((row) => ({
                                ...row,
                                value: (
                                  item.value as DemandReceivingResult
                                ).beforeStartup.find(
                                  (saved) => saved.id === row.id,
                                )?.value,
                              })),
                            },
                    ),
                  },
                },
          ),
      },
      {
        name: `an uncovered live-query crash is not pending demand`,
        history: { enumerated: `never, held, wait 0` },
        law: `persisted demand coverage`,
        difference: `expected {"status":"loading"}`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandReceivingResult),
                    cuts: (item.value as DemandReceivingResult).cuts.map(
                      (cut) => ({
                        ...cut,
                        record: {
                          ...cut.record,
                          queries: {
                            demand: {
                              ...cut.record.queries.demand!,
                              observed: { status: `crashed` },
                            },
                          },
                        },
                      }),
                    ),
                  },
                },
          ),
      },
      {
        name: `restored source rows are visible while the covered load waits`,
        history: { enumerated: `covered, held, wait 1000` },
        law: `persisted demand publication`,
        difference: `Restored source rows differ from authored provider facts`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandReceivingResult),
                    cuts: (item.value as DemandReceivingResult).cuts.map(
                      (cut, index) =>
                        index === 0 ? { ...cut, sourceWindow: [] } : cut,
                    ),
                  },
                },
          ),
      },
      {
        name: `uncovered demand cannot become ready from overlapping rows`,
        history: { enumerated: `never, held, wait 0` },
        law: `persisted demand coverage`,
        difference: `expected {"status":"loading"}`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandReceivingResult),
                    cuts: (item.value as DemandReceivingResult).cuts.map(
                      (cut) => ({
                        ...cut,
                        record: {
                          ...cut.record,
                          queries: {
                            demand: {
                              ...cut.record.queries.demand!,
                              observed: { status: `ready`, rows: [] },
                            },
                          },
                        },
                      }),
                    ),
                  },
                },
          ),
      },
      {
        name: `offline startup cannot silently discard durable covered rows`,
        history: { enumerated: `covered, held, wait 0` },
        law: `persisted demand durability`,
        difference: `Durable rows differ from authored provider facts`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandReceivingResult),
                    cuts: (item.value as DemandReceivingResult).cuts.map(
                      (cut) => ({ ...cut, durable: [] }),
                    ),
                  },
                },
          ),
      },
    ],
  })
}
