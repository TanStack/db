import { describe, expect, it } from "vitest"
import { Aggregate, Func, PropRef, Value } from "../../../src/query/ir.js"

// Import the validation function that we want to test directly
// Since we can't easily mock the D2 streams, we'll test the validation logic separately
function validateSelectAgainstGroupBy(
  groupByClause: Array<any>,
  selectClause: any
): void {
  // This is the same validation logic from group-by.ts
  for (const [alias, expr] of Object.entries(selectClause)) {
    if ((expr as any).type === `agg`) {
      // Aggregate expressions are allowed and don't need to be in GROUP BY
      continue
    }

    // Non-aggregate expression must be in GROUP BY
    const groupIndex = groupByClause.findIndex((groupExpr) =>
      expressionsEqual(expr, groupExpr)
    )

    if (groupIndex === -1) {
      throw new Error(
        `Non-aggregate expression '${alias}' in SELECT must also appear in GROUP BY clause`
      )
    }
  }
}

// Helper function to compare expressions (simplified version)
function expressionsEqual(expr1: any, expr2: any): boolean {
  if (expr1.type !== expr2.type) return false

  if (expr1.type === `ref` && expr2.type === `ref`) {
    return JSON.stringify(expr1.path) === JSON.stringify(expr2.path)
  }

  if (expr1.type === `val` && expr2.type === `val`) {
    return expr1.value === expr2.value
  }

  if (expr1.type === `func` && expr2.type === `func`) {
    return (
      expr1.name === expr2.name &&
      expr1.args.length === expr2.args.length &&
      expr1.args.every((arg: any, i: number) =>
        expressionsEqual(arg, expr2.args[i])
      )
    )
  }

  return false
}

describe(`group-by compiler`, () => {
  describe(`validation logic`, () => {
    describe(`validation errors`, () => {
      it(`throws error when non-aggregate SELECT expression is not in GROUP BY`, () => {
        const groupByClause = [new PropRef([`users`, `department`])]
        const selectClause = {
          department: new PropRef([`users`, `department`]),
          invalidField: new PropRef([`users`, `name`]), // This is not in GROUP BY
        }

        expect(() => {
          validateSelectAgainstGroupBy(groupByClause, selectClause)
        }).toThrow(
          `Non-aggregate expression 'invalidField' in SELECT must also appear in GROUP BY clause`
        )
      })

      it(`allows aggregate expressions in SELECT without GROUP BY requirement`, () => {
        const groupByClause = [new PropRef([`users`, `department`])]
        const selectClause = {
          department: new PropRef([`users`, `department`]),
          count: new Aggregate(`count`, [new PropRef([`users`, `id`])]),
          avg_salary: new Aggregate(`avg`, [new PropRef([`users`, `salary`])]),
        }

        // Should not throw
        expect(() => {
          validateSelectAgainstGroupBy(groupByClause, selectClause)
        }).not.toThrow()
      })
    })

    describe(`expression equality`, () => {
      it(`correctly identifies equal ref expressions`, () => {
        const expr1 = new PropRef([`users`, `department`])
        const expr2 = new PropRef([`users`, `department`])

        expect(expressionsEqual(expr1, expr2)).toBe(true)
      })

      it(`correctly identifies different ref expressions`, () => {
        const expr1 = new PropRef([`users`, `department`])
        const expr2 = new PropRef([`users`, `name`])

        expect(expressionsEqual(expr1, expr2)).toBe(false)
      })

      it(`correctly identifies equal value expressions`, () => {
        const expr1 = new Value(42)
        const expr2 = new Value(42)

        expect(expressionsEqual(expr1, expr2)).toBe(true)
      })

      it(`correctly identifies different value expressions`, () => {
        const expr1 = new Value(42)
        const expr2 = new Value(43)

        expect(expressionsEqual(expr1, expr2)).toBe(false)
      })

      it(`correctly identifies equal function expressions`, () => {
        const expr1 = new Func(`upper`, [new PropRef([`users`, `name`])])
        const expr2 = new Func(`upper`, [new PropRef([`users`, `name`])])

        expect(expressionsEqual(expr1, expr2)).toBe(true)
      })

      it(`correctly identifies different function expressions`, () => {
        const expr1 = new Func(`upper`, [new PropRef([`users`, `name`])])
        const expr2 = new Func(`lower`, [new PropRef([`users`, `name`])])

        expect(expressionsEqual(expr1, expr2)).toBe(false)
      })

      it(`correctly identifies expressions of different types as not equal`, () => {
        const expr1 = new PropRef([`users`, `name`])
        const expr2 = new Value(`name`)

        expect(expressionsEqual(expr1, expr2)).toBe(false)
      })
    })
  })
})
