import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { serialize } from '../src/pg-serializer'

// Replay one named law directly with PG_SERIALIZER_ORACLE_PROPERTY=<test name>,
// PG_SERIALIZER_ORACLE_SEED=<reported seed>, and
// PG_SERIALIZER_ORACLE_PATH=<reported shrink path>.
// Example: pnpm exec vitest run tests/pg-serializer-oracle.property.test.ts -t 'mixed finite arrays retain ordered typed contents'
const replayProperty = process.env.PG_SERIALIZER_ORACLE_PROPERTY
const replaySeedText = process.env.PG_SERIALIZER_ORACLE_SEED
const replayPath = process.env.PG_SERIALIZER_ORACLE_PATH
const runsText = process.env.PG_SERIALIZER_ORACLE_RUNS ?? `100`
const runs = Number(runsText)
const registeredProperties = new Set<string>()
const example = replayProperty === undefined ? it : it.skip

if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error(`PG_SERIALIZER_ORACLE_RUNS must be a positive integer`)
}
if (
  replayProperty === undefined &&
  (replaySeedText !== undefined || replayPath !== undefined)
) {
  throw new Error(`PostgreSQL serializer replay requires a property name`)
}
if (
  replayProperty !== undefined &&
  (replaySeedText === undefined || replayPath === undefined)
) {
  throw new Error(`PostgreSQL serializer replay requires seed and path`)
}
const replaySeed =
  replaySeedText === undefined ? undefined : Number(replaySeedText)
if (
  replaySeedText !== undefined &&
  (replaySeedText.trim() === `` || !Number.isSafeInteger(replaySeed))
) {
  throw new Error(`PG_SERIALIZER_ORACLE_SEED must be an integer`)
}
if (replayPath !== undefined && !/^\d+(?::\d+)*$/.test(replayPath)) {
  throw new Error(
    `PG_SERIALIZER_ORACLE_PATH must contain colon-separated nonnegative integers`,
  )
}

function serializerReplayOptions(
  seed: number | undefined,
  path: string | undefined,
) {
  return { numRuns: runs, seed, path }
}

function serializerProp<T>([arbitrary]: [fc.Arbitrary<T>]) {
  return (name: string, check: (value: T) => void): void => {
    if (registeredProperties.has(name)) {
      throw new Error(`duplicate PostgreSQL serializer property: ${name}`)
    }
    registeredProperties.add(name)
    if (replayProperty === undefined) {
      fcTest.prop([arbitrary], { numRuns: runs, seed: 20260930 })(
        `${name} (fixed)`,
        check,
      )
      fcTest.prop([arbitrary], { numRuns: runs })(`${name} (random)`, check)
      return
    }
    if (replayProperty === name) {
      fcTest.prop([arbitrary], serializerReplayOptions(replaySeed, replayPath))(
        `${name} (replay)`,
        check,
      )
    } else {
      // Vitest requires each describe block to register at least one test.
      it.skip(`${name} (not requested)`, () => {})
    }
  }
}

/**
 * # Does PostgreSQL text serialization preserve the supported value domain?
 *
 * Established scalar output examples in pg-serializer.test.ts and PostgreSQL's
 * array text grammar supply the contract; this file extends those examples to
 * generated values. Scalars have direct laws: strings pass through, finite
 * numbers round-trip through strict numeric parsing, booleans use PostgreSQL
 * tokens, nullish values become empty text, and Dates produce valid ISO
 * strings. Flat arrays preserve every element, type, position, quote, slash,
 * comma, brace, and null marker.
 *
 * The decoder below is an independent parser for this finite output dialect,
 * not PostgreSQL or a copy of the serializer. Generated values compare decoded
 * output with the input. Each input is a one-call history: the driver calls
 * production serialize(), and the refinement check observes its complete
 * returned text when that call returns. Corrupt-output controls and
 * shrink/replay checks prove the parser and properties reject omissions and
 * malformed tokens. This does not establish Electric's provider casting or
 * server acceptance; the real-provider SQL suites own that boundary.
 *
 * The one-call input grammar varies scalar kind and value, and flat array
 * length (0–10 for numeric, boolean, and mixed arrays; 0–5 for text and
 * nullish arrays), element kind, element order, nullish presence, and quoted
 * text containing delimiters, quotes, backslashes, or whitespace. The named
 * controls below reconstruct empty, singleton, repeated, mixed, and escaped
 * arrays. Removing an element, reversing distinct elements, replacing a NULL
 * token with quoted text, or losing an escape changes the observed value, so
 * each corresponding axis contributes to the law. Bounded Date inputs run
 * from years 0000 through 9999; finite doubles exclude negative zero because
 * JavaScript's number-to-string conversion loses its sign. Nested arrays,
 * nonfinite numbers, unsupported objects, and provider casts are outside this
 * flat finite-value model. Malformed array text is a nearby rejected output.
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
    serializerProp([fc.string()])(`strings pass through unchanged`, (str) => {
      expect(serialize(str)).toBe(str)
    })

    serializerProp([fc.string()])(`strings are idempotent`, (str) => {
      // serialize(serialize(str)) should equal serialize(str) for strings
      const once = serialize(str)
      const twice = serialize(once)
      expect(twice).toBe(once)
    })
  })

  describe(`number serialization`, () => {
    serializerProp([fc.integer()])(
      `integers round-trip through strict numeric parsing`,
      (n) => {
        const serialized = serialize(n)
        expect(parseFiniteNumber(serialized)).toBe(n)
      },
    )

    serializerProp([
      fc
        .double({ noNaN: true, noDefaultInfinity: true })
        .filter((n) => !Object.is(n, -0)),
    ])(`finite doubles round-trip through strict numeric parsing`, (n) => {
      // Number-to-string conversion loses -0's sign; parsing "-0" does not.
      const serialized = serialize(n)
      expect(parseFiniteNumber(serialized)).toBe(n)
    })

    serializerProp([fc.integer()])(`integers produce numeric strings`, (n) => {
      const serialized = serialize(n)
      expect(serialized).toMatch(/^-?\d+$/)
    })
  })

  describe(`bigint serialization`, () => {
    serializerProp([fc.bigInt()])(
      `bigints round-trip through BigInt parsing`,
      (n) => {
        const serialized = serialize(n)
        expect(BigInt(serialized)).toBe(n)
      },
    )

    serializerProp([fc.bigInt()])(`bigints produce integer strings`, (n) => {
      const serialized = serialize(n)
      expect(serialized).toMatch(/^-?\d+$/)
    })
  })

  describe(`boolean serialization`, () => {
    serializerProp([fc.boolean()])(
      `booleans serialize to 'true' or 'false'`,
      (b) => {
        const serialized = serialize(b)
        expect(serialized).toBe(b ? `true` : `false`)
      },
    )

    serializerProp([fc.boolean()])(
      `booleans round-trip through string comparison`,
      (b) => {
        const serialized = serialize(b)
        expect(serialized === `true`).toBe(b)
      },
    )
  })

  describe(`null/undefined serialization`, () => {
    serializerProp([fc.constantFrom(null, undefined)])(
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

    example.each([
      [new Date(`0000-01-01T00:00:00.000Z`), `0000-01-01T00:00:00.000Z`],
      [new Date(`9999-12-31T23:59:59.999Z`), `9999-12-31T23:59:59.999Z`],
    ] as const)(`serializes the bounded Date endpoint %s`, (date, text) => {
      expect(serialize(date)).toBe(text)
    })

    serializerProp([arbitraryBoundedDate])(
      `dates produce valid ISO strings`,
      (date) => {
        const serialized = serialize(date)
        expect(serialized).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        )
      },
    )

    serializerProp([arbitraryBoundedDate])(
      `dates round-trip through Date parsing`,
      (date) => {
        const serialized = serialize(date)
        const parsed = new Date(serialized)
        expect(parsed.getTime()).toBe(date.getTime())
      },
    )
  })

  describe(`array serialization`, () => {
    example(`retains every element at the ten-element array bound`, () => {
      const input = Array.from({ length: 10 }, (_, index) => index)
      expectFiniteArrayContents(input, serialize(input))
    })

    serializerProp([fc.array(fc.integer(), { maxLength: 10 })])(
      `integer arrays produce Postgres array format`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
      },
    )

    serializerProp([fc.array(fc.integer(), { maxLength: 10 })])(
      `integer arrays can be parsed back`,
      (arr) => {
        const serialized = serialize(arr)
        expectFiniteArrayContents(arr, serialized)
      },
    )

    serializerProp([fc.array(fc.boolean(), { maxLength: 10 })])(
      `boolean arrays serialize correctly`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
        expectFiniteArrayContents(arr, serialized)
      },
    )

    serializerProp([
      fc.array(fc.constantFrom(null, undefined), { maxLength: 5 }),
    ])(`arrays with null/undefined serialize to NULL`, (arr) => {
      const serialized = serialize(arr)
      expectFiniteArrayContents(arr, serialized)
    })
  })

  describe(`string array escaping`, () => {
    serializerProp([fc.array(fc.string(), { maxLength: 5 })])(
      `string arrays are properly quoted`,
      (arr) => {
        const serialized = serialize(arr)
        expect(serialized).toMatch(/^\{.*\}$/)
        expectFiniteArrayContents(arr, serialized)
      },
    )

    serializerProp([
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
    serializerProp([
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

    serializerProp([fc.array(fc.integer(), { maxLength: 10 })])(
      `array serialization is deterministic`,
      (arr) => {
        const first = serialize(arr)
        const second = serialize(arr)
        expect(first).toBe(second)
      },
    )
  })

  describe(`finite scalar and array checker calibration`, () => {
    example.each([
      [`0`, 0],
      [`-0`, -0],
      [`1.25`, 1.25],
      [`5e-324`, Number.MIN_VALUE],
      [`1.7976931348623157e+308`, Number.MAX_VALUE],
      [`-2.5E-3`, -0.0025],
    ] as const)(`reads the complete finite token %s`, (text, value) => {
      expect(parseFiniteNumber(text)).toBe(value)
    })

    example.each([
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
    example.each(validArrays)(
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
    example.each(corruptArrays)(`rejects $name`, ({ input, output }) => {
      // The same observer judges production outputs above; these outputs come
      // from test-owned faults, not a mutation of the serializer or its inputs.
      expect(() => expectFiniteArrayContents(input, output)).toThrow()
    })

    example(`shrinks and exactly replays omitted nonempty arrays`, () => {
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
      const replay = fc.check(
        property,
        serializerReplayOptions(failure.seed, failure.counterexamplePath),
      )
      expect(replay.failed).toBe(true)
      expect(replay.counterexample).toEqual(failure.counterexample)
      expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
    })

    example.each([
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

    serializerProp([
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
