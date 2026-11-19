/**
 * A limited provider reply proves its own prefix. It cannot erase saved rows
 * outside that prefix or the exact larger demand's offline coverage. This is
 * the primary persistence model's unchanged judgment, received through two
 * concurrent live queries and real closed/reopened storage.
 *
 * The finite grammar crosses source sizes eight/nine, distinct/tied boundary
 * ranks, and unchanged/changed prefix values. Both sizes exceed the windows.
 * A saved row tied with the prefix's last rank distinguishes strict-prefix
 * authority from inclusive-rank deletion. Changed values distinguish a stale
 * prefix from a valid merge. Provider
 * exhaustion, deletion, ordering changes, arbitrary filters, and multiple
 * browser tabs remain outside this receiver.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  coverageViolations,
  expectedObservations,
  persistedCoverageRows,
} from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  DemandPeerCut,
  DemandPeerHistory,
  DemandPeerResult,
} from './persisted-demand-peer-driver'

const histories: Array<DemandPeerHistory> = ([8, 9] as const).flatMap((size) =>
  [false, true].map((changed) => ({ size, changed })),
)
histories.push(
  ...histories.map((history) => ({ ...history, tied: true as const })),
)
const states = [
  `large online demand durably covered`,
  `large saved suffix accepted and unapplied`,
  `large raw acquisition waits behind restore`,
  `finite small prefix consumed before large raw acquisition`,
  `large offline deadline observed without provider answer`,
  `saved suffix shares finite prefix boundary rank`,
] as const
const recordAt = (cut: DemandPeerCut) => ({
  ...cut.record,
  queries: {
    large: {
      ...cut.record.queries.large!,
      waitPassed: (load: LoadSubsetOptions) =>
        cut.waits[cut.record.queries.large!.sent.indexOf(load)] === true,
    },
  },
})
const rowsKey = (rows: ReadonlyArray<unknown>) =>
  JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
    ),
  )

export function registerPersistedDemandPeer(
  property: string,
  receive: (
    history: DemandPeerHistory,
    id: string,
  ) => Promise<DemandPeerResult>,
  options: { owns: ReadonlyArray<string>; path: string },
) {
  let sequence = 0
  oracleProperty({
    id: property,
    owns: options.owns,
    law: {
      statement: `A finite online prefix preserves durable rows beyond its scope and the exact larger demand's saved offline coverage, including when that demand's persisted restore was accepted but unapplied before the prefix arrived.`,
      authority: `docs/guides/sqlite-persistence.md#on-demand-collections-offline; packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle.ts`,
      limits: `${options.path}. Two ordered windows of widths two/five; source sizes eight/nine; unchanged/changed prefix values; distinct/tied finite-prefix boundary. One optimistic application hold. No exhaustion, deletion, changing ranks, arbitrary filters/cursors, retention expiry or concurrent tabs.`,
    },
    histories: { enumerated: histories, states: [...states] },
    label: (history) =>
      `source ${history.size}, ${history.changed ? `changed` : `unchanged`} prefix${history.tied ? `, tied boundary` : ``}`,
    model: () => undefined,
    driver: async (history, observe) => {
      const result = await receive(history, `${property}-${sequence++}`)
      for (const state of result.reached) observe(`reach`, state)
      observe(`result`, result)
    },
    check: (_history, trace) => {
      const result = trace.find((item) => item.checkpoint === `result`)
        ?.value as DemandPeerResult | undefined
      if (!result)
        return violation(
          `receiving premise`,
          `Missing peer receiving record`,
          `persisted peer demand`,
        )
      for (const cut of result.cuts) {
        const record = recordAt(cut)
        const sourceRows = persistedCoverageRows(
          record.events,
          { group: `a`, orderByRank: true, limit: 5 },
          true,
        )
        // Persistence restores the requested window, not every durable row.
        // Provider pages may supply extra rows; only the demanded prefix is
        // owed publicly. The durable comparison below still checks all rows.
        if (rowsKey(cut.sourceRows.slice(0, 5)) !== rowsKey(sourceRows))
          return violation(
            cut.name,
            `Finite prefix discarded or corrupted saved source rows`,
            `persisted peer publication`,
            { expected: sourceRows, actual: result },
          )
        const durable = persistedCoverageRows(
          record.events,
          { group: `a` },
          true,
        )
        if (rowsKey(cut.durable) !== rowsKey(durable))
          return violation(
            cut.name,
            `Finite prefix discarded or corrupted durable saved rows`,
            `persisted peer durability`,
            { expected: durable, actual: result },
          )
        const failures = coverageViolations(record)
        if (failures.length)
          return violation(
            cut.name,
            failures.join(`; `),
            `persisted peer demand`,
            { expected: expectedObservations(record), actual: result },
          )
        const expected = expectedObservations(record).large!
        if (expected.status === `ready`) {
          const window = persistedCoverageRows(
            record.events,
            { group: `a`, orderByRank: true, limit: 5 },
            true,
          )
          if (rowsKey(cut.largeRows) !== rowsKey(window))
            return violation(
              cut.name,
              `Saved larger query values differ from source facts`,
              `persisted peer publication`,
              { expected: window, actual: result },
            )
        }
        const preload =
          expected.status === `ready`
            ? `fulfilled`
            : expected.status === `error`
              ? `rejected`
              : `pending`
        if (cut.largePreload !== preload)
          return violation(
            cut.name,
            `Expected larger preload ${preload}, observed ${cut.largePreload}`,
            `persisted peer demand`,
            { expected: preload, actual: result },
          )
      }
      const failures = [
        ...result.cleanupErrors,
        ...(result.browserErrors ?? []),
      ]
      return failures.length
        ? violation(
            `receiving cleanup`,
            failures.join(`; `),
            `receiving cleanup`,
          )
        : pass
    },
    calibrations: [
      {
        name: `finite prefix cannot discard the saved suffix`,
        history: { enumerated: `source 8, unchanged prefix` },
        law: `persisted peer publication`,
        difference: `Finite prefix discarded or corrupted saved source rows`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandPeerResult),
                    cuts: (item.value as DemandPeerResult).cuts.map((cut) => ({
                      ...cut,
                      sourceRows: cut.sourceRows.filter((row) => row.rank < 5),
                    })),
                  },
                },
          ),
      },
      {
        name: `finite prefix cannot erase durable suffix rows`,
        history: { enumerated: `source 8, unchanged prefix` },
        law: `persisted peer durability`,
        difference: `Finite prefix discarded or corrupted durable saved rows`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint !== `result`
              ? item
              : {
                  ...item,
                  value: {
                    ...(item.value as DemandPeerResult),
                    cuts: (item.value as DemandPeerResult).cuts.map((cut) => ({
                      ...cut,
                      durable: cut.durable.filter(
                        (row) => Number(row.rank) < 5,
                      ),
                    })),
                  },
                },
          ),
      },
    ],
  })
}
