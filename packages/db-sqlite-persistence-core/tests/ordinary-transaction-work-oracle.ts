import { DatabaseSync } from 'node:sqlite'
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import type { PersistedTx, SQLiteDriver } from '../src'

type Row = Record<string, string | number>
type Tx = PersistedTx<Row, string>
type SnapshotRow = { key: string; value: Row; metadata?: unknown }
type Tombstone = { key: string; value: Row; rowVersion: number }
type Observation = {
  rows: Array<SnapshotRow>
  collectionMetadata: Array<{ key: string; value: unknown }>
  keySet: unknown
  expectedKeys: Array<string>
  tombstones: Array<Tombstone>
  position: { term: number; seq: number; rowVersion: number }
  applied: Array<{ txId: string; rowVersion: number }>
}

/**
 * # Can an ordinary committed SQLite transaction persist many rows in bounded work?
 *
 * Authority: PersistedTx's row/metadata semantics and the established SQLite
 * resume-snapshot oracle. Issue #1992 proposed chunk-bounded work for
 * independent keys; the repeated-key follow-up extends that law to distinct
 * keys within each row or metadata action family. Driver query/run calls scale
 * with parameter-limited chunks of distinct keys, even when actions repeat,
 * while rows, metadata, tombstones, key evidence, replay and position remain
 * atomic. A successful `applyCommittedTx` is the durable checkpoint. A failed
 * transaction leaves the entire previous durable state and position intact.
 *
 * Model: a pure Map reducer applies the public transaction actions in order.
 * It has no SQL, batching classifier, statement scheduler or production helper.
 * Its `expectedKeys` and tombstones are diagnostic projections of the same row
 * and delete laws; `applied` records the committed positions. Public replay is
 * checked separately because an oversized delta may legitimately full-reload.
 * Every modeled field has a distinguishing next action: update needs prior row
 * value/metadata, insert after delete needs tombstone state, and resume needs
 * the applied position. The model holds no driver-call state; work is a separate
 * cardinality law. All fixture keys are strings with the documented `s:` storage
 * encoding, so raw-table diagnostics can decode them without production code.
 *
 * Process grammar: start from a fresh Collection, optionally apply one seed
 * transaction, then apply one ordinary transaction (`truncate` absent). A replay
 * case may reapply the same committed position. Fault cases reject during a
 * later row-write group or final bookkeeping inside that transaction.
 * Design grammar: empty/single/boundary/10k distinct keys; existing versus
 * absent row; insert/update/delete; inline versus later row metadata; matching
 * and unmatched metadata; repeated keys; tombstones; collection metadata;
 * 100, 500, and 999 bound-parameter caps and replay count 128 versus 130.
 * The fixed cases below reconstruct each axis and its adjacent value. Removing
 * a size boundary loses the chunk-cut witness; removing the seed loses merge
 * and prior metadata; removing repeated keys admits an unsafe reordering.
 * The grammar excludes negative/nonfinite keys, invalid caps below four,
 * concurrent transactions, truncate replacement, and multiple sync runs.
 * The generated history grammar below uses one fixed two-row seed, one bounded
 * ordinary transaction, and an optional dependent update. Its mandatory
 * scenario suffixes reconstruct repeated-key, delete/reinsert, partial-update,
 * and present/absent metadata witnesses; random action prefixes in 0–4, 5–24,
 * and 25–60 bands exercise adjacent orders and longer repeated-key work
 * without erasing those suffixes. Late bookkeeping rejection is the rollback
 * branch. It excludes arbitrary-length histories, interleaved
 * row metadata (the API applies it after mutations), key types beyond these
 * string fixtures, and concurrent owners. The fixed size/parameter cases above
 * retain the work-threshold claim; the generated grammar checks both semantics
 * and a distinct-key work bound after committed and rolled-back candidates.
 * A 205-update single-key case crosses the former per-action work path.
 * Truncate tests keep serialization errors observable even if later same-key
 * actions overwrite the invalid value.
 * A second generated grammar uses 0–60 distinct keys, two parameter caps, and
 * six independent-key action shapes (later/inline insert metadata, partial
 * update, delete, row-metadata-only, collection-metadata-only). It applies an
 * optional seed, then checks
 * durable semantics and the same chunk work bound after the candidate. Both
 * generated grammars reset driver counters around each apply, assert exactly
 * one SQLite transaction on success or rollback, and finish measurement before
 * reading any post-apply snapshot. The first grammar's work bound counts unique
 * keys per row, row-metadata and collection-metadata family.
 *
 * Production driver: real SQLiteCorePersistenceAdapter and node:sqlite with a
 * transaction-scoped driver, parameter cap and optional row-write fault.
 * Refinement: after settlement, compare complete durable rows and metadata,
 * expected keys, tombstones, position, and replay. Count calls only between
 * adapter entry and return, after schema setup and before the snapshot reads.
 * The bound is deliberately loose: 12 fixed calls plus six calls per family
 * chunk of at most min(125, floor(maxBoundParameters / 4)) distinct keys. It rules out
 * per-action persistence for repeated keys,
 * not every inefficient SQL design. This is a proposed work contract, not a
 * measured browser latency or proof for Cloudflare Workers, OPFS scheduling,
 * Electric, WAL across processes, Tauri, or native mobile. The existing owner
 * retains full replacement and schema-migration laws; this fixture adds ordinary
 * write work and does not replace driver admission or host receiving witnesses.
 */

function clone<T>(value: T): T {
  return structuredClone(value)
}

function sortedKeys(values: Iterable<string>): Array<string> {
  return [...values].sort()
}

function sortRows(rows: Array<SnapshotRow>): Array<SnapshotRow> {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key))
}

// The model replays semantic actions from their contract, never from SQL.
function modelAfter(history: ReadonlyArray<Tx>): Observation {
  const rows = new Map<string, { value: Row; metadata?: unknown }>()
  const tombstones = new Map<string, Tombstone>()
  const collectionMetadata = new Map<string, unknown>()
  const applied: Observation['applied'] = []
  const appliedPositions = new Set<string>()
  let rowVersion = 0
  let term = 0
  let seq = 0

  for (const tx of history) {
    const positionId = `${tx.term}:${tx.seq}`
    if (appliedPositions.has(positionId)) continue
    appliedPositions.add(positionId)
    rowVersion = Math.max(rowVersion + 1, tx.rowVersion)
    term = tx.term
    seq = tx.seq
    for (const mutation of tx.mutations) {
      if (mutation.type === 'delete') {
        rows.delete(mutation.key)
        tombstones.set(mutation.key, {
          key: mutation.key,
          value: clone(mutation.value),
          rowVersion,
        })
        continue
      }
      const previous = rows.get(mutation.key)
      const value =
        mutation.type === 'update'
          ? { ...previous?.value, ...clone(mutation.value) }
          : clone(mutation.value)
      const metadata = mutation.metadataChanged
        ? clone(mutation.metadata)
        : clone(previous?.metadata)
      rows.set(mutation.key, { value, metadata })
      tombstones.delete(mutation.key)
    }
    for (const change of tx.rowMetadataMutations ?? []) {
      const row = rows.get(change.key)
      if (row)
        row.metadata =
          change.type === 'delete' ? undefined : clone(change.value)
    }
    for (const change of tx.collectionMetadataMutations ?? []) {
      if (change.type === 'delete') collectionMetadata.delete(change.key)
      else collectionMetadata.set(change.key, clone(change.value))
    }
    applied.push({ txId: tx.txId, rowVersion })
  }
  return {
    rows: sortRows([...rows].map(([key, row]) => ({ key, ...row }))),
    collectionMetadata: [...collectionMetadata]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    keySet: { status: 'consistent' },
    expectedKeys: sortedKeys(rows.keys()),
    tombstones: [...tombstones.values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    position: { term, seq, rowVersion },
    applied,
  }
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

function fixture(maxBoundParameters: number): Fixture {
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

type WriteCounts = Readonly<Fixture['counts']>

function beginMeasuredWrite(host: Fixture): void {
  host.counts.query = 0
  host.counts.run = 0
  host.counts.transactions = 0
  host.counts.maxParams = 0
}

function finishMeasuredWrite(
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

function publicKey(encoded: string): string {
  if (!encoded.startsWith('s:'))
    throw new Error(`unexpected raw key ${encoded}`)
  return encoded.slice(2)
}

async function observe(
  adapter: SQLiteCorePersistenceAdapter,
  driver: SQLiteDriver,
  collectionId: string,
): Promise<Observation> {
  const snapshot = await adapter.loadResumeSnapshot(collectionId)
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

function transaction(
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

function insertRows(count: number): Tx {
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

type Case = {
  name: string
  cap: number
  seed?: Tx
  candidate: Tx
  workSize?: number
  workFamilies?: number
}

const workCases: Array<Case> = [0, 1, 24, 25, 26, 99, 100, 101, 205].map(
  (size) => ({
    name: `unique-${size}`,
    cap: size <= 26 ? 100 : 999,
    candidate: insertRows(size),
    workSize: size,
  }),
)
workCases.push(
  ...[124, 125, 126].map((size) => ({
    name: `unique-${size}-500-parameter-cap`,
    cap: 500,
    candidate: insertRows(size),
    workSize: size,
  })),
)
function updateRows(count: number): Case {
  const ids = Array.from({ length: count }, (_, i) => `row-${i}`)
  return {
    name: `update-${count}`,
    cap: 100,
    seed: insertRows(count),
    workSize: count,
    candidate: transaction(
      `update-${count}`,
      2,
      ids.map((key) => ({ type: 'update', key, value: { version: 2 } })),
      ids.map((key) => ({ type: 'set', key, value: { source: 'update' } })),
    ),
  }
}
function deleteRows(count: number): Case {
  const ids = Array.from({ length: count }, (_, i) => `row-${i}`)
  return {
    name: `delete-${count}`,
    cap: 100,
    seed: insertRows(count),
    workSize: count,
    candidate: transaction(
      `delete-${count}`,
      2,
      ids.map((key) => ({
        type: 'delete',
        key,
        value: { id: key, deleted: 1 },
      })),
    ),
  }
}
function metadataOnly(count: number): Case {
  const ids = Array.from({ length: count }, (_, i) => `row-${i}`)
  return {
    name: `metadata-only-${count}`,
    cap: 100,
    seed: insertRows(count),
    workSize: count,
    candidate: transaction(
      `metadata-only-${count}`,
      2,
      [],
      [
        ...ids.map((key) => ({
          type: 'set' as const,
          key,
          value: { source: 'later' },
        })),
        { type: 'set', key: 'absent', value: { ignored: true } },
      ],
    ),
  }
}
function unmatchedMetadata(count: number): Case {
  const existing = Array.from({ length: count }, (_, i) => `row-${i}`)
  const added = Array.from({ length: count }, (_, i) => ({ id: `new-${i}` }))
  return {
    name: `unmatched-metadata-${count}`,
    cap: 100,
    seed: insertRows(count),
    workSize: count,
    workFamilies: 2,
    candidate: transaction(
      `unmatched-metadata-${count}`,
      2,
      added.map((value) => ({ type: 'insert', key: value.id, value })),
      existing.map((key) => ({
        type: 'set',
        key,
        value: { source: 'unmatched' },
      })),
    ),
  }
}
function collectionMetadataOnly(count: number): Case {
  const keys = Array.from({ length: count }, (_, i) => `meta-${i}`)
  return {
    name: `collection-metadata-only-${count}`,
    cap: 100,
    seed: transaction(
      `metadata-seed-${count}`,
      1,
      [],
      [],
      keys.map((key) => ({ type: 'set', key, value: { version: 1 } })),
    ),
    candidate: transaction(
      `metadata-candidate-${count}`,
      2,
      [],
      [],
      keys.map((key, index) =>
        index % 2 === 0
          ? { type: 'set', key, value: { version: 2 } }
          : { type: 'delete', key },
      ),
    ),
    workSize: count,
  }
}
const additionalWorkCases: Array<Case> = [
  updateRows(1),
  updateRows(26),
  updateRows(205),
  deleteRows(1),
  deleteRows(26),
  deleteRows(205),
  metadataOnly(1),
  metadataOnly(26),
  metadataOnly(205),
  collectionMetadataOnly(1),
  collectionMetadataOnly(25),
  collectionMetadataOnly(26),
  collectionMetadataOnly(205),
  unmatchedMetadata(26),
]
additionalWorkCases.push({
  name: 'repeated-update-205',
  cap: 100,
  seed: transaction('repeated-seed', 1, [
    {
      type: 'insert',
      key: 'same',
      value: { id: 'same', version: 1 },
      metadataChanged: true,
      metadata: { source: 'seed' },
    },
  ]),
  candidate: transaction(
    'repeated-updates',
    2,
    Array.from({ length: 205 }, (_, index) => ({
      type: 'update' as const,
      key: 'same',
      value: { version: index + 2 },
      metadataChanged: index % 4 === 0,
      metadata: index % 4 === 0 ? { source: `update-${index}` } : undefined,
    })),
  ),
  workSize: 1,
})
workCases.push({
  name: 'unique-10000',
  cap: 999,
  candidate: insertRows(10000),
  workSize: 10000,
})
const semanticCases: Array<Case> = [
  {
    name: 'existing-insert-keeps-metadata',
    cap: 100,
    seed: transaction('seed', 1, [
      {
        type: 'insert',
        key: 'same',
        value: { id: 'same', title: 'old' },
        metadataChanged: true,
        metadata: { origin: 'seed' },
      },
    ]),
    candidate: transaction('replace', 2, [
      { type: 'insert', key: 'same', value: { id: 'same', title: 'new' } },
    ]),
  },
  {
    name: 'partial-update-and-later-metadata',
    cap: 100,
    seed: transaction(
      'seed',
      1,
      [
        {
          type: 'insert',
          key: 'same',
          value: { id: 'same', title: 'kept', count: 1 },
          metadataChanged: true,
          metadata: { origin: 'seed' },
        },
      ],
      [],
      [{ type: 'set', key: 'cursor', value: { offset: 1 } }],
    ),
    candidate: transaction(
      'update',
      2,
      [
        {
          type: 'update',
          key: 'same',
          value: { count: 2 },
          metadataChanged: true,
          metadata: { origin: 'inline' },
        },
      ],
      [
        { type: 'set', key: 'same', value: { origin: 'later' } },
        { type: 'set', key: 'absent', value: { ignored: true } },
      ],
      [
        { type: 'delete', key: 'cursor' },
        { type: 'set', key: 'next', value: { offset: 2 } },
      ],
    ),
  },
  {
    name: 'repeated-key-delete-reinsert',
    cap: 100,
    candidate: transaction(
      'repeat',
      1,
      [
        { type: 'insert', key: 'same', value: { id: 'same', first: 1 } },
        { type: 'insert', key: 'other', value: { id: 'other' } },
        { type: 'update', key: 'same', value: { second: 2 } },
        { type: 'delete', key: 'same', value: { id: 'same', deleted: 1 } },
        { type: 'insert', key: 'same', value: { id: 'same', final: 3 } },
        { type: 'update', key: 'same', value: { last: 4 } },
      ],
      [
        { type: 'set', key: 'same', value: { origin: 'later' } },
        { type: 'delete', key: 'other' },
      ],
    ),
  },
  {
    name: 'delete-retains-tombstone',
    cap: 100,
    seed: transaction('seed', 1, [
      { type: 'insert', key: 'gone', value: { id: 'gone', before: 1 } },
    ]),
    candidate: transaction(
      'delete',
      2,
      [{ type: 'delete', key: 'gone', value: { id: 'gone', deleted: 2 } }],
      [{ type: 'set', key: 'gone', value: { ignored: true } }],
    ),
  },
  {
    name: 'repeated-collection-metadata-key-keeps-order',
    cap: 100,
    seed: transaction(
      'metadata-seed',
      1,
      [],
      [],
      [{ type: 'set', key: 'cursor', value: { version: 1 } }],
    ),
    candidate: transaction(
      'metadata-repeat',
      2,
      [],
      [],
      [
        { type: 'set', key: 'cursor', value: { version: 2 } },
        { type: 'set', key: 'mode', value: { enabled: true } },
        { type: 'delete', key: 'cursor' },
        { type: 'set', key: 'cursor', value: { version: 3 } },
        { type: 'delete', key: 'cursor' },
      ],
    ),
  },
]

// A deliberate wrong answer control: a fast writer that drops prior metadata
// passes a row-count check, but the complete observation comparison rejects it.
function sameObservation(actual: Observation, expected: Observation): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

type GeneratedScenario =
  | 'repeated-key'
  | 'delete-reinsert'
  | 'partial-update'
  | 'metadata-present-set'
  | 'metadata-present-delete'
  | 'metadata-absent-set'
  | 'metadata-absent-delete'
type ActionSpec = {
  kind: 'insert' | 'update' | 'delete'
  key: 'a' | 'b'
  version: number
  metadata: 'keep' | 'set' | 'clear'
}
type RowMetadataAction = NonNullable<Tx['rowMetadataMutations']>[number]
type CollectionMetadataAction = NonNullable<
  Tx['collectionMetadataMutations']
>[number]
type GeneratedHistory = {
  scenario: GeneratedScenario
  target: 'a' | 'b'
  prefix: Array<ActionSpec>
  rowMetadataPrefix: Array<RowMetadataAction>
  collectionMetadata: Array<CollectionMetadataAction>
  rollback: boolean
  followup: boolean
}

const generatedActionArbitrary: fc.Arbitrary<ActionSpec> = fc.record({
  kind: fc.constantFrom<ActionSpec['kind']>('insert', 'update', 'delete'),
  key: fc.constantFrom<'a' | 'b'>('a', 'b'),
  version: fc.integer({ min: 0, max: 9 }),
  metadata: fc.constantFrom<ActionSpec['metadata']>('keep', 'set', 'clear'),
})

const generatedHistoryArbitrary: fc.Arbitrary<GeneratedHistory> = fc.record({
  scenario: fc.constantFrom<GeneratedScenario>(
    'repeated-key',
    'delete-reinsert',
    'partial-update',
    'metadata-present-set',
    'metadata-present-delete',
    'metadata-absent-set',
    'metadata-absent-delete',
  ),
  target: fc.constantFrom<'a' | 'b'>('a', 'b'),
  prefix: fc.oneof(
    fc.array(generatedActionArbitrary, { maxLength: 4 }),
    fc.array(generatedActionArbitrary, { minLength: 5, maxLength: 24 }),
    fc.array(generatedActionArbitrary, { minLength: 25, maxLength: 60 }),
  ),
  rowMetadataPrefix: fc.array(
    fc
      .record({
        type: fc.constantFrom<'set' | 'delete'>('set', 'delete'),
        key: fc.constantFrom('a', 'b', 'c'),
        version: fc.integer({ min: 0, max: 9 }),
      })
      .map(
        ({ type, key, version }): RowMetadataAction =>
          type === 'set'
            ? { type, key, value: { source: `prefix-${version}` } }
            : { type, key },
      ),
    { maxLength: 3 },
  ),
  collectionMetadata: fc.array(
    fc
      .record({
        type: fc.constantFrom<'set' | 'delete'>('set', 'delete'),
        key: fc.constantFrom('cursor', 'mode'),
        version: fc.integer({ min: 0, max: 9 }),
      })
      .map(
        ({ type, key, version }): CollectionMetadataAction =>
          type === 'set' ? { type, key, value: { version } } : { type, key },
      ),
    { maxLength: 2 },
  ),
  rollback: fc.boolean(),
  followup: fc.boolean(),
})

type IndependentWorkCase = {
  shape:
    | 'insert-later-metadata'
    | 'insert-inline-metadata'
    | 'partial-update'
    | 'delete'
    | 'row-metadata-only'
    | 'collection-metadata-only'
  size: number
  cap: 100 | 999
}

const independentWorkArbitrary: fc.Arbitrary<IndependentWorkCase> = fc.record({
  shape: fc.constantFrom<IndependentWorkCase['shape']>(
    'insert-later-metadata',
    'insert-inline-metadata',
    'partial-update',
    'delete',
    'row-metadata-only',
    'collection-metadata-only',
  ),
  size: fc.integer({ min: 0, max: 60 }),
  cap: fc.constantFrom<100 | 999>(100, 999),
})

function independentTransactions(input: IndependentWorkCase): {
  seed?: Tx
  candidate: Tx
} {
  const keys = Array.from({ length: input.size }, (_, index) => `row-${index}`)
  switch (input.shape) {
    case 'insert-later-metadata':
      return { candidate: insertRows(input.size) }
    case 'insert-inline-metadata':
      return {
        candidate: transaction(
          'inline-insert',
          1,
          keys.map((key) => ({
            type: 'insert',
            key,
            value: { id: key, version: 1 },
            metadataChanged: true,
            metadata: { source: 'inline' },
          })),
        ),
      }
    case 'partial-update':
      return {
        seed: insertRows(input.size),
        candidate: transaction(
          'partial-update',
          2,
          keys.map((key) => ({
            type: 'update',
            key,
            value: { version: 2 },
          })),
        ),
      }
    case 'delete':
      return {
        seed: insertRows(input.size),
        candidate: transaction(
          'delete',
          2,
          keys.map((key) => ({
            type: 'delete',
            key,
            value: { id: key, deleted: 1 },
          })),
        ),
      }
    case 'row-metadata-only':
      return {
        seed: insertRows(input.size),
        candidate: transaction(
          'metadata',
          2,
          [],
          keys.map((key) => ({
            type: 'set',
            key,
            value: { source: 'later' },
          })),
        ),
      }
    case 'collection-metadata-only':
      return {
        seed: transaction(
          'collection-metadata-seed',
          1,
          [],
          [],
          keys.map((key) => ({ type: 'set', key, value: { version: 1 } })),
        ),
        candidate: transaction(
          'collection-metadata',
          2,
          [],
          [],
          keys.map((key, index) =>
            index % 2 === 0
              ? { type: 'set', key, value: { version: 2 } }
              : { type: 'delete', key },
          ),
        ),
      }
  }
}

async function assertIndependentWork(
  input: IndependentWorkCase,
  extraMeasuredCalls = 0,
): Promise<void> {
  const host = fixture(input.cap)
  const collectionId = 'oracle-independent-work'
  let primary: unknown
  try {
    await host.adapter.loadResumeSnapshot(collectionId)
    const { seed, candidate } = independentTransactions(input)
    const history: Array<Tx> = []
    if (seed) {
      history.push(clone(seed))
      beginMeasuredWrite(host)
      await host.adapter.applyCommittedTx(collectionId, seed)
      finishMeasuredWrite(host, 'independent-key seed checkpoint')
    }
    history.push(clone(candidate))
    beginMeasuredWrite(host)
    await host.adapter.applyCommittedTx(collectionId, candidate)
    // The optional increment is a count-perturbation control for the checker.
    host.counts.run += extraMeasuredCalls
    const counts = finishMeasuredWrite(
      host,
      'independent-key candidate checkpoint',
    )
    expect(
      await observe(host.adapter, host.driver, collectionId),
      'independent-key durable checkpoint',
    ).toEqual(modelAfter(history))
    const chunk = Math.min(125, Math.floor(input.cap / 4))
    const bound = 12 + 6 * Math.ceil(input.size / chunk)
    expect(
      counts.query + counts.run,
      'independent-key work checkpoint',
    ).toBeLessThanOrEqual(bound)
  } catch (error) {
    primary = error
  }
  try {
    host.close()
  } catch (cleanup) {
    if (primary !== undefined)
      throw new AggregateError(
        [primary, cleanup],
        'primary and cleanup failed',
        { cause: primary },
      )
    throw cleanup
  }
  if (primary !== undefined) throw primary
}

function generatedTransactions(input: GeneratedHistory): {
  seed: Tx
  candidate: Tx
  followup: Tx
} {
  const seed = transaction('generated-seed', 1, [
    {
      type: 'insert',
      key: 'a',
      value: { id: 'a', version: 1, keep: 1 },
      metadataChanged: true,
      metadata: { source: 'seed-a' },
    },
    {
      type: 'insert',
      key: 'b',
      value: { id: 'b', version: 1, keep: 1 },
      metadataChanged: true,
      metadata: { source: 'seed-b' },
    },
  ])
  const mutations: Tx['mutations'] = input.prefix.map(
    (action): Tx['mutations'][number] => {
      if (action.kind === 'delete') {
        return {
          type: 'delete',
          key: action.key,
          value: { id: action.key, deleted: action.version },
        }
      }
      const metadata =
        action.metadata === 'set'
          ? { source: `inline-${action.version}` }
          : undefined
      if (action.kind === 'insert') {
        return {
          type: 'insert',
          key: action.key,
          value: { id: action.key, version: action.version },
          metadataChanged: action.metadata !== 'keep',
          metadata,
        }
      }
      return {
        type: 'update',
        key: action.key,
        value: { version: action.version },
        metadataChanged: action.metadata !== 'keep',
        metadata,
      }
    },
  )
  const rowMetadata = [...input.rowMetadataPrefix]
  const key = input.target
  switch (input.scenario) {
    case 'repeated-key':
      mutations.push(
        { type: 'insert', key, value: { id: key, version: 2 } },
        { type: 'update', key, value: { fromUpdate: 3 } },
        { type: 'insert', key, value: { id: key, version: 4 } },
      )
      break
    case 'delete-reinsert':
      mutations.push(
        { type: 'delete', key, value: { id: key, deleted: 2 } },
        { type: 'insert', key, value: { id: key, version: 3 } },
      )
      break
    case 'partial-update':
      mutations.push({ type: 'update', key, value: { version: 3 } })
      break
    case 'metadata-present-set':
      mutations.push({ type: 'insert', key, value: { id: key, version: 3 } })
      rowMetadata.push({ type: 'set', key, value: { source: 'late' } })
      break
    case 'metadata-present-delete':
      mutations.push({ type: 'insert', key, value: { id: key, version: 3 } })
      rowMetadata.push({ type: 'delete', key })
      break
    case 'metadata-absent-set':
      rowMetadata.push({ type: 'set', key: 'c', value: { source: 'ignored' } })
      break
    case 'metadata-absent-delete':
      rowMetadata.push({ type: 'delete', key: 'c' })
      break
  }
  return {
    seed,
    candidate: transaction(
      'generated-candidate',
      2,
      mutations,
      rowMetadata,
      input.collectionMetadata,
    ),
    followup: transaction('generated-followup', 3, [
      { type: 'update', key, value: { followup: 1 } },
    ]),
  }
}

function expectGeneratedWork(candidate: Tx, counts: WriteCounts): void {
  const uniqueKeys = (actions: ReadonlyArray<{ key: string }>): number =>
    new Set(actions.map((action) => action.key)).size
  const chunk = 25 // The generated driver permits 100 bindings, four per row.
  const workChunks =
    Math.ceil(uniqueKeys(candidate.mutations) / chunk) +
    Math.ceil(uniqueKeys(candidate.rowMetadataMutations ?? []) / chunk) +
    Math.ceil(uniqueKeys(candidate.collectionMetadataMutations ?? []) / chunk)
  expect(
    counts.query + counts.run,
    'generated repeated-key work checkpoint',
  ).toBeLessThanOrEqual(12 + 6 * workChunks)
}

async function assertGeneratedHistory(
  input: GeneratedHistory,
  corruptCandidateMetadata = false,
  extraTransactionAt?: 'seed' | 'candidate' | 'followup',
): Promise<void> {
  const host = fixture(100)
  const collectionId = 'oracle-generated-history'
  let primary: unknown
  try {
    const { seed, candidate, followup } = generatedTransactions(input)
    const history = [clone(seed)]
    await host.adapter.loadResumeSnapshot(collectionId)
    beginMeasuredWrite(host)
    await host.adapter.applyCommittedTx(collectionId, seed)
    finishMeasuredWrite(
      host,
      'generated seed checkpoint',
      extraTransactionAt === 'seed' ? 1 : 0,
    )
    expect(
      await observe(host.adapter, host.driver, collectionId),
      'seed durable checkpoint',
    ).toEqual(modelAfter(history))
    if (input.rollback) {
      host.failRunMatching(/INSERT INTO applied_tx/)
      beginMeasuredWrite(host)
      await expect(
        host.adapter.applyCommittedTx(collectionId, candidate),
      ).rejects.toThrow('injected late bookkeeping failure')
      const counts = finishMeasuredWrite(
        host,
        'generated rollback checkpoint',
        extraTransactionAt === 'candidate' ? 1 : 0,
      )
      expectGeneratedWork(candidate, counts)
      host.failRunMatching(undefined)
      expect(
        await observe(host.adapter, host.driver, collectionId),
        'rollback durable checkpoint',
      ).toEqual(modelAfter(history))
    } else {
      host.corruptRowMetadata(corruptCandidateMetadata)
      history.push(clone(candidate))
      beginMeasuredWrite(host)
      await host.adapter.applyCommittedTx(collectionId, candidate)
      const counts = finishMeasuredWrite(
        host,
        'generated candidate checkpoint',
        extraTransactionAt === 'candidate' ? 1 : 0,
      )
      expectGeneratedWork(candidate, counts)
      expect(
        await observe(host.adapter, host.driver, collectionId),
        'candidate durable checkpoint',
      ).toEqual(modelAfter(history))
      if (input.followup) {
        history.push(clone(followup))
        beginMeasuredWrite(host)
        await host.adapter.applyCommittedTx(collectionId, followup)
        finishMeasuredWrite(
          host,
          'generated followup checkpoint',
          extraTransactionAt === 'followup' ? 1 : 0,
        )
        expect(
          await observe(host.adapter, host.driver, collectionId),
          'followup durable checkpoint',
        ).toEqual(modelAfter(history))
      }
    }
  } catch (error) {
    primary = error
  }
  try {
    host.close()
  } catch (cleanup) {
    if (primary !== undefined)
      throw new AggregateError(
        [primary, cleanup],
        'primary and cleanup failed',
        { cause: primary },
      )
    throw cleanup
  }
  if (primary !== undefined) throw primary
}

export function runOrdinaryTransactionWorkOracle(): void {
  describe('ordinary SQLite committed transaction oracle', () => {
    it('reconstructs the bounded generated action-history axes', () => {
      const samples = fc.sample(generatedHistoryArbitrary, {
        seed: 1992,
        numRuns: 120,
      })
      expect(new Set(samples.map((sample) => sample.scenario))).toEqual(
        new Set<GeneratedScenario>([
          'repeated-key',
          'delete-reinsert',
          'partial-update',
          'metadata-present-set',
          'metadata-present-delete',
          'metadata-absent-set',
          'metadata-absent-delete',
        ]),
      )
      expect(new Set(samples.map((sample) => sample.rollback))).toEqual(
        new Set([true, false]),
      )
      expect(new Set(samples.map((sample) => sample.followup))).toEqual(
        new Set([true, false]),
      )
      expect(
        new Set(
          samples.map((sample) => `${sample.scenario}:${sample.rollback}`),
        ).size,
      ).toBe(14)
      expect(new Set(samples.map((sample) => sample.target))).toEqual(
        new Set(['a', 'b']),
      )
      expect(
        samples.some(
          (sample) =>
            sample.prefix.length > 0 && sample.rowMetadataPrefix.length > 0,
        ),
      ).toBe(true)
      expect(
        samples.every(
          (sample) =>
            sample.prefix.length <= 60 &&
            sample.rowMetadataPrefix.length <= 3 &&
            sample.collectionMetadata.length <= 2,
        ),
      ).toBe(true)
      expect(samples.some((sample) => sample.prefix.length >= 25)).toBe(true)
    })

    it('reconstructs independent-key work shapes and host caps', () => {
      const samples = fc.sample(independentWorkArbitrary, {
        seed: 31992,
        numRuns: 120,
      })
      expect(new Set(samples.map((sample) => sample.shape))).toEqual(
        new Set<IndependentWorkCase['shape']>([
          'insert-later-metadata',
          'insert-inline-metadata',
          'partial-update',
          'delete',
          'row-metadata-only',
          'collection-metadata-only',
        ]),
      )
      expect(new Set(samples.map((sample) => sample.cap))).toEqual(
        new Set([100, 999]),
      )
      expect(
        samples.every((sample) => sample.size >= 0 && sample.size <= 60),
      ).toBe(true)
    })

    fcTest.prop([independentWorkArbitrary], {
      seed: 31992,
      numRuns: oracleRuns(24),
    })('bounds independent-key write work (fixed)', assertIndependentWork)

    fcTest.prop(
      [independentWorkArbitrary],
      oraclePropertyOptions(24, 'sqlite-ordinary.independent-work'),
    )(
      'bounds independent-key write work (random or replayed)',
      assertIndependentWork,
    )

    fcTest.prop([generatedHistoryArbitrary], {
      seed: 1992,
      numRuns: oracleRuns(24),
    })(
      'preserves bounded ordinary write histories (fixed)',
      assertGeneratedHistory,
    )

    fcTest.prop(
      [generatedHistoryArbitrary],
      oraclePropertyOptions(24, 'sqlite-ordinary.write-history'),
    )(
      'preserves bounded ordinary write histories (random or replayed)',
      assertGeneratedHistory,
    )

    it('rejects a wrong metadata-preservation design in the generated driver', async () => {
      await expect(
        assertGeneratedHistory(
          {
            scenario: 'partial-update',
            target: 'a',
            prefix: [],
            rowMetadataPrefix: [],
            collectionMetadata: [],
            rollback: false,
            followup: false,
          },
          true,
        ),
      ).rejects.toThrow()
    })

    it('rejects extra transactions at every generated write checkpoint', async () => {
      const history: GeneratedHistory = {
        scenario: 'partial-update',
        target: 'a',
        prefix: [],
        rowMetadataPrefix: [],
        collectionMetadata: [],
        rollback: false,
        followup: true,
      }
      await assertGeneratedHistory(history)
      for (const checkpoint of ['seed', 'candidate', 'followup'] as const) {
        await expect(
          assertGeneratedHistory(history, false, checkpoint),
        ).rejects.toThrow(`generated ${checkpoint} checkpoint`)
      }
      await expect(
        assertGeneratedHistory(
          { ...history, rollback: true },
          false,
          'candidate',
        ),
      ).rejects.toThrow('generated rollback checkpoint')
    })

    it('rejects extra measured row calls at the independent-key work checkpoint', async () => {
      const caseWithOneRow: IndependentWorkCase = {
        shape: 'insert-later-metadata',
        size: 1,
        cap: 100,
      }
      await assertIndependentWork(caseWithOneRow)
      await expect(assertIndependentWork(caseWithOneRow, 20)).rejects.toThrow(
        'independent-key work checkpoint',
      )
    })

    it('calibrates the complete-observation comparison', () => {
      const expected = modelAfter([
        semanticCases[0]!.seed!,
        semanticCases[0]!.candidate,
      ])
      const wrong = clone(expected)
      wrong.rows[0]!.metadata = undefined
      expect(sameObservation(expected, expected)).toBe(true)
      expect(sameObservation(wrong, expected)).toBe(false)
    })

    it('calibrates the synthetic 100-parameter host guard at its boundary', async () => {
      const host = fixture(100)
      let primary: unknown
      try {
        await host.driver.exec('CREATE TABLE cap_probe (value INTEGER)')
        const statement = (n: number) =>
          `INSERT INTO cap_probe (value) VALUES ${Array.from({ length: n }, () => '(?)').join(', ')}`
        await host.driver.run(statement(100), Array(100).fill(1))
        await expect(
          host.driver.run(statement(101), Array(101).fill(1)),
        ).rejects.toThrow('binding cap 100 exceeded: 101')
        expect(
          await host.driver.query<{ count: number }>(
            'SELECT COUNT(*) AS count FROM cap_probe',
          ),
        ).toEqual([{ count: 100 }])
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })

    it('refines durable semantics for the bounded process and design grammar; ordinary large writes are chunk-bounded', async () => {
      const workObservations: Array<{
        case: string
        calls: number
        bound: number
        maxParams: number
      }> = []
      for (const item of [
        ...workCases,
        ...additionalWorkCases,
        ...semanticCases,
      ]) {
        const host = fixture(item.cap)
        const collectionId = `oracle-${item.name}`
        let primary: unknown
        try {
          await host.adapter.loadResumeSnapshot(collectionId) // schema setup outside work count
          const history: Array<Tx> = []
          if (item.seed) {
            history.push(clone(item.seed))
            await host.adapter.applyCommittedTx(collectionId, item.seed)
          }
          host.counts.query = 0
          host.counts.run = 0
          host.counts.transactions = 0
          host.counts.maxParams = 0
          history.push(clone(item.candidate))
          await host.adapter.applyCommittedTx(collectionId, item.candidate)
          const calls = host.counts.query + host.counts.run
          const candidateTransactions = host.counts.transactions
          const maxParams = host.counts.maxParams
          const actual = await observe(host.adapter, host.driver, collectionId)
          const expected = modelAfter(history)
          expect(actual, `${item.name}: complete durable observation`).toEqual(
            expected,
          )
          expect(
            candidateTransactions,
            `${item.name}: one SQLite transaction`,
          ).toBe(1)
          if (item.workSize !== undefined) {
            const chunk = Math.min(125, Math.floor(item.cap / 4))
            const bound =
              12 +
              6 * (item.workFamilies ?? 1) * Math.ceil(item.workSize / chunk)
            workObservations.push({ case: item.name, calls, bound, maxParams })
          }
        } catch (error) {
          primary = error
        }
        try {
          host.close()
        } catch (cleanup) {
          if (primary !== undefined)
            throw new AggregateError(
              [primary, cleanup],
              `${item.name}: primary and cleanup failed`,
              { cause: primary },
            )
          throw cleanup
        }
        if (primary !== undefined) throw primary
      }
      // Check work after every semantic comparison, so the RED identifies work.
      console.log('ORDINARY_SQLITE_WORK', JSON.stringify(workObservations))
      for (const row of workObservations) {
        expect(row.calls, `${row.case}: work checkpoint`).toBeLessThanOrEqual(
          row.bound,
        )
      }
      const atSize = (size: number) =>
        workObservations.find(
          (row) => row.case === `unique-${size}-500-parameter-cap`,
        )!
      expect(atSize(124).calls).toBeLessThanOrEqual(10)
      expect(atSize(124).maxParams).toBe(496)
      expect(atSize(125).calls).toBeLessThanOrEqual(10)
      expect(atSize(125).maxParams).toBe(500)
      expect(atSize(126).calls).toBeLessThanOrEqual(15)
      expect(atSize(126).maxParams).toBe(500)
    })

    it('rejects a writer that discards existing metadata while batching', async () => {
      const host = fixture(100)
      const collectionId = 'oracle-hostile-metadata'
      let primary: unknown
      try {
        const item = semanticCases[0]!
        const history = [clone(item.seed!), clone(item.candidate)]
        await host.adapter.applyCommittedTx(collectionId, item.seed!)
        host.corruptRowMetadata(true)
        await host.adapter.applyCommittedTx(collectionId, item.candidate)
        const actual = await observe(host.adapter, host.driver, collectionId)
        const expected = modelAfter(history)
        expect(actual.rows[0]?.metadata).toBeUndefined()
        expect(actual).not.toEqual(expected)
        expect(sameObservation(actual, expected)).toBe(false)
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })

    it('rejects invalid values even when a later same-key action overwrites them', async () => {
      const host = fixture(100)
      const collectionId = 'oracle-overwritten-invalid-value'
      let primary: unknown
      try {
        await host.adapter.loadResumeSnapshot(collectionId)
        const seed = transaction('seed', 1, [
          { type: 'insert', key: 'same', value: { id: 'same' } },
        ])
        await host.adapter.applyCommittedTx(collectionId, seed)
        const before = await observe(host.adapter, host.driver, collectionId)
        const invalid = new Date(Number.NaN)
        const candidates: Array<PersistedTx> = [
          {
            txId: 'invalid-row',
            term: 1,
            seq: 2,
            rowVersion: 2,
            truncate: true,
            mutations: [
              { type: 'insert', key: 'same', value: { invalid } },
              { type: 'insert', key: 'same', value: { id: 'same' } },
            ],
          },
          {
            txId: 'invalid-row-before-delete',
            term: 1,
            seq: 2,
            rowVersion: 2,
            truncate: true,
            mutations: [
              { type: 'insert', key: 'same', value: { invalid } },
              { type: 'delete', key: 'same', value: { id: 'same' } },
            ],
          },
          {
            txId: 'invalid-inline-metadata',
            term: 1,
            seq: 2,
            rowVersion: 2,
            truncate: true,
            mutations: [
              {
                type: 'insert',
                key: 'same',
                value: { id: 'same' },
                metadataChanged: true,
                metadata: invalid,
              },
              {
                type: 'insert',
                key: 'same',
                value: { id: 'same' },
                metadataChanged: true,
                metadata: { source: 'valid' },
              },
            ],
          },
          {
            txId: 'invalid-row-metadata',
            term: 1,
            seq: 2,
            rowVersion: 2,
            truncate: true,
            mutations: [],
            rowMetadataMutations: [
              { type: 'set', key: 'same', value: invalid },
              { type: 'delete', key: 'same' },
            ],
          },
          {
            txId: 'invalid-collection-metadata',
            term: 1,
            seq: 2,
            rowVersion: 2,
            truncate: true,
            mutations: [],
            collectionMetadataMutations: [
              { type: 'set', key: 'cursor', value: invalid },
              { type: 'delete', key: 'cursor' },
            ],
          },
          {
            txId: 'undefined-collection-metadata',
            term: 1,
            seq: 2,
            rowVersion: 2,
            truncate: true,
            mutations: [],
            collectionMetadataMutations: [
              { type: 'set', key: 'cursor', value: undefined },
              { type: 'delete', key: 'cursor' },
            ],
          },
        ]
        for (const candidate of candidates) {
          await expect(
            host.adapter.applyCommittedTx(collectionId, candidate),
          ).rejects.toThrow()
          expect(
            await observe(host.adapter, host.driver, collectionId),
          ).toEqual(before)
        }
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })

    it('rejects a low-call replacement that loses metadata', async () => {
      const host = fixture(100)
      const collectionId = 'oracle-hostile-batch'
      let primary: unknown
      try {
        const seed = insertRows(26)
        const candidate = transaction(
          'replace-26',
          2,
          Array.from({ length: 26 }, (_, index) => ({
            type: 'insert' as const,
            key: `row-${index}`,
            value: { id: `row-${index}`, version: 2 },
          })),
        )
        await host.adapter.applyCommittedTx(collectionId, seed)
        const table = createPersistedTableName(collectionId, 'c')
        host.counts.run = 0
        // This test-only fast writer uses two legal 100-parameter statements.
        // REPLACE drops existing metadata, which an ordinary insert must retain.
        // It reaches the durable snapshot checkpoint, but deliberately bypasses
        // applyCommittedTx and therefore does not test position or rollback.
        await host.driver.transaction(async (driver) => {
          for (let offset = 0; offset < 26; offset += 25) {
            const batch = candidate.mutations.slice(offset, offset + 25)
            await driver.run(
              `INSERT OR REPLACE INTO "${table}" (key, value, metadata, row_version) VALUES ${batch.map(() => '(?, ?, ?, ?)').join(', ')}`,
              batch.flatMap((mutation) => [
                `s:${mutation.key}`,
                JSON.stringify(mutation.value),
                null,
                2,
              ]),
            )
          }
        })
        expect(host.counts.run).toBe(2)
        expect(host.counts.maxParams).toBeLessThanOrEqual(100)
        const actual = await observe(host.adapter, host.driver, collectionId)
        const expected = modelAfter([clone(seed), clone(candidate)])
        expect(actual.rows.map((row) => row.value)).toEqual(
          expected.rows.map((row) => row.value),
        )
        expect(actual.rows.some((row) => row.metadata === undefined)).toBe(true)
        expect(actual.rows).not.toEqual(expected.rows)
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })

    it('treats a repeated committed position as an idempotent write', async () => {
      const host = fixture(100)
      const collectionId = 'oracle-idempotent-position'
      let primary: unknown
      try {
        const seed = transaction('seed', 1, [
          { type: 'insert', key: 'gone', value: { id: 'gone' } },
        ])
        const candidate = transaction('delete', 2, [
          { type: 'delete', key: 'gone', value: { id: 'gone', deleted: 1 } },
        ])
        const history = [clone(seed), clone(candidate), clone(candidate)]
        await host.adapter.applyCommittedTx(collectionId, seed)
        await host.adapter.applyCommittedTx(collectionId, candidate)
        await host.adapter.applyCommittedTx(collectionId, candidate)
        expect(await observe(host.adapter, host.driver, collectionId)).toEqual(
          modelAfter(history),
        )
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })

    it('rolls back a fault after row and metadata statements but before applied position', async () => {
      const host = fixture(100)
      const collectionId = 'oracle-late-bookkeeping-fault'
      let primary: unknown
      try {
        const seed = transaction(
          'seed',
          1,
          [{ type: 'insert', key: 'anchor', value: { id: 'anchor' } }],
          [],
          [{ type: 'set', key: 'cursor', value: { offset: 1 } }],
        )
        await host.adapter.applyCommittedTx(collectionId, seed)
        const before = await observe(host.adapter, host.driver, collectionId)
        host.failRunMatching(/INSERT INTO applied_tx/)
        const candidate = transaction(
          'later-fault',
          2,
          [{ type: 'update', key: 'anchor', value: { changed: 1 } }],
          [{ type: 'set', key: 'anchor', value: { source: 'new' } }],
          [{ type: 'set', key: 'cursor', value: { offset: 2 } }],
        )
        await expect(
          host.adapter.applyCommittedTx(collectionId, candidate),
        ).rejects.toThrow('injected late bookkeeping failure')
        host.failRunMatching(undefined)
        expect(await observe(host.adapter, host.driver, collectionId)).toEqual(
          before,
        )
        expect(before).toEqual(modelAfter([clone(seed)]))
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })

    it('preserves public replay below the threshold and full reload above it', async () => {
      for (const size of [64, 65]) {
        const host = fixture(999)
        const collectionId = `oracle-replay-${size}`
        let primary: unknown
        try {
          const candidate = clone(insertRows(size))
          candidate.collectionMetadataMutations = []
          await host.adapter.applyCommittedTx(collectionId, candidate)
          const actual = await host.adapter.pullSince(collectionId, 0)
          if (size === 65) {
            expect(actual).toEqual({
              latestRowVersion: 1,
              requiresFullReload: true,
            })
          } else {
            expect(actual.requiresFullReload).toBe(false)
            if (actual.requiresFullReload) throw new Error('expected replay')
            expect(actual.latestRowVersion).toBe(1)
            expect([...actual.changedKeys].sort()).toEqual(
              candidate.mutations.map((change) => change.key).sort(),
            )
            expect(actual.deletedKeys).toEqual([])
            expect(actual.deltas).toEqual([
              {
                txId: candidate.txId,
                latestRowVersion: 1,
                changedRows: candidate.mutations.map((change) => ({
                  key: change.key,
                  value: clone(change.value),
                })),
                deletedKeys: [],
                rowMetadataMutations: clone(
                  candidate.rowMetadataMutations ?? [],
                ),
                collectionMetadataMutations: clone(
                  candidate.collectionMetadataMutations ?? [],
                ),
              },
            ])
          }
        } catch (error) {
          primary = error
        }
        try {
          host.close()
        } catch (cleanup) {
          if (primary !== undefined)
            throw new AggregateError(
              [primary, cleanup],
              'primary and cleanup failed',
              { cause: primary },
            )
          throw cleanup
        }
        if (primary !== undefined) throw primary
      }
    })

    it('rolls back rows, metadata, evidence and position after a later row-write fault', async () => {
      const host = fixture(100)
      const collectionId = 'oracle-later-fault'
      let primary: unknown
      try {
        await host.adapter.loadResumeSnapshot(collectionId)
        const seed = transaction(
          'seed',
          1,
          [
            {
              type: 'insert',
              key: 'anchor',
              value: { id: 'anchor', stable: 1 },
              metadataChanged: true,
              metadata: { source: 'old' },
            },
          ],
          [],
          [{ type: 'set', key: 'cursor', value: { offset: 1 } }],
        )
        await host.adapter.applyCommittedTx(collectionId, seed)
        const before = await observe(host.adapter, host.driver, collectionId)
        host.failAfterRowWriteCount(25)
        const candidate = transaction(
          'large-failing',
          2,
          Array.from({ length: 51 }, (_, i) => ({
            type: 'insert' as const,
            key: `new-${i}`,
            value: { id: `new-${i}` },
          })),
          [{ type: 'set', key: 'anchor', value: { source: 'new' } }],
          [{ type: 'set', key: 'cursor', value: { offset: 2 } }],
        )
        await expect(
          host.adapter.applyCommittedTx(collectionId, candidate),
        ).rejects.toThrow('injected later row-write failure')
        host.failAfterRowWriteCount(undefined)
        const after = await observe(host.adapter, host.driver, collectionId)
        expect(after).toEqual(before)
        expect(after).toEqual(modelAfter([seed]))
      } catch (error) {
        primary = error
      }
      try {
        host.close()
      } catch (cleanup) {
        if (primary !== undefined)
          throw new AggregateError(
            [primary, cleanup],
            'primary and cleanup failed',
            { cause: primary },
          )
        throw cleanup
      }
      if (primary !== undefined) throw primary
    })
  })
}
