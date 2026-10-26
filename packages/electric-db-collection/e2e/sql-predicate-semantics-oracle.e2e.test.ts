import { fc } from '@fast-check/vitest'
import electricClientPackage from '@electric-sql/client/package.json'
import { IR } from '@tanstack/db'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { compileSQL } from '../src/sql-compiler'
import type { Client } from 'pg'

type Row = {
  id: number
  count: number | null
  label: string | null
  enabled: boolean | null
}

type Column = `count` | `label` | `enabled`
type Comparable = number | string | boolean
type Comparison = `eq` | `gt` | `gte` | `lt` | `lte`
type Truth = boolean | null
type Predicate =
  | { type: `compare`; op: Comparison; column: Column; value: Comparable }
  | { type: `isNull`; column: Column }
  | { type: `not`; value: Predicate }
  | { type: `and`; left: Predicate; right: Predicate }
  | { type: `or`; left: Predicate; right: Predicate }
  | {
      type: `test`
      op: `eq` | `in` | `isNull`
      value: Predicate
      expected: boolean
      both: boolean
    }

/*
Compiler contract inventory:

| Contract                         | Focused owner             | Semantic owner |
| -------------------------------- | ------------------------- | -------------- |
| comparison operators and values  | sql-compiler.test.ts      | this suite     |
| Boolean grouping                 | sql-compiler.test.ts      | this suite     |
| IS NULL / SQL three-valued logic | sql-compiler.test.ts      | this suite     |
| parameter binding and quoting    | sql-compiler.test.ts      | this suite     |
| stable wire text and name mapping| sql-compiler.test.ts      | focused only   |
| unsupported expressions/errors   | sql-compiler.test.ts      | focused only   |

This suite sends the compiler's emitted SQL and serialized parameters to
PostgreSQL, then compares selected IDs with a separately specified finite
three-valued evaluator. The focused-only rows are intentionally not inferred
from semantic equality.
*/

const electricClientVersion = electricClientPackage.version

const integerComparison = fc.record({
  type: fc.constant(`compare` as const),
  op: fc.constantFrom<Comparison>(`eq`, `gt`, `gte`, `lt`, `lte`),
  column: fc.constant(`count` as const),
  value: fc.integer({ min: -2, max: 2 }),
})
const stringComparison = fc.record({
  type: fc.constant(`compare` as const),
  // Text ordering depends on the database collation; equality does not.
  op: fc.constant(`eq` as const),
  column: fc.constant(`label` as const),
  value: fc.constantFrom(``, `a`, `b`, `O'Reilly`, `"quoted"`),
})
const booleanComparison = fc.record({
  type: fc.constant(`compare` as const),
  op: fc.constant(`eq` as const),
  column: fc.constant(`enabled` as const),
  value: fc.boolean(),
})
const nullCheck = fc.record({
  type: fc.constant(`isNull` as const),
  column: fc.constantFrom<Column>(`count`, `label`, `enabled`),
})
const leaf = fc.oneof(
  integerComparison,
  stringComparison,
  booleanComparison,
  nullCheck,
)
const predicate: fc.Memo<Predicate> = fc.memo<Predicate>((depth) =>
  depth <= 1
    ? leaf
    : fc.oneof(
        leaf,
        fc.record({
          type: fc.constant(`not` as const),
          value: predicate(depth - 1),
        }),
        fc.record({
          type: fc.constant(`and` as const),
          left: predicate(depth - 1),
          right: predicate(depth - 1),
        }),
        fc.record({
          type: fc.constant(`or` as const),
          left: predicate(depth - 1),
          right: predicate(depth - 1),
        }),
        fc.record({
          type: fc.constant(`test` as const),
          op: fc.constantFrom(`eq` as const, `in` as const, `isNull` as const),
          value: predicate(depth - 1),
          expected: fc.boolean(),
          both: fc.boolean(),
        }),
      ),
)

const rows = fc.uniqueArray(
  fc.record({
    id: fc.integer({ min: 1, max: 20 }),
    count: fc.option(fc.integer({ min: -3, max: 3 }), { nil: null }),
    label: fc.option(fc.constantFrom(``, `a`, `b`, `O'Reilly`, `"quoted"`), {
      nil: null,
    }),
    enabled: fc.option(fc.boolean(), { nil: null }),
  }),
  { minLength: 1, maxLength: 12, selector: ({ id }) => id },
)

const requiredReach = [
  `predicate:and`,
  `predicate:or`,
  `predicate:not`,
  `predicate:isNull`,
  `context:eq`,
  `context:in`,
  `context:isNull`,
  `comparison:eq`,
  `comparison:gt`,
  `comparison:gte`,
  `comparison:lt`,
  `comparison:lte`,
  `column:label`,
  `column:enabled`,
  `literal:empty-string`,
  `literal:single-quote`,
  `literal:quoted-string`,
  `row:null-count`,
  `row:null-label`,
  `row:null-enabled`,
] as const

function recordPredicateReach(value: Predicate, reached: Set<string>): void {
  reached.add(`predicate:${value.type}`)
  if (value.type === `test`) {
    reached.add(`context:${value.op}`)
    recordPredicateReach(value.value, reached)
    return
  }
  if (value.type === `compare`) {
    reached.add(`comparison:${value.op}`)
    reached.add(`column:${value.column}`)
    if (value.value === ``) reached.add(`literal:empty-string`)
    if (value.value === `O'Reilly`) reached.add(`literal:single-quote`)
    if (value.value === `"quoted"`) reached.add(`literal:quoted-string`)
    return
  }
  if (value.type === `not`) {
    recordPredicateReach(value.value, reached)
    return
  }
  if (value.type === `and` || value.type === `or`) {
    recordPredicateReach(value.left, reached)
    recordPredicateReach(value.right, reached)
  }
}

function recordRowReach(world: Array<Row>, reached: Set<string>): void {
  for (const row of world) {
    if (row.count === null) reached.add(`row:null-count`)
    if (row.label === null) reached.add(`row:null-label`)
    if (row.enabled === null) reached.add(`row:null-enabled`)
  }
}

function toExpression(value: Predicate): IR.BasicExpression<boolean> {
  if (value.type === `test`) {
    const inner = toExpression(value.value)
    return new IR.Func(
      value.op,
      value.op === `isNull`
        ? [inner]
        : [
            inner,
            new IR.Value(
              value.op === `eq`
                ? value.expected
                : value.both
                  ? [true, false]
                  : [value.expected],
            ),
          ],
    )
  }
  if (value.type === `compare`) {
    return new IR.Func(value.op, [
      new IR.PropRef([value.column]),
      new IR.Value(value.value),
    ])
  }
  if (value.type === `isNull`) {
    return new IR.Func(`isNull`, [new IR.PropRef([value.column])])
  }
  if (value.type === `not`) {
    return new IR.Func(`not`, [toExpression(value.value)])
  }
  return new IR.Func(value.type, [
    toExpression(value.left),
    toExpression(value.right),
  ])
}

function negate(value: Truth): Truth {
  return value === null ? null : !value
}

function combine(type: `and` | `or`, left: Truth, right: Truth): Truth {
  if (type === `and`) {
    if (left === false || right === false) return false
    return left === true && right === true ? true : null
  }
  if (left === true || right === true) return true
  return left === false && right === false ? false : null
}

function evaluate(value: Predicate, row: Row): Truth {
  if (value.type === `test`) {
    const actual = evaluate(value.value, row)
    if (value.op === `isNull`) return actual === null
    if (actual === null) return null
    return value.op === `in` && value.both ? true : actual === value.expected
  }
  if (value.type === `isNull`) return row[value.column] === null
  if (value.type === `not`) return negate(evaluate(value.value, row))
  if (value.type === `and` || value.type === `or`) {
    return combine(
      value.type,
      evaluate(value.left, row),
      evaluate(value.right, row),
    )
  }
  const actual = row[value.column]
  if (actual === null) return null
  if (typeof actual !== typeof value.value) {
    throw new Error(`Generated a comparison across PostgreSQL type domains`)
  }
  if (value.op === `eq`) return actual === value.value
  if (value.op === `gt`) return actual > value.value
  if (value.op === `gte`) return actual >= value.value
  if (value.op === `lt`) return actual < value.value
  return actual <= value.value
}

describe(`Electric predicate compiler semantics`, () => {
  let client: Client
  let table: string

  beforeAll(async () => {
    client = makePgClient()
    await client.connect()
    await client.query(`SET search_path TO ${inject(`testSchema`)}`)
    table = `predicate_semantics_${Date.now().toString(16)}`
    await client.query(
      `CREATE TABLE "${table}" (
        id INTEGER PRIMARY KEY,
        count INTEGER,
        label TEXT,
        enabled BOOLEAN,
        roles TEXT[],
        integer_roles INTEGER[],
        required_role VARCHAR(16)
      )`,
    )
  })

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS "${table}"`)
    await client.end()
  })

  it(`matches PostgreSQL over finite row worlds`, async () => {
    let executedCells = 0
    const reached = new Set<string>()
    const version = await client.query<{ server_version: string }>(
      `SHOW server_version`,
    )
    await fc.assert(
      fc.asyncProperty(
        rows,
        predicate(3),
        async (world, generatedPredicate) => {
          recordRowReach(world, reached)
          recordPredicateReach(generatedPredicate, reached)
          await client.query(`TRUNCATE "${table}"`)
          for (const row of world) {
            await client.query(
              `INSERT INTO "${table}" (id, count, label, enabled) VALUES ($1, $2, $3, $4)`,
              [row.id, row.count, row.label, row.enabled],
            )
          }
          const compiled = compileSQL({
            where: toExpression(generatedPredicate),
          })
          const params = Object.entries(compiled.params ?? {})
            .sort(([left], [right]) => Number(left) - Number(right))
            .map(([, value]) => value)
          const result = await client.query<{ id: number }>(
            `SELECT id FROM "${table}" WHERE ${compiled.where} ORDER BY id`,
            params,
          )
          const expected = world
            .filter((row) => evaluate(generatedPredicate, row) === true)
            .map(({ id }) => id)
            .sort((left, right) => left - right)
          expect(result.rows.map(({ id }) => id)).toEqual(expected)
          executedCells++
        },
      ),
      {
        seed: 1814,
        numRuns: 50,
        // Compound booleans are values too: cross comparison, membership, and
        // null tests, including NOT with both possible membership values.
        examples: [
          ...([`eq`, `in`, `isNull`] as const).map(
            (op): [Array<Row>, Predicate] => [
              [
                { id: 1, count: 4, label: null, enabled: true },
                { id: 2, count: 2, label: `a`, enabled: false },
                { id: 3, count: null, label: `O'Reilly`, enabled: null },
              ],
              {
                type: `test`,
                op,
                expected: true,
                both: true,
                value:
                  op === `in`
                    ? {
                        type: `not`,
                        value: {
                          type: `compare`,
                          op: `eq`,
                          column: `enabled`,
                          value: true,
                        },
                      }
                    : { type: `compare`, op: `gt`, column: `count`, value: 3 },
              },
            ],
          ),
          [
            [{ id: 1, count: 0, label: `O'Reilly`, enabled: null }],
            { type: `compare`, op: `eq`, column: `label`, value: `O'Reilly` },
          ],
        ],
      },
    )
    expect(executedCells).toBe(50)
    expect([...reached].sort()).toEqual(
      expect.arrayContaining([...requiredReach]),
    )
    console.info(
      `Electric predicate semantics: PostgreSQL ${version.rows[0]?.server_version}; Electric client ${electricClientVersion}; 50 generated cells; ${reached.size} reached categories`,
    )
  })

  it(`preserves boolean grouping beneath a comparison`, async () => {
    const world: Array<Row> = [
      { id: 1, count: 0, label: null, enabled: true },
      { id: 2, count: 0, label: null, enabled: false },
      { id: 3, count: 0, label: null, enabled: null },
    ]
    await client.query(`TRUNCATE "${table}"`)
    for (const row of world) {
      await client.query(
        `INSERT INTO "${table}" (id, count, label, enabled) VALUES ($1, $2, $3, $4)`,
        [row.id, row.count, row.label, row.enabled],
      )
    }
    const compiled = compileSQL({
      where: new IR.Func(`eq`, [
        new IR.Func(`or`, [new IR.PropRef([`enabled`]), new IR.Value(false)]),
        new IR.Value(false),
      ]),
    })
    const result = await client.query<{ id: number }>(
      `SELECT id FROM "${table}" WHERE ${compiled.where} ORDER BY id`,
      Object.values(compiled.params ?? {}),
    )

    expect(result.rows.map(({ id }) => id)).toEqual([2])
  })

  it(`preserves PostgreSQL array membership semantics`, async () => {
    await client.query(`TRUNCATE "${table}"`)
    await client.query(
      `INSERT INTO "${table}" (id, roles, integer_roles, required_role) VALUES
        (1, ARRAY['admin', 'editor'], ARRAY[1, 2], 'admin'),
        (2, ARRAY['viewer'], ARRAY[3], 'admin'),
        (3, NULL, NULL, NULL),
        (4, ARRAY[NULL]::TEXT[], ARRAY[NULL]::INTEGER[], 'admin')`,
    )

    const ref = (column: string) => new IR.PropRef([column])
    const call = (name: string, ...args: Array<IR.BasicExpression>) =>
      new IR.Func<boolean>(name, args)
    const selectedIds = async (
      where: IR.BasicExpression<boolean>,
    ): Promise<Array<number>> => {
      const compiled = compileSQL({ where })
      const params = Object.entries(compiled.params ?? {})
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => value)
      const result = await client.query<{ id: number }>(
        `SELECT id FROM "${table}" WHERE ${compiled.where} ORDER BY id`,
        params,
      )
      return result.rows.map(({ id }) => id)
    }

    const integerMembership = call(`in`, new IR.Value(2), ref(`integer_roles`))
    expect(await selectedIds(integerMembership)).toEqual([1])
    expect(await selectedIds(call(`not`, integerMembership))).toEqual([2, 3, 4])
    expect(
      await selectedIds(call(`in`, ref(`required_role`), ref(`roles`))),
    ).toEqual([1])

    const reversedContainment = await client.query<{ id: number }>(
      `SELECT id FROM "${table}" WHERE ARRAY[$1] @> roles ORDER BY id`,
      [`admin`],
    )
    expect(reversedContainment.rows.map(({ id }) => id)).not.toEqual([1])
    await expect(
      client.query(
        `SELECT id FROM "${table}" WHERE integer_roles @> ARRAY[$1]`,
        [`2`],
      ),
    ).rejects.toMatchObject({ code: `42883` })
  })

  it(`rejects representative compiler faults against PostgreSQL`, async () => {
    const world: Array<Row> = [
      { id: 1, count: 2, label: null, enabled: true },
      { id: 2, count: 2, label: null, enabled: false },
      { id: 3, count: null, label: null, enabled: true },
      { id: 4, count: 0, label: null, enabled: true },
    ]
    await client.query(`TRUNCATE "${table}"`)
    for (const row of world) {
      await client.query(
        `INSERT INTO "${table}" (id, count, label, enabled) VALUES ($1, $2, $3, $4)`,
        [row.id, row.count, row.label, row.enabled],
      )
    }
    const faultControlPredicate: Predicate = {
      type: `and`,
      left: {
        type: `or`,
        left: { type: `compare`, op: `gt`, column: `count`, value: 1 },
        right: { type: `isNull`, column: `count` },
      },
      right: { type: `compare`, op: `eq`, column: `enabled`, value: true },
    }
    const expected = world
      .filter((row) => evaluate(faultControlPredicate, row) === true)
      .map(({ id }) => id)
    const compiled = compileSQL({ where: toExpression(faultControlPredicate) })
    const compiledResult = await client.query<{ id: number }>(
      `SELECT id FROM "${table}" WHERE ${compiled.where} ORDER BY id`,
      Object.values(compiled.params ?? {}),
    )
    expect(compiledResult.rows.map(({ id }) => id)).toEqual(expected)

    const faults = [
      {
        name: `wrong bound`,
        sql: `("count" > $1 OR "count" IS NULL) AND "enabled" = $2`,
        params: [`2`, `true`],
      },
      {
        name: `lost predicate`,
        sql: `"count" > $1 OR "count" IS NULL`,
        params: [`1`],
      },
      {
        name: `incorrect null handling`,
        sql: `"count" > $1 AND "enabled" = $2`,
        params: [`1`, `true`],
      },
      {
        name: `swapped comparison direction`,
        sql: `("count" < $1 OR "count" IS NULL) AND "enabled" = $2`,
        params: [`1`, `true`],
      },
    ]
    for (const fault of faults) {
      const result = await client.query<{ id: number }>(
        `SELECT id FROM "${table}" WHERE ${fault.sql} ORDER BY id`,
        fault.params,
      )
      expect(
        result.rows.map(({ id }) => id),
        fault.name,
      ).not.toEqual(expected)
    }
  })
})
