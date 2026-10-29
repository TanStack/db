/**
 * Law 2 of the multi-tab Electric owner: after successful recovery and source
 * catch-up, durable rows and every open eager Collection equal the source head.
 * The authority is the persisted multi-tab eventual-consistency contract in
 * oracle-coverage.md (#2209). Arrival-order regressions before this cut remain
 * permitted. This judgment knows no cursor, coordinator, or storage algorithm.
 *
 * The Node driver supplies its independent server log; the Chromium/real SDK
 * driver supplies PostgreSQL rows. Both use this same settled-row judgment.
 * It does not judge intermediate publication, on-demand subsets, or optimism.
 *
 * This module owns the independent model and refinement check: the source head
 * predicts both durable and public rows, ignoring row order but retaining every
 * row occurrence and requiring each tab to be ready. The legal history grammar
 * and Node production driver live in multi-tab-electric-oracle.test.ts. The
 * receiving grammar and Chromium driver live in
 * ../e2e/electric-source-prefix-oracle.opfs.spec.ts and its page module.
 * Each driver calls this comparison after recovery and complete source delivery.
 */
import { declareOracle } from '../../db/tests/oracle-declaration'

type SourceRow = { id: string | number; label: string }

function canonicalRows(rows: ReadonlyArray<SourceRow>): Array<SourceRow> {
  return rows
    .map(({ id, label }) => ({ id, label }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

/** Compare durable rows and ready tabs with the independently supplied head. */
export function sourceHeadViolation(
  sourceHead: ReadonlyArray<SourceRow>,
  observation: {
    durableRows: ReadonlyArray<SourceRow>
    tabs: ReadonlyArray<{ status: string; rows: ReadonlyArray<SourceRow> }>
  },
): string | undefined {
  // Source-head equality is independent of how storage orders or repairs
  // interleaved commits. Readiness is supplied by each tab's own source.
  const expected = canonicalRows(sourceHead)
  if (
    JSON.stringify(canonicalRows(observation.durableRows)) !==
    JSON.stringify(expected)
  ) {
    return `durable rows differ from source head: ${JSON.stringify({ expected, actual: observation.durableRows })}`
  }
  for (const [index, tab] of observation.tabs.entries()) {
    if (
      tab.status !== `ready` ||
      JSON.stringify(canonicalRows(tab.rows)) !== JSON.stringify(expected)
    ) {
      return `tab ${index} differs from ready source head: ${JSON.stringify({ expected, actual: tab })}`
    }
  }
  return undefined
}

declareOracle({ check: [sourceHeadViolation] })
