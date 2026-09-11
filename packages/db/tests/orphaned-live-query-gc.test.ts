import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions, resetCleanupQueue } from './utils.js'

type Person = { id: string; name: string }

const collections: Array<{ cleanup: () => Promise<void> }> = []

const makeSource = () => {
  const source = createCollection(
    mockSyncCollectionOptions<Person>({
      id: `orphan-gc-source`,
      getKey: (person) => person.id,
      initialData: [{ id: `1`, name: `Alice` }],
    }),
  )
  collections.push(source)
  return source
}

describe(`live query collections that never gain a subscriber`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCleanupQueue()
  })

  afterEach(async () => {
    for (const collection of collections.reverse()) await collection.cleanup()
    collections.length = 0
    await Promise.resolve()
    resetCleanupQueue()
    vi.useRealTimers()
  })

  it(`releases every orphan's source subscription after the grace period`, async () => {
    const source = makeSource()
    const orphans = Array.from({ length: 3 }, () => {
      const orphan = createLiveQueryCollection({
        startSync: true,
        gcTime: 1,
        query: (q) => q.from({ person: source }),
      })
      collections.push(orphan)
      return orphan
    })

    expect(source.subscriberCount).toBe(orphans.length)
    await vi.advanceTimersByTimeAsync(51)

    expect(orphans.map((orphan) => orphan.status)).toEqual([
      `cleaned-up`,
      `cleaned-up`,
      `cleaned-up`,
    ])
    expect(source.subscriberCount).toBe(0)
  })

  it(`stops evaluating a reclaimed query when its source changes`, async () => {
    const source = makeSource()
    const project = vi.fn(({ person }: { person: Person }) => ({ ...person }))
    const orphan = createLiveQueryCollection({
      startSync: true,
      gcTime: 1,
      query: (q) => q.from({ person: source }).fn.select(project),
    })
    collections.push(orphan)
    expect(project).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(51)
    expect(orphan.status).toBe(`cleaned-up`)
    project.mockClear()

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `2`, name: `Bob` } })
    source.utils.commit()

    expect(source.size).toBe(2)
    expect(project).not.toHaveBeenCalled()
    expect(source.subscriberCount).toBe(0)
  })
})
