import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createChangeProxy, withChangeTracking } from '../src/proxy'

/**
 * # Which draft writes count as changes, and which count as reverts?
 *
 * A draft records the changes a callback makes to a row. A write that makes a
 * value structurally equal to its original again is a revert. `getChanges()`
 * reports each own enumerable string key whose final value differs from its
 * original, with that final value, and each deleted key as `undefined`. It
 * may also report a key the callback wrote whose final value equals its
 * original, with that value. A missed change (a false negative) breaks the
 * row; an extra report of an equal value (a false positive) only repeats the
 * stored value, so the law permits it. A direct write back to the original
 * value still reports nothing.
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
 * 9. Instances of two different classes differ. A class instance and a
 *    plain object compare by keys, because a draft snapshot holds class
 *    instances as plain objects. A class instance without enumerable keys
 *    (here, one with only a private field) equals only itself.
 *
 * Laws checked at one checkpoint: after the last write of a history.
 * The driver writes through `createChangeProxy`'s draft
 * (its `set`, `deleteProperty`, and `get` traps, and the array iterator), and
 * the check reads `getChanges()` and the draft.
 *
 * - `getChanges()` reports every change in the model, with its final value.
 *   Any other key it reports is one the history wrote, with its final value.
 * - Reading the draft gives the model's final value.
 * - The original row is unchanged.
 *
 * Authority: rules 1 to 6 and the laws come from the `createChangeProxy` and
 * `getChanges` implementation comments in `src/proxy.ts` and the revert
 * examples in `tests/proxy-oracle.test.ts`, as of `18abceee`. Rules 7 to 9 are design
 * decisions recorded in
 * `docs/contributing/oracle-reviews/code-weight-draft-proxy.md`. The
 * false-positive permission is a maintainer decision (2026-10-09), recorded in
 * `docs/contributing/oracle-reviews/proxy-revert-replaced-object.md`.
 *
 * Limits:
 * - The main histories write by assignment, delete, nested property write,
 *   and nested write through `for...of` on an array. A native mutator
 *   (`push`, `set`, `add`, ...) marks a value changed without a revert check,
 *   so a mutator that leaves the value equal may still report it. The last
 *   block mixes array mutators with assignments, a nested object, and a
 *   retained handle, and checks when that permission ends. Map and Set
 *   mutators are not mixed with assignments. Each mutator's own result
 *   belongs to `proxy-native-methods-oracle.property.test.ts`.
 * - An assignment of a value draft-equal to the current one is a no-op, so a
 *   handle retained before it stays attached. Native JavaScript would detach
 *   it; no law here decides that case.
 * - Top-level symbol keys are not written. `getChanges()` does not report
 *   them; the coverage map lists symbol writes as unsupported. Symbol keys
 *   inside nested objects are written.
 * - Keys are non-index strings, so property order follows insertion order.
 * - A keyed class instance (`Point`) appears in original rows and written
 *   values. A keyless one (`Secret`) appears only as a written value. A
 *   draft reads a class instance of the original row as a plain object; the
 *   detachment contract owns that boundary.
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
  | { k: `point`; a: Primitive }

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

// A class instance with one enumerable key.
class Point {
  constructor(public a: unknown) {}
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
    case `point`:
      // Rule 9: a Point compares by keys with the plain object a draft
      // snapshot holds, so it encodes as that object.
      return canon({ k: `obj`, a: spec.a })
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
    case `point`:
      return new Point(spec.a)
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
  primArb.map((a): Spec => ({ k: `point`, a })),
)
// Written values may also be class instances with only private state.
const writtenArb: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 9, arbitrary: specArb },
  fc.constantFrom(1, 2).map((v): Spec => ({ k: `secret`, v })),
)

type Op =
  | { op: `set`; field: Field; value: Spec }
  // `same` writes the original row's own value back instead of an equal
  // fresh value, so identity-based paths are reached too.
  | { op: `revert`; field: Field; same?: boolean }
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
      same: fc.boolean(),
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
  .map(({ f, g, first, second, between, revert }): History => ({
    original: { f, g },
    ops: [
      { op: `set`, field: `f`, value: first },
      ...between,
      { op: `set`, field: `f`, value: second },
      ...(revert ? [{ op: `revert` as const, field: `f` as const }] : []),
    ],
  }))

// Nested round trips. Either add a key the original object lacks and later
// delete it, or change an existing key and later write its original value
// back, with up to two other ops in between. Other ops may leave other fields
// changed, so the nested object must stop counting as a change on its own.
const nestedRoundTripArb: fc.Arbitrary<History> = fc
  .record({
    a: primArb,
    sym: fc.option(primArb, { nil: undefined }),
    g: specArb,
    mode: fc.constantFrom(
      `delete` as const,
      `restore` as const,
      `replace` as const,
    ),
    value: primArb,
    between: fc.array(opArb, { maxLength: 2 }),
  })
  .map(({ a, sym, g, mode, value, between }): History => {
    const f: Spec = sym === undefined ? { k: `obj`, a } : { k: `obj`, a, sym }
    // `replace` assigns a new object without `a`; the nested write that
    // restores `a` makes the field equal its original again.
    const replacement: Spec =
      sym === undefined ? { k: `obj` } : { k: `obj`, sym }
    const first: GeneratedOp =
      mode === `delete`
        ? { op: `nested`, field: `f`, key: `b`, value }
        : mode === `replace`
          ? { op: `set`, field: `f`, value: replacement }
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
    case `point`:
      // A Point, or the plain object a draft reads for one.
      return readSpec(value, { k: `obj`, a: like.a })
  }
}

function expectHistory({ original, ops }: History): void {
  const row = realizeRoot(original)
  const before = realizeRoot(original)
  const { proxy, getChanges } = createChangeProxy(row)
  let state: Root = { ...original }
  const written = new Set<string>()
  for (const generated of ops) {
    const op = resolve(state, original, generated)
    if (op === undefined || !applicable(state, original, op)) continue
    written.add(op.field)
    if (op.op === `revert`) {
      if (original[op.field] === undefined) delete proxy[op.field]
      else
        proxy[op.field] = op.same ? row[op.field] : realize(original[op.field]!)
    } else drive(proxy as Record<string, any>, op)
    state = step(state, original, op)
  }

  const expected = expectedChanges(original, state)
  const changes = getChanges() as Record<string, unknown>
  const context = JSON.stringify({
    original: Object.fromEntries(FIELDS.map((f) => [f, canon(original[f])])),
    ops,
  })
  for (const field of expected.keys())
    expect(field in changes, `change of ${field} reported, ${context}`).toBe(
      true,
    )
  // An extra report is permitted only for a written key, with its final value.
  for (const field of Object.keys(changes)) {
    if (expected.has(field)) continue
    expect(written.has(field), `unwritten ${field} reported, ${context}`).toBe(
      true,
    )
    expect(
      readSpec(changes[field], state[field]),
      `extra report of ${field}, ${context}`,
    ).toBe(encode(state[field]))
  }
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
    // Reverts that write the row's own object back, a class instance included.
    let sameObjectReverts = 0
    let samePointReverts = 0
    for (const { original, ops } of sample) {
      let state: Root = { ...original }
      // A revert counts only when the field differs from its original, so
      // the set trap's revert branch runs. Other reverts write an equal value.
      let effectiveReverts = 0
      for (const generated of ops) {
        const op = resolve(state, original, generated)
        if (op === undefined || !applicable(state, original, op)) continue
        reached.add(op.op)
        const restored = original[op.field]
        if (
          op.op === `revert` &&
          op.same &&
          restored !== undefined &&
          !(restored.k === `prim` || restored.k === `date`)
        )
          sameObjectReverts +=
            restored.k === `point` ? (samePointReverts++, 1) : 1
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
    expect(sameObjectReverts).toBeGreaterThanOrEqual(20)
    expect(samePointReverts).toBeGreaterThan(0)
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
      `a replaced object restored to its original by a nested write reports at most its original value`,
      {
        original: { f: { k: `obj`, a: 0 } },
        ops: [
          { op: `set`, field: `f`, value: { k: `obj` } },
          { op: `nested`, field: `f`, key: `a`, value: 0 },
        ],
      },
    ],
    [
      `a replaced object restored with its symbol key kept reports at most its original value`,
      {
        original: {
          f: { k: `obj`, a: 0, sym: 1 },
          g: { k: `map`, entries: [] },
        },
        ops: [
          { op: `nested`, field: `f`, key: `a`, value: 0 },
          { op: `set`, field: `f`, value: { k: `obj`, sym: 1 } },
          { op: `nested`, field: `f`, key: `a`, value: 0 },
        ],
      },
    ],
    [
      `an array replaced by an empty Set is a change`,
      {
        original: { g: { k: `array`, items: [] } },
        ops: [{ op: `set`, field: `g`, value: { k: `set`, values: [] } }],
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

// ---------------------------------------------------------------------------
// Native mutators mixed with assignments.
//
// The histories above write only through assignment and delete, so they
// cannot reach a key whose value a native mutator changed. A native mutator
// (`push`, `pop`, `reverse`) counts as a change without a revert check, so
// when the value ends equal to the original, `getChanges()` may still report
// it, as for any written key. A mutator called through a handle the callback
// has since replaced changes nothing in the row.
//
// Model: plain JavaScript values. A row is `{ x, f: { arr, g: { a } } }`. Each
// step runs on a native copy. A retained handle is the array object it was
// taken from; once `f.arr` holds another array, the handle is detached. An assignment of a value equal to the current one changes
// nothing, as the set trap documents: the draft keeps its array, so the handle
// and any native write stay attached. Native JavaScript would detach the
// handle there; that difference is an open question, not a law of this block.
//
// Law, checked after the last step:
// - `x` is reported exactly when it differs from the original.
// - `f` is reported, with its final value, when it differs from the original.
//   When it equals the original, `f` may be reported, with its final value.
// - Reading the draft gives the model's final row.

type NativeRow = { x: number; f: { arr: Array<number>; g: { a?: number } } }
type NativeOp =
  | { op: `push`; v: number }
  | { op: `pop` }
  | { op: `reverse` }
  | { op: `assignArr`; items: Array<number> }
  | { op: `restoreArr` }
  | { op: `replaceG` }
  | { op: `setGa`; v: number }
  | { op: `retain` }
  | { op: `pushHandle`; v: number }
  | { op: `setX`; v: number }

const smallInt = fc.integer({ min: 0, max: 2 })
const nativeOpArb: fc.Arbitrary<NativeOp> = fc.oneof(
  smallInt.map((v): NativeOp => ({ op: `push`, v })),
  fc.constant<NativeOp>({ op: `pop` }),
  fc.constant<NativeOp>({ op: `reverse` }),
  fc
    .array(smallInt, { maxLength: 3 })
    .map((items): NativeOp => ({ op: `assignArr`, items })),
  { weight: 2, arbitrary: fc.constant<NativeOp>({ op: `restoreArr` }) },
  fc.constant<NativeOp>({ op: `replaceG` }),
  { weight: 2, arbitrary: smallInt.map((v): NativeOp => ({ op: `setGa`, v })) },
  fc.constant<NativeOp>({ op: `retain` }),
  smallInt.map((v): NativeOp => ({ op: `pushHandle`, v })),
  smallInt.map((v): NativeOp => ({ op: `setX`, v })),
)
type NativeHistory = { original: NativeRow; ops: Array<NativeOp> }
const nativeHistoryArb: fc.Arbitrary<NativeHistory> = fc.record({
  original: fc.record({
    x: smallInt,
    f: fc.record({
      arr: fc.array(smallInt, { maxLength: 3 }),
      g: fc.record({ a: smallInt }),
    }),
  }),
  ops: fc.array(nativeOpArb, { minLength: 1, maxLength: 8 }),
})

const cloneRow = (row: NativeRow): NativeRow => ({
  x: row.x,
  f: { arr: [...row.f.arr], g: { ...row.f.g } },
})
const sameRowPart = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

function nativeModel(history: NativeHistory): NativeRow {
  const row = cloneRow(history.original)
  let handle: Array<number> | undefined
  for (const action of history.ops) {
    switch (action.op) {
      case `push`:
        row.f.arr.push(action.v)
        break
      case `pop`:
        row.f.arr.pop()
        break
      case `reverse`:
        row.f.arr.reverse()
        break
      case `assignArr`:
      case `restoreArr`: {
        const next =
          action.op === `assignArr` ? action.items : history.original.f.arr
        // An assignment of an equal value is a no-op: the draft keeps its
        // array, so a retained handle stays attached.
        if (sameRowPart(next, row.f.arr)) break
        row.f.arr = [...next]
        break
      }
      case `replaceG`:
        row.f.g = {}
        break
      case `setGa`:
        row.f.g.a = action.v
        break
      case `retain`:
        handle = row.f.arr
        break
      case `pushHandle`:
        if (handle === undefined) break
        handle.push(action.v)
        break
      case `setX`:
        row.x = action.v
        break
    }
  }
  return row
}

function driveNative(history: NativeHistory): {
  changes: Record<string, unknown>
  read: unknown
} {
  const { proxy, getChanges } = createChangeProxy(
    cloneRow(history.original) as unknown as Record<string, unknown>,
  )
  const draft = proxy as unknown as NativeRow
  let handle: Array<number> | undefined
  for (const action of history.ops) {
    switch (action.op) {
      case `push`:
        draft.f.arr.push(action.v)
        break
      case `pop`:
        draft.f.arr.pop()
        break
      case `reverse`:
        draft.f.arr.reverse()
        break
      case `assignArr`:
        draft.f.arr = [...action.items]
        break
      case `restoreArr`:
        draft.f.arr = [...history.original.f.arr]
        break
      case `replaceG`:
        draft.f.g = {}
        break
      case `setGa`:
        draft.f.g.a = action.v
        break
      case `retain`:
        handle = draft.f.arr
        break
      case `pushHandle`:
        handle?.push(action.v)
        break
      case `setX`:
        draft.x = action.v
        break
    }
  }
  return {
    changes: getChanges(),
    read: { x: draft.x, f: { arr: [...draft.f.arr], g: { ...draft.f.g } } },
  }
}

function expectNativeHistory(history: NativeHistory): void {
  const final = nativeModel(history)
  const { changes, read } = driveNative(history)
  const context = JSON.stringify(history)
  expect(read, `draft reads the final row, ${context}`).toEqual(final)
  const xChanged = final.x !== history.original.x
  expect(`x` in changes, `x reported, ${context}`).toBe(xChanged)
  if (xChanged) expect(changes.x, `x value, ${context}`).toBe(final.x)
  const fChanged = !sameRowPart(final.f, history.original.f)
  expect(`f` in changes || !fChanged, `f reported, ${context}`).toBe(true)
  // An equal f may be reported, with its final value.
  if (`f` in changes) expect(changes.f, `f value, ${context}`).toEqual(final.f)
  expect(Object.keys(changes).sort(), `only x and f, ${context}`).toEqual(
    Object.keys(changes)
      .filter((key) => key === `x` || key === `f`)
      .sort(),
  )
}

describe(`draft revert oracle: native mutators mixed with assignments`, () => {
  for (const { name, seed } of campaigns) {
    it(`matches the model across generated native histories (${name})`, () => {
      fc.assert(fc.property(nativeHistoryArb, expectNativeHistory), {
        numRuns: 400,
        ...(seed === undefined ? {} : { seed }),
      })
    })
  }

  // Positive execution witness: the fixed campaign reaches a native write
  // that an assignment then replaces, and a mutator through a detached handle.
  it(`reaches replaced native writes and detached handles in the fixed campaign`, () => {
    const sample = fc.sample(nativeHistoryArb, {
      seed: FIXED_SEED,
      numRuns: 400,
    })
    const replaced = sample.filter((h) => {
      const first = h.ops.findIndex((o) =>
        [`push`, `pop`, `reverse`].includes(o.op),
      )
      return (
        first >= 0 &&
        h.ops
          .slice(first)
          .some((o) => o.op === `assignArr` || o.op === `restoreArr`)
      )
    })
    const detached = sample.filter((h) => {
      const retain = h.ops.findIndex((o) => o.op === `retain`)
      if (retain < 0) return false
      const after = h.ops.slice(retain + 1)
      const replace = after.findIndex(
        (o) => o.op === `assignArr` || o.op === `restoreArr`,
      )
      return (
        replace >= 0 &&
        after.slice(replace + 1).some((o) => o.op === `pushHandle`)
      )
    })
    expect(replaced.length).toBeGreaterThan(20)
    expect(detached.length).toBeGreaterThan(3)
  })

  it.each<[string, NativeHistory]>([
    [
      `a native write that an assignment then restores reports at most its original value`,
      {
        original: { x: 0, f: { arr: [1], g: { a: 0 } } },
        ops: [
          { op: `setX`, v: 1 },
          { op: `push`, v: 2 },
          { op: `restoreArr` },
          { op: `replaceG` },
          { op: `setGa`, v: 0 },
        ],
      },
    ],
    [
      `a mutator through a detached handle changes nothing in the row`,
      {
        original: { x: 0, f: { arr: [1], g: { a: 0 } } },
        ops: [
          { op: `retain` },
          { op: `assignArr`, items: [1, 2] },
          { op: `restoreArr` },
          { op: `pushHandle`, v: 0 },
        ],
      },
    ],
    [
      `restoring the last native write reports at most the original value`,
      {
        original: { x: 0, f: { arr: [0], g: { a: 0 } } },
        ops: [
          { op: `pop` },
          { op: `replaceG` },
          { op: `restoreArr` },
          { op: `setGa`, v: 0 },
        ],
      },
    ],
  ])(`%s`, (_name, history) => expectNativeHistory(history))

  // The generated row nests the native site two levels deep. One level more
  // checks that a report three levels up still carries the final value.
  it(`restoring a native write three levels deep reports at most the original value`, () => {
    const row = { f: { h: { arr: [0] }, g: { a: 0 } } }
    const changes = withChangeTracking(structuredClone(row), (draft) => {
      draft.f.h.arr.pop()
      draft.f.g = {} as { a: number }
      draft.f.h.arr = [0]
      draft.f.g.a = 0
    })
    expect(Object.keys(changes).every((key) => key === `f`)).toBe(true)
    if (`f` in changes) expect(changes.f).toEqual(row.f)
  })

  // A native write through any handle that reaches the row's value is a
  // change, and a missed change is the error that matters. These handles share
  // their parent's value: a Map or Set value, a typed-array view, and a value
  // read through a frozen draft.
  it.each<[string, Record<string, unknown>, (draft: any) => void, string]>([
    [
      `a Map value`,
      { m: new Map([[`k`, [1]]]) },
      (draft) => draft.m.get(`k`).push(2),
      `m`,
    ],
    [
      `a Map value from iteration`,
      { m: new Map([[`k`, [1]]]) },
      (draft) => {
        for (const value of draft.m.values()) value.push(2)
      },
      `m`,
    ],
    [
      `a Set value from iteration`,
      { s: new Set([[1]]) },
      (draft) => {
        for (const value of draft.s) value.push(2)
      },
      `s`,
    ],
    [
      `a typed-array view`,
      { t: new Float64Array([1, 2, 3]) },
      (draft) => draft.t.subarray(1).fill(9),
      `t`,
    ],
    [
      `a value read through a frozen draft`,
      { f: { arr: [1] } },
      (draft) => Object.freeze(draft).f.arr.push(2),
      `f`,
    ],
  ])(`reports a native write through %s`, (_name, row, write, key) => {
    const changes = withChangeTracking(row, write)
    expect(key in changes).toBe(true)
  })

  // A nested revert inside a Map or Set value must not hide another write to
  // the same container.
  it.each<[string, Record<string, unknown>, (draft: any) => void, string]>([
    [
      `a Map`,
      { m: new Map<string, unknown>([[`k`, { a: 0 }]]) },
      (draft) => {
        draft.m.set(`j`, 1)
        draft.m.get(`k`).a = 1
        draft.m.get(`k`).a = 0
      },
      `m`,
    ],
    [
      `a Set`,
      { s: new Set<unknown>([{ a: 0 }]) },
      (draft) => {
        draft.s.add(1)
        for (const value of draft.s) if (typeof value === `object`) value.a = 1
        for (const value of draft.s) if (typeof value === `object`) value.a = 0
      },
      `s`,
    ],
  ])(
    `a nested revert in %s keeps its other write`,
    (_name, row, write, key) => {
      const changes = withChangeTracking(row, write)
      expect(key in changes).toBe(true)
    },
  )
})
