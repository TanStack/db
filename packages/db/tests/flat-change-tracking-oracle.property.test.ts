/**
 * # Does flat-row change tracking report what the draft proxy reports?
 *
 * Law and source: `collection.update` passes each row to the callback as a
 * draft and records the fields whose final value differs from the row, plus
 * deleted fields as `undefined` (`src/proxy.ts`). A row whose own fields are
 * all primitives or functions, with a plain or null prototype and no symbol
 * keys, is tracked with a shallow copy instead of a proxy. Both trackers must
 * report the same change set for every callback, and any other row must fall
 * back to the proxy.
 *
 * Why an example can miss the failure: a single assignment of a new value
 * passes any diff. The trackers can disagree only on equal-but-not-identical
 * values (`0` and `-0`, two `NaN`s), on a field set back to its original
 * value, on a field set to `undefined` versus deleted, on an added field, and
 * on an assigned object that later changes outside the callback.
 *
 * Model: `expectedChanges` folds the operations over a plain copy and keeps
 * fields whose final value differs under `===` or `Object.is`, plus deleted
 * fields. It does not import either tracker.
 *
 * History grammar: one to three rows with fields `a`, `b`, and `c` drawn from
 * `0`, `-0`, `1`, `NaN`, `''`, `'x'`, `true`, `false`, `null`, `undefined`, a
 * function, or missing, with a plain or null prototype. Each row gets up to
 * five operations: assign a field (`a` to `d`) a value from that domain or a
 * fresh object, set a field back to its original value, delete a field, or
 * read it. Histories call the tracker with an array or with a single row.
 *
 * Production driver: `withFlatChangeTracking` and the proxy trackers
 * `withArrayChangeTracking` and `withChangeTracking` run the same operations.
 *
 * Refinement check: the flat result, the proxy result, and the model are
 * strictly equal, including present `undefined` fields, except that `0` and
 * `-0` compare equal: collection equality does not distinguish them, and the
 * proxy skips writing a value equal to the current one. Mutating an assigned
 * object after the callback leaves both results unchanged.
 *
 * Calibration: a flat diff with `!==` reports unchanged `NaN` fields, one with
 * `Object.is` alone reports `-0` written over `0`, and one that skips
 * deletions loses removed fields; each fails the pinned histories and both
 * campaigns. The proxy used to treat a field added with `undefined` as
 * reverted when another field went back to its original value, and dropped
 * the added field; the pinned history for that case failed before the fix.
 *
 * Known omissions: nested objects, arrays, Dates, Maps, Sets, class
 * instances, and symbol keys are outside this owner; the proxy oracles and
 * contracts own them, and this file checks only that they fall back.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  withArrayChangeTracking,
  withChangeTracking,
  withFlatChangeTracking,
} from '../src/proxy.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from './oracle-config.js'

const property = `flat-change-tracking.equivalence`
const requestedReplayProperty = readOracleRunConfig().replayProperty

const MISSING = Symbol(`missing`)
const FRESH_OBJECT = Symbol(`fresh object`)
const fn = () => 1
const values: ReadonlyArray<unknown> = [
  0,
  -0,
  1,
  Number.NaN,
  ``,
  `x`,
  true,
  false,
  null,
  undefined,
  fn,
]
const fields = [`a`, `b`, `c`] as const
type Row = Record<string, unknown>
type Operation =
  | { kind: `set`; field: string; value: unknown }
  | { kind: `revert`; field: string }
  | { kind: `delete`; field: string }
  | { kind: `read`; field: string }
type History = {
  rows: Array<{ fields: Array<unknown>; nullPrototype: boolean }>
  operations: Array<Array<Operation>>
  single: boolean
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || Object.is(a, b)
}

function expectedChanges(original: Row, operations: Array<Operation>): Row {
  const draft: Row = { ...original }
  for (const operation of operations) applyOperation(draft, original, operation)
  const changes: Row = {}
  for (const key of Object.keys(draft)) {
    if (
      !Object.hasOwn(original, key) ||
      !sameValue(draft[key], original[key])
    ) {
      changes[key] = draft[key]
    }
  }
  for (const key of Object.keys(original)) {
    if (!Object.hasOwn(draft, key)) changes[key] = undefined
  }
  return changes
}

function applyOperation(draft: Row, original: Row, operation: Operation) {
  switch (operation.kind) {
    case `set`:
      draft[operation.field] =
        operation.value === FRESH_OBJECT ? { nested: 1 } : operation.value
      break
    case `revert`:
      if (Object.hasOwn(original, operation.field)) {
        draft[operation.field] = original[operation.field]
      }
      break
    case `delete`:
      delete draft[operation.field]
      break
    case `read`:
      void draft[operation.field]
      break
  }
}

// Collection equality does not distinguish -0 from 0.
function normalizeZeros(rows: Array<Row> | undefined) {
  return rows?.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === 0 ? 0 : value]),
    ),
  )
}

function buildRow({
  fields: fieldValues,
  nullPrototype,
}: History[`rows`][number]): Row {
  const row: Row = nullPrototype ? Object.create(null) : {}
  fieldValues.forEach((value, index) => {
    if (value !== MISSING) row[fields[index]!] = value
  })
  return row
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const fieldArbitrary = fc.constantFrom(`a`, `b`, `c`, `d`)
const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant(`set` as const),
      field: fieldArbitrary,
      value: fc.constantFrom(...values, FRESH_OBJECT),
    }),
  },
  fc.record({ kind: fc.constant(`revert` as const), field: fieldArbitrary }),
  fc.record({ kind: fc.constant(`delete` as const), field: fieldArbitrary }),
  fc.record({ kind: fc.constant(`read` as const), field: fieldArbitrary }),
)
const historyArbitrary: fc.Arbitrary<History> = fc
  .array(
    fc.record({
      fields: fc.tuple(
        ...fields.map(() => fc.constantFrom(...values, MISSING)),
      ),
      nullPrototype: fc.boolean(),
    }),
    { minLength: 1, maxLength: 3 },
  )
  .chain((rows) =>
    fc.record({
      rows: fc.constant(rows),
      operations: fc.tuple(
        ...rows.map(() => fc.array(operationArbitrary, { maxLength: 5 })),
      ),
      single: rows.length === 1 ? fc.boolean() : fc.constant(false),
    }),
  )

// Each history isolates one place a plausible flat diff goes wrong.
const pinnedHistories: ReadonlyArray<{ name: string; history: History }> = [
  {
    name: `NaN written over NaN is not a change`,
    history: {
      rows: [{ fields: [Number.NaN, 1, MISSING], nullPrototype: false }],
      operations: [[{ kind: `set`, field: `a`, value: Number.NaN }]],
      single: false,
    },
  },
  {
    name: `-0 written over 0 is not a change`,
    history: {
      rows: [{ fields: [0, 1, MISSING], nullPrototype: false }],
      operations: [[{ kind: `set`, field: `a`, value: -0 }]],
      single: true,
    },
  },
  {
    name: `a field added as undefined survives another field's revert`,
    history: {
      rows: [{ fields: [`x`, 1, MISSING], nullPrototype: false }],
      operations: [
        [
          { kind: `set`, field: `a`, value: `y` },
          { kind: `set`, field: `d`, value: undefined },
          { kind: `revert`, field: `a` },
        ],
      ],
      single: false,
    },
  },
  {
    name: `deleted, added, and reverted fields`,
    history: {
      rows: [{ fields: [1, `x`, true], nullPrototype: true }],
      operations: [
        [
          { kind: `delete`, field: `a` },
          { kind: `set`, field: `d`, value: undefined },
          { kind: `set`, field: `b`, value: `y` },
          { kind: `revert`, field: `b` },
        ],
      ],
      single: false,
    },
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

function runHistory(history: History): void {
  const originals = history.rows.map(buildRow)
  const run = (drafts: Array<Row> | Row) => {
    const list = Array.isArray(drafts) ? drafts : [drafts]
    list.forEach((draft, index) => {
      for (const operation of history.operations[index]!) {
        applyOperation(draft, originals[index]!, operation)
      }
    })
  }
  const flat = withFlatChangeTracking(
    history.rows.map(buildRow),
    run,
    !history.single,
  )
  expect(flat, `flat rows take the flat path`).toBeDefined()
  const proxy = history.single
    ? [withChangeTracking(buildRow(history.rows[0]!), run)]
    : withArrayChangeTracking(history.rows.map(buildRow), run)
  const model = originals.map((original, index) =>
    expectedChanges(original, history.operations[index]!),
  )
  expect(normalizeZeros(flat), `flat vs model`).toStrictEqual(
    normalizeZeros(model),
  )
  expect(normalizeZeros(proxy), `proxy vs model`).toStrictEqual(
    normalizeZeros(model),
  )
}

describe(`flat change tracking oracle`, () => {
  if (requestedReplayProperty === undefined) {
    for (const { name, history } of pinnedHistories) {
      it(`matches the draft proxy when ${name}`, () => runHistory(history))
    }

    it(`falls back to the proxy for rows that are not flat`, () => {
      const callback = () => {}
      for (const row of [
        { a: { nested: 1 } },
        { a: [1] },
        { a: new Date(0) },
        { [Symbol(`s`)]: 1 },
        new (class Row {
          a = 1
        })(),
      ]) {
        expect(withFlatChangeTracking([row], callback, true)).toBeUndefined()
      }
    })

    it(`detaches an assigned object from later mutation`, () => {
      const assigned = { nested: 1 }
      const [changes] = withFlatChangeTracking(
        [{ a: 1 }],
        (drafts) => {
          ;(drafts as Array<Row>)[0]!.a = assigned
        },
        true,
      )!
      assigned.nested = 2
      expect(changes).toStrictEqual({ a: { nested: 1 } })
    })

    fcTest.prop([historyArbitrary], {
      seed: 44_502_101,
      numRuns: oracleRuns(200),
    })(`matches the draft proxy (fixed)`, runHistory)
    fcTest.prop([historyArbitrary], oraclePropertyOptions(200, property))(
      `matches the draft proxy (random)`,
      runHistory,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop([historyArbitrary], oraclePropertyOptions(200, property))(
      `matches the draft proxy (replay)`,
      runHistory,
    )
  } else {
    it.skip(`runs only when its replay property is selected`, () => {})
  }
})
