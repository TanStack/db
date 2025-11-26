import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
  lt,
} from "@tanstack/db"
import { electricCollectionOptions } from "../src/electric"
import type { ElectricCollectionUtils } from "../src/electric"
import type { Collection } from "@tanstack/db"
import type { Message } from "@electric-sql/client"
import type { StandardSchemaV1 } from "@standard-schema/spec"

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
const mockStream = {
  subscribe: mockSubscribe,
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

      const testElectricCollection = createCollection(
        electricCollectionOptions({
          id: `test-incremental-loading`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `users` },
          },
          syncMode: `on-demand`,
          getKey: (user: User) => user.id,
          startSync: true,
          autoIndex: `eager` as const,
        })
      )

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
      const limitedLiveQuery = createLiveQueryCollection({
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
      })

      expect(limitedLiveQuery.status).toBe(`ready`)
      expect(limitedLiveQuery.size).toBe(2) // Only first 2 active users
      expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

      const callArgs = (index: number) =>
        mockRequestSnapshot.mock.calls[index]?.[0]
      expect(callArgs(0)).toMatchObject({
        params: { "1": `true` },
        where: `"active" = $1`,
        orderBy: `"age" NULLS FIRST`,
        limit: 2,
      })

      // Next call will return a snapshot containing 2 rows
      // Calls after that will return the default empty snapshot
      mockRequestSnapshot.mockResolvedValueOnce({
        data: [
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
        ],
      })

      // Create second live query with higher limit of 6
      const expandedLiveQuery = createLiveQueryCollection({
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
      })

      // Wait for the live query to process
      await new Promise((resolve) => setTimeout(resolve, 0))

      // With the fix for limited query deduplication, queries with limits are only
      // deduplicated when their where clauses are EQUAL (not just subset).
      // Both queries have the same where clause (active = true), so the second query
      // with limit 6 can't fully reuse the first query with limit 2.
      // The internal query system may make additional requests as it processes.
      // TODO: Once we have cursor based pagination with the PK as a tiebreaker, we can reduce this.
      expect(mockRequestSnapshot).toHaveBeenCalledTimes(6)

      // Check that first it requested a limit of 2 users (from first query)
      expect(callArgs(0)).toMatchObject({
        params: { "1": `true` },
        where: `"active" = $1`,
        orderBy: `"age" NULLS FIRST`,
        limit: 2,
      })

      // Check that second it requested a limit of 6 users (from second query)
      expect(callArgs(1)).toMatchObject({
        params: { "1": `true` },
        where: `"active" = $1`,
        orderBy: `"age" NULLS FIRST`,
        limit: 6,
      })

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
    syncMode: `eager` | `on-demand` | `progressive`
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
    const liveQuery = createLiveQueryCollection({
      id: `on-demand-live-query`,
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

    // Should have requested more data from Electric with correct parameters
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5, // Requests full limit from Electric
        orderBy: `"age" NULLS FIRST`,
        where: `"active" = $1`,
        params: { 1: `true` }, // Parameters are stringified
      })
    )
    expect(liveQuery.size).toBeGreaterThan(2)
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
    createLiveQueryCollection({
      id: `progressive-live-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .orderBy(({ user }) => user.id, `asc`)
          .limit(3),
    })

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have fetched more data from Electric with correct parameters
    // Progressive mode uses fetchSnapshot, not requestSnapshot
    expect(mockFetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3, // Requests full limit from Electric
        orderBy: `"id" NULLS FIRST`,
        params: {},
      })
    )
    expect(mockRequestSnapshot).not.toHaveBeenCalled()
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
    createLiveQueryCollection({
      id: `expanding-live-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .orderBy(({ user }) => user.age, `asc`)
          .limit(3),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have requested snapshot for limit 3
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 3,
        orderBy: `"age" NULLS FIRST`,
      })
    )

    // With the fix for limited query deduplication, queries with limits but different
    // where clauses (or no where clause vs with where clause) are not deduplicated.
    // The internal query system may make additional requests as it processes the data.
    // TODO: Once we have cursor based pagination with the PK as a tiebreaker, we can reduce this.
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(3)
  })

  it(`should pass correct WHERE clause to requestSnapshot when live query has filters`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.size).toBe(0)

    // Create filtered live query
    createLiveQueryCollection({
      id: `filtered-live-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.name, `desc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have requested snapshot with WHERE clause
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: `"active" = $1`,
        params: { "1": `true` },
        orderBy: `"name" DESC NULLS FIRST`,
        limit: 10,
      })
    )
  })

  it(`should handle complex filters in fetchSnapshot`, async () => {
    const electricCollection =
      createElectricCollectionWithSyncMode(`progressive`)

    expect(electricCollection.status).toBe(`loading`) // Still syncing in progressive mode

    // Create live query with complex WHERE clause
    createLiveQueryCollection({
      id: `complex-filter-live-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 20))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(5),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have called fetchSnapshot with complex WHERE clause (not requestSnapshot)
    expect(mockFetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: `"age" > $1`,
        params: { "1": `20` },
        orderBy: `"age" NULLS FIRST`,
        limit: 5,
      })
    )
    expect(mockRequestSnapshot).not.toHaveBeenCalled()
  })
})

// Tests specifically for loadSubset deduplication
describe(`Electric Collection - loadSubset deduplication`, () => {
  let subscriber: (messages: Array<Message<User>>) => void

  function createElectricCollectionWithSyncMode(
    syncMode: `on-demand` | `progressive`
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

  it(`should deduplicate identical concurrent loadSubset requests`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create three identical live queries concurrently
    // Without deduplication, this would trigger 3 requestSnapshot calls
    // With deduplication, only 1 should be made
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // With deduplication, only 1 requestSnapshot call should be made
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)
    expect(mockRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        where: `"active" = $1`,
        params: { "1": `true` },
        orderBy: `"age" NULLS FIRST`,
        limit: 10,
      })
    )
  })

  it(`should deduplicate subset loadSubset requests with same where clause`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query with limit 20
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 10))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(20),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create a live query with SAME where clause but smaller limit
    // This SHOULD be deduped because where clauses are equal and limit is smaller
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 10)) // Same where clause
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10), // Smaller limit
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Still only 1 call - the second was deduped (same where, smaller limit)
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)
  })

  it(`should NOT deduplicate limited queries with different where clauses`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query with a broader predicate
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 10))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(20),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create a live query with a DIFFERENT where clause (even if more restrictive)
    // This should NOT be deduped because for limited queries, where clauses must be EQUAL.
    // The top 10 of "age > 20" might include rows outside the top 20 of "age > 10".
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 20)) // Different where clause
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // 2 calls - the second was NOT deduped (different where clause with limit)
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
  })

  it(`should NOT deduplicate non-subset loadSubset requests`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query with a narrower predicate
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 30))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create a live query with a broader predicate (age > 20 is NOT subset of age > 30)
    // This should NOT be deduped - should trigger another requestSnapshot
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 20))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have 2 calls - the second was not a subset
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
  })

  it(`should reset deduplication state on must-refetch/truncate`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync(sampleUsers)
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // With the fix for limited query deduplication, additional requests may be made
    // as the internal query system processes data.
    // TODO: Once we have cursor based pagination with the PK as a tiebreaker, we can reduce this.
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(3)

    // Simulate a must-refetch (which triggers truncate and reset)
    subscriber([{ headers: { control: `must-refetch` } }])
    subscriber([{ headers: { control: `up-to-date` } }])

    // Wait for the existing live query to re-request data after truncate
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The existing live query re-requests its data after truncate
    // TODO: Once we have cursor based pagination with the PK as a tiebreaker, we can reduce this.
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(5)

    // Create the same live query again after reset
    // This should NOT be deduped because the reset cleared the deduplication state,
    // but it WILL be deduped because the existing live query just made the same request
    // So creating a different query to ensure we test the reset
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, false))
          .orderBy(({ user }) => user.age, `asc`)
          .limit(10),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should have more calls - the different query triggered a new request
    // TODO: Once we have cursor based pagination with the PK as a tiebreaker, we can reduce this.
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(6)
  })

  it(`should deduplicate unlimited queries regardless of orderBy`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create a live query without limit (unlimited)
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.age, `asc`),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create another unlimited query with same where but different orderBy
    // This should be deduped - orderBy is ignored for unlimited queries
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => eq(user.active, true))
          .orderBy(({ user }) => user.name, `desc`),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Still only 1 call - different orderBy doesn't matter for unlimited queries
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)
  })

  it(`should combine multiple unlimited queries with union`, async () => {
    const electricCollection = createElectricCollectionWithSyncMode(`on-demand`)

    simulateInitialSync([])
    expect(electricCollection.status).toBe(`ready`)

    // Create first unlimited query (age > 30)
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 30)),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(1)

    // Create second unlimited query (age < 20) - different range
    // This should trigger a new request
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => lt(user.age, 20)),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)

    // Create third query (age > 35) - this is a subset of (age > 30)
    // This should be deduped
    createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ user: electricCollection })
          .where(({ user }) => gt(user.age, 35)),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    // Still 2 calls - third was covered by the union of first two
    expect(mockRequestSnapshot).toHaveBeenCalledTimes(2)
  })
})
