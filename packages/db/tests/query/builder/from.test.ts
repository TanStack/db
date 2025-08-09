import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import { eq } from "../../../src/query/builder/functions.js"
import {
  OnlyOneSourceAllowedError,
  QueryMustHaveFromClauseError,
} from "../../../src/errors"

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
    const builder = new Query()
    const query = builder.from({ employees: employeesCollection })
    const builtQuery = getQueryIR(query)

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`collectionRef`)
    expect(builtQuery.from.alias).toBe(`employees`)
    if (builtQuery.from.type === `collectionRef`) {
      expect(builtQuery.from.collection).toBe(employeesCollection)
    }
  })

  it(`allows chaining other methods after from`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.id, 1))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
  })

  it(`supports different collection aliases`, () => {
    const builder = new Query()
    const query = builder.from({ emp: employeesCollection })
    const builtQuery = getQueryIR(query)

    expect(builtQuery.from.alias).toBe(`emp`)
  })

  it(`supports sub-queries in from clause`, () => {
    const subQuery = new Query()
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))

    const builder = new Query()
    const query = builder.from({ activeEmployees: subQuery as any })
    const builtQuery = getQueryIR(query)

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`queryRef`)
    expect(builtQuery.from.alias).toBe(`activeEmployees`)
  })

  it(`throws error when sub-query lacks from clause`, () => {
    const incompleteSubQuery = new Query()
    const builder = new Query()

    expect(() => {
      builder.from({ incomplete: incompleteSubQuery as any })
    }).toThrow(QueryMustHaveFromClauseError)
  })

  it(`throws error with multiple sources`, () => {
    const builder = new Query()

    expect(() => {
      builder.from({
        employees: employeesCollection,
        departments: departmentsCollection,
      } as any)
    }).toThrow(OnlyOneSourceAllowedError)
  })
})
