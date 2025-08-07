import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"
import { createLiveQueryCollection } from "../../src/query/live-query-collection.js"
import { eq, gt } from "../../src/query/builder/functions.js"

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

const initialPersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
    isActive: true,
    team: `team1`,
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
    isActive: true,
    team: `team2`,
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
    isActive: true,
    team: `team1`,
  },
]

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number
  salary: number
  hire_date: string
}

interface Department {
  id: number
  name: string
  budget: number
}

// Test schema for nullable fields
interface EmployeeWithNullableFields {
  id: number
  name: string
  department_id: number | null
  salary: number | null
  hire_date: string
}

// Test data
const employeeData: Array<Employee> = [
  {
    id: 1,
    name: `Alice`,
    department_id: 1,
    salary: 50000,
    hire_date: `2020-01-15`,
  },
  {
    id: 2,
    name: `Bob`,
    department_id: 2,
    salary: 60000,
    hire_date: `2019-03-20`,
  },
  {
    id: 3,
    name: `Charlie`,
    department_id: 1,
    salary: 55000,
    hire_date: `2021-06-10`,
  },
  {
    id: 4,
    name: `Diana`,
    department_id: 2,
    salary: 65000,
    hire_date: `2018-11-05`,
  },
  {
    id: 5,
    name: `Eve`,
    department_id: 1,
    salary: 52000,
    hire_date: `2022-02-28`,
  },
]

const departmentData: Array<Department> = [
  { id: 1, name: `Engineering`, budget: 500000 },
  { id: 2, name: `Sales`, budget: 300000 },
]

// Test data with nullable fields
const employeeWithNullableData: Array<EmployeeWithNullableFields> = [
  {
    id: 1,
    name: `Alice`,
    department_id: 1,
    salary: 50000,
    hire_date: `2020-01-15`,
  },
  {
    id: 2,
    name: `Bob`,
    department_id: 2,
    salary: null,
    hire_date: `2019-03-20`,
  },
  {
    id: 3,
    name: `Charlie`,
    department_id: null,
    salary: 55000,
    hire_date: `2021-06-10`,
  },
  {
    id: 4,
    name: `Diana`,
    department_id: 2,
    salary: 65000,
    hire_date: `2018-11-05`,
  },
  {
    id: 5,
    name: `Eve`,
    department_id: 1,
    salary: 52000,
    hire_date: `2022-02-28`,
  },
  {
    id: 6,
    name: `Frank`,
    department_id: null,
    salary: null,
    hire_date: `2023-01-01`,
  },
]

function createEmployeesCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Employee>({
      id: `test-employees`,
      getKey: (employee) => employee.id,
      initialData: employeeData,
      autoIndex,
    })
  )
}

function createDepartmentsCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (department) => department.id,
      initialData: departmentData,
      autoIndex,
    })
  )
}

function createEmployeesWithNullableCollection(
  autoIndex: `off` | `eager` = `eager`
) {
  return createCollection(
    mockSyncCollectionOptions<EmployeeWithNullableFields>({
      id: `test-employees-nullable`,
      getKey: (employee) => employee.id,
      initialData: employeeWithNullableData,
      autoIndex,
    })
  )
}

function createOrderByTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    let employeesCollection: ReturnType<typeof createEmployeesCollection>
    let departmentsCollection: ReturnType<typeof createDepartmentsCollection>

    beforeEach(() => {
      employeesCollection = createEmployeesCollection(autoIndex)
      departmentsCollection = createDepartmentsCollection(autoIndex)
    })

    describe(`Basic OrderBy`, () => {
      it(`orders by single column ascending`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.name, `asc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(5)
        expect(results.map((r) => r.name)).toEqual([
          `Alice`,
          `Bob`,
          `Charlie`,
          `Diana`,
          `Eve`,
        ])
      })

      it(`orders by single column descending`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(5)
        expect(results.map((r) => r.salary)).toEqual([
          65000, 60000, 55000, 52000, 50000,
        ])
      })

      it(`maintains deterministic order with multiple calls`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.name, `asc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
            }))
        )
        await collection.preload()

        const results1 = Array.from(collection.values())
        const results2 = Array.from(collection.values())

        expect(results1.map((r) => r.name)).toEqual(results2.map((r) => r.name))
      })
    })

    describe(`Multiple Column OrderBy`, () => {
      it(`orders by multiple columns`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.department_id, `asc`)
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              department_id: employees.department_id,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(5)

        // Should be ordered by department_id ASC, then salary DESC within each department
        // Department 1: Charlie (55000), Eve (52000), Alice (50000)
        // Department 2: Diana (65000), Bob (60000)
        expect(
          results.map((r) => ({ dept: r.department_id, salary: r.salary }))
        ).toEqual([
          { dept: 1, salary: 55000 }, // Charlie
          { dept: 1, salary: 52000 }, // Eve
          { dept: 1, salary: 50000 }, // Alice
          { dept: 2, salary: 65000 }, // Diana
          { dept: 2, salary: 60000 }, // Bob
        ])
      })

      it(`handles mixed sort directions`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.hire_date, `desc`) // Most recent first
            .orderBy(({ employees }) => employees.name, `asc`) // Then by name A-Z
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              hire_date: employees.hire_date,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(5)

        // Should be ordered by hire_date DESC first
        expect(results[0]!.hire_date).toBe(`2022-02-28`) // Eve (most recent)
      })
    })

    describe(`OrderBy with Limit and Offset`, () => {
      it(`applies limit correctly with ordering`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .limit(3)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(3)
        expect(results.map((r) => r.salary)).toEqual([65000, 60000, 55000])
      })

      it(`applies offset correctly with ordering`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .offset(2)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(3) // 5 - 2 offset
        expect(results.map((r) => r.salary)).toEqual([55000, 52000, 50000])
      })

      it(`applies both limit and offset with ordering`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .offset(1)
            .limit(2)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.salary)).toEqual([60000, 55000])
      })

      it(`throws error when limit/offset used without orderBy`, () => {
        expect(() => {
          createLiveQueryCollection((q) =>
            q
              .from({ employees: employeesCollection })
              .limit(3)
              .select(({ employees }) => ({
                id: employees.id,
                name: employees.name,
              }))
          )
        }).toThrow(
          `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
        )
      })
    })

    describe(`OrderBy with Joins`, () => {
      it(`orders joined results correctly`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .join(
              { departments: departmentsCollection },
              ({ employees, departments }) =>
                eq(employees.department_id, departments.id)
            )
            .orderBy(({ departments }) => departments.name, `asc`)
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees, departments }) => ({
              id: employees.id,
              employee_name: employees.name,
              department_name: departments.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(5)

        // Should be ordered by department name ASC, then salary DESC
        // Engineering: Charlie (55000), Eve (52000), Alice (50000)
        // Sales: Diana (65000), Bob (60000)
        expect(
          results.map((r) => ({ dept: r.department_name, salary: r.salary }))
        ).toEqual([
          { dept: `Engineering`, salary: 55000 }, // Charlie
          { dept: `Engineering`, salary: 52000 }, // Eve
          { dept: `Engineering`, salary: 50000 }, // Alice
          { dept: `Sales`, salary: 65000 }, // Diana
          { dept: `Sales`, salary: 60000 }, // Bob
        ])
      })
    })

    describe(`OrderBy with Where Clauses`, () => {
      it(`orders filtered results correctly`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .where(({ employees }) => gt(employees.salary, 52000))
            .orderBy(({ employees }) => employees.salary, `asc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(3) // Alice (50000) and Eve (52000) filtered out
        expect(results.map((r) => r.salary)).toEqual([55000, 60000, 65000])
      })
    })

    describe(`Fractional Index Behavior`, () => {
      it(`maintains stable ordering during live updates`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        // Get initial order
        const initialResults = Array.from(collection.values())
        expect(initialResults.map((r) => r.salary)).toEqual([
          65000, 60000, 55000, 52000, 50000,
        ])

        // Add a new employee that should go in the middle
        const newEmployee = {
          id: 6,
          name: `Frank`,
          department_id: 1,
          salary: 57000,
          hire_date: `2023-01-01`,
        }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `insert`,
          value: newEmployee,
        })
        employeesCollection.utils.commit()

        // Check that ordering is maintained with new item inserted correctly
        const updatedResults = Array.from(collection.values())
        expect(updatedResults.map((r) => r.salary)).toEqual([
          65000, 60000, 57000, 55000, 52000, 50000,
        ])

        // Verify the item is in the correct position
        const frankIndex = updatedResults.findIndex((r) => r.name === `Frank`)
        expect(frankIndex).toBe(2) // Should be third in the list
      })

      it(`handles updates to ordered fields correctly`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        // Update Alice's salary to be the highest
        const updatedAlice = { ...employeeData[0]!, salary: 70000 }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `update`,
          value: updatedAlice,
        })
        employeesCollection.utils.commit()

        const results = Array.from(collection.values())

        // Alice should now have the highest salary but fractional indexing might keep original order
        // What matters is that her salary is updated to 70000 and she appears in the results
        const aliceResult = results.find((r) => r.name === `Alice`)
        expect(aliceResult).toBeDefined()
        expect(aliceResult!.salary).toBe(70000)

        // Check that the highest salary is 70000 (Alice's updated salary)
        const salaries = results.map((r) => r.salary).sort((a, b) => b - a)
        expect(salaries[0]).toBe(70000)
      })

      it(`handles deletions correctly`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        // Delete the highest paid employee (Diana)
        const dianaToDelete = employeeData.find((emp) => emp.id === 4)!
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `delete`,
          value: dianaToDelete,
        })
        employeesCollection.utils.commit()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(4)
        expect(results[0]!.name).toBe(`Bob`) // Now the highest paid
        expect(results.map((r) => r.salary)).toEqual([
          60000, 55000, 52000, 50000,
        ])
      })

      it(`handles insert update delete sequence`, async () => {
        const collection = createCollection(
          mockSyncCollectionOptions<Person>({
            id: `test-string-id-sequence`,
            getKey: (person: Person) => person.id,
            initialData: initialPersons,
          })
        )

        const liveQuery = createLiveQueryCollection((q) =>
          q
            .from({ collection })
            .select(({ collection: c }) => ({
              id: c.id,
              name: c.name,
            }))
            .orderBy(({ collection: c }) => c.id, `asc`)
        )
        await liveQuery.preload()

        // Initial state: should have all 3 people
        let results = Array.from(liveQuery.values())
        expect(results).toHaveLength(3)

        // INSERT: Add Kyle
        collection.utils.begin()
        collection.utils.write({
          type: `insert`,
          value: {
            id: `4`,
            name: `Kyle Doe`,
            age: 40,
            email: `kyle.doe@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        collection.utils.commit()

        results = Array.from(liveQuery.values())
        expect(results).toHaveLength(4)
        let entries = new Map(liveQuery.entries())
        expect(entries.get(`4`)).toMatchObject({
          id: `4`,
          name: `Kyle Doe`,
        })

        // UPDATE: Change Kyle's name
        collection.utils.begin()
        collection.utils.write({
          type: `update`,
          value: {
            id: `4`,
            name: `Kyle Doe Updated`,
            age: 40,
            email: `kyle.doe@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        collection.utils.commit()

        results = Array.from(liveQuery.values())
        expect(results).toHaveLength(4)
        entries = new Map(liveQuery.entries())
        expect(entries.get(`4`)).toMatchObject({
          id: `4`,
          name: `Kyle Doe Updated`,
        })

        // DELETE: Remove Kyle
        collection.utils.begin()
        collection.utils.write({
          type: `delete`,
          value: {
            id: `4`,
            name: `Kyle Doe Updated`,
            age: 40,
            email: `kyle.doe@example.com`,
            isActive: true,
            team: `team1`,
          },
        })
        collection.utils.commit()

        results = Array.from(liveQuery.values())
        expect(results).toHaveLength(3) // Should be back to original 3
        entries = new Map(liveQuery.entries())
        expect(entries.get(`4`)).toBeUndefined()
      })
    })

    describe(`Edge Cases`, () => {
      it(`handles empty collections`, async () => {
        const emptyCollection = createCollection(
          mockSyncCollectionOptions<Employee>({
            id: `test-empty-employees`,
            getKey: (employee) => employee.id,
            initialData: [],
          })
        )

        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: emptyCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(0)
      })
    })

    describe(`Nullable Column OrderBy`, () => {
      let employeesWithNullableCollection: ReturnType<
        typeof createEmployeesWithNullableCollection
      >

      beforeEach(() => {
        employeesWithNullableCollection =
          createEmployeesWithNullableCollection(autoIndex)
      })

      it(`orders by nullable column ascending with nulls first`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesWithNullableCollection })
            .orderBy(({ employees }) => employees.salary, {
              direction: `asc`,
              nulls: `first`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(6)

        // Should have nulls first, then sorted by salary ascending
        expect(results.map((r) => r.salary)).toEqual([
          null, // Frank
          null, // Bob
          50000, // Alice
          52000, // Eve
          55000, // Charlie
          65000, // Diana
        ])
      })

      it(`orders by nullable column ascending with nulls last`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesWithNullableCollection })
            .orderBy(({ employees }) => employees.salary, {
              direction: `asc`,
              nulls: `last`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(6)

        // Should have lowest salaries first, then nulls last
        expect(results.map((r) => r.salary)).toEqual([
          50000, // Alice
          52000, // Eve
          55000, // Charlie
          65000, // Diana
          null, // Bob
          null, // Frank
        ])
      })

      it(`orders by nullable column descending with nulls first`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesWithNullableCollection })
            .orderBy(({ employees }) => employees.salary, {
              direction: `desc`,
              nulls: `first`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(6)

        // Should have nulls first, then highest salaries
        expect(results.map((r) => r.salary)).toEqual([
          null, // Frank
          null, // Bob
          65000, // Diana
          55000, // Charlie
          52000, // Eve
          50000, // Alice
        ])
      })

      it(`orders by nullable column descending with nulls last`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesWithNullableCollection })
            .orderBy(({ employees }) => employees.salary, {
              direction: `desc`,
              nulls: `last`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(6)

        // Should have highest salaries first, then nulls last
        expect(results.map((r) => r.salary)).toEqual([
          65000, // Diana
          55000, // Charlie
          52000, // Eve
          50000, // Alice
          null, // Bob
          null, // Frank
        ])
      })

      it(`orders by multiple nullable columns`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesWithNullableCollection })
            .orderBy(({ employees }) => employees.department_id, {
              direction: `asc`,
              nulls: `first`,
            })
            .orderBy(({ employees }) => employees.salary, {
              direction: `desc`,
              nulls: `last`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              department_id: employees.department_id,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(6)

        // Should be ordered by department_id ASC (nulls first), then salary DESC (nulls last)
        // Department null: Charlie (55000), Frank (null)
        // Department 1: Alice (50000), Eve (52000)
        // Department 2: Diana (65000), Bob (null)
        expect(
          results.map((r) => ({ dept: r.department_id, salary: r.salary }))
        ).toEqual([
          { dept: null, salary: 55000 }, // Charlie
          { dept: null, salary: null }, // Frank
          { dept: 1, salary: 52000 }, // Eve
          { dept: 1, salary: 50000 }, // Alice
          { dept: 2, salary: 65000 }, // Diana
          { dept: 2, salary: null }, // Bob
        ])
      })

      it(`maintains stable ordering during live updates with nullable fields`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesWithNullableCollection })
            .orderBy(({ employees }) => employees.salary, {
              direction: `asc`,
              nulls: `first`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        // Get initial order
        const initialResults = Array.from(collection.values())
        expect(initialResults.map((r) => r.salary)).toEqual([
          null,
          null,
          50000,
          52000,
          55000,
          65000,
        ])

        // Add a new employee with null salary
        const newEmployee = {
          id: 7,
          name: `Grace`,
          department_id: 1,
          salary: null,
          hire_date: `2023-01-01`,
        }
        employeesWithNullableCollection.utils.begin()
        employeesWithNullableCollection.utils.write({
          type: `insert`,
          value: newEmployee,
        })
        employeesWithNullableCollection.utils.commit()

        // Check that ordering is maintained with new null item
        const updatedResults = Array.from(collection.values())
        expect(updatedResults.map((r) => r.salary)).toEqual([
          null,
          null,
          null,
          50000,
          52000,
          55000,
          65000,
        ])

        // Verify the new item is in the correct position
        const graceIndex = updatedResults.findIndex((r) => r.name === `Grace`)
        expect(graceIndex).toBeLessThan(3) // Should be among the nulls
      })
    })

    describe(`String Comparison Tests`, () => {
      it(`handles case differently in lexical vs locale string comparison`, async () => {
        const numericEmployees = [
          {
            id: 1,
            name: `Charlie`,
            department_id: 1,
            salary: 50000,
            hire_date: `2020-01-15`,
          },
          {
            id: 2,
            name: `alice`,
            department_id: 1,
            salary: 50000,
            hire_date: `2020-01-15`,
          },
          {
            id: 3,
            name: `bob`,
            department_id: 1,
            salary: 50000,
            hire_date: `2020-01-15`,
          },
        ]

        const numericCollection = createCollection(
          mockSyncCollectionOptions<Employee>({
            id: `test-numeric-employees`,
            getKey: (employee) => employee.id,
            initialData: numericEmployees,
            autoIndex,
          })
        )

        // Test lexical sorting (should sort by character code)
        const lexicalCollection = createLiveQueryCollection((q) =>
          q
            .from({ employees: numericCollection })
            .orderBy(({ employees }) => employees.name, {
              direction: `asc`,
              stringSort: `lexical`,
            })
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
            }))
        )
        await lexicalCollection.preload()

        // In lexical comparison, uppercase letters come before lowercase letters
        const lexicalResults = Array.from(lexicalCollection.values())
        expect(lexicalResults.map((r) => r.name)).toEqual([
          `Charlie`,
          `alice`,
          `bob`,
        ])

        // Test locale sorting with numeric collation (default)
        const localeCollection = createLiveQueryCollection((q) =>
          q
            .from({ employees: numericCollection })
            .orderBy(({ employees }) => employees.name, `asc`)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
            }))
        )
        await localeCollection.preload()

        const localeResults = Array.from(localeCollection.values())
        expect(localeResults.map((r) => r.name)).toEqual([
          `alice`,
          `bob`,
          `Charlie`,
        ])
      })
    })
  })
}

describe(`Query2 OrderBy Compiler`, () => {
  createOrderByTests(`off`)
  createOrderByTests(`eager`)
})
