/**
 * Ordinary harness test for the query-shape oracle. It checks the cleanup
 * helper that the oracle's drivers use: every release runs and every error is
 * kept. The oracle's law (join multiplicity, correlation identity, and null
 * keys) is owned by includes-query-shape-oracle.test.ts.
 */
import { test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { cleanupQuery } from './includes-query-shape-support.js'

describe(`includes query-shape recompute oracle`, () => {
  fcTest(`releases every source and retains cleanup errors`, async () => {
    const liveError = new Error(`live cleanup`)
    const sourceError = new Error(`source cleanup`)
    const released: Array<string> = []
    await expect(
      cleanupQuery(
        {
          cleanup: async () => {
            released.push(`live`)
            throw liveError
          },
        },
        [
          {
            collection: {
              cleanup: async () => {
                released.push(`first source`)
                throw sourceError
              },
            },
          },
          {
            collection: {
              cleanup: async () => {
                released.push(`second source`)
              },
            },
          },
        ],
      ),
    ).rejects.toMatchObject({ errors: [liveError, sourceError] })
    expect(released).toEqual([`live`, `first source`, `second source`])
  })
})
