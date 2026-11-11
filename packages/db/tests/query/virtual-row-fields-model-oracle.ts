import { expect } from 'vitest'
import { metadataCollisionCases } from './virtual-row-fields-grammar-oracle.js'
import { virtualFieldNames } from './virtual-row-fields-support.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'

// The attribution, boundary-publication, publication-ledger, inline-value,
// and nullable-selection models and checks of the virtual-field publication
// oracle, moved here unchanged from virtual-row-fields-oracle.test.ts. The
// oracle compares production with them; the ordinary checker calibrations in
// virtual-row-fields.test.ts feed them hostile observations. This module
// registers no tests.

export function sourceOwnsMetadata(shape: string): boolean {
  return shape === `structured-spread` || shape === `functional-direct`
}

export function checkRootMetadata(
  actual: Record<(typeof virtualFieldNames)[number], unknown>,
  expected: Record<(typeof virtualFieldNames)[number], unknown>,
): void {
  for (const field of virtualFieldNames)
    expect(actual[field], field).toBe(expected[field])
}

export type AttributionKey = string | number
export type AttributionRow = {
  id: AttributionKey
  parentId: string
  label: string
}
// The finite grammar varies compiler context types, but every accepted root
// has these ordinary fields. Erase only that context union at the driver edge;
// the full runtime shape remains independently checked below.
export type AttributionContext = {
  schema: {}
  baseSchema: {}
  fromSourceName: string
  result: { id: AttributionKey; label: string }
  hasResult: true
}
// Model rows are authored source facts, never sampled from the production
// Collection. Pending overlays affect only their named key; settlement without
// source confirmation restores the authored base (optimistic-history contract).
export function expectedAttributedRows(
  rows: ReadonlyArray<AttributionRow>,
  shape: string,
  pending: ReadonlySet<AttributionKey>,
  sourceId: string,
  outputId: string,
  outputKey: (id: AttributionKey) => unknown,
  // Single-source rows keep their source key. Joined rows use their actual
  // default pair or explicit custom key (maintainer decision, November 5).
  sourceKey: (id: AttributionKey) => AttributionKey = (id) => id,
) {
  return rows.map((row) => ({
    ordinary:
      shape === `structured-projection`
        ? {
            id: row.id,
            label: row.label,
            hasPendingWrites: pending.has(row.id),
          }
        : shape === `functional-projection`
          ? { id: row.id, label: row.label }
          : { ...row },
    metadata: sourceOwnsMetadata(shape)
      ? expectedSourceMetadata(sourceKey(row.id), sourceId, pending.has(row.id))
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
  expected: ReturnType<typeof expectedAttributedRows>,
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

// Each finite history has one numeric token. A state keeps that token once,
// so repeated observations preserve the original per-history checkpoint count.

// Both boolean values are legal authored collisions. True distinguishes an
// output-owned row's mandatory false pending flag; false distinguishes a
// pending source-owned row. Use a legal local origin to challenge remote roots.
export const collisionCases = metadataCollisionCases

export type BoundaryPublicationHistory = {
  kind:
    | `implicit-single`
    | `implicit-join`
    | `inline-return`
    | `grouped`
    | `aggregate`
  composition: `direct` | `query-ref`
  pendingSource: `parent` | `child`
  inline: `none` | `array` | `singleton`
  collision: string
  authoredPending: boolean
}
export const boundaryPublicationHistories: Array<BoundaryPublicationHistory> = [
  ...([`grouped`, `aggregate`] as const).flatMap((kind) =>
    ([`direct`, `query-ref`] as const).map((composition) => ({
      kind,
      composition,
      pendingSource: `child` as const,
      inline: `none` as const,
      collision: `none`,
      authoredPending: false,
    })),
  ),
  ...([`implicit-single`, `implicit-join`] as const).flatMap((kind) =>
    ([`direct`, `query-ref`] as const).flatMap((composition) =>
      (kind === `implicit-single`
        ? ([`child`] as const)
        : ([`parent`, `child`] as const)
      ).map((pendingSource) => ({
        kind,
        composition,
        pendingSource,
        inline: `none` as const,
        collision: `none`,
        authoredPending: false,
      })),
    ),
  ),
  ...([`none`, `array`, `singleton`] as const).flatMap((inline) =>
    collisionCases.flatMap(({ collision, authoredPending }) =>
      ([`direct`, `query-ref`] as const).flatMap((composition) =>
        ([`parent`, `child`] as const).map((pendingSource) => ({
          kind: `inline-return` as const,
          inline,
          collision,
          authoredPending,
          composition,
          pendingSource,
        })),
      ),
    ),
  ),
]
export type BoundaryPublishedRow = AttributionRow & { children?: unknown }
export type BoundaryJoinedRow = {
  parent: AttributionRow
  chosen: AttributionRow
}
export type BoundaryPublicationContext = Omit<AttributionContext, `result`> & {
  result:
    | BoundaryPublishedRow
    | BoundaryJoinedRow
    | { id: AttributionKey; total: number }
}
// This grammar also models joined namespaces and inline children. Keep its
// carrier open to those shapes; exact fields still come from the model below.
export type BoundaryMetadataResult = {
  ordinary: object
  metadata: ReturnType<typeof expectedAttributedRows>[number][`metadata`]
}

// A namespace combines two source values rather than selecting either one.
// Returning an actual source input, including a spread projected upstream,
// retains that input's source owner. No selected metadata values choose it.
export function expectedBoundaryPublication(
  history: BoundaryPublicationHistory,
  parent: AttributionRow,
  children: ReadonlyArray<AttributionRow>,
  pending: ReadonlySet<AttributionKey>,
  parentId: string,
  childId: string,
  outputId: string,
): Array<BoundaryMetadataResult> {
  if (history.kind === `grouped` || history.kind === `aggregate`) {
    // Group membership and counts follow authored rows, independent of their
    // metadata. No source row is selected whole, so publication owns metadata.
    const counts = new Map<string, number>()
    for (const child of children) {
      const id = history.kind === `aggregate` ? `all` : child.parentId
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return [...counts].map(([id, total]) => ({
      ordinary: { id, total },
      metadata: expectedSourceMetadata(`output-${id}`, outputId, false),
    }))
  }
  if (history.kind === `implicit-single`)
    return expectedAttributedRows(
      children,
      `functional-direct`,
      pending,
      childId,
      outputId,
      (id) => id,
    )
  if (history.kind === `implicit-join`)
    return children
      .filter((child) => child.parentId === parent.id)
      .map((child) => ({
        ordinary: {
          parent: {
            ...parent,
            ...expectedSourceMetadata(
              parent.id,
              parentId,
              pending.has(parent.id),
            ),
          },
          chosen: {
            ...child,
            ...expectedSourceMetadata(child.id, childId, pending.has(child.id)),
          },
        },
        metadata: expectedSourceMetadata(`result-${child.id}`, outputId, false),
      }))
  const selected = expectedAttributedRows(
    [parent],
    `functional-direct`,
    pending,
    parentId,
    outputId,
    (id) => id,
  )[0]!
  if (history.inline !== `none`) {
    const values = children
      .filter((child) => child.parentId === parent.id)
      .map(({ id, label }) => ({ id, label }))
    return [
      {
        ...selected,
        ordinary: {
          ...selected.ordinary,
          children: history.inline === `singleton` ? values[0] : values,
        },
      },
    ]
  }
  return [selected]
}

// Compare physical membership keys and every readable row field together.
// Sorting by the entry key permits unspecified delivery order, while retaining
// duplicate rows and mismatches between a public row's key and its entry key.
export function checkBoundaryPublication(
  actual: ReadonlyArray<readonly [AttributionKey, object]>,
  expected: ReadonlyArray<BoundaryMetadataResult>,
): void {
  const order = (
    a: readonly [AttributionKey, object],
    b: readonly [AttributionKey, object],
  ) => `${typeof a[0]}:${a[0]}`.localeCompare(`${typeof b[0]}:${b[0]}`)
  expect(
    actual.map(([key, row]) => [key, { ...row }] as const).sort(order),
  ).toEqual(
    expected
      .map(
        ({ ordinary, metadata }) =>
          [
            metadata.$key as AttributionKey,
            { ...ordinary, ...metadata },
          ] as const,
      )
      .sort(order),
  )
}

export type MetadataResult = ReturnType<typeof expectedAttributedRows>[number]
export function expectedJoinedMetadata(
  leftRows: ReadonlyArray<AttributionRow>,
  rightRows: ReadonlyArray<AttributionRow>,
  shape: string,
  reverse: boolean,
  pending: ReadonlySet<AttributionKey>,
  rightOrigin: `local` | `remote`,
  leftId: string,
  rightId: string,
  outputId: string,
): Array<MetadataResult> {
  return leftRows.flatMap((a) => {
    const matches = rightRows.filter((b) => b.parentId === a.id)
    return (matches.length ? matches : [undefined]).map((b) => {
      const spread = reverse ? { ...b, ...a } : { ...a, ...b }
      const owner = shape === `functional-direct` || reverse || !b ? a : b
      const selected =
        shape.endsWith(`projection`) || shape === `functional-direct`
          ? a
          : spread
      const expected = expectedAttributedRows(
        [selected],
        shape,
        pending,
        owner === b ? rightId : leftId,
        outputId,
        (id) => `projection-${id}`,
      )[0]!
      if (sourceOwnsMetadata(shape) && owner === b && !pending.has(b.id))
        expected.metadata.$origin = rightOrigin
      return expected
    })
  })
}

// Capture all row fields now. Retaining production row handles could let a
// later metadata getter or mutation rewrite evidence from an earlier callback.
export function captureMetadataRows(
  rows: ReadonlyArray<object>,
): Array<object> {
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      virtualFieldNames.map((field) => [
        field,
        (row as Record<string, unknown>)[field],
      ]),
    ),
  }))
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

export function expectedInlineMetadataValues(
  rows: ReadonlyArray<AttributionRow>,
  shape: string,
  pending: ReadonlySet<AttributionKey>,
  sourceId: string,
  overrides: Readonly<Record<string, unknown>>,
): Array<object> {
  return rows.map((row) => {
    const source = expectedAttributedRows(
      [row],
      `structured-spread`,
      pending,
      sourceId,
      `unused`,
      (id) => id,
    )[0]!
    const selected = shape.endsWith(`projection`)
      ? expectedAttributedRows(
          [row],
          shape,
          pending,
          sourceId,
          `unused`,
          (id) => id,
        )[0]!.ordinary
      : { ...source.ordinary, ...source.metadata }
    return shape === `functional-direct`
      ? selected
      : { ...selected, ...overrides }
  })
}
export function checkInlineMetadataValues(
  actual: ReadonlyArray<object>,
  expected: ReadonlyArray<object>,
): void {
  // These values are flat authored records. Sorting ignores unspecified order,
  // but preserves every selected property and duplicate occurrence.
  const byId = (a: object, b: object) =>
    String((a as { id: unknown }).id).localeCompare(
      String((b as { id: unknown }).id),
    )
  expect([...actual].sort(byId)).toEqual([...expected].sort(byId))
}

export function expectedNullableSelection(
  match: { id: string; label: string } | undefined,
  sourceId: string,
  facadeId: string,
  facadeKey: string | number,
): { inline: Array<object>; facade: Array<object> } {
  const inline = match
    ? [
        {
          ...match,
          $key: match.id,
          $collectionId: sourceId,
          $origin: `remote`,
          $hasPendingWrites: false,
        },
      ]
    : [{}]
  return {
    inline,
    facade: match
      ? inline.map((row) => ({ ...row, $key: facadeKey }))
      : [
          {
            $key: facadeKey,
            $collectionId: facadeId,
            $origin: `remote`,
            $hasPendingWrites: false,
          },
        ],
  }
}
export function checkNullableSelection(
  actual: {
    facade: ReadonlyArray<object>
    inline: ReadonlyArray<ReadonlyArray<object>>
  },
  expected: ReturnType<typeof expectedNullableSelection>,
): void {
  checkInlineMetadataValues(actual.facade, expected.facade)
  for (const value of actual.inline)
    checkInlineMetadataValues(value, expected.inline)
}
