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
 *   need is live in that election: one that is still waiting at the grant,
 *   or one that arises before the term. A need that an earlier election
 *   served, in this tab or another, exempts no later election. Every
 *   Collection is preloaded in one task, and a lock manager grants on a later
 *   task, so at every grant each eager Collection's startup row read and each
 *   managed Collection's cache claim are queued. A managed Collection
 *   requests its lock only after its claim, so its own startup metadata read
 *   is queued at its grant too.
 * - (c) Need. A live need ends that wait. A local write during another
 *   startup read gets its Collection's term and settles, whether it began
 *   before or after the grant. A follower's or another tab's write settles
 *   through the leader. A takeover's queued work never waits on the departed
 *   leader: a source commit that a follower's queued read flushes after the
 *   grant settles in less than one RPC timeout, and one that the departed
 *   leader received but never answered settles within one RPC timeout and its
 *   retry.
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
 * another startup read is held, issued after its Collection's grant or
 * before it (the grant waits until the write is issued), a local write held
 * in flight when a second Collection's lock is granted (that write is queued
 * work at the grant, so the second term follows it), a follower tab's write
 * to the last eager Collection, or a write from a third tab that opens,
 * writes the last eager Collection, and closes while the first tab leads.
 * Both later writes reach every tab, so a follower sees another tab's need
 * long before its own election. At most one lifecycle event: a follower tab
 * takes over after the leader tab closes, optionally while its restarted
 * first eager Collection's read is held, so every takeover grant meets a
 * queued read; a follower that knows its leader's route takes over while
 * its live query's subset read on
 * a managed Collection is held with a source commit queued behind it, which
 * that read flushes after the grant; the same, but the read flushes the
 * commit to the leader, which receives it and closes without an answer; a
 * managed source starts a scoped recovery that rotates its cache
 * generation; the first Collection restarts; or the tab closes while its
 * terms still wait. A managed schema change resets its generation in place;
 * it does not rotate it.
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
 * when the writer's term is observed. A write issued before its grant
 * records, at the grant, that it was issued. A queued source commit records
 * that a takeover grant arrived while its read was held; an unanswered one
 * records that the departed leader held it when that leader closed.
 */
import fc from 'fast-check'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
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
  need:
    | `none`
    | `local-write`
    | `local-write-before-grant`
    | `write-queued-at-grant`
    | `follower-write`
    | `bystander-write`
  lifecycle:
    | `none`
    | `takeover`
    | `takeover-while-read-held`
    | `takeover-with-commit-queued`
    | `takeover-with-commit-unanswered`
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
  uninstall: () => void
}

/**
 * Hold seams at the adapter boundary. They must patch the adapter in the
 * process that runs it: in process for Browser tabs, in the main process for
 * a real Electron app.
 */
export type ReloadSeams = {
  holdFirstRowSnapshot: (storageId: string) => HeldCall
  holdFirstWrite: (storageId: string) => HeldCall
  holdFirstSubsetLoad: (storageId: string) => HeldCall
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
  /** Whether the local write was issued when its gated grant arrived. */
  writeIssuedAtGrant: boolean | undefined
  /** Whether the departed leader held the source commit when it closed. */
  leaderHeldCommitAtClose: boolean | undefined
  /**
   * Milliseconds from the release of the follower's held read until the
   * follower led every Collection and the source commit was durable, or
   * undefined if that did not happen within the bound.
   */
  sourceCommitSettledMs: number | undefined
  factsPresent: Record<string, boolean>
  storedRow: Record<string, boolean>
  databaseFactsPresent: boolean
}

type Row = { id: string; title: string }

/**
 * Settlement bounds for a takeover's source commit. One RPC timeout is 10 s
 * and a request makes three attempts 200 and 400 ms apart. A commit flushed
 * after the grant has a live route, so it owes less than one timeout. A
 * commit the departed leader received owes one timeout and a retry, about
 * 10.2 s; a design whose retry also goes to the departed leader needs at
 * least 20.4 s.
 */
const COMMIT_QUEUED_BOUND_MS = 5_000
const COMMIT_UNANSWERED_BOUND_MS = 15_000

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
 * Polls an asynchronous condition every 20 ms. Returns the elapsed
 * milliseconds once it holds, or undefined after `boundMs`, so a comparison
 * can report a stall instead of timing out.
 */
async function settledWithin(
  condition: () => Promise<boolean>,
  boundMs: number,
): Promise<number | undefined> {
  const start = Date.now()
  while (Date.now() - start < boundMs) {
    if (await condition()) return Date.now() - start
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return undefined
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

/** A managed source's own sync controls, as a source commits a change. */
type SourceControls = Pick<
  Parameters<SyncConfig<Row, string>[`sync`]>[0],
  `begin` | `write` | `commit`
>

function openCollections(
  persistence: PersistedCollectionPersistence,
  history: ReloadHistory,
  ids: ReadonlyArray<string>,
  schemaVersionFor: (index: number) => number,
  // A managed source's persistence capability, as Electric's source uses it.
  capabilities: Map<number, RecoveryCapability> = new Map(),
  sources: Map<number, SourceControls> = new Map(),
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
        sources.set(index, params)
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

type StorageTarget = Parameters<typeof resolvePersistedStorageTarget>[0]
type AdapterSeam = Record<
  string,
  (this: unknown, target: StorageTarget, ...rest: Array<unknown>) => unknown
>

/**
 * Holds one adapter method's first matching call at its first adapter call,
 * before any SQL, inside whatever scheduler turn and writer lock its caller
 * holds.
 */
function holdFirstCall(
  method: string,
  matches: (storageId: string, rest: Array<unknown>) => boolean,
): HeldCall {
  const seam = SQLiteCorePersistenceAdapter.prototype as unknown as AdapterSeam
  const original = seam[method]!
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const state = { held: false, used: false }
  seam[method] = async function (target, ...rest) {
    if (
      !state.used &&
      matches(resolvePersistedStorageTarget(target).collectionId, rest)
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
    uninstall: () => {
      release()
      seam[method] = original
    },
  }
}

/** Seams for a host whose adapter runs in this JavaScript context. */
export const inProcessSeams: ReloadSeams = {
  // A Collection's first row snapshot holds that tab's shared scheduler, as
  // a long queued read does, but not the database, so an unscheduled term
  // write can still run.
  holdFirstRowSnapshot: (storageId) =>
    holdFirstCall(
      `loadResumeSnapshotUnscheduled`,
      (id, rest) =>
        id === storageId &&
        (rest[0] as { includeRows?: boolean } | undefined)?.includeRows !==
          false,
    ),
  // A Collection's first committed write, inside its writer lock.
  holdFirstWrite: (storageId) =>
    holdFirstCall(`applyCommittedTxUnscheduled`, (id) => id === storageId),
  // A Collection's first subset read, inside its tab's hydration scope.
  holdFirstSubsetLoad: (storageId) =>
    holdFirstCall(`loadSubsetUnscheduled`, (id) => id === storageId),
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
      await collection
        .insert({ id: `row`, title: collection.id })
        .when(`settled`)
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
    let leaderHeldCommitAtClose: boolean | undefined
    let sourceCommitSettledMs: number | undefined
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
    if (queuedWrite) cleanups.push(queuedWrite.hold.uninstall)
    let openGate!: () => void
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    cleanups.push(() => openGate())
    let grantedWhileWriteHeld: boolean | undefined
    // A local write issued before its grant: the writer's first grant waits
    // until the write is issued.
    const writeBeforeGrant = history.need === `local-write-before-grant`
    let writeIssued = false
    let writeIssuedAtGrant: boolean | undefined
    const gated = queuedWrite?.gated ?? (writeBeforeGrant ? ids[0] : undefined)
    cleanups.push(
      delayLeaderGrants(
        dbName,
        history.grantTasks,
        (storageId) => {
          preloadsCalledAtEveryGrant &&= preloadsCalled
          if (followerHold?.isHeld()) grantsWhileFollowerReadHeld++
          // Only the first tab's grant meets the gate; a later takeover
          // grant for the same Collection does not.
          if (storageId === queuedWrite?.gated) {
            grantedWhileWriteHeld ??= queuedWrite.hold.isHeld()
          }
          if (writeBeforeGrant && storageId === ids[0]) {
            writeIssuedAtGrant ??= writeIssued
          }
        },
        (storageId) => (storageId === gated ? gate : undefined),
      ),
    )
    const heldId = heldCollection(history)
    const hold =
      heldId === undefined
        ? undefined
        : host.seams.holdFirstRowSnapshot(ids[heldId]!)
    if (hold) cleanups.push(hold.uninstall)

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

    if ((history.need === `local-write` || writeBeforeGrant) && hold) {
      await waitFor(hold.isHeld, `held startup read`)
      await preloads[0]
      const write = leaderCollections[0]!
        .insert({ id: `local`, title: `l` })
        .when(`settled`)
      writeIssued = true
      // The write asks for its route within a few tasks; then it is granted.
      for (let task = 0; task < 5; task++) await nextTask()
      openGate()
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
      const write = leaderCollections[0]!
        .insert({ id: `local`, title: `l` })
        .when(`settled`)
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
    if (followerOpens(history)) {
      const follower = await host.openTab(dbName)
      const followerSources = new Map<number, SourceControls>()
      const followerCollections = openCollections(
        follower.persistence,
        history,
        ids,
        (index) => (history.collections[index]!.schemaChange ? 2 : 1),
        new Map(),
        followerSources,
      )
      let followerOpen = true
      cleanups.push(async () => {
        if (followerOpen) await closeTab(follower, followerCollections)
        else {
          for (const collection of followerCollections) {
            await collection.cleanup().catch(() => undefined)
          }
        }
      })
      await Promise.all(
        followerCollections.map((collection) => collection.preload()),
      )
      const lastEager = history.collections
        .flatMap((collection, index) =>
          collection.kind === `eager` ? [index] : [],
        )
        .at(-1)!
      if (history.need === `follower-write`) {
        await followerCollections[lastEager]!.insert({
          id: `f`,
          title: `f`,
        }).when(`settled`)
        needSettled = true
      }
      if (history.need === `bystander-write`) {
        // A third tab comes and goes while the first tab leads. Its request
        // reaches the follower too.
        const bystander = await host.openTab(dbName)
        const bystanderCollections = openCollections(
          bystander.persistence,
          history,
          ids,
          (index) => (history.collections[index]!.schemaChange ? 2 : 1),
        )
        await Promise.all(
          bystanderCollections.map((collection) => collection.preload()),
        )
        await bystanderCollections[lastEager]!.insert({
          id: `b`,
          title: `b`,
        }).when(`settled`)
        await closeTab(bystander, bystanderCollections)
        needSettled = true
      }
      const followerLeads = () =>
        ids.every((id) => follower.isLeader(storageIds[id]!))
      /**
       * Closes the leader tab while `held` keeps a follower read queued,
       * counts the follower terms written while it stays held, then releases
       * it.
       */
      const takeOverWhileHeld = async (held: HeldCall) => {
        followerHold = held
        const termsBefore = log.length
        const followerTerms = () =>
          log
            .slice(termsBefore)
            .filter((entry) =>
              ids.some((id) => isTermFor(entry, storageIds[id]!)),
            ).length
        leaderOpen = false
        await closeTab(leader, leaderCollections)
        await waitFor(
          () => grantsWhileFollowerReadHeld >= ids.length,
          `takeover grants while the follower read is held`,
        ).catch(() => undefined)
        await holdUntilTermOrElapsed(() => followerTerms() > 0)
        termsWhileFollowerReadHeld = followerTerms()
        held.release()
      }
      if (history.lifecycle === `takeover`) {
        leaderOpen = false
        await closeTab(leader, leaderCollections)
        await waitFor(followerLeads, `follower takeover`)
        followerLeadsAll = true
      }
      if (history.lifecycle === `takeover-while-read-held`) {
        // The follower restarts its first eager Collection and holds that
        // read, so every takeover grant arrives while a read is queued.
        const restarted = history.collections.findIndex(
          (c) => c.kind === `eager`,
        )
        const held = host.seams.holdFirstRowSnapshot(
          storageIds[ids[restarted]!]!,
        )
        cleanups.push(held.uninstall)
        await followerCollections[restarted]!.cleanup()
        const restart = followerCollections[restarted]!.preload()
        await waitFor(held.isHeld, `held follower read`)
        await takeOverWhileHeld(held)
        await restart
        await waitFor(followerLeads, `follower takeover`)
        followerLeadsAll = true
      }
      if (
        history.lifecycle === `takeover-with-commit-queued` ||
        history.lifecycle === `takeover-with-commit-unanswered`
      ) {
        // The follower's live query reads a subset of its first managed
        // Collection. Its source commits while that read is held, so the
        // commit is queued behind the read and is flushed in its scope.
        const sourced = history.collections.findIndex(
          (c) => c.kind === `managed`,
        )
        const storageId = storageIds[ids[sourced]!]!
        const source = followerSources.get(sourced)!
        const commit = (id: string) => {
          source.begin()
          source.write({ type: `insert`, value: { id, title: id } })
          source.commit()
        }
        const durable = async (id: string) =>
          (
            await host.rawQuery(
              `SELECT 1 AS found FROM "${createPersistedTableName(storageId, `c`)}" WHERE key = ?`,
              [`s:${id}`],
            )
          ).length > 0
        // A long-lived follower knows its leader's route. Its first commit
        // through the leader teaches it, so the departed leader's route is
        // the one the follower holds when the leader closes.
        commit(`warm`)
        if (
          (await settledWithin(() => durable(`warm`), 15_000)) === undefined
        ) {
          throw new Error(`timed out waiting for the follower's first commit`)
        }
        const held = host.seams.holdFirstSubsetLoad(storageId)
        cleanups.push(held.uninstall)
        const query = createLiveQueryCollection({
          query: (q) => q.from({ row: followerCollections[sourced]! }),
        })
        cleanups.push(() => query.cleanup())
        const loaded = query.preload().catch(() => undefined)
        await waitFor(held.isHeld, `held follower subset read`)
        commit(`source`)
        let released: number
        if (history.lifecycle === `takeover-with-commit-queued`) {
          await takeOverWhileHeld(held)
          released = Date.now()
        } else {
          // The leader receives the flushed commit and closes without an
          // answer. Closing a tab releases its locks, so its held write
          // ends with its connection.
          const leaderWrite = host.seams.holdFirstWrite(storageId)
          cleanups.push(leaderWrite.uninstall)
          held.release()
          released = Date.now()
          await waitFor(leaderWrite.isHeld, `leader holding the commit`)
          leaderOpen = false
          await leader.close()
          leaderHeldCommitAtClose = leaderWrite.isHeld()
          leaderWrite.release()
          for (const collection of leaderCollections) {
            await collection.cleanup().catch(() => undefined)
          }
        }
        // A bound past a wrong design's stall, but under the RPC retry
        // budget, so a stalled run is reported, not timed out.
        const bound =
          history.lifecycle === `takeover-with-commit-queued`
            ? COMMIT_QUEUED_BOUND_MS
            : COMMIT_UNANSWERED_BOUND_MS
        const settled = await settledWithin(
          async () => followerLeads() && (await durable(`source`)),
          bound - (Date.now() - released),
        )
        followerLeadsAll = followerLeads()
        if (settled === undefined) {
          // A stalled follower is closed at once, so its pending work ends
          // and the comparison reports the stall.
          followerOpen = false
          await follower.close()
        } else {
          sourceCommitSettledMs = Date.now() - released
        }
        await loaded
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
        writeIssuedAtGrant,
        leaderHeldCommitAtClose,
        sourceCommitSettledMs,
        rotatedStorageId,
        factsPresent,
        storedRow,
      }
    }
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
}

function isTakeover(history: ReloadHistory): boolean {
  return history.lifecycle.startsWith(`takeover`)
}

/** Whether a follower tab opens after the first tab is ready. */
function followerOpens(history: ReloadHistory): boolean {
  return (
    history.need === `follower-write` ||
    history.need === `bystander-write` ||
    isTakeover(history)
  )
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
    history.need !== `local-write-before-grant` &&
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
  // A bystander tab reads every Collection once, as the follower does.
  const tabs =
    1 +
    (followerOpens(history) ? 1 : 0) +
    (history.need === `bystander-write` ? 1 : 0)
  const followerRestarts =
    history.lifecycle === `takeover-while-read-held`
      ? history.collections.findIndex((c) => c.kind === `eager`)
      : -1
  const disposed = history.lifecycle === `dispose-while-waiting`
  const held = heldCollection(history)
  return {
    tabs,
    // The first tab's own write needs its Collection's leader.
    writerExemptFromOrder:
      history.need === `local-write` ||
      history.need === `local-write-before-grant` ||
      history.need === `write-queued-at-grant`
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
        // Each election reserves one term: the first tab's, a takeover's,
        // and a restart's.
        terms: disposed
          ? 0
          : 1 +
            (isTakeover(history) ? 1 : 0) +
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
    // A restart's term follows its own second startup read, even for a
    // Collection that needed a leader before: that need is already served.
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
  if (
    (history.need === `local-write` ||
      history.need === `local-write-before-grant`) &&
    observed.termDuringHold !== true
  ) {
    violations.push(`${ids[0]}: no term while another startup read was held`)
  }
  if (
    history.need === `local-write-before-grant` &&
    observed.writeIssuedAtGrant !== true
  ) {
    violations.push(`premise: the write was not issued before its grant`)
  }
  if (history.need !== `none` && observed.needSettled !== true) {
    violations.push(`the leader need did not settle`)
  }
  if (isTakeover(history) && observed.followerLeadsAll !== true) {
    violations.push(`the follower did not take over`)
  }
  // (c) a takeover's queued work does not wait on the departed leader
  if (
    history.lifecycle === `takeover-with-commit-queued` ||
    history.lifecycle === `takeover-with-commit-unanswered`
  ) {
    if (observed.sourceCommitSettledMs === undefined) {
      violations.push(
        `the follower's queued source commit did not settle within ${
          history.lifecycle === `takeover-with-commit-queued`
            ? COMMIT_QUEUED_BOUND_MS
            : COMMIT_UNANSWERED_BOUND_MS
        } ms of its takeover`,
      )
    }
  }
  if (
    history.lifecycle === `takeover-with-commit-unanswered` &&
    observed.leaderHeldCommitAtClose !== true
  ) {
    violations.push(`premise: the leader did not hold the commit at close`)
  }
  // (b) order at takeover: no follower term while its queued read waits
  if (
    history.lifecycle === `takeover-while-read-held` ||
    history.lifecycle === `takeover-with-commit-queued`
  ) {
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
  if (
    (need === `local-write` || need === `local-write-before-grant`) &&
    !(firstEager && eager >= 2)
  )
    need = `none`
  if ((need === `follower-write` || need === `bystander-write`) && eager === 0)
    need = `none`
  if (need === `write-queued-at-grant` && !(firstEager && eager >= 2))
    need = `none`
  if (lifecycle === `restart` && !firstEager) lifecycle = `none`
  if (lifecycle === `dispose-while-waiting` && (eager === 0 || need !== `none`))
    lifecycle = `none`
  // A takeover follows the first tab's settled reload; a local write keeps
  // one of its reads held until the write's term.
  if (
    lifecycle.startsWith(`takeover`) &&
    (need === `local-write` || need === `local-write-before-grant`)
  )
    lifecycle = `none`
  if (lifecycle === `takeover-while-read-held` && eager === 0)
    lifecycle = `none`
  const managed = history.collections.length - eager
  if (lifecycle === `rotate` && managed === 0) lifecycle = `none`
  if (lifecycle.startsWith(`takeover-with-commit`) && managed === 0)
    lifecycle = `none`
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
      `local-write-before-grant` as const,
      `write-queued-at-grant` as const,
      `follower-write` as const,
      `bystander-write` as const,
    ),
    lifecycle: fc.constantFrom(
      `none` as const,
      `takeover` as const,
      `takeover-while-read-held` as const,
      `takeover-with-commit-queued` as const,
      `takeover-with-commit-unanswered` as const,
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
    `local write before its grant while a read is held`,
    { ...base, need: `local-write-before-grant`, collections: [eager, eager] },
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
    `follower write, then takeover while a read is held`,
    {
      ...base,
      need: `follower-write`,
      lifecycle: `takeover-while-read-held`,
      collections: [eager, eager],
    },
  ],
  [
    `another tab's write, then takeover while a read is held`,
    {
      ...base,
      need: `bystander-write`,
      lifecycle: `takeover-while-read-held`,
      collections: [eager, managed, eager],
    },
  ],
  [
    `takeover with a queued source commit`,
    {
      ...base,
      lifecycle: `takeover-with-commit-queued`,
      collections: [eager, managed],
    },
  ],
  [
    `takeover with a source commit the leader never answered`,
    {
      ...base,
      lifecycle: `takeover-with-commit-unanswered`,
      collections: [managed, eager],
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
    `local write, then restart`,
    {
      ...base,
      need: `local-write`,
      lifecycle: `restart`,
      collections: [eager, eager],
    },
  ],
  [
    `close while terms wait`,
    {
      ...base,
      lifecycle: `dispose-while-waiting`,
      collections: [eager, eager],
    },
  ],
]

declareOracle({ check: [reloadViolations], model: [expectedReload] })
