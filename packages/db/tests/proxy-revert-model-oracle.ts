// The plain-data value specs, history grammars, and transition model of the
// draft revert oracle. The law, its authority, and its limits are stated in
// proxy-revert-oracle.property.test.ts, which drives production against this
// model; proxy-revert-census.test.ts samples the same grammars. This module
// registers no tests and has no side effects.
import { fc } from '@fast-check/vitest'

// ---------------------------------------------------------------------------
// Value specs. The model works on plain-data specs and never reads a draft.

export const S = Symbol(`s`)
export const PRIMITIVES = [0, -0, 1, NaN, `a`, `b`, null, undefined] as const
export type Primitive = (typeof PRIMITIVES)[number]

export type Spec =
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
export type MapValue = Primitive | { set: Array<string> }
export const isSetValue = (v: MapValue): v is { set: Array<string> } =>
  typeof v === `object` && v !== null
export const mapValue = (v: MapValue): unknown =>
  isSetValue(v) ? [`set`, v.set] : prim(v)

// Typed arrays, including a subclass whose constructor ignores its argument,
// so a clone must not rely on constructor arguments to copy elements.
export type TypedKind = `f64` | `u8` | `vec3`
export class Vec3 extends Float64Array {
  constructor() {
    super(3)
  }
}
export const typedKind = (value: unknown): TypedKind | undefined =>
  value instanceof Vec3
    ? `vec3`
    : value instanceof Float64Array
      ? `f64`
      : value instanceof Uint8Array
        ? `u8`
        : undefined

// A class whose only state is a private field, so it has no enumerable keys.
export class Secret {
  #v: number
  constructor(v: number) {
    this.#v = v
  }
  read(): number {
    return this.#v
  }
}

// A class instance with one enumerable key.
export class Point {
  constructor(public a: unknown) {}
}

export const HOLE = Symbol(`hole`)
export const FIELDS = [`f`, `g`, `h`] as const
export type Field = (typeof FIELDS)[number]
export type Root = Partial<Record<Field, Spec>>

// Draft equality as an encoding. Equal encodings mean equal values.
export function encode(spec: Spec | undefined): string {
  return JSON.stringify(canon(spec))
}
// SameValue preserves the sign that String(number) and JSON numbers erase.
// This token is independent of the production draft comparator.
export function numberToken(value: number): string {
  return Object.is(value, -0) ? `-0` : String(value)
}
export function prim(v: Primitive | undefined): unknown {
  return typeof v === `number` ? [`num`, numberToken(v)] : [typeof v, v ?? null]
}
export function canon(spec: Spec | undefined): unknown {
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
      // Elements follow rule 1: -0 differs from 0 and NaN equals NaN. The class is
      // part of the value.
      return [`typed`, spec.ctor, spec.values.map(numberToken)]
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

export function realize(spec: Spec): unknown {
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

export function realizeRoot(root: Root): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const field of FIELDS) {
    const spec = root[field]
    if (spec) value[field] = realize(spec)
  }
  return value
}

// ---------------------------------------------------------------------------
// Grammar.

export const primArb = fc.constantFrom(...PRIMITIVES)
export const specArb: fc.Arbitrary<Spec> = fc.oneof(
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
export const writtenArb: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 9, arbitrary: specArb },
  fc.constantFrom(1, 2).map((v): Spec => ({ k: `secret`, v })),
)

export type Op =
  | { op: `set`; field: Field; value: Spec }
  // `same` writes the original row's own value back instead of an equal
  // fresh value, so identity-based paths are reached too.
  | { op: `revert`; field: Field; same?: boolean }
  | { op: `delete`; field: Field }
  | { op: `nested`; field: Field; key: `a` | `b` | `sym`; value: Primitive }
  | { op: `nestedDelete`; field: Field; key: `a` | `b` | `sym` }
  | { op: `index`; field: Field; index: number; value: Primitive }
  | { op: `forOf`; field: Field; index: number; value: Primitive }

export const opArb: fc.Arbitrary<Op> = fc.oneof(
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
export type GeneratedOp = Op | { op: `revertChanged`; pick: number }
export type History = { original: Root; ops: Array<GeneratedOp> }

export function resolve(
  state: Root,
  original: Root,
  op: GeneratedOp,
): Op | undefined {
  if (op.op !== `revertChanged`) return op
  const changed = FIELDS.filter(
    (field) => encode(state[field]) !== encode(original[field]),
  )
  return changed.length > 0
    ? { op: `revert`, field: changed[op.pick % changed.length]! }
    : undefined
}
export const historyArb: fc.Arbitrary<History> = fc.record({
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
export const partialRevertArb: fc.Arbitrary<History> = fc
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
export const urlOrSecretArb: fc.Arbitrary<Spec> = fc.oneof(
  fc
    .constantFrom(`a` as const, `b` as const)
    .map((path): Spec => ({ k: `url`, path })),
  fc.constantFrom(1, 2).map((v): Spec => ({ k: `secret`, v })),
)
export const classWriteArb: fc.Arbitrary<History> = fc
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
export const nestedRoundTripArb: fc.Arbitrary<History> = fc
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

// A sign-only write must survive each assignment path. Random fields, nested
// keys and typed-array positions vary the access path without another value
// change masking a lost zero sign. Both signs are legal; Uint8Array is excluded
// because native integer conversion cannot retain -0. Removing a path loses
// its draft boundary; removing the sign distinction admits the old comparator.
export const signedZeroPaths = [`root`, `nested`, `float64`] as const
export const signedZeroArb = fc.record({
  path: fc.constantFrom(...signedZeroPaths),
  field: fc.constantFrom(...FIELDS),
  negative: fc.boolean(),
  key: fc.constantFrom(`a` as const, `b` as const, `sym` as const),
  width: fc.integer({ min: 1, max: 3 }),
  index: fc.nat(2),
})
export type SignedZeroInput =
  typeof signedZeroArb extends fc.Arbitrary<infer T> ? T : never
export function signedZeroHistory(input: SignedZeroInput): History {
  const before = input.negative ? -0 : 0
  const after = input.negative ? 0 : -0
  let original: Spec
  let op: Op
  if (input.path === `root`) {
    original = { k: `prim`, v: before }
    op = { op: `set`, field: input.field, value: { k: `prim`, v: after } }
  } else if (input.path === `nested`) {
    original = { k: `obj`, [input.key]: before }
    op = { op: `nested`, field: input.field, key: input.key, value: after }
  } else {
    const index = input.index % input.width
    original = {
      k: `typed`,
      ctor: `f64`,
      values: Array.from({ length: input.width }, (_, at) =>
        at === index ? before : 1,
      ),
    }
    op = { op: `index`, field: input.field, index, value: after }
  }
  return { original: { [input.field]: original }, ops: [op] }
}

// ---------------------------------------------------------------------------
// Model: apply each op to the spec state. An op whose target has the wrong
// shape does nothing, and the driver skips it the same way.

export function applicable(state: Root, original: Root, op: Op): boolean {
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

export function step(state: Root, original: Root, op: Op): Root {
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

export function expectedChanges(
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

export const FIXED_SEED = 2026101

// Native mutators mixed with assignments: the grammar.

export type NativeRow = {
  x: number
  f: { arr: Array<number>; g: { a?: number } }
}
export type NativeOp =
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

export const smallInt = fc.integer({ min: 0, max: 2 })
export const nativeOpArb: fc.Arbitrary<NativeOp> = fc.oneof(
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
export type NativeHistory = { original: NativeRow; ops: Array<NativeOp> }
export const nativeHistoryArb: fc.Arbitrary<NativeHistory> = fc.record({
  original: fc.record({
    x: smallInt,
    f: fc.record({
      arr: fc.array(smallInt, { maxLength: 3 }),
      g: fc.record({ a: smallInt }),
    }),
  }),
  ops: fc.array(nativeOpArb, { minLength: 1, maxLength: 8 }),
})
