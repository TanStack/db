/**
 * # When may a live-query Collection start provider work?
 *
 * A live-query Collection reads local memory. It starts no provider work on
 * its own. Provider work comes from a source Collection whose sync run started
 * because of its own `startSync: true`, a subscriber, or a preload. A
 * live-query Collection's own subscriptions to its source Collections defer
 * acquisition until the live-query Collection has a subscriber or a preload in
 * its current sync run. Deferred subscriptions start no idle source
 * Collection's sync run and no acquisition attempt. Their demand stays active.
 * The rule is transitive: a live-query Collection over another one resumes the
 * inner Collection's acquisition only when it resumes its own.
 *
 * Before its first subscriber or preload, a live-query Collection may start
 * its own sync run (a framework render or `startSync: true`) and reads the rows
 * its source Collections already hold. Cleanup ends the sync run, so a
 * restarted live-query Collection defers acquisition again.
 *
 * Two publication rules qualify those local reads. An ordered window over an
 * on-demand source Collection is not published until its acquisitions settle,
 * by atomic window publication, because local rows cannot prove a window. An
 * unordered query publishes the rows its source Collections hold as a partial
 * result.
 *
 * Initial-query readiness follows the same rule. With no provider work
 * needed, because every source Collection is eager and its sync run already
 * started, the live-query Collection is ready as soon as its sync run runs.
 * Otherwise it is not ready before its first subscriber or preload. When that
 * call starts the sync run, and every needed acquisition attempt and source
 * sync run completes synchronously, it is ready before the call returns: the
 * synchronous observation cut. When the sync run started earlier, deferred
 * acquisition resumes through the subscription's restart path, which settles
 * asynchronously. Over eager source Collections that resumption is
 * synchronous.
 *
 * Limits: source Collections load synchronously, so every checkpoint is
 * settled. The grammar crosses five source states, two query shapes, and one or
 * two live-query levels. It does not generate concurrent consumers, failure,
 * or truncate; the subscription lifecycle oracle owns those once acquisition
 * has resumed.
 */
import { describe, expect, it } from 'vitest'
import {
  BTreeIndex,
  Query,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '../src'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import type { Collection } from '../src'

type Row = { id: string; rank: number; group: string }
const ROWS: Array<Row> = [
  { id: `a`, rank: 1, group: `g` },
  { id: `b`, rank: 2, group: `g` },
  { id: `c`, rank: 3, group: `g` },
]

/**
 * ## Source states
 *
 * `-running` and `-holding` source Collections already started their sync
 * run, by `startSync: true`, before any live-query Collection exists. An eager
 * source Collection writes every row when its sync run starts. An on-demand
 * source Collection writes rows only for an acquisition attempt, except that
 * `on-demand-holding` already holds every row, as it would after another
 * consumer's acquisition. Each fixture counts sync-run starts and acquisition
 * attempts: those are its provider work.
 */
type SourceState =
  | `eager-idle`
  | `eager-running`
  | `on-demand-idle`
  | `on-demand-running`
  | `on-demand-holding`

const SOURCE_STATES: Array<SourceState> = [
  `eager-idle`,
  `eager-running`,
  `on-demand-idle`,
  `on-demand-running`,
  `on-demand-holding`,
]

/**
 * ## Query shapes
 *
 * `all` reads every row. `window` orders by rank and keeps a limit of two,
 * which uses the ordered loading path.
 */
type QueryShape = `all` | `window`
const QUERY_SHAPES: Array<QueryShape> = [`all`, `window`]
const EXPECTED_IDS: Record<QueryShape, Array<string>> = {
  all: [`a`, `b`, `c`],
  window: [`a`, `b`],
}

/**
 * ## History grammar
 *
 * Commands act on the outermost live-query Collection, which is the only
 * public Collection in the history. `start` starts its sync run, as a
 * framework render or `startSync: true` does. `subscribe` adds a subscriber.
 * `preload` asks for its data. `cleanup` ends its sync run. Each history is
 * legal: it never subscribes twice or unsubscribes without a subscription.
 */
type Command =
  `start` | `read` | `subscribe` | `unsubscribe` | `preload` | `cleanup`

const HISTORIES: Record<string, Array<Command>> = {
  'start and read without a subscriber': [`start`, `read`],
  'subscribe after start': [`start`, `read`, `subscribe`],
  'preload after start': [`start`, `preload`],
  'subscribe without a prior start': [`subscribe`],
  'cleanup before a subscriber, then subscribe': [
    `start`,
    `read`,
    `cleanup`,
    `start`,
    `subscribe`,
  ],
  'restart after a run with a subscriber': [
    `start`,
    `subscribe`,
    `unsubscribe`,
    `cleanup`,
    `start`,
    `read`,
  ],
}

/**
 * ## Reference model
 *
 * The model tracks only what the law names. `subscriberOrPreload` is whether
 * the outer live-query Collection had a subscriber or a preload in its current
 * sync run. At depth two, `innerSubscriberOrPreload` is the same fact for the
 * inner live-query Collection: the outer's first subscriber or preload resumes
 * it, and cleanup of the outer does not end the inner sync run. Once the inner
 * Collection's acquisitions settled, the outer reads it as local memory.
 * `sourceStarted` and `sourceHoldsRows` describe the source Collection. It
 * never reads production state.
 *
 * - After a command that leaves no subscriber or preload, the source
 *   Collection's sync-run starts and acquisition attempts do not change.
 * - The first subscriber or preload starts an idle source Collection's sync run
 *   once. Over an on-demand source Collection it starts at least one
 *   acquisition attempt.
 * - A running sync run shows the rows the source Collection holds, except
 *   that an on-demand window stays unpublished until a subscriber or preload
 *   lets its acquisitions run.
 * - It is ready when it had a subscriber or preload, or when its source
 *   Collection is eager and already started, so it needs no provider work.
 * - The first subscriber or preload makes it ready before that call returns
 *   when the call starts the sync run, or when the source Collection is eager.
 */
type ModelState = {
  subscriberOrPreload: boolean
  innerSubscriberOrPreload: boolean
  syncRunning: boolean
  sourceHoldsRows: boolean
  sourceStarted: boolean
}

type Expected = {
  startsAdded: number
  acquisitions: `none` | `some`
  readyAtCall: boolean
  ready: boolean | `unchecked`
  ids: Array<string> | `unchecked`
}

function initialModel(state: SourceState): ModelState {
  return {
    subscriberOrPreload: false,
    innerSubscriberOrPreload: false,
    syncRunning: false,
    sourceHoldsRows: state === `eager-running` || state === `on-demand-holding`,
    sourceStarted: state.endsWith(`running`) || state.endsWith(`holding`),
  }
}

function applyModel(
  state: SourceState,
  shape: QueryShape,
  depth: 1 | 2,
  model: ModelState,
  command: Command,
): { next: ModelState; expected: Expected } {
  const onDemand = state.startsWith(`on-demand`)
  const next = { ...model }
  switch (command) {
    case `start`:
      next.syncRunning = true
      break
    case `read`:
    case `unsubscribe`:
      // A subscriber or preload belongs to the sync run, not to one
      // subscription, so unsubscribing does not defer acquisition again.
      break
    case `subscribe`:
    case `preload`:
      next.syncRunning = true
      next.subscriberOrPreload = true
      break
    case `cleanup`:
      next.subscriberOrPreload = false
      next.syncRunning = false
      break
  }
  const firstSubscriberOrPreload =
    next.subscriberOrPreload && !model.subscriberOrPreload
  let startsAdded = 0
  if (firstSubscriberOrPreload && !next.sourceStarted) {
    startsAdded = 1
    next.sourceStarted = true
  }
  if (firstSubscriberOrPreload) {
    next.sourceHoldsRows = true
    if (depth === 2) next.innerSubscriberOrPreload = true
  }
  // An inner live-query Collection with settled acquisitions is local memory.
  const readsSettledInner = depth === 2 && next.innerSubscriberOrPreload
  const needsNoProviderWork =
    (!onDemand && next.sourceStarted) || readsSettledInner
  return {
    next,
    expected: {
      startsAdded,
      acquisitions: firstSubscriberOrPreload && onDemand ? `some` : `none`,
      readyAtCall:
        firstSubscriberOrPreload &&
        (!model.syncRunning ||
          !onDemand ||
          (depth === 2 && model.innerSubscriberOrPreload)),
      ready: next.syncRunning
        ? next.subscriberOrPreload || needsNoProviderWork
        : `unchecked`,
      ids: next.syncRunning
        ? next.sourceHoldsRows &&
          !(
            shape === `window` &&
            onDemand &&
            !next.subscriberOrPreload &&
            !readsSettledInner
          )
          ? EXPECTED_IDS[shape]
          : []
        : `unchecked`,
    },
  }
}

/**
 * ## Production driver
 *
 * Real Collections only. The source Collection counts its own provider work.
 * The driver reads the outer live-query Collection's status right after each
 * command returns, for the synchronous observation cut, and its status and
 * rows again after the history settles.
 */
let sequence = 0

function makeSource(state: SourceState) {
  const counts = { starts: 0, acquisitions: 0 }
  const onDemand = state.startsWith(`on-demand`)
  const written = new Set<string>()
  const collection = createCollection<Row>({
    id: `deferred-acquisition-${sequence++}`,
    getKey: (row) => row.id,
    syncMode: onDemand ? `on-demand` : `eager`,
    startSync: state !== `eager-idle` && state !== `on-demand-idle`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        counts.starts++
        const writeAll = () => {
          begin()
          for (const row of ROWS) {
            if (written.has(row.id)) continue
            written.add(row.id)
            write({ type: `insert`, value: row })
          }
          commit()
        }
        if (!onDemand || state === `on-demand-holding`) writeAll()
        markReady()
        if (!onDemand) return
        return {
          loadSubset: () => {
            counts.acquisitions++
            writeAll()
            return true
          },
        }
      },
    },
  })
  return { collection, counts }
}

function makeLiveQuery(
  source: Collection<Row, string | number, any>,
  shape: QueryShape,
  depth: 1 | 2,
) {
  const read = (q: any, from: unknown) => {
    const base = q
      .from({ row: from })
      .orderBy(({ row }: any) => row.rank, `asc`)
    return shape === `window` ? base.limit(2) : base
  }
  const inner = createLiveQueryCollection({
    query: (q) => read(q, source),
    gcTime: 0,
  })
  if (depth === 1) return { outer: inner, collections: [inner] }
  const outer = createLiveQueryCollection({
    query: (q) => read(q, inner),
    gcTime: 0,
  })
  return { outer, collections: [outer, inner] }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * ## Refinement check
 *
 * After every command the driver compares the source Collection's added
 * provider work, the synchronous readiness cut, and the settled status and
 * rows with the model. A failure names the source state, query shape, depth,
 * history, and step.
 */
describe(`live-query deferred acquisition`, () => {
  for (const state of SOURCE_STATES) {
    for (const shape of QUERY_SHAPES) {
      for (const depth of [1, 2] as const) {
        for (const [name, commands] of Object.entries(HISTORIES)) {
          it(`${state}, ${shape}, depth ${depth}: ${name}`, async () => {
            const { collection: source, counts } = makeSource(state)
            const { outer, collections } = makeLiveQuery(source, shape, depth)
            let model = initialModel(state)
            let subscription: { unsubscribe: () => void } | undefined
            try {
              for (const [step, command] of commands.entries()) {
                const before = { ...counts }
                let pending: Promise<void> | undefined
                switch (command) {
                  case `start`:
                    outer.startSyncImmediate()
                    break
                  case `read`:
                    break
                  case `subscribe`:
                    subscription = outer.subscribeChanges(() => {}, {
                      includeInitialState: true,
                    })
                    break
                  case `unsubscribe`:
                    subscription?.unsubscribe()
                    subscription = undefined
                    break
                  case `preload`:
                    pending = outer.preload()
                    break
                  case `cleanup`:
                    subscription?.unsubscribe()
                    subscription = undefined
                    pending = outer.cleanup()
                    break
                }
                const statusAtCall = outer.status
                await pending
                await settle()
                const result = applyModel(state, shape, depth, model, command)
                model = result.next
                const { expected } = result
                const where = `${command} at step ${step}`

                expect(
                  counts.starts - before.starts,
                  `${where}: source sync-run starts`,
                ).toBe(expected.startsAdded)
                const attempts = counts.acquisitions - before.acquisitions
                if (expected.acquisitions === `none`) {
                  expect(attempts, `${where}: acquisition attempts`).toBe(0)
                } else {
                  expect(
                    attempts,
                    `${where}: acquisition attempts`,
                  ).toBeGreaterThan(0)
                }
                if (expected.readyAtCall) {
                  expect(
                    statusAtCall,
                    `${where}: ready before the call returns`,
                  ).toBe(`ready`)
                }
                if (expected.ready !== `unchecked`) {
                  expect(
                    outer.status === `ready`,
                    `${where}: initial-query readiness (status ${outer.status})`,
                  ).toBe(expected.ready)
                }
                if (expected.ids !== `unchecked`) {
                  expect(
                    outer.toArray.map((row) => row.id),
                    `${where}: rows`,
                  ).toEqual(expected.ids)
                }
              }
            } finally {
              subscription?.unsubscribe()
              for (const collection of collections) await collection.cleanup()
              await source.cleanup()
            }
          })
        }
      }
    }
  }
})

/**
 * ## Pooled live queries
 *
 * A pooled live query serves an `eq` query on one eager source Collection from
 * an equality partition. Building its view during a render subscribes the
 * partition to the source Collection, so the same law applies: the partition's
 * subscription defers acquisition until a view has a subscriber or a preload.
 * Only eager source states apply, and pooled cleanup releases a shared
 * partition, so this block uses the histories without cleanup. `start` is
 * building the view.
 */
describe(`pooled live-query deferred acquisition`, () => {
  const pooledHistories: Record<string, Array<Command>> = {
    'build and read without a subscriber': [`start`, `read`],
    'subscribe after build': [`start`, `read`, `subscribe`],
    'preload after build': [`start`, `preload`],
  }
  for (const state of [`eager-idle`, `eager-running`] as const) {
    for (const [name, commands] of Object.entries(pooledHistories)) {
      it(`${state}: ${name}`, async () => {
        const { collection: source, counts } = makeSource(state)
        let view: any
        let model = initialModel(state)
        let subscription: { unsubscribe: () => void } | undefined
        try {
          for (const [step, command] of commands.entries()) {
            const before = { ...counts }
            switch (command) {
              case `start`:
                view = createPooledLiveQuery(
                  new Query()
                    .from({ row: source })
                    .where(({ row }) => eq(row.group, `g`))
                    .orderBy(({ row }) => row.rank, `asc`),
                  { gcTime: 0 },
                )
                expect(view, `the query is poolable`).toBeDefined()
                break
              case `read`:
                break
              case `subscribe`:
                subscription = view.subscribeChanges(() => {})
                break
              case `preload`:
                await view.preload()
                break
              default:
                throw new Error(`pooled history uses no ${command}`)
            }
            await settle()
            const result = applyModel(state, `all`, 1, model, command)
            model = result.next
            const { expected } = result
            const where = `${command} at step ${step}`
            expect(
              counts.starts - before.starts,
              `${where}: source sync-run starts`,
            ).toBe(expected.startsAdded)
            if (expected.ready !== `unchecked`) {
              expect(
                view.status === `ready`,
                `${where}: initial-query readiness (status ${view.status})`,
              ).toBe(expected.ready)
            }
            if (expected.ids !== `unchecked`) {
              expect(
                Array.from(view.entries(), ([, row]: [unknown, Row]) => row.id),
                `${where}: rows`,
              ).toEqual(expected.ids)
            }
          }
        } finally {
          subscription?.unsubscribe()
          await view?.cleanup()
          await source.cleanup()
        }
      })
    }
  }
})
