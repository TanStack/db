/**
 * Calibrations of Part 1 of the persisted demand coverage oracle: the
 * refinement check rejects wrong observations, the model differs from each
 * plausible wrong design at a named cell (ORC-006, ORC-013), and the cells
 * enumerate every declared combination once. They judge the model, check, and
 * grammar in persisted-demand-coverage-cells-model-oracle.ts and run no
 * production, so they are ordinary tests. The oracle that drives production
 * is persisted-demand-coverage-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_CELLS,
  COVERAGE_HISTORIES,
  LAW,
  SESSION_1_ROWS,
  UPSTREAM_SCHEDULES,
  WAITS,
  cellName,
  expectedTrace,
  firstMismatch,
  sameObservation,
} from './persisted-demand-coverage-cells-model-oracle.js'
import type {
  Cell,
  Design,
} from './persisted-demand-coverage-cells-model-oracle.js'

describe(`persisted demand coverage oracle`, () => {
  // -------------------------------------------------------------------------
  // Calibration: the comparison rejects wrong answers, and each block
  // distinguishes its law from plausible wrong designs at a named case
  // (ORC-006, ORC-013). These checks judge the models and comparisons;
  // production mutants run separately against an implementation.
  // -------------------------------------------------------------------------

  it(`rejects wrong observations at a checkpoint`, () => {
    const ready = {
      queryStatus: `ready`,
      preload: `resolved`,
      rows: [`a1:v1`, `a2:v1`],
    } as const
    expect(sameObservation(ready, ready)).toBe(true)
    expect(sameObservation(ready, { ...ready, rows: [`a1:v1`] })).toBe(false)
    expect(sameObservation(ready, { ...ready, rows: [`a2:v1`, `a1:v1`] })).toBe(
      false,
    )
    expect(sameObservation(ready, { ...ready, rows: [`a1:v1`, `a1:v1`] })).toBe(
      false,
    )
    expect(sameObservation(ready, { ...ready, preload: `pending` })).toBe(false)
    expect(
      sameObservation(ready, { queryStatus: `loading`, preload: `pending` }),
    ).toBe(false)
    expect(
      sameObservation(
        { queryStatus: `loading`, preload: `pending` },
        { queryStatus: `ready`, preload: `resolved`, rows: [] },
      ),
    ).toBe(false)
  })

  const wrongDesigns: ReadonlyArray<{ design: Design; witness: Cell }> = [
    {
      design: { ...LAW, name: `any local read counts`, isCovered: () => true },
      witness: { history: `not-requested`, waitMs: 0, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `nonempty rows count`,
        isCovered: (history) => SESSION_1_ROWS[history].length > 0,
      },
      witness: { history: `settled-empty`, waitMs: 0, upstream: `pending` },
    },
    {
      // A Collection-wide flag set by any settled load, or rows that match D.
      design: {
        ...LAW,
        name: `coverage per Collection`,
        isCovered: (history) =>
          history !== `not-requested` && history !== `failed`,
      },
      witness: {
        history: `overlapping-demand`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: {
        ...LAW,
        name: `coverage keyed by filter only`,
        isCovered: (history) =>
          LAW.isCovered(history) ||
          history === `other-window` ||
          history === `other-order`,
      },
      witness: { history: `other-window`, waitMs: 0, upstream: `pending` },
    },
    {
      // Honors limit but drops `orderBy` from the key.
      design: {
        ...LAW,
        name: `coverage ignores order`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `other-order`,
      },
      witness: { history: `other-order`, waitMs: 0, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `coverage written before the rows commit`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `durable-write-failed`,
      },
      witness: {
        history: `durable-write-failed`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: {
        ...LAW,
        name: `coverage survives truncate`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `truncated`,
      },
      witness: { history: `truncated`, waitMs: 0, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `any settled load records coverage`,
        isCovered: (history) =>
          LAW.isCovered(history) ||
          history === `truncated-in-flight` ||
          history === `recovered-in-flight`,
      },
      witness: {
        history: `truncated-in-flight`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: {
        ...LAW,
        name: `coverage ignores rows deleted after it settled`,
        isCovered: (history) =>
          LAW.isCovered(history) || history === `settled-then-row-deleted`,
      },
      witness: {
        history: `settled-then-row-deleted`,
        waitMs: 0,
        upstream: `pending`,
      },
    },
    {
      design: { ...LAW, name: `wait ignored`, honorsWait: false },
      witness: { history: `settled`, waitMs: 1000, upstream: `pending` },
    },
    {
      design: { ...LAW, name: `half deadline`, deadlineFraction: 0.5 },
      witness: { history: `settled`, waitMs: 1000, upstream: `pending` },
    },
    {
      design: {
        ...LAW,
        name: `failure errors a covered demand`,
        failureSettlesCovered: false,
      },
      witness: { history: `settled`, waitMs: 1000, upstream: `fails-early` },
    },
    {
      design: {
        ...LAW,
        name: `upstream aborted after SQLite`,
        upstreamContinues: false,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `answers-late` },
    },
    {
      design: {
        ...LAW,
        name: `late failure undoes a settlement`,
        settlementSurvivesFailure: false,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `fails-late` },
    },
    {
      design: {
        ...LAW,
        name: `settles before restore`,
        settlesBeforeRestore: true,
      },
      witness: { history: `settled`, waitMs: 0, upstream: `pending` },
    },
  ]

  it.each(wrongDesigns.map((entry) => [entry.design.name, entry] as const))(
    `distinguishes the law from the wrong design: %s`,
    (_name, { design, witness }) => {
      expect(ALL_CELLS).toContainEqual(witness)
      expect(
        firstMismatch(expectedTrace(witness), expectedTrace(witness, design)),
      ).toBeDefined()
    },
  )

  it(`enumerates every declared cell once`, () => {
    const names = ALL_CELLS.map(cellName)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(
      COVERAGE_HISTORIES.length * WAITS.length * UPSTREAM_SCHEDULES.length,
    )
  })
})
