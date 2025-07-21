import { beforeEach, describe, expect, test } from "vitest"
import { concat, createLiveQueryCollection } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"
import { DistinctRequiresSelectError } from "../../src/errors"

// Sample data types for comprehensive DISTINCT testing
type User = {
  id: number
  name: string
  email: string
  department: string
  role: string
  salary: number
  active: boolean
  country: string
  city: string
}

// Sample user data with duplicates for testing DISTINCT
const sampleUsers: Array<User> = [
  {
    id: 1,
    name: `John Doe`,
    email: `john@example.com`,
    department: `Engineering`,
    role: `Developer`,
    salary: 75000,
    active: true,
    country: `USA`,
    city: `New York`,
  },
  {
    id: 2,
    name: `Jane Smith`,
    email: `jane@example.com`,
    department: `Engineering`,
    role: `Developer`,
    salary: 80000,
    active: true,
    country: `USA`,
    city: `San Francisco`,
  },
  {
    id: 3,
    name: `Bob Johnson`,
    email: `bob@example.com`,
    department: `Marketing`,
    role: `Manager`,
    salary: 90000,
    active: true,
    country: `Canada`,
    city: `Toronto`,
  },
  {
    id: 4,
    name: `Alice Brown`,
    email: `alice@example.com`,
    department: `Engineering`,
    role: `Developer`,
    salary: 75000,
    active: false,
    country: `USA`,
    city: `New York`,
  },
  {
    id: 5,
    name: `Charlie Wilson`,
    email: `charlie@example.com`,
    department: `Sales`,
    role: `Representative`,
    salary: 60000,
    active: true,
    country: `USA`,
    city: `Chicago`,
  },
  {
    id: 6,
    name: `Diana Davis`,
    email: `diana@example.com`,
    department: `Engineering`,
    role: `Developer`,
    salary: 75000,
    active: true,
    country: `UK`,
    city: `London`,
  },
  {
    id: 7,
    name: `Eve Miller`,
    email: `eve@example.com`,
    department: `Marketing`,
    role: `Manager`,
    salary: 90000,
    active: true,
    country: `Canada`,
    city: `Toronto`,
  },
  {
    id: 8,
    name: `Frank Garcia`,
    email: `frank@example.com`,
    department: `Engineering`,
    role: `Developer`,
    salary: 75000,
    active: true,
    country: `USA`,
    city: `New York`,
  },
]

function createUsersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
      autoIndex,
    })
  )
}

function createDistinctTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    describe(`Basic Usage`, () => {
      let usersCollection: ReturnType<typeof createUsersCollection>

      beforeEach(() => {
        usersCollection = createUsersCollection(autoIndex)
      })

      test(`distinct on a single column`, () => {
        const distinctCountries = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({ country: users.country }))
              .distinct(),
        })

        expect(distinctCountries.size).toBe(3) // USA, Canada, UK

        const countries = Array.from(distinctCountries.values()).map(
          (user) => user.country
        )
        expect(countries).toContain(`USA`)
        expect(countries).toContain(`Canada`)
        expect(countries).toContain(`UK`)
        expect(countries.length).toBe(3)
      })

      test(`distinct on multiple columns`, () => {
        const distinctRoleSalary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({
                role: users.role,
                salary: users.salary,
              }))
              .distinct(),
        })

        // Expected unique combinations:
        // Developer-75000 (John, Alice, Diana, Frank)
        // Developer-80000 (Jane)
        // Manager-90000 (Bob, Eve)
        // Representative-60000 (Charlie)
        expect(distinctRoleSalary.size).toBe(4)

        const combinations = Array.from(distinctRoleSalary.values()).map(
          (user) => `${user.role}-${user.salary}`
        )
        expect(combinations).toContain(`Developer-75000`)
        expect(combinations).toContain(`Developer-80000`)
        expect(combinations).toContain(`Manager-90000`)
        expect(combinations).toContain(`Representative-60000`)
        expect(combinations.length).toBe(4)
      })

      test(`distinct without select should throw`, () => {
        expect(() =>
          createLiveQueryCollection({
            startSync: true,
            query: (q) => q.from({ users: usersCollection }).distinct(),
          })
        ).toThrow(DistinctRequiresSelectError)
      })
    })

    describe(`With Computed Values`, () => {
      let usersCollection: ReturnType<typeof createUsersCollection>

      beforeEach(() => {
        usersCollection = createUsersCollection(autoIndex)
      })

      test(`distinct on computed salary ranges`, () => {
        const distinctSalaryRanges = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .fn.select(({ users }) => ({
                salary_range:
                  users.salary > 80000
                    ? `High`
                    : users.salary < 70000
                      ? `Medium`
                      : `Low`,
              }))
              .distinct(),
        })

        expect(distinctSalaryRanges.size).toBe(3) // High, Medium, Low

        const ranges = Array.from(distinctSalaryRanges.values()).map(
          (user) => user.salary_range
        )
        expect(ranges).toContain(`High`)
        expect(ranges).toContain(`Medium`)
        expect(ranges).toContain(`Low`)
      })

      test(`distinct on computed string value`, () => {
        const distinctFullNames = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({
                full_name: concat(users.department, ` - `, users.role),
              }))
              .distinct(),
        })

        expect(distinctFullNames.size).toBe(3) // All unique combinations of department and role

        const fullNames = Array.from(distinctFullNames.values()).map(
          (user) => user.full_name
        )

        expect(fullNames).toContain(`Engineering - Developer`)
        expect(fullNames).toContain(`Marketing - Manager`)
        expect(fullNames).toContain(`Sales - Representative`)
      })
    })

    describe(`Live Updates`, () => {
      let usersCollection: ReturnType<typeof createUsersCollection>

      beforeEach(() => {
        usersCollection = createUsersCollection(autoIndex)
      })

      test(`live updates when inserting new users`, () => {
        const distinctDepartments = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({ department: users.department }))
              .distinct(),
        })

        expect(distinctDepartments.size).toBe(3) // Engineering, Marketing, Sales

        // Insert new user with existing department
        const newUser1: User = {
          id: 9,
          name: `Grace Lee`,
          email: `grace@example.com`,
          department: `Engineering`,
          role: `Developer`,
          salary: 75000,
          active: true,
          country: `USA`,
          city: `Boston`,
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `insert`, value: newUser1 })
        usersCollection.utils.commit()

        // Should still have 3 departments (Engineering already exists)
        expect(distinctDepartments.size).toBe(3)

        // Insert new user with new department
        const newUser2: User = {
          id: 10,
          name: `Henry Chen`,
          email: `henry@example.com`,
          department: `HR`,
          role: `Manager`,
          salary: 85000,
          active: true,
          country: `USA`,
          city: `Seattle`,
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `insert`, value: newUser2 })
        usersCollection.utils.commit()

        // Should now have 4 departments
        expect(distinctDepartments.size).toBe(4)

        const departments = Array.from(distinctDepartments.values()).map(
          (user) => user.department
        )
        expect(departments).toContain(`HR`)
      })

      test(`live updates when updating existing users`, () => {
        const distinctCountries = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({ country: users.country }))
              .distinct(),
        })

        expect(distinctCountries.size).toBe(3) // USA, Canada, UK

        // Update user 1 to change country from USA to Germany
        const updatedUser = {
          ...sampleUsers.find((u) => u.id === 1)!,
          country: `Germany`,
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `update`, value: updatedUser })
        usersCollection.utils.commit()

        // Should now have 4 countries (because there were also other users from USA so the distinct count is 4)
        expect(distinctCountries.size).toBe(4)

        const countries = Array.from(distinctCountries.values()).map(
          (user) => user.country
        )
        expect(countries).toContain(`Germany`)

        // Modify user 1 to Canada such that Germany no longer occurs
        // and the distinct count is back to 3
        const updatedUserAgain = {
          ...sampleUsers.find((u) => u.id === 1)!,
          country: `Canada`,
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `update`, value: updatedUserAgain })
        usersCollection.utils.commit()

        // Should now have 3 countries
        expect(distinctCountries.size).toBe(3)

        const finalCountries = Array.from(distinctCountries.values()).map(
          (user) => user.country
        )
        expect(finalCountries).not.toContain(`Germany`)
        expect(finalCountries).toContain(`Canada`)
        expect(finalCountries).toContain(`USA`)
        expect(finalCountries).toContain(`UK`)
      })

      test(`live updates when deleting users`, () => {
        const distinctCities = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({ city: users.city }))
              .distinct(),
        })

        expect(distinctCities.size).toBe(5) // New York, San Francisco, Toronto, Chicago, London

        // Delete all users from New York
        const newYorkUsers = sampleUsers.filter((u) => u.city === `New York`)
        for (const user of newYorkUsers) {
          usersCollection.utils.begin()
          usersCollection.utils.write({ type: `delete`, value: user })
          usersCollection.utils.commit()
        }

        // Should now have 4 cities (New York removed)
        expect(distinctCities.size).toBe(4)

        const cities = Array.from(distinctCities.values()).map(
          (user) => user.city
        )
        expect(cities).not.toContain(`New York`)
      })
    })

    describe(`Edge Cases and Complex Scenarios`, () => {
      let usersCollection: ReturnType<typeof createUsersCollection>

      beforeEach(() => {
        usersCollection = createUsersCollection(autoIndex)
      })

      test(`distinct with null values`, () => {
        // Add a user with null department
        const userWithNullDept: User = {
          id: 11,
          name: `Null User`,
          email: `null@example.com`,
          department: null as any,
          role: `Developer`,
          salary: 70000,
          active: true,
          country: `USA`,
          city: `Austin`,
        }

        usersCollection.utils.begin()
        usersCollection.utils.write({ type: `insert`, value: userWithNullDept })
        usersCollection.utils.commit()

        const distinctDepartments = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({ department: users.department }))
              .distinct(),
        })

        expect(distinctDepartments.size).toBe(4) // Engineering, Marketing, Sales, null

        const departments = Array.from(distinctDepartments.values()).map(
          (user) => user.department
        )
        expect(departments).toContain(null)
      })

      test(`empty collection handling`, () => {
        const emptyCollection = createCollection(
          mockSyncCollectionOptions<User>({
            id: `empty-users`,
            getKey: (user) => user.id,
            initialData: [],
          })
        )

        const emptyDistinct = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: emptyCollection })
              .select(({ users }) => ({ department: users.department }))
              .distinct(),
        })

        expect(emptyDistinct.size).toBe(0)

        // Add data to empty collection
        const newUser: User = {
          id: 1,
          name: `Test User`,
          email: `test@example.com`,
          department: `Test`,
          role: `Tester`,
          salary: 50000,
          active: true,
          country: `Test`,
          city: `Test City`,
        }

        emptyCollection.utils.begin()
        emptyCollection.utils.write({ type: `insert`, value: newUser })
        emptyCollection.utils.commit()

        expect(emptyDistinct.size).toBe(1)
        const department = emptyDistinct.get(1)
        expect(department?.department).toBe(`Test`)
      })

      test(`distinct with boolean values`, () => {
        const distinctActiveStatus = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({ active: users.active }))
              .distinct(),
        })

        expect(distinctActiveStatus.size).toBe(2) // true, false

        const statuses = Array.from(distinctActiveStatus.values()).map(
          (user) => user.active
        )
        expect(statuses).toContain(true)
        expect(statuses).toContain(false)
      })

      test(`distinct with ordered results based on non-selected column`, () => {
        const distinctOrderedData = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .select(({ users }) => ({
                role: users.role,
              }))
              .distinct()
              .orderBy(({ users }) => users.salary, `desc`),
        })

        // In general, the combination of distinct with orderBy where orderBy uses a non-selected column is non-deterministic
        // However, in this case each role has a salary range and those salary ranges don't overlap so it is deterministic
        // So we expect the results to be:  manager, developer, representative
        const distinctOrderedRoles = distinctOrderedData.toArray.map(
          (r) => r.role
        )
        expect(distinctOrderedRoles).toEqual([
          `Manager`,
          `Developer`,
          `Representative`,
        ])
      })

      test(`distinct with functional select`, () => {
        const distinctComputed = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ users: usersCollection })
              .fn.select((row) => ({
                salary_tier: row.users.salary >= 80000 ? `Senior` : `Junior`,
              }))
              .distinct(),
        })

        expect(distinctComputed.size).toBe(2)

        const locations = Array.from(distinctComputed.values()).map(
          (user) => user.salary_tier
        )
        expect(locations).toContain(`Senior`)
        expect(locations).toContain(`Junior`)
      })
    })
  })
}

describe(`Query DISTINCT Execution`, () => {
  createDistinctTests(`off`)
  createDistinctTests(`eager`)
})
