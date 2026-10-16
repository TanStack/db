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
 * An include's source node has `kind: 'include'` and rolls up the include's
 * per-row child Collections as `instances: { total, withErrors }`. A pooled
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
 * each live query's gate from its Collections, using only the rules above, and
 * the include's parent rows from whether `B` synced its row while the
 * sync run was running. It builds the expected tree from those facts. It does
 * not read production state.
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
 * reload of a crashed Collection rejects. A query whose first load failed
 * starts again once no source has a failure, `loading` with `reloading`
 * until it is ready. `restart` cleans up the
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
 * the current tree. Request lanes check that a lazy load or a root Collection's
 * load that fails after initial-query readiness is a request error on the query's
 * node, and that it clears. Effect lanes check the Effect's gate and its
 * request errors after its initial-query readiness.
 *
 * ## Limits
 *
 * Collections are eager, so a live query cannot become ready while a Collection is
 * still loading. The on-demand case, where a Collection fails its first load
 * after the live query is ready, is not generated here. Per-row child
 * Collections are rolled up, not nodes, and no grammar step fails one; the
 * include-instances lane fails one and checks the roll-up, the relay, and
 * that two includes under one alias count separately. An Effect's request
 * error clears on a later successful load of the same Collection; release of
 * only the failed demand is not exercised. Pooled histories do not restart: a pooled view ends for good when
 * its Collection is cleaned up. The ordering check reads the observed query
 * only, not its Collections.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createEffect } from '../src/query/effect.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import { Query } from '../src/query/builder/index.js'
import { eq } from '../src/query/builder/functions.js'
import { InvalidCollectionStatusTransitionError } from '../src/errors.js'
import { RequestErrors } from '../src/collection/lifecycle.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
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
      kind: `ready` | `fail` | `report` | `healthy` | `crash` | `reload`
      source: SourceName
    }
  | { kind: `restart` }

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
type SourceModel = GateModel & { failure: Problem; stopped: Problem }
type Model = {
  sources: Record<SourceName, SourceModel>
  query: GateModel
  inner: GateModel
  serial: number
  // Parent rows the include query's sync run has received from `B`.
  parentRows: number
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
  })
  return {
    sources: { A: source(), B: source() },
    query: { gate: `loading`, cause: null, reloading: false },
    inner: { gate: `loading`, cause: null, reloading: false },
    serial: 0,
    parentRows: 0,
  }
}

// A live query's status follows its sources until it is ready, and never
// leaves `crashed`. A crashed input crashes the query at any time, even after
// its first load failed, as a crash does to a Collection; after the query is
// ready, nothing else changes it. A failed first load stays until no input
// has a failure left (inputs leave `error` only by reloading): then the query
// starts a new sync run, `loading` with `reloading` until it is ready. The
// query takes the cause of the input that ended its sync run.
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
  if (current.gate === `error`) {
    if (failed) return current
    current = { gate: `loading`, cause: null, reloading: true }
  }
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
    // A running sync run receives `B`'s row once `B` syncs it, including a
    // run that started again; a failed sync run receives nothing more.
    if (
      shape === `include` &&
      (model.query.gate === `loading` || model.query.gate === `ready`) &&
      model.sources.B.gate === `ready`
    ) {
      model.parentRows = 1
    }
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
    return step.kind === `reload` ? `throws` : outcome
  }
  switch (step.kind) {
    case `ready`:
      if (source.reloading) {
        // The new run's first commit replaces the rows and clears the node.
        source.reloading = false
        source.gate = `ready`
        source.cause = null
        source.failure = null
        source.stopped = null
      } else if (source.gate === `error`) outcome = `bad-transition`
      else if (stopped) outcome = `throws`
      else source.gate = `ready`
      break
    case `reload`:
      // Everything visible stays until the new run commits or fails.
      source.reloading = true
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
      else
        source.failure = {
          message: `${step.source} problem`,
          serial: ++model.serial,
        }
      break
    case `healthy`:
      if (stopped || source.gate !== `ready`) outcome = `throws`
      else source.failure = null
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
  return outcome
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
  instances?: { total: number; withErrors: number }
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
      // The include node rolls up the per-row child Collections: one per
      // parent row the sync run received. They stay until a restart, even
      // when the sync run fails later. No grammar step fails a child
      // Collection, so none is in error.
      return queryNode(`root`, model.query, [
        source(`b`, B),
        {
          ...sourceNode(`a`, A, identity, `include`),
          instances: { total: model.parentRows, withErrors: 0 },
        },
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
  const collection = createCollection<Row, number>({
    id: `health-oracle-${name}-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    startSync: false,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
      },
    },
  })
  return {
    collection,
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
function project(node: ErrorTreeNode): ExpectedNode {
  const problem = (info: ErrorTreeNode[`error`]): ExpectedProblem =>
    info ? { message: info.message } : null
  return {
    alias: node.alias,
    kind: node.kind,
    status: node.status as Gate,
    hasErrors: node.hasErrors,
    failureReason: problem(node.failureReason),
    error: problem(node.error),
    reloading: node.reloading,
    ...(node.instances ? { instances: node.instances } : {}),
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
        if (step.kind === `restart`) {
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

/**
 * A load that fails after the Effect's gate is a request error, as it is on
 * a live query's node: the Effect is not disposed, `onErrorsChange` receives
 * a tree whose root node has a `request` error, and a later successful load
 * of the same source clears it. The parents lead the Effect, and a lazy join
 * loads the children each new parent row reaches. The lane crosses
 * `skipInitial` with the parents' source mode.
 */
describe(`effect request errors`, () => {
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

      // Model: after initial-query readiness, a failed load is a request error.
      outcomes.push(`fail`)
      writeParent(2)
      await flushPromises()
      expect(effect.disposed).toBe(false)
      expect(sourceErrors).toEqual([])
      expect(trees.at(-1)?.error).toMatchObject({
        message: `child load failed`,
      })
      expect(trees.at(-1)?.hasErrors).toBe(true)

      // Model: a later successful load of the same source clears it.
      outcomes.push(`ok`)
      writeParent(3)
      await flushPromises()
      expect(effect.disposed).toBe(false)
      expect(trees.at(-1)?.error).toBeNull()
      expect(trees.at(-1)?.hasErrors).toBe(false)
    } finally {
      console.error = consoleError
      await effect.dispose()
      await parents.cleanup()
      await children.cleanup()
    }
  })
})

/**
 * An include node rolls up the include's own per-row child Collections. A
 * child Collection that fails, here because an index the reader created on
 * it throws on a new row, counts in `inError` and makes the include node
 * `hasErrors`; the live query emits `errors:change` for it and keeps its own
 * status. Two includes that read one Collection under the same alias are
 * two nodes, and each counts only its own children. A healthy child that
 * starts does not change any node's error state, so it emits no
 * `errors:change`; otherwise every new parent row would rebuild the tree.
 */
describe(`include instances`, () => {
  it(`a failing child Collection counts in its own include only`, async () => {
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
      expect(includes().map((node) => [node.kind, node.instances])).toEqual([
        [`include`, { total: 2, withErrors: 0 }],
        [`include`, { total: 2, withErrors: 0 }],
      ])

      let events = 0
      const stop = query.on(`errors:change`, () => {
        events++
      })
      // New parent rows start healthy child Collections.
      B.write({ id: 3, parentId: 3 })
      B.write({ id: 4, parentId: 4 })
      await flushPromises()
      expect(events, `healthy children emit no errors:change`).toBe(0)
      expect(includes()[0]!.instances).toEqual({ total: 4, withErrors: 0 })
      // One child Collection of `items` fails: its index throws on row 9.
      class FailingIndex extends BasicIndex<number> {
        override add(key: number, item: any): void {
          if (key === 9) throw new Error(`index failed`)
          super.add(key, item)
        }
      }
      const items = query.get(1)!.items
      items.createIndex((row) => row.id, { indexType: FailingIndex })
      expect(() => A.write({ id: 9, parentId: 1 })).toThrow(`index failed`)
      await flushPromises()
      stop()

      expect(items.status).toBe(`crashed`)
      expect(query.status).toBe(`ready`)
      expect(events, `errors:change relay`).toBeGreaterThan(0)
      const [itemsNode, sameNode] = includes()
      expect(itemsNode!.instances).toEqual({ total: 4, withErrors: 1 })
      expect(itemsNode!.hasErrors).toBe(true)
      expect(sameNode!.instances).toEqual({ total: 4, withErrors: 0 })
      expect(sameNode!.hasErrors).toBe(false)
      expect(query.errors.hasErrors).toBe(true)

      // Removing the failing child's parent row retires that child, so it
      // leaves the count and the query reports the change.
      let retireEvents = 0
      const stopRetire = query.on(`errors:change`, () => {
        retireEvents++
      })
      B.write({ id: 1, parentId: 1 }, `delete`)
      await flushPromises()
      stopRetire()
      expect(retireEvents, `retiring a child in error relays`).toBeGreaterThan(
        0,
      )
      expect(includes()[0]!.instances).toEqual({ total: 3, withErrors: 0 })
      expect(query.errors.hasErrors).toBe(false)
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
