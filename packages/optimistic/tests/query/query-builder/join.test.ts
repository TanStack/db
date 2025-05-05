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

describe(`QueryBuilder.join`, () => {
  it(`adds a simple inner join`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })

    const builtQuery = query._query
    expect(builtQuery.join).toBeDefined()
    const join = builtQuery.join!
    expect(join).toHaveLength(1)
    expect(join[0]).toMatchObject({
      type: `inner`,
      from: `departments`,
      as: `d`,
      on: [`@e.department_id`, `=`, `@d.id`],
    })
  })

  it(`supports all join types`, () => {
    const joinTypes = [`inner`, `left`, `right`, `full`, `cross`] as const

    for (const type of joinTypes) {
      const query = queryBuilder<TestSchema>()
        .from(`employees`, `e`)
        .join({
          type,
          from: `departments`,
          as: `d`,
          on: [`@e.department_id`, `=`, `@d.id`],
        })

      const builtQuery = query._query
      expect(builtQuery.join).toBeDefined()
      expect(builtQuery.join![0]!.type).toBe(type)
    }
  })

  it(`supports multiple joins`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d1`,
        on: [`@e.department_id`, `=`, `@d1.id`],
      })
      .join({
        type: `left`,
        from: `departments`,
        as: `d2`,
        on: [`@e.department_id`, `=`, `@d2.id`],
      })

    const builtQuery = query._query
    expect(builtQuery.join).toBeDefined()
    const join = builtQuery.join!
    expect(join).toHaveLength(2)
    expect(join[0]!.type).toBe(`inner`)
    expect(join[0]!.as).toBe(`d1`)
    expect(join[1]!.type).toBe(`left`)
    expect(join[1]!.as).toBe(`d2`)
  })

  it(`allows join with a where condition`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
        where: [`@d.budget`, `>`, 1000000],
      })

    const builtQuery = query._query
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join![0]!.where).toEqual([`@d.budget`, `>`, 1000000])
  })

  it(`allows accessing joined table in select`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .select(`@e.id`, `@e.name`, `@d.name`, `@d.budget`)

    const builtQuery = query._query
    expect(builtQuery.select).toEqual([
      `@e.id`,
      `@e.name`,
      `@d.name`,
      `@d.budget`,
    ])
  })

  it(`allows accessing joined table in where`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .where(`@d.budget`, `>`, 1000000)

    const builtQuery = query._query
    expect(builtQuery.where).toEqual([`@d.budget`, `>`, 1000000])
  })

  it(`creates a complex query with multiple joins, select and where`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .where(`@e.salary`, `>`, 50000)
      .where(`@d.budget`, `>`, 1000000)
      .select(`@e.id`, `@e.name`, `@d.name`, {
        dept_location: `@d.location`,
      })

    const builtQuery = query._query
    expect(builtQuery.from).toBe(`employees`)
    expect(builtQuery.as).toBe(`e`)
    expect(builtQuery.join).toBeDefined()
    const join = builtQuery.join!
    expect(join).toHaveLength(1)
    expect(join[0]!.type).toBe(`inner`)
    expect(join[0]!.from).toBe(`departments`)
    expect(join[0]!.as).toBe(`d`)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toHaveLength(4)
  })
})
