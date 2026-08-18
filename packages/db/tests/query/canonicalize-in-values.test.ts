import { describe, expect, it, vi } from 'vitest'
import { createLiveQueryCollection, inArray } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Child = { id: number; parentId: number; title: string }

const sampleChildren: Array<Child> = [
  { id: 10, parentId: 1, title: `Child A1` },
  { id: 20, parentId: 2, title: `Child B1` },
  { id: 30, parentId: 3, title: `Child C1` },
]

function createChildrenCollectionWithTracking() {
  const loadSubsetCalls: Array<LoadSubsetOptions> = []

  const collection = createCollection<Child>({
    id: `canon-children`,
    getKey: (child) => child.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
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

function firstInArrayValues(loadSubsetCalls: Array<LoadSubsetOptions>) {
  expect(loadSubsetCalls.length).toBeGreaterThan(0)
  const filters = extractSimpleComparisons(loadSubsetCalls[0]!.where)
  const inFilter = filters.find((f) => f.operator === `in`)
  expect(inFilter).toBeDefined()
  return inFilter!.value
}

describe(`canonicalize inArray value order`, () => {
  it(`sorts inArray values in the predicate passed to loadSubset`, async () => {
    const { collection: children, loadSubsetCalls } =
      createChildrenCollectionWithTracking()

    // Out-of-order literal — survives normalizeExpressionPaths unsorted, so
    // without canonicalization loadSubset would receive [3, 1, 2].
    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ c: children }).where(({ c }) => inArray(c.parentId, [3, 1, 2])),
    )

    await liveQuery.preload()

    expect(firstInArrayValues(loadSubsetCalls)).toEqual([1, 2, 3])
  })

  it(`sorts multi-digit numbers numerically, not lexicographically`, async () => {
    const { collection: children, loadSubsetCalls } =
      createChildrenCollectionWithTracking()

    // A lexicographic `.sort()` would yield [1, 10, 2]; the value comparator
    // must sort these numerically to [1, 2, 10].
    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ c: children }).where(({ c }) => inArray(c.parentId, [10, 2, 1])),
    )

    await liveQuery.preload()

    expect(firstInArrayValues(loadSubsetCalls)).toEqual([1, 2, 10])
  })

  it(`leaves a single-element inArray unchanged`, async () => {
    const { collection: children, loadSubsetCalls } =
      createChildrenCollectionWithTracking()

    const liveQuery = createLiveQueryCollection((q) =>
      q.from({ c: children }).where(({ c }) => inArray(c.parentId, [7])),
    )

    await liveQuery.preload()

    expect(firstInArrayValues(loadSubsetCalls)).toEqual([7])
  })

  it(`sorts inArray values for ordered/limited queries too`, async () => {
    const { collection: children, loadSubsetCalls } =
      createChildrenCollectionWithTracking()

    // orderBy + limit takes the requestLimitedSnapshot path; the where is still
    // canonicalized because it is normalized at subscription creation.
    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ c: children })
        .where(({ c }) => inArray(c.parentId, [3, 1, 2]))
        .orderBy(({ c }) => c.id)
        .limit(2),
    )

    await liveQuery.preload()

    expect(firstInArrayValues(loadSubsetCalls)).toEqual([1, 2, 3])
  })
})
