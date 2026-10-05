import { describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import { compileSQLite } from '../src/sqlite-compiler'

const val = <T>(value: T) => new IR.Value(value)
// Helper to create expression nodes
const ref = (path: Array<string>) => new IR.PropRef(path)
const func = <T = unknown>(name: string, args: Array<IR.BasicExpression>) =>
  new IR.Func<T>(name, args)

describe(`SQLite Compiler`, () => {
  describe(`where clause compilation`, () => {
    it(`should compile eq operator`, () => {
      const result = compileSQLite({
        where: func(`eq`, [ref([`name`]), val(`test`)]),
      })

      expect(result.where).toBe(`"name" = ?`)
      expect(result.params).toEqual([`test`])
    })

    it(`should compile gt operator`, () => {
      const result = compileSQLite({
        where: func(`gt`, [ref([`price`]), val(100)]),
      })

      expect(result.where).toBe(`"price" > ?`)
      expect(result.params).toEqual([100])
    })

    it(`should compile gte operator`, () => {
      const result = compileSQLite({
        where: func(`gte`, [ref([`price`]), val(100)]),
      })

      expect(result.where).toBe(`"price" >= ?`)
      expect(result.params).toEqual([100])
    })

    it(`should compile lt operator`, () => {
      const result = compileSQLite({
        where: func(`lt`, [ref([`price`]), val(100)]),
      })

      expect(result.where).toBe(`"price" < ?`)
      expect(result.params).toEqual([100])
    })

    it(`should compile lte operator`, () => {
      const result = compileSQLite({
        where: func(`lte`, [ref([`price`]), val(100)]),
      })

      expect(result.where).toBe(`"price" <= ?`)
      expect(result.params).toEqual([100])
    })

    it(`should compile and operator with two conditions`, () => {
      const result = compileSQLite({
        where: func(`and`, [
          func(`gt`, [ref([`price`]), val(50)]),
          func(`lt`, [ref([`price`]), val(100)]),
        ]),
      })

      expect(result.where).toBe(`("price" > ?) AND ("price" < ?)`)
      expect(result.params).toEqual([50, 100])
    })

    it(`should compile and operator with multiple conditions`, () => {
      const result = compileSQLite({
        where: func(`and`, [
          func(`eq`, [ref([`status`]), val(`active`)]),
          func(`gt`, [ref([`price`]), val(50)]),
          func(`lt`, [ref([`price`]), val(100)]),
        ]),
      })

      expect(result.where).toBe(
        `("status" = ?) AND ("price" > ?) AND ("price" < ?)`,
      )
      expect(result.params).toEqual([`active`, 50, 100])
    })

    it(`should compile or operator`, () => {
      const result = compileSQLite({
        where: func(`or`, [
          func(`eq`, [ref([`status`]), val(`active`)]),
          func(`eq`, [ref([`status`]), val(`pending`)]),
        ]),
      })

      expect(result.where).toBe(`("status" = ?) OR ("status" = ?)`)
      expect(result.params).toEqual([`active`, `pending`])
    })

    it(`should compile isNull operator`, () => {
      const result = compileSQLite({
        where: func(`isNull`, [ref([`deleted_at`])]),
      })

      expect(result.where).toBe(`"deleted_at" IS NULL`)
      expect(result.params).toEqual([])
    })

    it(`should compile not(isNull) as IS NOT NULL`, () => {
      const result = compileSQLite({
        where: func(`not`, [func(`isNull`, [ref([`deleted_at`])])]),
      })

      expect(result.where).toBe(`"deleted_at" IS NOT NULL`)
      expect(result.params).toEqual([])
    })

    it(`should compile like operator`, () => {
      const result = compileSQLite({
        where: func(`like`, [ref([`name`]), val(`%test%`)]),
      })

      expect(result.where).toBe(`"name" LIKE ?`)
      expect(result.params).toEqual([`%test%`])
    })

    it(`should escape quotes in column names`, () => {
      const result = compileSQLite({
        where: func(`eq`, [ref([`col"name`]), val(`test`)]),
      })

      expect(result.where).toBe(`"col""name" = ?`)
    })

    it(`should throw error for null values in comparison operators`, () => {
      expect(() =>
        compileSQLite({
          where: func(`eq`, [ref([`name`]), val(null)]),
        }),
      ).toThrow(`Cannot use null/undefined with 'eq' operator`)
    })

    it(`should compile ilike operator`, () => {
      const result = compileSQLite({
        where: func(`ilike`, [ref([`name`]), val(`%test%`)]),
      })

      expect(result.where).toBe(`"name" LIKE ? COLLATE NOCASE`)
      expect(result.params).toEqual([`%test%`])
    })

    it(`should compile upper function`, () => {
      const result = compileSQLite({
        where: func(`eq`, [func(`upper`, [ref([`name`])]), val(`TEST`)]),
      })

      expect(result.where).toBe(`UPPER("name") = ?`)
      expect(result.params).toEqual([`TEST`])
    })

    it(`should compile lower function`, () => {
      const result = compileSQLite({
        where: func(`eq`, [func(`lower`, [ref([`name`])]), val(`test`)]),
      })

      expect(result.where).toBe(`LOWER("name") = ?`)
      expect(result.params).toEqual([`test`])
    })

    it(`should compile coalesce function`, () => {
      const result = compileSQLite({
        where: func(`eq`, [
          func(`coalesce`, [ref([`name`]), val(`default`)]),
          val(`test`),
        ]),
      })

      expect(result.where).toBe(`COALESCE("name", ?) = ?`)
      expect(result.params).toEqual([`default`, `test`])
    })

    it(`should compile length function`, () => {
      const result = compileSQLite({
        where: func(`gt`, [func(`length`, [ref([`name`])]), val(5)]),
      })

      expect(result.where).toBe(`LENGTH("name") > ?`)
      expect(result.params).toEqual([5])
    })

    it(`should compile concat function with multiple args`, () => {
      const result = compileSQLite({
        where: func(`eq`, [
          func(`concat`, [ref([`first_name`]), val(` `), ref([`last_name`])]),
          val(`John Doe`),
        ]),
      })

      expect(result.where).toBe(`CONCAT("first_name", ?, "last_name") = ?`)
      expect(result.params).toEqual([` `, `John Doe`])
    })

    it(`should compile add operator`, () => {
      const result = compileSQLite({
        where: func(`gt`, [func(`add`, [ref([`price`]), val(10)]), val(100)]),
      })

      expect(result.where).toBe(`"price" + ? > ?`)
      expect(result.params).toEqual([10, 100])
    })

    it(`should throw for length with wrong arg count`, () => {
      expect(() =>
        compileSQLite({ where: func(`length`, [ref([`a`]), ref([`b`])]) }),
      ).toThrow(`length expects 1 argument`)
    })

    it(`should throw for add with wrong arg count`, () => {
      expect(() =>
        compileSQLite({ where: func(`add`, [ref([`price`])]) }),
      ).toThrow(`add expects 2 arguments`)
    })

    it(`should throw error for unsupported operators`, () => {
      expect(() =>
        compileSQLite({
          where: func(`unsupported_op`, [ref([`name`]), val(`%test%`)]),
        }),
      ).toThrow(`Operator 'unsupported_op' is not supported`)
    })
  })

  describe(`orderBy compilation`, () => {
    it(`should compile simple orderBy`, () => {
      const result = compileSQLite({
        orderBy: [
          {
            expression: ref([`price`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
        ],
      })

      expect(result.orderBy).toBe(`"price" NULLS LAST`)
      expect(result.params).toEqual([])
    })

    it(`should compile orderBy with desc direction`, () => {
      const result = compileSQLite({
        orderBy: [
          {
            expression: ref([`price`]),
            compareOptions: { direction: `desc`, nulls: `last` },
          },
        ],
      })

      expect(result.orderBy).toBe(`"price" DESC NULLS LAST`)
    })

    it(`should compile orderBy with nulls first`, () => {
      const result = compileSQLite({
        orderBy: [
          {
            expression: ref([`price`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
      })

      expect(result.orderBy).toBe(`"price" NULLS FIRST`)
    })

    it(`should compile multiple orderBy clauses`, () => {
      const result = compileSQLite({
        orderBy: [
          {
            expression: ref([`category`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
          {
            expression: ref([`price`]),
            compareOptions: { direction: `desc`, nulls: `last` },
          },
        ],
      })

      expect(result.orderBy).toBe(
        `"category" NULLS LAST, "price" DESC NULLS LAST`,
      )
    })
  })

  describe(`limit`, () => {
    it(`should pass through limit`, () => {
      const result = compileSQLite({
        limit: 50,
      })

      expect(result.limit).toBe(50)
    })
  })

  describe(`combined options`, () => {
    it(`should compile where, orderBy, and limit together`, () => {
      const result = compileSQLite({
        where: func(`gt`, [ref([`price`]), val(100)]),
        orderBy: [
          {
            expression: ref([`price`]),
            compareOptions: { direction: `desc`, nulls: `last` },
          },
        ],
        limit: 10,
      })

      expect(result.where).toBe(`"price" > ?`)
      expect(result.orderBy).toBe(`"price" DESC NULLS LAST`)
      expect(result.limit).toBe(10)
      expect(result.params).toEqual([100])
    })

    it(`should handle empty options`, () => {
      const result = compileSQLite({})

      expect(result.where).toBeUndefined()
      expect(result.orderBy).toBeUndefined()
      expect(result.limit).toBeUndefined()
      expect(result.params).toEqual([])
    })
  })
})
