import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import { avg, count, eq, sum } from "../../../src/query/builder/functions.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number
  salary: number
  active: boolean
}

// Test collection
const employeesCollection = new CollectionImpl<Employee>({
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`QueryBuilder.groupBy`, () => {
  it(`sets the group by clause correctly`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => employees.department_id)
      .select(({ employees }) => ({
        department_id: employees.department_id,
        count: count(employees.id),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.groupBy).toHaveLength(1)
    expect(builtQuery.groupBy![0]!.type).toBe(`ref`)
  })

  it(`supports multiple group by expressions`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => [employees.department_id, employees.active])
      .select(({ employees }) => ({
        department_id: employees.department_id,
        active: employees.active,
        count: count(employees.id),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.groupBy).toHaveLength(2)
    expect(builtQuery.groupBy![0]!.type).toBe(`ref`)
    expect(builtQuery.groupBy![1]!.type).toBe(`ref`)
  })

  it(`works with aggregate functions in select`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => employees.department_id)
      .select(({ employees }) => ({
        department_id: employees.department_id,
        total_employees: count(employees.id),
        avg_salary: avg(employees.salary),
        total_salary: sum(employees.salary),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.select).toBeDefined()

    const select = builtQuery.select!
    expect(select).toHaveProperty(`total_employees`)
    expect(select).toHaveProperty(`avg_salary`)
    expect(select).toHaveProperty(`total_salary`)
  })

  it(`can be combined with where clause`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))
      .groupBy(({ employees }) => employees.department_id)
      .select(({ employees }) => ({
        department_id: employees.department_id,
        active_count: count(employees.id),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.select).toBeDefined()
  })

  it(`can be combined with having clause`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => employees.department_id)
      .having(({ employees }) => eq(employees.department_id, 1))
      .select(({ employees }) => ({
        department_id: employees.department_id,
        count: count(employees.id),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.having).toBeDefined()
    expect(builtQuery.select).toBeDefined()
  })

  it(`overrides previous group by clauses`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => employees.department_id)
      .groupBy(({ employees }) => employees.active) // This should override
      .select(({ employees }) => ({
        active: employees.active,
        count: count(employees.id),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.groupBy).toHaveLength(1)
    expect((builtQuery.groupBy![0] as any).path).toEqual([
      `employees`,
      `active`,
    ])
  })

  it(`supports complex expressions in group by`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => [employees.department_id, employees.active])
      .select(({ employees }) => ({
        department_id: employees.department_id,
        active: employees.active,
        count: count(employees.id),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.groupBy).toHaveLength(2)
  })
})
