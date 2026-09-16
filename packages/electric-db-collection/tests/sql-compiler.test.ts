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

      it.each([
        [`gt`, false, `left`, `("enabled") <> ("enabled")`],
        [`gt`, false, `right`, `("enabled") = TRUE`],
        [`gt`, true, `left`, `("enabled") = FALSE`],
        [`gt`, true, `right`, `("enabled") <> ("enabled")`],
        [`gte`, false, `left`, `("enabled") = FALSE`],
        [`gte`, false, `right`, `("enabled") = ("enabled")`],
        [`gte`, true, `left`, `("enabled") = ("enabled")`],
        [`gte`, true, `right`, `("enabled") = TRUE`],
        [`lt`, false, `left`, `("enabled") = TRUE`],
        [`lt`, false, `right`, `("enabled") <> ("enabled")`],
        [`lt`, true, `left`, `("enabled") <> ("enabled")`],
        [`lt`, true, `right`, `("enabled") = FALSE`],
        [`lte`, false, `left`, `("enabled") = ("enabled")`],
        [`lte`, false, `right`, `("enabled") = FALSE`],
        [`lte`, true, `left`, `("enabled") = TRUE`],
        [`lte`, true, `right`, `("enabled") = ("enabled")`],
      ] as const)(
        `folds boolean %s with %s on the %s`,
        (operator, literal, literalSide, expected) => {
          const column = ref(`enabled`)
          const value = val(literal)
          const args =
            literalSide === `left` ? [value, column] : [column, value]
          const result = compileSQL({ where: func(operator, args) })

          expect(result.where).toBe(expected)
          expect(result.params).toEqual({})
        },
      )

      // Regression test for https://github.com/TanStack/db/issues/1147
      it(`should compile eq with empty string value`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`status`), val(``)]),
        })
        expect(result.where).toBe(`"status" = $1`)
        expect(result.params).toEqual({ '1': `` })
      })

      it(`should compile eq with empty string in AND clause`, () => {
        const result = compileSQL({
          where: func(`and`, [
            func(`eq`, [ref(`projectId`), val(`uuid-123`)]),
            func(`eq`, [ref(`status`), val(``)]),
          ]),
        })
        expect(result.where).toBe(`"projectId" = $1 AND "status" = $2`)
        expect(result.params).toEqual({ '1': `uuid-123`, '2': `` })
      })

      it(`should handle multiple empty strings with correct param indices`, () => {
        const result = compileSQL({
          where: func(`and`, [
            func(`eq`, [ref(`field1`), val(``)]),
            func(`eq`, [ref(`field2`), val(``)]),
          ]),
        })
        expect(result.where).toBe(`"field1" = $1 AND "field2" = $2`)
        // Both empty strings should be present with correct indices
        expect(result.params).toEqual({ '1': ``, '2': `` })
      })

      it(`should compile like with empty string pattern`, () => {
        const result = compileSQL({
          where: func(`like`, [ref(`description`), val(``)]),
        })
        expect(result.where).toBe(`"description" LIKE $1`)
        expect(result.params).toEqual({ '1': `` })
      })

      it(`should compile ilike with empty string pattern`, () => {
        const result = compileSQL({
          where: func(`ilike`, [ref(`title`), val(``)]),
        })
        expect(result.where).toBe(`"title" ILIKE $1`)
        expect(result.params).toEqual({ '1': `` })
      })
    })

    describe(`array membership`, () => {
      it(`uses containment for a scalar value in an array-valued reference`, () => {
        const result = compileSQL({
          where: func(`in`, [val(`admin`), ref(`roles`)]),
        })

        expect(result.where).toBe(
          `($1 = ANY("roles") OR TRUE) AND "roles" @> ARRAY[$1] AND "roles" IS NOT NULL`,
        )
        expect(result.params).toEqual({ '1': `admin` })
      })

      it(`uses ANY for compatible reference-to-array membership`, () => {
        const result = compileSQL({
          where: func(`in`, [ref(`requiredRole`), ref(`roles`)]),
        })

        expect(result.where).toBe(`"requiredRole" = ANY("roles")`)
        expect(result.params).toEqual({})
      })

      it(`uses ANY for a scalar reference in a literal list`, () => {
        const result = compileSQL({
          where: func(`in`, [ref(`status`), val([`active`, `pending`])]),
        })

        expect(result.where).toBe(`"status" = ANY($1)`)
        expect(result.params).toEqual({ '1': `{"active","pending"}` })
      })

      it(`rejects nullish membership operands before binding parameters`, () => {
        const invalidExpressions = [
          func(`in`, [val(null), ref(`roles`)]),
          func(`in`, [val(undefined), ref(`roles`)]),
          func(`in`, [ref(`status`), val(null)]),
          func(`in`, [ref(`status`), val(undefined)]),
        ]

        for (const where of invalidExpressions) {
          expect(() => compileSQL({ where })).toThrow(
            `Cannot use null/undefined value with 'in' operator`,
          )
        }
      })

      it(`rejects an array-valued element`, () => {
        for (const array of [ref(`roles`), val([`admin`, `editor`])]) {
          expect(() =>
            compileSQL({
              where: func(`in`, [val([`admin`, `editor`]), array]),
            }),
          ).toThrow(/array-valued.+left|left.+array-valued/i)
        }
      })
    })

    describe(`unsupported nested references`, () => {
      it(`fails before emitting unsupported subset predicates`, () => {
        for (const where of [
          ref(`payload`, `enabled`),
          func(`eq`, [ref(`payload`, `score`), val(10)]),
          func(`isNull`, [ref(`payload`, `nullable`)]),
          func(`in`, [val(`admin`), ref(`payload`, `roles`)]),
          func(`in`, [ref(`payload`, `score`), val([])]),
          func(`in`, [ref(`payload`, `score`), val([null])]),
          func(`in`, [ref(`payload`, `score`), val([1, `one`])]),
          func(`in`, [ref(`payload`, `role`), ref(`roles`)]),
          func(`upper`, [ref(`payload`, `name`)]),
          func(`lower`, [ref(`payload`, `name`)]),
        ]) {
          expect(() => compileSQL({ where })).toThrow(
            `Compiler can't handle nested properties: payload.`,
          )
        }
      })

      it(`fails before emitting unsupported subset ordering`, () => {
        expect(() =>
          compileSQL({
            orderBy: [
              {
                expression: ref(`payload`, `score`),
                compareOptions: { direction: `asc`, nulls: `last` },
              },
            ],
          }),
        ).toThrow(`Compiler can't handle nested properties: payload.score`)
      })
    })

    describe(`compound where clauses`, () => {
      it(`preserves boolean grouping beneath a comparison`, () => {
        const result = compileSQL({
          where: func(`eq`, [
            func(`or`, [ref(`enabled`), ref(`visible`)]),
            val(false),
          ]),
        })

        expect(result.where).toBe(`("enabled" OR "visible") = $1`)
        expect(result.params).toEqual({ '1': `false` })
      })

      it(`preserves nested boolean grouping`, () => {
        const result = compileSQL({
          where: func(`and`, [
            func(`or`, [
              func(`eq`, [ref(`status`), val(`active`)]),
              func(`eq`, [ref(`status`), val(`pending`)]),
            ]),
            func(`eq`, [ref(`visible`), val(true)]),
          ]),
        })

        expect(result.where).toBe(
          `("status" = $1 OR "status" = $2) AND "visible" = $3`,
        )
      })

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
        expect(result.where).toBe(`"a" = $1 AND "b" = $2 AND "c" = $3`)
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

      it(`validates negated null-check arity before simplifying it`, () => {
        expect(() =>
          compileSQL({
            where: func(`not`, [func(`isNull`, [ref(`name`)]), val(true)]),
          }),
        ).toThrow(`NOT expects 1 argument`)

        expect(() =>
          compileSQL({
            where: func(`not`, [
              func(`isNull`, [ref(`name`), ref(`fallback`)]),
            ]),
          }),
        ).toThrow(`isNull expects 1 argument`)
      })

      it(`binds negated expression null checks once`, () => {
        const result = compileSQL({
          where: func(`not`, [
            func(`isNull`, [func(`eq`, [ref(`enabled`), val(true)])]),
          ]),
        })

        expect(result.where).toBe(`("enabled" = $1) IS NOT NULL`)
        expect(result.params).toEqual({ '1': `true` })
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

    describe(`column name encoding (camelCase to snake_case)`, () => {
      // Helper to simulate snakeCamelMapper's encode function
      const camelToSnake = (str: string): string =>
        str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

      it(`should encode column names in where clause when encoder is provided`, () => {
        const result = compileSQL(
          {
            where: func(`eq`, [ref(`programTemplateId`), val(`uuid-123`)]),
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.where).toBe(`"program_template_id" = $1`)
        expect(result.params).toEqual({ '1': `uuid-123` })
      })

      it(`escapes quotes introduced by a column encoder`, () => {
        const result = compileSQL(
          { where: func(`eq`, [ref(`payload`), val(`gold`)]) },
          { encodeColumnName: (name) => `mapped"${name}` },
        )

        expect(result.where).toBe(`"mapped""payload" = $1`)
      })

      it(`should encode column names in compound where clauses`, () => {
        const result = compileSQL(
          {
            where: func(`and`, [
              func(`eq`, [ref(`programTemplateId`), val(`uuid-123`)]),
              func(`gt`, [ref(`createdAt`), val(`2024-01-01`)]),
            ]),
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.where).toBe(
          `"program_template_id" = $1 AND "created_at" > $2`,
        )
        expect(result.params).toEqual({ '1': `uuid-123`, '2': `2024-01-01` })
      })

      it(`should encode column names in orderBy clause`, () => {
        const result = compileSQL(
          {
            orderBy: [
              {
                expression: ref(`createdAt`),
                compareOptions: { direction: `desc`, nulls: `last` },
              },
            ],
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.orderBy).toBe(`"created_at" DESC NULLS LAST`)
      })

      it(`should encode column names in isNull expressions`, () => {
        const result = compileSQL(
          {
            where: func(`isNull`, [ref(`deletedAt`)]),
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.where).toBe(`"deleted_at" IS NULL`)
      })

      it(`should encode column names in NOT isNull expressions`, () => {
        const result = compileSQL(
          {
            where: func(`not`, [func(`isNull`, [ref(`archivedAt`)])]),
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.where).toBe(`"archived_at" IS NOT NULL`)
      })

      it(`should not transform column names when no encoder is provided`, () => {
        const result = compileSQL({
          where: func(`eq`, [ref(`programTemplateId`), val(`uuid-123`)]),
        })
        // Without encoder, camelCase name is preserved
        expect(result.where).toBe(`"programTemplateId" = $1`)
      })

      it(`should handle complex nested expressions with encoding`, () => {
        const result = compileSQL(
          {
            where: func(`and`, [
              func(`eq`, [ref(`userId`), val(`user-1`)]),
              func(`or`, [
                func(`eq`, [ref(`accountType`), val(`premium`)]),
                func(`gte`, [ref(`totalSpend`), val(1000)]),
              ]),
            ]),
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.where).toBe(
          `"user_id" = $1 AND ("account_type" = $2 OR "total_spend" >= $3)`,
        )
      })

      it(`should encode column names in LIKE expressions`, () => {
        const result = compileSQL(
          {
            where: func(`ilike`, [ref(`firstName`), val(`%john%`)]),
          },
          { encodeColumnName: camelToSnake },
        )
        expect(result.where).toBe(`"first_name" ILIKE $1`)
      })

      it(`should work with already snake_case names (identity transform)`, () => {
        const result = compileSQL(
          {
            where: func(`eq`, [ref(`user_id`), val(`123`)]),
          },
          { encodeColumnName: camelToSnake },
        )
        // snake_case input remains snake_case
        expect(result.where).toBe(`"user_id" = $1`)
      })
    })
  })
})
