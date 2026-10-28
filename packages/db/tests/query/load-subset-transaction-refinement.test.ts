// Ordinary loadSubset transaction tests: a load aborted before it reaches the
// source. The abort-timing law for accepted and parked batches is owned by
// load-subset-transaction-refinement-oracle.test.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'

type Row = { id: string; group: string }

describe(`loadSubset transaction refinement`, () => {
  // A load aborted before it starts rejects with `AbortError` and never
  // reaches the source.
  it(`rejects a load aborted before it reaches the source`, async () => {
    let loadSubsetCalls = 0
    const source = createCollection<Row>({
      id: `transaction-refinement-before-load`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loadSubsetCalls++
              return true
            },
          }
        },
      },
    })
    source.startSyncImmediate()
    try {
      const controller = new AbortController()
      controller.abort()
      const load = source._sync.loadSubset({ signal: controller.signal })
      if (load === true) throw new Error(`Expected a rejected load`)
      await expect(load).rejects.toMatchObject({ name: `AbortError` })
      expect(loadSubsetCalls).toBe(0)
    } finally {
      await source.cleanup()
    }
  })
})
