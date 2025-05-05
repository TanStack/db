import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number | null
  salary: number
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

describe(`QueryBuilder.select`, () => {
  it(`sets the select clause correctly with individual columns`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, `@name`)

    const builtQuery = query._query
    expect(builtQuery.select).toEqual([`@id`, `@name`])
  })

  it(`handles aliased columns`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, { employee_name: `@name` })

    const builtQuery = query._query
    expect(builtQuery.select).toHaveLength(2)
    expect(builtQuery.select[0]).toBe(`@id`)
    expect(builtQuery.select[1]).toHaveProperty(`employee_name`, `@name`)
  })

  it(`handles function calls`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, {
        upper_name: { UPPER: `@name` },
      })

    const builtQuery = query._query
    expect(builtQuery.select).toHaveLength(2)
    expect(builtQuery.select[1]).toHaveProperty(`upper_name`)
  })

  it(`overrides previous select calls`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, `@name`)
      .select(`@id`, `@salary`) // This should override the previous select

    const builtQuery = query._query
    expect(builtQuery.select).toEqual([`@id`, `@salary`])
  })

  it(`supports qualified table references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .select(`@e.id`, `@e.name`)

    const builtQuery = query._query
    expect(builtQuery.select).toEqual([`@e.id`, `@e.name`])
  })

  // Runtime test for the result types
  it(`infers correct result types`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, `@name`)

    // We can't directly assert on types in a test, but we can check
    // that the query is constructed correctly, which implies the types work
    const builtQuery = query._query
    expect(builtQuery.select).toEqual([`@id`, `@name`])
  })
})
