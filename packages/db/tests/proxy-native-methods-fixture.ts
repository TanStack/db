// Shared generators, call tables, and observers for the native-method oracle and
// its ordinary coverage tests. The oracle owns the law; these are its inputs.
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { withChangeTracking } from '../src/proxy'

export const FIXED_SEED = 2026102
export const RUNS = 400
export const ARRAY_METHODS = `proxy.native-array-methods`
export const TYPED_METHODS = `proxy.native-typed-methods`

export const prototypeMethods = (prototype: object, skip: Set<string>) =>
  Object.getOwnPropertyNames(prototype).filter(
    (name) =>
      !skip.has(name) &&
      typeof Object.getOwnPropertyDescriptor(prototype, name)?.value ===
        `function`,
  )

// ---------------------------------------------------------------------------
// Arrays.

// Original objects have `x` from 0 to 3; objects the callback inserts have
// `x` of 5 or more, so identity can be checked for original objects only.
export type Item = { x: number }
export type Element = number | undefined | Item | Array<Item>
export type ElementSpec = Element | `hole`
export type ArrayRow = { items: Array<Element> }

export const itemArb = fc.integer({ min: 0, max: 3 }).map((x): Item => ({ x }))
export const elementArb: fc.Arbitrary<ElementSpec> = fc.oneof(
  fc.integer({ min: 0, max: 3 }),
  fc.constant(undefined),
  fc.constant(`hole` as const),
  itemArb,
  fc.array(itemArb, { maxLength: 2 }),
)
export const arraySpecArb = fc.array(elementArb, { maxLength: 4 })

export function realizeArray(spec: Array<ElementSpec>): ArrayRow {
  const items: Array<Element> = []
  items.length = spec.length
  spec.forEach((element, i) => {
    if (element === `hole`) return
    items[i] =
      typeof element === `object`
        ? (JSON.parse(JSON.stringify(element)) as Item | Array<Item>)
        : element
  })
  return { items }
}

export const readsObject = (v: unknown) => typeof v === `object`
export const arrayMethods = prototypeMethods(
  Array.prototype,
  new Set([`constructor`]),
)
// Arguments for each method, from the row and an index-shaped number `k`.
export const arrayCalls: Record<
  string,
  (row: ArrayRow, k: number) => Array<unknown>
> = {
  at: (_row, k) => [k - 2],
  concat: (row) => [[{ x: 9 }], row.items],
  copyWithin: (_row, k) => [0, k],
  entries: () => [],
  every: () => [readsObject],
  fill: (_row, k) => [{ x: 6 }, k],
  filter: () => [readsObject],
  find: () => [readsObject],
  findIndex: () => [readsObject],
  findLast: () => [readsObject],
  findLastIndex: () => [readsObject],
  flat: () => [],
  flatMap: () => [(v: unknown) => v],
  forEach: () => [() => undefined],
  includes: (row, k) => [row.items[k % Math.max(row.items.length, 1)]],
  indexOf: (row, k) => [row.items[k % Math.max(row.items.length, 1)]],
  join: () => [`,`],
  keys: () => [],
  lastIndexOf: (row, k) => [row.items[k % Math.max(row.items.length, 1)]],
  map: () => [(v: unknown) => v],
  pop: () => [],
  push: () => [{ x: 5 }],
  reduce: () => [(_acc: unknown, v: unknown) => v, 0],
  reduceRight: () => [(_acc: unknown, v: unknown) => v, 0],
  reverse: () => [],
  shift: () => [],
  slice: (_row, k) => [k - 2, k],
  some: () => [readsObject],
  sort: () => [() => 0],
  splice: (_row, k) => [k, 1, { x: 7 }],
  toLocaleString: () => [],
  toReversed: () => [],
  toSorted: () => [() => 0],
  toSpliced: (_row, k) => [k, 1],
  toString: () => [],
  unshift: () => [{ x: 5 }],
  values: () => [],
  with: () => [0, { x: 7 }],
}

// Objects reachable from a result, in visit order, without repeats.
export function objectsIn(
  value: unknown,
  seen: Array<object> = [],
): Array<object> {
  if (value === null || typeof value !== `object` || seen.includes(value))
    return seen
  seen.push(value)
  for (const child of Array.isArray(value) ? value : Object.values(value))
    objectsIn(child, seen)
  return seen
}

export function observeArray(row: ArrayRow, method: string, k: number) {
  const call = (
    row.items as unknown as Record<string, (...a: Array<unknown>) => unknown>
  )[method]!
  let raw: unknown
  try {
    raw = call.apply(row.items, arrayCalls[method]!(row, k))
  } catch (error) {
    // A native error, such as a RangeError from `with`, is an observation.
    return { threw: (error as Error).constructor.name }
  }
  const returnsSelf = raw === row.items
  const result =
    raw !== null && typeof raw === `object` && Symbol.iterator in raw
      ? [...(raw as Iterable<unknown>)]
      : raw
  const snapshot = JSON.stringify(result ?? null)
  const originals = objectsIn(result).filter(
    (o): o is Item => !Array.isArray(o) && (o as Item).x <= 3,
  )
  // Where each original object of the result sits in the row, by identity.
  const identity = originals.map((o) =>
    row.items.flatMap((element, i) =>
      element === o
        ? [i]
        : Array.isArray(element) && element.includes(o)
          ? [i + 0.5]
          : [],
    ),
  )
  for (const o of originals) o.x += 100
  return { snapshot, returnsSelf, identity }
}

// Holes count: a detached array must preserve the native array's holes.
export const encodeArray = (items: Array<Element>) =>
  JSON.stringify({ items, present: items.map((_, i) => i in items) })

export function expectArrayCall(
  spec: Array<ElementSpec>,
  method: string,
  k: number,
): void {
  const native = realizeArray(spec)
  const expected = observeArray(native, method, k)
  let actual: unknown
  const changes = withChangeTracking(realizeArray(spec), (draft) => {
    actual = observeArray(draft, method, k)
  })
  const context = JSON.stringify({ spec, method, k })
  expect(actual, `result, ${context}`).toEqual(expected)
  const changed =
    encodeArray(native.items) !== encodeArray(realizeArray(spec).items)
  const detachedItems = (changes as Partial<ArrayRow>).items
  if (changed || detachedItems !== undefined)
    expect(
      detachedItems && encodeArray(detachedItems),
      `detached items, ${context}`,
    ).toBe(encodeArray(native.items))
  if (!changed && !MUTATORS.has(method))
    expect(changes, `no change, ${context}`).toEqual({})
}
export const MUTATORS = new Set([
  `copyWithin`,
  `fill`,
  `pop`,
  `push`,
  `reverse`,
  `shift`,
  `sort`,
  `splice`,
  `unshift`,
])
export type TypedRow = { t: Float64Array }
export const typedSpecArb = fc.array(fc.constantFrom(0, -0, 1, 2, NaN, 3.5), {
  maxLength: 4,
})
export const typedArrayPrototype = Object.getPrototypeOf(Float64Array.prototype)
export const typedMethods = prototypeMethods(
  typedArrayPrototype,
  new Set([`constructor`]),
)
export const positive = (v: number) => v > 1
export const sum = (a: number, v: number) => a + v
export const typedCalls: Record<string, (k: number) => Array<unknown>> = {
  at: (k) => [k - 2],
  copyWithin: (k) => [0, k],
  entries: () => [],
  every: () => [positive],
  fill: (k) => [7, k],
  filter: () => [positive],
  find: () => [positive],
  findIndex: () => [positive],
  findLast: () => [positive],
  findLastIndex: () => [positive],
  forEach: () => [() => undefined],
  includes: () => [NaN],
  indexOf: () => [1],
  join: () => [`,`],
  keys: () => [],
  lastIndexOf: () => [1],
  map: () => [(v: number) => v * 2],
  reduce: () => [sum, 0],
  reduceRight: () => [sum, 0],
  reverse: () => [],
  set: () => [[9]],
  slice: (k) => [k - 2, k],
  some: () => [positive],
  sort: () => [],
  subarray: (k) => [k - 2, k],
  toLocaleString: () => [],
  toReversed: () => [],
  toSorted: () => [],
  toString: () => [],
  values: () => [],
  with: () => [0, 9],
}
export const TYPED_MUTATORS = new Set([
  `copyWithin`,
  `fill`,
  `reverse`,
  `set`,
  `sort`,
])

export function observeTyped(
  row: TypedRow,
  method: string,
  k: number,
  write: boolean,
) {
  const call = (
    row.t as unknown as Record<string, (...a: Array<unknown>) => unknown>
  )[method]!
  let raw: unknown
  try {
    raw = call.apply(row.t, typedCalls[method]!(k))
  } catch (error) {
    return { threw: (error as Error).constructor.name }
  }
  const returnsSelf = raw === row.t
  const result =
    raw !== null && typeof raw === `object` && Symbol.iterator in raw
      ? Array.from(raw as Iterable<unknown>, String)
      : String(raw)
  // A write through a typed-array result changes the row when it shares the
  // buffer (`subarray`).
  if (write && raw instanceof Float64Array && raw.length > 0) raw[0] = 42
  return { result, returnsSelf }
}

export const encodeTyped = (t: Float64Array) => Array.from(t, (v) => String(v))

export function expectTypedCall(
  values: Array<number>,
  method: string,
  k: number,
  write: boolean,
): void {
  const make = (): TypedRow => ({ t: Float64Array.from(values) })
  const native = make()
  const expected = observeTyped(native, method, k, write)
  let actual: unknown
  const changes = withChangeTracking(make(), (draft) => {
    actual = observeTyped(draft, method, k, write)
  })
  const context = JSON.stringify({
    values: values.map(String),
    method,
    k,
    write,
  })
  expect(actual, `result, ${context}`).toEqual(expected)
  // -0 differs from 0 here: a typed array stores the sign.
  const changed = native.t.some((v, i) => !Object.is(v, values[i]))
  const detachedArray = (changes as Partial<TypedRow>).t
  if (changed || detachedArray !== undefined)
    expect(
      detachedArray && encodeTyped(detachedArray),
      `detached typed array, ${context}`,
    ).toEqual(encodeTyped(native.t))
  if (!changed && !TYPED_MUTATORS.has(method))
    expect(changes, `no change, ${context}`).toEqual({})
}
