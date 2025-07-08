import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import { eq, upper } from "../../../src/query/builder/functions.js"

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
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`QueryBuilder.orderBy`, () => {
  it(`sets the order by clause correctly with default ascending`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name)
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect(builtQuery.orderBy![0]!.expression.type).toBe(`ref`)
    expect((builtQuery.orderBy![0]!.expression as any).path).toEqual([
      `employees`,
      `name`,
    ])
    expect(builtQuery.orderBy![0]!.direction).toBe(`asc`)
  })

  it(`supports descending order`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.salary, `desc`)
      .select(({ employees }) => ({
        id: employees.id,
        salary: employees.salary,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect((builtQuery.orderBy![0]!.expression as any).path).toEqual([
      `employees`,
      `salary`,
    ])
    expect(builtQuery.orderBy![0]!.direction).toBe(`desc`)
  })

  it(`supports ascending order explicitly`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.hire_date, `asc`)

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
  })

  it(`supports simple order by expressions`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.department_id, `asc`)
      .select(({ employees }) => ({
        id: employees.id,
        department_id: employees.department_id,
        salary: employees.salary,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
  })

  it(`supports function expressions in order by`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => upper(employees.name))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    // The function expression gets wrapped, so we check if it contains the function
    const orderByClause = builtQuery.orderBy![0]!
    expect(orderByClause.expression.type).toBeDefined()
    expect(orderByClause.direction).toBe(`asc`)
  })

  it(`can be combined with other clauses`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.department_id, 1))
      .orderBy(({ employees }) => employees.salary, `desc`)
      .limit(10)
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        salary: employees.salary,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.limit).toBe(10)
    expect(builtQuery.select).toBeDefined()
  })

  it(`supports multiple order by clauses`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name)
      .orderBy(({ employees }) => employees.salary, `desc`) // This should be added

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(2)
    expect((builtQuery.orderBy![0]!.expression as any).path).toEqual([
      `employees`,
      `name`,
    ])
    expect(builtQuery.orderBy![0]!.direction).toBe(`asc`)
    expect((builtQuery.orderBy![1]!.expression as any).path).toEqual([
      `employees`,
      `salary`,
    ])
    expect(builtQuery.orderBy![1]!.direction).toBe(`desc`)
  })

  it(`supports limit and offset with order by`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.hire_date, `desc`)
      .limit(20)
      .offset(10)
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        hire_date: employees.hire_date,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.limit).toBe(20)
    expect(builtQuery.offset).toBe(10)
    expect(builtQuery.select).toBeDefined()
  })
})
