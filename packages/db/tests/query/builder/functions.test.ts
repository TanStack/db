import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import {
  add,
  and,
  avg,
  coalesce,
  concat,
  count,
  eq,
  gt,
  gte,
  inArray,
  length,
  like,
  lower,
  lt,
  lte,
  max,
  min,
  not,
  or,
  sum,
  upper,
} from "../../../src/query/builder/functions.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
  first_name: string
  last_name: string
}

// Test collection
const employeesCollection = new CollectionImpl<Employee>({
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`QueryBuilder Functions`, () => {
  describe(`Comparison operators`, () => {
    it(`eq function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => eq(employees.id, 1))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.where).toBeDefined()
      expect((builtQuery.where as any)[0]?.name).toBe(`eq`)
    })

    it(`gt function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => gt(employees.salary, 50000))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`gt`)
    })

    it(`lt function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => lt(employees.salary, 100000))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`lt`)
    })

    it(`gte function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => gte(employees.salary, 50000))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`gte`)
    })

    it(`lte function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => lte(employees.salary, 100000))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`lte`)
    })
  })

  describe(`Boolean operators`, () => {
    it(`and function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) =>
          and(eq(employees.active, true), gt(employees.salary, 50000))
        )

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`and`)
    })

    it(`or function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) =>
          or(eq(employees.department_id, 1), eq(employees.department_id, 2))
        )

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`or`)
    })

    it(`not function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => not(eq(employees.active, false)))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`not`)
    })
  })

  describe(`String functions`, () => {
    it(`upper function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          upper_name: upper(employees.name),
        }))

      const builtQuery = getQueryIR(query)
      expect(builtQuery.select).toBeDefined()
      const select = builtQuery.select!
      expect(select).toHaveProperty(`upper_name`)
      expect((select.upper_name as any).name).toBe(`upper`)
    })

    it(`lower function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          lower_name: lower(employees.name),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.lower_name as any).name).toBe(`lower`)
    })

    it(`length function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          name_length: length(employees.name),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.name_length as any).name).toBe(`length`)
    })

    it(`like function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => like(employees.name, `%John%`))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`like`)
    })
  })

  describe(`Array functions`, () => {
    it(`concat function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          full_name: concat([employees.first_name, ` `, employees.last_name]),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.full_name as any).name).toBe(`concat`)
    })

    it(`coalesce function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          name_or_default: coalesce([employees.name, `Unknown`]),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.name_or_default as any).name).toBe(`coalesce`)
    })

    it(`in function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .where(({ employees }) => inArray(employees.department_id, [1, 2, 3]))

      const builtQuery = getQueryIR(query)
      expect((builtQuery.where as any)[0]?.name).toBe(`in`)
    })
  })

  describe(`Aggregate functions`, () => {
    it(`count function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          employee_count: count(employees.id),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect(select).toHaveProperty(`employee_count`)
      expect((select.employee_count as any).type).toBe(`agg`)
      expect((select.employee_count as any).name).toBe(`count`)
    })

    it(`avg function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          avg_salary: avg(employees.salary),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.avg_salary as any).name).toBe(`avg`)
    })

    it(`sum function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          total_salary: sum(employees.salary),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.total_salary as any).name).toBe(`sum`)
    })

    it(`min and max functions work`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          min_salary: min(employees.salary),
          max_salary: max(employees.salary),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.min_salary as any).name).toBe(`min`)
      expect((select.max_salary as any).name).toBe(`max`)
    })
  })

  describe(`Math functions`, () => {
    it(`add function works`, () => {
      const query = new Query()
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          salary_plus_bonus: add(employees.salary, 1000),
        }))

      const builtQuery = getQueryIR(query)
      const select = builtQuery.select!
      expect((select.salary_plus_bonus as any).name).toBe(`add`)
    })
  })
})
