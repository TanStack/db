import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { TraceAssertionError } from '../trace-runner.js'
import { flushPromises } from '../utils.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
} from '../../src/types.js'

type Parent = { id: number; name: string }
type Child = { id: number; parentId: number; title: string }

const parents = [
  { id: 1, name: `A` },
  { id: 2, name: `B` },
  { id: 3, name: `C` },
]
const children = [
  { id: 10, parentId: 1, title: `A1` },
  { id: 11, parentId: 1, title: `A2` },
  { id: 20, parentId: 2, title: `B1` },
]

let sequence = 0
const cleanups: Array<() => void> = []

function createParents() {
  let begin!: () => void
  let write!: (message: ChangeMessageOrDeleteKeyMessage<Parent, number>) => void
  let commit!: () => void
  const collection = createCollection<Parent, number>({
    id: `join-dedupe-parents-${sequence++}`,
    getKey: (parent) => parent.id,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        for (const parent of parents) write({ type: `insert`, value: parent })
        commit()
        params.markReady()
      },
    },
  })
  cleanups.push(() => collection.cleanup())
  return {
    collection,
    insert: (parent: Parent) => {
      begin()
      write({ type: `insert`, value: parent })
      commit()
    },
  }
}

function createChildren() {
  const loads: Array<LoadSubsetOptions> = []
  const collection = createCollection<Child, number>({
    id: `join-dedupe-children-${sequence++}`,
    getKey: (child) => child.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const child of children) write({ type: `insert`, value: child })
        commit()
        markReady()
        return {
          loadSubset: vi.fn((options: LoadSubsetOptions) => {
            loads.push(options)
            return Promise.resolve()
          }),
        }
      },
    },
  })
  cleanups.push(() => collection.cleanup())
  return { collection, loads }
}

function createJoinedQuery(
  parentCollection: ReturnType<typeof createParents>[`collection`],
  childCollection: ReturnType<typeof createChildren>[`collection`],
) {
  const live = createLiveQueryCollection((query) =>
    query
      .from({ parent: parentCollection })
      .join({ child: childCollection }, ({ parent, child }) =>
        eq(child.parentId, parent.id),
      ),
  )
  cleanups.push(() => live.cleanup())
  return live
}

describe(`loadSubset join-key deduplication`, () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  })

  it(
    `discovered trace: a second live query reuses its loaded join predicate`,
    expectAssertionFailure(
      async () => {
        const { collection: parentCollection } = createParents()
        const { collection: childCollection, loads } = createChildren()
        const firstLive = createJoinedQuery(parentCollection, childCollection)

        await firstLive.preload()
        const loadCount = loads.length
        expect(loadCount).toBeGreaterThan(0)

        const secondLive = createJoinedQuery(parentCollection, childCollection)
        await secondLive.preload()
        try {
          expect(loads).toHaveLength(loadCount)
        } catch (error) {
          throw new TraceAssertionError(0, error)
        }
      },
      {
        checkpoint: 0,
        classify: ({ actual, expected }) => actual === 2 && expected === 1,
      },
    ),
  )

  it(`requests only a newly inserted join key`, async () => {
    const { collection: parentCollection, insert } = createParents()
    const { collection: childCollection, loads } = createChildren()
    const live = createJoinedQuery(parentCollection, childCollection)

    await live.preload()
    const loadCount = loads.length

    insert({ id: 4, name: `D` })
    await flushPromises()

    const newLoads = loads.slice(loadCount)
    expect(newLoads).toHaveLength(1)

    const [load] = newLoads
    if (!load) {
      throw new Error(`Expected one child transport load`)
    }
    expect(load).toEqual({
      where: expect.anything(),
      orderBy: undefined,
      limit: undefined,
      subscription: expect.anything(),
    })
    expect(load.where).toBeDefined()
    expect(extractSimpleComparisons(load.where)).toEqual([
      { field: [`parentId`], operator: `in`, value: [4] },
    ])
  })
})
