import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { withChangeTracking } from '../src/proxy'

/**
 * # Do built-in array and typed-array methods behave on a draft as natively?
 *
 * Contract: a draft behaves like the native value it represents. Every
 * built-in method called on a draft array or typed array gives the native
 * result, returns the draft where the native method returns the array itself,
 * hands out drafts of the row's objects, and reports changes that reconstruct
 * the native row's final value.
 *
 * Model: the same call on a native row of equal data. The expected result
 * never reads a draft or production code.
 *
 * Grammar: a row value (an array of numbers, `undefined`, holes, objects, and
 * nested arrays of objects; or a `Float64Array` with `-0` and `NaN`), a method
 * from the built-in prototype, an index-shaped argument, and an optional write
 * through the result. The method list comes from `Array.prototype` and the
 * shared `TypedArray.prototype`, so a new built-in method fails the argument
 * check until it has arguments.
 *
 * Driver: `withChangeTracking` runs the same call on a draft of an equal row.
 *
 * Check, after the callback returns and its changes are detached: the call's
 * result or the class of the error it threw, whether it returned
 * the array itself, the row index of each original object in the result, and
 * the detached field value after the optional write.
 *
 * Authority: the draft contract in `src/proxy.ts` and the native-differential
 * laws in `tests/proxy-oracle.test.ts`.
 *
 * Limits:
 * - A mutator that changes nothing may report an equal value in its change
 *   set. Mutators mark a change without a revert check (see the revert oracle's
 *   limits).
 * - An object the callback inserts reads back as a draft, not as itself, so
 *   identity is checked only for objects of the original row.
 * - Callback arguments are fixed per method. The callbacks read only.
 */

// ---------------------------------------------------------------------------
// Campaigns. `TANSTACK_DB_PROXY_NATIVE_SEED` and
// `TANSTACK_DB_PROXY_NATIVE_PATH` select a direct replay.

const replaySeed = process.env.TANSTACK_DB_PROXY_NATIVE_SEED
const replayPath = process.env.TANSTACK_DB_PROXY_NATIVE_PATH
const FIXED_SEED = 2026102
const RUNS = 400
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
function campaignOptions(seed: number | undefined): fc.Parameters<unknown> {
  if (replayPath !== undefined && replaySeed === undefined)
    throw new Error(`TANSTACK_DB_PROXY_NATIVE_PATH requires a seed`)
  if (seed !== undefined && !Number.isSafeInteger(seed))
    throw new Error(`TANSTACK_DB_PROXY_NATIVE_SEED must be an integer`)
  return {
    numRuns: RUNS,
    ...(seed === undefined ? {} : { seed }),
    ...(replayPath === undefined ? {} : { path: replayPath }),
  }
}

const prototypeMethods = (prototype: object, skip: Set<string>) =>
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
type Item = { x: number }
type Element = number | undefined | Item | Array<Item>
type ElementSpec = Element | `hole`
type ArrayRow = { items: Array<Element> }

const itemArb = fc.integer({ min: 0, max: 3 }).map((x): Item => ({ x }))
const elementArb: fc.Arbitrary<ElementSpec> = fc.oneof(
  fc.integer({ min: 0, max: 3 }),
  fc.constant(undefined),
  fc.constant(`hole` as const),
  itemArb,
  fc.array(itemArb, { maxLength: 2 }),
)
const arraySpecArb = fc.array(elementArb, { maxLength: 4 })

function realizeArray(spec: Array<ElementSpec>): ArrayRow {
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

const readsObject = (v: unknown) => typeof v === `object`
const arrayMethods = prototypeMethods(Array.prototype, new Set([`constructor`]))
// Arguments for each method, from the row and an index-shaped number `k`.
const arrayCalls: Record<string, (row: ArrayRow, k: number) => Array<unknown>> =
  {
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
function objectsIn(value: unknown, seen: Array<object> = []): Array<object> {
  if (value === null || typeof value !== `object` || seen.includes(value))
    return seen
  seen.push(value)
  for (const child of Array.isArray(value) ? value : Object.values(value))
    objectsIn(child, seen)
  return seen
}

function observeArray(row: ArrayRow, method: string, k: number) {
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
const encodeArray = (items: Array<Element>) =>
  JSON.stringify({ items, present: items.map((_, i) => i in items) })

function expectArrayCall(
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
const MUTATORS = new Set([
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

describe(`array methods behave like native arrays`, () => {
  it(`has arguments for every method`, () => {
    expect(arrayMethods.filter((name) => !(name in arrayCalls))).toEqual([])
  })

  // The row of the original pinned table, for every method.
  it.each(arrayMethods)(`%s on a fixed row gives the native result`, (m) => {
    for (const k of [0, 1, 3])
      expectArrayCall([{ x: 1 }, 2, [{ x: 3 }], { x: 0 }], m, k)
  })

  for (const { name, seed } of campaigns) {
    it(`matches native arrays across generated rows (${name})`, () => {
      fc.assert(
        fc.property(
          arraySpecArb,
          fc.constantFrom(...arrayMethods),
          fc.nat(4),
          expectArrayCall,
        ),
        campaignOptions(seed),
      )
    })
  }

  it(`reaches every method, holes, empty rows, and nested objects in the fixed campaign`, () => {
    const sample = fc.sample(
      fc.tuple(arraySpecArb, fc.constantFrom(...arrayMethods), fc.nat(4)),
      { seed: FIXED_SEED, numRuns: RUNS },
    )
    expect(new Set(sample.map(([, m]) => m)).size).toBe(arrayMethods.length)
    expect(sample.filter(([spec]) => spec.length === 0).length).toBeGreaterThan(
      0,
    )
    expect(
      sample.filter(([spec]) => spec.includes(`hole`)).length,
    ).toBeGreaterThan(0)
    expect(
      sample.filter(([spec]) => spec.some((e) => Array.isArray(e))).length,
    ).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Typed arrays.

type TypedRow = { t: Float64Array }
const typedSpecArb = fc.array(fc.constantFrom(0, -0, 1, 2, NaN, 3.5), {
  maxLength: 4,
})
const typedArrayPrototype = Object.getPrototypeOf(Float64Array.prototype)
const typedMethods = prototypeMethods(
  typedArrayPrototype,
  new Set([`constructor`]),
)
const positive = (v: number) => v > 1
const sum = (a: number, v: number) => a + v
const typedCalls: Record<string, (k: number) => Array<unknown>> = {
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
const TYPED_MUTATORS = new Set([`copyWithin`, `fill`, `reverse`, `set`, `sort`])

function observeTyped(
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

const encodeTyped = (t: Float64Array) => Array.from(t, (v) => String(v))

function expectTypedCall(
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

describe(`typed-array methods behave like native typed arrays`, () => {
  it(`has arguments for every method`, () => {
    expect(typedMethods.filter((name) => !(name in typedCalls))).toEqual([])
  })

  // The row of the original pinned table, for every method.
  it.each(typedMethods)(`%s on a fixed row gives the native result`, (m) => {
    for (const write of [false, true]) expectTypedCall([3, 1, 2], m, 1, write)
  })

  for (const { name, seed } of campaigns) {
    it(`matches native typed arrays across generated rows (${name})`, () => {
      fc.assert(
        fc.property(
          typedSpecArb,
          fc.constantFrom(...typedMethods),
          fc.nat(4),
          fc.boolean(),
          expectTypedCall,
        ),
        campaignOptions(seed),
      )
    })
  }

  it(`reaches every method, empty rows, NaN, and -0 in the fixed campaign`, () => {
    const sample = fc.sample(
      fc.tuple(typedSpecArb, fc.constantFrom(...typedMethods)),
      { seed: FIXED_SEED, numRuns: RUNS },
    )
    expect(new Set(sample.map(([, m]) => m)).size).toBe(typedMethods.length)
    expect(sample.some(([v]) => v.length === 0)).toBe(true)
    expect(sample.some(([v]) => v.some((x) => Number.isNaN(x)))).toBe(true)
    expect(sample.some(([v]) => v.some((x) => Object.is(x, -0)))).toBe(true)
  })
})
