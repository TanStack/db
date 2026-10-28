// Shared fixtures and helpers for the ordinary SQLite committed-transaction tests.
// The law and its independent model live in ordinary-transaction-work-oracle.ts.
import { DatabaseSync } from 'node:sqlite'
import { expect } from 'vitest'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import { Temporal } from './temporal-value-oracle'
import type { PersistedTx, SQLiteDriver } from '../src'

export type Row = Record<
  string,
  string | number | Temporal.Instant | Temporal.PlainDate
>
export type Tx = PersistedTx<Row, string>

export function clone<T>(value: T): T {
  // Native Temporal values are immutable. structuredClone erases their slots.
  if (value instanceof Temporal.Instant || value instanceof Temporal.PlainDate)
    return value
  if (Array.isArray(value)) return value.map(clone) as T
  if (value !== null && typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
    ) as T
  }
  return value
}

type Fixture = {
  adapter: SQLiteCorePersistenceAdapter
  driver: SQLiteDriver
  counts: {
    query: number
    run: number
    transactions: number
    maxParams: number
  }
  failAfterRowWriteCount: (count: number | undefined) => void
  failRunMatching: (pattern: RegExp | undefined) => void
  corruptRowMetadata: (enabled: boolean) => void
  close: () => void
}

function binding(value: unknown): string | number | bigint | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  )
    return value
  return String(value)
}

export function fixture(maxBoundParameters: number): Fixture {
  const database = new DatabaseSync(':memory:')
  const counts = { query: 0, run: 0, transactions: 0, maxParams: 0 }
  let failAfter: number | undefined
  let rowWriteCount = 0
  let failRunPattern: RegExp | undefined
  let corruptMetadata = false
  const rowWritePattern =
    /INSERT INTO "c_[^"]+" \(key, value, metadata, row_version\)/
  const checkParams = (params: ReadonlyArray<unknown>) => {
    counts.maxParams = Math.max(counts.maxParams, params.length)
    if (params.length > maxBoundParameters) {
      throw new Error(
        `binding cap ${maxBoundParameters} exceeded: ${params.length}`,
      )
    }
  }
  const driver: SQLiteDriver = {
    maxBoundParameters,
    exec: async (sql) => {
      database.exec(sql)
    },
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) => {
      counts.query++
      checkParams(params)
      return database
        .prepare(sql)
        .all(...params.map(binding))
        .map((row) => ({ ...row })) as Array<T>
    },
    run: async (sql, params = []) => {
      counts.run++
      checkParams(params)
      if (rowWritePattern.test(sql)) {
        rowWriteCount += params.length / 4
        if (failAfter !== undefined && rowWriteCount > failAfter) {
          throw new Error('injected later row-write failure')
        }
      }
      if (failRunPattern?.test(sql))
        throw new Error('injected late bookkeeping failure')
      const actualParams =
        corruptMetadata && rowWritePattern.test(sql)
          ? params.map((param, index) => (index % 4 === 2 ? null : param))
          : params
      database.prepare(sql).run(...actualParams.map(binding))
    },
    transaction: async <T>(fn: (tx: SQLiteDriver) => Promise<T>) => {
      counts.transactions++
      database.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(driver)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  return {
    adapter: new SQLiteCorePersistenceAdapter({ driver }),
    driver,
    counts,
    failAfterRowWriteCount: (count) => {
      failAfter = count
      rowWriteCount = 0
    },
    failRunMatching: (pattern) => {
      failRunPattern = pattern
    },
    corruptRowMetadata: (enabled) => {
      corruptMetadata = enabled
    },
    close: () => database.close(),
  }
}

export type WriteCounts = Readonly<Fixture['counts']>

export function beginMeasuredWrite(host: Fixture): void {
  host.counts.query = 0
  host.counts.run = 0
  host.counts.transactions = 0
  host.counts.maxParams = 0
}

export function finishMeasuredWrite(
  host: Fixture,
  checkpoint: string,
  extraTransactions = 0,
): WriteCounts {
  // The optional increment is a checker control, never a production path.
  host.counts.transactions += extraTransactions
  const counts = { ...host.counts }
  expect(counts.transactions, `${checkpoint}: one SQLite transaction`).toBe(1)
  return counts
}

export function transaction(
  txId: string,
  seq: number,
  mutations: Tx['mutations'],
  rowMetadataMutations: Tx['rowMetadataMutations'] = [],
  collectionMetadataMutations: Tx['collectionMetadataMutations'] = [],
): Tx {
  return {
    txId,
    term: 1,
    seq,
    rowVersion: seq,
    mutations,
    rowMetadataMutations,
    collectionMetadataMutations,
  }
}

export function insertRows(count: number): Tx {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    version: 1,
  }))
  return transaction(
    `insert-${count}`,
    1,
    rows.map((row) => ({ type: 'insert', key: row.id, value: row })),
    rows.map((row) => ({
      type: 'set',
      key: row.id,
      value: { source: 'feed' },
    })),
    [{ type: 'set', key: 'cursor', value: { offset: count } }],
  )
}

export type SnapshotRow = { key: string; value: Row; metadata?: unknown }
export type Tombstone = { key: string; value: Row; rowVersion: number }
export type Observation = {
  rows: Array<SnapshotRow>
  collectionMetadata: Array<{ key: string; value: unknown }>
  keySet: unknown
  expectedKeys: Array<string>
  tombstones: Array<Tombstone>
  position: { term: number; seq: number; rowVersion: number }
  applied: Array<{ txId: string; rowVersion: number }>
}

export function sortedKeys(values: Iterable<string>): Array<string> {
  return [...values].sort()
}

export function sortRows(rows: Array<SnapshotRow>): Array<SnapshotRow> {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key))
}

function publicKey(encoded: string): string {
  if (!encoded.startsWith('s:'))
    throw new Error(`unexpected raw key ${encoded}`)
  return encoded.slice(2)
}

export async function observe(
  adapter: SQLiteCorePersistenceAdapter,
  driver: SQLiteDriver,
  collectionId: string,
): Promise<Observation> {
  const snapshot = await adapter.loadResumeSnapshot({
    kind: `eager`,
    collectionId: collectionId,
  })
  const table = createPersistedTableName(collectionId, 't')
  const [expected, tombstones, applied] = await Promise.all([
    driver.query<{ key: string }>(
      'SELECT key FROM collection_expected_keys WHERE collection_id = ? ORDER BY key',
      [collectionId],
    ),
    driver.query<{ key: string; value: string; row_version: number }>(
      `SELECT key, value, row_version FROM "${table}" ORDER BY key`,
    ),
    driver.query<{ tx_id: string; row_version: number }>(
      'SELECT tx_id, row_version FROM applied_tx WHERE collection_id = ? ORDER BY term, seq',
      [collectionId],
    ),
  ])
  return {
    rows: sortRows(snapshot.rows as Array<SnapshotRow>),
    collectionMetadata: [...snapshot.collectionMetadata].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    keySet: snapshot.keySet,
    expectedKeys: sortedKeys(expected.map((row) => publicKey(row.key))),
    tombstones: tombstones
      .map((row) => ({
        key: publicKey(row.key),
        value: JSON.parse(row.value) as Row,
        rowVersion: row.row_version,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    position: {
      term: snapshot.latestTerm,
      seq: snapshot.latestSeq,
      rowVersion: snapshot.latestRowVersion,
    },
    applied: applied.map((row) => ({
      txId: row.tx_id,
      rowVersion: row.row_version,
    })),
  }
}
