// Checker calibrations for the Effect virtual-field oracle in
// virtual-row-fields-effect-oracle.test.ts. They run no production: each
// feeds a hand-built callback ledger to the oracle's delta check, which must
// reject a hostile ledger and accept the implementation freedom that the
// allowed controls preserve.
import { expect, test } from 'vitest'
import {
  captureEvent,
  checkEffectDelta,
  expectedEffectDelta,
  expectedEffectRows,
  occurrence,
} from './virtual-row-fields-effect-model-oracle.js'
import type { DeltaEvent } from '../../src/query/effect.js'
import type {
  Key,
  KeyIntervals,
  Ledger,
  ModelEvent,
  ProjectedRow,
  SourceRow,
} from './virtual-row-fields-effect-model-oracle.js'

// The same delta judgment must reject wrong callback histories even when their
// final row is right. Controls seed active key intervals through initial enter
// delivery, so failures reach the update comparison rather than setup.
const effectFaults = [
  `omitted-peer`,
  `duplicate-message`,
  `duplicate-batch`,
  `stale-pending`,
  `wrong-source`,
  `new-previous-value`,
  `extra-undefined`,
  `wrong-route`,
  `missing-named`,
  `delayed-extra`,
  `key-collision`,
  `key-change`,
] as const

// Allowed controls preserve implementation freedom: row order and opaque key
// representation do not define metadata, and an exited interval owns no key.
function calibrationRows(pending: boolean): Array<ProjectedRow> {
  const base: Array<SourceRow> = [
    { id: 1, side: `left`, parentId: `unused`, label: `base` },
    { id: `1`, side: `left`, parentId: `unused`, label: `peer` },
  ]
  return expectedEffectRows(
    `single`,
    {
      id: `source`,
      base,
      origins: new Map(),
      ...(pending ? { overlay: { ...base[0]!, label: `pending` } } : {}),
    },
    { id: `unused`, base: [], origins: new Map() },
  )
}
function calibrationLedger(
  delta: ReadonlyArray<ModelEvent>,
  keyFor: (value: ProjectedRow) => Key,
): Ledger {
  const batch = delta.map((event) => ({
    ...structuredClone(event),
    key: keyFor(event.value),
  }))
  return {
    batches: batch.length ? [batch.reverse()] : [],
    named: batch.map((event) => ({
      ...structuredClone(event),
      route: event.type,
    })),
  }
}

test.each(effectFaults)(
  `rejects a hostile Effect metadata ledger: %s`,
  (fault) => {
    const row = (id: Key, pending: boolean): ProjectedRow => ({
      id,
      side: `left`,
      label: pending ? `pending` : `base`,
      observedKey: id,
      observedCollectionId: `source`,
      observedOrigin: pending ? `local` : `remote`,
      observedPending: pending,
    })
    const before = [row(1, false), row(`1`, false)]
    const after = [row(1, true), row(`1`, true)]
    const events = (expected: Array<ModelEvent>, prefix: string): Ledger => {
      const batch = expected.map((event) => ({
        ...structuredClone(event),
        key: `${prefix}/${occurrence(event.value)}`,
      }))
      return {
        batches: [batch],
        named: batch.map((event) => ({
          ...structuredClone(event),
          route: event.type,
        })),
      }
    }
    const active: KeyIntervals = new Map()
    checkEffectDelta(
      events(expectedEffectDelta([], before), `opaque`),
      expectedEffectDelta([], before),
      active,
    )
    const expected = expectedEffectDelta(before, after)
    const allowed = events(expected, `opaque`)
    checkEffectDelta(structuredClone(allowed), expected, new Map(active))
    const hostile = structuredClone(allowed)
    const first = hostile.batches[0]![0]!
    const second = hostile.batches[0]![1]!
    if (fault === `omitted-peer`) hostile.batches[0]!.pop()
    if (fault === `duplicate-message`)
      hostile.batches[0]!.push(structuredClone(first))
    if (fault === `duplicate-batch`)
      hostile.batches.push(structuredClone(hostile.batches[0]!))
    if (fault === `stale-pending`)
      (first.value as Record<string, unknown>).observedPending = false
    if (fault === `wrong-source`)
      (first.value as Record<string, unknown>).observedCollectionId =
        `other-source`
    if (fault === `new-previous-value`)
      first.previousValue = structuredClone(first.value)
    if (fault === `extra-undefined`)
      (first.value as Record<string, unknown>).extra = undefined
    if (fault === `wrong-route`) hostile.named[0]!.route = `enter`
    if (fault === `missing-named`) hostile.named.pop()
    if (fault === `delayed-extra`)
      hostile.batches.push([structuredClone(first)])
    // Both channels agree on each bad key, so only interval continuity can
    // reject these faults; cross-channel agreement cannot mask its removal.
    if (fault === `key-collision`) {
      second.key = first.key
      hostile.named[1]!.key = second.key
    }
    if (fault === `key-change`) {
      first.key = `different-opaque-key`
      hostile.named[0]!.key = first.key
    }
    expect(() => checkEffectDelta(hostile, expected, new Map(active))).toThrow()
  },
)

test(`permits reordered delivery and fresh opaque keys after an exit`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const active: KeyIntervals = new Map()
  const oldKey = (row: ProjectedRow) => `arbitrary/${occurrence(row)}`
  const initial = expectedEffectDelta([], before)
  checkEffectDelta(calibrationLedger(initial, oldKey), initial, active)
  const update = expectedEffectDelta(before, after)
  checkEffectDelta(calibrationLedger(update, oldKey), update, active)
  const remaining = [after[0]!]
  const exit = expectedEffectDelta(after, remaining)
  checkEffectDelta(calibrationLedger(exit, oldKey), exit, active)
  const reentry = expectedEffectDelta(remaining, after)
  checkEffectDelta(
    calibrationLedger(reentry, (row) => `fresh/${occurrence(row)}`),
    reentry,
    active,
  )
  const next = [before[0]!, after[1]!]
  const survivor = expectedEffectDelta(after, next)
  checkEffectDelta(calibrationLedger(survivor, oldKey), survivor, active)
})

test(`permits empty callback partitions while preserving exact delta events`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const active: KeyIntervals = new Map()
  const keyFor = (row: ProjectedRow) => occurrence(row)
  for (const delta of [
    expectedEffectDelta([], before),
    expectedEffectDelta(before, after),
    expectedEffectDelta(after, after),
  ]) {
    const ledger = calibrationLedger(delta, keyFor)
    ledger.batches.unshift([])
    ledger.batches.push([])
    checkEffectDelta(ledger, delta, active)
  }
})

test(`records scalar callback values before later object mutation`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const keyFor = (row: ProjectedRow) => occurrence(row)
  const active: KeyIntervals = new Map()
  const initial = expectedEffectDelta([], before)
  checkEffectDelta(calibrationLedger(initial, keyFor), initial, active)
  const expected = expectedEffectDelta(before, after)
  const row = structuredClone(expected[0]!.value)
  const previousValue = structuredClone(expected[0]!.previousValue!)
  const event: DeltaEvent = {
    type: `update`,
    key: keyFor(row),
    value: row,
    previousValue,
  }
  const ledger: Ledger = {
    batches: [[captureEvent(event)]],
    named: [{ route: `update`, ...captureEvent(event) }],
  }
  row.observedPending = false
  previousValue.label = `mutated after delivery`
  checkEffectDelta(ledger, expected, active)
})

test(`preserves later interval judgments after an invalid unknown update`, () => {
  const before = calibrationRows(false)
  const after = calibrationRows(true)
  const keyFor = (row: ProjectedRow) => occurrence(row)
  const active: KeyIntervals = new Map()
  const initial = expectedEffectDelta([], before)
  const ledger = calibrationLedger(initial, keyFor)
  const invalid = {
    type: `update`,
    key: `never-entered`,
    value: structuredClone(before[0]!),
    previousValue: structuredClone(before[0]!),
  }
  ledger.batches[0]!.unshift(invalid)
  ledger.named.unshift({ ...structuredClone(invalid), route: `update` })
  expect(() => checkEffectDelta(ledger, initial, active)).toThrow()
  const update = expectedEffectDelta(before, after)
  checkEffectDelta(calibrationLedger(update, keyFor), update, active)
})
