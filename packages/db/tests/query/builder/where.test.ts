import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  not,
  or,
} from "../../../src/query/builder/functions.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
}

// Test collection
const employeesCollection = new CollectionImpl<Employee>({
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`QueryBuilder.where`, () => {
  it(`sets a simple condition with eq function`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.id, 1))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect(Array.isArray(builtQuery.where)).toBe(true)
    expect(builtQuery.where).toHaveLength(1)
    expect((builtQuery.where as any)[0]?.type).toBe(`func`)
    expect((builtQuery.where as any)[0]?.name).toBe(`eq`)
  })

  it(`supports various comparison operators`, () => {
    const builder = new Query()

    // Test gt
    const gtQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => gt(employees.salary, 50000))
    expect((getQueryIR(gtQuery).where as any)[0]?.name).toBe(`gt`)

    // Test gte
    const gteQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => gte(employees.salary, 50000))
    expect((getQueryIR(gteQuery).where as any)[0]?.name).toBe(`gte`)

    // Test lt
    const ltQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => lt(employees.salary, 100000))
    expect((getQueryIR(ltQuery).where as any)[0]?.name).toBe(`lt`)

    // Test lte
    const lteQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => lte(employees.salary, 100000))
    expect((getQueryIR(lteQuery).where as any)[0]?.name).toBe(`lte`)
  })

  it(`supports boolean operations`, () => {
    const builder = new Query()

    // Test and
    const andQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) =>
        and(eq(employees.active, true), gt(employees.salary, 50000))
      )
    expect((getQueryIR(andQuery).where as any)[0]?.name).toBe(`and`)

    // Test or
    const orQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) =>
        or(eq(employees.department_id, 1), eq(employees.department_id, 2))
      )
    expect((getQueryIR(orQuery).where as any)[0]?.name).toBe(`or`)

    // Test not
    const notQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => not(eq(employees.active, false)))
    expect((getQueryIR(notQuery).where as any)[0]?.name).toBe(`not`)
  })

  it(`supports string operations`, () => {
    const builder = new Query()

    // Test like
    const likeQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => like(employees.name, `%John%`))
    expect((getQueryIR(likeQuery).where as any)[0]?.name).toBe(`like`)
  })

  it(`supports in operator`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => inArray(employees.department_id, [1, 2, 3]))

    expect((getQueryIR(query).where as any)[0]?.name).toBe(`in`)
  })

  it(`supports boolean literals`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect((builtQuery.where as any)[0]?.name).toBe(`eq`)
  })

  it(`supports null comparisons`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.department_id, null))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
  })

  it(`creates complex nested conditions`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) =>
        and(
          eq(employees.active, true),
          or(gt(employees.salary, 75000), eq(employees.department_id, 1))
        )
      )

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect((builtQuery.where as any)[0]?.name).toBe(`and`)
  })

  it(`allows combining where with other methods`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => gt(employees.salary, 50000))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        salary: employees.salary,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
  })

  it(`accumulates multiple where clauses (ANDed together)`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))
      .where(({ employees }) => gt(employees.salary, 50000)) // This should be ANDed

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect(Array.isArray(builtQuery.where)).toBe(true)
    expect(builtQuery.where).toHaveLength(2)
    expect((builtQuery.where as any)[0]?.name).toBe(`eq`)
    expect((builtQuery.where as any)[1]?.name).toBe(`gt`)
  })
})
