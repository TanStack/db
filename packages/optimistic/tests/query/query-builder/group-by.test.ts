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

describe(`QueryBuilder.groupBy`, () => {
  it(`sets a single property reference as groupBy`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@department_id`, { count: { COUNT: `@id` } as any })
      .groupBy(`@department_id`)

    const builtQuery = query.buildQuery()
    expect(builtQuery.groupBy).toBe(`@department_id`)
  })

  it(`sets an array of property references as groupBy`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@department_id`, `@salary`, { count: { COUNT: `@id` } as any })
      .groupBy([`@department_id`, `@salary`])

    const builtQuery = query.buildQuery()
    expect(builtQuery.groupBy).toEqual([`@department_id`, `@salary`])
  })

  it(`overrides previous groupBy values`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@department_id`, `@salary`, { count: { COUNT: `@id` } as any })
      .groupBy(`@department_id`)
      .groupBy(`@salary`) // This should override

    const builtQuery = query.buildQuery()
    expect(builtQuery.groupBy).toBe(`@salary`)
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
      .select(`@d.name`, { avg_salary: { AVG: `@e.salary` } as any })
      .groupBy(`@d.name`)

    const builtQuery = query.buildQuery()
    expect(builtQuery.groupBy).toBe(`@d.name`)
  })

  it(`allows combining with having for filtered aggregations`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .select(`@d.name`, { total_salary: { SUM: `@e.salary` } as any })
      .groupBy(`@d.name`)
      .having({ SUM: `@e.salary` } as any, `>`, 100000)

    const builtQuery = query.buildQuery()
    expect(builtQuery.groupBy).toBe(`@d.name`)
    expect(builtQuery.having).toEqual([{ SUM: `@e.salary` }, `>`, 100000])
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
      .select(`@d.name`, { count: { COUNT: `@e.id` } as any })
      .groupBy(`@d.name`)
      .having({ COUNT: `@e.id` } as any, `>`, 5)
      .orderBy(`@d.name`)
      .limit(10)

    const builtQuery = query.buildQuery()

    // Check groupBy
    expect(builtQuery.groupBy).toBe(`@d.name`)

    // Also verify all other parts of the query are present
    expect(builtQuery.from).toBe(`employees`)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.having).toBeDefined()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.limit).toBe(10)
  })
})
