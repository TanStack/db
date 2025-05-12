import { describe, expect, it } from "vitest"
import { evaluateFunction, isFunctionCall } from "../../src/query/functions.js"

describe(`Query > Functions`, () => {
  describe(`isFunctionCall`, () => {
    it(`identifies valid function calls`, () => {
      expect(isFunctionCall({ UPPER: `@name` })).toBe(true)
      expect(isFunctionCall({ LOWER: `@description` })).toBe(true)
      expect(isFunctionCall({ LENGTH: `@text` })).toBe(true)
      expect(isFunctionCall({ DATE: `@dateColumn` })).toBe(true)
    })

    it(`rejects invalid function calls`, () => {
      expect(isFunctionCall(null)).toBe(false)
      expect(isFunctionCall(undefined)).toBe(false)
      expect(isFunctionCall(`string`)).toBe(false)
      expect(isFunctionCall(42)).toBe(false)
      expect(isFunctionCall({})).toBe(false)
      expect(isFunctionCall({ notAFunction: `value` })).toBe(false)
      expect(isFunctionCall({ UPPER: `@name`, LOWER: `@name` })).toBe(false) // Multiple keys
    })
  })

  describe(`Function implementations`, () => {
    describe(`UPPER`, () => {
      it(`converts a string to uppercase`, () => {
        expect(evaluateFunction(`UPPER`, `hello`)).toBe(`HELLO`)
        expect(evaluateFunction(`UPPER`, `Hello World`)).toBe(`HELLO WORLD`)
        expect(evaluateFunction(`UPPER`, `mixed CASE`)).toBe(`MIXED CASE`)
      })

      it(`throws an error when argument is not a string`, () => {
        expect(() => evaluateFunction(`UPPER`, 123)).toThrow(
          `UPPER function expects a string argument`
        )
        expect(() => evaluateFunction(`UPPER`, null)).toThrow(
          `UPPER function expects a string argument`
        )
        expect(() => evaluateFunction(`UPPER`, undefined)).toThrow(
          `UPPER function expects a string argument`
        )
        expect(() => evaluateFunction(`UPPER`, {})).toThrow(
          `UPPER function expects a string argument`
        )
      })
    })

    describe(`LOWER`, () => {
      it(`converts a string to lowercase`, () => {
        expect(evaluateFunction(`LOWER`, `HELLO`)).toBe(`hello`)
        expect(evaluateFunction(`LOWER`, `Hello World`)).toBe(`hello world`)
        expect(evaluateFunction(`LOWER`, `mixed CASE`)).toBe(`mixed case`)
      })

      it(`throws an error when argument is not a string`, () => {
        expect(() => evaluateFunction(`LOWER`, 123)).toThrow(
          `LOWER function expects a string argument`
        )
        expect(() => evaluateFunction(`LOWER`, null)).toThrow(
          `LOWER function expects a string argument`
        )
        expect(() => evaluateFunction(`LOWER`, undefined)).toThrow(
          `LOWER function expects a string argument`
        )
        expect(() => evaluateFunction(`LOWER`, {})).toThrow(
          `LOWER function expects a string argument`
        )
      })
    })

    describe(`LENGTH`, () => {
      it(`returns the length of a string`, () => {
        expect(evaluateFunction(`LENGTH`, ``)).toBe(0)
        expect(evaluateFunction(`LENGTH`, `hello`)).toBe(5)
        expect(evaluateFunction(`LENGTH`, `Hello World`)).toBe(11)
        expect(evaluateFunction(`LENGTH`, `   `)).toBe(3)
      })

      it(`returns the length of an array`, () => {
        expect(evaluateFunction(`LENGTH`, [])).toBe(0)
        expect(evaluateFunction(`LENGTH`, [1, 2, 3])).toBe(3)
        expect(evaluateFunction(`LENGTH`, [`a`, `b`, `c`, `d`, `e`])).toBe(5)
        expect(evaluateFunction(`LENGTH`, [null, undefined])).toBe(2)
      })

      it(`throws an error when argument is not a string or array`, () => {
        expect(() => evaluateFunction(`LENGTH`, 123)).toThrow(
          `LENGTH function expects a string or array argument`
        )
        expect(() => evaluateFunction(`LENGTH`, null)).toThrow(
          `LENGTH function expects a string or array argument`
        )
        expect(() => evaluateFunction(`LENGTH`, undefined)).toThrow(
          `LENGTH function expects a string or array argument`
        )
        expect(() => evaluateFunction(`LENGTH`, {})).toThrow(
          `LENGTH function expects a string or array argument`
        )
      })
    })

    describe(`CONCAT`, () => {
      it(`concatenates multiple strings`, () => {
        expect(evaluateFunction(`CONCAT`, [`Hello`, ` `, `World`])).toBe(
          `Hello World`
        )
        expect(evaluateFunction(`CONCAT`, [`a`, `b`, `c`, `d`])).toBe(`abcd`)
        expect(evaluateFunction(`CONCAT`, [`Prefix-`, null, `-Suffix`])).toBe(
          `Prefix--Suffix`
        )
        expect(evaluateFunction(`CONCAT`, [`Start-`, undefined, `-End`])).toBe(
          `Start--End`
        )
        expect(evaluateFunction(`CONCAT`, [])).toBe(``)
        expect(evaluateFunction(`CONCAT`, [`SingleString`])).toBe(
          `SingleString`
        )
      })

      it(`throws an error when argument is not an array`, () => {
        expect(() => evaluateFunction(`CONCAT`, `not an array`)).toThrow(
          `CONCAT function expects an array of string arguments`
        )
        expect(() => evaluateFunction(`CONCAT`, 123)).toThrow(
          `CONCAT function expects an array of string arguments`
        )
        expect(() => evaluateFunction(`CONCAT`, null)).toThrow(
          `CONCAT function expects an array of string arguments`
        )
        expect(() => evaluateFunction(`CONCAT`, undefined)).toThrow(
          `CONCAT function expects an array of string arguments`
        )
        expect(() => evaluateFunction(`CONCAT`, {})).toThrow(
          `CONCAT function expects an array of string arguments`
        )
      })

      it(`throws an error when array contains non-string values (except null/undefined)`, () => {
        expect(() => evaluateFunction(`CONCAT`, [`text`, 123])).toThrow(
          `CONCAT function expects all arguments to be strings`
        )
        expect(() => evaluateFunction(`CONCAT`, [`text`, {}])).toThrow(
          `CONCAT function expects all arguments to be strings`
        )
        expect(() => evaluateFunction(`CONCAT`, [true, `text`])).toThrow(
          `CONCAT function expects all arguments to be strings`
        )
      })
    })

    describe(`COALESCE`, () => {
      it(`returns the first non-null value`, () => {
        expect(evaluateFunction(`COALESCE`, [null, `value`, `ignored`])).toBe(
          `value`
        )
        expect(
          evaluateFunction(`COALESCE`, [undefined, null, 42, `ignored`])
        ).toBe(42)
        expect(evaluateFunction(`COALESCE`, [null, undefined, `default`])).toBe(
          `default`
        )
        expect(evaluateFunction(`COALESCE`, [`first`, null, `ignored`])).toBe(
          `first`
        )
        expect(evaluateFunction(`COALESCE`, [0, null, `ignored`])).toBe(0)
        expect(evaluateFunction(`COALESCE`, [false, null, `ignored`])).toBe(
          false
        )
      })

      it(`returns null if all values are null or undefined`, () => {
        expect(evaluateFunction(`COALESCE`, [null, undefined, null])).toBe(null)
        expect(evaluateFunction(`COALESCE`, [undefined])).toBe(null)
        expect(evaluateFunction(`COALESCE`, [null])).toBe(null)
        expect(evaluateFunction(`COALESCE`, [])).toBe(null)
      })

      it(`throws an error when argument is not an array`, () => {
        expect(() => evaluateFunction(`COALESCE`, `not an array`)).toThrow(
          `COALESCE function expects an array of arguments`
        )
        expect(() => evaluateFunction(`COALESCE`, 123)).toThrow(
          `COALESCE function expects an array of arguments`
        )
        expect(() => evaluateFunction(`COALESCE`, null)).toThrow(
          `COALESCE function expects an array of arguments`
        )
        expect(() => evaluateFunction(`COALESCE`, undefined)).toThrow(
          `COALESCE function expects an array of arguments`
        )
        expect(() => evaluateFunction(`COALESCE`, {})).toThrow(
          `COALESCE function expects an array of arguments`
        )
      })
    })

    describe(`DATE`, () => {
      it(`returns a Date object when given a valid string date`, () => {
        const result = evaluateFunction(`DATE`, `2023-01-15`)
        expect(result).toBeInstanceOf(Date)
        expect((result as Date).getFullYear()).toBe(2023)
        expect((result as Date).getMonth()).toBe(0) // January = 0
        expect((result as Date).getUTCDate()).toBe(15)

        // Test other date formats
        const isoResult = evaluateFunction(`DATE`, `2023-02-20T12:30:45Z`)
        expect(isoResult).toBeInstanceOf(Date)
        expect((isoResult as Date).getUTCFullYear()).toBe(2023)
        expect((isoResult as Date).getUTCMonth()).toBe(1) // February = 1
        expect((isoResult as Date).getUTCDate()).toBe(20)
        expect((isoResult as Date).getUTCHours()).toBe(12)
        expect((isoResult as Date).getUTCMinutes()).toBe(30)
      })

      it(`returns a Date object when given a timestamp number`, () => {
        const timestamp = 1609459200000 // 2021-01-01T00:00:00Z
        const result = evaluateFunction(`DATE`, timestamp)
        expect(result).toBeInstanceOf(Date)
        expect((result as Date).getTime()).toBe(timestamp)
      })

      it(`returns the same Date object when given a Date object`, () => {
        const date = new Date(`2023-05-10`)
        const result = evaluateFunction(`DATE`, date)
        expect(result).toBeInstanceOf(Date)
        expect(result).toBe(date) // Should be the same reference
      })

      it(`returns null when given null or undefined`, () => {
        expect(evaluateFunction(`DATE`, null)).toBe(null)
        expect(evaluateFunction(`DATE`, undefined)).toBe(null)
      })

      it(`throws an error when given an invalid date string`, () => {
        expect(() => evaluateFunction(`DATE`, `not-a-date`)).toThrow(
          `DATE function could not parse`
        )
        expect(() => evaluateFunction(`DATE`, `2023/99/99`)).toThrow(
          `DATE function could not parse`
        )
      })

      it(`throws an error when given non-date compatible types`, () => {
        expect(() => evaluateFunction(`DATE`, {})).toThrow(
          `DATE function expects a string, number, or Date argument`
        )
        expect(() => evaluateFunction(`DATE`, [])).toThrow(
          `DATE function expects a string, number, or Date argument`
        )
        expect(() => evaluateFunction(`DATE`, true)).toThrow(
          `DATE function expects a string, number, or Date argument`
        )
      })
    })

    describe(`JSON_EXTRACT`, () => {
      const testJson = `{"user": {"name": "John", "profile": {"age": 30, "roles": ["admin", "editor"]}}}`

      it(`extracts values from JSON using a path`, () => {
        // Extract entire object
        expect(evaluateFunction(`JSON_EXTRACT`, [testJson])).toEqual({
          user: {
            name: `John`,
            profile: {
              age: 30,
              roles: [`admin`, `editor`],
            },
          },
        })

        // Extract nested object
        expect(evaluateFunction(`JSON_EXTRACT`, [testJson, `user`])).toEqual({
          name: `John`,
          profile: {
            age: 30,
            roles: [`admin`, `editor`],
          },
        })

        // Extract simple property
        expect(
          evaluateFunction(`JSON_EXTRACT`, [testJson, `user`, `name`])
        ).toBe(`John`)

        // Extract from deeply nested path
        expect(
          evaluateFunction(`JSON_EXTRACT`, [testJson, `user`, `profile`, `age`])
        ).toBe(30)

        // Extract array
        expect(
          evaluateFunction(`JSON_EXTRACT`, [
            testJson,
            `user`,
            `profile`,
            `roles`,
          ])
        ).toEqual([`admin`, `editor`])

        // Extract from array
        expect(
          evaluateFunction(`JSON_EXTRACT`, [
            testJson,
            `user`,
            `profile`,
            `roles`,
            `0`,
          ])
        ).toBe(`admin`)
      })

      it(`works with JS objects as input`, () => {
        const jsObject = { product: { id: 123, details: { price: 99.99 } } }

        expect(evaluateFunction(`JSON_EXTRACT`, [jsObject])).toEqual(jsObject)
        expect(
          evaluateFunction(`JSON_EXTRACT`, [jsObject, `product`, `id`])
        ).toBe(123)
        expect(
          evaluateFunction(`JSON_EXTRACT`, [
            jsObject,
            `product`,
            `details`,
            `price`,
          ])
        ).toBe(99.99)
      })

      it(`returns null for non-existent paths`, () => {
        expect(
          evaluateFunction(`JSON_EXTRACT`, [testJson, `nonexistent`])
        ).toBe(null)
        expect(
          evaluateFunction(`JSON_EXTRACT`, [testJson, `user`, `nonexistent`])
        ).toBe(null)
        expect(
          evaluateFunction(`JSON_EXTRACT`, [
            testJson,
            `user`,
            `name`,
            `nonexistent`,
          ])
        ).toBe(null)
      })

      it(`returns null when input is null or undefined`, () => {
        expect(evaluateFunction(`JSON_EXTRACT`, [null])).toBe(null)
        expect(evaluateFunction(`JSON_EXTRACT`, [undefined])).toBe(null)
      })

      it(`throws an error when input is invalid JSON`, () => {
        expect(() =>
          evaluateFunction(`JSON_EXTRACT`, [`{invalid:json}`])
        ).toThrow(`JSON_EXTRACT function could not parse JSON string`)
      })

      it(`throws an error when arguments are invalid`, () => {
        expect(() => evaluateFunction(`JSON_EXTRACT`, `not-an-array`)).toThrow(
          `JSON_EXTRACT function expects an array`
        )
        expect(() => evaluateFunction(`JSON_EXTRACT`, [])).toThrow(
          `JSON_EXTRACT function expects an array with at least one element`
        )
        expect(() => evaluateFunction(`JSON_EXTRACT`, [testJson, 123])).toThrow(
          `JSON_EXTRACT function expects path elements to be strings`
        )
      })
    })

    describe(`JSON_EXTRACT_PATH`, () => {
      it(`works as an alias for JSON_EXTRACT`, () => {
        const testObj = { data: { value: 42 } }

        // Compare results from both function names with the same inputs
        const extractResult = evaluateFunction(`JSON_EXTRACT`, [
          testObj,
          `data`,
          `value`,
        ])
        const extractPathResult = evaluateFunction(`JSON_EXTRACT_PATH`, [
          testObj,
          `data`,
          `value`,
        ])

        expect(extractPathResult).toEqual(extractResult)
        expect(extractPathResult).toBe(42)
      })
    })
  })

  describe(`Function stubs`, () => {
    it(`throws "not implemented" for remaining non-aggregate functions`, () => {
      // All functions are now implemented!
    })
  })
})
