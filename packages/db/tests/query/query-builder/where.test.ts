import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
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

describe(`QueryBuilder.where`, () => {
  it(`sets a simple condition with property reference and literal`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@id`, `=`, 1)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([`@id`, `=`, 1])
  })

  it(`supports various comparison operators`, () => {
    const operators = [
      `=`,
      `!=`,
      `<`,
      `<=`,
      `>`,
      `>=`,
      `like`,
      `in`,
      `is`,
      `is not`,
    ] as const

    for (const op of operators) {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .where(`@id`, op as any, 1)

      const builtQuery = query._query
      expect(builtQuery.where).toBeDefined()
      // Type assertion since we know where is defined based on our query
      const where = builtQuery.where!
      expect(where[1]).toBe(op)
    }
  })

  it(`allows comparing property references to property references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .where(`@e.department_id`, `=`, `@department.id`)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([
      `@e.department_id`,
      `=`,
      `@department.id`,
    ])
  })

  it(`allows comparing literals to property references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(10000, `<`, `@salary`)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([10000, `<`, `@salary`])
  })

  it(`supports boolean literals`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@active`, `=`, true)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([`@active`, `=`, true])
  })

  it(`combines multiple where calls with AND`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@id`, `>`, 10)
      .where(`@salary`, `>=`, 50000)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([
      [`@id`, `>`, 10],
      `and`,
      [`@salary`, `>=`, 50000],
    ])
  })

  it(`handles multiple chained where clauses`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@id`, `>`, 10)
      .where(`@salary`, `>=`, 50000)
      .where(`@active`, `=`, true)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([
      [[`@id`, `>`, 10], `and`, [`@salary`, `>=`, 50000]],
      `and`,
      [`@active`, `=`, true],
    ])
  })

  it(`supports passing a complete condition`, () => {
    const condition = [`@id`, `=`, 1] as any

    const query = queryBuilder<TestSchema>().from(`employees`).where(condition)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual(condition)
  })

  it(`allows combining with other methods`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@salary`, `>`, 50000)
      .select(`@id`, `@name`, `@salary`)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([`@salary`, `>`, 50000])
    expect(builtQuery.select).toEqual([`@id`, `@name`, `@salary`])
  })
})
