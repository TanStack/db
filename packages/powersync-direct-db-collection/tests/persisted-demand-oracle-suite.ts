/**
 * The Direct receiving paths reuse the primary persisted-demand model/checker.
 * This bounded enumeration crosses all first-run premises with three offline
 * schedules. Its public cuts distinguish exact coverage from overlapping rows,
 * and its durable cuts include rows even when the query must remain loading.
 * Real SQLite hosts, fresh SDKs and explicit close/reopen supply the receiving
 * premises. There is no separate Direct completeness model or expected table.
 */
import { afterAll } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  coverageViolations,
  expectedObservations,
  persistedCoverageRows,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import {
  directDemandHistories,
  directDemandStates,
} from './persisted-demand-history-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { DirectDemandHistory } from './persisted-demand-history-oracle'
import type {
  DirectDemandCut,
  DirectDemandResult,
} from './persisted-demand-driver'

// Reconstitute each measured per-load wait after browser transport. Functions
// stay outside observation data; the primary model receives the same premises.
const coverageRecord = (cut: DirectDemandCut) => ({
  ...cut.record,
  queries: {
    demand: {
      ...cut.record.queries.demand!,
      waitPassed: (load: LoadSubsetOptions) =>
        cut.waits[cut.record.queries.demand!.sent.indexOf(load)] === true,
    },
  },
})

export function registerDirectPersistedDemand(
  property: string,
  receive: (
    history: DirectDemandHistory,
    id: string,
  ) => Promise<DirectDemandResult>,
  {
    owns,
    receivingPath,
  }: { owns: ReadonlyArray<string>; receivingPath: string },
) {
  let sequence = 0
  const measured = new Map<DirectDemandHistory, Set<string>>()
  afterAll(() => {
    const counts = Object.fromEntries(
      directDemandStates.map((state) => [
        state,
        [...measured.values()].filter((states) => states.has(state)).length,
      ]),
    )
    console.info(
      `${property} measured enumerated reach`,
      JSON.stringify(counts),
    )
  })
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `An exact on-demand load that reached applied settlement and saved its rows can become ready on those durable rows after SQLite close/reopen when its own wait passes or its upstream fails. Rows from an incomplete, failed, overlapping or never-loaded demand do not certify that demand. A source delete invalidates the saved count and replacing a limited-window row invalidates its saved keys. Direct may replace its saved cache with the current SDK table after the first successful nonempty stream load. That replacement ends old coverage, including overlapping dormant demands. A fresh SDK's initial empty listener, a failed load, and an empty subscription mapper cannot authorize that eviction.`,
      authority: `docs/guides/sqlite-persistence.md#on-demand-collections-offline; docs/collections/powersync-direct-db-collection.md#on-demand-sync; primary packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts and its shared persisted-demand-coverage-model-oracle.ts.`,
      limits: `${receivingPath} Ten first-run histories crossed with two held-provider waits and one early SDK stream rejection, including a rejected exact load with nonempty healthy-donor rows. Additional histories supply exact and ordered refresh, disjoint B eviction followed by a failed previously covered A load, and empty subscription mappers. Default single-process coordinator. No cache-claim expiry, deployed service, or multi-tab claim.`,
    },
    histories: {
      enumerated: directDemandHistories,
      states: [...directDemandStates],
    },
    label: (history) =>
      `${history.first}, ${history.second}, wait ${history.waitMs}${history.transition ? `, ${history.transition}` : ``}${history.slowDurableRead ? `, delayed durable observation` : ``}`,
    model: () => undefined,
    driver: async (history, observe) => {
      const result = await receive(history, `${property}-${sequence++}`)
      const reached = new Set(result.reached)
      for (const cut of result.cuts)
        coverageViolations(coverageRecord(cut), (state) => reached.add(state))
      measured.set(history, reached)
      for (const state of reached) observe(`reach`, state)
      observe(`result`, result)
    },
    check: (history, trace) => {
      const result = trace.find((item) => item.checkpoint === `result`)
        ?.value as DirectDemandResult | undefined
      if (!result)
        return violation(
          `result`,
          `Missing persisted Direct receiving record`,
          `persisted demand coverage`,
        )
      // Currentness records the actual source reset clock. Judge every reset's
      // authority separately, so an unauthorized reset cannot erase the law by
      // merely making its own in-flight acquisitions obsolete in the model.
      if (
        (result.beforeStartup.length > 0 ||
          result.beforeStartupEvents.some(
            (event) =>
              event.type === `settled` && event.current && !event.aborted,
          )) &&
        result.resets.some((reset) => reset.session > 1 && !reset.confirmed)
      )
        return violation(
          `before successful provider checkpoint`,
          `Saved cache reset without a successful nonempty provider checkpoint`,
          `persisted demand durability`,
          { expected: `no unconfirmed cache reset`, actual: result },
        )
      const durableProjection = (
        events: DirectDemandCut['record']['events'],
      ) => [
        ...persistedCoverageRows(events, { group: `a` }, true),
        ...persistedCoverageRows(events, { group: `b` }, true),
      ]
      const wantDurable = durableProjection(result.beforeStartupEvents)
      const rowValues = (values: ReadonlyArray<unknown>) =>
        JSON.stringify(
          values.map((row) =>
            Object.fromEntries(
              Object.entries(row as Record<string, unknown>).sort(
                ([left], [right]) => left.localeCompare(right),
              ),
            ),
          ),
        )
      if (rowValues(result.beforeStartup) !== rowValues(wantDurable))
        return violation(
          `reopen before adapter startup`,
          `Durable rows differ from primary model`,
          `persisted demand durability`,
          { expected: wantDurable, actual: result },
        )
      for (const cut of result.cuts) {
        const record = coverageRecord(cut)
        const failures = coverageViolations(record)
        if (failures.length)
          return violation(
            cut.name,
            failures.join(`; `),
            `persisted demand coverage`,
            { expected: expectedObservations(record), actual: result },
          )
        const predicted = expectedObservations(record).demand!
        const preload =
          predicted.status === `ready`
            ? `fulfilled`
            : predicted.status === `error`
              ? `rejected`
              : `pending`
        if (cut.preload !== preload)
          return violation(
            cut.name,
            `Expected preload ${preload}, observed ${cut.preload}`,
            `persisted demand coverage`,
            { expected: preload, actual: result },
          )
        const wantAtCut = durableProjection(cut.record.events)
        if (rowValues(cut.durable) !== rowValues(wantAtCut))
          return violation(
            cut.name,
            `Durable rows differ from primary model`,
            `persisted demand durability`,
            { expected: wantAtCut, actual: result },
          )
      }
      if (
        result.cuts.length !==
          (history.transition === `load-other-then-reject-saved`
            ? 4
            : history.transition
              ? 3
              : 2) ||
        !result.providerRequests[1]
      )
        return violation(
          `receiving premise`,
          `Missing offline HTTP request or public observation`,
          `persisted demand coverage`,
        )
      const diagnostics = [
        ...result.cleanupErrors,
        ...(result.browserErrors ?? []),
      ]
      return diagnostics.length
        ? violation(
            `receiving cleanup`,
            diagnostics.join(`; `),
            `receiving cleanup`,
            { expected: [], actual: result },
          )
        : pass
    },
    calibrations: [
      {
        name: `a failed exact demand cannot borrow its healthy donor's nonempty rows`,
        history: { enumerated: `failed-with-peer, held, wait 0` },
        law: `persisted demand coverage`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DirectDemandResult),
                    cuts: (item.value as DirectDemandResult).cuts.map(
                      (cut) => ({
                        ...cut,
                        preload: `fulfilled`,
                        record: {
                          ...cut.record,
                          queries: {
                            demand: {
                              ...cut.record.queries.demand!,
                              observed: { status: `ready`, rows: cut.durable },
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
        name: `an unconfirmed reset cannot authorize its own saved-cache eviction`,
        history: { enumerated: `never, held, wait 0` },
        law: `persisted demand durability`,
        difference: `Saved cache reset without a successful nonempty provider checkpoint`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DirectDemandResult),
                    beforeStartup: [{ id: `saved`, group: `a` }],
                    resets: [{ session: 2, confirmed: false }],
                  },
                },
          ),
      },
      {
        name: `completed product mismatch remains primary after wrapper cleanup fails`,
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
                    ...(item.value as DirectDemandResult),
                    cleanupErrors: [`late wrapper removal failed`],
                    cuts: (item.value as DirectDemandResult).cuts.map(
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
        name: `completed valid product record exposes wrapper cleanup failure`,
        history: { enumerated: `never, held, wait 0` },
        law: `receiving cleanup`,
        difference: `late wrapper removal failed`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DirectDemandResult),
                    cleanupErrors: [`late wrapper removal failed`],
                  },
                },
          ),
      },
      {
        name: `durable projection rejects a row the source never wrote`,
        history: { enumerated: `never, held, wait 0` },
        law: `persisted demand durability`,
        difference: `Durable rows differ from primary model`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DirectDemandResult),
                    beforeStartup: [
                      { id: `unwritten`, group: `a`, rank: 1, value: `wrong` },
                    ],
                    resets: [],
                  },
                },
          ),
      },
      {
        name: `pending readiness cannot hide a fulfilled preload`,
        history: { enumerated: `never, held, wait 0` },
        law: `persisted demand coverage`,
        difference: `Expected preload pending`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DirectDemandResult),
                    cuts: (item.value as DirectDemandResult).cuts.map(
                      (cut) => ({ ...cut, preload: `fulfilled` }),
                    ),
                  },
                },
          ),
      },
      {
        name: `uncovered rows cannot certify readiness`,
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
                    ...(item.value as DirectDemandResult),
                    cuts: (item.value as DirectDemandResult).cuts.map(
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
    ],
  })
}
