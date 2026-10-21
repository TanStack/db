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
 *   After a crash, adapter calls do nothing: core ended the run.
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
 * reported problem. It derives
 * each live query's gate from its Collections, using only the rules above,
 * and builds the expected tree from those facts. It does not read production
 * state.
 *
 * ## The history grammar
 *
 * Steps act on Collection `A` or `B`: `ready` writes the Collection's row and calls
 * `markReady()`; `fail` calls `fail()`; `report` calls `reportError()`;
 * `healthy` calls `reportHealthy()`; `crash` crashes the Collection through
 * its lifecycle, as a crash cause would; `reload` calls `collection.reload()`.
 * A reload keeps the rows, status, and shown problem, and marks the node
 * `reloading`, until the new run's first commit (the next `ready`) replaces
 * the rows and clears the node, or its `fail` shows the new error. A
 * reload of a crashed Collection rejects. `reload-cleanup-fails` reloads while
 * the retired run's cleanup rejects: that breaks the adapter contract, so the
 * Collection crashes and the reload ends with it, unless a reload is already in
 * flight and nothing is retired. `cancel` begins, writes, and commits with an
 * aborted signal: nothing changes, and a reload's truncate waits for the run's
 * next commit. A query whose first load failed stays in `error` until its
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
 * its row count while ready, the full projected error tree, and the thrown
 * error class. It also checks identity: reading twice gives the same tree,
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
 * The generated Collections are eager, so a live query cannot become ready
 * while a Collection is still loading. The on-demand case, where a
 * Collection fails its first load after the live query is ready, is not
 * generated; a focused lane enumerates it. Per-row child
 * Collections are not in the tree; an include's node shows its source. Pooled histories do not restart: a pooled view ends for good when
 * its Collection is cleaned up. The ordering check reads the observed query
 * only, not its Collections.
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

type Row = { id: number; parentId: number }
type SyncParams = Parameters<SyncConfig<Row, number>[`sync`]>[0]
type SourceName = `A` | `B`
type Shape =
  `direct` | `join` | `self-join` | `nested` | `include` | `pooled-nested`
type Step =
  | {
      kind:
        | `ready`
        | `fail`
        | `report`
        | `healthy`
        | `crash`
        | `reload`
        | `reload-cleanup-fails`
        | `cancel`
      source: SourceName
    }
  | { kind: `restart` }
  | { kind: `reload-query` }

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

type Gate = `loading` | `ready` | `error` | `crashed`
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
type SourceModel = GateModel & {
  failure: Problem
  stopped: Problem
  failureFromReload: boolean
}
// A query's reload() reloads the Collections below it that show an error,
// then reloads the query itself once they all settle, unless one failed.
type PendingSelfReload = {
  target: `query` | `inner`
  waits: Set<SourceName | `inner`>
  failed: boolean
}
type Model = {
  sources: Record<SourceName, SourceModel>
  query: GateModel
  inner: GateModel
  serial: number
  selfReloads: Array<PendingSelfReload>
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
  })
  return {
    sources: { A: source(), B: source() },
    query: { gate: `loading`, cause: null, reloading: false },
    inner: { gate: `loading`, cause: null, reloading: false },
    serial: 0,
    selfReloads: [],
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
  if (shape === `nested`) {
    model.inner = deriveGate(model.inner, gates([`A`]))
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
    Object.assign(model, freshModel())
    return `ok`
  }
  if (step.kind === `reload-query`) {
    // A pooled view has no reload of its own.
    if (shape === `pooled-nested`) return `ok`
    if (model.query.gate === `crashed`) return `throws`
    // The query reloads every Collection below it that shows an error,
    // through any nested live query; a reload in flight keeps its run.
    const reloaded = shapeSources[shape].filter((name) => {
      const source = model.sources[name]
      return source.gate === `error` || source.stopped !== null
    })
    for (const name of reloaded) model.sources[name].reloading = true
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
    return `ok`
  }
  // A step on a source this shape does not read has no effect.
  if (!shapeSources[shape].includes(step.source)) return `ok`
  const source = model.sources[step.source]
  let outcome: `ok` | `throws` | `bad-transition` = `ok`
  // After a crash, adapter calls do nothing and a reload rejects. After
  // fail(), adapter calls throw until a reload starts a new sync run.
  const stopped =
    !source.reloading && (source.gate === `error` || source.stopped !== null)
  if (step.kind !== `crash` && source.gate === `crashed`) {
    deriveQueries(shape, model)
    return step.kind === `reload` || step.kind === `reload-cleanup-fails`
      ? `throws`
      : outcome
  }
  switch (step.kind) {
    case `ready`:
      if (source.reloading) {
        // The new run's first commit replaces the rows and clears the
        // retired run's problems from the node.
        source.reloading = false
        source.gate = `ready`
        source.cause = null
        if (!source.failureFromReload) source.failure = null
        source.failureFromReload = false
        source.stopped = null
      } else if (source.gate === `error`) outcome = `bad-transition`
      else if (stopped) outcome = `throws`
      else source.gate = `ready`
      break
    case `reload`:
      // Everything visible stays until the new run commits or fails.
      source.reloading = true
      break
    case `cancel`:
      // A commit canceled by its signal never happened: nothing changes,
      // and a reload's truncate waits for the run's next commit.
      break
    case `reload-cleanup-fails`:
      // A reload in flight returns its promise and retires nothing.
      if (source.reloading) break
      // The retired run's cleanup rejecting breaks the adapter contract:
      // the Collection crashes and the reload ends with it.
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
      else if (source.gate !== `ready`) {
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
      // From any active status, for good.
      if (source.gate !== `crashed`) {
        source.gate = `crashed`
        source.cause = `${step.source} crashed`
        source.failure = null
        source.stopped = null
        source.reloading = false
      }
      break
  }
  deriveQueries(shape, model)
  settleSelfReloads(shape, model)
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
    (node.error ?? node.failureReason)!.message.replace(cleanupPrefix, ``),
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
  const collection = createCollection<Row, number>({
    id: `health-oracle-${name}-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    startSync: false,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
        return () => {
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

function project(node: ErrorTreeNode): ExpectedNode {
  const problem = (info: ErrorTreeNode[`error`]): ExpectedProblem =>
    info ? { message: info.message.replace(cleanupPrefix, ``) } : null
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
    steps = steps.filter((step) => step.kind !== `restart`)
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
  // Cleanup without subscribers drops event listeners, so each sync run
  // registers its own.
  const begin = () => {
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
    start()
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
      const expected = applyModel(shape, model, step)
      events = []
      let thrown: unknown
      try {
        if (step.kind === `reload-query`) {
          const reload = (query as { reload?: () => Promise<void> }).reload?.()
          if (query.status === `crashed`)
            thrown = await reload?.catch((e: unknown) => e)
          else void reload?.catch(() => undefined)
          await flushPromises()
        } else if (step.kind === `restart`) {
          await query.cleanup()
          await inner?.cleanup({ dependents: true })
          await Promise.all([
            sources.A.collection.cleanup(),
            sources.B.collection.cleanup(),
          ])
          begin()
        } else if (shapeSources[shape].includes(step.source)) {
          const params = sources[step.source].params
          if (step.kind === `reload`) {
            // A reload settles only when its new run commits or fails; a
            // crashed Collection rejects at once.
            const reload = params.collection.reload()
            if (params.collection.status === `crashed`)
              thrown = await reload.catch((e: unknown) => e)
            else void reload.catch(() => undefined)
          } else if (step.kind === `reload-cleanup-fails`) {
            sources[step.source].failNextCleanup()
            const reload = params.collection.reload()
            if (params.collection.status === `crashed`)
              thrown = await reload.catch((e: unknown) => e)
            else {
              void reload.catch(() => undefined)
              await flushPromises()
            }
            sources[step.source].failNextCleanup(false)
          } else if (step.kind === `ready`) {
            // A reload's new run commits its row, as a first load does.
            if (
              params.collection.status === `loading` ||
              params.collection._lifecycle.reloading
            ) {
              params.begin()
              params.write({
                type: `insert`,
                value: { id: 1, parentId: 1 },
              })
              params.commit()
            }
            params.markReady()
          } else if (step.kind === `cancel`) {
            const canceled = new AbortController()
            canceled.abort()
            params.begin()
            params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
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
      if (model.query.gate === `ready`) {
        expect(size(), `${label}: rows stay while ready`).toBe(1)
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
        if (JSON.stringify(before) !== JSON.stringify(after)) {
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
const on = (
  kind: Exclude<Step[`kind`], `restart`>,
  source: SourceName,
): Step => ({
  kind,
  source,
})
const restart: Step = { kind: `restart` }

// Named histories, one per distinction the law draws.
const namedHistories: Record<string, ReadonlyArray<Step>> = {
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
    { weight: 1, arbitrary: fc.constant(restart) },
    { weight: 1, arbitrary: fc.constant({ kind: `reload-query` } as const) },
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
            `cancel` as const,
          ),
          fc.constantFrom(`A` as const, `B` as const),
        )
        .map(([kind, source]) => on(kind, source)),
    },
  )
  fcTest.prop(
    [fc.constantFrom(...shapes), fc.array(stepArb, { maxLength: 8 })],
    oraclePropertyOptions(60, `source-health.history`),
  )(`generated histories refine the model`, (shape, steps) =>
    runHistory(shape, steps),
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

  // A reload whose new run fails keeps the rows, so they stay the baseline
  // that a diffing adapter, such as query-db, reads for its next write.
  it(`keeps the rows as the baseline after the reload's new run fails`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    source.params.begin()
    source.params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    source.params.commit()
    source.params.markReady()
    const reload = source.collection.reload().catch(() => undefined)
    source.params.fail(new Error(`reload failed`))
    await reload
    const baseline = [
      ...source.params.collection._state.acceptedSyncedEntries(),
    ]
    expect(baseline.map(([key]) => key)).toEqual([1])
    expect([...source.collection.keys()]).toEqual([1])
    expect(source.collection.errors.error?.message).toBe(`reload failed`)
    await source.collection.cleanup()
  })

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
    const outcomes: Array<`ok` | `fail`> = []
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
    return { parents, children, query, outcomes, writeParent, markParentsReady }
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
    const source = createCollection<Row, number>({
      id: `health-effect-stopped-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      startSync: true,
      sync: {
        sync: (params) => {
          if (status === `error`) params.fail(new Error(`first load failed`))
          else params.markReady()
        },
      },
    })
    await source.preload().catch(() => undefined)
    if (status === `crashed`) source._lifecycle.crash(new Error(`crashed`))
    expect(source.status).toBe(status)
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
