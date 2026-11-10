import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import { virtualFieldNames } from './virtual-row-fields-support.js'

/**
 * VirtualRowProps and live-queries.md's Virtual properties section give row
 * roots all four virtual fields. Structured source spreads and direct
 * functional source returns retain source metadata. Other projections receive
 * their output Collection's metadata (maintainer decision, 2026-10-28).
 *
 * Ordinary expected rows come from each driver's independent query model.
 * This shared judgment chooses attribution from authored syntax, not from
 * production values or compiler classifications. The publication law in
 * ARCHITECTURE requires callback reads, values and previous values to describe
 * the same complete public result. Batch partition remains free.
 *
 * The core owner supplies its attribution/timeline grammars. The QueryClient
 * receiver supplies reload scheduling and raw public observations. Sharing
 * this judgment adds no provider or history coverage until those drivers run.
 */
export type AttributionKey = string | number
export type MetadataResult = {
  ordinary: object
  metadata: {
    $key: unknown
    $collectionId: string
    $hasPendingWrites: boolean
    $origin: string
  }
}
// The independent attribution law uses authoring shape, never selected values.
export function sourceOwnsMetadata(shape: string): boolean {
  return shape === `structured-spread` || shape === `functional-direct`
}

// Authoring shape, never selected values, chooses source attribution. Ordinary
// rows are independently selected by each owner before this shared rule runs.
export function attributeMetadataRows<TRow extends { id: AttributionKey }>(
  rows: ReadonlyArray<TRow>,
  shape: string,
  pending: ReadonlySet<AttributionKey>,
  sourceId: string,
  outputId: string,
  outputKey: (id: AttributionKey) => unknown,
): Array<MetadataResult> {
  return rows.map((row) => ({
    ordinary: { ...row },
    metadata: sourceOwnsMetadata(shape)
      ? expectedSourceMetadata(row.id, sourceId, pending.has(row.id))
      : {
          $key: outputKey(row.id),
          $collectionId: outputId,
          $hasPendingWrites: false,
          $origin: `remote`,
        },
  }))
}

export function checkAttributedRows(
  actual: ReadonlyArray<object>,
  expected: ReadonlyArray<MetadataResult>,
): void {
  const observed = actual.map((row) => ({
    ordinary: Object.fromEntries(
      Object.entries(row).filter(
        ([name]) => !virtualFieldNames.some((field) => field === name),
      ),
    ),
    metadata: Object.fromEntries(
      virtualFieldNames.map((field) => [
        field,
        (row as Record<string, unknown>)[field],
      ]),
    ),
  }))
  const identity = (row: { ordinary: object }) => {
    const { id } = row.ordinary as { id: unknown }
    return `${typeof id}:${String(id)}`
  }
  const byId = (a: { ordinary: object }, b: { ordinary: object }) =>
    identity(a).localeCompare(identity(b))
  // Sorting permits unspecified result order but preserves every occurrence,
  // field and extra row. No Map can collapse duplicate contributions here.
  expect(observed.sort(byId)).toEqual([...expected].sort(byId))
}
export type MetadataBatch = {
  rows: Array<object>
  changes: Array<{
    type: string
    key: AttributionKey
    value: object
    previousValue?: object
  }>
}
export function publishedModelRows(rows: ReadonlyArray<MetadataResult>) {
  return rows.map((row) => ({ ...row.ordinary, ...row.metadata }))
}
// Collection change messages are the exact before/after delta for one atomic
// publication. Their ordering is unspecified; duplicate or omitted messages
// remain visible because neither side collapses actual messages into a Map.
export function expectedMetadataChanges(
  before: ReadonlyArray<MetadataResult>,
  after: ReadonlyArray<MetadataResult>,
) {
  const changes: MetadataBatch[`changes`] = []
  const same = (a: MetadataResult, b: MetadataResult) =>
    JSON.stringify(a) === JSON.stringify(b)
  for (const row of before) {
    if (!after.some((next) => next.metadata.$key === row.metadata.$key))
      changes.push({
        type: `delete`,
        key: row.metadata.$key as AttributionKey,
        value: publishedModelRows([row])[0]!,
      })
  }
  for (const row of after) {
    const previous = before.find(
      (old) => old.metadata.$key === row.metadata.$key,
    )
    if (!previous || !same(previous, row))
      changes.push({
        type: previous ? `update` : `insert`,
        key: row.metadata.$key as AttributionKey,
        value: publishedModelRows([row])[0]!,
        ...(previous
          ? { previousValue: publishedModelRows([previous])[0]! }
          : {}),
      })
  }
  return changes
}
export function checkMetadataPublications(
  actual: ReadonlyArray<MetadataBatch>,
  before: ReadonlyArray<MetadataResult>,
  after: ReadonlyArray<MetadataResult>,
): void {
  const expectedChanges = expectedMetadataChanges(before, after)
  if (expectedChanges.length)
    expect(actual.length, `owed metadata publication`).toBeGreaterThan(0)
  const byChange = (
    a: MetadataBatch[`changes`][number],
    b: MetadataBatch[`changes`][number],
  ) => `${typeof a.key}:${a.key}`.localeCompare(`${typeof b.key}:${b.key}`)
  for (const batch of actual) {
    checkAttributedRows(batch.rows, [...after])
  }
  // Compare every callback's delta together. Splitting a batch stays legal;
  // repeating a whole batch cannot consume the same public change twice.
  expect(actual.flatMap((batch) => batch.changes).sort(byChange)).toEqual(
    [...expectedChanges].sort(byChange),
  )
}

declareOracle({
  model: [sourceOwnsMetadata, attributeMetadataRows, expectedMetadataChanges],
  check: [checkAttributedRows, checkMetadataPublications],
})
