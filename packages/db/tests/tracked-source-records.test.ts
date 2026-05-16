import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { TrackedSourceRecordsManager } from '../src/collection/tracked-source-records.js'
import { LiveQueryTrackedSourceRecordsAggregator } from '../src/query/live/tracked-source-records-aggregator.js'
import { mockSyncCollectionOptions } from './utils.js'
import type { TrackedSourceRecordsChange } from '../src/types.js'

type User = {
  id: number
  name: string
}

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `users`,
      getKey: (user) => user.id,
      initialData: [],
    }),
  )
}

describe(`TrackedSourceRecordsManager`, () => {
  it(`nets overlapping additions and removals before applying them`, () => {
    const manager = new TrackedSourceRecordsManager<number>(`users`)
    const changes: Array<TrackedSourceRecordsChange> = []
    manager.subscribe((change) => changes.push(change))

    manager.apply([1], [1])

    expect(manager.get()).toEqual([])
    expect(changes).toEqual([])

    manager.apply([1], [])
    changes.length = 0

    manager.apply([1], [1])

    expect(manager.get()).toEqual([{ collectionId: `users`, key: 1 }])
    expect(changes).toEqual([])
  })
})

describe(`LiveQueryTrackedSourceRecordsAggregator`, () => {
  it(`nets overlapping additions and removals before notifying listeners`, () => {
    const usersCollection = createUsersCollection()
    const sourceChanges: Array<TrackedSourceRecordsChange> = []
    const liveQueryChanges: Array<TrackedSourceRecordsChange> = []
    const listeners = new Set<(change: TrackedSourceRecordsChange) => void>([
      (change) => liveQueryChanges.push(change),
    ])
    const aggregator = new LiveQueryTrackedSourceRecordsAggregator(
      { [usersCollection.id]: usersCollection },
      listeners,
    )

    usersCollection.subscribeTrackedSourceRecords((change) =>
      sourceChanges.push(change),
    )
    aggregator.setExposed(true)

    aggregator.apply(usersCollection.id, [1], [1])

    expect(aggregator.snapshot()).toEqual([])
    expect(usersCollection.getTrackedSourceRecords()).toEqual([])
    expect(liveQueryChanges).toEqual([])
    expect(sourceChanges).toEqual([])
  })
})
