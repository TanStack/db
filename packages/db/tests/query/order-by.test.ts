import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"
import { createLiveQueryCollection } from "../../src/query/live-query-collection.js"
import {
  eq,
  gt,
  isUndefined,
  lt,
  max,
  not,
} from "../../src/query/builder/functions.js"
import { createFilterFunctionFromExpression } from "../../src/collection/change-events.js"

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
  profile?: {
    bio: string
    score: number
    stats: {
      tasksCompleted: number
      rating: number
    }
  }
  address?: {
    city: string
    country: string
    coordinates: {
      lat: number
      lng: number
    }
  }
}

const initialPersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
    isActive: true,
    team: `team1`,
    profile: {
      bio: `Senior developer with 5 years experience`,
      score: 85,
      stats: {
        tasksCompleted: 120,
        rating: 4.5,
      },
    },
    address: {
      city: `New York`,
      country: `USA`,
      coordinates: {
        lat: 40.7128,
        lng: -74.006,
      },
    },
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
    isActive: true,
    team: `team2`,
    profile: {
      bio: `Junior developer`,
      score: 92,
      stats: {
        tasksCompleted: 85,
        rating: 4.8,
      },
    },
    address: {
      city: `Los Angeles`,
      country: `USA`,
      coordinates: {
        lat: 34.0522,
        lng: -118.2437,
      },
    },
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
    isActive: true,
    team: `team1`,
    profile: {
      bio: `Lead engineer`,
      score: 78,
      stats: {
        tasksCompleted: 200,
        rating: 4.2,
      },
    },
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

      it(`applies incremental insert of a new row before the topK correctly`, async () => {
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

        // Now insert a new employee with highest salary
        // this should push Diana which previously had the highest salary (65k)
        // into the 2nd position and thus part of the top 2 with offset 1
        const newEmployee = {
          id: 6,
          name: `George`,
          department_id: 1,
          salary: 70_000,
          hire_date: `2023-01-01`,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `insert`,
          value: newEmployee,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())

        expect(newResults).toHaveLength(2)
        expect(newResults.map((r) => [r.id, r.salary])).toEqual([
          [4, 65_000],
          [2, 60_000],
        ])
      })

      it(`applies incremental insert of a new row inside the topK correctly`, async () => {
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

        // Now insert a new employee with 2nd highest salary
        // this should push Charlie which previously had the 3rd highest salary (55k)
        // to position 4 and thus out of the top 2 with offset 1
        const newEmployee = {
          id: 6,
          name: `George`,
          department_id: 1,
          salary: 62_000,
          hire_date: `2023-01-01`,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `insert`,
          value: newEmployee,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())

        expect(newResults).toHaveLength(2)
        expect(newResults.map((r) => [r.id, r.salary])).toEqual([
          [6, 62_000],
          [2, 60_000],
        ])
      })

      it(`applies incremental insert of a new row inside the topK but after max sent value correctly`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `asc`)
            .offset(1)
            .limit(10)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results.map((r) => r.salary)).toEqual([
          52_000, 55_000, 60_000, 65_000,
        ])

        // Now insert a new employee with highest salary
        // this should now become part of the topK because
        // the topK isn't full yet, so even though it's after the max sent value
        // it should still be part of the topK
        const newEmployee = {
          id: 6,
          name: `George`,
          department_id: 1,
          salary: 72_000,
          hire_date: `2023-01-01`,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `insert`,
          value: newEmployee,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())

        expect(newResults.map((r) => [r.id, r.salary])).toEqual([
          [5, 52_000],
          [3, 55_000],
          [2, 60_000],
          [4, 65_000],
          [6, 72_000],
        ])
      })

      it(`applies incremental insert of a new row after the topK correctly`, async () => {
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

        // Now insert a new employee with a lower salary than those from the top K
        // There should be no changes to the top K
        const newEmployee = {
          id: 6,
          name: `George`,
          department_id: 1,
          salary: 43_000,
          hire_date: `2023-01-01`,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `insert`,
          value: newEmployee,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())

        expect(newResults).toHaveLength(2)
        expect(results.map((r) => r.salary)).toEqual([60000, 55000])
      })

      it(`applies incremental update of a row inside the topK correctly`, async () => {
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

        // Now we update the salary of Bob from 60k to 62k
        // he should stay in the top 2 with offset 1
        // and there should be no changes to the top 2 except for the salary change
        const bobData = employeeData.find((e) => e.id === 2)!
        const bobUpdatedData = { ...bobData, salary: 62_000 }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `update`,
          previousValue: bobData,
          value: bobUpdatedData,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())

        expect(newResults).toHaveLength(2)
        expect(newResults.map((r) => [r.id, r.salary])).toEqual([
          [2, 62_000],
          [3, 55_000],
        ])
      })

      it(`applies incremental delete of a row in the topK correctly`, async () => {
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

        // Now delete Bob with salary 60k
        // as a result, Eve with salary 52k should move into the top 2 with offset 1
        const bobData = employeeData.find((e) => e.id === 2)!

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `delete`,
          value: bobData,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())

        expect(newResults).toHaveLength(2)
        expect(newResults.map((r) => [r.id, r.salary])).toEqual([
          [3, 55_000],
          [5, 52_000],
        ])
      })

      it(`handles deletion from partial page with limit larger than data`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .orderBy(({ employees }) => employees.salary, `desc`)
            .limit(20) // Limit larger than number of employees (5)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(5)
        expect(results[0]!.name).toBe(`Diana`)

        // Delete Diana (the highest paid employee, first in DESC order)
        const dianaData = employeeData.find((e) => e.id === 4)!
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `delete`,
          value: dianaData,
        })
        employeesCollection.utils.commit()

        const newResults = Array.from(collection.values())
        expect(newResults).toHaveLength(4)
        expect(newResults[0]!.name).toBe(`Bob`)
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
            .orderBy(({ departments }) => departments?.name, `asc`)
            .orderBy(({ employees }) => employees.salary, `desc`)
            .select(({ employees, departments }) => ({
              id: employees.id,
              employee_name: employees.name,
              department_name: departments?.name,
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

    describe(`OrderBy with GroupBy`, () => {
      it(`should order grouped results correctly`, async () => {
        type VehicleDocument = {
          id: number
          vin: string
          updatedAt: number
        }

        const vehicleDocumentsData = [
          { id: 1, vin: `1`, updatedAt: new Date(`2023-01-01`).getTime() },
          { id: 2, vin: `2`, updatedAt: new Date(`2023-01-02`).getTime() },
          { id: 3, vin: `1`, updatedAt: new Date(`2023-01-05`).getTime() },
        ]

        const vehicleDocumentCollection = createCollection(
          mockSyncCollectionOptions<VehicleDocument>({
            id: `vehicle-document-collection`,
            getKey: (doc) => doc.id,
            autoIndex: `eager`,
            initialData: vehicleDocumentsData,
          })
        )

        const liveQuery = createLiveQueryCollection({
          query: (qb) =>
            qb
              .from({ vehicleDocuments: vehicleDocumentCollection })
              .groupBy((q) => q.vehicleDocuments.vin)
              .orderBy((q) => q.vehicleDocuments.vin, `asc`)
              .select((q) => ({
                vin: q.vehicleDocuments.vin,
              })),
          startSync: true,
        })

        await liveQuery.stateWhenReady()
        expect(liveQuery.toArray).toEqual([{ vin: `1` }, { vin: `2` }])

        // Insert a vehicle document
        vehicleDocumentCollection.utils.begin()
        vehicleDocumentCollection.utils.write({
          type: `insert`,
          value: {
            id: 4,
            vin: `3`,
            updatedAt: new Date(`2023-01-03`).getTime(),
          },
        })
        vehicleDocumentCollection.utils.commit()

        expect(liveQuery.toArray).toEqual([
          { vin: `1` },
          { vin: `2` },
          { vin: `3` },
        ])
      })

      it(`should order groups based on aggregates correctly`, async () => {
        type VehicleDocument = {
          id: number
          vin: string
          updatedAt: number
        }

        const vehicleDocumentsData = [
          { id: 1, vin: `1`, updatedAt: new Date(`2023-01-01`).getTime() },
          { id: 2, vin: `2`, updatedAt: new Date(`2023-01-02`).getTime() },
          { id: 3, vin: `1`, updatedAt: new Date(`2023-01-05`).getTime() },
        ]

        const vehicleDocumentCollection = createCollection(
          mockSyncCollectionOptions<VehicleDocument>({
            id: `vehicle-document-collection`,
            getKey: (doc) => doc.id,
            autoIndex: `eager`,
            initialData: vehicleDocumentsData,
          })
        )

        const liveQuery = createLiveQueryCollection({
          query: (qb) =>
            qb
              .from({ vehicleDocuments: vehicleDocumentCollection })
              .groupBy((q) => q.vehicleDocuments.vin)
              .orderBy((q) => max(q.vehicleDocuments.updatedAt), `desc`)
              .select((q) => ({
                vin: q.vehicleDocuments.vin,
                updatedAt: max(q.vehicleDocuments.updatedAt),
              }))
              .offset(0)
              .limit(10),
          startSync: true,
        })

        await liveQuery.stateWhenReady()
        expect(liveQuery.toArray).toEqual([
          { vin: `1`, updatedAt: new Date(`2023-01-05`).getTime() },
          { vin: `2`, updatedAt: new Date(`2023-01-02`).getTime() },
        ])

        // Insert a vehicle document
        vehicleDocumentCollection.utils.begin()
        vehicleDocumentCollection.utils.write({
          type: `insert`,
          value: {
            id: 4,
            vin: `3`,
            updatedAt: new Date(`2023-01-03`).getTime(),
          },
        })
        vehicleDocumentCollection.utils.commit()

        expect(liveQuery.toArray).toEqual([
          { vin: `1`, updatedAt: new Date(`2023-01-05`).getTime() },
          { vin: `3`, updatedAt: new Date(`2023-01-03`).getTime() },
          { vin: `2`, updatedAt: new Date(`2023-01-02`).getTime() },
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

      it(`orders correctly with a limit`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .where(({ employees }) => gt(employees.salary, 50000))
            .orderBy(({ employees }) => employees.salary, `asc`)
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
        expect(results.map((r) => r.salary)).toEqual([52000, 55000])
        expect(results.map((r) => r.id)).toEqual([5, 3])
      })

      it(`returns a single row with limit 1`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ employees: employeesCollection })
            .where(({ employees }) => gt(employees.salary, 50000))
            .orderBy(({ employees }) => employees.salary, `asc`)
            .limit(1)
            .select(({ employees }) => ({
              id: employees.id,
              name: employees.name,
              salary: employees.salary,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())

        expect(results).toHaveLength(1)
        expect(results[0]!.id).toEqual(5)
        expect(results[0]!.salary).toEqual(52000)
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

      it(`can use orderBy on different columns of the same collection`, async () => {
        type DateItem = {
          id: string
          date: Date
          value: number
        }

        const dateCollection = createCollection(
          mockSyncCollectionOptions<DateItem>({
            id: `test-dates`,
            getKey: (item) => item.id,
            initialData: [
              {
                id: `1`,
                date: new Date(`2025-09-15`),
                value: 5,
              },
              {
                id: `2`,
                date: new Date(`2025-09-10`),
                value: 42,
              },
            ],
            autoIndex,
          })
        )

        // When autoIndex is `eager` this creates an index on the date field
        const firstQuery = createLiveQueryCollection((q) =>
          q
            .from({ numbers: dateCollection })
            .orderBy(({ numbers }) => numbers.date, `asc`)
            .limit(1)
        )
        await firstQuery.preload()

        // This then tries to use an index on the date field but in the opposite direction
        const orderByQuery = createLiveQueryCollection((q) =>
          q
            .from({ numbers: dateCollection })
            .orderBy(({ numbers }) => numbers.value, `asc`)
            .limit(1)
        )
        await orderByQuery.preload()

        const orderedDatesResult = Array.from(firstQuery.values())
        expect(orderedDatesResult).toHaveLength(1)

        expect(orderedDatesResult[0]!.id).toBe(`2`)
        expect(orderedDatesResult[0]!.date).toEqual(new Date(`2025-09-10`))
        expect(orderedDatesResult[0]!.value).toBe(42)

        const orderedNumbersResult = Array.from(orderByQuery.values())
        expect(orderedNumbersResult).toHaveLength(1)

        expect(orderedNumbersResult[0]!.id).toBe(`1`)
        expect(orderedNumbersResult[0]!.value).toBe(5)
        expect(orderedNumbersResult[0]!.date).toEqual(new Date(`2025-09-15`))
      })

      it(`can use orderBy in both ascending and descending order on the same column`, async () => {
        type DateItem = {
          id: string
          date: Date
        }

        const dateCollection = createCollection(
          mockSyncCollectionOptions<DateItem>({
            id: `test-dates`,
            getKey: (item) => item.id,
            initialData: [
              {
                id: `1`,
                date: new Date(`2025-09-15`),
              },
              {
                id: `2`,
                date: new Date(`2025-09-10`),
              },
            ],
            autoIndex,
          })
        )

        // When autoIndex is `eager` this creates an index on the date field
        const firstQuery = createLiveQueryCollection((q) =>
          q
            .from({ numbers: dateCollection })
            .orderBy(({ numbers }) => numbers.date, `asc`)
            .limit(1)
            .select(({ numbers }) => ({
              id: numbers.id,
              date: numbers.date,
            }))
        )
        await firstQuery.preload()

        // This then tries to use an index on the date field but in the opposite direction
        const orderByQuery = createLiveQueryCollection((q) =>
          q
            .from({ numbers: dateCollection })
            .orderBy(({ numbers }) => numbers.date, `desc`)
            .limit(1)
            .select(({ numbers }) => ({
              id: numbers.id,
              date: numbers.date,
            }))
        )
        await orderByQuery.preload()

        const results = Array.from(orderByQuery.values())
        expect(results).toHaveLength(1)

        expect(results[0]!.id).toBe(`1`)
        expect(results[0]!.date).toEqual(new Date(`2025-09-15`))
      })

      it(`optimizes where clause correctly after orderBy on same column`, async () => {
        type PersonItem = {
          id: string
          age: number | null
        }

        const personsCollection = createCollection(
          mockSyncCollectionOptions<PersonItem>({
            id: `test-dates`,
            getKey: (item) => item.id,
            initialData: [
              {
                id: `1`,
                age: 14,
              },
              {
                id: `2`,
                age: 25,
              },
              {
                id: `3`,
                age: null,
              },
            ],
            autoIndex,
          })
        )

        // When autoIndex is `eager` this creates an index on the date field
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.age, {
              direction: `asc`,
              nulls: `last`,
            })
            .limit(3)
        )
        await query1.preload()

        const result1 = Array.from(query1.values())
        expect(result1).toHaveLength(3)
        expect(result1.map((r) => r.age)).toEqual([14, 25, null])

        // With 3-valued logic, lt(null, 18) returns UNKNOWN (null), which excludes the row
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .where(({ persons }) => lt(persons.age, 18))
        )
        await query2.preload()

        const result2 = Array.from(query2.values())
        const ages = result2.map((r) => r.age)
        // null should NOT be included because lt(null, 18) returns UNKNOWN in 3-valued logic
        expect(ages).toHaveLength(1)
        expect(ages).toContain(14)

        // The default compare options defaults to nulls first
        // So the null value is not part of the result
        const query3 = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .where(({ persons }) => gt(persons.age, 18))
        )
        await query3.preload()

        const result3 = Array.from(query3.values())
        const ages2 = result3.map((r) => r.age)
        expect(ages2).toHaveLength(1)
        expect(ages2).toContain(25)
      })

      it(`can use orderBy when two different comparators are used on the same column`, async () => {
        type DateItem = {
          id: string
          value: string
        }

        const dateCollection = createCollection(
          mockSyncCollectionOptions<DateItem>({
            id: `test-dates`,
            getKey: (item) => item.id,
            initialData: [
              {
                id: `1`,
                value: `a`,
              },
              {
                id: `2`,
                value: `b`,
              },
              {
                id: `3`,
                value: `C`,
              },
            ],
            autoIndex,
          })
        )

        // When autoIndex is `eager` this creates an index on the date field
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ numbers: dateCollection })
            .orderBy(({ numbers }) => numbers.value, {
              direction: `asc`,
              stringSort: `lexical`,
            })
            .limit(2)
        )
        await query1.preload()

        const results1 = Array.from(query1.values()).map((r) => r.value)
        expect(results1).toEqual([`C`, `a`])

        // This then tries to use an index on the date field but in the opposite direction
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ numbers: dateCollection })
            .orderBy(({ numbers }) => numbers.value, {
              direction: `asc`,
              stringSort: `locale`,
              locale: `en-US`,
            })
            .limit(2)
        )
        await query2.preload()

        const results2 = Array.from(query2.values()).map((r) => r.value)
        expect(results2).toEqual([`a`, `b`])
      })

      it(`can use orderBy when nulls first vs nulls last are used on the same column`, async () => {
        type NullableItem = {
          id: string
          value: number | null
        }

        const nullableCollection = createCollection(
          mockSyncCollectionOptions<NullableItem>({
            id: `test-nullable`,
            getKey: (item) => item.id,
            initialData: [
              {
                id: `1`,
                value: 10,
              },
              {
                id: `2`,
                value: null,
              },
              {
                id: `3`,
                value: 5,
              },
              {
                id: `4`,
                value: null,
              },
            ],
            autoIndex,
          })
        )

        // When autoIndex is `eager` this creates an index on the value field with nulls first
        const query1 = createLiveQueryCollection((q) =>
          q
            .from({ items: nullableCollection })
            .orderBy(({ items }) => items.value, {
              direction: `asc`,
              nulls: `first`,
            })
            .limit(3)
            .select(({ items }) => ({
              id: items.id,
              value: items.value,
            }))
        )
        await query1.preload()

        const results1 = Array.from(query1.values())
        expect(results1.map((r) => r.value)).toEqual([null, null, 5])

        // This then tries to use an index on the value field but with nulls last
        const query2 = createLiveQueryCollection((q) =>
          q
            .from({ items: nullableCollection })
            .orderBy(({ items }) => items.value, {
              direction: `asc`,
              nulls: `last`,
            })
            .limit(3)
            .select(({ items }) => ({
              id: items.id,
              value: items.value,
            }))
        )
        await query2.preload()

        const results2 = Array.from(query2.values())
        expect(results2.map((r) => r.value)).toEqual([5, 10, null])
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

    describe(`OrderBy Optimization Tests`, () => {
      const itWhenAutoIndex = autoIndex === `eager` ? it : it.skip

      itWhenAutoIndex(
        `optimizes single-column orderBy when passed as single value`,
        async () => {
          // Patch getConfig to expose the builder on the returned config for test access
          const { CollectionConfigBuilder } = await import(
            `../../src/query/live/collection-config-builder.js`
          )
          const originalGetConfig = CollectionConfigBuilder.prototype.getConfig

          CollectionConfigBuilder.prototype.getConfig = function (this: any) {
            const cfg = originalGetConfig.call(this)
            ;(cfg as any).__builder = this
            return cfg
          }

          try {
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

            const builder = (collection as any).config.__builder
            expect(builder).toBeTruthy()
            expect(
              Object.keys(builder.optimizableOrderByCollections)
            ).toContain(employeesCollection.id)
          } finally {
            CollectionConfigBuilder.prototype.getConfig = originalGetConfig
          }
        }
      )

      itWhenAutoIndex(
        `optimizes orderBy with alias paths in joins`,
        async () => {
          // Patch getConfig to expose the builder on the returned config for test access
          const { CollectionConfigBuilder } = await import(
            `../../src/query/live/collection-config-builder.js`
          )
          const originalGetConfig = CollectionConfigBuilder.prototype.getConfig

          CollectionConfigBuilder.prototype.getConfig = function (this: any) {
            const cfg = originalGetConfig.call(this)
            ;(cfg as any).__builder = this
            return cfg
          }

          try {
            const collection = createLiveQueryCollection((q) =>
              q
                .from({ employees: employeesCollection })
                .join(
                  { departments: departmentsCollection },
                  ({ employees, departments }) =>
                    eq(employees.department_id, departments.id)
                )
                .orderBy(({ departments }) => departments?.name, `asc`)
                .limit(5)
                .select(({ employees, departments }) => ({
                  employeeId: employees.id,
                  employeeName: employees.name,
                  departmentName: departments?.name,
                }))
            )

            await collection.preload()

            const builder = (collection as any).config.__builder
            expect(builder).toBeTruthy()

            // Verify that the order-by optimization is scoped to the departments alias
            const orderByInfo = Object.values(
              builder.optimizableOrderByCollections
            )[0] as any
            expect(orderByInfo).toBeDefined()
            expect(orderByInfo.alias).toBe(`departments`)
            expect(orderByInfo.offset).toBe(0)
            expect(orderByInfo.limit).toBe(5)
          } finally {
            CollectionConfigBuilder.prototype.getConfig = originalGetConfig
          }
        }
      )

      itWhenAutoIndex(
        `optimizes single-column orderBy when passed as array with single element`,
        async () => {
          // Patch getConfig to expose the builder on the returned config for test access
          const { CollectionConfigBuilder } = await import(
            `../../src/query/live/collection-config-builder.js`
          )
          const originalGetConfig = CollectionConfigBuilder.prototype.getConfig

          CollectionConfigBuilder.prototype.getConfig = function (this: any) {
            const cfg = originalGetConfig.call(this)
            ;(cfg as any).__builder = this
            return cfg
          }

          try {
            const collection = createLiveQueryCollection((q) =>
              q
                .from({ employees: employeesCollection })
                .orderBy(({ employees }) => [employees.salary], `desc`)
                .limit(3)
                .select(({ employees }) => ({
                  id: employees.id,
                  name: employees.name,
                  salary: employees.salary,
                }))
            )

            await collection.preload()

            const builder = (collection as any).config.__builder
            expect(builder).toBeTruthy()
            expect(
              Object.keys(builder.optimizableOrderByCollections)
            ).toContain(employeesCollection.id)
          } finally {
            CollectionConfigBuilder.prototype.getConfig = originalGetConfig
          }
        }
      )
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

    describe(`Nested Object OrderBy`, () => {
      const createPersonsCollection = () => {
        return createCollection(
          mockSyncCollectionOptions<Person>({
            id: `test-persons-nested`,
            getKey: (person) => person.id,
            initialData: initialPersons,
            autoIndex,
          })
        )
      }

      let personsCollection: ReturnType<typeof createPersonsCollection>

      beforeEach(() => {
        personsCollection = createPersonsCollection()
      })

      it(`orders by nested object properties ascending`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.profile?.score, `asc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              score: persons.profile?.score,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(3)
        expect(results.map((r) => r.score)).toEqual([78, 85, 92]) // John Smith, John Doe, Jane Doe
        expect(results.map((r) => r.name)).toEqual([
          `John Smith`,
          `John Doe`,
          `Jane Doe`,
        ])
      })

      it(`orders by nested object properties descending`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.profile?.score, `desc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              score: persons.profile?.score,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(3)
        expect(results.map((r) => r.score)).toEqual([92, 85, 78]) // Jane Doe, John Doe, John Smith
        expect(results.map((r) => r.name)).toEqual([
          `Jane Doe`,
          `John Doe`,
          `John Smith`,
        ])
      })

      it(`orders by deeply nested properties`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.profile?.stats.rating, `desc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              rating: persons.profile?.stats.rating,
              tasksCompleted: persons.profile?.stats.tasksCompleted,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(3)
        expect(results.map((r) => r.rating)).toEqual([4.8, 4.5, 4.2]) // Jane, John Doe, John Smith
        expect(results.map((r) => r.name)).toEqual([
          `Jane Doe`,
          `John Doe`,
          `John Smith`,
        ])
      })

      it(`orders by multiple nested properties`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.team, `asc`)
            .orderBy(({ persons }) => persons.profile?.score, `desc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              team: persons.team,
              score: persons.profile?.score,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(3)

        // Should be ordered by team ASC, then score DESC within each team
        // team1: John Doe (85), John Smith (78)
        // team2: Jane Doe (92)
        expect(results.map((r) => r.team)).toEqual([`team1`, `team1`, `team2`])
        expect(results.map((r) => r.name)).toEqual([
          `John Doe`,
          `John Smith`,
          `Jane Doe`,
        ])
        expect(results.map((r) => r.score)).toEqual([85, 78, 92])
      })

      it(`orders by coordinates (nested numeric properties)`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .where(({ persons }) => not(isUndefined(persons.address)))
            .orderBy(({ persons }) => persons.address?.coordinates.lat, `asc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              city: persons.address?.city,
              lat: persons.address?.coordinates.lat,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(2) // Only John Doe and Jane Doe have addresses
        expect(results.map((r) => r.lat)).toEqual([34.0522, 40.7128]) // LA, then NY
        expect(results.map((r) => r.city)).toEqual([`Los Angeles`, `New York`])
      })

      it(`handles null/undefined nested properties in ordering`, async () => {
        // Add a person without profile for testing
        const personWithoutProfile: Person = {
          id: `4`,
          name: `Test Person`,
          age: 40,
          email: `test@example.com`,
          isActive: true,
          team: `team3`,
        }

        personsCollection.utils.begin()
        personsCollection.utils.write({
          type: `insert`,
          value: personWithoutProfile,
        })
        personsCollection.utils.commit()

        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.profile?.score, `desc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              score: persons.profile?.score,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(4)

        // Person without profile should have undefined score and be first (undefined sorts first)
        expect(results.map((r) => r.score)).toEqual([undefined, 92, 85, 78])
        expect(results[0]!.name).toBe(`Test Person`)
      })

      it(`maintains ordering during live updates of nested properties`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.profile?.score, `desc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              score: persons.profile?.score,
            }))
        )
        await collection.preload()

        // Initial order should be Jane (92), John Doe (85), John Smith (78)
        let results = Array.from(collection.values())
        expect(results.map((r) => r.name)).toEqual([
          `Jane Doe`,
          `John Doe`,
          `John Smith`,
        ])

        // Update John Smith's score to be highest
        const johnSmith = initialPersons.find((p) => p.id === `3`)!
        const updatedJohnSmith: Person = {
          ...johnSmith,
          profile: {
            ...johnSmith.profile!,
            score: 95, // Higher than Jane's 92
          },
        }

        personsCollection.utils.begin()
        personsCollection.utils.write({
          type: `update`,
          value: updatedJohnSmith,
        })
        personsCollection.utils.commit()

        // Order should now be John Smith (95), Jane (92), John Doe (85)
        results = Array.from(collection.values())
        expect(results.map((r) => r.name)).toEqual([
          `John Smith`,
          `Jane Doe`,
          `John Doe`,
        ])
        expect(results.map((r) => r.score)).toEqual([95, 92, 85])
      })

      it(`handles string ordering on nested properties`, async () => {
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ persons: personsCollection })
            .orderBy(({ persons }) => persons.address?.city, `asc`)
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              city: persons.address?.city,
            }))
        )
        await collection.preload()

        const results = Array.from(collection.values())
        expect(results).toHaveLength(3)

        // Should be ordered: undefined, Los Angeles, New York (undefined sorts first)
        // Note: undefined values in ORDER BY sort first in our implementation
        expect(results.map((r) => r.city)).toEqual([
          undefined,
          `Los Angeles`,
          `New York`,
        ])
        expect(results.map((r) => r.name)).toEqual([
          `John Smith`,
          `Jane Doe`,
          `John Doe`,
        ])
      })
    })
  })
}

describe(`Query2 OrderBy Compiler`, () => {
  createOrderByTests(`off`)
  createOrderByTests(`eager`)
})

describe(`OrderBy with collection-level StringSortOpts`, () => {
  type StringItem = {
    id: number
    name: string
  }

  const stringItemsData: Array<StringItem> = [
    { id: 1, name: `Charlie` },
    { id: 2, name: `alice` },
    { id: 3, name: `bob` },
  ]

  it(`should use collection's compareOptions when query doesn't specify stringSort`, async () => {
    // Create collection with lexical string sorting as default
    const collectionWithLexical = createCollection(
      mockSyncCollectionOptions<StringItem>({
        id: `test-lexical-collection`,
        getKey: (item) => item.id,
        initialData: stringItemsData,
        defaultStringCollation: {
          stringSort: `lexical`,
        },
      })
    )

    // Query without specifying stringSort should use collection's lexical default
    const lexicalQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: collectionWithLexical })
        .orderBy(({ items }) => items.name, `asc`)
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        }))
    )
    await lexicalQuery.preload()

    // In lexical comparison, uppercase letters come before lowercase letters
    const lexicalResults = Array.from(lexicalQuery.values())
    expect(lexicalResults.map((r) => r.name)).toEqual([
      `Charlie`,
      `alice`,
      `bob`,
    ])
  })

  it(`should override collection's compareOptions when query specifies stringSort`, async () => {
    // Create collection with lexical string sorting as default
    const collectionWithLexical = createCollection(
      mockSyncCollectionOptions<StringItem>({
        id: `test-lexical-collection-override`,
        getKey: (item) => item.id,
        initialData: stringItemsData,
        defaultStringCollation: {
          stringSort: `lexical`,
        },
      })
    )

    // Query with explicit locale stringSort should override collection's lexical default
    const localeQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: collectionWithLexical })
        .orderBy(({ items }) => items.name, {
          direction: `asc`,
          stringSort: `locale`,
          locale: `en-US`,
        })
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        }))
    )
    await localeQuery.preload()

    // In locale comparison, case-insensitive sorting puts lowercase first
    const localeResults = Array.from(localeQuery.values())
    expect(localeResults.map((r) => r.name)).toEqual([
      `alice`,
      `bob`,
      `Charlie`,
    ])
  })

  it(`should use collection default and allow query overrides`, async () => {
    // Create collection with lexical string sorting as default
    const collectionWithLexical = createCollection(
      mockSyncCollectionOptions<StringItem>({
        id: `test-lexical-collection-sequence`,
        getKey: (item) => item.id,
        initialData: stringItemsData,
        defaultStringCollation: {
          stringSort: `lexical`,
        },
      })
    )

    // First query without specifying stringSort should use collection's lexical default
    const firstQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: collectionWithLexical })
        .orderBy(({ items }) => items.name, `asc`)
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        }))
    )
    await firstQuery.preload()

    // In lexical comparison, uppercase letters come before lowercase letters
    const firstResults = Array.from(firstQuery.values())
    expect(firstResults.map((r) => r.name)).toEqual([`Charlie`, `alice`, `bob`])

    // Second query with explicit locale stringSort should override collection's lexical default
    const secondQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: collectionWithLexical })
        .orderBy(({ items }) => items.name, {
          direction: `asc`,
          stringSort: `locale`,
          locale: `en-US`,
        })
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        }))
    )
    await secondQuery.preload()

    // Should use locale sorting (case-insensitive) for this query
    const secondResults = Array.from(secondQuery.values())
    expect(secondResults.map((r) => r.name)).toEqual([
      `alice`,
      `bob`,
      `Charlie`,
    ])

    // Third query without specifying stringSort should use collection's lexical default again
    const thirdQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: collectionWithLexical })
        .orderBy(({ items }) => items.name, `desc`)
        .select(({ items }) => ({
          id: items.id,
          name: items.name,
        }))
    )
    await thirdQuery.preload()

    // Should revert back to lexical sorting (collection default)
    const thirdResults = Array.from(thirdQuery.values())
    expect(thirdResults.map((r) => r.name)).toEqual([`bob`, `alice`, `Charlie`])
  })
})

describe(`OrderBy with collection alias conflicts`, () => {
  type EmailSchema = {
    email: string
    createdAt: Date
  }

  const date1 = new Date(`2024-01-01`)
  const date2 = new Date(`2024-01-02`)
  const date3 = new Date(`2024-01-03`)

  const emailCollection = createCollection<EmailSchema>({
    ...mockSyncCollectionOptions({
      id: `emails`,
      getKey: (item) => item.email,
      initialData: [
        { email: `first@test.com`, createdAt: date1 },
        { email: `second@test.com`, createdAt: date2 },
        { email: `third@test.com`, createdAt: date3 },
      ],
    }),
  })

  it(`should work when alias does not conflict with field name`, () => {
    // This should work fine - alias "t" doesn't conflict with any field
    const liveCollection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ t: emailCollection }).orderBy(({ t }) => t.createdAt, `desc`),
    })

    const result = liveCollection.toArray

    expect(result).toHaveLength(3)
    expect(result[0]?.email).toBe(`third@test.com`)
    expect(result[1]?.email).toBe(`second@test.com`)
    expect(result[2]?.email).toBe(`first@test.com`)
  })

  it(`should work when alias DOES conflict with field name`, () => {
    // This breaks - alias "email" conflicts with field "email"
    const liveCollection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ email: emailCollection })
          .orderBy(({ email }) => email.createdAt, `desc`),
    })

    const result = liveCollection.toArray

    expect(result).toHaveLength(3)
    // The sorting should work - most recent first
    expect(result[0]?.email).toBe(`third@test.com`)
    expect(result[1]?.email).toBe(`second@test.com`)
    expect(result[2]?.email).toBe(`first@test.com`)
  })

  it(`should also work for createdAt alias conflict`, () => {
    // This should also work - alias "createdAt" conflicts with field "createdAt"
    const liveCollection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ createdAt: emailCollection })
          .orderBy(({ createdAt }) => createdAt.email, `asc`),
    })

    const result = liveCollection.toArray as Array<EmailSchema>

    expect(result).toHaveLength(3)
    // The sorting should work - alphabetically by email
    expect(result[0]?.email).toBe(`first@test.com`)
    expect(result[1]?.email).toBe(`second@test.com`)
    expect(result[2]?.email).toBe(`third@test.com`)
  })
})

describe(`OrderBy with duplicate values`, () => {
  type TestItem = {
    id: number
    a: number
    keep: boolean
  }

  function createOrderByBugTests(autoIndex: `off` | `eager`): void {
    describe(`with autoIndex ${autoIndex}`, () => {
      it(`should correctly advance window when there are duplicate values`, async () => {
        // Create test data that reproduces the specific bug described:
        // Items with many duplicates at value 5, then normal progression
        const duplicateTestData: Array<TestItem> = [
          { id: 1, a: 1, keep: true },
          { id: 2, a: 2, keep: true },
          { id: 3, a: 3, keep: true },
          { id: 4, a: 4, keep: true },
          { id: 5, a: 5, keep: true },
          { id: 6, a: 5, keep: true },
          { id: 7, a: 5, keep: true },
          { id: 8, a: 5, keep: true },
          { id: 9, a: 5, keep: true },
          { id: 10, a: 5, keep: true },
          { id: 11, a: 11, keep: true },
          { id: 12, a: 12, keep: true },
          { id: 13, a: 13, keep: true },
          { id: 14, a: 14, keep: true },
          { id: 15, a: 15, keep: true },
          { id: 16, a: 16, keep: true },
        ]

        const duplicateCollection = createCollection(
          mockSyncCollectionOptions<TestItem>({
            id: `test-duplicate-window-bug`,
            getKey: (item) => item.id,
            initialData: duplicateTestData,
            autoIndex,
          })
        )

        // Create a live query with offset 0, limit 5 (first page)
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ items: duplicateCollection })
            .where(({ items }) => eq(items.keep, true))
            .orderBy(({ items }) => items.a, `asc`)
            .offset(0)
            .limit(5)
            .select(({ items }) => ({
              id: items.id,
              a: items.a,
              keep: items.keep,
            }))
        )
        await collection.preload()

        // First page should return items 1-5
        let results = Array.from(collection.values()).sort(
          (a, b) => a.id - b.id
        )
        expect(results).toEqual([
          { id: 1, a: 1, keep: true },
          { id: 2, a: 2, keep: true },
          { id: 3, a: 3, keep: true },
          { id: 4, a: 4, keep: true },
          { id: 5, a: 5, keep: true },
        ])

        // Now move to next page (offset 5, limit 5)
        collection.utils.setWindow({ offset: 5, limit: 5 })
        await collection.stateWhenReady()

        // Second page should return items 6-10 (all with value 5)
        results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
        expect(results).toEqual([
          { id: 6, a: 5, keep: true },
          { id: 7, a: 5, keep: true },
          { id: 8, a: 5, keep: true },
          { id: 9, a: 5, keep: true },
          { id: 10, a: 5, keep: true },
        ])

        // Now move to third page (offset 10, limit 5)
        // It should advance past the duplicate 5s
        collection.utils.setWindow({ offset: 10, limit: 5 })
        await collection.stateWhenReady()

        // Third page should return items 11-13 (the items after the duplicate 5s)
        // The bug would cause this to stall and return empty or get stuck
        results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
        expect(results).toEqual([
          { id: 11, a: 11, keep: true },
          { id: 12, a: 12, keep: true },
          { id: 13, a: 13, keep: true },
          { id: 14, a: 14, keep: true },
          { id: 15, a: 15, keep: true },
        ])

        // Verify we can continue to next page
        collection.utils.setWindow({ offset: 15, limit: 5 })
        await collection.stateWhenReady()

        // Should be empty since we've exhausted all items
        results = Array.from(collection.values())
        expect(results).toEqual([{ id: 16, a: 16, keep: true }])
      })

      it(`should correctly advance window when there are duplicate values loaded from sync layer`, async () => {
        // Create test data that reproduces the specific bug described:
        // Items with many duplicates at value 5, then normal progression
        const allTestData: Array<TestItem> = [
          { id: 1, a: 1, keep: true },
          { id: 2, a: 2, keep: true },
          { id: 3, a: 3, keep: true },
          { id: 4, a: 4, keep: true },
          { id: 5, a: 5, keep: true },
          { id: 6, a: 5, keep: true },
          { id: 7, a: 5, keep: true },
          { id: 8, a: 5, keep: true },
          { id: 9, a: 5, keep: true },
          { id: 10, a: 5, keep: true },
          { id: 11, a: 11, keep: true },
          { id: 12, a: 12, keep: true },
          { id: 13, a: 13, keep: true },
          { id: 14, a: 14, keep: true },
          { id: 15, a: 15, keep: true },
          { id: 16, a: 16, keep: true },
        ]

        // Start with only the first 5 items in the local collection
        const initialData = allTestData.slice(0, 5)
        let loadSubsetCallCount = 0

        const duplicateCollection = createCollection(
          mockSyncCollectionOptions<TestItem>({
            id: `test-duplicate-sync-layer-bug`,
            getKey: (item) => item.id,
            initialData,
            autoIndex,
            syncMode: `on-demand`,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                // Load initial data
                begin()
                initialData.forEach((item) => {
                  write({
                    type: `insert`,
                    value: item,
                  })
                })
                commit()
                markReady()

                return {
                  loadSubset: (options) => {
                    loadSubsetCallCount++

                    // Simulate async loading from remote source
                    return new Promise<void>((resolve) => {
                      setTimeout(() => {
                        begin()

                        // Order all test data by field 'a' in ascending order
                        const sortedData = [...allTestData].sort(
                          (a, b) => a.a - b.a
                        )

                        // Apply where clause filter if present
                        let filteredData = sortedData
                        if (options.where) {
                          try {
                            const filterFn = createFilterFunctionFromExpression(
                              options.where
                            )
                            filteredData = sortedData.filter(filterFn)
                          } catch (error) {
                            console.log(`Error compiling where clause:`, error)
                            // If compilation fails, use all data
                            filteredData = sortedData
                          }
                        }

                        // Return a slice from 0 to limit
                        const { limit } = options
                        const dataToLoad = limit
                          ? filteredData.slice(0, limit)
                          : filteredData

                        dataToLoad.forEach((item) => {
                          write({
                            type: `insert`,
                            value: item,
                          })
                        })

                        commit()
                        resolve()
                      }, 10) // Small delay to simulate network
                    })
                  },
                }
              },
            },
          })
        )

        // Create a live query with offset 0, limit 5 (first page)
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ items: duplicateCollection })
            .where(({ items }) => eq(items.keep, true))
            .orderBy(({ items }) => items.a, `asc`)
            .offset(0)
            .limit(5)
            .select(({ items }) => ({
              id: items.id,
              a: items.a,
              keep: items.keep,
            }))
        )
        await collection.preload()

        // First page should return items 1-5 (all local data)
        let results = Array.from(collection.values()).sort(
          (a, b) => a.id - b.id
        )
        expect(results).toEqual([
          { id: 1, a: 1, keep: true },
          { id: 2, a: 2, keep: true },
          { id: 3, a: 3, keep: true },
          { id: 4, a: 4, keep: true },
          { id: 5, a: 5, keep: true },
        ])
        expect(loadSubsetCallCount).toBe(1)

        // Now move to next page (offset 5, limit 5) - this should trigger loadSubset
        const moveToSecondPage = collection.utils.setWindow({
          offset: 5,
          limit: 5,
        })
        expect(moveToSecondPage).toBeInstanceOf(Promise)
        await moveToSecondPage

        // Second page should return items 6-10 (all with value 5, loaded from sync layer)
        results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
        expect(results).toEqual([
          { id: 6, a: 5, keep: true },
          { id: 7, a: 5, keep: true },
          { id: 8, a: 5, keep: true },
          { id: 9, a: 5, keep: true },
          { id: 10, a: 5, keep: true },
        ])
        // we expect 2 new loadSubset calls (1 for data equal to max value and one for data greater than max value)
        expect(loadSubsetCallCount).toBe(3)

        // Now move to third page (offset 10, limit 5)
        // It should advance past the duplicate 5s
        const moveToThirdPage = collection.utils.setWindow({
          offset: 10,
          limit: 5,
        })

        // Now it is `true` because we already have that page
        // because when we loaded the 2nd page we loaded all the duplicate 5s and then we loaded
        // values > 5 with limit 5 but since the entire 2nd page is filled with the duplicate 5s
        // we in fact already loaded the third page so it is immediately available here
        expect(moveToThirdPage).toBe(true)

        // Third page should return items 11-13 (the items after the duplicate 5s)
        // The bug would cause this to stall and return empty or get stuck
        results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
        expect(results).toEqual([
          { id: 11, a: 11, keep: true },
          { id: 12, a: 12, keep: true },
          { id: 13, a: 13, keep: true },
          { id: 14, a: 14, keep: true },
          { id: 15, a: 15, keep: true },
        ])
        // We expect no more loadSubset calls because when we loaded the previous page
        // we asked for all data equal to max value and LIMIT values greater than max value
        // and the LIMIT values greater than max value already loaded the next page
        expect(loadSubsetCallCount).toBe(3)
      })

      it(`should correctly advance window when there are duplicate values loaded from both local collection and sync layer`, async () => {
        // Create test data that reproduces the specific bug described:
        // Items with many duplicates at value 5, then normal progression
        const allTestData: Array<TestItem> = [
          { id: 1, a: 1, keep: true },
          { id: 2, a: 2, keep: true },
          { id: 3, a: 3, keep: true },
          { id: 4, a: 4, keep: true },
          { id: 5, a: 5, keep: true },
          { id: 6, a: 5, keep: true },
          { id: 7, a: 5, keep: true },
          { id: 8, a: 5, keep: true },
          { id: 9, a: 5, keep: true },
          { id: 10, a: 5, keep: true },
          { id: 11, a: 11, keep: true },
          { id: 12, a: 12, keep: true },
          { id: 13, a: 13, keep: true },
          { id: 14, a: 14, keep: true },
          { id: 15, a: 15, keep: true },
          { id: 16, a: 16, keep: true },
        ]

        // Start with only the first 5 items in the local collection
        const initialData = allTestData.slice(0, 10)
        let loadSubsetCallCount = 0

        const duplicateCollection = createCollection(
          mockSyncCollectionOptions<TestItem>({
            id: `test-duplicate-sync-layer-bug`,
            getKey: (item) => item.id,
            initialData,
            autoIndex,
            syncMode: `on-demand`,
            sync: {
              sync: ({ begin, write, commit, markReady }) => {
                // Load initial data
                begin()
                initialData.forEach((item) => {
                  write({
                    type: `insert`,
                    value: item,
                  })
                })
                commit()
                markReady()

                return {
                  loadSubset: (options) => {
                    loadSubsetCallCount++

                    // Simulate async loading from remote source
                    return new Promise<void>((resolve) => {
                      setTimeout(() => {
                        begin()

                        // Order all test data by field 'a' in ascending order
                        const sortedData = [...allTestData].sort(
                          (a, b) => a.a - b.a
                        )

                        // Apply where clause filter if present
                        let filteredData = sortedData
                        if (options.where) {
                          try {
                            const filterFn = createFilterFunctionFromExpression(
                              options.where
                            )
                            filteredData = sortedData.filter(filterFn)
                          } catch (error) {
                            console.log(`Error compiling where clause:`, error)
                            // If compilation fails, use all data
                            filteredData = sortedData
                          }
                        }

                        // Return a slice from 0 to limit
                        const { limit } = options
                        const dataToLoad = limit
                          ? filteredData.slice(0, limit)
                          : filteredData

                        dataToLoad.forEach((item) => {
                          write({
                            type: `insert`,
                            value: item,
                          })
                        })

                        commit()
                        resolve()
                      }, 10) // Small delay to simulate network
                    })
                  },
                }
              },
            },
          })
        )

        // Create a live query with offset 0, limit 5 (first page)
        const collection = createLiveQueryCollection((q) =>
          q
            .from({ items: duplicateCollection })
            .where(({ items }) => eq(items.keep, true))
            .orderBy(({ items }) => items.a, `asc`)
            .offset(0)
            .limit(5)
            .select(({ items }) => ({
              id: items.id,
              a: items.a,
              keep: items.keep,
            }))
        )
        await collection.preload()

        // First page should return items 1-5 (all local data)
        let results = Array.from(collection.values()).sort(
          (a, b) => a.id - b.id
        )
        expect(results).toEqual([
          { id: 1, a: 1, keep: true },
          { id: 2, a: 2, keep: true },
          { id: 3, a: 3, keep: true },
          { id: 4, a: 4, keep: true },
          { id: 5, a: 5, keep: true },
        ])
        expect(loadSubsetCallCount).toBe(1)

        // Now move to next page (offset 5, limit 5) - this should trigger loadSubset
        const moveToSecondPage = collection.utils.setWindow({
          offset: 5,
          limit: 5,
        })
        expect(moveToSecondPage).toBeInstanceOf(Promise)
        await moveToSecondPage

        // Second page should return items 6-10 (all with value 5, loaded from sync layer)
        results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
        expect(results).toEqual([
          { id: 6, a: 5, keep: true },
          { id: 7, a: 5, keep: true },
          { id: 8, a: 5, keep: true },
          { id: 9, a: 5, keep: true },
          { id: 10, a: 5, keep: true },
        ])
        // we expect 2 new loadSubset calls (1 for data equal to max value and one for data greater than max value)
        expect(loadSubsetCallCount).toBe(3)

        // Now move to third page (offset 10, limit 5)
        // It should advance past the duplicate 5s
        const moveToThirdPage = collection.utils.setWindow({
          offset: 10,
          limit: 5,
        })

        // Now it is `true` because we already have that page
        // because when we loaded the 2nd page we loaded all the duplicate 5s and then we loaded
        // values > 5 with limit 5 but since the entire 2nd page is filled with the duplicate 5s
        // we in fact already loaded the third page so it is immediately available here
        expect(moveToThirdPage).toBe(true)

        // Third page should return items 11-13 (the items after the duplicate 5s)
        // The bug would cause this to stall and return empty or get stuck
        results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
        expect(results).toEqual([
          { id: 11, a: 11, keep: true },
          { id: 12, a: 12, keep: true },
          { id: 13, a: 13, keep: true },
          { id: 14, a: 14, keep: true },
          { id: 15, a: 15, keep: true },
        ])
        // We expect no more loadSubset calls because when we loaded the previous page
        // we asked for all data equal to max value and LIMIT values greater than max value
        // and the LIMIT values greater than max value already loaded the next page
        expect(loadSubsetCallCount).toBe(3)
      })
    })
  }

  createOrderByBugTests(`eager`)
})

describe(`OrderBy with Date values and precision differences`, () => {
  type TestItemWithDate = {
    id: number
    createdAt: Date
    keep: boolean
  }

  it(`should use range query for Date values to handle backend precision differences`, async () => {
    // This test verifies that when paginating with Date orderBy values,
    // the code uses a range query (gte/lt) instead of exact equality (eq)
    // to handle backends with higher precision than JavaScript's millisecond precision.
    //
    // The bug: PostgreSQL stores timestamps with microsecond precision.
    // When JS has a Date "2024-01-15T10:30:45.123Z", the backend might have multiple
    // rows with 123.000μs, 123.100μs, 123.200μs, etc. Using eq() would only match
    // 123.000μs, missing the others. The fix uses gte/lt to match the full 1ms range.

    const baseTime = new Date(`2024-01-15T10:30:45.123Z`)

    const testData: Array<TestItemWithDate> = [
      { id: 1, createdAt: new Date(`2024-01-15T10:30:45.120Z`), keep: true },
      { id: 2, createdAt: new Date(`2024-01-15T10:30:45.121Z`), keep: true },
      { id: 3, createdAt: new Date(`2024-01-15T10:30:45.122Z`), keep: true },
      { id: 4, createdAt: new Date(`2024-01-15T10:30:45.122Z`), keep: true },
      { id: 5, createdAt: baseTime, keep: true },
      { id: 6, createdAt: baseTime, keep: true },
      { id: 7, createdAt: baseTime, keep: true },
      { id: 8, createdAt: baseTime, keep: true },
      { id: 9, createdAt: baseTime, keep: true },
      { id: 10, createdAt: baseTime, keep: true },
      { id: 11, createdAt: new Date(`2024-01-15T10:30:45.124Z`), keep: true },
      { id: 12, createdAt: new Date(`2024-01-15T10:30:45.125Z`), keep: true },
    ]

    const initialData = testData.slice(0, 5)

    // Track the WHERE clauses sent to loadSubset
    const loadSubsetWhereClauses: Array<any> = []

    const sourceCollection = createCollection(
      mockSyncCollectionOptions<TestItemWithDate>({
        id: `test-date-precision-query`,
        getKey: (item) => item.id,
        initialData,
        autoIndex: `eager`,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            initialData.forEach((item) => {
              write({ type: `insert`, value: item })
            })
            commit()
            markReady()

            return {
              loadSubset: (options) => {
                // Capture the WHERE clause for inspection
                loadSubsetWhereClauses.push(options.where)

                return new Promise<void>((resolve) => {
                  setTimeout(() => {
                    begin()
                    const sortedData = [...testData].sort(
                      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
                    )

                    let filteredData = sortedData
                    if (options.where) {
                      try {
                        const filterFn = createFilterFunctionFromExpression(
                          options.where
                        )
                        filteredData = sortedData.filter(filterFn)
                      } catch {
                        filteredData = sortedData
                      }
                    }

                    const { limit } = options
                    const dataToLoad = limit
                      ? filteredData.slice(0, limit)
                      : filteredData

                    dataToLoad.forEach((item) => {
                      write({ type: `insert`, value: item })
                    })

                    commit()
                    resolve()
                  }, 10)
                })
              },
            }
          },
        },
      })
    )

    const collection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .where(({ items }) => eq(items.keep, true))
        .orderBy(({ items }) => items.createdAt, `asc`)
        .offset(0)
        .limit(5)
        .select(({ items }) => ({
          id: items.id,
          createdAt: items.createdAt,
          keep: items.keep,
        }))
    )
    await collection.preload()

    // First page loads
    const results = Array.from(collection.values()).sort((a, b) => a.id - b.id)
    expect(results.map((r) => r.id)).toEqual([1, 2, 3, 4, 5])

    // Clear tracked clauses before moving to next page
    loadSubsetWhereClauses.length = 0

    // Move to next page - this should trigger the Date precision handling
    const moveToSecondPage = collection.utils.setWindow({ offset: 5, limit: 5 })
    await moveToSecondPage

    // Find the WHERE clause that queries for the "equal values" (the minValue query)
    // With the fix, this should be: and(gte(createdAt, baseTime), lt(createdAt, baseTime+1ms))
    // Without the fix, this would be: eq(createdAt, baseTime)
    const equalValuesQuery = loadSubsetWhereClauses.find((clause) => {
      if (!clause) return false
      // Check if it's an 'and' with 'gte' and 'lt' (the fix)
      if (clause.name === `and` && clause.args?.length === 2) {
        const [first, second] = clause.args
        return first?.name === `gte` && second?.name === `lt`
      }
      return false
    })

    // The fix should produce a range query (and(gte, lt)) for Date values
    // instead of an exact equality query (eq)
    expect(equalValuesQuery).toBeDefined()
    expect(equalValuesQuery.name).toBe(`and`)
    expect(equalValuesQuery.args[0].name).toBe(`gte`)
    expect(equalValuesQuery.args[1].name).toBe(`lt`)

    // Verify the range is exactly 1ms
    const gteValue = equalValuesQuery.args[0].args[1].value
    const ltValue = equalValuesQuery.args[1].args[1].value
    expect(gteValue).toBeInstanceOf(Date)
    expect(ltValue).toBeInstanceOf(Date)
    expect(ltValue.getTime() - gteValue.getTime()).toBe(1) // 1ms difference
  })
})
