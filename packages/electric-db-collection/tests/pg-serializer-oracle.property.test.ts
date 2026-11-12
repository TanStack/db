import { describe, expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { serialize } from '../src/pg-serializer'
import { oracleProperty } from '../../db/tests/oracle-property'
import { validArrays } from './pg-serializer-array-controls'
import {
  checkExistingElectricComparison,
  existingElectricComparison,
} from './electric-property-oracle'
import { parseFiniteNumber } from './pg-serializer-finite-decoder'
import {
  expectFiniteArrayContents,
  serializerProp,
} from './pg-serializer-property-oracle'
import type { FiniteArrayValue } from './pg-serializer-finite-decoder'

type ArrayControl = { name: string; input: Array<FiniteArrayValue | undefined> }

// This property has enumerated histories, so leave TANSTACK_DB_ORACLE_UNIT
// unset. Replay one named law with TANSTACK_DB_ORACLE_SEED=<reported seed>,
// TANSTACK_DB_ORACLE_PATH=<reported shrink path>, and
// TANSTACK_DB_ORACLE_PROPERTY=<property name>. Example:
// TANSTACK_DB_ORACLE_SEED=1 TANSTACK_DB_ORACLE_PATH=0 \
// TANSTACK_DB_ORACLE_PROPERTY=pg-serializer.mixed-array-contents \
// pnpm exec vitest run tests/pg-serializer-oracle.property.test.ts

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

describe(`pg-serializer property-based tests`, () => {
  describe(`string serialization`, () => {
    serializerProp(`pg-serializer.string-passthrough`, [fc.string()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`strings pass through unchanged`, (str) => {
      expect(serialize(str)).toBe(str)
    })

    serializerProp(`pg-serializer.string-idempotent`, [fc.string()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`strings are idempotent`, (str) => {
      // serialize(serialize(str)) should equal serialize(str) for strings
      const once = serialize(str)
      const twice = serialize(once)
      expect(twice).toBe(once)
    })
  })

  describe(`number serialization`, () => {
    serializerProp(`pg-serializer.integer-round-trip`, [fc.integer()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`integers round-trip through strict numeric parsing`, (n) => {
      const serialized = serialize(n)
      expect(parseFiniteNumber(serialized)).toBe(n)
    })

    serializerProp(
      `pg-serializer.double-round-trip`,
      [
        fc
          .double({ noNaN: true, noDefaultInfinity: true })
          .filter((n) => !Object.is(n, -0)),
      ],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`finite doubles round-trip through strict numeric parsing`, (n) => {
      // Number-to-string conversion loses -0's sign; parsing "-0" does not.
      const serialized = serialize(n)
      expect(parseFiniteNumber(serialized)).toBe(n)
    })

    serializerProp(`pg-serializer.integer-text`, [fc.integer()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`integers produce numeric strings`, (n) => {
      const serialized = serialize(n)
      expect(serialized).toMatch(/^-?\d+$/)
    })
  })

  describe(`bigint serialization`, () => {
    serializerProp(`pg-serializer.bigint-round-trip`, [fc.bigInt()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`bigints round-trip through BigInt parsing`, (n) => {
      const serialized = serialize(n)
      expect(BigInt(serialized)).toBe(n)
    })

    serializerProp(`pg-serializer.bigint-text`, [fc.bigInt()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`bigints produce integer strings`, (n) => {
      const serialized = serialize(n)
      expect(serialized).toMatch(/^-?\d+$/)
    })
  })

  describe(`boolean serialization`, () => {
    serializerProp(`pg-serializer.boolean-tokens`, [fc.boolean()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`booleans serialize to 'true' or 'false'`, (b) => {
      const serialized = serialize(b)
      expect(serialized).toBe(b ? `true` : `false`)
    })

    serializerProp(`pg-serializer.boolean-round-trip`, [fc.boolean()], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`booleans round-trip through string comparison`, (b) => {
      const serialized = serialize(b)
      expect(serialized === `true`).toBe(b)
    })
  })

  describe(`date serialization`, () => {
    // Use bounded dates to avoid negative years which have different ISO format
    const arbitraryBoundedDate = fc.date({
      noInvalidDate: true,
      min: new Date(`0000-01-01T00:00:00.000Z`),
      max: new Date(`9999-12-31T23:59:59.999Z`),
    })

    serializerProp(`pg-serializer.date-iso`, [arbitraryBoundedDate], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`dates produce valid ISO strings`, (date) => {
      const serialized = serialize(date)
      expect(serialized).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      )
    })

    serializerProp(`pg-serializer.date-round-trip`, [arbitraryBoundedDate], {
      owns: [`src/pg-serializer.ts#serialize`],
    })(`dates round-trip through Date parsing`, (date) => {
      const serialized = serialize(date)
      const parsed = new Date(serialized)
      expect(parsed.getTime()).toBe(date.getTime())
    })
  })

  describe(`array serialization`, () => {
    serializerProp(
      `pg-serializer.integer-array-format`,
      [fc.array(fc.integer(), { maxLength: 10 })],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`integer arrays produce Postgres array format`, (arr) => {
      const serialized = serialize(arr)
      expect(serialized).toMatch(/^\{.*\}$/)
    })

    serializerProp(
      `pg-serializer.integer-array-contents`,
      [fc.array(fc.integer(), { maxLength: 10 })],
      {
        owns: [`src/pg-serializer.ts#serialize`],
        fixed: [
          {
            name: `retains every element at the ten-element array bound`,
            history: Array.from({ length: 10 }, (_, index) => index),
          },
        ],
      },
    )(`integer arrays can be parsed back`, (arr) => {
      const serialized = serialize(arr)
      expectFiniteArrayContents(arr, serialized)
    })

    serializerProp(
      `pg-serializer.boolean-array-contents`,
      [fc.array(fc.boolean(), { maxLength: 10 })],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`boolean arrays serialize correctly`, (arr) => {
      const serialized = serialize(arr)
      expect(serialized).toMatch(/^\{.*\}$/)
      expectFiniteArrayContents(arr, serialized)
    })

    serializerProp(
      `pg-serializer.nullish-array-contents`,
      [fc.array(fc.constantFrom(null, undefined), { maxLength: 5 })],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`arrays with null/undefined serialize to NULL`, (arr) => {
      const serialized = serialize(arr)
      expectFiniteArrayContents(arr, serialized)
    })
  })

  describe(`string array escaping`, () => {
    serializerProp(
      `pg-serializer.string-array-contents`,
      [fc.array(fc.string(), { maxLength: 5 })],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`string arrays are properly quoted`, (arr) => {
      const serialized = serialize(arr)
      expect(serialized).toMatch(/^\{.*\}$/)
      expectFiniteArrayContents(arr, serialized)
    })

    serializerProp(
      `pg-serializer.string-escaping`,
      [
        fc
          .tuple(fc.string(), fc.constantFrom(`"`, `\\`), fc.string())
          .map((parts) => parts.join(``)),
      ],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`strings with special chars are escaped`, (str) => {
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
    serializerProp(
      `pg-serializer.scalar-determinism`,
      [
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.date({ noInvalidDate: true }),
        ),
      ],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`serialize is deterministic`, (val) => {
      const first = serialize(val)
      const second = serialize(val)
      expect(first).toBe(second)
    })

    serializerProp(
      `pg-serializer.array-determinism`,
      [fc.array(fc.integer(), { maxLength: 10 })],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`array serialization is deterministic`, (arr) => {
      const first = serialize(arr)
      const second = serialize(arr)
      expect(first).toBe(second)
    })
  })

  describe(`finite scalar and array checker calibration`, () => {
    serializerProp(
      `pg-serializer.mixed-array-contents`,
      [
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
      ],
      { owns: [`src/pg-serializer.ts#serialize`] },
    )(`mixed finite arrays retain ordered typed contents`, (input) => {
      expectFiniteArrayContents(input, serialize(input))
    })

    // The named controls run the real serializer through the same comparison.
    // The generated string grammar cannot take back every control (it draws
    // no line break), so they are their own enumerated cases;
    // pg-serializer-calibration.test.ts decodes their hand-written outputs.
    oracleProperty({
      id: `pg-serializer.array-controls`,
      owns: [`src/pg-serializer.ts#serialize`],
      law: {
        statement: `Flat finite arrays retain ordered typed contents through the real serializer.`,
        authority: `The established scalar output laws and independent finite-array decoder in pg-serializer-oracle.property.test.ts.`,
        limits: `The seven named finite-array controls; no PostgreSQL acceptance or Electric provider casting claim.`,
      },
      histories: validArrays.map(({ name, input }) => ({ name, input })),
      label: ({ name }) =>
        `decodes the independent ${name} control and the real serializer`,
      ...existingElectricComparison(
        `pg-serializer.array-controls`,
        ({ input }: ArrayControl) =>
          expectFiniteArrayContents(input, serialize(input)),
      ),
      check: checkExistingElectricComparison,
    })
  })
})
