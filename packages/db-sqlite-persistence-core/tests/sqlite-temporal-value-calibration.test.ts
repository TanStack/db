// @vitest-environment node
/**
 * Calibrations of the SQLite typed-value comparison in
 * sqlite-temporal-value-support.ts against the model in
 * sqlite-temporal-value-model-oracle.ts: the comparison rejects empty objects,
 * wrong same-type values, ISO-string erasure, and missing, duplicate, and
 * reversed query keys, and the grammar holds all 16 distinct cells. They run
 * no production, so they are ordinary tests. The oracle that drives production
 * is sqlite-temporal-value-oracle.test.ts.
 */
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check } from './sqlite-temporal-value-support'
import {
  cases,
  expectedValue,
  inputValue,
  kinds,
  textFor,
} from './sqlite-temporal-value-model-oracle'

beforeEach(() => vi.stubGlobal(`Temporal`, Temporal))
afterEach(() => vi.unstubAllGlobals())

describe(`typed-value oracle calibration`, () => {
  it.each(kinds)(`distinguishes type and value for $0`, (kind) => {
    check(inputValue(kind, 0), expectedValue(kind, 0), `valid value`)
    expect(() => check({}, expectedValue(kind, 0), `empty object`)).toThrow()
    expect(() =>
      check(inputValue(kind, 1), expectedValue(kind, 0), `wrong value`),
    ).toThrow()
    if (kind !== `ISO string`) {
      expect(() =>
        check(textFor(kind, 0), expectedValue(kind, 0), `type erased`),
      ).toThrow()
    }
  })

  it(`rejects missing, duplicate, and reversed query results`, () => {
    const expected = [`z-early`, `a-late`]
    check(expected, expected, `valid keys`)
    for (const actual of [
      [],
      [`z-early`, `z-early`],
      [...expected].reverse(),
    ]) {
      expect(() => check(actual, expected, `query keys`)).toThrow()
    }
    expect(cases).toHaveLength(16)
    expect(
      new Set(
        cases.map(
          ({ kind, history, indexed }) => `${kind}/${history}/${indexed}`,
        ),
      ).size,
    ).toBe(16)
  })
})
