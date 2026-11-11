import { isDeepStrictEqual } from 'node:util'
import { expect } from 'vitest'
import { expectedSourceMetadata } from './virtual-row-fields-source-oracle.js'
import { virtualFieldNames } from './virtual-row-fields-support.js'
import type { DeltaEvent } from '../../src/query/effect.js'

// The source, row, event, and ledger model of the Effect virtual-field oracle
// and its delta check, moved here unchanged from
// virtual-row-fields-effect-oracle.test.ts. The oracle compares production
// Effects with them; the ordinary checker calibrations in
// virtual-row-fields-effect.test.ts feed them hand-built ledgers. This module
// registers no tests.

export type Key = string | number
export type Side = `left` | `right`
export type Origin = `local` | `remote`
export type SourceRow = {
  id: Key
  parentId: string
  side: Side
  label: string
}
export type SourceState = {
  id: string
  base: Array<SourceRow>
  origins: Map<Key, Origin>
  overlay?: SourceRow
  confirmation?: SourceRow
}
export type Projection = `structured` | `functional`
export type Kind = `single` | `join` | `union`
export type History = {
  kind: Kind
  projection: Projection
  reverse: boolean
  confirm: ReadonlyArray<Side>
  reject: ReadonlyArray<Side>
  rightFirst: boolean
}
export type ProjectedRow = Record<string, unknown> & { id: Key; side: Side }
export type ModelEvent = {
  type: `enter` | `update` | `exit`
  value: ProjectedRow
  previousValue?: ProjectedRow
}
export type RecordedEvent = {
  type: string
  key: Key
  value: unknown
  previousValue?: unknown
}
export type NamedEvent = RecordedEvent & { route: ModelEvent[`type`] }
export type Ledger = {
  batches: Array<Array<RecordedEvent>>
  named: Array<NamedEvent>
}
export type KeyIntervals = Map<string, Key>

export function visibleSource(source: SourceState) {
  return source.base.map((base) => {
    const pending = source.overlay?.id === base.id
    const row = pending ? source.overlay! : base
    return {
      ...row,
      ...expectedSourceMetadata(
        row.id,
        source.id,
        pending,
        source.origins.get(row.id) ?? `remote`,
      ),
    }
  })
}
export type SourceValue = ReturnType<typeof visibleSource>[number]

// SELECT copies these source facts into ordinary fields. New output objects
// need no root metadata judgment to determine their explicitly selected values.
export function projectedSource(row: SourceValue): ProjectedRow {
  return {
    id: row.id,
    side: row.side,
    label: row.label,
    observedKey: row.$key,
    observedCollectionId: row.$collectionId,
    observedOrigin: row.$origin,
    observedPending: row.$hasPendingWrites,
  }
}
export function expectedEffectRows(
  kind: Kind,
  left: SourceState,
  right: SourceState,
): Array<ProjectedRow> {
  const a = visibleSource(left)
  const b = visibleSource(right)
  if (kind === `single`) return a.map(projectedSource)
  if (kind === `union`) return [...a, ...b].map(projectedSource)
  return a.map((row) => {
    const joined = b.find((candidate) => candidate.parentId === row.id)
    return {
      ...projectedSource(row),
      rightLabel: joined?.label,
      rightKey: joined?.$key,
      rightCollectionId: joined?.$collectionId,
      rightOrigin: joined?.$origin,
      rightPending: joined?.$hasPendingWrites,
    }
  })
}
export function occurrence(value: unknown): string {
  if (!value || typeof value !== `object`) return `invalid:${String(value)}`
  const row = value as Record<string, unknown>
  return `${String(row.side)}:${typeof row.id}:${String(row.id)}`
}
// Independent before/after differencing retains every occurrence. Equality
// distinguishes a missing own field from a field whose value is undefined.
export function expectedEffectDelta(
  before: ReadonlyArray<ProjectedRow>,
  after: ReadonlyArray<ProjectedRow>,
): Array<ModelEvent> {
  const delta: Array<ModelEvent> = []
  for (const old of before) {
    if (!after.some((row) => occurrence(row) === occurrence(old)))
      delta.push({ type: `exit`, value: old })
  }
  for (const row of after) {
    const old = before.find((prior) => occurrence(prior) === occurrence(row))
    if (!old) delta.push({ type: `enter`, value: row })
    else if (!isDeepStrictEqual(old, row))
      delta.push({ type: `update`, value: row, previousValue: old })
  }
  return delta
}
export function eventOrder(
  a: { value: unknown },
  b: { value: unknown },
): number {
  return occurrence(a.value).localeCompare(occurrence(b.value))
}
export function eventValue(event: RecordedEvent) {
  const { key: _key, ...selected } = event
  return selected
}
// Named delivery and batch delivery each refine the independent full delta.
// Cross-channel agreement alone would allow both channels to share a defect.
export function checkEffectDelta(
  ledger: Ledger,
  expected: ReadonlyArray<ModelEvent>,
  active: KeyIntervals,
): void {
  const batches = ledger.batches.flat()
  const failures: Array<Error> = []
  const judge = (law: string, compare: () => void) => {
    try {
      compare()
    } catch (error) {
      failures.push(new Error(law, { cause: error }))
    }
  }
  judge(`batch delta and previous values`, () => {
    expect(batches.map(eventValue).sort(eventOrder)).toStrictEqual(
      [...expected].sort(eventOrder),
    )
  })
  judge(`named delta, route and previous values`, () => {
    expect(ledger.named.map(eventValue).sort(eventOrder)).toStrictEqual(
      expected
        .map((event) => ({ ...event, route: event.type }))
        .sort(eventOrder),
    )
  })
  judge(`named and batch event keys agree`, () => {
    expect(
      ledger.named.map(({ route: _route, ...event }) => event).sort(eventOrder),
    ).toStrictEqual([...batches].sort(eventOrder))
  })

  // Report an invalid event without adopting it as a live occurrence. Later
  // lawful enters in the same batch can still establish their own intervals.
  for (const event of batches) {
    const id = occurrence(event.value)
    judge(`opaque key interval for ${event.type} ${id}`, () => {
      expect([`string`, `number`]).toContain(typeof event.key)
      if (event.type === `enter`) {
        expect(active.has(id), `enter starts an absent occurrence`).toBe(false)
        expect(
          [...active.values()],
          `live occurrence keys are distinct`,
        ).not.toContain(event.key)
        active.set(id, event.key)
      } else {
        expect(active.has(id), `update/exit names a live occurrence`).toBe(true)
        expect(event.key, `key remains stable within its active interval`).toBe(
          active.get(id),
        )
        if (event.type === `exit`) active.delete(id)
      }
    })
  }
  if (failures.length)
    throw new AggregateError(failures, `Effect delta law failed`, {
      cause: failures[0],
    })
}

// One source has two outcomes and two confirmation states. Two sources have
// four independent outcomes, four confirmation masks and two settlement orders.
// Only unions vary branch order: it has observable source-selection machinery.

export function captureSelected(value: unknown): unknown {
  if (!value || typeof value !== `object`) return value
  return Object.fromEntries(
    Object.entries(value).filter(
      ([name]) => !virtualFieldNames.some((field) => field === name),
    ),
  )
}
export function captureEvent(event: DeltaEvent): RecordedEvent {
  return {
    type: event.type,
    key: event.key,
    value: captureSelected(event.value),
    ...(`previousValue` in event
      ? { previousValue: captureSelected(event.previousValue) }
      : {}),
  }
}
// Driver projection: runtime source objects, not model source snapshots.
