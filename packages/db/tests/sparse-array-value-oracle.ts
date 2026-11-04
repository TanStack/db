/**
 * Array value equality reads every position. The utility equality contract
 * equates a hole with undefined, but a defined number at that position differs.
 * This shared part of the utility owner supplies the same authored values and
 * observation to its direct comparison and the observer's publication driver.
 * It does not promise array presence/descriptor fidelity: draft and persisted
 * equality own those stricter domains.
 */
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { declareOracle } from './oracle-declaration.js'

export const sparseArrayCase = fc.record({
  cells: fc.array(
    fc.oneof(
      fc.integer(),
      fc.constant(undefined),
      fc.constant(`hole` as const),
    ),
    {
      minLength: 1,
      maxLength: 5,
    },
  ),
  at: fc.nat(4),
  value: fc.integer(),
})
export type SparseArrayCase =
  typeof sparseArrayCase extends fc.Arbitrary<infer T> ? T : never
export type SparseArrayForm = `hole` | `undefined` | `defined`
export const sparseArrayCarriers = [`direct`, `record`, `set`] as const
export type SparseArrayCarrier = (typeof sparseArrayCarriers)[number]

export function makeSparseArray(
  spec: SparseArrayCase,
  form: SparseArrayForm,
  carrier: SparseArrayCarrier,
): object {
  const values: Array<number | undefined> = new Array(spec.cells.length)
  spec.cells.forEach((cell, index) => {
    if (cell !== `hole`) values[index] = cell
  })
  const index = spec.at % values.length
  if (form === `hole`) delete values[index]
  else values[index] = form === `defined` ? spec.value : undefined
  return carrier === `record`
    ? { values }
    : carrier === `set`
      ? new Set([values])
      : values
}

// The model retains values by position, without implementing a recursive walk.
export function sparseArrayValues(
  spec: SparseArrayCase,
  form: SparseArrayForm,
) {
  return spec.cells.map((cell, index) =>
    index === spec.at % spec.cells.length
      ? form === `defined`
        ? spec.value
        : undefined
      : cell === `hole`
        ? undefined
        : cell,
  )
}
export function checkSparseArray(
  actual: object,
  expected: ReadonlyArray<number | undefined>,
  carrier: SparseArrayCarrier,
): void {
  if (carrier === `set`) {
    expect((actual as Set<unknown>).size, `singleton Set carrier`).toBe(1)
  }
  const values =
    carrier === `record`
      ? (actual as { values: Array<unknown> }).values
      : carrier === `set`
        ? (actual as Set<Array<unknown>>).values().next().value
        : actual
  expect(Array.isArray(values), `array value carrier`).toBe(true)
  expect(Array.from(values as Array<unknown>), `array positions`).toEqual(
    expected,
  )
}
declareOracle({
  grammar: [sparseArrayCase],
  model: [sparseArrayValues],
  check: [checkSparseArray],
})
