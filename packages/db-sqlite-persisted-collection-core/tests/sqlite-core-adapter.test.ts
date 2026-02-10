import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import type {
  PersistenceAdapter,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '../src'

type Todo = {
  id: string
  title: string
  createdAt: string
  score: number
}

export type SQLiteCoreAdapterContractTodo = Todo

type MixedKeyTodo = {
  id: string | number
  title: string
  createdAt: string
  score: number
}

type FlexibleTodoRow = Record<string, unknown> & {
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
  private readonly transactionDbPath = new AsyncLocalStorage<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly dbPath: string) {}

  async exec(sql: string): Promise<void> {
    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [activeDbPath, sql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [this.dbPath, sql])
    })
  }

  async query<T>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>> {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params ?? [])
    const queryActiveDbPath = activeDbPath ?? this.dbPath

    const runQuery = async () => {
      const { stdout } = await execFileAsync(`sqlite3`, [
        `-json`,
        queryActiveDbPath,
        renderedSql,
      ])
      const trimmedOutput = stdout.trim()
      if (!trimmedOutput) {
        return []
      }
      return JSON.parse(trimmedOutput) as Array<T>
    }

    if (activeDbPath) {
      return runQuery()
    }

    return this.enqueue(async () => runQuery())
  }

  async run(sql: string, params?: ReadonlyArray<unknown>): Promise<void> {
    const activeDbPath = this.transactionDbPath.getStore()
    const renderedSql = interpolateSql(sql, params ?? [])
    const runActiveDbPath = activeDbPath ?? this.dbPath

    if (activeDbPath) {
      await execFileAsync(`sqlite3`, [runActiveDbPath, renderedSql])
      return
    }

    await this.enqueue(async () => {
      await execFileAsync(`sqlite3`, [runActiveDbPath, renderedSql])
    })
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const activeDbPath = this.transactionDbPath.getStore()
    if (activeDbPath) {
      return fn()
    }

    return this.enqueue(async () => {
      const txDirectory = mkdtempSync(join(tmpdir(), `db-sqlite-core-tx-`))
      const txDbPath = join(txDirectory, `state.sqlite`)

      if (existsSync(this.dbPath)) {
        copyFileSync(this.dbPath, txDbPath)
      }

      try {
        const txResult = await this.transactionDbPath.run(txDbPath, async () =>
          fn(),
        )

        if (existsSync(txDbPath)) {
          copyFileSync(txDbPath, this.dbPath)
        }
        return txResult
      } finally {
        rmSync(txDirectory, { recursive: true, force: true })
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.queue.then(operation, operation)
    this.queue = queuedOperation.then(
      () => undefined,
      () => undefined,
    )
    return queuedOperation
  }
}

type AdapterHarness = {
  adapter: SQLiteCorePersistenceAdapter<Todo, string>
  driver: SqliteCliDriver
  dbPath: string
  cleanup: () => void
}

export type SQLiteCoreAdapterContractHarness = {
  adapter: PersistenceAdapter<Todo, string> & {
    pullSince: (
      collectionId: string,
      fromRowVersion: number,
    ) => Promise<SQLitePullSinceResult<string>>
  }
  driver: SQLiteDriver
  cleanup: () => void
}

function createHarness(
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter<Todo, string>>[0],
    `driver`
  >,
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
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter<Todo, string>>[0],
    `driver`
  >,
): AdapterHarness {
  const harness = createHarness(options)
  activeCleanupFns.push(harness.cleanup)
  return harness
}

export type SQLiteCoreAdapterHarnessFactory = (
  options?: Omit<
    ConstructorParameters<typeof SQLiteCorePersistenceAdapter<Todo, string>>[0],
    `driver`
  >,
) => SQLiteCoreAdapterContractHarness

export function runSQLiteCoreAdapterContractSuite(
  suiteName: string = `SQLiteCorePersistenceAdapter`,
  harnessFactory: SQLiteCoreAdapterHarnessFactory = registerHarness,
): void {
  const registerContractHarness = harnessFactory

  describe(suiteName, () => {
    it(`applies transactions idempotently with row versions and tombstones`, async () => {
      const { adapter, driver } = registerContractHarness()
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
      const tombstoneRows = await driver.query<{
        key: string
        row_version: number
      }>(`SELECT key, row_version FROM "${tombstoneTable}"`)
      expect(tombstoneRows).toHaveLength(1)
      expect(tombstoneRows[0]?.row_version).toBe(3)
    })

    it(`rolls back partially applied mutations when transaction fails`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `atomicity`

      await expect(
        adapter.applyCommittedTx(collectionId, {
          txId: `atomicity-1`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `1`,
              value: {
                id: `1`,
                title: `First`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 1,
              },
            },
            {
              type: `insert`,
              key: `2`,
              value: {
                id: `2`,
                title: `Second`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: 2,
                // Trigger JSON.stringify failure after the first mutation executes.
                unsafe: 1n,
              } as unknown as Todo,
            },
          ],
        }),
      ).rejects.toThrow()

      const rows = await adapter.loadSubset(collectionId, {})
      expect(rows).toEqual([])

      const txRows = await driver.query<{ count: number }>(
        `SELECT COUNT(*) AS count
       FROM applied_tx
       WHERE collection_id = ?`,
        [collectionId],
      )
      expect(txRows[0]?.count).toBe(0)
    })

    it(`supports pushdown operators with correctness-preserving fallback`, async () => {
      const { adapter } = registerContractHarness()
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

    it(`supports datetime/strftime predicate compilation for ISO date fields`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `date-pushdown`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-date`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Start`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 1,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Other`,
              createdAt: `2026-01-03T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`and`, [
          new IR.Func(`eq`, [
            new IR.Func(`strftime`, [
              new IR.Value(`%Y-%m-%d`),
              new IR.Func(`datetime`, [new IR.PropRef([`createdAt`])]),
            ]),
            new IR.Value(`2026-01-02`),
          ]),
          new IR.Func(`eq`, [
            new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
            new IR.Value(`2026-01-02`),
          ]),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`persists bigint/date values and evaluates typed predicates`, async () => {
      const { adapter } = registerContractHarness()
      const typedAdapter = adapter as PersistenceAdapter<
        Record<string, unknown>,
        string
      >
      const collectionId = `typed-values`
      const firstBigInt = BigInt(`9007199254740992`)
      const secondBigInt = BigInt(`9007199254740997`)

      await typedAdapter.applyCommittedTx(collectionId, {
        txId: `seed-typed-values`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Alpha`,
              createdAt: new Date(`2026-01-02T00:00:00.000Z`),
              largeViewCount: firstBigInt,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Beta`,
              createdAt: new Date(`2026-01-03T00:00:00.000Z`),
              largeViewCount: secondBigInt,
            },
          },
        ],
      })

      const bigintRows = await typedAdapter.loadSubset(collectionId, {
        where: new IR.Func(`gt`, [
          new IR.PropRef([`largeViewCount`]),
          new IR.Value(BigInt(`9007199254740993`)),
        ]),
      })
      expect(bigintRows.map((row) => row.key)).toEqual([`2`])

      const dateRows = await typedAdapter.loadSubset(collectionId, {
        where: new IR.Func(`gt`, [
          new IR.PropRef([`createdAt`]),
          new IR.Value(new Date(`2026-01-02T12:00:00.000Z`)),
        ]),
      })
      expect(dateRows.map((row) => row.key)).toEqual([`2`])

      const restoredRows = await typedAdapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.Func(`date`, [new IR.PropRef([`createdAt`])]),
          new IR.Value(`2026-01-02`),
        ]),
      })
      const firstRow = restoredRows[0]?.value
      expect(firstRow?.createdAt).toBeInstanceOf(Date)
      expect(firstRow?.largeViewCount).toBe(firstBigInt)
    })

    it(`handles cursor whereCurrent/whereFrom requests`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `todos`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-cursor`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `a`,
            value: {
              id: `a`,
              title: `A`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 10,
            },
          },
          {
            type: `insert`,
            key: `b`,
            value: {
              id: `b`,
              title: `B`,
              createdAt: `2026-01-02T00:00:00.000Z`,
              score: 10,
            },
          },
          {
            type: `insert`,
            key: `c`,
            value: {
              id: `c`,
              title: `C`,
              createdAt: `2026-01-03T00:00:00.000Z`,
              score: 12,
            },
          },
          {
            type: `insert`,
            key: `d`,
            value: {
              id: `d`,
              title: `D`,
              createdAt: `2026-01-04T00:00:00.000Z`,
              score: 13,
            },
          },
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
      const { adapter, driver } = registerContractHarness()
      const collectionId = `todos`
      const signature = `idx-title`

      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [`json_extract(value, '$.title')`],
      })
      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [`json_extract(value, '$.title')`],
      })

      const registryRows = await driver.query<{
        removed: number
        index_name: string
      }>(
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

      if (!adapter.markIndexRemoved) {
        throw new Error(
          `Adapter must implement markIndexRemoved for this contract suite`,
        )
      }
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
      const baseHarness = registerContractHarness({
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
      const { adapter } = registerContractHarness({
        pullSinceReloadThreshold: 1,
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

    it(`keeps numeric and string keys distinct in storage`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter<
        MixedKeyTodo,
        string | number
      >({
        driver,
      })
      const collectionId = `mixed-keys`

      await adapter.applyCommittedTx(collectionId, {
        txId: `mixed-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: 1,
            value: {
              id: 1,
              title: `Numeric`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `String`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {})
      expect(rows).toHaveLength(2)
      expect(rows.some((row) => row.key === 1)).toBe(true)
      expect(rows.some((row) => row.key === `1`)).toBe(true)
    })

    it(`stores hostile collection ids safely via deterministic table mapping`, async () => {
      const { adapter, driver } = registerContractHarness()
      const hostileCollectionId = `todos"; DROP TABLE applied_tx; --`

      await adapter.applyCommittedTx(hostileCollectionId, {
        txId: `hostile-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `safe`,
            value: {
              id: `safe`,
              title: `Safe`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      const registryRows = await driver.query<{ table_name: string }>(
        `SELECT table_name
       FROM collection_registry
       WHERE collection_id = ?`,
        [hostileCollectionId],
      )
      expect(registryRows).toHaveLength(1)
      expect(registryRows[0]?.table_name).toMatch(/^c_[a-z2-7]+_[0-9a-z]+$/)

      const loadedRows = await adapter.loadSubset(hostileCollectionId, {})
      expect(loadedRows).toHaveLength(1)
      expect(loadedRows[0]?.key).toBe(`safe`)
    })

    it(`prunes applied_tx rows by sequence threshold`, async () => {
      const { adapter, driver } = registerContractHarness({
        appliedTxPruneMaxRows: 2,
      })
      const collectionId = `pruning`

      for (let seq = 1; seq <= 4; seq++) {
        await adapter.applyCommittedTx(collectionId, {
          txId: `prune-${seq}`,
          term: 1,
          seq,
          rowVersion: seq,
          mutations: [
            {
              type: `insert`,
              key: `k-${seq}`,
              value: {
                id: `k-${seq}`,
                title: `Row ${seq}`,
                createdAt: `2026-01-01T00:00:00.000Z`,
                score: seq,
              },
            },
          ],
        })
      }

      const appliedRows = await driver.query<{ seq: number }>(
        `SELECT seq
       FROM applied_tx
       WHERE collection_id = ?
       ORDER BY seq ASC`,
        [collectionId],
      )
      expect(appliedRows.map((row) => row.seq)).toEqual([3, 4])
    })

    it(`prunes applied_tx rows by age threshold when configured`, async () => {
      const { adapter, driver } = registerContractHarness({
        appliedTxPruneMaxAgeSeconds: 1,
      })
      const collectionId = `pruning-by-age`

      await adapter.applyCommittedTx(collectionId, {
        txId: `age-1`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `old`,
            value: {
              id: `old`,
              title: `Old`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
            },
          },
        ],
      })

      await driver.run(
        `UPDATE applied_tx
       SET applied_at = 0
       WHERE collection_id = ? AND seq = 1`,
        [collectionId],
      )

      await adapter.applyCommittedTx(collectionId, {
        txId: `age-2`,
        term: 1,
        seq: 2,
        rowVersion: 2,
        mutations: [
          {
            type: `insert`,
            key: `new`,
            value: {
              id: `new`,
              title: `New`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          },
        ],
      })

      const appliedRows = await driver.query<{ seq: number }>(
        `SELECT seq
       FROM applied_tx
       WHERE collection_id = ?
       ORDER BY seq ASC`,
        [collectionId],
      )
      expect(appliedRows.map((row) => row.seq)).toEqual([2])
    })

    it(`supports large IN lists via batching`, async () => {
      const { adapter } = registerContractHarness()
      const collectionId = `large-in`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-large-in`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
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
          {
            type: `insert`,
            key: `4`,
            value: {
              id: `4`,
              title: `Four`,
              createdAt: `2026-01-04T00:00:00.000Z`,
              score: 4,
            },
          },
        ],
      })

      const largeIds = Array.from(
        { length: 1200 },
        (_value, index) => `miss-${index}`,
      )
      largeIds[100] = `2`
      largeIds[1100] = `4`

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`in`, [
          new IR.PropRef([`id`]),
          new IR.Value(largeIds),
        ]),
        orderBy: [
          {
            expression: new IR.PropRef([`id`]),
            compareOptions: {
              direction: `asc`,
              nulls: `last`,
            },
          },
        ],
      })

      expect(rows.map((row) => row.key)).toEqual([`2`, `4`])
    })

    it(`falls back to in-memory filtering when SQL json path pushdown is unsupported`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter<FlexibleTodoRow, string>(
        {
          driver,
        },
      )
      const collectionId = `fallback-where`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-fallback`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Keep`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
              [`meta-field`]: `alpha`,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Drop`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
              [`meta-field`]: `beta`,
            },
          },
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`meta-field`]),
          new IR.Value(`alpha`),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`supports alias-qualified refs during in-memory fallback filtering`, async () => {
      const { driver } = registerContractHarness()
      const adapter = new SQLiteCorePersistenceAdapter<FlexibleTodoRow, string>(
        {
          driver,
        },
      )
      const collectionId = `fallback-alias-qualified-ref`

      await adapter.applyCommittedTx(collectionId, {
        txId: `seed-alias-fallback`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              title: `Keep`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 1,
              [`meta-field`]: `alpha`,
            },
          },
          {
            type: `insert`,
            key: `2`,
            value: {
              id: `2`,
              title: `Drop`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
              [`meta-field`]: `beta`,
            },
          },
        ],
      })

      // `meta-field` makes SQL pushdown unsupported, so filter correctness comes
      // from the in-memory evaluator. The leading `todos` segment simulates
      // alias-qualified refs emitted by higher-level query builders.
      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`todos`, `meta-field`]),
          new IR.Value(`alpha`),
        ]),
      })

      expect(rows.map((row) => row.key)).toEqual([`1`])
    })

    it(`compiles serialized expression index specs used by phase-2 metadata`, async () => {
      const { adapter, driver } = registerContractHarness()
      const collectionId = `serialized-index`
      const signature = `serialized-title`

      await adapter.ensureIndex(collectionId, signature, {
        expressionSql: [
          JSON.stringify({
            type: `ref`,
            path: [`title`],
          }),
        ],
      })

      const registryRows = await driver.query<{ index_name: string }>(
        `SELECT index_name
       FROM persisted_index_registry
       WHERE collection_id = ? AND signature = ?`,
        [collectionId, signature],
      )
      const indexName = registryRows[0]?.index_name
      expect(indexName).toBeTruthy()

      const sqliteMasterRows = await driver.query<{ sql: string }>(
        `SELECT sql
       FROM sqlite_master
       WHERE type = 'index' AND name = ?`,
        [indexName],
      )
      expect(sqliteMasterRows).toHaveLength(1)
      expect(sqliteMasterRows[0]?.sql).toContain(
        `json_extract(value, '$.title')`,
      )
    })

    it(`rejects unsafe raw SQL fragments in index specs`, async () => {
      const { adapter } = registerContractHarness()

      await expect(
        adapter.ensureIndex(`unsafe-index`, `unsafe`, {
          expressionSql: [
            `json_extract(value, '$.title'); DROP TABLE applied_tx`,
          ],
        }),
      ).rejects.toThrow(/Invalid persisted index SQL fragment/)
    })
  })
}
