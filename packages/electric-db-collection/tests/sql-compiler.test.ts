import { describe, expect, it } from 'vitest'
import { compileSQL } from '../src/sql-compiler'
import type { IR } from '@tanstack/db'

// Helper to create a value expression
function val<T>(value: T): IR.BasicExpression<T> {
  return { type: `val`, value } as IR.BasicExpression<T>
}

// Helper to create a reference expression
function ref(...path: Array<string>): IR.BasicExpression {
  return { type: `ref`, path } as IR.BasicExpression
}

// Helper to create a function expression

function func(name: string, args: Array<any>): IR.BasicExpression<boolean> {
  return { type: `func`, name, args } as IR.BasicExpression<boolean>
}

describe(`sql-compiler`, () => {
  describe(`compileSQL`, () => {
    describe(`basic where clauses`, () => {
      it(`should compile eq with string value`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`name`), val(`John`)]),
        })
        expect(result.where).toBe(`"name" = $1`)
        expect(result.params).toEqual({ '1': `John` })
      })

      it(`should compile eq with number value`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`age`), val(25)]),
        })
        expect(result.where).toBe(`"age" = $1`)
        expect(result.params).toEqual({ '1': `25` })
      })

      it(`should compile gt operator`, () => {
        const result = compileSQL({
          where: func(`gt`, [ref(`age`), val(18)]),
        })
        expect(result.where).toBe(`"age" > $1`)
        expect(result.params).toEqual({ '1': `18` })
      })

      it(`should compile lt operator`, () => {
        const result = compileSQL({
          where: func(`lt`, [ref(`price`), val(100)]),
        })
        expect(result.where).toBe(`"price" < $1`)
        expect(result.params).toEqual({ '1': `100` })
      })

      it(`should compile gte operator`, () => {
        const result = compileSQL({
          where: func(`gte`, [ref(`quantity`), val(10)]),
        })
        expect(result.where).toBe(`"quantity" >= $1`)
        expect(result.params).toEqual({ '1': `10` })
      })

      it(`should compile lte operator`, () => {
        const result = compileSQL({
          where: func(`lte`, [ref(`rating`), val(5)]),
        })
        expect(result.where).toBe(`"rating" <= $1`)
        expect(result.params).toEqual({ '1': `5` })
      })
    })

    describe(`compound where clauses`, () => {
      it(`should compile AND with two conditions`, () => {
        const result = compileSQL({
          where: func(`and`, [
            func(`eq`, [ref(`projectId`), val(`uuid-123`)]),
            func(`gt`, [ref(`name`), val(`cursor-value`)]),
          ]),
        })
        // Note: 2-arg AND doesn't add parentheses around the operands
        expect(result.where).toBe(`"projectId" = $1 AND "name" > $2`)
        expect(result.params).toEqual({ '1': `uuid-123`, '2': `cursor-value` })
      })

      it(`should compile AND with more than two conditions`, () => {
        const result = compileSQL({
          where: func(`and`, [
            func(`eq`, [ref(`a`), val(`1`)]),
            func(`eq`, [ref(`b`), val(`2`)]),
            func(`eq`, [ref(`c`), val(`3`)]),
          ]),
        })
        // >2 args adds parentheses
        expect(result.where).toBe(`("a" = $1) AND ("b" = $2) AND ("c" = $3)`)
        expect(result.params).toEqual({ '1': `1`, '2': `2`, '3': `3` })
      })

      it(`should compile OR with two conditions`, () => {
        const result = compileSQL({
          where: func(`or`, [
            func(`eq`, [ref(`status`), val(`active`)]),
            func(`eq`, [ref(`status`), val(`pending`)]),
          ]),
        })
        expect(result.where).toBe(`"status" = $1 OR "status" = $2`)
        expect(result.params).toEqual({ '1': `active`, '2': `pending` })
      })
    })

    describe(`null/undefined value handling`, () => {
      it(`should throw error for eq(col, null)`, () => {
        // Users should use isNull() instead of eq(col, null)
        expect(() =>
          compileSQL({
            where: func(`eq`, [ref(`deletedAt`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should throw error for eq(col, undefined)`, () => {
        expect(() =>
          compileSQL({
            where: func(`eq`, [ref(`deletedAt`), val(undefined)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should throw error for eq(null, col) (reversed order)`, () => {
        expect(() =>
          compileSQL({
            where: func(`eq`, [val(null), ref(`name`)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should throw error for gt with null value`, () => {
        expect(() =>
          compileSQL({
            where: func(`gt`, [ref(`age`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'gt' operator`)
      })

      it(`should throw error for lt with undefined value`, () => {
        expect(() =>
          compileSQL({
            where: func(`lt`, [ref(`age`), val(undefined)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'lt' operator`)
      })

      it(`should throw error for gte with null value`, () => {
        expect(() =>
          compileSQL({
            where: func(`gte`, [ref(`price`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'gte' operator`)
      })

      it(`should throw error for lte with null value`, () => {
        expect(() =>
          compileSQL({
            where: func(`lte`, [ref(`rating`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'lte' operator`)
      })

      it(`should throw error for like with null value`, () => {
        expect(() =>
          compileSQL({
            where: func(`like`, [ref(`name`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'like' operator`)
      })

      it(`should throw error for ilike with null value`, () => {
        expect(() =>
          compileSQL({
            where: func(`ilike`, [ref(`name`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'ilike' operator`)
      })

      it(`should throw error for eq(col, null) in AND clause`, () => {
        expect(() =>
          compileSQL({
            where: func(`and`, [
              func(`eq`, [ref(`projectId`), val(`uuid-123`)]),
              func(`eq`, [ref(`deletedAt`), val(null)]),
            ]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should throw error for eq(col, null) in mixed conditions`, () => {
        expect(() =>
          compileSQL({
            where: func(`and`, [
              func(`eq`, [ref(`status`), val(`active`)]),
              func(`eq`, [ref(`archivedAt`), val(null)]),
              func(`gt`, [ref(`createdAt`), val(`2024-01-01`)]),
            ]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should not include params for null values in complex queries`, () => {
        // This test simulates the bug scenario: a query with both valid params and null
        // Before the fix, this would generate:
        //   where: "projectId" = $1 AND "name" > $2
        //   params: { "1": "uuid" } // missing $2!
        // After the fix, gt(name, null) throws an error
        expect(() =>
          compileSQL({
            where: func(`and`, [
              func(`eq`, [ref(`projectId`), val(`uuid`)]),
              func(`gt`, [ref(`name`), val(null)]),
            ]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'gt' operator`)
      })

      it(`should throw error for eq(null, null)`, () => {
        // Both args are null - this is nonsensical and would cause missing params
        expect(() =>
          compileSQL({
            where: func(`eq`, [val(null), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should throw error for eq(null, literal)`, () => {
        // Comparing null to a literal is nonsensical (always evaluates to UNKNOWN)
        expect(() =>
          compileSQL({
            where: func(`eq`, [val(null), val(42)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })

      it(`should throw error for eq(col, null) - use isNull(col) instead`, () => {
        // eq(col, null) should throw an error
        // Users should use isNull(col) which works correctly
        expect(() =>
          compileSQL({
            where: func(`eq`, [ref(`email`), val(null)]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)

        // isNull(col) should work correctly
        const isNullResult = compileSQL({
          where: func(`isNull`, [ref(`email`)]),
        })
        expect(isNullResult.where).toBe(`"email" IS NULL`)
        expect(isNullResult.params).toEqual({})
      })

      it(`should throw error for eq(col, null) in OR clause`, () => {
        expect(() =>
          compileSQL({
            where: func(`or`, [
              func(`eq`, [ref(`deletedAt`), val(null)]),
              func(`eq`, [ref(`status`), val(`active`)]),
            ]),
          }),
        ).toThrow(`Cannot use null/undefined value with 'eq' operator`)
      })
    })

    describe(`isNull/isUndefined operators`, () => {
      it(`should compile isNull correctly`, () => {
        const result = compileSQL({
          where: func(`isNull`, [ref(`deletedAt`)]),
        })
        expect(result.where).toBe(`"deletedAt" IS NULL`)
        expect(result.params).toEqual({})
      })

      it(`should compile isUndefined correctly`, () => {
        const result = compileSQL({
          where: func(`isUndefined`, [ref(`field`)]),
        })
        expect(result.where).toBe(`"field" IS NULL`)
        expect(result.params).toEqual({})
      })

      it(`should compile NOT isNull correctly`, () => {
        const result = compileSQL({
          where: func(`not`, [func(`isNull`, [ref(`name`)])]),
        })
        expect(result.where).toBe(`"name" IS NOT NULL`)
        expect(result.params).toEqual({})
      })
    })

    describe(`empty where clause`, () => {
      it(`should add true = true when no where clause`, () => {
        const result = compileSQL({})
        expect(result.where).toBe(`true = true`)
        expect(result.params).toEqual({})
      })
    })

    describe(`limit`, () => {
      it(`should include limit in result`, () => {
        const result = compileSQL({ limit: 10 })
        expect(result.limit).toBe(10)
      })
    })

    describe(`structured expression output (whereExpr/orderByExpr)`, () => {
      it(`should include whereExpr for simple equality`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`userId`), val(`abc-123`)]),
        })
        expect(result.whereExpr).toEqual({
          type: `func`,
          name: `eq`,
          args: [
            { type: `ref`, column: `userId` },
            { type: `val`, paramIndex: 1 },
          ],
        })
      })

      it(`should include whereExpr for compound AND`, () => {
        const result = compileSQL({
          where: func(`and`, [
            func(`eq`, [ref(`projectId`), val(`uuid-123`)]),
            func(`gt`, [ref(`age`), val(18)]),
          ]),
        })
        expect(result.whereExpr).toEqual({
          type: `func`,
          name: `and`,
          args: [
            {
              type: `func`,
              name: `eq`,
              args: [
                { type: `ref`, column: `projectId` },
                { type: `val`, paramIndex: 1 },
              ],
            },
            {
              type: `func`,
              name: `gt`,
              args: [
                { type: `ref`, column: `age` },
                { type: `val`, paramIndex: 2 },
              ],
            },
          ],
        })
      })

      it(`should include whereExpr for isNull`, () => {
        const result = compileSQL({
          where: func(`isNull`, [ref(`deletedAt`)]),
        })
        expect(result.whereExpr).toEqual({
          type: `func`,
          name: `isNull`,
          args: [{ type: `ref`, column: `deletedAt` }],
        })
      })

      it(`should not include whereExpr when no where clause`, () => {
        const result = compileSQL({ limit: 10 })
        expect(result.whereExpr).toBeUndefined()
      })

      it(`should include orderByExpr for simple orderBy`, () => {
        const result = compileSQL({
          orderBy: [
            {
              expression: ref(`createdAt`),
              compareOptions: { direction: `desc`, nulls: `first` },
            },
          ],
        })
        expect(result.orderByExpr).toEqual([
          { column: `createdAt`, direction: `desc`, nulls: `first` },
        ])
      })

      it(`should include orderByExpr with nulls last`, () => {
        const result = compileSQL({
          orderBy: [
            {
              expression: ref(`name`),
              compareOptions: { direction: `asc`, nulls: `last` },
            },
          ],
        })
        expect(result.orderByExpr).toEqual([{ column: `name`, nulls: `last` }])
      })

      it(`should include orderByExpr for multiple columns`, () => {
        const result = compileSQL({
          orderBy: [
            {
              expression: ref(`status`),
              compareOptions: { direction: `asc`, nulls: `first` },
            },
            {
              expression: ref(`createdAt`),
              compareOptions: { direction: `desc`, nulls: `first` },
            },
          ],
        })
        expect(result.orderByExpr).toEqual([
          { column: `status`, nulls: `first` },
          { column: `createdAt`, direction: `desc`, nulls: `first` },
        ])
      })

      it(`should not include orderByExpr when no orderBy clause`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`id`), val(1)]),
        })
        expect(result.orderByExpr).toBeUndefined()
      })

      it(`should include both whereExpr and orderByExpr together`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`active`), val(true)]),
          orderBy: [
            {
              expression: ref(`createdAt`),
              compareOptions: { direction: `desc`, nulls: `first` },
            },
          ],
          limit: 10,
        })
        expect(result.whereExpr).toEqual({
          type: `func`,
          name: `eq`,
          args: [
            { type: `ref`, column: `active` },
            { type: `val`, paramIndex: 1 },
          ],
        })
        expect(result.orderByExpr).toEqual([
          { column: `createdAt`, direction: `desc`, nulls: `first` },
        ])
        expect(result.limit).toBe(10)
        // Also verify backwards-compatible string fields are present
        expect(result.where).toBe(`"active" = $1`)
        expect(result.orderBy).toBe(`"createdAt" DESC NULLS FIRST`)
      })
    })
  })
})
