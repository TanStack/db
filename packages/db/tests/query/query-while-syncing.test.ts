import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLiveQueryCollection, eq, gt } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createTransaction } from '../../src/transactions.js'

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  active: boolean
}

type Department = {
  id: number
  name: string
  budget: number
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25, active: true },
  { id: 2, name: `Bob`, age: 19, active: true },
  { id: 3, name: `Charlie`, age: 30, active: false },
  { id: 4, name: `Dave`, age: 22, active: true },
]

const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering`, budget: 100000 },
  { id: 2, name: `Sales`, budget: 80000 },
  { id: 3, name: `Marketing`, budget: 60000 },
]

describe(`Query while syncing`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe.each([`off`, `eager`] as const)(`with autoIndex %s`, (autoIndex) => {
    describe(`Basic queries with startSync: true`, () => {
      test(`should update live query results while source collection is syncing`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        // Create a collection that doesn't auto-start syncing
        const usersCollection = createCollection<User, number>({
          id: `test-users-delayed-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        // Create a live query before the source collection has any data
        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.active, true))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
              })),
        })

        // The live query starts with startSync: true, which immediately subscribes to the source
        // This triggers the source collection to start syncing too (even though it has startSync: false)
        // Wait a moment for the subscription to set up
        await vi.advanceTimersByTimeAsync(10)

        // Both should now be in loading state
        expect(usersCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`)

        // Write first batch of data (but don't mark ready yet)
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] })
        syncWrite!({ type: `insert`, value: sampleUsers[1] })
        syncCommit!()

        // Data should be visible in both collections
        expect(usersCollection.size).toBe(2)
        expect(liveQuery.size).toBe(2) // Both Alice and Bob are active

        // Both should still be in loading state
        expect(usersCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`)

        // Write second batch of data
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[2] })
        syncWrite!({ type: `insert`, value: sampleUsers[3] })
        syncCommit!()

        // More data should be visible
        expect(usersCollection.size).toBe(4)
        expect(liveQuery.size).toBe(3) // Alice, Bob, and Dave are active

        // Still loading
        expect(usersCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`)

        // Mark the source collection as ready
        syncMarkReady!()

        // Now both should be ready
        expect(usersCollection.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`ready`)

        // Final data check
        expect(liveQuery.toArray).toEqual([
          { id: 1, name: `Alice` },
          { id: 2, name: `Bob` },
          { id: 4, name: `Dave` },
        ])
      })

      test(`should handle WHERE filters correctly during sync`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<User, number>({
          id: `test-users-where-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        // Query for users over 20
        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => gt(user.age, 20))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
                age: user.age,
              })),
        })

        // The live query will trigger the source collection to start syncing
        await vi.advanceTimersByTimeAsync(10)

        // Add users one by one
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] }) // Alice, 25
        syncCommit!()

        expect(liveQuery.size).toBe(1)
        expect(liveQuery.get(1)?.name).toBe(`Alice`)
        expect(liveQuery.status).toBe(`loading`)

        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[1] }) // Bob, 19 (should be filtered out)
        syncCommit!()

        expect(liveQuery.size).toBe(1) // Bob should not appear
        expect(liveQuery.status).toBe(`loading`)

        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[2] }) // Charlie, 30
        syncWrite!({ type: `insert`, value: sampleUsers[3] }) // Dave, 22
        syncCommit!()

        expect(liveQuery.size).toBe(3) // Alice, Charlie, Dave
        expect(liveQuery.status).toBe(`loading`)

        syncMarkReady!()

        expect(liveQuery.status).toBe(`ready`)
        expect(liveQuery.toArray.map((u) => u.name).sort()).toEqual([
          `Alice`,
          `Charlie`,
          `Dave`,
        ])
      })

      test(`should handle SELECT projection correctly during sync`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<User, number>({
          id: `test-users-select-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ user: usersCollection }).select(({ user }) => ({
              id: user.id,
              name: user.name,
              // Only select id and name, not age or active
            })),
        })

        // The live query will trigger the source collection to start syncing
        await vi.advanceTimersByTimeAsync(10)

        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] })
        syncCommit!()

        const result = liveQuery.get(1)
        expect(result).toEqual({ id: 1, name: `Alice` })
        expect(result).not.toHaveProperty(`age`)
        expect(result).not.toHaveProperty(`active`)
        expect(liveQuery.status).toBe(`loading`)

        syncMarkReady!()
        expect(liveQuery.status).toBe(`ready`)
      })
    })

    describe(`Join queries`, () => {
      test(`should update live query with join while both sources are syncing`, async () => {
        let userSyncBegin: (() => void) | undefined
        let userSyncWrite: ((op: any) => void) | undefined
        let userSyncCommit: (() => void) | undefined
        let userSyncMarkReady: (() => void) | undefined

        let deptSyncBegin: (() => void) | undefined
        let deptSyncWrite: ((op: any) => void) | undefined
        let deptSyncCommit: (() => void) | undefined
        let deptSyncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<
          User & { department_id?: number },
          number
        >({
          id: `test-users-join-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              userSyncBegin = begin
              userSyncWrite = write
              userSyncCommit = commit
              userSyncMarkReady = markReady
            },
          },
        })

        const departmentsCollection = createCollection<Department, number>({
          id: `test-departments-join-sync`,
          getKey: (dept) => dept.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              deptSyncBegin = begin
              deptSyncWrite = write
              deptSyncCommit = commit
              deptSyncMarkReady = markReady
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                `inner`,
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        // The live query will trigger both source collections to start syncing
        await vi.advanceTimersByTimeAsync(10)

        expect(liveQuery.status).toBe(`loading`)

        // Add a department first
        deptSyncBegin!()
        deptSyncWrite!({ type: `insert`, value: sampleDepartments[0] })
        deptSyncCommit!()

        expect(departmentsCollection.size).toBe(1)
        expect(liveQuery.size).toBe(0) // No users yet
        expect(liveQuery.status).toBe(`loading`)

        // Add a user with matching department
        userSyncBegin!()
        userSyncWrite!({
          type: `insert`,
          value: { ...sampleUsers[0], department_id: 1 },
        })
        userSyncCommit!()

        expect(usersCollection.size).toBe(1)
        expect(liveQuery.size).toBe(1) // Should have a join result now
        expect(liveQuery.toArray[0]).toEqual({
          user_name: `Alice`,
          department_name: `Engineering`,
        })
        expect(liveQuery.status).toBe(`loading`) // Still loading because neither source is ready

        // Add more data
        deptSyncBegin!()
        deptSyncWrite!({ type: `insert`, value: sampleDepartments[1] })
        deptSyncCommit!()

        userSyncBegin!()
        userSyncWrite!({
          type: `insert`,
          value: { ...sampleUsers[1], department_id: 2 },
        })
        userSyncCommit!()

        expect(liveQuery.size).toBe(2)
        expect(liveQuery.status).toBe(`loading`)

        // Mark first source ready
        userSyncMarkReady!()
        expect(usersCollection.status).toBe(`ready`)
        expect(departmentsCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`) // Still loading because departments not ready

        // Mark second source ready
        deptSyncMarkReady!()
        expect(departmentsCollection.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`ready`) // Now ready because all sources are ready

        expect(liveQuery.toArray).toEqual([
          { user_name: `Alice`, department_name: `Engineering` },
          { user_name: `Bob`, department_name: `Sales` },
        ])
      })

      test(`should handle left join correctly while syncing`, async () => {
        let userSyncBegin: (() => void) | undefined
        let userSyncWrite: ((op: any) => void) | undefined
        let userSyncCommit: (() => void) | undefined
        let userSyncMarkReady: (() => void) | undefined

        let deptSyncBegin: (() => void) | undefined
        let deptSyncWrite: ((op: any) => void) | undefined
        let deptSyncCommit: (() => void) | undefined
        let deptSyncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<
          User & { department_id?: number },
          number
        >({
          id: `test-users-left-join-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              userSyncBegin = begin
              userSyncWrite = write
              userSyncCommit = commit
              userSyncMarkReady = markReady
            },
          },
        })

        const departmentsCollection = createCollection<Department, number>({
          id: `test-departments-left-join-sync`,
          getKey: (dept) => dept.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              deptSyncBegin = begin
              deptSyncWrite = write
              deptSyncCommit = commit
              deptSyncMarkReady = markReady
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .leftJoin({ dept: departmentsCollection }, ({ user, dept }) =>
                eq(user.department_id, dept.id),
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept?.name,
              })),
        })

        // The live query will trigger both source collections to start syncing
        await vi.advanceTimersByTimeAsync(10)

        // Add a user without a department
        userSyncBegin!()
        userSyncWrite!({
          type: `insert`,
          value: { ...sampleUsers[0], department_id: undefined },
        })
        userSyncCommit!()

        expect(liveQuery.size).toBe(1)
        expect(liveQuery.toArray[0]).toEqual({
          user_name: `Alice`,
          department_name: undefined,
        })
        expect(liveQuery.status).toBe(`loading`)

        // Add a department
        deptSyncBegin!()
        deptSyncWrite!({ type: `insert`, value: sampleDepartments[0] })
        deptSyncCommit!()

        // Add a user with matching department
        userSyncBegin!()
        userSyncWrite!({
          type: `insert`,
          value: { ...sampleUsers[1], department_id: 1 },
        })
        userSyncCommit!()

        expect(liveQuery.size).toBe(2)
        const results = liveQuery.toArray
        expect(results.find((r) => r.user_name === `Alice`)).toEqual({
          user_name: `Alice`,
          department_name: undefined,
        })
        expect(results.find((r) => r.user_name === `Bob`)).toEqual({
          user_name: `Bob`,
          department_name: `Engineering`,
        })

        userSyncMarkReady!()
        deptSyncMarkReady!()

        expect(liveQuery.status).toBe(`ready`)
      })
    })

    describe(`Multiple source collections`, () => {
      test(`should wait for all sources to be ready before marking live query ready`, async () => {
        let sync1Begin: (() => void) | undefined
        let sync1Write: ((op: any) => void) | undefined
        let sync1Commit: (() => void) | undefined
        let sync1MarkReady: (() => void) | undefined

        let sync2Begin: (() => void) | undefined
        let sync2Write: ((op: any) => void) | undefined
        let sync2Commit: (() => void) | undefined
        let sync2MarkReady: (() => void) | undefined

        let sync3Begin: (() => void) | undefined
        let sync3Write: ((op: any) => void) | undefined
        let sync3Commit: (() => void) | undefined
        let sync3MarkReady: (() => void) | undefined

        const collection1 = createCollection<User, number>({
          id: `multi-source-1`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              sync1Begin = begin
              sync1Write = write
              sync1Commit = commit
              sync1MarkReady = markReady
            },
          },
        })

        const collection2 = createCollection<User, number>({
          id: `multi-source-2`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              sync2Begin = begin
              sync2Write = write
              sync2Commit = commit
              sync2MarkReady = markReady
            },
          },
        })

        const collection3 = createCollection<User, number>({
          id: `multi-source-3`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              sync3Begin = begin
              sync3Write = write
              sync3Commit = commit
              sync3MarkReady = markReady
            },
          },
        })

        // Create a query that uses all three collections
        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ c1: collection1 })
              .join(
                { c2: collection2 },
                ({ c1, c2 }) => eq(c1.id, c2.id),
                `inner`,
              )
              .join(
                { c3: collection3 },
                ({ c1, c3 }) => eq(c1.id, c3.id),
                `inner`,
              )
              .select(({ c1 }) => ({
                id: c1.id,
                name: c1.name,
              })),
        })

        // The live query will trigger all source collections to start syncing
        await vi.advanceTimersByTimeAsync(10)

        expect(liveQuery.status).toBe(`loading`)

        // Add data to all collections
        sync1Begin!()
        sync1Write!({ type: `insert`, value: sampleUsers[0] })
        sync1Commit!()

        sync2Begin!()
        sync2Write!({ type: `insert`, value: sampleUsers[0] })
        sync2Commit!()

        sync3Begin!()
        sync3Write!({ type: `insert`, value: sampleUsers[0] })
        sync3Commit!()

        // Should have one matching result
        expect(liveQuery.size).toBe(1)
        expect(liveQuery.status).toBe(`loading`)

        // Mark first collection ready
        sync1MarkReady!()
        expect(collection1.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`loading`) // Still loading

        // Mark second collection ready
        sync2MarkReady!()
        expect(collection2.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`loading`) // Still loading

        // Mark third collection ready
        sync3MarkReady!()
        expect(collection3.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`ready`) // Now ready!
      })
    })

    describe(`Error handling during sync`, () => {
      test(`should transition to error if source collection errors during sync`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined

        const usersCollection = createCollection<User, number>({
          id: `test-users-error-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ user: usersCollection }).select(({ user }) => ({
              id: user.id,
              name: user.name,
            })),
        })

        // The live query will trigger the source collection to start syncing
        await vi.advanceTimersByTimeAsync(10)

        // Add some data
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] })
        syncCommit!()

        expect(liveQuery.size).toBe(1)
        expect(liveQuery.status).toBe(`loading`)

        // Trigger an error in the source collection by directly setting its status
        // In a real scenario, this would happen if the sync function throws an error
        usersCollection._lifecycle.setStatus(`error`)

        // Wait for the status change event to propagate
        await vi.advanceTimersByTimeAsync(10)

        // Live query should also transition to error
        expect(usersCollection.status).toBe(`error`)
        expect(liveQuery.status).toBe(`error`)

        // Data should still be visible
        expect(liveQuery.size).toBe(1)
      })
    })

    describe(`Basic queries with .preload()`, () => {
      test(`should update live query results while source collection is syncing using preload()`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        // Create a collection that doesn't auto-start syncing
        const usersCollection = createCollection<User, number>({
          id: `test-users-preload-sync`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        // Create a live query WITHOUT startSync - it will be idle
        const liveQuery = createLiveQueryCollection({
          startSync: false,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.active, true))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
              })),
        })

        // Both should be idle initially
        expect(usersCollection.status).toBe(`idle`)
        expect(liveQuery.status).toBe(`idle`)

        // Trigger loading with preload()
        const preloadPromise = liveQuery.preload()

        // Wait for subscription to set up
        await vi.advanceTimersByTimeAsync(10)

        // Both should now be in loading state
        expect(usersCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`)

        // Write first batch of data (but don't mark ready yet)
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] })
        syncWrite!({ type: `insert`, value: sampleUsers[1] })
        syncCommit!()

        // Data should be visible in both collections
        expect(usersCollection.size).toBe(2)
        expect(liveQuery.size).toBe(2) // Both Alice and Bob are active

        // Both should still be in loading state
        expect(usersCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`)

        // Write second batch of data
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[2] })
        syncWrite!({ type: `insert`, value: sampleUsers[3] })
        syncCommit!()

        // More data should be visible
        expect(usersCollection.size).toBe(4)
        expect(liveQuery.size).toBe(3) // Alice, Bob, and Dave are active

        // Still loading
        expect(usersCollection.status).toBe(`loading`)
        expect(liveQuery.status).toBe(`loading`)

        // Mark the source collection as ready
        syncMarkReady!()

        // Now both should be ready
        expect(usersCollection.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`ready`)

        // preload() promise should resolve
        await preloadPromise

        // Final data check
        expect(liveQuery.toArray).toEqual([
          { id: 1, name: `Alice` },
          { id: 2, name: `Bob` },
          { id: 4, name: `Dave` },
        ])
      })

      test(`should handle WHERE filters during sync with preload()`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<User, number>({
          id: `test-users-where-preload`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        // Query for users over 20
        const liveQuery = createLiveQueryCollection({
          startSync: false,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => gt(user.age, 20))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
                age: user.age,
              })),
        })

        expect(liveQuery.status).toBe(`idle`)

        // Trigger loading
        liveQuery.preload()
        await vi.advanceTimersByTimeAsync(10)

        // Add users one by one
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] }) // Alice, 25
        syncCommit!()

        expect(liveQuery.size).toBe(1)
        expect(liveQuery.get(1)?.name).toBe(`Alice`)
        expect(liveQuery.status).toBe(`loading`)

        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[1] }) // Bob, 19 (filtered out)
        syncCommit!()

        expect(liveQuery.size).toBe(1) // Bob should not appear
        expect(liveQuery.status).toBe(`loading`)

        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[2] }) // Charlie, 30
        syncWrite!({ type: `insert`, value: sampleUsers[3] }) // Dave, 22
        syncCommit!()

        expect(liveQuery.size).toBe(3) // Alice, Charlie, Dave
        expect(liveQuery.status).toBe(`loading`)

        syncMarkReady!()

        expect(liveQuery.status).toBe(`ready`)
        expect(liveQuery.toArray.map((u) => u.name).sort()).toEqual([
          `Alice`,
          `Charlie`,
          `Dave`,
        ])
      })

      test(`should handle join queries during sync with preload()`, async () => {
        let userSyncBegin: (() => void) | undefined
        let userSyncWrite: ((op: any) => void) | undefined
        let userSyncCommit: (() => void) | undefined
        let userSyncMarkReady: (() => void) | undefined

        let deptSyncBegin: (() => void) | undefined
        let deptSyncWrite: ((op: any) => void) | undefined
        let deptSyncCommit: (() => void) | undefined
        let deptSyncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<
          User & { department_id?: number },
          number
        >({
          id: `test-users-join-preload`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              userSyncBegin = begin
              userSyncWrite = write
              userSyncCommit = commit
              userSyncMarkReady = markReady
            },
          },
        })

        const departmentsCollection = createCollection<Department, number>({
          id: `test-departments-join-preload`,
          getKey: (dept) => dept.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              deptSyncBegin = begin
              deptSyncWrite = write
              deptSyncCommit = commit
              deptSyncMarkReady = markReady
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: false,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .join(
                { dept: departmentsCollection },
                ({ user, dept }) => eq(user.department_id, dept.id),
                `inner`,
              )
              .select(({ user, dept }) => ({
                user_name: user.name,
                department_name: dept.name,
              })),
        })

        expect(liveQuery.status).toBe(`idle`)

        // Trigger loading with preload
        const preloadPromise = liveQuery.preload()
        await vi.advanceTimersByTimeAsync(10)

        expect(liveQuery.status).toBe(`loading`)

        // Add a department first
        deptSyncBegin!()
        deptSyncWrite!({ type: `insert`, value: sampleDepartments[0] })
        deptSyncCommit!()

        expect(departmentsCollection.size).toBe(1)
        expect(liveQuery.size).toBe(0) // No users yet

        // Add a user with matching department
        userSyncBegin!()
        userSyncWrite!({
          type: `insert`,
          value: { ...sampleUsers[0], department_id: 1 },
        })
        userSyncCommit!()

        expect(liveQuery.size).toBe(1) // Should have a join result now
        expect(liveQuery.toArray[0]).toEqual({
          user_name: `Alice`,
          department_name: `Engineering`,
        })
        expect(liveQuery.status).toBe(`loading`)

        // Mark both sources ready
        userSyncMarkReady!()
        deptSyncMarkReady!()

        expect(liveQuery.status).toBe(`ready`)
        await preloadPromise
      })

      test(`should handle stateWhenReady() while syncing with preload()`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<User, number>({
          id: `test-users-state-when-ready`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: false,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.active, true))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
              })),
        })

        expect(liveQuery.status).toBe(`idle`)

        // Trigger loading and wait for ready state
        const statePromise = liveQuery.stateWhenReady()

        await vi.advanceTimersByTimeAsync(10)
        expect(liveQuery.status).toBe(`loading`)

        // Add data while loading
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] })
        syncWrite!({ type: `insert`, value: sampleUsers[1] })
        syncCommit!()

        expect(liveQuery.size).toBe(2)
        expect(liveQuery.status).toBe(`loading`)

        // stateWhenReady() should still be pending
        let stateResolved = false
        statePromise.then(() => {
          stateResolved = true
        })

        await vi.advanceTimersByTimeAsync(10)
        expect(stateResolved).toBe(false)

        // Mark ready
        syncMarkReady!()

        // Now stateWhenReady() should resolve
        const state = await statePromise
        expect(stateResolved).toBe(true)
        expect(state.size).toBe(2)
        expect(liveQuery.status).toBe(`ready`)
      })

      test(`should reflect local optimistic mutations in live query before source is ready`, async () => {
        let syncBegin: (() => void) | undefined
        let syncWrite: ((op: any) => void) | undefined
        let syncCommit: (() => void) | undefined
        let syncMarkReady: (() => void) | undefined

        const usersCollection = createCollection<User, number>({
          id: `test-users-optimistic-mutations`,
          getKey: (user) => user.id,
          autoIndex,
          startSync: false,
          sync: {
            sync: ({ begin, write, commit, markReady }) => {
              syncBegin = begin
              syncWrite = write
              syncCommit = commit
              syncMarkReady = markReady
            },
          },
        })

        const liveQuery = createLiveQueryCollection({
          startSync: false,
          query: (q) =>
            q
              .from({ user: usersCollection })
              .where(({ user }) => eq(user.active, true))
              .select(({ user }) => ({
                id: user.id,
                name: user.name,
              })),
        })

        // Trigger loading
        liveQuery.preload()
        await vi.advanceTimersByTimeAsync(10)

        expect(liveQuery.status).toBe(`loading`)

        // Add initial data via sync
        syncBegin!()
        syncWrite!({ type: `insert`, value: sampleUsers[0] }) // Alice, active
        syncWrite!({ type: `insert`, value: sampleUsers[2] }) // Charlie, inactive
        syncCommit!()

        // Live query should show only Alice (active user)
        expect(usersCollection.size).toBe(2)
        expect(liveQuery.size).toBe(1)
        expect(liveQuery.get(1)?.name).toBe(`Alice`)

        // Create a controlled promise for the mutation function
        let resolveInsertMutation: (() => void) | undefined
        const insertMutationPromise = new Promise<void>((resolve) => {
          resolveInsertMutation = resolve
        })

        // Perform a local optimistic mutation while still loading
        const insertTx = createTransaction({
          mutationFn: async () => {
            await insertMutationPromise
          },
        })
        insertTx.mutate(() => {
          usersCollection.insert({ id: 5, name: `Eve`, age: 28, active: true })
        })

        // The optimistic mutation should be visible immediately (before mutationFn resolves)
        expect(usersCollection.size).toBe(3)
        expect(liveQuery.size).toBe(2)
        expect(liveQuery.get(5)?.name).toBe(`Eve`)

        // Resolve the mutation WITHOUT syncing the data back
        resolveInsertMutation!()
        await vi.advanceTimersByTimeAsync(10) // Wait for rollback microtask

        // The optimistic mutation should be rolled back since we didn't sync it
        expect(usersCollection.size).toBe(2)
        expect(liveQuery.size).toBe(1)
        expect(liveQuery.get(5)).toBeUndefined()

        // Now sync the data to persist it
        syncBegin!()
        syncWrite!({
          type: `insert`,
          value: { id: 5, name: `Eve`, age: 28, active: true },
        })
        syncCommit!()

        // Now it should be persisted
        expect(usersCollection.size).toBe(3)
        expect(liveQuery.size).toBe(2)
        expect(liveQuery.get(5)?.name).toBe(`Eve`)

        // Test update with controlled resolution
        let resolveUpdateMutation: (() => void) | undefined
        const updateMutationPromise = new Promise<void>((resolve) => {
          resolveUpdateMutation = resolve
        })

        const updateTx = createTransaction({
          mutationFn: async () => {
            await updateMutationPromise
          },
        })
        updateTx.mutate(() => {
          usersCollection.update(1, (draft) => {
            draft.name = `Alice Updated`
          })
        })

        // Update should be visible optimistically
        expect(liveQuery.get(1)?.name).toBe(`Alice Updated`)

        // Resolve mutation and sync the update back to persist it
        resolveUpdateMutation!()
        await vi.advanceTimersByTimeAsync(10)

        // Without sync, it would roll back to original, but let's sync it
        syncBegin!()
        syncWrite!({
          type: `update`,
          value: { id: 1, name: `Alice Updated`, age: 25, active: true },
        })
        syncCommit!()

        // Now it should be persisted
        expect(liveQuery.get(1)?.name).toBe(`Alice Updated`)

        // Mark ready
        syncMarkReady!()

        expect(usersCollection.status).toBe(`ready`)
        expect(liveQuery.status).toBe(`ready`)
      })
    })
  })
})
