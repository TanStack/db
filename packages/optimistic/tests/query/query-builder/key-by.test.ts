import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number
  salary: number
}

interface Department extends Input {
  id: number
  name: string
  budget: number
  location: string
}

// Make sure TestSchema extends Schema
interface TestSchema extends Schema {
  employees: Employee
  departments: Department
}

describe(`QueryBuilder.keyBy`, () => {
  it(`sets a single property reference as keyBy`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, `@name`)
      .keyBy(`@id`)

    const builtQuery = query._query
    expect(builtQuery.keyBy).toBe(`@id`)
  })

  it(`sets an array of property references as keyBy`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, `@name`, `@department_id`)
      .keyBy([`@id`, `@department_id`])

    const builtQuery = query._query
    expect(builtQuery.keyBy).toEqual([`@id`, `@department_id`])
  })

  it(`overrides previous keyBy values`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, `@name`, `@department_id`)
      .keyBy(`@id`)
      .keyBy(`@department_id`) // This should override

    const builtQuery = query._query
    expect(builtQuery.keyBy).toBe(`@department_id`)
  })

  it(`works with joined tables`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .select(`@e.id`, `@e.name`, `@d.name`)
      .keyBy(`@d.id`)

    const builtQuery = query._query
    expect(builtQuery.keyBy).toBe(`@d.id`)
  })

  it(`can be combined with other query methods`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .where(`@e.salary`, `>`, 50000)
      .select(`@e.id`, `@e.name`, `@d.name`)
      .orderBy(`@e.salary`)
      .limit(10)
      .offset(5)
      .keyBy(`@e.id`)

    const builtQuery = query._query

    // Check keyBy
    expect(builtQuery.keyBy).toBe(`@e.id`)

    // Also verify all other parts of the query are present
    expect(builtQuery.from).toBe(`employees`)
    expect(builtQuery.as).toBe(`e`)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toHaveLength(4)
    expect(builtQuery.select).toEqual([
      `@e.id`,
      `@e.name`,
      `@d.name`,
      { _orderByIndex: { ORDER_INDEX: `numeric` } }, // Added by the orderBy method
    ])
    expect(builtQuery.orderBy).toBe(`@e.salary`)
    expect(builtQuery.limit).toBe(10)
    expect(builtQuery.offset).toBe(5)
  })
})
