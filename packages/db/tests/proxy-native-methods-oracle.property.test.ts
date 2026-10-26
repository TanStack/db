import { describe, it as vitestIt } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config.js'

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
  RUNS,
  TYPED_METHODS,
  arrayMethods,
  arraySpecArb,
  expectArrayCall,
  expectTypedCall,
  observeArray,
  observeTyped,
  typedMethods,
  typedSpecArb,
} from './proxy-native-methods-fixture.js'

const it = oracleReplayTest(vitestIt)

declareOracle({
  check: [expectArrayCall, expectTypedCall],
  model: [observeArray, observeTyped],
})

describe(`array methods behave like native arrays`, () => {
  // The row of the original pinned table, for every method.
  it.each(arrayMethods)(`%s on a fixed row gives the native result`, (m) => {
    for (const k of [0, 1, 3])
      expectArrayCall([{ x: 1 }, 2, [{ x: 3 }], { x: 0 }], m, k)
  })

  it(`matches native arrays across generated rows (${FIXED_SEED})`, () => {
    fc.assert(
      fc.property(
        arraySpecArb,
        fc.constantFrom(...arrayMethods),
        fc.nat(4),
        expectArrayCall,
      ),
      { numRuns: oracleRuns(RUNS), seed: FIXED_SEED },
    )
  })
  oracleReplayTest(fcTest, ARRAY_METHODS).prop(
    [arraySpecArb, fc.constantFrom(...arrayMethods), fc.nat(4)],
    oraclePropertyOptions(RUNS, ARRAY_METHODS),
  )(`matches native arrays across generated rows (random)`, expectArrayCall)
})
describe(`typed-array methods behave like native typed arrays`, () => {
  // The row of the original pinned table, for every method.
  it.each(typedMethods)(`%s on a fixed row gives the native result`, (m) => {
    for (const write of [false, true]) expectTypedCall([3, 1, 2], m, 1, write)
  })

  // A mutator counts as a change without a revert check, even when the
  // result equals the original under draft equality (-0 equals 0).
  it(`reversing [-0, 0] is a change although the result is draft-equal`, () => {
    expectTypedCall([-0, 0], `reverse`, 0, false)
  })

  it(`matches native typed arrays across generated rows (${FIXED_SEED})`, () => {
    fc.assert(
      fc.property(
        typedSpecArb,
        fc.constantFrom(...typedMethods),
        fc.nat(4),
        fc.boolean(),
        expectTypedCall,
      ),
      { numRuns: oracleRuns(RUNS), seed: FIXED_SEED },
    )
  })
  oracleReplayTest(fcTest, TYPED_METHODS).prop(
    [typedSpecArb, fc.constantFrom(...typedMethods), fc.nat(4), fc.boolean()],
    oraclePropertyOptions(RUNS, TYPED_METHODS),
  )(
    `matches native typed arrays across generated rows (random)`,
    expectTypedCall,
  )
})
