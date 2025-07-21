import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import { eq, gt } from "../../../src/query/builder/functions.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
}

interface Department {
  id: number
  name: string
}

// Test collections
const employeesCollection = new CollectionImpl<Employee>({
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

const departmentsCollection = new CollectionImpl<Department>({
  id: `departments`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`QueryBuilder functional variants (fn)`, () => {
  describe(`fn.select`, () => {
    it(`sets fnSelect function and removes regular select`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({ id: employees.id })) // This should be removed
        .fn.select((row) => ({ customName: row.employees.name.toUpperCase() }))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnSelect).toBeDefined()
      expect(typeof builtQuery.fnSelect).toBe(`function`)
      expect(builtQuery.select).toBeUndefined() // Regular select should be removed
    })

    it(`works without previous select clause`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .fn.select((row) => row.employees.name)

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnSelect).toBeDefined()
      expect(typeof builtQuery.fnSelect).toBe(`function`)
      expect(builtQuery.select).toBeUndefined()
    })

    it(`supports complex transformations`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .fn.select((row) => ({
          displayName: `${row.employees.name} (ID: ${row.employees.id})`,
          salaryTier: row.employees.salary > 75000 ? `high` : `low`,
          isActiveDepartment:
            row.employees.department_id !== null && row.employees.active,
        }))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnSelect).toBeDefined()
    })

    it(`works with joins`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .join(
          { departments: departmentsCollection },
          ({ employees, departments }) =>
            eq(employees.department_id, departments.id)
        )
        .fn.select((row) => ({
          employeeName: row.employees.name,
          departmentName: row.departments?.name || `No Department`,
        }))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnSelect).toBeDefined()
    })
  })

  describe(`fn.where`, () => {
    it(`adds to fnWhere array`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .fn.where((row) => row.employees.active)

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnWhere).toBeDefined()
      expect(Array.isArray(builtQuery.fnWhere)).toBe(true)
      expect(builtQuery.fnWhere).toHaveLength(1)
      expect(typeof builtQuery.fnWhere![0]).toBe(`function`)
    })

    it(`accumulates multiple fn.where calls`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .fn.where((row) => row.employees.active)
        .fn.where((row) => row.employees.salary > 50000)
        .fn.where((row) => row.employees.name.includes(`John`))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnWhere).toBeDefined()
      expect(builtQuery.fnWhere).toHaveLength(3)
    })

    it(`works alongside regular where clause`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => gt(employees.id, 0)) // Regular where
        .fn.where((row) => row.employees.active) // Functional where

      const builtQuery = getQueryIR(query)
      expect(builtQuery.where).toBeDefined() // Regular where still exists
      expect(builtQuery.fnWhere).toBeDefined()
      expect(builtQuery.fnWhere).toHaveLength(1)
    })

    it(`supports complex conditions`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .fn.where(
          (row) =>
            row.employees.active &&
            row.employees.salary > 60000 &&
            (row.employees.department_id === 1 ||
              row.employees.department_id === 2)
        )

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnWhere).toHaveLength(1)
    })

    it(`works with joins`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .join(
          { departments: departmentsCollection },
          ({ employees, departments }) =>
            eq(employees.department_id, departments.id)
        )
        .fn.where(
          (row) =>
            row.employees.active &&
            row.departments !== undefined &&
            row.departments.name !== `HR`
        )

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnWhere).toHaveLength(1)
    })
  })

  describe(`fn.having`, () => {
    it(`adds to fnHaving array`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .fn.having((row) => row.employees.salary > 50000)

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnHaving).toBeDefined()
      expect(Array.isArray(builtQuery.fnHaving)).toBe(true)
      expect(builtQuery.fnHaving).toHaveLength(1)
      expect(typeof builtQuery.fnHaving![0]).toBe(`function`)
    })

    it(`accumulates multiple fn.having calls`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .fn.having((row) => row.employees.active)
        .fn.having((row) => row.employees.salary > 50000)
        .fn.having((row) => row.employees.name.length > 3)

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnHaving).toBeDefined()
      expect(builtQuery.fnHaving).toHaveLength(3)
    })

    it(`works alongside regular having clause`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .having(({ employees }) => gt(employees.id, 0)) // Regular having
        .fn.having((row) => row.employees.active) // Functional having

      const builtQuery = getQueryIR(query)
      expect(builtQuery.having).toBeDefined() // Regular having still exists
      expect(builtQuery.fnHaving).toBeDefined()
      expect(builtQuery.fnHaving).toHaveLength(1)
    })

    it(`supports complex aggregation conditions`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .fn.having((row) => {
          // Complex condition involving grouped data
          const avgSalary = row.employees.salary // In real usage, this would be computed from grouped data
          return avgSalary > 70000 && row.employees.active
        })

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnHaving).toHaveLength(1)
    })

    it(`works with joins and grouping`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .join(
          { departments: departmentsCollection },
          ({ employees, departments }) =>
            eq(employees.department_id, departments.id)
        )
        .groupBy(({ departments }) => departments.name)
        .fn.having(
          (row) =>
            row.employees.salary > 60000 &&
            row.departments !== undefined &&
            row.departments.name !== `Temp`
        )

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnHaving).toHaveLength(1)
    })
  })

  describe(`combinations`, () => {
    it(`supports all functional variants together`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .join(
          { departments: departmentsCollection },
          ({ employees, departments }) =>
            eq(employees.department_id, departments.id)
        )
        .fn.where((row) => row.employees.active)
        .fn.where((row) => row.employees.salary > 40000)
        .groupBy(({ departments }) => departments.name)
        .fn.having((row) => row.employees.salary > 70000)
        .fn.select((row) => ({
          departmentName: row.departments?.name || `Unknown`,
          employeeInfo: `${row.employees.name} - $${row.employees.salary}`,
          isHighEarner: row.employees.salary > 80000,
        }))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.fnWhere).toHaveLength(2)
      expect(builtQuery.fnHaving).toHaveLength(1)
      expect(builtQuery.fnSelect).toBeDefined()
      expect(builtQuery.select).toBeUndefined() // Regular select should be removed
    })

    it(`works with regular clauses mixed in`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => gt(employees.id, 0)) // Regular where
        .fn.where((row) => row.employees.active) // Functional where
        .select(({ employees }) => ({ id: employees.id })) // Regular select (will be removed)
        .fn.select((row) => ({ name: row.employees.name })) // Functional select

      const builtQuery = getQueryIR(query)
      expect(builtQuery.where).toBeDefined()
      expect(builtQuery.fnWhere).toHaveLength(1)
      expect(builtQuery.select).toBeUndefined() // Should be removed by fn.select
      expect(builtQuery.fnSelect).toBeDefined()
    })
  })

  describe(`error handling`, () => {
    it(`maintains query validity with functional variants`, () => {
      const builder = new Query()

      // Should not throw when building query with functional variants
      expect(() => {
        const query = builder
          .from({ employees: employeesCollection })
          .fn.where((row) => row.employees.active)
          .fn.select((row) => row.employees.name)

        getQueryIR(query)
      }).not.toThrow()
    })

    it(`allows empty functional variant arrays`, () => {
      const query = new Query().from({ employees: employeesCollection })

      const builtQuery = getQueryIR(query)
      // These should be undefined/empty when no functional variants are used
      expect(builtQuery.fnWhere).toBeUndefined()
      expect(builtQuery.fnHaving).toBeUndefined()
      expect(builtQuery.fnSelect).toBeUndefined()
    })
  })
})
