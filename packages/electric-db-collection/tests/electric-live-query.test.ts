import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  createCollection,
  createEffect,
  createLiveQueryCollection,
  eq,
  gt,
  lt,
} from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import { tagPersistence } from './electric-persistence-fixture'
import type { ElectricCollectionUtils } from '../src/electric'
import type { Collection } from '@tanstack/db'
import type { Message } from '@electric-sql/client'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'

// A live query starts no provider work for its sources until it has a
// subscriber or a preload, so tests of the requests it sends subscribe it.
function subscribed<
  T extends { subscribeChanges: (callback: () => void) => unknown },
>(liveQuery: T): T {
  liveQuery.subscribeChanges(() => {})
  return liveQuery
}

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

// Sample data for tests
const sampleUsers: Array<User> = [
  {
    id: 1,
    name: `Alice`,
    age: 25,
    email: `alice@example.com`,
    active: true,
  },
  {
    id: 2,
    name: `Bob`,
    age: 19,
    email: `bob@example.com`,
    active: true,
  },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
  },
  {
    id: 4,
    name: `Dave`,
    age: 22,
    email: `dave@example.com`,
    active: true,
  },
]

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockRequestSnapshot = vi.fn()
const mockFetchSnapshot = vi.fn()

function expectNoRepeatedSnapshotRequests() {
  const requests = mockRequestSnapshot.mock.calls.map(([request]) => request)
  const keys = requests.map((request) => JSON.stringify(request))
  expect(keys).toHaveLength(new Set(keys).size)
}

const mockStream = {
  subscribe: mockSubscribe,
  unsubscribeAll: vi.fn(),
  fetchSnapshot: mockFetchSnapshot,
  requestSnapshot: async (...args: any) => {
    const result = await mockRequestSnapshot(...args)
    const subscribers = mockSubscribe.mock.calls.map((call) => call[0])
    const data = [...result.data]

    const messages: Array<Message<any>> = data.map((row: any) => ({
      value: row.value,
      key: row.key,
      headers: row.headers,
    }))

    if (messages.length > 0) {
      // add an up-to-date message
      messages.push({
        headers: { control: `up-to-date` },
      })
    }

    subscribers.forEach((subscriber) => subscriber(messages))
    return result
  },
}

// Mock the requestSnapshot method
// to return an empty array of data
// since most tests don't use it
mockRequestSnapshot.mockResolvedValue({
  data: [],
})

// Mock the fetchSnapshot method
// to return empty data with metadata
// since most tests don't use it
mockFetchSnapshot.mockResolvedValue({
  metadata: {},
  data: [],
})

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => mockStream),
  }
})

describe.each([
  [`autoIndex enabled (default)`, `eager` as const],
  [`autoIndex disabled`, `off` as const],
])(`Electric Collection with Live Query - %s`, (description, autoIndex) => {
  let electricCollection: Collection<
    User,
    string | number,
    ElectricCollectionUtils,
    StandardSchemaV1<unknown, unknown>,
    User
  >
  let subscriber: (messages: Array<Message<User>>) => void

  function createElectricUsersCollection() {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    // Create Electric collection with specified autoIndex
    const config = {
      id: `electric-users`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `users`,
        },
      },
      getKey: (user: User) => user.id,
      autoIndex,
    }

    const options = electricCollectionOptions(config)
    return createCollection({
      ...options,
      startSync: true,
      ...(autoIndex === `eager` ? { defaultIndexType: BasicIndex } : {}),
    }) as unknown as Collection<
      User,
      string | number,
      ElectricCollectionUtils,
      StandardSchemaV1<unknown, unknown>,
      User
    >
  }

  function simulateInitialSync(users: Array<User> = sampleUsers) {
    const messages: Array<Message<User>> = users.map((user) => ({
      key: user.id.toString(),
      value: user,
      headers: { operation: `insert` },
    }))

    messages.push({
      headers: { control: `up-to-date` },
    })

    subscriber(messages)
  }

  function simulateMustRefetch() {
    subscriber([
      {
        headers: { control: `must-refetch` },
      },
    ])
  }

  function simulateResync(users: Array<User>) {
    const messages: Array<Message<User>> = users.map((user) => ({
      key: user.id.toString(),
      value: user,
      headers: { operation: `insert` },
    }))

    messages.push({
      headers: { control: `up-to-date` },
    })

    subscriber(messages)
  }

  function simulateUpToDateOnly() {
    // Send only an up-to-date message with no data changes
    subscriber([{ headers: { control: `up-to-date` } }])
  }

  beforeEach(() => {
    electricCollection = createElectricUsersCollection()
  })

  it(`should handle basic must-refetch with filtered live query`, () => {
    // Create a live query with WHERE clause
    const activeLiveQuery = createLiveQueryCollection({
      id: `active-users-live-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            active: user.active,
          })),
    })

    // Initial sync
    simulateInitialSync()
    expect(electricCollection.status).toBe(`ready`)
    expect(electricCollection.size).toBe(4)
    expect(activeLiveQuery.status).toBe(`ready`)
    expect(activeLiveQuery.size).toBe(3) // Only active users

    // Must-refetch and resync with updated data
    simulateMustRefetch()
    const updatedUsers = [
      {
        id: 1,
        name: `Alice Updated`,
        age: 26,
        email: `alice@example.com`,
        active: true,
      },
      { id: 5, name: `Eve`, age: 24, email: `eve@example.com`, active: true },
      {
        id: 6,
        name: `Frank`,
        age: 35,
        email: `frank@example.com`,
        active: false,
      },
    ]
    simulateResync(updatedUsers)

    // BUG: Live query should have 2 active users but only shows 1
    expect(electricCollection.status).toBe(`ready`)
    expect(electricCollection.size).toBe(3)
    expect(activeLiveQuery.status).toBe(`ready`)
    expect(activeLiveQuery.size).toBe(2) // Only active users (Alice Updated and Eve)
  })

  it(`should handle must-refetch with complex projections`, () => {
    const complexLiveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 18))
          .select(({ user }) => ({
            userId: user.id,
            displayName: user.name,
            isAdult: user.age,
          })),
    })

    // Initial sync and must-refetch
    simulateInitialSync()
    simulateMustRefetch()

    const newUsers = [
      {
        id: 9,
        name: `Iris`,
        age: 30,
        email: `iris@example.com`,
        active: false,
      },
      {
        id: 10,
        name: `Jack`,
        age: 17,
        email: `jack@example.com`,
        active: true,
      }, // Under 18, filtered
    ]
    simulateResync(newUsers)

    expect(complexLiveQuery.status).toBe(`ready`)
    expect(complexLiveQuery.size).toBe(1) // Only Iris (Jack filtered by age)
    expect(complexLiveQuery.get(9)).toMatchObject({
      userId: 9,
      displayName: `Iris`,
      isAdult: 30,
    })
  })

  it(`should handle rapid must-refetch sequences`, () => {
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) => q.from({ user: electricCollection }),
    })

    // Initial sync
    simulateInitialSync()
    expect(liveQuery.size).toBe(4)

    // Multiple rapid must-refetch messages
    simulateMustRefetch()
    simulateMustRefetch()
    simulateMustRefetch()

    // Final resync
    const newUsers = [
      {
        id: 10,
        name: `New User`,
        age: 20,
        email: `new@example.com`,
        active: true,
      },
    ]
    simulateResync(newUsers)

    expect(electricCollection.status).toBe(`ready`)
    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(1)
  })

  it(`should handle live query becoming ready after must-refetch during initial sync`, () => {
    // Test that live queries properly transition to ready state when must-refetch
    // occurs during the initial sync of the source Electric collection

    let testSubscriber: (messages: Array<Message<User>>) => void = () => {}
    vi.clearAllMocks()
    mockSubscribe.mockImplementation((callback) => {
      testSubscriber = callback
      return () => {}
    })

    // Create Electric collection
    const testElectricCollection = createCollection({
      ...electricCollectionOptions({
        id: `initial-sync-collection`,
        shapeOptions: {
          url: `http://test-url`,
          params: {
            table: `users`,
          },
        },
        getKey: (user: User) => user.id,
      }),
      autoIndex,
      startSync: true,
      ...(autoIndex === `eager` ? { defaultIndexType: BasicIndex } : {}),
    })

    // Send initial data but don't complete sync (no up-to-date)
    testSubscriber([
      {
        key: `1`,
        value: {
          id: 1,
          name: `Alice`,
          age: 25,
          email: `alice@example.com`,
          active: true,
        },
        headers: { operation: `insert` },
      },
    ])

    expect(testElectricCollection.status).toBe(`loading`)

    // Create live query while Electric collection is still loading
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) => q.from({ user: testElectricCollection }),
    })

    expect(liveQuery.status).toBe(`loading`)

    // Send must-refetch while collection is in loading state
    testSubscriber([{ headers: { control: `must-refetch` } }])

    // Complete the sync
    testSubscriber([{ headers: { control: `up-to-date` } }])

    // Both Electric collection and live query should be ready
    expect(testElectricCollection.status).toBe(`ready`)
    expect(liveQuery.status).toBe(`ready`)
  })

  it(`should not emit changes on up-to-date messages with no data changes`, async () => {
    // Test to verify that up-to-date messages without actual data changes
    // don't trigger unnecessary renders in live query collections

    // Create a live query collection
    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .select(({ user }) => ({
            id: user.id,
            name: user.name,
            active: user.active,
          })),
    })

    // Track changes emitted by the live query
    const changeNotifications: Array<any> = []
    const subscription = liveQuery.subscribeChanges((changes) => {
      changeNotifications.push(changes)
    })

    // Initial sync with data
    simulateInitialSync()
    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(3) // Only active users

    // Clear any initial change notifications
    changeNotifications.length = 0

    // Send an up-to-date message with no data changes
    // This simulates the scenario where Electric sends up-to-date
    // but there are no actual changes to the data
    simulateUpToDateOnly()

    // Wait a tick to ensure any async operations complete
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The live query should not have emitted any changes
    // because there were no actual data changes
    expect(changeNotifications).toHaveLength(0)

    // Verify the collection is still in ready state
    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(3)

    // Clean up
    subscription.unsubscribe()
  })

  it(`should not emit changes on multiple consecutive up-to-date messages with no data changes`, async () => {
    // Test to verify that multiple consecutive up-to-date messages
    // without data changes don't accumulate unnecessary renders

    const liveQuery = createLiveQueryCollection({
      startSync: true,
      query: (q) => q.from({ user: electricCollection }),
    })

    // Track changes emitted by the live query
    const changeNotifications: Array<any> = []
    const subscription = liveQuery.subscribeChanges((changes) => {
      changeNotifications.push(changes)
    })

    // Initial sync
    simulateInitialSync()
    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(4)

    // Clear initial change notifications
    changeNotifications.length = 0

    // Send multiple up-to-date messages with no data changes
    simulateUpToDateOnly()
    simulateUpToDateOnly()
    simulateUpToDateOnly()

    // Wait for any async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should not have emitted any changes despite multiple up-to-date messages
    expect(changeNotifications).toHaveLength(0)

    // Verify collection state is still correct
    expect(liveQuery.status).toBe(`ready`)
    expect(liveQuery.size).toBe(4)

    // Clean up
    subscription.unsubscribe()
  })
  if (autoIndex === `eager`) {
    it(`should load more data via requestSnapshot when creating live query with higher limit`, async () => {
      // Create a new electric collection with on-demand syncMode for this test
      vi.clearAllMocks()

      let testSubscriber: (messages: Array<Message<User>>) => void = () => {}
      mockSubscribe.mockImplementation((callback) => {
        testSubscriber = callback
        return () => {}
      })

      const testElectricCollection = createCollection({
        ...electricCollectionOptions({
          id: `test-incremental-loading`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `users` },
          },
          syncMode: `on-demand`,
          getKey: (user: User) => user.id,
          startSync: true,
          autoIndex: `eager` as const,
        }),
        defaultIndexType: BasicIndex,
      })

      mockRequestSnapshot.mockResolvedValue({
        data: [],
      })

      // Initial sync with limited data
      testSubscriber([
        ...sampleUsers.map((user) => ({
          key: user.id.toString(),
          value: user,
          headers: { operation: `insert` as const },
        })),
        { headers: { control: `up-to-date` as const } },
      ])

      expect(testElectricCollection.status).toBe(`ready`)
      expect(testElectricCollection.size).toBe(4)
      expect(mockRequestSnapshot).toHaveBeenCalledTimes(0)

      // Create first live query with limit of 2
      const limitedLiveQuery = subscribed(
        createLiveQueryCollection({
          id: `limited-users-live-query`,
          startSync: true,
          query: (q) =>
            q
              .from({ user: testElectricCollection })
              .where(({ user }) => eq(user.active, true))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
                active: user.active,
                age: user.age,
              }))
              .orderBy(({ user }) => user.age, `asc`)
              .limit(2),
        }),
      )

      // Wait for async subset loading to complete
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(limitedLiveQuery.status).toBe(`ready`)
      expect(limitedLiveQuery.size).toBe(2) // Only first 2 active users
      expect(
        mockRequestSnapshot.mock.calls.map(([request]) => request),
      ).toEqual([
        {
          params: { '1': `true` },
          where: `"active" = $1`,
          orderBy: `"age" NULLS FIRST`,
          limit: 2,
        },
        {
          params: { '1': `true`, '2': `22` },
          where: `"active" = $1 AND "age" = $2`,
        },
      ])

      const callArgs = (index: number) =>
        mockRequestSnapshot.mock.calls[index]?.[0]
      expect(callArgs(0)).toMatchObject({
        params: { '1': `true` },
        where: `"active" = $1`,
        orderBy: `"age" NULLS FIRST`,
        limit: 2,
      })

      // Next call will return a snapshot containing 2 rows
      // Calls after that will return the default empty snapshot
      mockRequestSnapshot.mockImplementation(async ({ where }) => ({
        data: where.includes(` > `)
          ? [
              {
                headers: { operation: `insert` },
                key: 5,
                value: {
                  id: 5,
                  name: `Eve`,
                  age: 30,
                  email: `eve@example.com`,
                  active: true,
                },
              },
              {
                headers: { operation: `insert` },
                key: 6,
                value: {
                  id: 6,
                  name: `Frank`,
                  age: 35,
                  email: `frank@example.com`,
                  active: true,
                },
              },
            ]
          : [],
      }))

      // Create second live query with higher limit of 6
      const expandedLiveQuery = subscribed(
        createLiveQueryCollection({
          id: `expanded-users-live-query`,
          startSync: true,
          query: (q) =>
            q
              .from({ user: testElectricCollection })
              .where(({ user }) => eq(user.active, true))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
                active: user.active,
              }))
              .orderBy(({ user }) => user.age, `asc`)
              .limit(6),
        }),
      )

      // Wait for the live query to process
      await new Promise((resolve) => setTimeout(resolve, 0))

      expectNoRepeatedSnapshotRequests()

      // Check that first it requested a limit of 2 users (from first query)
      expect(callArgs(0)).toMatchObject({
        params: { '1': `true` },
        where: `"active" = $1`,
        orderBy: `"age" NULLS FIRST`,
        limit: 2,
      })

      expect(mockRequestSnapshot).toHaveBeenCalledWith({
        params: { '1': `true` },
        where: `"active" = $1`,
        orderBy: `"age" NULLS FIRST`,
        limit: 6,
      })
      expect(mockRequestSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          where: `"active" = $1 AND "age" > $2`,
          orderBy: `"age" NULLS FIRST`,
        }),
      )

      // The expanded live query should have the locally available data
      expect(expandedLiveQuery.status).toBe(`ready`)
      // The mock returned 2 additional users (Eve and Frank) in response to the limit 6 request,
      // plus the initial 3 active users (Alice, Bob, Dave) from the initial sync
      expect(expandedLiveQuery.size).toBe(5)
    })
  }
})

// Tests specifically for syncMode behavior with live queries
describe(`Electric Collection with Live Query - syncMode integration`, () => {
  let subscriber: (messages: Array<Message<User>>) => void

  function createElectricCollectionWithSyncMode(
    syncMode: `eager` | `on-demand` | `progressive`,
  ) {
    vi.clearAllMocks()

    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    mockRequestSnapshot.mockResolvedValue({
      data: [],
    })

    const config = {
      id: `electric-users-${syncMode}`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `users`,
        },
      },
      syncMode,
      getKey: (user: User) => user.id,
    }

    const options = electricCollectionOptions(config)
    return createCollection({
      ...options,
      startSync: true,
      autoIndex: `eager` as const,
      defaultIndexType: BasicIndex,
    })
  }

  function simulateInitialSync(users: Array<User> = sampleUsers) {
    const messages: Array<Message<User>> = users.map((user) => ({
      key: user.id.toString(),
      value: user,
      headers: { operation: `insert` },
    }))

    messages.push({
      headers: { control: `up-to-date` },
    })

    subscriber(messages)
  }

  it(`should trigger requestSnapshot in on-demand mode when live query needs more data`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    // Initial sync with limited data
    simulateInitialSync([sampleUsers[0]!, sampleUsers[1]!]) // Only Alice and Bob
    expect(electricCollection.status).toBe(`ready`)
    expect(electricCollection.size).toBe(2)
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(0)

    // Mock requestSnapshot to return additional data
    mockRequestSnapshot.mockResolvedValueOnce({
      data: [
        {
          headers: { operation: `insert` },
          key: 3,
          value: sampleUsers[2]!, // Charlie
        },
        {
          headers: { operation: `insert` },
          key: 4,
          value: sampleUsers[3]!, // Dave
        },
      ],
    })

    // Create live query with limit that exceeds available data
    const liveQuery = subscribed(
      createLiveQueryCollection({
        id: `on-demand-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(5),
      }),
    )

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have requested more data from Electric with correct parameters
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5, // Requests full limit from Electric
        orderBy: `"age" NULLS FIRST`,
        where: `"active" = $1`,
        params: { 1: `true` }, // Parameters are stringified
      }),
    )
    expect(liveQuery.size).toBeGreaterThan(2)
  })

  it(`loads a prefix while publishing only the requested offset window`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    mockRequestSnapshot.mockResolvedValueOnce({
      data: sampleUsers.map((user) => ({
        headers: { operation: `insert` },
        key: user.id,
        value: user,
      })),
    })

    const liveQuery = subscribed(
      createLiveQueryCollection({
        id: `offset-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(2)
            .offset(2),
      }),
    )

    await vi.waitFor(() => expect(liveQuery.status).toBe(`ready`))

    expect(mockRequestSnapshot.mock.calls[0]?.[0]).toMatchObject({
      limit: 4,
      orderBy: `"id" NULLS FIRST`,
      params: {},
    })
    expect(mockRequestSnapshot.mock.calls[0]?.[0]).not.toHaveProperty(`offset`)
    expect(liveQuery.toArray.map((user) => user.id)).toEqual([3, 4])
  })

  it(`should trigger fetchSnapshot in progressive mode when live query needs more data`, async () => {
    const electricCollection =
      createElectricCollectionWithSyncMode(`progressive`)

    // In progressive mode, stream messages are buffered until up-to-date
    // So collection starts empty even though we send data
    subscriber([
      {
        key: sampleUsers[0]!.id.toString(),
        value: sampleUsers[0]!,
        headers: { operation: `insert` },
      },
      {
        key: sampleUsers[1]!.id.toString(),
        value: sampleUsers[1]!,
        headers: { operation: `insert` },
      },
    ])

    expect(electricCollection.status).toBe(`loading`) // Still syncing in progressive mode
    // Messages are buffered, so size is 0 until up-to-date
    expect(electricCollection.size).toBe(0)

    // Mock fetchSnapshot to return data
    mockFetchSnapshot.mockResolvedValueOnce({
      metadata: {},
      data: [
        {
          headers: { operation: `insert` },
          key: sampleUsers[2]!.id.toString(),
          value: sampleUsers[2]!, // Charlie
        },
      ],
    })

    // Create live query that needs more data
    subscribed(
      createLiveQueryCollection({
        id: `progressive-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .orderBy(({ user }) => user.id, `asc`)
            .limit(3),
      }),
    )

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have fetched more data from Electric with correct parameters
    // Progressive mode uses fetchSnapshot, not requestSnapshot
    expect(mockFetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3, // Requests full limit from Electric
        orderBy: `"id" NULLS FIRST`,
        params: {},
      }),
    )
    expect(mockRequestSnapshot).not.toHaveBeenCalled()
  })

  // Receiving witnesses for the core initial-readiness law (Model D of
  // includes-temporal-oracle.test.ts). A real progressive source settles a
  // query's subset while its own Collection stays `loading` until the full
  // sync, and a real on-demand source is ready before its subset loads.
  // Initial-query readiness and Effect `skipInitial` follow the settled subset
  // in both cases. Electric buffers progressive changes until the full sync,
  // so it cannot deliver a change between settlement and source readiness;
  // the controlled core lane owns that history.
  describe(`initial readiness follows the settled subset`, () => {
    const selectedUser = sampleUsers[0]!
    const laterUser = { ...sampleUsers[3]!, active: true, id: 5 }

    function startProgressiveSubset() {
      const electricCollection =
        createElectricCollectionWithSyncMode(`progressive`)
      mockFetchSnapshot.mockResolvedValueOnce({
        metadata: {},
        data: [
          {
            headers: { operation: `insert` },
            key: selectedUser.id.toString(),
            value: selectedUser,
          },
        ],
      })
      return electricCollection
    }

    function completeFullSync(users: Array<User>) {
      subscriber([
        ...users.map((user) => ({
          key: user.id.toString(),
          value: user,
          headers: { operation: `insert` as const },
        })),
        { headers: { control: `up-to-date` } },
      ])
    }

    it(`a live query is ready once its subset loads`, async () => {
      const electricCollection = startProgressiveSubset()
      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.id, selectedUser.id)),
      )

      let preloaded = false
      void liveQuery.preload().then(() => {
        preloaded = true
      })
      await vi.waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(preloaded).toBe(true)
      expect(electricCollection.status).toBe(`loading`)
      expect(liveQuery.status).toBe(`ready`)
      expect(liveQuery.toArray.map((user) => user.id)).toEqual([
        selectedUser.id,
      ])

      completeFullSync(sampleUsers)

      expect(electricCollection.status).toBe(`ready`)
      expect(liveQuery.status).toBe(`ready`)
      expect(liveQuery.toArray.map((user) => user.id)).toEqual([
        selectedUser.id,
      ])
    })

    // A known limit, pinned so that a change to Electric's buffering is
    // visible: before the full sync, a ready progressive query shows its
    // snapshot rows, and stream changes to them wait for the atomic swap.
    it(`a ready query's rows update only when the full sync completes`, async () => {
      const electricCollection = startProgressiveSubset()
      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.id, selectedUser.id)),
      )
      await liveQuery.preload()
      const renamed = { ...selectedUser, name: `Alice renamed` }

      subscriber([
        {
          key: selectedUser.id.toString(),
          value: renamed,
          headers: { operation: `update` },
        },
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(liveQuery.toArray.map((user) => user.name)).toEqual([
        selectedUser.name,
      ])

      completeFullSync([renamed])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(liveQuery.toArray.map((user) => user.name)).toEqual([renamed.name])
    })

    it(`a skipInitial effect suppresses only its subset rows`, async () => {
      const electricCollection = startProgressiveSubset()
      const entered: Array<number> = []
      const effect = createEffect<User>({
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true)),
        skipInitial: true,
        onEnter: (event) => {
          entered.push(event.value.id)
        },
      })

      await vi.waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(electricCollection.status).toBe(`loading`)
      expect(entered).toEqual([])

      // The full sync delivers the subset row again plus a row that became
      // active after the subset loaded. Only the latter is a change.
      completeFullSync([selectedUser, laterUser])

      expect(electricCollection.status).toBe(`ready`)
      await vi.waitFor(() => expect(entered).toEqual([laterUser.id]))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(entered).toEqual([laterUser.id])
      await effect.dispose()
    })

    it(`a skipInitial effect over an on-demand source suppresses its subset rows`, async () => {
      const electricCollection =
        createElectricCollectionWithSyncMode(`on-demand`)
      simulateInitialSync([])
      expect(electricCollection.status).toBe(`ready`)
      mockRequestSnapshot.mockResolvedValueOnce({
        data: [
          {
            headers: { operation: `insert` },
            key: selectedUser.id,
            value: selectedUser,
          },
        ],
      })
      const entered: Array<number> = []
      const effect = createEffect<User>({
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true)),
        skipInitial: true,
        onEnter: (event) => {
          entered.push(event.value.id)
        },
      })

      await vi.waitFor(() =>
        expect(mockRequestSnapshot).toHaveBeenCalledTimes(1),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(electricCollection.has(selectedUser.id)).toBe(true)
      expect(entered).toEqual([])

      subscriber([
        {
          key: laterUser.id.toString(),
          value: laterUser,
          headers: { operation: `insert` },
        },
        { headers: { control: `up-to-date` } },
      ])

      await vi.waitFor(() => expect(entered).toEqual([laterUser.id]))
      await effect.dispose()
    })

    // Applied settlement: a progressive load may settle only once its rows
    // are visible or the source's initial sync is ready. Outside the buffered
    // initial sync a progressive load installs no rows itself, so each phase
    // below predicts "not ready" while the row is absent and the source is
    // loading, then "ready with the row" once the sync that holds it applies.
    // The phases are a must-refetch before the query's load and a
    // must-refetch while its fetch is in flight. A stream resumed from an
    // explicit offset is the neighboring case: its local materialization is
    // complete by contract (the descriptor-isolation oracle's resumed-subset
    // checkpoint), so the query is ready at once on the rows it holds.
    describe.each([
      `reset before the load`,
      `reset during the fetch`,
      `resumed from an offset`,
    ] as const)(`progressive load outside the buffered sync: %s`, (phase) => {
      it(`reports the query ready only once its rows are established`, async () => {
        const electricCollection =
          phase === `resumed from an offset`
            ? createProgressiveFromOffset()
            : createElectricCollectionWithSyncMode(`progressive`)
        let resolveFetch: (() => void) | undefined
        // A phase that never fetches leaves its one-shot response queued.
        mockFetchSnapshot.mockReset()
        mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })
        mockFetchSnapshot.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFetch = () =>
                resolve({
                  metadata: {},
                  data: [
                    {
                      headers: { operation: `insert` },
                      key: selectedUser.id.toString(),
                      value: selectedUser,
                    },
                  ],
                })
            }),
        )
        if (phase === `reset before the load`) {
          subscriber([{ headers: { control: `must-refetch` } }])
        }
        const liveQuery = createLiveQueryCollection((q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.id, selectedUser.id)),
        )
        let preloaded = false
        void liveQuery.preload().then(() => {
          preloaded = true
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (phase === `reset during the fetch`) {
          await vi.waitFor(() => expect(resolveFetch).toBeDefined())
          subscriber([{ headers: { control: `must-refetch` } }])
          resolveFetch!()
        }
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(electricCollection.status).toBe(`loading`)
        expect(electricCollection.has(selectedUser.id)).toBe(false)
        const resumed = phase === `resumed from an offset`
        expect({ ready: liveQuery.isReady(), preloaded }).toEqual({
          ready: resumed,
          preloaded: resumed,
        })

        completeFullSync([selectedUser])
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(electricCollection.status).toBe(`ready`)
        expect({ ready: liveQuery.isReady(), preloaded }).toEqual({
          ready: true,
          preloaded: true,
        })
        expect(liveQuery.toArray.map((user) => user.id)).toEqual([
          selectedUser.id,
        ])
      })
    })

    // A load after the full sync settles only once the swap's applied
    // receipt resolves. Here the swap's durable write is held. Whether the
    // row is visible yet is a persistence detail, so the check is the law
    // itself: a ready query shows the row.
    it(`a load after the full sync is ready only with the swap's rows`, async () => {
      vi.clearAllMocks()
      mockSubscribe.mockImplementation((callback) => {
        subscriber = callback
        return () => {}
      })
      const { adapter } = tagPersistence()
      let releaseSwap: (() => void) | undefined
      const heldAdapter: PersistenceAdapter = {
        ...adapter,
        applyCommittedTx: async (id, transaction) => {
          if (
            transaction.mutations.some(
              (mutation) => mutation.key === selectedUser.id,
            )
          ) {
            await new Promise<void>((resolve) => {
              releaseSwap = resolve
            })
          }
          return adapter.applyCommittedTx(id, transaction)
        },
      }
      const electricCollection = createCollection(
        persistedCollectionOptions<
          User,
          string | number,
          never,
          ElectricCollectionUtils<User>
        >({
          ...electricCollectionOptions({
            id: `electric-users-progressive-persisted`,
            shapeOptions: {
              url: `http://test-url`,
              params: { table: `users` },
            },
            syncMode: `progressive`,
            getKey: (user: User) => user.id,
          }),
          persistence: { adapter: heldAdapter },
        }),
      )
      electricCollection.startSyncImmediate()
      await vi.waitFor(() => expect(mockSubscribe).toHaveBeenCalled())
      completeFullSync([selectedUser])
      await vi.waitFor(() => expect(releaseSwap).toBeDefined())

      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.id, selectedUser.id)),
      )
      let preloaded = false
      void liveQuery.preload().then(() => {
        preloaded = true
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      if (liveQuery.isReady()) {
        expect(liveQuery.toArray.map((user) => user.id)).toEqual([
          selectedUser.id,
        ])
      }

      releaseSwap!()
      await vi.waitFor(() => expect(preloaded).toBe(true))
      expect(liveQuery.toArray.map((user) => user.id)).toEqual([
        selectedUser.id,
      ])
    })

    // A stream error rejects the snapshot that waiting loads follow. When
    // the user's onError retries and the stream recovers, the recovered full
    // sync establishes the snapshot again, so later loads must settle.
    it(`settles later loads after onError retries a progressive stream`, async () => {
      vi.clearAllMocks()
      mockSubscribe.mockImplementation((callback) => {
        subscriber = callback
        return () => {}
      })
      const electricCollection = createCollection({
        ...electricCollectionOptions({
          id: `electric-users-progressive-retry`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `users` },
            onError: () => ({}),
          },
          syncMode: `progressive`,
          getKey: (user: User) => user.id,
        }),
        startSync: true,
      })
      const streamOptions = vi.mocked(ShapeStream).mock.calls.at(-1)![0] as {
        onError: (error: Error) => Promise<unknown>
      }
      await streamOptions.onError(new Error(`stream failed`))
      completeFullSync([selectedUser])
      await vi.waitFor(() => expect(electricCollection.status).toBe(`ready`))

      const liveQuery = createLiveQueryCollection((q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.id, selectedUser.id)),
      )
      await liveQuery.preload()
      expect(liveQuery.status).toBe(`ready`)
      expect(liveQuery.toArray.map((user) => user.id)).toEqual([
        selectedUser.id,
      ])
    })

    function createProgressiveFromOffset() {
      vi.clearAllMocks()
      mockSubscribe.mockImplementation((callback) => {
        subscriber = callback
        return () => {}
      })
      return createCollection({
        ...electricCollectionOptions({
          id: `electric-users-progressive-offset`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `users` },
            offset: `0_0`,
            handle: `resumed-handle`,
          },
          syncMode: `progressive`,
          getKey: (user: User) => user.id,
        }),
        startSync: true,
      })
    }
  })

  it(`should NOT trigger requestSnapshot in eager mode even when live query needs more data`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`eager`)

    // Initial sync with limited data
    simulateInitialSync([sampleUsers[0]!, sampleUsers[1]!]) // Only Alice and Bob
    expect(electricCollection.status).toBe(`ready`)
    expect(electricCollection.size).toBe(2)
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(0)

    // Create live query with limit that exceeds available data
    const liveQuery = createLiveQueryCollection({
      id: `eager-live-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(5),
    })

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should NOT have requested more data (eager mode doesn't support incremental loading)
    expect(mockRequestSnapshot).not.toHaveBeenCalled()
    expect(liveQuery.size).toBe(2) // Only has the initially synced data
  })

  it(`should request additional snapshots progressively as live query expands in on-demand mode`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    // Initial sync with just Alice
    simulateInitialSync([sampleUsers[0]!])
    expect(electricCollection.size).toBe(1)

    // First snapshot returns Bob and Charlie
    mockRequestSnapshot.mockResolvedValueOnce({
      data: [
        {
          headers: { operation: `insert` },
          key: 2,
          value: sampleUsers[1]!, // Bob
        },
        {
          headers: { operation: `insert` },
          key: 3,
          value: sampleUsers[2]!, // Charlie
        },
      ],
    })

    // Create live query with limit of 3
    subscribed(
      createLiveQueryCollection({
        id: `expanding-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .orderBy(({ user }) => user.age, `asc`)
            .limit(3),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have requested snapshot for limit 3
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3,
        orderBy: `"age" NULLS FIRST`,
      }),
    )

    // Electric maps one cursor demand to a bounded page plus its exact tie.
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
    expectNoRepeatedSnapshotRequests()
  })

  it(`should pass correct WHERE clause to requestSnapshot when live query has filters`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.size).toBe(0)

    // Create filtered live query
    subscribed(
      createLiveQueryCollection({
        id: `filtered-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.name, `desc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have requested snapshot with WHERE clause
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: `"active" = $1`,
        params: { '1': `true` },
        orderBy: `"name" DESC NULLS FIRST`,
        limit: 10,
      }),
    )
  })

  it(`should handle complex filters in fetchSnapshot`, async () => {
    const electricCollection =
      createElectricCollectionWithSyncMode(`progressive`)

    expect(electricCollection.status).toBe(`loading`) // Still syncing in progressive mode

    // Create live query with complex WHERE clause
    subscribed(
      createLiveQueryCollection({
        id: `complex-filter-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 20))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(5),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have called fetchSnapshot with complex WHERE clause (not requestSnapshot)
    expect(mockFetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: `"age" > $1`,
        params: { '1': `20` },
        orderBy: `"age" NULLS FIRST`,
        limit: 5,
      }),
    )
    expect(mockRequestSnapshot).not.toHaveBeenCalled()
  })
})

// Tests specifically for loadSubset deduplication
describe(`Electric Collection - loadSubset deduplication`, () => {
  let subscriber: (messages: Array<Message<User>>) => void

  function createElectricCollectionWithSyncMode(
    syncMode: `on-demand` | `progressive`,
  ) {
    vi.clearAllMocks()

    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    mockRequestSnapshot.mockResolvedValue({
      data: [],
    })

    const config = {
      id: `electric-dedupe-test-${syncMode}`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `users`,
        },
      },
      syncMode,
      getKey: (user: User) => user.id,
    }

    const options = electricCollectionOptions(config)
    return createCollection({
      ...options,
      startSync: true,
      autoIndex: `eager` as const,
      defaultIndexType: BasicIndex,
    })
  }

  function simulateInitialSync(users: Array<User> = sampleUsers) {
    const messages: Array<Message<User>> = users.map((user) => ({
      key: user.id.toString(),
      value: user,
      headers: { operation: `insert` },
    }))

    messages.push({
      headers: { control: `up-to-date` },
    })

    subscriber(messages)
  }

  it(`keeps independently abortable live-query requests independent`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Each live query owns its own abort signal, so canceling one cannot cancel
    // transport work still needed by a peer.
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(3)
    for (const [request] of mockRequestSnapshot.mock.calls) {
      expect(request).toMatchObject({
        where: `"active" = $1`,
        params: { '1': `true` },
        orderBy: `"age" NULLS FIRST`,
        limit: 10,
      })
    }
  })

  it(`keeps different exact windows independent despite a shared predicate`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query with limit 20
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 10))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(20),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // A smaller limit is a distinct exact demand. A requested wider window does
    // not prove that its rows were applied or that the source was exhausted.
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 10)) // Same where clause
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10), // Smaller limit
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
    expect(
      mockRequestSnapshot.mock.calls.map(([request]) => request.limit),
    ).toEqual([20, 10])
  })

  it(`should NOT deduplicate limited queries with different where clauses`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query with a broader predicate
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 10))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(20),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create a live query with a DIFFERENT where clause (even if more restrictive)
    // This should NOT be deduped because for limited queries, where clauses must be EQUAL.
    // The top 10 of "age > 20" might include rows outside the top 20 of "age > 10".
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 20)) // Different where clause
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    // 2 calls - the second was NOT deduped (different where clause with limit)
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
  })

  it(`should NOT deduplicate non-subset loadSubset requests`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query with a narrower predicate
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 30))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create a live query with a broader predicate (age > 20 is NOT subset of age > 30)
    // This should NOT be deduped - should trigger another requestSnapshot
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 20))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have 2 calls - the second was not a subset
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
  })

  it(`should reset deduplication state on must-refetch/truncate`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync(sampleUsers)
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    const requestsBeforeReset = mockRequestSnapshot.mock.calls.map(
      ([request]) => JSON.stringify(request),
    )
    expect(requestsBeforeReset.length).toBeGreaterThan(0)

    // Simulate a must-refetch (which triggers truncate and reset)
    subscriber([{ headers: { control: `must-refetch` } }])
    subscriber([{ headers: { control: `up-to-date` } }])

    // Wait for the existing live query to re-request data after truncate
    await new Promise((resolve) => setTimeout(resolve, 0))

    const requestsAfterReset = mockRequestSnapshot.mock.calls
      .slice(requestsBeforeReset.length)
      .map(([request]) => JSON.stringify(request))
    expect(requestsAfterReset.length).toBeGreaterThan(0)
    expect(
      requestsAfterReset.some((request) =>
        requestsBeforeReset.includes(request),
      ),
    ).toBe(true)

    // Create the same live query again after reset
    // This should NOT be deduped because the reset cleared the deduplication state,
    // but it WILL be deduped because the existing live query just made the same request
    // So creating a different query to ensure we test the reset
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, false))
            .orderBy(({ user }) => user.age, `asc`)
            .limit(10),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ params: { '1': `false` } }),
    )
  })

  it(`keeps different exact unlimited orderings independent`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query without limit (unlimited)
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.age, `asc`),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Order remains part of exact demand identity even without a limit.
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true))
            .orderBy(({ user }) => user.name, `desc`),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
    expect(
      mockRequestSnapshot.mock.calls.map(([request]) => request.orderBy),
    ).toEqual([`"age" NULLS FIRST`, `"name" DESC NULLS FIRST`])
  })

  it(`does not infer union coverage across different predicates`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create first unlimited query (age > 30)
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 30)),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create second unlimited query (age < 20) - different range
    // This should trigger a new request
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => lt(user.age, 20)),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)

    // A broader requested predicate does not prove applied coverage for this
    // distinct exact predicate.
    subscribed(
      createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => gt(user.age, 35)),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(3)
    expect(
      mockRequestSnapshot.mock.calls.map(([request]) => request.params),
    ).toEqual([{ '1': `30` }, { '1': `20` }, { '1': `35` }])
  })

  it(`reuses retained Electric rows after the final live-query owner leaves`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)
    const row = sampleUsers[0]!
    simulateInitialSync([])
    mockRequestSnapshot.mockResolvedValue({
      data: [
        {
          headers: { operation: `insert` },
          key: row.id,
          value: row,
        },
      ],
    })
    const createLive = (id: string) =>
      createLiveQueryCollection({
        id,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
            .where(({ user }) => eq(user.active, true)),
      })
    const first = createLive(`electric-remount-first`)
    let second: ReturnType<typeof createLive> | undefined

    try {
      await first.preload()
      expect(first.toArray.map(({ id }) => id)).toEqual([row.id])

      await first.cleanup()
      expect(electricCollection.size).toBe(1)

      second = createLive(`electric-remount-second`)
      await second.preload()

      expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)
      expect(second.toArray.map(({ id }) => id)).toEqual([row.id])
    } finally {
      await Promise.all([
        first.cleanup(),
        second?.cleanup(),
        electricCollection.cleanup(),
      ])
    }
  })
})
