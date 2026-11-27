/**
 * Direct's cursor receiver reuses the primary persisted-demand judgment. Only
 * current subscription settlement is normalized to loading/ready/error, with
 * scoped public errors taking precedence over ready after failure. Original
 * physical acquisition outcomes remain diagnostics across a truncate replay.
 * Public rows are
 * the separate full group-A Collection projection for page-shaped source data.
 * This is not a live-query cursor materialization or cursor-selectivity oracle.
 */
import { afterAll } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  coverageViolations,
  expectedObservations,
  persistedCoverageRows,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import {
  constructCursorDemand,
  cursorDemandHistoryArb,
  cursorDemandStates,
} from './cursor-persisted-demand-history-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  CursorDemandHistory,
  CursorDemandState,
} from './cursor-persisted-demand-history-oracle'
import type { CursorDemandResult } from './cursor-persisted-demand-driver'

const rowValues = (rows: ReadonlyArray<unknown>) =>
  JSON.stringify(
    rows
      .map((row) =>
        Object.fromEntries(
          Object.entries(row as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      )
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  )

export function registerCursorPersistedDemand(
  property: string,
  receive: (h: CursorDemandHistory, id: string) => Promise<CursorDemandResult>,
  {
    owns,
    receivingPath,
  }: { owns: ReadonlyArray<string>; receivingPath: string },
) {
  let sequence = 0
  const required = new WeakMap<CursorDemandHistory, CursorDemandState>()
  const measured = new Map<string, number>()
  const constructed = cursorDemandStates.flatMap((state) =>
    Array.from({ length: 5 }, (_, index) => ({
      name: `${state} construction ${index + 1}`,
      enters: [state],
      build: (h: CursorDemandHistory) => {
        const built = constructCursorDemand(h, state)
        required.set(built, state)
        return built
      },
    })),
  )
  afterAll(() =>
    console.info(
      `${property} measured reach`,
      JSON.stringify(Object.fromEntries(measured)),
    ),
  )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `An applied and durably saved exact cursor demand can settle offline after storage reopen; a changed cursor cannot use that coverage merely because rows match. A first confirmed source checkpoint may replace the cache, which ends older coverage. Reopening the old demand after eviction must then follow its failed upstream. A fresh SDK's initial empty listener cannot authorize eviction.`,
      authority: `docs/guides/sqlite-persistence.md#on-demand-collections-offline; docs/collections/powersync-direct-db-collection.md#on-demand-sync; primary packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle.ts and glossary persisted demand coverage.`,
      limits: `${receivingPath} Genuine public requestLimitedSnapshot uses minValues, finite limit and offset zero; actual sent whereFrom/whereCurrent supplies cursor identity. Page-shaped provider tables contain only 1-2 saved cursor rows, with finite translated ranks. No cursor selectivity, rows before the boundary or beyond the limit, ties, live-query cursor materialization, multi-tab, claim expiry, or deployed service claim.`,
    },
    histories: {
      arbitrary: cursorDemandHistoryArb,
      states: cursorDemandStates,
      constructed,
      runs: 24,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `matching saved cursor`,
          history: {
            coordinate: 0,
            limit: 2,
            boundary: `same`,
            after: `offline`,
          },
        },
        {
          name: `changed cursor with saved rows`,
          history: {
            coordinate: 0,
            limit: 2,
            boundary: `changed`,
            after: `offline`,
          },
        },
        {
          name: `saved cursor after confirmed eviction`,
          history: {
            coordinate: 0,
            limit: 2,
            boundary: `changed`,
            after: `evict`,
          },
        },
      ],
    },
    model: () => undefined,
    driver: async (h, observe) => {
      const result = await receive(h, `${property}-${sequence++}`)
      for (const state of result.reached) {
        measured.set(state, (measured.get(state) ?? 0) + 1)
        observe(`reach`, state)
      }
      observe(`result`, result)
    },
    check: (h, trace) => {
      const needed = required.get(h)
      if (
        needed &&
        !trace.some((o) => o.checkpoint === `reach` && o.value === needed)
      )
        return violation(
          `reach`,
          `Missing ${needed}`,
          `constructed cursor reach`,
        )
      const result = trace.find((o) => o.checkpoint === `result`)?.value as
        CursorDemandResult | undefined
      if (!result)
        return violation(
          `result`,
          `Missing cursor receiving result`,
          `persisted cursor coverage`,
        )
      const saved = result.beforeStartupEvents.filter(
        (event) => event.type === `settled`,
      )
      const loads = result.cuts.flatMap(
        (cut) => cut.record.queries.demand!.sent,
      )
      if (
        !saved.some((event) => event.current && event.load.cursor?.whereFrom) ||
        loads.length === 0 ||
        result.cuts.some(
          (cut) => cut.record.queries.demand!.sent.length !== 1,
        ) ||
        loads.some(
          (load) => !load.cursor?.whereFrom || load.limit !== h.limit,
        ) ||
        result.providerRequests.length !== (h.after === `evict` ? 3 : 2) ||
        result.providerRequests.some((count) => count < 1)
      )
        return violation(
          `receiving premise`,
          `Missing real limited cursor acquisition`,
          `persisted cursor path`,
          {
            expected: `actual saved and reopened limited cursor requests`,
            actual: result,
          },
        )
      // Actual resets do not author a snapshot in the model. This prevents an
      // unauthorized reset from making its own in-flight request obsolete and
      // thereby erasing the saved-demand obligation it should preserve.
      if (result.resets.some((reset) => reset.session > 1 && !reset.confirmed))
        return violation(
          `before confirmed checkpoint`,
          `Saved cache reset without a successful nonempty provider checkpoint`,
          `persisted cursor durability`,
          { expected: `no unconfirmed cache reset`, actual: result },
        )
      const wantedBefore = persistedCoverageRows(
        result.beforeStartupEvents,
        { group: `a` },
        true,
      )
      if (rowValues(result.beforeStartup) !== rowValues(wantedBefore))
        return violation(
          `reopen before adapter startup`,
          `Durable rows differ from primary model`,
          `persisted cursor durability`,
          { expected: wantedBefore, actual: result },
        )
      for (const cut of result.cuts) {
        const failures = coverageViolations(cut.record)
        if (failures.length)
          return violation(
            cut.name,
            failures.join(`; `),
            `persisted cursor coverage`,
            { expected: expectedObservations(cut.record), actual: result },
          )
        const wantedRows = persistedCoverageRows(
          cut.record.events,
          { group: `a` },
          true,
        )
        if (rowValues(cut.durable) !== rowValues(wantedRows))
          return violation(
            cut.name,
            `Durable rows differ from primary model`,
            `persisted cursor durability`,
            { expected: wantedRows, actual: result },
          )
      }
      const diagnostics = [
        ...result.cleanupErrors,
        ...(result.browserErrors ?? []),
      ]
      return diagnostics.length
        ? violation(
            `receiving cleanup`,
            diagnostics.join(`; `),
            `cursor receiving cleanup`,
          )
        : pass
    },
    calibrations: [
      {
        name: `changed cursor cannot borrow saved coverage`,
        history: { fixed: `changed cursor with saved rows` },
        law: `persisted cursor coverage`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as CursorDemandResult),
                    cuts: (entry.value as CursorDemandResult).cuts.map(
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
        name: `saved row values survive reopen`,
        history: { fixed: `matching saved cursor` },
        law: `persisted cursor durability`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as CursorDemandResult),
                    beforeStartup: [],
                  },
                },
          ),
      },
      {
        name: `obsolete physical rejection cannot replace current readiness`,
        history: { fixed: `matching saved cursor` },
        law: `persisted cursor coverage`,
        difference: `expected {"status":"ready"`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as CursorDemandResult),
                    cuts: (entry.value as CursorDemandResult).cuts.map(
                      (cut) => ({
                        ...cut,
                        physical: [
                          {
                            settlement: `rejected`,
                            aborted: true,
                            error: `obsolete acquisition`,
                          },
                        ],
                        record: {
                          ...cut.record,
                          queries: {
                            demand: {
                              ...cut.record.queries.demand!,
                              observed: { status: `error` },
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
        name: `ready cannot hide a failed current cursor acquisition`,
        history: { fixed: `saved cursor after confirmed eviction` },
        law: `persisted cursor coverage`,
        difference: `expected {"status":"error"}`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as CursorDemandResult),
                    cuts: (entry.value as CursorDemandResult).cuts.map((cut) =>
                      cut.name !== `saved cursor after cache eviction`
                        ? cut
                        : {
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
                          },
                    ),
                  },
                },
          ),
      },
      ...constructed.map((builder) => ({
        name: `${builder.name} cannot omit its state`,
        history: { constructed: builder.name },
        law: `constructed cursor reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter(
            (entry) =>
              !(
                entry.checkpoint === `reach` &&
                entry.value === builder.enters[0]
              ),
          ),
      })),
    ],
    timeout: 120_000,
  })
}
