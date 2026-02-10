import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
} from '../src'
import type { SQLiteDriver } from '../src'

type Todo = {
  id: string
  title: string
  createdAt: string
  score: number
}

const execFileAsync = promisify(execFile)

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return `NULL`
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? String(value) : `NULL`
  }

  if (typeof value === `boolean`) {
    return value ? `1` : `0`
  }

  if (typeof value === `bigint`) {
    return value.toString()
  }

  const textValue = typeof value === `string` ? value : String(value)
  return `'${textValue.replace(/'/g, `''`)}'`
}

function interpolateSql(sql: string, params: ReadonlyArray<unknown>): string {
  let parameterIndex = 0
  const renderedSql = sql.replace(/\?/g, () => {
    const currentParam = params[parameterIndex]
    parameterIndex++
    return toSqlLiteral(currentParam)
  })

  if (parameterIndex !== params.length) {
    throw new Error(
      `SQL interpolation mismatch: used ${parameterIndex} params, received ${params.length}`,
    )
  }

  return renderedSql
}

class SqliteCliDriver implements SQLiteDriver {
  constructor(private readonly dbPath: string) {}

  async exec(sql: string): Promise<void> {
    await execFileAsync(`sqlite3`, [this.dbPath, sql])
  }

  async query<T>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>> {
    const renderedSql = interpolateSql(sql, params ?? [])
    const { stdout } = await execFileAsync(`sqlite3`, [
      `-json`,
      this.dbPath,
      renderedSql,
    ])
    const trimmedOutput = stdout.trim()
    if (!trimmedOutput) {
      return []
    }
    return JSON.parse(trimmedOutput) as Array<T>
  }

  async run(sql: string, params?: ReadonlyArray<unknown>): Promise<void> {
    const renderedSql = interpolateSql(sql, params ?? [])
    await execFileAsync(`sqlite3`, [this.dbPath, renderedSql])
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }
}

type AdapterHarness = {
  adapter: SQLiteCorePersistenceAdapter<Todo, string>
  driver: SqliteCliDriver
  dbPath: string
  cleanup: () => void
}

function createHarness(
  options?: ConstructorParameters<typeof SQLiteCorePersistenceAdapter<Todo, string>>[0],
): AdapterHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new SqliteCliDriver(dbPath)
  const adapter = new SQLiteCorePersistenceAdapter<Todo, string>({
    driver,
    ...options,
  })

  return {
    adapter,
    driver,
    dbPath,
    cleanup: () => {
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}

const activeCleanupFns: Array<() => void> = []

afterEach(() => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    cleanupFn?.()
  }
})

function registerHarness(
  options?: ConstructorParameters<typeof SQLiteCorePersistenceAdapter<Todo, string>>[0],
): AdapterHarness {
  const harness = createHarness(options)
  activeCleanupFns.push(harness.cleanup)
  return harness
}

describe(`SQLiteCorePersistenceAdapter`, () => {
  it(`applies transactions idempotently with row versions and tombstones`, async () => {
    const { adapter, driver } = registerHarness()
    const collectionId = `todos`

    await adapter.applyCommittedTx(collectionId, {
      txId: `tx-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `1`,
          value: {
            id: `1`,
            title: `Initial`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 10,
          },
        },
      ],
    })
    await adapter.applyCommittedTx(collectionId, {
      txId: `tx-1-replay`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `1`,
          value: {
            id: `1`,
            title: `Initial`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 10,
          },
        },
      ],
    })

    const txRows = await driver.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
      [collectionId],
    )
    expect(txRows[0]?.count).toBe(1)

    await adapter.applyCommittedTx(collectionId, {
      txId: `tx-2`,
      term: 1,
      seq: 2,
      rowVersion: 2,
      mutations: [
        {
          type: `update`,
          key: `1`,
          value: {
            id: `1`,
            title: `Updated`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 11,
          },
        },
      ],
    })

    const updated = await adapter.loadSubset(collectionId, {
      where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(`1`)]),
    })
    expect(updated).toEqual([
      {
        key: `1`,
        value: {
          id: `1`,
          title: `Updated`,
          createdAt: `2026-01-01T00:00:00.000Z`,
          score: 11,
        },
      },
    ])

    await adapter.applyCommittedTx(collectionId, {
      txId: `tx-3`,
      term: 1,
      seq: 3,
      rowVersion: 3,
      mutations: [
        {
          type: `delete`,
          key: `1`,
          value: {
            id: `1`,
            title: `Updated`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 11,
          },
        },
      ],
    })

    const remainingRows = await adapter.loadSubset(collectionId, {})
    expect(remainingRows).toEqual([])

    const tombstoneTable = createPersistedTableName(collectionId, `t`)
    const tombstoneRows = await driver.query<{ key: string; row_version: number }>(
      `SELECT key, row_version FROM "${tombstoneTable}"`,
    )
    expect(tombstoneRows).toHaveLength(1)
    expect(tombstoneRows[0]?.row_version).toBe(3)
  })

  it(`supports pushdown operators with correctness-preserving fallback`, async () => {
    const { adapter } = registerHarness()
    const collectionId = `todos`

    const rows: Array<Todo> = [
      {
        id: `1`,
        title: `Task Alpha`,
        createdAt: `2026-01-01T00:00:00.000Z`,
        score: 10,
      },
      {
        id: `2`,
        title: `Task Beta`,
        createdAt: `2026-01-02T00:00:00.000Z`,
        score: 20,
      },
      {
        id: `3`,
        title: `Other`,
        createdAt: `2026-01-03T00:00:00.000Z`,
        score: 15,
      },
      {
        id: `4`,
        title: `Task Gamma`,
        createdAt: `2026-01-04T00:00:00.000Z`,
        score: 25,
      },
    ]

    await adapter.applyCommittedTx(collectionId, {
      txId: `seed-1`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: rows.map((row) => ({
        type: `insert` as const,
        key: row.id,
        value: row,
      })),
    })

    const filtered = await adapter.loadSubset(collectionId, {
      where: new IR.Func(`and`, [
        new IR.Func(`or`, [
          new IR.Func(`like`, [
            new IR.PropRef([`title`]),
            new IR.Value(`%Task%`),
          ]),
          new IR.Func(`in`, [new IR.PropRef([`id`]), new IR.Value([`3`])]),
        ]),
        new IR.Func(`eq`, [
          new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
          new IR.Value(`2026-01-02`),
        ]),
      ]),
      orderBy: [
        {
          expression: new IR.PropRef([`score`]),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
          },
        },
      ],
    })

    expect(filtered).toEqual([
      {
        key: `2`,
        value: {
          id: `2`,
          title: `Task Beta`,
          createdAt: `2026-01-02T00:00:00.000Z`,
          score: 20,
        },
      },
    ])

    const withInEmpty = await adapter.loadSubset(collectionId, {
      where: new IR.Func(`in`, [
        new IR.PropRef([`id`]),
        new IR.Value([] as Array<string>),
      ]),
    })
    expect(withInEmpty).toEqual([])
  })

  it(`handles cursor whereCurrent/whereFrom requests`, async () => {
    const { adapter } = registerHarness()
    const collectionId = `todos`

    await adapter.applyCommittedTx(collectionId, {
      txId: `seed-cursor`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        { type: `insert`, key: `a`, value: { id: `a`, title: `A`, createdAt: `2026-01-01T00:00:00.000Z`, score: 10 } },
        { type: `insert`, key: `b`, value: { id: `b`, title: `B`, createdAt: `2026-01-02T00:00:00.000Z`, score: 10 } },
        { type: `insert`, key: `c`, value: { id: `c`, title: `C`, createdAt: `2026-01-03T00:00:00.000Z`, score: 12 } },
        { type: `insert`, key: `d`, value: { id: `d`, title: `D`, createdAt: `2026-01-04T00:00:00.000Z`, score: 13 } },
      ],
    })

    const rows = await adapter.loadSubset(collectionId, {
      orderBy: [
        {
          expression: new IR.PropRef([`score`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
          },
        },
      ],
      limit: 1,
      cursor: {
        whereCurrent: new IR.Func(`eq`, [
          new IR.PropRef([`score`]),
          new IR.Value(10),
        ]),
        whereFrom: new IR.Func(`gt`, [
          new IR.PropRef([`score`]),
          new IR.Value(10),
        ]),
      },
    })

    expect(rows.map((row) => row.key)).toEqual([`a`, `b`, `c`])
  })

  it(`ensures and removes persisted indexes with registry tracking`, async () => {
    const { adapter, driver } = registerHarness()
    const collectionId = `todos`
    const signature = `idx-title`

    await adapter.ensureIndex(collectionId, signature, {
      expressionSql: [`json_extract(value, '$.title')`],
    })
    await adapter.ensureIndex(collectionId, signature, {
      expressionSql: [`json_extract(value, '$.title')`],
    })

    const registryRows = await driver.query<{ removed: number; index_name: string }>(
      `SELECT removed, index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
      [collectionId, signature],
    )
    expect(registryRows).toHaveLength(1)
    expect(registryRows[0]?.removed).toBe(0)

    const createdIndexName = registryRows[0]?.index_name
    const sqliteMasterBefore = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
      [createdIndexName],
    )
    expect(sqliteMasterBefore).toHaveLength(1)

    await adapter.markIndexRemoved(collectionId, signature)

    const registryRowsAfter = await driver.query<{ removed: number }>(
      `SELECT removed
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
      [collectionId, signature],
    )
    expect(registryRowsAfter[0]?.removed).toBe(1)

    const sqliteMasterAfter = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
      [createdIndexName],
    )
    expect(sqliteMasterAfter).toHaveLength(0)
  })

  it(`enforces schema mismatch policies`, async () => {
    const baseHarness = registerHarness({
      schemaVersion: 1,
      schemaMismatchPolicy: `reset`,
    })
    const collectionId = `todos`
    await baseHarness.adapter.applyCommittedTx(collectionId, {
      txId: `seed-schema`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `1`,
          value: {
            id: `1`,
            title: `Before mismatch`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
        },
      ],
    })

    const strictAdapter = new SQLiteCorePersistenceAdapter<Todo, string>({
      driver: baseHarness.driver,
      schemaVersion: 2,
      schemaMismatchPolicy: `sync-absent-error`,
    })
    await expect(strictAdapter.loadSubset(collectionId, {})).rejects.toThrow(
      /Schema version mismatch/,
    )

    const resetAdapter = new SQLiteCorePersistenceAdapter<Todo, string>({
      driver: baseHarness.driver,
      schemaVersion: 2,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    const resetRows = await resetAdapter.loadSubset(collectionId, {})
    expect(resetRows).toEqual([])
  })

  it(`returns pullSince deltas and requiresFullReload when threshold is exceeded`, async () => {
    const { adapter } = registerHarness({
      pullSinceReloadThreshold: 2,
    })
    const collectionId = `todos`

    await adapter.applyCommittedTx(collectionId, {
      txId: `seed-pull`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [
        {
          type: `insert`,
          key: `1`,
          value: {
            id: `1`,
            title: `One`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
        },
        {
          type: `insert`,
          key: `2`,
          value: {
            id: `2`,
            title: `Two`,
            createdAt: `2026-01-02T00:00:00.000Z`,
            score: 2,
          },
        },
      ],
    })
    await adapter.applyCommittedTx(collectionId, {
      txId: `seed-pull-2`,
      term: 1,
      seq: 2,
      rowVersion: 2,
      mutations: [
        {
          type: `delete`,
          key: `1`,
          value: {
            id: `1`,
            title: `One`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
        },
      ],
    })

    const delta = await adapter.pullSince(collectionId, 1)
    if (delta.requiresFullReload) {
      throw new Error(`Expected key-level delta, received full reload`)
    }
    expect(delta.changedKeys).toEqual([])
    expect(delta.deletedKeys).toEqual([`1`])

    const fullReload = await adapter.pullSince(collectionId, 0)
    expect(fullReload.requiresFullReload).toBe(true)
  })
})
