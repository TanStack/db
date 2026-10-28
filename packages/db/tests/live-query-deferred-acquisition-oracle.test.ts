/**
 * # When may a live-query Collection start provider work?
 *
 * A live-query Collection reads local memory. It starts no provider work on
 * its own. Provider work comes from a source Collection whose sync run started
 * because of its own `startSync: true`, a subscriber, or a preload. A
 * live-query Collection's own subscriptions to its source Collections defer
 * acquisition until the live-query Collection has a subscriber that asks for
 * data, or a preload in its current sync run. A subscriber that survives
 * cleanup still asks for data; one that itself defers does not. Nothing else
 * resumes acquisition: not another consumer starting the source, and not a
 * source truncate. Deferred subscriptions start no idle source
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
 * A committed subscriber, including one that resumes deferred acquisition,
 * owns its demand independently of an abandoned render's sync-start deferral.
 * Its admission releases that deferral. A failed sync start remains an error
 * in that run; releasing the old render handle does not implicitly retry it.
 *
 * Limits: source Collections load synchronously, so every checkpoint is
 * settled. The grammar crosses seven source states, two query shapes, and one or
 * two live-query levels, with one peer consumer and one truncate before the
 * first subscriber. It does not generate source failure, asynchronous loads,
 * or several live-query consumers; the subscription lifecycle oracle owns
 * those once acquisition has resumed. Pinned blocks cover pooled views,
 * `DbClient` stream preloads, a subscriber that outlives cleanup, and reads
 * that wait for readiness.
 */
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createCollection } from '../src'
import { resumeDeferredLiveQueryCollections } from '../src/live-query-options.js'
import { Query } from '../src/query/builder/index.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import { expectedStartHandoff } from './collection-subscription-lifecycle-grammar-oracle.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
import { declareOracle } from './oracle-declaration.js'
import {
  EXPECTED_IDS,
  QUERY_SHAPES,
  makeLiveQuery,
  makeSource,
  pooledQuery,
  settle,
} from './live-query-deferred-acquisition-support.js'
import type {
  QueryShape,
  Row,
  SourceState,
} from './live-query-deferred-acquisition-support.js'

const SOURCE_STATES: Array<SourceState> = [
  `eager-idle`,
  `eager-running`,
  `eager-render-deferred`,
  `on-demand-idle`,
  `on-demand-running`,
  `on-demand-holding`,
  `on-demand-render-deferred`,
]

/**
 * ## History grammar
 *
 * Commands act on the outermost live-query Collection, which is the only
 * public Collection in the history. `start` starts its sync run, as a
 * framework render or `startSync: true` does. `subscribe` adds a subscriber.
 * `defer-subscribe` adds logical demand without acquisition; `resume` makes
 * that subscription ask for data independently of an earlier render.
 * `preload` asks for its data. `cleanup` ends its sync run. Two commands act
 * on the source Collection instead, and neither is a subscriber or a preload
 * of the live-query Collection: `peer` adds another consumer that subscribes
 * to the source directly, which may start its sync run, and `truncate` makes a
 * running source replace its rows, as a must-refetch does. Each history is
 * legal: it never subscribes twice or unsubscribes without a subscription.
 */
type Command =
  | `start`
  | `read`
  | `subscribe`
  | `defer-subscribe`
  | `resume`
  | `unsubscribe`
  | `preload`
  | `cleanup`
  | `peer`
  | `truncate`

const HISTORIES: Record<string, Array<Command>> = {
  'start and read without a subscriber': [`start`, `read`],
  'subscribe after start': [`start`, `read`, `subscribe`],
  'preload after start': [`start`, `preload`],
  'subscribe without a prior start': [`subscribe`],
  'resume deferred acquisition after start': [
    `start`,
    `defer-subscribe`,
    `read`,
    `resume`,
    `read`,
  ],
  'resume deferred acquisition without a prior start': [
    `defer-subscribe`,
    `read`,
    `resume`,
    `read`,
  ],
  'preload without a prior start': [`preload`],
  'cleanup before a subscriber, then subscribe': [
    `start`,
    `read`,
    `cleanup`,
    `start`,
    `subscribe`,
  ],
  'a peer starts the source before a subscriber, then subscribe': [
    `start`,
    `read`,
    `peer`,
    `subscribe`,
  ],
  'the source truncates before a subscriber, then subscribe': [
    `start`,
    `read`,
    `truncate`,
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
    case `defer-subscribe`:
      next.syncRunning = true
      break
    case `read`:
    case `unsubscribe`:
      // A subscriber or preload belongs to the sync run, not to one
      // subscription, so unsubscribing does not defer acquisition again.
      break
    case `subscribe`:
    case `resume`:
    case `preload`:
      next.syncRunning = true
      next.subscriberOrPreload = true
      break
    case `cleanup`:
      next.subscriberOrPreload = false
      next.syncRunning = false
      break
    case `peer`:
      // The peer's own subscription starts an idle source; an eager source
      // then holds every row. The live-query Collection gained no subscriber.
      if (!model.sourceStarted) {
        next.sourceStarted = true
        if (!onDemand) next.sourceHoldsRows = true
      }
      break
    case `truncate`:
      // A running source drops its rows; an eager source writes them again.
      if (model.sourceStarted && onDemand) next.sourceHoldsRows = false
      break
  }
  const firstSubscriberOrPreload =
    next.subscriberOrPreload && !model.subscriberOrPreload
  let startsAdded = command === `peer` && !model.sourceStarted ? 1 : 0
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
 * ## Refinement check
 *
 * After every command the driver compares the source Collection's added
 * provider work, the synchronous readiness cut, and the settled status and
 * rows with the model. A failure names the source state, query shape, depth,
 * history, and step.
 */
async function runAcquisitionHistory(
  state: SourceState,
  shape: QueryShape,
  depth: 1 | 2,
  commands: ReadonlyArray<Command>,
): Promise<void> {
  const {
    collection: source,
    counts,
    truncate: truncateSource,
  } = makeSource(state)
  const { outer, collections } = makeLiveQuery(source, shape, depth)
  let peer: { unsubscribe: () => void } | undefined
  let model = initialModel(state)
  let subscription: ReturnType<typeof outer.subscribeChanges> | undefined
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
        case `defer-subscribe`:
          subscription = outer.subscribeChanges(() => {}, {
            includeInitialState: true,
            deferAcquisition: true,
          })
          break
        case `resume`:
          subscription!.resumeDeferredAcquisition()
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
        case `peer`:
          peer = source.subscribeChanges(() => {})
          break
        case `truncate`:
          truncateSource()
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
        expect(attempts, `${where}: acquisition attempts`).toBeGreaterThan(0)
      }
      if (expected.readyAtCall) {
        expect(statusAtCall, `${where}: ready before the call returns`).toBe(
          `ready`,
        )
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
    peer?.unsubscribe()
    for (const collection of collections) await collection.cleanup()
    await source.cleanup()
  }
}

describe(`live-query deferred acquisition`, () => {
  for (const state of SOURCE_STATES) {
    for (const shape of QUERY_SHAPES) {
      for (const depth of [1, 2] as const) {
        for (const [name, commands] of Object.entries(HISTORIES)) {
          it(`${state}, ${shape}, depth ${depth}: ${name}`, async () => {
            return runAcquisitionHistory(state, shape, depth, commands)
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
 * building the view. An observer is another public demand path for the same
 * view: its preload must reach the source even though a pooled view has no
 * query-Collection config. The observer runs with and without an SSR cleanup
 * client, which must not mistake the absent config for a live-query builder.
 */
// The pooled entry point takes the internal builder, as its own oracle does.
declareOracle({
  check: [runAcquisitionHistory, runPooledHistory],
  model: [initialModel, applyModel, expectedReplacementRun],
})

async function runPooledHistory(
  state: SourceState,
  commands: ReadonlyArray<Command>,
): Promise<void> {
  const { collection: source, counts } = makeSource(state)
  let view: any
  let model = initialModel(state)
  let subscription: { unsubscribe: () => void } | undefined
  try {
    for (const [step, command] of commands.entries()) {
      const before = { ...counts }
      switch (command) {
        case `start`:
          view = createPooledLiveQuery(pooledQuery(source)(new Query()), {
            gcTime: 0,
          })
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
    await source.cleanup({ dependents: true })
  }
}

describe(`pooled live-query deferred acquisition`, () => {
  const pooledHistories: Record<string, Array<Command>> = {
    'build and read without a subscriber': [`start`, `read`],
    'subscribe after build': [`start`, `read`, `subscribe`],
    'preload after build': [`start`, `preload`],
  }
  for (const state of [`eager-idle`, `eager-running`] as const) {
    for (const [name, commands] of Object.entries(pooledHistories)) {
      it(`${state}: ${name}`, async () => {
        return runPooledHistory(state, commands)
      })
    }
  }
})

/**
 * After cleanup during admission, the replacement run's subscriber count,
 * readiness, and acquisition follow from how the surviving subscriber read.
 * Only a handle that returned as acquiring is demand for the next run; a
 * still-deferred handle contributes none. So a deferred reader leaves the
 * replacement unready unless the source is eager and idle, and the replacement
 * acquires only for an on-demand idle source that a non-deferred reader keeps.
 */
function expectedReplacementRun(
  state: SourceState,
  reader: `ordinary` | `resumed` | `deferred`,
) {
  return {
    acquiring: reader === `deferred` ? 0 : 1,
    ready: reader !== `deferred` || state === `eager-idle`,
    acquires: reader !== `deferred` && state === `on-demand-idle`,
  }
}

describe(`a subscriber that outlives cleanup`, () => {
  // Admission may still be transferring ownership when a source status callback
  // cleans up the live-query Collection. Cleanup retires that start, not the
  // surviving logical subscription. It must not restart before an explicit restart request.
  // The model counts a returned acquiring handle as demand for the next run;
  // a still-deferred handle contributes none. This extends the settled-cleanup
  // histories below with the construction boundary, both shapes and depths.
  it.each(
    ([`eager-idle`, `on-demand-idle`] as const).flatMap((state) =>
      QUERY_SHAPES.flatMap((shape) =>
        ([1, 2] as const).flatMap((depth) =>
          ([`ordinary`, `resumed`, `deferred`] as const).flatMap((reader) =>
            [false, true].flatMap((renderGate) =>
              ([`loading`, `ready`] as const).flatMap((cleanupAt) =>
                [false, true].map((restartFromCleanup) => ({
                  state,
                  shape,
                  depth,
                  reader,
                  renderGate,
                  cleanupAt,
                  restartFromCleanup,
                })),
              ),
            ),
          ),
        ),
      ),
    ),
  )(
    `$state $shape depth=$depth $reader gate=$renderGate survives $cleanupAt cleanup during admission (restart=$restartFromCleanup)`,
    async ({
      state,
      shape,
      depth,
      reader,
      renderGate,
      cleanupAt,
      restartFromCleanup,
    }) => {
      const expected = expectedReplacementRun(state, reader)
      const { collection: source, counts } = makeSource(state)
      const { outer, collections } = makeLiveQuery(source, shape, depth)
      if (renderGate) expect(outer._deferSyncStart()).toBe(true)
      let subscription: ReturnType<typeof outer.subscribeChanges> | undefined
      if (reader !== `ordinary`) {
        subscription = outer.subscribeChanges(() => {}, {
          deferAcquisition: true,
        })
      }
      let pending: Promise<void> | undefined
      let reached = false
      const retiredStatuses: Array<string> = []
      const stopTarget = outer.on(`status:change`, ({ status }) => {
        if (reached) {
          retiredStatuses.push(status)
          if (restartFromCleanup && status === `cleaned-up`)
            outer.startSyncImmediate()
        }
      })
      const stopSource = source.on(`status:change`, ({ status }) => {
        if (status === cleanupAt && !reached) {
          reached = true
          pending = outer.cleanup()
        }
      })
      try {
        if (reader === `ordinary`)
          subscription = outer.subscribeChanges(() => {})
        else if (reader === `resumed`) subscription!.resumeDeferredAcquisition()
        else source.startSyncImmediate()
        expect(reached, `source startup reached cleanup`).toBe(true)
        await pending
        if (!restartFromCleanup) {
          expect(outer.status, `cleanup must not retry admission`).toBe(
            `cleaned-up`,
          )
          expect(retiredStatuses).toEqual([`cleaned-up`])
        } else {
          expect(retiredStatuses[0]).toBe(`cleaned-up`)
          expect(
            retiredStatuses.filter((status) => status === `loading`),
          ).toHaveLength(1)
        }
        expect(outer.subscriberCount).toBe(expected.acquiring)
        stopSource()
        stopTarget()
        outer.startSyncImmediate()
        await settle()
        expect(counts.acquisitions > 0, `replacement has acquisition`).toBe(
          expected.acquires,
        )
        expect(outer.status === `ready`, `replacement readiness`).toBe(
          expected.ready,
        )
        expect(outer.toArray.map((row) => row.id)).toEqual(
          expected.ready ? EXPECTED_IDS[shape] : [],
        )
        expect(outer.subscriberCount).toBe(expected.acquiring)
      } finally {
        stopSource()
        stopTarget()
        subscription?.unsubscribe()
        for (const collection of collections) await collection.cleanup()
        await source.cleanup()
      }
    },
  )
})

/**
 * Source errors remain readable through a handoff that did not throw. This
 * extends the primary demand oracle at its previously omitted failure cut.
 * The grammar crosses callback return/throw, independent/owned start, and an
 * optional error cause. Removing timing confuses another reader's failure
 * with ours; removing outcome confuses fail() (a loading error, status
 * `error`) with a throwing sync function (a crash, status `crashed`). An
 * independent reader's earlier start can leave either status before the
 * release, so both are declared reach states. No second start
 * without cleanup is legal. The shared judgment also feeds the React driver.
 */
describe(`render sync-start handoff error provenance`, () => {
  for (const campaign of [`fixed`, `random`] as const) {
    it(`reports only its own thrown starts (${campaign})`, async () => {
      const reach = createOracleReach(`start-handoff`, [
        `prior-error`,
        `prior-crash`,
        `failed`,
        `own-throw`,
        `undefined-cause`,
        `healthy`,
      ])
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            outcome: fc.constantFrom(
              `ready` as const,
              `fail` as const,
              `throw` as const,
            ),
            timing: fc.constantFrom(
              `before-release` as const,
              `during-release` as const,
            ),
            cause: fc.constantFrom(`error` as const, `undefined` as const),
          }),
          async (history) => {
            reach.beginHistory()
            const expected = expectedStartHandoff(history)
            const failure =
              history.cause === `error`
                ? new Error(`source failure`)
                : undefined
            let starts = 0
            const source = createCollection<{ id: string }>({
              getKey: (row) => row.id,
              gcTime: 0,
              sync: {
                sync: ({ markReady, fail }) => {
                  starts++
                  if (history.outcome === `throw`) throw failure
                  if (history.outcome === `fail`) fail(failure)
                  else markReady()
                },
              },
            })
            source._deferSyncStart()
            source.startSyncImmediate()
            try {
              if (history.timing === `before-release`) {
                try {
                  source._resumeSyncStart()
                } catch {
                  /* Independent reader owns this error. */
                }
              }
              if (source.status === `error`) reach.reach(`prior-error`)
              if (source.status === `crashed`) reach.reach(`prior-crash`)
              if (history.outcome === `fail`) reach.reach(`failed`)
              if (expected.throws) reach.reach(`own-throw`)
              if (history.cause === `undefined`) reach.reach(`undefined-cause`)
              if (history.outcome === `ready`) reach.reach(`healthy`)
              const pending = new Set([source])
              let result: { threw: boolean; error?: unknown } = { threw: false }
              try {
                resumeDeferredLiveQueryCollections(pending)
              } catch (error) {
                result = { threw: true, error }
              }
              expect(result.threw, JSON.stringify(history)).toBe(
                expected.throws,
              )
              if (expected.throws) expect(result.error).toBe(failure)
              expect(source.status).toBe(expected.status)
              expect(starts).toBe(expected.starts)
              expect(pending.size).toBe(0)
              resumeDeferredLiveQueryCollections(pending)
              source._resumeSyncStart()
              expect(starts, `old render handles never retry`).toBe(1)
            } finally {
              await source.cleanup()
            }
          },
        ),
        campaign === `fixed`
          ? { numRuns: oracleRuns(100), seed: 2229 }
          : oraclePropertyOptions(100, `live-query.start-handoff`),
      )
      reach.assertReached()
      console.info(
        `start-handoff ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
})
