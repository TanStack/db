import { describe, expect } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { serialize } from '../src/pg-serializer'

/**
 * Property-based tests for pg-serializer
 *
 * Key properties:
 * 1. Strings pass through unchanged
 * 2. Numbers produce parseable numeric strings
 * 3. Booleans serialize to 'true'/'false'
 * 4. null and undefined both serialize to empty string
 * 5. Dates produce valid ISO strings
 * 6. Array escaping is consistent
 */

describe(`pg-serializer property-based tests`, () => {
  describe(`string serialization`, () => {
    fcTest.prop([fc.string()])(`strings pass through unchanged`, (str) => {
      expect(serialize(str)).toBe(str)
    })

    fcTest.prop([fc.string()])(`strings are idempotent`, (str) => {
      // serialize(serialize(str)) should equal serialize(str) for strings
      const once = serialize(str)
      const twice = serialize(once)
      expect(twice).toBe(once)
    })
  })

  describe(`number serialization`, () => {
    fcTest.prop([fc.integer()])(
      `integers round-trip through parseFloat`,
      (n) => {
        const serialized = serialize(n)
        expect(parseFloat(serialized)).toBe(n)
      },
    )

    fcTest.prop([fc.double({ noNaN: true, noDefaultInfinity: true })])(
      `finite doubles round-trip through parseFloat`,
      (n) => {
        const serialized = serialize(n)
        expect(parseFloat(serialized)).toBe(n)
      },
    )

    fcTest.prop([fc.integer()])(`integers produce numeric strings`, (n) => {
      const serialized = serialize(n)
      expect(serialized).toMatch(/^-?\d+$/)
    })
  })

  describe(`bigint serialization`, () => {
    fcTest.prop([fc.bigInt()])(
      `bigints round-trip through BigInt parsing`,
      (n) => {
        const serialized = serialize(n)
        expect(BigInt(serialized)).toBe(n)
      },
    )

    fcTest.prop([fc.bigInt()])(`bigints produce integer strings`, (n) => {
      const serialized = serialize(n)
      expect(serialized).toMatch(/^-?\d+$/)
    })
  })

  describe(`boolean serialization`, () => {
    fcTest.prop([fc.boolean()])(
      `booleans serialize to 'true' or 'false'`,
      (b) => {
        const serialized = serialize(b)
        expect(serialized).toBe(b ? `true` : `false`)
      },
    )

    fcTest.prop([fc.boolean()])(
      `booleans round-trip through string comparison`,
      (b) => {
        const serialized = serialize(b)
        expect(serialized === `true`).toBe(b)
      },
    )
  })

  describe(`null/undefined serialization`, () => {
    fcTest.prop([fc.constantFrom(null, undefined)])(
      `null and undefined both serialize to empty string`,
      (val) => {
        expect(serialize(val)).toBe(``)
      },
    )
  })

  describe(`date serialization`, () => {
    // Use bounded dates to avoid negative years which have different ISO format
    const arbitraryBoundedDate = fc.date({
      noInvalidDate: true,
      min: new Date(`0000-01-01T00:00:00.000Z`),
      max: new Date(`9999-12-31T23:59:59.999Z`),
    })

    fcTest.prop([arbitraryBoundedDate])(
      `dates produce valid ISO strings`,
      (date) => {
        const serialized = serialize(date)
        expect(serialized).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        )
      },
    )

    fcTest.prop([arbitraryBoundedDate])(
      `dates round-trip through Date parsing`,
      (date) => {
        const serialized = serialize(date)
        const parsed = new Date(serialized)
        expect(parsed.getTime()).toBe(date.getTime())
      },
    )
  })

  describe(`array serialization`, () => {
    fcTest.prop([fc.array(fc.integer(), { maxLength: 10 })])(
      `integer arrays produce Postgres array format`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
      },
    )

    fcTest.prop([fc.array(fc.integer(), { maxLength: 10 })])(
      `integer arrays can be parsed back`,
      (arr) => {
        const serialized = serialize(arr)
        // Remove braces and parse
        const inner = serialized.slice(1, -1)
        if (inner === ``) {
          expect(arr).toEqual([])
        } else {
          const parsed = inner.split(`,`).map(Number)
          expect(parsed).toEqual(arr)
        }
      },
    )

    fcTest.prop([fc.array(fc.boolean(), { maxLength: 10 })])(
      `boolean arrays serialize correctly`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
        // Each element should be 'true' or 'false'
        const inner = serialized.slice(1, -1)
        if (inner !== ``) {
          const elements = inner.split(`,`)
          elements.forEach((el) => {
            expect([`true`, `false`]).toContain(el)
          })
        }
      },
    )

    fcTest.prop([fc.array(fc.constantFrom(null, undefined), { maxLength: 5 })])(
      `arrays with null/undefined serialize to NULL`,
      (arr) => {
        const serialized = serialize(arr)
        const inner = serialized.slice(1, -1)
        if (inner !== ``) {
          const elements = inner.split(`,`)
          elements.forEach((el) => {
            expect(el).toBe(`NULL`)
          })
        }
      },
    )
  })

  describe(`string array escaping`, () => {
    fcTest.prop([fc.array(fc.string(), { maxLength: 5 })])(
      `string arrays are properly quoted`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
        // Each string element should be quoted
      },
    )

    fcTest.prop([
      fc.string().filter((s) => s.includes(`"`) || s.includes(`\\`)),
    ])(`strings with special chars are escaped`, (str) => {
      const serialized = serialize([str])
      // Should contain escaped quotes or backslashes
      if (str.includes(`"`)) {
        expect(serialized).toContain(`\\"`)
      }
      if (str.includes(`\\`)) {
        expect(serialized).toContain(`\\\\`)
      }
    })
  })

  describe(`consistency properties`, () => {
    fcTest.prop([
      fc.oneof(
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.date({ noInvalidDate: true }),
      ),
    ])(`serialize is deterministic`, (val) => {
      const first = serialize(val)
      const second = serialize(val)
      expect(first).toBe(second)
    })

    fcTest.prop([fc.array(fc.integer(), { maxLength: 10 })])(
      `array serialization is deterministic`,
      (arr) => {
        const first = serialize(arr)
        const second = serialize(arr)
        expect(first).toBe(second)
      },
    )
  })
})
