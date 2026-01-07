import { describe, expect, it } from 'vitest'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'
import {
  add,
  and,
  coalesce,
  concat,
  divide,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  length,
  like,
  lower,
  lt,
  lte,
  multiply,
  not,
  or,
  subtract,
  upper,
} from '../../../src/query/builder/operators/index.js'
import type { NamespacedRow } from '../../../src/types.js'

describe(`evaluators`, () => {
  describe(`compileExpression`, () => {
    it(`handles unknown expression type`, () => {
      const unknownExpr = { type: `unknown` } as any
      expect(() => compileExpression(unknownExpr)).toThrow(
        `Unknown expression type: unknown`,
      )
    })

    describe(`ref compilation`, () => {
      it(`throws error for empty reference path`, () => {
        const emptyRef = new PropRef([])
        expect(() => compileExpression(emptyRef)).toThrow(
          `Reference path cannot be empty`,
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
          `Unknown function: unknownFunc`,
        )
      })

      describe(`string functions`, () => {
        it(`handles upper with non-string value`, () => {
          const func = upper(new Value(42))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(42)
        })

        it(`handles lower with non-string value`, () => {
          const func = lower(new Value(true))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles length with non-string, non-array value`, () => {
          const func = length(new Value(42))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(0)
        })

        it(`handles length with array`, () => {
          const func = length(new Value([1, 2, 3]))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(3)
        })

        it(`handles concat with various types`, () => {
          const func = concat(
            new Value(`Hello`),
            new Value(null),
            new Value(undefined),
            new Value(42),
            new Value({ a: 1 }),
            new Value([1, 2, 3])
          )
          const compiled = compileExpression(func)

          const result = compiled({})
          expect(result).toContain(`Hello`)
          expect(result).toContain(`42`)
        })

        it(`handles concat with objects that can't be stringified`, () => {
          const circular: any = {}
          circular.self = circular

          const func = concat(new Value(circular))
          const compiled = compileExpression(func)

          // Should not throw and should return some fallback string
          const result = compiled({})
          expect(typeof result).toBe(`string`)
        })

        it(`handles coalesce with all null/undefined values`, () => {
          const func = coalesce(
            new Value(null),
            new Value(undefined),
            new Value(null)
          )
          const compiled = compileExpression(func)

          expect(compiled({})).toBeNull()
        })

        it(`handles coalesce with first non-null value`, () => {
          const func = coalesce(
            new Value(null),
            new Value(`first`),
            new Value(`second`)
          )
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(`first`)
        })
      })

      describe(`array functions`, () => {
        it(`handles in with non-array value`, () => {
          const func = inArray(new Value(1), new Value(`not an array`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles in with array`, () => {
          const func = inArray(new Value(2), new Value([1, 2, 3, null]))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles in with null value (3-valued logic)`, () => {
          const func = inArray(new Value(null), new Value([1, 2, 3]))
          const compiled = compileExpression(func)

          // In 3-valued logic, null in array returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles in with undefined value (3-valued logic)`, () => {
          const func = inArray(new Value(undefined), new Value([1, 2, 3]))
          const compiled = compileExpression(func)

          // In 3-valued logic, undefined in array returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })
      })

      describe(`math functions`, () => {
        it(`handles add with null values (should default to 0)`, () => {
          const func = add(new Value(null), new Value(undefined))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(0)
        })

        it(`handles subtract with null values`, () => {
          const func = subtract(new Value(null), new Value(5))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(-5)
        })

        it(`handles multiply with null values`, () => {
          const func = multiply(new Value(null), new Value(5))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(0)
        })

        it(`handles divide with zero divisor`, () => {
          const func = divide(new Value(10), new Value(0))
          const compiled = compileExpression(func)

          expect(compiled({})).toBeNull()
        })

        it(`handles divide with null values`, () => {
          const func = divide(new Value(null), new Value(null))
          const compiled = compileExpression(func)

          expect(compiled({})).toBeNull()
        })
      })

      describe(`like/ilike functions`, () => {
        it(`handles like with non-string value`, () => {
          const func = like(new Value(42), new Value(`%2%`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles like with non-string pattern`, () => {
          const func = like(new Value(`hello`), new Value(42))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles like with wildcard patterns`, () => {
          const func = like(new Value(`hello world`), new Value(`hello%`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles like with single character wildcard`, () => {
          const func = like(new Value(`hello`), new Value(`hell_`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles like with regex special characters`, () => {
          const func = like(new Value(`test.string`), new Value(`test.string`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles like with null value (3-valued logic)`, () => {
          const func = like(new Value(null), new Value(`hello%`))
          const compiled = compileExpression(func)

          // In 3-valued logic, like with null value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles like with undefined value (3-valued logic)`, () => {
          const func = like(new Value(undefined), new Value(`hello%`))
          const compiled = compileExpression(func)

          // In 3-valued logic, like with undefined value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles like with null pattern (3-valued logic)`, () => {
          const func = like(new Value(`hello`), new Value(null))
          const compiled = compileExpression(func)

          // In 3-valued logic, like with null pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles like with undefined pattern (3-valued logic)`, () => {
          const func = like(new Value(`hello`), new Value(undefined))
          const compiled = compileExpression(func)

          // In 3-valued logic, like with undefined pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike (case insensitive)`, () => {
          const func = ilike(new Value(`HELLO`), new Value(`hello`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles ilike with patterns`, () => {
          const func = ilike(new Value(`HELLO WORLD`), new Value(`hello%`))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles ilike with null value (3-valued logic)`, () => {
          const func = ilike(new Value(null), new Value(`hello%`))
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with null value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike with undefined value (3-valued logic)`, () => {
          const func = ilike(new Value(undefined), new Value(`hello%`))
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with undefined value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike with null pattern (3-valued logic)`, () => {
          const func = ilike(new Value(`hello`), new Value(null))
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with null pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike with undefined pattern (3-valued logic)`, () => {
          const func = ilike(new Value(`hello`), new Value(undefined))
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with undefined pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })
      })

      describe(`comparison operators`, () => {
        describe(`eq (equality)`, () => {
          it(`handles eq with null and null (3-valued logic)`, () => {
            const func = eq(new Value(null), new Value(null))
            const compiled = compileExpression(func)

            // In 3-valued logic, null = null returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with null and value (3-valued logic)`, () => {
            const func = eq(new Value(null), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, null = value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with value and null (3-valued logic)`, () => {
            const func = eq(new Value(5), new Value(null))
            const compiled = compileExpression(func)

            // In 3-valued logic, value = null returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with undefined and value (3-valued logic)`, () => {
            const func = eq(new Value(undefined), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined = value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with matching values`, () => {
            const func = eq(new Value(5), new Value(5))
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(true)
          })

          it(`handles eq with non-matching values`, () => {
            const func = eq(new Value(5), new Value(10))
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(false)
          })

          it(`handles eq with matching Uint8Arrays (content equality)`, () => {
            const array1 = new Uint8Array([1, 2, 3, 4, 5])
            const array2 = new Uint8Array([1, 2, 3, 4, 5])
            const func = eq(new Value(array1), new Value(array2))
            const compiled = compileExpression(func)

            // Should return true because content is the same
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with non-matching Uint8Arrays (different content)`, () => {
            const array1 = new Uint8Array([1, 2, 3, 4, 5])
            const array2 = new Uint8Array([1, 2, 3, 4, 6])
            const func = eq(new Value(array1), new Value(array2))
            const compiled = compileExpression(func)

            // Should return false because content is different
            expect(compiled({})).toBe(false)
          })

          it(`handles eq with Uint8Arrays of different lengths`, () => {
            const array1 = new Uint8Array([1, 2, 3, 4])
            const array2 = new Uint8Array([1, 2, 3, 4, 5])
            const func = eq(new Value(array1), new Value(array2))
            const compiled = compileExpression(func)

            // Should return false because lengths are different
            expect(compiled({})).toBe(false)
          })

          it(`handles eq with same Uint8Array reference`, () => {
            const array = new Uint8Array([1, 2, 3, 4, 5])
            const func = eq(new Value(array), new Value(array))
            const compiled = compileExpression(func)

            // Should return true (fast path for reference equality)
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with Uint8Array and non-Uint8Array`, () => {
            const array = new Uint8Array([1, 2, 3])
            const value = [1, 2, 3]
            // Cast to any to test runtime behavior with mismatched types
            const func = eq(new Value(array) as any, new Value(value) as any)
            const compiled = compileExpression(func)

            // Should return false because types are different
            expect(compiled({})).toBe(false)
          })

          it(`handles eq with ULIDs (16-byte Uint8Arrays)`, () => {
            // Simulate ULID comparison - 16 bytes
            const ulid1 = new Uint8Array(16)
            const ulid2 = new Uint8Array(16)

            // Fill with same values
            for (let i = 0; i < 16; i++) {
              ulid1[i] = i
              ulid2[i] = i
            }

            const func = eq(new Value(ulid1), new Value(ulid2))
            const compiled = compileExpression(func)

            // Should return true because content is identical
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with Buffers (if available)`, () => {
            if (typeof Buffer !== `undefined`) {
              const buffer1 = Buffer.from([1, 2, 3, 4, 5])
              const buffer2 = Buffer.from([1, 2, 3, 4, 5])
              const func = eq(new Value(buffer1), new Value(buffer2))
              const compiled = compileExpression(func)

              // Should return true because content is the same
              expect(compiled({})).toBe(true)
            }
          })

          it(`handles eq with Date objects (should compare by getTime(), not reference)`, () => {
            // Create two Date objects with the same time value
            // They are different object instances but represent the same moment
            const date1 = new Date(`2024-01-15T10:30:45.123Z`)
            const date2 = new Date(`2024-01-15T10:30:45.123Z`)

            // Verify they are different object references
            expect(date1).not.toBe(date2)
            // But they have the same time value
            expect(date1.getTime()).toBe(date2.getTime())

            const func = new Func(`eq`, [new Value(date1), new Value(date2)])
            const compiled = compileExpression(func)

            // Should return true because they represent the same time
            // Currently this fails because eq() does referential comparison
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with Date objects with different times`, () => {
            const date1 = new Date(`2024-01-15T10:30:45.123Z`)
            const date2 = new Date(`2024-01-15T10:30:45.124Z`) // 1ms later

            const func = new Func(`eq`, [new Value(date1), new Value(date2)])
            const compiled = compileExpression(func)

            // Should return false because they represent different times
            expect(compiled({})).toBe(false)
          })

          it(`handles eq with Uint8Arrays created with length (repro case)`, () => {
            // Reproduction of user's issue: new Uint8Array(5) creates [0,0,0,0,0]
            const array1 = new Uint8Array(5) // Creates array of length 5, all zeros
            const array2 = new Uint8Array(5) // Creates another array of length 5, all zeros
            const func = eq(new Value(array1), new Value(array2))
            const compiled = compileExpression(func)

            // Should return true because both have same content (all zeros)
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with empty Uint8Arrays`, () => {
            const array1 = new Uint8Array(0)
            const array2 = new Uint8Array(0)
            const func = eq(new Value(array1), new Value(array2))
            const compiled = compileExpression(func)

            // Empty arrays should be equal
            expect(compiled({})).toBe(true)
          })

          it(`still handles eq with strings correctly`, () => {
            const func1 = eq(new Value(`hello`), new Value(`hello`))
            const compiled1 = compileExpression(func1)
            expect(compiled1({})).toBe(true)

            const func2 = eq(new Value(`hello`), new Value(`world`))
            const compiled2 = compileExpression(func2)
            expect(compiled2({})).toBe(false)
          })

          it(`still handles eq with numbers correctly`, () => {
            const func1 = eq(new Value(42), new Value(42))
            const compiled1 = compileExpression(func1)
            expect(compiled1({})).toBe(true)

            const func2 = eq(new Value(42), new Value(43))
            const compiled2 = compileExpression(func2)
            expect(compiled2({})).toBe(false)
          })
        })

        describe(`gt (greater than)`, () => {
          it(`handles gt with null and value (3-valued logic)`, () => {
            const func = gt(new Value(null), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, null > value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gt with value and null (3-valued logic)`, () => {
            const func = gt(new Value(5), new Value(null))
            const compiled = compileExpression(func)

            // In 3-valued logic, value > null returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gt with undefined (3-valued logic)`, () => {
            const func = gt(new Value(undefined), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined > value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gt with valid values`, () => {
            const func = gt(new Value(10), new Value(5))
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(true)
          })
        })

        describe(`gte (greater than or equal)`, () => {
          it(`handles gte with null (3-valued logic)`, () => {
            const func = gte(new Value(null), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, null >= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gte with undefined (3-valued logic)`, () => {
            const func = gte(new Value(undefined), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined >= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })
        })

        describe(`lt (less than)`, () => {
          it(`handles lt with null (3-valued logic)`, () => {
            const func = lt(new Value(null), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, null < value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles lt with undefined (3-valued logic)`, () => {
            const func = lt(new Value(undefined), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined < value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles lt with valid values`, () => {
            const func = lt(new Value(3), new Value(5))
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(true)
          })
        })

        describe(`lte (less than or equal)`, () => {
          it(`handles lte with null (3-valued logic)`, () => {
            const func = lte(new Value(null), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, null <= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles lte with undefined (3-valued logic)`, () => {
            const func = lte(new Value(undefined), new Value(5))
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined <= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })
        })
      })

      describe(`boolean operators`, () => {
        it(`handles and with short-circuit evaluation`, () => {
          const func = and(new Value(false), divide(new Value(1), new Value(0))) // This would return null, but shouldn't be evaluated
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles and with null value (3-valued logic)`, () => {
          const func = and(new Value(true), new Value(null))
          const compiled = compileExpression(func)

          // In 3-valued logic, true AND null = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles and with undefined value (3-valued logic)`, () => {
          const func = and(new Value(true), new Value(undefined))
          const compiled = compileExpression(func)

          // In 3-valued logic, true AND undefined = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles and with null and false (3-valued logic)`, () => {
          const func = and(new Value(null), new Value(false))
          const compiled = compileExpression(func)

          // In 3-valued logic, null AND false = false
          expect(compiled({})).toBe(false)
        })

        it(`handles and with all true values`, () => {
          const func = and(new Value(true), new Value(true))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles or with short-circuit evaluation`, () => {
          const func = or(new Value(true), divide(new Value(1), new Value(0))) // This would return null, but shouldn't be evaluated
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles or with null value (3-valued logic)`, () => {
          const func = or(new Value(false), new Value(0), new Value(null))
          const compiled = compileExpression(func)

          // In 3-valued logic, false OR null = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles or with undefined value (3-valued logic)`, () => {
          const func = or(new Value(false), new Value(0), new Value(undefined))
          const compiled = compileExpression(func)
          // In 3-valued logic, false OR undefined = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles or with null and true (3-valued logic)`, () => {
          const func = or(new Value(null), new Value(true))
          const compiled = compileExpression(func)

          // In 3-valued logic, null OR true = true
          expect(compiled({})).toBe(true)
        })

        it(`handles or with all false values`, () => {
          const func = or(new Value(false), new Value(0))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles not with null value (3-valued logic)`, () => {
          const func = not(new Value(null))
          const compiled = compileExpression(func)

          // In 3-valued logic, NOT null = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles not with undefined value (3-valued logic)`, () => {
          const func = not(new Value(undefined))
          const compiled = compileExpression(func)

          // In 3-valued logic, NOT undefined = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles not with true value`, () => {
          const func = not(new Value(true))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles not with false value`, () => {
          const func = not(new Value(false))
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
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
