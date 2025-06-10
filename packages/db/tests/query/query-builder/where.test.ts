import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { SimpleCondition } from "../../../src/query/schema.js"
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
    expect(builtQuery.where).toEqual([[`@id`, `=`, 1]])
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
      const where = builtQuery.where![0]! as SimpleCondition
      expect(where[1]).toBe(op)
    }
  })

  it(`supports passing arrays to set membership operators`, () => {
    const operators = [`in`, `not in`] as const
    for (const op of operators) {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .where(`@id`, op, [1, 2, 3])

      const builtQuery = query._query
      expect(builtQuery.where).toEqual([`@id`, op, [1, 2, 3]])
    }
  })

  it(`allows comparing property references to property references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .where(`@e.department_id`, `=`, `@department.id`)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([
      [`@e.department_id`, `=`, `@department.id`],
    ])
  })

  it(`allows comparing literals to property references`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(10000, `<`, `@salary`)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([[10000, `<`, `@salary`]])
  })

  it(`supports boolean literals`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@active`, `=`, true)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([[`@active`, `=`, true]])
  })

  it(`combines multiple where calls`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@id`, `>`, 10)
      .where(`@salary`, `>=`, 50000)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([
      [`@id`, `>`, 10],
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
      [`@id`, `>`, 10],
      [`@salary`, `>=`, 50000],
      [`@active`, `=`, true],
    ])
  })

  it(`supports passing a complete condition`, () => {
    const condition = [`@id`, `=`, 1] as any

    const query = queryBuilder<TestSchema>().from(`employees`).where(condition)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([condition])
  })

  it(`supports callback functions`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(({ employees }) => employees.salary > 50000)

    const builtQuery = query._query
    expect(typeof builtQuery.where![0]).toBe(`function`)
  })

  it(`combines callback with traditional conditions`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@active`, `=`, true)
      .where(({ employees }) => employees.salary > 50000)
      .where(`@department_id`, `!=`, null)

    const builtQuery = query._query
    expect(builtQuery.where).toHaveLength(3)
    expect(builtQuery.where![0]).toEqual([`@active`, `=`, true])
    expect(typeof builtQuery.where![1]).toBe(`function`)
    expect(builtQuery.where![2]).toEqual([`@department_id`, `!=`, null])
  })

  it(`supports multiple callback functions`, () => {
    const callback1 = ({ employees }: any) => employees.salary > 50000
    const callback2 = ({ employees }: any) => employees.name.startsWith(`J`)

    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(callback1)
      .where(callback2)

    const builtQuery = query._query
    expect(builtQuery.where).toHaveLength(2)
    expect(typeof builtQuery.where![0]).toBe(`function`)
    expect(typeof builtQuery.where![1]).toBe(`function`)
    expect(builtQuery.where![0]).toBe(callback1)
    expect(builtQuery.where![1]).toBe(callback2)
  })

  it(`allows combining with other methods`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .where(`@salary`, `>`, 50000)
      .select(`@id`, `@name`, `@salary`)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([[`@salary`, `>`, 50000]])
    expect(builtQuery.select).toEqual([`@id`, `@name`, `@salary`])
  })
})
