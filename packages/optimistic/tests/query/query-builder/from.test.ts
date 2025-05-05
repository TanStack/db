import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number | null
}

interface Department extends Input {
  id: number
  name: string
  budget: number
}

// Make sure TestSchema extends Schema
interface TestSchema extends Schema {
  employees: Employee
  departments: Department
}

describe(`QueryBuilder.from`, () => {
  it(`sets the from clause correctly`, () => {
    const query = queryBuilder<TestSchema>().from(`employees`)
    const builtQuery = query._query

    expect(builtQuery.from).toBe(`employees`)
    expect(builtQuery.as).toBeUndefined()
  })

  it(`sets the from clause with an alias`, () => {
    const query = queryBuilder<TestSchema>().from(`employees`, `e`)
    const builtQuery = query._query

    expect(builtQuery.from).toBe(`employees`)
    expect(builtQuery.as).toBe(`e`)
  })

  it(`allows chaining other methods after from`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@id`, `=`, 1)
      .select(`@id`, `@name`)

    const builtQuery = query._query

    expect(builtQuery.from).toBe(`employees`)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toHaveLength(2)
  })
})
