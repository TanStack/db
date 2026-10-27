import { expect } from 'vitest'
import { hash } from '../src/hashing/hash'

// Shared by the hash law oracle and its ordinary tests. The law that
// expectEqualHashes asserts is owned by hash-oracle.property.test.ts.
export type HashValue = (value: unknown) => number

export function expectEqualHashes(
  value: unknown,
  equivalent: unknown,
  hashValue: HashValue = hash,
): void {
  expect(hashValue(value)).toBe(hashValue(equivalent))
}
