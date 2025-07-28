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
  it(`sets the order by clause correctly with default options`, () => {
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
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`asc`)
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`locale`)
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
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`desc`)
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`locale`)
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

  it(`supports nulls first/last`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.hire_date, {
        direction: `asc`,
        nulls: `last`,
      })
      .select(({ employees }) => ({
        id: employees.id,
        hire_date: employees.hire_date,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`asc`)
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`last`)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`locale`)
  })

  it(`supports stringSort`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name, {
        direction: `asc`,
        stringSort: `lexical`,
      })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`lexical`)
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`asc`)
  })

  it(`supports locale`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name, {
        direction: `asc`,
        stringSort: `locale`,
        locale: `de-DE`,
      })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`locale`)
    expect(builtQuery.orderBy![0]!.compareOptions.locale).toBe(`de-DE`)
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`asc`)
  })

  it(`supports locale options`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .orderBy(({ employees }) => employees.name, {
        direction: `asc`,
        stringSort: `locale`,
        locale: `de-DE`,
        localeOptions: { sensitivity: `base` },
      })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.orderBy).toHaveLength(1)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`locale`)
    expect(builtQuery.orderBy![0]!.compareOptions.locale).toBe(`de-DE`)
    expect(builtQuery.orderBy![0]!.compareOptions.localeOptions).toEqual({
      sensitivity: `base`,
    })
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`asc`)
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
    expect(orderByClause.compareOptions.direction).toBe(`asc`)
    expect(orderByClause.compareOptions.nulls).toBe(`first`)
    expect(orderByClause.compareOptions.stringSort).toBe(`locale`)
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
    expect(builtQuery.orderBy![0]!.compareOptions.direction).toBe(`asc`)
    expect(builtQuery.orderBy![0]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![0]!.compareOptions.stringSort).toBe(`locale`)
    expect((builtQuery.orderBy![1]!.expression as any).path).toEqual([
      `employees`,
      `salary`,
    ])
    expect(builtQuery.orderBy![1]!.compareOptions.direction).toBe(`desc`)
    expect(builtQuery.orderBy![1]!.compareOptions.nulls).toBe(`first`)
    expect(builtQuery.orderBy![1]!.compareOptions.stringSort).toBe(`locale`)
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
