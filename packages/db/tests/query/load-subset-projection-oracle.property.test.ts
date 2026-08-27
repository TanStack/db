import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { oraclePropertyOptions } from '../oracle-config.js'

type Row = { id: number }

let collectionSequence = 0

async function measureSynchronousEvidenceWork(
  authority: `applied` | `established`,
  candidateCount: number,
) {
  const rows = Array.from({ length: 32 }, (_, id) => ({ id }))
  const physicalDemands = Array.from({ length: candidateCount }, (_, index) =>
    Object.freeze({ limit: 16 + index }),
  )
  let loadCount = 0
  const collection = createCollection<Row>({
    id: `load-subset-${authority}-evidence-work-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            loadCount++
            if (loadCount > candidateCount) return true
            if (loadCount === 1) {
              begin()
              rows.forEach((row) => write({ type: `insert`, value: row }))
              commit()
            }
            return Promise.resolve({
              hasMore: authority === `established` ? false : undefined,
              appliedRowKeys: rows.map(({ id }) => id),
            })
          },
        }
      },
    },
  })

  try {
    for (const demand of physicalDemands) {
      const result = collection._sync.loadSubset(demand)
      if (result !== true) await result
    }

    const satisfiedDemand = Object.freeze({ limit: 1 })
    collection._sync.resetLoadSubsetEvidenceWorkCounts()
    expect(collection._sync.loadSubset(satisfiedDemand)).toBe(true)
    const satisfaction = collection._sync.getLoadSubsetEvidenceWorkCounts()

    collection._sync.resetLoadSubsetEvidenceWorkCounts()
    expect(collection._sync.getLoadSubsetOutcome(satisfiedDemand)).toEqual(
      expect.objectContaining({ demand: satisfiedDemand }),
    )
    const outcomeRead = collection._sync.getLoadSubsetEvidenceWorkCounts()

    return { satisfaction, outcomeRead }
  } finally {
    await collection.cleanup()
  }
}

test.each([`established`, `applied`] as const)(
  `bounds synchronous %s evidence work independently of candidate count`,
  async (authority) => {
    const oneCandidate = await measureSynchronousEvidenceWork(authority, 1)
    const eightCandidates = await measureSynchronousEvidenceWork(authority, 8)

    expect(eightCandidates).toEqual(oneCandidate)
    // Count copied row-key slots, not copy operations. The fixed budget includes
    // the selected projection and the coverage registry's stored snapshots.
    expect(eightCandidates).toEqual({
      satisfaction: {
        rowKeyCopies: 96,
        demandSnapshots: 4,
        demandKeyDerivations: 5,
      },
      outcomeRead: {
        rowKeyCopies: 32,
        demandSnapshots: 1,
        demandKeyDerivations: 1,
      },
    })
  },
)

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
