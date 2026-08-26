import { fc, test as fcTest } from '@fast-check/vitest'
import { expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { oraclePropertyOptions } from '../oracle-config.js'

type Row = { id: number }

let collectionSequence = 0

const projectionScenarioArbitrary = fc
  .record({
    sourceSize: fc.integer({ min: 1, max: 8 }),
    rawOffset: fc.nat(7),
    rawLimit: fc.nat(7),
  })
  .map(({ sourceSize, rawOffset, rawLimit }) => {
    const callerOffset = rawOffset % sourceSize
    const callerLimit = 1 + (rawLimit % (sourceSize - callerOffset))
    return { sourceSize, callerOffset, callerLimit }
  })

fcTest.prop([projectionScenarioArbitrary], oraclePropertyOptions(50))(
  `projects covering exhaustion relative to a finite source world`,
  async ({ sourceSize, callerOffset, callerLimit }) => {
    const rows = Array.from({ length: sourceSize }, (_, id) => ({ id }))
    let physicalLoads = 0
    const collection = createCollection<Row>({
      id: `load-subset-projection-oracle-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              physicalLoads++
              if (physicalLoads > 1) return true
              begin()
              for (const row of rows) write({ type: `insert`, value: row })
              commit()
              return Promise.resolve({
                hasMore: false,
                appliedRowKeys: rows.map(({ id }) => id),
              })
            },
          }
        },
      },
    })

    try {
      const physicalDemand = { offset: 0, limit: sourceSize }
      await collection._sync.loadSubset(physicalDemand)

      const callerDemand = { offset: callerOffset, limit: callerLimit }
      expect(collection._sync.loadSubset(callerDemand)).toBe(true)

      const callerEnd = callerOffset + callerLimit
      const expectedExtent = callerEnd < sourceSize ? `continues` : `exhausted`
      expect(collection._sync.getLoadSubsetOutcome(callerDemand)).toEqual(
        expect.objectContaining({
          demand: callerDemand,
          extent: expectedExtent,
        }),
      )
    } finally {
      await collection.cleanup()
    }
  },
)
