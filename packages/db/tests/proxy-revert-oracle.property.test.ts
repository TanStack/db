import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createChangeProxy } from '../src/proxy'

/**
 * # Which draft writes count as changes, and which count as reverts?
 *
 * A draft records the changes a callback makes to a row. A write that makes a
 * value structurally equal to its original again is a revert, and a fully
 * reverted draft reports no change. `getChanges()` returns:
 *
 * - `{}` when every value equals its original;
 * - otherwise each own enumerable string key whose final value differs from
 *   its original, with that final value, and each deleted key as `undefined`.
 *
 * "Equal" here is draft equality, which is stricter than `deepEquals`:
 *
 * 1. Primitives compare by value. `-0` equals `0`, and `NaN` equals `NaN`.
 * 2. Dates compare by timestamp. Invalid dates are equal.
 * 3. Regular expressions compare by source, flags, and `lastIndex`.
 * 4. Maps and Sets compare by entries or values in insertion order.
 * 5. Arrays compare by length and present indexes, so a hole differs from
 *    `undefined`.
 * 6. Plain objects compare by enumerable own string and symbol keys, in any
 *    order.
 *
 * Laws checked after every generated history:
 *
 * - `getChanges()` equals the model's changes.
 * - Reading the draft gives the model's final value.
 * - The original row is unchanged.
 *
 * Authority: the `createChangeProxy` and `getChanges` implementation comments
 * in `src/proxy.ts` and the revert examples in `tests/proxy.test.ts`, as of
 * `18abceee`.
 *
 * Limits:
 * - Writes are assignments, deletes, nested property writes, and nested writes
 *   through `for...of` on an array. Map, Set, and array mutator methods
 *   (`set`, `add`, `push`) mark a value changed without a revert check; the
 *   native-operation tests in `proxy.test.ts` own them.
 * - Top-level symbol keys are not written. `getChanges()` does not report
 *   them; the coverage map lists symbol writes as unsupported. Symbol keys
 *   inside nested objects are written.
 * - Keys are non-index strings, so property order follows insertion order.
 */

// ---------------------------------------------------------------------------
// Value specs. The model works on plain-data specs and never reads a draft.

const S = Symbol(`s`)
const PRIMITIVES = [0, -0, 1, NaN, `a`, `b`, null, undefined] as const
type Primitive = (typeof PRIMITIVES)[number]

type Spec =
  | { k: `prim`; v: Primitive }
  | { k: `date`; t: number }
  | { k: `regex`; flags: string; lastIndex: number }
  | { k: `map`; entries: Array<[string, MapValue]> }
  | { k: `set`; values: Array<string> }
  | { k: `array`; items: Array<Primitive | typeof HOLE> }
  | { k: `obj`; a?: Primitive; b?: Primitive; sym?: Primitive }
  | { k: `rows`; rows: Array<{ a: Primitive }> }

// A Map value is a primitive or a nested Set, so draft rules must also hold
// inside Map values.
type MapValue = Primitive | { set: Array<string> }
const isSetValue = (v: MapValue): v is { set: Array<string> } =>
  typeof v === `object` && v !== null
const mapValue = (v: MapValue): unknown =>
  isSetValue(v) ? [`set`, v.set] : prim(v)

const HOLE = Symbol(`hole`)
const FIELDS = [`f`, `g`, `h`] as const
type Field = (typeof FIELDS)[number]
type Root = Partial<Record<Field, Spec>>

// Draft equality as an encoding. Equal encodings mean equal values.
function encode(spec: Spec | undefined): string {
  return JSON.stringify(canon(spec))
}
function prim(v: Primitive | undefined): unknown {
  return typeof v === `number` ? [`num`, String(v)] : [typeof v, v ?? null]
}
function canon(spec: Spec | undefined): unknown {
  if (spec === undefined) return [`absent`]
  switch (spec.k) {
    case `prim`:
      return prim(spec.v)
    case `date`:
      return [`date`, String(spec.t)]
    case `regex`:
      return [`regex`, spec.flags, spec.lastIndex]
    case `map`:
      return [`map`, spec.entries.map(([key, v]) => [key, mapValue(v)])]
    case `set`:
      return [`set`, spec.values]
    case `array`:
      return [
        `array`,
        spec.items.length,
        spec.items.flatMap((v, i) => (v === HOLE ? [] : [[i, prim(v)]])),
      ]
    case `obj`:
      return [
        `obj`,
        `a` in spec ? prim(spec.a) : `-`,
        `b` in spec ? prim(spec.b) : `-`,
        `sym` in spec ? prim(spec.sym) : `-`,
      ]
    case `rows`:
      return [`rows`, spec.rows.map((row) => prim(row.a))]
  }
}

function realize(spec: Spec): unknown {
  switch (spec.k) {
    case `prim`:
      return spec.v
    case `date`:
      return new Date(spec.t)
    case `regex`: {
      const value = new RegExp(`x`, spec.flags)
      value.lastIndex = spec.lastIndex
      return value
    }
    case `map`:
      return new Map(
        spec.entries.map(([key, v]) => [
          key,
          isSetValue(v) ? new Set(v.set) : v,
        ]),
      )
    case `set`:
      return new Set(spec.values)
    case `array`: {
      const value: Array<unknown> = []
      value.length = spec.items.length
      spec.items.forEach((v, i) => {
        if (v !== HOLE) value[i] = v
      })
      return value
    }
    case `obj`: {
      const value: Record<PropertyKey, unknown> = {}
      if (`a` in spec) value.a = spec.a
      if (`b` in spec) value.b = spec.b
      if (`sym` in spec) value[S] = spec.sym
      return value
    }
    case `rows`:
      return spec.rows.map((row) => ({ a: row.a }))
  }
}

function realizeRoot(root: Root): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const field of FIELDS) {
    const spec = root[field]
    if (spec) value[field] = realize(spec)
  }
  return value
}

// ---------------------------------------------------------------------------
// Grammar.

const primArb = fc.constantFrom(...PRIMITIVES)
const specArb: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 2, arbitrary: primArb.map((v) => ({ k: `prim` as const, v })) },
  fc.constantFrom(0, 1, NaN).map((t) => ({ k: `date` as const, t })),
  fc.record({
    k: fc.constant(`regex` as const),
    flags: fc.constantFrom(``, `g`),
    lastIndex: fc.nat(1),
  }),
  fc
    .uniqueArray(
      fc.tuple(
        fc.constantFrom(`x`, `y`),
        fc.oneof(
          primArb,
          fc
            .uniqueArray(fc.constantFrom(`x`, `y`), { maxLength: 2 })
            .map((set): MapValue => ({ set })),
        ),
      ),
      { maxLength: 2, selector: ([key]) => key },
    )
    .map((entries) => ({ k: `map` as const, entries })),
  fc
    .uniqueArray(fc.constantFrom(`x`, `y`), { maxLength: 2 })
    .map((values) => ({ k: `set` as const, values })),
  fc
    .array(fc.oneof(primArb, fc.constant(HOLE)), { maxLength: 3 })
    .map((items) => ({ k: `array` as const, items })),
  fc.record(
    { k: fc.constant(`obj` as const), a: primArb, b: primArb, sym: primArb },
    { requiredKeys: [`k`] },
  ),
  fc
    .array(fc.record({ a: primArb }), { minLength: 1, maxLength: 3 })
    .map((rows) => ({ k: `rows` as const, rows })),
)

type Op =
  | { op: `set`; field: Field; value: Spec }
  | { op: `revert`; field: Field }
  | { op: `delete`; field: Field }
  | { op: `nested`; field: Field; key: `a` | `b` | `sym`; value: Primitive }
  | { op: `index`; field: Field; index: number; value: Primitive }
  | { op: `forOf`; field: Field; index: number; value: Primitive }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    op: fc.constant(`set` as const),
    field: fc.constantFrom(...FIELDS),
    value: specArb,
  }),
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant(`revert` as const),
      field: fc.constantFrom(...FIELDS),
    }),
  },
  fc.record({
    op: fc.constant(`delete` as const),
    field: fc.constantFrom(...FIELDS),
  }),
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant(`nested` as const),
      field: fc.constantFrom(...FIELDS),
      key: fc.constantFrom(`a` as const, `b` as const, `sym` as const),
      value: primArb,
    }),
  },
  fc.record({
    op: fc.constant(`index` as const),
    field: fc.constantFrom(...FIELDS),
    index: fc.nat(2),
    value: primArb,
  }),
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant(`forOf` as const),
      field: fc.constantFrom(...FIELDS),
      index: fc.nat(2),
      value: primArb,
    }),
  },
)

type History = { original: Root; ops: Array<Op> }
const historyArb: fc.Arbitrary<History> = fc.record({
  original: fc.record(
    { f: specArb, g: specArb, h: specArb },
    { requiredKeys: [] },
  ),
  ops: fc.array(opArb, { minLength: 1, maxLength: 6 }),
})

// ---------------------------------------------------------------------------
// Model: apply each op to the spec state. An op whose target has the wrong
// shape does nothing, and the driver skips it the same way.

function applicable(state: Root, op: Op): boolean {
  const current = state[op.field]
  switch (op.op) {
    case `set`:
      return true
    case `revert`:
      return op.field in state || current !== undefined
    case `delete`:
      return current !== undefined
    case `nested`:
      return current?.k === `obj`
    case `index`:
      return current?.k === `array` && op.index < current.items.length
    case `forOf`:
      return current?.k === `rows` && op.index < current.rows.length
  }
}

function step(state: Root, original: Root, op: Op): Root {
  const next: Root = { ...state }
  const current = state[op.field]
  switch (op.op) {
    case `set`:
      next[op.field] = op.value
      break
    case `revert`:
      if (original[op.field] === undefined) delete next[op.field]
      else next[op.field] = original[op.field]
      break
    case `delete`:
      delete next[op.field]
      break
    case `nested`:
      next[op.field] = {
        ...(current as Extract<Spec, { k: `obj` }>),
        [op.key]: op.value,
      }
      break
    case `index`: {
      const items = [...(current as Extract<Spec, { k: `array` }>).items]
      items[op.index] = op.value
      next[op.field] = { k: `array`, items }
      break
    }
    case `forOf`: {
      const rows = (current as Extract<Spec, { k: `rows` }>).rows.map(
        (row) => ({ ...row }),
      )
      rows[op.index] = { a: op.value }
      next[op.field] = { k: `rows`, rows }
      break
    }
  }
  return next
}

function expectedChanges(
  original: Root,
  final: Root,
): Map<Field, Spec | undefined> {
  const changes = new Map<Field, Spec | undefined>()
  for (const field of FIELDS) {
    if (encode(final[field]) === encode(original[field])) continue
    changes.set(field, final[field])
  }
  return changes
}

// ---------------------------------------------------------------------------
// Driver.

function drive(draft: Record<string, any>, op: Op): void {
  switch (op.op) {
    case `set`:
      draft[op.field] = realize(op.value)
      return
    case `revert`:
      return
    case `delete`:
      delete draft[op.field]
      return
    case `nested`:
      if (op.key === `sym`) draft[op.field][S] = op.value
      else draft[op.field][op.key] = op.value
      return
    case `index`:
      draft[op.field][op.index] = op.value
      return
    case `forOf`: {
      let index = 0
      for (const row of draft[op.field] as Array<{ a: unknown }>) {
        if (index++ === op.index) row.a = op.value
      }
      return
    }
  }
}

function readSpec(value: unknown, like: Spec | undefined): string {
  // Encode the draft's value with the same rules as the model.
  if (like === undefined)
    return value === undefined ? encode(undefined) : `present`
  switch (like.k) {
    case `prim`:
      return JSON.stringify(prim(value as Primitive))
    case `date`:
      return value instanceof Date
        ? encode({ k: `date`, t: value.getTime() })
        : `not a Date`
    case `regex`:
      return value instanceof RegExp
        ? encode({ k: `regex`, flags: value.flags, lastIndex: value.lastIndex })
        : `not a RegExp`
    case `map`:
      return value instanceof Map
        ? encode({
            k: `map`,
            entries: [...value].map(([key, v]): [string, MapValue] => [
              key,
              v instanceof Set ? { set: [...v] } : v,
            ]),
          })
        : `not a Map`
    case `set`:
      return value instanceof Set
        ? encode({ k: `set`, values: [...value] })
        : `not a Set`
    case `array`: {
      if (!Array.isArray(value)) return `not an array`
      const items: Array<Primitive | typeof HOLE> = []
      for (let i = 0; i < value.length; i++)
        items.push(i in value ? (value[i] as Primitive) : HOLE)
      return encode({ k: `array`, items })
    }
    case `obj`: {
      if (value === null || typeof value !== `object`) return `not an object`
      const o = value as Record<PropertyKey, Primitive>
      const keys = Reflect.ownKeys(o).filter((key) =>
        Object.prototype.propertyIsEnumerable.call(o, key),
      )
      if (keys.some((key) => key !== `a` && key !== `b` && key !== S))
        return `extra keys`
      const spec: Spec = { k: `obj` }
      if (`a` in o) spec.a = o.a
      if (`b` in o) spec.b = o.b
      if (S in o) spec.sym = o[S]
      return encode(spec)
    }
    case `rows`:
      return Array.isArray(value)
        ? encode({
            k: `rows`,
            rows: value.map((row: { a: Primitive }) => ({ a: row.a })),
          })
        : `not rows`
  }
}

function expectHistory({ original, ops }: History): void {
  const row = realizeRoot(original)
  const before = realizeRoot(original)
  const { proxy, getChanges } = createChangeProxy(row)
  let state: Root = { ...original }
  for (const op of ops) {
    if (!applicable(state, op)) continue
    if (op.op === `revert`) {
      if (original[op.field] === undefined) delete proxy[op.field]
      else proxy[op.field] = realize(original[op.field]!)
    } else drive(proxy as Record<string, any>, op)
    state = step(state, original, op)
  }

  const expected = expectedChanges(original, state)
  const changes = getChanges() as Record<string, unknown>
  const context = JSON.stringify({
    original: Object.fromEntries(FIELDS.map((f) => [f, canon(original[f])])),
    ops,
  })
  expect(Object.keys(changes).sort(), `changed keys, ${context}`).toEqual(
    [...expected.keys()].sort(),
  )
  for (const [field, spec] of expected) {
    if (spec === undefined)
      expect(changes[field], `deleted ${field}, ${context}`).toBeUndefined()
    else
      expect(
        readSpec(changes[field], spec),
        `change of ${field}, ${context}`,
      ).toBe(encode(spec))
  }
  for (const field of FIELDS)
    expect(
      readSpec(proxy[field], state[field]),
      `draft ${field}, ${context}`,
    ).toBe(encode(state[field]))
  for (const field of FIELDS)
    expect(
      readSpec(row[field], original[field]),
      `original ${field} unchanged, ${context}`,
    ).toBe(readSpec(before[field], original[field]))
}

// ---------------------------------------------------------------------------
// Campaigns. `TANSTACK_DB_PROXY_REVERT_SEED` and
// `TANSTACK_DB_PROXY_REVERT_PATH` select a direct replay.

const replaySeed = process.env.TANSTACK_DB_PROXY_REVERT_SEED
const replayPath = process.env.TANSTACK_DB_PROXY_REVERT_PATH
const FIXED_SEED = 2026101
const campaigns =
  replaySeed === undefined && replayPath === undefined
    ? [
        { name: String(FIXED_SEED), seed: FIXED_SEED as number | undefined },
        { name: `random`, seed: undefined },
      ]
    : [
        {
          name: `replay`,
          seed: replaySeed === undefined ? undefined : Number(replaySeed),
        },
      ]

describe(`draft revert oracle`, () => {
  for (const { name, seed } of campaigns) {
    it(`matches the model across generated write histories (${name})`, () => {
      if (replayPath !== undefined && replaySeed === undefined)
        throw new Error(`TANSTACK_DB_PROXY_REVERT_PATH requires a seed`)
      if (
        replaySeed !== undefined &&
        (replaySeed.trim() === `` ||
          typeof seed !== `number` ||
          !Number.isSafeInteger(seed))
      )
        throw new Error(`TANSTACK_DB_PROXY_REVERT_SEED must be an integer`)
      fc.assert(fc.property(historyArb, expectHistory), {
        numRuns: 400,
        ...(seed === undefined ? {} : { seed }),
        ...(replayPath === undefined ? {} : { path: replayPath }),
      })
    })
  }

  // Positive execution witness: the fixed campaign reaches each operation, a
  // partial revert (some change survives one revert), a full revert, and a
  // change made only under a nested symbol key.
  it(`reaches every operation and both revert outcomes in the fixed campaign`, () => {
    const sample = fc.sample(historyArb, { seed: FIXED_SEED, numRuns: 400 })
    const reached = new Set<string>()
    let partial = 0
    let full = 0
    let symbolOnly = 0
    for (const { original, ops } of sample) {
      let state: Root = { ...original }
      const applied: Array<Op> = []
      for (const op of ops) {
        if (!applicable(state, op)) continue
        reached.add(op.op)
        applied.push(op)
        state = step(state, original, op)
      }
      const changed = expectedChanges(original, state).size
      const reverts = applied.filter((op) => op.op === `revert`).length
      const touched = new Set(applied.map((op) => op.field)).size
      if (reverts > 0 && changed > 0 && touched > changed) partial++
      if (applied.length > 1 && reverts > 0 && changed === 0) full++
      for (const field of FIELDS) {
        const a = original[field]
        const b = state[field]
        if (
          a?.k === `obj` &&
          b?.k === `obj` &&
          a.sym !== b.sym &&
          encode({ ...a, sym: undefined }) ===
            encode({ ...b, sym: undefined }) &&
          !Object.is(a.sym, b.sym) &&
          encode(a) !== encode(b)
        )
          symbolOnly++
      }
    }
    expect([...reached].sort()).toEqual([
      `delete`,
      `forOf`,
      `index`,
      `nested`,
      `revert`,
      `set`,
    ])
    expect(partial).toBeGreaterThan(20)
    expect(full).toBeGreaterThan(20)
    expect(symbolOnly).toBeGreaterThan(0)
  })

  // Pinned witnesses.
  it.each<[string, History]>([
    [
      `reverting one of two changed fields keeps the other change`,
      {
        original: { f: { k: `prim`, v: `a` }, g: { k: `prim`, v: `a` } },
        ops: [
          { op: `set`, field: `f`, value: { k: `prim`, v: `b` } },
          { op: `set`, field: `g`, value: { k: `prim`, v: `b` } },
          { op: `revert`, field: `f` },
        ],
      },
    ],
    [
      `a nested write through for...of records the row change`,
      {
        original: { f: { k: `rows`, rows: [{ a: 0 }, { a: 1 }] } },
        ops: [{ op: `forOf`, field: `f`, index: 1, value: `a` }],
      },
    ],
    [
      `a nested write through for...of that restores the value is a revert`,
      {
        original: { f: { k: `rows`, rows: [{ a: 0 }, { a: 1 }] } },
        ops: [
          { op: `forOf`, field: `f`, index: 1, value: `a` },
          { op: `forOf`, field: `f`, index: 1, value: 1 },
        ],
      },
    ],
    [
      `a change made only under a nested symbol key is recorded`,
      {
        original: { f: { k: `obj`, a: 1, sym: `a` } },
        ops: [{ op: `nested`, field: `f`, key: `sym`, value: `b` }],
      },
    ],
    [
      `replacing a nested object with one that differs only under a symbol key is recorded`,
      {
        original: { f: { k: `obj`, a: 1, sym: `a` } },
        ops: [{ op: `set`, field: `f`, value: { k: `obj`, a: 1, sym: `b` } }],
      },
    ],
    [
      `Map entry order is a change`,
      {
        original: {
          f: {
            k: `map`,
            entries: [
              [`x`, 1],
              [`y`, 0],
            ],
          },
        },
        ops: [
          {
            op: `set`,
            field: `f`,
            value: {
              k: `map`,
              entries: [
                [`y`, 0],
                [`x`, 1],
              ],
            },
          },
        ],
      },
    ],
    [
      `a reordered Set inside a Map value is a change`,
      {
        original: { f: { k: `map`, entries: [[`x`, { set: [`x`, `y`] }]] } },
        ops: [
          {
            op: `set`,
            field: `f`,
            value: { k: `map`, entries: [[`x`, { set: [`y`, `x`] }]] },
          },
        ],
      },
    ],
    [
      `Set value order is a change`,
      {
        original: { f: { k: `set`, values: [`x`, `y`] } },
        ops: [
          { op: `set`, field: `f`, value: { k: `set`, values: [`y`, `x`] } },
        ],
      },
    ],
    [
      `RegExp lastIndex is a change`,
      {
        original: { f: { k: `regex`, flags: `g`, lastIndex: 0 } },
        ops: [
          {
            op: `set`,
            field: `f`,
            value: { k: `regex`, flags: `g`, lastIndex: 1 },
          },
        ],
      },
    ],
    [
      `a hole replaced by undefined is a change`,
      {
        original: { f: { k: `array`, items: [HOLE, 1] } },
        ops: [
          {
            op: `set`,
            field: `f`,
            value: { k: `array`, items: [undefined, 1] },
          },
        ],
      },
    ],
    [
      `-0 and NaN rewrites are not changes`,
      {
        original: { f: { k: `prim`, v: 0 }, g: { k: `prim`, v: NaN } },
        ops: [
          { op: `set`, field: `f`, value: { k: `prim`, v: -0 } },
          { op: `set`, field: `g`, value: { k: `prim`, v: NaN } },
        ],
      },
    ],
  ])(`%s`, (_name, history) => expectHistory(history))
})
