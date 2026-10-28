import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { createChangeProxy, withChangeTracking } from '../src/proxy'
import { makeFrozenRow, makeStoredRow } from './proxy-native-rows'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config'
import { declareOracle } from './oracle-declaration'
import type { FrozenRow, StoredRow } from './proxy-native-rows'

/**
 * # Does a draft behave like the native value it represents?
 *
 * A mutation draft promises ordinary JavaScript object, array, Map, Set, Date,
 * RegExp, class, and Temporal behavior while recording the smallest correct
 * change set. Reads must not create changes. Writes and deletes must preserve
 * descriptors, keys, iteration, cycles, aliases, and revert-to-original rules.
 * The input object must remain unchanged.
 *
 * Pinned examples of individual language operations live in proxy.test.ts.
 * The array callback oracle is differential: it runs the same callback history on a plain native row and
 * on a draft, then compares callback results, visit order, reconstructed rows,
 * change records, peers, and the untouched baseline. Generated two-step
 * histories explore interactions that single method tests cannot reach.
 *
 * Detachment and Map/Set iterator identity have deeper contract owners in the
 * companion files. Keeping those graphs separate prevents this broad language
 * conformance suite from growing another copy of their models.
 */

const accessPaths = [
  `element`,
  `array`,
  `accumulator`,
  `values`,
  `entries`,
] as const

const callbackMethods = [
  `forEach`,
  `some`,
  `every`,
  `map`,
  `reduce`,
  `reduceRight`,
  `find`,
  `filter`,
] as const
type CallbackMethod = (typeof callbackMethods)[number]
type CallbackRow = { items: Array<{ id: number; value: number }>; peer: string }
type CallbackStep = { method: CallbackMethod; target: number; delta: number }

// The same authored operation runs on separate native and draft rows. Neither
// the native interpreter nor its observations use production tracking helpers.
function runArrayCallback(row: CallbackRow, step: CallbackStep) {
  const visits: Array<number> = []
  const target = step.target % row.items.length
  const visit = (item: CallbackRow[`items`][number]) => {
    visits.push(item.id)
    if (item.id === target) item.value += step.delta
    return item.id === target
  }
  let result: number | boolean | Array<number> | void
  switch (step.method) {
    case `forEach`:
      result = row.items.forEach(visit)
      break
    case `some`:
      result = row.items.some(visit)
      break
    case `every`:
      result = row.items.every((item) => !visit(item))
      break
    case `map`:
      result = row.items.map((item) => {
        visit(item)
        return item.value
      })
      break
    case `reduce`:
      result = row.items.reduce((sum, item) => {
        visit(item)
        return sum + item.value
      }, 0)
      break
    case `reduceRight`:
      result = row.items.reduceRight((sum, item) => {
        visit(item)
        return sum + item.value
      }, 0)
      break
    case `find`:
      result = row.items.find(visit)?.id
      break
    case `filter`:
      result = row.items.filter(visit).map((item) => item.id)
      break
  }
  return { visits, result }
}

function copyCallbackRow(row: CallbackRow): CallbackRow {
  return { items: row.items.map((item) => ({ ...item })), peer: row.peer }
}

function observeArrayCallbacks(
  values: Array<number>,
  steps: Array<CallbackStep>,
) {
  const initial: CallbackRow = {
    items: values.map((value, id) => ({ id, value })),
    peer: `untouched`,
  }
  const original = copyCallbackRow(initial)
  const native = copyCallbackRow(initial)
  const { proxy, getChanges } = createChangeProxy(original)
  return steps.map((step) => {
    const expectedCall = runArrayCallback(native, step)
    const actualCall = runArrayCallback(proxy, step)
    const expectedRow = copyCallbackRow(native)
    const changed = native.items.some(
      (item, index) => item.value !== values[index],
    )
    const changes: Partial<CallbackRow> = getChanges()
    return {
      expectedCall,
      actualCall,
      expectedRow,
      actualRow: copyCallbackRow({ ...original, ...changes }),
      expectedChanges: changed ? { items: expectedRow.items } : {},
      actualChanges: {
        ...changes,
        ...(changes.items !== undefined
          ? { items: changes.items.map((item) => ({ ...item })) }
          : {}),
      },
      initial,
      original: copyCallbackRow(original),
    }
  })
}

function assertArrayCallbacks(cuts: ReturnType<typeof observeArrayCallbacks>) {
  for (const cut of cuts) {
    expect(cut.actualCall).toStrictEqual(cut.expectedCall)
    expect(cut.actualRow).toStrictEqual(cut.expectedRow)
    expect(cut.actualChanges).toStrictEqual(cut.expectedChanges)
    expect(cut.original).toStrictEqual(cut.initial)
  }
}

/**
 * The native write model: one authored write through an access path, applied
 * to a plain row. A draft that records the same write must report the same
 * row. The write reaches `items[0]` through the named path.
 */
function writeThroughAccessPath(
  row: { id: number; items: Array<{ value: number }> },
  path: (typeof accessPaths)[number],
  delta: number,
) {
  if (path === `accumulator`)
    row.items.reduce((first) => {
      first.value += delta
      return first
    })
  else if (path === `values`) row.items.values().next().value!.value += delta
  else if (path === `entries`)
    row.items.entries().next().value![1].value += delta
  else
    row.items.forEach((item, index, array) => {
      expect(array).toBe(row.items)
      if (index === 0)
        (path === `element` ? item : array[index]!).value += delta
    })
  return row
}

declareOracle({
  check: [assertArrayCallbacks],
  model: [runArrayCallback, writeThroughAccessPath],
})

describe(`native array callback oracle`, () => {
  it(`keeps the shared baseline independent of every captured actual cut`, () => {
    const cuts = observeArrayCallbacks(
      [1, 2],
      [
        { method: `forEach`, target: 0, delta: 3 },
        { method: `forEach`, target: 0, delta: -3 },
      ],
    )
    assertArrayCallbacks(cuts)
    cuts[0]!.actualRow.items[0]!.value = 99
    cuts[0]!.original.items[0]!.value = 98
    expect(cuts[0]!.initial.items[0]!.value).toBe(1)
    expect(cuts[0]!.expectedRow.items[0]!.value).toBe(4)
    expect(cuts[1]!.actualRow.items[0]!.value).toBe(1)
    expect(cuts[1]!.original.items[0]!.value).toBe(1)
    expect(() => assertArrayCallbacks(cuts)).toThrow()
  })
  it.each(accessPaths)(
    `preserves native writes through the %s access path`,
    async (path) => {
      for (const delta of [0, 3, -2]) {
        const make = () => ({ id: 1, items: [{ value: 1 }, { value: 2 }] })
        const run = (row: ReturnType<typeof make>) =>
          writeThroughAccessPath(row, path, delta)
        const expected = writeThroughAccessPath(make(), path, delta)
        const original = make()
        const changes = withChangeTracking(original, run)
        expect({ ...original, ...changes }).toStrictEqual(expected)
        expect(original).toStrictEqual(make())
        let confirm: (value: ReturnType<typeof make>) => void = () => {}
        const collection = createCollection({
          getKey: (row: ReturnType<typeof make>) => row.id,
          startSync: true,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              begin()
              write({ type: `insert`, value: make() })
              commit()
              markReady()
              confirm = (value) => {
                begin()
                write({ type: `update`, value })
                commit()
              }
            },
          },
          // The handler confirms the update, so the stored row is its result.
          onUpdate: ({ transaction }) => {
            confirm(transaction.mutations[0].modified)
            return Promise.resolve()
          },
        })
        try {
          const tx = collection.update(1, run)
          await tx.isPersisted.promise
          const saved = collection.get(1)!
          // This oracle covers row data, not collection-owned virtual fields.
          expect({ id: saved.id, items: saved.items }).toStrictEqual(expected)
        } finally {
          await collection.cleanup()
        }
      }
    },
  )
  it.each(callbackMethods)(
    `matches native %s reads, writes and reverts`,
    (method) => {
      for (const target of [0, 1, 2]) {
        for (const deltas of [
          [0, 0],
          [3, 5],
          [3, -3],
        ]) {
          assertArrayCallbacks(
            observeArrayCallbacks(
              [4, -2, 7],
              deltas.map((delta) => ({ method, target, delta })),
            ),
          )
        }
      }
    },
  )

  const step = fc.record({
    method: fc.constantFrom(...callbackMethods),
    target: fc.integer({ min: 0, max: 5 }),
    delta: fc.integer({ min: -5, max: 5 }),
  })
  // A fixed and a random campaign. A path replay of
  // `proxy.callback-history` runs only the random campaign, from its path.
  const callbackHistory = fc.record({
    values: fc.array(fc.integer({ min: -10, max: 10 }), {
      minLength: 1,
      maxLength: 6,
    }),
    steps: fc.tuple(step, step),
  })
  const callbackProperty = fc.property(callbackHistory, ({ values, steps }) => {
    assertArrayCallbacks(observeArrayCallbacks(values, steps))
  })
  oracleReplayTest(it)(
    `matches native two-step callback histories (2026103)`,
    () => {
      fc.assert(callbackProperty, { seed: 2026103, numRuns: oracleRuns(200) })
    },
  )
  oracleReplayTest(it, `proxy.callback-history`)(
    `matches native two-step callback histories (random)`,
    () => {
      fc.assert(
        callbackProperty,
        oraclePropertyOptions(200, `proxy.callback-history`),
      )
    },
  )

  it.each([`lost-write`, `extra-visit`, `wrong-peer`] as const)(
    `rejects a captured %s independently of the native authority`,
    (fault) => {
      const cuts = observeArrayCallbacks(
        [4, -2, 7],
        [{ method: `forEach`, target: 1, delta: 3 }],
      )
      assertArrayCallbacks(cuts)
      const cut = cuts[0]!
      if (fault === `lost-write`) cut.actualRow.items[1]!.value = -2
      if (fault === `extra-visit`) cut.actualCall.visits.push(1)
      if (fault === `wrong-peer`) cut.actualRow.peer = `corrupted`
      expect(() => assertArrayCallbacks(cuts)).toThrowError(/expected/)
    },
  )
})

// Commented-out draft checks kept from the Proxy Library suite.
// TODO worth it to make this work?
// it(`should handle symbolic properties`, () => {
//   const symbolKey = Symbol(`test`)
//   const obj = {
//     [symbolKey]: `value`,
//   }
//
//   const { proxy, getChanges } = createChangeProxy(obj)
//   proxy[symbolKey] = `new value`
//
//   const changes = getChanges()
//   expect(changes[symbolKey]).toBe(`new value`)
//   expect(obj[symbolKey]).toBe(`new value`)
// })
// it(`should prevent prototype pollution`, () => {
//   const obj = { constructor: { prototype: {} } }
//   const { proxy } = createChangeProxy(obj)
//
//   // Attempt to modify Object.prototype through the proxy
//   // @ts-expect-error ignore for test
//   proxy.__proto__ = { malicious: true }
//   // @ts-expect-error ignore for test
//   proxy.constructor.prototype.malicious = true
//
//   // Verify that Object.prototype wasn't polluted
//   // @ts-expect-error ignore for test
//   expect({}.malicious).toBeUndefined()
//   // @ts-expect-error ignore for test
//   expect(Object.prototype.malicious).toBeUndefined()
//
//   // The changes should only affect the proxy's own prototype chain
//   // @ts-expect-error ignore for test
//   expect(proxy.__proto__.malicious).toBe(true)
//   // @ts-expect-error ignore for test
//   expect(proxy.constructor.prototype.malicious).toBe(true)
// })
// it(`should track array length changes through truncation`, () => {
//   const arr = [1, 2, 3, 4, 5]
//   const { proxy, getChanges } = createChangeProxy({ arr })
//
//   proxy.arr.length = 3
//
//   expect(getChanges()).toEqual({
//     arr: [1, 2, 3],
//   })
//   expect(arr.length).toBe(3)
//   expect(arr).toEqual([1, 2, 3, 4, 5])
// })
// it.only(`should prevent prototype pollution`, () => {
//   const obj = { constructor: { prototype: {} } }
//   const { proxy } = createChangeProxy(obj)
//
//   // Attempt to modify Object.prototype through the proxy
//   // @ts-expect-error ignore for test
//   proxy.__proto__ = { malicious: true }
//   // @ts-expect-error ignore for test
//   proxy.constructor.prototype.malicious = true
//
//   // Verify that Object.prototype wasn't polluted
//   // @ts-expect-error ignore for test
//   expect({}.malicious).toBeUndefined()
//   // @ts-expect-error ignore for test
//   expect(Object.prototype.malicious).toBeUndefined()
//
//   // The changes should only affect the proxy's own prototype chain
//   // @ts-expect-error ignore for test
//   expect(proxy.__proto__.malicious).toBe(true)
//   // @ts-expect-error ignore for test
//   expect(proxy.constructor.prototype.malicious).toBe(true)
// })

// A function stored as data is a value like any other. Reading it from a draft
// must give back the stored function, by any read path, as the native row
// does. Calling a stored method must see the draft as `this`, so its writes are
// tracked. Inherited methods (Array, Map, and Set methods) are not data and
// keep their own draft handling.
describe(`stored functions behave like native values`, () => {
  type Row = StoredRow
  const make = makeStoredRow

  // Each probe returns an observation that must be the same for a native row
  // and for a draft of an equal row.
  const probes: Array<[string, (row: Row, f: () => number) => unknown]> = [
    [`field access`, (row, f) => row.handler === f],
    [`array index`, (row, f) => row.fns[0] === f],
    [
      `for...of`,
      (row, f) => {
        for (const fn of row.fns) return fn === f
        return undefined
      },
    ],
    [`spread`, (row, f) => [...row.fns][0] === f],
    [
      `includes and indexOf`,
      (row, f) => [row.fns.includes(f), row.fns.indexOf(f)],
    ],
    [`array callback`, (row, f) => row.fns.map((fn) => fn === f)],
    [`nested field`, (row, f) => row.obj.g === f],
    [`Object.values`, (row, f) => Object.values(row.obj).includes(f)],
    [`Map value`, (row, f) => row.m.get(`k`) === f],
    [`Set member`, (row, f) => [...row.s][0] === f && row.s.has(f)],
    [`calling a stored function`, (row) => row.handler()],
    [
      `a function assigned during the callback`,
      (row, f) => {
        const assigned = row as Row & { added?: () => number }
        assigned.added = f
        return assigned.added === f
      },
    ],
    [
      `a stored method sees its object as this`,
      (row) => row.obj.bump() === row.obj,
    ],
    [
      `a detached stored method has no this`,
      (row) => {
        const { bump } = row.obj
        try {
          bump()
          return `returned`
        } catch (error) {
          return (error as Error).constructor.name
        }
      },
    ],
    [
      `an inherited constructor`,
      (row) => [
        row.constructor === Object,
        row.fns.constructor === Array,
        row.m.constructor === Map,
        row.s.constructor === Set,
      ],
    ],
  ]

  // The native model: a probe on a plain row gives the observation that a
  // draft of an equal row must give.
  function expectNativeProbeResult(
    probe: (row: Row, f: () => number) => unknown,
  ) {
    const f = () => 1
    const f2 = () => 2
    const native = probe(make(f, f2), f)
    const { proxy } = createChangeProxy(make(f, f2))
    expect(probe(proxy, f)).toEqual(native)
  }
  declareOracle({ check: [expectNativeProbeResult] })

  it.each(probes)(`%s gives the native result`, (_name, probe) => {
    expectNativeProbeResult(probe)
  })
})

/**
 * `Object.defineProperty` on a draft defines the property as on a native row:
 * the same result, value, and descriptor. A defined enumerable value is a
 * change.
 */
describe(`defineProperty behaves like on a native row`, () => {
  type Row = Record<string, unknown>
  const make = (): Row => ({ a: 1, nested: { b: 2 } })
  // One getter for both rows, so their descriptors compare equal.
  const getTwo = () => 2
  const definitions: Array<
    [string, (row: Row) => PropertyDescriptor & { key: string }]
  > = [
    [`a new key with only a value`, () => ({ key: `k`, value: 5 })],
    [`an existing key with only a value`, () => ({ key: `a`, value: 5 })],
    [
      `an existing key made read-only`,
      () => ({ key: `a`, value: 6, writable: false }),
    ],
    [
      `a new enumerable writable key`,
      () => ({
        key: `k`,
        value: 7,
        writable: true,
        enumerable: true,
        configurable: true,
      }),
    ],
    [`an object value`, () => ({ key: `a`, value: { c: 3 }, writable: false })],
    [`a nested key`, () => ({ key: `nested`, value: { b: 3 } })],
    [
      `a new key with only an object value`,
      () => ({ key: `k`, value: { c: 3 } }),
    ],
    [`a getter over an existing key`, () => ({ key: `a`, get: getTwo })],
    [
      `a new enumerable getter`,
      () => ({ key: `k`, get: getTwo, enumerable: true, configurable: true }),
    ],
  ]
  const observe = (
    row: Row,
    define: (row: Row) => PropertyDescriptor & { key: string },
  ) => {
    const { key, ...descriptor } = define(row)
    const defined = Reflect.defineProperty(row, key, descriptor)
    const { value, ...rest } = Object.getOwnPropertyDescriptor(row, key) ?? {}
    // A read-only, non-configurable property must read back as defined.
    const fixed = rest.configurable === false && rest.writable === false
    const same = fixed ? row[key] === descriptor.value : undefined
    return {
      same,
      defined,
      value: JSON.stringify(value),
      rest,
      read: JSON.stringify(row[key]),
    }
  }

  // Like a clone, changes hold enumerable string keys only, with the value
  // the native row now reads.
  function expectDefinitionMatchesNative(
    define: (row: Row) => PropertyDescriptor & { key: string },
  ) {
    const native = make()
    const expected = observe(native, define)
    const { proxy, getChanges } = createChangeProxy(make())
    expect(observe(proxy, define)).toEqual(expected)
    const { key } = define(proxy)
    const enumerable = expected.rest.enumerable === true
    expect(getChanges()).toEqual(enumerable ? { [key]: native[key] } : {})
  }
  declareOracle({ check: [expectDefinitionMatchesNative] })

  it.each(definitions)(`%s`, (_name, define) => {
    expectDefinitionMatchesNative(define)
  })
})

/**
 * Freezing, sealing, or fixing a key of a draft must not lose a later write
 * through a nested value. The Proxy invariants make a frozen key return the
 * raw copy, so the draft counts that key as changed when it reads it. The law
 * therefore compares rows, not patches: applying `getChanges()` to the
 * original must give the native row.
 */
describe(`frozen and sealed drafts keep nested writes`, () => {
  type Row = FrozenRow
  const make = makeFrozenRow
  const histories: Array<[string, (row: Row) => void]> = [
    [
      `freeze, then a nested write`,
      (row) => {
        Object.freeze(row)
        row.n.x = 2
      },
    ],
    [`freeze, then a nested read`, (row) => void Object.freeze(row).n.x],
    [
      `seal, then a nested write`,
      (row) => {
        Object.seal(row)
        row.n.x = 2
      },
    ],
    [
      `a fixed key, then a nested write`,
      (row) => {
        Object.defineProperty(row, `n`, {
          writable: false,
          configurable: false,
        })
        row.n.x = 2
      },
    ],
  ]

  // The native model: the row that a plain object gives after the history.
  function expectNativeRowAfter(run: (row: Row) => void) {
    const native = make()
    run(native)
    const { proxy, getChanges } = createChangeProxy(make())
    run(proxy)
    expect({ ...make(), ...getChanges() }).toEqual({ ...native })
  }
  declareOracle({ check: [expectNativeRowAfter] })

  it.each(histories)(`%s gives the native row`, (_name, run) => {
    expectNativeRowAfter(run)
  })

  // The boundary is a read-only and non-configurable key. A sealed key is
  // non-configurable but writable, and a read-only key may stay configurable.
  // Either way the draft hands out a draft, so a read is no change. These
  // cases reject a boundary that checks only one of the two attributes.
})
