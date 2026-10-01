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
 * 7. Typed arrays compare by class and by elements under rule 1.
 * 8. URLs compare by `href`.
 * 9. An object of another class differs, and a class instance without
 *    enumerable keys (here, one with only a private field) equals only
 *    itself.
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
 * - Class instances appear only as written values. A draft reads a class
 *   instance of the original row as a plain object; the detachment contract
 *   owns that boundary.
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
  | { k: `typed`; ctor: TypedKind; values: Array<number> }
  | { k: `url`; path: `a` | `b` }
  | { k: `secret`; v: number }

// A Map value is a primitive or a nested Set, so draft rules must also hold
// inside Map values.
type MapValue = Primitive | { set: Array<string> }
const isSetValue = (v: MapValue): v is { set: Array<string> } =>
  typeof v === `object` && v !== null
const mapValue = (v: MapValue): unknown =>
  isSetValue(v) ? [`set`, v.set] : prim(v)

// Typed arrays, including a subclass whose constructor ignores its argument,
// so a clone must not rely on constructor arguments to copy elements.
type TypedKind = `f64` | `u8` | `vec3`
class Vec3 extends Float64Array {
  constructor() {
    super(3)
  }
}
const typedKind = (value: unknown): TypedKind | undefined =>
  value instanceof Vec3
    ? `vec3`
    : value instanceof Float64Array
      ? `f64`
      : value instanceof Uint8Array
        ? `u8`
        : undefined

// A class whose only state is a private field, so it has no enumerable keys.
class Secret {
  #v: number
  constructor(v: number) {
    this.#v = v
  }
  read(): number {
    return this.#v
  }
}

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
    case `typed`:
      // Elements follow rule 1: -0 equals 0 and NaN equals NaN. The class is
      // part of the value.
      return [`typed`, spec.ctor, spec.values.map(String)]
    case `url`:
      return [`url`, spec.path]
    case `secret`:
      // Rule 9. Secrets appear only as written values, and the original is
      // never a Secret, so the value is enough to compare written states.
      return [`secret`, spec.v]
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
    case `typed`: {
      if (spec.ctor === `u8`) return Uint8Array.from(spec.values)
      const value =
        spec.ctor === `vec3` ? new Vec3() : new Float64Array(spec.values.length)
      spec.values.forEach((v, i) => (value[i] = v))
      return value
    }
    case `url`:
      return new URL(`https://example.com/${spec.path}`)
    case `secret`:
      return new Secret(spec.v)
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
  fc.oneof(
    fc
      .array(fc.constantFrom(0, -0, 1, NaN, 1.5), { maxLength: 3 })
      .map((values): Spec => ({ k: `typed`, ctor: `f64`, values })),
    fc
      .array(fc.constantFrom(0, 1, 255), { maxLength: 3 })
      .map((values): Spec => ({ k: `typed`, ctor: `u8`, values })),
    fc
      .tuple(...[0, 1, 2].map(() => fc.constantFrom(0, -0, 1, NaN)))
      .map((values): Spec => ({ k: `typed`, ctor: `vec3`, values })),
  ),
  fc
    .constantFrom(`a` as const, `b` as const)
    .map((path): Spec => ({ k: `url`, path })),
)
// Written values may also be class instances with only private state.
const writtenArb: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 9, arbitrary: specArb },
  fc.constantFrom(1, 2).map((v): Spec => ({ k: `secret`, v })),
)

type Op =
  | { op: `set`; field: Field; value: Spec }
  | { op: `revert`; field: Field }
  | { op: `delete`; field: Field }
  | { op: `nested`; field: Field; key: `a` | `b` | `sym`; value: Primitive }
  | { op: `nestedDelete`; field: Field; key: `a` | `b` | `sym` }
  | { op: `index`; field: Field; index: number; value: Primitive }
  | { op: `forOf`; field: Field; index: number; value: Primitive }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    op: fc.constant(`set` as const),
    field: fc.constantFrom(...FIELDS),
    value: writtenArb,
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
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant(`nestedDelete` as const),
      field: fc.constantFrom(...FIELDS),
      key: fc.constantFrom(`a` as const, `b` as const, `sym` as const),
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

// Generated ops also include a revert of a field that is currently changed,
// so most reverts run the set trap's revert branch. `resolve` turns it into a
// concrete revert of one changed field, or nothing.
type GeneratedOp = Op | { op: `revertChanged`; pick: number }
type History = { original: Root; ops: Array<GeneratedOp> }

function resolve(state: Root, original: Root, op: GeneratedOp): Op | undefined {
  if (op.op !== `revertChanged`) return op
  const changed = FIELDS.filter(
    (field) => encode(state[field]) !== encode(original[field]),
  )
  return changed.length > 0
    ? { op: `revert`, field: changed[op.pick % changed.length]! }
    : undefined
}
const historyArb: fc.Arbitrary<History> = fc.record({
  original: fc.record(
    { f: specArb, g: specArb, h: specArb },
    { requiredKeys: [] },
  ),
  ops: fc.array(
    fc.oneof(
      { weight: 3, arbitrary: opArb as fc.Arbitrary<GeneratedOp> },
      {
        weight: 2,
        arbitrary: fc.record({
          op: fc.constant(`revertChanged` as const),
          pick: fc.nat(2),
        }),
      },
    ),
    { minLength: 1, maxLength: 8 },
  ),
})

// Partial reverts by construction: change two or three fields in some order,
// then revert every changed field but one. The model decides whether a change
// survives (a new value can equal the original).
const partialRevertArb: fc.Arbitrary<History> = fc
  .record({
    original: fc.record({ f: specArb, g: specArb, h: specArb }),
    values: fc.tuple(specArb, specArb, specArb),
    order: fc.shuffledSubarray([...FIELDS], { minLength: 2 }),
    keep: fc.nat(2),
  })
  .map(({ original, values, order, keep }) => {
    const kept = order[keep % order.length]!
    const changes: Array<GeneratedOp> = order.map((field) => ({
      op: `set`,
      field,
      value: values[FIELDS.indexOf(field)]!,
    }))
    const reverts: Array<GeneratedOp> = order
      .filter((field) => field !== kept)
      .map((field) => ({ op: `revert`, field }))
    return { original, ops: [...changes, ...reverts] }
  })

// Two writes of URLs or keyless Secrets to one field, with up to two other
// ops in between and an optional revert. The original field is a URL, an
// object without keys, or any value.
const urlOrSecretArb: fc.Arbitrary<Spec> = fc.oneof(
  fc
    .constantFrom(`a` as const, `b` as const)
    .map((path): Spec => ({ k: `url`, path })),
  fc.constantFrom(1, 2).map((v): Spec => ({ k: `secret`, v })),
)
const classWriteArb: fc.Arbitrary<History> = fc
  .record({
    f: fc.oneof(
      urlOrSecretArb.filter((spec) => spec.k === `url`),
      fc.constant<Spec>({ k: `obj` }),
      specArb,
    ),
    g: specArb,
    first: urlOrSecretArb,
    second: urlOrSecretArb,
    between: fc.array(opArb, { maxLength: 2 }),
    revert: fc.boolean(),
  })
  .map(
    ({ f, g, first, second, between, revert }): History => ({
      original: { f, g },
      ops: [
        { op: `set`, field: `f`, value: first },
        ...between,
        { op: `set`, field: `f`, value: second },
        ...(revert ? [{ op: `revert` as const, field: `f` as const }] : []),
      ],
    }),
  )

// Nested round trips. Either add a key the original object lacks and later
// delete it, or change an existing key and later write its original value
// back, with up to two other ops in between. Other ops may leave other fields
// changed, so the nested object must stop counting as a change on its own.
const nestedRoundTripArb: fc.Arbitrary<History> = fc
  .record({
    a: primArb,
    sym: fc.option(primArb, { nil: undefined }),
    g: specArb,
    mode: fc.constantFrom(`delete` as const, `restore` as const),
    value: primArb,
    between: fc.array(opArb, { maxLength: 2 }),
  })
  .map(({ a, sym, g, mode, value, between }): History => {
    const f: Spec = sym === undefined ? { k: `obj`, a } : { k: `obj`, a, sym }
    const first: GeneratedOp =
      mode === `delete`
        ? { op: `nested`, field: `f`, key: `b`, value }
        : { op: `nested`, field: `f`, key: `a`, value }
    const last: GeneratedOp =
      mode === `delete`
        ? { op: `nestedDelete`, field: `f`, key: `b` }
        : { op: `nested`, field: `f`, key: `a`, value: a }
    return { original: { f, g }, ops: [first, ...between, last] }
  })

// ---------------------------------------------------------------------------
// Model: apply each op to the spec state. An op whose target has the wrong
// shape does nothing, and the driver skips it the same way.

function applicable(state: Root, original: Root, op: Op): boolean {
  const current = state[op.field]
  switch (op.op) {
    case `set`:
      return true
    case `revert`:
      // Restoring a deleted field is a revert too. Skip only when the field
      // is absent both originally and now.
      return original[op.field] !== undefined || current !== undefined
    case `delete`:
      return current !== undefined
    case `nested`:
      return current?.k === `obj`
    case `nestedDelete`:
      return current?.k === `obj` && op.key in current
    case `index`:
      // Float typed arrays store any number exactly; Uint8Array would coerce.
      if (current?.k === `typed`)
        return (
          current.ctor !== `u8` &&
          typeof op.value === `number` &&
          op.index < current.values.length
        )
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
    case `nestedDelete`: {
      const obj = { ...(current as Extract<Spec, { k: `obj` }>) }
      delete obj[op.key]
      next[op.field] = obj
      break
    }
    case `index`: {
      if (current?.k === `typed`) {
        const values = [...current.values]
        values[op.index] = op.value as number
        next[op.field] = { ...current, values }
        break
      }
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
    case `nestedDelete`:
      if (op.key === `sym`) delete draft[op.field][S]
      else delete draft[op.field][op.key]
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
    case `typed`: {
      const ctor = typedKind(value)
      return ctor === undefined
        ? `not a typed array`
        : encode({
            k: `typed`,
            ctor,
            values: Array.from(value as Float64Array),
          })
    }
    case `url`:
      return value instanceof URL
        ? encode({ k: `url`, path: value.pathname.slice(1) as `a` | `b` })
        : `not a URL`
    case `secret`:
      return value instanceof Secret
        ? encode({ k: `secret`, v: value.read() })
        : `not a Secret`
  }
}

function expectHistory({ original, ops }: History): void {
  const row = realizeRoot(original)
  const before = realizeRoot(original)
  const { proxy, getChanges } = createChangeProxy(row)
  let state: Root = { ...original }
  for (const generated of ops) {
    const op = resolve(state, original, generated)
    if (op === undefined || !applicable(state, original, op)) continue
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
    it(`matches the model across generated nested round trips (${name})`, () => {
      fc.assert(fc.property(nestedRoundTripArb, expectHistory), {
        numRuns: 200,
        ...(seed === undefined ? {} : { seed }),
        ...(replayPath === undefined ? {} : { path: replayPath }),
      })
    })
    it(`matches the model across generated URL and keyless writes (${name})`, () => {
      fc.assert(fc.property(classWriteArb, expectHistory), {
        numRuns: 200,
        ...(seed === undefined ? {} : { seed }),
        ...(replayPath === undefined ? {} : { path: replayPath }),
      })
    })
    it(`matches the model across generated partial reverts (${name})`, () => {
      fc.assert(fc.property(partialRevertArb, expectHistory), {
        numRuns: 200,
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
      // A revert counts only when the field differs from its original, so
      // the set trap's revert branch runs. Other reverts write an equal value.
      let effectiveReverts = 0
      for (const generated of ops) {
        const op = resolve(state, original, generated)
        if (op === undefined || !applicable(state, original, op)) continue
        reached.add(op.op)
        if (
          op.op === `revert` &&
          encode(state[op.field]) !== encode(original[op.field])
        )
          effectiveReverts++
        state = step(state, original, op)
      }
      const changed = expectedChanges(original, state).size
      if (effectiveReverts > 0 && changed > 0) partial++
      if (effectiveReverts > 0 && changed === 0) full++
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
      `nestedDelete`,
      `revert`,
      `set`,
    ])
    expect(partial).toBeGreaterThanOrEqual(5)
    expect(full).toBeGreaterThanOrEqual(30)
    expect(symbolOnly).toBeGreaterThan(0)
  })

  // Writes that a keyless comparison would call equal: another URL, or a
  // Secret over another Secret or over an object without keys.
  it(`reaches writes over URLs and keyless objects in the fixed campaign`, () => {
    let urlWrites = 0
    let keylessWrites = 0
    const sample = fc.sample(classWriteArb, { seed: FIXED_SEED, numRuns: 200 })
    for (const { original, ops } of sample) {
      let state: Root = { ...original }
      for (const generated of ops) {
        const op = resolve(state, original, generated)
        if (op === undefined || !applicable(state, original, op)) continue
        const current = state[op.field]
        if (op.op === `set` && op.value.k === `url` && current?.k === `url`)
          if (op.value.path !== current.path) urlWrites++
        if (op.op === `set` && op.value.k === `secret`)
          if (
            (current?.k === `secret` && current.v !== op.value.v) ||
            (current?.k === `obj` && encode(current) === encode({ k: `obj` }))
          )
            keylessWrites++
        state = step(state, original, op)
      }
    }
    expect(urlWrites).toBeGreaterThanOrEqual(10)
    expect(keylessWrites).toBeGreaterThanOrEqual(10)
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
      `adding a nested key and deleting it again is not a change`,
      {
        original: { f: { k: `obj`, a: 1 } },
        ops: [
          { op: `nested`, field: `f`, key: `b`, value: 2 },
          { op: `nestedDelete`, field: `f`, key: `b` },
        ],
      },
    ],
    [
      `restoring a nested value is not a change while a sibling stays changed`,
      {
        original: { f: { k: `obj`, a: 1 }, g: { k: `prim`, v: `a` } },
        ops: [
          { op: `nested`, field: `f`, key: `a`, value: 2 },
          { op: `set`, field: `g`, value: { k: `prim`, v: `b` } },
          { op: `nested`, field: `f`, key: `a`, value: 1 },
        ],
      },
    ],
    [
      `deleting an added nested key is not a change while a sibling stays changed`,
      {
        original: { f: { k: `obj`, a: 1 }, g: { k: `prim`, v: `a` } },
        ops: [
          { op: `nested`, field: `f`, key: `b`, value: 2 },
          { op: `set`, field: `g`, value: { k: `prim`, v: `b` } },
          { op: `nestedDelete`, field: `f`, key: `b` },
        ],
      },
    ],
    [
      `a replaced object that returns to its new value is still a change`,
      {
        original: { f: { k: `obj`, a: 1 } },
        ops: [
          { op: `set`, field: `f`, value: { k: `obj`, a: 2 } },
          { op: `nested`, field: `f`, key: `a`, value: 3 },
          { op: `nested`, field: `f`, key: `a`, value: 2 },
        ],
      },
    ],
    [
      `a key added with the value undefined stays a change after a sibling revert`,
      {
        original: { f: { k: `obj`, a: 0 } },
        ops: [
          { op: `nested`, field: `f`, key: `b`, value: 0 },
          { op: `set`, field: `h`, value: { k: `prim`, v: undefined } },
          { op: `nestedDelete`, field: `f`, key: `b` },
        ],
      },
    ],
    [
      `a typed-array subclass keeps its elements in the draft`,
      {
        original: { f: { k: `typed`, ctor: `vec3`, values: [1, 2, 3] } },
        ops: [{ op: `index`, field: `f`, index: 0, value: 9 }],
      },
    ],
    [
      `rewriting NaN into a Float64Array is not a change`,
      {
        original: { f: { k: `typed`, ctor: `f64`, values: [NaN, 1] } },
        ops: [
          {
            op: `set`,
            field: `f`,
            value: { k: `typed`, ctor: `f64`, values: [NaN, 1] },
          },
          { op: `index`, field: `f`, index: 0, value: NaN },
        ],
      },
    ],
    [
      `a typed array of another class is a change`,
      {
        original: { f: { k: `typed`, ctor: `f64`, values: [1, 0] } },
        ops: [
          {
            op: `set`,
            field: `f`,
            value: { k: `typed`, ctor: `u8`, values: [1, 0] },
          },
        ],
      },
    ],
    [
      `deleting a field and writing its original back is a revert`,
      {
        original: { f: { k: `prim`, v: `a` }, g: { k: `prim`, v: `a` } },
        ops: [
          { op: `delete`, field: `f` },
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
