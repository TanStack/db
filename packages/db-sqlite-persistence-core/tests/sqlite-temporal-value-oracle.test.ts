// @vitest-environment node
/**
 * Can accepted typed values survive a SQLite close/reopen without losing meaning?
 *
 * Authority: the existing core adapter contract preserves Date and BigInt.
 * Issue https://github.com/TanStack/db/issues/2034 requests the same behavior for
 * Temporal.Instant and Temporal.PlainDate. The approved v2 design requires
 * native reconstruction with registered global constructors. Missing support
 * rejects explicitly; new marker-shaped records remain ordinary data.
 *
 * Model: two independent fixture ordinals mean earlier/later. Expected values
 * are literal type/text records, and expected query keys follow those ordinals.
 * No production encoder, decoder, SQL compiler, or comparator supplies truth.
 * Type/text records are model-only observations, not a proposed storage format.
 *
 * Bounded grammar: Date, ISO string, Instant, and PlainDate; insert then optional
 * update that swaps the two values; with/without an installed expression index.
 * Every write carries direct/nested row values, inline row metadata, separate
 * row metadata, and collection metadata. The update swaps value order while
 * retaining keys, exposing collapsed-value ties. All 16 cells run; no random campaign.
 * Removing kind loses Temporal reach or passing controls; removing update loses
 * replacement/replay coverage; removing index loses that query configuration.
 * Fresh unique keys and monotonic transaction positions exclude invalid writes.
 *
 * Driver/checkpoint: real SQLiteCorePersistenceAdapter over file-backed
 * node:sqlite. After committed writes, close the handle, create a new handle
 * and adapter, and observe loadSubset, scanRows, loadCollectionMetadata, and
 * pullSince. Queries check equality, range, and both positions of an ordered
 * one-row window. Installed indexes have a sqlite_master reach witness; this
 * oracle does not claim the query planner uses them.
 *
 * Limits: one polyfill copy and in-process reopen. The companion rank/text
 * model below adds precision, supported-range endpoints, signed years and
 * calendar annotations. Other Temporal kinds, engine-native constructors,
 * truncate/delete histories, crashes and mobile/browser hosts remain outside
 * this owner. The Node expression-index owner separately observes raw SQL and
 * actual index use with these values.
 *
 * Calibration: the same comparison rejects empty objects, ISO-string erasure,
 * wrong same-type values, missing/duplicate rows, and reversed query output.
 * afterEach owns handles/files; Vitest retains assertion and teardown failures
 * separately. The review record documents ORC outcomes and exact run receipts:
 * docs/contributing/oracle-reviews/issue-2034-temporal-persistence.md.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { IR } from '@tanstack/db'
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SQLiteCorePersistenceAdapter } from '../src'
import {
  temporalFamilies,
  temporalQueryCases,
  temporalValue,
} from './temporal-value-oracle'
import { harnessScope } from './contracts/harness-scope'
import type { PersistedTx, SQLiteDriver } from '../src'
import type { SQLInputValue } from 'node:sqlite'

type Kind = `Date` | `ISO string` | `Instant` | `PlainDate`
type Ordinal = 0 | 1
type History = `insert` | `update`
const kinds: Array<Kind> = [`Date`, `ISO string`, `Instant`, `PlainDate`]
const histories: Array<History> = [`insert`, `update`]
const collectionId = `typed-values`
const keys = [`z-early`, `a-late`] as const

function textFor(kind: Kind, ordinal: Ordinal): string {
  const day = ordinal === 0 ? `2026-01-02` : `2026-01-03`
  return kind === `PlainDate`
    ? day
    : `${day}T00:00:00${kind === `Instant` ? `` : `.000`}Z`
}

function inputValue(kind: Kind, ordinal: Ordinal): unknown {
  const text = textFor(kind, ordinal)
  switch (kind) {
    case `Date`:
      return new Date(text)
    case `ISO string`:
      return text
    case `Instant`:
      return Temporal.Instant.from(text)
    case `PlainDate`:
      return Temporal.PlainDate.from(text)
  }
}

function expectedValue(kind: Kind, ordinal: Ordinal): unknown {
  const text = textFor(kind, ordinal)
  return kind === `ISO string` ? text : { kind, text }
}

// Explicit native-type observations catch same-class objects whose enumerable
// fields are empty. Deep equality alone can miss a changed Temporal value.
function observe(value: unknown): unknown {
  if (value instanceof Date) return { kind: `Date`, text: value.toISOString() }
  if (value instanceof Temporal.Instant) {
    return { kind: `Instant`, text: value.toString() }
  }
  if (value instanceof Temporal.PlainDate) {
    return { kind: `PlainDate`, text: value.toString() }
  }
  if (Array.isArray(value)) return value.map(observe)
  if (value !== null && typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, observe(entry)]),
    )
  }
  return value
}

function check(
  actual: unknown,
  expected: unknown,
  checkpoint: string,
  assertion: typeof expect.soft = expect,
): void {
  assertion(observe(actual), checkpoint).toStrictEqual(expected)
}

function binding(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  )
    return value
  throw new Error(`Unexpected SQLite binding: ${String(value)}`)
}

function createDriver(database: DatabaseSync): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      Promise.resolve(
        database.prepare(sql).all(...params.map(binding)) as Array<T>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(binding))
      return Promise.resolve()
    },
    transaction: async (task) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await task(driver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return driver
}

const scope = harnessScope(() => {
  const directory = mkdtempSync(join(tmpdir(), `db-temporal-oracle-`))
  let database: DatabaseSync | undefined
  function close(): void {
    database?.close()
    database = undefined
  }
  return {
    open() {
      close()
      database = new DatabaseSync(join(directory, `state.sqlite`))
      return {
        database,
        adapter: new SQLiteCorePersistenceAdapter({
          driver: createDriver(database),
        }),
      }
    },
    cleanup() {
      try {
        close()
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
})

beforeEach(() => vi.stubGlobal(`Temporal`, Temporal))
afterEach(() => vi.unstubAllGlobals())
afterEach(scope.cleanup)

function payload(value: unknown): Record<string, unknown> {
  return { stamp: value, nested: { dates: [value] } }
}

function transaction(kind: Kind, history: History): PersistedTx {
  const seq = history === `insert` ? 2 : 3
  const ordinals: Array<Ordinal> = history === `insert` ? [0, 1] : [1, 0]
  return {
    txId: `values-${seq}`,
    term: 1,
    seq,
    rowVersion: seq,
    mutations: keys.map((key, index) => ({
      type: history,
      key,
      value: { id: key, ...payload(inputValue(kind, ordinals[index]!)) },
      metadata: payload(inputValue(kind, ordinals[index]!)),
      metadataChanged: true,
    })),
    // A separate key retains the independent row-metadata mutation path.
    rowMetadataMutations: [
      {
        type: `set`,
        key: `metadata-only`,
        value: payload(inputValue(kind, 1)),
      },
    ],
    collectionMetadataMutations: [
      {
        type: `set`,
        key: `checkpoint`,
        value: payload(inputValue(kind, 0)),
      },
    ],
  }
}

// Recompute the complete public result from fixture ordinals. This model does
// not read the driver's transaction or persisted bytes to derive expectations.
function expectedRows(kind: Kind, history: History) {
  return [
    {
      key: `metadata-only`,
      value: { id: `metadata-only` },
      metadata: payload(expectedValue(kind, 1)),
    },
    ...keys.map((key, index) => {
      const ordinal = (history === `insert` ? index : 1 - index) as Ordinal
      const value = payload(expectedValue(kind, ordinal))
      return { key, value: { id: key, ...value }, metadata: value }
    }),
  ].sort((a, b) => a.key.localeCompare(b.key))
}

const cases = kinds.flatMap((kind) =>
  histories.flatMap((history) =>
    [false, true].map((indexed) => ({ kind, history, indexed })),
  ),
)

describe(`SQLite typed-value preservation after reopen`, () => {
  it.each(cases)(
    `$kind / $history / indexed=$indexed`,
    async ({ kind, history, indexed }) => {
      const harness = scope.create()
      const { adapter } = harness.open()
      await adapter.applyCommittedTx(collectionId, {
        txId: `baseline`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `metadata-only`,
            value: { id: `metadata-only` },
          },
        ],
      })
      await adapter.applyCommittedTx(collectionId, transaction(kind, `insert`))
      if (history === `update`) {
        await adapter.applyCommittedTx(
          collectionId,
          transaction(kind, `update`),
        )
      }
      if (indexed) {
        await adapter.ensureIndex(collectionId, `stamp`, {
          expressionSql: [JSON.stringify({ type: `ref`, path: [`stamp`] })],
        })
      }

      const { adapter: reopened, database } = harness.open()
      const indexes = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT index_name FROM persisted_index_registry WHERE collection_id = ? AND signature = ?)`,
        )
        .all(collectionId, `stamp`)
      expect(indexes).toHaveLength(indexed ? 1 : 0)
      const expected = expectedRows(kind, history)
      const rows = await reopened.loadSubset(collectionId, {})
      const scanned = await reopened.scanRows(collectionId, {})
      // Soft checks continue to the replay and query checkpoints after a mismatch.
      for (const [checkpoint, actual] of [
        [`hydration`, rows],
        [`scan`, scanned],
      ] as const) {
        check(
          [...actual].sort((a, b) =>
            String(a.key).localeCompare(String(b.key)),
          ),
          expected,
          checkpoint,
          expect.soft,
        )
      }
      const metadata = await reopened.loadCollectionMetadata(collectionId)
      check(
        metadata,
        [{ key: `checkpoint`, value: payload(expectedValue(kind, 0)) }],
        `collection metadata`,
        expect.soft,
      )

      const seq = history === `insert` ? 2 : 3
      const replay = await reopened.pullSince(collectionId, seq - 1)
      expect(replay.requiresFullReload, `replay payload reached`).toBe(false)
      if (replay.requiresFullReload)
        throw new Error(`Expected a replay payload`)
      const expectedChangedRows = keys.map((key) => {
        const row = expected.find((entry) => entry.key === key)!
        return { key, value: row.value }
      })
      check(
        replay.deltas,
        [
          {
            txId: `values-${seq}`,
            latestRowVersion: seq,
            changedRows: expectedChangedRows,
            deletedKeys: [],
            rowMetadataMutations: [
              {
                type: `set`,
                key: `metadata-only`,
                value: payload(expectedValue(kind, 1)),
              },
            ],
            collectionMetadataMutations: [
              {
                type: `set`,
                key: `checkpoint`,
                value: payload(expectedValue(kind, 0)),
              },
            ],
          },
        ],
        `transaction replay`,
        expect.soft,
      )

      const earlier = history === `insert` ? keys[0] : keys[1]
      const later = history === `insert` ? keys[1] : keys[0]
      for (const [operator, expectedKey] of [
        [`eq`, earlier],
        [`gt`, later],
      ] as const) {
        const matches = await reopened.loadSubset(collectionId, {
          where: new IR.Func(operator, [
            new IR.PropRef([`stamp`]),
            new IR.Value(inputValue(kind, 0)),
          ]),
        })
        check(
          matches.map((row) => row.key),
          [expectedKey],
          `${operator} query`,
          expect.soft,
        )
      }
      for (const [offset, expectedKey] of [
        [0, earlier],
        [1, later],
      ] as const) {
        const page = await reopened.loadSubset(collectionId, {
          orderBy: [
            {
              expression: new IR.PropRef([`stamp`]),
              compareOptions: { direction: `asc`, nulls: `last` },
            },
          ],
          limit: 1,
          offset,
        })
        check(
          page.map((row) => row.key),
          [expectedKey],
          `ordered page ${offset}`,
          expect.soft,
        )
      }
    },
  )
})

describe(`typed-value oracle calibration`, () => {
  it.each(kinds)(`distinguishes type and value for $0`, (kind) => {
    check(inputValue(kind, 0), expectedValue(kind, 0), `valid value`)
    expect(() => check({}, expectedValue(kind, 0), `empty object`)).toThrow()
    expect(() =>
      check(inputValue(kind, 1), expectedValue(kind, 0), `wrong value`),
    ).toThrow()
    if (kind !== `ISO string`) {
      expect(() =>
        check(textFor(kind, 0), expectedValue(kind, 0), `type erased`),
      ).toThrow()
    }
  })

  it(`rejects missing, duplicate, and reversed query results`, () => {
    const expected = [`z-early`, `a-late`]
    check(expected, expected, `valid keys`)
    for (const actual of [
      [],
      [`z-early`, `z-early`],
      [...expected].reverse(),
    ]) {
      expect(() => check(actual, expected, `query keys`)).toThrow()
    }
    expect(cases).toHaveLength(16)
    expect(
      new Set(
        cases.map(
          ({ kind, history, indexed }) => `${kind}/${history}/${indexed}`,
        ),
      ).size,
    ).toBe(16)
  })
})

// V2 extends the same physical-reopen owner with bounded value families. Rank
// and text come from the independent companion model; SQL never supplies truth.
describe(`native Temporal query refinement`, () => {
  it.each(temporalFamilies)(`$kind / $name`, async (family) => {
    const harness = scope.create()
    const { adapter } = harness.open()
    await adapter.applyCommittedTx(collectionId, {
      txId: `seed`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: family.texts.map((_, i) => ({
        type: `insert`,
        key: `row-${i}`,
        value: {
          stamp: temporalValue(family, i),
          target: temporalValue(family, 1),
        },
      })),
    })
    const { adapter: reopened } = harness.open()
    for (const query of temporalQueryCases(family)) {
      const rows = await reopened.loadSubset(collectionId, {
        where: query.where,
      })
      expect
        .soft(rows.map((row) => row.key).sort(), query.name)
        .toEqual(query.expectedKeys)
    }
    const target = new IR.Value(temporalValue(family, 1))
    const stamp = new IR.PropRef([`stamp`])
    const cursorRows = await reopened.loadSubset(collectionId, {
      cursor: {
        whereCurrent: new IR.Func(`and`, [
          new IR.Func(`gte`, [stamp, target]),
          new IR.Func(`lte`, [stamp, target]),
        ]),
        whereFrom: new IR.Func(`gt`, [stamp, target]),
      },
      orderBy: [
        {
          expression: stamp,
          compareOptions: { direction: `asc`, nulls: `last` },
        },
      ],
      limit: 1,
    })
    const currentKeys = family.texts.flatMap((_, i) =>
      family.ranks[i] === family.ranks[1] ? [`row-${i}`] : [],
    )
    const followingKeys = family.texts
      .flatMap((_, i) =>
        family.ranks[i]! > family.ranks[1] ? [`row-${i}`] : [],
      )
      .slice(0, 1)
    expect
      .soft(
        cursorRows.map((row) => row.key),
        `cursor tie group and continuation`,
      )
      .toEqual([...currentKeys, ...followingKeys])
    const ordered = family.texts
      .map((_, i) => i)
      .sort((a, b) => family.ranks[a]! - family.ranks[b]! || a - b)
    for (const [offset, index] of ordered.entries()) {
      const rows = await reopened.loadSubset(collectionId, {
        orderBy: [
          {
            expression: new IR.PropRef([`stamp`]),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
        ],
        offset,
        limit: 1,
      })
      expect.soft(rows.map((row) => row.key)).toEqual([`row-${index}`])
      check(
        rows[0]?.value.stamp,
        { kind: family.kind, text: family.texts[index] },
        `native result`,
        expect.soft,
      )
    }
  })

  it(`preserves marker-shaped records and rejects missing or unsupported constructors atomically`, async () => {
    const { adapter } = scope.create().open()
    const marker = {
      __tanstack_db_persisted_type__: `Temporal.Instant`,
      value: `2026-01-02T00:00:00Z`,
      order: `unused`,
    }
    const tx: PersistedTx = {
      txId: `record`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `record`,
          value: { marker, stamp: Temporal.Instant.from(marker.value) },
        },
      ],
    }
    await adapter.applyCommittedTx(collectionId, tx)
    const before = await adapter.loadResumeSnapshot(collectionId)
    expect(before.rows[0]?.value.marker).toEqual(marker)
    const nested = await adapter.loadSubset(collectionId, {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`marker`, `value`]),
        new IR.Value(marker.value),
      ]),
    })
    expect(
      nested.map((row) => row.key),
      `escaped record query`,
    ).toEqual([`record`])
    vi.stubGlobal(`Temporal`, undefined)
    await expect(adapter.loadSubset(collectionId, {})).rejects.toThrow(
      /Temporal/,
    )
    await expect(
      adapter.applyCommittedTx(collectionId, {
        ...tx,
        txId: `missing`,
        seq: 2,
        rowVersion: 2,
      }),
    ).rejects.toThrow(/Temporal/)
    vi.stubGlobal(`Temporal`, Temporal)
    await expect(
      adapter.applyCommittedTx(collectionId, {
        ...tx,
        txId: `unsupported`,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `unsupported`,
            value: { stamp: Temporal.Duration.from(`P1D`) },
          },
        ],
      }),
    ).rejects.toThrow(/Temporal/)
    await expect(
      adapter.applyCommittedTx(collectionId, {
        ...tx,
        txId: `invalid-brand`,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `fake`,
            value: {
              stamp: Object.create(Temporal.Instant.prototype) as unknown,
            },
          },
        ],
      }),
    ).rejects.toThrow(/Invalid Temporal/)
    check(
      await adapter.loadResumeSnapshot(collectionId),
      observe(before),
      `rollback`,
    )
  })
})

// Equality is a pair relation: separate IN sets for order and identity can
// accidentally combine matches from different ordinary string literals.
it(`keeps native IN membership distinct from lookalike string keys`, async () => {
  const { adapter } = scope.create().open()
  const orderText = `10000000000000000000000`
  const identityText = `Temporal.Instant:1970-01-01T00:00:00Z`
  const values = [
    Temporal.Instant.from(`1970-01-01T00:00:00Z`),
    orderText,
    identityText,
  ]
  await adapter.applyCommittedTx(collectionId, {
    txId: `mixed`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: values.map((stamp, i) => ({
      type: `insert`,
      key: `row-${i}`,
      value: { stamp },
    })),
  })
  const predicate = new IR.Func<boolean>(`in`, [
    new IR.PropRef([`stamp`]),
    new IR.Value([orderText, identityText]),
  ])
  expect(
    (await adapter.loadSubset(collectionId, { where: predicate }))
      .map((row) => row.key)
      .sort(),
  ).toEqual([`row-1`, `row-2`])
  expect(
    (
      await adapter.loadSubset(collectionId, {
        where: new IR.Func(`not`, [predicate]),
      })
    ).map((row) => row.key),
  ).toEqual([`row-0`])
})
