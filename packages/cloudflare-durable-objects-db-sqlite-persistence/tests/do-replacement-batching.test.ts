import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { createCloudflareDOSQLiteDriver } from '../src/do-driver'

// Cloudflare caps each Durable Object SQL query at 100 bound parameters.
const MAX_BOUND_PARAMETERS = 100

function toSqliteBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

function createHarness() {
  const database = new DatabaseSync(`:memory:`)
  const boundParameterCounts: Array<number> = []
  const driver = createCloudflareDOSQLiteDriver({
    sql: {
      exec: (sql, ...params) => {
        boundParameterCounts.push(params.length)
        if (params.length > MAX_BOUND_PARAMETERS) {
          throw new Error(`host parameter limit exceeded`)
        }
        const statement = database.prepare(sql)
        const bindings = params.map(toSqliteBinding)
        if (statement.columns().length > 0) {
          return statement.all(...bindings).map((row) => ({ ...row }))
        }
        statement.run(...bindings)
        return []
      },
    },
  })
  return {
    database,
    boundParameterCounts,
    adapter: new SQLiteCorePersistenceAdapter({ driver }),
  }
}

describe(`Cloudflare Durable Object batching`, () => {
  it.each([25, 26, 205])(
    `persists %i replacement rows within the host parameter limit`,
    async (rowCount) => {
      const { database, adapter, boundParameterCounts } = createHarness()
      const collectionId = `cloudflare-batch-${rowCount}`
      const keys = Array.from(
        { length: rowCount },
        (_, index) => `row-${index}`,
      )

      try {
        await adapter.applyCommittedTx(collectionId, {
          txId: `replacement`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          truncate: true,
          mutations: keys.map((key) => ({
            type: `insert` as const,
            key,
            value: { id: key },
          })),
        })

        const snapshot = await adapter.loadResumeSnapshot(collectionId)
        expect(snapshot.rows.map(({ key }) => key).sort()).toEqual(
          [...keys].sort(),
        )
        expect(snapshot.keySet).toEqual({ status: `consistent` })
        expect(Math.max(...boundParameterCounts)).toBe(MAX_BOUND_PARAMETERS)
      } finally {
        database.close()
      }
    },
  )

  it.each([25, 26, 205])(
    `persists %i ordinary rows with metadata in bounded host calls`,
    async (rowCount) => {
      const { database, adapter, boundParameterCounts } = createHarness()
      const collectionId = `cloudflare-ordinary-${rowCount}`
      const keys = Array.from(
        { length: rowCount },
        (_, index) => `row-${index}`,
      )

      try {
        await adapter.loadResumeSnapshot(collectionId)
        boundParameterCounts.length = 0
        await adapter.applyCommittedTx(collectionId, {
          txId: `ordinary`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: keys.map((key) => ({
            type: `insert` as const,
            key,
            value: { id: key },
          })),
          rowMetadataMutations: keys.map((key) => ({
            type: `set` as const,
            key,
            value: { source: `ordinary` },
          })),
          collectionMetadataMutations: keys.map((key) => ({
            type: `set` as const,
            key,
            value: { source: `ordinary` },
          })),
        })
        const writeCalls = boundParameterCounts.length
        const maxBindings = Math.max(...boundParameterCounts)
        const snapshot = await adapter.loadResumeSnapshot(collectionId)

        expect(snapshot.rows.map(({ key }) => key).sort()).toEqual(
          [...keys].sort(),
        )
        expect(snapshot.rows.map(({ metadata }) => metadata)).toEqual(
          Array(rowCount).fill({ source: `ordinary` }),
        )
        expect(
          snapshot.collectionMetadata.map(({ key }) => key).sort(),
        ).toEqual([...keys].sort())
        expect(snapshot.collectionMetadata.map(({ value }) => value)).toEqual(
          Array(rowCount).fill({ source: `ordinary` }),
        )
        expect(snapshot.keySet).toEqual({ status: `consistent` })
        expect(maxBindings).toBe(MAX_BOUND_PARAMETERS)
        // Includes the host's BEGIN and COMMIT around core query/run calls.
        expect(writeCalls).toBeLessThanOrEqual(
          14 + 6 * Math.ceil(rowCount / 25),
        )
      } finally {
        database.close()
      }
    },
  )
})
