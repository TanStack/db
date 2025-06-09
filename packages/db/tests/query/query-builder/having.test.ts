import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { SimpleCondition } from "../../../src/query/schema.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number
  salary: number
  active: boolean
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

describe(`QueryBuilder.having`, () => {
  it(`sets a simple having condition with property reference and literal`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .having(`@salary`, `>`, 50000)

    const builtQuery = query._query
    expect(builtQuery.having).toEqual([[`@salary`, `>`, 50000]])
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
        .having(`@salary`, op as any, 50000)

      const builtQuery = query._query
      expect(builtQuery.having).toBeDefined()
      const having = builtQuery.having![0]! as SimpleCondition
      expect(having[1]).toBe(op)
    }
  })

  it(`allows comparing property references to property references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .having(`@e.salary`, `>`, `@d.budget`)

    const builtQuery = query._query
    expect(builtQuery.having).toEqual([[`@e.salary`, `>`, `@d.budget`]])
  })

  it(`allows comparing literals to property references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .having(50000, `<`, `@salary`)

    const builtQuery = query._query
    expect(builtQuery.having).toEqual([[50000, `<`, `@salary`]])
  })

  it(`combines multiple having calls`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .having(`@salary`, `>`, 50000)
      .having(`@active`, `=`, true)

    const builtQuery = query._query
    expect(builtQuery.having).toEqual([
      [`@salary`, `>`, 50000],
      [`@active`, `=`, true],
    ])
  })

  it(`supports passing a complete condition`, () => {
    const condition = [`@salary`, `>`, 50000] as any

    const query = queryBuilder<TestSchema>().from(`employees`).having(condition)

    const builtQuery = query._query
    expect(builtQuery.having).toEqual([condition])
  })

  it(`works in a practical example with groupBy`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .select(`@d.name`, { avg_salary: { SUM: `@e.salary` } as any })
      .groupBy(`@d.name`)
      .having({ SUM: `@e.salary` } as any, `>`, 100000)

    const builtQuery = query._query
    expect(builtQuery.groupBy).toBe(`@d.name`)
    expect(builtQuery.having).toEqual([[{ SUM: `@e.salary` }, `>`, 100000]])
  })

  it(`allows combining with other query methods`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .where(`@e.active`, `=`, true)
      .groupBy(`@d.name`)
      .having(`@e.salary`, `>`, 50000)
      .select(`@d.name`, { total_salary: { SUM: `@e.salary` } as any })
      .orderBy(`@d.name`)
      .limit(10)

    const builtQuery = query._query
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.groupBy).toBeDefined()
    expect(builtQuery.having).toBeDefined()
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.orderBy).toBeDefined()
    expect(builtQuery.limit).toBeDefined()
  })
})
