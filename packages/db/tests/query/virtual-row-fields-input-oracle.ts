/**
 * # What may user JavaScript learn from a query input?
 *
 * Authority: the maintainer's O12 decision, recorded in the RC challenge on
 * 2026-10-28, and ARCHITECTURE.md's functional-input boundary. Direct source
 * returns and structured source spreads expose genuine source metadata.
 * Own-shape projections (including functional spreads) expose no reserved
 * fields before a downstream callback. Inline include values keep authored
 * shape. Collection-valued compiled inputs remain inadmissible.
 *
 * This small model uses authored source facts and syntax descriptions, not
 * compiler provenance or observed values. Callback input is a model observation
 * of one runtime value; it is not a published Collection row. An ordinary
 * derived output carries this observation so publication-only sanitization
 * cannot erase an earlier violation. The finite grammar bounds recursion at
 * two QueryRefs and joins at one LEFT join. Provider/framework timing, arbitrary
 * objects/descriptors and same-key overlapping transactions are outside it.
 */
import { isDeepStrictEqual } from 'node:util'
import { declareOracle } from '../oracle-declaration.js'
import { virtualFieldNames } from './virtual-row-fields-support.js'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import {
  metadataCollisionCases,
  metadataProjectionShapes,
} from './virtual-row-fields-grammar-oracle.js'

export type MetadataInputShape = (typeof metadataProjectionShapes)[number]
export type MetadataInputRow = {
  id: string | number
  parentId: string
  label: string
  // An explicit undefined ordinary property must survive both boundaries.
  optional: undefined
}
export type MetadataSourceFact = {
  row: MetadataInputRow
  sourceId: string
  pending: boolean
}
export type MetadataCollision = (typeof metadataCollisionCases)[number]
export type MetadataInputDescription = MetadataCollision & {
  shape: MetadataInputShape
}
export const metadataInputDescriptions = metadataProjectionShapes.flatMap(
  (shape) =>
    metadataCollisionCases
      .filter(
        ({ collision }) =>
          shape !== `functional-direct` || collision === `none`,
      )
      .map((collision) => ({ shape, ...collision })),
)
export const metadataCallbackPaths = [
  `query-ref`,
  `nested-query-ref`,
  `joined-from`,
  `joined-source`,
  `union-first`,
  `union-last`,
  `union-query-ref`,
] as const
export type MetadataCallbackPath = (typeof metadataCallbackPaths)[number]
export const metadataCallbackHistories = metadataInputDescriptions.flatMap(
  (description) =>
    metadataCallbackPaths.map((path) => ({ ...description, path })),
)
export const metadataCallbackReceiverHistories =
  metadataCallbackHistories.flatMap((history) =>
    ([`root`, `inline-child`, `inline-child-direct`] as const)
      // A flat union has no named source reference for include correlation.
      // Admission requires the QueryRef used by union-query-ref or the wrapped
      // receiver; direct union-first/last are not legal include children.
      .filter(
        (receiver) =>
          receiver !== `inline-child-direct` ||
          (history.path !== `union-first` && history.path !== `union-last`),
      )
      .map((receiver) => ({ ...history, receiver })),
  )
export const metadataInlineHistories = metadataInputDescriptions.flatMap(
  (description) =>
    ([`array`, `materialized`, `collection`] as const).flatMap((form) =>
      ([`direct`, `query-ref`] as const).map((path) => ({
        ...description,
        form,
        path,
      })),
    ),
)
export type MetadataInputSnapshot = {
  present: boolean
  ordinary: Record<string, unknown>
  fields: Record<string, { present: boolean; own: boolean; value: unknown }>
}

// This is the existing source-row law, shared with root publication. A pending
// unconfirmed update drops at settlement; a later remote write stays remote.
export function expectedSourceVirtualFields(fact: {
  row: { id: string | number }
  sourceId: string
  pending: boolean
}) {
  return expectedSourceMetadata(fact.row.id, fact.sourceId, fact.pending)
}
export function authoredMetadataCollision(
  description: MetadataCollision,
): Record<string, unknown> {
  return Object.fromEntries(
    virtualFieldNames
      .filter(
        (field) =>
          description.collision === field || description.collision === `all`,
      )
      .map((field) => [
        field,
        field === `$hasPendingWrites`
          ? description.authoredPending
          : field === `$origin`
            ? `local`
            : `spoof-${field}`,
      ]),
  )
}
function ordinaryProjection(
  fact: MetadataSourceFact,
  shape: MetadataInputShape,
): Record<string, unknown> {
  if (shape === `structured-projection`)
    return {
      id: fact.row.id,
      label: fact.row.label,
      hasPendingWrites: fact.pending,
    }
  if (shape === `functional-projection`)
    return {
      id: fact.row.id,
      label: fact.row.label,
      optional: undefined,
    }
  return { ...fact.row }
}
export function expectedMetadataInput(
  fact: MetadataSourceFact,
  description: MetadataInputDescription,
  inline = false,
): MetadataInputSnapshot {
  const ordinary = ordinaryProjection(fact, description.shape)
  const sourceOwned =
    description.shape === `structured-spread` ||
    description.shape === `functional-direct`
  const fields = inline
    ? {
        ...(description.shape.endsWith(`projection`)
          ? {}
          : expectedSourceVirtualFields(fact)),
        ...authoredMetadataCollision(description),
      }
    : sourceOwned
      ? expectedSourceVirtualFields(fact)
      : {}
  return expectedMetadataRecord({ ...ordinary, ...fields })
}
// A record snapshot is also the common judgment for inline parents. It keeps
// missing fields distinct from own undefined and checks every ordinary field.
export function expectedMetadataRecord(
  record: Record<string, unknown> | undefined,
): MetadataInputSnapshot {
  return {
    present: record !== undefined,
    ordinary: Object.fromEntries(
      Object.entries(record ?? {}).filter(
        ([key]) => !virtualFieldNames.some((field) => field === key),
      ),
    ),
    fields: Object.fromEntries(
      virtualFieldNames.map((field) => [
        field,
        {
          present: record !== undefined && field in record,
          own: record !== undefined && Object.hasOwn(record, field),
          value: record?.[field],
        },
      ]),
    ),
  }
}
// Reserved metadata promises presence and readable value, not descriptor
// layout. Keep `own` in captures as diagnostics without requiring it for a
// present field. An absent field cannot legally be own. This applies only to
// top-level callback metadata. Nested inline selected records stay in ordinary
// data and retain their authored own fields, including own undefined.
function readableMetadataInput(snapshot: MetadataInputSnapshot) {
  return {
    ...snapshot,
    fields: Object.fromEntries(
      Object.entries(snapshot.fields).map(([name, field]) => [
        name,
        field.present ? { present: true, value: field.value } : field,
      ]),
    ),
  }
}
export function metadataInputViolations(
  actual: MetadataInputSnapshot,
  allowed: ReadonlyArray<MetadataInputSnapshot>,
): Array<string> {
  return allowed.some((expected) =>
    isDeepStrictEqual(
      readableMetadataInput(actual),
      readableMetadataInput(expected),
    ),
  )
    ? []
    : [`callback input differs from every permitted authored source state`]
}
export function metadataOutputViolations(
  actual: ReadonlyArray<{
    id: string | number
    observed: MetadataInputSnapshot
  }>,
  expected: ReadonlyArray<{
    id: string | number
    observed: MetadataInputSnapshot
  }>,
): Array<string> {
  const byId = (a: { id: string | number }, b: { id: string | number }) =>
    `${typeof a.id}:${a.id}`.localeCompare(`${typeof b.id}:${b.id}`)
  // The derived output carries the recorder's diagnostic ownership flag too.
  // Judge its metadata facts by the same readable-value law, while exact outer
  // fields, typed keys, ordinary input fields and occurrence counts stay strict.
  const stripDiagnostics = (rows: ReadonlyArray<unknown>) =>
    rows.map((value) => {
      if (!value || typeof value !== `object`) return value
      const row = value as Record<string, unknown>
      const observed = row.observed
      if (
        !observed ||
        typeof observed !== `object` ||
        !(`fields` in observed) ||
        !observed.fields
      )
        return row
      return {
        ...row,
        observed: readableMetadataInput(observed as MetadataInputSnapshot),
      }
    })
  return isDeepStrictEqual(
    stripDiagnostics([...actual].sort(byId)),
    stripDiagnostics([...expected].sort(byId)),
  )
    ? []
    : [`derived ordinary output differs from the callback-input law`]
}

declareOracle({
  model: [
    expectedSourceVirtualFields,
    expectedMetadataInput,
    expectedMetadataRecord,
  ],
  check: [metadataInputViolations, metadataOutputViolations],
  grammar: [
    metadataInputDescriptions,
    metadataCallbackHistories,
    metadataCallbackReceiverHistories,
    metadataInlineHistories,
  ],
})
