import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import type { Message } from '@electric-sql/client'

// Sample types for tests
type User = {
  id: number
  name: string
  department_id: number
}

type Department = {
  id: number
  name: string
}

// Sample data
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, department_id: 1 },
  { id: 2, name: `Bob`, department_id: 1 },
  { id: 3, name: `Charlie`, department_id: 2 },
]

const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering` },
  { id: 2, name: `Sales` },
]

// Mock the ShapeStream module - we need separate mocks for different collections
const mockUsersSubscribe = vi.fn()
const mockUsersRequestSnapshot = vi.fn()
const mockUsersFetchSnapshot = vi.fn()
const mockUsersStream = {
  subscribe: mockUsersSubscribe,
  requestSnapshot: mockUsersRequestSnapshot,
  fetchSnapshot: mockUsersFetchSnapshot,
}

const mockDepartmentsSubscribe = vi.fn()
const mockDepartmentsRequestSnapshot = vi.fn()
const mockDepartmentsFetchSnapshot = vi.fn()
const mockDepartmentsStream = {
  subscribe: mockDepartmentsSubscribe,
  requestSnapshot: mockDepartmentsRequestSnapshot,
  fetchSnapshot: mockDepartmentsFetchSnapshot,
}

// Track which collection is being created to return the right mock stream
let creatingCollection: `users` | `departments` = `users`

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => {
      if (creatingCollection === `users`) {
        return mockUsersStream
      }
      return mockDepartmentsStream
    }),
  }
})

describe(`Electric Collection - Progressive mode with joins`, () => {
  let usersSubscriber: (messages: Array<Message<User>>) => void
  let departmentsSubscriber: (messages: Array<Message<Department>>) => void

  function createProgressiveUsersCollection() {
    creatingCollection = `users`

    mockUsersSubscribe.mockImplementation((callback) => {
      usersSubscriber = callback
      return () => {}
    })

    // Make requestSnapshot throw the error we see in the issue
    mockUsersRequestSnapshot.mockImplementation(() => {
      throw new Error(
        `Snapshot requests are not supported in full mode, as the consumer is guaranteed to observe all data`,
      )
    })

    mockUsersFetchSnapshot.mockResolvedValue({
      metadata: {},
      data: [],
    })

    const options = electricCollectionOptions({
      id: `progressive-users`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `users` },
      },
      syncMode: `progressive`,
      getKey: (user: User) => user.id,
    })

    return createCollection({
      ...options,
      startSync: true,
      autoIndex: `eager` as const,
    })
  }

  function createProgressiveDepartmentsCollection() {
    creatingCollection = `departments`

    mockDepartmentsSubscribe.mockImplementation((callback) => {
      departmentsSubscriber = callback
      return () => {}
    })

    // Make requestSnapshot throw the error we see in the issue
    mockDepartmentsRequestSnapshot.mockImplementation(() => {
      throw new Error(
        `Snapshot requests are not supported in full mode, as the consumer is guaranteed to observe all data`,
      )
    })

    mockDepartmentsFetchSnapshot.mockResolvedValue({
      metadata: {},
      data: [],
    })

    const options = electricCollectionOptions({
      id: `progressive-departments`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `departments` },
      },
      syncMode: `progressive`,
      getKey: (dept: Department) => dept.id,
    })

    return createCollection({
      ...options,
      startSync: true,
      autoIndex: `eager` as const,
    })
  }

  function simulateUsersSync(users: Array<User> = sampleUsers) {
    const messages: Array<Message<User>> = users.map((user) => ({
      key: user.id.toString(),
      value: user,
      headers: { operation: `insert` },
    }))
    messages.push({ headers: { control: `up-to-date` } })
    usersSubscriber(messages)
  }

  function simulateDepartmentsSync(
    departments: Array<Department> = sampleDepartments,
  ) {
    const messages: Array<Message<Department>> = departments.map((dept) => ({
      key: dept.id.toString(),
      value: dept,
      headers: { operation: `insert` },
    }))
    messages.push({ headers: { control: `up-to-date` } })
    departmentsSubscriber(messages)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it(`should handle join between two progressive collections without calling requestSnapshot`, async () => {
    // Create two progressive collections
    const usersCollection = createProgressiveUsersCollection()
    const departmentsCollection = createProgressiveDepartmentsCollection()

    // Complete initial sync for both collections
    simulateUsersSync()
    simulateDepartmentsSync()

    expect(usersCollection.status).toBe(`ready`)
    expect(departmentsCollection.status).toBe(`ready`)
    expect(usersCollection.size).toBe(3)
    expect(departmentsCollection.size).toBe(2)

    // Create a live query that joins both collections
    // This should NOT throw an error about "Snapshot requests are not supported in full mode"
    const joinQuery = createLiveQueryCollection({
      id: `users-with-departments`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `left`,
          )
          .select(({ user, dept }) => ({
            user_name: user.name,
            department_name: dept?.name,
          })),
    })

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The join query should have all users with their departments
    expect(joinQuery.status).toBe(`ready`)
    expect(joinQuery.size).toBe(3) // All 3 users

    // Verify that requestSnapshot was NOT called on either collection
    // because progressive mode should not use requestSnapshot after initial sync
    expect(mockUsersRequestSnapshot).not.toHaveBeenCalled()
    expect(mockDepartmentsRequestSnapshot).not.toHaveBeenCalled()

    // Verify the data is correct
    const results = joinQuery.toArray
    const alice = results.find((r) => r.user_name === `Alice`)
    expect(alice).toMatchObject({
      user_name: `Alice`,
      department_name: `Engineering`,
    })

    const charlie = results.find((r) => r.user_name === `Charlie`)
    expect(charlie).toMatchObject({
      user_name: `Charlie`,
      department_name: `Sales`,
    })
  })

  it(`should handle join when joined collection is still in buffering phase`, async () => {
    // Create two progressive collections
    const usersCollection = createProgressiveUsersCollection()
    const departmentsCollection = createProgressiveDepartmentsCollection()

    // Complete sync for users but NOT for departments (still buffering)
    simulateUsersSync()
    // Don't call simulateDepartmentsSync() - departments is still buffering

    expect(usersCollection.status).toBe(`ready`)
    expect(departmentsCollection.status).toBe(`loading`) // Still buffering

    // Mock fetchSnapshot to return department data (this is what progressive mode should use during buffering)
    mockDepartmentsFetchSnapshot.mockResolvedValueOnce({
      metadata: {},
      data: sampleDepartments.map((dept) => ({
        key: dept.id.toString(),
        value: dept,
        headers: { operation: `insert` },
      })),
    })

    // Create a live query that joins both collections
    // The departments collection is lazy and still buffering, so it should use fetchSnapshot
    const joinQuery = createLiveQueryCollection({
      id: `users-with-departments-buffering`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .join(
            { dept: departmentsCollection },
            ({ user, dept }) => eq(user.department_id, dept.id),
            `left`,
          )
          .select(({ user, dept }) => ({
            user_name: user.name,
            department_name: dept?.name,
          })),
    })

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Verify joinQuery exists (avoid unused variable error)
    expect(joinQuery).toBeDefined()

    // requestSnapshot should NOT have been called
    expect(mockDepartmentsRequestSnapshot).not.toHaveBeenCalled()

    // fetchSnapshot SHOULD have been called (because departments is still buffering)
    expect(mockDepartmentsFetchSnapshot).toHaveBeenCalled()
  })

  it(`should handle ordered query on progressive collection after initial sync`, async () => {
    // This test reproduces the scenario from the issue comment
    // A simple ordered query (no join) on a progressive collection
    const usersCollection = createProgressiveUsersCollection()

    // Complete initial sync
    simulateUsersSync()

    expect(usersCollection.status).toBe(`ready`)
    expect(usersCollection.size).toBe(3)

    // Create an ordered live query (like the useLiveSuspenseQuery example in the issue)
    const orderedQuery = createLiveQueryCollection({
      id: `ordered-users`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .orderBy(({ user }) => user.id, `desc`),
    })

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The query should work without throwing
    expect(orderedQuery.status).toBe(`ready`)
    expect(orderedQuery.size).toBe(3)

    // requestSnapshot should NOT have been called
    expect(mockUsersRequestSnapshot).not.toHaveBeenCalled()

    // Verify ordering is correct (descending by id)
    const results = orderedQuery.toArray
    expect(results[0]?.name).toBe(`Charlie`) // id: 3
    expect(results[1]?.name).toBe(`Bob`) // id: 2
    expect(results[2]?.name).toBe(`Alice`) // id: 1
  })

  it(`should handle ordered query with limit on progressive collection after initial sync`, async () => {
    // Test ordered query with limit
    const usersCollection = createProgressiveUsersCollection()

    // Complete initial sync
    simulateUsersSync()

    expect(usersCollection.status).toBe(`ready`)
    expect(usersCollection.size).toBe(3)

    // Create an ordered live query with limit
    const orderedQuery = createLiveQueryCollection({
      id: `ordered-limited-users`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: usersCollection })
          .orderBy(({ user }) => user.id, `desc`)
          .limit(2),
    })

    // Wait for the live query to process
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The query should work without throwing
    expect(orderedQuery.status).toBe(`ready`)
    expect(orderedQuery.size).toBe(2)

    // requestSnapshot should NOT have been called
    expect(mockUsersRequestSnapshot).not.toHaveBeenCalled()

    // Verify ordering and limit are correct
    const results = orderedQuery.toArray
    expect(results[0]?.name).toBe(`Charlie`) // id: 3
    expect(results[1]?.name).toBe(`Bob`) // id: 2
  })
})
