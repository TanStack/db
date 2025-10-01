import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
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
const mockStream = {
  subscribe: mockSubscribe,
  requestSnapshot: (...args: any) => {
    mockRequestSnapshot(...args)
    const results = mockRequestSnapshot.mock.results
    const lastResult = results[results.length - 1]!.value

    const subscribers = mockSubscribe.mock.calls.map(args => args[0])
    subscribers.forEach(subscriber => subscriber(lastResult.data.map((row: any) => ({
      type: `insert`,
      value: row.value,
      key: row.key,
    }))))
  }
}

// Mock the requestSnapshot method
// to return an empty array of data
// since most tests don't use it
mockRequestSnapshot.mockResolvedValue({
  data: []
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
    it.only(`should load more data via requestSnapshot when creating live query with higher limit`, async () => {
      // Reset mocks
      vi.clearAllMocks()
      mockRequestSnapshot.mockResolvedValue({
        data: [
          { key: 5, value: { id: 5, name: `Eve`, age: 30, email: `eve@example.com`, active: true } },
          { key: 6, value: { id: 6, name: `Frank`, age: 35, email: `frank@example.com`, active: true } },
        ],
      })

      // Initial sync with limited data
      simulateInitialSync()
      expect(electricCollection.status).toBe(`ready`)
      expect(electricCollection.size).toBe(4)
      expect(mockRequestSnapshot).toHaveBeenCalledTimes(0)

      // Create first live query with limit of 2
      const limitedLiveQuery = createLiveQueryCollection({
        id: `limited-users-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
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

      const callArgs = (index: number) => mockRequestSnapshot.mock.calls[index]?.[0]
      expect(callArgs(0)).toMatchObject({
        params: { "1": "true" },
        where: "active = $1",
        orderBy: "age NULLS FIRST",
        limit: 2,
      })

      // Create second live query with higher limit of 5
      const expandedLiveQuery = createLiveQueryCollection({
        id: `expanded-users-live-query`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: electricCollection })
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

      // Verify that requestSnapshot was called with the correct parameters
      expect(mockRequestSnapshot).toHaveBeenCalledTimes(3)

      // Check that first it requested a limit of 6 users
      expect(callArgs(1)).toMatchObject({
        params: { "1": "true" },
        where: "active = $1",
        orderBy: "age NULLS FIRST",
        limit: 6,
      })

      // After this initial snapshot for the new live query it receives all 3 users from the local collection
      // so it still needs 3 more users to reach the limit of 6 so it requests 3 more to the sync layer
      expect(callArgs(2)).toMatchObject({
        params: { "1": "true", "2": "25" },
        where: "active = $1 AND age > $2",
        orderBy: "age NULLS FIRST",
        limit: 3,
      })

      // The sync layer won't provide any more users so the DB is exhausted and it stops (i.e. doesn't request more) 

      // The expanded live query should now have more data
      expect(expandedLiveQuery.status).toBe(`ready`)
      expect(expandedLiveQuery.size).toBe(5) // Alice, Bob, Dave from initial + Eve and Frank from additional data
    })
  }
})
