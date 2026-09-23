import { bench, describe } from 'vitest'
import { hash } from '../src/hashing/hash'

const cached = { id: 1, title: `row`, active: true }
hash(cached)
let result = 0

describe(`hash input paths`, () => {
  bench(`primitive`, () => {
    result ^= hash(42)
  })
  bench(`cached row`, () => {
    result ^= hash(cached)
  })
  bench(`fresh row`, () => {
    result ^= hash({ id: 1, title: `row`, active: true })
  })
})

// Keep benchmark results observable without adding work inside each sample.
export function getHashBenchmarkResult(): number {
  return result
}
