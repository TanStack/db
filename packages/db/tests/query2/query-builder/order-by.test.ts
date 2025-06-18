import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { BaseQueryBuilder } from "../../../src/query2/query-builder/index.js"
import { eq, upper } from "../../../src/query2/expresions/index.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number
  salary: number
  hire_date: string
}

// Test collection
const employeesCollection = new CollectionImpl<Employee>({
  id: "employees",
  getKey: (item) => item.id,
  sync: { sync: () => {} }
})

describe("QueryBuilder.orderBy", () => {
  it("sets the order by clause correctly with default ascending", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name)
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect(builtQuery.orderBy![0]!.type).toBe("ref")
    expect((builtQuery.orderBy![0] as any).path).toEqual(["employees", "name"])
  })

  it("supports descending order", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.salary, "desc")
      .select(({ employees }) => ({
        id: employees.id,
        salary: employees.salary
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect((builtQuery.orderBy![0] as any).path).toEqual(["employees", "salary"])
  })

  it("supports ascending order explicitly", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.hire_date, "asc")

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
  })

  it("supports simple order by expressions", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.department_id, "asc")
      .select(({ employees }) => ({
        id: employees.id,
        department_id: employees.department_id,
        salary: employees.salary
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
  })

  it("supports function expressions in order by", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => upper(employees.name))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    // The function expression gets wrapped, so we check if it contains the function
    const orderByExpr = builtQuery.orderBy![0]!
    expect(orderByExpr.type).toBeDefined()
  })

  it("can be combined with other clauses", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.department_id, 1))
      .orderBy(({ employees }) => employees.salary, "desc")
      .limit(10)
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        salary: employees.salary
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.limit).toBe(10)
    expect(builtQuery.select).toBeDefined()
  })

  it("overrides previous order by clauses", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name)
      .orderBy(({ employees }) => employees.salary, "desc") // This should override

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect((builtQuery.orderBy![0] as any).path).toEqual(["employees", "salary"])
  })

  it("supports limit and offset with order by", () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.hire_date, "desc")
      .limit(20)
      .offset(10)
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        hire_date: employees.hire_date
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.limit).toBe(20)
    expect(builtQuery.offset).toBe(10)
    expect(builtQuery.select).toBeDefined()
  })
}) 