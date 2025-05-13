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

describe(`QueryBuilder orderBy, limit, and offset`, () => {
  describe(`orderBy`, () => {
    it(`sets a simple string order`, () => {
      const query = queryBuilder<TestSchema>().from(`employees`).orderBy(`@id`)

      const builtQuery = query._query
      expect(builtQuery.orderBy).toBe(`@id`)
    })

    it(`sets an object with direction`, () => {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .orderBy({ "@id": `desc` })

      const builtQuery = query._query
      expect(builtQuery.orderBy).toEqual({ "@id": `desc` })
    })

    it(`sets an array of orders`, () => {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .orderBy([`@id`, { "@name": `asc` }])

      const builtQuery = query._query
      expect(builtQuery.orderBy).toEqual([`@id`, { "@name": `asc` }])
    })

    it(`overrides previous orderBy values`, () => {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .orderBy(`@id`)
        .orderBy(`@name`) // This should override

      const builtQuery = query._query
      expect(builtQuery.orderBy).toBe(`@name`)
    })
  })

  describe(`limit`, () => {
    it(`sets a limit on the query`, () => {
      const query = queryBuilder<TestSchema>().from(`employees`).limit(10)

      const builtQuery = query._query
      expect(builtQuery.limit).toBe(10)
    })

    it(`overrides previous limit values`, () => {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .limit(10)
        .limit(20) // This should override

      const builtQuery = query._query
      expect(builtQuery.limit).toBe(20)
    })
  })

  describe(`offset`, () => {
    it(`sets an offset on the query`, () => {
      const query = queryBuilder<TestSchema>().from(`employees`).offset(5)

      const builtQuery = query._query
      expect(builtQuery.offset).toBe(5)
    })

    it(`overrides previous offset values`, () => {
      const query = queryBuilder<TestSchema>()
        .from(`employees`)
        .offset(5)
        .offset(15) // This should override

      const builtQuery = query._query
      expect(builtQuery.offset).toBe(15)
    })
  })

  describe(`combined methods`, () => {
    it(`builds a complex query with orderBy, limit, and offset`, () => {
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
        .orderBy([`@e.salary`, { "@d.name": `asc` }])
        .limit(10)
        .offset(5)

      const builtQuery = query._query
      expect(builtQuery.orderBy).toEqual([`@e.salary`, { "@d.name": `asc` }])
      expect(builtQuery.limit).toBe(10)
      expect(builtQuery.offset).toBe(5)

      // Also verify all other parts of the query are present
      expect(builtQuery.from).toBe(`employees`)
      expect(builtQuery.as).toBe(`e`)
      expect(builtQuery.join).toBeDefined()
      expect(builtQuery.where).toBeDefined()
      expect(builtQuery.select).toEqual([
        `@e.id`,
        `@e.name`,
        `@d.name`,
        { _orderByIndex: { ORDER_INDEX: `numeric` } }, // Added by the orderBy method
      ])
    })
  })
})
