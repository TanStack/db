import { describe, expect, it } from "vitest"
import { compileExpression } from "../../../src/query/compiler/evaluators.js"
import { Func, PropRef, Value } from "../../../src/query/ir.js"
import type { NamespacedRow } from "../../../src/types.js"

describe(`evaluators`, () => {
  describe(`compileExpression`, () => {
    it(`handles unknown expression type`, () => {
      const unknownExpr = { type: `unknown` } as any
      expect(() => compileExpression(unknownExpr)).toThrow(
        `Unknown expression type: unknown`
      )
    })

    describe(`ref compilation`, () => {
      it(`throws error for empty reference path`, () => {
        const emptyRef = new PropRef([])
        expect(() => compileExpression(emptyRef)).toThrow(
          `Reference path cannot be empty`
        )
      })

      it(`handles simple table reference`, () => {
        const ref = new PropRef([`users`])
        const compiled = compileExpression(ref)
        const row: NamespacedRow = { users: { id: 1, name: `John` } }

        expect(compiled(row)).toEqual({ id: 1, name: `John` })
      })

      it(`handles single property access`, () => {
        const ref = new PropRef([`users`, `name`])
        const compiled = compileExpression(ref)
        const row: NamespacedRow = { users: { id: 1, name: `John` } }

        expect(compiled(row)).toBe(`John`)
      })

      it(`handles single property access with undefined table`, () => {
        const ref = new PropRef([`users`, `name`])
        const compiled = compileExpression(ref)
        const row: NamespacedRow = { users: undefined as any }

        expect(compiled(row)).toBeUndefined()
      })

      it(`handles multiple property navigation`, () => {
        const ref = new PropRef([`users`, `profile`, `bio`])
        const compiled = compileExpression(ref)
        const row: NamespacedRow = {
          users: { profile: { bio: `Hello world` } },
        }

        expect(compiled(row)).toBe(`Hello world`)
      })

      it(`handles multiple property navigation with null value`, () => {
        const ref = new PropRef([`users`, `profile`, `bio`])
        const compiled = compileExpression(ref)
        const row: NamespacedRow = { users: { profile: null } }

        expect(compiled(row)).toBeNull()
      })

      it(`handles multiple property navigation with undefined table`, () => {
        const ref = new PropRef([`users`, `profile`, `bio`])
        const compiled = compileExpression(ref)
        const row: NamespacedRow = { users: undefined as any }

        expect(compiled(row)).toBeUndefined()
      })
    })

    describe(`function compilation`, () => {
      it(`throws error for unknown function`, () => {
        const unknownFunc = new Func(`unknownFunc`, [])
        expect(() => compileExpression(unknownFunc)).toThrow(
          `Unknown function: unknownFunc`
        )
      })

      describe(`string functions`, () => {
        it(`handles upper with non-string value`, () => {
          const func = new Func(`upper`, [new Value(42)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(42)
        })

        it(`handles lower with non-string value`, () => {
          const func = new Func(`lower`, [new Value(true)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles length with non-string, non-array value`, () => {
          const func = new Func(`length`, [new Value(42)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(0)
        })

        it(`handles length with array`, () => {
          const func = new Func(`length`, [new Value([1, 2, 3])])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(3)
        })

        it(`handles concat with various types`, () => {
          const func = new Func(`concat`, [
            new Value(`Hello`),
            new Value(null),
            new Value(undefined),
            new Value(42),
            new Value({ a: 1 }),
            new Value([1, 2, 3]),
          ])
          const compiled = compileExpression(func)

          const result = compiled({})
          expect(result).toContain(`Hello`)
          expect(result).toContain(`42`)
        })

        it(`handles concat with objects that can't be stringified`, () => {
          const circular: any = {}
          circular.self = circular

          const func = new Func(`concat`, [new Value(circular)])
          const compiled = compileExpression(func)

          // Should not throw and should return some fallback string
          const result = compiled({})
          expect(typeof result).toBe(`string`)
        })

        it(`handles coalesce with all null/undefined values`, () => {
          const func = new Func(`coalesce`, [
            new Value(null),
            new Value(undefined),
            new Value(null),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBeNull()
        })

        it(`handles coalesce with first non-null value`, () => {
          const func = new Func(`coalesce`, [
            new Value(null),
            new Value(`first`),
            new Value(`second`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(`first`)
        })
      })

      describe(`array functions`, () => {
        it(`handles in with non-array value`, () => {
          const func = new Func(`in`, [new Value(1), new Value(`not an array`)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles in with array`, () => {
          const func = new Func(`in`, [new Value(2), new Value([1, 2, 3])])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })
      })

      describe(`math functions`, () => {
        it(`handles add with null values (should default to 0)`, () => {
          const func = new Func(`add`, [new Value(null), new Value(undefined)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(0)
        })

        it(`handles subtract with null values`, () => {
          const func = new Func(`subtract`, [new Value(null), new Value(5)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(-5)
        })

        it(`handles multiply with null values`, () => {
          const func = new Func(`multiply`, [new Value(null), new Value(5)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(0)
        })

        it(`handles divide with zero divisor`, () => {
          const func = new Func(`divide`, [new Value(10), new Value(0)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBeNull()
        })

        it(`handles divide with null values`, () => {
          const func = new Func(`divide`, [new Value(null), new Value(null)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBeNull()
        })
      })

      describe(`like/ilike functions`, () => {
        it(`handles like with non-string value`, () => {
          const func = new Func(`like`, [new Value(42), new Value(`%2%`)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles like with non-string pattern`, () => {
          const func = new Func(`like`, [new Value(`hello`), new Value(42)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles like with wildcard patterns`, () => {
          const func = new Func(`like`, [
            new Value(`hello world`),
            new Value(`hello%`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles like with single character wildcard`, () => {
          const func = new Func(`like`, [
            new Value(`hello`),
            new Value(`hell_`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles like with regex special characters`, () => {
          const func = new Func(`like`, [
            new Value(`test.string`),
            new Value(`test.string`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles ilike (case insensitive)`, () => {
          const func = new Func(`ilike`, [
            new Value(`HELLO`),
            new Value(`hello`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles ilike with patterns`, () => {
          const func = new Func(`ilike`, [
            new Value(`HELLO WORLD`),
            new Value(`hello%`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })
      })

      describe(`boolean operators`, () => {
        it(`handles and with short-circuit evaluation`, () => {
          const func = new Func(`and`, [
            new Value(false),
            new Func(`divide`, [new Value(1), new Value(0)]), // This would return null, but shouldn't be evaluated
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles or with short-circuit evaluation`, () => {
          const func = new Func(`or`, [
            new Value(true),
            new Func(`divide`, [new Value(1), new Value(0)]), // This would return null, but shouldn't be evaluated
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles or with all false values`, () => {
          const func = new Func(`or`, [
            new Value(false),
            new Value(0),
            new Value(null),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })
      })
    })

    describe(`value compilation`, () => {
      it(`returns constant function for values`, () => {
        const val = new Value(42)
        const compiled = compileExpression(val)

        expect(compiled({})).toBe(42)
        expect(compiled({ users: { id: 1 } })).toBe(42) // Should be same regardless of input
      })
    })
  })
})
