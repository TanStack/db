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
 * value, on a field set to `undefined` versus deleted, on an added field, on
 * an assigned object that later changes outside the callback, and on the
 * shapes a shallow copy treats differently from a proxy: a frozen row, a
 * non-enumerable field, a property defined in the callback, another row's
 * draft stored in a field, and a callback that throws.
 *
 * Model: `expectedChanges` folds every row's operations, in callback order,
 * over plain copies of the rows. It keeps enumerable fields whose final value
 * differs under `===` or `Object.is` from the row's own field, or, for the
 * object a non-enumerable field holds, by contents; plus deleted enumerable
 * fields. A copy holds no non-enumerable field, so reading one gives
 * `undefined`, deleting one does nothing, and writing one is a change unless
 * it writes the row's value. Defining a field acts as assigning it: an
 * enumerable accessor reports the value it reads. A stored draft is the model's copy, read
 * when the callback returns. It does not import either tracker. When the
 * callback throws, or a plain object rejects one of its operations, both
 * trackers must throw the same error and leave the rows unchanged.
 *
 * History grammar: one to three rows with fields `a`, `b`, and `c` drawn from
 * `0`, `-0`, `1`, `NaN`, `''`, `'x'`, `true`, `false`, `null`, `undefined`, a
 * function, or missing, with a plain or null prototype, optionally frozen,
 * and optionally with a non-enumerable field `h` holding a domain value or an
 * object. Each
 * row gets up to six operations: assign a field (`a` to `d`, or `h`) a value
 * from that domain or a fresh object, assign `d` `undefined`, set a field
 * back to its original value, delete a field, read it, define it with
 * `Object.defineProperty` as an enumerable or non-enumerable data or accessor
 * property,
 * or store a row's draft in it. A weighted run changes a field, adds `d` as
 * `undefined`, and reverts the field; others write and delete `h`, write an
 * equal object over an object `h`, or define a getter and assign it its own value; and one writes the
 * opposite-signed zero over each zero field. Histories call the tracker with an
 * array or with a single row, and may throw after any operation.
 *
 * Production driver: `withFlatChangeTracking` and the proxy trackers
 * `withArrayChangeTracking` and `withChangeTracking` run the same operations.
 *
 * Refinement check: the flat result, the proxy result, and the model are
 * strictly equal, including present `undefined` fields and the cycles a
 * stored draft creates, except that `0` and `-0` compare equal and
 * prototypes are ignored: collection equality does not distinguish them, and
 * the proxy skips writing a value equal to the current one. Mutating an
 * assigned object after the callback leaves both results unchanged.
 *
 * Calibration: a flat diff with `!==` reports unchanged `NaN` fields, one with
 * `Object.is` alone reports `-0` written over `0`, one that skips deletions
 * loses removed fields, one that ignores whether the row owns a field drops
 * added `undefined` fields, and one that edits rows in place breaks the throw
 * and stored-draft histories; each fails a pinned history and the fixed
 * campaign. The proxy used to treat a field added with `undefined` as
 * reverted when another field went back to its original value, and dropped
 * the added field; the pinned history and both campaigns fail without the
 * fix, because the grammar weights that run.
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
  | { kind: `define`; field: string; value: unknown; enumerable: boolean }
  | {
      kind: `define-getter`
      field: string
      value: unknown
      enumerable: boolean
    }
  | { kind: `store-draft`; field: string; row: number }
  // Writes the opposite-signed zero over every field the row holds as a zero.
  | { kind: `flip-zeros` }
type RowShape = {
  fields: Array<unknown>
  nullPrototype: boolean
  frozen: boolean
  hidden: unknown
}
type History = {
  rows: Array<RowShape>
  operations: Array<Array<Operation>>
  single: boolean
  // The callback throws after this many operations, counted across rows.
  throwAfter: number | undefined
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || Object.is(a, b)
}

// Only a non-enumerable field holds an object, always `{ nested: 1 }`; an
// equal object written over it is not a change.
function sameContents(a: unknown, b: unknown): boolean {
  if (sameValue(a, b)) return true
  if (
    a === null ||
    b === null ||
    typeof a !== `object` ||
    typeof b !== `object`
  )
    return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) && sameValue((a as Row)[key], (b as Row)[key]),
    )
  )
}

function expectedChanges(
  originals: Array<Row>,
  operations: Array<Array<Operation>>,
): Array<Row> {
  const drafts: Array<Row> = originals.map((original) => ({ ...original }))
  drafts.forEach((draft, index) => {
    for (const operation of operations[index]!) {
      applyOperation(draft, originals[index]!, operation, drafts)
    }
  })
  return drafts.map((draft, index) => {
    const original = originals[index]!
    const changes: Row = {}
    for (const key of Object.keys(draft)) {
      if (
        !Object.hasOwn(original, key) ||
        !sameContents(draft[key], original[key])
      ) {
        changes[key] = draft[key]
      }
    }
    for (const key of Object.keys(original)) {
      if (!Object.hasOwn(draft, key)) changes[key] = undefined
    }
    return changes
  })
}

const domainValue = (value: unknown) =>
  value === FRESH_OBJECT ? { nested: 1 } : value

// Shared by the model and the driver; `drafts` are the callback's drafts.
function applyOperation(
  draft: Row,
  original: Row,
  operation: Operation,
  drafts: Array<Row>,
) {
  switch (operation.kind) {
    case `set`:
      draft[operation.field] = domainValue(operation.value)
      break
    case `define`:
      Object.defineProperty(draft, operation.field, {
        value: domainValue(operation.value),
        enumerable: operation.enumerable,
        writable: true,
        configurable: true,
      })
      break
    case `define-getter`: {
      const value = domainValue(operation.value)
      Object.defineProperty(draft, operation.field, {
        get: () => value,
        enumerable: operation.enumerable,
        configurable: true,
      })
      break
    }
    case `flip-zeros`:
      for (const key of Object.keys(original)) {
        if (original[key] === 0) {
          draft[key] = Object.is(original[key], 0) ? -0 : 0
        }
      }
      break
    case `store-draft`:
      draft[operation.field] = drafts[operation.row % drafts.length]
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

// Collection equality does not distinguish -0 from 0 or prototypes. A
// stored draft can make a change set cyclic, so the copy keeps cycles.
function normalize(value: unknown, copies = new Map<object, Row>()): unknown {
  if (value === 0) return 0
  if (value === null || typeof value !== `object`) return value
  const existing = copies.get(value)
  if (existing) return existing
  const copy: Row = {}
  copies.set(value, copy)
  for (const [key, field] of Object.entries(value)) {
    copy[key] = normalize(field, copies)
  }
  return copy
}

function buildRow(shape: RowShape): Row {
  const row: Row = shape.nullPrototype ? Object.create(null) : {}
  shape.fields.forEach((value, index) => {
    if (value !== MISSING) row[fields[index]!] = value
  })
  if (shape.hidden !== MISSING) {
    Object.defineProperty(row, `h`, {
      value: domainValue(shape.hidden),
      enumerable: false,
      writable: true,
      configurable: true,
    })
  }
  return shape.frozen ? Object.freeze(row) : row
}

// Captures a row's own properties, including non-enumerable ones.
const rowState = (row: Row) => Object.getOwnPropertyDescriptors(row)

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const fieldArbitrary = fc.constantFrom(`a`, `b`, `c`, `d`, `h`)
const valueArbitrary = fc.constantFrom(...values, FRESH_OBJECT)
const operationArbitrary: fc.Arbitrary<Operation> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant(`set` as const),
      field: fieldArbitrary,
      value: valueArbitrary,
    }),
  },
  fc.constant<Operation>({ kind: `set`, field: `d`, value: undefined }),
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant(`revert` as const),
      field: fieldArbitrary,
    }),
  },
  fc.record({ kind: fc.constant(`delete` as const), field: fieldArbitrary }),
  fc.record({ kind: fc.constant(`read` as const), field: fieldArbitrary }),
  fc.record({
    kind: fc.constant(`define` as const),
    field: fieldArbitrary,
    value: valueArbitrary,
    enumerable: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant(`define-getter` as const),
    field: fieldArbitrary,
    value: valueArbitrary,
    enumerable: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant(`store-draft` as const),
    field: fieldArbitrary,
    row: fc.nat({ max: 2 }),
  }),
)
// An added `undefined` while another field changes and reverts is where the
// proxy once dropped the added field, so the grammar also emits that run.
const excursionArbitrary: fc.Arbitrary<Array<Operation>> = fc
  .tuple(fc.constantFrom(...fields), valueArbitrary)
  .map(([field, value]) => [
    { kind: `set`, field, value },
    { kind: `set`, field: `d`, value: undefined },
    { kind: `revert`, field },
  ])
// Runs that reach the descriptor laws, each of which a single operation
// rarely forms: a hidden field written then deleted, an equal object written
// over a hidden object field, and a getter-only field assigned its own value.
const descriptorRunArbitrary: fc.Arbitrary<Array<Operation>> = fc.oneof(
  valueArbitrary.map((value): Array<Operation> => [
    { kind: `set`, field: `h`, value },
    { kind: `delete`, field: `h` },
  ]),
  fc.constant<Array<Operation>>([
    { kind: `set`, field: `h`, value: FRESH_OBJECT },
  ]),
  fc
    .tuple(fc.constantFrom(...fields), valueArbitrary, fc.boolean())
    .map(([field, value, enumerable]): Array<Operation> => [
      { kind: `define-getter`, field, value, enumerable },
      { kind: `set`, field, value },
    ]),
)
const operationsArbitrary: fc.Arbitrary<Array<Operation>> = fc
  .array(
    fc.oneof(
      {
        weight: 4,
        arbitrary: operationArbitrary.map((operation) => [operation]),
      },
      excursionArbitrary,
      descriptorRunArbitrary,
      // A field drawn as a zero rarely gets the other zero by chance.
      fc.constant<Array<Operation>>([{ kind: `flip-zeros` }]),
    ),
    { maxLength: 5 },
  )
  .map((chunks) => chunks.flat().slice(0, maxOperations))
const maxOperations = 6

const rowArbitrary: fc.Arbitrary<RowShape> = fc.record({
  fields: fc.tuple(...fields.map(() => fc.constantFrom(...values, MISSING))),
  nullPrototype: fc.boolean(),
  frozen: fc.boolean(),
  hidden: fc.oneof(
    { weight: 2, arbitrary: fc.constant(MISSING) },
    fc.constant(FRESH_OBJECT),
    fc.constantFrom(...values),
  ),
})
const historyArbitrary: fc.Arbitrary<History> = fc
  .array(rowArbitrary, { minLength: 1, maxLength: 3 })
  .chain((rows) =>
    fc.record({
      rows: fc.constant(rows),
      operations: fc.tuple(...rows.map(() => operationsArbitrary)),
      single: rows.length === 1 ? fc.boolean() : fc.constant(false),
      throwAfter: fc.oneof(
        { weight: 5, arbitrary: fc.constant(undefined) },
        fc.nat({ max: maxOperations }),
      ),
    }),
  )

const plainRow = (rowFields: Array<unknown>, nullPrototype = false) => ({
  fields: rowFields,
  nullPrototype,
  frozen: false,
  hidden: MISSING,
})

const firstDraft = (draft: Array<Row> | Row) =>
  Array.isArray(draft) ? draft[0]! : draft
// Each witness pins a shape the trackers once disagreed on to the change
// set both must now report: defining a field acts as assigning it, and a
// non-enumerable field is not row data unless the callback writes it.
const descriptorLaws: ReadonlyArray<{
  name: string
  shape: RowShape
  callback: (draft: Array<Row> | Row) => void
  expected: Row
}> = [
  {
    name: `an enumerable accessor defined in the callback reports its value`,
    shape: plainRow([1, MISSING, MISSING]),
    callback: (draft) => {
      Object.defineProperty(firstDraft(draft), `g`, {
        get: () => 7,
        enumerable: true,
        configurable: true,
      })
    },
    expected: { g: 7 },
  },
  {
    name: `defining a field with its own value is not a change`,
    shape: plainRow([1, MISSING, MISSING]),
    callback: (draft) => {
      Object.defineProperty(firstDraft(draft), `a`, {
        value: 1,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    },
    expected: {},
  },
  {
    name: `an equal object written to a non-enumerable object field is not a change`,
    shape: { ...plainRow([1, MISSING, MISSING]), hidden: FRESH_OBJECT },
    callback: (draft) => {
      firstDraft(draft).h = { nested: 1 }
    },
    expected: {},
  },
  {
    name: `a non-enumerable field written and then deleted is not a change`,
    shape: { ...plainRow([1, MISSING, MISSING]), hidden: `x` },
    callback: (draft) => {
      firstDraft(draft).h = `y`
      delete firstDraft(draft).h
    },
    expected: {},
  },
]

// Each history isolates one place a plausible flat diff goes wrong.
const pinnedHistories: ReadonlyArray<{ name: string; history: History }> = [
  {
    name: `a changed field defined back to its own value is not a change`,
    history: {
      rows: [plainRow([1, `x`, MISSING])],
      operations: [
        [
          { kind: `set`, field: `a`, value: 0 },
          { kind: `define`, field: `a`, value: 1, enumerable: true },
        ],
      ],
      single: true,
      throwAfter: undefined,
    },
  },
  {
    name: `assigning a getter-only field its own value throws`,
    history: {
      rows: [plainRow([1, MISSING, MISSING])],
      operations: [
        [
          { kind: `define-getter`, field: `a`, value: 2, enumerable: true },
          { kind: `set`, field: `a`, value: 2 },
        ],
      ],
      single: false,
      throwAfter: undefined,
    },
  },
  {
    name: `NaN written over NaN is not a change`,
    history: {
      rows: [plainRow([Number.NaN, 1, MISSING])],
      operations: [[{ kind: `set`, field: `a`, value: Number.NaN }]],
      single: false,
      throwAfter: undefined,
    },
  },
  {
    name: `-0 written over 0 is not a change`,
    history: {
      rows: [plainRow([0, 1, MISSING])],
      operations: [[{ kind: `set`, field: `a`, value: -0 }]],
      single: true,
      throwAfter: undefined,
    },
  },
  {
    name: `a field added as undefined survives another field's revert`,
    history: {
      rows: [plainRow([`x`, 1, MISSING])],
      operations: [
        [
          { kind: `set`, field: `a`, value: `y` },
          { kind: `set`, field: `d`, value: undefined },
          { kind: `revert`, field: `a` },
        ],
      ],
      single: false,
      throwAfter: undefined,
    },
  },
  {
    name: `deleted, added, and reverted fields`,
    history: {
      rows: [plainRow([1, `x`, true], true)],
      operations: [
        [
          { kind: `delete`, field: `a` },
          { kind: `set`, field: `d`, value: undefined },
          { kind: `set`, field: `b`, value: `y` },
          { kind: `revert`, field: `b` },
        ],
      ],
      single: false,
      throwAfter: undefined,
    },
  },
  {
    name: `a frozen row with a hidden field is written, defined, and deleted`,
    history: {
      rows: [
        {
          fields: [1, 2, MISSING],
          nullPrototype: false,
          frozen: true,
          hidden: 5,
        },
      ],
      operations: [
        [
          { kind: `set`, field: `a`, value: 3 },
          { kind: `define`, field: `c`, value: `x`, enumerable: true },
          { kind: `define`, field: `d`, value: 1, enumerable: false },
          { kind: `set`, field: `h`, value: 6 },
          { kind: `delete`, field: `b` },
        ],
      ],
      single: true,
      throwAfter: undefined,
    },
  },
  {
    name: `rows store each other's drafts`,
    history: {
      rows: [plainRow([1, 2, MISSING]), plainRow([3, 4, MISSING])],
      operations: [
        [
          { kind: `store-draft`, field: `d`, row: 1 },
          { kind: `store-draft`, field: `c`, row: 0 },
        ],
        [
          { kind: `store-draft`, field: `d`, row: 0 },
          { kind: `delete`, field: `b` },
        ],
      ],
      single: false,
      throwAfter: undefined,
    },
  },
  {
    name: `the callback throws after writing`,
    history: {
      rows: [plainRow([1, 2, MISSING]), plainRow([3, 4, MISSING])],
      operations: [
        [
          { kind: `set`, field: `a`, value: 5 },
          { kind: `delete`, field: `b` },
        ],
        [{ kind: `set`, field: `d`, value: 1 }],
      ],
      single: false,
      throwAfter: 2,
    },
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

class CallbackError extends Error {}

function runHistory(history: History): void {
  const originals = history.rows.map(buildRow)
  // A revert reads the row the tracker was given.
  const run = (rows: Array<Row>) => (drafts: Array<Row> | Row) => {
    const list = Array.isArray(drafts) ? drafts : [drafts]
    let applied = 0
    list.forEach((draft, index) => {
      for (const operation of history.operations[index]!) {
        if (applied++ === history.throwAfter) throw new CallbackError()
        applyOperation(draft, rows[index]!, operation, list)
      }
    })
    if (applied === history.throwAfter) throw new CallbackError()
  }
  const flatRows = history.rows.map(buildRow)
  const proxyRows = history.rows.map(buildRow)
  const track = {
    flat: () =>
      withFlatChangeTracking(flatRows, run(flatRows), !history.single),
    proxy: () =>
      history.single
        ? [withChangeTracking(proxyRows[0]!, run(proxyRows))]
        : withArrayChangeTracking(proxyRows, run(proxyRows)),
  }
  // A plain object rejects some callbacks itself, such as assigning a field
  // the callback gave only a getter; the trackers must reject them too.
  let model: Array<Row> | undefined
  let modelRejects = false
  try {
    model = expectedChanges(originals, history.operations)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    modelRejects = true
  }
  const throws =
    modelRejects ||
    (history.throwAfter !== undefined &&
      history.throwAfter <= history.operations.flat().length)
  if (throws) {
    const errors = [track.flat, track.proxy].map((tracker) => {
      try {
        tracker()
      } catch (error) {
        return (error as Error).constructor
      }
      return undefined
    })
    expect(errors[0], `flat rethrows`).toBeOneOf([CallbackError, TypeError])
    expect(errors[1], `proxy throws the same error`).toBe(errors[0])
    for (const rows of [flatRows, proxyRows]) {
      expect(rows.map(rowState), `rows unchanged`).toStrictEqual(
        originals.map(rowState),
      )
    }
    return
  }
  const flat = track.flat()
  expect(flat, `flat rows take the flat path`).toBeDefined()
  const proxy = track.proxy()
  expect(normalize(flat), `flat vs model`).toStrictEqual(normalize(model))
  expect(normalize(proxy), `proxy vs model`).toStrictEqual(normalize(model))
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
        // A getter can return a new value on each read, so only the proxy,
        // which reads it once, reports a stable change set.
        Object.defineProperty({}, `a`, { get: () => 1, enumerable: true }),
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

    for (const { name, shape, callback, expected } of descriptorLaws) {
      it(`reports the same change set when ${name}`, () => {
        expect(
          withFlatChangeTracking([buildRow(shape)], callback, false),
          `flat`,
        ).toStrictEqual([expected])
        expect(
          withChangeTracking(buildRow(shape), callback),
          `proxy`,
        ).toStrictEqual(expected)
      })
    }

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
