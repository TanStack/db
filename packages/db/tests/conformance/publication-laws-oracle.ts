/**
 * Publication rows at the shared conformance suite's settled cut.
 *
 * The authority is contract.ts's reactive source-swap law and public binding
 * result law, plus publication-log.ts's end-of-turn observation cut. Empty
 * intermediate values remain legal while a new list query loads. Every
 * recorded turn must contain only the selected input's rows; once the driver
 * has settled, the final turn must contain the source model's complete rows.
 *
 * The existing source-ID and pooled histories supply those rows independently
 * of the hook. This check does not infer readiness from production output.
 * Limits: the tiny list-query histories in suite.ts, selected values at the
 * final cut and ID membership at earlier cuts. It does not judge findOne,
 * arbitrary scheduling, status traces, or changes hidden within one turn.
 */
import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'
import { expectUnorderedRows } from './result-laws'

export function expectPublishedRows(
  values: ReadonlyArray<unknown>,
  rows: ReadonlyArray<{ id: string }>,
): void {
  expect(values.length, `no recorded publication`).toBeGreaterThan(0)
  const allowed = new Set(rows.map(({ id }) => id))
  for (const value of values) {
    const published = (Array.isArray(value) ? value : value ? [value] : []).map(
      (row: { id: string }) => row.id,
    )
    expect(
      published.filter((id) => !allowed.has(id)),
      `published rows ${JSON.stringify(published)}`,
    ).toEqual([])
  }
  // A dropped accessor value is not proof of a legal empty loading turn once
  // the driver has reached the settled cut. Use the same selected-row law as
  // the scenarios' independent final-row model, including a legal empty set.
  expectUnorderedRows(values.at(-1), rows)
}

declareOracle({ check: [expectPublishedRows] })
