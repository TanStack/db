import { expect, it } from 'vitest'
import { transformPublicContainers } from '../../src/query/compiler/route-metadata.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

it.each(
  ([`object`, `array`] as const).flatMap((kind) =>
    [false, true].map((ordered) => ({ kind, ordered })),
  ),
)(
  `preserves $kind reference-key matches through an ordered=$ordered projected source`,
  async ({ kind, ordered }) => {
    const makeKey = (code: number): object =>
      kind === `object` ? { code } : [code]
    const key = makeKey(1)
    const other = makeKey(2)
    const parents = createControlledCollection(`copy-parents`, [
      { id: 1, group: 1, key },
    ])
    const children = createControlledCollection(`copy-children`, [
      { id: 10, group: 1, key },
      { id: 20, group: 1, key: makeKey(1) },
      { id: 30, group: 1, key: other },
    ])
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const filtered = q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.group, parent.group))
        const source = (
          ordered ? filtered.orderBy(({ child }) => child.id) : filtered
        ).select(({ child }) => ({ id: child.id, key: child.key }))
        const matches = q
          .from({ inner: source })
          .where(({ inner }) => eq(inner.key, parent.key))
          .select(({ inner }) => ({ id: inner.id }))
        return {
          id: parent.id,
          collection: matches,
          array: toArray(matches),
          materialized: materialize(matches),
        }
      }),
    )
    const check = (expected: Array<number>) => {
      const row = live.get(1)!
      for (const values of [
        row.collection.toArray,
        row.array,
        row.materialized,
      ]) {
        expect(values.map(({ id }) => id).sort((a, b) => a - b)).toEqual(
          expected,
        )
      }
    }
    try {
      await live.preload()
      check([10])
      parents.write(`update`, { id: 1, group: 1, key: other })
      check([30])
      children.write(`update`, { id: 10, group: 1, key: other })
      check([10, 30])
      children.write(`delete`, { id: 30, group: 1, key: other })
      check([10])
    } finally {
      await live.cleanup()
      await Promise.all([
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  },
)

it.each([false, true])(
  `copies public descriptors with null prototype=%s`,
  (nullPrototype) => {
    const privateKey = Symbol(`private`)
    const publicKey = Symbol(`public`)
    const opaque = new Date(0)
    const replacement = new Map()
    const reference = { token: true }
    const child = { [privateKey]: true, value: 1 }
    const input = Object.create(
      nullPrototype ? null : Object.prototype,
    ) as Record<PropertyKey, unknown>
    let reads = 0
    const getter = () => {
      reads++
      return 7
    }
    Object.defineProperties(input, {
      child: { value: child, enumerable: true, writable: false },
      alias: { value: child, enumerable: true },
      leaf: { value: reference, enumerable: true },
      opaque: { value: opaque, enumerable: true },
      hidden: { value: 4, enumerable: false },
      accessor: { get: getter, enumerable: true },
      [`__proto__`]: { value: `user property`, enumerable: true },
      [publicKey]: { value: child, enumerable: true },
      [privateKey]: { value: true },
      self: { value: input, enumerable: true },
    })
    const result = transformPublicContainers(
      input,
      (value) => (value === reference ? replacement : value),
      new Set([privateKey]),
    ) as typeof input
    expect(reads).toBe(0)
    expect(Object.getPrototypeOf(result)).toBe(Object.getPrototypeOf(input))
    expect(Reflect.ownKeys(result)).toEqual(
      Reflect.ownKeys(input).filter((key) => key !== privateKey),
    )
    expect(result.child).toEqual({ value: 1 })
    expect(result.alias).toBe(result.child)
    expect(result[publicKey]).toBe(result.child)
    expect(result.self).toBe(result)
    expect(result.leaf).toBe(replacement)
    expect(result.opaque).toBe(opaque)
    expect(result[`__proto__`]).toBe(`user property`)
    expect(Object.getOwnPropertyDescriptor(result, `child`)).toEqual({
      value: result.child,
      enumerable: true,
      writable: false,
      configurable: false,
    })
    expect(Object.getOwnPropertyDescriptor(result, `accessor`)?.get).toBe(
      getter,
    )
    expect(Object.getOwnPropertyDescriptor(result, `hidden`)).toEqual(
      Object.getOwnPropertyDescriptor(input, `hidden`),
    )
    expect(child[privateKey]).toBe(true)
    expect(input.self).toBe(input)
  },
)

it(`preserves sparse arrays and locked lengths while removing private keys`, () => {
  const privateKey = Symbol(`private`)
  const input: Array<Record<PropertyKey, unknown>> = new Array(4)
  input[2] = { value: 2, [privateKey]: true }
  Object.defineProperty(input, `length`, { writable: false })
  const result = transformPublicContainers(
    input,
    (value) => value,
    new Set([privateKey]),
  ) as Array<unknown>
  const expected = new Array(4)
  expected[2] = { value: 2 }
  expect(result).toEqual(expected)
  expect(Object.hasOwn(result, 0)).toBe(false)
  expect(Object.getOwnPropertyDescriptor(result, `length`)).toEqual(
    Object.getOwnPropertyDescriptor(input, `length`),
  )
  expect(input[2][privateKey]).toBe(true)
})
