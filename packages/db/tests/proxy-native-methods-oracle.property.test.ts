import { describe, expect, it as vitestIt } from 'vitest'
import { fc } from '@fast-check/vitest'
import { withChangeTracking } from '../src/proxy'
import {
  oracleProperty,
  oracleReplayTest,
  oracleRoute,
  pass,
  violation,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'

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
// Campaigns. Each generated property has a fixed campaign and a random
// campaign over the same grammar and check. A path replay of one property
// runs its recorded history once and every other test stands aside. A seed
// alone reseeds the random campaigns.

import {
  ARRAY_METHODS,
  FIXED_SEED,
  MUTATORS,
  RUNS,
  TYPED_METHODS,
  TYPED_MUTATORS,
  arrayMethods,
  arraySpecArb,
  encodeArray,
  encodeTyped,
  expectArrayCall,
  expectTypedCall,
  observeArray,
  observeTyped,
  realizeArray,
  typedMethods,
  typedSpecArb,
} from './proxy-native-methods-fixture.js'
import type { ArrayRow, TypedRow } from './proxy-native-methods-fixture.js'
import type { Verdict } from './oracle-config.js'

const it = oracleReplayTest(vitestIt)

// The model is native array and typed-array behavior. observeArray and
// observeTyped record a call on either side, so they are not declared.
// What this oracle owns: the gap report judges the built-in array and typed
// array method behavior of drafts in proxy.ts by this file's tests.
declareOracle({
  check: [expectArrayCall, expectTypedCall],
})

// Detached native containers use the fixture's existing encodings. Only the
// emptiness of the changes object is judged, so enumerable keys retain that
// observation without introducing class instances into the recorded data.
type NativeCallObservation = {
  result: unknown
  detached: string | Array<string> | undefined
  hasDetached: boolean
  changes: Record<string, true>
}

function assertionVerdict(checkpoint: string, compare: () => void): Verdict {
  try {
    compare()
    return pass
  } catch (error) {
    if (!(error instanceof Error) || error.name !== `AssertionError`)
      throw error
    return {
      kind: `violation`,
      checkpoint,
      difference: error.message,
      law: `native method refinement`,
      cause: error,
    }
  }
}

describe(`array methods behave like native arrays`, () => {
  // The row of the original fixed table, for every method.
  it.each(arrayMethods)(`%s on a fixed row gives the native result`, (m) => {
    oracleRoute(`case`)
    for (const k of [0, 1, 3])
      expectArrayCall([{ x: 1 }, 2, [{ x: 3 }], { x: 0 }], m, k)
  })

  oracleProperty({
    id: ARRAY_METHODS,
    law: {
      statement: `Draft array methods return the native result, preserve original-object identity relations, and detach the native final field value.`,
      authority: `src/proxy.ts draft contract and tests/proxy-oracle.test.ts native differential laws`,
      limits: `Bounded recipe arrays; fixed read-only callbacks; inserted objects have no original-row identity promise; no-op mutators may report equal changes.`,
    },
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: fc.tuple(
        arraySpecArb,
        fc.constantFrom(...arrayMethods),
        fc.nat(4),
      ),
      runs: RUNS,
      fixedSeeds: [FIXED_SEED],
    },
    model: ([spec, method, k]) => {
      const native = realizeArray(spec)
      const result = observeArray(native, method, k)
      return {
        result,
        items: encodeArray(native.items),
        changed:
          encodeArray(native.items) !== encodeArray(realizeArray(spec).items),
      }
    },
    driver: ([spec, method, k], observe) => {
      let result: unknown
      const changes = withChangeTracking(realizeArray(spec), (draft) => {
        result = observeArray(draft, method, k)
      })
      const detachedItems = (changes as Partial<ArrayRow>).items
      observe(`detached array call`, {
        result,
        detached: detachedItems && encodeArray(detachedItems),
        hasDetached: detachedItems !== undefined,
        changes: Object.fromEntries(
          Reflect.ownKeys(changes)
            .filter((key) =>
              Object.prototype.propertyIsEnumerable.call(changes, key),
            )
            .map((key) => [String(key), true]),
        ),
      })
    },
    check: ([spec, method, k], observations, expected) => {
      for (const { checkpoint, value } of observations) {
        const verdict = assertionVerdict(checkpoint, () => {
          const actual = value as NativeCallObservation
          const context = JSON.stringify({ spec, method, k })
          expect(actual.result, `result, ${context}`).toEqual(expected.result)
          if (expected.changed || actual.hasDetached)
            expect(actual.detached, `detached items, ${context}`).toBe(
              expected.items,
            )
          if (!expected.changed && !MUTATORS.has(method))
            expect(actual.changes, `no change, ${context}`).toEqual({})
        })
        if (verdict.kind === `violation`) return verdict
      }
      return observations.length === 1
        ? pass
        : violation(`complete history`, `the array call did not return`)
    },
  })
})
describe(`typed-array methods behave like native typed arrays`, () => {
  // The row of the original fixed table, for every method.
  it.each(typedMethods)(`%s on a fixed row gives the native result`, (m) => {
    oracleRoute(`case`)
    for (const write of [false, true]) expectTypedCall([3, 1, 2], m, 1, write)
  })

  // Reversal swaps distinct signed-zero values. The native comparison checks
  // their final positions, including the detached change-set value.
  it(`reversing signed zeros preserves their native positions`, () => {
    oracleRoute(`case`)
    expectTypedCall([-0, 0], `reverse`, 0, false)
  })

  oracleProperty({
    id: TYPED_METHODS,
    law: {
      statement: `Draft typed-array methods return the native result and self relation, and detach the native final field value after a possible write through the result.`,
      authority: `src/proxy.ts draft contract and tests/proxy-oracle.test.ts native differential laws`,
      limits: `Float64Array recipes with fixed callbacks and bounded indices; no-op mutators may report equal changes.`,
    },
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: fc.tuple(
        typedSpecArb,
        fc.constantFrom(...typedMethods),
        fc.nat(4),
        fc.boolean(),
      ),
      runs: RUNS,
      fixedSeeds: [FIXED_SEED],
    },
    model: ([values, method, k, write]) => {
      const native: TypedRow = { t: Float64Array.from(values) }
      const result = observeTyped(native, method, k, write)
      return {
        result,
        values: encodeTyped(native.t),
        changed: native.t.some((v, i) => !Object.is(v, values[i])),
      }
    },
    driver: ([values, method, k, write], observe) => {
      let result: unknown
      const changes = withChangeTracking(
        { t: Float64Array.from(values) },
        (draft) => {
          result = observeTyped(draft, method, k, write)
        },
      )
      const detachedArray = (changes as Partial<TypedRow>).t
      observe(`detached typed-array call`, {
        result,
        detached: detachedArray && encodeTyped(detachedArray),
        hasDetached: detachedArray !== undefined,
        changes: Object.fromEntries(
          Reflect.ownKeys(changes)
            .filter((key) =>
              Object.prototype.propertyIsEnumerable.call(changes, key),
            )
            .map((key) => [String(key), true]),
        ),
      })
    },
    check: ([values, method, k, write], observations, expected) => {
      for (const { checkpoint, value } of observations) {
        const verdict = assertionVerdict(checkpoint, () => {
          const actual = value as NativeCallObservation
          const context = JSON.stringify({
            values: values.map(String),
            method,
            k,
            write,
          })
          expect(actual.result, `result, ${context}`).toEqual(expected.result)
          if (expected.changed || actual.hasDetached)
            expect(actual.detached, `detached typed array, ${context}`).toEqual(
              expected.values,
            )
          if (!expected.changed && !TYPED_MUTATORS.has(method))
            expect(actual.changes, `no change, ${context}`).toEqual({})
        })
        if (verdict.kind === `violation`) return verdict
      }
      return observations.length === 1
        ? pass
        : violation(`complete history`, `the typed-array call did not return`)
    },
  })
})
