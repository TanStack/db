import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { compileExpression } from '../../../src/query/compiler/evaluators.js'
import { Func, PropRef, Value } from '../../../src/query/ir.js'
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
          const func = new Func(`in`, [
            new Value(2),
            new Value([1, 2, 3, null]),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles in with null value (3-valued logic)`, () => {
          const func = new Func(`in`, [new Value(null), new Value([1, 2, 3])])
          const compiled = compileExpression(func)

          // In 3-valued logic, null in array returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles in with undefined value (3-valued logic)`, () => {
          const func = new Func(`in`, [
            new Value(undefined),
            new Value([1, 2, 3]),
          ])
          const compiled = compileExpression(func)

          // In 3-valued logic, undefined in array returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
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

      describe(`date/time functions`, () => {
        it(`handles date by normalizing to YYYY-MM-DD`, () => {
          const func = new Func(`date`, [new Value(`2026-01-02T05:06:07.000Z`)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(`2026-01-02`)
        })

        it(`handles datetime by normalizing to ISO string`, () => {
          const func = new Func(`datetime`, [new Value(1767225600000)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(`2026-01-01T00:00:00.000Z`)
        })

        it(`handles strftime with supported date format`, () => {
          const func = new Func(`strftime`, [
            new Value(`%Y-%m-%d`),
            new Value(`2026-01-02T05:06:07.000Z`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(`2026-01-02`)
        })

        it(`returns null for strftime with non-string format`, () => {
          const func = new Func(`strftime`, [
            new Value(123),
            new Value(`2026-01-02T05:06:07.000Z`),
          ])
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

        it(`handles like with null value (3-valued logic)`, () => {
          const func = new Func(`like`, [new Value(null), new Value(`hello%`)])
          const compiled = compileExpression(func)

          // In 3-valued logic, like with null value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles like with undefined value (3-valued logic)`, () => {
          const func = new Func(`like`, [
            new Value(undefined),
            new Value(`hello%`),
          ])
          const compiled = compileExpression(func)

          // In 3-valued logic, like with undefined value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles like with null pattern (3-valued logic)`, () => {
          const func = new Func(`like`, [new Value(`hello`), new Value(null)])
          const compiled = compileExpression(func)

          // In 3-valued logic, like with null pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles like with undefined pattern (3-valued logic)`, () => {
          const func = new Func(`like`, [
            new Value(`hello`),
            new Value(undefined),
          ])
          const compiled = compileExpression(func)

          // In 3-valued logic, like with undefined pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
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

        it(`handles ilike with null value (3-valued logic)`, () => {
          const func = new Func(`ilike`, [new Value(null), new Value(`hello%`)])
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with null value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike with undefined value (3-valued logic)`, () => {
          const func = new Func(`ilike`, [
            new Value(undefined),
            new Value(`hello%`),
          ])
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with undefined value returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike with null pattern (3-valued logic)`, () => {
          const func = new Func(`ilike`, [new Value(`hello`), new Value(null)])
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with null pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`handles ilike with undefined pattern (3-valued logic)`, () => {
          const func = new Func(`ilike`, [
            new Value(`hello`),
            new Value(undefined),
          ])
          const compiled = compileExpression(func)

          // In 3-valued logic, ilike with undefined pattern returns UNKNOWN (null)
          expect(compiled({})).toBe(null)
        })

        it(`like % wildcard matches across newline characters`, () => {
          const func = new Func(`like`, [
            new Value(`hello\nworld`),
            new Value(`%world`),
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`like _ wildcard matches a newline character`, () => {
          const func = new Func(`like`, [new Value(`a\nb`), new Value(`a_b`)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })
      })

      describe(`comparison operators`, () => {
        describe(`eq (equality)`, () => {
          it(`handles eq with null and null (3-valued logic)`, () => {
            const func = new Func(`eq`, [new Value(null), new Value(null)])
            const compiled = compileExpression(func)

            // In 3-valued logic, null = null returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with null and value (3-valued logic)`, () => {
            const func = new Func(`eq`, [new Value(null), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, null = value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with value and null (3-valued logic)`, () => {
            const func = new Func(`eq`, [new Value(5), new Value(null)])
            const compiled = compileExpression(func)

            // In 3-valued logic, value = null returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with undefined and value (3-valued logic)`, () => {
            const func = new Func(`eq`, [new Value(undefined), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined = value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles eq with matching values`, () => {
            const func = new Func(`eq`, [new Value(5), new Value(5)])
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(true)
          })

          it(`handles eq with non-matching values`, () => {
            const func = new Func(`eq`, [new Value(5), new Value(10)])
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(false)
          })

          it(`handles eq with matching Uint8Arrays (content equality)`, () => {
            const array1 = new Uint8Array([1, 2, 3, 4, 5])
            const array2 = new Uint8Array([1, 2, 3, 4, 5])
            const func = new Func(`eq`, [new Value(array1), new Value(array2)])
            const compiled = compileExpression(func)

            // Should return true because content is the same
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with non-matching Uint8Arrays (different content)`, () => {
            const array1 = new Uint8Array([1, 2, 3, 4, 5])
            const array2 = new Uint8Array([1, 2, 3, 4, 6])
            const func = new Func(`eq`, [new Value(array1), new Value(array2)])
            const compiled = compileExpression(func)

            // Should return false because content is different
            expect(compiled({})).toBe(false)
          })

          it(`handles eq with Uint8Arrays of different lengths`, () => {
            const array1 = new Uint8Array([1, 2, 3, 4])
            const array2 = new Uint8Array([1, 2, 3, 4, 5])
            const func = new Func(`eq`, [new Value(array1), new Value(array2)])
            const compiled = compileExpression(func)

            // Should return false because lengths are different
            expect(compiled({})).toBe(false)
          })

          it(`handles eq with same Uint8Array reference`, () => {
            const array = new Uint8Array([1, 2, 3, 4, 5])
            const func = new Func(`eq`, [new Value(array), new Value(array)])
            const compiled = compileExpression(func)

            // Should return true (fast path for reference equality)
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with Uint8Array and non-Uint8Array`, () => {
            const array = new Uint8Array([1, 2, 3])
            const value = [1, 2, 3]
            const func = new Func(`eq`, [new Value(array), new Value(value)])
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

            const func = new Func(`eq`, [new Value(ulid1), new Value(ulid2)])
            const compiled = compileExpression(func)

            // Should return true because content is identical
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with Buffers (if available)`, () => {
            if (typeof Buffer !== `undefined`) {
              const buffer1 = Buffer.from([1, 2, 3, 4, 5])
              const buffer2 = Buffer.from([1, 2, 3, 4, 5])
              const func = new Func(`eq`, [
                new Value(buffer1),
                new Value(buffer2),
              ])
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
            const func = new Func(`eq`, [new Value(array1), new Value(array2)])
            const compiled = compileExpression(func)

            // Should return true because both have same content (all zeros)
            expect(compiled({})).toBe(true)
          })

          it(`handles eq with empty Uint8Arrays`, () => {
            const array1 = new Uint8Array(0)
            const array2 = new Uint8Array(0)
            const func = new Func(`eq`, [new Value(array1), new Value(array2)])
            const compiled = compileExpression(func)

            // Empty arrays should be equal
            expect(compiled({})).toBe(true)
          })

          it(`still handles eq with strings correctly`, () => {
            const func1 = new Func(`eq`, [
              new Value(`hello`),
              new Value(`hello`),
            ])
            const compiled1 = compileExpression(func1)
            expect(compiled1({})).toBe(true)

            const func2 = new Func(`eq`, [
              new Value(`hello`),
              new Value(`world`),
            ])
            const compiled2 = compileExpression(func2)
            expect(compiled2({})).toBe(false)
          })

          it(`still handles eq with numbers correctly`, () => {
            const func1 = new Func(`eq`, [new Value(42), new Value(42)])
            const compiled1 = compileExpression(func1)
            expect(compiled1({})).toBe(true)

            const func2 = new Func(`eq`, [new Value(42), new Value(43)])
            const compiled2 = compileExpression(func2)
            expect(compiled2({})).toBe(false)
          })
        })

        describe(`gt (greater than)`, () => {
          it(`handles gt with null and value (3-valued logic)`, () => {
            const func = new Func(`gt`, [new Value(null), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, null > value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gt with value and null (3-valued logic)`, () => {
            const func = new Func(`gt`, [new Value(5), new Value(null)])
            const compiled = compileExpression(func)

            // In 3-valued logic, value > null returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gt with undefined (3-valued logic)`, () => {
            const func = new Func(`gt`, [new Value(undefined), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined > value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gt with valid values`, () => {
            const func = new Func(`gt`, [new Value(10), new Value(5)])
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(true)
          })
        })

        describe(`gte (greater than or equal)`, () => {
          it(`handles gte with null (3-valued logic)`, () => {
            const func = new Func(`gte`, [new Value(null), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, null >= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles gte with undefined (3-valued logic)`, () => {
            const func = new Func(`gte`, [new Value(undefined), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined >= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })
        })

        describe(`lt (less than)`, () => {
          it(`handles lt with null (3-valued logic)`, () => {
            const func = new Func(`lt`, [new Value(null), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, null < value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles lt with undefined (3-valued logic)`, () => {
            const func = new Func(`lt`, [new Value(undefined), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined < value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles lt with valid values`, () => {
            const func = new Func(`lt`, [new Value(3), new Value(5)])
            const compiled = compileExpression(func)

            expect(compiled({})).toBe(true)
          })
        })

        describe(`lte (less than or equal)`, () => {
          it(`handles lte with null (3-valued logic)`, () => {
            const func = new Func(`lte`, [new Value(null), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, null <= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })

          it(`handles lte with undefined (3-valued logic)`, () => {
            const func = new Func(`lte`, [new Value(undefined), new Value(5)])
            const compiled = compileExpression(func)

            // In 3-valued logic, undefined <= value returns UNKNOWN (null)
            expect(compiled({})).toBe(null)
          })
        })

        describe(`NaN (PostgreSQL float semantics)`, () => {
          // Following PostgreSQL, NaN is equal to itself and greater than every
          // other (non-null) value, so it has a well-defined order.
          it(`treats NaN as equal to NaN`, () => {
            const func = new Func(`eq`, [new Value(NaN), new Value(NaN)])
            expect(compileExpression(func)({})).toBe(true)
          })

          it(`treats NaN as not equal to a number`, () => {
            const func = new Func(`eq`, [new Value(NaN), new Value(5)])
            expect(compileExpression(func)({})).toBe(false)
          })

          it(`still returns UNKNOWN when comparing NaN with null`, () => {
            const func = new Func(`eq`, [new Value(NaN), new Value(null)])
            expect(compileExpression(func)({})).toBe(null)
          })

          it(`treats NaN as greater than every number`, () => {
            expect(
              compileExpression(new Func(`gt`, [new Value(NaN), new Value(5)]))(
                {},
              ),
            ).toBe(true)
            expect(
              compileExpression(new Func(`gt`, [new Value(5), new Value(NaN)]))(
                {},
              ),
            ).toBe(false)
            expect(
              compileExpression(
                new Func(`gt`, [new Value(NaN), new Value(NaN)]),
              )({}),
            ).toBe(false)
          })

          it(`orders NaN with gte/lt/lte consistently`, () => {
            // NaN >= anything (including NaN); nothing finite >= NaN
            expect(
              compileExpression(
                new Func(`gte`, [new Value(NaN), new Value(5)]),
              )({}),
            ).toBe(true)
            expect(
              compileExpression(
                new Func(`gte`, [new Value(NaN), new Value(NaN)]),
              )({}),
            ).toBe(true)
            // NaN < nothing; a finite value < NaN
            expect(
              compileExpression(new Func(`lt`, [new Value(NaN), new Value(5)]))(
                {},
              ),
            ).toBe(false)
            expect(
              compileExpression(new Func(`lt`, [new Value(5), new Value(NaN)]))(
                {},
              ),
            ).toBe(true)
            // NaN <= NaN; a finite value <= NaN
            expect(
              compileExpression(
                new Func(`lte`, [new Value(NaN), new Value(NaN)]),
              )({}),
            ).toBe(true)
            expect(
              compileExpression(
                new Func(`lte`, [new Value(5), new Value(NaN)]),
              )({}),
            ).toBe(true)
          })

          it(`matches NaN inside an IN list`, () => {
            const func = new Func(`in`, [
              new Value(NaN),
              new Value([NaN, 1, 2]),
            ])
            expect(compileExpression(func)({})).toBe(true)
          })
        })

        describe(`Temporal objects`, () => {
          const evalOp = (op: string, left: any, right: any) =>
            compileExpression(
              new Func(op, [new Value(left), new Value(right)]),
            )({})

          describe(`Instant`, () => {
            const earlier = Temporal.Instant.from(`2024-01-15T10:00:00Z`)
            const later = Temporal.Instant.from(`2024-01-15T11:00:00Z`)

            it(`orders chronologically`, () => {
              expect(evalOp(`gt`, later, earlier)).toBe(true)
              expect(evalOp(`gt`, earlier, later)).toBe(false)
              expect(evalOp(`gt`, earlier, earlier)).toBe(false)
              expect(evalOp(`gte`, earlier, earlier)).toBe(true)
              expect(evalOp(`lt`, earlier, later)).toBe(true)
              expect(evalOp(`lte`, earlier, earlier)).toBe(true)
            })

            it(`eq returns true for distinct instances with the same instant`, () => {
              const earlierCopy = Temporal.Instant.from(earlier)
              expect(earlier).not.toBe(earlierCopy)
              expect(evalOp(`eq`, earlier, earlierCopy)).toBe(true)
            })
          })

          describe(`PlainDate`, () => {
            const jan15 = Temporal.PlainDate.from(`2024-01-15`)
            const jan16 = Temporal.PlainDate.from(`2024-01-16`)

            it(`orders chronologically`, () => {
              expect(evalOp(`gt`, jan16, jan15)).toBe(true)
              expect(evalOp(`gt`, jan15, jan16)).toBe(false)
              expect(evalOp(`gt`, jan15, jan15)).toBe(false)
              expect(evalOp(`gte`, jan15, jan15)).toBe(true)
              expect(evalOp(`lt`, jan15, jan16)).toBe(true)
              expect(evalOp(`lte`, jan15, jan15)).toBe(true)
            })

            it(`eq returns true for distinct instances with the same date`, () => {
              const jan15Copy = Temporal.PlainDate.from(jan15)
              expect(jan15).not.toBe(jan15Copy)
              expect(evalOp(`eq`, jan15, jan15Copy)).toBe(true)
            })

            it(`eq returns false for different dates`, () => {
              expect(evalOp(`eq`, jan15, jan16)).toBe(false)
            })
          })

          describe(`PlainDateTime`, () => {
            const a = Temporal.PlainDateTime.from(`2024-01-15T10:30:00`)
            const b = Temporal.PlainDateTime.from(`2024-01-15T10:30:01`)

            it(`orders chronologically`, () => {
              expect(evalOp(`gt`, b, a)).toBe(true)
              expect(evalOp(`gt`, a, b)).toBe(false)
              expect(evalOp(`gt`, a, a)).toBe(false)
              expect(evalOp(`gte`, a, a)).toBe(true)
              expect(evalOp(`lt`, a, b)).toBe(true)
              expect(evalOp(`lte`, a, a)).toBe(true)
            })

            it(`eq returns true for distinct instances with the same value`, () => {
              const aCopy = Temporal.PlainDateTime.from(a)
              expect(a).not.toBe(aCopy)
              expect(evalOp(`eq`, a, aCopy)).toBe(true)
            })
          })

          describe(`PlainTime`, () => {
            const morning = Temporal.PlainTime.from(`08:00:00`)
            const evening = Temporal.PlainTime.from(`20:00:00`)

            it(`orders by time of day`, () => {
              expect(evalOp(`gt`, evening, morning)).toBe(true)
              expect(evalOp(`gt`, morning, evening)).toBe(false)
              expect(evalOp(`gt`, morning, morning)).toBe(false)
              expect(evalOp(`gte`, morning, morning)).toBe(true)
              expect(evalOp(`lt`, morning, evening)).toBe(true)
              expect(evalOp(`lte`, morning, morning)).toBe(true)
            })

            it(`eq returns true for distinct instances with the same time`, () => {
              const morningCopy = Temporal.PlainTime.from(morning)
              expect(morning).not.toBe(morningCopy)
              expect(evalOp(`eq`, morning, morningCopy)).toBe(true)
            })

            it(`eq returns false for different times`, () => {
              expect(evalOp(`eq`, morning, evening)).toBe(false)
            })
          })

          describe(`PlainYearMonth`, () => {
            const feb = Temporal.PlainYearMonth.from(`2024-02`)
            const mar = Temporal.PlainYearMonth.from(`2024-03`)

            it(`orders chronologically`, () => {
              expect(evalOp(`gt`, mar, feb)).toBe(true)
              expect(evalOp(`gt`, feb, mar)).toBe(false)
              expect(evalOp(`gt`, feb, feb)).toBe(false)
              expect(evalOp(`gte`, feb, feb)).toBe(true)
              expect(evalOp(`lt`, feb, mar)).toBe(true)
              expect(evalOp(`lte`, feb, feb)).toBe(true)
            })

            it(`eq returns true for distinct instances with the same year/month`, () => {
              const febCopy = Temporal.PlainYearMonth.from(feb)
              expect(feb).not.toBe(febCopy)
              expect(evalOp(`eq`, feb, febCopy)).toBe(true)
            })

            it(`eq returns false for different year/month pairs`, () => {
              expect(evalOp(`eq`, feb, mar)).toBe(false)
            })
          })

          describe(`PlainMonthDay`, () => {
            // PlainMonthDay has no static .compare() — there is no canonical ordering
            // without a year (e.g. Feb 29 only sometimes follows Feb 28). Equality is
            // still well-defined.
            const md1 = Temporal.PlainMonthDay.from(`--03-15`)
            const md2 = Temporal.PlainMonthDay.from(`--04-15`)

            it(`eq returns true for distinct instances with the same month/day`, () => {
              const md1Copy = Temporal.PlainMonthDay.from(md1)
              expect(md1).not.toBe(md1Copy)
              expect(evalOp(`eq`, md1, md1Copy)).toBe(true)
            })

            it(`eq returns false for different month/day pairs`, () => {
              expect(evalOp(`eq`, md1, md2)).toBe(false)
            })

            it(`gt throws since PlainMonthDay has no defined ordering`, () => {
              expect(() => evalOp(`gt`, md1, md2)).toThrow(
                /no defined ordering/,
              )
            })
          })

          describe(`ZonedDateTime`, () => {
            // Same wall-clock noon in two zones is a different instant.
            // Tokyo is ahead of New York, so noon Tokyo precedes noon NY by ~14h.
            const tokyoNoon = Temporal.ZonedDateTime.from(
              `2024-01-15T12:00:00[Asia/Tokyo]`,
            )
            const nyNoon = Temporal.ZonedDateTime.from(
              `2024-01-15T12:00:00[America/New_York]`,
            )

            it(`orders by underlying instant across time zones`, () => {
              expect(evalOp(`gt`, nyNoon, tokyoNoon)).toBe(true)
              expect(evalOp(`gt`, tokyoNoon, nyNoon)).toBe(false)
              expect(evalOp(`gt`, tokyoNoon, tokyoNoon)).toBe(false)
              expect(evalOp(`gte`, tokyoNoon, tokyoNoon)).toBe(true)
              expect(evalOp(`lt`, tokyoNoon, nyNoon)).toBe(true)
              expect(evalOp(`lte`, tokyoNoon, tokyoNoon)).toBe(true)
            })

            it(`eq returns true for distinct instances with same instant AND zone`, () => {
              const tokyoNoonCopy = Temporal.ZonedDateTime.from(tokyoNoon)
              expect(tokyoNoon).not.toBe(tokyoNoonCopy)
              expect(evalOp(`eq`, tokyoNoon, tokyoNoonCopy)).toBe(true)
            })

            it(`eq returns false for same instant in different zones`, () => {
              // ZonedDateTime.equals treats the time zone as part of identity, so two
              // ZonedDateTimes for the same instant in different zones are not equal —
              // even though .compare() returns 0 for them.
              const inTokyo = nyNoon.withTimeZone(`Asia/Tokyo`)
              expect(evalOp(`eq`, nyNoon, inTokyo)).toBe(false)
            })

            it(`ranks same-instant-different-zone as positionally equal`, () => {
              // .compare() ranks by underlying instant, so two ZonedDateTimes for
              // the same instant in different zones are positionally equal — even
              // though .equals() returns false (see the eq test above). This
              // verifies we dispatch to .compare() rather than lex-comparing
              // toString output, which would order by zone name.
              const inTokyo = nyNoon.withTimeZone(`Asia/Tokyo`)
              expect(evalOp(`gt`, nyNoon, inTokyo)).toBe(false)
              expect(evalOp(`lt`, nyNoon, inTokyo)).toBe(false)
              expect(evalOp(`gte`, nyNoon, inTokyo)).toBe(true)
              expect(evalOp(`lte`, nyNoon, inTokyo)).toBe(true)
            })
          })

          describe(`Duration`, () => {
            // Without a relativeTo, Duration ordering is only well-defined when both
            // values are time/day-only. Calendar-affected fields (years/months/weeks)
            // are not exercised here.
            const oneHour = Temporal.Duration.from(`PT1H`)
            const twoHours = Temporal.Duration.from(`PT2H`)

            it(`orders time-only durations by length`, () => {
              expect(evalOp(`gt`, twoHours, oneHour)).toBe(true)
              expect(evalOp(`gt`, oneHour, twoHours)).toBe(false)
              expect(evalOp(`gt`, oneHour, oneHour)).toBe(false)
              expect(evalOp(`gte`, oneHour, oneHour)).toBe(true)
              expect(evalOp(`lt`, oneHour, twoHours)).toBe(true)
              expect(evalOp(`lte`, oneHour, oneHour)).toBe(true)
            })

            it(`eq returns true for distinct instances with the same value`, () => {
              const oneHourCopy = Temporal.Duration.from(oneHour)
              expect(oneHour).not.toBe(oneHourCopy)
              expect(evalOp(`eq`, oneHour, oneHourCopy)).toBe(true)
            })

            it(`eq returns false for different durations`, () => {
              expect(evalOp(`eq`, oneHour, twoHours)).toBe(false)
            })

            it(`equivalent forms compare equal but eq returns false`, () => {
              // PT60M and PT1H represent the same duration. .compare() ranks them
              // as equal, but .equals() (structural, field-by-field) does not, so
              // eq returns false. This pins the asymmetry — and verifies we
              // dispatch to .compare() rather than lex-comparing toString output,
              // which would say "PT1H" < "PT60M".
              const sixtyMinutes = Temporal.Duration.from(`PT60M`)
              const oneHourLit = Temporal.Duration.from(`PT1H`)
              expect(evalOp(`gt`, sixtyMinutes, oneHourLit)).toBe(false)
              expect(evalOp(`lt`, sixtyMinutes, oneHourLit)).toBe(false)
              expect(evalOp(`gte`, sixtyMinutes, oneHourLit)).toBe(true)
              expect(evalOp(`lte`, sixtyMinutes, oneHourLit)).toBe(true)
              expect(evalOp(`eq`, sixtyMinutes, oneHourLit)).toBe(false)
            })
          })

          it(`eq returns false for different Temporal types with overlapping string forms`, () => {
            // PlainDate and PlainDateTime can both stringify to "2024-01-15..." but
            // should compare unequal because the types differ.
            const date = Temporal.PlainDate.from(`2024-01-15`)
            const dateTime = Temporal.PlainDateTime.from(`2024-01-15`)
            // sanity-check the strings share a prefix
            expect(dateTime.toString().startsWith(date.toString())).toBe(true)
            expect(evalOp(`eq`, date, dateTime)).toBe(false)
          })

          it(`gt throws when comparing different Temporal types`, () => {
            // Mixed-type ordering is undefined; surfacing a TypeError beats the
            // string-lex pseudo-comparison Temporal explicitly designs against.
            const date = Temporal.PlainDate.from(`2024-01-15`)
            const dateTime = Temporal.PlainDateTime.from(`2024-01-15T00:00:00`)
            expect(() => evalOp(`gt`, date, dateTime)).toThrow(
              /different types/,
            )
          })
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

        it(`handles and with null value (3-valued logic)`, () => {
          const func = new Func(`and`, [new Value(true), new Value(null)])
          const compiled = compileExpression(func)

          // In 3-valued logic, true AND null = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles and with undefined value (3-valued logic)`, () => {
          const func = new Func(`and`, [new Value(true), new Value(undefined)])
          const compiled = compileExpression(func)

          // In 3-valued logic, true AND undefined = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles and with null and false (3-valued logic)`, () => {
          const func = new Func(`and`, [new Value(null), new Value(false)])
          const compiled = compileExpression(func)

          // In 3-valued logic, null AND false = false
          expect(compiled({})).toBe(false)
        })

        it(`handles and with all true values`, () => {
          const func = new Func(`and`, [new Value(true), new Value(true)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles or with short-circuit evaluation`, () => {
          const func = new Func(`or`, [
            new Value(true),
            new Func(`divide`, [new Value(1), new Value(0)]), // This would return null, but shouldn't be evaluated
          ])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(true)
        })

        it(`handles or with null value (3-valued logic)`, () => {
          const func = new Func(`or`, [
            new Value(false),
            new Value(0),
            new Value(null),
          ])
          const compiled = compileExpression(func)

          // In 3-valued logic, false OR null = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles or with undefined value (3-valued logic)`, () => {
          const func = new Func(`or`, [
            new Value(false),
            new Value(0),
            new Value(undefined),
          ])
          const compiled = compileExpression(func)
          // In 3-valued logic, false OR undefined = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles or with null and true (3-valued logic)`, () => {
          const func = new Func(`or`, [new Value(null), new Value(true)])
          const compiled = compileExpression(func)

          // In 3-valued logic, null OR true = true
          expect(compiled({})).toBe(true)
        })

        it(`handles or with all false values`, () => {
          const func = new Func(`or`, [new Value(false), new Value(0)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles not with null value (3-valued logic)`, () => {
          const func = new Func(`not`, [new Value(null)])
          const compiled = compileExpression(func)

          // In 3-valued logic, NOT null = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles not with undefined value (3-valued logic)`, () => {
          const func = new Func(`not`, [new Value(undefined)])
          const compiled = compileExpression(func)

          // In 3-valued logic, NOT undefined = null (UNKNOWN)
          expect(compiled({})).toBe(null)
        })

        it(`handles not with true value`, () => {
          const func = new Func(`not`, [new Value(true)])
          const compiled = compileExpression(func)

          expect(compiled({})).toBe(false)
        })

        it(`handles not with false value`, () => {
          const func = new Func(`not`, [new Value(false)])
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
