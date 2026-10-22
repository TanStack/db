/**
 * # Source failure and the error tree
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
 * - **The error tree** says whether the data on screen is still kept current.
 *   After Collection readiness, `reportError(error)` sets the Collection's
 *   `failureReason` while the sync adapter keeps trying, `reportHealthy()`
 *   clears it, and `fail()` sets its `error`: the sync adapter stopped. The
 *   status and the rows do not change. A node shows at most one problem, and
 *   nothing clears an `error` within a sync run. Once the adapter called
 *   `fail()`, every later report from it is a contract violation that throws.
 *   After a crash, the adapter's status calls do nothing: core ended the
 *   run. Sync data the run commits still applies, as closure keeps accepted
 *   sync obligations.
 *
 * A live query exposes both axes for everything it depends on through
 * `collection.errors`: one node for itself and one per source alias in query
 * order, recursing through nested live queries. The tree always has the same
 * shape for a given query. Each node mirrors its Collection at the moment it
 * is read, and the live query emits `errors:change` when a node below it
 * changes, so a reader knows to read the tree again. When a status changes,
 * `status:change` fires first and `errors:change` follows at once, and the
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
 * reported problem. It also keeps the Collection's rows (key and the tag of
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
 * and a reload starts a fresh sync run. A crash during cleanup lasts until
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
 * live query, and then the query itself. `restart` cleans up the
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
 * reported a source error, the full projected error tree, and the thrown
 * error class. An Effect that ends as it is created leaves A's listener count
 * where it was. It also checks identity: reading twice gives the same tree,
 * and between steps a node is the same object exactly when its expected
 * facts, including problem serials, did not change. At every event it checks
 * that no `errors:change` shows a status that `status:change` has not
 * announced, and that each `status:change` is followed at once by
 * `errors:change`. When the expected tree changed, the last event must show
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
 * The demand grammars settle all pending loads at once (the overlapping-load
 * lane owns their order). The lazy demand grammar does not yet check the
 * request error while a source reload's replay is in flight or after one
 * failed: a demand change during the replay can clear the error before its
 * key loads again, which stays open (the maintainer deferred a fix). Per-row child Collections are not
 * in the tree; an include's node shows its source. Pooled histories do not
 * restart or clean up: a pooled view ends for good when its Collection is
 * cleaned up. The ordering check reads the observed query only, not its
 * Collections. Grammar exclusions are listed with the history grammar.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection, findProblems } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createEffect } from '../src/query/effect.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import { Query } from '../src/query/builder/index.js'
import { eq, isUndefined, not } from '../src/query/builder/functions.js'
import { InvalidCollectionStatusTransitionError } from '../src/errors.js'
import { RequestErrors } from '../src/collection/lifecycle.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createDeferred } from '../src/deferred.js'
import { oraclePropertyOptions } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type {
  CollectionStatus,
  ErrorTreeNode,
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

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

type Gate = `loading` | `ready` | `error` | `crashed` | `cleaned-up`
// `serial` names one reported problem. A new report is a new problem even
// when it has the same field, so the node that shows it is a new node.
type Problem = null | { message: string; serial: number }
// `cause` is the message of what put the gate in `error` or `crashed`.
// `reloading`: a reload's new sync run (or a query's restart) has not
// committed yet, so everything visible is the previous run's.
type GateModel = { gate: Gate; cause: string | null; reloading: boolean }
// The node shows `stopped` (from fail() after readiness) over `failure`
// (from reportError()); a reload's new run can report while the previous
// run's error still shows.
// `failureFromReload`: the new run reported `failure` itself, so its first
// commit keeps it.
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
  failure: Problem
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
// its gate, every other problem of A is error tree detail. A cascade cleanup
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
    failure: null,
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
  Object.assign(source, {
    cleaning: true,
    retired: true,
    reloading: false,
    failure: null,
    stopped: null,
    failureFromReload: false,
    rows: new Map(),
    open: null,
    armed: false,
  })
  if (!model.queryDetached) model.queryEnded = true
  model.selfReloads = []
  if (name === `A`) {
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

function isReload(kind: Step[`kind`]): boolean {
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
    source.failure = null
    source.stopped = null
    source.reloading = false
  }
}

// The adapter writes an update for a key in its baseline, and an insert for
// any other key.
function writeRow(
  model: Model,
  source: SourceModel,
  step: Extract<Step, { kind: `write` }>,
): void {
  const tag = ++model.serial
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
  if (!source.failureFromReload) source.failure = null
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
  if (!truncate || !marksReady || source.gate === `crashed`) return `ok`
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

function freshModel(): Model {
  const source = (): SourceModel => ({
    gate: `loading`,
    cause: null,
    reloading: false,
    failure: null,
    stopped: null,
    failureFromReload: false,
    cleaning: false,
    retired: false,
    retiredCleanup: false,
    rows: new Map(),
    open: null,
    armed: false,
  })
  return {
    sources: { A: source(), B: source() },
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
      // itself.
      const waits = new Set<SourceName | `inner`>(reloaded)
      if (
        shape === `nested` &&
        !model.innerEnded &&
        model.inner.gate === `error` &&
        !rejects.includes(`A`)
      ) {
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
  const source = model.sources[step.source]
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
        ? `${step.source} crashed`
        : step.kind === `retired-cleanup-rejects` && source.retiredCleanup
          ? `${step.source} cleanup failed`
          : null
    if (step.kind === `retired-cleanup-rejects`) source.retiredCleanup = false
    if (crashCause) {
      // A crash keeps the first cause.
      if (source.gate !== `crashed`) {
        source.gate = `crashed`
        source.cause = crashCause
      }
    } else if (isReload(step.kind)) {
      if (source.cleaning || source.gate === `crashed`) return `throws`
      restartSource(source)
    }
    deriveQueries(shape, model)
    deriveEffect(model)
    return `ok`
  }
  if (step.kind !== `crash` && source.gate === `crashed`) {
    // A crash ends the status calls. Data the run commits still applies:
    // closure keeps accepted sync obligations, such as the confirmation of
    // a write admitted before it (the IndexedDB retirement oracle owns that
    // law).
    if (step.kind === `write`) writeRow(model, source, step)
    if (step.kind === `commit`) commitOpen(source)
    if (step.kind === `cancel`) source.open = null
    if (step.kind === `truncate`) {
      const open = openTransaction(source)
      open.writes = new Map()
      open.truncate = true
      open.adapter = true
    }
    deriveQueries(shape, model)
    deriveEffect(model)
    if (step.kind === `retired-cleanup-rejects`) source.retiredCleanup = false
    return isReload(step.kind) ? `throws` : outcome
  }
  switch (step.kind) {
    case `ready`:
      // During a first load or a reload, the run writes row 1 and commits
      // before markReady(), as a first load does.
      if (source.gate === `loading` || source.reloading) {
        openTransaction(source).writes.set(1, ++model.serial)
        // A commit that throws ends the step before markReady().
        outcome = commitOpen(source)
        if (outcome !== `ok`) break
      }
      if (source.reloading) completeReload(source)
      else if (source.gate === `error`) outcome = `bad-transition`
      else if (stopped) outcome = `throws`
      else source.gate = `ready`
      break
    case `write`:
      writeRow(model, source, step)
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
      crashSource(source, `${step.source} cleanup failed`)
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
      source.cause = `${step.source} cleanup failed`
      source.failure = null
      source.stopped = null
      source.reloading = false
      break
    case `fail`:
      // Before Collection readiness the first load fails; after it, the
      // rows stay and the node shows the error.
      if (stopped) outcome = `throws`
      else {
        // A reload that fails before its first commit keeps the rows: they
        // stay the baseline, and a transaction it began no longer replaces
        // them.
        if (source.reloading) {
          source.armed = false
          if (source.open && !source.open.adapter) source.open.truncate = false
        }
      }
      if (outcome === `throws`) break
      if (source.gate !== `ready`) {
        source.gate = `error`
        source.cause = `${step.source} gave up`
        source.reloading = false
      } else {
        source.reloading = false
        source.failure = null
        source.stopped = {
          message: `${step.source} gave up`,
          serial: ++model.serial,
        }
      }
      break
    case `report`:
      if (stopped || source.gate !== `ready`) outcome = `throws`
      else {
        source.failure = {
          message: `${step.source} problem`,
          serial: ++model.serial,
        }
        source.failureFromReload = source.reloading
      }
      break
    case `healthy`:
      if (stopped || source.gate !== `ready`) outcome = `throws`
      else {
        source.failure = null
        source.failureFromReload = false
      }
      break
    case `crash`:
      crashSource(source, `${step.source} crashed`)
      break
  }
  deriveQueries(shape, model)
  settleSelfReloads(shape, model)
  deriveEffect(model)
  return outcome
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
// only) says which report.
type ExpectedProblem = null | { message: string; serial?: number }
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
  const reported = (problem: Problem): ExpectedProblem =>
    problem
      ? {
          message: problem.message,
          ...(identity ? { serial: problem.serial } : {}),
        }
      : null
  const error =
    source.gate === `error` || source.gate === `crashed`
      ? { message: source.cause! }
      : reported(source.stopped)
  const failureReason = error ? null : reported(source.failure)
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
    gate === `error` || gate === `crashed` ? { message: cause! } : null
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
function problemOf(node: ErrorTreeNode): ProblemSummary {
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
  const collection = createCollection<Row, number>({
    id: `health-oracle-${name}-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    startSync: false,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
        return () => {
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
  query: Pick<Collection<any, any>, `status` | `errors` | `on` | `cleanup`>
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
      // A plain subquery materializes one child Collection per parent row.
      return liveQuery(
        createLiveQueryCollection((q) =>
          q.from({ b: B }).select(({ b }) => ({
            id: b.id,
            items: q.from({ a: A }).where(({ a }) => eq(a.parentId, b.id)),
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

function project(node: ErrorTreeNode): ExpectedNode {
  const problem = (info: ErrorTreeNode[`error`]): ExpectedProblem =>
    info
      ? {
          message: info.message
            .replace(cleanupPrefix, ``)
            .replace(cleanedUnderQueryMessage, cleanedUnderQuery),
        }
      : null
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
  previous: ErrorTreeNode,
  next: ErrorTreeNode,
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
  const known = new Map(params.collection._state.acceptedSyncedEntries())
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

async function runHistory(
  shape: Shape,
  steps: ReadonlyArray<Step>,
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
        step.kind !== `cleanup-settle`,
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
  const mirrors = { A: new Map<number, number>(), B: new Map<number, number>() }
  const mirrored = { A: true, B: true }
  let mirrorSubscriptions: Array<{ unsubscribe: () => void }> = []
  const mirror = () => {
    for (const subscription of mirrorSubscriptions) subscription.unsubscribe()
    mirrorSubscriptions = shapeSources[shape].map((name) => {
      mirrors[name] = new Map()
      mirrored[name] = true
      return sources[name].collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = change.key
            if (change.type === `delete`) mirrors[name].delete(key)
            else mirrors[name].set(key, (change.value as Row).tag ?? 0)
          }
        },
        { includeInitialState: true },
      )
    })
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
      const tree = query.errors
      events.push({
        kind,
        announced,
        status: tree.status,
        tree: project(tree),
      })
    }
    const stopStatus = query.on(`status:change`, () => record(`status`))
    const stopHealth = query.on(`errors:change`, () => record(`health`))
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
      query.errors,
      `${shape}: the query exposes an error tree`,
    ).toBeDefined()
    begin()
    await flushPromises()
    let previous = query.errors
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
            }
          : undefined
      const queryEndedBefore = model.queryEnded
      const expected = applyModel(shape, model, step)
      // The write tag the model gave this step, if it wrote.
      const tag = model.serial
      events = []
      let thrown: unknown
      try {
        if (step.kind === `effect`) {
          await mountEffect()
        } else if (step.kind === `cleanup-hold`) {
          if (shapeSources[shape].includes(step.source)) {
            sources[step.source].holdCleanup()
            pendingCleanups[step.source] ??= sources[step.source].collection
              .cleanup({ dependents: true })
              .finally(() => {
                pendingCleanups[step.source] = undefined
              })
          }
        } else if (step.kind === `cleanup-settle`) {
          sources[step.source].settleCleanup()
          await pendingCleanups[step.source]
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
            params.fail(new Error(`${step.source} gave up`))
          } else if (step.kind === `healthy`) {
            params.reportHealthy()
          } else if (step.kind === `crash`) {
            params.collection._lifecycle.crash(
              new Error(`${step.source} crashed`),
            )
          } else {
            params.reportError(new Error(`${step.source} problem`))
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
        if (mirrored[name])
          expect(
            sortedTags(mirrors[name]),
            `${label}: ${name} direct subscriber rows`,
          ).toEqual(sortedTags(source.rows))
        if (source.gate === `crashed`) continue
        expect(
          sortedTags(
            new Map(
              [...collection._state.acceptedSyncedEntries()].map(
                ([key, row]) => [key, row.tag ?? 0],
              ),
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
      const next = query.errors
      expect(project(next), `${label}: error tree`).toEqual(tree)
      expect(
        findProblems(next).map(problemOf),
        `${label}: findProblems`,
      ).toEqual(expectedProblems(tree))

      // Identity: a reader can compare trees with `===`. Reading twice gives
      // the same tree, and a step replaces exactly the nodes on the path to
      // what changed.
      expect(query.errors === next, `${label}: stable read`).toBe(true)
      const after = expectedTree(shape, model, true)
      if (step.kind !== `restart`) {
        expectIdentity(previous, next, before, after, label)
      }
      previous = next

      // Order: `status:change` comes first and `errors:change` follows it at
      // once, so no `errors:change` shows a status that `status:change` has
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
        }
      }
    }
  } finally {
    console.error = consoleError
    stop()
    for (const subscription of mirrorSubscriptions) subscription.unsubscribe()
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
    { weight: 1, arbitrary: fc.constant(restart) },
    { weight: 1, arbitrary: fc.constant({ kind: `reload-query` } as const) },
    { weight: 1, arbitrary: fc.constant({ kind: `effect` } as const) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.constantFrom(`cleanup-hold` as const, `cleanup-settle` as const),
          fc.constantFrom(`A` as const, `B` as const),
        )
        .map(([kind, source]): Step => ({ kind, source })),
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
  fcTest.prop(
    [fc.constantFrom(...shapes), fc.array(stepArb, { maxLength: 12 })],
    oraclePropertyOptions(60, `source-health.history`),
  )(
    `generated histories refine the model`,
    (shape, steps) => withDeadline(runHistory(shape, steps)),
    120_000,
  )
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
      expect(query.errors.reloading).toBe(true)
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
      expect(collection.errors.reloading).toBe(false)
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
      const baseline = new Map(params.collection._state.acceptedSyncedEntries())
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
  // is too: the last errors:change before the status change shows no
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
      const announced: Array<ErrorTreeNode> = []
      collection.on(`errors:change`, () => announced.push(collection.errors))
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
        expect(collection.errors.error?.message).toBe(
          problem === `crash` ? `crashed` : `first load failed`,
        )
        expect(announced).toEqual([])
      } else {
        expect(collection.errors.hasErrors).toBe(false)
        expect(announced.at(-1)?.hasErrors).toBe(false)
      }
      adapterCleanup.resolve()
      await cleaned
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.errors.hasErrors).toBe(false)
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
      expect(collection.errors.reloading).toBe(false)
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
        ...source.params.collection._state.acceptedSyncedEntries(),
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
      expect(source.collection.errors.error?.message).toBe(`reload failed`)
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
    expect(source.collection.errors.reloading).toBe(false)
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
      history.query.errors,
      `the query exposes an error tree`,
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
        expect(query.errors.hasErrors).toBe(false)

        outcomes.push(`fail`)
        writeParent(`insert`, 2)
        await flushPromises()
        expect(query.status).toBe(`ready`)
        expect(query.errors.error).toMatchObject({
          message: `child load failed`,
        })
        expect(query.errors.failureReason).toBeNull()
        expect(children.errors.hasErrors).toBe(false)

        // The demand changes again and its new load settles.
        outcomes.push(`ok`)
        writeParent(`insert`, 3)
        await flushPromises()
        expect(query.errors.hasErrors).toBe(false)
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
      expect(query.errors.error).toMatchObject({ message: `child load failed` })

      writeParent(`delete`, 1)
      writeParent(`delete`, 2)
      await flushPromises()
      expect(query.errors.hasErrors).toBe(false)
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
          expect(query.errors.error).toMatchObject({
            message: `child load failed`,
          })

          await (reloaded === `source` ? children : query).reload()
          await flushPromises()
          expect(query.errors.hasErrors).toBe(false)
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
        expect(query.errors.error, `the later failure stays`).toMatchObject({
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
      expect(query.errors.error).toMatchObject({ message: `child load failed` })
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
      expect(collection.errors.hasErrors).toBe(false)

      query = createLiveQueryCollection((q) => q.from({ row: collection }))
      await query.preload()
      expect(query.status).toBe(`ready`)
      expect(query.toArray.map((row) => row.id)).toEqual([2])
      expect(query.errors.hasErrors).toBe(false)
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
      expect(query.errors.error).toMatchObject({ message: `child load failed` })
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
        expect(query.errors.reloading).toBe(false)
        if (outcome === `ok`) expect(query.size).toBe(1)
        if (outcome === `load-fails`)
          expect(query.errors.error?.message).toContain(`load 2 failed`)
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
        expect(query.errors.error).toMatchObject({
          message: `marker load failed`,
        })

        failLoads = false
        await query.utils.setWindow({ offset: 6, limit: 2 })
        await flushPromises()
        expect(ids(), `the window moves after the failure`).toEqual([7, 8])
        expect(query.errors.error, `the later load clears it`).toBeNull()
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

describe(`root request errors`, () => {
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
    expect(query.errors, `the query exposes an error tree`).toBeDefined()
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      expect(query.errors.hasErrors).toBe(false)

      outcomes.push(`fail`)
      await Promise.resolve(
        query.utils.setWindow({ offset: 4, limit: 2 }),
      ).catch(() => undefined)
      await flushPromises()
      expect(query.status).toBe(`ready`)
      expect(query.errors.error).toMatchObject({ message: `root load failed` })
      expect(source.errors.hasErrors).toBe(false)

      await query.utils.setWindow({ offset: 8, limit: 2 })
      await flushPromises()
      expect(query.errors.hasErrors).toBe(false)
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
            query.errors.error?.message ?? null,
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
            query.errors.error?.message ?? null,
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
        expect(source.errors.hasErrors).toBe(false)
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
      query.errors.sources.find((node) => node.alias === `lazy`)!
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
        findProblems(query.errors).some((node) => node.alias === `lazy`),
      ).toBe(true)

      if (model.afterReload === `rejects`) {
        await expect(query.reload()).rejects.toBeDefined()
        expect(runs, `a crashed query does not reload its sources`).toBe(1)
      } else {
        await query.reload()
        await flushPromises()
        expect(cut(), `after the query's reload`).toEqual(model.afterReload)
        expect(findProblems(query.errors)).toEqual([])
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
// On-demand demand grammar
// ---------------------------------------------------------------------------

/**
 * A live query over an on-demand Collection loads only the window it shows.
 * The law, from the request-error rules above: a load that fails before the
 * query's initial-query readiness fails the query's first load; one that
 * fails after it is a request error on the query's own node, and the source
 * stays healthy. A request error clears only when a load that started after
 * the failure succeeds; a source's reload loads the window again and clears
 * it when that replay succeeds. The source's own problems after readiness
 * are error tree detail and never change the query's status; its crash
 * crashes the query.
 *
 * The provider has rows 1 to 99. It answers a request without a limit with
 * every row, and a limited request with the rows up to the end of the
 * window. The query shows two rows ordered by id. Steps: `window` moves the
 * window two rows on; `settle-ok` settles every pending load, and any load
 * the query requests after it, until none is pending; `settle-fail` rejects
 * every pending load at once (the overlapping-load lane owns the order of
 * two loads); `reload` reloads the source; `report`, `healthy`, and `fail`
 * are the source adapter's calls after readiness; `crash` crashes the
 * source.
 *
 * Which loads a window needs is the loader's choice, so the model does not
 * predict requests: the driver reports each load the query requests, as the
 * adapter sees it. The model keeps the query's gate, its request error,
 * whether a load was requested after that error, the pending loads, the
 * window, and the source's node. The comparison checks, after every step,
 * the query's status, its own error, the source's node, and, when no load is
 * pending and no error shows, the rows in the window.
 */
type DemandStep =
  | `window`
  | `settle-ok`
  | `settle-fail`
  | `reload`
  | `report`
  | `healthy`
  | `fail`
  | `crash`

type DemandModel = {
  gate: `loading` | `ready` | `error` | `crashed`
  requestError: string | null
  // A load started after the shown request error.
  laterLoad: boolean
  pending: number
  offset: number
  // The window whose load last succeeded; the query shows it.
  shown: number
  // A source reload's replay is pending; a window move made now waits for
  // it, and a later reload aborts that move (setWindow() rejects).
  replayPending: boolean
  // A replay failed: the query keeps its last complete snapshot until a
  // later replay succeeds, so a window move waits for that replay too.
  replayFailed: boolean
  moveWaitsForReplay: boolean
  // The window before the move that waits for a replay: a reload that
  // aborts the move returns to it. A move with its own load joins the
  // replay, so the replay loads it.
  replayedOffset: number
  source: { failure: string | null; stopped: string | null; crashed: boolean }
  serial: number
}

// The query requested `count` loads at the adapter boundary. A window move
// that requests none is served from rows the query already loaded, unless it
// waits for a replay.
function requestedLoads(
  model: DemandModel,
  count: number,
  step?: DemandStep,
): void {
  if (count === 0) {
    if (step === `window` && model.pending === 0 && !model.moveWaitsForReplay)
      model.shown = model.offset
    return
  }
  model.pending += count
  if (model.requestError) model.laterLoad = true
}

function applyDemandModel(model: DemandModel, step: DemandStep): void {
  if (model.gate === `crashed`) return
  switch (step) {
    case `window`:
      if (model.gate !== `ready`) return
      if (model.replayPending || model.replayFailed) {
        if (!model.moveWaitsForReplay) model.replayedOffset = model.offset
        model.moveWaitsForReplay = true
      }
      model.offset += 2
      return
    case `settle-ok`:
      if (model.pending === 0) return
      model.pending = 0
      model.replayPending = false
      model.replayFailed = false
      model.moveWaitsForReplay = false
      if (model.gate === `loading`) model.gate = `ready`
      if (model.requestError && model.laterLoad) model.requestError = null
      model.shown = model.offset
      return
    case `settle-fail`:
      if (model.pending === 0) return
      model.pending = 0
      if (model.replayPending) model.replayFailed = true
      model.replayPending = false
      model.moveWaitsForReplay = false
      if (model.gate === `loading`) {
        model.gate = `error`
        return
      }
      model.requestError = `root load ${++model.serial} failed`
      model.laterLoad = false
      // A failed window move keeps the last good window; the app retries
      // with setWindow().
      model.offset = model.shown
      return
    case `reload`:
      // The new run is ready inside sync(), so its first commit at once
      // clears the node; the replay loads the window again.
      if (model.source.crashed) return
      model.source.failure = null
      model.source.stopped = null
      if (model.moveWaitsForReplay) {
        model.offset = model.replayedOffset
        model.moveWaitsForReplay = false
      }
      model.replayPending = true
      return
    case `report`:
      if (model.source.stopped) return
      model.source.failure = `source problem`
      return
    case `healthy`:
      if (model.source.stopped) return
      model.source.failure = null
      return
    case `fail`:
      if (model.source.stopped) return
      model.source.failure = null
      model.source.stopped = `source gave up`
      return
    case `crash`:
      model.source.crashed = true
      model.gate = `crashed`
      return
  }
}

async function runDemandHistory(steps: ReadonlyArray<DemandStep>) {
  const model: DemandModel = {
    gate: `loading`,
    requestError: null,
    laterLoad: false,
    pending: 0,
    offset: 0,
    shown: 0,
    replayPending: false,
    replayFailed: false,
    moveWaitsForReplay: false,
    replayedOffset: 0,
    source: { failure: null, stopped: null, crashed: false },
    serial: 0,
  }
  const loads: Array<ReturnType<typeof createDeferred<void>>> = []
  let params!: SyncParams
  const source = createCollection<Row, number>({
    id: `health-demand-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
        // Rows this sync run has served; a reload's run serves them again.
        const served = new Set<number>()
        next.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const load = createDeferred<void>()
            loads.push(load)
            const end = options.limit === undefined ? 99 : model.offset + 2
            return load.promise.then(() => {
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
  const query = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.id)
      .limit(2),
  )
  const consoleError = console.error
  console.error = () => {}
  try {
    void query.preload().catch(() => undefined)
    await flushPromises()
    requestedLoads(model, loads.length)
    for (const [index, step] of steps.entries()) {
      const label = `step ${index} ${step}`
      applyDemandModel(model, step)
      let requested = 0
      const before = loads.length
      if (step === `window`) {
        if (query.status === `ready`)
          void Promise.resolve(
            query.utils.setWindow({ offset: model.offset, limit: 2 }),
          ).catch(() => undefined)
      } else if (step === `settle-ok`) {
        // Ordered loading may follow a load with more requests; settle until
        // the window asks for nothing more.
        for (let round = 0; round < 5 && loads.length > 0; round++) {
          for (const load of loads.splice(0)) load.resolve()
          await flushPromises()
        }
        requested = 0
      } else if (step === `settle-fail`) {
        for (const load of loads.splice(0))
          load.reject(new Error(`root load ${model.serial} failed`))
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
          // After fail(), the adapter's calls throw; the model ignores them.
        }
      }
      await flushPromises()
      requested += Math.max(
        0,
        loads.length -
          (step === `settle-fail` || step === `settle-ok` ? 0 : before),
      )
      requestedLoads(model, requested, step)

      expect(query.status, `${label}: query status`).toBe(model.gate)
      if (model.gate === `ready`) {
        expect(
          query.errors.error?.message ?? null,
          `${label}: request error`,
        ).toBe(model.requestError)
      }
      const sourceNode = query.errors.sources[0]!
      if (!model.source.crashed) {
        expect(
          sourceNode.failureReason?.message ?? null,
          `${label}: source failureReason`,
        ).toBe(model.source.stopped ? null : model.source.failure)
        expect(
          sourceNode.error?.message ?? null,
          `${label}: source error`,
        ).toBe(model.source.stopped)
      }
      if (
        model.gate === `ready` &&
        model.pending === 0 &&
        model.requestError === null
      ) {
        expect(
          query.toArray.map((row) => row.id),
          `${label}: window rows`,
        ).toEqual([model.shown + 1, model.shown + 2])
      }
    }
  } finally {
    console.error = consoleError
    for (const load of loads.splice(0)) load.resolve()
    await query.cleanup()
    await source.cleanup({ dependents: true })
  }
}

describe(`on-demand demand grammar`, () => {
  // Named histories, one per distinction the law draws.
  const named: Record<string, ReadonlyArray<DemandStep>> = {
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

  const step = fc.constantFrom<DemandStep>(
    `window`,
    `settle-ok`,
    `settle-fail`,
    `reload`,
    `report`,
    `healthy`,
    `fail`,
    `crash`,
  )
  fcTest.prop(
    [fc.array(step, { maxLength: 10 })],
    oraclePropertyOptions(60, `source-health.on-demand`),
  )(
    `generated demand histories refine the model`,
    (steps) => withDeadline(runDemandHistory(steps)),
    120_000,
  )
})

// ---------------------------------------------------------------------------
// Lazy join demand grammar
// ---------------------------------------------------------------------------

/**
 * A live query that left-joins an eager parent Collection to an on-demand
 * child Collection loads the children of the parents it shows. The law: a
 * load that fails before initial-query readiness fails the query's first
 * load. After it, a failed load is a request error on the query's node while
 * the query still needs a key whose load failed; it clears when a later load
 * of that key succeeds, or when the query no longer needs the key. A source
 * reload replays the query's demand; a failed replay is a request error
 * until a later replay succeeds. Each parent shows its child once a load of
 * the child's key succeeded.
 *
 * Steps: `parent` adds parent 1, 2, or 3, and `unparent` removes it; the
 * other steps are as in the window grammar. The driver reports each load's
 * requested keys from the adapter boundary, and the model judges outcomes.
 * The comparison checks the query's status, whether its node shows an
 * error, and, when no load is pending, each parent row and its child. After a
 * failed replay the query keeps its last complete snapshot private until a
 * replay succeeds; the model does not track that snapshot, so the rows check
 * waits for the replay to succeed.
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
        | `reload`
        | `report`
        | `fail`
        | `crash`
    }

// One load the query requested, as the adapter saw it.
// `fromReplay`: the replay itself made the request, not a demand change.
type LazyLoad = {
  serial: number
  keys: Set<number>
  replay: boolean
  fromReplay?: boolean
}

type LazyModel = {
  gate: `loading` | `ready` | `error` | `crashed`
  parents: Set<number>
  loaded: Set<number>
  // Needed keys whose last load failed after readiness, with that load's
  // serial.
  failed: Map<number, number>
  // A source reload's replay is in flight: every load the query starts
  // joins it, inside its publication barrier.
  replayActive: boolean
  // A failed replay keeps the query's publication private for all its
  // demand, so its error stays until a replay succeeds or the query has no
  // demand left.
  replayFailed: boolean
  pending: Array<LazyLoad>
  // Keys a replay load failed for; the replay reports the failure once all
  // its loads settle, if the query still needs one of them then.
  replayFailedKeys: Set<number>
  // Aborted loads the current run may still finish: their rows apply.
  obsolete: Map<number, Set<number>>
  // Loads a reload retired that are still in flight at the adapter. As for a
  // truncate, a load started before the replay still holds the query's first
  // load until it settles, while the query still needs one of its keys; it
  // decides nothing else.
  retiredInFlight: Map<number, Set<number>>
  // Every load the query requested and did not abort, by serial: a key's
  // latest such load decides it, so an older load that settles later changes
  // nothing, and an aborted one leaves the decision to the one before it.
  requested: Map<number, Set<number>>
  source: { failure: string | null; stopped: string | null; crashed: boolean }
}

// A load the query requested settles. Its rows apply on success either way;
// its outcome decides each key it was the latest load of.
function settleLazyLoad(
  model: LazyModel,
  load: LazyLoad,
  succeeded: boolean,
): void {
  model.pending = model.pending.filter((entry) => entry !== load)
  if (model.gate === `crashed`) return
  const latestFor = (key: number) => latestLoadFor(model, key) === load.serial
  if (succeeded) {
    for (const key of load.keys) {
      model.loaded.add(key)
      // A key loaded: its failure clears, unless a newer load of it failed.
      if ((model.failed.get(key) ?? 0) < load.serial) model.failed.delete(key)
    }
    if (load.replay) model.replayFailed = false
    settleReplay(model)
    return
  }
  // Only the latest load of a key the query still needs decides it.
  const needed = [...load.keys].filter(
    (key) => model.parents.has(key) && latestFor(key),
  )
  // Before initial-query readiness, that failure fails the query's first
  // load.
  if (model.gate === `loading` && !load.replay) {
    if (needed.length > 0) model.gate = `error`
    return
  }
  if (load.replay) {
    for (const key of needed) model.replayFailedKeys.add(key)
  } else for (const key of needed) model.failed.set(key, load.serial)
  settleReplay(model)
}

// The serial of the latest load the query requested for a key and did not
// abort.
function latestLoadFor(model: LazyModel, key: number): number | undefined {
  let latest: number | undefined
  for (const [serial, keys] of model.requested)
    if (keys.has(key) && (latest === undefined || serial > latest))
      latest = serial
  return latest
}

// A replay settles once none of its loads is pending; one that failed for a
// key the query still needs then fails the query's first load, or shows a
// request error after it.
function settleReplay(model: LazyModel): void {
  if (model.pending.some((entry) => entry.replay)) return
  model.replayActive = false
  const failed = [...model.replayFailedKeys].some((key) =>
    model.parents.has(key),
  )
  model.replayFailedKeys = new Set()
  if (!failed) return
  if (model.gate === `loading`) model.gate = `error`
  else model.replayFailed = true
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

// During the first load, the query is ready once no pending load is for a
// key it still needs: a demand it retired no longer holds readiness back. A
// source reload's replay restores the demand as one unit, so the query also
// waits until the replay settles.
function deriveLazyGate(model: LazyModel): void {
  if (
    model.gate !== `loading` ||
    model.replayActive ||
    [...model.retiredInFlight.values()].some((keys) =>
      [...keys].some((key) => model.parents.has(key)),
    )
  )
    return
  const blocking = model.pending.some(({ serial, keys }) =>
    [...keys].some(
      (key) => model.parents.has(key) && latestLoadFor(model, key) === serial,
    ),
  )
  if (!blocking) model.gate = `ready`
}

function applyLazyModel(model: LazyModel, step: LazyStep): void {
  if (model.gate === `crashed`) return
  switch (step.kind) {
    case `parent`:
      model.parents.add(step.key)
      return
    case `unparent`:
      model.parents.delete(step.key)
      model.failed.delete(step.key)
      if (model.parents.size === 0) model.replayFailed = false
      return
    // Settle steps reach the model one load at a time, from the driver.
    case `settle-ok`:
    case `settle-fail`:
    case `settle-first-ok`:
    case `settle-first-fail`:
    case `settle-last-ok`:
    case `settle-last-fail`:
    case `throw-next`:
      return
    case `reload`:
      if (model.source.crashed) return
      // The replay loads the demand again; a key it loads is loaded again.
      model.source.failure = null
      model.source.stopped = null
      // The retired run's loads no longer apply, and its truncate drops the
      // loaded children until the replay loads them again.
      // Only the query's own loads hold it; a replay's loads stop when a
      // newer replay replaces them.
      for (const { serial, keys, fromReplay } of model.pending)
        if (!fromReplay) model.retiredInFlight.set(serial, keys)
      // A replay this reload discards reports nothing.
      model.replayFailedKeys = new Set()
      model.pending = []
      model.obsolete = new Map()
      model.loaded = new Set()
      model.replayActive = true
      return
    case `report`:
      if (!model.source.stopped) model.source.failure = `source problem`
      return
    case `fail`:
      if (!model.source.stopped) {
        model.source.failure = null
        model.source.stopped = `source gave up`
      }
      return
    case `crash`:
      model.source.crashed = true
      model.gate = `crashed`
      return
  }
}

// `asyncChildReady`: the child Collection's reload calls markReady() after
// sync() returns, so its loads in flight settle before the replay exists.
// `honorsAbort`: the loader rejects a request whose signal aborts; one that
// does not may still finish it later.
async function runLazyHistory(
  steps: ReadonlyArray<LazyStep>,
  {
    asyncChildReady = false,
    honorsAbort = true,
  }: { asyncChildReady?: boolean; honorsAbort?: boolean } = {},
) {
  const model: LazyModel = {
    gate: `loading`,
    parents: new Set([1]),
    loaded: new Set(),
    failed: new Map(),
    replayActive: false,
    replayFailed: false,
    pending: [],
    replayFailedKeys: new Set(),
    obsolete: new Map(),
    retiredInFlight: new Map(),
    requested: new Map(),
    source: { failure: null, stopped: null, crashed: false },
  }
  // Loads in flight at the adapter, oldest first, and what the adapter saw
  // since the last report: each request, and which of them were aborted or
  // threw.
  const loads: Array<{
    serial: number
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  const requests: Array<LazyLoad & { thrown: boolean }> = []
  const aborted = new Set<number>()
  let serials = 0
  let throwNext = false
  let failures = 0
  let childRuns = 0
  let parentParams!: SyncParams
  let childParams!: SyncParams
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
        // Children this sync run has served; a reload's run serves them
        // again.
        const served = new Set<number>()
        if (childRuns++ > 0 && asyncChildReady)
          setTimeout(() => params.markReady(), 0)
        else params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const keys = requestedKeys(options)
            const serial = ++serials
            const thrown = throwNext
            throwNext = false
            requests.push({ serial, keys, replay: false, thrown })
            if (thrown) throw new Error(`child load ${++failures} threw`)
            const deferred = createDeferred<void>()
            loads.push({ serial, deferred })
            // The adapter sees every abort. One that honors aborts also
            // rejects the request; one that does not may still finish it.
            options.signal?.addEventListener(`abort`, () => {
              aborted.add(serial)
              if (!honorsAbort) return
              model.retiredInFlight.delete(serial)
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
  const query = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents })
      .leftJoin({ child: children }, ({ parent, child }) =>
        eq(parent.id, child.parentId),
      ),
  )
  const consoleError = console.error
  console.error = () => {}
  // Requests made since the last report, tagged with whether a source
  // reload's replay made them.
  const report = (replayMade = false) => {
    // An aborted request is obsolete: it decides nothing, but if its run
    // still serves it, its rows apply when it succeeds.
    const retireAborted = () => {
      for (const load of model.pending)
        if (aborted.has(load.serial)) model.obsolete.set(load.serial, load.keys)
      model.pending = model.pending.filter((load) => !aborted.has(load.serial))
      for (const serial of aborted) model.requested.delete(serial)
    }
    // A demand change releases the loads it retires before it requests new
    // ones, so releasing a replay's last pending load settles the replay
    // first.
    retireAborted()
    if (!replayMade) settleReplay(model)
    // A request a new demand makes during a replay joins the replay, but one
    // that throws fails at once; one the replay makes fails with the replay.
    // Every request is recorded before a thrown one settles, so the replay's
    // later requests still belong to it.
    const reported = requests.splice(0).map((request) => {
      const load: LazyLoad = {
        serial: request.serial,
        keys: request.keys,
        replay: model.replayActive && (replayMade || !request.thrown),
        fromReplay: replayMade,
      }
      model.requested.set(load.serial, load.keys)
      model.pending.push(load)
      return { load, thrown: request.thrown }
    })
    for (const { load, thrown } of reported)
      if (thrown) settleLazyLoad(model, load, false)
    // A demand change that requests every needed key again replaces the
    // older loads: readiness waits only for the replacement.
    if (
      !replayMade &&
      reported.some(({ load }) =>
        [...model.parents].every((key) => load.keys.has(key)),
      )
    )
      model.retiredInFlight.clear()
    retireAborted()
    aborted.clear()
    settleReplay(model)
  }
  // Settle loads at the adapter and report each outcome to the model.
  const settle = (
    picked: Array<(typeof loads)[number]>,
    succeeded: boolean,
  ) => {
    for (const { serial, deferred } of picked) {
      loads.splice(
        loads.findIndex((load) => load.serial === serial),
        1,
      )
      const load = model.pending.find((entry) => entry.serial === serial)
      if (load) settleLazyLoad(model, load, succeeded)
      else if (succeeded && model.obsolete.has(serial))
        for (const key of model.obsolete.get(serial)!) model.loaded.add(key)
      model.obsolete.delete(serial)
      model.retiredInFlight.delete(serial)
      if (succeeded) deferred.resolve()
      else deferred.reject(new Error(`child load ${++failures} failed`))
    }
  }
  try {
    void query.preload().catch(() => undefined)
    await flushPromises()
    report()
    let announcements = 0
    query.on(`errors:change`, () => announcements++)
    for (const [index, step] of steps.entries()) {
      const label = `step ${index} ${JSON.stringify(step)}`
      // A demand change that leaves the projected tree as it was keeps the
      // tree's identity and announces nothing.
      const treeBefore = query.errors
      const factsBefore = JSON.stringify(project(treeBefore))
      const announcedBefore = announcements
      // Only a demand change can leave every fact as it was; a reload, a
      // settled load, or a source call can change a fact and change it back.
      const demandOnly = step.kind === `parent` || step.kind === `unparent`
      // Open (see the request error check below): a demand change during a
      // replay can show a request error and clear it at once.
      const replayBefore = model.replayActive
      applyLazyModel(model, step)
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
      } else if (step.kind === `throw-next`) {
        throwNext = true
      } else if (step.kind === `reload`) {
        void children.reload().catch(() => undefined)
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
      report(step.kind === `reload`)
      deriveLazyGate(model)

      expect(query.status, `${label}: query status`).toBe(model.gate)
      expect(query.errors, `${label}: stable read`).toBe(query.errors)
      if (
        demandOnly &&
        !replayBefore &&
        JSON.stringify(project(query.errors)) === factsBefore
      ) {
        expect(query.errors, `${label}: unchanged tree keeps identity`).toBe(
          treeBefore,
        )
        expect(
          announcements,
          `${label}: unchanged tree announces nothing`,
        ).toBe(announcedBefore)
      }
      // Open: a demand change while a source reload's replay is in flight
      // can clear a request error before its key loads again (see the
      // coverage map). Until that is settled, the check waits for the
      // replay to succeed; it still checks the error a failed replay shows.
      const replayOpen =
        (model.replayActive || model.replayFailed) &&
        step.kind !== `settle-fail`
      if (model.gate === `ready` && !replayOpen) {
        expect(query.errors.error !== null, `${label}: request error`).toBe(
          model.failed.size > 0 || model.replayFailed,
        )
      }
      // After a failed replay the query keeps its last complete snapshot
      // private, which the model does not track.
      if (
        model.gate === `ready` &&
        model.pending.length === 0 &&
        !model.replayFailed
      ) {
        const rows = query.toArray.map(
          (row: { parent: Row; child?: Row }) =>
            [row.parent.id, row.child?.id ?? null] as const,
        )
        expect(
          [...rows].sort((a, b) => a[0] - b[0]),
          `${label}: rows`,
        ).toEqual(
          [...model.parents]
            .sort((a, b) => a - b)
            .map((key) => [key, model.loaded.has(key) ? key * 10 : null]),
        )
      }
    }
  } finally {
    console.error = consoleError
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
        `reload` as const,
        `report` as const,
        `fail` as const,
        `crash` as const,
      )
      .map((kind): LazyStep => ({ kind })),
  )
  const named: Record<string, ReadonlyArray<LazyStep>> = {
    'a failed first load fails the query': [{ kind: `settle-fail` }],
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
  it(`releasing a replay's last pending load settles the replay`, () =>
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
  fcTest.prop(
    [fc.array(step, { maxLength: 10 }), fc.boolean(), fc.boolean()],
    oraclePropertyOptions(60, `source-health.lazy-demand`),
  )(
    `generated lazy demand histories refine the model`,
    (steps, asyncChildReady, honorsAbort) =>
      withDeadline(runLazyHistory(steps, { asyncChildReady, honorsAbort })),
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
 * `onErrorsChange` receives the error tree, with one node per source alias.
 *
 * The lane crosses `skipInitial`, the source mode, and when the source fails.
 * Before initial-query readiness, an eager source has not called `markReady()`, and an
 * on-demand source still has its first load pending. After it, the
 * source calls `fail()`, which fails the first load of an on-demand source
 * still in its initial sync and sets the `error` of an eager source after
 * Collection readiness, or it crashes, or it reaches Collection readiness
 * (on-demand only) and then reports a `failureReason`. Every history also checks that one change reaches
 * `onErrorsChange` once: no two reported trees are the same object.
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
  }
  const histories: Array<EffectHistory> = [true, false].flatMap((skipInitial) =>
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      (
        [
          `before gate`,
          `fail after gate`,
          `crash after gate`,
          `report after gate`,
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
    const trees: Array<ErrorTreeNode> = []
    const delivered: Array<unknown> = []
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      skipInitial,
      onBatch: (events) => {
        delivered.push(...events.map((event) => event.key))
      },
      onSourceError: (error) => sourceErrors.push(error),
      onErrorsChange: (errors) => trees.push(errors),
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await flushPromises()
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

      if (failure === `report after gate`) {
        // An on-demand source reaches its own Collection readiness after the
        // Effect's: a status change that must reach onErrorsChange once.
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
    const trees: Array<ErrorTreeNode> = []
    const consoleError = console.error
    console.error = () => {}
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      skipInitial,
      onBatch: () => {},
      onSourceError: (error) => sourceErrors.push(error),
      onErrorsChange: (errors) => trees.push(errors),
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
    const trees: Array<ErrorTreeNode> = []
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
      onErrorsChange: (errors) => trees.push(errors),
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
 * emits no `errors:change`; otherwise every new parent row would rebuild it.
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
      const first = view.errors
      expect(first.sources.map((node) => node.alias)).toEqual([alias])
      expect(view.errors, `a second read gives the same tree`).toBe(first)
      params.reportError(new Error(`stalled`))
      const reported = view.errors
      expect(reported).not.toBe(first)
      expect(view.errors, `the changed tree is stable too`).toBe(reported)
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
        items: q
          .from({ a: A.collection })
          .where(({ a }) => eq(a.parentId, b.id)),
        same: q.from({ a: A.collection }).where(({ a }) => eq(a.id, b.id)),
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
      const includes = () => query.errors.sources.slice(1)
      expect(includes().map((node) => [node.alias, node.kind])).toEqual([
        [`a`, `include`],
        [`a`, `include`],
      ])

      let events = 0
      const stop = query.on(`errors:change`, () => {
        events++
      })
      // New parent rows start healthy child Collections. Every tree change is
      // announced, so with no event the tree is the same object.
      const treeBefore = query.errors
      B.write({ id: 3, parentId: 3 })
      B.write({ id: 4, parentId: 4 })
      await flushPromises()
      stop()
      expect(events, `healthy children emit no errors:change`).toBe(0)
      expect(query.errors, `no tree change without an event`).toBe(treeBefore)

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
 * issuer (a lazy demand or a root source). Its node shows one of them: the
 * most recent failure among the requests still failing. When the last one
 * settles, the node is healthy again. The model is a list of failing issuers
 * in failure order; the production driver is the shared `RequestErrors`
 * tracker, and the check compares the shown cause after every step, plus
 * whether a settle reported a change.
 */
describe(`request error bookkeeping`, () => {
  const key = fc.constantFrom(`a`, `b`, `c`)
  const step = fc.oneof(
    fc.record({ kind: fc.constant(`fail` as const), key }),
    fc.record({ kind: fc.constant(`settle` as const), key }),
  )
  fcTest.prop(
    [fc.array(step, { maxLength: 12 })],
    oraclePropertyOptions(100, `source-health.request-errors`),
  )(`a node shows the latest failure still failing`, (steps) => {
    const tracker = new RequestErrors()
    const failing: Array<{ key: string; cause: Error }> = []
    for (const { kind, key: issuer } of steps) {
      const before = failing.at(-1)?.cause ?? null
      const index = failing.findIndex((entry) => entry.key === issuer)
      if (index !== -1) failing.splice(index, 1)
      if (kind === `fail`) {
        const cause = new Error(`${issuer} failed`)
        failing.push({ key: issuer, cause })
        tracker.fail(issuer, cause)
      } else {
        const changed = tracker.settle(issuer)
        expect(changed, `settle ${issuer} reports a change`).toBe(
          (failing.at(-1)?.cause ?? null) !== before,
        )
      }
      expect(tracker.problem?.cause ?? null).toBe(failing.at(-1)?.cause ?? null)
    }
  })
})
