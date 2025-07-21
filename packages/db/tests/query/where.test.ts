import { beforeEach, describe, expect, test } from "vitest"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"
import {
  add,
  and,
  coalesce,
  concat,
  eq,
  gt,
  gte,
  inArray,
  length,
  like,
  lower,
  lt,
  lte,
  not,
  or,
  upper,
} from "../../src/query/builder/functions.js"

// Sample data types for comprehensive testing
type Employee = {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
  hire_date: string
  email: string | null
  first_name: string
  last_name: string
  age: number
}

// Sample employee data
const sampleEmployees: Array<Employee> = [
  {
    id: 1,
    name: `Alice Johnson`,
    department_id: 1,
    salary: 75000,
    active: true,
    hire_date: `2020-01-15`,
    email: `alice@company.com`,
    first_name: `Alice`,
    last_name: `Johnson`,
    age: 28,
  },
  {
    id: 2,
    name: `Bob Smith`,
    department_id: 2,
    salary: 65000,
    active: true,
    hire_date: `2019-03-20`,
    email: `bob@company.com`,
    first_name: `Bob`,
    last_name: `Smith`,
    age: 32,
  },
  {
    id: 3,
    name: `Charlie Brown`,
    department_id: 1,
    salary: 85000,
    active: false,
    hire_date: `2018-07-10`,
    email: null,
    first_name: `Charlie`,
    last_name: `Brown`,
    age: 35,
  },
  {
    id: 4,
    name: `Diana Miller`,
    department_id: 3,
    salary: 95000,
    active: true,
    hire_date: `2021-11-05`,
    email: `diana@company.com`,
    first_name: `Diana`,
    last_name: `Miller`,
    age: 29,
  },
  {
    id: 5,
    name: `Eve Wilson`,
    department_id: 2,
    salary: 55000,
    active: true,
    hire_date: `2022-02-14`,
    email: `eve@company.com`,
    first_name: `Eve`,
    last_name: `Wilson`,
    age: 25,
  },
  {
    id: 6,
    name: `Frank Davis`,
    department_id: null,
    salary: 45000,
    active: false,
    hire_date: `2017-09-30`,
    email: `frank@company.com`,
    first_name: `Frank`,
    last_name: `Davis`,
    age: 40,
  },
]

function createEmployeesCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<Employee>({
      id: `test-employees`,
      getKey: (emp) => emp.id,
      initialData: sampleEmployees,
      autoIndex,
    })
  )
}

function createWhereTests(autoIndex: `off` | `eager`): void {
  describe(`with autoIndex ${autoIndex}`, () => {
    describe(`Comparison Operators`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection(autoIndex)
      })

      test(`eq operator - equality comparison`, () => {
        const activeEmployees = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.active, true))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                active: emp.active,
              })),
        })

        expect(activeEmployees.size).toBe(4) // Alice, Bob, Diana, Eve
        expect(activeEmployees.toArray.every((emp) => emp.active)).toBe(true)

        // Test with number equality
        const specificEmployee = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.id, 1))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(specificEmployee.size).toBe(1)
        expect(specificEmployee.get(1)?.name).toBe(`Alice Johnson`)

        // Test live updates
        const newEmployee: Employee = {
          id: 7,
          name: `Grace Lee`,
          department_id: 1,
          salary: 70000,
          active: true,
          hire_date: `2023-01-10`,
          email: `grace@company.com`,
          first_name: `Grace`,
          last_name: `Lee`,
          age: 27,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `insert`, value: newEmployee })
        employeesCollection.utils.commit()

        expect(activeEmployees.size).toBe(5) // Should include Grace
        expect(activeEmployees.get(7)?.name).toBe(`Grace Lee`)

        // Update Grace to inactive
        const inactiveGrace = { ...newEmployee, active: false }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `update`,
          value: inactiveGrace,
        })
        employeesCollection.utils.commit()

        expect(activeEmployees.size).toBe(4) // Should exclude Grace
        expect(activeEmployees.get(7)).toBeUndefined()
      })

      test(`gt operator - greater than comparison`, () => {
        const highEarners = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => gt(emp.salary, 70000))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(highEarners.size).toBe(3) // Alice (75k), Charlie (85k), Diana (95k)
        expect(highEarners.toArray.every((emp) => emp.salary > 70000)).toBe(
          true
        )

        // Test with age
        const seniors = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => gt(emp.age, 30))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                age: emp.age,
              })),
        })

        expect(seniors.size).toBe(3) // Bob (32), Charlie (35), Frank (40)

        // Test live updates
        const youngerEmployee: Employee = {
          id: 8,
          name: `Henry Young`,
          department_id: 1,
          salary: 80000, // Above 70k threshold
          active: true,
          hire_date: `2023-01-15`,
          email: `henry@company.com`,
          first_name: `Henry`,
          last_name: `Young`,
          age: 26, // Below 30 threshold
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `insert`,
          value: youngerEmployee,
        })
        employeesCollection.utils.commit()

        expect(highEarners.size).toBe(4) // Should include Henry (salary > 70k)
        expect(seniors.size).toBe(3) // Should not include Henry (age <= 30)
      })

      test(`gte operator - greater than or equal comparison`, () => {
        const wellPaid = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => gte(emp.salary, 65000))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(wellPaid.size).toBe(4) // Alice, Bob, Charlie, Diana
        expect(wellPaid.toArray.every((emp) => emp.salary >= 65000)).toBe(true)

        // Test boundary condition
        const exactMatch = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => gte(emp.salary, 65000))
              .select(({ emp }) => ({ id: emp.id, salary: emp.salary })),
        })

        expect(exactMatch.toArray.some((emp) => emp.salary === 65000)).toBe(
          true
        ) // Bob
      })

      test(`lt operator - less than comparison`, () => {
        const juniorSalary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => lt(emp.salary, 60000))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(juniorSalary.size).toBe(2) // Eve (55k), Frank (45k)
        expect(juniorSalary.toArray.every((emp) => emp.salary < 60000)).toBe(
          true
        )

        // Test with age
        const youngEmployees = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => lt(emp.age, 30))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                age: emp.age,
              })),
        })

        expect(youngEmployees.size).toBe(3) // Alice (28), Diana (29), Eve (25)
      })

      test(`lte operator - less than or equal comparison`, () => {
        const modestSalary = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => lte(emp.salary, 65000))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(modestSalary.size).toBe(3) // Bob, Eve, Frank
        expect(modestSalary.toArray.every((emp) => emp.salary <= 65000)).toBe(
          true
        )

        // Test boundary condition
        expect(modestSalary.toArray.some((emp) => emp.salary === 65000)).toBe(
          true
        ) // Bob
      })
    })

    describe(`Boolean Operators`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`and operator - logical AND`, () => {
        const activeHighEarners = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                and(eq(emp.active, true), gt(emp.salary, 70000))
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
                active: emp.active,
              })),
        })

        expect(activeHighEarners.size).toBe(2) // Alice (75k), Diana (95k)
        expect(
          activeHighEarners.toArray.every(
            (emp) => emp.active && emp.salary > 70000
          )
        ).toBe(true)

        // Test with three conditions
        const specificGroup = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                and(
                  eq(emp.active, true),
                  gte(emp.age, 25),
                  lte(emp.salary, 75000)
                )
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                age: emp.age,
                salary: emp.salary,
              })),
        })

        expect(specificGroup.size).toBe(3) // Alice, Bob, Eve
      })

      test(`or operator - logical OR`, () => {
        const seniorOrHighPaid = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => or(gt(emp.age, 33), gt(emp.salary, 80000)))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                age: emp.age,
                salary: emp.salary,
              })),
        })

        expect(seniorOrHighPaid.size).toBe(3) // Charlie (35, 85k), Diana (29, 95k), Frank (40, 45k)

        // Test with department conditions
        const specificDepartments = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                or(eq(emp.department_id, 1), eq(emp.department_id, 3))
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                department_id: emp.department_id,
              })),
        })

        expect(specificDepartments.size).toBe(3) // Alice, Charlie (dept 1), Diana (dept 3)
      })

      test(`not operator - logical NOT`, () => {
        const inactiveEmployees = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => not(eq(emp.active, true)))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                active: emp.active,
              })),
        })

        expect(inactiveEmployees.size).toBe(2) // Charlie, Frank
        expect(inactiveEmployees.toArray.every((emp) => !emp.active)).toBe(true)

        // Test with complex condition
        const notHighEarners = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => not(gt(emp.salary, 70000)))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(notHighEarners.size).toBe(3) // Bob, Eve, Frank
        expect(notHighEarners.toArray.every((emp) => emp.salary <= 70000)).toBe(
          true
        )
      })

      test(`complex nested boolean conditions`, () => {
        const complexQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                and(
                  eq(emp.active, true),
                  or(
                    and(eq(emp.department_id, 1), gt(emp.salary, 70000)),
                    and(eq(emp.department_id, 2), lt(emp.age, 30))
                  )
                )
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                department_id: emp.department_id,
                salary: emp.salary,
                age: emp.age,
              })),
        })

        expect(complexQuery.size).toBe(2) // Alice (dept 1, 75k), Eve (dept 2, age 25)
      })
    })

    describe(`String Operators`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`like operator - pattern matching`, () => {
        const johnsonFamily = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => like(emp.name, `%Johnson%`))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(johnsonFamily.size).toBe(1) // Alice Johnson
        expect(johnsonFamily.get(1)?.name).toBe(`Alice Johnson`)

        // Test starts with pattern
        const startsWithB = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => like(emp.name, `B%`))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(startsWithB.size).toBe(1) // Bob Smith

        // Test ends with pattern
        const endsWither = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => like(emp.name, `%er`))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(endsWither.size).toBe(1) // Diana Miller

        // Test email pattern
        const companyEmails = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => like(emp.email, `%@company.com`))
              .select(({ emp }) => ({ id: emp.id, email: emp.email })),
        })

        expect(companyEmails.size).toBe(5) // All except Charlie (null email)
      })
    })

    describe(`Array Operators`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`inArray operator - membership testing`, () => {
        const specificDepartments = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => inArray(emp.department_id, [1, 2]))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                department_id: emp.department_id,
              })),
        })

        expect(specificDepartments.size).toBe(4) // Alice, Bob, Charlie, Eve
        expect(
          specificDepartments.toArray.every(
            (emp) => emp.department_id === 1 || emp.department_id === 2
          )
        ).toBe(true)

        // Test with specific IDs
        const specificEmployees = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => inArray(emp.id, [1, 3, 5]))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(specificEmployees.size).toBe(3) // Alice, Charlie, Eve

        // Test with salary ranges
        const salaryRanges = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => inArray(emp.salary, [55000, 75000, 95000]))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(salaryRanges.size).toBe(3) // Alice (75k), Diana (95k), Eve (55k)
      })
    })

    describe(`Null Handling`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`null equality comparison`, () => {
        const nullEmails = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.email, null))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                email: emp.email,
              })),
        })

        expect(nullEmails.size).toBe(1) // Charlie
        expect(nullEmails.get(3)?.email).toBeNull()

        const nullDepartments = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.department_id, null))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                department_id: emp.department_id,
              })),
        })

        expect(nullDepartments.size).toBe(1) // Frank
        expect(nullDepartments.get(6)?.department_id).toBeNull()
      })

      test(`not null comparison`, () => {
        const hasEmail = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => not(eq(emp.email, null)))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                email: emp.email,
              })),
        })

        expect(hasEmail.size).toBe(5) // All except Charlie
        expect(hasEmail.toArray.every((emp) => emp.email !== null)).toBe(true)

        const hasDepartment = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => not(eq(emp.department_id, null)))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                department_id: emp.department_id,
              })),
        })

        expect(hasDepartment.size).toBe(5) // All except Frank
      })
    })

    describe(`String Functions in WHERE`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`upper function in WHERE clause`, () => {
        const upperNameMatch = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(upper(emp.first_name), `ALICE`))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(upperNameMatch.size).toBe(1) // Alice
        expect(upperNameMatch.get(1)?.name).toBe(`Alice Johnson`)
      })

      test(`lower function in WHERE clause`, () => {
        const lowerNameMatch = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(lower(emp.last_name), `smith`))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(lowerNameMatch.size).toBe(1) // Bob
        expect(lowerNameMatch.get(2)?.name).toBe(`Bob Smith`)
      })

      test(`length function in WHERE clause`, () => {
        const shortNames = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => lt(length(emp.first_name), 4))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                first_name: emp.first_name,
              })),
        })

        expect(shortNames.size).toBe(2) // Bob (3), Eve (3)
        expect(
          shortNames.toArray.every((emp) => emp.first_name.length < 4)
        ).toBe(true)

        const longNames = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => gt(length(emp.last_name), 6))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                last_name: emp.last_name,
              })),
        })

        expect(longNames.size).toBe(1) // Alice Johnson (7 chars)
      })

      test(`concat function in WHERE clause`, () => {
        const fullNameMatch = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                eq(concat(emp.first_name, ` `, emp.last_name), `Alice Johnson`)
              )
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(fullNameMatch.size).toBe(1) // Alice
        expect(fullNameMatch.get(1)?.name).toBe(`Alice Johnson`)
      })

      test(`coalesce function in WHERE clause`, () => {
        const emailOrDefault = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                like(coalesce(emp.email, `no-email@company.com`), `%no-email%`)
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                email: emp.email,
              })),
        })

        expect(emailOrDefault.size).toBe(1) // Charlie (null email becomes "no-email@company.com")
        expect(emailOrDefault.get(3)?.email).toBeNull()
      })
    })

    describe(`Math Functions in WHERE`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`add function in WHERE clause`, () => {
        const salaryPlusBonus = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => gt(add(emp.salary, 10000), 80000))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(salaryPlusBonus.size).toBe(3) // Alice (85k), Charlie (95k), Diana (105k)
        expect(
          salaryPlusBonus.toArray.every((emp) => emp.salary + 10000 > 80000)
        ).toBe(true)

        // Test age calculation
        const ageCheck = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(add(emp.age, 5), 30))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                age: emp.age,
              })),
        })

        expect(ageCheck.size).toBe(1) // Eve (25 + 5 = 30)
        expect(ageCheck.get(5)?.age).toBe(25)
      })
    })

    describe(`Live Updates with WHERE Clauses`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`live updates with complex WHERE conditions`, () => {
        const complexQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                and(
                  eq(emp.active, true),
                  or(
                    and(gte(emp.salary, 70000), lt(emp.age, 35)),
                    eq(emp.department_id, 2)
                  )
                )
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
                age: emp.age,
                department_id: emp.department_id,
              })),
        })

        // Initial: Alice (active, 75k, 28), Bob (active, dept 2), Diana (active, 95k, 29), Eve (active, dept 2)
        expect(complexQuery.size).toBe(4)

        // Insert employee that matches criteria
        const newEmployee: Employee = {
          id: 10,
          name: `Ian Clark`,
          department_id: 1,
          salary: 80000, // >= 70k
          active: true,
          hire_date: `2023-01-20`,
          email: `ian@company.com`,
          first_name: `Ian`,
          last_name: `Clark`,
          age: 30, // < 35
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `insert`, value: newEmployee })
        employeesCollection.utils.commit()

        expect(complexQuery.size).toBe(5) // Should include Ian
        expect(complexQuery.get(10)?.name).toBe(`Ian Clark`)

        // Update Ian to not match criteria (age >= 35)
        const olderIan = { ...newEmployee, age: 36 }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `update`, value: olderIan })
        employeesCollection.utils.commit()

        expect(complexQuery.size).toBe(4) // Should exclude Ian (age >= 35, not dept 2)
        expect(complexQuery.get(10)).toBeUndefined()

        // Update Ian to dept 2 (should match again)
        const dept2Ian = { ...olderIan, department_id: 2 }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `update`, value: dept2Ian })
        employeesCollection.utils.commit()

        expect(complexQuery.size).toBe(5) // Should include Ian (dept 2)
        expect(complexQuery.get(10)?.department_id).toBe(2)

        // Delete Ian
        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `delete`, value: dept2Ian })
        employeesCollection.utils.commit()

        expect(complexQuery.size).toBe(4) // Back to original
        expect(complexQuery.get(10)).toBeUndefined()
      })

      test(`live updates with string function WHERE conditions`, () => {
        const nameStartsWithA = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => like(upper(emp.first_name), `A%`))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                first_name: emp.first_name,
              })),
        })

        expect(nameStartsWithA.size).toBe(1) // Alice

        // Insert employee with name starting with 'a'
        const newEmployee: Employee = {
          id: 11,
          name: `amy stone`,
          department_id: 1,
          salary: 60000,
          active: true,
          hire_date: `2023-01-25`,
          email: `amy@company.com`,
          first_name: `amy`, // lowercase 'a'
          last_name: `stone`,
          age: 26,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `insert`, value: newEmployee })
        employeesCollection.utils.commit()

        expect(nameStartsWithA.size).toBe(2) // Should include amy (uppercase conversion)
        expect(nameStartsWithA.get(11)?.first_name).toBe(`amy`)

        // Update amy's name to not start with 'A'
        const renamedEmployee = {
          ...newEmployee,
          first_name: `Beth`,
          name: `Beth stone`,
        }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `update`,
          value: renamedEmployee,
        })
        employeesCollection.utils.commit()

        expect(nameStartsWithA.size).toBe(1) // Should exclude Beth
        expect(nameStartsWithA.get(11)).toBeUndefined()
      })

      test(`live updates with null handling`, () => {
        const hasNullEmail = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.email, null))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                email: emp.email,
              })),
        })

        expect(hasNullEmail.size).toBe(1) // Charlie

        // Update Charlie to have an email
        const charlieWithEmail = {
          ...sampleEmployees.find((e) => e.id === 3)!,
          email: `charlie@company.com`,
        }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({
          type: `update`,
          value: charlieWithEmail,
        })
        employeesCollection.utils.commit()

        expect(hasNullEmail.size).toBe(0) // Should exclude Charlie
        expect(hasNullEmail.get(3)).toBeUndefined()

        // Insert new employee with null email
        const newEmployee: Employee = {
          id: 12,
          name: `Jack Null`,
          department_id: 1,
          salary: 60000,
          active: true,
          hire_date: `2023-02-01`,
          email: null, // null email
          first_name: `Jack`,
          last_name: `Null`,
          age: 28,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `insert`, value: newEmployee })
        employeesCollection.utils.commit()

        expect(hasNullEmail.size).toBe(1) // Should include Jack
        expect(hasNullEmail.get(12)?.email).toBeNull()
      })
    })

    describe(`Edge Cases and Error Handling`, () => {
      let employeesCollection: ReturnType<typeof createEmployeesCollection>

      beforeEach(() => {
        employeesCollection = createEmployeesCollection()
      })

      test(`empty collection handling`, () => {
        const emptyCollection = createCollection(
          mockSyncCollectionOptions<Employee>({
            id: `empty-employees`,
            getKey: (emp) => emp.id,
            initialData: [],
          })
        )

        const emptyQuery = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: emptyCollection })
              .where(({ emp }) => eq(emp.active, true))
              .select(({ emp }) => ({ id: emp.id, name: emp.name })),
        })

        expect(emptyQuery.size).toBe(0)

        // Add data to empty collection
        const newEmployee: Employee = {
          id: 1,
          name: `First Employee`,
          department_id: 1,
          salary: 60000,
          active: true,
          hire_date: `2023-02-05`,
          email: `first@company.com`,
          first_name: `First`,
          last_name: `Employee`,
          age: 30,
        }

        emptyCollection.utils.begin()
        emptyCollection.utils.write({ type: `insert`, value: newEmployee })
        emptyCollection.utils.commit()

        expect(emptyQuery.size).toBe(1)
      })

      test(`multiple WHERE conditions with same field`, () => {
        const salaryRange = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                and(gte(emp.salary, 60000), lte(emp.salary, 80000))
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                salary: emp.salary,
              })),
        })

        expect(salaryRange.size).toBe(2) // Bob (65k), Alice (75k)
        expect(
          salaryRange.toArray.every(
            (emp) => emp.salary >= 60000 && emp.salary <= 80000
          )
        ).toBe(true)
      })

      test(`deeply nested conditions`, () => {
        const deeplyNested = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) =>
                or(
                  and(
                    eq(emp.active, true),
                    or(
                      and(eq(emp.department_id, 1), gt(emp.salary, 70000)),
                      and(eq(emp.department_id, 2), lt(emp.age, 30))
                    )
                  ),
                  and(eq(emp.active, false), gt(emp.age, 35))
                )
              )
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                active: emp.active,
                department_id: emp.department_id,
                salary: emp.salary,
                age: emp.age,
              })),
        })

        // Should match: Alice (active, dept 1, 75k), Eve (active, dept 2, age 25), Frank (inactive, age 40 > 35)
        expect(deeplyNested.size).toBe(3) // Alice, Eve, Frank
      })

      test(`multiple WHERE calls should be ANDed together`, () => {
        // Test that multiple .where() calls are combined with AND logic
        const result = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.active, true)) // First condition
              .where(({ emp }) => gt(emp.salary, 70000)) // Second condition (should be ANDed)
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                active: emp.active,
                salary: emp.salary,
              })),
        })

        // Should only return employees that are BOTH active AND have salary > 70000
        // Expected: Alice (active, 75k), Diana (active, 95k)
        // Should NOT include: Bob (active, 65k - fails salary), Charlie (85k, inactive - fails active)
        expect(result.size).toBe(2)

        const resultArray = result.toArray
        expect(
          resultArray.every((emp) => emp.active && emp.salary > 70000)
        ).toBe(true)

        const names = resultArray.map((emp) => emp.name).sort()
        expect(names).toEqual([`Alice Johnson`, `Diana Miller`])
      })

      test(`three WHERE calls should all be ANDed together`, () => {
        const result = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.active, true)) // First condition
              .where(({ emp }) => gte(emp.salary, 65000)) // Second condition
              .where(({ emp }) => lt(emp.age, 35)) // Third condition
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                active: emp.active,
                salary: emp.salary,
                age: emp.age,
              })),
        })

        // Should only return employees that are active AND salary >= 65000 AND age < 35
        // Expected: Alice (active, 75k, 28), Bob (active, 65k, 32), Diana (active, 95k, 29)
        // Should NOT include: Eve (active, 55k, 25 - fails salary), Charlie (inactive), Frank (inactive)
        expect(result.size).toBe(3)

        const resultArray = result.toArray
        expect(
          resultArray.every(
            (emp) => emp.active && emp.salary >= 65000 && emp.age < 35
          )
        ).toBe(true)

        const names = resultArray.map((emp) => emp.name).sort()
        expect(names).toEqual([`Alice Johnson`, `Bob Smith`, `Diana Miller`])
      })

      test(`multiple WHERE calls with live updates`, () => {
        const result = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ emp: employeesCollection })
              .where(({ emp }) => eq(emp.active, true))
              .where(({ emp }) => gte(emp.salary, 70000))
              .select(({ emp }) => ({
                id: emp.id,
                name: emp.name,
                active: emp.active,
                salary: emp.salary,
              })),
        })

        // Initial state: Alice (active, 75k), Diana (active, 95k)
        expect(result.size).toBe(2)

        // Add employee that meets both criteria
        const newEmployee: Employee = {
          id: 10,
          name: `John Doe`,
          department_id: 1,
          salary: 80000, // >= 70k
          active: true, // active
          hire_date: `2023-01-01`,
          email: `john@company.com`,
          first_name: `John`,
          last_name: `Doe`,
          age: 30,
        }

        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `insert`, value: newEmployee })
        employeesCollection.utils.commit()

        expect(result.size).toBe(3) // Should include John
        expect(result.get(10)?.name).toBe(`John Doe`)

        // Update John to not meet salary criteria
        const updatedJohn = { ...newEmployee, salary: 60000 } // < 70k
        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `update`, value: updatedJohn })
        employeesCollection.utils.commit()

        expect(result.size).toBe(2) // Should exclude John
        expect(result.get(10)).toBeUndefined()

        // Update John to not meet active criteria but meet salary
        const inactiveJohn = { ...newEmployee, active: false, salary: 80000 }
        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `update`, value: inactiveJohn })
        employeesCollection.utils.commit()

        expect(result.size).toBe(2) // Should still exclude John
        expect(result.get(10)).toBeUndefined()

        // Clean up
        employeesCollection.utils.begin()
        employeesCollection.utils.write({ type: `delete`, value: inactiveJohn })
        employeesCollection.utils.commit()
      })
    })
  })
}

describe(`Query WHERE Execution`, () => {
  createWhereTests(`off`)
  createWhereTests(`eager`)
})
