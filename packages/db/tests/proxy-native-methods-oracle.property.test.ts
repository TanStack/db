import { describe, it as vitestIt } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
  oracleRuns,
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
  RUNS,
  TYPED_METHODS,
  arrayMethods,
  arraySpecArb,
  expectArrayCall,
  expectTypedCall,
  typedMethods,
  typedSpecArb,
} from './proxy-native-methods-fixture.js'

const it = oracleReplayTest(vitestIt)

// The model is native array and typed-array behavior. observeArray and
// observeTyped record a call on either side, so they are not declared.
// What this oracle owns: the gap report judges the built-in array and typed
// array method behavior of drafts in proxy.ts by this file's tests.
declareOracle({
  owns: [`src/proxy.ts`],
  check: [expectArrayCall, expectTypedCall],
})

describe(`array methods behave like native arrays`, () => {
  // The row of the original fixed table, for every method.
  it.each(arrayMethods)(`%s on a fixed row gives the native result`, (m) => {
    oracleRoute(`case`)
    for (const k of [0, 1, 3])
      expectArrayCall([{ x: 1 }, 2, [{ x: 3 }], { x: 0 }], m, k)
  })

  it(`matches native arrays across generated rows (${FIXED_SEED})`, () => {
    const parameters = oracleFixedSeed(FIXED_SEED, {
      numRuns: oracleRuns(RUNS),
    })
    oracleRoute(oracleRouteOf(parameters))
    fc.assert(
      fc.property(
        arraySpecArb,
        fc.constantFrom(...arrayMethods),
        fc.nat(4),
        expectArrayCall,
      ),
      parameters,
    )
  })
  const arraySpecCampaign = oraclePropertyOptions(RUNS, ARRAY_METHODS)
  oracleReplayTest(fcTest, ARRAY_METHODS).prop(
    [arraySpecArb, fc.constantFrom(...arrayMethods), fc.nat(4)],
    arraySpecCampaign,
  )(`matches native arrays across generated rows (random)`, (...args) => {
    oracleRoute(oracleRouteOf(arraySpecCampaign))
    expectArrayCall(...args)
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

  it(`matches native typed arrays across generated rows (${FIXED_SEED})`, () => {
    const campaignParameters = oracleFixedSeed(FIXED_SEED, {
      numRuns: oracleRuns(RUNS),
    })
    oracleRoute(oracleRouteOf(campaignParameters))
    fc.assert(
      fc.property(
        typedSpecArb,
        fc.constantFrom(...typedMethods),
        fc.nat(4),
        fc.boolean(),
        expectTypedCall,
      ),
      campaignParameters,
    )
  })
  const typedSpecCampaign = oraclePropertyOptions(RUNS, TYPED_METHODS)
  oracleReplayTest(fcTest, TYPED_METHODS).prop(
    [typedSpecArb, fc.constantFrom(...typedMethods), fc.nat(4), fc.boolean()],
    typedSpecCampaign,
  )(`matches native typed arrays across generated rows (random)`, (...args) => {
    oracleRoute(oracleRouteOf(typedSpecCampaign))
    expectTypedCall(...args)
  })
})
