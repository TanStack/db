import { describe, expect, it } from 'vitest'
import { compileSingleRowExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'

const cases = [0, 129, 65536].flatMap((size) =>
  [`eq`, `in`].flatMap((operator) =>
    [`array`, `buffer`, `mixed`].flatMap((form) =>
      [`equal`, `offset`, `different`, `length`].map((shape) => ({
        size,
        operator,
        form,
        shape,
      })),
    ),
  ),
)

// Count bytes encoded, without retaining one mock-call record per byte.
function measureEncoding(run: () => unknown) {
  const original = String.fromCharCode
  let bytes = 0
  String.fromCharCode = (...codes) => {
    bytes += codes.length
    return original(...codes)
  }
  try {
    return { result: run(), bytes }
  } finally {
    String.fromCharCode = original
  }
}

describe(`binary equality work`, () => {
  it.each(cases)(
    `compares $size bytes with $operator/$form/$shape without encoding strings`,
    ({ size, operator, form, shape }) => {
      const left =
        form === `buffer`
          ? Buffer.alloc(size, 65)
          : new Uint8Array(size).fill(65)
      const backing = new Uint8Array(size + 2).fill(65)
      backing[0] = 99
      backing[backing.length - 1] = 99
      let right: Uint8Array =
        shape === `offset`
          ? backing.subarray(1, size + 1)
          : Uint8Array.from(left)
      if (shape === `different`) {
        if (size === 0) right = new Uint8Array([66])
        else right[size - 1] = 66
      }
      if (shape === `length`) right = new Uint8Array(size + 1).fill(65)
      if (form !== `array`)
        right = Buffer.from(right.buffer, right.byteOffset, right.byteLength)
      const expected = shape === `equal` || shape === `offset`
      const evaluate = compileSingleRowExpression(
        new Func(operator, [
          new PropRef([`blob`]),
          new Value(operator === `in` ? [null, right] : right),
        ]),
      )
      const observed = measureEncoding(() => evaluate({ blob: left }))
      expect(observed.result).toBe(expected)
      expect(observed.bytes).toBe(0)
    },
  )

  it.each([`eq`, `in`])(
    `compares a MiB using %s without caching mutable bytes`,
    (operator) => {
      const left = new Uint8Array(1024 * 1024).fill(65)
      const right = left.slice()
      const evaluate = compileSingleRowExpression(
        new Func(operator, [
          new PropRef([`blob`]),
          new Value(operator === `in` ? [right] : right),
        ]),
      )
      const equal = measureEncoding(() => evaluate({ blob: left }))
      expect(equal).toEqual({ result: true, bytes: 0 })
      right[right.length - 1] = 66
      const different = measureEncoding(() => evaluate({ blob: left }))
      expect(different).toEqual({ result: false, bytes: 0 })
    },
  )

  it.each([`eq`, `in`])(
    `keeps %s binary values separate from normalization-like strings`,
    (operator) => {
      const bytes = new Uint8Array([65])
      const text = '\u0000tanstack-db:binary:A'
      for (const [left, right] of [
        [bytes, text],
        [text, bytes],
      ]) {
        const evaluate = compileSingleRowExpression(
          new Func(operator, [
            new PropRef([`value`]),
            new Value(operator === `in` ? [right] : right),
          ]),
        )
        expect(evaluate({ value: left })).toBe(false)
      }
    },
  )
})
