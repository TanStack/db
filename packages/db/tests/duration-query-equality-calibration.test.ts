// Calibration of the Duration equality model in
// duration-query-equality-model-oracle.ts. This test runs no production: it
// requires the model to separate every field and to reject three plausible
// wrong keys at the oracle's exact-key-set comparison.
import { expect, it } from 'vitest'
import {
  cases,
  fields,
  modelEqual,
  modelKeys,
  oppositeSigns,
  sameDisplay,
  secondFieldChange,
} from './duration-query-equality-model-oracle.js'
import type { Case } from './duration-query-equality-model-oracle.js'
import type { Temporal } from 'temporal-polyfill'

// Every field changes the model's answer, while a separately constructed
// equal copy does not. Three pairs kill text, absolute-value, and first-field
// key mutants at the same exact-key-set comparison used below.
it(`calibrates all ten fields and three plausible wrong keys`, () => {
  for (const [equal, changed] of Array.from({ length: 10 }, (_, index) =>
    cases.slice(index * 2, index * 2 + 2),
  )) {
    expect(modelEqual(equal!.stored, equal!.probe)).toBe(true)
    expect(modelEqual(changed!.stored, changed!.probe)).toBe(false)
  }
  expect(String(sameDisplay.stored)).toBe(String(sameDisplay.probe))
  expect(modelEqual(sameDisplay.stored, sameDisplay.probe)).toBe(false)
  const magnitudeKey = (value: Temporal.Duration) =>
    fields.map((field) => Math.abs(value[field])).join(`,`)
  const firstNonzeroKey = (value: Temporal.Duration) => {
    const field = fields.find((candidate) => value[candidate] !== 0)!
    return `${field}:${value[field]}`
  }
  const wrongKeys = (
    testCase: Case,
    key: (value: Temporal.Duration) => string,
  ) => new Set(key(testCase.stored) === key(testCase.probe) ? [`row`] : [])
  for (const [testCase, key] of [
    [sameDisplay, String],
    [oppositeSigns, magnitudeKey],
    [secondFieldChange, firstNonzeroKey],
  ] as const) {
    expect(() =>
      expect(wrongKeys(testCase, key)).toEqual(modelKeys(testCase)),
    ).toThrow()
  }
})
