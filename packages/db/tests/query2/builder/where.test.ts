import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { BaseQueryBuilder } from "../../../src/query2/builder/index.js"
import {
  and,
  eq,
  gt,
  gte,
  isIn,
  like,
  lt,
  lte,
  not,
  or,
} from "../../../src/query2/builder/functions.js"

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
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.id, 1))

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.where?.type).toBe(`func`)
    expect((builtQuery.where as any)?.name).toBe(`eq`)
  })

  it(`supports various comparison operators`, () => {
    const builder = new BaseQueryBuilder()

    // Test gt
    const gtQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => gt(employees.salary, 50000))
    expect((gtQuery._getQuery().where as any)?.name).toBe(`gt`)

    // Test gte
    const gteQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => gte(employees.salary, 50000))
    expect((gteQuery._getQuery().where as any)?.name).toBe(`gte`)

    // Test lt
    const ltQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => lt(employees.salary, 100000))
    expect((ltQuery._getQuery().where as any)?.name).toBe(`lt`)

    // Test lte
    const lteQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => lte(employees.salary, 100000))
    expect((lteQuery._getQuery().where as any)?.name).toBe(`lte`)
  })

  it(`supports boolean operations`, () => {
    const builder = new BaseQueryBuilder()

    // Test and
    const andQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) =>
        and(eq(employees.active, true), gt(employees.salary, 50000))
      )
    expect((andQuery._getQuery().where as any)?.name).toBe(`and`)

    // Test or
    const orQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) =>
        or(eq(employees.department_id, 1), eq(employees.department_id, 2))
      )
    expect((orQuery._getQuery().where as any)?.name).toBe(`or`)

    // Test not
    const notQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => not(eq(employees.active, false)))
    expect((notQuery._getQuery().where as any)?.name).toBe(`not`)
  })

  it(`supports string operations`, () => {
    const builder = new BaseQueryBuilder()

    // Test like
    const likeQuery = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => like(employees.name, `%John%`))
    expect((likeQuery._getQuery().where as any)?.name).toBe(`like`)
  })

  it(`supports in operator`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => isIn(employees.department_id, [1, 2, 3]))

    expect((query._getQuery().where as any)?.name).toBe(`in`)
  })

  it(`supports boolean literals`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
    expect((builtQuery.where as any)?.name).toBe(`eq`)
  })

  it(`supports null comparisons`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.department_id, null))

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
  })

  it(`creates complex nested conditions`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) =>
        and(
          eq(employees.active, true),
          or(gt(employees.salary, 75000), eq(employees.department_id, 1))
        )
      )

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
    expect((builtQuery.where as any)?.name).toBe(`and`)
  })

  it(`allows combining where with other methods`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => gt(employees.salary, 50000))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        salary: employees.salary,
      }))

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
  })

  it(`overrides previous where clauses`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))
      .where(({ employees }) => gt(employees.salary, 50000)) // This should override

    const builtQuery = query._getQuery()
    expect(builtQuery.where).toBeDefined()
    expect((builtQuery.where as any)?.name).toBe(`gt`)
  })
})
