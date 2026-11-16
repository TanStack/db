// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import { CountingDriver } from './sqlite-boolean-arity-support'

// Index lifecycle cases for the ordered-page law, which
// `sqlite-ordered-page-oracle.test.ts` owns.

const target = { kind: `eager` as const, collectionId: `ordered-page-index` }
const tableName = createPersistedTableName(target.collectionId, `c`)
const spec = {
  expressionSql: [JSON.stringify({ type: `ref`, path: [`rank`] })],
}

// Records the order probe, the read that checks an order field before a page
// runs in SQL, and its query plan.
class ProbePlanDriver extends CountingDriver {
  probes: Array<{ sql: string; params: Array<string | number> }> = []
  probePlans: Array<Array<string>> = []

  override query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    if (sql.includes(` AS irregular,`)) {
      const probe = { sql, params: params as Array<string | number> }
      this.probes.push(probe)
      this.probePlans.push(
        (
          this.db
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .all(...probe.params) as Array<{ detail: string }>
        ).map((row) => row.detail),
      )
    }
    return super.query<T>(sql, params)
  }
}

async function seededAdapter() {
  const driver = new ProbePlanDriver()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  await adapter.applyCommittedTx(target, {
    txId: `seed`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [1, 2, 3, 4].map((rank) => ({
      type: `insert` as const,
      key: `k${rank}`,
      value: { rank },
    })),
  })
  await adapter.ensureIndex(target, `rank`, spec)
  const loadPage = async () => {
    driver.reads = []
    const rows = await adapter.loadSubset(target, {
      orderBy: [
        {
          expression: new IR.PropRef([`rank`]),
          compareOptions: { direction: `desc`, nulls: `first` },
        },
      ],
      limit: 2,
    })
    return {
      keys: rows.map((row) => row.key),
      rawRows: driver.reads.reduce((sum, read) => sum + read.rawRows, 0),
    }
  }
  const irregularIndexes = () =>
    driver.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_irregular'`,
      )
      .all() as Array<{ name: string }>
  return { driver, adapter, loadPage, irregularIndexes }
}

describe(`SQLite ordered page indexes`, () => {
  it(`pages in memory while an older irregular-rows index exists, and in SQL once ensureIndex rebuilds it`, async () => {
    const { driver, adapter, loadPage, irregularIndexes } =
      await seededAdapter()
    try {
      const [irregular] = irregularIndexes()
      driver.db.exec(`DROP INDEX "${irregular!.name}"`)
      driver.db.exec(
        `CREATE INDEX "${irregular!.name}" ON "${tableName}" (key) WHERE json_type(value, '$.rank') = 'object'`,
      )

      expect(await loadPage()).toEqual({ keys: [`k4`, `k3`], rawRows: 4 })

      await adapter.ensureIndex(target, `rank`, spec)
      expect(await loadPage()).toEqual({ keys: [`k4`, `k3`], rawRows: 2 })
    } finally {
      driver.db.close()
    }
  })

  it(`answers the order probe from indexes, not the table`, async () => {
    const { driver, loadPage } = await seededAdapter()
    try {
      expect(await loadPage()).toEqual({ keys: [`k4`, `k3`], rawRows: 2 })
      expect(driver.probePlans).toHaveLength(1)
      for (const step of driver.probePlans[0]!.filter((detail) =>
        detail.includes(tableName),
      ))
        expect(step).toMatch(/ USING (COVERING )?INDEX /)
    } finally {
      driver.db.close()
    }
  })

  it(`reads no stored value for the order probe once the irregular-rows index is gone`, async () => {
    const { driver, adapter, loadPage } = await seededAdapter()
    try {
      await loadPage()
      const [probe] = driver.probes
      await adapter.markIndexRemoved(target, `rank`)
      // A stored value that is not JSON makes every read of it throw.
      driver.db.exec(`UPDATE "${tableName}" SET value = '{' WHERE key = 's:k1'`)

      expect(driver.db.prepare(probe!.sql).all(...probe!.params)).toEqual([])
      // The same columns without the index condition do read stored values.
      const columns = probe!.sql.slice(
        0,
        probe!.sql.lastIndexOf(`WHERE EXISTS`),
      )
      expect(columns).toContain(` AS high`)
      expect(() => driver.db.prepare(columns).all()).toThrow(/malformed JSON/)
    } finally {
      driver.db.close()
    }
  })

  it(`drops the irregular-rows index with its field index`, async () => {
    const { driver, adapter, irregularIndexes } = await seededAdapter()
    try {
      expect(irregularIndexes()).toHaveLength(1)
      await adapter.markIndexRemoved(target, `rank`)
      expect(irregularIndexes()).toEqual([])
    } finally {
      driver.db.close()
    }
  })
})
