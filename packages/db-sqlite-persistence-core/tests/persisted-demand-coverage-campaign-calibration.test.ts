/**
 * Checker calibration (ORC-006) of the persisted demand coverage comparison,
 * coverageViolations in persisted-demand-coverage-model-oracle.ts, with the
 * demands of the generated campaign. It builds wrong observations by hand and
 * runs no production, so it is an ordinary test. The campaign that drives
 * production is persisted-demand-coverage-campaign-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import { oracleReplayRequested } from '../../db/tests/oracle-config'
import { coverageViolations } from './persisted-demand-coverage-model-oracle.js'
import {
  SPECS,
  WINDOW_LIMIT,
} from './persisted-demand-coverage-campaign-grammar-oracle.js'
import type {
  CoverageRecord,
  QueryObservation,
  SourceEvent,
} from './persisted-demand-coverage-model-oracle.js'
import type { LoadSubsetOptions } from '@tanstack/db'

describe(`persisted demand coverage over generated histories`, () => {
  it.skipIf(oracleReplayRequested())(
    `rejects observations that ignore lost rows, obsolete loads, or other window rows`,
    () => {
      // Checker calibration (ORC-006): the shared judgment must reject a wrong
      // observation of each kind. Each record below states what production
      // would wrongly show; the comparison must report it.
      const loadA: LoadSubsetOptions = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`group`]),
          new IR.Value(`a`),
        ]),
      }
      const loadW = {
        ...loadA,
        orderBy: [
          {
            expression: new IR.PropRef([`rank`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
        limit: WINDOW_LIMIT,
      } as unknown as LoadSubsetOptions
      const rows: SourceEvent = {
        type: `rows`,
        rows: [
          [`r1`, { group: `a`, rank: 1 }],
          [`r2`, { group: `a`, rank: 2 }],
        ],
      }
      const covered: Array<SourceEvent> = [
        rows,
        { type: `settled`, load: loadA, current: true },
        { type: `settled`, load: loadW, current: true },
      ]
      const ready = (ids: Array<string>): QueryObservation => ({
        status: `ready`,
        rows: ids,
      })
      const record = (
        events: ReadonlyArray<SourceEvent>,
        a: QueryObservation,
        w: QueryObservation,
      ): CoverageRecord => ({
        events,
        // The offline session's own loads of the same demands.
        queries: {
          a: { spec: SPECS.a, sent: [{ ...loadA }], observed: a },
          w: { spec: SPECS.w, sent: [{ ...loadW }], observed: w },
        },
        upstream: `never answers`,
        waitPassed: true,
      })
      // The right observations pass.
      expect(
        coverageViolations(
          record(covered, ready([`r1`, `r2`]), ready([`r1`, `r2`])),
        ),
      ).toEqual([])
      // A demand that lost a row, settled anyway.
      expect(
        coverageViolations(
          record([...covered, { type: `delete`, id: `r1` }], ready([`r2`]), {
            status: `loading`,
          }),
        ),
      ).toHaveLength(1)
      // An obsolete load treated as coverage.
      expect(
        coverageViolations(
          record(
            [rows, { type: `settled`, load: loadA, current: false }],
            ready([`r1`, `r2`]),
            { status: `loading` },
          ),
        ),
      ).toHaveLength(1)
      // A released load that the source resolves must not certify its demand.
      expect(
        coverageViolations(
          record(
            [
              rows,
              { type: `settled`, load: loadA, current: true, aborted: true },
            ],
            ready([`r1`, `r2`]),
            { status: `loading` },
          ),
        ),
      ).toHaveLength(1)
      // A window that holds another row, settled anyway.
      expect(
        coverageViolations(
          record(
            [
              ...covered,
              { type: `rows`, rows: [[`r3`, { group: `a`, rank: 0 }]] },
            ],
            ready([`r1`, `r2`, `r3`]),
            ready([`r3`, `r1`]),
          ),
        ),
      ).toHaveLength(1)
      // A window shown out of order.
      expect(
        coverageViolations(
          record(covered, ready([`r1`, `r2`]), ready([`r2`, `r1`])),
        ),
      ).toHaveLength(1)
    },
  )
})
