import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Parent = {
  id: number
  name: string
}

type Child = {
  id: number
  parentId: number
  title: string
}

const sampleParents: Array<Parent> = [
  { id: 1, name: `Parent A` },
  { id: 2, name: `Parent B` },
  { id: 3, name: `Parent C` },
]

const sampleChildren: Array<Child> = [
  { id: 10, parentId: 1, title: `Child A1` },
  { id: 11, parentId: 1, title: `Child A2` },
  { id: 20, parentId: 2, title: `Child B1` },
]

describe(`loadedSubsets deduplication`, () => {
  function createParentsCollection() {
    return createCollection<Parent>({
      id: `dedup-parents`,
      getKey: (p) => p.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const parent of sampleParents) {
            write({ type: `insert`, value: parent })
          }
          commit()
          markReady()
        },
      },
    })
  }

  function createChildrenCollectionWithTracking() {
    const loadSubsetCalls: Array<LoadSubsetOptions> = []

    const collection = createCollection<Child>({
      id: `dedup-children`,
      getKey: (child) => child.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const child of sampleChildren) {
            write({ type: `insert`, value: child })
          }
          commit()
          markReady()
          return {
            loadSubset: vi.fn((options: LoadSubsetOptions) => {
              loadSubsetCalls.push(options)
              return Promise.resolve()
            }),
          }
        },
      },
    })

    return { collection, loadSubsetCalls }
  }

  it(`should not grow loadedSubsets when requestSnapshot is called with the same predicate`, async () => {
    const parents = createParentsCollection()
    const { collection: children, loadSubsetCalls } =
      createChildrenCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ p: parents })
        .join({ c: children }, ({ p, c }) => eq(c.parentId, p.id))
        .select(({ p, c }) => ({
          parentId: p.id,
          parentName: p.name,
          childId: c.id,
          childTitle: c.title,
        })),
    )

    await liveQuery.preload()

    const initialCallCount = loadSubsetCalls.length
    expect(initialCallCount).toBeGreaterThan(0)

    const firstCall = loadSubsetCalls[0]!
    expect(firstCall.where).toBeDefined()

    const filters = extractSimpleComparisons(firstCall.where)
    expect(filters).toEqual([
      {
        field: [`parentId`],
        operator: `in`,
        value: expect.arrayContaining([1, 2, 3]),
      },
    ])

    expect(loadSubsetCalls.length).toBe(initialCallCount)
  })

  it(`should deduplicate join key requests across pipeline batches`, async () => {
    let parentBegin: () => void
    let parentWrite: (msg: { type: string; value: Parent }) => void
    let parentCommit: () => void

    const parents = createCollection<Parent>({
      id: `dedup-parents-sync`,
      getKey: (p) => p.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          parentBegin = begin
          parentWrite = write as any
          parentCommit = commit

          begin()
          for (const parent of sampleParents) {
            write({ type: `insert`, value: parent })
          }
          commit()
          markReady()
        },
      },
    })

    const { collection: children, loadSubsetCalls } =
      createChildrenCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ p: parents })
        .join({ c: children }, ({ p, c }) => eq(c.parentId, p.id))
        .select(({ p, c }) => ({
          parentId: p.id,
          parentName: p.name,
          childId: c.id,
          childTitle: c.title,
        })),
    )

    await liveQuery.preload()

    const callCountAfterPreload = loadSubsetCalls.length

    parentBegin!()
    parentWrite!({ type: `insert`, value: { id: 4, name: `Parent D` } })
    parentCommit!()
    await flushPromises()

    const newCalls = loadSubsetCalls.slice(callCountAfterPreload)

    for (const call of newCalls) {
      if (!call.where) continue
      const filters = extractSimpleComparisons(call.where)
      for (const filter of filters) {
        if (filter.operator === `in`) {
          const values = filter.value as Array<number>
          expect(values).toContain(4)
          expect(values).not.toContain(1)
          expect(values).not.toContain(2)
          expect(values).not.toContain(3)
        }
      }
    }
  })
})
