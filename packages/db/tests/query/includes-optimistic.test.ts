// Harness tests for the optimistic relationship oracle's driver guards: a
// duplicate or same-level optimistic handle and a mismatched confirmation are
// rejected. These test the oracle's own machinery, not a relationship law. The
// owner is includes-optimistic-oracle.property.test.ts, and the guards are in
// includes-optimistic-support.ts.
import { test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  assertCanStartOptimisticChange,
  assertMatchingConfirmation,
} from './includes-optimistic-support.js'

describe(`optimistic relationship-transition oracle`, () => {
  fcTest(
    `rejects optimistic handles the sync mock cannot settle independently`,
    () => {
      const pending = new Map([[`first`, { level: 1 as const }]])

      expect(() => assertCanStartOptimisticChange(pending, 2, `first`)).toThrow(
        /Duplicate optimistic handle first/,
      )
      expect(() =>
        assertCanStartOptimisticChange(pending, 1, `second`),
      ).toThrow(/Level 1 already has pending optimistic handle first/)
      expect(() => assertMatchingConfirmation({ id: 11 }, { id: 12 })).toThrow(
        /Confirmation row 12 does not match pending row 11/,
      )
    },
  )
})
