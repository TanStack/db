/**
 * Ordinary SQLite expression-index tests. Each one checks a fixed case against
 * values written out in the test, a replay-configuration parser, a plan
 * classifier, or the cleanup behavior of the observer. None reaches an
 * independent model, so none is oracle coverage. The law these cases illustrate,
 * and the generated check that owns it, are in expression-index-oracle.test.ts.
 * The shared observer and fixtures are in expression-index-support.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  IR,
  coalesce as coalesceExpression,
  createCollection,
} from '@tanstack/db'
import {
  createPersistedTableName,
  createSQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core'
import { readOracleRunConfig } from '../../db/tests/oracle-config.js'
import {
  Temporal,
  temporalFamilies,
  temporalValue,
} from '../../db-sqlite-persistence-core/tests/temporal-value-oracle'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import {
  PERSISTED_TYPE_TAG,
  PERSISTED_VALUE_TAG,
  SQLITE_BIGINT_MAX,
  SQLITE_BIGINT_MIN,
  bigintRangeError,
  makeLegacyPathBindingMutation,
  makeOverbroadEqualityMutation,
  observeExpressionIndexScenario,
  planScansTable,
  planUsesNamedIndex,
  serializeIndexExpression,
  sqliteLiteral,
  withFailurePreservingCleanup,
} from './expression-index-support'
import type { PersistedTx } from '@tanstack/db-sqlite-persistence-core'
import type { QueryPlanRow } from './expression-index-support'

describe(`SQLite expression-index oracle`, () => {
  it.each([
    {
      label: `empty seed`,
      environment: { TANSTACK_DB_ORACLE_SEED: `` },
      message: `TANSTACK_DB_ORACLE_SEED must be an integer`,
    },
    {
      label: `path without seed`,
      environment: { TANSTACK_DB_ORACLE_PATH: `0` },
      message: `TANSTACK_DB_ORACLE_PATH requires TANSTACK_DB_ORACLE_SEED`,
    },
    {
      label: `property without path`,
      environment: {
        TANSTACK_DB_ORACLE_SEED: `1659005`,
        TANSTACK_DB_ORACLE_PROPERTY: `sqlite-persistence.expression-index`,
      },
      message: `TANSTACK_DB_ORACLE_PROPERTY requires TANSTACK_DB_ORACLE_PATH`,
    },
    {
      label: `invalid shrink path`,
      environment: {
        TANSTACK_DB_ORACLE_SEED: `1659005`,
        TANSTACK_DB_ORACLE_PATH: `0:`,
        TANSTACK_DB_ORACLE_PROPERTY: `sqlite-persistence.expression-index`,
      },
      message: `TANSTACK_DB_ORACLE_PATH must contain colon-separated nonnegative integers`,
    },
  ])(`rejects a $label replay configuration`, ({ environment, message }) => {
    expect(() => readOracleRunConfig(environment)).toThrow(message)
  })

  it(`accepts a seed alone and a checked seed and shrink-path replay pair`, () => {
    expect(readOracleRunConfig({ TANSTACK_DB_ORACLE_SEED: `1659005` })).toEqual(
      {
        multiplier: 1,
        replaySeed: 1659005,
        replayPath: undefined,
        replayProperty: undefined,
      },
    )
    expect(
      readOracleRunConfig({
        TANSTACK_DB_ORACLE_SEED: `-1659005`,
        TANSTACK_DB_ORACLE_PATH: `0:1:2`,
        TANSTACK_DB_ORACLE_PROPERTY: `sqlite-persistence.expression-index`,
      }),
    ).toEqual({
      multiplier: 1,
      replaySeed: -1659005,
      replayPath: `0:1:2`,
      replayProperty: `sqlite-persistence.expression-index`,
    })
  })

  it.each([
    {
      label: `coalesce-constant`,
      indexExpression: new IR.Func(`coalesce`, [
        new IR.PropRef([`nickname`]),
        new IR.Value(`none`),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`coalesce`, [
          new IR.PropRef([`nickname`]),
          new IR.Value(`none`),
        ]),
        new IR.Value(`none`),
      ]),
      rows: [
        { key: `missing`, value: { nickname: null } },
        { key: `present`, value: { nickname: `Ada` } },
      ],
      expectedKeys: [`missing`],
    },
    {
      label: `string-membership-constant`,
      indexExpression: new IR.Func(`in`, [
        new IR.PropRef([`nickname`]),
        new IR.Value([`Ada`, `Grace`]),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`in`, [
          new IR.PropRef([`nickname`]),
          new IR.Value([`Ada`, `Grace`]),
        ]),
        new IR.Value(true),
      ]),
      rows: [
        { key: `matching`, value: { nickname: `Ada` } },
        { key: `different`, value: { nickname: `Linus` } },
      ],
      expectedKeys: [`matching`],
    },
    {
      label: `strftime-constant`,
      indexExpression: new IR.Func(`strftime`, [
        new IR.Value(`%Y-%m-%d`),
        new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`strftime`, [
          new IR.Value(`%Y-%m-%d`),
          new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
        ]),
        new IR.Value(`2026-04-05`),
      ]),
      rows: [
        { key: `current`, value: { createdAt: `2026-04-05T00:00:00.000Z` } },
        {
          key: `epoch-milliseconds`,
          value: { createdAt: new Date(`2026-04-05T00:00:00.000Z`).getTime() },
        },
        { key: `past`, value: { createdAt: `2025-04-05T00:00:00.000Z` } },
      ],
      expectedKeys: [`current`, `epoch-milliseconds`],
    },
    {
      label: `add-constant`,
      indexExpression: new IR.Func(`add`, [
        new IR.PropRef([`score`]),
        new IR.Value(1),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`add`, [new IR.PropRef([`score`]), new IR.Value(1)]),
        new IR.Value(`21`),
      ]),
      rows: [
        { key: `matching`, value: { score: `2` } },
        { key: `different`, value: { score: 4 } },
      ],
      expectedKeys: [`matching`],
    },
    {
      label: `bigint-coalesce-constant`,
      indexExpression: new IR.Func(`coalesce`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.Func(`coalesce`, [
          new IR.PropRef([`largeViewCount`]),
          new IR.Value(SQLITE_BIGINT_MIN),
        ]),
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      rows: [
        { key: `missing`, value: { largeViewCount: null } },
        { key: `minimum`, value: { largeViewCount: SQLITE_BIGINT_MIN } },
        { key: `zero`, value: { largeViewCount: 0n } },
      ],
      expectedKeys: [`minimum`, `missing`],
    },
  ])(
    `loads through a constant-bearing $label expression`,
    async ({ expectedKeys, ...scenario }) => {
      const observation = await observeExpressionIndexScenario(scenario)

      expect(observation.adapterKeys).toEqual(expectedKeys)
      if (
        scenario.label === `strftime-constant` ||
        scenario.label === `add-constant` ||
        scenario.label === `string-membership-constant`
      ) {
        expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
        expect(observation.directSqlKeys).toEqual(
          scenario.rows.map((row) => row.key).sort(),
        )
        expect(planScansTable(observation.plan, observation.tableName)).toBe(
          true,
        )
        return
      }
      expect(observation.directSqlKeys).toEqual(expectedKeys)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  // Literal positions and polarity come from the string contract, not SQL.
  it.each([`\u0000ab`, `a\u0000b`, `ab\u0000`])(
    `preserves ordinary NUL strings / %j`,
    async (target) => {
      const ref = new IR.PropRef([`stamp`])
      const literal = new IR.Value(target)
      const eq = new IR.Func<boolean>(`eq`, [ref, literal])
      for (const where of [
        eq,
        new IR.Func<boolean>(`eq`, [literal, ref]),
        new IR.Func<boolean>(`in`, [ref, new IR.Value([target, `other`])]),
        new IR.Func<boolean>(`and`, [eq, new IR.Value(true)]),
        new IR.Func<boolean>(`or`, [eq, new IR.Value(false)]),
      ]) {
        const result = await observeExpressionIndexScenario({
          label: `NUL`,
          indexExpression: ref,
          where,
          rows: [
            { key: `match`, value: { stamp: target } },
            { key: `different`, value: { stamp: `absent` } },
          ],
        })
        expect(result.adapterKeys).toEqual([`match`])
        expect(result.directSqlKeys).toEqual([`match`])
      }
    },
  )

  // Distinct native/ordinary fallback meanings must retain separate persisted
  // indexes. The wrapper receives both public definitions before preload; the
  // registry and sqlite_master checkpoints expose a signature collision even
  // when residual query evaluation could still return correct rows.
  it(`persists separate indexes for native and ordinary tagged literals`, async () => {
    vi.stubGlobal(`Temporal`, Temporal)
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })
    const collectionId = `native-tag-indexes`
    const collection = createCollection(
      persistedCollectionOptions<{ id: string; stamp: unknown }, string>({
        id: collectionId,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: { sync: ({ markReady }) => markReady() },
        persistence: { adapter },
      }),
    )
    try {
      await withFailurePreservingCleanup(async () => {
        const native = Temporal.Instant.from(`2026-01-02T00:00:00Z`)
        for (const value of [
          native,
          { __type: `Temporal.Instant`, value: String(native) },
        ]) {
          collection.createIndex((row) =>
            coalesceExpression(row.stamp, new IR.Value(value)),
          )
        }
        await collection.preload()
        const entries = driver
          .getDatabase()
          .prepare(
            `SELECT index_name FROM persisted_index_registry WHERE collection_id = ? AND removed = 0`,
          )
          .all(collectionId) as Array<{ index_name: string }>
        expect(entries).toHaveLength(2)
        expect(new Set(entries.map((entry) => entry.index_name)).size).toBe(2)
        for (const entry of entries) {
          expect(
            driver
              .getDatabase()
              .prepare(
                `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
              )
              .all(entry.index_name),
          ).toHaveLength(1)
        }
      }, [() => collection.cleanup(), () => driver.close()])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // A NUL string stays ordinary text in both bound predicates and index DDL.
  // Enumerate string-only and native-mixed membership, with positive/negative
  // predicates. Expected keys come from fixture membership; stored index values
  // independently observe the DDL before residual filtering can hide a mismatch.
  it.each([`\u0000ab`, `a\u0000b`, `ab\u0000`, `é'\u0000𐀀`])(
    `preserves NUL membership literals in index definitions / %j`,
    async (target) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        const native = Temporal.Instant.from(`2026-01-02T00:00:00Z`)
        for (const mixed of [false, true]) {
          const membership = new IR.Func<boolean>(`in`, [
            new IR.PropRef([`stamp`]),
            new IR.Value(mixed ? [target, native] : [target]),
          ])
          for (const negate of [false, true]) {
            const result = await observeExpressionIndexScenario({
              label: `NUL-membership`,
              indexExpression: membership,
              observeIndexValues: true,
              where: negate ? new IR.Func(`not`, [membership]) : membership,
              rows: [
                { key: `match`, value: { stamp: target } },
                { key: `native`, value: { stamp: native } },
                { key: `other`, value: { stamp: `absent` } },
              ],
            })
            const matches = mixed ? [`match`, `native`] : [`match`]
            const expected = negate
              ? [`match`, `native`, `other`].filter(
                  (key) => !matches.includes(key),
                )
              : matches
            expect(result.adapterKeys).toEqual(expected)
            expect(result.directSqlKeys).toEqual(
              expect.arrayContaining(expected),
            )
            expect(result.indexValues).toEqual([
              { key: `match`, value: 1 },
              { key: `native`, value: mixed ? 1 : 0 },
              { key: `other`, value: 0 },
            ])
          }
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it(`keeps large string membership indexes within SQLite expression depth`, async () => {
    const membership = new IR.Func(`in`, [
      new IR.PropRef([`nickname`]),
      new IR.Value(Array.from({ length: 1025 }, (_, index) => `name-${index}`)),
    ])
    const observation = await observeExpressionIndexScenario({
      label: `large-string-membership`,
      indexExpression: membership,
      where: new IR.Func<boolean>(`eq`, [membership, new IR.Value(true)]),
      rows: [
        { key: `matching`, value: { nickname: `name-1024` } },
        { key: `different`, value: { nickname: `absent` } },
      ],
    })
    expect(observation.adapterKeys).toEqual([`matching`])
    // The DDL remains valid at large arity. The safe classifier deliberately
    // leaves eq(in(...), true) to residual filtering, as for other scalar functions.
    expect(observation.indexSql).toBeDefined()
    expect(observation.directSqlKeys).toEqual([`different`, `matching`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
  })

  it(`rebuilds a persisted BigInt-constant index when its normalized spec changes`, async () => {
    const indexExpression = new IR.Func(`coalesce`, [
      new IR.PropRef([`largeViewCount`]),
      new IR.Value(SQLITE_BIGINT_MIN),
    ])
    const observation = await observeExpressionIndexScenario({
      label: `bigint-constant-upgrade`,
      indexExpression,
      where: new IR.Func<boolean>(`eq`, [
        indexExpression,
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      rows: [
        { key: `missing`, value: { largeViewCount: null } },
        { key: `minimum`, value: { largeViewCount: SQLITE_BIGINT_MIN } },
        { key: `zero`, value: { largeViewCount: 0n } },
      ],
      preparePreviousIndex: async (adapter, collectionId, signature) => {
        await adapter.ensureIndex(
          { kind: `eager`, collectionId: collectionId },
          signature,
          {
            expressionSql: [
              JSON.stringify(indexExpression, (_key, value: unknown) =>
                typeof value === `bigint` ? value.toString() : value,
              ),
            ],
          },
        )
      },
    })

    expect(observation.adapterKeys).toEqual([`minimum`, `missing`])
    expect(observation.directSqlKeys).toEqual([`minimum`, `missing`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it.each([
    {
      label: `bigint-field-range`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(BigInt(`9007199254740993`)),
      ]),
      rows: [
        {
          key: `lower`,
          value: { largeViewCount: BigInt(`9007199254740992`) },
        },
        {
          key: `higher`,
          value: { largeViewCount: BigInt(`9007199254740997`) },
        },
      ],
      expectedKeys: [`higher`],
      expectedCandidateKeys: [`higher`, `lower`],
      expectedQueryParams: [],
    },
    {
      label: `bigint-field-min-boundary`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MIN),
      ]),
      rows: [
        {
          key: `minimum`,
          value: { largeViewCount: SQLITE_BIGINT_MIN },
        },
        {
          key: `next`,
          value: { largeViewCount: SQLITE_BIGINT_MIN + 1n },
        },
      ],
      expectedKeys: [`minimum`],
      expectedQueryParams: [],
    },
    {
      label: `bigint-field-max-boundary`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MAX),
      ]),
      rows: [
        {
          key: `previous`,
          value: { largeViewCount: SQLITE_BIGINT_MAX - 1n },
        },
        {
          key: `maximum`,
          value: { largeViewCount: SQLITE_BIGINT_MAX },
        },
      ],
      expectedKeys: [`maximum`],
      expectedQueryParams: [],
    },
    {
      label: `date-field-range`,
      indexExpression: new IR.PropRef([`createdAt`]),
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`createdAt`]),
        new IR.Value(new Date(`2026-01-02T12:00:00.000Z`)),
      ]),
      rows: [
        {
          key: `earlier`,
          value: { createdAt: new Date(`2026-01-02T00:00:00.000Z`) },
        },
        {
          key: `later`,
          value: { createdAt: new Date(`2026-01-03T00:00:00.000Z`) },
        },
        {
          key: `numeric-later`,
          value: { createdAt: new Date(`2026-01-03T00:00:00.000Z`).getTime() },
        },
      ],
      expectedKeys: [`later`, `numeric-later`],
      expectedQueryParams: [],
    },
    {
      label: `bigint-field-in`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value([BigInt(`9007199254740992`), BigInt(`9007199254740997`)]),
      ]),
      rows: [
        {
          key: `included-low`,
          value: { largeViewCount: BigInt(`9007199254740992`) },
        },
        {
          key: `excluded`,
          value: { largeViewCount: BigInt(`9007199254740994`) },
        },
        {
          key: `included-high`,
          value: { largeViewCount: BigInt(`9007199254740997`) },
        },
      ],
      expectedKeys: [`included-high`, `included-low`],
      expectedQueryParams: [`[9007199254740992,9007199254740997]`],
    },
    {
      label: `bigint-field-batched-in`,
      indexExpression: new IR.PropRef([`largeViewCount`]),
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(
          Array.from(
            { length: 901 },
            (_unused, index) => BigInt(`9007199254740992`) + BigInt(index),
          ),
        ),
      ]),
      rows: [
        {
          key: `included-first`,
          value: { largeViewCount: BigInt(`9007199254740992`) },
        },
        {
          key: `excluded`,
          value: { largeViewCount: BigInt(`9007199254740991`) },
        },
        {
          key: `included-last`,
          value: { largeViewCount: BigInt(`9007199254741892`) },
        },
      ],
      expectedKeys: [`included-first`, `included-last`],
      expectedQueryParams: [
        `[${Array.from({ length: 901 }, (_unused, index) =>
          (BigInt(`9007199254740992`) + BigInt(index)).toString(),
        ).join(`,`)}]`,
      ],
    },
  ])(
    `uses the raw $label field expression index`,
    async ({
      expectedKeys,
      expectedCandidateKeys,
      expectedQueryParams,
      ...scenario
    }) => {
      const observation = await observeExpressionIndexScenario(scenario)
      const diagnostic = JSON.stringify(
        {
          sql: observation.predicateQuery.sql,
          params: observation.predicateQuery.params,
          plan: observation.plan.map((row) => row.detail),
          adapterKeys: observation.adapterKeys,
          directSqlKeys: observation.directSqlKeys,
        },
        null,
        2,
      )

      expect(observation.adapterKeys, diagnostic).toEqual(expectedKeys)
      if (scenario.label === `date-field-range`) {
        expect(observation.predicateQuery.sql, diagnostic).not.toContain(
          ` WHERE `,
        )
        expect(observation.directSqlKeys, diagnostic).toEqual(
          scenario.rows.map((row) => row.key).sort(),
        )
        expect(planScansTable(observation.plan, observation.tableName)).toBe(
          true,
        )
        return
      }
      expect(observation.directSqlKeys, diagnostic).toEqual(
        expectedCandidateKeys ?? expectedKeys,
      )
      expect(observation.predicateQuery.params, diagnostic).toEqual(
        expectedQueryParams,
      )
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
        diagnostic,
      ).toBe(true)
    },
  )

  it(`uses the field expression index for a paired-surrogate string equality`, async () => {
    const field = new IR.PropRef([`name`])
    const observation = await observeExpressionIndexScenario({
      label: `paired-surrogate-equality`,
      indexExpression: field,
      where: new IR.Func<boolean>(`eq`, [field, new IR.Value(`😀`)]),
      rows: [
        { key: `matching`, value: { name: `😀` } },
        { key: `other`, value: { name: `other` } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`matching`])
    expect(observation.directSqlKeys).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it.each([
    { label: `field on the left`, reversed: false },
    { label: `field on the right`, reversed: true },
  ])(
    `keeps indexed lone-surrogate equality sound with $label`,
    async ({ reversed }) => {
      const field = new IR.PropRef([`name`])
      const value = new IR.Value(`\uD800`)
      const observation = await observeExpressionIndexScenario({
        label: `lone-surrogate-equality`,
        indexExpression: field,
        where: new IR.Func<boolean>(
          `eq`,
          reversed ? [value, field] : [field, value],
        ),
        rows: [
          { key: `matching`, value: { name: `\uD800` } },
          { key: `other-lone`, value: { name: `\uDC00` } },
          { key: `ordinary`, value: { name: `ordinary` } },
        ],
      })

      expect(observation.adapterKeys).toEqual([`matching`])
      // The binding and stored value must have the same SQLite byte sequence.
      expect(observation.directSqlKeys).toEqual([`matching`])
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it.each([
    { label: `BigInt equality`, value: 1n, expectedKeys: [`bigint`] },
    { label: `boolean equality`, value: true, expectedKeys: [`boolean`] },
  ])(
    `keeps indexed $label sound across stored scalar types`,
    async ({ value, expectedKeys }) => {
      const field = new IR.PropRef([`n`])
      const observation = await observeExpressionIndexScenario({
        label: `mixed-scalar-equality`,
        indexExpression: field,
        where: new IR.Func<boolean>(`eq`, [field, new IR.Value(value)]),
        rows: [
          { key: `bigint`, value: { n: 1n } },
          { key: `boolean`, value: { n: true } },
          { key: `number`, value: { n: 1 } },
          { key: `text`, value: { n: `1` } },
          { key: `nan`, value: { n: Number.NaN } },
          { key: `date`, value: { n: new Date(1) } },
          { key: `null`, value: { n: null } },
          { key: `missing`, value: {} },
        ],
      })

      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(observation.directSqlKeys).toEqual([`bigint`, `boolean`, `number`])
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it.each([`eq`, `in`] as const)(
    `keeps Date epoch matches when a numeric $operator predicate falls back`,
    async (operator) => {
      const field = new IR.PropRef([`n`])
      const observation = await observeExpressionIndexScenario({
        label: `numeric-${operator}-date-epoch`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [
          field,
          new IR.Value(operator === `eq` ? 1 : [1]),
        ]),
        rows: [
          { key: `date`, value: { n: new Date(1) } },
          { key: `number`, value: { n: 1 } },
          { key: `other`, value: { n: 2 } },
        ],
      })

      expect(observation.adapterKeys).toEqual([`date`, `number`])
      expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
      expect(observation.directSqlKeys).toEqual([`date`, `number`, `other`])
    },
  )

  it(`keeps a BigInt match through a lower-wrapped membership fallback`, async () => {
    const lower = new IR.Func(`lower`, [new IR.PropRef([`n`])])
    const observation = await observeExpressionIndexScenario({
      label: `bigint-lower-membership`,
      indexExpression: lower,
      where: new IR.Func<boolean>(`in`, [lower, new IR.Value([1n])]),
      rows: [
        { key: `bigint`, value: { n: 1n } },
        { key: `number`, value: { n: 1 } },
        { key: `text`, value: { n: `1` } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`bigint`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
    expect(observation.directSqlKeys).toEqual([`bigint`, `number`, `text`])
  })

  it(`keeps a missing field equal to a lone-surrogate coalesce fallback`, async () => {
    const fallback = `\uD800`
    const coalesce = new IR.Func(`coalesce`, [
      new IR.PropRef([`name`]),
      new IR.Value(fallback),
    ])
    const observation = await observeExpressionIndexScenario({
      label: `lone-surrogate-coalesce`,
      indexExpression: coalesce,
      where: new IR.Func<boolean>(`eq`, [coalesce, new IR.Value(fallback)]),
      rows: [
        { key: `missing`, value: {} },
        { key: `other`, value: { name: `other` } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`missing`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
    expect(observation.directSqlKeys).toEqual([`missing`, `other`])
  })

  it(`keeps indexed BigInt membership sound across stored scalar types`, async () => {
    const field = new IR.PropRef([`n`])
    const observation = await observeExpressionIndexScenario({
      label: `mixed-scalar-bigint-in`,
      indexExpression: field,
      where: new IR.Func<boolean>(`in`, [field, new IR.Value([1n, 2n])]),
      rows: [
        { key: `bigint-one`, value: { n: 1n } },
        { key: `bigint-two`, value: { n: 2n } },
        { key: `boolean`, value: { n: true } },
        { key: `number`, value: { n: 1 } },
        { key: `text`, value: { n: `1` } },
        { key: `nan`, value: { n: Number.NaN } },
        { key: `date`, value: { n: new Date(1) } },
        { key: `null`, value: { n: null } },
        { key: `missing`, value: {} },
      ],
    })

    expect(observation.adapterKeys).toEqual([`bigint-one`, `bigint-two`])
    expect(observation.directSqlKeys).toEqual([
      `bigint-one`,
      `bigint-two`,
      `boolean`,
      `number`,
    ])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it(`uses an indexed safe conjunct while leaving an unsafe range to the row evaluator`, async () => {
    const status = new IR.PropRef([`status`])
    const observation = await observeExpressionIndexScenario({
      label: `indexed-safe-conjunct`,
      indexExpression: status,
      where: new IR.Func<boolean>(`and`, [
        new IR.Func<boolean>(`eq`, [status, new IR.Value(`active`)]),
        new IR.Func<boolean>(`gt`, [new IR.PropRef([`n`]), new IR.Value(0)]),
      ]),
      rows: [
        { key: `active-nan`, value: { status: `active`, n: Number.NaN } },
        { key: `active-negative`, value: { status: `active`, n: -1 } },
        { key: `active-zero`, value: { status: `active`, n: 0 } },
        { key: `inactive-positive`, value: { status: `inactive`, n: 2 } },
        { key: `inactive-zero`, value: { status: `inactive`, n: 0 } },
        { key: `inactive-nan`, value: { status: `inactive`, n: Number.NaN } },
      ],
    })

    expect(observation.adapterKeys).toEqual([`active-nan`])
    expect(observation.directSqlKeys).toEqual([`active-nan`, `active-zero`])
    expect(observation.predicateQuery.sql).toContain(` WHERE `)
    expect(observation.predicateQuery.sql).toContain(`$.n`)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(false)
  })

  it.each([
    {
      operator: `gt`,
      target: 1,
      expectedKeys: [
        `array`,
        `bigint-positive`,
        `date`,
        `infinity`,
        `nan`,
        `numeric-text`,
        `positive`,
      ],
    },
    {
      operator: `lt`,
      target: 2,
      expectedKeys: [
        `bigint-negative`,
        `negative`,
        `negative-infinity`,
        `negative-subnormal`,
        `negative-text`,
        `one`,
        `zero`,
      ],
    },
  ] as const)(
    `uses an indexed superset for a mixed scalar $operator range`,
    async ({ operator, target, expectedKeys }) => {
      const field = new IR.PropRef([`n`])
      const rows = [
        { key: `negative`, value: { n: -2 } },
        { key: `negative-subnormal`, value: { n: -Number.MIN_VALUE } },
        { key: `zero`, value: { n: 0 } },
        { key: `one`, value: { n: 1 } },
        { key: `positive`, value: { n: 3 } },
        { key: `nan`, value: { n: Number.NaN } },
        { key: `infinity`, value: { n: Number.POSITIVE_INFINITY } },
        { key: `negative-infinity`, value: { n: Number.NEGATIVE_INFINITY } },
        { key: `numeric-text`, value: { n: `3` } },
        { key: `negative-text`, value: { n: `-2` } },
        { key: `word`, value: { n: `abc` } },
        { key: `bigint-negative`, value: { n: -2n } },
        { key: `bigint-positive`, value: { n: 3n } },
        { key: `date`, value: { n: new Date(3) } },
        { key: `null`, value: { n: null } },
        { key: `missing`, value: {} },
        { key: `array`, value: { n: [3] } },
        { key: `object`, value: { n: { x: 3 } } },
      ]
      const observation = await observeExpressionIndexScenario({
        label: `mixed-scalar-${operator}-range`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [field, new IR.Value(target)]),
        rows,
      })

      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(observation.directSqlKeys).toEqual(
        expect.arrayContaining([...expectedKeys]),
      )
      expect(observation.directSqlKeys.length).toBeLessThan(rows.length)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
      expect(planScansTable(observation.plan, observation.tableName)).toBe(
        false,
      )
    },
  )

  it.each([
    {
      operator: `gt`,
      expectedKeys: [`above`, `date`, `nan`, `numeric-text`],
      expectedCandidates: 7,
    },
    {
      operator: `gte`,
      expectedKeys: [`above`, `date`, `equal`, `nan`, `numeric-text`],
      expectedCandidates: 7,
    },
    {
      operator: `lt`,
      expectedKeys: [`below`, `negative`],
      expectedCandidates: 8,
    },
    {
      operator: `lte`,
      expectedKeys: [`below`, `equal`, `negative`],
      expectedCandidates: 8,
    },
  ] as const)(
    `keeps matches adjacent to an indexed integer $operator bound`,
    async ({ operator, expectedKeys, expectedCandidates }) => {
      const field = new IR.PropRef([`n`])
      const rows = [
        { key: `negative`, value: { n: -1 } },
        { key: `below`, value: { n: 1 - Number.EPSILON / 2 } },
        { key: `equal`, value: { n: 1 } },
        { key: `above`, value: { n: 1 + Number.EPSILON } },
        { key: `nan`, value: { n: Number.NaN } },
        { key: `numeric-text`, value: { n: `2` } },
        { key: `date`, value: { n: new Date(2) } },
        { key: `null`, value: { n: null } },
        { key: `missing`, value: {} },
      ]
      const observation = await observeExpressionIndexScenario({
        label: `adjacent-integer-${operator}`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [field, new IR.Value(1)]),
        rows,
      })

      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(observation.directSqlKeys).toEqual(
        expect.arrayContaining([...expectedKeys]),
      )
      expect(observation.directSqlKeys).toHaveLength(expectedCandidates)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it(`keeps Unicode lowercase matches in an indexed candidate set`, async () => {
    const field = new IR.PropRef([`name`])
    const lower = new IR.Func(`lower`, [field])
    const rows = [
      { key: `ascii-lower`, value: { name: `ak` } },
      { key: `ascii-upper`, value: { name: `AK` } },
      { key: `kelvin-inside`, value: { name: `aK` } },
      { key: `ascii-other`, value: { name: `ak-more` } },
      { key: `unicode-other`, value: { name: `aé` } },
      { key: `ascii-before`, value: { name: `abc` } },
    ]
    const observation = await observeExpressionIndexScenario({
      label: `unicode-lower-candidates`,
      indexExpression: lower,
      where: new IR.Func<boolean>(`eq`, [lower, new IR.Value(`ak`)]),
      rows,
    })

    expect(observation.adapterKeys).toEqual([
      `ascii-lower`,
      `ascii-upper`,
      `kelvin-inside`,
    ])
    expect(observation.directSqlKeys).toEqual(
      expect.arrayContaining(observation.adapterKeys),
    )
    expect(observation.directSqlKeys).not.toContain(`ascii-other`)
    expect(observation.directSqlKeys).toHaveLength(4)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(false)
  })

  it.each([
    {
      label: `large Number and BigInt bound`,
      value: { n: 1000000000000000100 },
      indexExpression: new IR.PropRef([`n`]),
      predicate: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`n`]),
        new IR.Value(1000000000000000120n),
      ]),
    },
    {
      label: `numeric object key`,
      value: { part: { '0': `match` } },
      indexExpression: new IR.PropRef([`part`, `0`]),
      predicate: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`part`, `0`]),
        new IR.Value(`match`),
      ]),
    },
    {
      label: `Unicode lowercase after NUL`,
      value: { name: `a\u0000K` },
      indexExpression: new IR.Func(`lower`, [new IR.PropRef([`name`])]),
      predicate: new IR.Func<boolean>(`eq`, [
        new IR.Func(`lower`, [new IR.PropRef([`name`])]),
        new IR.Value(`a\u0000k`),
      ]),
    },
  ])(`keeps $label through a unary SQL candidate`, async (testCase) => {
    for (const wrapper of [`and`, `or`] as const) {
      const observation = await observeExpressionIndexScenario({
        label: `candidate-${testCase.label}-${wrapper}`,
        indexExpression: testCase.indexExpression,
        where: new IR.Func<boolean>(wrapper, [testCase.predicate]),
        rows: [{ key: `match`, value: testCase.value }],
      })

      // The JavaScript predicate matches each row by the public contract.
      // Every matching key must survive SQLite before that evaluator runs.
      expect(observation.adapterKeys).toEqual([`match`])
      expect(observation.directSqlKeys).toContain(`match`)
    }
  })

  it(`keeps numeric-key object and array matches across candidate kinds`, async () => {
    const variants = [
      {
        name: `equality`,
        match: `match`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      },
      {
        name: `coalesce`,
        match: `match`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`eq`, [
            new IR.Func(`coalesce`, [ref, new IR.Value(`fallback`)]),
            new IR.Value(`match`),
          ]),
      },
      {
        name: `membership`,
        match: 1n,
        other: 2n,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`in`, [ref, new IR.Value([1n])]),
      },
      {
        name: `prefix`,
        match: `match`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`like`, [ref, new IR.Value(`mat%`)]),
      },
      {
        name: `lowercase`,
        match: `MATCH`,
        other: `other`,
        predicate: (ref: IR.PropRef) =>
          new IR.Func<boolean>(`eq`, [
            new IR.Func(`lower`, [ref]),
            new IR.Value(`match`),
          ]),
      },
    ]
    for (const segment of [`0`, `1`]) {
      const wrapArray = (value: unknown) => {
        const items: Array<unknown> = []
        items[Number(segment)] = value
        return { part: items }
      }
      for (const variant of variants) {
        const ref = new IR.PropRef([`part`, segment])
        const rows = [
          {
            key: `array-match`,
            value: wrapArray(variant.match),
          },
          {
            key: `object-match`,
            value: { part: { [segment]: variant.match } },
          },
          {
            key: `array-other`,
            value: wrapArray(variant.other),
          },
          {
            key: `object-other`,
            value: { part: { [segment]: variant.other } },
          },
        ]
        const predicate = variant.predicate(ref)
        for (const wrapper of [`direct`, `and`, `or`] as const) {
          const observation = await observeExpressionIndexScenario({
            label: `numeric-key-${segment}-${variant.name}-${wrapper}`,
            indexExpression: ref,
            where:
              wrapper === `direct`
                ? predicate
                : new IR.Func<boolean>(wrapper, [predicate]),
            rows,
          })
          const expectedKeys = [`array-match`, `object-match`]
          expect(observation.adapterKeys).toEqual(expectedKeys)
          expect(observation.directSqlKeys).toEqual(
            expect.arrayContaining(expectedKeys),
          )
          if (variant.name === `equality`) {
            expect(
              planUsesNamedIndex(
                observation.plan,
                observation.tableName,
                observation.indexName,
              ),
            ).toBe(true)
          }
        }
      }
    }
  })

  it(`indexes mixed array and object numeric paths`, async () => {
    const ref = new IR.PropRef([`part`, `0`, `0`])
    const observation = await observeExpressionIndexScenario({
      label: `mixed-numeric-carriers`,
      indexExpression: ref,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      rows: [
        { key: `array-array`, value: { part: [[`match`]] } },
        { key: `array-object`, value: { part: [{ '0': `match` }] } },
        { key: `object-array`, value: { part: { '0': [`match`] } } },
        { key: `object-object`, value: { part: { '0': { '0': `match` } } } },
      ],
    })
    const expectedKeys = [
      `array-array`,
      `array-object`,
      `object-array`,
      `object-object`,
    ]
    expect(observation.adapterKeys).toEqual(expectedKeys)
    expect(observation.directSqlKeys).toEqual(expectedKeys)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it(`indexes every three-segment numeric carrier combination`, async () => {
    const ref = new IR.PropRef([`part`, `0`, `0`, `0`])
    const rows = Array.from({ length: 8 }, (_unused, mask) => {
      let nested: unknown = `match`
      for (let bit = 0; bit < 3; bit++) {
        nested = mask & (1 << bit) ? [nested] : { '0': nested }
      }
      return { key: `carrier-${mask}`, value: { part: nested } }
    })
    const observation = await observeExpressionIndexScenario({
      label: `three-numeric-carriers`,
      indexExpression: ref,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      rows,
    })
    const expectedKeys = rows.map(({ key }) => key)
    expect(observation.adapterKeys).toEqual(expectedKeys)
    expect(observation.directSqlKeys).toEqual(expectedKeys)
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
  })

  it(`keeps deep numeric paths in the unbounded candidate set`, async () => {
    const ref = new IR.PropRef([`part`, `0`, `0`, `0`, `0`])
    const observation = await observeExpressionIndexScenario({
      label: `deep-numeric-carriers`,
      indexExpression: ref,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.Value(`match`)]),
      rows: [
        {
          key: `match`,
          value: { part: { '0': { '0': { '0': { '0': `match` } } } } },
        },
      ],
    })
    expect(observation.adapterKeys).toEqual([`match`])
    expect(observation.directSqlKeys).toEqual([`match`])
    expect(observation.predicateQuery.sql).not.toContain(` WHERE `)
  })

  it(`keeps Unicode lowercase matches across NUL placement and equality direction`, async () => {
    const spellings = [
      { name: `NUL before fold`, source: `a\u0000K`, target: `a\u0000k` },
      { name: `NUL after fold`, source: `K\u0000a`, target: `k\u0000a` },
      { name: `NUL after prefix`, source: `aK\u0000b`, target: `ak\u0000b` },
      { name: `no NUL`, source: `aK`, target: `ak` },
    ]
    const field = new IR.PropRef([`name`])
    const lower = new IR.Func(`lower`, [field])
    for (const spelling of spellings) {
      expect(spelling.source.toLowerCase()).toBe(spelling.target)
      const rows = [
        { key: `ascii`, value: { name: spelling.target } },
        { key: `unicode`, value: { name: spelling.source } },
        { key: `other`, value: { name: `different` } },
      ]
      for (const lowerOnLeft of [true, false]) {
        const literal = new IR.Value(spelling.target)
        const predicate = new IR.Func<boolean>(
          `eq`,
          lowerOnLeft ? [lower, literal] : [literal, lower],
        )
        for (const wrapper of [`direct`, `and`, `or`] as const) {
          const observation = await observeExpressionIndexScenario({
            label: `nul-lower-${spelling.name}-${lowerOnLeft}-${wrapper}`,
            indexExpression: lower,
            where:
              wrapper === `direct`
                ? predicate
                : new IR.Func<boolean>(wrapper, [predicate]),
            rows,
          })
          const expectedKeys = [`ascii`, `unicode`]
          expect(observation.adapterKeys).toEqual(expectedKeys)
          expect(observation.directSqlKeys).toEqual(
            expect.arrayContaining(expectedKeys),
          )
        }
      }
    }
  })

  it.each([
    {
      label: `greater than zero`,
      operator: `gt`,
      target: 0,
      expectedKeys: [`infinity`, `nan`, `numeric-text`, `positive`],
    },
    {
      label: `less than two`,
      operator: `lt`,
      target: 2,
      expectedKeys: [`negative`, `negative-infinity`, `positive`],
    },
  ] as const)(
    `keeps indexed numeric comparison matches for $label`,
    async ({ label, operator, target, expectedKeys }) => {
      const field = new IR.PropRef([`n`])
      const observation = await observeExpressionIndexScenario({
        label: `numeric-domain-${label}`,
        indexExpression: field,
        where: new IR.Func<boolean>(operator, [field, new IR.Value(target)]),
        rows: [
          { key: `negative`, value: { n: -1 } },
          { key: `positive`, value: { n: 1 } },
          { key: `nan`, value: { n: Number.NaN } },
          { key: `infinity`, value: { n: Number.POSITIVE_INFINITY } },
          { key: `negative-infinity`, value: { n: Number.NEGATIVE_INFINITY } },
          { key: `missing`, value: {} },
          { key: `null`, value: { n: null } },
          { key: `numeric-text`, value: { n: `2` } },
          { key: `text`, value: { n: `abc` } },
        ],
      })

      // Public rows are exact. SQL may admit extra candidates for the row
      // evaluator when SQLite and TanStack DB order stored values differently.
      expect(observation.adapterKeys).toEqual(expectedKeys)
      expect(
        planUsesNamedIndex(
          observation.plan,
          observation.tableName,
          observation.indexName,
        ),
      ).toBe(true)
    },
  )

  it.each([
    {
      label: `nested row value`,
      tx: {
        txId: `out-of-range-row`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `row`,
            value: { profile: { count: SQLITE_BIGINT_MAX + 1n } },
          },
        ],
      } satisfies PersistedTx,
    },
    {
      label: `row metadata`,
      tx: {
        txId: `out-of-range-row-metadata`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        rowMetadataMutations: [
          {
            type: `set`,
            key: `row`,
            value: { count: SQLITE_BIGINT_MIN - 1n },
          },
        ],
      } satisfies PersistedTx,
    },
    {
      label: `collection metadata`,
      tx: {
        txId: `out-of-range-collection-metadata`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [{ type: `insert`, key: `row`, value: { id: `row` } }],
        collectionMetadataMutations: [
          {
            type: `set`,
            key: `checkpoint`,
            value: { count: SQLITE_BIGINT_MAX + 1n },
          },
        ],
      } satisfies PersistedTx,
    },
  ])(`rejects an out-of-range BigInt in a persisted $label`, async ({ tx }) => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })

    await withFailurePreservingCleanup(async () => {
      await expect(
        adapter.applyCommittedTx(
          { kind: `eager`, collectionId: `bigint-write-range` },
          tx,
        ),
      ).rejects.toThrow(
        /SQLite BigInt value .* outside the signed 64-bit range/,
      )

      if (adapter.scanRows) {
        expect(
          await adapter.scanRows({
            kind: `eager`,
            collectionId: `bigint-write-range`,
          }),
        ).toEqual([])
      }
    }, [() => driver.close()])
  })

  it(`reads a legacy persisted BigInt beyond the new write range`, async () => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })
    const collectionId = `legacy-bigint-read`
    const tableName = createPersistedTableName(collectionId, `c`)
    const legacyValue = 10n ** 30n

    await withFailurePreservingCleanup(async () => {
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-legacy-bigint-read`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `legacy`,
              value: { id: `legacy`, count: 1n },
            },
          ],
        },
      )
      driver
        .getDatabase()
        .prepare(`UPDATE "${tableName}" SET value = ?`)
        .run(
          JSON.stringify({
            id: `legacy`,
            count: {
              [PERSISTED_TYPE_TAG]: `bigint`,
              [PERSISTED_VALUE_TAG]: legacyValue.toString(),
            },
          }),
        )

      if (!adapter.scanRows) {
        throw new Error(`real SQLite adapter did not expose scanRows`)
      }
      const scanned = await adapter.scanRows({
        kind: `eager`,
        collectionId: collectionId,
      })
      expect(scanned.map((row) => row.value)).toEqual([
        { id: `legacy`, count: legacyValue },
      ])

      const subset = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`id`]),
            new IR.Value(`legacy`),
          ]),
        },
      )
      expect(subset.map((row) => row.value)).toEqual([
        { id: `legacy`, count: legacyValue },
      ])
    }, [() => driver.close()])
  })

  it.each([
    {
      label: `scalar comparison`,
      rejectedValue: SQLITE_BIGINT_MAX + 1n,
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value(SQLITE_BIGINT_MAX + 1n),
      ]),
    },
    {
      label: `ordinary IN`,
      rejectedValue: SQLITE_BIGINT_MIN - 1n,
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value([0n, SQLITE_BIGINT_MIN - 1n]),
      ]),
    },
    {
      label: `batched IN`,
      rejectedValue: SQLITE_BIGINT_MAX + 1n,
      where: new IR.Func<boolean>(`in`, [
        new IR.PropRef([`largeViewCount`]),
        new IR.Value([
          ...Array.from({ length: 900 }, (_unused, index) => BigInt(index)),
          SQLITE_BIGINT_MAX + 1n,
        ]),
      ]),
    },
  ])(
    `rejects an out-of-range BigInt in a $label before SQLite comparison`,
    async ({ rejectedValue, where }) => {
      const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
      const adapter = createSQLiteCorePersistenceAdapter({ driver })
      const collectionId = `bigint-query-range`

      await withFailurePreservingCleanup(async () => {
        await adapter.applyCommittedTx(
          { kind: `eager`, collectionId: collectionId },
          {
            txId: `seed-bigint-query-range`,
            term: 1,
            seq: 1,
            rowVersion: 1,
            mutations: [
              {
                type: `insert`,
                key: `zero`,
                value: { largeViewCount: 0n },
              },
            ],
          },
        )

        await expect(
          adapter.loadSubset(
            { kind: `eager`, collectionId: collectionId },
            { where },
          ),
        ).rejects.toThrow(bigintRangeError(rejectedValue))
      }, [() => driver.close()])
    },
  )

  it(`rejects a hostile serialized out-of-range BigInt index constant`, async () => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver })
    const value = SQLITE_BIGINT_MAX + 1n

    await withFailurePreservingCleanup(async () => {
      await expect(
        adapter.ensureIndex(
          { kind: `eager`, collectionId: `bigint-index-range` },
          `out-of-range`,
          {
            expressionSql: [
              serializeIndexExpression(
                new IR.Func(`add`, [
                  new IR.PropRef([`largeViewCount`]),
                  new IR.Value(value),
                ]),
              ),
            ],
          },
        ),
      ).rejects.toThrow(bigintRangeError(value))
    }, [() => driver.close()])
  })

  it(`does not confuse an alias-qualified field ref with a nested JSON path`, async () => {
    const observation = await observeExpressionIndexScenario({
      label: `alias-qualified-field`,
      indexExpression: new IR.PropRef([`score`]),
      where: new IR.Func<boolean>(`gt`, [
        new IR.PropRef([`todos`, `score`], `todos`),
        new IR.Value(1),
      ]),
      rows: [
        { key: `matching`, value: { score: 2 } },
        { key: `different`, value: { score: 0 } },
      ],
    })
    const diagnostic = JSON.stringify(
      {
        sql: observation.predicateQuery.sql,
        params: observation.predicateQuery.params,
        plan: observation.plan.map((row) => row.detail),
        adapterKeys: observation.adapterKeys,
        directSqlKeys: observation.directSqlKeys,
      },
      null,
      2,
    )

    expect(observation.adapterKeys, diagnostic).toEqual([`matching`])
    expect(observation.directSqlKeys, diagnostic).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
      diagnostic,
    ).toBe(true)
  })

  it(`does not guess that a legacy nested path is an alias`, async () => {
    const baseDriver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const adapter = createSQLiteCorePersistenceAdapter({ driver: baseDriver })
    const collectionId = `legacy-nested-path`

    await withFailurePreservingCleanup(async () => {
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `seed-legacy-nested-path`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `nested-match`,
              value: {
                profile: { [`meta-field`]: `alpha` },
                [`meta-field`]: `flat-other`,
              },
            },
            {
              type: `insert`,
              key: `flat-only`,
              value: { [`meta-field`]: `alpha` },
            },
          ],
        },
      )

      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`profile`, `meta-field`]),
            new IR.Value(`alpha`),
          ]),
        },
      )

      expect(rows.map((row) => row.key)).toEqual([`nested-match`])
    }, [() => baseDriver.close()])
  })

  it(`exposes an overbroad indexed predicate hidden by in-memory re-filtering`, async () => {
    const observation = await observeExpressionIndexScenario({
      label: `overbroad-indexed-predicate`,
      indexExpression: new IR.PropRef([`score`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`score`]),
        new IR.Value(`2`),
      ]),
      rows: [
        { key: `lower`, value: { score: `1` } },
        { key: `matching`, value: { score: `2` } },
        { key: `higher`, value: { score: `3` } },
      ],
      transformQuery: makeOverbroadEqualityMutation,
    })

    expect(observation.adapterKeys).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(true)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(false)
    expect(observation.directSqlKeys).toEqual([`higher`, `matching`])
  })

  it(`kills the former path-binding compiler behavior at the driver boundary`, async () => {
    const observation = await observeExpressionIndexScenario({
      label: `legacy-path-binding`,
      indexExpression: new IR.PropRef([`score`]),
      where: new IR.Func<boolean>(`eq`, [
        new IR.PropRef([`score`]),
        new IR.Value(`2`),
      ]),
      rows: [
        { key: `matching`, value: { score: `2` } },
        { key: `different`, value: { score: `3` } },
      ],
      transformQuery: makeLegacyPathBindingMutation,
    })

    expect(observation.adapterKeys).toEqual([`matching`])
    expect(observation.directSqlKeys).toEqual([`matching`])
    expect(
      planUsesNamedIndex(
        observation.plan,
        observation.tableName,
        observation.indexName,
      ),
    ).toBe(false)
    expect(planScansTable(observation.plan, observation.tableName)).toBe(true)
  })

  it(`recognizes equivalent SQLite plan identifier formats without prefix collisions`, () => {
    const tableName = `rows`
    const indexName = `literal_ddl`

    for (const detail of [
      `SEARCH rows USING INDEX literal_ddl (<expr>=?)`,
      `SEARCH TABLE rows USING INDEX literal_ddl (<expr>=?)`,
      `SEARCH "rows" USING INDEX "literal_ddl" (<expr>=?)`,
      `SEARCH TABLE "rows" USING INDEX "literal_ddl" (<expr>=?)`,
    ]) {
      expect(planUsesNamedIndex([{ detail }], tableName, indexName)).toBe(true)
    }

    for (const detail of [`SCAN rows`, `SCAN TABLE rows`, `SCAN "rows"`]) {
      expect(planScansTable([{ detail }], tableName)).toBe(true)
    }

    expect(
      planUsesNamedIndex(
        [
          {
            detail: `SEARCH rows_archive USING INDEX literal_ddl_backup (<expr>=?)`,
          },
        ],
        tableName,
        indexName,
      ),
    ).toBe(false)
    expect(planScansTable([{ detail: `SCAN rows_archive` }], tableName)).toBe(
      false,
    )
  })

  it(`distinguishes rejected DDL path binding from correct predicate rows without index use`, async () => {
    const driver = new BetterSqlite3SQLiteDriver({ filename: `:memory:` })
    const database = driver.getDatabase()
    const jsonPath = `$.payload.threadId`
    const target = `thread-'1`

    await withFailurePreservingCleanup(() => {
      database.exec(
        `CREATE TABLE rows (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      )
      const insert = database.prepare(
        `INSERT INTO rows (key, value) VALUES (?, ?)`,
      )
      insert.run(`matching`, JSON.stringify({ payload: { threadId: target } }))
      insert.run(
        `different`,
        JSON.stringify({ payload: { threadId: `thread-2` } }),
      )

      // SQLite rejects a DDL-path binding before an index can exist. This is
      // a setup-rejection control only, not the production oracle's RED.
      expect(() =>
        database
          .prepare(`CREATE INDEX bound_ddl ON rows (json_extract(value, ?))`)
          .run(jsonPath),
      ).toThrow(/parameters prohibited in index expressions/i)

      database.exec(
        `CREATE INDEX literal_ddl ON rows (json_extract(value, ${sqliteLiteral(jsonPath)}))`,
      )
      const literalPredicate = `SELECT key FROM rows WHERE json_extract(value, ${sqliteLiteral(jsonPath)}) = ?`
      const boundPredicate = `SELECT key FROM rows WHERE json_extract(value, ?) = ?`
      const literalRows = database.prepare(literalPredicate).all(target)
      const boundRows = database.prepare(boundPredicate).all(jsonPath, target)
      const literalPlan = database
        .prepare(`EXPLAIN QUERY PLAN ${literalPredicate}`)
        .all(target) as Array<QueryPlanRow>
      const boundPlan = database
        .prepare(`EXPLAIN QUERY PLAN ${boundPredicate}`)
        .all(jsonPath, target) as Array<QueryPlanRow>

      // Same correct rows, different plan: a row-only assertion is
      // false-green. This predicate-plan mismatch kills the hostile mutant.
      expect(boundRows).toEqual(literalRows)
      expect(planUsesNamedIndex(literalPlan, `rows`, `literal_ddl`)).toBe(true)
      expect(planScansTable(literalPlan, `rows`)).toBe(false)
      expect(planUsesNamedIndex(boundPlan, `rows`, `literal_ddl`)).toBe(false)
      expect(planScansTable(boundPlan, `rows`)).toBe(true)
    }, [() => driver.close()])
  })
})

describe(`Temporal expression-index refinement`, () => {
  it.each(temporalFamilies)(
    `preserves wrapper-created native coalesce literals / $name`,
    async (family) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        const expression = new IR.Func(`coalesce`, [
          new IR.PropRef([`stamp`]),
          new IR.Value(temporalValue(family, 1)),
        ])
        const result = await observeExpressionIndexScenario({
          label: `wrapper-${family.name}`,
          viaWrapper: true,
          indexExpression: expression,
          where: new IR.Func<boolean>(`eq`, [
            expression,
            new IR.Value(temporalValue(family, 1)),
          ]),
          rows: family.texts.map((_, i) => ({
            key: `row-${i}`,
            value: {
              id: `row-${i}`,
              stamp: i === 1 ? null : temporalValue(family, i),
            },
          })),
        })
        expect(result.adapterKeys).toEqual([`row-1`])
        expect(result.directSqlKeys).toEqual([`row-1`])
        expect(
          planUsesNamedIndex(result.plan, result.tableName, result.indexName),
          JSON.stringify(result),
        ).toBe(true)
        expect(planScansTable(result.plan, result.tableName)).toBe(false)
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it.each(temporalFamilies)(
    `retains native identity through numeric array and object paths / $name`,
    async (family) => {
      vi.stubGlobal(`Temporal`, Temporal)
      try {
        const ref = new IR.PropRef([`dates`, `0`])
        for (const carrier of [`array`, `object`] as const) {
          const rows = family.texts.map((_, i) => ({
            key: `row-${i}`,
            value: {
              dates:
                carrier === `array`
                  ? [temporalValue(family, i)]
                  : { 0: temporalValue(family, i) },
            },
          }))
          for (const operator of [`eq`, `in`] as const) {
            const expression = new IR.Func<boolean>(operator, [
              ref,
              new IR.Value(
                operator === `eq`
                  ? temporalValue(family, 1)
                  : [temporalValue(family, 1)],
              ),
            ])
            const result = await observeExpressionIndexScenario({
              label: `${family.name}-${carrier}-${operator}`,
              indexExpression: expression,
              where: expression,
              rows,
              observeIndexValues: true,
            })
            expect(result.adapterKeys).toEqual([`row-1`])
            expect(result.directSqlKeys).toEqual([`row-1`])
            expect(result.indexValues).toEqual(
              family.texts.map((_, i) => ({
                key: `row-${i}`,
                value: i === 1 ? 1 : 0,
              })),
            )
          }
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it(`preserves the primary failure and still closes SQLite`, async () => {
    const { CollectionImpl } = await import('../../db/src/collection/index')
    const primary = new Error(`primary metadata failure`)
    const cleanup = new Error(`secondary cleanup failure`)
    const cleanupOriginal = CollectionImpl.prototype.cleanup
    const execOriginal = BetterSqlite3SQLiteDriver.prototype.exec
    let driver: BetterSqlite3SQLiteDriver | undefined
    const execSpy = vi
      .spyOn(BetterSqlite3SQLiteDriver.prototype, `exec`)
      .mockImplementation(function (this: BetterSqlite3SQLiteDriver, sql) {
        driver = this
        return execOriginal.call(this, sql)
      })
    const closeSpy = vi.spyOn(BetterSqlite3SQLiteDriver.prototype, `close`)
    const cleanupSpy = vi
      .spyOn(CollectionImpl.prototype, `cleanup`)
      .mockImplementation(async function (
        this: InstanceType<typeof CollectionImpl>,
      ) {
        await cleanupOriginal.call(this)
        throw cleanup
      })
    const metadataSpy = vi
      .spyOn(CollectionImpl.prototype, `getIndexMetadata`)
      .mockImplementation(() => {
        throw primary
      })
    vi.stubGlobal(`Temporal`, Temporal)
    try {
      const result = await observeExpressionIndexScenario({
        label: `prep-cleanup`,
        viaWrapper: true,
        indexExpression: new IR.Func(`coalesce`, [
          new IR.PropRef([`stamp`]),
          new IR.Value(Temporal.Instant.from(`2026-01-01T00:00:00Z`)),
        ]),
        rows: [],
      }).then(
        () => undefined,
        (error) => error,
      )
      expect.soft(result).toBeInstanceOf(AggregateError)
      expect.soft(result?.errors).toEqual([primary, cleanup])
      expect.soft(closeSpy).toHaveBeenCalledTimes(1)
    } finally {
      metadataSpy.mockRestore()
      cleanupSpy.mockRestore()
      closeSpy.mockRestore()
      execSpy.mockRestore()
      driver?.close()
      vi.unstubAllGlobals()
    }
  })
})
