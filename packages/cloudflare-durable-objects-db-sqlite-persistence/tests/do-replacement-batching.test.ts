import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { IR } from '../../db/src'
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

function createLimitedHost(nativeTransaction = false) {
  const database = new DatabaseSync(`:memory:`)
  const boundParameterCounts: Array<number> = []
  const sqlStorage = {
    exec: (sql: string, ...params: ReadonlyArray<unknown>) => {
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
  }
  const driver = createCloudflareDOSQLiteDriver(
    nativeTransaction
      ? { storage: { sql: sqlStorage, transaction: async (fn) => fn() } }
      : { sql: sqlStorage },
  )
  return {
    adapter: new SQLiteCorePersistenceAdapter({ driver }),
    boundParameterCounts,
    close: () => database.close(),
  }
}

describe(`Cloudflare Durable Object replacement batching`, () => {
  it.each([25, 26, 205])(
    `persists %i replacement rows within the host parameter limit`,
    async (rowCount) => {
      const { adapter, boundParameterCounts, close } = createLimitedHost()
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
        close()
      }
    },
  )

  /**
   * A root DO driver declares the host's 100-binding limit. loadSubset uses
   * the transaction driver, so that nested driver must carry the same limit.
   * The independent row model is the set of IDs named by the chosen clauses;
   * the 100/101 pair distinguishes the host cap from a legacy 999 fallback.
   * The controlled storage throws before executing any over-limit statement.
   * This is a Node receiving seam, not a native Cloudflare runtime receipt.
   */
  it.each([
    [`savepoint`, `eq`],
    [`savepoint`, `in`],
    [`native`, `eq`],
    [`native`, `in`],
  ] as const)(
    `keeps %s transaction %s predicates within the host limit`,
    async (mode, kind) => {
      const { adapter, boundParameterCounts, close } = createLimitedHost(
        mode === `native`,
      )
      const collectionId = `cloudflare-predicate-${kind}`
      try {
        await adapter.applyCommittedTx(collectionId, {
          txId: `seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            { type: `insert`, key: `target`, value: { id: `target` } },
            { type: `insert`, key: `miss`, value: { id: `miss` } },
          ],
        })

        for (const clauseCount of [100, 101]) {
          const requestedIds = [
            `target`,
            ...Array.from(
              { length: clauseCount - 1 },
              (_, index) => `absent-${index}`,
            ),
          ]
          const where = new IR.Func(
            `or`,
            requestedIds.map(
              (id) =>
                new IR.Func(kind, [
                  new IR.PropRef([`id`]),
                  new IR.Value(kind === `in` ? [id] : id),
                ]),
            ),
          )
          const attemptStart = boundParameterCounts.length
          const rows = await adapter.loadSubset(collectionId, { where })
          expect(rows.map((row) => row.key)).toEqual([`target`])
          expect(
            Math.max(...boundParameterCounts.slice(attemptStart)),
          ).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS)
        }
      } finally {
        close()
      }
    },
  )
})
