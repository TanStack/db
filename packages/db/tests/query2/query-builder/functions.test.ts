import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { BaseQueryBuilder } from "../../../src/query2/query-builder/index.js"
import { 
  eq, gt, gte, lt, lte, and, or, not, like, isIn as isInFunc,
  upper, lower, length, concat, coalesce, add,
  count, avg, sum, min, max
} from "../../../src/query2/expresions/index.js"

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
  id: "employees",
  getKey: (item) => item.id,
  sync: { sync: () => {} }
})

describe("QueryBuilder Functions", () => {
  describe("Comparison operators", () => {
    it("eq function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => eq(employees.id, 1))

      const builtQuery = query._getQuery()
      expect(builtQuery.where).toBeDefined()
      expect((builtQuery.where as any)?.name).toBe("eq")
    })

    it("gt function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => gt(employees.salary, 50000))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("gt")
    })

    it("lt function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => lt(employees.salary, 100000))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("lt")
    })

    it("gte function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => gte(employees.salary, 50000))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("gte")
    })

    it("lte function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => lte(employees.salary, 100000))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("lte")
    })
  })

  describe("Boolean operators", () => {
    it("and function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => and(
          eq(employees.active, true),
          gt(employees.salary, 50000)
        ))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("and")
    })

    it("or function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => or(
          eq(employees.department_id, 1),
          eq(employees.department_id, 2)
        ))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("or")
    })

    it("not function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => not(eq(employees.active, false)))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("not")
    })
  })

  describe("String functions", () => {
    it("upper function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          upper_name: upper(employees.name)
        }))

      const builtQuery = query._getQuery()
      expect(builtQuery.select).toBeDefined()
      const select = builtQuery.select!
      expect(select).toHaveProperty("upper_name")
      expect((select.upper_name as any).name).toBe("upper")
    })

    it("lower function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          lower_name: lower(employees.name)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.lower_name as any).name).toBe("lower")
    })

    it("length function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          name_length: length(employees.name)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.name_length as any).name).toBe("length")
    })

    it("like function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => like(employees.name, "%John%"))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("like")
    })
  })

  describe("Array functions", () => {
    it("concat function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          full_name: concat([employees.first_name, " ", employees.last_name])
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.full_name as any).name).toBe("concat")
    })

    it("coalesce function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          name_or_default: coalesce([employees.name, "Unknown"])
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.name_or_default as any).name).toBe("coalesce")
    })

    it("in function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .where(({ employees }) => isInFunc(employees.department_id, [1, 2, 3]))

      const builtQuery = query._getQuery()
      expect((builtQuery.where as any)?.name).toBe("in")
    })
  })

  describe("Aggregate functions", () => {
    it("count function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          employee_count: count(employees.id)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect(select).toHaveProperty("employee_count")
      expect((select.employee_count as any).type).toBe("agg")
      expect((select.employee_count as any).name).toBe("count")
    })

    it("avg function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          avg_salary: avg(employees.salary)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.avg_salary as any).name).toBe("avg")
    })

    it("sum function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          total_salary: sum(employees.salary)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.total_salary as any).name).toBe("sum")
    })

    it("min and max functions work", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .groupBy(({ employees }) => employees.department_id)
        .select(({ employees }) => ({
          department_id: employees.department_id,
          min_salary: min(employees.salary),
          max_salary: max(employees.salary)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.min_salary as any).name).toBe("min")
      expect((select.max_salary as any).name).toBe("max")
    })
  })

  describe("Math functions", () => {
    it("add function works", () => {
      const builder = new BaseQueryBuilder()
      const query = builder
        .from({ employees: employeesCollection })
        .select(({ employees }) => ({
          id: employees.id,
          salary_plus_bonus: add(employees.salary, 1000)
        }))

      const builtQuery = query._getQuery()
      const select = builtQuery.select!
      expect((select.salary_plus_bonus as any).name).toBe("add")
    })
  })
}) 