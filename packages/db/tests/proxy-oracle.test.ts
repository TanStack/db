import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { createChangeProxy, withChangeTracking } from '../src/proxy'
import { makeFrozenRow, makeStoredRow } from './proxy-native-rows'
import { oracleRoute } from './oracle-config'
import {
  asProductionError,
  errorViolation,
  isErrorObservation,
} from './oracle-error-observation'
import { declareOracle } from './oracle-declaration'
import { differs, oracleProperty, pass, violation } from './oracle-property'
import type { Observation, Verdict } from './oracle-property'
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
 * Fixed examples of individual language operations live in proxy.test.ts.
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

type CallbackHistory = { values: Array<number>; steps: Array<CallbackStep> }

// What the draft exposes after one step, or what the native callback owes.
type CallbackView = {
  call: ReturnType<typeof runArrayCallback>
  row: CallbackRow
  changes: Record<string, unknown>
  original: CallbackRow
}

function initialRow(values: Array<number>): CallbackRow {
  return {
    items: values.map((value, id) => ({ id, value })),
    peer: `untouched`,
  }
}

// Production side: one draft row, run step by step. It records what the draft
// exposes and decides nothing. An error raised by a draft call is the
// observation of its step, and it stops the history.
function driveArrayCallbacks(
  history: CallbackHistory,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const original = copyCallbackRow(initialRow(history.values))
  const { proxy, getChanges } = createChangeProxy(original)
  for (const [index, step] of history.steps.entries()) {
    const checkpoint = `step ${index}`
    let call: ReturnType<typeof runArrayCallback>
    let changes: Record<string, any>
    try {
      call = runArrayCallback(proxy, step)
      changes = getChanges()
    } catch (error) {
      observe(checkpoint, asProductionError(error))
      return
    }
    observe(checkpoint, {
      call,
      row: copyCallbackRow({ ...original, ...changes }),
      changes: {
        ...changes,
        ...(changes.items !== undefined
          ? { items: changes.items.map((item: object) => ({ ...item })) }
          : {}),
      },
      original: copyCallbackRow(original),
    })
  }
}

// Native side: the same callback history on a plain row, independent of the
// draft. The views it returns are what the driver must exhibit.
function modelArrayCallbacks(history: CallbackHistory): Array<CallbackView> {
  const initial = initialRow(history.values)
  const native = copyCallbackRow(initial)
  return history.steps.map((step) => {
    const call = runArrayCallback(native, step)
    // A value is changed unless it is the same value. -0 and 0 are distinct
    // row values (maintainer decision, 2026-10-29), so `Object.is` decides.
    const changed = native.items.some(
      (item, index) => !Object.is(item.value, history.values[index]),
    )
    const row = copyCallbackRow(native)
    return {
      call,
      row,
      changes: changed ? { items: row.items } : {},
      original: copyCallbackRow(initial),
    }
  })
}

const LAW_CALL = `a draft's callback makes the native call: the same visits and result`
const LAW_ROW = `the row rebuilt from the draft's recorded changes is the native row`
const LAW_CHANGES = `the recorded changes are the native changes`
const LAW_BASELINE = `the input row is never changed by a callback`
const LAW_NO_ERROR = `a draft's callback raises no error`
const LAW_OBSERVED = `every step of a history is observed`

// The comparison shared by the campaign and the fixed examples.
function judgeStep(
  checkpoint: string,
  actual: CallbackView,
  expected: CallbackView,
): Verdict | undefined {
  return (
    differs(checkpoint, LAW_CALL, actual.call, expected.call) ??
    differs(checkpoint, LAW_ROW, actual.row, expected.row) ??
    differs(checkpoint, LAW_CHANGES, actual.changes, expected.changes) ??
    differs(checkpoint, LAW_BASELINE, actual.original, expected.original)
  )
}

// The array-callback comparison: each observed step against the model's view
// of that step. A missing step, or an error that stops the history, is a
// violation too.
function judgeCallbacks(
  _history: CallbackHistory,
  observations: ReadonlyArray<Observation>,
  expected: ReadonlyArray<CallbackView>,
): Verdict {
  for (const [index, observation] of observations.entries()) {
    const value = observation.value
    if (isErrorObservation(value))
      return errorViolation(
        observation.checkpoint,
        LAW_NO_ERROR,
        value,
        `no error`,
      )
    const verdict = judgeStep(
      observation.checkpoint,
      value as CallbackView,
      expected[index]!,
    )
    if (verdict) return verdict
  }
  if (observations.length !== expected.length)
    return violation(
      `end of history`,
      `observed ${observations.length} of ${expected.length} steps`,
      LAW_OBSERVED,
      { actual: observations.length, expected: expected.length },
    )
  return pass
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

// What this oracle owns: the gap report judges the draft's array callback
// methods and the stored-function and defineProperty behavior of drafts in
// proxy.ts by this file's tests.
declareOracle({
  owns: [`src/proxy.ts`],
  check: [judgeCallbacks],
  model: [runArrayCallback, writeThroughAccessPath, modelArrayCallbacks],
})

// -0 joins the values and deltas, so `-0 += 0` writes 0: a change of a
// zero's sign alone, which a draft must record like any other write. The
// campaign and its random histories are oracleProperty below.
const signedInteger = (min: number, max: number) =>
  fc.oneof(fc.integer({ min, max }), fc.constant(-0), fc.constant(0))
const step = fc.record({
  method: fc.constantFrom(...callbackMethods),
  target: fc.integer({ min: 0, max: 5 }),
  delta: signedInteger(-5, 5),
})
const callbackHistory = fc.record({
  values: fc.array(signedInteger(-10, 10), {
    minLength: 1,
    maxLength: 6,
  }),
  steps: fc.tuple(step, step),
})

// Reach describes the history, not production: some step of the model's views
// leaves an item that differs from its start only by the sign of a zero. The
// model is independent of the draft, so reach does not depend on production.
function reachedStates(
  history: CallbackHistory,
  _trace: ReadonlyArray<Observation>,
  expected: ReadonlyArray<CallbackView>,
): Array<`zero-sign-write`> {
  return expected.some((view) =>
    view.row.items.some(
      (item, index) =>
        item.value === history.values[index] &&
        !Object.is(item.value, history.values[index]),
    ),
  )
    ? [`zero-sign-write`]
    : []
}

// Replaces the first observation's view, or reports that the corruption does
// not apply to this history.
function replaceFirstView(
  trace: ReadonlyArray<Observation>,
  change: (view: CallbackView) => CallbackView | undefined,
): Array<Observation> | undefined {
  const [first, ...rest] = trace
  if (first === undefined) return undefined
  const corrupted = change(first.value as CallbackView)
  return corrupted === undefined
    ? undefined
    : [{ checkpoint: first.checkpoint, value: corrupted }, ...rest]
}

oracleProperty<CallbackHistory, Array<CallbackView>>({
  id: `proxy.callback-history`,
  law: {
    statement: `A draft's array callback runs the native callback: it makes the same call, the row rebuilt from its recorded changes is the native row, its recorded changes are the native changes, and the input row is never changed. A change of a zero's sign alone is a change.`,
    authority: `packages/db/src/proxy.ts; the maintainer decision (2026-10-29) that -0 and 0 are distinct row values; the native array methods as the authority for callback results.`,
    limits: `One row of up to six numeric items, two callback steps, and the eight array callback methods; the Collection write path, virtual fields, Map and Set drafts, and detachment belong to their own oracles.`,
  },
  histories: {
    arbitrary: callbackHistory,
    states: [`zero-sign-write`],
    runs: 200,
    fixedSeeds: [2026103],
    // Fixed histories the framework runs in every campaign: the input row stays
    // unchanged across two callback steps, and each callback method runs over
    // several targets and delta pairs with the native result as the owed value.
    fixed: [
      {
        name: `keeps the input row unchanged across two callback steps`,
        history: {
          values: [1, 2],
          steps: [
            { method: `forEach`, target: 0, delta: 3 },
            { method: `forEach`, target: 0, delta: -3 },
          ],
        },
      },
      ...callbackMethods.flatMap((method) =>
        [0, 1, 2].flatMap((target) =>
          [
            [0, 0],
            [3, 5],
            [3, -3],
          ].map((deltas) => ({
            name: `matches native ${method} reads, writes and reverts (target ${target}, deltas ${deltas.join(`, `)})`,
            history: {
              values: [4, -2, 7],
              steps: deltas.map((delta) => ({ method, target, delta })),
            },
          })),
        ),
      ),
    ], // The first step makes a zero change sign and leaves its magnitude; the
    // second step stays random, so the states after the write are explored.
    constructed: [
      {
        name: `a zero changes sign on the first step`,
        enters: [`zero-sign-write`],
        build: (generated) => ({
          values: [-0, ...generated.values.slice(0, 5)],
          steps: [
            { ...generated.steps[0]!, target: 0, delta: 0 },
            generated.steps[1]!,
          ],
        }),
      },
    ],
  },
  model: modelArrayCallbacks,
  reached: reachedStates,
  driver: driveArrayCallbacks,
  check: judgeCallbacks,
  // Wrong answers the check must reject: the write lost, the visit repeated,
  // and the peer corrupted.
  calibrations: [
    {
      name: `lost write`,
      law: LAW_ROW,
      corrupt: (trace) =>
        replaceFirstView(trace, (view) => {
          const baseline = copyCallbackRow(view.original)
          return differs(`lost write`, LAW_ROW, view.row, baseline)
            ? { ...view, row: baseline }
            : undefined
        }),
    },
    {
      name: `extra visit`,
      law: LAW_CALL,
      corrupt: (trace) =>
        replaceFirstView(trace, (view) => ({
          ...view,
          call: { ...view.call, visits: [...view.call.visits, 0] },
        })),
    },
    {
      name: `last step dropped`,
      law: LAW_OBSERVED,
      corrupt: (trace) => (trace.length === 0 ? undefined : trace.slice(0, -1)),
    },
    {
      name: `wrong peer`,
      law: LAW_ROW,
      corrupt: (trace) =>
        replaceFirstView(trace, (view) => ({
          ...view,
          row: { ...view.row, peer: `corrupted` },
        })),
    },
  ],
})

describe(`native array callback oracle`, () => {
  it.each(accessPaths)(
    `preserves native writes through the %s access path`,
    async (path) => {
      oracleRoute(`case`)
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
          await tx.when(`settled`)
          const saved = collection.get(1)!
          // This oracle covers row data, not collection-owned virtual fields.
          expect({ id: saved.id, items: saved.items }).toStrictEqual(expected)
        } finally {
          await collection.cleanup()
        }
      }
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
    oracleRoute(`case`)
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
    oracleRoute(`case`)
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
    oracleRoute(`case`)
    expectNativeRowAfter(run)
  })

  // The boundary is a read-only and non-configurable key. A sealed key is
  // non-configurable but writable, and a read-only key may stay configurable.
  // Either way the draft hands out a draft, so a read is no change. These
  // cases reject a boundary that checks only one of the two attributes.
})
