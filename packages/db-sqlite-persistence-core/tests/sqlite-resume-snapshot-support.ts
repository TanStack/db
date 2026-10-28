// Shared fixtures and helpers for the SQLite resume-snapshot tests. The laws and
// models they serve are in sqlite-resume-snapshot-oracle.test.ts.
import { expect } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { SQLiteCorePersistenceAdapter, SQLiteDriver } from '../src'

export type CachedSchemaState = {
  schemaVersion: number
  resetEpoch: number
  rows: Array<{ key: string | number; value: Record<string, unknown> }>
  metadata: Array<{ key: string; value: unknown }>
  appliedTransactions: Array<{
    term: number
    seq: number
    txId: string
    rowVersion: number
  }>
  keyEvidence: {
    available: number
    incompatible: number
    expectedKeys: Array<string>
  }
}

export function toBinding(value: unknown): string | number | bigint | null {
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

/** In-memory SQLite driver with optional statement observation and write failure. */
export function createDriver(
  database: DatabaseSync,
  failTransactionRun?: (sql: string) => boolean,
  observeQuery?: (sql: string) => void,
  observeRun?: (sql: string, params: ReadonlyArray<unknown>) => void,
): SQLiteDriver {
  const driver: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) => {
      observeQuery?.(sql)
      return Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      )
    },
    run: (sql, params = []) => {
      observeRun?.(sql, params)
      database.prepare(sql).run(...params.map(toBinding))
      return Promise.resolve()
    },
    transaction: async (transaction) => {
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const transactionDriver: SQLiteDriver = {
          ...driver,
          run: (sql, params) =>
            failTransactionRun?.(sql)
              ? Promise.reject(new Error(`injected transaction failure`))
              : driver.run(sql, params),
        }
        const result = await transaction(transactionDriver)
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

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

export async function reachCheckpoint(
  promise: Promise<void>,
  checkpoint: string,
  timeoutMs = 1_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach checkpoint: ${checkpoint}`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function closeDatabasePreservingPrimary(
  database: DatabaseSync,
  primaryFailure: unknown,
  secondaryFailures: ReadonlyArray<unknown> = [],
): never | void {
  let cleanupFailure: unknown
  try {
    database.close()
  } catch (error) {
    cleanupFailure = error
  }

  if (primaryFailure !== undefined) {
    const failure =
      primaryFailure instanceof Error
        ? primaryFailure
        : new Error(`SQLite resume snapshot failed`, { cause: primaryFailure })
    const cleanupFailures = [
      ...secondaryFailures,
      ...(cleanupFailure !== undefined ? [cleanupFailure] : []),
    ]
    if (cleanupFailures.length > 0) {
      Object.defineProperty(failure, `cleanupFailures`, {
        value: cleanupFailures,
        enumerable: true,
      })
    }
    throw failure
  }
  if (secondaryFailures.length === 0 && cleanupFailure !== undefined) {
    throw cleanupFailure
  }
  if (secondaryFailures.length > 0) {
    throw new AggregateError(
      [
        ...secondaryFailures,
        ...(cleanupFailure !== undefined ? [cleanupFailure] : []),
      ],
      `SQLite resume snapshot cleanup failed`,
    )
  }
}

export async function observeCachedSchemaState(
  adapter: SQLiteCorePersistenceAdapter,
  driver: SQLiteDriver,
  collectionId: string,
): Promise<CachedSchemaState> {
  const snapshot = await adapter.loadResumeSnapshot({
    kind: `eager`,
    collectionId: collectionId,
  })
  const registryRows = await driver.query<{ schema_version: number }>(
    `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
    [collectionId],
  )
  const versionRows = await driver.query<{
    key_set_evidence_available: number
    key_set_evidence_incompatible: number
  }>(
    `SELECT key_set_evidence_available, key_set_evidence_incompatible
     FROM collection_version
     WHERE collection_id = ?`,
    [collectionId],
  )
  const expectedKeys = await driver.query<{ key: string }>(
    `SELECT key
     FROM collection_expected_keys
     WHERE collection_id = ?
     ORDER BY key`,
    [collectionId],
  )
  const appliedTransactions = await driver.query<{
    term: number
    seq: number
    tx_id: string
    row_version: number
  }>(
    `SELECT term, seq, tx_id, row_version
     FROM applied_tx
     WHERE collection_id = ?
     ORDER BY term, seq`,
    [collectionId],
  )

  return {
    schemaVersion: registryRows[0]?.schema_version ?? -1,
    resetEpoch: snapshot.resetEpoch,
    rows: snapshot.rows
      .map(({ key, value }) => ({ key, value }))
      .sort((left, right) => String(left.key).localeCompare(String(right.key))),
    metadata: snapshot.collectionMetadata.sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    appliedTransactions: appliedTransactions.map(
      ({ term, seq, tx_id, row_version }) => ({
        term,
        seq,
        txId: tx_id,
        rowVersion: row_version,
      }),
    ),
    keyEvidence: {
      available: versionRows[0]?.key_set_evidence_available ?? -1,
      incompatible: versionRows[0]?.key_set_evidence_incompatible ?? -1,
      expectedKeys: expectedKeys.map(({ key }) => key),
    },
  }
}

/**
 * # Which generation does a SQLite resume snapshot certify?
 *
 * `loadResumeSnapshot` must return rows, collection metadata, applied position,
 * reset epoch, and key-set evidence from one atomic persisted generation. Raw
 * key loss makes that evidence incompatible until a full replacement establishes
 * a new baseline; concurrent schema migration may advance but never downgrade or
 * repeat the observed generation. These laws refine the shared persistence and
 * schema-mismatch contracts exercised by sqlite-core-adapter-oracle.test.ts.
 * A managed cache claim must still be live inside the read transaction before
 * any generation-specific durable access. A claim expires at its expiry time;
 * a later-acquired live peer claim does not inherit the earlier claim's expiry.
 *
 * `CachedSchemaState` is the independent projection: complete rows and metadata,
 * transaction position, schema/reset lineage, and expected keys. The history
 * grammar crosses external row loss, full replacement, two legacy-schema
 * adapters, stale reads, newer-schema observation, and a cached writer racing a
 * reset. Expected membership and lineage come from the declared transition, not
 * from the adapter's SQL or internal branch structure.
 *
 * The production driver runs two real `SQLiteCorePersistenceAdapter` instances
 * over one node:sqlite database and holds the exact transaction or snapshot
 * boundary needed for each interleaving. At the settled snapshot checkpoint it
 * compares the entire projected schema state; the held boundary and reset epoch
 * are reach witnesses, while compatible reopen and recertifying truncate cases
 * prevent an oracle that merely rejects every resume.
 * A separate generated startup lane holds the runtime between its metadata and
 * hydration snapshots, then crosses no write, a managed public insert, and a
 * hostile raw deletion over one-to-three baseline rows. Its independent model
 * preserves every managed row but fails closed for unsupported raw loss.
 * The focused work law first executes one controlled expected-key table read to
 * prove its SQL observer can detect the forbidden membership work, then resets
 * the counters before measuring the public position and snapshot operations.
 * A second value-and-work law applies a 205-row full replacement through
 * `applyCommittedTx`. It compares exact durable rows, row metadata, key evidence,
 * resume metadata, and applied position after return while bounding driver
 * query/run calls. A later-batch fault must roll the whole replacement back.
 * Duplicate-key and delete histories retain their ordered sequential meaning.
 *
 * Known omissions: this narrow fixture supplies the same-connection
 * concurrency seam that the serialized copy-on-commit CLI harness cannot. It
 * uses a controlled clock and one shared real SQLite connection for claim races.
 * It does not claim native host execution or judge whether a consumer such as
 * Electric may use the certified cursor; those remain separate driver-contract
 * and Electric recovery owners. The work bound is a driver-call measure in
 * node:sqlite, not an elapsed-time or browser OPFS latency guarantee.
 */

export type StartupRow = { id: string; title: string }
export const expectStartupRows = (
  actual: Array<StartupRow>,
  expected: Array<StartupRow>,
) => expect(actual).toEqual(expected)
