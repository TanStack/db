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
 * - (e) Budget. Each adapter reads each Collection's registry row once (a
 *   Browser tab has its own; Electron renderers share their main process's),
 *   and each tab reads an eager Collection's rows once. An eager Collection takes two startup snapshots: its metadata
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
 * History grammar: a database whose setup is complete, lacks a column an
 * older release did not add, or lacks a database index; 1 to 4 Collections,
 * each eager (local rows) or managed
 * (an on-demand source with a cache generation claim), each with complete
 * setup or any subset of its seven derived setup facts removed, and an eager
 * one optionally reopened with a new schema version. A lock grant 1, 2, or 5
 * tasks after the request; each SQL statement immediate or one task late
 * (where the host controls latency). At most one need: a local write while
 * another startup read is held, a local write held in flight when a second
 * Collection's lock is granted (that write is queued work at the grant, so
 * the second term follows it), or a follower tab's write. At most one
 * lifecycle event: a follower tab takes over after the leader tab closes
 * (optionally while one of its reads is held, so every takeover grant meets
 * a queued read), a managed source starts a scoped recovery that rotates its
 * cache generation, the first Collection restarts, or the tab closes while
 * its terms still wait. A managed schema change resets its generation in
 * place; it does not rotate it.
 * A second tab opens after the first is ready, so the first tab's reload is
 * observed alone. Excluded: dropped row tables.
 *
 * Production drivers: each host supplies a real persistence, coordinator,
 * and database, a statement recorder, and latency control. The Node Browser
 * driver, the Electron renderer driver, and the Chromium OPFS page all run
 * this loop and this comparison. The recorder keeps every statement in order
 * with its parameters, so a missing, repeated, or reordered statement stays
 * visible.
 *
 * Not owned here: whether the barrier waits for regular work that is queued
 * but not yet running. Regular work that is running is already ordered
 * before a term by the driver's transaction order and the writer lock, so no
 * reload history separates that case deterministically; the shared logical
 * scheduling oracle owns it at the scheduler.
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

/** Database setup an older release or an outside tool left incomplete. */
export type DatabaseDamage = `none` | `migrated-column` | `database-index`

export type ReloadHistory = {
  collections: ReadonlyArray<CollectionHistory>
  databaseDamage: DatabaseDamage
  grantTasks: 1 | 2 | 5
  statementLatency: 0 | 1
  need: `none` | `local-write` | `write-queued-at-grant` | `follower-write`
  lifecycle:
    | `none`
    | `takeover`
    | `takeover-while-read-held`
    | `rotate`
    | `restart`
    | `dispose-while-waiting`
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

/** A held adapter call: held at its first call, before any SQL. */
export type HeldCall = {
  isHeld: () => boolean
  release: () => void
  restore: () => void
}

/**
 * Hold seams at the adapter boundary. They must patch the adapter in the
 * process that runs it: in process for Browser tabs, in the main process for
 * a real Electron app.
 */
export type ReloadSeams = {
  holdFirstRowSnapshot: (storageId: string) => HeldCall
  holdFirstWrite: (storageId: string) => HeldCall
}

/** What a production driver supplies. Everything else is shared. */
export type ReloadHost = {
  seams: ReloadSeams
  /** Whether `statementLatency` reaches the database. */
  controlsLatency: boolean
  /**
   * Whether each tab has its own adapter. Electron renderers share their
   * main process's adapter, so a second renderer reuses its setup reads.
   */
  adapterPerTab: boolean
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
  adapterPerTab: boolean
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
  /** Takeover grants, and follower terms, while the follower's read waits. */
  grantsWhileFollowerReadHeld: number
  termsWhileFollowerReadHeld: number
  /** The rotated Collection's new physical ID. */
  rotatedStorageId: string | undefined
  /** Whether the gated grant arrived while the queued write was held. */
  grantedWhileWriteHeld: boolean | undefined
  factsPresent: Record<string, boolean>
  storedRow: Record<string, boolean>
  databaseFactsPresent: boolean
}

type Row = { id: string; title: string }

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Premise helper with a 15 s bound. Its condition is the premise.
async function waitFor(condition: () => boolean, label: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (condition()) return
    await nextTask()
  }
  throw new Error(`timed out waiting for ${label}`)
}

/**
 * Keeps a hold for as long as a wrong term would need to appear: until one
 * does, or 500 ms pass. A correct barrier writes none during the hold, so it
 * always waits the full bound; the term-ahead mutants are rejected on both
 * drivers within it.
 */
async function holdUntilTermOrElapsed(
  termAppeared: () => boolean,
  boundMs = 500,
) {
  const deadline = Date.now() + boundMs
  while (Date.now() < deadline && !termAppeared()) await nextTask()
}

type RecoveryCapability = { startScopedRecovery?: () => Promise<void> }

function openCollections(
  persistence: PersistedCollectionPersistence,
  history: ReloadHistory,
  ids: ReadonlyArray<string>,
  schemaVersionFor: (index: number) => number,
  // A managed source's persistence capability, as Electric's source uses it.
  capabilities: Map<number, RecoveryCapability> = new Map(),
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
      sync: (params) => {
        const metadata = params.metadata as
          { persistence?: RecoveryCapability } | undefined
        if (metadata?.persistence) {
          capabilities.set(index, metadata.persistence)
        }
        params.markReady()
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
        schemaVersion: schemaVersionFor(index),
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
  onGrant: (storageId: string) => void,
  gateFor: (storageId: string) => Promise<void> | undefined = () => undefined,
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
    const prefix = `tsdb:leader:${dbName}:`
    const granted: LockGrantedCallback<unknown> = async (lock) => {
      if (name.startsWith(prefix)) {
        const storageId = name.slice(prefix.length)
        for (let task = 0; task < tasks; task++) await nextTask()
        await gateFor(storageId)
        onGrant(storageId)
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
function holdFirstRowSnapshot(storageId: string): HeldCall {
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

type HeldWriteSeam = {
  applyCommittedTxUnscheduled: (
    target: Parameters<typeof resolvePersistedStorageTarget>[0],
    ...rest: Array<unknown>
  ) => Promise<unknown>
}

/**
 * Holds one Collection's first committed write at its first adapter call,
 * inside its scheduler turn and writer lock, before any SQL.
 */
function holdFirstWrite(storageId: string): HeldCall {
  const seam =
    SQLiteCorePersistenceAdapter.prototype as unknown as HeldWriteSeam
  const original = seam.applyCommittedTxUnscheduled
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const state = { held: false, used: false }
  seam.applyCommittedTxUnscheduled = async function (
    this: HeldWriteSeam,
    target,
    ...rest
  ) {
    if (
      !state.used &&
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
      seam.applyCommittedTxUnscheduled = original
    },
  }
}

/** Seams for a host whose adapter runs in this JavaScript context. */
export const inProcessSeams: ReloadSeams = {
  holdFirstRowSnapshot,
  holdFirstWrite,
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
    if (history.databaseDamage === `migrated-column`) {
      await host.rawExec(
        `ALTER TABLE applied_tx DROP COLUMN replay_requires_full_reload`,
      )
    }
    if (history.databaseDamage === `database-index`) {
      await host.rawExec(`DROP INDEX cache_generation_head`)
    }

    // Reload: the first tab alone, with a recorder and the history's seams.
    const log: Array<Logged> = []
    let termDuringHold: boolean | undefined
    let needSettled: boolean | undefined
    let followerLeadsAll: boolean | undefined
    let rotatedStorageId: string | undefined
    host.record((sql, params) =>
      log.push({ sql: sql.replace(/\s+/g, ` `).trim(), params }),
    )
    cleanups.push(() => host.record(null))
    if (host.controlsLatency) host.setStatementLatency(history.statementLatency)
    cleanups.push(() => host.setStatementLatency(0))
    let preloadsCalled = false
    let preloadsCalledAtEveryGrant = true
    let followerHold: HeldCall | undefined
    let grantsWhileFollowerReadHeld = 0
    let termsWhileFollowerReadHeld = 0
    // A write queued at a grant: the second eager Collection's grant waits
    // until the first one's write is held in flight.
    const queuedWrite =
      history.need === `write-queued-at-grant`
        ? {
            writer: ids[0]!,
            gated:
              ids[
                history.collections.findIndex(
                  (c, index) => index > 0 && c.kind === `eager`,
                )
              ]!,
            hold: host.seams.holdFirstWrite(ids[0]!),
          }
        : undefined
    if (queuedWrite) cleanups.push(queuedWrite.hold.restore)
    let openGate!: () => void
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    cleanups.push(() => openGate())
    let grantedWhileWriteHeld: boolean | undefined
    cleanups.push(
      delayLeaderGrants(
        dbName,
        history.grantTasks,
        (storageId) => {
          preloadsCalledAtEveryGrant &&= preloadsCalled
          if (followerHold?.isHeld()) grantsWhileFollowerReadHeld++
          // Only the first tab's grant meets the queued write; a later
          // takeover grant for the same Collection does not.
          if (storageId === queuedWrite?.gated) {
            grantedWhileWriteHeld ??= queuedWrite.hold.isHeld()
          }
        },
        (storageId) => (storageId === queuedWrite?.gated ? gate : undefined),
      ),
    )
    const heldId = heldCollection(history)
    const hold =
      heldId === undefined
        ? undefined
        : host.seams.holdFirstRowSnapshot(ids[heldId]!)
    if (hold) cleanups.push(hold.restore)

    const leader = await host.openTab(dbName)
    const leaderCapabilities = new Map<number, RecoveryCapability>()
    const leaderCollections = openCollections(
      leader.persistence,
      history,
      ids,
      (index) => (history.collections[index]!.schemaChange ? 2 : 1),
      leaderCapabilities,
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
      await holdUntilTermOrElapsed(
        () => log.some((entry) => isTermFor(entry, writer)),
        2_000,
      )
      termDuringHold =
        hold.isHeld() && log.some((entry) => isTermFor(entry, writer))
      hold.release()
      await write
      needSettled = true
    }
    if (queuedWrite) {
      await preloads[0]
      await waitFor(
        () => leader.isLeader(queuedWrite.writer),
        `writer leadership`,
      )
      const write = leaderCollections[0]!.insert({ id: `local`, title: `l` })
        .isPersisted.promise
      await waitFor(queuedWrite.hold.isHeld, `held queued write`)
      openGate()
      await waitFor(
        () => grantedWhileWriteHeld !== undefined,
        `gated grant during the held write`,
      )
      await holdUntilTermOrElapsed(() =>
        log.some((entry) => isTermFor(entry, queuedWrite.gated)),
      )
      queuedWrite.hold.release()
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
    // A managed source starts a scoped recovery, which rotates its cache
    // generation and subscribes again under the new physical ID.
    const rotated = rotatedCollection(history)
    if (rotated !== undefined) {
      await waitFor(
        () => leaderCapabilities.has(rotated),
        `managed persistence capability`,
      )
      await leaderCapabilities.get(rotated)!.startScopedRecovery?.()
      const heads = await host.rawQuery(
        `SELECT physical_id FROM cache_generation
         WHERE logical_id = ? AND retired = 0`,
        [ids[rotated]!],
      )
      rotatedStorageId = heads[0]?.physical_id as string | undefined
      await waitFor(
        () =>
          rotatedStorageId !== undefined && leader.isLeader(rotatedStorageId),
        `rotated generation leader`,
      ).catch(() => undefined) // the comparison reports a missing term
    }
    const reloadLog = [...log]

    // A second tab opens after the first is ready, as a follower.
    if (
      history.need === `follower-write` ||
      history.lifecycle === `takeover` ||
      history.lifecycle === `takeover-while-read-held`
    ) {
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
      if (history.lifecycle === `takeover-while-read-held`) {
        // The follower restarts its first eager Collection and holds that
        // read, so every takeover grant arrives while a read is queued.
        const restarted = history.collections.findIndex(
          (c) => c.kind === `eager`,
        )
        followerHold = host.seams.holdFirstRowSnapshot(
          storageIds[ids[restarted]!]!,
        )
        cleanups.push(followerHold.restore)
        await followerCollections[restarted]!.cleanup()
        const restart = followerCollections[restarted]!.preload()
        await waitFor(followerHold.isHeld, `held follower read`)
        const termsBefore = log.length
        leaderOpen = false
        await closeTab(leader, leaderCollections)
        await waitFor(
          () => grantsWhileFollowerReadHeld >= ids.length,
          `takeover grants while the follower read is held`,
        ).catch(() => undefined)
        await holdUntilTermOrElapsed(() =>
          log
            .slice(termsBefore)
            .some((entry) =>
              ids.some((id) => isTermFor(entry, storageIds[id]!)),
            ),
        )
        termsWhileFollowerReadHeld = log
          .slice(termsBefore)
          .filter((entry) =>
            ids.some((id) => isTermFor(entry, storageIds[id]!)),
          ).length
        followerHold.release()
        await restart
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
        // A rotated Collection's setup facts belong to its new generation.
        factsPresent[id] = await setupFactsPresent(
          host,
          index === rotatedCollection(history) && rotatedStorageId
            ? rotatedStorageId
            : storageId,
        )
        if (history.collections[index]!.kind === `eager`) {
          const rows = await host.rawQuery(
            `SELECT 1 AS found FROM "${createPersistedTableName(storageId, `c`)}" WHERE key = ?`,
            [`s:row`],
          )
          storedRow[id] = rows.length > 0
        }
      }
      const migrated = await host.rawQuery(
        `SELECT 1 AS found FROM sqlite_master
         WHERE name = 'applied_tx' AND sql LIKE '%replay_requires_full_reload%'`,
      )
      const headIndex = await host.rawQuery(
        `SELECT 1 AS found FROM sqlite_master WHERE name = 'cache_generation_head'`,
      )
      return {
        databaseFactsPresent: migrated.length > 0 && headIndex.length > 0,
        adapterPerTab: host.adapterPerTab,
        ids,
        storageIds,
        reloadLog,
        log: [...log],
        preloadsCalledAtEveryGrant,
        termDuringHold,
        needSettled,
        followerLeadsAll,
        grantsWhileFollowerReadHeld,
        termsWhileFollowerReadHeld,
        grantedWhileWriteHeld,
        rotatedStorageId,
        factsPresent,
        storedRow,
      }
    }
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
}

/** The rotated Collection: the first managed one, when the history rotates. */
function rotatedCollection(history: ReloadHistory): number | undefined {
  if (history.lifecycle !== `rotate`) return undefined
  const index = history.collections.findIndex((c) => c.kind === `managed`)
  return index === -1 ? undefined : index
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
  // Connection settings such as journal_mode are per connection, not schema.
  if (/^PRAGMA table_info/.test(entry.sql)) return true
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

export function expectedReload(
  history: ReloadHistory,
  topology: { adapterPerTab: boolean } = { adapterPerTab: true },
): {
  collections: Array<ExpectedCollection>
  tabs: number
  writerExemptFromOrder: number | undefined
} {
  const heldTakeover = history.lifecycle === `takeover-while-read-held`
  const secondTab =
    history.need === `follower-write` ||
    history.lifecycle === `takeover` ||
    heldTakeover
  const followerRestarts = heldTakeover
    ? history.collections.findIndex((c) => c.kind === `eager`)
    : -1
  const disposed = history.lifecycle === `dispose-while-waiting`
  const tabs = secondTab ? 2 : 1
  const held = heldCollection(history)
  return {
    tabs,
    writerExemptFromOrder:
      history.need === `local-write` || history.need === `write-queued-at-grant`
        ? 0
        : undefined,
    collections: history.collections.map((collection, index) => {
      // A restart reads again; so does the follower's restart before takeover.
      const restarted =
        (history.lifecycle === `restart` && index === 0) ||
        index === followerRestarts
      const eager = collection.kind === `eager`
      // Setup and a schema reset happen at a Collection's first read. A tab
      // closed during the held read may never reach the reads queued behind
      // it: the held one, later eager ones, and every managed one, whose
      // read follows its claim.
      const tabsOnThisGeneration =
        index === rotatedCollection(history) ? 1 : tabs
      const neverRead =
        disposed &&
        (index >= (held ?? Infinity) || collection.kind === `managed`)
      return {
        setupRuns: neverRead ? undefined : collection.missing.length > 0,
        storedRow: eager && !neverRead ? !collection.schemaChange : undefined,
        // Each tab's adapter reads the registry once; a restart reuses it.
        // A held first snapshot reads it after the hold, so a tab closed
        // during the hold may never read it.
        // A rotated generation's old ID is read only by the first tab; a
        // later tab opens on the new generation.
        registryReads: neverRead
          ? undefined
          : topology.adapterPerTab
            ? tabsOnThisGeneration
            : 1,
        // Each tab reads an eager Collection's rows once; a restart rereads.
        rowScans: eager && !disposed ? tabs + (restarted ? 1 : 0) : undefined,
        // A held snapshot may or may not run after its tab closes.
        snapshots: disposed
          ? undefined
          : (eager ? 2 : 1) * (tabsOnThisGeneration + (restarted ? 1 : 0)),
        terms: disposed
          ? 0
          : 1 +
            (history.lifecycle === `takeover` || heldTakeover ? 1 : 0) +
            (history.lifecycle === `restart` && index === 0 ? 1 : 0),
      }
    }),
  }
}

export function reloadViolations(
  history: ReloadHistory,
  observed: ReloadObservation,
): Array<string> {
  const violations: Array<string> = []
  const expected = expectedReload(history, observed)
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
  // (b) order: a write queued at a grant precedes that grant's term
  if (history.need === `write-queued-at-grant`) {
    const gatedIndex = history.collections.findIndex(
      (c, index) => index > 0 && c.kind === `eager`,
    )
    const gated = storageIds[ids[gatedIndex]!]!
    const writer = storageIds[ids[0]!]!
    if (observed.grantedWhileWriteHeld !== true) {
      violations.push(`premise: the gated grant did not meet the queued write`)
    }
    const write = log.findIndex(
      (e) =>
        e.sql.startsWith(
          `INSERT INTO "${createPersistedTableName(writer, `c`)}"`,
        ) && e.params.includes(`s:local`),
    )
    const term = log.findIndex((e) => isTermFor(e, gated))
    if (write === -1 || term === -1 || term < write) {
      violations.push(
        `${ids[gatedIndex]} term before the write queued at its grant`,
      )
    }
  }
  // A rotated generation is registered fresh and elected once, after it
  // exists; the retired generation is not elected again.
  const rotated = rotatedCollection(history)
  if (rotated !== undefined) {
    const id = ids[rotated]!
    const next = observed.rotatedStorageId
    if (next === undefined || next === storageIds[id]) {
      violations.push(`${id}: no rotated generation`)
    } else {
      const created = log.findIndex(
        (e) =>
          e.sql.startsWith(`INSERT INTO cache_generation (`) &&
          e.params.includes(next),
      )
      const terms = log.flatMap((e, at) => (isTermFor(e, next) ? [at] : []))
      if (terms.length !== 1) {
        violations.push(
          `${id}: ${terms.length} terms for the rotated generation`,
        )
      }
      if (created === -1 || terms.some((at) => at < created)) {
        violations.push(`${id}: rotated term before its generation existed`)
      }
      const registry = count(log, (e) => isRegistryReadFor(e, next))
      if (registry < 1 || registry > 2 * expected.tabs) {
        violations.push(`${id}: ${registry} rotated registry reads`)
      }
    }
  }
  // (c) need
  if (history.need === `local-write` && observed.termDuringHold !== true) {
    violations.push(`${ids[0]}: no term while another startup read was held`)
  }
  if (history.need !== `none` && observed.needSettled !== true) {
    violations.push(`the leader need did not settle`)
  }
  if (
    (history.lifecycle === `takeover` ||
      history.lifecycle === `takeover-while-read-held`) &&
    observed.followerLeadsAll !== true
  ) {
    violations.push(`the follower did not take over`)
  }
  // (b) order at takeover: no follower term while its queued read waits
  if (history.lifecycle === `takeover-while-read-held`) {
    if (observed.grantsWhileFollowerReadHeld === 0) {
      violations.push(
        `premise: no takeover grant while the follower read waited`,
      )
    }
    if (observed.termsWhileFollowerReadHeld !== 0) {
      violations.push(
        `${observed.termsWhileFollowerReadHeld} follower terms while its queued read waited`,
      )
    }
  }
  // (a, e) database setup repairs damage and is otherwise skipped
  const databaseSetup = count(log, isDatabaseSetupStatement)
  if (history.databaseDamage === `none` && databaseSetup !== 0) {
    violations.push(`${databaseSetup} database setup statements`)
  }
  if (history.databaseDamage !== `none` && databaseSetup === 0) {
    violations.push(`damaged database setup was not repaired`)
  }
  if (!observed.databaseFactsPresent) {
    violations.push(`database setup facts missing`)
  }
  return violations
}

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

const collectionArb: fc.Arbitrary<CollectionHistory> = fc.record({
  kind: fc.constantFrom(`eager` as const, `managed` as const),
  missing: fc.subarray([...derivedFacts]),
  schemaChange: fc.boolean(),
})

/** Repairs a generated history so its need and lifecycle have a target. */
function legal(history: ReloadHistory): ReloadHistory {
  const eager = history.collections.filter((c) => c.kind === `eager`).length
  const firstEager = history.collections[0]?.kind === `eager`
  let { need, lifecycle } = history
  // A local write needs an eager writer first and another eager read held.
  if (need === `local-write` && !(firstEager && eager >= 2)) need = `none`
  if (need === `follower-write` && eager === 0) need = `none`
  if (need === `write-queued-at-grant` && !(firstEager && eager >= 2))
    need = `none`
  if (lifecycle === `restart` && !firstEager) lifecycle = `none`
  if (lifecycle === `dispose-while-waiting` && (eager === 0 || need !== `none`))
    lifecycle = `none`
  if (
    (lifecycle === `takeover` || lifecycle === `takeover-while-read-held`) &&
    need === `local-write`
  )
    lifecycle = `none`
  if (lifecycle === `takeover-while-read-held` && eager === 0)
    lifecycle = `none`
  const managed = history.collections.length - eager
  if (lifecycle === `rotate` && managed === 0) lifecycle = `none`
  return { ...history, need, lifecycle }
}

export const reloadHistoryArb: fc.Arbitrary<ReloadHistory> = fc
  .record({
    collections: fc.array(collectionArb, { minLength: 1, maxLength: 4 }),
    databaseDamage: fc.constantFrom(
      `none` as const,
      `none` as const,
      `migrated-column` as const,
      `database-index` as const,
    ),
    grantTasks: fc.constantFrom(1 as const, 2 as const, 5 as const),
    statementLatency: fc.constantFrom(0 as const, 1 as const),
    need: fc.constantFrom(
      `none` as const,
      `local-write` as const,
      `write-queued-at-grant` as const,
      `follower-write` as const,
    ),
    lifecycle: fc.constantFrom(
      `none` as const,
      `takeover` as const,
      `takeover-while-read-held` as const,
      `rotate` as const,
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
  databaseDamage: `none`,
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
    `database from an older release`,
    { ...base, databaseDamage: `migrated-column`, collections: [eager] },
  ],
  [
    `database index missing`,
    {
      ...base,
      databaseDamage: `database-index`,
      collections: [managed, eager],
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
    `write queued at another grant`,
    {
      ...base,
      need: `write-queued-at-grant`,
      collections: [eager, managed, eager],
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
  [
    `takeover while a follower read is held`,
    {
      ...base,
      lifecycle: `takeover-while-read-held`,
      collections: [eager, managed, eager],
    },
  ],
  [
    `managed schema change`,
    { ...base, collections: [{ ...managed, schemaChange: true }, eager] },
  ],
  [
    `generation rotation`,
    { ...base, lifecycle: `rotate`, collections: [eager, managed] },
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
