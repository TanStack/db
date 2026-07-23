import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import { runSQLiteCoreAdapterContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-core-adapter-contract'
import { BetterSqlite3SQLiteDriver } from '../src/node-driver'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
} from '../../db-sqlite-persistence-core/src'
import type { SQLiteCoreAdapterHarnessFactory } from '../../db-sqlite-persistence-core/tests/contracts/sqlite-core-adapter-contract'
import type { SQLiteDriver } from '../../db-sqlite-persistence-core/src'

const createHarness: SQLiteCoreAdapterHarnessFactory = (options) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-core-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
  const adapter = new SQLiteCorePersistenceAdapter({
    driver,
    ...options,
  })

  return {
    adapter,
    driver,
    cleanup: () => {
      try {
        driver.close()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }
}

type QueryPlanRow = {
  detail: string
}

runSQLiteCoreAdapterContractSuite(
  `SQLiteCorePersistenceAdapter (better-sqlite3 node driver)`,
  createHarness,
)

function createQueryObservingDriver(
  inner: SQLiteDriver,
  observeQuery: (
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => void | Promise<void>,
): SQLiteDriver {
  const wrap = (driver: SQLiteDriver): SQLiteDriver => {
    return {
      exec: async function (sql) {
        return driver.exec(sql)
      },
      query: async function <T>(sql: string, params?: ReadonlyArray<unknown>) {
        await observeQuery(sql, params ?? [])
        return driver.query<T>(sql, params)
      },
      run: async function (sql, params) {
        return driver.run(sql, params)
      },
      transaction: async function <T>(
        fn: (transactionDriver: SQLiteDriver) => Promise<T>,
      ) {
        return driver.transaction((transactionDriver) =>
          fn(wrap(transactionDriver)),
        )
      },
      transactionWithDriver: driver.transactionWithDriver
        ? async function <T>(
            fn: (transactionDriver: SQLiteDriver) => Promise<T>,
          ) {
            return driver.transactionWithDriver!((transactionDriver) =>
              fn(wrap(transactionDriver)),
            )
          }
        : undefined,
    }
  }

  return wrap(inner)
}

describe(`SQLiteCorePersistenceAdapter planner behavior (better-sqlite3)`, () => {
  it(`uses expression indexes for runtime ref filters`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-plan-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const baseDriver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
    const collectionId = `thread-messages`
    const tableName = createPersistedTableName(collectionId, `c`)
    let capturedSubsetSql: string | undefined
    let capturedSubsetParams: ReadonlyArray<unknown> = []

    const driver = createQueryObservingDriver(baseDriver, (sql, params) => {
      if (
        sql.startsWith(`SELECT key, value, metadata, row_version FROM`) &&
        sql.includes(`WHERE`)
      ) {
        capturedSubsetSql = sql
        capturedSubsetParams = params
      }
    })
    const adapter = new SQLiteCorePersistenceAdapter({ driver })

    try {
      await adapter.applyCommittedTx(collectionId, {
        txId: `thread-messages-seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              threadId: `thread-1`,
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
              threadId: `thread-1`,
              title: `Second`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          },
          {
            type: `insert`,
            key: `3`,
            value: {
              id: `3`,
              threadId: `thread-2`,
              title: `Other thread`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 3,
            },
          },
        ],
      })

      await adapter.ensureIndex(collectionId, `thread-id`, {
        expressionSql: [
          JSON.stringify({
            type: `ref`,
            path: [`threadId`],
          }),
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`threadId`]),
          new IR.Value(`thread-1`),
        ]),
      })

      expect(rows).toHaveLength(2)
      expect(capturedSubsetSql).toContain(`WHERE`)
      expect(capturedSubsetParams).toEqual([`thread-1`])

      const planRows = baseDriver
        .getDatabase()
        .prepare(`EXPLAIN QUERY PLAN ${capturedSubsetSql}`)
        .all(...capturedSubsetParams) as Array<{ detail: string }>
      const indexedSearchPattern = new RegExp(
        `\\bSEARCH ${tableName}\\b.*\\bUSING INDEX\\b`,
      )

      expect(planRows.map((row) => row.detail).length).toBeGreaterThan(0)
      expect(
        planRows.some((row) => indexedSearchPattern.test(row.detail)),
      ).toBe(true)
      expect(
        planRows.some((row) => row.detail.startsWith(`SCAN ${tableName}`)),
      ).toBe(false)
    } finally {
      baseDriver.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it(`uses expression indexes for filters while sorting composite orderBy`, async () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-plan-`))
    const dbPath = join(tempDirectory, `state.sqlite`)
    const baseDriver = new BetterSqlite3SQLiteDriver({ filename: dbPath })
    const collectionId = `thread-messages-composite-order`
    const tableName = createPersistedTableName(collectionId, `c`)
    let capturedSubsetSql: string | undefined
    let capturedSubsetParams: ReadonlyArray<unknown> = []

    const driver = createQueryObservingDriver(baseDriver, (sql, params) => {
      if (
        sql.startsWith(`SELECT key, value, metadata, row_version FROM`) &&
        sql.includes(`WHERE`)
      ) {
        capturedSubsetSql = sql
        capturedSubsetParams = params
      }
    })
    const adapter = new SQLiteCorePersistenceAdapter({ driver })

    try {
      await adapter.applyCommittedTx(collectionId, {
        txId: `thread-messages-composite-order-seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: `insert`,
            key: `1`,
            value: {
              id: `1`,
              threadId: `thread-1`,
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
              threadId: `thread-1`,
              title: `Second`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 2,
            },
          },
          {
            type: `insert`,
            key: `3`,
            value: {
              id: `3`,
              threadId: `thread-2`,
              title: `Other thread`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: 3,
            },
          },
        ],
      })

      await adapter.ensureIndex(collectionId, `thread-id`, {
        expressionSql: [
          JSON.stringify({
            type: `ref`,
            path: [`threadId`],
          }),
        ],
      })

      const rows = await adapter.loadSubset(collectionId, {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`threadId`]),
          new IR.Value(`thread-1`),
        ]),
        orderBy: [
          {
            expression: new IR.PropRef([`createdAt`]),
            compareOptions: {
              direction: `desc`,
              nulls: `first`,
            },
          },
          {
            expression: new IR.PropRef([`id`]),
            compareOptions: {
              direction: `desc`,
              nulls: `first`,
            },
          },
        ],
      })

      if (capturedSubsetSql === undefined) {
        throw new Error(`Expected subset SQL to be captured`)
      }

      expect(rows.map((row) => row.key)).toEqual([`2`, `1`])
      expect(capturedSubsetSql).toContain(`WHERE`)
      expect(capturedSubsetSql).toContain(`ORDER BY`)
      expect(capturedSubsetParams).toEqual([`thread-1`])

      const planRows = baseDriver
        .getDatabase()
        .prepare<Array<unknown>, QueryPlanRow>(
          `EXPLAIN QUERY PLAN ${capturedSubsetSql}`,
        )
        .all(...capturedSubsetParams)
      const indexedSearchPattern = new RegExp(
        `\\bSEARCH ${tableName}\\b.*\\bUSING INDEX\\b`,
      )

      expect(planRows.length).toBeGreaterThan(0)
      expect(
        planRows.some((row) => indexedSearchPattern.test(row.detail)),
      ).toBe(true)
      const planDetails = planRows.map((row) => row.detail)
      expect(planDetails).toContain(`USE TEMP B-TREE FOR ORDER BY`)
    } finally {
      baseDriver.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
