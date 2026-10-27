/**
 * # Source failure and the health tree
 *
 * A Collection answers two questions on two separate axes:
 *
 * - **Status** says whether the data can be shown. It is decided by the first
 *   load of a sync run. While the sync adapter retries it stays `loading`.
 *   When the sync adapter stops before Collection readiness (`fail`), the
 *   status is `error`: the first load failed, and a later `markReady()` in the
 *   same sync run is a contract violation that throws. When local storage or
 *   an invariant breaks, the status is `crashed`, from any active status and
 *   for good. Only a new sync run leaves `error`.
 * - **The health tree** says whether the data on screen is still kept current.
 *   After Collection readiness, `reportError(error)` sets the Collection's
 *   `failureReason` while the sync adapter keeps trying, `reportHealthy()`
 *   clears it, and `fail()` sets its `error`: the sync adapter stopped. The
 *   status and the rows do not change. A node shows at most one problem, and
 *   nothing clears an `error` within a sync run. Once the adapter called
 *   `fail()`, every later report from it is a contract violation that throws,
 *   and a second `fail()` does nothing.
 *   After a crash, the adapter's status calls do nothing: core ended the
 *   run. Sync data the run commits still applies, as closure keeps accepted
 *   sync obligations.
 *
 * A live query exposes both axes for everything it depends on through
 * `collection.health`: one node for itself and one per source alias in query
 * order, recursing through nested live queries. The tree always has the same
 * shape for a given query. Each node mirrors its Collection at the moment it
 * is read, and the live query emits `health:change` when a node below it
 * changes, so a reader knows to read the tree again. When a status changes,
 * `status:change` fires first and `health:change` follows at once, and the
 * tree is current when either fires. A reader can compare trees with `===`:
 * a node keeps its identity until something in its subtree changes, and a
 * change replaces only the nodes on its path.
 *
 * An include's source node has `kind: 'include'`. A pooled
 * live query shows its source's status and the same tree a live-query
 * Collection over that source would have, so its tree also reaches through
 * a nested live query.
 *
 * The IndexedDB and persistence oracles own the causes of a crash; this
 * oracle drives the transition directly.
 *
 * A live query's own status follows its sources until it is ready: it becomes
 * ready when every Collection is ready, fails its first load when one fails
 * its first load, and crashes when one crashes. After the query has shown
 * data, only a crash changes its status: a query cannot keep serving rows
 * from a Collection that cannot serve reads. Every other source problem stays
 * on the source's node, and the query keeps its status and rows.
 *
 * ## The model
 *
 * The model keeps, for each Collection, its status and its problem after
 * readiness (none, a failure reason, or an error), with a serial for each
 * reported failure. A problem shows its newest failure and lists its frame,
 * oldest first, in `errors` (maintainer decision). The failure reason's
 * frame is every `reportError()` of the sync run since the slot was last
 * clear: `reportHealthy()` empties it, and a reload's new run that reports
 * starts a new one, which its first commit keeps. An error is once per sync
 * run, so its frame is one failure. A live query's request error lists every
 * request failure still open on its node, once per cause, in the order each
 * was shown; a failed replay adds every failed load it was judged on. It
 * also keeps the Collection's rows (key and the tag of
 * the write that produced each), the sync run's open transaction, and
 * whether a reload's replacement is armed. A reload's first transaction
 * replaces every row; until the run begins it, a diffing adapter reads no
 * rows to diff against. A reload that fails before its first commit keeps
 * the rows, and a transaction it began no longer replaces them. A crash ends
 * the status calls, but data the run commits still applies. It derives each
 * live query's gate from its Collections, using only the rules above, and
 * the Effect's state from A: its gate is A's readiness, and a crash, or a
 * failed first load before the gate, ends it. It builds the expected tree
 * and rows from those facts. It does not read production state.
 *
 * The model has three layers, and every grammar in this file uses the same
 * first two. The source layer (`applySourceStep`) is one Collection, as
 * above. The demand layer (see "Demand on an on-demand Collection") is the
 * data a live query asked an on-demand Collection to load, with its loads,
 * replays, and request errors. The projections derive what each grammar
 * observes: the six shapes of the main grammar over two eager Collections,
 * the window of an ordered query over an on-demand Collection, and a lazy
 * join over an eager parent and an on-demand child.
 *
 * ## The history grammar
 *
 * Steps act on Collection `A` or `B`: `ready` writes row 1 during a first
 * load or a reload, commits, and calls `markReady()`; `write` adds row 1, 2,
 * or 3 to the run's open transaction, beginning one if none is open;
 * `commit` commits it; `fail` calls `fail()`; `report` calls `reportError()`;
 * `healthy` calls `reportHealthy()`; `crash` crashes the Collection through
 * its lifecycle, as a crash cause would; `reload` calls `collection.reload()`.
 * A reload keeps the rows, status, and shown problem, and marks the node
 * `reloading`, until the new run's first commit (the next `ready`) replaces
 * the rows and clears the node, or its `fail` shows the new error. A
 * reload of a crashed Collection rejects. `reload-cleanup-fails` reloads while
 * the retired run's cleanup rejects: that breaks the adapter contract, so the
 * Collection crashes and the reload ends with it, unless a reload is already in
 * flight and nothing is retired. `reload-cleanup-held` reloads while the
 * retired run's cleanup stays pending, and `retired-cleanup-rejects` later
 * rejects it: that crashes the Collection too, also after a cleanup and a
 * fresh start, because the adapter broke its contract for that Collection
 * (maintainer decision).
 * `cancel` commits the open transaction (or a
 * new one) with an aborted signal: its writes are gone, and a reload's
 * replacement waits for the run's next transaction. The driver writes like
 * a diffing adapter: an insert for a key missing from the baseline and an
 * update for a key it has. `effect` disposes the Effect over A and creates a
 * new one. `cleanup-hold` starts `cleanup({ dependents: true })` while the
 * adapter's cleanup stays pending, and `cleanup-settle` lets it finish.
 * Cleanup start ends the sync run at once: the rows go, the node drops the
 * run's problems but keeps a failed first load's or a crash's cause while
 * the status shows it, the retired run's calls do nothing, and a reload
 * rejects. The cascade ends the query and an Effect over the Collection,
 * without a source error. After cleanup settles, the status is `cleaned-up`,
 * and a reload starts a fresh sync run. `cleanup-during-reload` reloads while
 * an app listener on the Collection's or the query's `health:change` runs
 * `cleanup({ dependents: true })` at the reload's first announcement (see
 * "Cleanup during a reload"): it is an ordinary cleanup, so the reload ends
 * with its run, and a later fresh start begins from nothing. A crash during cleanup lasts until
 * cleanup settles; a crash after it lasts until the next cleanup. An Effect
 * created while A's cleanup is pending ends with a source error. A query's
 * reload after a cascade starts the query and every cleaned-up Collection it
 * reads; it goes through its inputs in order, and the first that ends its run
 * decides. A Collection still cleaning up crashes it, and such a query reads
 * no Collection, so it announces nothing more and no cascade ends it.
 * Outside the grammar: cleanup of the pooled shape, whose restart is an open
 * question. A history that does not settle within 10 seconds fails. A query whose first load failed stays in `error` until its
 * own reload: `reload-query` calls the observed query's `reload()`, which
 * reloads every Collection below it that shows an error, through a nested
 * live query, and then the query itself. A nested query that a cascade
 * ended is one of those Collections when A shows an error: its own reload
 * reloads A and starts it, also when another source's reload rejects and
 * the outer query does not start. `restart` cleans up the
 * live query and every Collection, then preloads the live query again. Every step
 * is issued in every state. The model predicts its outcome, including a throw
 * for `markReady()` after `fail()`, for any report after `fail()`, and for a
 * report before Collection readiness. Six shapes cross the grammar: a direct Collection, a join, a
 * self-join of one Collection under two aliases, a nested live query, an
 * include child that materializes a Collection per parent row, and a pooled
 * live query over a nested live query.
 *
 * ## The comparison
 *
 * After every step the driver compares, with the model: the query's status,
 * each Collection's rows and tags, the baseline a diffing adapter reads, the
 * query's row count while ready, whether the Effect ended and how often it
 * reported a source error, the full projected health tree, and the thrown
 * error class. Each problem in the tree projects with its listed failures:
 * their messages, their order, and, for a cause the driver reported, which
 * report it is (the same object, by the model's serial); a problem whose
 * `message`, `cause`, and `at` are not its newest failure's projects as a
 * mismatch. A legal `report` or `healthy` that changes the tree announces
 * one `health:change`. An Effect that ends as it is created leaves A's listener count
 * where it was. While a Collection is cleaning up or cleaned up, no sync run
 * of it is live at the adapter (every run it started has had its cleanup
 * called), and a cleanup during a reload leaves that reload settled. It also checks identity: reading twice gives the same tree,
 * and between steps a node is the same object exactly when its expected
 * facts, including problem serials, did not change. At every event it checks
 * that no `health:change` shows a status that `status:change` has not
 * announced, and that each `status:change` is followed at once by
 * `health:change`. When the expected tree changed, the last event must show
 * the current tree. `findProblems` must list, in tree order, exactly the
 * expected nodes with a problem of their own. Request lanes check that a lazy load or a root Collection's
 * load that fails after initial-query readiness is a request error on the query's
 * node, and that it clears. Effect lanes check the Effect's gate, and that a
 * failed load after it still ends the Effect: an Effect has no request errors.
 * The on-demand reload lane checks that a reload of an on-demand Collection
 * keeps a query's rows until the new run reloads its subset.
 *
 * ## Limits
 *
 * The main grammar's Collections are eager, so a live query cannot become
 * ready while a Collection is still loading; a focused lane enumerates an
 * on-demand Collection that fails its first load after the query is ready.
 * The main grammar reaches a cleanup during a reload only from `health:change`
 * and only with `{ dependents: true }`; the lazy grammar's `ending` reaches
 * every notification and also a plain `cleanup()`, but only as a history's
 * last step, and it does not judge the query a plain cleanup leaves.
 * The window grammar settles all pending loads at once, and the lazy grammar
 * settles all, the oldest, or the newest (the overlapping-load lane owns
 * other orders). A demand parked behind a child whose first load failed makes
 * no request, so the model predicts it from law 10 (maintainer decision). Per-row child Collections are not
 * in the tree; an include's node shows its source. Pooled histories do not
 * restart or clean up: a pooled view ends for good when its Collection is
 * cleaned up. The ordering check reads the observed query only, not its
 * Collections. Grammar exclusions are listed with the history grammar.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, describe, expect, it } from 'vitest'
import { createCollection, findProblems } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createEffect } from '../src/query/effect.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import { Query } from '../src/query/builder/index.js'
import { eq, isUndefined, not } from '../src/query/builder/functions.js'
import { include } from '../src/query/builder/include-functions.js'
import {
  CollectionHasSubscribersError,
  CollectionReloadDuringSyncEntryError,
  InvalidCollectionStatusTransitionError,
} from '../src/errors.js'
import { RequestErrors } from '../src/collection/lifecycle.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createDeferred } from '../src/deferred.js'
import { createOracleReach } from './oracle-reach.js'
import { oraclePropertyOptions } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type {
  CollectionStatus,
  HealthNode,
  LoadSubsetOptions,
  SyncConfig,
} from '../src/types.js'

// `tag` names the write that produced a row, so a read shows which write
// (and so which sync run) the row came from.
type Row = { id: number; parentId: number; tag?: number }
type SyncParams = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type SourceName = `A` | `B`
type Shape =
  `direct` | `join` | `self-join` | `nested` | `include` | `pooled-nested`
// A source step that takes no other argument.
type SourceStepKind =
  | `ready`
  | `fail`
  | `report`
  | `healthy`
  | `crash`
  | `reload`
  | `reload-cleanup-fails`
  | `reload-cleanup-held`
  | `retired-cleanup-rejects`
  | `cancel`
type Step =
  | { kind: SourceStepKind; source: SourceName }
  // `write` adds a row to the sync run's open transaction, beginning one if
  // none is open; `commit` commits it (an empty transaction when none is
  // open). The transaction stays open across other steps.
  | { kind: `write`; source: SourceName; key: RowKey; untagged?: boolean }
  | { kind: `commit`; source: SourceName }
  // `direct-write` commits row 1, 2, or 3 in its own transaction begun with
  // `begin({ direct: true })`, as query-db's direct writes do. It is not
  // part of the run's snapshot. It is made only when no transaction is open.
  | { kind: `direct-write`; source: SourceName; key: RowKey }
  // `truncate` calls the adapter's truncate() in the open transaction, which
  // then replaces every row; it stays the adapter's even if a reload ends.
  | { kind: `truncate`; source: SourceName; markReady?: boolean }
  | { kind: `restart` }
  | { kind: `reload-query` }
  // `effect` disposes the Effect over A and creates a new one.
  | { kind: `effect` }
  // `cleanup-hold` starts `cleanup({ dependents: true })` while the adapter's
  // cleanup stays pending; `cleanup-settle` lets it finish.
  | { kind: `cleanup-hold` | `cleanup-settle`; source: SourceName }
  // `cleanup-reload`, in one tick: `cleanup({ dependents: true })` whose
  // adapter cleanup settles at once, then `reload()`, which starts a fresh
  // sync run, then `reload()` again, which reloads that run.
  | { kind: `cleanup-reload`; source: SourceName }
  // `cleanup-during-reload` calls `reload()` while an app listener waits for
  // the first notification that `at` names; that listener runs
  // `cleanup({ dependents: true })`. A reload that makes no such notification
  // is followed at once by the same cleanup.
  | {
      kind: `cleanup-during-reload`
      source: SourceName
      at: `source-health` | `query-health`
    }

// ---------------------------------------------------------------------------
// Cleanup during a reload
// ---------------------------------------------------------------------------
//
// Law (ARCHITECTURE law 14, and the maintainer decision that a reload ends
// with its run): `reload()` notifies listeners synchronously while it runs,
// and app code can run `cleanup()` from any of them. Such a cleanup is an
// ordinary cleanup. The reload ends with its run and settles as a cleaned-up
// reload does, no sync run starts for it, and nothing of it stays armed: a
// later fresh start's diff baseline is the rows that run loads. The
// Collection ends `cleaned-up` exactly as after a cleanup that follows the
// reload. So the model applies the reload and then an ordinary cleanup, and
// where inside the reload the cleanup lands decides nothing.
//
// The notifications a reload makes before its new run's `sync()` (found by
// instrumenting every event emitter during `reload()`):
//
// - `source-health`: the Collection's `health:change`, when the reload
//   announces `reloading: true`, or its `status:change` and `health:change`
//   when a reload of a cleaned-up Collection starts a fresh run.
// - `query-health`: a dependent live query's `health:change`, which follows
//   that announcement at once.
// - `loading-subset`: the Collection's `loadingSubset:change`, when retiring
//   the run aborts loads in flight (on-demand only).
// - `subscription-status`: a change subscription's `status:change`, when the
//   reload detaches its demand from the retired run or replays it (on-demand
//   only: an eager subscription's status does not change).
//
// The main grammar reaches the first two; the lazy grammar reaches all four.
// Not reached: the retired run's adapter cleanup function and the new run's
// `sync()` are adapter code, and a cleanup from them is a cleanup during sync
// entry or adapter cleanup, which other lanes own.
type ReloadNotice =
  `source-health` | `query-health` | `loading-subset` | `subscription-status`

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

type Gate = `loading` | `ready` | `error` | `crashed` | `cleaned-up`
// `serial` names one reported failure. A new report is a new failure even
// when it has the same message, so the node that shows it is a new node.
type Failure = { message: string; serial: number }
type Problem = null | Failure
// `cause` is the message of what put the gate in `error` or `crashed`.
// `reloading`: a reload's new sync run (or a query's restart) has not
// committed yet, so everything visible is the previous run's.
type GateModel = { gate: Gate; cause: string | null; reloading: boolean }
// The node shows `stopped` (from fail() after readiness) over `failures`
// (from reportError()); a reload's new run can report while the previous
// run's error still shows.
// `failures` is the failure reason's frame (maintainer decision): every
// reportError() of the sync run since the slot was last clear, oldest first.
// The node's `failureReason` is the newest of them, and its `errors` lists
// them all. `reportHealthy()` empties the frame. A frame belongs to one sync
// run, so a reload's new run that reports starts a new frame.
// `failureFromReload`: the new run reported `failures` itself, so its first
// commit keeps them.
// `rows` are the applied synced rows; `open` is the run's open transaction.
// `armed`: a reload started and its run has not begun a transaction yet, so
// the next transaction it begins replaces every row, and until then a diffing
// adapter sees no rows to diff against.
// `cleaning`: cleanup started and the adapter's cleanup has not settled.
// `retired`: cleanup ended the sync run and no new one has started, so the
// adapter's calls do nothing.
// `retiredCleanup`: a reload retired a run whose cleanup is still pending.
// Cleanup and a fresh start keep it pending.
type SourceModel = GateModel & {
  cleaning: boolean
  retired: boolean
  retiredCleanup: boolean
  failures: Array<Failure>
  stopped: Problem
  failureFromReload: boolean
  rows: Rows
  open: OpenTransaction | null
  armed: boolean
}
// A query's reload() reloads the Collections below it that show an error,
// then reloads the query itself once they all settle, unless one failed.
// `start`: the query a cascade ended starts once its reloaded sources settle.
type PendingSelfReload = {
  target: `query` | `inner` | `start`
  waits: Set<SourceName | `inner`>
  failed: boolean
}
type RowKey = 1 | 2 | 3
// Synced rows by key, each with the tag of the write that produced it. A
// write without a tag field gives an inserted row tag 0, and an update keeps
// the tag the row had: a sync update merges into the row.
type Rows = Map<number, number>
// A sync transaction the run has begun and not committed. `truncate`: the
// transaction is a reload's first, so its commit replaces every row.
type OpenTransaction = {
  writes: Rows
  truncate: boolean
  adapter?: boolean
  marksReady?: boolean
}
type Model = {
  sources: Record<SourceName, SourceModel>
  query: GateModel
  inner: GateModel
  serial: number
  selfReloads: Array<PendingSelfReload>
  effect: EffectModel
  // A cascade cleanup ended the observed query (and, below it, the inner
  // query): it shows `cleaned-up` and announces nothing more.
  queryEnded: boolean
  innerEnded: boolean
  // The query crashed while it started, because a Collection it reads was
  // still cleaning up. It reads no Collection: it announces nothing more,
  // and no cascade ends it.
  queryDetached: boolean
}

// An Effect over A. It reaches its gate when A is ready. A crash of A ends
// it at any time, and a failed first load of A ends it before its gate,
// including one that A already showed when the Effect was created. After
// its gate, every other problem of A is health tree detail. A cascade cleanup
// of A ends it without a source error: the app asked for it. `live`: it has
// not ended; `errors`: how often it reported a source error.
type EffectModel = { live: boolean; gate: boolean; errors: number }

function deriveEffect(model: Model): void {
  const { effect } = model
  const A = model.sources.A
  if (!effect.live) return
  if (A.gate === `crashed` || (A.gate === `error` && !effect.gate)) {
    effect.live = false
    effect.errors++
  } else if (A.gate === `ready`) effect.gate = true
}

// The reload of a query a cleanup ended starts it again, as any Collection's
// reload starts a cleaned-up one, and its start starts each cleaned-up
// Collection it reads. It goes through its inputs in query order, and the
// first that ends its run decides: a Collection still cleaning up crashes it
// (it then reads nothing), and a failed or crashed input fails or crashes
// it. It still starts every later input.
const cleanedUnderQuery = `a source was cleaned up under a live query`
const queryInputs: Record<Shape, ReadonlyArray<SourceName | `inner`>> = {
  direct: [`A`],
  join: [`A`, `B`],
  'self-join': [`A`],
  nested: [`inner`, `B`],
  include: [`B`, `A`],
  'pooled-nested': [`inner`],
}
function startQuery(
  model: Model,
  inputs: ReadonlyArray<SourceName | `inner`>,
): GateModel {
  let result: GateModel = { gate: `loading`, cause: null, reloading: false }
  for (const input of inputs) {
    const running = result.gate === `loading`
    if (input === `inner`) {
      const { gate, cause } = model.inner
      if (running && (gate === `error` || gate === `crashed`))
        result = { gate, cause, reloading: false }
      continue
    }
    const source = model.sources[input]
    // A Collection still cleaning up stops the start, unless the run already
    // ended; then the query starts the rest.
    if (source.cleaning) {
      if (running)
        return { gate: `crashed`, cause: cleanedUnderQuery, reloading: false }
      continue
    }
    if (source.gate === `cleaned-up`) restartSource(source)
    if (running && (source.gate === `error` || source.gate === `crashed`))
      result = { gate: source.gate, cause: source.cause, reloading: false }
  }
  return result
}
function restartEndedQuery(shape: Shape, model: Model): void {
  model.queryEnded = false
  if (shape === `nested` && model.innerEnded) {
    model.innerEnded = false
    model.inner = startQuery(model, [`A`])
  } else model.innerEnded = false
  // An inner query that crashes as it starts throws into the outer start,
  // which then starts nothing more.
  model.query =
    shape === `nested` &&
    model.inner.gate === `crashed` &&
    model.inner.cause === cleanedUnderQuery
      ? { ...model.inner }
      : startQuery(model, queryInputs[shape])
  deriveQueries(shape, model)
  deriveEffect(model)
  model.queryDetached =
    model.query.gate === `crashed` && model.query.cause === cleanedUnderQuery
}

// A fresh sync run of a cleaned-up Collection: nothing of the old run stays.
function restartSource(source: SourceModel): void {
  Object.assign(source, {
    gate: `loading`,
    cause: null,
    reloading: false,
    failures: [],
    stopped: null,
    failureFromReload: false,
    cleaning: false,
    retired: false,
    retiredCleanup: source.retiredCleanup,
    rows: new Map(),
    open: null,
    armed: false,
  } satisfies SourceModel)
}

// Cleanup start invalidates the sync run at once: the rows go, the node drops
// the run's problems but keeps a crash's or failed first load's cause while
// the status shows it, and the status waits for the adapter's cleanup. A
// cascade ends every live query and Effect that reads the Collection. A
// second cleanup returns the pending one.
function applyCleanup(
  shape: Shape,
  model: Model,
  kind: `cleanup-hold` | `cleanup-settle`,
  name: SourceName,
): void {
  const source = model.sources[name]
  if (!shapeSources[shape].includes(name)) return
  if (kind === `cleanup-settle`) {
    if (!source.cleaning) return
    source.cleaning = false
    source.gate = `cleaned-up`
    source.cause = null
    deriveQueries(shape, model)
    return
  }
  if (source.cleaning || source.gate === `cleaned-up`) return
  // A Collection crashed after its cleanup has no sync run since: there is
  // no adapter cleanup to wait for, so the cleanup settles at once and ends
  // the crash.
  if (source.retired) {
    source.gate = `cleaned-up`
    source.cause = null
    deriveQueries(shape, model)
    return
  }
  Object.assign(source, {
    cleaning: true,
    retired: true,
    reloading: false,
    failures: [],
    stopped: null,
    failureFromReload: false,
    rows: new Map(),
    open: null,
    armed: false,
  })
  // A cascade that ends a query cancels its pending reload: the app ended
  // it. A query that had already ended keeps its pending start, and a query
  // the cascade does not reach keeps its reload.
  if (!model.queryDetached && !model.queryEnded) {
    model.queryEnded = true
    model.selfReloads = model.selfReloads.filter(
      (pending) => pending.target === `inner`,
    )
  }
  if (name === `A`) {
    model.selfReloads = model.selfReloads.filter(
      (pending) => pending.target !== `inner`,
    )
    model.innerEnded = true
    if (model.effect.live) model.effect.live = false
  }
  deriveQueries(shape, model)
}

// The rows a diffing adapter reads to choose between insert and update: the
// applied rows with the open transaction's writes on top, or only the open
// transaction's writes when it replaces every row, or none while a reload's
// replacement has not begun.
function expectedBaseline(source: SourceModel): Rows {
  if (source.armed) return new Map()
  if (source.open?.truncate) return new Map(source.open.writes)
  return new Map([...source.rows, ...(source.open?.writes ?? [])])
}

function isReload(kind: string): boolean {
  return (
    kind === `reload` ||
    kind === `reload-cleanup-fails` ||
    kind === `reload-cleanup-held`
  )
}

// From any active status, for good. A reload ends with it, before its first
// commit: the rows stay the baseline.
function crashSource(source: SourceModel, cause: string): void {
  if (source.reloading) {
    source.armed = false
    if (source.open && !source.open.adapter) source.open.truncate = false
  }
  if (source.gate !== `crashed`) {
    source.gate = `crashed`
    source.cause = cause
    source.failures = []
    source.stopped = null
    source.reloading = false
  }
}

// The adapter writes an update for a key in its baseline, and an insert for
// any other key.
function writeRow(
  counter: { serial: number },
  source: SourceModel,
  step: Extract<SourceAction, { kind: `write` }>,
): void {
  const tag = ++counter.serial
  const previous = expectedBaseline(source).get(step.key)
  openTransaction(source).writes.set(
    step.key,
    step.untagged ? (previous ?? 0) : tag,
  )
}

// The run begins a transaction. A reload's run replaces every row with its
// first transaction.
function openTransaction(source: SourceModel): OpenTransaction {
  if (!source.open) {
    source.open = { writes: new Map(), truncate: source.armed }
    source.armed = false
  }
  return source.open
}

// A reload completes at its first commit when the Collection is ready, and
// at markReady() when its first load failed: the node drops the retired
// run's problems.
function completeReload(source: SourceModel): void {
  source.reloading = false
  source.gate = `ready`
  source.cause = null
  if (!source.failureFromReload) source.failures = []
  source.failureFromReload = false
  source.stopped = null
}

// Commit the open transaction: a reload's first one replaces every row.
// Returns the outcome of a truncate that marks the Collection ready, which
// is a markReady() at its commit: a reload completes, a first load becomes
// ready, and after a failed first load or fail() it breaks the adapter
// contract, so the commit throws after the rows apply.
function commitOpen(source: SourceModel): `ok` | `throws` | `bad-transition` {
  const { writes, truncate, marksReady } = openTransaction(source)
  source.rows = truncate
    ? new Map(writes)
    : new Map([...source.rows, ...writes])
  source.open = null
  if (truncate && source.reloading && source.gate === `ready`) {
    completeReload(source)
    return `ok`
  }
  // A truncate's markReady option makes a Collection that is not ready yet
  // ready; on a ready one it does nothing, also after fail() (law-silent;
  // recorded in the coverage map).
  if (
    !truncate ||
    !marksReady ||
    source.gate === `crashed` ||
    source.gate === `ready`
  )
    return `ok`
  if (source.reloading) completeReload(source)
  else if (source.gate === `error`) return `bad-transition`
  else if (source.stopped) return `throws`
  else if (source.gate === `loading`) source.gate = `ready`
  return `ok`
}

const shapeSources: Record<Shape, ReadonlyArray<SourceName>> = {
  direct: [`A`],
  join: [`A`, `B`],
  'self-join': [`A`],
  nested: [`A`, `B`],
  include: [`A`, `B`],
  'pooled-nested': [`A`],
}

function freshSource(): SourceModel {
  return {
    gate: `loading`,
    cause: null,
    reloading: false,
    failures: [],
    stopped: null,
    failureFromReload: false,
    cleaning: false,
    retired: false,
    retiredCleanup: false,
    rows: new Map(),
    open: null,
    armed: false,
  }
}

function freshModel(): Model {
  return {
    sources: { A: freshSource(), B: freshSource() },
    query: { gate: `loading`, cause: null, reloading: false },
    inner: { gate: `loading`, cause: null, reloading: false },
    serial: 0,
    selfReloads: [],
    effect: { live: true, gate: false, errors: 0 },
    queryEnded: false,
    innerEnded: false,
    queryDetached: false,
  }
}

// A live query's status follows its sources until it is ready, and never
// leaves `crashed`. A crashed input crashes the query at any time, even after
// its first load failed, as a crash does to a Collection; after the query is
// ready, nothing else changes it. A failed first load stays until the query's
// own reload (see settleSelfReloads): that run keeps `error` with `reloading`
// until it is ready, or until an input fails it with a new cause. The query
// takes the cause of the input that ended its sync run.
function deriveGate(
  current: GateModel,
  inputs: ReadonlyArray<GateModel>,
): GateModel {
  if (current.gate === `crashed`) return current
  const crashed = inputs.find(({ gate }) => gate === `crashed`)
  if (crashed)
    return { gate: `crashed`, cause: crashed.cause, reloading: false }
  if (current.gate === `ready`) return current
  const failed = inputs.find(({ gate }) => gate === `error`)
  if (current.gate === `error` && !current.reloading) return current
  if (failed) return { gate: `error`, cause: failed.cause, reloading: false }
  if (inputs.every(({ gate }) => gate === `ready`))
    return { gate: `ready`, cause: null, reloading: false }
  return current
}

function deriveQueries(shape: Shape, model: Model): void {
  const gates = (names: ReadonlyArray<SourceName>) =>
    names.map((name) => model.sources[name])
  const ended: GateModel = { gate: `cleaned-up`, cause: null, reloading: false }
  if (model.innerEnded) model.inner = ended
  if (model.queryEnded) {
    model.query = shape === `pooled-nested` ? model.inner : ended
    if (shape === `nested` && !model.innerEnded)
      model.inner = deriveGate(model.inner, gates([`A`]))
    return
  }
  if (shape === `nested`) {
    if (!model.innerEnded) model.inner = deriveGate(model.inner, gates([`A`]))
    model.query = deriveGate(model.query, [model.inner, model.sources.B])
  } else if (shape === `pooled-nested`) {
    // A pooled view has no gate of its own: it shows its source's.
    model.inner = deriveGate(model.inner, gates([`A`]))
    model.query = model.inner
  } else {
    model.query = deriveGate(model.query, gates(shapeSources[shape]))
  }
}

/**
 * Apply a step. Returns `throws` when the contract forbids it, and
 * `bad-transition` when it forbids `markReady()` because the first load failed.
 */
function applyModel(
  shape: Shape,
  model: Model,
  step: Step,
): `ok` | `throws` | `bad-transition` {
  if (step.kind === `restart`) {
    // A retired run's cleanup still pending stays pending.
    const { A, B } = model.sources
    Object.assign(model, freshModel())
    model.sources.A.retiredCleanup = A.retiredCleanup
    model.sources.B.retiredCleanup = B.retiredCleanup
    return `ok`
  }
  if (step.kind === `effect`) {
    // An Effect created while A's cleanup is pending cannot read A: it ends
    // through onSourceError. Over a cleaned-up A, the new Effect's
    // subscription starts A's next sync run.
    if (model.sources.A.cleaning) {
      model.effect = { live: false, gate: false, errors: 1 }
      return `ok`
    }
    if (model.sources.A.gate === `cleaned-up`) restartSource(model.sources.A)
    model.effect = { live: true, gate: false, errors: 0 }
    deriveEffect(model)
    return `ok`
  }
  if (step.kind === `cleanup-hold` || step.kind === `cleanup-settle`) {
    applyCleanup(shape, model, step.kind, step.source)
    return `ok`
  }
  if (step.kind === `cleanup-reload`) {
    // A cleanup still pending, or a source the shape does not read, takes
    // no part. Otherwise the cleanup settles, the first reload starts a
    // fresh run, and the second reloads it. Work of the cleaned-up run,
    // such as its reload's open transaction, decides nothing for them.
    const source = model.sources[step.source]
    if (!shapeSources[shape].includes(step.source) || source.cleaning)
      return `ok`
    applyCleanup(shape, model, `cleanup-hold`, step.source)
    applyCleanup(shape, model, `cleanup-settle`, step.source)
    for (let reloads = 0; reloads < 2; reloads++)
      applySourceStep(model, source, step.source, { kind: `reload` })
    deriveQueries(shape, model)
    deriveEffect(model)
    return `ok`
  }
  if (step.kind === `cleanup-during-reload`) {
    // The reload, then an ordinary cascade cleanup (see "Cleanup during a
    // reload"). The reload's own outcome stands: it rejects on a crashed
    // Collection or one still cleaning up, and the cleanup then cleans up
    // the crashed one or returns the pending one.
    if (!shapeSources[shape].includes(step.source)) return `ok`
    const source = model.sources[step.source]
    const pending = source.cleaning
    const { outcome } = applySourceStep(model, source, step.source, {
      kind: `reload`,
    })
    if (pending) return outcome
    applyCleanup(shape, model, `cleanup-hold`, step.source)
    applyCleanup(shape, model, `cleanup-settle`, step.source)
    deriveEffect(model)
    return outcome
  }
  if (step.kind === `reload-query`) {
    // A pooled view has no reload of its own.
    if (shape === `pooled-nested`) return `ok`
    if (model.queryEnded) {
      // It reloads every Collection below it that shows an error, then
      // starts once those reloads succeed; a crashed one rejects, so it does
      // not start.
      const stopped = shapeSources[shape].filter((name) => {
        const source = model.sources[name]
        return (
          source.gate === `error` ||
          source.gate === `crashed` ||
          source.stopped !== null
        )
      })
      if (stopped.length === 0) {
        restartEndedQuery(shape, model)
        return `ok`
      }
      // The reloads run together: a crashed or cleaning one rejects, and
      // the query then does not start, but the others still reload.
      const rejects = stopped.filter(
        (name) =>
          model.sources[name].gate === `crashed` ||
          model.sources[name].cleaning,
      )
      const reloaded = stopped.filter((name) => !rejects.includes(name))
      for (const name of reloaded) {
        const source = model.sources[name]
        if (source.reloading) continue
        source.reloading = true
        source.armed = true
        source.open = null
      }
      // A nested query reloads its inner query too, which reloads A, then
      // itself. An inner query the cascade ended is a Collection below the
      // query that shows A's error, so it is one of the reloads that run
      // together: once A reloads, it starts, as any Collection's reload
      // starts a cleaned-up one, also when another reload rejects and the
      // outer query then does not start.
      const waits = new Set<SourceName | `inner`>(reloaded)
      const viaInner = model.innerEnded
        ? reloaded.includes(`A`)
        : model.inner.gate === `error` && !rejects.includes(`A`)
      if (shape === `nested` && viaInner) {
        model.selfReloads.push({
          target: `inner`,
          waits: new Set(reloaded.includes(`A`) ? [`A`] : []),
          failed: false,
        })
        waits.delete(`A`)
        waits.add(`inner`)
      }
      model.selfReloads.push({
        target: `start`,
        waits,
        failed: rejects.length > 0,
      })
      settleSelfReloads(shape, model)
      return `ok`
    }
    if (model.query.gate === `crashed`) return `throws`
    // The query reloads every Collection below it that shows an error,
    // through any nested live query; a reload in flight keeps its run.
    const reloaded = shapeSources[shape].filter((name) => {
      const source = model.sources[name]
      return source.gate === `error` || source.stopped !== null
    })
    for (const name of reloaded) {
      const source = model.sources[name]
      if (source.reloading) continue
      source.reloading = true
      source.armed = true
      source.open = null
    }
    if (shape === `nested`) {
      // The outer query reloads the inner query when A shows an error; the
      // inner query reloads A, then itself.
      const viaInner = reloaded.includes(`A`) || model.inner.gate === `error`
      if (viaInner)
        model.selfReloads.push({
          target: `inner`,
          waits: new Set(reloaded.includes(`A`) ? [`A`] : []),
          failed: false,
        })
      model.selfReloads.push({
        target: `query`,
        waits: new Set([
          ...reloaded.filter((name) => name !== `A`),
          ...(viaInner ? [`inner` as const] : []),
        ]),
        failed: false,
      })
    } else {
      model.selfReloads.push({
        target: `query`,
        waits: new Set(reloaded),
        failed: false,
      })
    }
    deriveQueries(shape, model)
    settleSelfReloads(shape, model)
    deriveEffect(model)
    return `ok`
  }
  // A step on a source this shape does not read has no effect.
  if (!shapeSources[shape].includes(step.source)) return `ok`
  const { outcome, settles } = applySourceStep(
    model,
    model.sources[step.source],
    step.source,
    // The cleanup steps returned above; TypeScript does not narrow their
    // two-valued kind.
    step as Extract<Step, SourceAction>,
  )
  deriveQueries(shape, model)
  if (settles) settleSelfReloads(shape, model)
  deriveEffect(model)
  return outcome
}

// A source action without the Collection it acts on. `mark-ready` is the
// adapter's markReady() without a write; the on-demand grammars use it.
type SourceAction =
  | { kind: SourceStepKind | `mark-ready` }
  | { kind: `write`; key: RowKey; untagged?: boolean }
  | { kind: `commit` }
  | { kind: `direct-write`; key: RowKey }
  | { kind: `truncate`; markReady?: boolean }

/**
 * The source layer: one sync adapter call (or crash, or reload) on one
 * Collection. Every grammar in this file drives its Collections through it,
 * so a law about a Collection's status, node, reload, or rows is written
 * once. `label` names the Collection in its problem messages. `settles` is
 * false when the call changed only a retired or crashed run, so a query's
 * pending reload has nothing new to settle.
 */
function applySourceStep(
  counter: { serial: number },
  source: SourceModel,
  label: string,
  step: SourceAction,
): { outcome: `ok` | `throws` | `bad-transition`; settles: boolean } {
  let outcome: `ok` | `throws` | `bad-transition` = `ok`
  // After a crash, status calls do nothing and a reload rejects. After
  // fail(), adapter calls throw until a reload starts a new sync run.
  const stopped =
    !source.reloading && (source.gate === `error` || source.stopped !== null)
  // While cleanup is pending, and after it, the retired run's calls do
  // nothing. A reload is a start: it rejects during cleanup or on a crash,
  // and after cleanup it starts a fresh sync run. A crash still applies:
  // only cleanup leaves it, so a crash during cleanup ends when cleanup
  // settles.
  if (source.retired) {
    const crashCause =
      step.kind === `crash`
        ? `${label} crashed`
        : step.kind === `retired-cleanup-rejects` && source.retiredCleanup
          ? `${label} cleanup failed`
          : null
    if (step.kind === `retired-cleanup-rejects`) source.retiredCleanup = false
    if (crashCause) {
      // A crash keeps the first cause.
      if (source.gate !== `crashed`) {
        source.gate = `crashed`
        source.cause = crashCause
      }
    } else if (isReload(step.kind)) {
      if (source.cleaning || source.gate === `crashed`)
        return { outcome: `throws`, settles: false }
      restartSource(source)
    }
    return { outcome: `ok`, settles: false }
  }
  if (step.kind !== `crash` && source.gate === `crashed`) {
    // A crash ends the status calls. Data the run commits still applies:
    // closure keeps accepted sync obligations, such as the confirmation of
    // a write admitted before it (the IndexedDB retirement oracle owns that
    // law).
    if (step.kind === `write`) writeRow(counter, source, step)
    if (step.kind === `direct-write` && !source.open)
      source.rows.set(step.key, ++counter.serial)
    if (step.kind === `commit`) commitOpen(source)
    if (step.kind === `cancel`) source.open = null
    if (step.kind === `truncate`) {
      const open = openTransaction(source)
      open.writes = new Map()
      open.truncate = true
      open.adapter = true
    }
    if (step.kind === `retired-cleanup-rejects`) source.retiredCleanup = false
    return { outcome: isReload(step.kind) ? `throws` : outcome, settles: false }
  }
  switch (step.kind) {
    case `ready`:
      // During a first load or a reload, the run writes row 1 and commits
      // before markReady(), as a first load does.
      if (source.gate === `loading` || source.reloading) {
        openTransaction(source).writes.set(1, ++counter.serial)
        // A commit that throws ends the step before markReady().
        outcome = commitOpen(source)
        if (outcome !== `ok`) break
      }
      outcome = markSourceReady(source)
      break
    case `mark-ready`:
      outcome = markSourceReady(source)
      break
    case `write`:
      writeRow(counter, source, step)
      break
    case `direct-write`:
      // A direct write edits the rows on screen. It is not the run's
      // snapshot, so a reload's replacement stays armed for the run's next
      // transaction and the reload stays in flight.
      if (!source.open) source.rows.set(step.key, ++counter.serial)
      break
    case `commit`:
      outcome = commitOpen(source)
      break
    case `truncate`: {
      const open = openTransaction(source)
      open.writes = new Map()
      open.truncate = true
      open.adapter = true
      // By default the truncate's commit also marks the Collection ready.
      open.marksReady = step.markReady !== false
      break
    }
    case `reload`:
    case `reload-cleanup-held`:
      // Everything visible stays until the new run commits or fails. The
      // retired run's open transaction is dropped.
      if (!source.reloading) {
        source.reloading = true
        source.armed = true
        source.open = null
        if (step.kind === `reload-cleanup-held`) source.retiredCleanup = true
      }
      break
    case `retired-cleanup-rejects`:
      // The retired run's cleanup rejecting breaks the adapter contract,
      // whenever it settles: the Collection crashes, and a reload in flight
      // ends with it.
      if (!source.retiredCleanup) break
      source.retiredCleanup = false
      crashSource(source, `${label} cleanup failed`)
      break
    case `cancel`: {
      // A commit canceled by its signal never happened: its writes are gone,
      // and a reload's replacement waits for the run's next transaction.
      const canceled = openTransaction(source)
      if (canceled.truncate && source.reloading) source.armed = true
      source.open = null
      break
    }
    case `reload-cleanup-fails`:
      // A reload in flight returns its promise and retires nothing.
      if (source.reloading) break
      // The retired run's cleanup rejecting breaks the adapter contract:
      // the Collection crashes and the reload ends with it. The reload
      // already dropped the retired run's open transaction.
      source.open = null
      source.gate = `crashed`
      source.cause = `${label} cleanup failed`
      source.failures = []
      source.stopped = null
      source.reloading = false
      break
    case `fail`:
      // Before Collection readiness the first load fails; after it, the
      // rows stay and the node shows the error. A second fail() in the run
      // changes nothing.
      if (stopped) break
      // A reload that fails before its first commit keeps the rows: they
      // stay the baseline, and a transaction it began no longer replaces
      // them.
      if (source.reloading) {
        source.armed = false
        if (source.open && !source.open.adapter) source.open.truncate = false
      }
      if (source.gate !== `ready`) {
        source.gate = `error`
        source.cause = `${label} gave up`
        source.reloading = false
      } else {
        source.reloading = false
        source.failures = []
        source.stopped = {
          message: `${label} gave up`,
          serial: ++counter.serial,
        }
      }
      break
    case `report`:
      if (stopped || source.gate !== `ready`) outcome = `throws`
      else {
        // A reload's new run that reports starts its own frame; the
        // retired run's failures leave with that run.
        if (source.reloading && !source.failureFromReload) source.failures = []
        source.failures.push({
          message: `${label} problem`,
          serial: ++counter.serial,
        })
        source.failureFromReload = source.reloading
      }
      break
    case `healthy`:
      if (stopped || source.gate !== `ready`) outcome = `throws`
      else {
        source.failures = []
        source.failureFromReload = false
      }
      break
    case `crash`:
      crashSource(source, `${label} crashed`)
      break
  }
  return { outcome, settles: true }
}

// markReady() of the current sync run. A reload completes at it when its run
// has not committed yet, and its replacement then has no rows: the rows from
// before the reload go. After a failed first load or fail() it breaks the
// adapter contract.
function markSourceReady(
  source: SourceModel,
): `ok` | `throws` | `bad-transition` {
  if (source.reloading) {
    if (source.armed) {
      source.rows = new Map()
      source.armed = false
    }
    completeReload(source)
    return `ok`
  }
  if (source.gate === `error`) return `bad-transition`
  if (source.stopped) return `throws`
  source.gate = `ready`
  return `ok`
}

// A load of an on-demand Collection that succeeds is one sync transaction of
// the rows it loaded, keyed here by the demand key they serve. As every
// transaction, it is a reload's first commit while the reload's replacement
// is armed, and then replaces every row.
function commitLoad(
  counter: { serial: number },
  source: SourceModel,
  keys: Iterable<number>,
): void {
  const open = openTransaction(source)
  for (const key of keys) open.writes.set(key, ++counter.serial)
  commitOpen(source)
}

// A reloaded Collection settles when its new run commits (ready) or fails.
// Once a query's reload has nothing left to wait for, it reloads the query
// itself if it still shows its failed first load.
function settleSelfReloads(shape: Shape, model: Model): void {
  let progressed = true
  while (progressed) {
    progressed = false
    for (const pending of [...model.selfReloads]) {
      for (const wait of [...pending.waits]) {
        const settled =
          wait === `inner`
            ? !model.selfReloads.some((other) => other.target === `inner`)
            : !model.sources[wait].reloading
        if (!settled) continue
        pending.waits.delete(wait)
        const gate =
          wait === `inner` ? model.inner.gate : model.sources[wait].gate
        const stopped = wait !== `inner` && model.sources[wait].stopped
        if (gate !== `ready` || stopped) pending.failed = true
      }
      if (pending.waits.size > 0) continue
      model.selfReloads.splice(model.selfReloads.indexOf(pending), 1)
      progressed = true
      if (pending.target === `start`) {
        if (!pending.failed && model.queryEnded) restartEndedQuery(shape, model)
        continue
      }
      // The reload of an inner query a cascade ended starts it once A
      // reloaded.
      if (pending.target === `inner` && model.innerEnded) {
        if (pending.failed) continue
        model.innerEnded = false
        model.inner = startQuery(model, [`A`])
        deriveQueries(shape, model)
        continue
      }
      const current = model[pending.target]
      if (pending.failed || current.gate !== `error`) continue
      // The restarted run fails at once on an input that still failed, and
      // is ready at once when every input is ready.
      const inputs =
        pending.target === `inner`
          ? [model.sources.A]
          : shape === `nested`
            ? [model.inner, model.sources.B]
            : shapeSources[shape].map((name) => model.sources[name])
      const failedInput = inputs.find(
        ({ gate }) => gate === `error` || gate === `crashed`,
      )
      model[pending.target] = failedInput
        ? { gate: `error`, cause: failedInput.cause, reloading: false }
        : inputs.every(({ gate }) => gate === `ready`)
          ? { gate: `ready`, cause: null, reloading: false }
          : { gate: `error`, cause: current.cause, reloading: true }
      deriveQueries(shape, model)
    }
  }
}

// A problem's message says which cause the node shows; `serial` (identity
// only) says which report. `errors` is the problem's frame, oldest first:
// each failure's message and, when the driver reported its cause, that
// report's serial (see `reportedSerials`). The problem shows the newest.
type ExpectedFailure = { message: string; cause?: number }
type ExpectedProblem = null | {
  message: string
  serial?: number
  errors: Array<ExpectedFailure>
}
// A status cause (a failed first load or a crash) is one failure: its frame
// is the sync run, and nothing adds to it.
function statusCause(message: string): NonNullable<ExpectedProblem> {
  return { message, errors: [{ message }] }
}
// The newest failure of a frame shows, and the frame lists them all.
function framed(
  frame: ReadonlyArray<Failure>,
  identity: boolean,
): ExpectedProblem {
  const newest = frame.at(-1)
  return newest
    ? {
        message: newest.message,
        ...(identity ? { serial: newest.serial } : {}),
        errors: frame.map(({ message, serial }) => ({
          message,
          cause: serial,
        })),
      }
    : null
}
type ExpectedNode = {
  alias: string
  kind: `source` | `live-query` | `include`
  status: Gate
  hasErrors: boolean
  failureReason: ExpectedProblem
  error: ExpectedProblem
  reloading: boolean
  sources: Array<ExpectedNode>
}

// `identity` adds each problem's serial, which the public tree does not show
// but which decides whether a node is new.
function sourceNode(
  alias: string,
  source: SourceModel,
  identity: boolean,
  kind: ExpectedNode[`kind`] = `source`,
): ExpectedNode {
  // fail() after readiness is once per sync run, so its frame is one
  // failure.
  const error =
    source.gate === `error` || source.gate === `crashed`
      ? statusCause(source.cause!)
      : framed(source.stopped ? [source.stopped] : [], identity)
  const failureReason = error ? null : framed(source.failures, identity)
  return {
    alias,
    kind,
    status: source.gate,
    hasErrors: error !== null || failureReason !== null,
    failureReason,
    error,
    reloading: source.reloading,
    sources: [],
  }
}

function queryNode(
  alias: string,
  { gate, cause, reloading }: GateModel,
  sources: Array<ExpectedNode>,
): ExpectedNode {
  const error =
    gate === `error` || gate === `crashed` ? statusCause(cause!) : null
  return {
    alias,
    kind: `live-query`,
    status: gate,
    hasErrors: error !== null || sources.some((node) => node.hasErrors),
    failureReason: null,
    error,
    reloading,
    sources,
  }
}

// `findProblems` lists, in tree order, the nodes whose own facts show a
// problem; a node whose problems are all below it is skipped.
type ProblemSummary = [alias: string, message: string]
function expectedProblems(node: ExpectedNode): Array<ProblemSummary> {
  const own = (node.error ?? node.failureReason)?.message ?? null
  return [
    ...(own ? [[node.alias, own] as ProblemSummary] : []),
    ...node.sources.flatMap(expectedProblems),
  ]
}
function problemOf(node: HealthNode): ProblemSummary {
  return [
    node.alias,
    (node.error ?? node.failureReason)!.message
      .replace(cleanupPrefix, ``)
      .replace(cleanedUnderQueryMessage, cleanedUnderQuery),
  ]
}

function expectedTree(
  shape: Shape,
  model: Model,
  identity = false,
): ExpectedNode {
  const { A, B } = model.sources
  const source = (alias: string, name: SourceModel) =>
    sourceNode(alias, name, identity)
  switch (shape) {
    case `direct`:
      return queryNode(`root`, model.query, [source(`a`, A)])
    case `join`:
      return queryNode(`root`, model.query, [source(`a`, A), source(`b`, B)])
    case `self-join`:
      return queryNode(`root`, model.query, [
        source(`first`, A),
        source(`second`, A),
      ])
    case `nested`:
      return queryNode(`root`, model.query, [
        queryNode(`inner`, model.inner, [source(`a`, A)]),
        source(`b`, B),
      ])
    case `include`:
      // The include node shows its source; per-row child Collections are not
      // in the tree.
      return queryNode(`root`, model.query, [
        source(`b`, B),
        sourceNode(`a`, A, identity, `include`),
      ])
    case `pooled-nested`:
      // The view's node shows its source's gate, and the source's subtree
      // continues through the nested live query.
      return queryNode(`root`, model.query, [
        queryNode(`inner`, model.inner, [source(`a`, A)]),
      ])
  }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function createSource(name: SourceName) {
  let params: SyncParams | undefined
  let failNextCleanup = false
  // A held adapter cleanup stays pending until the driver settles it.
  let held: ReturnType<typeof createDeferred<void>> | undefined
  // The next cleanup, a reload's retired run's, stays pending until the
  // driver rejects it.
  let holdNextCleanup = false
  let retiredHeld: ReturnType<typeof createDeferred<void>> | undefined
  // Sync runs the adapter was asked to start, and those whose cleanup it was
  // asked to run: the difference is the runs still live at the adapter.
  const runs = { started: 0, ended: 0 }
  const collection = createCollection<Row, number>({
    id: `health-oracle-${name}-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    startSync: false,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
        runs.started++
        return () => {
          runs.ended++
          if (held) return held.promise
          if (holdNextCleanup) {
            holdNextCleanup = false
            retiredHeld ??= createDeferred<void>()
            return retiredHeld.promise
          }
          if (!failNextCleanup) return
          failNextCleanup = false
          return Promise.reject(new Error(`${name} cleanup failed`))
        }
      },
    },
  })
  return {
    collection,
    liveRuns: () => runs.started - runs.ended,
    failNextCleanup: (armed = true) => {
      failNextCleanup = armed
    },
    holdNextCleanup: (armed = true) => {
      holdNextCleanup = armed
    },
    rejectRetiredCleanup: () => {
      retiredHeld?.reject(new Error(`${name} cleanup failed`))
      retiredHeld = undefined
    },
    holdCleanup: () => {
      held ??= createDeferred<void>()
    },
    settleCleanup: () => {
      held?.resolve()
      held = undefined
    },
    get params(): SyncParams {
      if (!params) throw new Error(`source ${name} has not started`)
      return params
    },
  }
}

// The observed query and how the driver starts and measures it. A live-query
// Collection starts with a preload; a pooled view starts when it has a
// subscriber, as an observer would subscribe.
type Subject = {
  query: Pick<Collection<any, any>, `status` | `health` | `on` | `cleanup`>
  inner?: Collection<any, any>
  start: () => void
  size: () => number
}

function liveQuery(query: Collection<any, any>, inner?: Collection<any, any>) {
  return {
    query,
    inner,
    start: () => void query.preload().catch(() => undefined),
    size: () => query.size,
  }
}

function buildQuery(
  shape: Shape,
  A: Collection<Row, number>,
  B: Collection<Row, number>,
): Subject {
  switch (shape) {
    case `direct`:
      return liveQuery(createLiveQueryCollection((q) => q.from({ a: A })))
    case `join`:
      return liveQuery(
        createLiveQueryCollection((q) =>
          q.from({ a: A }).join({ b: B }, ({ a, b }) => eq(a.id, b.id)),
        ),
      )
    case `self-join`:
      return liveQuery(
        createLiveQueryCollection((q) =>
          q
            .from({ first: A })
            .join({ second: A }, ({ first, second }) =>
              eq(first.id, second.id),
            ),
        ),
      )
    case `nested`: {
      const inner = createLiveQueryCollection((q) => q.from({ a: A }))
      return liveQuery(
        createLiveQueryCollection((q) =>
          q
            .from({ inner })
            .join({ b: B }, ({ inner: row, b }) => eq(row.id, b.id)),
        ),
        inner,
      )
    }
    case `include`:
      // An included subquery materializes one child Collection per parent row.
      return liveQuery(
        createLiveQueryCollection((q) =>
          q.from({ b: B }).select(({ b }) => ({
            id: b.id,
            items: include(
              q.from({ a: A }).where(({ a }) => eq(a.parentId, b.id)),
            ),
          })),
        ),
      )
    case `pooled-nested`: {
      const inner = createLiveQueryCollection((q) => q.from({ a: A }))
      const view = createPooledLiveQuery(
        new Query()
          .from({ inner })
          .where(({ inner: row }) =>
            eq(row.parentId, 1),
          ) as unknown as Parameters<typeof createPooledLiveQuery>[0],
      ) as unknown as PooledView
      let subscription: { unsubscribe: () => void } | undefined
      return {
        query: view,
        inner,
        start: () => {
          subscription?.unsubscribe()
          subscription = view.subscribeChanges(() => {})
        },
        size: () => [...view.entries()].length,
      }
    }
  }
}

type PooledView = Subject[`query`] & {
  subscribeChanges: (listener: () => void) => { unsubscribe: () => void }
  entries: () => Iterable<unknown>
}

// The public tree, projected onto the fields the model owns.
// A failed adapter cleanup reaches the node as a SyncCleanupError, whose
// message names the Collection; the model knows only the adapter's message.
const cleanupPrefix = /^Collection ".*" sync cleanup function threw an error: /
// The message names the Collection and the query; the model names the case.
const cleanedUnderQueryMessage =
  /^Source collection '.*' was manually cleaned up while live query '.*' depends on it\..*$/s

// The model's serial of each cause the main grammar's driver reported
// through `reportError()` or `fail()`, so the projection can say which
// report each listed failure is: the same object, not only the same message.
const reportedSerials = new WeakMap<object, number>()
const projectedCauseNotNewest = `the problem does not show its newest failure`

function project(node: HealthNode): ExpectedNode {
  const message = (text: string) =>
    text
      .replace(cleanupPrefix, ``)
      .replace(cleanedUnderQueryMessage, cleanedUnderQuery)
  // A problem shows its newest failure: its `message`, `cause`, and `at` are
  // the last listed failure's, and the list is oldest first. A problem that
  // breaks this projects a message no model predicts.
  const problem = (info: HealthNode[`error`]): ExpectedProblem => {
    if (!info) return null
    const newest = info.errors.at(-1)
    const showsNewest =
      newest !== undefined &&
      newest.message === info.message &&
      newest.cause === info.cause &&
      newest.at === info.at &&
      info.errors.every(
        (failure, index) =>
          index === 0 || info.errors[index - 1]!.at <= failure.at,
      )
    return {
      message: showsNewest ? message(info.message) : projectedCauseNotNewest,
      errors: info.errors.map((failure) => ({
        message: message(failure.message),
        cause:
          typeof failure.cause === `object` && failure.cause !== null
            ? reportedSerials.get(failure.cause)
            : undefined,
      })),
    }
  }
  return {
    alias: node.alias,
    kind: node.kind,
    status: node.status as Gate,
    hasErrors: node.hasErrors,
    failureReason: problem(node.failureReason),
    error: problem(node.error),
    reloading: node.reloading,
    sources: node.sources.map(project),
  }
}

// A node whose expected facts did not change is the same object; a node whose
// facts changed is a new object, and so is every node above it.
function expectIdentity(
  previous: HealthNode,
  next: HealthNode,
  before: ExpectedNode,
  after: ExpectedNode,
  label: string,
): void {
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  expect(previous === next, `${label}: ${after.alias} identity`).toBe(!changed)
  if (!changed) return
  after.sources.forEach((source, index) =>
    expectIdentity(
      previous.sources[index]!,
      next.sources[index]!,
      before.sources[index]!,
      source,
      label,
    ),
  )
}

// A diffing adapter writes an insert for a key missing from its baseline and
// an update for a key it has, so a wrong baseline throws or loses rows.
function writeDiffing(
  params: SyncParams,
  key: number,
  tag: number,
  untagged = false,
): void {
  const known = new Map(params.collection._state.replacementBaseline())
  params.write({
    type: known.has(key) ? `update` : `insert`,
    value: untagged
      ? { id: key, parentId: key }
      : { id: key, parentId: key, tag },
  })
}

function sortedTags(rows: Rows): Array<[number, number]> {
  return [...rows].sort(([a], [b]) => a - b)
}

function tagsOf(rows: ReadonlyArray<Row>): Array<[number, number]> {
  return sortedTags(new Map(rows.map((row) => [row.id, row.tag ?? 0])))
}

// The rows a ready query shows. `join()` is a left join, so a join keeps
// every row of its left side; an include shows its parent rows, and the
// pooled view keeps rows whose parentId is 1.
function expectedQuerySize(shape: Shape, model: Model): number {
  const { A, B } = model.sources
  switch (shape) {
    case `direct`:
    case `self-join`:
    case `join`:
    case `nested`:
      return A.rows.size
    case `include`:
      return B.rows.size
    case `pooled-nested`:
      return A.rows.has(1) ? 1 : 0
  }
}

// A history that hangs fails as a counterexample, not as a test timeout.
async function withDeadline(work: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`history did not settle within 10 s`)),
          10_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// The driver of a cleanup during a reload (see "Cleanup during a reload").
// `listen` registers the app's listeners for one notification and returns
// their stop functions; the first notification while `reload()` runs calls
// `clean`. A reload that made none is followed at once by `clean`, so every
// history ends with the same cleanup. `notified` says which of the two ran.
type CleanupDuringReload = {
  notified: boolean
  // The Collection's node showed `reloading` when the cleanup started.
  reloadingAtCleanup: boolean
  reload: Promise<void>
  cleanup: Promise<void>
}
function reloadWithCleanup(
  collection: Collection<Row, number>,
  listen: (notice: () => void) => Array<() => void>,
  clean: () => Promise<void>,
): CleanupDuringReload {
  let cleanup: Promise<void> | undefined
  let reloadingAtCleanup = false
  let reloading = true
  const run = () => {
    if (cleanup) return
    reloadingAtCleanup = collection.health.reloading
    cleanup = clean()
    void cleanup.catch(() => undefined)
  }
  const stops = listen(() => {
    if (reloading) run()
  })
  let reload: Promise<void>
  try {
    reload = collection.reload()
  } finally {
    reloading = false
    for (const stop of stops) stop()
  }
  void reload.catch(() => undefined)
  const notified = cleanup !== undefined
  run()
  return { notified, reloadingAtCleanup, reload, cleanup: cleanup! }
}

// The reload settles by the checkpoint, as a cleaned-up reload does
// elsewhere: one still in flight when the cleanup started rejects. (A reload
// that completed, or rejected, before it keeps that outcome.)
async function expectReloadEnded(
  ended: CleanupDuringReload,
  label: string,
): Promise<void> {
  let outcome: `pending` | `resolved` | `rejected` = `pending`
  ended.reload.then(
    () => (outcome = `resolved`),
    () => (outcome = `rejected`),
  )
  await flushPromises()
  expect(outcome, `${label}: the reload settles`).not.toBe(`pending`)
  if (ended.reloadingAtCleanup)
    expect(outcome, `${label}: the cleaned-up reload rejects`).toBe(`rejected`)
}

// The states the main grammar's later laws depend on (ORC-015). Only the
// generated property records them.
const historyReachStates = [
  `direct subscriber during a reload`,
  `reload ends before its first commit`,
  `untagged insert of a kept row`,
  `retired cleanup rejects after a fresh start`,
  `cleanup and reload during a reload's open transaction`,
  `direct write while a reload is armed`,
  `fail on a stopped source`,
  `cleanup from the Collection's health:change during a reload`,
  `cleanup from the query's health:change during a reload`,
  `fresh run commits after a cleanup during a reload`,
  `report adds a failure to an open frame`,
  `reload's new run reports over the retired run's frame`,
  `failure frame clears with failures listed`,
] as const
type HistoryReach = ReturnType<
  typeof createOracleReach<(typeof historyReachStates)[number]>
>

async function runHistory(
  shape: Shape,
  steps: ReadonlyArray<Step>,
  directSubscribers = true,
  reach?: HistoryReach,
): Promise<void> {
  const sources = { A: createSource(`A`), B: createSource(`B`) }
  const { query, inner, start, size } = buildQuery(
    shape,
    sources.A.collection,
    sources.B.collection,
  )
  const model = freshModel()
  // A pooled view ends for good when its source is cleaned up, and a later
  // mount gets a new view, so its histories do not restart.
  if (shape === `pooled-nested`) {
    steps = steps.filter(
      (step) =>
        step.kind !== `restart` &&
        step.kind !== `cleanup-hold` &&
        step.kind !== `cleanup-settle` &&
        step.kind !== `cleanup-reload` &&
        step.kind !== `cleanup-during-reload`,
    )
  }
  // Each event, with the status announced so far and the tree read then.
  type Event = {
    kind: `status` | `health`
    announced: string
    status: string
    tree: ExpectedNode
  }
  let events: Array<Event> = []
  let announced: string = query.status
  let stop = () => {}
  // The Effect over A, how often it reported a source error, and A's
  // listener count just before it was created.
  const pendingCleanups: Partial<Record<SourceName, Promise<void>>> = {}
  const settleCleanups = async () => {
    for (const name of [`A`, `B`] as const) {
      sources[name].settleCleanup()
      await pendingCleanups[name]
    }
  }
  let effect: ReturnType<typeof createEffect> | undefined
  let effectErrors: Array<Error> = []
  // A direct subscriber with the initial state, on each source the shape
  // reads. Within one Collection lifetime its applied rows are its
  // Collection's rows at every step, also while a reload is in flight or
  // after one fails. What a subscription that survives cleanup sees belongs
  // to the subscription lifecycle oracle, so the check stops at cleanup
  // start and a restart subscribes again.
  // A generated history may leave them out, so the query is then a source's
  // only subscriber.
  const mirrors = { A: new Map<number, number>(), B: new Map<number, number>() }
  const mirrored = { A: false, B: false }
  // A restart happened while a retired run's cleanup was still pending.
  const freshSinceRetire = { A: false, B: false }
  // The source's last cleanup ran from a listener during a reload (reach).
  const cleanedDuringReload = { A: false, B: false }
  // The step's cleanup during a reload, checked at the checkpoint.
  let reloadCleanup: CleanupDuringReload | undefined
  const mirrorSubscriptions: Partial<
    Record<SourceName, { unsubscribe: () => void }>
  > = {}
  const mirrorSource = (name: SourceName) => {
    mirrorSubscriptions[name]?.unsubscribe()
    mirrors[name] = new Map()
    mirrored[name] = true
    mirrorSubscriptions[name] = sources[name].collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = change.key
          if (change.type === `delete`) mirrors[name].delete(key)
          else mirrors[name].set(key, (change.value as Row).tag ?? 0)
        }
      },
      { includeInitialState: true },
    )
  }
  const mirror = () => {
    if (!directSubscribers) return
    for (const name of shapeSources[shape]) mirrorSource(name)
  }
  mirror()
  let listenersBeforeEffect = 0
  const listenersOn = (collection: Collection<any, any>) =>
    [
      ...(
        collection as unknown as {
          _events: { listeners: Map<string, Map<unknown, unknown>> }
        }
      )._events.listeners.values(),
    ].reduce((sum, set) => sum + set.size, 0)
  const mountEffect = async () => {
    await effect?.dispose()
    listenersBeforeEffect = listenersOn(sources.A.collection)
    const errors: Array<Error> = []
    effectErrors = errors
    effect = createEffect({
      query: (q) => q.from({ row: sources.A.collection }),
      onBatch: () => {},
      onSourceError: (error) => errors.push(error),
    })
  }
  // Cleanup without subscribers drops event listeners, so each sync run
  // registers its own.
  const listen = () => {
    stop()
    announced = query.status
    const record = (kind: Event[`kind`]) => {
      if (kind === `status`) announced = query.status
      const tree = query.health
      events.push({
        kind,
        announced,
        status: tree.status,
        tree: project(tree),
      })
    }
    const stopStatus = query.on(`status:change`, () => record(`status`))
    const stopHealth = query.on(`health:change`, () => record(`health`))
    stop = () => {
      stopStatus()
      stopHealth()
    }
  }
  const begin = () => {
    listen()
    start()
    void mountEffect()
  }
  const consoleError = console.error
  console.error = () => {}
  try {
    expect(
      query.health,
      `${shape}: the query exposes a health tree`,
    ).toBeDefined()
    begin()
    await flushPromises()
    let previous = query.health
    for (const [index, step] of steps.entries()) {
      const label = `step ${index} ${JSON.stringify(step)} on ${shape}`
      const before = expectedTree(shape, model, true)
      // The run's state before the step decides what the adapter does, as a
      // real adapter decides from its own state.
      const pre =
        `source` in step
          ? {
              loading:
                model.sources[step.source].gate === `loading` ||
                model.sources[step.source].reloading,
              open: model.sources[step.source].open !== null,
              retired:
                model.sources[step.source].cleaning ||
                model.sources[step.source].gate === `cleaned-up`,
              cleaning: model.sources[step.source].cleaning,
              // A cleanup waits for the adapter only when a sync run is
              // live: not while one is pending, after cleanup, or after a
              // crash that followed cleanup.
              cleanupWaits:
                !model.sources[step.source].cleaning &&
                model.sources[step.source].gate !== `cleaned-up` &&
                !model.sources[step.source].retired,
            }
          : undefined
      if (
        reach &&
        `source` in step &&
        shapeSources[shape].includes(step.source)
      ) {
        const source = model.sources[step.source]
        if (source.reloading && mirrored[step.source])
          reach.reach(`direct subscriber during a reload`)
        if (source.reloading && (step.kind === `fail` || step.kind === `crash`))
          reach.reach(`reload ends before its first commit`)
        if (
          step.kind === `write` &&
          step.untagged &&
          source.rows.has(step.key) &&
          !expectedBaseline(source).has(step.key)
        )
          reach.reach(`untagged insert of a kept row`)
        if (
          step.kind === `retired-cleanup-rejects` &&
          source.retiredCleanup &&
          freshSinceRetire[step.source]
        )
          reach.reach(`retired cleanup rejects after a fresh start`)
        if (
          step.kind === `cleanup-reload` &&
          source.reloading &&
          source.open &&
          !source.cleaning
        )
          reach.reach(`cleanup and reload during a reload's open transaction`)
        if (step.kind === `direct-write` && source.armed && !source.open)
          reach.reach(`direct write while a reload is armed`)
        if (
          step.kind === `fail` &&
          !source.reloading &&
          (source.gate === `error` || source.stopped !== null)
        )
          reach.reach(`fail on a stopped source`)
        const reports =
          step.kind === `report` &&
          source.gate === `ready` &&
          !source.stopped &&
          source.failures.length > 0
        if (reports && !source.reloading)
          reach.reach(`report adds a failure to an open frame`)
        if (reports && source.reloading && !source.failureFromReload)
          reach.reach(`reload's new run reports over the retired run's frame`)
        if (
          step.kind === `healthy` &&
          source.gate === `ready` &&
          !source.stopped &&
          source.failures.length > 1
        )
          reach.reach(`failure frame clears with failures listed`)
        if (
          (step.kind === `ready` || step.kind === `commit`) &&
          !source.retired &&
          cleanedDuringReload[step.source]
        )
          reach.reach(`fresh run commits after a cleanup during a reload`)
      }
      // Any other cleanup of a source discards what the last one left.
      if (step.kind === `restart`) {
        cleanedDuringReload.A = false
        cleanedDuringReload.B = false
      } else if (
        step.kind === `cleanup-hold` ||
        step.kind === `cleanup-reload` ||
        step.kind === `cleanup-during-reload`
      )
        cleanedDuringReload[step.source] = false
      if (step.kind === `restart`)
        for (const name of [`A`, `B`] as const)
          if (model.sources[name].retiredCleanup) freshSinceRetire[name] = true
      const queryEndedBefore = model.queryEnded
      const serialBefore = model.serial
      const expected = applyModel(shape, model, step)
      // The write tag the model gave this step, if it wrote.
      const tag = model.serial
      // A report the model numbered is that failure: its cause projects as
      // the model's serial.
      const reported = (error: Error) => {
        if (model.serial !== serialBefore) reportedSerials.set(error, tag)
        return error
      }
      events = []
      let thrown: unknown
      reloadCleanup = undefined
      try {
        if (step.kind === `effect`) {
          await mountEffect()
        } else if (step.kind === `cleanup-during-reload`) {
          if (shapeSources[shape].includes(step.source)) {
            const { collection } = sources[step.source]
            // The cleanup ends the direct subscriber, as any cleanup does.
            mirrored[step.source] = false
            reloadCleanup = reloadWithCleanup(
              collection,
              (notice) => [
                (step.at === `source-health` ? collection : query).on(
                  `health:change`,
                  notice,
                ),
              ],
              () => collection.cleanup({ dependents: true }),
            )
            if (reloadCleanup.notified) {
              cleanedDuringReload[step.source] = true
              reach?.reach(
                step.at === `source-health`
                  ? `cleanup from the Collection's health:change during a reload`
                  : `cleanup from the query's health:change during a reload`,
              )
            }
            // A crashed Collection, or one still cleaning up, rejects the
            // reload; a pending cleanup stays pending.
            if (pre!.cleaning || expected === `throws`)
              thrown = await reloadCleanup.reload.catch((e: unknown) => e)
            if (!pre!.cleaning) await reloadCleanup.cleanup
          }
        } else if (step.kind === `cleanup-hold`) {
          if (shapeSources[shape].includes(step.source)) {
            // A hold armed when no run is live would hold the next run's
            // cleanup instead, which the step does not ask for.
            if (pre!.cleanupWaits) sources[step.source].holdCleanup()
            pendingCleanups[step.source] ??= sources[step.source].collection
              .cleanup({ dependents: true })
              .finally(() => {
                pendingCleanups[step.source] = undefined
              })
          }
        } else if (step.kind === `cleanup-settle`) {
          sources[step.source].settleCleanup()
          await pendingCleanups[step.source]
        } else if (step.kind === `cleanup-reload`) {
          if (
            shapeSources[shape].includes(step.source) &&
            !pendingCleanups[step.source]
          ) {
            const { collection } = sources[step.source]
            // The cleanup ends the direct subscriber; the fresh run gets a
            // new one at the checkpoint.
            mirrored[step.source] = false
            void collection.cleanup({ dependents: true }).catch(() => undefined)
            void collection.reload().catch(() => undefined)
            void collection.reload().catch(() => undefined)
            await flushPromises()
          }
        } else if (step.kind === `reload-query` && queryEndedBefore) {
          // The query starts again; a source still cleaning up crashes it,
          // which its status shows. Its cleanup dropped its listeners.
          listen()
          void (query as { reload?: () => Promise<void> })
            .reload?.()
            .catch(() => undefined)
          await flushPromises()
        } else if (step.kind === `reload-query`) {
          const reload = (query as { reload?: () => Promise<void> }).reload?.()
          if (query.status === `crashed`)
            thrown = await reload?.catch((e: unknown) => e)
          else void reload?.catch(() => undefined)
          await flushPromises()
        } else if (step.kind === `restart`) {
          await settleCleanups()
          // The app ends its readers before it cleans up their Collections.
          await effect?.dispose()
          await query.cleanup()
          await inner?.cleanup({ dependents: true })
          await Promise.all([
            sources.A.collection.cleanup(),
            sources.B.collection.cleanup(),
          ])
          mirror()
          begin()
        } else if (shapeSources[shape].includes(step.source)) {
          const params = sources[step.source].params
          if (step.kind === `reload` || step.kind === `reload-cleanup-held`) {
            // A reload settles only when its new run commits or fails; a
            // crashed Collection, or one whose cleanup is pending, rejects at
            // once.
            if (step.kind === `reload-cleanup-held`)
              sources[step.source].holdNextCleanup()
            const reload = params.collection.reload()
            sources[step.source].holdNextCleanup(false)
            if (params.collection.status === `crashed` || pre!.cleaning)
              thrown = await reload.catch((e: unknown) => e)
            else void reload.catch(() => undefined)
          } else if (step.kind === `retired-cleanup-rejects`) {
            sources[step.source].rejectRetiredCleanup()
            await flushPromises()
          } else if (step.kind === `reload-cleanup-fails`) {
            sources[step.source].failNextCleanup()
            const reload = params.collection.reload()
            if (params.collection.status === `crashed` || pre!.cleaning)
              thrown = await reload.catch((e: unknown) => e)
            else {
              void reload.catch(() => undefined)
              await flushPromises()
            }
            sources[step.source].failNextCleanup(false)
          } else if (step.kind === `ready`) {
            // A first load's or a reload's run commits row 1 before
            // markReady(), in its open transaction if it has one.
            if (pre!.loading) {
              if (!pre!.open) params.begin()
              writeDiffing(params, 1, tag)
              params.commit()
            }
            params.markReady()
          } else if (step.kind === `direct-write`) {
            if (!pre!.open) {
              params.begin({ direct: true })
              const kept =
                params.collection._state.getAcceptedSyncedRow(step.key) !==
                undefined
              params.write({
                type: kept ? `update` : `insert`,
                value: { id: step.key, parentId: step.key, tag: model.serial },
              })
              params.commit()
            }
          } else if (step.kind === `write`) {
            if (!pre!.open) params.begin()
            writeDiffing(params, step.key, tag, step.untagged)
          } else if (step.kind === `commit`) {
            if (!pre!.open) params.begin()
            params.commit()
          } else if (step.kind === `truncate`) {
            if (!pre!.open) params.begin()
            params.truncate(
              step.markReady === false ? { markReady: false } : undefined,
            )
          } else if (step.kind === `cancel`) {
            const canceled = new AbortController()
            canceled.abort()
            if (!pre!.open) {
              params.begin()
              writeDiffing(params, 1, tag)
            }
            try {
              params.commit(canceled.signal)
            } catch {
              // A canceled commit may throw its abort reason.
            }
            await flushPromises()
          } else if (step.kind === `fail`) {
            params.fail(reported(new Error(`${step.source} gave up`)))
          } else if (step.kind === `healthy`) {
            params.reportHealthy()
          } else if (step.kind === `crash`) {
            params.collection._lifecycle.crash(
              new Error(`${step.source} crashed`),
            )
          } else {
            params.reportError(reported(new Error(`${step.source} problem`)))
          }
        }
      } catch (error) {
        thrown = error
      }
      await flushPromises()

      if (expected !== `ok`) {
        expect(thrown, `${label}: contract violation throws`).toBeDefined()
        if (expected === `bad-transition`) {
          expect(thrown, label).toBeInstanceOf(
            InvalidCollectionStatusTransitionError,
          )
        }
      } else {
        expect(thrown, `${label}: legal step`).toBeUndefined()
      }
      expect(query.status, `${label}: gate`).toBe(
        model.query.gate as CollectionStatus,
      )
      if (reloadCleanup) await expectReloadEnded(reloadCleanup, label)
      // Rows: each Collection shows its applied rows, and a diffing adapter
      // reads the baseline. A ready query shows the rows its shape derives
      // from them. Nothing reads a crashed Collection's baseline.
      for (const name of shapeSources[shape]) {
        const source = model.sources[name]
        const collection = sources[name].collection
        expect(tagsOf(collection.toArray), `${label}: ${name} rows`).toEqual(
          sortedTags(source.rows),
        )
        if (source.cleaning || source.retired) mirrored[name] = false
        // A source that started again after cleanup, by any path, gets a
        // fresh direct subscriber.
        else if (directSubscribers && !mirrored[name]) mirrorSource(name)
        if (mirrored[name])
          expect(
            sortedTags(mirrors[name]),
            `${label}: ${name} direct subscriber rows`,
          ).toEqual(sortedTags(source.rows))
        // Cleanup ends the run at the adapter, and nothing starts one until
        // the Collection starts again.
        if (source.retired)
          expect(
            sources[name].liveRuns(),
            `${label}: ${name} sync runs live after cleanup`,
          ).toBe(0)
        if (source.gate === `crashed`) continue
        expect(
          sortedTags(
            new Map(
              [...collection._state.replacementBaseline()].map(([key, row]) => [
                key,
                row.tag ?? 0,
              ]),
            ),
          ),
          `${label}: ${name} baseline`,
        ).toEqual(sortedTags(expectedBaseline(source)))
      }
      if (model.query.gate === `ready`) {
        expect(size(), `${label}: query rows`).toBe(
          expectedQuerySize(shape, model),
        )
      }
      // The Effect ends once, through onSourceError. One that ends as it is
      // created, over a stopped source, leaves nothing on that source.
      expect(effect!.disposed, `${label}: effect ended`).toBe(
        !model.effect.live,
      )
      expect(effectErrors.length, `${label}: effect source errors`).toBe(
        model.effect.errors,
      )
      if (step.kind === `effect` && !model.effect.live) {
        expect(
          listenersOn(sources.A.collection),
          `${label}: listeners left by the ended effect`,
        ).toBe(listenersBeforeEffect)
      }
      const tree = expectedTree(shape, model)
      const next = query.health
      expect(project(next), `${label}: health tree`).toEqual(tree)
      expect(
        findProblems(next).map(problemOf),
        `${label}: findProblems`,
      ).toEqual(expectedProblems(tree))

      // Identity: a reader can compare trees with `===`. Reading twice gives
      // the same tree, and a step replaces exactly the nodes on the path to
      // what changed.
      expect(query.health === next, `${label}: stable read`).toBe(true)
      const after = expectedTree(shape, model, true)
      if (step.kind !== `restart`) {
        expectIdentity(previous, next, before, after, label)
      }
      previous = next

      // Order: `status:change` comes first and `health:change` follows it at
      // once, so no `health:change` shows a status that `status:change` has
      // not announced. The last event leaves a reader with the current tree.
      if (step.kind !== `restart`) {
        for (const [at, event] of events.entries()) {
          expect(event.status, `${label}: event ${at} status announced`).toBe(
            event.announced,
          )
          if (event.kind === `status`) {
            expect(
              events[at + 1]?.kind,
              `${label}: health follows status`,
            ).toBe(`health`)
          }
        }
        // A query a cleanup ended announces nothing more; a read still
        // shows the current tree.
        if (
          !model.queryEnded &&
          !model.queryDetached &&
          JSON.stringify(before) !== JSON.stringify(after)
        ) {
          expect(
            events.at(-1)?.tree,
            `${label}: last event is current`,
          ).toEqual(tree)
          // Law 17: a report or a healthy call is one change, also when it
          // only adds a failure to the frame or empties it, so the query
          // announces it once.
          if (
            expected === `ok` &&
            (step.kind === `report` || step.kind === `healthy`)
          )
            expect(
              events.filter((event) => event.kind === `health`).length,
              `${label}: one health:change`,
            ).toBe(1)
        }
      }
    }
  } finally {
    console.error = consoleError
    stop()
    for (const subscription of Object.values(mirrorSubscriptions))
      subscription.unsubscribe()
    await settleCleanups()
    await effect?.dispose()
    await query.cleanup()
    await inner?.cleanup({ dependents: true })
    await Promise.all([
      sources.A.collection.cleanup(),
      sources.B.collection.cleanup(),
    ])
  }
}

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

const shapes: ReadonlyArray<Shape> = [
  `direct`,
  `join`,
  `self-join`,
  `nested`,
  `include`,
  `pooled-nested`,
]
const on = (kind: SourceStepKind, source: SourceName): Step => ({
  kind,
  source,
})
const restart: Step = { kind: `restart` }

// Named histories, one per distinction the law draws.
const namedHistories: Record<string, ReadonlyArray<Step>> = {
  // A direct write during a reload applies to the kept rows; the reload's
  // first snapshot commit still replaces every row.
  'a direct write during a reload keeps the other rows and the reload': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 2 },
    { kind: `commit`, source: `A` },
    on(`reload`, `A`),
    { kind: `direct-write`, source: `A`, key: 2 },
    on(`ready`, `A`),
  ],
  // The cleaned-up run's reload decides nothing for a later reload.
  "a cleanup's late end of a reload does not end a newer reload": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 1, untagged: true },
    { kind: `cleanup-reload`, source: `A` },
  ],
  'a second fail() in the sync run does nothing': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`fail`, `A`),
    on(`fail`, `A`),
  ],
  'a second fail() after a failed first load does nothing': [
    on(`fail`, `A`),
    on(`fail`, `A`),
  ],
  "a cascade cancels a query's reload that waits for its sources": [
    on(`fail`, `A`),
    { kind: `reload-query` },
    { kind: `cleanup-hold`, source: `B` },
    on(`ready`, `A`),
  ],
  "a truncate's markReady after fail() on a ready Collection does nothing": [
    { kind: `ready`, source: `A` },
    { kind: `ready`, source: `B` },
    { kind: `reload`, source: `A` },
    { kind: `write`, source: `A`, key: 1, untagged: true },
    { kind: `truncate`, source: `A`, markReady: true },
    { kind: `fail`, source: `A` },
    { kind: `commit`, source: `A` },
  ],
  'a cleanup after a crash that followed cleanup settles at once': [
    { kind: `cleanup-hold`, source: `A` },
    { kind: `cleanup-settle`, source: `A` },
    { kind: `crash`, source: `A` },
    { kind: `cleanup-hold`, source: `A` },
  ],
  "a reload's default truncate after a failed first load makes it ready": [
    on(`fail`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    { kind: `truncate`, source: `A` },
    { kind: `write`, source: `A`, key: 1 },
    { kind: `commit`, source: `A` },
  ],
  'an inner query that crashes as it starts stops the outer start': [
    { kind: `cleanup-hold`, source: `A` },
    { kind: `cleanup-hold`, source: `B` },
    { kind: `cleanup-settle`, source: `B` },
    { kind: `reload-query` },
  ],
  "a query's reload after a cascade reloads a failed source first": [
    on(`ready`, `A`),
    on(`fail`, `B`),
    { kind: `cleanup-hold`, source: `A` },
    { kind: `cleanup-settle`, source: `A` },
    { kind: `reload-query` },
    on(`ready`, `B`),
    on(`ready`, `A`),
  ],
  "a failed reload keeps the adapter's own truncate": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 2 },
    { kind: `commit`, source: `A` },
    on(`reload`, `A`),
    { kind: `truncate`, source: `A`, markReady: false },
    { kind: `write`, source: `A`, key: 3 },
    on(`fail`, `A`),
    { kind: `commit`, source: `A` },
  ],
  "a failed reload's open write of a kept row applies on the kept rows": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 1 },
    on(`fail`, `A`),
    { kind: `commit`, source: `A` },
  ],
  "a retired run's late cleanup failure crashes the Collection": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload-cleanup-held`, `A`),
    on(`ready`, `A`),
    on(`retired-cleanup-rejects`, `A`),
  ],
  "a retired run's cleanup failure after a cleanup crashes the fresh run": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload-cleanup-held`, `A`),
    { kind: `cleanup-hold`, source: `A` },
    { kind: `cleanup-settle`, source: `A` },
    { kind: `restart` },
    on(`ready`, `A`),
    on(`retired-cleanup-rejects`, `A`),
  ],
  "a canceled reload commit with the adapter's own truncate keeps the replacement armed":
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`reload`, `A`),
      { kind: `write`, source: `A`, key: 1, untagged: true },
      { kind: `truncate`, source: `A`, markReady: false },
      on(`cancel`, `A`),
    ],
  "a failed reload's open insert of a kept row replaces it": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 1, untagged: true },
    on(`fail`, `A`),
    { kind: `commit`, source: `A` },
  ],
  'a crash during a reload still applies its open write of a kept row': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 1 },
    on(`crash`, `A`),
    { kind: `commit`, source: `A` },
  ],
  'a crash during cleanup lasts until cleanup settles': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `cleanup-hold`, source: `A` },
    on(`crash`, `A`),
    on(`reload`, `A`),
    { kind: `cleanup-settle`, source: `A` },
    on(`crash`, `A`),
    on(`reload`, `A`),
  ],
  "a query's reload after a cascade starts it and its sources again": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `cleanup-hold`, source: `A` },
    { kind: `cleanup-settle`, source: `A` },
    { kind: `reload-query` },
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  "a query's reload while a source cleans up crashes it": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `cleanup-hold`, source: `A` },
    { kind: `reload-query` },
    { kind: `cleanup-settle`, source: `A` },
  ],
  'an Effect created during cleanup ends with a source error': [
    on(`ready`, `A`),
    { kind: `cleanup-hold`, source: `A` },
    { kind: `effect` },
    { kind: `cleanup-settle`, source: `A` },
  ],
  'a reload rejects while adapter cleanup is pending, and starts fresh after it':
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`report`, `A`),
      { kind: `cleanup-hold`, source: `A` },
      on(`reload`, `A`),
      { kind: `write`, source: `A`, key: 2 },
      { kind: `cleanup-settle`, source: `A` },
      on(`reload`, `A`),
      on(`ready`, `A`),
    ],
  "cleanup keeps a failed first load's cause while the status shows it": [
    on(`fail`, `A`),
    { kind: `cleanup-hold`, source: `A` },
    on(`report`, `A`),
    { kind: `cleanup-settle`, source: `A` },
  ],
  'a cascade cleanup ends the Effect without a source error': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `cleanup-hold`, source: `A` },
    { kind: `effect` },
    { kind: `cleanup-settle`, source: `A` },
    { kind: `effect` },
    on(`ready`, `A`),
  ],
  "a crash during a reload keeps the rows as the adapter's baseline": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    on(`crash`, `A`),
    { kind: `write`, source: `A`, key: 1 },
    { kind: `commit`, source: `A` },
  ],
  "a crash during a reload stops the reload's transaction replacing rows": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 3 },
    { kind: `commit`, source: `A` },
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 2 },
    on(`crash`, `A`),
    { kind: `commit`, source: `A` },
  ],
  "a query's reload replaces the rows its failed run left": [
    on(`ready`, `A`),
    on(`fail`, `B`),
    { kind: `reload-query` },
    on(`ready`, `B`),
  ],
  "a reload's first transaction replaces every row": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 2 },
    { kind: `commit`, source: `A` },
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 3 },
    { kind: `commit`, source: `A` },
  ],
  "a failed reload's open transaction applies on the kept rows": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 2 },
    { kind: `commit`, source: `A` },
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 3 },
    on(`fail`, `A`),
    { kind: `commit`, source: `A` },
  ],
  "a failed reload keeps the rows as the adapter's baseline": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    on(`fail`, `A`),
    { kind: `write`, source: `A`, key: 1 },
    { kind: `commit`, source: `A` },
  ],
  'a canceled reload transaction leaves the replacement for the next one': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 2 },
    { kind: `commit`, source: `A` },
    on(`reload`, `A`),
    { kind: `write`, source: `A`, key: 3 },
    on(`cancel`, `A`),
    { kind: `write`, source: `A`, key: 2 },
    { kind: `commit`, source: `A` },
  ],
  'a crashed Collection still applies the sync data its run commits': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    { kind: `write`, source: `A`, key: 2 },
    on(`crash`, `A`),
    { kind: `write`, source: `A`, key: 3 },
    { kind: `commit`, source: `A` },
  ],
  'a failure reason clears when the sync adapter reports healthy': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`report`, `A`),
    on(`healthy`, `A`),
  ],
  'fail after Collection readiness keeps the rows, and later reports throw': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`report`, `A`),
    on(`fail`, `A`),
    on(`report`, `A`),
    on(`healthy`, `A`),
    restart,
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  'a query reload reaches every Collection below it that stopped': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`fail`, `A`),
    { kind: `reload-query` },
    on(`ready`, `A`),
  ],
  'a query reload restarts a first load that failed below it': [
    on(`fail`, `A`),
    { kind: `reload-query` },
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  "a reload's first commit keeps a failure reason its new run reported": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`report`, `A`),
    on(`reload`, `A`),
    on(`report`, `A`),
    on(`ready`, `A`),
  ],
  "a canceled commit leaves a reload waiting for the run's next commit": [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`reload`, `A`),
    on(`cancel`, `A`),
    on(`ready`, `A`),
  ],
  'a reloaded source recovers while a nested source fails its first load': [
    on(`fail`, `B`),
    { kind: `reload-query` },
    on(`fail`, `A`),
    on(`ready`, `B`),
  ],
  'an initial error is final for its sync run': [
    on(`fail`, `A`),
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  'a restart recovers a sync run that failed': [
    on(`fail`, `A`),
    restart,
    on(`ready`, `A`),
    on(`ready`, `B`),
  ],
  'a crash after initial-query readiness crashes the query, and adapter calls do nothing':
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`report`, `A`),
      on(`crash`, `A`),
      on(`healthy`, `A`),
      restart,
      on(`ready`, `A`),
      on(`ready`, `B`),
    ],
  'a reload keeps everything visible until its new run commits': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`report`, `A`),
    on(`fail`, `A`),
    on(`reload`, `A`),
    on(`report`, `A`),
    on(`healthy`, `A`),
    on(`ready`, `A`),
  ],
  'a reload recovers a failed first load, and the query starts again': [
    on(`fail`, `A`),
    on(`reload`, `A`),
    on(`reload`, `A`),
    on(`ready`, `B`),
    on(`ready`, `A`),
  ],
  'a reload whose new run fails shows the new error': [
    on(`ready`, `A`),
    on(`ready`, `B`),
    on(`fail`, `A`),
    on(`reload`, `A`),
    on(`fail`, `A`),
    on(`fail`, `B`),
    on(`reload`, `A`),
  ],
  'a crashed Collection cannot reload': [
    on(`ready`, `A`),
    on(`crash`, `A`),
    on(`reload`, `A`),
  ],
  // A cleanup from a listener the reload notifies ends the reload with its
  // run: no run stays live, and the fresh run's commit is its baseline.
  ...Object.fromEntries(
    ([`source-health`, `query-health`] as const).map((at) => [
      `a cleanup from the ${at} notification ends the reload with its run`,
      [
        on(`ready`, `A`),
        on(`ready`, `B`),
        { kind: `cleanup-during-reload`, source: `A`, at } satisfies Step,
        on(`reload`, `A`),
        on(`ready`, `A`),
        { kind: `write`, source: `A`, key: 1 } satisfies Step,
        { kind: `commit`, source: `A` } satisfies Step,
      ],
    ]),
  ),
  // A cleanup of a cleaned-up Collection has no run to wait for, so it
  // settles at once; a reload then starts a fresh run, which the next
  // listener cleanup ends (a 30-times counterexample of the driver, which
  // held the fresh run's cleanup).
  'a cleanup after a cleanup during a reload settles at once': [
    on(`ready`, `B`),
    { kind: `cleanup-during-reload`, source: `B`, at: `source-health` },
    { kind: `cleanup-hold`, source: `B` },
    { kind: `cleanup-during-reload`, source: `B`, at: `query-health` },
  ],
  // The query's reload passes through the nested query that a cascade ended:
  // that inner query is a Collection below it that shows A's error, so its
  // own reload reloads A and then starts it, while B's reload rejects and
  // the outer query does not start (a 30-times counterexample of the model,
  // which reloaded A past the ended inner query).
  'a query reload starts an ended nested query even when another source rejects':
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      { kind: `cleanup-during-reload`, source: `A`, at: `source-health` },
      on(`reload`, `A`),
      on(`ready`, `A`),
      on(`reload-cleanup-fails`, `B`),
      on(`fail`, `A`),
      { kind: `reload-query` },
      { kind: `commit`, source: `A` },
    ],
  'a report before Collection readiness throws': [
    on(`report`, `A`),
    on(`healthy`, `B`),
    on(`ready`, `A`),
  ],
}

describe(`source failure and health oracle`, () => {
  for (const shape of shapes) {
    for (const [name, steps] of Object.entries(namedHistories)) {
      it(`${shape}: ${name}`, () => runHistory(shape, steps))
    }
  }

  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    {
      weight: 2,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`A` as const, `B` as const),
          fc.constantFrom(1 as const, 2 as const, 3 as const),
          fc.boolean(),
        )
        .map(([source, key, untagged]): Step =>
          untagged
            ? { kind: `write`, source, key, untagged }
            : { kind: `write`, source, key },
        ),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`commit` as const, `truncate` as const),
          fc.constantFrom(`A` as const, `B` as const),
          fc.boolean(),
        )
        .map(([kind, source, markReady]): Step =>
          kind === `truncate` ? { kind, source, markReady } : { kind, source },
        ),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`A` as const, `B` as const),
          fc.constantFrom(1 as const, 2 as const, 3 as const),
        )
        .map(([source, key]): Step => ({ kind: `direct-write`, source, key })),
    },
    { weight: 1, arbitrary: fc.constant(restart) },
    { weight: 1, arbitrary: fc.constant({ kind: `reload-query` } as const) },
    { weight: 1, arbitrary: fc.constant({ kind: `effect` } as const) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(
            `cleanup-hold` as const,
            `cleanup-settle` as const,
            `cleanup-reload` as const,
          ),
          fc.constantFrom(`A` as const, `B` as const),
        )
        .map(([kind, source]): Step => ({ kind, source })),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`source-health` as const, `query-health` as const),
          fc.constantFrom(`A` as const, `B` as const),
        )
        .map(([at, source]): Step => ({
          kind: `cleanup-during-reload`,
          source,
          at,
        })),
    },
    {
      weight: 6,
      arbitrary: fc
        .tuple(
          fc.constantFrom(
            `ready` as const,
            `fail` as const,
            `report` as const,
            `healthy` as const,
            `crash` as const,
            `reload` as const,
            `reload-cleanup-fails` as const,
            `reload-cleanup-held` as const,
            `retired-cleanup-rejects` as const,
            `cancel` as const,
          ),
          fc.constantFrom(`A` as const, `B` as const),
        )
        .map(([kind, source]) => on(kind, source)),
    },
  )
  // Prefixes that enter a declared reach state that random steps alone rarely
  // reach at the base run count; random steps follow each one.
  const reachPrefixes: ReadonlyArray<ReadonlyArray<Step>> = [
    // A reload's open insert of a row the Collection keeps. Before it, a
    // failure reason's frame grows and clears with failures listed, and the
    // reload's new run reports while the retired run's frame shows. The
    // reload then ends before its first commit.
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`report`, `A`),
      on(`report`, `A`),
      on(`healthy`, `A`),
      on(`report`, `A`),
      on(`reload`, `A`),
      on(`report`, `A`),
      { kind: `write`, source: `A`, key: 1, untagged: true },
      on(`fail`, `A`),
    ],
    // A retired run's cleanup that rejects after a cleanup and a fresh start.
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`reload-cleanup-held`, `A`),
      { kind: `restart` },
      on(`ready`, `A`),
      on(`retired-cleanup-rejects`, `A`),
    ],
    // Cleanup, a fresh start, and a reload while a reload's transaction is
    // open.
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`reload`, `A`),
      { kind: `write`, source: `A`, key: 1 },
      { kind: `cleanup-reload`, source: `A` },
    ],
    // A direct write while a reload's replacement is armed.
    [
      on(`ready`, `A`),
      on(`ready`, `B`),
      on(`reload`, `A`),
      { kind: `direct-write`, source: `A`, key: 2 },
    ],
    // fail() on a source whose adapter already stopped.
    [on(`ready`, `A`), on(`ready`, `B`), on(`fail`, `A`), on(`fail`, `A`)],
    // A cleanup from each listener the reload notifies, then a fresh start
    // whose run commits.
    ...([`source-health`, `query-health`] as const).map((at) => [
      on(`ready`, `A`),
      on(`ready`, `B`),
      { kind: `cleanup-during-reload` as const, source: `A` as const, at },
      on(`reload`, `A`),
      on(`ready`, `A`),
    ]),
  ]
  const historyReach = createOracleReach(
    `source-health.history`,
    historyReachStates,
  )
  let historiesRan = false
  fcTest.prop(
    [
      fc.constantFrom(...shapes),
      fc
        .tuple(
          fc.option(fc.constantFrom(...reachPrefixes), { freq: 3 }),
          fc.array(stepArb, { maxLength: 12 }),
        )
        .map(([prefix, rest]): Array<Step> => [...(prefix ?? []), ...rest]),
      fc.boolean(),
    ],
    oraclePropertyOptions(60, `source-health.history`),
  )(
    `generated histories refine the model`,
    (shape, steps, directSubscribers) => {
      historiesRan = true
      historyReach.beginHistory()
      return withDeadline(
        runHistory(shape, steps, directSubscribers, historyReach),
      )
    },
    120_000,
  )
  afterAll(() => {
    if (historiesRan) historyReach.assertReached()
  })
})

// ---------------------------------------------------------------------------
// Request lane
// ---------------------------------------------------------------------------

/**
 * A live query's lazy source loads only the keys its rows reach, and an
 * on-demand root source loads the window the query shows. After the query's
 * initial-query readiness, a load that fails is a request error on the query's own node:
 * the source stays healthy and the query keeps its status. A lazy demand's
 * error clears when the same demand later settles, or when the query stops
 * needing it; a root source's error clears when a later load of that source
 * settles. Before initial-query readiness, the same failure fails the query's sync run.
 */
// ---------------------------------------------------------------------------
// Reload invariant witness
// ---------------------------------------------------------------------------

// A reload retires its sync run, and the retired run's `commit()` can no
// longer reach a transaction it left open. That transaction has no public
// observation (its writes never apply), so this witness checks the
// invariant directly: after the reload no transaction stays open, and the
// new run's own commit decides the row.
// ---------------------------------------------------------------------------
// Problem values
// ---------------------------------------------------------------------------

/**
 * `fail()`, `reportError()`, and a crash accept any value as the problem. The
 * law: the value never changes what the call does. Status, node, and a
 * reload's promise follow the same rules as for an `Error`, and the node's
 * problem keeps the value as its `cause`. A value that cannot describe
 * itself (no prototype, a throwing getter) shows the generic message. The
 * lane crosses each call site with each kind of value.
 */
describe(`problem values`, () => {
  const values: Record<string, () => unknown> = {
    error: () => new Error(`gave up`),
    string: () => `gave up`,
    'no prototype': () => Object.create(null),
    'throwing getter': () => ({
      get code() {
        throw new Error(`getter`)
      },
      toString() {
        throw new Error(`toString`)
      },
    }),
  }
  const sites = [
    `fail before ready`,
    `fail after ready`,
    `fail during a reload`,
    `reportError`,
    `crash`,
  ] as const
  const cases = sites.flatMap((site) =>
    Object.keys(values).map((value) => ({ site, value })),
  )
  it.each(cases)(`%j`, async ({ site, value }) => {
    let params!: SyncParams
    const collection = createCollection<Row, number>({
      id: `health-problem-value-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
        },
      },
    })
    const problem = values[value]!()
    void collection.preload().catch(() => undefined)
    await flushPromises()
    let reload: Promise<void> | undefined
    if (site !== `fail before ready`) {
      params.markReady()
      if (site === `fail during a reload`) {
        reload = collection.reload()
        void reload.catch(() => undefined)
      }
    }
    if (site === `reportError`) params.reportError(problem)
    else if (site === `crash`) collection._lifecycle.crash(problem)
    else params.fail(problem)
    await flushPromises()
    const shown =
      site === `fail before ready` || site === `crash`
        ? collection.health.error
        : site === `reportError`
          ? collection.health.failureReason
          : collection.health.error
    expect(collection.status).toBe(
      site === `fail before ready`
        ? `error`
        : site === `crash`
          ? `crashed`
          : `ready`,
    )
    expect(shown?.cause, `the node keeps the value`).toBe(problem)
    expect(typeof shown?.message).toBe(`string`)
    // One call is one failure in the problem's frame, and it is the one the
    // problem shows. JSON keeps every failure's facts and leaves out causes.
    expect(shown?.errors.length, `one failure listed`).toBe(1)
    expect(shown?.errors[0]?.cause, `the listed failure's value`).toBe(problem)
    const facts = JSON.parse(JSON.stringify(shown!.errors[0]))
    expect(facts, `JSON leaves out the cause`).not.toHaveProperty(`cause`)
    expect(JSON.parse(JSON.stringify(shown))).toEqual({
      ...facts,
      errors: [facts],
    })
    if (reload)
      await expect(reload, `a failed reload settles`).rejects.toBe(problem)
    await collection.cleanup()
  })
})

describe(`reload invariant`, () => {
  // A query's reload() settles with the query: after its failed source
  // recovers, the query reloads itself, and the reload waits for that run to
  // be ready (or to fail).
  it(`settles a query reload with the query's restarted run`, async () => {
    let runs = 0
    const loads: Array<ReturnType<typeof createDeferred<void>>> = []
    const parents = createCollection<Row, number>({
      id: `health-query-reload-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          if (runs++ === 0) {
            params.fail(new Error(`first load failed`))
            return
          }
          params.begin()
          params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
          params.commit()
          params.markReady()
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-query-reload-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              const load = createDeferred<void>()
              loads.push(load)
              return load.promise
            },
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.id, child.parentId),
        ),
    )
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload().catch(() => undefined)
      expect(query.status).toBe(`error`)
      let settled = false
      const reload = query.reload().finally(() => {
        settled = true
      })
      await flushPromises()
      // The query's own reload waits for its join load: it keeps `error` and
      // shows `reloading`, and the reload waits too.
      expect(query.status).toBe(`error`)
      expect(query.health.reloading).toBe(true)
      expect(settled, `reload settled before the query's run was ready`).toBe(
        false,
      )
      for (const load of loads) load.resolve()
      await reload
      expect(query.status).toBe(`ready`)
    } finally {
      console.error = consoleError
      for (const load of loads) load.resolve()
      await query.cleanup()
      await parents.cleanup()
      await children.cleanup()
    }
  })

  // A throwing sync function is a programming error in any run. During a
  // reload of a failed first load the status still shows `error`, but this
  // run did not fail, so the throw crashes the Collection.
  it(`crashes when a reload's sync function throws after a failed first load`, async () => {
    let runs = 0
    const collection = createCollection<Row, number>({
      id: `health-reload-throw-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          if (runs++ === 0) params.fail(new Error(`first load failed`))
          else throw new Error(`sync threw`)
        },
      },
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await collection.preload().catch(() => undefined)
      expect(collection.status).toBe(`error`)
      await expect(collection.reload()).rejects.toThrow(`sync threw`)
      expect(collection.status).toBe(`crashed`)
      expect(collection.health.reloading).toBe(false)
    } finally {
      console.error = consoleError
      await collection.cleanup()
    }
  })

  // A reload's next commit replaces every synced row, so the baseline an
  // adapter diffs against is empty until that commit. An adapter that writes
  // only rows missing from the baseline, as Query Collections do, must still
  // rebuild every row.
  it(`gives a diffing adapter an empty baseline for the reload's commit`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    const writeMissing = (rows: Array<Row>) => {
      const params = source.params
      const baseline = new Map(params.collection._state.replacementBaseline())
      params.begin()
      for (const row of rows)
        if (!baseline.has(row.id)) params.write({ type: `insert`, value: row })
      params.commit()
      params.markReady()
    }
    writeMissing([{ id: 1, parentId: 1 }])
    const reload = source.collection.reload()
    writeMissing([{ id: 1, parentId: 1 }])
    await reload
    expect([...source.collection.keys()]).toEqual([1])
    await source.collection.cleanup()
  })

  // Cleanup start closes restart admission (ARCHITECTURE law 14), and a
  // reload starts a sync run. While adapter cleanup is pending, a reload
  // rejects as a start would, and no sync run starts under the cleanup.
  it(`rejects a reload while adapter cleanup is pending`, async () => {
    let runs = 0
    const adapterCleanup = createDeferred<void>()
    const collection = createCollection<Row, number>({
      id: `health-reload-during-cleanup-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          runs++
          params.markReady()
          return () => adapterCleanup.promise
        },
      },
    })
    await collection.preload()
    const cleaned = collection.cleanup()
    await expect(collection.reload()).rejects.toThrow(/during cleanup/)
    expect(runs).toBe(1)
    adapterCleanup.resolve()
    await cleaned
    expect(collection.status).toBe(`cleaned-up`)
    expect(runs).toBe(1)
  })

  // Cleanup start drops the discarded run's problems while the status waits
  // for adapter cleanup. Every change to the tree is announced, so the drop
  // is too: the last health:change before the status change shows no
  // problem. The cause of a `crashed` or `error` status stays while that
  // status shows.
  it.each([`report`, `fail`, `crash`, `first-load-error`] as const)(
    `announces the problems that cleanup start drops: %s`,
    async (problem) => {
      const adapterCleanup = createDeferred<void>()
      let params!: SyncParams
      const collection = createCollection<Row, number>({
        id: `health-cleanup-drop-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: (next) => {
            params = next
            if (problem === `first-load-error`)
              next.fail(new Error(`first load failed`))
            else next.markReady()
            return () => adapterCleanup.promise
          },
        },
      })
      await collection.preload().catch(() => undefined)
      if (problem === `report`) params.reportError(new Error(`stalled`))
      else if (problem === `fail`) params.fail(new Error(`stopped`))
      else if (problem === `crash`)
        collection._lifecycle.crash(new Error(`crashed`))
      const announced: Array<HealthNode> = []
      collection.on(`health:change`, () => announced.push(collection.health))
      const cleaned = collection.cleanup()
      // A status's own cause stays while that status shows.
      const keepsCause = problem === `crash` || problem === `first-load-error`
      expect(collection.status).toBe(
        problem === `crash`
          ? `crashed`
          : problem === `first-load-error`
            ? `error`
            : `ready`,
      )
      if (keepsCause) {
        expect(collection.health.error?.message).toBe(
          problem === `crash` ? `crashed` : `first load failed`,
        )
        expect(announced).toEqual([])
      } else {
        expect(collection.health.hasErrors).toBe(false)
        expect(announced.at(-1)?.hasErrors).toBe(false)
      }
      adapterCleanup.resolve()
      await cleaned
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.health.hasErrors).toBe(false)
    },
  )

  // A ready callback that throws reaches the adapter's markReady(), on a
  // start and on a reload alike. The reload itself succeeded once the status
  // is ready, so it resolves, as a start's preload does.
  it.each([`sync`, `async`] as const)(
    `settles a reload whose ready callback throws: %s markReady`,
    async (timing) => {
      let runs = 0
      const collection = createCollection<Row, number>({
        id: `health-reload-ready-throw-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: (params) => {
            if (runs++ === 0) {
              params.fail(new Error(`first load failed`))
              return
            }
            if (timing === `sync`) params.markReady()
            else
              setTimeout(() => {
                expect(() => params.markReady()).toThrow(`callback threw`)
              }, 0)
          },
        },
      })
      await collection.preload().catch(() => undefined)
      collection.onFirstReady(() => {
        throw new Error(`callback threw`)
      })
      const settled = await Promise.race([
        collection.reload().then(
          () => `resolved`,
          () => `rejected`,
        ),
        new Promise((resolve) => setTimeout(() => resolve(`pending`), 200)),
      ])
      expect(settled).toBe(`resolved`)
      expect(collection.status).toBe(`ready`)
      expect(collection.health.reloading).toBe(false)
      await collection.cleanup()
    },
  )

  // A live query that never started has no run yet. Its reload starts it,
  // as any Collection's reload starts an idle one, after it reloads a source
  // whose first load failed.
  it.each([`ready`, `failed`] as const)(
    `starts a never-started live query on reload: source %s`,
    async (sourceState) => {
      let runs = 0
      const source = createCollection<Row, number>({
        id: `health-idle-query-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        startSync: true,
        sync: {
          sync: (params) => {
            if (runs++ === 0 && sourceState === `failed`) {
              params.fail(new Error(`first load failed`))
              return
            }
            params.begin()
            params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
            params.commit()
            params.markReady()
          },
        },
      })
      await source.preload().catch(() => undefined)
      const query = createLiveQueryCollection({
        query: (q) => q.from({ row: source }),
        startSync: false,
      })
      expect(query.status).toBe(`idle`)
      try {
        await query.reload()
        expect(query.status).toBe(`ready`)
        expect(query.size).toBe(1)
        expect(source.status).toBe(`ready`)
      } finally {
        await query.cleanup()
        await source.cleanup()
      }
    },
  )

  // A reload whose new run fails keeps the rows, so they stay the baseline
  // that a diffing adapter, such as query-db, reads for its next write.
  // A transaction the new run opened before it failed is no longer the
  // reload's replacement: when it commits, its writes apply on the kept rows.
  it.each([`no open transaction`, `an open transaction`] as const)(
    `keeps the rows as the baseline after the reload's new run fails with %s`,
    async (open) => {
      const source = createSource(`A`)
      source.collection.startSyncImmediate()
      source.params.begin()
      source.params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
      source.params.commit()
      source.params.markReady()
      const reload = source.collection.reload().catch(() => undefined)
      if (open === `an open transaction`) {
        source.params.begin()
        source.params.write({ type: `insert`, value: { id: 2, parentId: 2 } })
      }
      source.params.fail(new Error(`reload failed`))
      await reload
      const baseline = [
        ...source.params.collection._state.replacementBaseline(),
      ]
      expect(baseline.map(([key]) => key)).toEqual(
        open === `an open transaction` ? [1, 2] : [1],
      )
      expect([...source.collection.keys()]).toEqual([1])
      if (open === `an open transaction`) {
        await source.params.commit()
        expect([...source.collection.keys()].sort()).toEqual([1, 2])
      }
      expect(source.collection.status).toBe(`ready`)
      expect(source.collection.health.error?.message).toBe(`reload failed`)
      await source.collection.cleanup()
    },
  )

  // The oracle's driver writes one row key, so it cannot see rows that a
  // reload failed to replace. This witness writes a new key in the new run.
  it(`replaces the rows at the commit after a canceled first commit`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    const first = source.params
    first.begin()
    first.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    first.commit()
    first.markReady()
    const reload = source.collection.reload()
    const next = source.params
    const canceled = new AbortController()
    canceled.abort()
    next.begin()
    next.write({ type: `insert`, value: { id: 3, parentId: 3 } })
    try {
      next.commit(canceled.signal)
    } catch {
      // A canceled commit may throw its abort reason.
    }
    // The run continues at once, before the canceled receipt settles.
    next.begin()
    next.write({ type: `insert`, value: { id: 2, parentId: 2 } })
    next.commit()
    next.markReady()
    await reload
    expect(source.collection.health.reloading).toBe(false)
    expect([...source.collection.keys()]).toEqual([2])
    await source.collection.cleanup()
  })

  it(`drops the retired run's open sync transaction`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    const first = source.params
    first.begin()
    first.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    first.commit()
    first.markReady()
    first.begin()
    first.write({ type: `insert`, value: { id: 2, parentId: 0 } })
    const reload = source.collection.reload()
    const next = source.params
    next.begin()
    next.write({ type: `insert`, value: { id: 2, parentId: 2 } })
    next.commit()
    next.markReady()
    await reload
    expect(
      source.collection._state.pendingSyncedTransactions.filter(
        (transaction) => !transaction.committed,
      ),
    ).toEqual([])
    expect(source.collection.get(2)).toMatchObject({ id: 2, parentId: 2 })
    await source.collection.cleanup()
  })
})

describe(`request errors`, () => {
  function createRequestHistory() {
    let parentParams!: SyncParams
    const outcomes: Array<`ok` | `fail` | `hold`> = []
    const held: Array<ReturnType<typeof createDeferred<void>>> = []
    const parents = createCollection<Row, number>({
      id: `health-request-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          parentParams = params
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-request-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (_options: LoadSubsetOptions) => {
              const outcome = outcomes.shift() ?? `ok`
              if (outcome === `hold`) {
                const load = createDeferred<void>()
                held.push(load)
                return load.promise
              }
              return outcome === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`child load failed`))
            },
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.id, child.parentId),
        ),
    )
    const writeParent = (type: `insert` | `delete`, id: number) => {
      parentParams.begin()
      parentParams.write({ type, value: { id, parentId: id } })
      parentParams.commit()
    }
    const markParentsReady = () => parentParams.markReady()
    return {
      parents,
      children,
      query,
      outcomes,
      held,
      writeParent,
      markParentsReady,
    }
  }

  async function withHistory(
    run: (history: ReturnType<typeof createRequestHistory>) => Promise<void>,
  ) {
    const history = createRequestHistory()
    expect(
      history.query.health,
      `the query exposes a health tree`,
    ).toBeDefined()
    const consoleError = console.error
    console.error = () => {}
    try {
      await run(history)
    } finally {
      console.error = consoleError
      await history.query.cleanup()
      await history.parents.cleanup()
      await history.children.cleanup()
    }
  }

  it(`a failed load after initial-query readiness is a request error that clears when its demand settles`, () =>
    withHistory(
      async ({ query, children, outcomes, writeParent, markParentsReady }) => {
        const preload = query.preload()
        writeParent(`insert`, 1)
        markParentsReady()
        await preload
        expect(query.health.hasErrors).toBe(false)

        outcomes.push(`fail`)
        writeParent(`insert`, 2)
        await flushPromises()
        expect(query.status).toBe(`ready`)
        expect(query.health.error).toMatchObject({
          message: `child load failed`,
        })
        expect(query.health.failureReason).toBeNull()
        expect(children.health.hasErrors).toBe(false)

        // The demand changes again and its new load settles.
        outcomes.push(`ok`)
        writeParent(`insert`, 3)
        await flushPromises()
        expect(query.health.hasErrors).toBe(false)
      },
    ))

  it(`a request error clears when the query stops needing the demand`, () =>
    withHistory(async ({ query, outcomes, writeParent, markParentsReady }) => {
      const preload = query.preload()
      writeParent(`insert`, 1)
      markParentsReady()
      await preload

      outcomes.push(`fail`)
      writeParent(`insert`, 2)
      await flushPromises()
      expect(query.health.error).toMatchObject({ message: `child load failed` })

      writeParent(`delete`, 1)
      writeParent(`delete`, 2)
      await flushPromises()
      expect(query.health.hasErrors).toBe(false)
      expect(query.status).toBe(`ready`)
    }))

  // A later load of the failed demand that fulfills clears its error, also
  // when a reload issues it: a source's reload replays the query's demand,
  // and the query's own reload loads it in a new run. The guide offers
  // `reload()` for a node with an `error`, so the query's reload must reach
  // a request error on its own node.
  it.each([`source`, `query`] as const)(
    `a request error clears when the %s reload loads the demand again`,
    (reloaded) =>
      withHistory(
        async ({
          query,
          children,
          outcomes,
          writeParent,
          markParentsReady,
        }) => {
          const preload = query.preload()
          writeParent(`insert`, 1)
          markParentsReady()
          await preload

          outcomes.push(`fail`)
          writeParent(`insert`, 2)
          await flushPromises()
          expect(query.health.error).toMatchObject({
            message: `child load failed`,
          })

          await (reloaded === `source` ? children : query).reload()
          await flushPromises()
          expect(query.health.hasErrors).toBe(false)
          expect(query.status).toBe(`ready`)
          expect(query.size).toBe(2)
        },
      ),
  )

  // A replay clears only what failed before it started (as LoadOrder does
  // for root loads): a demand that fails while the replay is in flight keeps
  // its error when the replay succeeds. The replay holds that failure with
  // its publication, so it shows once the replay settles.
  it(`a source reload's replay keeps a request error that failed after it started`, () =>
    withHistory(
      async ({
        query,
        children,
        outcomes,
        held,
        writeParent,
        markParentsReady,
      }) => {
        const preload = query.preload()
        writeParent(`insert`, 1)
        markParentsReady()
        await preload

        outcomes.push(`hold`)
        const reload = children.reload()
        await flushPromises()
        expect(held, `the replay is in flight`).toHaveLength(1)

        outcomes.push(`fail`)
        writeParent(`insert`, 2)
        await flushPromises()

        held[0]!.resolve()
        await reload
        await flushPromises()
        expect(query.health.error, `the later failure stays`).toMatchObject({
          message: `child load failed`,
        })
      },
    ))

  it(`a failed load before initial-query readiness fails the query's sync run`, () =>
    withHistory(async ({ query, outcomes, writeParent, markParentsReady }) => {
      outcomes.push(`fail`)
      const preload = query.preload()
      void preload.catch(() => undefined)
      writeParent(`insert`, 1)
      markParentsReady()
      await flushPromises()
      expect(query.status).toBe(`error`)
      expect(query.health.error).toMatchObject({ message: `child load failed` })
      await expect(preload).rejects.toBeDefined()
    }))
})

// A crash is not recovered in place: `reload()` rejects and nothing starts a
// new sync run. Only cleanup leaves `crashed`, and cleanup discards all of
// the Collection's state, so a later start is a fresh start, as a new
// Collection over the same source would be. Model: after the cascade
// cleanup and a new preload, the Collection and a query mounted again show
// only the new run's rows and no problem.
describe(`crash recovery`, () => {
  it(`recovers a crashed Collection only through a full cleanup`, async () => {
    let runs = 0
    const collection = createCollection<Row, number>({
      id: `health-crash-recovery-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          const run = ++runs
          params.begin()
          params.write({ type: `insert`, value: { id: run, parentId: run } })
          params.commit()
          params.markReady()
        },
      },
    })
    let query = createLiveQueryCollection((q) => q.from({ row: collection }))
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      collection._lifecycle.crash(new Error(`index broke`))
      expect(query.status).toBe(`crashed`)

      await expect(collection.reload()).rejects.toThrow(/crashed/)
      await flushPromises()
      expect(collection.status, `nothing recovers it in place`).toBe(`crashed`)
      expect(runs).toBe(1)

      await collection.cleanup({ dependents: true })
      await collection.preload()
      expect(runs).toBe(2)
      expect(collection.status).toBe(`ready`)
      expect(collection.toArray.map((row) => row.id)).toEqual([2])
      expect(collection.health.hasErrors).toBe(false)

      query = createLiveQueryCollection((q) => q.from({ row: collection }))
      await query.preload()
      expect(query.status).toBe(`ready`)
      expect(query.toArray.map((row) => row.id)).toEqual([2])
      expect(query.health.hasErrors).toBe(false)
    } finally {
      console.error = consoleError
      await query.cleanup()
      await collection.cleanup({ dependents: true })
    }
  })
})

// A query whose first load failed waits for `reload()`: another source
// becoming ready does not restart it, and its failed load is not retried. The
// main grammar fails only sources, so this lane supplies the query's own
// failure.
describe(`a query's own failed first load`, () => {
  it(`does not restart when an unrelated source becomes ready`, async () => {
    let loads = 0
    const children = createCollection<Row, number>({
      id: `health-own-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              loads++
              return new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error(`child load failed`)), 0),
              )
            },
          }
        },
      },
    })
    const parents = createSource(`B`)
    parents.collection.startSyncImmediate()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ child: children })
        .where(({ child }) => eq(child.parentId, 1))
        .join({ parent: parents.collection }, ({ child, parent }) =>
          eq(child.parentId, parent.id),
        ),
    )
    const consoleError = console.error
    console.error = () => {}
    try {
      void query.preload().catch(() => undefined)
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(query.status).toBe(`error`)
      expect(query.health.error).toMatchObject({ message: `child load failed` })
      const loadsAtFailure = loads
      parents.params.markReady()
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(query.status).toBe(`error`)
      expect(loads).toBe(loadsAtFailure)
    } finally {
      console.error = consoleError
      await query.cleanup()
      await parents.collection.cleanup()
      await children.cleanup()
    }
  })

  // The query's own reload starts a new run while the status still shows the
  // failed first load. That run is in its first load too, so its outcome
  // decides the reload: a load that fails again fails it (status `error`,
  // the new cause), and a graph that throws crashes the query.
  it.each([`ok`, `load-fails`, `graph-throws`] as const)(
    `settles the query's reload with its new run: %s`,
    async (outcome) => {
      const answers: Array<`fail` | `ok`> = [
        `fail`,
        outcome === `load-fails` ? `fail` : `ok`,
      ]
      const source = createCollection<Row, number>({
        id: `health-own-reload-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              loadSubset: () => {
                const answer = answers.shift() ?? `ok`
                if (answer === `fail`)
                  return Promise.reject(
                    new Error(`load ${2 - answers.length} failed`),
                  )
                // The rows arrive after the run's sync entry, so a graph
                // that throws on them does so in a later graph run.
                return Promise.resolve().then(() => {
                  params.begin()
                  params.write({
                    type: `insert`,
                    value: { id: 1, parentId: 1 },
                  })
                  params.commit()
                })
              },
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) =>
        q.from({ row: source }).fn.select(({ row }) => {
          if (outcome === `graph-throws`) throw new Error(`select threw`)
          return row
        }),
      )
      const consoleError = console.error
      console.error = () => {}
      try {
        await query.preload().catch(() => undefined)
        expect(query.status).toBe(`error`)
        const settled = await Promise.race([
          query.reload().then(
            () => `resolved`,
            () => `rejected`,
          ),
          new Promise((resolve) => setTimeout(() => resolve(`pending`), 200)),
        ])
        expect(settled).toBe(outcome === `ok` ? `resolved` : `rejected`)
        expect(query.status).toBe(
          outcome === `ok`
            ? `ready`
            : outcome === `load-fails`
              ? `error`
              : `crashed`,
        )
        expect(query.health.reloading).toBe(false)
        if (outcome === `ok`) expect(query.size).toBe(1)
        if (outcome === `load-fails`)
          expect(query.health.error?.message).toContain(`load 2 failed`)
      } finally {
        console.error = consoleError
        await query.cleanup()
        await source.cleanup()
      }
    },
  )
})

// An ordered window that filters on a lazily joined source waits for its join
// loads before it moves. A join load that fails after readiness is a request
// error on the query's node, and it settles that demand: the window must not
// wait for it for good. A later move loads, moves the window, and clears the
// error. Every marker row exists from the start, so only the load fails.
describe(`a failed join load under an ordered filtered window`, () => {
  // Q1 (review 2): while the join load is pending, the query holds its
  // output. When the load fails, the failure settles that demand (law 16),
  // so the held output publishes at once: a change made meanwhile, which
  // needs no other join load, shows without waiting for some later change.
  it.each([`left`, `inner`] as const)(
    `publishes a change held behind a failed join load (%s join)`,
    async (join) => {
      let rootParams!: SyncParams
      const pendingLoads: Array<ReturnType<typeof createDeferred<void>>> = []
      let holdLoads = false
      const roots = createCollection<
        { id: number; rank: number; label?: string },
        number
      >({
        id: `health-held-roots-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            rootParams = params as unknown as SyncParams
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({ type: `insert`, value: { id, rank: id } })
            params.commit()
            params.markReady()
          },
        },
      })
      const markers = createCollection<{ id: number; rootId: number }, number>({
        id: `health-held-markers-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({
                type: `insert`,
                value: { id: 100 + id, rootId: id },
              })
            params.commit()
            params.markReady()
            return {
              loadSubset: () => {
                if (!holdLoads) return Promise.resolve()
                const load = createDeferred<void>()
                pendingLoads.push(load)
                return load.promise
              },
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) => {
        const from = q.from({ root: roots })
        const joined =
          join === `left`
            ? from.leftJoin({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
            : from.join({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
        return joined
          .where(({ marker }) => not(isUndefined(marker.id)))
          .orderBy(({ root }) => root.rank)
          .limit(2)
      })
      const subscription = query.subscribeChanges(() => {})
      const consoleError = console.error
      console.error = () => {}
      const ids = () => query.toArray.map((row: any) => row.root.id as number)
      try {
        await query.preload()
        expect(ids()).toEqual([1, 2])
        holdLoads = true
        // A new root asks the lazy join for its marker; the load is held.
        rootParams.begin()
        rootParams.write({
          type: `insert`,
          value: { id: 11, rank: 0 },
        } as never)
        rootParams.commit()
        await flushPromises()
        expect(
          pendingLoads.length,
          `the new root waits for a join load`,
        ).toBeGreaterThan(0)
        // Root 2 is visible and its marker is loaded: its update needs no
        // join load.
        rootParams.begin()
        rootParams.write({
          type: `update`,
          value: { id: 2, rank: 2, label: `edited` },
        } as never)
        rootParams.commit()
        await flushPromises()
        for (const load of pendingLoads.splice(0))
          load.reject(new Error(`marker load failed`))
        await flushPromises()
        expect(pendingLoads, `no join load is pending`).toEqual([])
        expect(query.status).toBe(`ready`)
        expect(query.health.error).toMatchObject({
          message: `marker load failed`,
        })
        expect(ids(), `the window keeps its rows`).toEqual([1, 2])
        expect(
          (query.toArray[1] as any).root.label,
          `the held change publishes after the failure`,
        ).toBe(`edited`)
      } finally {
        console.error = consoleError
        subscription.unsubscribe()
        await query.cleanup()
        await roots.cleanup()
        await markers.cleanup()
      }
    },
  )

  it.each([`left`, `inner`] as const)(
    `lets a later window move (%s join)`,
    async (join) => {
      let failLoads = false
      const roots = createCollection<{ id: number; rank: number }, number>({
        id: `health-window-roots-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({ type: `insert`, value: { id, rank: id } })
            params.commit()
            params.markReady()
          },
        },
      })
      const markers = createCollection<{ id: number; rootId: number }, number>({
        id: `health-window-markers-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({
                type: `insert`,
                value: { id: 100 + id, rootId: id },
              })
            params.commit()
            params.markReady()
            return {
              loadSubset: () =>
                failLoads
                  ? Promise.reject(new Error(`marker load failed`))
                  : Promise.resolve(),
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) => {
        const from = q.from({ root: roots })
        const joined =
          join === `left`
            ? from.leftJoin({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
            : from.join({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
        return joined
          .where(({ marker }) => not(isUndefined(marker.id)))
          .orderBy(({ root }) => root.rank)
          .limit(2)
      })
      const subscription = query.subscribeChanges(() => {})
      const consoleError = console.error
      console.error = () => {}
      const ids = () => query.toArray.map((row: any) => row.root.id as number)
      try {
        await query.preload()
        expect(ids()).toEqual([1, 2])

        failLoads = true
        await expect(
          Promise.resolve(query.utils.setWindow({ offset: 4, limit: 2 })),
        ).rejects.toThrow(`marker load failed`)
        expect(query.status).toBe(`ready`)
        expect(query.health.error).toMatchObject({
          message: `marker load failed`,
        })

        failLoads = false
        await query.utils.setWindow({ offset: 6, limit: 2 })
        await flushPromises()
        expect(ids(), `the window moves after the failure`).toEqual([7, 8])
        expect(query.health.error, `the later load clears it`).toBeNull()
        expect(query.status).toBe(`ready`)
      } finally {
        console.error = consoleError
        subscription.unsubscribe()
        await query.cleanup()
        await roots.cleanup()
        await markers.cleanup()
      }
    },
  )
})

describe(`root request health`, () => {
  it(`a failed root load after initial-query readiness is a request error that clears when a later load settles`, async () => {
    const outcomes: Array<`ok` | `fail`> = []
    const source = createCollection<Row, number>({
      id: `health-root-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () =>
              (outcomes.shift() ?? `ok`) === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`root load failed`)),
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.id)
        .limit(2),
    )
    expect(query.health, `the query exposes a health tree`).toBeDefined()
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      expect(query.health.hasErrors).toBe(false)

      outcomes.push(`fail`)
      await Promise.resolve(
        query.utils.setWindow({ offset: 4, limit: 2 }),
      ).catch(() => undefined)
      await flushPromises()
      expect(query.status).toBe(`ready`)
      expect(query.health.error).toMatchObject({ message: `root load failed` })
      expect(source.health.hasErrors).toBe(false)

      await query.utils.setWindow({ offset: 8, limit: 2 })
      await flushPromises()
      expect(query.health.hasErrors).toBe(false)
    } finally {
      console.error = consoleError
      await query.cleanup()
      await source.cleanup()
    }
  })
})

// Two root loads of one source can overlap: a window move, then a refill
// after a visible row is deleted. A request error clears only when a load
// started after the failure succeeds, or the demand is released: a load
// already in flight cannot cover the data whose request failed. Both loads
// here start before either settles, so once one fails the error stays, and
// it shows the latest failure.
type OverlapHistory = {
  outcomes: readonly [`ok` | `fail`, `ok` | `fail`]
  // Which load settles first: the earlier-started (0) or the later one (1).
  first: 0 | 1
}
function expectedOverlap({ outcomes, first }: OverlapHistory) {
  const order = first === 0 ? ([0, 1] as const) : ([1, 0] as const)
  let shown: string | null = null
  return order.map((load) => {
    if (outcomes[load] === `fail`) shown = `load ${load} failed`
    return shown
  })
}

describe(`overlapping root loads`, () => {
  const histories: Array<OverlapHistory> = []
  for (const a of [`ok`, `fail`] as const)
    for (const b of [`ok`, `fail`] as const)
      for (const first of [0, 1] as const)
        histories.push({ outcomes: [a, b], first })

  it.each(histories)(
    `outcomes $outcomes, load $first settles first`,
    async (history) => {
      const loads: Array<ReturnType<typeof createDeferred<void>>> = []
      let deferLoads = false
      let params!: SyncParams
      const source = createCollection<Row, number>({
        id: `health-overlap-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        gcTime: 0,
        sync: {
          sync: (next) => {
            params = next
            next.markReady()
            return {
              loadSubset: () => {
                if (!deferLoads) return Promise.resolve()
                const load = createDeferred<void>()
                loads.push(load)
                return load.promise
              },
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.id)
          .limit(2),
      )
      const consoleError = console.error
      console.error = () => {}
      try {
        await query.preload()
        params.begin()
        for (const id of [1, 2, 3, 4])
          params.write({ type: `insert`, value: { id, parentId: id } })
        params.commit()
        await flushPromises()
        deferLoads = true
        void Promise.resolve(
          query.utils.setWindow({ offset: 2, limit: 2 }),
        ).catch(() => undefined)
        await flushPromises()
        params.begin()
        params.write({ type: `delete`, value: { id: 3, parentId: 3 } })
        params.commit()
        await flushPromises()
        // Premise: both loads are in flight at once.
        expect(loads).toHaveLength(2)
        const model = expectedOverlap(history)
        const order = history.first === 0 ? [0, 1] : [1, 0]
        for (const [step, load] of order.entries()) {
          if (history.outcomes[load] === `ok`) loads[load]!.resolve()
          else loads[load]!.reject(new Error(`load ${load} failed`))
          await flushPromises()
          expect(
            query.health.error?.message ?? null,
            `after load ${load} settles`,
          ).toBe(model[step])
          expect(query.status).toBe(`ready`)
        }
        // A load started after the failure clears it when it succeeds.
        if (model.at(-1) !== null) {
          void Promise.resolve(
            query.utils.setWindow({ offset: 6, limit: 2 }),
          ).catch(() => undefined)
          await flushPromises()
          // The loader may have started more loads while the two settled; a
          // load started before the failure clears nothing, so settle every
          // load until the one the window move started has succeeded.
          const started = loads.length
          for (let index = 2; index < loads.length; index++) {
            loads[index]!.resolve()
            await flushPromises()
          }
          expect(
            loads.length,
            `the window move started a load`,
          ).toBeGreaterThan(2)
          expect(started).toBeGreaterThan(2)
          expect(
            query.health.error?.message ?? null,
            `after a later load succeeds`,
          ).toBeNull()
        }
      } finally {
        console.error = consoleError
        await query.cleanup()
        await source.cleanup()
      }
    },
  )
})

// ---------------------------------------------------------------------------
// On-demand reload lane
// ---------------------------------------------------------------------------

/**
 * A live query over an on-demand Collection holds rows only for the subsets
 * it loaded. A reload retires the sync run that loaded them, so the new run
 * must load each subset again. The law: the query keeps its rows until the
 * new run has reloaded its subset, and then shows the new run's rows. This
 * holds whenever the new run first commits. An adapter often calls
 * `markReady()` inside `sync()`, before core has its `loadSubset`.
 *
 * The provider has rows 1 to 4. Their `parentId` names the run that serves
 * them (run 1 gives `id`, run 2 gives `id + 10`), so a read shows which run
 * served each row. Histories cross the new run's first commit (an empty
 * `markReady()` inside `sync()`, a commit of row 5 inside `sync()`, or an
 * empty `markReady()` after `sync()` returns) with an unfiltered query and a
 * query for row 1.
 *
 * The model filters the provider's rows for a run through the query's
 * predicate. The driver checks two cuts. While the new run's loads are in
 * flight, the query still shows run 1's rows. A direct read of the Collection
 * shows only what the new run committed itself: an on-demand Collection holds
 * only loaded rows, and a reload's truncate replaced them, as any truncate
 * does. When the loads settle, the query and the Collection show run 2's
 * rows, and the reload resolves.
 */
type OnDemandReloadHistory = {
  firstCommit: `empty-inside-sync` | `row-inside-sync` | `empty-after-sync`
  query: `all` | `row-1`
}

function providerRows(run: number): Array<Row> {
  return [1, 2, 3, 4].map((id) => ({
    id,
    parentId: run === 1 ? id : id + 10,
  }))
}

function expectedOnDemandReload(
  history: OnDemandReloadHistory,
  run: number,
): Array<Row> {
  const ownCommit =
    run === 2 && history.firstCommit === `row-inside-sync`
      ? [{ id: 5, parentId: 15 }]
      : []
  return [...providerRows(run), ...ownCommit].filter(
    (row) => history.query === `all` || row.id === 1,
  )
}

describe(`on-demand reload`, () => {
  const histories: Array<OnDemandReloadHistory> = []
  for (const firstCommit of [
    `empty-inside-sync`,
    `row-inside-sync`,
    `empty-after-sync`,
  ] as const)
    for (const query of [`all`, `row-1`] as const)
      histories.push({ firstCommit, query })

  it.each(histories)(
    `first commit $firstCommit, query $query`,
    async (history) => {
      let runs = 0
      const runLoads: Array<Array<() => void>> = [[], [], []]
      const newRunReady = createDeferred<void>()
      const source = createCollection<Row, number>({
        id: `health-on-demand-reload-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        gcTime: 0,
        sync: {
          sync: (params) => {
            const run = ++runs
            if (run === 1 || history.firstCommit === `empty-inside-sync`) {
              params.markReady()
            } else if (history.firstCommit === `row-inside-sync`) {
              params.begin()
              params.write({ type: `insert`, value: { id: 5, parentId: 15 } })
              params.commit()
              params.markReady()
            } else {
              void newRunReady.promise.then(() => params.markReady())
            }
            return {
              loadSubset: () => {
                const serve = () => {
                  params.begin()
                  for (const row of providerRows(run))
                    params.write({ type: `insert`, value: row })
                  params.commit()
                }
                if (run === 1) {
                  serve()
                  return true
                }
                const load = createDeferred<void>()
                runLoads[run]!.push(() => {
                  serve()
                  load.resolve()
                })
                return load.promise
              },
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) => {
        const rows = q.from({ row: source })
        return history.query === `all`
          ? rows
          : rows.where(({ row }) => eq(row.id, 1))
      })
      const sorted = (rows: Array<Row>) =>
        [...rows]
          .map(({ id, parentId }) => ({ id, parentId }))
          .sort((a, b) => a.id - b.id)
      try {
        await query.preload()
        expect(sorted(query.toArray)).toEqual(
          expectedOnDemandReload(history, 1),
        )

        let reloaded = false
        const reload = source.reload().then(() => {
          reloaded = true
        })
        newRunReady.resolve()
        await flushPromises()
        expect(
          runLoads[2]!.length,
          `the new run reloads the query's subset`,
        ).toBeGreaterThan(0)
        expect(sorted(query.toArray), `while the loads are in flight`).toEqual(
          expectedOnDemandReload(history, 1),
        )
        expect(
          sorted(source.toArray),
          `a direct read while the loads are in flight`,
        ).toEqual(
          history.firstCommit === `row-inside-sync`
            ? [{ id: 5, parentId: 15 }]
            : [],
        )

        for (const serve of runLoads[2]!.splice(0)) serve()
        await reload
        await flushPromises()
        expect(reloaded).toBe(true)
        expect(sorted(query.toArray), `after the loads settle`).toEqual(
          expectedOnDemandReload(history, 2),
        )
        expect(query.status).toBe(`ready`)
        expect(source.health.hasErrors).toBe(false)
      } finally {
        await query.cleanup()
        await source.cleanup()
      }
    },
  )
})

// ---------------------------------------------------------------------------
// On-demand first load after query readiness
// ---------------------------------------------------------------------------

/**
 * A live query over an on-demand Collection becomes ready when its subsets
 * settle, so the Collection can still be in its first load when the query is
 * ready. The generated Collections are eager and never reach this state.
 * The laws are the ones above. After the query has shown data, only a crash
 * changes its status. The Collection's own node shows its first-load failure
 * (`error` status) or its stop after readiness (`ready` status, with an
 * `error`). The query's `reload()` reloads the Collection, and the new run's
 * readiness clears the node. A crashed query's `reload()` rejects.
 *
 * Histories cross the Collection's step (`fail` before its first ready,
 * `fail` after a `markReady()`, or `crash`) with a direct query and an
 * inner join to an eager Collection. Each history then calls the query's
 * `reload()`. The model gives the node's status and error message, the
 * query's status, and its row count at each cut.
 */
type LateFirstLoadHistory = {
  step: `fail-before-ready` | `fail-after-ready` | `crash`
  shape: `direct` | `join`
}

type LateFirstLoadCut = {
  queryStatus: CollectionStatus
  rows: number | null
  node: { status: CollectionStatus; error: string | null }
}

function expectedLateFirstLoad(history: LateFirstLoadHistory): {
  afterStep: LateFirstLoadCut
  afterReload: LateFirstLoadCut | `rejects`
} {
  if (history.step === `crash`)
    return {
      afterStep: {
        queryStatus: `crashed`,
        rows: null,
        node: { status: `crashed`, error: `stopped` },
      },
      afterReload: `rejects`,
    }
  return {
    afterStep: {
      queryStatus: `ready`,
      rows: 1,
      node: {
        status: history.step === `fail-before-ready` ? `error` : `ready`,
        error: `stopped`,
      },
    },
    afterReload: {
      queryStatus: `ready`,
      rows: 1,
      node: { status: `ready`, error: null },
    },
  }
}

describe(`on-demand first load after query readiness`, () => {
  const histories: Array<LateFirstLoadHistory> = []
  for (const step of [
    `fail-before-ready`,
    `fail-after-ready`,
    `crash`,
  ] as const)
    for (const shape of [`direct`, `join`] as const)
      histories.push({ step, shape })

  it.each(histories)(`step $step, shape $shape`, async (history) => {
    let runs = 0
    let firstRun!: SyncParams
    const lazy = createCollection<Row, number>({
      id: `health-late-first-load-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          // The first run stays in its first load; a reload's run is ready.
          if (runs++ === 0) firstRun = params
          else params.markReady()
          return {
            loadSubset: () => {
              params.begin()
              params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
              params.commit()
              return true
            },
          }
        },
      },
    })
    const eager = createCollection<Row, number>({
      id: `health-late-first-load-eager-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.begin()
          params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
          params.commit()
          params.markReady()
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      history.shape === `direct`
        ? q.from({ lazy })
        : q
            .from({ eager })
            .join({ lazy }, ({ eager, lazy }) => eq(eager.id, lazy.id)),
    )
    const lazyNode = () =>
      query.health.sources.find((node) => node.alias === `lazy`)!
    const cut = (): LateFirstLoadCut => ({
      queryStatus: query.status,
      rows: query.status === `ready` ? query.size : null,
      node: {
        status: lazyNode().status,
        error: lazyNode().error?.message ?? null,
      },
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      // Premise: the query is ready while the Collection is still loading.
      expect(lazy.status).toBe(`loading`)
      expect(query.size).toBe(1)

      const model = expectedLateFirstLoad(history)
      const stopped = new Error(`stopped`)
      if (history.step === `crash`)
        firstRun.collection._lifecycle.crash(stopped)
      else {
        if (history.step === `fail-after-ready`) firstRun.markReady()
        firstRun.fail(stopped)
      }
      await flushPromises()
      expect(cut(), `after the step`).toEqual(model.afterStep)
      expect(
        findProblems(query.health).some((node) => node.alias === `lazy`),
      ).toBe(true)

      if (model.afterReload === `rejects`) {
        await expect(query.reload()).rejects.toBeDefined()
        expect(runs, `a crashed query does not reload its sources`).toBe(1)
      } else {
        await query.reload()
        await flushPromises()
        expect(cut(), `after the query's reload`).toEqual(model.afterReload)
        expect(findProblems(query.health)).toEqual([])
      }
    } finally {
      console.error = consoleError
      await query.cleanup()
      await lazy.cleanup()
      await eager.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// The demand model, shared by the on-demand grammars
// ---------------------------------------------------------------------------

/**
 * # Demand on an on-demand Collection
 *
 * The window and lazy grammars below read an on-demand Collection, so the
 * live query holds logical demands: data it asked that Collection to load.
 * Both grammars use one model of the Collection and its demand, and the
 * main grammar's laws for the Collection itself:
 *
 * - **The Collection** is the main grammar's source model, driven through
 *   `applySourceStep`: its status, node, reload, and rows follow the same
 *   rules. Its rows arrive through loads. A load that succeeds is one sync
 *   transaction of its rows (`commitLoad`), so while a reload's replacement
 *   is armed, the reload's first load replaces every row, as any reload's
 *   first commit does. A load of a retired sync run commits nothing. A
 *   demand key is loaded while the Collection has its rows.
 * - **The demand** is a set of held keys. The lazy grammar holds one key per
 *   parent row. The window grammar's query holds one logical demand, its
 *   window, as key 0 (`windowDemand`); this is an abstraction, since
 *   production keys that demand by its window, not by a number.
 *
 * The demand rules come from `packages/db/src/query/live/ARCHITECTURE.md`
 * and the glossary's request-error entry:
 *
 * - **Law 10.** A key's latest load that the query did not abort decides
 *   it; an older load that settles later decides nothing. A failed load
 *   covers nothing, so the next demand change retires it, also one that
 *   threw, and an older load that still covers the key then decides it. Before
 *   initial-query readiness, a failed load of a held key fails the query's
 *   first load. After it, the failure is a request error on the query's own
 *   node (law 16) until a later load of that key succeeds or the query
 *   releases the key.
 * - **Law 9.** A truncate, or a source reload, starts a replay of the held
 *   demand. New demand joins the open replay, also one whose last attempt
 *   failed. A demand change is one step: the loads it starts join the replay
 *   before the loads it retires stop counting. The replay is judged once all
 *   its loads have settled, against the demand held then. A failure belongs
 *   to the logical demand that failed: if that demand retired, the replay
 *   succeeds for the rest. A replay load counts for the verdict only while
 *   the query holds it: what a load the query released loaded before its
 *   release does not count. A replay whose demand all retired with nothing
 *   loaded is aborted, and its error stays. Older overlapping replay work
 *   holds the replay and decides nothing. Releasing an owner removes its
 *   older work from readiness, also when the query asks for its keys again
 *   (a new owner). Replacing an acquisition does not release its owner: a
 *   demand parked behind a Collection whose first load failed is still
 *   held, so the replay waits for it.
 * - **Law 16.** A failed replay is a request error until a replay succeeds.
 *   It lists every failure it was judged on, in failure order, and shows the
 *   newest (maintainer decision: a failed replay's problem lists all its
 *   failed loads); the subscription's own replay error, the earliest of
 *   them, belongs to the subscription lifecycle oracle. It is reported once
 *   per attempt, and a later attempt's failure replaces it. A failed load
 *   that a later load replaced (a replay load that loaded its key, or the
 *   query's own load that requested it again) leaves the list (law 10). A
 *   failed key whose pending retry the replay replaced takes the replay's
 *   failure, so its earlier failure leaves, and a later replay's failure
 *   replaces it in turn; a failed key without a retry keeps its own
 *   failure next to the replay's (a request error belongs to the request
 *   that failed). A replay in flight defers the error of a load that fails
 *   meanwhile: that load fails with its own error once the replay settles.
 *   The replay decides the loads it replaced at its verdict, also one that
 *   an adapter which ignores aborts still serves. A replay whose attempt
 *   already failed defers nothing, so a load
 *   that joins it and fails shows its own error at once (maintainer
 *   decision). A replay's success clears the errors of the keys it loaded
 *   again, also a key whose earlier load threw (maintainer decision). A load
 *   that threw holds no demand, so a replay does not load its key again; and
 *   a key whose later load failed while the query still holds that load's
 *   demand keeps its error (law 10).
 * - **A request error belongs to the request that failed** (maintainer
 *   decision). A demand change retires the failed request, so its failure no
 *   longer outranks the older loads of its keys: a replay that loads the key
 *   decides it, and the error goes when the replay succeeds.
 * - **Which error shows** (maintainer decision, as TanStack Query's
 *   `error`): when several request errors are open, the node shows the
 *   newest, the one reported last, and its `errors` lists every open
 *   failure, oldest first; a failure that clears leaves the list. Two
 *   requests that fail with one error are one failure, which keeps the
 *   place of its first failure while another request still shows it, and a
 *   problem whose failures did not change keeps its identity (law 17).
 *
 * Which loads the query requests is the loader's choice, so the model does
 * not predict requests. The driver reports each request as the adapter saw
 * it: its keys, whether it threw, and whether the query aborted it
 * (`reportRequests`). The model then judges every outcome. Because it does
 * not predict requests, `expectHeldDemandCovered` checks the other side:
 * after each step of a ready query, every held key has a load that the
 * adapter still serves, its rows, a replay failure awaiting judgment, or a
 * shown request error. A load that the query aborts without a replacement
 * leaves its key uncovered.
 *
 * One request the model does predict: while the Collection shows a failed
 * first load, production parks a demand change's acquisition and sends no
 * request (maintainer decision: model it). The model starts the acquisition
 * that law 10 asks for, growth or churn, as a parked load
 * (`parkDemandChange`). It is the latest load of its keys, joins and holds an
 * open replay, and covers its keys. The next replay, or the Collection's
 * restart, requests it, and those requests replace it.
 */

// One load the query requested, as the adapter saw it.
// `replay`: the load belongs to an open replay. `fromReplay`: the replay
// itself made the request, not a demand change.
// `superseded`: a newer truncate replaced the replay attempt that made it. It
// still holds the replay's completion, decides nothing, and its rows apply
// if it succeeds.
// `parked`: the query asked for these keys while its Collection showed a
// failed first load, so no request reached the adapter; the acquisition
// waits until the Collection restarts.
type DemandLoad = {
  serial: number
  keys: Set<number>
  replay: boolean
  fromReplay: boolean
  superseded: boolean
  parked?: boolean
  // A parked churn replacement for every held key. A later demand change
  // that holds other keys drops it (law 10: the replacement no longer
  // matches the demand), and no request tells the driver.
  replacement?: boolean
}

type QueryGate = `loading` | `ready` | `error` | `crashed`

type Demand = {
  held: Set<number>
  // Held keys whose latest load failed after readiness, with that load's
  // serial.
  failed: Map<number, number>
  // A replay is open: every load the query starts joins it.
  replayActive: boolean
  // A replay failed. The query keeps its last complete publication, and the
  // error shows until a replay succeeds or the query holds nothing.
  replayFailed: boolean
  // The failed loads the failed replay shows, by serial, in failure order.
  replayErrors: Array<number>
  pending: Array<DemandLoad>
  // Held keys a replay failed for when it was judged, with the serial of the
  // failed load.
  replayFailedKeys: Map<number, number>
  // Replay loads that failed in the current attempt, by serial; the replay
  // judges them when it settles.
  replayFailedLoads: Map<number, Set<number>>
  // The loads of the open replay that loaded their keys, in any attempt, by
  // serial. A load the query released leaves: it loaded nothing for the
  // replay's verdict (law 9).
  replayLoads: Map<number, Set<number>>
  // Loads that a replay retired and the adapter still serves. As for a
  // truncate, a load started before a replay still holds the query's first
  // load until it settles, while the query holds one of its keys; it decides
  // nothing else.
  retiredInFlight: Map<number, Set<number>>
  // Every load the query requested and did not abort, by serial.
  requested: Map<number, Set<number>>
  // A reload retired the sync run while the query held no acquisition, so
  // it started no replay; its first commit then replays as a truncate does.
  replayAtFirstCommit: boolean
  // Loads that threw: they hold no acquisition.
  thrown: Set<number>
  // A replay started since the last report: the requests now reported are
  // its own.
  replayIssued: boolean
  // Loads that failed: they cover nothing (law 10).
  failedLoads: Set<number>
  // The latest adapter request's serial, and how many parked acquisitions
  // followed it; a parked acquisition is ordered between the two requests.
  lastSerial: number
  parks: number
  // One clock for when each load failed (`failedAt`) and when each failure
  // became a request error the node can show (`shownAt`), by serial. A
  // failure the replay defers is shown once the replay settles; a failed
  // replay's error is shown when the replay is judged.
  clock: number
  failedAt: Map<number, number>
  shownAt: Map<number, number>
  // The current replay attempt was judged failed: its error is reported,
  // and it no longer defers the failure of a load that joins it.
  replayAttemptFailed: boolean
  // Demand-change loads that failed while the replay was in flight. Each
  // fails with its own error once the replay settles, if it still decides a
  // key the replay failed for.
  deferredFailures: Set<number>
  // Failures, by serial, whose request a later demand change retired.
  retiredFailures: Set<number>
  // Requests the replay issued, by serial; every other request is the
  // query's own, such as a demand change's.
  replayRequests: Set<number>
  // When each request was made, on the failure clock.
  requestedAt: Map<number, number>
  // Failed keys whose later retry the current replay replaced: the replay
  // decides that retry (law 16), so a failed replay is the key's failure.
  retriedByReplay: Set<number>
  // Rules the model applied, for the drivers' declared reach (ORC-015).
  applied: Set<AppliedRule>
}

type AppliedRule =
  | `replay clears an earlier thrown failure`
  | `replay clears a retired failure`
  | `load fails after joining a failed replay`

// `serial` numbers the source's reported problems and written rows.
type OnDemandModel = {
  gate: QueryGate
  demand: Demand
  source: SourceModel
  serial: number
}

// The window grammar's one logical demand.
const windowDemand = 0

function freshOnDemandModel(held: Iterable<number>): OnDemandModel {
  return {
    gate: `loading`,
    demand: {
      held: new Set(held),
      failed: new Map(),
      replayActive: false,
      replayFailed: false,
      replayErrors: [],
      pending: [],
      replayFailedKeys: new Map(),
      replayFailedLoads: new Map(),
      replayLoads: new Map(),
      retiredInFlight: new Map(),
      requested: new Map(),
      replayAtFirstCommit: false,
      replayIssued: false,
      thrown: new Set(),
      failedLoads: new Set(),
      lastSerial: 0,
      parks: 0,
      clock: 0,
      failedAt: new Map(),
      shownAt: new Map(),
      replayAttemptFailed: false,
      deferredFailures: new Set(),
      retiredFailures: new Set(),
      retriedByReplay: new Set(),
      replayRequests: new Set(),
      requestedAt: new Map(),
      applied: new Set(),
    },
    source: freshSource(),
    serial: 0,
  }
}

function isLoaded(model: OnDemandModel, key: number): boolean {
  return model.source.rows.has(key)
}

// After fail() after readiness the adapter's calls throw, until a reload
// starts a new sync run. The drivers then make no truncate (law-silent: a
// truncate after fail() is outside the grammars).
function adapterStopped(source: SourceModel): boolean {
  return source.gate === `crashed` || (!source.reloading && !!source.stopped)
}

// The serial of the latest load the query requested for a key and did not
// abort.
function latestLoadFor(demand: Demand, key: number): number | undefined {
  let latest: number | undefined
  for (const [serial, keys] of demand.requested)
    if (keys.has(key) && (latest === undefined || serial > latest))
      latest = serial
  return latest
}

// A load the query requested settles. The driver has already committed its
// rows if its sync run is current; its outcome decides each key it is the
// latest load of.
function settleDemandLoad(
  model: OnDemandModel,
  load: DemandLoad,
  succeeded: boolean,
): void {
  const { demand } = model
  demand.pending = demand.pending.filter((entry) => entry !== load)
  if (model.gate === `crashed`) return
  if (load.superseded) {
    settleReplay(model)
    return
  }
  const latestFor = (key: number) => latestLoadFor(demand, key) === load.serial
  // A demand change's replacement that applies for every held key releases
  // the older loads it replaces: they no longer hold the first load.
  if (
    succeeded &&
    !load.fromReplay &&
    [...demand.held].every((key) => load.keys.has(key))
  )
    demand.retiredInFlight.clear()
  if (succeeded && !load.fromReplay)
    // A demand change's load that covers a superseded load's held keys
    // replaces that coverage. A newer replay still waits for the older work.
    demand.pending = demand.pending.filter(
      (entry) =>
        !entry.superseded ||
        ![...entry.keys]
          .filter((key) => demand.held.has(key))
          .every((key) => load.keys.has(key)),
    )
  if (succeeded) {
    // A replay load counts for the replay's own judgment. One that the
    // replay itself issued replaces an earlier acquisition, so the replay
    // decides its key (law 9): its error clears when the replay succeeds.
    if (load.replay) demand.replayLoads.set(load.serial, load.keys)
    for (const key of load.keys) {
      if (load.fromReplay) continue
      // A demand's own load: its key's request error clears (the glossary: a
      // later subset load for that demand fulfills), unless a newer load of
      // it failed and this load no longer holds the key (the query aborted
      // it).
      if (
        (demand.failed.get(key) ?? 0) < load.serial ||
        demand.requested.has(load.serial)
      )
        demand.failed.delete(key)
    }
    settleReplay(model)
    return
  }
  demand.failedAt.set(load.serial, ++demand.clock)
  // A failed demand load covers nothing. A replay's own request keeps the
  // coverage of the acquisition it replays, which the replay judges.
  if (!load.fromReplay) demand.failedLoads.add(load.serial)
  // Only the latest load of a key the query still holds decides it.
  const held = [...load.keys].filter(
    (key) => demand.held.has(key) && latestFor(key),
  )
  // Before initial-query readiness, that failure fails the query's first
  // load.
  if (model.gate === `loading` && !load.replay) {
    if (held.length > 0) model.gate = `error`
    return
  }
  // Law 9 judges a replay when it settles, against the demand held then.
  if (load.replay) demand.replayFailedLoads.set(load.serial, load.keys)
  // Law 16: a replay in flight defers the error of a load that fails
  // meanwhile. One whose attempt already failed defers nothing: the load
  // shows its own error at once, and the replay still counts the failure.
  if (load.replay && !demand.replayAttemptFailed) {
    if (!load.fromReplay) demand.deferredFailures.add(load.serial)
  } else {
    if (load.replay && held.length > 0)
      demand.applied.add(`load fails after joining a failed replay`)
    showFailure(demand, load.serial, held)
  }
  settleReplay(model)
}

// A failed load's error shows for the held keys it still decides. Two
// requests that fail with one error are one failure: while another request
// still shows it, it keeps the place of its first failure.
function showFailure(
  demand: Demand,
  serial: number,
  keys: ReadonlyArray<number>,
): void {
  if (keys.length === 0) return
  const shownElsewhere =
    [...demand.failed].some(
      ([key, failure]) => failure === serial && !keys.includes(key),
    ) ||
    (demand.replayFailed && demand.replayErrors.includes(serial))
  for (const key of keys) demand.failed.set(key, serial)
  if (!shownElsewhere) demand.shownAt.set(serial, ++demand.clock)
}

// A replay settles once none of its loads is pending. One that failed for a
// key the query still holds then fails the query's first load, or shows a
// request error after it.
function settleReplay(model: OnDemandModel): void {
  const { demand } = model
  // A superseded load holds the replay only while the query holds its data.
  const holds = (entry: DemandLoad) =>
    entry.replay &&
    (!entry.superseded || [...entry.keys].some((key) => demand.held.has(key)))
  if (demand.pending.some(holds)) return
  // Each key the replay loaded, with the serial of its latest replay load
  // the query still holds.
  const replayLoadedKeys = new Map<number, number>()
  for (const [serial, keys] of demand.replayLoads)
    for (const key of keys)
      replayLoadedKeys.set(
        key,
        Math.max(replayLoadedKeys.get(key) ?? 0, serial),
      )
  // Law 10: a key's latest load decides it, so a replay load that loaded a
  // key after its failed load replaces that failure. A failure whose request
  // a demand change retired no longer decides its key (maintainer decision:
  // a request error belongs to the request that failed), so the replay's
  // load of that key decides it, even an older one.
  const replayDecides = (key: number, failure: number) => {
    const loaded = replayLoadedKeys.get(key)
    return (
      loaded !== undefined &&
      (loaded > failure || demand.retiredFailures.has(failure))
    )
  }
  for (const [key, serial] of demand.replayFailedKeys) {
    if (!replayDecides(key, serial)) continue
    demand.replayFailedKeys.delete(key)
    if (replayLoadedKeys.get(key)! < serial)
      demand.applied.add(`replay clears a retired failure`)
  }
  const failedLoads = demand.replayFailedLoads
  for (const [serial, keys] of failedLoads)
    for (const key of keys)
      if (demand.held.has(key) && latestLoadFor(demand, key) === serial)
        demand.replayFailedKeys.set(key, serial)
  demand.replayFailedLoads = new Map()
  const deferred = demand.deferredFailures
  demand.deferredFailures = new Set()
  // A failed key stays failed while the query holds it; once the query
  // retires it, its failure cannot poison a successful replacement for the
  // remaining demand.
  for (const key of demand.replayFailedKeys.keys())
    if (!demand.held.has(key)) demand.replayFailedKeys.delete(key)
  // A replay stays open until it succeeds: a failed one is judged again
  // when its demand changes.
  const open = demand.replayActive || demand.replayFailed
  demand.replayActive = false
  if (demand.replayFailedKeys.size === 0) {
    // The replacement succeeded: its request error clears, and so do the
    // errors of the keys it loaded again. A replay whose demand all retired
    // with none loaded is aborted instead, and its error stays.
    // It succeeds as a replacement for the demand that remains (law 9), so
    // it must have loaded some of that demand.
    const loadedHeld = [...replayLoadedKeys.keys()].some((key) =>
      demand.held.has(key),
    )
    if (open && loadedHeld) {
      demand.replayFailed = false
      demand.replayAttemptFailed = false
      // A key whose earlier load threw clears too, but a key's failure after
      // its replay load stays while the query holds the failed request: the
      // later load decides.
      for (const [key, loaded] of replayLoadedKeys) {
        const failure = demand.failed.get(key)
        if (failure === undefined || !replayDecides(key, failure)) continue
        demand.failed.delete(key)
        if (loaded < failure)
          demand.applied.add(`replay clears a retired failure`)
        else if (demand.thrown.has(failure))
          demand.applied.add(`replay clears an earlier thrown failure`)
      }
      demand.replayLoads = new Map()
      return
    }
    // A replay that loaded nothing, while the query still holds demand whose
    // loads threw, has not replaced the rows: it stays open, keeps the last
    // complete publication private, and new demand joins it (law 9).
    if (open && demand.held.size > 0) demand.replayActive = true
    return
  }
  if (model.gate === `loading`) {
    model.gate = `error`
    return
  }
  demand.replayFailed = true
  // The attempt's failure is reported once. It lists every failed load it
  // was judged on whose demand the query still holds and that no later load
  // replaced: a later replay load that loaded its key, or a load of the
  // query's own, such as a demand change's, that requested its key again
  // after it failed (law 10: a failed load covers nothing, so that request
  // is the key's acquisition now). A load still pending when the query
  // asked again is replaced only once the replacement loads. It lists them
  // in failure order and shows the newest (maintainer decision: a failed
  // replay's problem lists all its failed loads). The subscription's own
  // replay error, the earliest of them, belongs to the subscription
  // lifecycle oracle. Then each load that
  // failed while the replay was in flight fails with its own error, for the
  // keys it still decides, in failure order.
  if (demand.replayAttemptFailed) return
  demand.replayAttemptFailed = true
  // Law 10 and law 16: a failed key's later retry is its latest request,
  // and the replay that replaced the retry decides it. When the replay
  // fails, the retry fails with it, so the key's earlier failure leaves the
  // list: the replay's failure is the key's now. A failed key without a
  // retry keeps its own failure, which belongs to its request (maintainer
  // decision).
  for (const key of demand.retriedByReplay) demand.failed.delete(key)
  const requestedAgain = (key: number, serial: number) =>
    [...demand.requested].some(
      ([later, keys]) =>
        keys.has(key) &&
        !demand.replayRequests.has(later) &&
        (demand.requestedAt.get(later) ?? 0) >
          (demand.failedAt.get(serial) ?? 0),
    )
  const failures = [...failedLoads]
    .filter(([serial, keys]) =>
      [...keys].some(
        (key) =>
          demand.held.has(key) &&
          !((replayLoadedKeys.get(key) ?? 0) > serial) &&
          !requestedAgain(key, serial),
      ),
    )
    .map(([serial]) => serial)
  if (failures.length === 0) failures.push(...demand.replayFailedKeys.values())
  const at = (serial: number) => demand.failedAt.get(serial) ?? 0
  // A new attempt's failure replaces the previous attempt's: a failure keeps
  // its place only while one of the held keys' failed requests shows it.
  demand.replayErrors = [...new Set(failures)].sort((a, b) => at(a) - at(b))
  for (const serial of demand.replayErrors)
    if (![...demand.failed.values()].includes(serial))
      demand.shownAt.set(serial, ++demand.clock)
  for (const serial of deferred)
    showFailure(
      demand,
      serial,
      [...demand.replayFailedKeys]
        .filter(([, failure]) => failure === serial)
        .map(([key]) => key),
    )
}

// A truncate or a source reload starts a replay of the held demand.
// A reload retires the old sync run: its loads no longer apply, and the
// query's own loads still hold its first load until they settle; the old
// replay's loads stop. A truncate keeps the run: its replay loads replace
// the open attempt's, which still hold the replay and decide nothing, and
// the query's own loads decide nothing either.
function startReplay(model: OnDemandModel, cause: `reload` | `truncate`): void {
  const { demand } = model
  // A reload replays the demand when it retires the run only if the query
  // holds an acquisition: a held key with a load that did not throw, parked
  // or not. Otherwise its first commit replays.
  const holdsAcquisition = [...demand.requested].some(
    ([serial, keys]) =>
      !demand.thrown.has(serial) &&
      [...keys].some((key) => demand.held.has(key)),
  )
  // A failed key with a retry still pending, parked or requested: the
  // replay replaces that retry (law 16).
  demand.retriedByReplay = new Set(
    [...demand.failed]
      .filter(([key, failure]) =>
        demand.pending.some(
          (load) =>
            !load.fromReplay && load.serial > failure && load.keys.has(key),
        ),
      )
      .map(([key]) => key),
  )
  // A replay requests parked demand too: its requests replace the parked
  // acquisitions.
  for (const load of demand.pending)
    if (load.parked) demand.requested.delete(load.serial)
  demand.pending = demand.pending.filter((load) => !load.parked)
  for (const load of demand.pending) {
    if (cause === `truncate` && load.replay) load.superseded = true
    else if (cause === `truncate` || !load.fromReplay)
      demand.retiredInFlight.set(load.serial, load.keys)
  }
  // A replay that this one replaces reports nothing, and what it loaded does
  // not count for this one: it decides the loads the old one deferred. The
  // new attempt is in flight.
  demand.replayFailedKeys = new Map()
  demand.replayFailedLoads = new Map()
  demand.replayLoads = new Map()
  demand.deferredFailures = new Set()
  demand.replayAttemptFailed = false
  demand.pending =
    cause === `truncate` ? demand.pending.filter((load) => load.superseded) : []
  if (cause === `truncate`) demand.requested = new Map()
  demand.replayAtFirstCommit = false
  if (cause === `reload` && !holdsAcquisition) {
    demand.replayAtFirstCommit = true
    return
  }
  demand.replayActive = true
  demand.replayIssued = true
}

// A source action that may commit: when it is the first commit of a reload
// that started no replay, that commit replays the demand as a truncate does.
function commitOnDemand(model: OnDemandModel, commit: () => void): void {
  const armed = model.source.reloading && model.source.armed
  commit()
  if (armed && !model.source.armed && model.demand.replayAtFirstCommit)
    startReplay(model, `truncate`)
}

function changeDemand(
  demand: Demand,
  kind: `parent` | `unparent`,
  key: number,
): void {
  // A request error belongs to the request that failed (maintainer
  // decision): a demand change retires every failed request, so a replay's
  // load of its keys can decide them (see settleReplay).
  for (const serial of [
    ...demand.failed.values(),
    ...demand.replayFailedKeys.values(),
  ])
    demand.retiredFailures.add(serial)
  if (kind === `parent`) demand.held.add(key)
  else {
    demand.held.delete(key)
    demand.failed.delete(key)
  }
  // Law 10: a failed load covers nothing, so a demand change keeps none of
  // the query's failed requests, and an older live load of a key then
  // decides it. A load that throws fails its keys as one that rejects does,
  // so the change retires it too. The driver sees the abort of a rejected
  // request, but a thrown one never became a load the adapter serves, so
  // the model retires it here. A thrown replay request stays: it waits for
  // its replay's verdict (law 16).
  for (const serial of demand.thrown)
    if (!demand.replayRequests.has(serial)) demand.requested.delete(serial)
  // Releasing an owner removes both its current and its older work from
  // readiness (law 9): older replay work for keys the query no longer holds
  // holds nothing, even if the query asks for those keys again.
  const released = (load: DemandLoad) =>
    ((load.superseded || load.parked) &&
      [...load.keys].every((held) => !demand.held.has(held))) ||
    (!!load.replacement &&
      (load.keys.size !== demand.held.size ||
        [...load.keys].some((held) => !demand.held.has(held))))
  for (const load of demand.pending)
    if (load.parked && released(load)) demand.requested.delete(load.serial)
  demand.pending = demand.pending.filter((load) => !released(load))
  // The same holds for a load a replay retired that the adapter still
  // serves: once the query releases every key of it, it no longer holds the
  // first load, also when the query asks for a key again (a new owner).
  for (const [serial, keys] of demand.retiredInFlight)
    if ([...keys].every((held) => !demand.held.has(held)))
      demand.retiredInFlight.delete(serial)
  if (demand.held.size === 0) demand.replayFailed = false
}

// A demand change while the Collection shows a failed first load starts the
// acquisition that law 10 asks for, but it parks without a request. Law 10:
// growth requests only the held keys that no live load covers (a failed or
// thrown load covers nothing); churn, a change that retires a key while it
// still has keys to request or more than one live load, requests one
// replacement for every held key. Law 16: a key whose replay request threw
// waits for the open replay's verdict, so a demand change does not request
// it by itself. Only a churn replacement for a live load that still covers
// held demand requests it again, as part of the whole held union.
function parkDemandChange(
  model: OnDemandModel,
  kind: `parent` | `unparent`,
): void {
  const { demand } = model
  if (model.source.gate !== `error` || demand.held.size === 0) return
  const live = [...demand.requested].filter(
    ([serial, keys]) =>
      !demand.thrown.has(serial) &&
      !demand.failedLoads.has(serial) &&
      [...keys].some((key) => demand.held.has(key)),
  )
  const covered = new Set(live.flatMap(([, keys]) => [...keys]))
  // A key whose own load failed is retried, also while a replay loads it.
  const uncovered = [...demand.held].filter(
    (key) => !covered.has(key) || demand.failed.has(key),
  )
  // A failed replay request that did not throw is live, so only thrown
  // replay requests are judged here; one the query released holds nothing
  // (law 9), also when the query asks for its key again.
  const judged = new Set(
    [...demand.replayFailedLoads]
      .filter(([serial]) => demand.requested.has(serial))
      .flatMap(([, keys]) => [...keys]),
  )
  const toRequest = uncovered.filter((key) => !judged.has(key))
  const churn =
    kind === `unparent` &&
    (toRequest.length > 0 ||
      live.length > 1 ||
      (live.length > 0 && uncovered.length > 0))
  const keys = new Set(churn ? demand.held : toRequest)
  if (keys.size === 0) return
  const load: DemandLoad = {
    serial: demand.lastSerial + ++demand.parks / 1000,
    keys,
    replay: demand.replayActive || demand.replayFailed,
    fromReplay: false,
    superseded: false,
    parked: true,
    replacement: churn,
  }
  demand.requested.set(load.serial, keys)
  demand.pending.push(load)
  if (load.replay) demand.replayActive = true
}

// The Collection restarted after its failed first load: its parked
// acquisitions now request, as a replay of the detached demand.
function restartParked(model: OnDemandModel): void {
  const { demand } = model
  const parked = demand.pending.filter((load) => load.parked)
  if (parked.length === 0) return
  for (const load of parked) demand.requested.delete(load.serial)
  demand.pending = demand.pending.filter((load) => !load.parked)
  demand.replayActive = true
  demand.replayIssued = true
  demand.replayAttemptFailed = false
}

// Requests the adapter saw since the last report. `aborted`: requests the
// query aborted since then. `stillServed`: the adapter still serves the
// request. `replayMade`: a truncate or a reload in this step made the
// requests, so they belong to its replay.
function reportRequests(
  model: OnDemandModel,
  requests: ReadonlyArray<{
    serial: number
    keys: Set<number>
    thrown: boolean
  }>,
  aborted: ReadonlySet<number>,
  stillServed: (serial: number) => boolean,
  replayMade: boolean,
): void {
  const { demand } = model
  const fromReplay = replayMade || demand.replayIssued
  demand.replayIssued = false
  // An aborted request is obsolete: it decides nothing. A superseded replay
  // load that the adapter still serves stays: it holds its replay until it
  // settles.
  const retired = (load: DemandLoad) =>
    aborted.has(load.serial) && !(load.superseded && stillServed(load.serial))
  // Law 9: a demand change is one step. The loads it starts join an open
  // replay before the loads it retires stop counting, so the replay settles
  // once, after the whole change. A request a new demand makes during a
  // replay joins the replay, but one that throws fails at once; one the
  // replay makes fails with the replay. Every request is recorded before a
  // thrown one settles, so the replay's later requests still belong to it.
  const reported = requests.map((request) => {
    demand.lastSerial = Math.max(demand.lastSerial, request.serial)
    demand.parks = 0
    const load: DemandLoad = {
      serial: request.serial,
      keys: request.keys,
      replay:
        (demand.replayActive || demand.replayFailed) &&
        (fromReplay || !request.thrown),
      fromReplay,
      superseded: false,
    }
    demand.requested.set(load.serial, load.keys)
    if (fromReplay) demand.replayRequests.add(load.serial)
    demand.requestedAt.set(load.serial, ++demand.clock)
    demand.pending.push(load)
    if (load.replay) demand.replayActive = true
    return { load, thrown: request.thrown }
  })
  for (const { load, thrown } of reported)
    if (thrown) {
      demand.thrown.add(load.serial)
      settleDemandLoad(model, load, false)
    }
  demand.pending = demand.pending.filter((load) => !retired(load))
  // A request the query aborted no longer holds its keys. Releasing the
  // owner removes its work from the replay too (law 9): the replay succeeds
  // only as a replacement for the demand that remains, so what a released
  // load loaded before its release does not count for the verdict.
  for (const serial of aborted) {
    demand.requested.delete(serial)
    demand.replayLoads.delete(serial)
  }
  settleReplay(model)
}

// The query's status follows its source until it is ready: a crash crashes
// it at any time, and a failed first load fails the query's first load.
function projectSourceGate(model: OnDemandModel): void {
  if (model.source.gate === `crashed`) model.gate = `crashed`
  else if (model.gate === `loading` && model.source.gate === `error`)
    model.gate = `error`
}

// During the first load, the query is ready once no pending load is for a
// key it still holds: a demand it retired no longer holds readiness back. A
// replay restores the demand as one unit, so the query also waits until the
// replay settles.
function deriveDemandGate(model: OnDemandModel): void {
  const { demand } = model
  if (
    model.gate !== `loading` ||
    demand.replayActive ||
    [...demand.retiredInFlight.values()].some((keys) =>
      [...keys].some((key) => demand.held.has(key)),
    )
  )
    return
  const blocking = demand.pending.some(({ serial, keys }) =>
    [...keys].some(
      (key) => demand.held.has(key) && latestLoadFor(demand, key) === serial,
    ),
  )
  if (!blocking) model.gate = `ready`
}

// The request error's frame on the query's node, by the serials of the
// failed loads: every open failure (its held keys' failed loads and a failed
// replay's), once each, in the order each was shown (maintainer decision:
// the problem lists the failures still open, oldest first). A failure that
// clears leaves the list.
function expectedRequestErrors(demand: Demand): Array<number> {
  const open = new Set([
    ...demand.failed.values(),
    ...(demand.replayFailed ? demand.replayErrors : []),
  ])
  const at = (serial: number) => demand.shownAt.get(serial) ?? 0
  return [...open].sort((a, b) => at(a) - at(b))
}

// The request error the node shows: the newest open failure, or none
// (maintainer decision, as TanStack Query's `error`).
function expectedRequestError(demand: Demand): number | null {
  return expectedRequestErrors(demand).at(-1) ?? null
}

// The query's own node against the model's request-error frame: the newest
// open failure shows (`message`, `cause`), and `errors` lists every open
// failure once, oldest first, each as the very value the adapter failed with.
function expectRequestErrors(
  node: HealthNode,
  frame: ReadonlyArray<number>,
  causes: ReadonlyMap<number, Error>,
  label: string,
): void {
  const error = node.error
  expect(
    {
      message: error?.message ?? null,
      errors: error?.errors.map((failure) => failure.message) ?? [],
    },
    `${label}: request error`,
  ).toEqual({
    message: frame.length > 0 ? causes.get(frame.at(-1)!)!.message : null,
    errors: frame.map((serial) => causes.get(serial)!.message),
  })
  if (!error) return
  expect(error.cause, `${label}: request error cause`).toBe(
    causes.get(frame.at(-1)!),
  )
  error.errors.forEach((failure, index) =>
    expect(failure.cause, `${label}: request error ${index} cause`).toBe(
      causes.get(frame[index]!),
    ),
  )
}

// The coverage law (laws 9 and 10): once the query is ready, every key it
// holds is covered by a load the adapter still serves, by its rows, by a
// replay failure awaiting judgment, or by the request error the query shows
// for it. `served` comes from the driver's adapter calls, not from
// production state; a parked acquisition covers its keys without one.
function expectHeldDemandCovered(
  model: OnDemandModel,
  served: Iterable<Set<number>>,
  errorShown: boolean,
  label: string,
): void {
  if (model.gate !== `ready`) return
  const { demand } = model
  const live = new Set([
    ...[...served].flatMap((keys) => [...keys]),
    ...demand.pending.flatMap((load) => (load.parked ? [...load.keys] : [])),
  ])
  const judged = new Set(
    [...demand.replayFailedLoads.values()].flatMap((keys) => [...keys]),
  )
  const uncovered = [...demand.held].filter(
    (key) =>
      !live.has(key) &&
      !isLoaded(model, key) &&
      !judged.has(key) &&
      !(errorShown && (demand.failed.has(key) || demand.replayFailed)),
  )
  expect(uncovered, `${label}: held demand is covered`).toEqual([])
}

// ---------------------------------------------------------------------------
// On-demand demand grammar
// ---------------------------------------------------------------------------

/**
 * A live query over an on-demand Collection loads only the window it shows.
 * The query holds one logical demand, its window, and the shared demand
 * model above judges it: a load that fails before the query's initial-query
 * readiness fails the query's first load; one that fails after it is a
 * request error on the query's own node, and the source stays healthy. A
 * request error clears only when a later load of the window succeeds; a
 * source's reload replays the window and clears it when that replay
 * succeeds. The source is the shared source model: its own problems after
 * readiness are health tree detail and never change the query's status, and
 * its crash crashes the query.
 *
 * The provider has rows 1 to 99. It answers a request without a limit with
 * every row, and a limited request with the rows up to the end of the
 * window. The query shows two rows ordered by id. Steps: `window` moves the
 * window two rows on; `settle-ok` settles every pending load, and any load
 * the query requests after it, until none is pending; `settle-fail` rejects
 * every pending load at once (the overlapping-load lane owns the order of
 * two loads); `reload` reloads the source; `report`, `healthy`, and `fail`
 * are the source adapter's calls after readiness; `crash` crashes the
 * source. The source marks ready inside sync(), so a reload completes at
 * once: its first commit has no rows, whatever the adapter writes later.
 *
 * The window projection keeps the window offset, the window the query shows,
 * and a window move that waits for a replay. The comparison checks, after
 * every step, the query's status, its own error message, the source's node,
 * the coverage law, and, when no load is in flight and no error shows, the
 * rows in the window.
 */
type WindowStep =
  | `window`
  | `settle-ok`
  | `settle-fail`
  | `reload`
  | `report`
  | `healthy`
  | `fail`
  | `crash`

// The window projection over the shared demand model.
type WindowModel = OnDemandModel & {
  offset: number
  // The window whose load last succeeded; the query shows it.
  shown: number
  // A window move made while a replay is open, or after one failed, waits
  // for the replay; a later reload aborts that move (setWindow() rejects)
  // and returns to `replayedOffset`. A move with its own load joins the
  // replay instead, so the replay loads it.
  moveWaitsForReplay: boolean
  replayedOffset: number
}

function applyWindowStep(model: WindowModel, step: WindowStep): void {
  if (model.gate === `crashed`) return
  const { source, demand } = model
  switch (step) {
    case `window`:
      if (model.gate !== `ready`) return
      if (demand.replayActive || demand.replayFailed) {
        if (!model.moveWaitsForReplay) model.replayedOffset = model.offset
        model.moveWaitsForReplay = true
      }
      model.offset += 2
      return
    // The driver settles loads and reports each outcome.
    case `settle-ok`:
    case `settle-fail`:
      return
    case `reload`: {
      const starts = !source.reloading && source.gate !== `crashed`
      applySourceStep(model, source, `source`, { kind: `reload` })
      if (!starts) break
      // The new run marks ready inside sync(), before any commit: the reload
      // completes at once, and its replay loads the window again.
      commitOnDemand(model, () =>
        applySourceStep(model, source, `source`, { kind: `mark-ready` }),
      )
      if (model.moveWaitsForReplay) {
        model.offset = model.replayedOffset
        model.moveWaitsForReplay = false
      }
      startReplay(model, `reload`)
      break
    }
    default:
      applySourceStep(model, source, `source`, { kind: step })
  }
  projectSourceGate(model)
}

// The loads of a step settled at the adapter. A settled window move shows
// its window; a failed one keeps the last good window, and the app retries
// with setWindow(). A move that requested no load is served from rows the
// query already loaded, unless it waits for a replay.
function settleWindow(
  model: WindowModel,
  step: WindowStep,
  settled: number,
  inFlight: number,
): void {
  if ((step === `settle-ok` || step === `settle-fail`) && settled > 0)
    model.moveWaitsForReplay = false
  if (step === `settle-ok` && settled > 0) model.shown = model.offset
  if (step === `settle-fail` && settled > 0) model.offset = model.shown
  if (step === `window` && inFlight === 0 && !model.moveWaitsForReplay)
    model.shown = model.offset
}

// A direct subscriber with the initial state on an on-demand Collection.
// Within one Collection lifetime its applied rows equal the Collection's rows
// at every step, also while a reload's or a truncate's replay is in flight or
// after it fails. The driver answers its own subset requests at once, with
// no rows, and keeps them out of the model: it observes, it asks for nothing.
// `boundary.owns` tells the loader which requests are the subscriber's.
function watchDirectly(
  collection: Collection<Row, number>,
  boundary: { owns: (options: LoadSubsetOptions) => boolean },
) {
  const rows = new Map<number, number>()
  const current: { subscription?: unknown } = {}
  // Its requests during subscribeChanges() come before it returns.
  boundary.owns = (options) =>
    current.subscription === undefined ||
    options.subscription === current.subscription
  current.subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) rows.delete(change.key)
        else rows.set(change.key, change.value.parentId)
      }
    },
    { includeInitialState: true },
  )
  return {
    check: (label: string) =>
      expect(
        [...rows].sort(([a], [b]) => a - b),
        `${label}: direct subscriber rows`,
      ).toEqual(
        collection.toArray
          .map((row): [number, number] => [row.id, row.parentId])
          .sort(([a], [b]) => a - b),
      ),
    stop: () =>
      (current.subscription as { unsubscribe: () => void }).unsubscribe(),
  }
}

// The states the window grammar's later laws depend on (ORC-015). Only the
// generated property records them.
const demandReachStates = [
  `window move waits for a replay`,
  `direct subscriber during a replay`,
] as const
type DemandReach = ReturnType<
  typeof createOracleReach<(typeof demandReachStates)[number]>
>

async function runDemandHistory(
  steps: ReadonlyArray<WindowStep>,
  directSubscriber = false,
  reach?: DemandReach,
) {
  const model: WindowModel = {
    ...freshOnDemandModel([windowDemand]),
    offset: 0,
    shown: 0,
    moveWaitsForReplay: false,
    replayedOffset: 0,
  }
  // The source marks ready inside sync().
  applySourceStep(model, model.source, `source`, { kind: `mark-ready` })
  // Loads in flight at the adapter, and what the adapter saw since the last
  // report: each request, and which of them the query aborted.
  const loads: Array<{
    serial: number
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  const requests: Array<{
    serial: number
    keys: Set<number>
    thrown: boolean
  }> = []
  const aborted = new Set<number>()
  // The sync run each load belongs to; a retired run's load commits nothing.
  const loadRuns = new Map<number, number>()
  // Each failed load's cause, by serial.
  const causes = new Map<number, Error>()
  let serials = 0
  let run = 0
  let failures = 0
  let params!: SyncParams
  const boundary = { owns: (_options: LoadSubsetOptions) => false }
  const source = createCollection<Row, number>({
    id: `health-demand-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
        const thisRun = ++run
        // Rows this sync run has served; a reload's run serves them again.
        const served = new Set<number>()
        next.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            if (boundary.owns(options)) return true
            const serial = ++serials
            const deferred = createDeferred<void>()
            loads.push({ serial, deferred })
            loadRuns.set(serial, thisRun)
            requests.push({
              serial,
              keys: new Set([windowDemand]),
              thrown: false,
            })
            // An aborted load still finishes: its rows apply if its run
            // serves it.
            options.signal?.addEventListener(`abort`, () => aborted.add(serial))
            const end = options.limit === undefined ? 99 : model.offset + 2
            return deferred.promise.then(() => {
              next.begin()
              for (let id = 1; id <= end; id++) {
                if (served.has(id)) continue
                served.add(id)
                next.write({ type: `insert`, value: { id, parentId: id } })
              }
              next.commit()
            })
          },
        }
      },
    },
  })
  const report = (replayMade: boolean) => {
    reportRequests(
      model,
      requests.splice(0),
      aborted,
      (serial) => loads.some((load) => load.serial === serial),
      replayMade,
    )
    aborted.clear()
  }
  // Settle loads at the adapter and report each outcome to the model.
  const settle = (succeeded: boolean) => {
    const picked = loads.splice(0)
    const message = `root load ${++failures} failed`
    for (const { serial, deferred } of picked) {
      if (succeeded && loadRuns.get(serial) === run)
        commitOnDemand(model, () =>
          commitLoad(model, model.source, [windowDemand]),
        )
      const load = model.demand.pending.find((entry) => entry.serial === serial)
      const cause = new Error(message)
      if (!succeeded) causes.set(serial, cause)
      if (load) settleDemandLoad(model, load, succeeded)
      model.demand.retiredInFlight.delete(serial)
      if (succeeded) deferred.resolve()
      else deferred.reject(cause)
    }
    return picked.length
  }
  const query = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.id)
      .limit(2),
  )
  const consoleError = console.error
  console.error = () => {}
  let watcher: ReturnType<typeof watchDirectly> | undefined
  try {
    void query.preload().catch(() => undefined)
    await flushPromises()
    if (directSubscriber) watcher = watchDirectly(source, boundary)
    report(false)
    deriveDemandGate(model)
    for (const [index, step] of steps.entries()) {
      const label = `step ${index} ${step}`
      applyWindowStep(model, step)
      if (model.moveWaitsForReplay)
        reach?.reach(`window move waits for a replay`)
      if (directSubscriber && model.demand.replayActive)
        reach?.reach(`direct subscriber during a replay`)
      let settled = 0
      if (step === `window`) {
        if (query.status === `ready`)
          void Promise.resolve(
            query.utils.setWindow({ offset: model.offset, limit: 2 }),
          ).catch(() => undefined)
      } else if (step === `settle-ok`) {
        // Ordered loading may follow a load with more requests; settle until
        // the window asks for nothing more.
        for (let round = 0; round < 5 && loads.length > 0; round++) {
          settled += settle(true)
          await flushPromises()
          report(false)
        }
      } else if (step === `settle-fail`) {
        settled = settle(false)
      } else if (step === `reload`) {
        void source.reload().catch(() => undefined)
      } else if (step === `crash`) {
        source._lifecycle.crash(new Error(`source crashed`))
      } else {
        try {
          if (step === `report`) params.reportError(new Error(`source problem`))
          else if (step === `healthy`) params.reportHealthy()
          else params.fail(new Error(`source gave up`))
        } catch {
          // After fail(), the adapter's calls throw; the model predicts that.
        }
      }
      await flushPromises()
      report(step === `reload`)
      settleWindow(model, step, settled, loads.length)
      deriveDemandGate(model)

      expect(query.status, `${label}: query status`).toBe(model.gate)
      watcher?.check(label)
      const shownError = expectedRequestError(model.demand)
      if (model.gate === `ready`)
        expectRequestErrors(
          query.health,
          expectedRequestErrors(model.demand),
          causes,
          label,
        )
      expectHeldDemandCovered(
        model,
        loads.map(() => new Set([windowDemand])),
        query.health.error !== null,
        label,
      )
      const sourceNode = query.health.sources[0]!
      if (model.source.gate !== `crashed`) {
        expect(
          sourceNode.failureReason?.message ?? null,
          `${label}: source failureReason`,
        ).toBe(
          model.source.stopped
            ? null
            : (model.source.failures.at(-1)?.message ?? null),
        )
        expect(
          sourceNode.error?.message ?? null,
          `${label}: source error`,
        ).toBe(model.source.stopped?.message ?? null)
      }
      if (model.gate === `ready` && loads.length === 0 && shownError === null) {
        expect(
          query.toArray.map((row) => row.id),
          `${label}: window rows`,
        ).toEqual([model.shown + 1, model.shown + 2])
      }
    }
  } finally {
    console.error = consoleError
    watcher?.stop()
    for (const { deferred } of loads.splice(0)) deferred.resolve()
    await query.cleanup()
    await source.cleanup({ dependents: true })
  }
}

describe(`on-demand demand grammar`, () => {
  // Named histories, one per distinction the law draws.
  const named: Record<string, ReadonlyArray<WindowStep>> = {
    'a failed load after readiness is a request error, and a later load clears it':
      [`settle-ok`, `window`, `settle-fail`, `window`, `settle-ok`],
    'a failed first load fails the query': [`settle-fail`],
    'a reload aborts a window move that waits for an earlier replay': [
      `settle-ok`,
      `reload`,
      `window`,
      `reload`,
      `settle-ok`,
    ],
    'a window move with its own load joins the next replay': [
      `settle-ok`,
      `window`,
      `reload`,
      `settle-ok`,
    ],
    "a failed source reload's replay is a request error": [
      `settle-ok`,
      `window`,
      `reload`,
      `settle-fail`,
    ],
    'a reload keeps a window move that joined the replay and aborts a later one':
      [`settle-ok`, `window`, `reload`, `window`, `reload`, `settle-ok`],
    'a reload aborts a window move that waits after a failed replay': [
      `settle-ok`,
      `reload`,
      `settle-fail`,
      `window`,
      `reload`,
      `settle-ok`,
    ],
    // A replay that fails after an earlier failed window load with no retry:
    // that failure belongs to its request, which no later load settled, so
    // the problem lists it before the replay's failures.
    'a failed replay after a failed window load lists both failures': [
      `settle-ok`,
      `window`,
      `settle-fail`,
      `reload`,
      `settle-fail`,
    ],
    "a successful replay clears the replay's request error": [
      `settle-ok`,
      `reload`,
      `settle-fail`,
      `reload`,
      `settle-ok`,
    ],
    "the source's own problems stay on its node": [
      `settle-ok`,
      `report`,
      `window`,
      `fail`,
      `settle-ok`,
      `crash`,
    ],
  }
  for (const [name, steps] of Object.entries(named))
    it(name, () => runDemandHistory(steps))

  const step = fc.constantFrom<WindowStep>(
    `window`,
    `settle-ok`,
    `settle-fail`,
    `reload`,
    `report`,
    `healthy`,
    `fail`,
    `crash`,
  )
  const demandReach = createOracleReach(
    `source-health.on-demand`,
    demandReachStates,
  )
  let demandHistoriesRan = false
  afterAll(() => {
    if (demandHistoriesRan) demandReach.assertReached()
  })
  // A prefix that enters a declared reach state that random steps alone
  // rarely reach at the base run count; random steps follow it.
  const demandReachPrefixes: ReadonlyArray<ReadonlyArray<WindowStep>> = [
    [`settle-ok`, `reload`, `window`],
    [`settle-ok`, `reload`, `settle-fail`, `window`],
  ]
  fcTest.prop(
    [
      fc
        .tuple(
          fc.option(fc.constantFrom(...demandReachPrefixes), { freq: 2 }),
          fc.array(step, { maxLength: 10 }),
        )
        .map(([prefix, rest]): Array<WindowStep> => [
          ...(prefix ?? []),
          ...rest,
        ]),
      fc.boolean(),
    ],
    oraclePropertyOptions(60, `source-health.on-demand`),
  )(
    `generated demand histories refine the model`,
    (steps, directSubscriber) => {
      demandHistoriesRan = true
      demandReach.beginHistory()
      return withDeadline(
        runDemandHistory(steps, directSubscriber, demandReach),
      )
    },
    120_000,
  )
})

// ---------------------------------------------------------------------------
// Lazy join demand grammar
// ---------------------------------------------------------------------------

/**
 * A live query that left-joins an eager parent Collection to an on-demand
 * child Collection loads the children of the parents it shows: it holds one
 * demand key per parent. The shared demand model above judges every load,
 * and the shared source model keeps the child Collection. Each parent shows
 * its child while the child Collection has that child's row.
 *
 * Steps: `parent` adds parent 1, 2, or 3, and `unparent` removes it;
 * `truncate` commits the child adapter's truncate; `child-ready` calls a
 * held markReady(); the other steps are as in the window grammar. The driver
 * reports each load's requested keys from the adapter boundary, and the
 * model judges outcomes. Every failure and every throw has its own message,
 * which the driver records by the load's serial. The comparison checks the
 * query's status, which request error its node shows (the message of the
 * failure the model shows, or none), the coverage law, the keys a truncate replay
 * requests, and, when no load is pending and no replay is open or failed,
 * each parent row and its child and the rows an Effect over the same join
 * received. While a replay is open or failed the query keeps its last
 * complete publication private (law 9), which the model does not track, so
 * the rows check waits for the replay to succeed. A history can end with a
 * cleanup during a reload of the child, from any of the four notifications
 * (see `LazyEnding` beside the driver).
 */
// `settle-ok` and `settle-fail` settle every pending load; the `first` and
// `last` forms settle only the oldest or the newest one. `throw-next` makes
// the next load the query requests throw synchronously.
type LazyStep =
  | { kind: `parent` | `unparent`; key: RowKey }
  | {
      kind:
        | `settle-ok`
        | `settle-fail`
        | `settle-first-ok`
        | `settle-first-fail`
        | `settle-last-ok`
        | `settle-last-fail`
        | `throw-next`
        | `reload-in-load`
        | `reload`
        | `truncate`
        | `child-ready`
        | `report`
        | `fail`
        | `crash`
    }

// Keys a subset request asks for, read from its predicate's literal values.
function requestedKeys(options: LoadSubsetOptions): Set<number> {
  const keys = new Set<number>()
  const visit = (node: unknown): void => {
    if (typeof node === `number`) keys.add(node)
    else if (Array.isArray(node)) node.forEach(visit)
    else if (node && typeof node === `object`) {
      const { type, value, args } = node as {
        type?: string
        value?: unknown
        args?: Array<unknown>
      }
      if (type === `val`) visit(value)
      else args?.forEach(visit)
    }
  }
  visit(options.where)
  return keys
}

// The lazy projection over the shared demand model: `parent` and
// `unparent` change the held demand, and the Collection steps go through
// the source layer. `holdChildReady`: every child sync run holds markReady()
// until a `child-ready` step; otherwise it marks ready inside sync() or at
// once after it, within the step.
function applyLazyStep(
  model: OnDemandModel,
  step: LazyStep,
  holdChildReady: boolean,
): void {
  if (model.gate === `crashed`) return
  const { source } = model
  const failedFirstLoad = source.gate === `error`
  switch (step.kind) {
    case `parent`:
    case `unparent`: {
      // Adding a held key or removing one not held changes no demand. Every
      // parent flows into the join, also under an ordered window, which
      // limits the join's output: the query holds every parent's child.
      if (model.demand.held.has(step.key) === (step.kind === `parent`)) return
      changeDemand(model.demand, step.kind, step.key)
      parkDemandChange(model, step.kind)
      return
    }
    // Settle steps reach the model one load at a time, from the driver.
    case `settle-ok`:
    case `settle-fail`:
    case `settle-first-ok`:
    case `settle-first-fail`:
    case `settle-last-ok`:
    case `settle-last-fail`:
    case `throw-next`:
    case `reload-in-load`:
      // A reload from inside the adapter's loadSubset call rejects and
      // changes nothing, as one from inside sync() does.
      return
    case `reload`: {
      // A reload in flight returns its promise; a crashed child rejects.
      const starts = !source.reloading && source.gate !== `crashed`
      applySourceStep(model, source, `source`, { kind: `reload` })
      if (!starts) break
      startReplay(model, `reload`)
      if (!holdChildReady)
        commitOnDemand(model, () =>
          applySourceStep(model, source, `source`, { kind: `mark-ready` }),
        )
      break
    }
    case `truncate`: {
      if (adapterStopped(source)) return
      // The adapter replaces every row in the same sync run, as a
      // must-refetch does, and its truncate replay loads the demand again.
      // Before a reload's first commit, the truncate commits in the reload's
      // first transaction: it is the replacement that the reload already
      // replays, and no replay row has applied yet.
      const reloadCommit = source.armed
      commitOnDemand(model, () => {
        applySourceStep(model, source, `source`, {
          kind: `truncate`,
          markReady: false,
        })
        applySourceStep(model, source, `source`, { kind: `commit` })
      })
      if (!reloadCommit) startReplay(model, `truncate`)
      break
    }
    // The held markReady() of the child's current sync run.
    case `child-ready`:
      commitOnDemand(model, () =>
        applySourceStep(model, source, `source`, { kind: `mark-ready` }),
      )
      break
    default:
      applySourceStep(model, source, `source`, { kind: step.kind })
  }
  // A Collection that leaves its failed first load restarts its parked
  // demand.
  if (failedFirstLoad && source.gate !== `error`) restartParked(model)
  projectSourceGate(model)
}

// The states the lazy grammar's later laws depend on (ORC-015). Only the
// generated property records them.
const lazyReachStates = [
  `reload during the first load`,
  `truncate while a reload is in flight`,
  `replay load fails`,
  `superseded replay load`,
  `direct subscriber during a replay`,
  `effect compared at a quiet checkpoint`,
  `request error shown`,
  `coverage checked during an open replay`,
  `parked demand during a replay`,
  `reload from inside loadSubset`,
  `reload from inside a deferred first load`,
  `cleanup from the Collection's health:change during a reload`,
  `cleanup from the query's health:change during a reload`,
  `cleanup from loadingSubset:change during a reload`,
  `cleanup from a subscription's status:change during a reload`,
  `several request errors open`,
  `replay clears an earlier thrown failure`,
  `replay clears a retired failure`,
  `load fails after joining a failed replay`,
  `replaced load settles after its replay failed`,
  `failed replay lists several failed loads`,
  `replay failed while a load it replaced is still served`,
] as const
type LazyReach = ReturnType<
  typeof createOracleReach<(typeof lazyReachStates)[number]>
>

// `asyncChildReady`: the child Collection's reload calls markReady() after
// sync() returns, so its loads in flight settle before the replay exists.
// `honorsAbort`: the loader rejects a request whose signal aborts; one that
// does not may still finish it later.
// `deferredStart`: the child's start is deferred, as a render defers a
// source's start, and the query's preload, which is independent demand,
// releases it, so its first load enters the adapter from the deferred start. With `reload-in-first-load`, that load
// calls children.reload() inside loadSubset, which must reject (a reload
// from inside loadSubset, however the call entered the adapter).
// `holdChildReady`: every child sync run holds markReady() until a
// `child-ready` step, so the child can still be `loading` when it reloads,
// and its reload stays in flight past the new run's first commit.
// `ending`: the history ends with a cleanup during a reload of the child
// (see "Cleanup during a reload"): `cleanup()`, or with `dependents`
// `cleanup({ dependents: true })`, from the first notification `at` names.
// The model is an ordinary cleanup, admitted as any cleanup is (a plain one
// refuses while an Effect reads the child): the child ends `cleaned-up` with no sync
// run live at its adapter and the reload settled; a cascade also ends the
// query and the Effect. A plain cleanup under the query is a query failure
// that this lane does not judge. Then a fresh start commits one row, and
// that row is both the child's rows and its diff baseline: nothing of the
// reload stayed armed.
type LazyEnding = { at: ReloadNotice; dependents: boolean }
async function runLazyHistory(
  steps: ReadonlyArray<LazyStep>,
  {
    asyncChildReady = false,
    honorsAbort = true,
    holdChildReady = false,
    directSubscriber = false,
    withEffect = false,
    window,
    reach,
    requests: expectedRequests,
    deferredStart,
    ending,
  }: {
    ending?: LazyEnding
    deferredStart?: `plain` | `reload-in-first-load`
    // The query orders parents by id and shows the first `window`.
    window?: number
    // By step index, the keys of each request the adapter receives in that
    // step. A named history pins production's requests where a parked
    // prediction rests on them.
    requests?: Readonly<Record<number, ReadonlyArray<ReadonlyArray<number>>>>
    asyncChildReady?: boolean
    honorsAbort?: boolean
    holdChildReady?: boolean
    directSubscriber?: boolean
    withEffect?: boolean
    reach?: LazyReach
  } = {},
) {
  const model = freshOnDemandModel([1])
  // Without a held markReady(), the child marks ready inside sync().
  if (!holdChildReady)
    applySourceStep(model, model.source, `source`, { kind: `mark-ready` })
  // Loads in flight at the adapter, oldest first, and what the adapter saw
  // since the last report: each request, and which of them were aborted or
  // threw.
  const loads: Array<{
    serial: number
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  const requests: Array<{
    serial: number
    keys: Set<number>
    thrown: boolean
  }> = []
  const aborted = new Set<number>()
  // Adapter loads not yet settled or aborted: what the adapter still serves.
  const live = new Map<number, Set<number>>()
  // The keys and the child sync run of every request; a retired run's load
  // commits nothing.
  const loadKeys = new Map<number, Set<number>>()
  const loadRuns = new Map<number, number>()
  let run = 0
  let serials = 0
  let throwNext = false
  // The next load the query requests calls children.reload() from inside
  // the adapter's loadSubset, and the driver keeps what it returned.
  let reloadInLoad = false
  // Each with whether a reload was already in flight: then reload() returns
  // that reload's promise, as any second call does, and retires nothing.
  const reentrantReloads: Array<{ promise: Promise<void>; inFlight: boolean }> =
    []
  let failures = 0
  let childRuns = 0
  // Child sync runs started and cleaned up at the adapter, and every change
  // subscription its loads came from.
  const childRunCounts = { started: 0, ended: 0 }
  const seenSubscriptions = new Set<
    NonNullable<LoadSubsetOptions[`subscription`]>
  >()
  let parentParams!: SyncParams
  let childParams!: SyncParams
  let forgetServed = () => {}
  let heldReady: (() => void) | undefined
  const boundary = { owns: (_options: LoadSubsetOptions) => false }
  let querySubscription: unknown
  // Loads that threw, by serial.
  const thrownLoads = new Set<number>()
  // Each failed or thrown load's cause, by serial: every failure has its
  // own message, so the node's message names the failure it shows.
  const causes = new Map<number, Error>()
  const parents = createCollection<Row, number>({
    id: `health-lazy-parents-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    gcTime: 0,
    sync: {
      sync: (params) => {
        parentParams = params
        params.begin()
        params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
        params.commit()
        params.markReady()
      },
    },
  })
  const children = createCollection<Row, number>({
    id: `health-lazy-children-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    gcTime: 0,
    sync: {
      sync: (params) => {
        childParams = params
        childRunCounts.started++
        const thisRun = ++run
        // Children this sync run has served; a reload's run, or a load
        // after the run's own truncate, serves them again.
        const served = new Set<number>()
        forgetServed = () => served.clear()
        if (holdChildReady) heldReady = () => params.markReady()
        else if (childRuns++ > 0 && asyncChildReady)
          setTimeout(() => params.markReady(), 0)
        else params.markReady()
        return {
          cleanup: () => {
            childRunCounts.ended++
          },
          loadSubset: (options: LoadSubsetOptions) => {
            if (options.subscription)
              seenSubscriptions.add(options.subscription)
            // The query starts first, so its subscription makes the first
            // request. The direct subscriber's and the Effect's requests are
            // answered at once and stay out of the model.
            querySubscription ??= options.subscription
            if (
              options.subscription !== querySubscription ||
              boundary.owns(options)
            )
              return true
            const keys = requestedKeys(options)
            const serial = ++serials
            const thrown = throwNext
            throwNext = false
            if (reloadInLoad) {
              reloadInLoad = false
              // Read at the call, from the public node: the call's own
              // condition.
              const inFlight = children.health.reloading
              const promise = children.reload()
              // Judged after the step; handled now so a rejection that
              // lands before then is not reported unhandled.
              promise.catch(() => undefined)
              reentrantReloads.push({ promise, inFlight })
            }
            requests.push({ serial, keys, thrown })
            loadKeys.set(serial, keys)
            loadRuns.set(serial, thisRun)
            if (thrown) {
              const cause = new Error(`child load ${++failures} threw`)
              causes.set(serial, cause)
              throw cause
            }
            const deferred = createDeferred<void>()
            loads.push({ serial, deferred })
            live.set(serial, keys)
            // The adapter sees every abort. One that honors aborts also
            // rejects the request; one that does not may still finish it.
            options.signal?.addEventListener(`abort`, () => {
              aborted.add(serial)
              live.delete(serial)
              if (!honorsAbort) return
              model.demand.retiredInFlight.delete(serial)
              const index = loads.findIndex((load) => load.serial === serial)
              if (index !== -1) loads.splice(index, 1)
              deferred.reject(new DOMException(`aborted`, `AbortError`))
            })
            return deferred.promise.then(() => {
              params.begin()
              for (const key of keys) {
                if (served.has(key)) continue
                served.add(key)
                params.write({
                  type: `insert`,
                  value: { id: key * 10, parentId: key },
                })
              }
              params.commit()
            })
          },
        }
      },
    },
  })
  const query = createLiveQueryCollection((q) => {
    const joined = q
      .from({ parent: parents })
      .leftJoin({ child: children }, ({ parent, child }) =>
        eq(parent.id, child.parentId),
      )
    return window === undefined
      ? joined
      : joined.orderBy(({ parent }) => parent.id).limit(window)
  })
  const consoleError = console.error
  console.error = () => {}
  // Requests made since the last report, tagged with whether a truncate or
  // a source reload in this step made them.
  const report = (replayMade = false) => {
    const reported = requests.splice(0)
    for (const request of reported)
      if (request.thrown) thrownLoads.add(request.serial)
    reportRequests(
      model,
      reported,
      aborted,
      (serial) => loads.some((load) => load.serial === serial),
      replayMade,
    )
    aborted.clear()
  }
  // Settle loads at the adapter and report each outcome to the model. A
  // load of the current sync run that succeeds commits its rows first.
  const settle = (
    picked: Array<(typeof loads)[number]>,
    succeeded: boolean,
  ) => {
    for (const { serial, deferred } of picked) {
      loads.splice(
        loads.findIndex((load) => load.serial === serial),
        1,
      )
      live.delete(serial)
      if (succeeded && loadRuns.get(serial) === run)
        commitOnDemand(model, () =>
          commitLoad(model, model.source, loadKeys.get(serial)!),
        )
      const load = model.demand.pending.find((entry) => entry.serial === serial)
      // A load the replay replaced settles after the replay failed (law 16:
      // its own outcome decides nothing).
      if (
        model.demand.retiredInFlight.has(serial) &&
        model.demand.replayAttemptFailed
      )
        reach?.reach(`replaced load settles after its replay failed`)
      if (load) settleDemandLoad(model, load, succeeded)
      model.demand.retiredInFlight.delete(serial)
      if (succeeded) deferred.resolve()
      else {
        const cause = new Error(`child load ${++failures} failed`)
        causes.set(serial, cause)
        deferred.reject(cause)
      }
    }
  }
  let watcher: ReturnType<typeof watchDirectly> | undefined
  // An Effect over the same lazy join, with its delivered rows by key.
  const effectRows = new Map<
    string | number,
    readonly [number, number | null]
  >()
  let effect: ReturnType<typeof createEffect> | undefined
  const endWithCleanupDuringReload = async ({ at, dependents }: LazyEnding) => {
    const label = `ending ${JSON.stringify({ at, dependents })}`
    // The direct subscriber's view across cleanup belongs to the
    // subscription lifecycle oracle.
    watcher?.stop()
    watcher = undefined
    const ended = reloadWithCleanup(
      children,
      (notice) => {
        switch (at) {
          case `source-health`:
            return [children.on(`health:change`, notice)]
          case `query-health`:
            return [query.on(`health:change`, notice)]
          case `loading-subset`:
            return [children.on(`loadingSubset:change`, notice)]
          case `subscription-status`:
            return [...seenSubscriptions].map((subscription) =>
              subscription.on(`status:change`, notice),
            )
        }
      },
      () => children.cleanup(dependents ? { dependents: true } : undefined),
    )
    // Admission: a plain cleanup() refuses while an Effect reads the child
    // (ARCHITECTURE, "Cleanup, restart, and detached waiters"), so nothing
    // ends and the reload goes on.
    if (!dependents && effect && !effect.disposed) {
      await expect(
        ended.cleanup,
        `${label}: plain cleanup under an Effect`,
      ).rejects.toBeInstanceOf(CollectionHasSubscribersError)
      return
    }
    if (ended.notified)
      reach?.reach(
        at === `source-health`
          ? `cleanup from the Collection's health:change during a reload`
          : at === `query-health`
            ? `cleanup from the query's health:change during a reload`
            : at === `loading-subset`
              ? `cleanup from loadingSubset:change during a reload`
              : `cleanup from a subscription's status:change during a reload`,
      )
    await ended.cleanup
    await expectReloadEnded(ended, label)
    expect(children.status, `${label}: child status`).toBe(`cleaned-up`)
    expect(
      childRunCounts.started - childRunCounts.ended,
      `${label}: child sync runs live after cleanup`,
    ).toBe(0)
    if (dependents) {
      expect(query.status, `${label}: query status`).toBe(`cleaned-up`)
      if (effect) expect(effect.disposed, `${label}: effect ended`).toBe(true)
    }
    // A fresh start: its run's commit is the child's rows and baseline.
    void children.preload().catch(() => undefined)
    await flushPromises()
    childParams.begin()
    childParams.write({ type: `insert`, value: { id: 99, parentId: 99 } })
    childParams.commit()
    await flushPromises()
    expect(
      children.toArray.map((row) => row.id),
      `${label}: fresh run rows`,
    ).toEqual([99])
    expect(
      [...children._state.replacementBaseline()].map(([key]) => key),
      `${label}: fresh run baseline`,
    ).toEqual([99])
  }
  try {
    if (deferredStart) {
      expect(children._deferSyncStart(), `the child start defers`).toBe(true)
      reloadInLoad = deferredStart === `reload-in-first-load`
    }
    void query.preload().catch(() => undefined)
    await flushPromises()
    if (deferredStart) {
      // The query's preload is independent demand, which releases a deferred
      // sync start (the deferred-acquisition oracle owns that law), so its
      // first load enters the adapter from the released start.
      expect(requests.length, `the first load ran`).toBeGreaterThan(0)
    }
    report()
    for (const reentrant of reentrantReloads.splice(0)) {
      reach?.reach(`reload from inside a deferred first load`)
      expect(reentrant.inFlight).toBe(false)
      await expect(
        reentrant.promise,
        `a reload from inside the deferred first load rejects`,
      ).rejects.toBeInstanceOf(CollectionReloadDuringSyncEntryError)
    }
    if (directSubscriber) watcher = watchDirectly(children, boundary)
    if (withEffect) {
      effect = createEffect({
        query: (q) => {
          const joined = q
            .from({ parent: parents })
            .leftJoin({ child: children }, ({ parent, child }) =>
              eq(parent.id, child.parentId),
            )
          return window === undefined
            ? joined
            : joined.orderBy(({ parent }) => parent.id).limit(window)
        },
        onBatch: (events) => {
          for (const event of events) {
            const row = event.value as { parent: Row; child?: Row }
            if (event.type === `exit`) effectRows.delete(event.key)
            else
              effectRows.set(event.key, [row.parent.id, row.child?.id ?? null])
          }
        },
        onSourceError: () => {},
      })
      await flushPromises()
      report()
    }
    let announcements = 0
    query.on(`health:change`, () => announcements++)
    for (const [index, step] of steps.entries()) {
      const label = `step ${index} ${JSON.stringify(step)}`
      // A demand change that leaves the projected tree as it was keeps the
      // tree's identity and announces nothing.
      const treeBefore = query.health
      const factsBefore = JSON.stringify(project(treeBefore))
      const announcedBefore = announcements
      // Only a demand change can leave every fact as it was; a reload, a
      // settled load, or a source call can change a fact and change it back.
      const demandOnly = step.kind === `parent` || step.kind === `unparent`
      // Open (see the request error check below): a demand change during a
      // replay can show a request error and clear it at once.
      const replayBefore = model.demand.replayActive
      if (step.kind === `reload` && model.gate === `loading`)
        reach?.reach(`reload during the first load`)
      if (reloadInLoad && step.kind === `parent`)
        reach?.reach(`reload from inside loadSubset`)
      if (step.kind === `truncate` && model.source.reloading)
        reach?.reach(`truncate while a reload is in flight`)
      const truncates =
        step.kind === `truncate` &&
        model.gate !== `crashed` &&
        !adapterStopped(model.source)
      const truncateIsReloadCommit = truncates && model.source.armed
      applyLazyStep(model, step, holdChildReady)
      if (step.kind === `parent` || step.kind === `unparent`) {
        parentParams.begin()
        parentParams.write({
          type: step.kind === `parent` ? `insert` : `delete`,
          value: { id: step.key, parentId: step.key },
        })
        parentParams.commit()
      } else if (step.kind === `settle-ok`) {
        for (let round = 0; round < 5 && loads.length > 0; round++) {
          settle([...loads], true)
          await flushPromises()
          report()
        }
      } else if (step.kind === `settle-fail`) {
        // Each failure has its own message, so two problems never look alike.
        settle([...loads], false)
      } else if (step.kind.startsWith(`settle-`)) {
        const pick = step.kind.startsWith(`settle-first`)
          ? loads[0]
          : loads.at(-1)
        if (pick) settle([pick], step.kind.endsWith(`-ok`))
      } else if (step.kind === `child-ready`) {
        const ready = heldReady
        heldReady = undefined
        try {
          ready?.()
        } catch {
          // markReady() after a failed first load throws.
        }
      } else if (step.kind === `throw-next`) {
        throwNext = true
      } else if (step.kind === `reload-in-load`) {
        reloadInLoad = true
      } else if (step.kind === `reload`) {
        void children.reload().catch(() => undefined)
      } else if (step.kind === `truncate`) {
        if (truncates) {
          childParams.begin()
          // Readiness stays with markReady(), so a truncate can land while
          // a reload is still in flight.
          childParams.truncate({ markReady: false })
          childParams.commit()
          forgetServed()
        }
      } else if (step.kind === `crash`) {
        children._lifecycle.crash(new Error(`children crashed`))
      } else {
        try {
          if (step.kind === `report`)
            childParams.reportError(new Error(`source problem`))
          else childParams.fail(new Error(`source gave up`))
        } catch {
          // After fail(), the adapter's calls throw; the model ignores them.
        }
      }
      await flushPromises()
      const stepRequests = [...requests]
      if (expectedRequests?.[index])
        expect(
          stepRequests.map((request) => [...request.keys].sort()),
          `${label}: requests`,
        ).toEqual(expectedRequests[index])
      // A load that threw holds no demand, so a replay does not load its
      // key again.
      report(step.kind === `reload` || step.kind === `truncate`)
      // A truncate replays the query's demand: the adapter receives a
      // request for every key the query still needs.
      if (
        truncates &&
        !truncateIsReloadCommit &&
        (model.gate === `ready` || model.gate === `loading`)
      )
        expect(
          [...model.demand.held].filter(
            (key) =>
              !thrownLoads.has(model.demand.failed.get(key) ?? 0) &&
              stepRequests.every((request) => !request.keys.has(key)),
          ),
          `${label}: keys the truncate replay did not request`,
        ).toEqual([])
      deriveDemandGate(model)
      for (const reentrant of reentrantReloads.splice(0))
        if (reentrant.inFlight) void reentrant.promise.catch(() => undefined)
        else
          await expect(
            reentrant.promise,
            `${label}: a reload from inside loadSubset rejects`,
          ).rejects.toBeInstanceOf(CollectionReloadDuringSyncEntryError)

      expect(query.status, `${label}: query status`).toBe(model.gate)
      watcher?.check(label)
      const { demand } = model
      if (watcher && demand.replayActive)
        reach?.reach(`direct subscriber during a replay`)
      if (demand.replayFailedKeys.size > 0 || demand.replayFailed)
        reach?.reach(`replay load fails`)
      if (demand.pending.some((load) => load.superseded))
        reach?.reach(`superseded replay load`)
      if (model.gate === `ready` && expectedRequestError(demand) !== null)
        reach?.reach(`request error shown`)
      if (
        model.gate === `ready` &&
        new Set([
          ...demand.failed.values(),
          ...(demand.replayFailed ? demand.replayErrors : []),
        ]).size > 1
      )
        reach?.reach(`several request errors open`)
      for (const rule of demand.applied) reach?.reach(rule)
      expect(query.health, `${label}: stable read`).toBe(query.health)
      if (
        demandOnly &&
        !replayBefore &&
        JSON.stringify(project(query.health)) === factsBefore
      ) {
        expect(query.health, `${label}: unchanged tree keeps identity`).toBe(
          treeBefore,
        )
        expect(
          announcements,
          `${label}: unchanged tree announces nothing`,
        ).toBe(announcedBefore)
      }
      // Law 17: a step that leaves different facts, such as a failure added
      // to or gone from the request error's list, gives a new tree and
      // announces it.
      if (JSON.stringify(project(query.health)) !== factsBefore) {
        expect(query.health, `${label}: changed tree is new`).not.toBe(
          treeBefore,
        )
        expect(
          announcements,
          `${label}: changed tree is announced`,
        ).toBeGreaterThan(announcedBefore)
      }
      if (model.gate === `ready` && demand.replayActive)
        reach?.reach(`coverage checked during an open replay`)
      if (
        demand.replayAttemptFailed &&
        loads.some((load) => demand.retiredInFlight.has(load.serial))
      )
        reach?.reach(`replay failed while a load it replaced is still served`)
      if (model.source.gate === `error` && demand.replayActive)
        reach?.reach(`parked demand during a replay`)
      expectHeldDemandCovered(
        model,
        live.values(),
        query.health.error !== null,
        label,
      )
      // Law 16: the query's node shows a request error exactly while the
      // model holds one, also while a replay is open or after one failed,
      // and it is the newest open failure (maintainer decision): its message
      // names the failed load the model expects. Its `errors` lists every
      // open failure, oldest first.
      if (model.gate === `ready`) {
        const frame = expectedRequestErrors(demand)
        if (
          demand.replayFailed &&
          demand.replayErrors.filter((serial) => frame.includes(serial))
            .length > 1
        )
          reach?.reach(`failed replay lists several failed loads`)
        expectRequestErrors(query.health, frame, causes, label)
      }
      // After a failed replay the query keeps its last complete snapshot
      // private, which the model does not track.
      // Law 9: while a replay is open, its replacement stays private, so the
      // query keeps the rows of its last complete publication.
      if (
        model.gate === `ready` &&
        demand.pending.length === 0 &&
        !demand.replayFailed &&
        !demand.replayActive
      ) {
        const rows = query.toArray.map(
          (row: { parent: Row; child?: Row }) =>
            [row.parent.id, row.child?.id ?? null] as const,
        )
        expect(
          [...rows].sort((a, b) => a[0] - b[0]),
          `${label}: rows`,
        ).toEqual(
          [...demand.held]
            .sort((a, b) => a - b)
            .slice(0, window)
            .map((key) => [key, isLoaded(model, key) ? key * 10 : null]),
        )
        // An Effect over the same query that a load failure has not ended
        // has received the same rows by now.
        if (effect && !effect.disposed)
          reach?.reach(`effect compared at a quiet checkpoint`)
        if (effect && !effect.disposed)
          expect(
            [...effectRows.values()].sort((a, b) => a[0] - b[0]),
            `${label}: effect rows`,
          ).toEqual([...rows].sort((a, b) => a[0] - b[0]))
      }
    }
    if (ending) await endWithCleanupDuringReload(ending)
  } finally {
    console.error = consoleError
    watcher?.stop()
    await effect?.dispose()
    for (const { deferred } of loads.splice(0)) deferred.resolve()
    await query.cleanup()
    await parents.cleanup()
    await children.cleanup({ dependents: true })
  }
}

describe(`lazy join demand grammar`, () => {
  const key = fc.constantFrom<RowKey>(1, 2, 3)
  const step: fc.Arbitrary<LazyStep> = fc.oneof(
    key.map((k): LazyStep => ({ kind: `parent`, key: k })),
    key.map((k): LazyStep => ({ kind: `unparent`, key: k })),
    fc
      .constantFrom(
        `settle-ok` as const,
        `settle-fail` as const,
        `settle-first-ok` as const,
        `settle-first-fail` as const,
        `settle-last-ok` as const,
        `settle-last-fail` as const,
        `throw-next` as const,
        `reload-in-load` as const,
        `reload` as const,
        `truncate` as const,
        `child-ready` as const,
        `report` as const,
        `fail` as const,
        `crash` as const,
      )
      .map((kind): LazyStep => ({ kind })),
  )
  const named: Record<string, ReadonlyArray<LazyStep>> = {
    'a failed first load fails the query': [{ kind: `settle-fail` }],
    "a truncate after a reload's failed replay loads the demand again": [
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
      { kind: `truncate` },
      { kind: `settle-ok` },
    ],
    'a later load of the failed key clears its request error': [
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `settle-ok` },
    ],
    'a request error clears when the query no longer needs the failed key': [
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
      { kind: `parent`, key: 3 },
      { kind: `settle-fail` },
      { kind: `unparent`, key: 3 },
    ],
    'a pending retry does not hold a request error for a key the query no longer needs':
      [
        { kind: `settle-ok` },
        { kind: `unparent`, key: 1 },
        { kind: `parent`, key: 1 },
        { kind: `settle-fail` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 1 },
      ],
    "a failed source reload's replay is a request error": [
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
    ],
    "a failed replay's error is not reported again when another demand retires":
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 2 },
      ],
    'a load that throws keeps its error until its key loads again': [
      { kind: `settle-ok` },
      { kind: `throw-next` },
      { kind: `parent`, key: 2 },
      { kind: `parent`, key: 3 },
      { kind: `settle-ok` },
    ],
    'a failed replacement keeps its error while a still-needed key is missing':
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `parent`, key: 3 },
        { kind: `settle-ok` },
        { kind: `unparent`, key: 1 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 3 },
      ],
  }
  for (const [name, steps] of Object.entries(named))
    it(name, () => runLazyHistory(steps))
  it(`an older load's success clears its key's failure while a newer load is pending`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 3 },
        { kind: `settle-fail` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 2 },
        { kind: `settle-first-ok` },
      ],
      { honorsAbort: false },
    ))
  it(`an older load's late success does not erase its key's newer failure`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 2 },
        { kind: `parent`, key: 2 },
        { kind: `settle-last-fail` },
        { kind: `settle-first-ok` },
        { kind: `unparent`, key: 1 },
      ],
      { honorsAbort: false },
    ))
  it(`a source reload's replay keeps the error of a load that threw`, () =>
    runLazyHistory([
      { kind: `throw-next` },
      { kind: `settle-ok` },
      { kind: `unparent`, key: 1 },
      { kind: `parent`, key: 1 },
      { kind: `reload` },
      { kind: `settle-ok` },
    ]))
  it(`a demand change that asks for a failed key again keeps its replay open`, () =>
    runLazyHistory(
      [
        { kind: `reload` },
        { kind: `parent`, key: 2 },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 1 },
      ],
      { honorsAbort: false },
    ))
  it(`a first load waits for a replay load that no demand change follows`, () =>
    runLazyHistory(
      [
        { kind: `parent`, key: 3 },
        { kind: `settle-first-ok` },
        { kind: `reload` },
        { kind: `unparent`, key: 3 },
      ],
      { honorsAbort: false },
    ))
  it(`a demand change after a failed replay load requests its key again`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `parent`, key: 2 },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 1 },
      ],
      { honorsAbort: false },
    ))
  it(`a reload's retired load that fails after the replay decides nothing`, () =>
    runLazyHistory(
      [
        { kind: `reload` },
        { kind: `settle-last-ok` },
        { kind: `settle-first-fail` },
      ],
      { honorsAbort: false },
    ))
  it(`a later load of the failed key clears its error while another load is pending`, () =>
    runLazyHistory([
      { kind: `unparent`, key: 1 },
      { kind: `parent`, key: 1 },
      { kind: `parent`, key: 2 },
      { kind: `settle-first-fail` },
      { kind: `parent`, key: 3 },
      { kind: `settle-last-ok` },
    ]))
  it(`a demand change aborts a replay load and must request its still-held key again`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 1 },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  // Neighbours of the parked-join history: the parked demand is requested
  // when its source restarts, and the replay then settles as usual; the
  // parked demand retires instead, which aborts the replay.
  it(`a parked demand loads when its source restarts, and the replay then settles`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 1 },
        { kind: `reload` },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  it(`a parked replay ends when its last demand retires`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 1 },
        { kind: `unparent`, key: 1 },
        { kind: `unparent`, key: 2 },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  it(`a load that fails during a replay keeps its own error`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `parent`, key: 3 },
        { kind: `settle-last-fail` },
        { kind: `settle-first-fail` },
        { kind: `unparent`, key: 3 },
      ],
      { honorsAbort: false },
    ))
  it(`a reload during the first load fails it only for a demand still held`, () =>
    runLazyHistory([
      { kind: `parent`, key: 3 },
      { kind: `reload` },
      { kind: `settle-first-fail` },
      { kind: `parent`, key: 2 },
      { kind: `unparent`, key: 3 },
      { kind: `unparent`, key: 2 },
    ]))
  it(`a second reload replaces a load that failed during the first replay`, () =>
    runLazyHistory(
      [
        { kind: `reload` },
        { kind: `parent`, key: 3 },
        { kind: `settle-last-fail` },
        { kind: `reload` },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false },
    ))
  it(`a second reload's replay replaces the first replay's loads`, () =>
    runLazyHistory(
      [
        { kind: `parent`, key: 2 },
        { kind: `reload` },
        { kind: `reload` },
        { kind: `unparent`, key: 1 },
        { kind: `settle-first-ok` },
        { kind: `settle-last-ok` },
        { kind: `settle-first-fail` },
      ],
      { honorsAbort: false },
    ))
  it(`a reload after a truncate keeps the first load waiting for its replay`, () =>
    runLazyHistory(
      [
        { kind: `parent`, key: 3 },
        { kind: `settle-last-ok` },
        { kind: `truncate` },
        { kind: `unparent`, key: 1 },
        { kind: `reload` },
      ],
      { honorsAbort: false },
    ))
  it(`a truncate replay clears the error of a key whose retry is still pending`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `truncate` },
        { kind: `settle-last-ok` },
      ],
      { honorsAbort: false },
    ))
  it(`a failed replay succeeds for the demand left after its failed demand retires`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `settle-fail` },
        { kind: `parent`, key: 3 },
        { kind: `unparent`, key: 1 },
        { kind: `settle-ok` },
        { kind: `settle-fail` },
      ],
      { honorsAbort: false },
    ))
  it(`a demand change's replacement keeps a reload's replay open in the first load`, () =>
    runLazyHistory(
      [
        { kind: `reload` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `parent`, key: 2 },
        { kind: `settle-first-fail` },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 3 },
      ],
      { holdChildReady: true },
    ))
  it(`a first load waits for a source reload's whole replay`, () =>
    runLazyHistory(
      [
        { kind: `parent`, key: 3 },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 1 },
        { kind: `reload` },
        { kind: `settle-last-fail` },
      ],
      { honorsAbort: false },
    ))
  it(`a reload during the first load with a late ready does not fail the query`, () =>
    runLazyHistory([{ kind: `reload` }, { kind: `settle-ok` }], {
      asyncChildReady: true,
    }))
  // A failed replay stays open for the demand the query still holds: a
  // replacement that throws holds no demand, but its key's logical owner
  // stays, so the replay does not succeed with nothing loaded (law 9). The
  // newer errors of key 3's joined load and of the replacement that throws
  // show over the replay's error; once their keys retire, the replay's
  // error, still open, shows again.
  it(`a failed replay's error shows again when the newer errors over it retire`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `unparent`, key: 1 },
      { kind: `throw-next` },
      { kind: `settle-last-fail` },
      { kind: `parent`, key: 2 },
      { kind: `unparent`, key: 2 },
      { kind: `parent`, key: 1 },
      { kind: `unparent`, key: 3 },
    ]))
  // Law 10: a later load decides its key, also after a replay loaded it.
  it(`a load that throws after a replay load keeps its error when the replay succeeds`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
      { kind: `throw-next` },
      { kind: `unparent`, key: 1 },
    ]))
  // Law 9: once the failed demand retires, the replay succeeds for the
  // demand it loaded, without another load.
  it(`a failed replay succeeds when its failed demand retires after the rest loaded`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
      { kind: `unparent`, key: 1 },
    ]))
  // Law 10: a replacement that loads the failed key again decides it.
  it(`a replacement that loads a failed replay key again lets the replay succeed`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `parent`, key: 2 },
      { kind: `unparent`, key: 3 },
      { kind: `settle-ok` },
    ]))
  // Law 9: only a demand that made no request waits as parked. A replay
  // load that a child with a failed first load still serves fails the replay
  // as any replay load does.
  it(`a replay load fails the replay while its child shows a failed first load`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `settle-fail` },
      ],
      { holdChildReady: true },
    ))
  // Law 9: a load that throws fails at once, for its own demand, and the
  // replay it would have joined loaded nothing for the demand the query
  // still holds, so the replay stays open and keeps its publication private.
  it(`a replay stays open when the only replacement for its held demand throws`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `reload` },
      { kind: `throw-next` },
      { kind: `unparent`, key: 1 },
    ]))
  // Law 9: a replay load that the query aborted settled nothing, so the
  // parked demand that replaces it is still owed a load.
  it(`a parked demand that replaces an aborted replay load holds the replay`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `reload` },
        { kind: `fail` },
        { kind: `unparent`, key: 1 },
      ],
      { holdChildReady: true },
    ))
  // Law 9: a truncate aborts the loads before it and replays the demand; an
  // aborted load that the adapter still finishes decides nothing, so a
  // request error waits for the replay.
  it(`a load the truncate aborted does not clear a request error when it finishes`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-first-ok` },
      ],
      { honorsAbort: false },
    ))
  // Law 10: a demand change retries a segment whose load failed, also while
  // that failure waits for a replay; the retry then decides the key, and the
  // first load succeeds.
  it(`a demand change retries a load that failed during a replay in the first load`, () =>
    runLazyHistory(
      [
        { kind: `reload` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `settle-first-fail` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 3 },
        { kind: `settle-ok` },
      ],
      { holdChildReady: true },
    ))
  // Law 10 and law 9: a demand change retries a key whose replay load
  // failed, and the retry decides it, before the replay is judged.
  it(`a demand change retries a key whose truncate replay load failed in the first load`, () =>
    runLazyHistory(
      [
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 1 },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false },
    ))
  // Law 9: releasing an owner removes its older replay work too, so a later
  // replay for the same key does not wait for it.
  it(`older replay work of a released key does not hold a later replay`, () =>
    runLazyHistory(
      [
        { kind: `truncate` },
        { kind: `truncate` },
        { kind: `unparent`, key: 1 },
        { kind: `parent`, key: 1 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
      ],
      { honorsAbort: false },
    ))
  // Law 9: a truncate replay whose held demand only threw loaded nothing, so
  // it stays open and keeps the last complete publication private.
  it(`a truncate replay stays open while its held demand's loads threw`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `truncate` },
      { kind: `settle-first-fail` },
      { kind: `unparent`, key: 1 },
      { kind: `throw-next` },
      { kind: `parent`, key: 1 },
    ]))
  // Law 9: replacing an acquisition does not release its logical owner, so
  // the older work of a key whose replay load failed still holds the replay.
  it(`older replay work of a held key holds the replay after its replay load fails`, () =>
    runLazyHistory(
      [
        { kind: `truncate` },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `parent`, key: 2 },
        { kind: `settle-last-fail` },
      ],
      { honorsAbort: false },
    ))
  // Law 10: a replay's success does not clear the error of a key whose
  // latest load threw after the replay loaded it.
  it(`a replay's success keeps the error of a key whose later load threw`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `reload` },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
      { kind: `throw-next` },
      { kind: `unparent`, key: 1 },
      { kind: `parent`, key: 1 },
    ]))
  // A reload replays at retire only for a held acquisition; a key whose only
  // load threw holds none, so the reload's first commit replays instead and
  // decides the load that commit came from.
  it(`a reload without a held acquisition replays at its first commit`, () =>
    runLazyHistory(
      [
        { kind: `throw-next` },
        { kind: `unparent`, key: 1 },
        { kind: `parent`, key: 2 },
        { kind: `reload` },
        { kind: `parent`, key: 1 },
        { kind: `settle-last-ok` },
      ],
      { holdChildReady: true },
    ))
  // A replay re-requests a demand parked behind a failed first load; that
  // request replaces the parked wait, so the replay completes and publishes.
  it(`a truncate replay re-requests parked demand and then publishes it`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-ok` },
      ],
      { holdChildReady: true },
    ))
  // Releasing a parked demand removes its parked acquisition, so a demand
  // for the same key parks again.
  it(`a parked demand released and asked for again parks again`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 2 },
        { kind: `parent`, key: 2 },
      ],
      { holdChildReady: true },
    ))
  // A replay's failed request keeps its acquisition's coverage, so releasing
  // a parked key requests nothing more and the replay fails for the key it
  // could not load again.
  it(`a failed replay request still covers its key when a parked key retires`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 3 },
      ],
      { holdChildReady: true },
    ))
  // Law 10: a later demand change drops a parked replacement that no longer
  // matches the held keys, so a replay failure it would have replaced
  // stands.
  it(`a demand change drops a parked replacement that no longer matches`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `settle-first-fail` },
        { kind: `parent`, key: 2 },
        { kind: `unparent`, key: 2 },
        { kind: `unparent`, key: 3 },
      ],
      { holdChildReady: true },
    ))
  // Law 9: a replay succeeds as a replacement for the demand that remains;
  // one that loaded only a key the query then released, while the
  // remaining key's request threw, stays open.
  it(`a replay that loaded only a released key stays open`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `truncate` },
        { kind: `throw-next` },
        { kind: `settle-first-ok` },
        { kind: `unparent`, key: 1 },
      ],
      { honorsAbort: false },
    ))
  // Law 16: a key whose replay request threw waits for the replay's
  // verdict. When the demand change retires the replay's only other load,
  // nothing covers held demand, so nothing parks and the replay fails for
  // the thrown key.
  it(`a parked contraction leaves a thrown replay key to the replay`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `throw-next` },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `truncate` },
        { kind: `unparent`, key: 2 },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  // Growth during that replay parks only the new key: the thrown replay key
  // is not a key to request. When the contraction then retires the replay's
  // other load and the new key, nothing covers the thrown key, so the
  // replay fails for it. A parked growth that also took the thrown key
  // would hold the replay open instead.
  it(`parked growth during a replay leaves a thrown replay key to the replay`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `parent`, key: 2 },
        { kind: `throw-next` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `unparent`, key: 2 },
        { kind: `unparent`, key: 3 },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  // The same growth and contraction on a healthy source, where the driver
  // sees production's requests. The parked rule rests on them: the growth
  // requests only the new key; the first contraction requests the held
  // union, because the new key's live load still covers held demand; the
  // last requests nothing, because no live load covers it.
  it(`growth during a replay requests only the new key`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `throw-next` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `unparent`, key: 2 },
        { kind: `unparent`, key: 3 },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false, requests: { 5: [[3]], 6: [[1, 3]], 7: [] } },
    ))
  // The same healthy-source histories, where the driver sees production's
  // requests: a contraction during the replay requests the whole held
  // union only while another live load covers held demand.
  it(`a contraction during a replay requests a thrown replay key only in a union`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `parent`, key: 3 },
        { kind: `settle-ok` },
        { kind: `throw-next` },
        { kind: `truncate` },
        { kind: `unparent`, key: 2 },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false, requests: { 6: [[1], [2], [3]], 7: [[1, 3]] } },
    ))
  // A reload from inside the adapter's loadSubset rejects and changes
  // nothing; the query keeps its demand and does not crash.
  // Law 9: a demand change counts as one step. This change retires a
  // fragmented-churn replacement and another segment while the replaced
  // segment's replay load has failed; judged between the two releases, the
  // replay would succeed, but judged once after the change it fails for the
  // key the query still holds (law 16).
  it(`a demand change that retires a replacement and another segment judges the replay once`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
      { kind: `parent`, key: 3 },
      { kind: `settle-ok` },
      { kind: `unparent`, key: 3 },
      { kind: `truncate` },
      { kind: `settle-last-ok` },
      { kind: `settle-last-fail` },
      { kind: `unparent`, key: 1 },
    ]))
  it(`a reload from inside loadSubset rejects and leaves the query running`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `reload-in-load` },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
    ]))
  // Q3 (review 2): a replay replaces a load it aborts. When the replay
  // fails first and the aborted load then rejects late, the replay decided
  // the key: its error stays (law 9: the replay decides the load it
  // replaced; a replaced load's own outcome decides nothing).
  it(`an aborted load that rejects after its replay failed decides nothing`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `settle-first-fail` },
        { kind: `parent`, key: 3 },
        { kind: `settle-ok` },
        { kind: `unparent`, key: 3 },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false },
    ))
  it(`an aborted load that succeeds after its replay failed decides nothing`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `settle-first-ok` },
      ],
      { honorsAbort: false },
    ))
  // Maintainer decision (law 16): of several open request errors, the node
  // shows the newest. The load of key 3 fails first and the older load of
  // key 2 fails after it, so key 2's error shows; once key 2 retires, key
  // 3's error is the newest open one.
  // A 30-times counterexample: key 2's load failed, so its request error
  // shows, and a replay then fails for keys 2 and 3. The replay's problem
  // lists both failed loads in failure order after key 2's earlier failure,
  // which stays open, and shows the newest.
  it(`a failed replay lists its failed loads after an earlier open failure`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `reload` },
      { kind: `settle-fail` },
    ]))
  it(`a failed truncate replay lists its failed loads after an earlier open failure`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `truncate` },
      { kind: `settle-fail` },
    ]))
  // 30-times counterexamples. A failed key without a retry keeps its own
  // failure next to the failed replay's (a request error belongs to the
  // request that failed); a replay load that a later demand-change load of
  // its key replaced leaves the replay's list (law 10).
  it(`a failed key without a retry keeps its failure next to a failed replay`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 3 },
        { kind: `settle-last-fail` },
        { kind: `settle-first-ok` },
        { kind: `unparent`, key: 1 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
      ],
      { honorsAbort: false },
    ))
  it(`a replay load replaced by a later load of its key leaves the replay's list`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `truncate` },
      { kind: `settle-last-fail` },
      { kind: `unparent`, key: 1 },
      { kind: `settle-last-fail` },
    ]))
  it(`a failed replay decides a failed key's retry even when that key loaded`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `parent`, key: 3 },
      { kind: `truncate` },
      { kind: `settle-first-fail` },
      { kind: `settle-ok` },
    ]))
  it(`a failed replay lists loads that failed with the replacement for them`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-fail` },
      { kind: `reload` },
      { kind: `parent`, key: 3 },
      { kind: `unparent`, key: 3 },
      { kind: `settle-fail` },
    ]))
  it(`the node shows the newest open request error`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `parent`, key: 3 },
      { kind: `settle-last-fail` },
      { kind: `settle-first-fail` },
      { kind: `unparent`, key: 2 },
    ]))
  // Maintainer decision (law 16): a replay's success clears the error of
  // every key it loaded again, also a key whose earlier load threw. The
  // churn replacement for keys 1 and 2 throws; the truncate replay then
  // loads both again through the older loads the query still holds.
  it(`a replay's success clears the error of a key whose earlier load threw`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `settle-ok` },
      { kind: `parent`, key: 3 },
      { kind: `settle-ok` },
      { kind: `throw-next` },
      { kind: `unparent`, key: 3 },
      { kind: `truncate` },
      { kind: `settle-ok` },
    ]))
  // Maintainer decision: a request error belongs to the request that
  // failed. The churn replacement for keys 1 and 2 throws while the
  // truncate replay is in flight; when its demand retires, the replay's
  // older load of key 1 decides that key, and its success leaves no error.
  it(`a replay's success clears the error of a failed request whose demand retired`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `parent`, key: 3 },
      { kind: `truncate` },
      { kind: `throw-next` },
      { kind: `unparent`, key: 3 },
      { kind: `unparent`, key: 2 },
      { kind: `settle-ok` },
    ]))
  // Law 9 (maintainer decision): a failed replay stays open while the query
  // holds demand, and its error clears when its failed demand retires after
  // the rest loaded. Here the failed demand is the churn replacement for
  // keys 1 and 3, which fails after the replay failed; when it retires, key
  // 3's earlier replay load decides key 3, and the replay succeeds.
  it(`a failed replay succeeds when a failed replacement retires after the rest loaded`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `settle-fail` },
        { kind: `parent`, key: 3 },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `unparent`, key: 2 },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 1 },
      ],
      { honorsAbort: false },
    ))
  // Law 16 (maintainer decision): only a replay in flight defers a load's
  // error. After the truncate replay failed, key 3's load and the churn
  // replacement join it; the replacement's failure shows its own error at
  // once, although key 3's load is still pending.
  it(`a load that joins a failed replay shows its own error when it fails`, () =>
    runLazyHistory([
      { kind: `settle-ok` },
      { kind: `parent`, key: 2 },
      { kind: `truncate` },
      { kind: `settle-last-fail` },
      { kind: `settle-last-fail` },
      { kind: `parent`, key: 3 },
      { kind: `unparent`, key: 1 },
      { kind: `settle-last-fail` },
    ]))
  // Law 16 and the maintainer decision on which error shows: keys 2 and 3
  // join the reload's replay in flight, and all three loads fail in order.
  // The replay reports its error, then each joined load fails with its own
  // error in failure order, so key 3's error, the newest, shows.
  it(`loads that fail during a replay show their own errors in failure order`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        { kind: `settle-fail` },
      ],
      { honorsAbort: false },
    ))
  // Law 16: the reload's replay decides key 2's load, which fails with the
  // replay's error. That is the replay's failure, not a newer one, so key
  // 3's load, which joined the replay and fails last, shows its own error.
  it(`a load the replay decided does not make the replay's error the newest`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `reload` },
        { kind: `parent`, key: 3 },
        { kind: `settle-fail` },
      ],
      { honorsAbort: false },
    ))
  // Law 10: a key's latest load decides it. After the replay failed, key 2's
  // load and the churn replacement for keys 2 and 3 join it; key 2's older
  // load then fails while the replacement is pending, and decides nothing,
  // so the replay's error still shows.
  it(`an older load's failure decides nothing while its key's replacement is pending`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `settle-fail` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        { kind: `unparent`, key: 1 },
        { kind: `settle-first-fail` },
      ],
      { honorsAbort: false },
    ))
  // Law 16: the replay decides every load it replaces, and a replaced load's
  // own outcome decides nothing, even when it settles after the replay
  // failed. Key 2's original load, which the truncate replaced, settles
  // after the replay failed and after the churn replacement for keys 1 and
  // 2 failed; whether it fails or succeeds, key 2 keeps the replacement's
  // error, the newest, and the older replay error does not show instead.
  for (const late of [`settle-first-fail`, `settle-first-ok`] as const)
    it(`a replaced load that ${late === `settle-first-ok` ? `succeeds` : `fails`} after its replay failed keeps the newest error`, () =>
      runLazyHistory(
        [
          { kind: `settle-ok` },
          { kind: `parent`, key: 2 },
          { kind: `parent`, key: 3 },
          { kind: `truncate` },
          { kind: `settle-last-fail` },
          { kind: `settle-last-fail` },
          { kind: `settle-last-fail` },
          { kind: `unparent`, key: 3 },
          { kind: `settle-last-fail` },
          { kind: late },
          { kind: `unparent`, key: 1 },
        ],
        { honorsAbort: false },
      ))
  // A thrown churn replacement fails its keys as a rejected one does (law
  // 10: a failed load covers nothing), so the next demand change retires
  // it, and the older load that still covers the held key decides it: its
  // failure is the key's request error now (a 30-times counterexample of
  // the model, which kept the thrown replacement as the key's latest load;
  // the rejected twin always passed).
  for (const replacement of [`throws`, `rejects`] as const)
    it(`a churn replacement that ${replacement} leaves its key to the older load after the next demand change`, () =>
      runLazyHistory([
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        ...(replacement === `throws`
          ? [
              { kind: `throw-next` } as const,
              { kind: `unparent`, key: 2 } as const,
            ]
          : [
              { kind: `unparent`, key: 2 } as const,
              { kind: `settle-last-fail` } as const,
            ]),
        { kind: `unparent`, key: 1 },
        { kind: `settle-first-fail` },
      ]))
  // Law 9: the replay succeeds only as a replacement for the demand that
  // remains. A replay load of the churn replacement for {1, 2} loads both
  // keys, then the replay load of {2} fails, and the query releases the
  // replacement: what it loaded before its release does not count, so the
  // replay fails for key 2 (a 30-times counterexample of the model, which
  // let the released load decide key 2).
  it(`a released replay load's success does not count for the replay's verdict`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 3 },
        { kind: `settle-last-fail` },
        { kind: `settle-first-ok` },
        { kind: `truncate` },
        { kind: `settle-last-ok` },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `settle-ok` },
      ],
      { honorsAbort: false },
    ))
  // Law 16: the replay decides every load it replaces, at its verdict. A
  // failed key's retry that the reload replaced takes the replay's failure
  // when the replay fails, also while an adapter that ignores aborts still
  // serves the retry, and the retry's late success then decides nothing (a
  // 30-times counterexample of production, which waited for the retry's
  // transport; it passed when replayed with an adapter that honors aborts).
  for (const cause of [`reload`, `truncate`] as const)
    it(`a failed ${cause} replay decides the retry it replaced while the adapter still serves it`, () =>
      runLazyHistory(
        [
          { kind: `settle-ok` },
          { kind: `parent`, key: 2 },
          { kind: `settle-fail` },
          { kind: `unparent`, key: 1 },
          { kind: cause },
          { kind: `settle-last-fail` },
          { kind: `settle-first-ok` },
        ],
        { honorsAbort: false },
      ))
  // Law 16: a replay decides the retry it replaced, and its failure is that
  // key's failure; a later replay's failure replaces it. So the earlier
  // replay's error leaves when a later replay fails, by a load that rejects
  // or by one that throws (30-times counterexamples of production, which
  // kept the earlier replay's error as the key's own failure).
  for (const honorsAbort of [true, false])
    for (const [later, steps] of [
      [`fails`, [{ kind: `truncate` }, { kind: `settle-first-fail` }]],
      [`throws`, [{ kind: `throw-next` }, { kind: `reload` }]],
    ] as const)
      it(`a failed replay's error leaves the key whose retry it replaced when a later replay ${later}${honorsAbort ? `` : `, also when the adapter ignores aborts`}`, () =>
        runLazyHistory(
          [
            { kind: `settle-ok` },
            { kind: `parent`, key: 2 },
            { kind: `settle-fail` },
            { kind: `unparent`, key: 1 },
            { kind: `reload` },
            { kind: `settle-last-fail` },
            { kind: `settle-ok` },
            ...steps,
          ],
          { honorsAbort },
        ))
  // Law 10: a failed load covers nothing, so a replacement that asks for its
  // keys again after it failed is their acquisition now. A failed replay
  // lists a failed replay load only until such a request, also when the
  // replacement fails too (maintainer decision; 30-times counterexamples of
  // production, which listed every replay load whose replacement failed).
  for (const [name, steps] of [
    [
      `a contraction`,
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 3 },
        { kind: `settle-first-fail` },
        { kind: `unparent`, key: 3 },
        { kind: `settle-fail` },
      ],
    ],
    [
      `a churn after a failed reload`,
      [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `settle-fail` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `settle-fail` },
      ],
    ],
  ] as const)
    it(`a failed replay does not list a failed load that ${name} asked for again`, () =>
      runLazyHistory(steps))
  // Law 16: a parked acquisition that retries a failed key is that key's
  // pending retry, so the replay that requests it replaces it, and the key
  // takes the replay's failure (a 30-times counterexample of the model,
  // which dropped the parked retry before it judged the retries).
  it(`a failed replay replaces a parked retry of a failed key`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `fail` },
        { kind: `unparent`, key: 1 },
        { kind: `truncate` },
        { kind: `settle-first-fail` },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  // Law 9: a failed replay request the query released holds nothing, so a
  // parked demand change that asks for its key again parks it, and the key
  // stays covered (a 30-times counterexample of the model, which left it to
  // the released request's verdict).
  it(`a parked growth asks again for a key whose released replay request failed`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `fail` },
        { kind: `truncate` },
        { kind: `parent`, key: 2 },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `parent`, key: 1 },
        { kind: `unparent`, key: 2 },
      ],
      { honorsAbort: false, holdChildReady: true },
    ))
  // Law 9: a failed replay with no logical demand left ends, and its error
  // goes, also when the last demand's only request threw, so no acquisition
  // was left to release (a 30-times counterexample of production, which
  // kept the failed replay open).
  for (const honorsAbort of [true, false])
    it(`a failed replay ends when the last demand, whose request threw, retires${honorsAbort ? `` : `, also when the adapter ignores aborts`}`, () =>
      runLazyHistory(
        [
          { kind: `settle-ok` },
          { kind: `parent`, key: 2 },
          { kind: `settle-fail` },
          { kind: `unparent`, key: 1 },
          { kind: `reload` },
          { kind: `settle-last-fail` },
          { kind: `parent`, key: 1 },
          { kind: `throw-next` },
          { kind: `settle-fail` },
          { kind: `unparent`, key: 1 },
          { kind: `unparent`, key: 2 },
        ],
        { honorsAbort },
      ))
  // Law 9: releasing the owner removes its older work from readiness. A
  // first-load request that a truncate retired, and that an adapter which
  // ignores aborts still serves, stops holding the first load once the
  // query releases its key, also when the query asks for the key again: the
  // new demand is a new owner (a 30-times counterexample of the model).
  it(`a retired first load released and asked for again no longer holds the first load`, () =>
    runLazyHistory(
      [
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `unparent`, key: 1 },
        { kind: `parent`, key: 1 },
        { kind: `settle-last-ok` },
        { kind: `unparent`, key: 3 },
      ],
      { honorsAbort: false },
    ))
  // Q1 (review 2): an ordered window over the join. A lazy load that fails
  // after readiness is a request error, and the query still publishes the
  // window's rows (law 16: a failed request does not hold publication).
  it(`a failed lazy load under an ordered window still publishes the window`, () =>
    runLazyHistory(
      [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `parent`, key: 3 },
        { kind: `settle-ok` },
      ],
      { window: 2 },
    ))
  // Q4 (review 2): a load that waited for a deferred start (DbClient
  // hydration defers a start through this seam) runs the adapter's
  // loadSubset when the start resumes. A reload from inside that call
  // rejects, as from any loadSubset call.
  it(`a reload from inside a deferred loadSubset rejects`, async () => {
    let reentrant: Promise<void> | undefined
    const children = createCollection<Row, number>({
      id: `health-deferred-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      startSync: false,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              if (!reentrant) {
                reentrant = children.reload()
                reentrant.catch(() => undefined)
              }
              return true
            },
          }
        },
      },
    })
    expect(children._deferSyncStart()).toBe(true)
    const query = createLiveQueryCollection((q) => q.from({ row: children }))
    void query.preload().catch(() => undefined)
    await flushPromises()
    children._resumeSyncStart()
    await flushPromises()
    expect(reentrant, `the deferred load ran`).toBeDefined()
    await expect(reentrant).rejects.toBeInstanceOf(
      CollectionReloadDuringSyncEntryError,
    )
    await query.cleanup()
    await children.cleanup()
  })
  // Q6 (review 2): cleanup run from a subscription's status listener while
  // a reload retires the run ends that reload with its run. A later fresh
  // start then has the rows it loads as its diff baseline: no reload's
  // replacement is armed (law 14: cleanup discards the run's state).
  it(`a cleanup run while a reload retires the run leaves no replacement armed`, async () => {
    let params!: SyncParams
    let syncCalls = 0
    const source = createCollection<Row, number>({
      id: `health-reentrant-cleanup-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (next) => {
          syncCalls++
          params = next
          next.markReady()
          return { loadSubset: () => new Promise<void>(() => {}) }
        },
      },
    })
    await source.preload()
    const subscription = source.subscribeChanges(() => {}, {
      includeInitialState: true,
    })
    subscription.requestSnapshot({
      where: undefined as never,
      optimizedOnly: false,
    } as never)
    let cleanup: Promise<void> | undefined
    subscription.on(`status:change`, () => {
      cleanup ??= source.cleanup().catch(() => undefined)
    })
    void source.reload().catch(() => undefined)
    await cleanup
    await flushPromises()
    expect(syncCalls, `the ended reload starts no sync run`).toBe(1)
    subscription.unsubscribe()
    await source.preload()
    params.begin()
    params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    params.commit()
    await flushPromises()
    expect(cleanup, `the listener ran during the reload`).toBeDefined()
    expect(
      [...source._state.replacementBaseline()].map(([key]) => key),
      `the fresh run's diff baseline`,
    ).toEqual([1])
    await source.cleanup()
  })
  // The generated replay of the witness above: a cleanup from the query's
  // subscription's status listener while the reload replays its demand,
  // for each cleanup form.
  it.each([false, true])(
    `a cleanup from a subscription's status listener during a reload leaves no replacement armed (dependents: %s)`,
    (dependents) =>
      runLazyHistory([{ kind: `settle-ok` }], {
        ending: { at: `subscription-status`, dependents },
      }),
  )
  // Q7 (review 2): a reload's new run that calls markReady() while a direct
  // transaction is open replaces the rows with none at that markReady(),
  // and the direct transaction still commits on top of the replacement.
  it(`markReady() during a reload with an open direct write keeps the write committable`, async () => {
    let params!: SyncParams
    const source = createCollection<Row, number>({
      id: `health-direct-ready-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          if (source.status === `loading`) {
            next.begin()
            next.write({ type: `insert`, value: { id: 1, parentId: 1 } })
            next.commit()
            next.markReady()
          }
        },
      },
    })
    await source.preload()
    const reload = source.reload()
    params.begin({ direct: true })
    params.write({ type: `insert`, value: { id: 2, parentId: 2 } })
    params.markReady()
    expect(
      () => params.write({ type: `insert`, value: { id: 3, parentId: 3 } }),
      `the direct transaction still takes writes`,
    ).not.toThrow()
    expect(
      () => params.commit(),
      `the direct write still commits`,
    ).not.toThrow()
    await reload
    expect(source.toArray.map((row) => row.id)).toEqual([2, 3])
    await source.cleanup()
  })
  const lazyReach = createOracleReach(
    `source-health.lazy-demand`,
    lazyReachStates,
  )
  let lazyHistoriesRan = false
  afterAll(() => {
    if (lazyHistoriesRan) lazyReach.assertReached()
  })
  // Prefixes that enter a declared reach state that random steps alone rarely
  // reach at the base run count, with the driver options the state needs.
  // Random steps follow each one.
  const lazyReachPrefixes: ReadonlyArray<{
    steps: ReadonlyArray<LazyStep>
    holdChildReady?: boolean
    honorsAbort?: boolean
  }> = [
    { steps: [{ kind: `reload` }, { kind: `truncate` }], holdChildReady: true },
    {
      steps: [
        { kind: `settle-ok` },
        { kind: `reload` },
        { kind: `settle-fail` },
      ],
    },
    {
      steps: [{ kind: `truncate` }, { kind: `truncate` }],
      honorsAbort: false,
    },
    {
      steps: [{ kind: `settle-ok` }, { kind: `fail` }, { kind: `truncate` }],
      holdChildReady: true,
    },
    {
      steps: [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
      ],
    },
    // A replay loads again a key whose earlier load threw; then a failed
    // request's demand retires before the replay that loads its key
    // succeeds.
    {
      steps: [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-ok` },
        { kind: `parent`, key: 3 },
        { kind: `settle-ok` },
        { kind: `throw-next` },
        { kind: `unparent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-ok` },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `throw-next` },
        { kind: `unparent`, key: 3 },
        { kind: `unparent`, key: 2 },
        { kind: `settle-ok` },
      ],
      holdChildReady: false,
      honorsAbort: true,
    },
    // A failed key's retry that a reload replaced is still served when the
    // replay fails.
    {
      steps: [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `settle-fail` },
        { kind: `unparent`, key: 1 },
        { kind: `reload` },
        { kind: `settle-last-fail` },
      ],
      holdChildReady: false,
      honorsAbort: false,
    },
    // Several request errors open: a replay failed, and a load that joined
    // it failed with its own error; then a load the replay replaced settles
    // after the replay failed.
    {
      steps: [
        { kind: `settle-ok` },
        { kind: `parent`, key: 2 },
        { kind: `parent`, key: 3 },
        { kind: `truncate` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `settle-last-fail` },
        { kind: `unparent`, key: 3 },
        { kind: `settle-last-fail` },
        { kind: `settle-first-ok` },
      ],
      holdChildReady: false,
      honorsAbort: false,
    },
  ]
  fcTest.prop(
    [
      fc
        .tuple(
          fc.option(fc.constantFrom(...lazyReachPrefixes), { freq: 2 }),
          fc.array(step, { maxLength: 10 }),
        )
        .map(([prefix, rest]) => ({ prefix, rest })),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.constantFrom(
        undefined,
        `plain` as const,
        `reload-in-first-load` as const,
      ),
      fc.option(
        fc.record({
          at: fc.constantFrom<ReloadNotice>(
            `source-health`,
            `query-health`,
            `loading-subset`,
            `subscription-status`,
          ),
          dependents: fc.boolean(),
        }),
        { freq: 2, nil: undefined },
      ),
    ],
    oraclePropertyOptions(100, `source-health.lazy-demand`),
  )(
    `generated lazy demand histories refine the model`,
    (
      { prefix, rest },
      asyncChildReady,
      generatedHonorsAbort,
      generatedHoldChildReady,
      directSubscriber,
      withEffect,
      windowed,
      deferredStart,
      ending,
    ) => {
      const steps = [...(prefix?.steps ?? []), ...rest]
      const honorsAbort = prefix?.honorsAbort ?? generatedHonorsAbort
      const holdChildReady = prefix?.holdChildReady ?? generatedHoldChildReady
      lazyHistoriesRan = true
      lazyReach.beginHistory()
      return withDeadline(
        runLazyHistory(steps, {
          asyncChildReady,
          honorsAbort,
          holdChildReady,
          directSubscriber,
          withEffect,
          window: windowed ? 2 : undefined,
          reach: lazyReach,
          deferredStart,
          ending,
        }),
      )
    },
    120_000,
  )
})

// ---------------------------------------------------------------------------
// Effect lane
// ---------------------------------------------------------------------------

/**
 * An Effect works the same as a query. Its initial-query readiness is its
 * initial load: every
 * initial load has settled and every eager source is ready, whether or not it
 * has `skipInitial`. `skipInitial` only decides whether the initial rows are
 * delivered. As for a live query, a crashed source ends the Effect through
 * `onSourceError` at any time, and a source whose first load fails ends it
 * before its initial-query readiness. An on-demand source can fail its first
 * load after that readiness, because the readiness follows the Effect's
 * settled loads; like every other source problem after it, that is a sync
 * problem on the source's node: it does not dispose the Effect, and
 * `onHealthChange` receives the health tree, with one node per source alias.
 *
 * The lane crosses `skipInitial`, the source mode, and when the source fails.
 * Before initial-query readiness, an eager source has not called `markReady()`, and an
 * on-demand source still has its first load pending. After it, the
 * source calls `fail()`, which fails the first load of an on-demand source
 * still in its initial sync and sets the `error` of an eager source after
 * Collection readiness, or it crashes, or it reaches Collection readiness
 * (on-demand only) and then reports a `failureReason`. Every history also checks that one change reaches
 * `onHealthChange` once: no two reported trees are the same object. The app
 * knows the tree the gate opens on, announced or not (laws 16 and 17), so a
 * healthy gate announces nothing, and each later change is one call.
 */
describe(`effect errors`, () => {
  type EffectHistory = {
    skipInitial: boolean
    syncMode: `eager` | `on-demand`
    failure:
      | `before gate`
      | `fail after gate`
      | `crash after gate`
      | `report after gate`
      | `problem before the Effect`
  }
  const histories: Array<EffectHistory> = [true, false].flatMap((skipInitial) =>
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      (
        [
          `before gate`,
          `fail after gate`,
          `crash after gate`,
          `report after gate`,
          `problem before the Effect`,
        ] as const
      ).map((failure) => ({ skipInitial, syncMode, failure })),
    ),
  )

  it.each(histories)(`%j`, async ({ skipInitial, syncMode, failure }) => {
    let params!: SyncParams
    let settleLoad = () => {}
    const writeRow = () => {
      params.begin()
      params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
      params.commit()
    }
    const source = createCollection<Row, number>({
      id: `health-effect-${syncMode}-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          if (syncMode === `eager`) return undefined
          return {
            loadSubset: () =>
              new Promise<void>((resolve) => {
                settleLoad = () => {
                  writeRow()
                  resolve()
                }
              }),
          }
        },
      },
    })
    const sourceErrors: Array<Error> = []
    const trees: Array<HealthNode> = []
    const delivered: Array<unknown> = []
    const startEffect = () =>
      createEffect({
        query: (q) => q.from({ row: source }),
        skipInitial,
        onBatch: (events) => {
          delivered.push(...events.map((event) => event.key))
        },
        onSourceError: (error) => sourceErrors.push(error),
        onHealthChange: (health) => trees.push(health),
      })
    const consoleError = console.error
    console.error = () => {}
    // A source can already be ready and report a problem when the Effect is
    // created. Law 16: after the Effect's initial-query readiness, a sync
    // problem reaches onHealthChange, so the gate reports the tree it opens
    // on once (law 17: every change is announced).
    if (failure === `problem before the Effect`) {
      void source.preload()
      await flushPromises()
      if (syncMode === `eager`) {
        writeRow()
        params.markReady()
      } else params.markReady()
      await flushPromises()
      params.reportError(new Error(`stalled`))
    }
    const effect = startEffect()
    try {
      await flushPromises()
      if (failure === `problem before the Effect`) {
        if (syncMode === `on-demand`) settleLoad()
        await flushPromises()
        expect(effect.disposed).toBe(false)
        expect(trees, `the gate reports the problem once`).toHaveLength(1)
        expect(trees[0]).toMatchObject({
          hasErrors: true,
          sources: [{ alias: `row`, failureReason: { message: `stalled` } }],
        })
        return
      }
      if (failure === `before gate`) {
        params.fail(new Error(`gave up`))
        await flushPromises()
        // Model: the Effect never reached initial-query readiness, so the failure
        // ends it.
        expect(effect.disposed).toBe(true)
        expect(sourceErrors).toHaveLength(1)
        expect(trees).toEqual([])
        return
      }
      // Reach initial-query readiness: the eager source becomes ready, or the on-demand
      // source's first load settles.
      if (syncMode === `eager`) {
        writeRow()
        params.markReady()
      } else {
        settleLoad()
      }
      await flushPromises()
      // Model: only `skipInitial` withholds the initial rows.
      expect(delivered).toEqual(skipInitial ? [] : [1])
      // The status change that completes the gate is part of the gate's
      // tree, not a change after it.
      expect(trees, `a healthy gate announces nothing`).toEqual([])

      if (failure === `report after gate`) {
        // An on-demand source reaches its own Collection readiness after the
        // Effect's: a status change that must reach onHealthChange once.
        if (syncMode === `on-demand`) params.markReady()
        await flushPromises()
        params.reportError(new Error(`stalled`))
        await flushPromises()
        expect(effect.disposed).toBe(false)
        expect(trees.at(-1)).toMatchObject({
          hasErrors: true,
          sources: [
            {
              alias: `row`,
              failureReason: { message: `stalled` },
              error: null,
            },
          ],
        })
        expect(new Set(trees).size, `one report per change`).toBe(trees.length)
        // The on-demand source's own readiness is one change, the report
        // another.
        expect(trees, `one call per change`).toHaveLength(
          syncMode === `on-demand` ? 2 : 1,
        )
        return
      }
      if (failure === `crash after gate`) {
        params.collection._lifecycle.crash(new Error(`crashed`))
      } else {
        params.fail(new Error(`gave up`))
      }
      await flushPromises()
      // Model: only a crash ends the Effect after its gate. A failed first
      // load of an on-demand source and an eager source's fail after
      // Collection readiness are both the source node's `error`.
      const ends = failure === `crash after gate`
      expect(effect.disposed).toBe(ends)
      expect(sourceErrors).toHaveLength(ends ? 1 : 0)
      expect(new Set(trees).size, `one report per change`).toBe(trees.length)
      if (!ends) expect(trees, `one call per change`).toHaveLength(1)
      if (!ends) {
        expect(trees.at(-1)).toMatchObject({
          kind: `live-query`,
          hasErrors: true,
          sources: [
            {
              alias: `row`,
              status: syncMode === `on-demand` ? `error` : `ready`,
              failureReason: null,
              error: { message: `gave up` },
            },
          ],
        })
      }
    } finally {
      console.error = consoleError
      await effect.dispose()
      await source.cleanup()
    }
  })
})

// Where an Effect's gate opens must not change what it announces. The gate
// can open when the Effect starts (every source already ready), inside a
// source's `status:change` (an eager source, a nested query, or a join's
// second source becomes ready after the Effect), or when a load settles (an
// on-demand source). The app knows the tree the gate opens on, announced or
// not (laws 16 and 17). Model: after a healthy gate `onHealthChange` has had
// no call, and the next change is exactly one call with the changed facts.
// The on-demand row makes its source ready after the gate, a real change on
// the source's node, so an Effect that suppresses a real first change fails.
describe(`effect healthy gate`, () => {
  type Opener =
    | `eager source ready after the Effect`
    | `eager source ready before the Effect`
    | `on-demand first load settles`
    | `nested query ready after the Effect`
    | `second join source ready after the Effect`
  const openers: Array<Opener> = [
    `eager source ready after the Effect`,
    `eager source ready before the Effect`,
    `on-demand first load settles`,
    `nested query ready after the Effect`,
    `second join source ready after the Effect`,
  ]
  it.each(openers)(`%s`, async (opener) => {
    const syncMode =
      opener === `on-demand first load settles` ? `on-demand` : `eager`
    const sources = [`a`, `b`].map((name) => {
      const state: { params?: SyncParams; settle: () => void } = {
        settle: () => {},
      }
      const collection = createCollection<Row, number>({
        id: `health-gate-${name}-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: name === `a` ? syncMode : `eager`,
        gcTime: 0,
        sync: {
          sync: (params) => {
            state.params = params
            params.begin()
            params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
            params.commit()
            if (name === `a` && syncMode === `on-demand`)
              return {
                loadSubset: () =>
                  new Promise<void>((resolve) => {
                    state.settle = resolve
                  }),
              }
            return undefined
          },
        },
      })
      return { collection, state }
    })
    const [a, b] = sources as [(typeof sources)[0], (typeof sources)[0]]
    const nested =
      opener === `nested query ready after the Effect`
        ? createLiveQueryCollection((q) => q.from({ row: a.collection }))
        : undefined
    const trees: Array<HealthNode> = []
    const consoleError = console.error
    console.error = () => {}
    if (opener === `eager source ready before the Effect`) {
      void a.collection.preload()
      await flushPromises()
      a.state.params!.markReady()
      await flushPromises()
    }
    if (opener === `second join source ready after the Effect`) {
      void a.collection.preload()
      await flushPromises()
      a.state.params!.markReady()
      await flushPromises()
    }
    const effect = createEffect({
      query: (q) =>
        opener === `second join source ready after the Effect`
          ? q
              .from({ row: a.collection })
              .join({ other: b.collection }, ({ row, other }) =>
                eq(row.id, other.id),
              )
          : nested
            ? q.from({ view: nested })
            : q.from({ row: a.collection }),
      onBatch: () => {},
      onHealthChange: (health) => trees.push(health),
    })
    try {
      await flushPromises()
      // Open the gate.
      if (opener === `on-demand first load settles`) a.state.settle()
      else if (opener === `second join source ready after the Effect`)
        b.state.params!.markReady()
      else if (opener !== `eager source ready before the Effect`)
        a.state.params!.markReady()
      await flushPromises()
      expect(effect.disposed).toBe(false)
      expect(trees, `a healthy gate announces nothing`).toEqual([])
      // One change after the gate: the on-demand source, still loading at
      // the gate, becomes ready; every other source reports a problem.
      if (opener === `on-demand first load settles`) a.state.params!.markReady()
      else a.state.params!.reportError(new Error(`stalled`))
      await flushPromises()
      expect(trees, `one call for the change`).toHaveLength(1)
      expect(trees[0]!.hasErrors).toBe(
        opener !== `on-demand first load settles`,
      )
    } finally {
      console.error = consoleError
      await effect.dispose()
      await nested?.cleanup().catch(() => undefined)
      await a.collection.cleanup().catch(() => undefined)
      await b.collection.cleanup().catch(() => undefined)
    }
  })
})

// The Effect lane above creates the Effect first. A source can already be in
// `error` (its first load failed) or `crashed` when the Effect subscribes.
// No status change follows, so the Effect must read the status when it
// subscribes. Model: the Effect never reaches its gate, so either status ends
// it through `onSourceError` once, and no tree is reported.
describe(`effect over a source that already stopped`, () => {
  const histories = ([`error`, `crashed`] as const).flatMap((status) =>
    [true, false].map((skipInitial) => ({ status, skipInitial })),
  )

  it.each(histories)(`%j`, async ({ status, skipInitial }) => {
    let loads = 0
    const source = createCollection<Row, number>({
      id: `health-effect-stopped-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          if (status === `error`) params.fail(new Error(`first load failed`))
          else params.markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
          }
        },
      },
    })
    await source.preload().catch(() => undefined)
    if (status === `crashed`) source._lifecycle.crash(new Error(`crashed`))
    expect(source.status).toBe(status)
    const listeners = () =>
      [
        ...(
          source as unknown as {
            _events: { listeners: Map<string, Map<unknown, unknown>> }
          }
        )._events.listeners.values(),
      ].reduce((sum, set) => sum + set.size, 0)
    const listenersBefore = listeners()
    const sourceErrors: Array<Error> = []
    const trees: Array<HealthNode> = []
    const consoleError = console.error
    console.error = () => {}
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      skipInitial,
      onBatch: () => {},
      onSourceError: (error) => sourceErrors.push(error),
      onHealthChange: (health) => trees.push(health),
    })
    try {
      await flushPromises()
      expect(effect.disposed).toBe(true)
      expect(sourceErrors).toHaveLength(1)
      expect(trees).toEqual([])
      // It ends before any subscription or load reaches the source, and it
      // leaves no listener on it.
      expect(loads, `loads issued to the stopped source`).toBe(0)
      expect(source.subscriberCount).toBe(0)
      expect(listeners(), `listeners left on the source`).toBe(listenersBefore)
    } finally {
      console.error = consoleError
      await effect.dispose()
      await source.cleanup()
    }
  })
})

/**
 * An Effect has no request errors: a load that fails after its gate, as
 * before it, ends the Effect through `onSourceError`, and no tree it reported
 * shows the failure. The parents lead the Effect, and a lazy join loads the
 * children each new parent row reaches. The lane crosses `skipInitial` with
 * the parents' source mode.
 */
describe(`effect load failures`, () => {
  type RequestHistory = {
    skipInitial: boolean
    parentMode: `eager` | `on-demand`
  }
  const histories: Array<RequestHistory> = [true, false].flatMap(
    (skipInitial) =>
      ([`eager`, `on-demand`] as const).map((parentMode) => ({
        skipInitial,
        parentMode,
      })),
  )

  it.each(histories)(`%j`, async ({ skipInitial, parentMode }) => {
    let parentParams!: SyncParams
    const outcomes: Array<`ok` | `fail`> = []
    const parents = createCollection<Row, number>({
      id: `health-effect-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: parentMode,
      gcTime: 0,
      sync: {
        sync: (params) => {
          parentParams = params
          if (parentMode === `on-demand`) {
            params.markReady()
            return { loadSubset: () => Promise.resolve() }
          }
          return undefined
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-effect-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () =>
              (outcomes.shift() ?? `ok`) === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`child load failed`)),
          }
        },
      },
    })
    const writeParent = (id: number) => {
      parentParams.begin()
      parentParams.write({ type: `insert`, value: { id, parentId: id } })
      parentParams.commit()
    }
    const sourceErrors: Array<Error> = []
    const trees: Array<HealthNode> = []
    const effect = createEffect({
      query: (q) =>
        q
          .from({ parent: parents })
          .leftJoin({ child: children }, ({ parent, child }) =>
            eq(parent.id, child.parentId),
          ),
      skipInitial,
      onBatch: () => {},
      onSourceError: (error) => sourceErrors.push(error),
      onHealthChange: (health) => trees.push(health),
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await flushPromises()
      writeParent(1)
      if (parentMode === `eager`) parentParams.markReady()
      await flushPromises()

      // Model: after initial-query readiness, a failed load ends the Effect.
      outcomes.push(`fail`)
      writeParent(2)
      await flushPromises()
      expect(effect.disposed).toBe(true)
      expect(sourceErrors.map((error) => error.message)).toEqual([
        `child load failed`,
      ])
      expect(trees.every((tree) => tree.error === null)).toBe(true)
    } finally {
      console.error = consoleError
      await effect.dispose()
      await parents.cleanup()
      await children.cleanup()
    }
  })
})

/**
 * Two includes that read one Collection under the same alias are two include
 * nodes, and the query fixes that shape, so a cleaned-up query keeps them. A
 * per-row child Collection that starts changes nothing in the tree, so it
 * emits no `health:change`; otherwise every new parent row would rebuild it.
 */
// A pooled view's tree keeps node identity, as every tree does, whatever
// alias its query gives the source, including the alias `root` that the
// view's own node shows. The generated pooled shape uses one alias.
describe(`pooled view node identity`, () => {
  it.each([`row`, `root`])(`with source alias %s`, async (alias) => {
    let params!: SyncParams
    const source = createCollection<Row, number>({
      id: `health-pooled-alias-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          next.begin()
          next.write({ type: `insert`, value: { id: 1, parentId: 1 } })
          next.commit()
          next.markReady()
        },
      },
    })
    const view = createPooledLiveQuery(
      new Query()
        .from({ [alias]: source })
        .where((refs) =>
          eq(
            (refs as Record<string, { parentId: number }>)[alias]!.parentId,
            1,
          ),
        ) as unknown as Parameters<typeof createPooledLiveQuery>[0],
    ) as unknown as PooledView
    const subscription = view.subscribeChanges(() => {})
    try {
      await source.preload()
      const first = view.health
      expect(first.sources.map((node) => node.alias)).toEqual([alias])
      expect(view.health, `a second read gives the same tree`).toBe(first)
      params.reportError(new Error(`stalled`))
      const reported = view.health
      expect(reported).not.toBe(first)
      expect(view.health, `the changed tree is stable too`).toBe(reported)
      expect(reported.sources[0]!.failureReason?.message).toBe(`stalled`)
    } finally {
      subscription.unsubscribe()
      await source.cleanup({ dependents: true })
    }
  })
})

describe(`include nodes`, () => {
  it(`keep their shape, and healthy children change nothing`, async () => {
    const make = (name: string) => {
      let params!: SyncParams
      const collection = createCollection<Row, number>({
        id: `health-include-${name}-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: (next) => {
            params = next
          },
        },
      })
      const write = (row: Row, type: `insert` | `delete` = `insert`) => {
        params.begin()
        params.write({ type, value: row })
        params.commit()
      }
      return { collection, write, ready: () => params.markReady() }
    }
    const A = make(`A`)
    const B = make(`B`)
    const query = createLiveQueryCollection((q) =>
      q.from({ b: B.collection }).select(({ b }) => ({
        id: b.id,
        items: include(
          q.from({ a: A.collection }).where(({ a }) => eq(a.parentId, b.id)),
        ),
        same: include(
          q.from({ a: A.collection }).where(({ a }) => eq(a.id, b.id)),
        ),
      })),
    )
    const consoleError = console.error
    console.error = () => {}
    try {
      const preload = query.preload()
      B.write({ id: 1, parentId: 1 })
      B.write({ id: 2, parentId: 2 })
      B.ready()
      A.write({ id: 1, parentId: 1 })
      A.ready()
      await preload
      const includes = () => query.health.sources.slice(1)
      expect(includes().map((node) => [node.alias, node.kind])).toEqual([
        [`a`, `include`],
        [`a`, `include`],
      ])

      let events = 0
      const stop = query.on(`health:change`, () => {
        events++
      })
      // New parent rows start healthy child Collections. Every tree change is
      // announced, so with no event the tree is the same object.
      const treeBefore = query.health
      B.write({ id: 3, parentId: 3 })
      B.write({ id: 4, parentId: 4 })
      await flushPromises()
      stop()
      expect(events, `healthy children emit no health:change`).toBe(0)
      expect(query.health, `no tree change without an event`).toBe(treeBefore)

      // The tree's shape comes from the query, so a cleaned-up query keeps
      // its include nodes.
      await query.cleanup()
      expect(includes().map((node) => node.kind)).toEqual([
        `include`,
        `include`,
      ])
    } finally {
      console.error = consoleError
      await query.cleanup()
      await A.collection.cleanup()
      await B.collection.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Request error bookkeeping
// ---------------------------------------------------------------------------

/**
 * A live query or Effect can have several failed requests at once, one per
 * issuer (a needed key of a lazy demand, a replay, or a root source), and a
 * failed replay is one request with every failed load it was judged on. Its
 * node shows one problem: the most recent failure among the requests still
 * failing (maintainer decision: the newest open failure), and the problem's
 * `errors` lists every failure still failing, once each, oldest first
 * (maintainer decision: a problem lists the failures of its frame). Two
 * requests that fail with one error are one failure, and it keeps the place
 * of its first failure: a load that the replay decided fails with the
 * replay's error, and that is not a newer failure (law 16). When the last
 * one settles, the node is healthy again. The problem keeps its identity
 * until its failures change: adding or removing one, also one that is not
 * the newest, is a change (law 17). The model is a list of failures, each
 * with its issuer, its cause, and the order of the cause's first failure;
 * the production driver is the shared `RequestErrors` tracker, and the check
 * compares the shown cause and the listed causes after every step, plus
 * whether a report or a settle changed the problem. `fail-shared` fails an
 * issuer with the cause another issuer still fails with; `fail-several`
 * fails an issuer with two new causes, as a failed replay does.
 */
describe(`request error bookkeeping`, () => {
  const key = fc.constantFrom(`a`, `b`, `c`)
  const step = fc.oneof(
    fc.record({ kind: fc.constant(`fail` as const), key }),
    fc.record({ kind: fc.constant(`fail-shared` as const), key }),
    fc.record({ kind: fc.constant(`fail-several` as const), key }),
    fc.record({ kind: fc.constant(`settle` as const), key }),
  )
  fcTest.prop(
    [fc.array(step, { maxLength: 12 })],
    oraclePropertyOptions(100, `source-health.request-errors`),
  )(
    `a node shows the latest failure still failing and lists them all`,
    (steps) => {
      const tracker = new RequestErrors()
      const failing: Array<{ key: string; cause: Error; order: number }> = []
      let failures = 0
      // The failures still failing, once per cause, oldest first.
      const listed = () => [
        ...new Set(
          [...failing]
            .sort((a, b) => a.order - b.order)
            .map(({ cause }) => cause),
        ),
      ]
      const same = (a: Array<Error>, b: Array<Error>) =>
        a.length === b.length && a.every((cause, index) => cause === b[index])
      for (const { kind, key: issuer } of steps) {
        const before = listed()
        const shownBefore = tracker.problem
        for (let index = failing.length - 1; index >= 0; index--)
          if (failing[index]!.key === issuer) failing.splice(index, 1)
        let changed: boolean
        if (kind === `settle`) changed = tracker.settle(issuer)
        else {
          const causes =
            kind === `fail-several`
              ? [
                  new Error(`${issuer} failed`),
                  new Error(`${issuer} failed again`),
                ]
              : [
                  (kind === `fail-shared` ? failing[0]?.cause : undefined) ??
                    new Error(`${issuer} failed`),
                ]
          for (const cause of causes)
            failing.push({
              key: issuer,
              cause,
              order:
                failing.find((entry) => entry.cause === cause)?.order ??
                ++failures,
            })
          changed = tracker.fail(issuer, causes)
        }
        const after = listed()
        expect(changed, `${kind} ${issuer} reports a change`).toBe(
          !same(before, after),
        )
        // A problem whose failures did not change stays, the same object.
        if (same(before, after)) expect(tracker.problem).toBe(shownBefore)
        expect(tracker.problem?.cause ?? null).toBe(after.at(-1) ?? null)
        expect(
          same(
            (tracker.problem?.errors ?? []).map(({ cause }) => cause as Error),
            after,
          ),
          `${kind} ${issuer}: listed failures`,
        ).toBe(true)
      }
    },
  )
})
