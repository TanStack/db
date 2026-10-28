/**
 * Ordinary coverage pins for native array and typed-array method tests: every
 * method has call arguments, and the fixed campaign reaches each generator
 * shape. The native-method law is owned by proxy-native-methods-oracle.property.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  FIXED_SEED,
  RUNS,
  arrayCalls,
  arrayMethods,
  arraySpecArb,
  typedCalls,
  typedMethods,
  typedSpecArb,
} from './proxy-native-methods-fixture.js'

describe(`array methods behave like native arrays`, () => {
  it(`has arguments for every method`, () => {
    expect(arrayMethods.filter((name) => !(name in arrayCalls))).toEqual([])
  })

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

describe(`typed-array methods behave like native typed arrays`, () => {
  it(`has arguments for every method`, () => {
    expect(typedMethods.filter((name) => !(name in typedCalls))).toEqual([])
  })

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
