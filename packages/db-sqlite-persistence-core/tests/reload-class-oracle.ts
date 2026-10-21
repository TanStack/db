/**
 * # Is a reload free of avoidable work ahead of its reads?
 *
 * Law and source: reloads must stay fast. This is an accepted, permanent
 * persistence goal, first reported in issues #2204 (per-Collection setup on
 * every load) and #2205 (election term writes ahead of startup reads). A
 * reload is a fresh persistence and coordinator over a database that an
 * earlier session filled. At the checkpoint after the history's last action
 * settles, a reload owes:
 *
 * - (a) Setup. A Collection whose setup is complete issues no setup
 *   statement. One whose setup is partial ends with every setup fact present.
 *   Stored rows survive, unless a schema change resets them.
 * - (b) Order. A term write does not run ahead of work that was queued on its
 *   tab's shared scheduler when its leader lock was granted, unless a leader
 *   need came first. Every Collection is preloaded in one task, and a lock
 *   manager grants on a later task, so at every grant each eager Collection's
 *   startup row read and each managed Collection's cache claim are queued. A
 *   managed Collection requests its lock only after its claim, so its own
 *   startup metadata read is queued at its grant too.
 * - (c) Need. A leader need ends that wait. A local write during another
 *   startup read still gets its Collection's term and settles. A follower's
 *   write settles through the leader.
 * - (e) Budget. Each tab reads each Collection's registry row once and its
 *   rows once. An eager Collection takes two startup snapshots: its metadata
 *   before its source starts, then its rows at the baseline hydrate. The
 *   second is required, not avoidable: the source has started by then, and
 *   the hydrate must bind its rows and key-set evidence to durable state at
 *   that moment (the Electric law "rejects row loss between resume metadata
 *   and baseline hydration"). A managed Collection takes one, for its
 *   metadata; it has no baseline. A commit the tab already knows,
 *   including its own write, never makes it reread rows. Database setup
 *   issues no statement when it is complete, and checks it once per driver.
 *   Each election reserves one term; a reload that is disposed while its
 *   terms wait reserves none.
 *
 * K=1 fairness under the election barrier (law d) belongs to the
 * shared-driver fairness oracle; it needs a scheduler-level history.
 *
 * Model: `expectedReload` computes every expectation from the history alone.
 * It knows each Collection's kind, which setup facts the history removed,
 * which tabs open, and which actions run. It reads no scheduler, coordinator,
 * or adapter state.
 *
 * History grammar: 1 to 4 Collections, each eager (local rows) or managed
 * (an on-demand source with a cache generation claim), each with complete
 * setup or any subset of its seven derived setup facts removed, and an eager
 * one optionally reopened with a new schema version. A lock grant 1, 2, or 5
 * tasks after the request; each SQL statement immediate or one task late
 * (where the host controls latency). At most one need: a local write while
 * another startup read is held, or a follower tab's write. At most one
 * lifecycle event: a follower tab takes over after the leader tab closes, the
 * first Collection restarts, or the tab closes while its terms still wait.
 * A second tab opens after the first is ready, so the first tab's reload is
 * observed alone. Excluded: managed schema changes (they rotate the cache
 * generation, owned by the resume-snapshot oracle), and dropped row tables.
 *
 * Production drivers: each host supplies a real persistence, coordinator,
 * and database, a statement recorder, and latency control. The Node Browser
 * driver, the Electron renderer driver, and the Chromium OPFS page all run
 * this loop and this comparison. The recorder keeps every statement in order
 * with its parameters, so a missing, repeated, or reordered statement stays
 * visible.
 *
 * Timing helpers are premises. `delayLeaderGrants` records, at each leader
 * grant, whether every preload had already been called; the comparison
 * rejects a history where one had not. The held read records that it is held
 * when the writer's term is observed.
 */
import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import {
  SQLiteCorePersistenceAdapter,
  createPersistedTableName,
  persistedCollectionOptions,
  resolvePersistedStorageTarget,
} from '../src'
import type { Collection, SyncConfig } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../src'

export type Fact =
  | `rowIndex`
  | `tombstoneIndex`
  | `versionRow`
  | `epochRow`
  | `insertTrigger`
  | `deleteTrigger`
  | `updateTrigger`

export const derivedFacts: ReadonlyArray<Fact> = [
  `rowIndex`,
  `tombstoneIndex`,
  `versionRow`,
  `epochRow`,
  `insertTrigger`,
  `deleteTrigger`,
  `updateTrigger`,
]

export type CollectionHistory = {
  kind: `eager` | `managed`
  missing: ReadonlyArray<Fact>
  schemaChange: boolean
}

export type ReloadHistory = {
  collections: ReadonlyArray<CollectionHistory>
  grantTasks: 1 | 2 | 5
  statementLatency: 0 | 1
  need: `none` | `local-write` | `follower-write`
  lifecycle: `none` | `takeover` | `restart` | `dispose-while-waiting`
}

// ---------------------------------------------------------------------------
// Production driver boundary
// ---------------------------------------------------------------------------

/**
 * One tab: a persistence and coordinator over the shared database. Its
 * persistence resets a Collection on a schema mismatch, so a schema change is
 * a legal reload for a local-only Collection.
 */
export type ReloadTab = {
  persistence: PersistedCollectionPersistence
  isLeader: (storageId: string) => boolean
  close: () => Promise<void>
}

/** What a production driver supplies. Everything else is shared. */
export type ReloadHost = {
  /** Whether `statementLatency` reaches the database. */
  controlsLatency: boolean
  openTab: (dbName: string) => Promise<ReloadTab>
  /** Record every statement the database runs, in order, or stop. */
  record: (
    recorder: ((sql: string, params: ReadonlyArray<unknown>) => void) | null,
  ) => void
  setStatementLatency: (latency: 0 | 1) => void
  rawQuery: (
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<Array<Record<string, unknown>>>
  rawExec: (sql: string) => Promise<void>
}

export type Logged = { sql: string; params: ReadonlyArray<unknown> }

export type ReloadObservation = {
  ids: ReadonlyArray<string>
  storageIds: Record<string, string>
  /** Statements while the first tab reloads, before a second tab opens. */
  reloadLog: ReadonlyArray<Logged>
  /** Every statement after the fill. */
  log: ReadonlyArray<Logged>
  preloadsCalledAtEveryGrant: boolean
  termDuringHold: boolean | undefined
  needSettled: boolean | undefined
  followerLeadsAll: boolean | undefined
  factsPresent: Record<string, boolean>
  storedRow: Record<string, boolean>
}

type Row = { id: string; title: string }

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function waitFor(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    if (condition()) return
    await nextTask()
  }
  throw new Error(`timed out waiting for ${label}`)
}

function openCollections(
  persistence: PersistedCollectionPersistence,
  history: ReloadHistory,
  ids: ReadonlyArray<string>,
  schemaVersionFor: (index: number) => number,
): Array<Collection<Row, string>> {
  return history.collections.map((collection, index) => {
    if (collection.kind === `eager`) {
      return createCollection(
        persistedCollectionOptions<Row, string>({
          id: ids[index]!,
          getKey: (row) => row.id,
          persistence,
          schemaVersion: schemaVersionFor(index),
        }),
      )
    }
    const source: SyncConfig<Row, string> = {
      sync: ({ markReady }) => {
        markReady()
        return { loadSubset: () => Promise.resolve() }
      },
    }
    return createCollection(
      persistedCollectionOptions<Row, string>({
        id: ids[index]!,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: source,
        persistence,
        schemaVersion: 1,
      }),
    )
  })
}

/**
 * Premise helper. Delivers each leader grant `tasks` tasks after the lock
 * manager's grant and reports, at each one, whether every preload had been
 * called. Node grants synchronously, which no standard lock manager does.
 */
function delayLeaderGrants(
  dbName: string,
  tasks: number,
  onGrant: () => void,
): () => void {
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
        onGrant()
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

type HeldReadSeam = {
  loadResumeSnapshotUnscheduled: (
    target: Parameters<typeof resolvePersistedStorageTarget>[0],
    ...rest: Array<unknown>
  ) => Promise<unknown>
}

/**
 * Holds one Collection's first row snapshot at its first adapter call, before
 * any SQL. It holds that tab's shared scheduler, as a long queued read does,
 * but not the database, so an unscheduled term write can still run.
 */
function holdFirstRowSnapshot(storageId: string) {
  const seam = SQLiteCorePersistenceAdapter.prototype as unknown as HeldReadSeam
  const original = seam.loadResumeSnapshotUnscheduled
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const state = { held: false, used: false }
  seam.loadResumeSnapshotUnscheduled = async function (
    this: HeldReadSeam,
    target,
    ...rest
  ) {
    const ctx = rest[0] as { includeRows?: boolean } | undefined
    if (
      !state.used &&
      ctx?.includeRows !== false &&
      resolvePersistedStorageTarget(target).collectionId === storageId
    ) {
      state.used = true
      state.held = true
      await released
      state.held = false
    }
    return original.call(this, target, ...rest)
  }
  return {
    isHeld: () => state.held,
    release: () => release(),
    restore: () => {
      release()
      seam.loadResumeSnapshotUnscheduled = original
    },
  }
}

function removeFactSql(storageId: string, fact: Fact): string {
  const row = createPersistedTableName(storageId, `c`)
  const tombstone = createPersistedTableName(storageId, `t`)
  const id = storageId.replaceAll(`'`, `''`)
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

async function setupFactsPresent(
  host: ReloadHost,
  storageId: string,
): Promise<boolean> {
  const row = createPersistedTableName(storageId, `c`)
  const tombstone = createPersistedTableName(storageId, `t`)
  const names = [
    row,
    tombstone,
    `${row}_row_version_idx`,
    `${tombstone}_row_version_idx`,
    `${row}_key_evidence_insert`,
    `${row}_key_evidence_delete`,
    `${row}_key_evidence_update`,
  ]
  for (const name of names) {
    const found = await host.rawQuery(
      `SELECT 1 AS found FROM sqlite_master WHERE name = ?`,
      [name],
    )
    if (found.length === 0) return false
  }
  for (const table of [`collection_version`, `collection_reset_epoch`]) {
    const found = await host.rawQuery(
      `SELECT 1 AS found FROM ${table} WHERE collection_id = ?`,
      [storageId],
    )
    if (found.length === 0) return false
  }
  return true
}

async function closeTab(
  tab: ReloadTab,
  collections: ReadonlyArray<Collection<Row, string>>,
) {
  for (const collection of collections) await collection.cleanup()
  await tab.close()
}

/** The shared driver loop. A host supplies only its production boundary. */
export async function observeReload(
  host: ReloadHost,
  history: ReloadHistory,
): Promise<ReloadObservation> {
  const ids = history.collections.map((_, index) => `reload-${index}`)
  const dbName = `reload-${Math.random().toString(36).slice(2, 10)}`
  const cleanups: Array<() => unknown> = []
  try {
    // Fill: one stored row per eager Collection and a cache generation for
    // each managed one. Then remove the chosen setup facts.
    const filler = await host.openTab(dbName)
    const filled = openCollections(filler.persistence, history, ids, () => 1)
    await Promise.all(filled.map((collection) => collection.preload()))
    for (const [index, collection] of filled.entries()) {
      if (history.collections[index]!.kind !== `eager`) continue
      await collection.insert({ id: `row`, title: collection.id }).isPersisted
        .promise
    }
    await closeTab(filler, filled)
    const generations = await host.rawQuery(
      `SELECT logical_id, physical_id FROM cache_generation WHERE retired = 0`,
    )
    const storageIds: Record<string, string> = {}
    for (const id of ids) {
      const generation = generations.find((row) => row.logical_id === id)
      storageIds[id] = (generation?.physical_id as string | undefined) ?? id
    }
    for (const [index, collection] of history.collections.entries()) {
      for (const fact of collection.missing) {
        await host.rawExec(removeFactSql(storageIds[ids[index]!]!, fact))
      }
    }

    // Reload: the first tab alone, with a recorder and the history's seams.
    const log: Array<Logged> = []
    let termDuringHold: boolean | undefined
    let needSettled: boolean | undefined
    let followerLeadsAll: boolean | undefined
    host.record((sql, params) =>
      log.push({ sql: sql.replace(/\s+/g, ` `).trim(), params }),
    )
    cleanups.push(() => host.record(null))
    if (host.controlsLatency) host.setStatementLatency(history.statementLatency)
    cleanups.push(() => host.setStatementLatency(0))
    let preloadsCalled = false
    let preloadsCalledAtEveryGrant = true
    cleanups.push(
      delayLeaderGrants(dbName, history.grantTasks, () => {
        preloadsCalledAtEveryGrant &&= preloadsCalled
      }),
    )
    const heldId = heldCollection(history)
    const hold =
      heldId === undefined ? undefined : holdFirstRowSnapshot(ids[heldId]!)
    if (hold) cleanups.push(hold.restore)

    const leader = await host.openTab(dbName)
    const leaderCollections = openCollections(
      leader.persistence,
      history,
      ids,
      (index) => (history.collections[index]!.schemaChange ? 2 : 1),
    )
    let leaderOpen = true
    cleanups.push(async () => {
      if (leaderOpen) await closeTab(leader, leaderCollections)
    })
    const preloads = leaderCollections.map((collection) => collection.preload())
    preloadsCalled = true
    for (const preload of preloads) void preload.catch(() => undefined)

    if (history.need === `local-write` && hold) {
      await waitFor(hold.isHeld, `held startup read`)
      await preloads[0]
      const write = leaderCollections[0]!.insert({ id: `local`, title: `l` })
        .isPersisted.promise
      const writer = storageIds[ids[0]!]!
      await waitFor(
        () => log.some((entry) => isTermFor(entry, writer)),
        `writer term during the held read`,
      ).catch(() => undefined)
      termDuringHold =
        hold.isHeld() && log.some((entry) => isTermFor(entry, writer))
      hold.release()
      await write
      needSettled = true
    }
    if (history.lifecycle === `dispose-while-waiting` && hold) {
      // The tab closes while a startup read is still queued: its coordinator
      // and connection close first and must not wait for that read. A
      // Collection's own cleanup may wait for queued work, as any write does.
      await waitFor(hold.isHeld, `held startup read`)
      leaderOpen = false
      await Promise.race([
        leader.close(),
        waitFor(() => false, `tab close while terms wait`),
      ])
      hold.release()
      await Promise.allSettled(preloads)
      for (const collection of leaderCollections) {
        await collection.cleanup().catch(() => undefined)
      }
      return await finish()
    }
    await Promise.all(preloads)
    await waitFor(
      () => ids.every((id) => leader.isLeader(storageIds[id]!)),
      `reloaded leaders`,
    )
    if (history.lifecycle === `restart`) {
      await leaderCollections[0]!.cleanup()
      await leaderCollections[0]!.preload()
      await waitFor(
        () => leader.isLeader(storageIds[ids[0]!]!),
        `restarted leader`,
      )
    }
    const reloadLog = [...log]

    // A second tab opens after the first is ready, as a follower.
    if (history.need === `follower-write` || history.lifecycle === `takeover`) {
      const follower = await host.openTab(dbName)
      const followerCollections = openCollections(
        follower.persistence,
        history,
        ids,
        (index) => (history.collections[index]!.schemaChange ? 2 : 1),
      )
      cleanups.push(() => closeTab(follower, followerCollections))
      await Promise.all(
        followerCollections.map((collection) => collection.preload()),
      )
      if (history.need === `follower-write`) {
        const writer = history.collections.findIndex((c) => c.kind === `eager`)
        await followerCollections[writer]!.insert({ id: `f`, title: `f` })
          .isPersisted.promise
        needSettled = true
      }
      if (history.lifecycle === `takeover`) {
        leaderOpen = false
        await closeTab(leader, leaderCollections)
        await waitFor(
          () => ids.every((id) => follower.isLeader(storageIds[id]!)),
          `follower takeover`,
        )
        followerLeadsAll = true
      }
    }
    return await finish(reloadLog)

    async function finish(reloadLog: ReadonlyArray<Logged> = [...log]) {
      host.record(null)
      const factsPresent: Record<string, boolean> = {}
      const storedRow: Record<string, boolean> = {}
      for (const [index, id] of ids.entries()) {
        const storageId = storageIds[id]!
        factsPresent[id] = await setupFactsPresent(host, storageId)
        if (history.collections[index]!.kind === `eager`) {
          const rows = await host.rawQuery(
            `SELECT 1 AS found FROM "${createPersistedTableName(storageId, `c`)}" WHERE key = ?`,
            [`s:row`],
          )
          storedRow[id] = rows.length > 0
        }
      }
      return {
        ids,
        storageIds,
        reloadLog,
        log: [...log],
        preloadsCalledAtEveryGrant,
        termDuringHold,
        needSettled,
        followerLeadsAll,
        factsPresent,
        storedRow,
      }
    }
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
}

/** The held read: the last eager Collection, when the history holds one. */
function heldCollection(history: ReloadHistory): number | undefined {
  if (
    history.need !== `local-write` &&
    history.lifecycle !== `dispose-while-waiting`
  ) {
    return undefined
  }
  const eager = history.collections.flatMap((collection, index) =>
    collection.kind === `eager` ? [index] : [],
  )
  return eager.at(-1)
}

// ---------------------------------------------------------------------------
// Recorder classification: statement text only, no production helpers
// ---------------------------------------------------------------------------

function isTermFor(entry: Logged, storageId: string): boolean {
  // A committed write's position update also writes leader_term, with the
  // term it already holds; only a reservation adds one.
  return (
    entry.sql.startsWith(
      `INSERT INTO leader_term (collection_id, latest_term) VALUES (?, ? + 1)`,
    ) && entry.params[0] === storageId
  )
}

function isRowScanFor(entry: Logged, storageId: string): boolean {
  return entry.sql.startsWith(
    `SELECT key, value, metadata, row_version FROM "${createPersistedTableName(storageId, `c`)}"`,
  )
}

function isRegistryReadFor(entry: Logged, storageId: string): boolean {
  return (
    entry.sql.startsWith(`SELECT table_name, tombstone_table_name`) &&
    entry.params[0] === storageId
  )
}

// One startup snapshot reads the reset epoch once, at its end.
function isSnapshotFor(entry: Logged, storageId: string): boolean {
  return (
    entry.sql.startsWith(`SELECT reset_epoch FROM collection_reset_epoch`) &&
    entry.params[0] === storageId
  )
}

function isMetadataReadFor(entry: Logged, storageId: string): boolean {
  return (
    entry.sql.startsWith(`SELECT key, value FROM collection_metadata`) &&
    entry.params[0] === storageId
  )
}

function isClaimFor(entry: Logged, logicalId: string): boolean {
  return (
    entry.sql.startsWith(`INSERT INTO cache_generation_claim`) &&
    entry.params[1] === logicalId
  )
}

function isSetupStatementFor(entry: Logged, storageId: string): boolean {
  const row = createPersistedTableName(storageId, `c`)
  const tombstone = createPersistedTableName(storageId, `t`)
  if (/^CREATE (TABLE|INDEX|TRIGGER) IF NOT EXISTS/.test(entry.sql)) {
    return entry.sql.includes(`"${row}`) || entry.sql.includes(`"${tombstone}`)
  }
  return (
    /^INSERT INTO collection_(version|reset_epoch) .*DO NOTHING$/.test(
      entry.sql,
    ) && entry.params[0] === storageId
  )
}

// Database setup: DDL, writes, or schema reads on tables no Collection owns.
function isDatabaseSetupStatement(entry: Logged): boolean {
  if (/^PRAGMA /.test(entry.sql)) return true
  if (/^(CREATE|ALTER) /.test(entry.sql)) {
    return !/"[ct]_[a-z0-9]+_[a-z0-9]+/.test(entry.sql)
  }
  return /^INSERT INTO schema_version /.test(entry.sql)
}

// ---------------------------------------------------------------------------
// The model and the comparison
// ---------------------------------------------------------------------------

type ExpectedCollection = {
  /** Undefined when the tab closes before the Collection's first read. */
  setupRuns: boolean | undefined
  storedRow: boolean | undefined
  registryReads: number | undefined
  rowScans: number | undefined
  snapshots: number | undefined
  terms: number
}

export function expectedReload(history: ReloadHistory): {
  collections: Array<ExpectedCollection>
  tabs: number
  writerExemptFromOrder: number | undefined
} {
  const secondTab =
    history.need === `follower-write` || history.lifecycle === `takeover`
  const disposed = history.lifecycle === `dispose-while-waiting`
  const tabs = secondTab ? 2 : 1
  const held = heldCollection(history)
  return {
    tabs,
    writerExemptFromOrder: history.need === `local-write` ? 0 : undefined,
    collections: history.collections.map((collection, index) => {
      const restarted = history.lifecycle === `restart` && index === 0
      const eager = collection.kind === `eager`
      // Setup and a schema reset happen at a Collection's first read. A tab
      // closed during the held read may never reach the reads queued behind
      // it: the held one, later eager ones, and every managed one, whose
      // read follows its claim.
      const neverRead =
        disposed &&
        (index >= (held ?? Infinity) || collection.kind === `managed`)
      return {
        setupRuns: neverRead ? undefined : collection.missing.length > 0,
        storedRow: eager && !neverRead ? !collection.schemaChange : undefined,
        // Each tab's adapter reads the registry once; a restart reuses it.
        // A held first snapshot reads it after the hold, so a tab closed
        // during the hold may never read it.
        registryReads: neverRead ? undefined : tabs,
        // Each tab reads an eager Collection's rows once; a restart rereads.
        rowScans: eager && !disposed ? tabs + (restarted ? 1 : 0) : undefined,
        // A held snapshot may or may not run after its tab closes.
        snapshots: disposed
          ? undefined
          : (eager ? 2 : 1) * (tabs + (restarted ? 1 : 0)),
        terms: disposed
          ? 0
          : 1 +
            (history.lifecycle === `takeover` ? 1 : 0) +
            (restarted ? 1 : 0),
      }
    }),
  }
}

export function reloadViolations(
  history: ReloadHistory,
  observed: ReloadObservation,
): Array<string> {
  const violations: Array<string> = []
  const expected = expectedReload(history)
  const { ids, storageIds, log, reloadLog } = observed
  const count = (
    entries: ReadonlyArray<Logged>,
    test: (e: Logged) => boolean,
  ) => entries.filter(test).length
  if (!observed.preloadsCalledAtEveryGrant) {
    violations.push(`premise: a leader grant ran before every preload began`)
  }
  history.collections.forEach((collection, index) => {
    const id = ids[index]!
    const storageId = storageIds[id]!
    const want = expected.collections[index]!
    // (a) setup work and repair
    const setup = count(log, (e) => isSetupStatementFor(e, storageId))
    if (want.setupRuns === false && setup !== 0) {
      violations.push(`${id}: ${setup} setup statements with complete setup`)
    }
    if (want.setupRuns === true && setup === 0) {
      violations.push(`${id}: partial setup was not repaired`)
    }
    if (want.setupRuns !== undefined && !observed.factsPresent[id]) {
      violations.push(`${id}: setup facts missing`)
    }
    if (
      want.storedRow !== undefined &&
      observed.storedRow[id] !== want.storedRow
    ) {
      violations.push(
        `${id}: stored row ${want.storedRow ? `lost` : `survived a reset`}`,
      )
    }
    // (e) budget
    const registry = count(log, (e) => isRegistryReadFor(e, storageId))
    if (want.registryReads !== undefined && registry !== want.registryReads) {
      violations.push(`${id}: ${registry} registry reads`)
    }
    if (want.rowScans !== undefined) {
      const scans = count(log, (e) => isRowScanFor(e, storageId))
      if (scans !== want.rowScans) violations.push(`${id}: ${scans} row scans`)
    }
    const snapshots = count(log, (e) => isSnapshotFor(e, storageId))
    if (want.snapshots !== undefined && snapshots !== want.snapshots) {
      violations.push(`${id}: ${snapshots} startup snapshots`)
    }
    const terms = count(log, (e) => isTermFor(e, storageId))
    if (terms !== want.terms) violations.push(`${id}: ${terms} term writes`)
    // (b) order, on the first tab's reload
    if (want.terms === 0 || expected.writerExemptFromOrder === index) return
    const term = reloadLog.findIndex((e) => isTermFor(e, storageId))
    const mustPrecede: Array<[string, (e: Logged) => boolean]> = []
    history.collections.forEach((other, otherIndex) => {
      const otherId = ids[otherIndex]!
      const otherStorage = storageIds[otherId]!
      if (other.kind === `eager`) {
        mustPrecede.push([
          `${otherId} read`,
          (e) => isRowScanFor(e, otherStorage),
        ])
      } else {
        mustPrecede.push([`${otherId} claim`, (e) => isClaimFor(e, otherId)])
      }
    })
    if (collection.kind === `managed`) {
      mustPrecede.push([
        `${id} metadata read`,
        (e) => isMetadataReadFor(e, storageId),
      ])
    }
    for (const [label, test] of mustPrecede) {
      const at = reloadLog.findIndex(test)
      if (at === -1 || at > term) violations.push(`${id} term before ${label}`)
    }
    // A restart's term follows its own second startup read.
    if (history.lifecycle === `restart` && index === 0) {
      const scans = reloadLog.flatMap((e, at) =>
        isRowScanFor(e, storageId) ? [at] : [],
      )
      const terms = reloadLog.flatMap((e, at) =>
        isTermFor(e, storageId) ? [at] : [],
      )
      if ((scans[1] ?? Infinity) > (terms[1] ?? -1)) {
        violations.push(`${id}: restart term before its startup read`)
      }
    }
  })
  // (c) need
  if (history.need === `local-write` && observed.termDuringHold !== true) {
    violations.push(`${ids[0]}: no term while another startup read was held`)
  }
  if (history.need !== `none` && observed.needSettled !== true) {
    violations.push(`the leader need did not settle`)
  }
  if (history.lifecycle === `takeover` && observed.followerLeadsAll !== true) {
    violations.push(`the follower did not take over`)
  }
  // (e) database setup is complete after the fill
  const databaseSetup = count(log, isDatabaseSetupStatement)
  if (databaseSetup !== 0) {
    violations.push(`${databaseSetup} database setup statements`)
  }
  return violations
}

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

const collectionArb: fc.Arbitrary<CollectionHistory> = fc
  .record({
    kind: fc.constantFrom(`eager` as const, `managed` as const),
    missing: fc.subarray([...derivedFacts]),
    schemaChange: fc.boolean(),
  })
  .map((collection) => ({
    ...collection,
    schemaChange: collection.kind === `eager` && collection.schemaChange,
  }))

/** Repairs a generated history so its need and lifecycle have a target. */
function legal(history: ReloadHistory): ReloadHistory {
  const eager = history.collections.filter((c) => c.kind === `eager`).length
  const firstEager = history.collections[0]?.kind === `eager`
  let { need, lifecycle } = history
  // A local write needs an eager writer first and another eager read held.
  if (need === `local-write` && !(firstEager && eager >= 2)) need = `none`
  if (need === `follower-write` && eager === 0) need = `none`
  if (lifecycle === `restart` && !firstEager) lifecycle = `none`
  if (lifecycle === `dispose-while-waiting` && (eager === 0 || need !== `none`))
    lifecycle = `none`
  if (lifecycle === `takeover` && need === `local-write`) lifecycle = `none`
  return { ...history, need, lifecycle }
}

export const reloadHistoryArb: fc.Arbitrary<ReloadHistory> = fc
  .record({
    collections: fc.array(collectionArb, { minLength: 1, maxLength: 4 }),
    grantTasks: fc.constantFrom(1 as const, 2 as const, 5 as const),
    statementLatency: fc.constantFrom(0 as const, 1 as const),
    need: fc.constantFrom(
      `none` as const,
      `local-write` as const,
      `follower-write` as const,
    ),
    lifecycle: fc.constantFrom(
      `none` as const,
      `takeover` as const,
      `restart` as const,
      `dispose-while-waiting` as const,
    ),
  })
  .map(legal)

const eager: CollectionHistory = {
  kind: `eager`,
  missing: [],
  schemaChange: false,
}
const managed: CollectionHistory = {
  kind: `managed`,
  missing: [],
  schemaChange: false,
}
const base = {
  grantTasks: 1,
  statementLatency: 1,
  need: `none`,
  lifecycle: `none`,
} as const

/** Each axis and its adjacent value, against an otherwise simple history. */
export const fixedReloadHistories: ReadonlyArray<[string, ReloadHistory]> = [
  [`one complete Collection`, { ...base, collections: [eager] }],
  [
    `three complete Collections`,
    { ...base, collections: [eager, eager, eager] },
  ],
  [
    `four Collections, immediate statements`,
    { ...base, statementLatency: 0, collections: [eager, eager, eager, eager] },
  ],
  [`late grant`, { ...base, grantTasks: 5, collections: [eager, eager] }],
  [
    `every derived fact missing`,
    {
      ...base,
      collections: [{ ...eager, missing: derivedFacts }, eager],
    },
  ],
  [
    `one trigger missing`,
    {
      ...base,
      grantTasks: 2,
      collections: [eager, { ...eager, missing: [`updateTrigger`] }],
    },
  ],
  [
    `bookkeeping rows missing`,
    {
      ...base,
      statementLatency: 0,
      collections: [{ ...eager, missing: [`versionRow`, `epochRow`] }],
    },
  ],
  [
    `schema change`,
    { ...base, collections: [{ ...eager, schemaChange: true }, eager] },
  ],
  [`managed Collection`, { ...base, collections: [managed] }],
  [
    `eager term behind a managed claim`,
    { ...base, collections: [eager, managed, eager] },
  ],
  [
    `managed Collection with missing setup`,
    {
      ...base,
      collections: [{ ...managed, missing: [`insertTrigger`] }, eager],
    },
  ],
  [
    `local write while a read is held`,
    { ...base, need: `local-write`, collections: [eager, eager] },
  ],
  [
    `local write, four Collections`,
    {
      ...base,
      grantTasks: 2,
      statementLatency: 0,
      need: `local-write`,
      collections: [eager, managed, { ...eager, missing: [`rowIndex`] }, eager],
    },
  ],
  [
    `follower write`,
    { ...base, need: `follower-write`, collections: [eager, eager] },
  ],
  [
    `takeover`,
    { ...base, lifecycle: `takeover`, collections: [eager, managed] },
  ],
  [`restart`, { ...base, lifecycle: `restart`, collections: [eager, eager] }],
  [
    `close while terms wait`,
    {
      ...base,
      lifecycle: `dispose-while-waiting`,
      collections: [eager, eager],
    },
  ],
]
