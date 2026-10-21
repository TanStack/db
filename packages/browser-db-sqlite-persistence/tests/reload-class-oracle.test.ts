import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  resolvePersistedStorageTarget,
} from '@tanstack/db-sqlite-persistence-core'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type { Collection } from '@tanstack/db'

/**
 * # Is a Browser reload free of avoidable work ahead of its reads?
 *
 * Law and source: reloads must stay fast. This is an accepted, permanent
 * persistence goal, first reported in issues #2204 (per-Collection setup on
 * every load) and #2205 (election term writes ahead of startup reads). A
 * reload is a fresh persistence and coordinator over an existing database.
 * Its promises, at the checkpoint after every Collection is ready and leads:
 *
 * - (a) Setup. A Collection whose setup is complete issues no setup statement
 *   and one registry read. One whose setup is partial ends with every setup
 *   fact present and its stored row intact.
 * - (b) Order. No Collection's term write runs ahead of any startup row read
 *   queued when its leader lock was granted, unless a leader need arrived
 *   first. Every startup read is queued at every grant, because every
 *   Collection is preloaded in one task and a standard lock manager grants
 *   on a later task.
 * - (c) Need. A local write needs a leader. While another Collection's startup
 *   read is held, the writer's term is still reserved, and the write settles
 *   once the read is released.
 * - (e) Budget. Each Collection reserves one term and reads the registry once;
 *   each Collection that does not write reads its rows once. Database setup
 *   runs at most once per adapter the persistence creates, which is twice:
 *   the default adapter and the one for schema version 1 each repeat every
 *   `CREATE ... IF NOT EXISTS`, `PRAGMA table_info`, and two failing
 *   `ALTER TABLE ... ADD COLUMN` probes. That repeated database setup is
 *   avoidable work, recorded as a finding rather than bounded tighter here.
 *
 * Known gap, pinned below: a leader's own committed write can arrive after
 * the wrapper observed its position, so the wrapper treats its own commit as
 * an observed-but-unpublished gap and recovers with `pullSince` and a full
 * row scan. Main does this for the first local write on a fresh database too.
 *
 * K=1 fairness under the election barrier (law d) belongs to the
 * shared-driver fairness oracle; the Electron renderer host is owned by the
 * Electron reload election-order oracle; schema-version changes are owned by
 * the core collection-setup reopen oracle.
 *
 * Model: computed from the history alone. It knows which setup facts it
 * removed, which Collection writes and which read it holds. It does not read
 * scheduler, coordinator, or adapter state.
 *
 * History grammar: 1 to 4 Collections, each with complete setup or any
 * subset of its seven derived setup facts removed (indexes, triggers, and
 * bookkeeping rows); a lock grant 1, 2, or 5 tasks after the request; each
 * SQL statement immediate or one task late; and optionally a local write on
 * the first Collection while the last one's startup read is held. Fixed
 * reconstructions cover each axis; random and replayed campaigns cover
 * their combinations. Excluded: Node's Web Locks grant synchronously, which
 * no standard lock manager does, so every grant is delayed by at least one
 * task. Takeover, restart re-subscribe, dispose while the term is held back,
 * dropped row tables, and schema changes are out of this grammar.
 *
 * Production path and recorder: the real Browser persistence, a real
 * BrowserCollectionCoordinator over Node's Web Locks and BroadcastChannel,
 * the real persisted wrapper, and a real SQLite file. The recorder logs
 * every SQL statement in order with its parameters, so a missing, repeated,
 * or reordered statement stays visible.
 */

type Fact =
  | `rowIndex`
  | `tombstoneIndex`
  | `versionRow`
  | `epochRow`
  | `insertTrigger`
  | `deleteTrigger`
  | `updateTrigger`

const derivedFacts: ReadonlyArray<Fact> = [
  `rowIndex`,
  `tombstoneIndex`,
  `versionRow`,
  `epochRow`,
  `insertTrigger`,
  `deleteTrigger`,
  `updateTrigger`,
]

type CollectionHistory = { missing: ReadonlyArray<Fact> }
export type ReloadHistory = {
  collections: ReadonlyArray<CollectionHistory>
  grantTasks: 1 | 2 | 5
  statementLatency: 0 | 1
  writeWhileLastReadHeld: boolean
}

type Row = { id: string; title: string }
type Logged = { sql: string; params: ReadonlyArray<unknown> }

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function removeFactSql(collectionId: string, fact: Fact): string {
  const row = createPersistedTableName(collectionId, `c`)
  const tombstone = createPersistedTableName(collectionId, `t`)
  const id = collectionId.replaceAll(`'`, `''`)
  switch (fact) {
    case `rowIndex`:
      return `DROP INDEX "${row}_row_version_idx"`
    case `tombstoneIndex`:
      return `DROP INDEX "${tombstone}_row_version_idx"`
    case `versionRow`:
      return `DELETE FROM collection_version WHERE collection_id = '${id}'`
    case `epochRow`:
      return `DELETE FROM collection_reset_epoch WHERE collection_id = '${id}'`
    case `insertTrigger`:
      return `DROP TRIGGER "${row}_key_evidence_insert"`
    case `deleteTrigger`:
      return `DROP TRIGGER "${row}_key_evidence_delete"`
    case `updateTrigger`:
      return `DROP TRIGGER "${row}_key_evidence_update"`
  }
}

// The seven named setup objects and two bookkeeping rows, from names alone.
function setupFactsPresent(
  database: BetterSqlite3.Database,
  collectionId: string,
): boolean {
  const row = createPersistedTableName(collectionId, `c`)
  const tombstone = createPersistedTableName(collectionId, `t`)
  const names = [
    row,
    tombstone,
    `${row}_row_version_idx`,
    `${tombstone}_row_version_idx`,
    `${row}_key_evidence_insert`,
    `${row}_key_evidence_delete`,
    `${row}_key_evidence_update`,
  ]
  const present = names.every(
    (name) =>
      database
        .prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`)
        .get(name) !== undefined,
  )
  const has = (table: string) =>
    database
      .prepare(`SELECT 1 FROM ${table} WHERE collection_id = ?`)
      .get(collectionId) !== undefined
  return present && has(`collection_version`) && has(`collection_reset_epoch`)
}

// Deliver each leader-lock grant `tasks` tasks after Node's synchronous grant.
function delayLeaderGrants(dbName: string, tasks: number): () => void {
  const locks = navigator.locks
  const request = locks.request.bind(locks)
  locks.request = ((
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<unknown>,
    maybeCallback?: LockGrantedCallback<unknown>,
  ) => {
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    const granted: LockGrantedCallback<unknown> = async (lock) => {
      if (name.startsWith(`tsdb:leader:${dbName}:`)) {
        for (let task = 0; task < tasks; task++) await nextTask()
      }
      return callback(lock)
    }
    return typeof optionsOrCallback === `function`
      ? request(name, granted)
      : request(name, optionsOrCallback, granted)
  }) as typeof locks.request
  return () => {
    locks.request = request
  }
}

async function waitFor(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    if (condition()) return
    await nextTask()
  }
  throw new Error(`timed out waiting for ${label}`)
}

function openCollections(
  persistence: ReturnType<typeof createBrowserWASQLitePersistence>,
  ids: ReadonlyArray<string>,
): Array<Collection<Row, string>> {
  return ids.map((id) =>
    createCollection(
      persistedCollectionOptions<Row, string>({
        id,
        getKey: (row) => row.id,
        persistence,
        schemaVersion: 1,
      }),
    ),
  )
}

type Observation = {
  ids: ReadonlyArray<string>
  log: ReadonlyArray<Logged>
  termDuringHold: boolean | undefined
  factsPresent: Record<string, boolean>
  storedRows: Record<string, number>
}

type HeldReadSeam = {
  loadResumeSnapshotUnscheduled: (
    target: Parameters<typeof resolvePersistedStorageTarget>[0],
    ...rest: Array<unknown>
  ) => Promise<unknown>
}

export async function observeReload(
  history: ReloadHistory,
): Promise<Observation> {
  const ids = history.collections.map((_, index) => `reload-${index}`)
  const directory = mkdtempSync(join(tmpdir(), `reload-class-`))
  const filename = join(directory, `state.sqlite`)
  const dbName = `reload-class-${Math.random().toString(36).slice(2)}`
  const cleanups: Array<() => unknown> = []
  try {
    // Fill: one stored row per Collection, then remove the chosen facts.
    const fillDatabase = createWASQLiteTestDatabase({ filename })
    const filler = new BrowserCollectionCoordinator({ dbName })
    const filled = openCollections(
      createBrowserWASQLitePersistence({
        database: fillDatabase,
        coordinator: filler,
      }),
      ids,
    )
    await Promise.all(filled.map((collection) => collection.preload()))
    for (const collection of filled) {
      await collection.insert({ id: `row`, title: collection.id }).isPersisted
        .promise
    }
    for (const collection of filled) await collection.cleanup()
    filler.dispose()
    await fillDatabase.close?.()
    const damage = new BetterSqlite3(filename)
    history.collections.forEach((collection, index) => {
      for (const fact of collection.missing) {
        damage.exec(removeFactSql(ids[index]!, fact))
      }
    })
    damage.close()

    // Reload with a recorder, statement latency, and an optional held read.
    const log: Array<Logged> = []
    const reloadDatabase = createWASQLiteTestDatabase({ filename })
    cleanups.push(() => reloadDatabase.close?.())
    const execute = reloadDatabase.execute.bind(reloadDatabase)
    const heldId = history.writeWhileLastReadHeld ? ids.at(-1) : undefined
    let releaseHold!: () => void
    const holdReleased = new Promise<void>((resolve) => {
      releaseHold = resolve
    })
    cleanups.push(() => releaseHold())
    let holdActive = false
    // Read through a function: the seam below changes it asynchronously.
    const isHeld = () => holdActive
    reloadDatabase.execute = async <TRow>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ) => {
      if (history.statementLatency === 1) await nextTask()
      log.push({ sql: sql.replace(/\s+/g, ` `).trim(), params })
      return execute<TRow>(sql, params)
    }
    // The held read waits at its scope's first adapter call, before any SQL.
    // It holds the shared scheduler, as a long queued read does, but not the
    // driver, so an unscheduled term write can still run.
    const seam =
      SQLiteCorePersistenceAdapter.prototype as unknown as HeldReadSeam
    const loadResumeSnapshot = seam.loadResumeSnapshotUnscheduled
    let heldOnce = false
    seam.loadResumeSnapshotUnscheduled = async function (
      this: HeldReadSeam,
      target,
      ...rest
    ) {
      if (
        heldId !== undefined &&
        !heldOnce &&
        resolvePersistedStorageTarget(target).collectionId === heldId
      ) {
        heldOnce = true
        holdActive = true
        await holdReleased
        holdActive = false
      }
      return loadResumeSnapshot.call(this, target, ...rest)
    }
    cleanups.push(() => {
      seam.loadResumeSnapshotUnscheduled = loadResumeSnapshot
    })
    cleanups.push(delayLeaderGrants(dbName, history.grantTasks))
    const coordinator = new BrowserCollectionCoordinator({ dbName })
    cleanups.push(() => coordinator.dispose())
    const collections = openCollections(
      createBrowserWASQLitePersistence({
        database: reloadDatabase,
        coordinator,
      }),
      ids,
    )
    cleanups.push(async () => {
      for (const collection of collections) await collection.cleanup()
    })
    const preloads = collections.map((collection) => collection.preload())
    let termDuringHold: boolean | undefined
    if (heldId !== undefined) {
      await waitFor(isHeld, `held startup read`)
      await preloads[0]
      const write = collections[0]!.insert({ id: `local`, title: `local` })
        .isPersisted.promise
      await waitFor(
        () => log.some((entry) => isTermFor(entry, ids[0]!)),
        `writer term during the held read`,
      ).catch(() => undefined)
      termDuringHold = isHeld() && log.some((e) => isTermFor(e, ids[0]!))
      releaseHold()
      await write
    }
    await Promise.all(preloads)
    await waitFor(
      () => ids.every((id) => coordinator.isLeader(id)),
      `reloaded leaders`,
    )

    const inspect = new BetterSqlite3(filename, { readonly: true })
    const factsPresent: Record<string, boolean> = {}
    const storedRows: Record<string, number> = {}
    for (const id of ids) {
      factsPresent[id] = setupFactsPresent(inspect, id)
      storedRows[id] = (
        inspect
          .prepare(
            `SELECT COUNT(*) AS count FROM "${createPersistedTableName(id, `c`)}" WHERE key = ?`,
          )
          .get(`s:row`) as { count: number }
      ).count
    }
    inspect.close()
    return { ids, log, termDuringHold, factsPresent, storedRows }
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(directory, { recursive: true, force: true })
  }
}

function isRegistryRead(entry: Logged): boolean {
  return entry.sql.startsWith(`SELECT table_name, tombstone_table_name`)
}

// A term reservation increments the stored term; a committed write's position
// update also writes leader_term, with the term it already holds.
function isTermFor(entry: Logged, id: string): boolean {
  return (
    entry.sql.startsWith(
      `INSERT INTO leader_term (collection_id, latest_term) VALUES (?, ? + 1)`,
    ) && entry.params[0] === id
  )
}

function isRowScanFor(entry: Logged, id: string): boolean {
  return entry.sql.startsWith(
    `SELECT key, value, metadata, row_version FROM "${createPersistedTableName(id, `c`)}"`,
  )
}

function isSetupStatementFor(entry: Logged, id: string): boolean {
  const row = createPersistedTableName(id, `c`)
  const tombstone = createPersistedTableName(id, `t`)
  if (/^CREATE (TABLE|INDEX|TRIGGER) IF NOT EXISTS/.test(entry.sql)) {
    return entry.sql.includes(`"${row}`) || entry.sql.includes(`"${tombstone}`)
  }
  return (
    /^INSERT INTO collection_(version|reset_epoch) .*DO NOTHING$/.test(
      entry.sql,
    ) && entry.params[0] === id
  )
}

// Global setup statements: one block per adapter that initializes.
const globalSetupHead = `CREATE TABLE IF NOT EXISTS cache_generation (`

/**
 * The reference judgment. Every expectation comes from the history; the
 * observation supplies only the recorded statements and final file state.
 */
export function reloadViolations(
  history: ReloadHistory,
  observed: Observation,
): Array<string> {
  const violations: Array<string> = []
  const { ids, log } = observed
  const writer = history.writeWhileLastReadHeld ? ids[0] : undefined
  const count = (predicate: (entry: Logged) => boolean) =>
    log.filter(predicate).length
  history.collections.forEach((collection, index) => {
    const id = ids[index]!
    const complete = collection.missing.length === 0
    // (a) setup work and repair
    const setup = count((entry) => isSetupStatementFor(entry, id))
    if (complete && setup !== 0) {
      violations.push(`${id}: ${setup} setup statements with complete setup`)
    }
    if (!complete && setup === 0) {
      violations.push(`${id}: partial setup was not repaired`)
    }
    if (!observed.factsPresent[id])
      violations.push(`${id}: setup facts missing`)
    if (observed.storedRows[id] !== 1) violations.push(`${id}: stored row lost`)
    // (e) budget
    const registry = count((e) => isRegistryRead(e) && e.params[0] === id)
    if (registry !== 1) violations.push(`${id}: ${registry} registry reads`)
    // A leader's own first write can rescan its rows (pinned below), so the
    // once-per-reload scan count applies to every Collection that does not write.
    const scans = count((entry) => isRowScanFor(entry, id))
    if (id !== writer && scans !== 1) {
      violations.push(`${id}: ${scans} row scans`)
    }
    const terms = count((entry) => isTermFor(entry, id))
    if (terms !== 1) violations.push(`${id}: ${terms} term writes`)
    // (b) order: behind every queued startup read, unless this one needs a leader
    if (id !== writer) {
      const term = log.findIndex((entry) => isTermFor(entry, id))
      for (const read of ids) {
        const scan = log.findIndex((entry) => isRowScanFor(entry, read))
        if (scan > term) violations.push(`${id} term before ${read} read`)
      }
    }
  })
  // (c) need: the writer's term was reserved while the other read was held
  if (writer !== undefined && observed.termDuringHold !== true) {
    violations.push(`${writer}: no term while another startup read was held`)
  }
  // (e) budget: the Browser persistence initializes two adapters, the
  // default one and the one for schema version 1. Each runs database setup.
  const globalSetups = count((entry) => entry.sql.startsWith(globalSetupHead))
  if (globalSetups > 2) violations.push(`${globalSetups} database setups`)
  return violations
}

const collectionArb = fc.record({
  missing: fc.subarray([...derivedFacts]),
})

const reloadHistoryArb: fc.Arbitrary<ReloadHistory> = fc
  .record({
    collections: fc.array(collectionArb, { minLength: 1, maxLength: 4 }),
    grantTasks: fc.constantFrom(1 as const, 2 as const, 5 as const),
    statementLatency: fc.constantFrom(0 as const, 1 as const),
    writeWhileLastReadHeld: fc.boolean(),
  })
  .map((history) => ({
    ...history,
    writeWhileLastReadHeld:
      history.writeWhileLastReadHeld && history.collections.length >= 2,
  }))

const complete: CollectionHistory = { missing: [] }

// Each axis and its adjacent value, against an otherwise simple history.
export const fixedReloadHistories: ReadonlyArray<[string, ReloadHistory]> = [
  [
    `one complete Collection`,
    {
      collections: [complete],
      grantTasks: 1,
      statementLatency: 1,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `three complete Collections`,
    {
      collections: [complete, complete, complete],
      grantTasks: 1,
      statementLatency: 1,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `four Collections, immediate statements`,
    {
      collections: [complete, complete, complete, complete],
      grantTasks: 1,
      statementLatency: 0,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `late grant`,
    {
      collections: [complete, complete],
      grantTasks: 5,
      statementLatency: 1,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `every derived fact missing`,
    {
      collections: [{ missing: derivedFacts }, complete],
      grantTasks: 1,
      statementLatency: 1,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `one trigger missing`,
    {
      collections: [complete, { missing: [`updateTrigger`] }],
      grantTasks: 2,
      statementLatency: 1,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `bookkeeping rows missing`,
    {
      collections: [{ missing: [`versionRow`, `epochRow`] }],
      grantTasks: 1,
      statementLatency: 0,
      writeWhileLastReadHeld: false,
    },
  ],
  [
    `local write while a read is held`,
    {
      collections: [complete, complete],
      grantTasks: 1,
      statementLatency: 1,
      writeWhileLastReadHeld: true,
    },
  ],
  [
    `local write, four Collections`,
    {
      collections: [complete, complete, { missing: [`rowIndex`] }, complete],
      grantTasks: 2,
      statementLatency: 0,
      writeWhileLastReadHeld: true,
    },
  ],
]

async function expectLawful(history: ReloadHistory) {
  const observed = await observeReload(history)
  expect(reloadViolations(history, observed)).toEqual([])
}

describe(`reload class oracle`, () => {
  fcTest.each(
    fixedReloadHistories.map(([name, history]) => ({ name, history })),
  )(
    `keeps a reload free of avoidable work: $name`,
    async ({ history }) => {
      await expectLawful(history)
    },
    30_000,
  )

  fcTest.prop([reloadHistoryArb], { seed: 2204, numRuns: oracleRuns(8) })(
    `keeps generated reloads lawful (fixed seed)`,
    expectLawful,
    120_000,
  )

  fcTest.prop(
    [reloadHistoryArb],
    oraclePropertyOptions(8, `sqlite-reload.class`),
  )(
    `keeps generated reloads lawful (random or replayed)`,
    expectLawful,
    120_000,
  )

  // Known gap: remove `.fails` when a leader's own commit no longer rescans.
  fcTest.fails(
    `does not rescan a leader's rows after its own first write`,
    async () => {
      const history: ReloadHistory = {
        collections: [complete, complete],
        grantTasks: 1,
        statementLatency: 0,
        writeWhileLastReadHeld: true,
      }
      const observed = await observeReload(history)
      const writerScans = observed.log.filter((entry) =>
        isRowScanFor(entry, observed.ids[0]!),
      ).length
      expect(writerScans).toBe(1)
    },
    30_000,
  )
})
