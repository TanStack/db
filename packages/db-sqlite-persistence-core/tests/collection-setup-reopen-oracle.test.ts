import { DatabaseSync } from 'node:sqlite'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import type { PersistedTx, SQLiteDriver } from '../src'
import type { Observation as TraceEntry } from '../../db/tests/oracle-property.js'

/**
 * # Does reopening a persisted Collection repair setup without redoing it?
 *
 * Authority: the SQLite core adapter's per-Collection setup contract. Every
 * public adapter operation first ensures the Collection's row table,
 * tombstone table, their `row_version` indexes, three key-set evidence
 * triggers, and its `collection_version` and `collection_reset_epoch` rows.
 * Key-set evidence and reset lineage depend on all nine facts. The work law
 * comes from an accepted persistence goal: reloads are fast. Issue #2204
 * found that a page load repeated this setup for every Collection, and each
 * statement is a worker round trip on OPFS.
 *
 * Setup law: after a fresh adapter's first read of a registered Collection
 * resolves, the Collection's schema objects are exactly those of a fresh
 * install (same type, name, table, and SQL), both bookkeeping rows exist, and
 * stored rows are unchanged. This holds from every legal starting state.
 *
 * Work law: when all nine facts already hold for the registered schema
 * version, the first read costs at most one driver call more than the same
 * read after setup is cached in memory. A partial state may cost more.
 *
 * Model: a starting state is the set of setup facts present. The model names
 * the seven schema objects (type, name, table) from the fact list itself. The
 * expected rows are the seeded rows. A state is complete exactly when every
 * fact is present. SQL text is not in the model: the driver also records a
 * production fresh install on a separate database, and the check compares
 * the reopened schema with it (a differential law), and the fresh install's
 * objects with the model's.
 *
 * History grammar, each on its own node:sqlite database (the driver also
 * opens a second one for the fresh install it compares with):
 * - Interrupted setup: the registry row exists and setup stopped after the
 *   first k of the nine facts, for k in 0..9, in production setup order. No
 *   rows exist yet, because no write can precede complete setup.
 * - Missing derived facts: two rows were committed, then any subset of the two
 *   indexes, three triggers, and two bookkeeping rows is absent (an older
 *   release, or an external tool). All 128 subsets run. The tables stay, so
 *   rows survive.
 * - Schema change: a complete or trigger-less Collection is reopened with a
 *   new schema version. The reset clears rows; the setup law still holds.
 *   The work law does not apply because reset is a write.
 * The grammar excludes cache-generation claims, concurrent adapters, and
 * dropped row tables that still hold rows.
 *
 * Production path and checkpoint: a fresh `SQLiteCorePersistenceAdapter`
 * first reads another Collection, so global initialization is not measured.
 * It then calls `loadSubset` on the target Collection, and calls it again for
 * the cached baseline. The setup and row observations are taken after the
 * first `loadSubset` resolves. Each history opens two in-memory databases
 * and closes both however the history ends.
 *
 * The property is `sqlite-persistence.setup-reopen` on `oracleProperty`,
 * enumerated over all 140 starting states, each its own test.
 */

type Row = { id: string; title: string }

const collectionId = `todos`
const neighborId = `neighbor`
const rowTable = createPersistedTableName(collectionId, `c`)
const tombstoneTable = createPersistedTableName(collectionId, `t`)

type Fact =
  | `rowTable`
  | `rowIndex`
  | `tombstoneTable`
  | `tombstoneIndex`
  | `versionRow`
  | `epochRow`
  | `insertTrigger`
  | `deleteTrigger`
  | `updateTrigger`

// Production setup order; an interrupted setup holds a prefix of it.
const setupOrder: ReadonlyArray<Fact> = [
  `rowTable`,
  `rowIndex`,
  `tombstoneTable`,
  `tombstoneIndex`,
  `versionRow`,
  `epochRow`,
  `insertTrigger`,
  `deleteTrigger`,
  `updateTrigger`,
]

const derivedFacts: ReadonlyArray<Fact> = setupOrder.filter(
  (fact) => fact !== `rowTable` && fact !== `tombstoneTable`,
)

const removeFact: Record<Fact, string> = {
  rowTable: `DROP TABLE IF EXISTS "${rowTable}"`,
  rowIndex: `DROP INDEX IF EXISTS "${rowTable}_row_version_idx"`,
  tombstoneTable: `DROP TABLE IF EXISTS "${tombstoneTable}"`,
  tombstoneIndex: `DROP INDEX IF EXISTS "${tombstoneTable}_row_version_idx"`,
  versionRow: `DELETE FROM collection_version WHERE collection_id = '${collectionId}'`,
  epochRow: `DELETE FROM collection_reset_epoch WHERE collection_id = '${collectionId}'`,
  insertTrigger: `DROP TRIGGER IF EXISTS "${rowTable}_key_evidence_insert"`,
  deleteTrigger: `DROP TRIGGER IF EXISTS "${rowTable}_key_evidence_delete"`,
  updateTrigger: `DROP TRIGGER IF EXISTS "${rowTable}_key_evidence_update"`,
}

const schemaObjectOf: Partial<
  Record<Fact, { type: string; name: string; tbl_name: string }>
> = {
  rowTable: { type: `table`, name: rowTable, tbl_name: rowTable },
  rowIndex: {
    type: `index`,
    name: `${rowTable}_row_version_idx`,
    tbl_name: rowTable,
  },
  tombstoneTable: {
    type: `table`,
    name: tombstoneTable,
    tbl_name: tombstoneTable,
  },
  tombstoneIndex: {
    type: `index`,
    name: `${tombstoneTable}_row_version_idx`,
    tbl_name: tombstoneTable,
  },
  insertTrigger: {
    type: `trigger`,
    name: `${rowTable}_key_evidence_insert`,
    tbl_name: rowTable,
  },
  deleteTrigger: {
    type: `trigger`,
    name: `${rowTable}_key_evidence_delete`,
    tbl_name: rowTable,
  },
  updateTrigger: {
    type: `trigger`,
    name: `${rowTable}_key_evidence_update`,
    tbl_name: rowTable,
  },
}

// Ordered like collectionSchema: by type, then name.
function modelSchemaObjects(): Array<{
  type: string
  name: string
  tbl_name: string
}> {
  return setupOrder
    .flatMap((fact) => schemaObjectOf[fact] ?? [])
    .sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.name.localeCompare(right.name),
    )
}

const seededRows: Array<Row> = [
  { id: `a`, title: `first` },
  { id: `b`, title: `second` },
]

function seedTx(): PersistedTx<Row, string> {
  return {
    txId: `seed`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: seededRows.map((row) => ({
      type: `insert` as const,
      key: row.id,
      value: { ...row },
    })),
  }
}

type Counts = { exec: number; query: number; run: number; transaction: number }

function binding(value: unknown): string | number | bigint | null {
  if (value == null) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  )
    return value
  return String(value)
}

function countingDriver(database: DatabaseSync): {
  driver: SQLiteDriver
  counts: Counts
} {
  const counts: Counts = { exec: 0, query: 0, run: 0, transaction: 0 }
  const driver: SQLiteDriver = {
    exec: async (sql) => {
      counts.exec++
      database.exec(sql)
    },
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) => {
      counts.query++
      return database
        .prepare(sql)
        .all(...params.map(binding))
        .map((row) => ({ ...row })) as Array<T>
    },
    run: async (sql, params = []) => {
      counts.run++
      database.prepare(sql).run(...params.map(binding))
    },
    transaction: async <T>(fn: (tx: SQLiteDriver) => Promise<T>) => {
      counts.transaction++
      database.exec(`BEGIN IMMEDIATE`)
      try {
        const result = await fn(driver)
        database.exec(`COMMIT`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK`)
        throw error
      }
    },
  }
  return { driver, counts }
}

const totalCalls = (counts: Counts) =>
  counts.exec + counts.query + counts.run + counts.transaction

type SchemaObject = {
  type: string
  name: string
  tbl_name: string
  sql: string
}

// Primary-key autoindexes have no SQL; they follow from the tables.
function collectionSchema(database: DatabaseSync): Array<SchemaObject> {
  return database
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE tbl_name IN (?, ?) AND sql IS NOT NULL ORDER BY type, name`,
    )
    .all(rowTable, tombstoneTable)
    .map((row) => ({ ...row }) as SchemaObject)
}

function bookkeeping(database: DatabaseSync): {
  version: boolean
  epoch: boolean
} {
  const has = (table: string) =>
    database
      .prepare(`SELECT 1 FROM ${table} WHERE collection_id = ?`)
      .get(collectionId) !== undefined
  return {
    version: has(`collection_version`),
    epoch: has(`collection_reset_epoch`),
  }
}

const readOptions = {}
const target = (id: string) => ({ kind: `eager` as const, collectionId: id })

async function freshInstallSchema(
  database: DatabaseSync,
): Promise<Array<SchemaObject>> {
  const { driver } = countingDriver(database)
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  await adapter.loadSubset(target(collectionId), readOptions)
  return collectionSchema(database)
}

type Start = {
  name: string
  seedRows: boolean
  absent: ReadonlyArray<Fact>
  reopenSchemaVersion?: number
}

type Observation = {
  schema: Array<SchemaObject>
  bookkeeping: { version: boolean; epoch: boolean }
  rows: Array<Row>
  openCalls: Counts
  cachedReadCalls: number
}

async function reopen(
  start: Start,
  database: DatabaseSync,
): Promise<Observation> {
  const install = countingDriver(database)
  const installer = new SQLiteCorePersistenceAdapter({
    driver: install.driver,
    schemaVersion: 1,
  })
  await installer.loadSubset(target(collectionId), readOptions)
  if (start.seedRows) {
    await installer.applyCommittedTx(target(collectionId), seedTx())
  }
  for (const fact of [...start.absent].reverse()) {
    database.exec(removeFact[fact])
  }

  // A new adapter is a page reload: no in-memory setup cache survives.
  const reload = countingDriver(database)
  const adapter = new SQLiteCorePersistenceAdapter({
    driver: reload.driver,
    schemaVersion: start.reopenSchemaVersion ?? 1,
  })
  await adapter.loadSubset(target(neighborId), readOptions)

  const before = { ...reload.counts }
  const rows = await adapter.loadSubset(target(collectionId), readOptions)
  const openCalls: Counts = {
    exec: reload.counts.exec - before.exec,
    query: reload.counts.query - before.query,
    run: reload.counts.run - before.run,
    transaction: reload.counts.transaction - before.transaction,
  }
  const schema = collectionSchema(database)
  const rowBookkeeping = bookkeeping(database)

  const cachedBefore = totalCalls(reload.counts)
  await adapter.loadSubset(target(collectionId), readOptions)
  const cachedReadCalls = totalCalls(reload.counts) - cachedBefore

  return {
    schema,
    bookkeeping: rowBookkeeping,
    rows: rows
      .map(({ value }) => value as Row)
      .sort((left, right) => left.id.localeCompare(right.id)),
    openCalls,
    cachedReadCalls,
  }
}

function subsets<T>(items: ReadonlyArray<T>): Array<Array<T>> {
  return Array.from({ length: 2 ** items.length }, (_, mask) =>
    items.filter((_item, index) => (mask & (1 << index)) !== 0),
  )
}

const starts: Array<Start> = [
  ...setupOrder.map((_, k): Start => ({
    name: `setup interrupted after ${k} facts`,
    seedRows: false,
    absent: setupOrder.slice(k),
  })),
  {
    name: `setup complete, no rows`,
    seedRows: false,
    absent: [],
  },
  ...subsets(derivedFacts).map((absent): Start => ({
    name: `rows present, absent: ${absent.join(`, `) || `nothing`}`,
    seedRows: true,
    absent,
  })),
  {
    name: `schema change on a complete Collection`,
    seedRows: true,
    absent: [],
    reopenSchemaVersion: 2,
  },
  {
    name: `schema change on a trigger-less Collection`,
    seedRows: true,
    absent: [`insertTrigger`, `deleteTrigger`, `updateTrigger`],
    reopenSchemaVersion: 2,
  },
]

// The model: what a fresh adapter's first read must leave behind.
function setupModel(start: Start) {
  const resets = start.reopenSchemaVersion !== undefined
  return {
    objects: modelSchemaObjects(),
    rows: start.seedRows && !resets ? seededRows : [],
    // The work law applies only when all nine facts hold and nothing resets.
    workLawApplies: start.absent.length === 0 && !resets,
  }
}

// The driver: a fresh install and a reopen, each on its own in-memory
// database, both closed however the history ends.
async function driveReopen(
  start: Start,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const databases: Array<DatabaseSync> = []
  const open = () => {
    const database = new DatabaseSync(`:memory:`)
    databases.push(database)
    return database
  }
  try {
    observe(`fresh install`, await freshInstallSchema(open()))
    observe(`reopened`, await reopen(start, open()))
  } finally {
    for (const database of databases)
      try {
        database.close()
      } catch {
        // A database that failed to open has nothing to release.
      }
  }
}

// The check: the fresh install has the model's seven objects; the reopened
// Collection's schema equals the fresh install's, both bookkeeping rows
// exist, and its rows are the model's; when the work law applies, opening
// issues no DDL or writes and costs at most one call over a cached read.
function checkReopen(
  _start: Start,
  trace: ReadonlyArray<TraceEntry>,
  owed: ReturnType<typeof setupModel>,
) {
  const fresh = trace.find(({ checkpoint }) => checkpoint === `fresh install`)
    ?.value as Array<SchemaObject> | undefined
  const seen = trace.find(({ checkpoint }) => checkpoint === `reopened`)
    ?.value as Observation | undefined
  if (!fresh || !seen)
    return violation(`reopened`, `the driver recorded no reopen`, `trace`)
  const wrong =
    differs(
      `fresh install`,
      `fresh-install`,
      fresh.map(({ type, name, tbl_name }) => ({ type, name, tbl_name })),
      owed.objects,
      `a fresh install created other schema objects than the model names`,
    ) ??
    differs(
      `reopened`,
      `setup`,
      seen.schema,
      fresh,
      `the reopened schema differs from a fresh install`,
    ) ??
    differs(
      `reopened`,
      `bookkeeping`,
      seen.bookkeeping,
      { version: true, epoch: true },
      `a bookkeeping row is missing`,
    ) ??
    differs(`reopened`, `rows`, seen.rows, owed.rows, `stored rows changed`)
  if (wrong || !owed.workLawApplies) return wrong ?? pass
  return (
    differs(
      `reopened`,
      `work`,
      { exec: seen.openCalls.exec, run: seen.openCalls.run },
      { exec: 0, run: 0 },
      `complete setup issued DDL or writes`,
    ) ??
    (totalCalls(seen.openCalls) - seen.cachedReadCalls > 1
      ? violation(
          `reopened`,
          `setup cost ${totalCalls(seen.openCalls) - seen.cachedReadCalls} calls over a cached read, owed at most 1`,
          `work`,
        )
      : pass)
  )
}

oracleProperty({
  id: `sqlite-persistence.setup-reopen`,
  law: {
    statement: `After a fresh adapter's first read of a registered Collection, its schema objects are exactly a fresh install's (same type, name, table, and SQL), both bookkeeping rows exist, and stored rows are unchanged, from every legal starting state; when all nine setup facts already hold for the registered schema version, the read issues no DDL or writes and costs at most one call more than a cached read. A partial state may cost more.`,
    authority: `the SQLite core adapter's per-Collection setup contract; the accepted persistence goal that reloads are fast (issue #2204)`,
    limits: `In-memory node:sqlite databases; no cache-generation claims, concurrent adapters, or dropped row tables that still hold rows. SQL text is checked against a production fresh install, not absolute definitions.`,
    owner: `SQLite persistence`,
  },
  histories: starts,
  label: (start) => start.name,
  model: setupModel,
  driver: driveReopen,
  check: checkReopen,
  calibrations: [
    {
      name: `a trigger is not restored`,
      law: `setup`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `reopened`
            ? {
                ...entry,
                value: {
                  ...(entry.value as Observation),
                  schema: (entry.value as Observation).schema.filter(
                    ({ type }) => type !== `trigger`,
                  ),
                },
              }
            : entry,
        ),
    },
    {
      name: `the reset epoch row is missing`,
      law: `bookkeeping`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `reopened`
            ? {
                ...entry,
                value: {
                  ...(entry.value as Observation),
                  bookkeeping: { version: true, epoch: false },
                },
              }
            : entry,
        ),
    },
    {
      name: `repair drops stored rows`,
      law: `rows`,
      corrupt: (trace) => {
        const seen = trace.find(({ checkpoint }) => checkpoint === `reopened`)
          ?.value as Observation | undefined
        if (!seen?.rows.length) return undefined
        return trace.map((entry) =>
          entry.checkpoint === `reopened`
            ? { ...entry, value: { ...seen, rows: [] } }
            : entry,
        )
      },
    },
    {
      name: `complete setup runs DDL again`,
      law: `work`,
      corrupt: (trace, start) =>
        setupModel(start).workLawApplies
          ? trace.map((entry) =>
              entry.checkpoint === `reopened`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as Observation),
                      openCalls: {
                        ...(entry.value as Observation).openCalls,
                        exec: 1,
                      },
                    },
                  }
                : entry,
            )
          : undefined,
    },
  ],
})
