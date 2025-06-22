import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { BaseQueryBuilder } from "../../../src/query2/builder/index.js"
import { eq } from "../../../src/query2/builder/functions.js"

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
  budget: number
  location: string
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

describe(`QueryBuilder.from`, () => {
  it(`sets the from clause correctly with collection`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder.from({ employees: employeesCollection })
    const builtQuery = query._getQuery()

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`collectionRef`)
    expect(builtQuery.from.alias).toBe(`employees`)
    if (builtQuery.from.type === `collectionRef`) {
      expect(builtQuery.from.collection).toBe(employeesCollection)
    }
  })

  it(`allows chaining other methods after from`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.id, 1))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = query._getQuery()

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
  })

  it(`supports different collection aliases`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder.from({ emp: employeesCollection })
    const builtQuery = query._getQuery()

    expect(builtQuery.from.alias).toBe(`emp`)
  })

  it(`supports sub-queries in from clause`, () => {
    const subQuery = new BaseQueryBuilder()
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))

    const builder = new BaseQueryBuilder()
    const query = builder.from({ activeEmployees: subQuery as any })
    const builtQuery = query._getQuery()

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`queryRef`)
    expect(builtQuery.from.alias).toBe(`activeEmployees`)
  })

  it(`throws error when sub-query lacks from clause`, () => {
    const incompleteSubQuery = new BaseQueryBuilder()
    const builder = new BaseQueryBuilder()

    expect(() => {
      builder.from({ incomplete: incompleteSubQuery as any })
    }).toThrow(`Query must have a from clause`)
  })

  it(`throws error with multiple sources`, () => {
    const builder = new BaseQueryBuilder()

    expect(() => {
      builder.from({
        employees: employeesCollection,
        departments: departmentsCollection,
      } as any)
    }).toThrow(`Only one source is allowed in the from clause`)
  })
})
