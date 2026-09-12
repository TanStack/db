import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { serialize } from '../src/pg-serializer'

/**
 * Property-based tests for pg-serializer
 *
 * Key properties:
 * 1. Strings pass through unchanged
 * 2. Finite numbers preserve their whole numeric value without trailing text
 * 3. Booleans serialize to 'true'/'false'
 * 4. null and undefined both serialize to empty string
 * 5. Dates produce valid ISO strings
 * 6. Arrays preserve every element, its type, and its position after decoding
 */

type FiniteArrayValue = string | number | boolean | null

function parseFiniteNumber(text: string): number {
  const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.exec(text)
  // Comparing the full match also rejects a final newline before JavaScript's $.
  if (match?.[0] !== text || !Number.isFinite(Number(text))) {
    throw new Error(`invalid finite numeric output: ${JSON.stringify(text)}`)
  }
  return Number(text)
}

/**
 * Decode the existing serializer's flat finite-value dialect, not arbitrary SQL.
 * Quoted text is distinct from unquoted NULL, boolean, and numeric tokens.
 * Grammar authority: PostgreSQL 18, sections 8.15.2 and 8.15.6:
 * https://www.postgresql.org/docs/18/arrays.html#ARRAYS-IO
 * No casts, nested dimensions, server ranges, or provider NULL policy are modeled.
 */
function parseFiniteArray(text: string): Array<FiniteArrayValue> {
  const values: Array<FiniteArrayValue> = []
  let position = 1
  const invalid = () =>
    new Error(
      `invalid flat array output at ${position}: ${JSON.stringify(text)}`,
    )
  if (text[0] !== `{`) throw invalid()
  if (text === `{}`) return values

  while (position < text.length) {
    if (text[position] === `"`) {
      position++
      let value = ``
      let closed = false
      while (position < text.length) {
        const character = text[position++]!
        if (character === `"`) {
          closed = true
          break
        }
        if (character === `\\`) {
          if (position === text.length) throw invalid()
          value += text[position++]!
        } else {
          value += character
        }
      }
      if (!closed) throw invalid()
      values.push(value)
    } else {
      const start = position
      while (
        position < text.length &&
        text[position] !== `,` &&
        text[position] !== `}`
      )
        position++
      const token = text.slice(start, position)
      if (token === `NULL`) values.push(null)
      else if (token === `true`) values.push(true)
      else if (token === `false`) values.push(false)
      else values.push(parseFiniteNumber(token))
    }

    const separator = text[position++]
    if (separator === `}` && position === text.length) return values
    if (separator !== `,`) throw invalid()
  }
  throw invalid()
}

function expectFiniteArrayContents(
  input: ReadonlyArray<FiniteArrayValue | undefined>,
  output: string,
): void {
  expect(parseFiniteArray(output)).toEqual(input.map((value) => value ?? null))
}

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
      `integers round-trip through strict numeric parsing`,
      (n) => {
        const serialized = serialize(n)
        expect(parseFiniteNumber(serialized)).toBe(n)
      },
    )

    fcTest.prop([
      fc
        .double({ noNaN: true, noDefaultInfinity: true })
        .filter((n) => !Object.is(n, -0)),
    ])(`finite doubles round-trip through strict numeric parsing`, (n) => {
      // Number-to-string conversion loses -0's sign; parsing "-0" does not.
      const serialized = serialize(n)
      expect(parseFiniteNumber(serialized)).toBe(n)
    })

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
        expectFiniteArrayContents(arr, serialized)
      },
    )

    fcTest.prop([fc.array(fc.boolean(), { maxLength: 10 })])(
      `boolean arrays serialize correctly`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
        expectFiniteArrayContents(arr, serialized)
      },
    )

    fcTest.prop([fc.array(fc.constantFrom(null, undefined), { maxLength: 5 })])(
      `arrays with null/undefined serialize to NULL`,
      (arr) => {
        const serialized = serialize(arr)
        expectFiniteArrayContents(arr, serialized)
      },
    )
  })

  describe(`string array escaping`, () => {
    fcTest.prop([fc.array(fc.string(), { maxLength: 5 })])(
      `string arrays are properly quoted`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
        expectFiniteArrayContents(arr, serialized)
      },
    )

    fcTest.prop([
      fc
        .tuple(fc.string(), fc.constantFrom(`"`, `\\`), fc.string())
        .map((parts) => parts.join(``)),
    ])(`strings with special chars are escaped`, (str) => {
      const serialized = serialize([str])
      // Should contain escaped quotes or backslashes
      if (str.includes(`"`)) {
        expect(serialized).toContain(`\\"`)
      }
      if (str.includes(`\\`)) {
        expect(serialized).toContain(`\\\\`)
      }
      expectFiniteArrayContents([str], serialized)
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

  describe(`finite scalar and array checker calibration`, () => {
    it.each([
      [`0`, 0],
      [`-0`, -0],
      [`1.25`, 1.25],
      [`5e-324`, Number.MIN_VALUE],
      [`1.7976931348623157e+308`, Number.MAX_VALUE],
      [`-2.5E-3`, -0.0025],
    ] as const)(`reads the complete finite token %s`, (text, value) => {
      expect(parseFiniteNumber(text)).toBe(value)
    })

    it.each([
      ``,
      ` `,
      `1.25junk`,
      `1.25\n`,
      `1.25 2`,
      `0x10`,
      `NaN`,
      `Infinity`,
      `1e999`,
      `1e`,
      `1.2.3`,
    ])(`rejects the invalid finite numeric token %j`, (text) => {
      expect(() => parseFiniteNumber(text)).toThrow(
        `invalid finite numeric output`,
      )
    })

    const validArrays: Array<{
      name: string
      input: Array<FiniteArrayValue | undefined>
      output: string
    }> = [
      { name: `empty`, input: [], output: `{}` },
      { name: `numbers`, input: [1, 2, -3, 1e21], output: `{1,2,-3,1e+21}` },
      {
        name: `booleans in order`,
        input: [false, true, false],
        output: `{false,true,false}`,
      },
      {
        name: `nullish multiplicity`,
        input: [null, undefined],
        output: `{NULL,NULL}`,
      },
      {
        name: `empty and NULL text`,
        input: [``, `NULL`, `null`],
        output: `{"","NULL","null"}`,
      },
      {
        name: `delimiters and escapes`,
        input: [`a,b`, `{z}`, `a"b`, `c\\d`],
        output: `{"a,b","{z}","a\\"b","c\\\\d"}`,
      },
      {
        name: `whitespace and typed-looking text`,
        input: [` leading `, `line\nbreak`, `0`, `true`],
        output: `{" leading ","line\nbreak","0","true"}`,
      },
    ]
    it.each(validArrays)(
      `decodes the independent $name control and the real serializer`,
      ({ input, output }) => {
        expectFiniteArrayContents(input, output)
        expectFiniteArrayContents(input, serialize(input))
      },
    )

    const corruptArrays: Array<{
      name: string
      input: Array<FiniteArrayValue | undefined>
      output: string
    }> = [
      { name: `all booleans omitted`, input: [true], output: `{}` },
      { name: `one boolean omitted`, input: [true, false], output: `{true}` },
      {
        name: `boolean duplicated`,
        input: [true, false],
        output: `{true,false,false}`,
      },
      {
        name: `booleans reordered`,
        input: [true, false],
        output: `{false,true}`,
      },
      { name: `boolean replaced`, input: [true, false], output: `{true,true}` },
      {
        name: `nullish elements omitted`,
        input: [null, undefined],
        output: `{}`,
      },
      { name: `NULL replaced with text`, input: [null], output: `{"NULL"}` },
      { name: `text replaced with NULL`, input: [`NULL`], output: `{NULL}` },
      { name: `empty text omitted`, input: [``], output: `{}` },
      {
        name: `strings reordered`,
        input: [`left`, `right`],
        output: `{"right","left"}`,
      },
      {
        name: `one required escape omitted`,
        input: [`a"b`, `c\\d`],
        output: `{"a\\"b","cd"}`,
      },
      {
        name: `unrelated escaped content`,
        input: [`a"b`],
        output: `{"unrelated\\"text"}`,
      },
      { name: `numeric suffix`, input: [1.25], output: `{1.25junk}` },
    ]
    it.each(corruptArrays)(`rejects $name`, ({ input, output }) => {
      // The same observer judges production outputs above; these outputs come
      // from test-owned faults, not a mutation of the serializer or its inputs.
      expect(() => expectFiniteArrayContents(input, output)).toThrow()
    })

    it(`shrinks and exactly replays omitted nonempty arrays`, () => {
      const property = fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (input) => expectFiniteArrayContents(input, `{}`),
      )
      const failure = fc.check(property, { seed: 90701, numRuns: 25 })
      expect(failure.failed).toBe(true)
      if (!failure.failed || failure.counterexamplePath === null) {
        throw new Error(`omission fault did not produce a replayable failure`)
      }
      expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
      expect(failure.counterexample[0]).toHaveLength(1)
      const replay = fc.check(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        numRuns: 1,
      })
      expect(replay.failed).toBe(true)
      expect(replay.counterexample).toEqual(failure.counterexample)
      expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
    })

    it.each([
      ``,
      `[]`,
      `{`,
      `}`,
      `{1`,
      `{1,}`,
      `{,1}`,
      `{true,,false}`,
      `{1}tail`,
      `{"unterminated}`,
      `{"a" "b"}`,
      `{"a"b"}`,
      `{"trailing\\`,
    ])(`rejects malformed array output %j`, (output) => {
      expect(() => parseFiniteArray(output)).toThrow()
    })

    fcTest.prop([
      fc.array(
        fc.oneof(
          fc.string(),
          fc
            .double({ noNaN: true, noDefaultInfinity: true })
            .filter((value) => !Object.is(value, -0)),
          fc.boolean(),
          fc.constantFrom(null, undefined),
        ),
        { maxLength: 10 },
      ),
    ])(`mixed finite arrays retain ordered typed contents`, (input) => {
      expectFiniteArrayContents(input, serialize(input))
    })
  })
})
