import { fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter.js'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  concat,
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { oracleProperty } from '../oracle-config.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import { registerIncludesProperty } from './includes-registration-oracle.js'
import {
  assertDeleteIdentityEvents,
  assertFacadeRootSnapshots,
  assertRetiredFacade,
  createControlledCollection,
  expectedMaterializations,
} from './includes-collection-support.js'
import {
  advanceFacadeIntervals,
  checkFacadeIntervals,
  createCollectionDriver,
  projectEventValue,
  projectLive,
  recompute,
} from './includes-collection-driver-oracle.js'
import type {
  CollectionAction,
  CollectionContext,
  FacadeIntervals,
  IncludedChildCollection,
  MetadataFacade,
  ParentEvent,
  ProjectedParent,
} from './includes-collection-driver-oracle.js'
import type { Collection } from '../../src/collection/index.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { SyncConfig } from '../../src/types.js'
import type {
  ChildRow,
  DeleteIdentityObservation,
  FacadeRootSnapshot,
  ParentRow,
} from './includes-collection-support.js'

/**
 * # What does a Collection-valued include promise?
 *
 * Authority: `packages/db/src/query/live/ARCHITECTURE.md`, especially nested
 * materialization and coherent publication. This oracle checks the public
 * Collection facade and its callbacks at startup, after each source write,
 * and at held truncate-replay and ordered-repair publication cuts.
 *
 * A bare child query materializes as a public Collection facade. That facade
 * has lifecycle and identity rules that inline arrays do not have:
 *
 * 1. Parents routed to the same active bucket share one facade.
 * 2. Child changes update the facade without forcing a parent value change.
 * 3. Moving a parent route gives it the destination bucket's facade.
 * 4. A held facade becomes empty and ready when its last route retires.
 * 5. A later active interval gets a new facade instead of retargeting the old
 *    facade.
 *
 * The main Map model recomputes parent rows and ordered children after each
 * generated action. It compares the bare Collection form with its `toArray`
 * and `materialize` siblings. It also derives expected parent events from the prior
 * and current model rows. Specialized models check facade sharing, retirement,
 * reactivation, event identity, optimistic settlement, and callback-time root
 * snapshots.
 *
 * The history grammar varies parent and child writes, route movement, shared
 * buckets, dormant buckets, ordering, parent-dependent filters, and joins. It
 * also varies optimistic confirmation and rollback. A bounded exhaustive
 * campaign covers every two-step history in the smallest relationship domain.
 * Random histories add longer combinations and shrink failures.
 *
 * The Map model stores current source Collection rows. It combines all D2
 * relation, route, and bucket state into the public result recomputation; it
 * does not model acquisition ownership or publication scheduling. Callback
 * snapshots and change messages are separate public observations.
 *
 * Grammar controls: the fixed route-retirement, dormant-bucket, shared-bucket,
 * and child-order witnesses reconstruct the key relationship histories. The
 * generated action grammar needs both parent and child writes: removing either
 * loses route transitions or child-only facade changes. Its IDs (parents 0–3,
 * children 10–14), groups (-3–3), values (-5–5), and 1–16 actions are bounded;
 * the bounded exhaustive campaign includes empty initial relations and zero actions. A
 * repeated key becomes an update, so the grammar rejects a duplicate insert.
 * The public-key grammar crosses one-digit and two-digit IDs to expose lexical
 * sorting; allowing equal IDs would collapse the two-row premise. The order
 * grammar uses adjacent swaps among 2–8 rows; a one-row case cannot move. The
 * optimistic grammar uses group/value -10–10 and disjoint IDs 10–100/101–200.
 * Its rollback and confirmation steps distinguish temporary from retained
 * child rows; a delete of an absent child is excluded.
 *
 * Known omissions: the controlled source does not prove real-provider
 * cancellation or ordering. The ordered-repair witness runs a finite root
 * request in a child live-query Collection and observes its parent include
 * facade at a controlled acquisition boundary. Arbitrary nested facade histories,
 * concurrent optimistic writes during a hold, and cross-framework callback
 * scheduling remain outside this owner.
 */

type SampleOf<T> = T extends fc.Arbitrary<infer TValue> ? TValue : never

type CollectionObservation = {
  rows: Array<ProjectedParent>
  publications: Array<Array<ProjectedParent>>
  events: Array<ParentEvent>
}

function diffParents(
  before: Array<ProjectedParent>,
  after: Array<ProjectedParent>,
): Array<ParentEvent> {
  const prior = new Map(before.map((row) => [row.id, projectEventValue(row)]))
  const next = new Map(after.map((row) => [row.id, projectEventValue(row)]))
  const result: Array<ParentEvent> = []
  for (const key of new Set([...prior.keys(), ...next.keys()])) {
    const oldValue = prior.get(key)
    const value = next.get(key)
    if (!value) result.push({ type: `delete`, key, value: oldValue! })
    else if (!oldValue) result.push({ type: `insert`, key, value })
    else if (JSON.stringify(oldValue) !== JSON.stringify(value))
      result.push({ type: `update`, key, value, previousValue: oldValue })
  }
  return result.sort((a, b) => Number(a.key) - Number(b.key))
}

type OptimisticAction =
  | { type: `insert`; row: ChildRow; settlement: `confirm` | `rollback` }
  | { type: `delete`; id: number; settlement: `confirm` | `rollback` }

type PendingOptimisticMutation = {
  transaction: ReturnType<Collection<ChildRow>[`insert`]>
  syncReleased: boolean
  receipt: Promise<void>
}

function createOptimisticCollectionDriver(
  group: number,
  initialChildren: ReadonlyArray<ChildRow> = [],
) {
  const pending = new Set<PendingOptimisticMutation>()
  const track = (transaction: PendingOptimisticMutation[`transaction`]) => {
    const entry: PendingOptimisticMutation = {
      transaction,
      syncReleased: false,
      receipt: Promise.resolve(),
    }
    pending.add(entry)
    // Observe both outcomes before the first fallible optimistic checkpoint.
    entry.receipt = transaction.when(`settled`).then(
      () => {
        pending.delete(entry)
      },
      () => {
        pending.delete(entry)
      },
    )
    return entry
  }
  const base = createCollectionDriver([{ id: 1, group }], initialChildren)
  const driver: TraceDriver<OptimisticAction, CollectionContext> = {
    ...base,
    async apply(action, context, checkpoint) {
      context.publications = []
      context.events = []
      context.before = recompute(context)
      if (action.type === `insert`) {
        const transaction = context.children.collection.insert({
          ...action.row,
        })
        const pendingMutation = track(transaction)
        context.model.children.set(action.row.id, { ...action.row })
        checkpoint()
        context.publications = []
        context.events = []
        context.before = recompute(context)
        if (action.settlement === `confirm`) {
          context.children.write(`insert`, action.row)
          pendingMutation.syncReleased = true
          context.children.resolveSync()
          await transaction.when(`settled`)
        } else {
          context.model.children.delete(action.row.id)
          const message = `rollback insert`
          const persisted = transaction.when(`settled`).catch(() => undefined)
          await withExpectedRejection(message, async () => {
            pendingMutation.syncReleased = true
            context.children.rejectSync(new Error(message))
            await persisted
            await flushPromises()
          })
        }
        return
      }

      const previous = context.model.children.get(action.id)
      if (!previous) throw new Error(`Missing optimistic delete row`)
      const transaction = context.children.collection.delete(action.id)
      const pendingMutation = track(transaction)
      context.model.children.delete(action.id)
      checkpoint()
      context.publications = []
      context.events = []
      context.before = recompute(context)
      if (action.settlement === `confirm`) {
        context.children.write(`delete`, previous)
        pendingMutation.syncReleased = true
        context.children.resolveSync()
        await transaction.when(`settled`)
      } else {
        context.model.children.set(action.id, previous)
        const message = `rollback delete`
        const persisted = transaction.when(`settled`).catch(() => undefined)
        await withExpectedRejection(message, async () => {
          pendingMutation.syncReleased = true
          context.children.rejectSync(new Error(message))
          await persisted
          await flushPromises()
        })
      }
    },
    async cleanup(context) {
      const errors: Array<unknown> = []
      const receipts = [...pending].map((entry) => entry.receipt)
      const attempt = (work: () => void) => {
        try {
          work()
        } catch (error) {
          errors.push(error)
        }
      }
      for (const entry of pending) {
        if (
          entry.transaction.state !== `completed` &&
          entry.transaction.state !== `failed`
        )
          attempt(() => {
            entry.transaction.rollback()
          })
        if (!entry.syncReleased)
          attempt(() => {
            entry.syncReleased = true
            context.children.resolveSync()
          })
      }
      // A failed rollback/release may leave a receipt unresolved. Keep that failure
      // and still dispose every resource instead of hanging before disposal.
      if (errors.length === 0) await Promise.all(receipts)
      attempt(() => context.subscription?.unsubscribe())
      const results = await Promise.allSettled(
        [
          () => context.live.cleanup(),
          () => context.parents.collection.cleanup(),
          () => context.children.collection.cleanup(),
        ].map(async (cleanup) => {
          await cleanup()
        }),
      )
      for (const result of results)
        if (result.status === `rejected`) errors.push(result.reason as unknown)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw new AggregateError(errors, `Optimistic oracle cleanup failed`)
    },
  }
  return { driver, pending }
}

const collectionProjection: TraceProjection<
  CollectionContext,
  CollectionObservation
> = {
  // Keep final reads, callback-time publications, and event payloads separate.
  // A later repair of one channel cannot hide an earlier disagreement.
  observe: (context) => ({
    rows: projectLive(context.live),
    publications: context.publications,
    events: context.events,
  }),
  recompute: (context) => {
    const rows = recompute(context)
    return {
      rows,
      publications: context.publications.map(() => rows),
      events: diffParents(context.before, rows),
    }
  },
  assertEqual(observed, expected) {
    oracleAssertion('includes collection-oracle.property comparison 306', () =>
      expect(observed.rows).toEqual(expected.rows),
    )
    oracleAssertion('includes collection-oracle.property comparison 307', () =>
      expect(observed.publications).toEqual(expected.publications),
    )
    // The mixed fixture has array/materialized siblings, so user-value changes
    // require root events. Separate tests cover bare-facade identity. Do not
    // prohibit metadata-only events for otherwise unchanged rows here.
    const changedKeys = new Set(expected.events.map((event) => event.key))
    oracleAssertion('includes collection-oracle.property comparison 312', () =>
      expect(
        observed.events
          .filter((event) => changedKeys.has(event.key))
          .sort((a, b) => Number(a.key) - Number(b.key)),
      ).toEqual(expected.events),
    )
    return undefined
  },
}

// The layout that a source Map of ordered children implies: the rows in rank
// order, with only id and value, because the facade row omits rank. Ties on
// rank are not generated in these histories, so the order is total.
function expectedOrderedRows(
  sourceRows: ReadonlyMap<number, { id: number; rank: number; value: string }>,
) {
  return [...sourceRows.values()]
    .sort((left, right) => left.rank - right.rank)
    .map(({ id, value }) => ({ id, value }))
}

const actionArbitrary: fc.Arbitrary<CollectionAction> = fc.oneof(
  fc.record({
    type: fc.constant(`putParent` as const),
    row: fc.record({
      id: fc.integer({ min: 0, max: 3 }),
      group: fc.integer({ min: -3, max: 3 }),
    }),
  }),
  fc.record({
    type: fc.constant(`deleteParent` as const),
    id: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant(`putChild` as const),
    row: fc.record({
      id: fc.integer({ min: 10, max: 14 }),
      parentGroup: fc.integer({ min: -3, max: 3 }),
      value: fc.integer({ min: -5, max: 5 }),
    }),
  }),
  fc.record({
    type: fc.constant(`deleteChild` as const),
    id: fc.integer({ min: 10, max: 14 }),
  }),
)

const collectionScenarioArbitrary = fc.record({
  parentGroup: fc.integer({ min: -3, max: 3 }),
  childValue: fc.integer({ min: -5, max: 5 }),
  actions: fc.array(actionArbitrary, { minLength: 1, maxLength: 16 }),
})

const orderSwapArbitrary = fc.integer({ min: 2, max: 8 }).chain((length) =>
  fc.integer({ min: 0, max: length - 2 }).map((swapIndex) => ({
    length,
    swapIndex,
  })),
)

const publicKeyOrderArbitrary = fc.record({
  smallId: fc.integer({ min: 2, max: 9 }),
  wideId: fc.integer({ min: 10, max: 19 }),
})

const optimisticChildArbitrary = fc.record({
  group: fc.integer({ min: -10, max: 10 }),
  insertedId: fc.integer({ min: 10, max: 100 }),
  confirmedId: fc.integer({ min: 101, max: 200 }),
  value: fc.integer({ min: -10, max: 10 }),
})

// Enumeration proves the small finite domain. The generated campaign explores
// longer histories over a wider value domain. Neither replaces the other.
function enumerateActionSequences(
  actions: ReadonlyArray<CollectionAction>,
  maxLength: number,
): Array<Array<CollectionAction>> {
  const sequences: Array<Array<CollectionAction>> = [[]]
  let frontier: Array<Array<CollectionAction>> = [[]]
  for (let length = 1; length <= maxLength; length++) {
    frontier = frontier.flatMap((prefix) =>
      actions.map((action) => [...prefix, action]),
    )
    sequences.push(...frontier)
  }
  return sequences
}

const exhaustiveActions: ReadonlyArray<CollectionAction> = [
  { type: `putParent`, row: { id: 0, group: 0 } },
  { type: `putParent`, row: { id: 0, group: 1 } },
  { type: `deleteParent`, id: 0 },
  { type: `putChild`, row: { id: 10, parentGroup: 0, value: 0 } },
  { type: `putChild`, row: { id: 10, parentGroup: 1, value: 1 } },
  { type: `deleteChild`, id: 10 },
]

const relationshipProperty = `includes-collection.relationship-history`

const publicKeyOrderProperty = `includes-collection.public-key-order`

const layoutSwapProperty = `includes-collection.layout-swap`

const optimisticChildProperty = `includes-collection.optimistic-child-history`

const retiredHeldFacadeLaw = `Retiring a route leaves a facade that a holder still references empty and ready, with no later events.`
const deleteFacadeIdentityLaw = `A delete event carries the facade identity that the deleted parent published.`
const facadeApplicationFailureLaw = `A failed facade application restores every facade it wrote and publishes no partial state or event.`
const facadeRootPublicationLaw = `Facade events observe the root publication they belong to.`
const sharedFacadeRetirementLaw = `A shared facade stays active until its last parent route departs.`
const heldTruncateReorderLaw = `A held child truncate replay publishes the final reorder through the facade once, against the last public snapshot.`
const fixedRelationshipLaw = `Collection, toArray, and materialize results match the recomputed relationship model after every source change.`
const exhaustiveLaw = `Every two-step history in the smallest relationship domain keeps Collection, toArray, and materialize equivalent to the recomputed model.`
const checkpointFailureLaw = `An optimistic insert or delete that fails at a checkpoint rolls back once, leaves no pending work, cleans up every Collection, and keeps a rollback failure as a suppressed error.`
const heldOrderedRepairLaw = `A held ordered child repair publishes the final child row through the facade once, against the last public snapshot.`
const rootEventObservationLaw = `Root event observations match the recomputed changed-row events exactly: a missing, repeated, or corrupt event is a comparison failure.`
const rollbackRetainedChildLaw = `After an optimistic child insert rolls back, the published child rows match the recomputation without it.`

// Named fixed relationship histories, replayed through the shared Collection
// driver and recomputation.
const fixedRelationshipHistories: Array<{
  name: string
  parents: Array<ParentRow>
  children: Array<ChildRow>
  reuseChildRelation: boolean
  steps: Array<CollectionAction>
}> = [
  {
    name: `publishes independently compiled equivalent child relations coherently`,
    parents: [{ id: 0, group: 0 }],
    children: [{ id: 10, parentGroup: 0, value: 0 }],
    reuseChildRelation: false,
    steps: [{ type: `deleteChild`, id: 10 }],
  },
  {
    name: `replays a dormant bucket when its first parent route activates`,
    parents: [],
    children: [{ id: 10, parentGroup: 7, value: 1 }],
    reuseChildRelation: true,
    steps: [{ type: `putParent`, row: { id: 1, group: 7 } }],
  },
  {
    name: `reactivating a retired route restores its current snapshot`,
    parents: [{ id: 1, group: 1 }],
    children: [
      { id: 10, parentGroup: 1, value: 1 },
      { id: 20, parentGroup: 2, value: 2 },
    ],
    reuseChildRelation: true,
    steps: [
      { type: `putParent`, row: { id: 1, group: 2 } },
      { type: `putParent`, row: { id: 1, group: 1 } },
    ],
  },
]

// The exhaustive two-step domain: every initial state crossed with every action
// sequence of length 0..2 over the six exhaustive actions. Each pair is one
// enumerated history, judged by the same trace driver and recomputation.
const exhaustiveInitialStates = [
  { parents: [] as Array<ParentRow>, children: [] as Array<ChildRow> },
  { parents: [{ id: 0, group: 0 }], children: [] as Array<ChildRow> },
  {
    parents: [] as Array<ParentRow>,
    children: [{ id: 10, parentGroup: 0, value: 0 }],
  },
  {
    parents: [{ id: 0, group: 0 }],
    children: [{ id: 10, parentGroup: 0, value: 0 }],
  },
]
const exhaustiveHistories = exhaustiveInitialStates.flatMap((initial) =>
  enumerateActionSequences(exhaustiveActions, 2).map((steps) => ({
    initial,
    steps,
  })),
)

// The production half of the former root-event calibration: one child value
// update, whose observation the shared comparison accepts, with one event.
async function observeChildValueUpdate(
  inspect: (
    observed: CollectionObservation,
    expected: CollectionObservation,
  ) => void,
): Promise<void> {
  const driver = createCollectionDriver(
    [{ id: 1, group: 1 }],
    [{ id: 10, parentGroup: 1, value: 1 }],
  )
  const context = await driver.setup()
  try {
    await driver.start?.(context)
    await driver.apply(
      { type: `putChild`, row: { id: 10, parentGroup: 1, value: 2 } },
      context,
      () => undefined,
    )
    const observed = collectionProjection.observe(context)
    const expected = collectionProjection.recompute(context)
    collectionProjection.assertEqual(observed, expected)
    expect(expected.events).toHaveLength(1)
    inspect(observed, expected)
  } finally {
    await driver.cleanup(context)
  }
}

const rootEventFaults = [
  `missing`,
  `duplicate`,
  `value`,
  `previousValue`,
  `type`,
] as const

// The production half of the former rollback calibration: an optimistic
// child insert that rolls back, whose observation the shared comparison
// accepts.
async function observeRolledBackChild(
  inspect: (
    observed: CollectionObservation,
    expected: CollectionObservation,
    row: ChildRow,
  ) => void,
): Promise<void> {
  const row = { id: 10, parentGroup: 1, value: 2 }
  const { driver } = createOptimisticCollectionDriver(1)
  const context = await driver.setup()
  await withHistoryCleanup(
    async () => {
      await driver.start?.(context)
      await driver.apply(
        { type: `insert`, row, settlement: `rollback` },
        context,
        () => undefined,
      )
      const observed = collectionProjection.observe(context)
      const expected = collectionProjection.recompute(context)
      collectionProjection.assertEqual(observed, expected)
      inspect(observed, expected, row)
    },
    () => [() => driver.cleanup(context)],
  )
}

// The former fixed-history body, unchanged.
async function judgeRetiredHeldFacade(): Promise<void> {
  let retiredFacade: IncludedChildCollection | undefined
  const heldSnapshots: Array<{
    status: string | undefined
    rows: Array<ChildRow> | undefined
  }> = []
  const driver = createCollectionDriver(
    [{ id: 1, group: 1 }],
    [{ id: 10, parentGroup: 1, value: 1 }],
  )
  const lifecycleDriver: TraceDriver<CollectionAction, CollectionContext> = {
    ...driver,
    apply(action, context, checkpoint) {
      retiredFacade ??= context.live.get(1)?.children
      expect(retiredFacade).toBeDefined()
      checkpoint()
      return driver.apply(action, context, checkpoint)
    },
  }
  const projection: TraceProjection<
    CollectionContext,
    {
      rows: Array<ProjectedParent>
      held: { status: string | undefined; rows: Array<ChildRow> | undefined }
    }
  > = {
    observe: (context) => {
      const held = {
        status: retiredFacade?.status,
        rows: retiredFacade?.toArray.map(({ id, parentGroup, value }) => ({
          id,
          parentGroup,
          value,
        })),
      }
      heldSnapshots.push(held)
      return { rows: projectLive(context.live), held }
    },
    recompute: (context) => ({
      rows: recompute(context),
      held: retiredFacade
        ? {
            status: `ready`,
            rows:
              context.model.parents.size === 0
                ? []
                : [{ id: 10, parentGroup: 1, value: 1 }],
          }
        : { status: undefined, rows: undefined },
    }),
    assertEqual(observed, expected) {
      expect(observed).toEqual(expected)
      return undefined
    },
  }

  await runTrace({
    steps: [{ type: `deleteParent`, id: 1 }],
    driver: lifecycleDriver,
    projection,
  })

  expect(heldSnapshots).toHaveLength(3)
  expect(heldSnapshots[1]).toEqual({
    status: `ready`,
    rows: [{ id: 10, parentGroup: 1, value: 1 }],
  })
  assertRetiredFacade(heldSnapshots[2]!)
  expect(retiredFacade?.toArray).toEqual([])
  await expect(retiredFacade?.preload()).resolves.toBeUndefined()
}

// The former fixed-history body, unchanged.
async function judgeDeleteFacadeIdentity(): Promise<void> {
  let publishedFacade: IncludedChildCollection | undefined
  const events: Array<DeleteIdentityObservation> = []
  const eventSnapshots: Array<Array<DeleteIdentityObservation>> = []
  let identitySubscription: { unsubscribe: () => void } | undefined
  const driver = createCollectionDriver(
    [{ id: 1, group: 1 }],
    [{ id: 10, parentGroup: 1, value: 1 }],
  )
  const eventDriver: TraceDriver<CollectionAction, CollectionContext> = {
    ...driver,
    async start(context) {
      await driver.start?.(context)
      publishedFacade = context.live.get(1)?.children
      expect(publishedFacade).toBeDefined()
      identitySubscription = context.live.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            events.push({
              type: change.type,
              key: change.key,
              id: change.value.id,
              matchesPublishedFacade: change.value.children === publishedFacade,
            })
          }
        },
        { includeInitialState: false },
      )
    },
    async cleanup(context) {
      try {
        identitySubscription?.unsubscribe()
      } finally {
        await driver.cleanup(context)
      }
    },
  }
  const projection: TraceProjection<
    CollectionContext,
    Array<DeleteIdentityObservation>,
    boolean
  > = {
    observe: () => {
      const snapshot = events.map((event) => ({ ...event }))
      eventSnapshots.push(snapshot)
      return snapshot
    },
    recompute: (context) => !context.model.parents.has(1),
    assertEqual(observed, expected) {
      assertDeleteIdentityEvents(observed, expected)
      return undefined
    },
  }

  await runTrace({
    steps: [{ type: `deleteParent`, id: 1 }],
    driver: eventDriver,
    projection,
  })
  expect(eventSnapshots).toHaveLength(2)
  assertDeleteIdentityEvents(eventSnapshots[0]!, false)
  assertDeleteIdentityEvents(eventSnapshots[1]!, true)
}

// The former fixed-history body, unchanged.
async function judgeFacadeApplicationFailure(): Promise<void> {
  const driver = createCollectionDriver(
    [{ id: 1, group: 1 }],
    [
      { id: 10, parentGroup: 1, value: 1 },
      { id: 20, parentGroup: 1, value: 2 },
    ],
  )
  const context = await driver.setup()
  await driver.start?.(context)
  const facade = context.live.get(1)!.children
  const changes: Array<unknown> = []
  const subscription = facade.subscribeChanges(
    (batch) => changes.push(...batch),
    { includeInitialState: false },
  )
  const originalGetKey = facade.config.getKey
  facade.config.getKey = (row) => {
    if (row.id === 20) throw new Error(`facade key failed`)
    return originalGetKey(row)
  }

  try {
    expect(() =>
      context.children.writeBatch([
        {
          type: `update`,
          value: { id: 10, parentGroup: 1, value: 10 },
        },
        {
          type: `update`,
          value: { id: 20, parentGroup: 1, value: 20 },
        },
      ]),
    ).toThrow(`facade key failed`)
    expect(projectLive(context.live)).toEqual([
      {
        id: 1,
        group: 1,
        childrenReady: true,
        children: [
          { id: 10, parentGroup: 1, value: 1 },
          { id: 20, parentGroup: 1, value: 2 },
        ],
        arrayChildren: [
          { id: 10, parentGroup: 1, value: 1 },
          { id: 20, parentGroup: 1, value: 2 },
        ],
        materializedChildren: [
          { id: 10, parentGroup: 1, value: 1 },
          { id: 20, parentGroup: 1, value: 2 },
        ],
      },
    ])
    expect(changes).toEqual([])

    facade.config.getKey = originalGetKey
    context.parents.write(`insert`, { id: 2, group: 2 })
    await flushPromises()
    expect(context.live.get(1)!.children).toBe(facade)
    expect(projectLive(context.live)[0]!.children).toEqual([
      { id: 10, parentGroup: 1, value: 10 },
      { id: 20, parentGroup: 1, value: 20 },
    ])
    expect(changes).toHaveLength(2)
  } finally {
    facade.config.getKey = originalGetKey
    subscription.unsubscribe()
    await driver.cleanup(context)
  }
}

// The former fixed-history body, unchanged.
async function judgeFacadeRootPublication(): Promise<void> {
  const driver = createCollectionDriver(
    [{ id: 1, group: 1 }],
    [
      { id: 10, parentGroup: 1, value: 1 },
      { id: 20, parentGroup: 2, value: 2 },
    ],
  )
  const context = await driver.setup()
  await driver.start?.(context)
  const oldFacade = context.live.get(1)!.children
  const callbackSnapshots: Array<FacadeRootSnapshot> = []
  const subscription = oldFacade.subscribeChanges(
    () => {
      const current = context.live.get(1)
      callbackSnapshots.push({
        group: current?.group,
        usesOldFacade: current?.children === oldFacade,
        rows: current ? [...current.children.keys()] : [],
      })
    },
    { includeInitialState: false },
  )

  try {
    context.parents.write(`update`, { id: 1, group: 2 })
    assertFacadeRootSnapshots(callbackSnapshots)
  } finally {
    subscription.unsubscribe()
    await driver.cleanup(context)
  }
}

// The former fixed-history body, unchanged.
async function judgeSharedFacadeRetirement(): Promise<void> {
  const driver = createCollectionDriver(
    [
      { id: 1, group: 1 },
      { id: 2, group: 1 },
    ],
    [{ id: 10, parentGroup: 1, value: 1 }],
  )
  const context = await driver.setup()
  await driver.start?.(context)
  const sharedFacade = context.live.get(1)!.children
  let intervals: FacadeIntervals<number> = { active: new Map(), next: 0 }
  const observedIntervals = new Map<number, MetadataFacade>()
  const checkIntervals = (groups: ReadonlyArray<number>) => {
    intervals = advanceFacadeIntervals(intervals, groups)
    checkFacadeIntervals(
      intervals,
      context.live.toArray.map((row) => ({
        group: row.group,
        facade: row.children,
      })),
      observedIntervals,
    )
  }

  try {
    checkIntervals([1, 1])
    expect(context.live.get(2)!.children).toBe(sharedFacade)
    context.parents.write(`delete`, { id: 1, group: 1 })
    checkIntervals([1])
    expect(context.live.get(2)!.children).toBe(sharedFacade)
    expect([...sharedFacade.keys()]).toEqual([10])
    expect(sharedFacade.status).toBe(`ready`)

    context.parents.write(`delete`, { id: 2, group: 1 })
    checkIntervals([])
    expect(context.live.toArray).toEqual([])
    expect(sharedFacade.toArray).toEqual([])
    expect(sharedFacade.status).toBe(`ready`)

    context.children.write(`insert`, { id: 20, parentGroup: 1, value: 2 })
    checkIntervals([])
    expect(context.live.toArray).toEqual([])
    expect(sharedFacade.toArray).toEqual([])
    expect(sharedFacade.status).toBe(`ready`)

    context.parents.write(`insert`, { id: 1, group: 1 })
    checkIntervals([1])
    const reactivated = context.live.get(1)!.children
    expect(reactivated).not.toBe(sharedFacade)
    const assertCurrent = (value: number) => {
      checkIntervals([1])
      const rows = [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value },
      ]
      expect(projectLive(context.live)).toEqual([
        {
          id: 1,
          group: 1,
          childrenReady: true,
          children: rows,
          arrayChildren: rows,
          materializedChildren: rows,
        },
      ])
      expect(context.live.get(1)!.children).toBe(reactivated)
      expect(sharedFacade.toArray).toEqual([])
      expect(sharedFacade.status).toBe(`ready`)
    }
    assertCurrent(2)
    context.children.write(`update`, { id: 20, parentGroup: 1, value: 3 })
    assertCurrent(3)
  } finally {
    await driver.cleanup(context)
  }
}

// The former fixed-history body, unchanged.
async function judgeHeldTruncateReorder(): Promise<void> {
  type OrderedChild = {
    id: number
    parentGroup: number
    rank: number
    value: string
  }
  const sourceRows = new Map<number, OrderedChild>([
    [10, { id: 10, parentGroup: 1, rank: 1, value: `A` }],
    [20, { id: 20, parentGroup: 1, rank: 2, value: `X` }],
  ])
  // Rank is absent from the facade row but retained in this source model:
  // two otherwise equal rows with different ranks yield different layouts.
  // The provider receives copies, so it cannot mutate the expected rows.
  const expectedRows = () => expectedOrderedRows(sourceRows)

  let sync!: Parameters<SyncConfig<OrderedChild, number>[`sync`]>[0]
  let holdReplay = false
  const held: Array<() => void> = []
  let requests = 0
  const children = createCollection<OrderedChild, number>({
    id: `held-child-facade-replay`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: () => {
            requests++
            if (requests <= 2) {
              sync.begin()
              for (const row of sourceRows.values()) {
                sync.write({ type: `insert`, value: { ...row } })
              }
              expect(sync.commit()).toBe(true)
            }
            return holdReplay
              ? new Promise<void>((resolve) => held.push(resolve))
              : true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const parents = createControlledCollection(`held-child-facade-parent`, [
    { id: 1, group: 1 },
  ])
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      children: include(
        q
          .from({ child: children })
          .where(({ child }) => eq(child.parentGroup, parent.group))
          .orderBy(({ child }) => child.rank)
          .limit(2)
          .select(({ child }) => ({ id: child.id, value: child.value })),
      ),
    })),
  )
  const callbacks: Array<{
    rows: Array<{ id: number; value: string }>
    changes: Array<{ type: string; key: string | number }>
  }> = []
  const rootCallbacks: Array<unknown> = []
  let unsubscribeFacade: (() => void) | undefined
  let unsubscribeRoot: (() => void) | undefined

  await withHistoryCleanup(
    async () => {
      await live.preload()
      const facade = live.get(1)!.children
      const before = expectedRows()
      expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual(
        before,
      )
      const facadeSubscription = facade.subscribeChanges(
        (changes) => {
          callbacks.push({
            rows: facade.toArray.map(({ id, value }) => ({ id, value })),
            changes: changes.map(({ type, key }) => ({ type, key })),
          })
        },
        { includeInitialState: false },
      )
      unsubscribeFacade = () => facadeSubscription.unsubscribe()
      const rootSubscription = live.subscribeChanges(
        (changes) => rootCallbacks.push(...changes),
        { includeInitialState: false },
      )
      unsubscribeRoot = () => rootSubscription.unsubscribe()

      holdReplay = true
      sync.begin()
      sync.truncate()
      expect(sync.commit()).toBe(true)
      await flushPromises()
      expect(requests).toBe(2)
      expect(held.length).toBeGreaterThan(0)
      const write = (row: OrderedChild) => {
        sourceRows.set(row.id, { ...row })
        sync.begin()
        sync.write({ type: `update`, value: { ...row } })
        expect(sync.commit()).toBe(true)
      }
      write({ id: 10, parentGroup: 1, rank: 2.5, value: `A` })
      write({ id: 10, parentGroup: 1, rank: 2.5, value: `B` })
      write({ id: 10, parentGroup: 1, rank: 2.5, value: `A` })
      await flushPromises()
      expect(held.length).toBeGreaterThan(0)
      expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual(
        before,
      )
      expect(callbacks).toEqual([])

      holdReplay = false
      for (const release of held.splice(0)) release()
      await flushPromises()
      const after = expectedRows()
      expect(live.get(1)!.children).toBe(facade)
      expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual(
        after,
      )
      const expectedCallbacks = [{ rows: after, changes: [] }]
      expect(callbacks).toEqual(expectedCallbacks)
      // A facade that omits its layout callback would pass the final read.
      expect(() =>
        expect(callbacks.slice(1)).toEqual(expectedCallbacks),
      ).toThrow()
      expect(rootCallbacks).toEqual([])
    },
    () => [
      () => {
        holdReplay = false
        for (const release of held.splice(0)) release()
      },
      () => unsubscribeFacade?.(),
      () => unsubscribeRoot?.(),
      () => live.cleanup(),
      () => parents.collection.cleanup(),
      () => children.cleanup(),
    ],
  )
}

// The former case body, unchanged, for one action kind and rollback outcome.
async function judgeCheckpointFailureSettlement(
  kind: `insert` | `delete`,
  failRollback: boolean,
): Promise<void> {
  const row = { id: 10, parentGroup: 1, value: 1 }
  const { driver, pending } = createOptimisticCollectionDriver(
    1,
    kind === `delete` ? [row] : [],
  )
  const primary: Error & { suppressed?: Array<unknown> } = new Error(
    `checkpoint failed`,
  )
  const cleanupError = new Error(`rollback observer failed`)
  let transaction: PendingOptimisticMutation[`transaction`] | undefined
  let context: CollectionContext | undefined
  let rollbackCalls = 0
  const cleanupCalls: Array<string> = []
  const failureDriver: typeof driver = {
    ...driver,
    async setup() {
      context = await driver.setup()
      for (const [name, collection] of [
        [`live`, context.live],
        [`parents`, context.parents.collection],
        [`children`, context.children.collection],
      ] as const) {
        const original = collection.cleanup.bind(collection)
        collection.cleanup = async () => {
          cleanupCalls.push(name)
          await original()
        }
      }
      return context
    },
  }
  const projection: typeof collectionProjection = {
    ...collectionProjection,
    assertEqual(observed, expected) {
      collectionProjection.assertEqual(observed, expected)
      const entry = [...pending][0]
      if (entry) {
        transaction = entry.transaction
        expect(transaction.state).toBe(`persisting`)
        const rollback = transaction.rollback.bind(transaction)
        transaction.rollback = ((options) => {
          rollbackCalls++
          const result = rollback(options)
          if (failRollback) throw cleanupError
          return result
        }) as typeof transaction.rollback
        throw primary
      }
      return undefined
    },
  }
  const action: OptimisticAction =
    kind === `insert`
      ? { type: `insert`, row, settlement: `confirm` }
      : { type: `delete`, id: row.id, settlement: `confirm` }
  await expect(
    runTrace({ steps: [action], driver: failureDriver, projection }),
  ).rejects.toBe(primary)
  expect(rollbackCalls).toBe(1)
  expect(transaction?.state).toBe(`failed`)
  expect(pending.size).toBe(0)
  expect(cleanupCalls).toEqual([`live`, `parents`, `children`])
  expect(context?.live.status).toBe(`cleaned-up`)
  expect(context?.parents.collection.status).toBe(`cleaned-up`)
  expect(context?.children.collection.status).toBe(`cleaned-up`)
  expect(primary.suppressed).toEqual(failRollback ? [cleanupError] : undefined)
}

// The former case body, unchanged, for one intermediate and final value.
async function judgeHeldOrderedChildRepair(
  intermediate: string,
  final: string,
): Promise<void> {
  type OrderedChild = {
    id: number
    parentGroup: number
    rank: number
    value: string
  }
  const sourceRows = new Map<number, OrderedChild>([
    [10, { id: 10, parentGroup: 1, rank: 1, value: `A` }],
    [20, { id: 20, parentGroup: 1, rank: 2, value: `X` }],
  ])
  // This source Map is the reference model. The selected facade rows
  // omit rank, so final row equality alone cannot prove layout delivery.
  const expectedRows = () => expectedOrderedRows(sourceRows)

  let sync!: Parameters<SyncConfig<OrderedChild, number>[`sync`]>[0]
  let holdRepair = false
  const held: Array<() => void> = []
  const requests: Array<{ limit?: number; refetch?: boolean }> = []
  const children = createCollection<OrderedChild, number>({
    id: `held-child-facade-repair-${intermediate}-${final}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            requests.push({
              limit: options.limit,
              refetch: options.refetch,
            })
            if (requests.length === 1) {
              sync.begin()
              for (const row of sourceRows.values()) {
                sync.write({ type: `insert`, value: { ...row } })
              }
              expect(sync.commit()).toBe(true)
            }
            return holdRepair
              ? new Promise<void>((resolve) => held.push(resolve))
              : true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const parents = createControlledCollection(`held-child-repair-parent`, [
    { id: 1, group: 1 },
  ])
  // The finite ordered source is itself a live-query Collection. The
  // parent materializes it through a Collection-valued child include.
  const orderedChildren = createLiveQueryCollection((q) =>
    q
      .from({ child: children })
      .orderBy(({ child }) => child.rank)
      .limit(2)
      .select(({ child }) => ({
        id: child.id,
        parentGroup: child.parentGroup,
        rank: child.rank,
        value: child.value,
      })),
  )
  orderedChildren.createIndex((child) => child.parentGroup, {
    indexType: BTreeIndex,
  })
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      children: include(
        q
          .from({ child: orderedChildren })
          .where(({ child }) => eq(child.parentGroup, parent.group))
          .orderBy(({ child }) => child.rank)
          .select(({ child }) => ({ id: child.id, value: child.value })),
      ),
    })),
  )
  const callbacks: Array<{
    rows: Array<{ id: number; value: string }>
    changes: Array<{
      type: string
      key: string | number
      value?: { id: number; value: string }
      previousValue?: { id: number; value: string }
    }>
  }> = []
  const rootCallbacks: Array<unknown> = []
  let unsubscribeFacade: (() => void) | undefined
  let unsubscribeRoot: (() => void) | undefined

  await withHistoryCleanup(
    async () => {
      await live.preload()
      const facade = live.get(1)!.children
      const before = expectedRows()
      expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual(
        before,
      )
      const facadeSubscription = facade.subscribeChanges(
        (changes) => {
          callbacks.push({
            rows: facade.toArray.map(({ id, value }) => ({ id, value })),
            changes: changes.map((change) =>
              change.type === `update`
                ? {
                    type: change.type,
                    key: change.key,
                    value: {
                      id: change.value.id,
                      value: change.value.value,
                    },
                    previousValue: change.previousValue && {
                      id: change.previousValue.id,
                      value: change.previousValue.value,
                    },
                  }
                : { type: change.type, key: change.key },
            ),
          })
        },
        { includeInitialState: false },
      )
      unsubscribeFacade = () => facadeSubscription.unsubscribe()
      const rootSubscription = live.subscribeChanges(
        (changes) => rootCallbacks.push(...changes),
        { includeInitialState: false },
      )
      unsubscribeRoot = () => rootSubscription.unsubscribe()

      holdRepair = true
      const write = (value: string) => {
        const row = { id: 10, parentGroup: 1, rank: 2.5, value }
        sourceRows.set(row.id, row)
        sync.begin()
        sync.write({ type: `update`, value: { ...row } })
        expect(sync.commit()).toBe(true)
      }
      write(`A`)
      write(intermediate)
      write(final)
      await flushPromises()
      expect(held.length, JSON.stringify(requests)).toBeGreaterThan(0)
      expect(requests[0]?.limit).toBe(2)
      expect(
        requests
          .slice(1)
          .some(({ limit, refetch }) => limit === 2 && refetch === true),
      ).toBe(true)
      expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual(
        before,
      )
      expect(callbacks).toEqual([])

      holdRepair = false
      for (const release of held.splice(0)) release()
      await flushPromises()
      const after = expectedRows()
      expect(live.get(1)!.children).toBe(facade)
      expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual(
        after,
      )
      const expectedCallbacks = [
        {
          rows: after,
          changes:
            final === `A`
              ? []
              : [
                  {
                    type: `update`,
                    key: 10,
                    value: { id: 10, value: final },
                    previousValue: { id: 10, value: `A` },
                  },
                ],
        },
      ]
      expect(callbacks).toEqual(expectedCallbacks)
      // A stale facade can have correct final rows yet omit this
      // callback; the public subscription must reject that rule.
      expect(() =>
        expect(callbacks.slice(1)).toEqual(expectedCallbacks),
      ).toThrow()
      expect(rootCallbacks).toEqual([])
    },
    () => [
      () => {
        holdRepair = false
        for (const release of held.splice(0)) release()
      },
      () => unsubscribeFacade?.(),
      () => unsubscribeRoot?.(),
      () => live.cleanup(),
      () => orderedChildren.cleanup(),
      () => parents.collection.cleanup(),
      () => children.cleanup(),
    ],
  )
}

describe(`Collection-valued includes oracle`, () => {
  oracleProperty({
    id: `includes-collection.root-event-observation`,
    law: {
      statement: rootEventObservationLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One child value update and five corruptions of its observed root event.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [`publishes one changed-row event for a child value update`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(rootEventObservationLaw, plan, observe, () =>
        observeChildValueUpdate(() => undefined),
      ),
    check: forwardAssertionJudgment,
    calibrations: rootEventFaults.map((fault) => ({
      name: `root event observations reject missing, repeated, and corrupt changed-row events: ${fault}`,
      law: rootEventObservationLaw,
      // The former calibration body for one fault. Exactly the old matcher:
      // the corrupted observation keeps the expected rows and publications, and
      // only an AssertionError from the shared comparison counts as rejecting
      // it. Any other outcome fails this calibration, as it failed the old test.
      driver: (plan, observe) =>
        recordAssertionJudgment(rootEventObservationLaw, plan, observe, () =>
          observeChildValueUpdate((observed, expected) => {
            const bad = structuredClone(observed)
            const event = bad.events[0]!
            if (fault === `missing`) bad.events = []
            else if (fault === `duplicate`)
              bad.events.push(structuredClone(event))
            else if (fault === `value`)
              event.value.arrayChildren[0]!.value = -999
            else if (fault === `previousValue`)
              event.previousValue!.materializedChildren[0]!.value = -999
            else event.type = `insert`
            // The previous checker accepted all these payload/count corruptions.
            expect(bad.rows).toEqual(expected.rows)
            expect(bad.publications).toEqual(expected.publications)
            try {
              collectionProjection.assertEqual(bad, expected)
            } catch (error) {
              if (error instanceof Error && error.name === `AssertionError`)
                rejectAt(`root event ${fault}`, error)
              throw new Error(
                `the corrupted root event failed outside the expected rejection: ${String(error)}`,
              )
            }
          }),
        ),
    })),
  })

  oracleProperty({
    id: `includes-collection.checkpoint-failure`,
    law: {
      statement: checkpointFailureLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `The four enumerated insert/delete by rollback-failure cells.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: ([`insert`, `delete`] as const).flatMap((kind) =>
      [false, true].map((failRollback) => ({ kind, failRollback })),
    ),
    label: ({ kind, failRollback }) =>
      `settles ${kind} after a checkpoint failure (rollback throws=${failRollback})`,
    resolve: (cell) => ({ ...cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(checkpointFailureLaw, plan, observe, () =>
        judgeCheckpointFailureSettlement(plan.kind, plan.failRollback),
      ),
    check: forwardAssertionJudgment,
  })

  const runRelationshipHistory = ({
    parentGroup,
    childValue,
    actions,
  }: SampleOf<typeof collectionScenarioArbitrary>) =>
    runTrace({
      steps: actions,
      driver: createCollectionDriver(
        [{ id: 0, group: parentGroup }],
        [{ id: 10, parentGroup, value: childValue }],
      ),
      projection: collectionProjection,
    })

  registerIncludesProperty(
    [collectionScenarioArbitrary],
    {
      property: relationshipProperty,
      runs: 30,
      fixedSeed: 1658101,
      owns: [
        `src/collection/index.ts#createCollection`,
        `src/indexes/btree-index.ts`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
      ],
    },
    `keeps Collection, toArray, and materialize equivalent across fixed relationship histories`,
    (...args: Parameters<typeof runRelationshipHistory>) => {
      return runRelationshipHistory(...args)
    },
  )

  oracleProperty({
    id: `includes-collection.exhaustive-two-step`,
    law: {
      statement: exhaustiveLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `Every initial state of the smallest domain crossed with every zero-, one-, and two-step history over its six actions.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: exhaustiveHistories,
    label: (history) =>
      `exhaustively matches every two-step history in the smallest relationship domain: ${JSON.stringify(history)}`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(exhaustiveLaw, plan, observe, () =>
        runTrace({
          steps: plan.history.steps,
          driver: createCollectionDriver(
            plan.history.initial.parents,
            plan.history.initial.children,
          ),
          projection: collectionProjection,
        }),
      ),
    check: forwardAssertionJudgment,
  })
  oracleProperty({
    id: `includes-collection.fixed-relationship`,
    law: {
      statement: fixedRelationshipLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `Three named fixed relationship histories.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: fixedRelationshipHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(fixedRelationshipLaw, plan, observe, () =>
        runTrace({
          steps: plan.history.steps,
          driver: createCollectionDriver(
            plan.history.parents,
            plan.history.children,
            plan.history.reuseChildRelation,
          ),
          projection: collectionProjection,
        }),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-collection.retired-held-facade`,
    law: {
      statement: retiredHeldFacadeLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One fixed history over controlled source Collections.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [`retiring a route leaves a held facade empty and ready`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(retiredHeldFacadeLaw, plan, observe, () =>
        judgeRetiredHeldFacade(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-collection.delete-facade-identity`,
    law: {
      statement: deleteFacadeIdentityLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One fixed history over controlled source Collections.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [`a delete event preserves the published facade identity`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(deleteFacadeIdentityLaw, plan, observe, () =>
        judgeDeleteFacadeIdentity(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-collection.facade-application-failure`,
    law: {
      statement: facadeApplicationFailureLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One fixed history over controlled source Collections.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [
      `facade application failure leaves no partial state or publication`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(facadeApplicationFailureLaw, plan, observe, () =>
        judgeFacadeApplicationFailure(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-collection.facade-root-publication`,
    law: {
      statement: facadeRootPublicationLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One fixed history over controlled source Collections.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [`facade events observe the matching root publication`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(facadeRootPublicationLaw, plan, observe, () =>
        judgeFacadeRootPublication(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-collection.shared-facade-retirement`,
    law: {
      statement: sharedFacadeRetirementLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One fixed history over controlled source Collections.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [`shared facades remain active until their last parent departs`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(sharedFacadeRetirementLaw, plan, observe, () =>
        judgeSharedFacadeRetirement(),
      ),
    check: forwardAssertionJudgment,
  })

  const runPublicKeyOrder = async ({
    smallId,
    wideId,
  }: SampleOf<typeof publicKeyOrderArbitrary>) => {
    const parents = createControlledCollection(`ordering-oracle-parents`, [
      { id: 1, group: 1 },
    ])
    const children = createControlledCollection(`ordering-oracle-children`, [
      { id: smallId, parentGroup: 1, value: smallId },
      { id: wideId, parentGroup: 1, value: wideId },
    ])
    const live = createLiveQueryCollection((q) => {
      return q.from({ parent: parents.collection }).select(({ parent }) => {
        const childRows = () =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .select(({ child }) => ({ id: child.id, value: child.value }))

        return {
          id: parent.id,
          facade: include(childRows()),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
          first: materialize(childRows().findOne()),
          joined: concat(
            toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .select(({ child }) => child.value),
            ),
          ),
        }
      })
    })

    await withHistoryCleanup(
      async () => {
        await live.preload()
        const result = live.get(1)!
        const expectedIds = [smallId, wideId]
        const facadeIds = result.facade.toArray.map((child) => child.id)

        oracleAssertion(
          'includes collection-oracle.property comparison 1042',
          () => expect(facadeIds).toEqual(expectedIds),
        )
        oracleAssertion(
          'includes collection-oracle.property comparison 1043',
          () =>
            expect(result.array.map((child) => child.id)).toEqual(expectedIds),
        )
        oracleAssertion(
          'includes collection-oracle.property comparison 1044',
          () =>
            expect(result.materialized.map((child) => child.id)).toEqual(
              expectedIds,
            ),
        )
        oracleAssertion(
          'includes collection-oracle.property comparison 1047',
          () => expect(result.first?.id).toBe(smallId),
        )
        oracleAssertion(
          'includes collection-oracle.property comparison 1048',
          () => expect(result.joined).toBe(`${smallId}${wideId}`),
        )
        // The public-key assertion rejects a plausible lexical reversal.
        oracleAssertion(
          'includes collection-oracle.property comparison 1050',
          () =>
            expect(() =>
              expect([...facadeIds].reverse()).toEqual(expectedIds),
            ).toThrow(),
        )
      },
      () => [
        () => live.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ],
    )
  }

  registerIncludesProperty(
    [publicKeyOrderArbitrary],
    {
      property: publicKeyOrderProperty,
      runs: 20,
      fixedSeed: 1658102,
      owns: [
        `src/collection/index.ts#createCollection`,
        `src/indexes/btree-index.ts`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
      ],
    },
    `uses one raw public-key order across Collection and inline materializations with a fixed seed`,
    (...args: Parameters<typeof runPublicKeyOrder>) => {
      return runPublicKeyOrder(...args)
    },
  )

  const runLayoutSwap = async ({
    length,
    swapIndex,
  }: SampleOf<typeof orderSwapArbitrary>) => {
    type OrderedChild = ChildRow & { position: number; label: string }
    const parents = createControlledCollection(`order-move-parents`, [
      { id: 1, group: 1 },
    ])
    const initialRows: Array<OrderedChild> = Array.from(
      { length },
      (_, index) => ({
        id: index + 1,
        parentGroup: 1,
        value: index + 1,
        position: index,
        label: String(index + 1),
      }),
    )
    const children = createControlledCollection<OrderedChild>(
      `order-move-children`,
      initialRows,
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const childRows = () =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.position)
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({
              id: child.id,
              position: child.position,
              label: child.label,
            }))

        return {
          id: parent.id,
          facade: include(childRows()),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
          first: materialize(childRows().findOne()),
          joined: concat(
            toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => child.label),
            ),
          ),
        }
      }),
    )

    const project = () => {
      const row = live.get(1)!
      return {
        facade: row.facade.toArray.map(({ id }) => id),
        array: row.array.map(({ id }) => id),
        materialized: row.materialized.map(({ id }) => id),
        first: row.first?.id,
        joined: row.joined,
      }
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        const facade = live.get(1)!.facade
        const initialIds = initialRows.map(({ id }) => id)
        oracleAssertion(
          'includes collection-oracle.property comparison 1143',
          () =>
            expect(project()).toEqual({
              ...expectedMaterializations(initialIds),
              first: initialIds[0],
              joined: initialRows.map(({ label }) => label).join(``),
            }),
        )

        const first = initialRows[swapIndex]!
        const second = initialRows[swapIndex + 1]!
        children.writeBatch([
          { type: `update`, value: { ...first, position: second.position } },
          { type: `update`, value: { ...second, position: first.position } },
        ])
        const expectedIds = [...initialIds]
        ;[expectedIds[swapIndex], expectedIds[swapIndex + 1]] = [
          expectedIds[swapIndex + 1]!,
          expectedIds[swapIndex]!,
        ]

        oracleAssertion(
          'includes collection-oracle.property comparison 1161',
          () => expect(live.get(1)!.facade).toBe(facade),
        )
        oracleAssertion(
          'includes collection-oracle.property comparison 1162',
          () =>
            expect(project()).toEqual({
              ...expectedMaterializations(expectedIds),
              first: expectedIds[0],
              joined: expectedIds.join(``),
            }),
        )
        // The same result check rejects a facade that kept its prior layout.
        oracleAssertion(
          'includes collection-oracle.property comparison 1168',
          () =>
            expect(() =>
              expect(project()).toEqual({
                ...expectedMaterializations(initialIds),
                first: initialIds[0],
                joined: initialRows.map(({ label }) => label).join(``),
              }),
            ).toThrow(),
        )
      },
      () => [
        () => live.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ],
    )
  }

  registerIncludesProperty(
    [orderSwapArbitrary],
    {
      property: layoutSwapProperty,
      runs: 20,
      fixedSeed: 1658103,
      owns: [
        `src/collection/index.ts#createCollection`,
        `src/indexes/btree-index.ts`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
      ],
    },
    `propagates order-only child swaps through every materialization with a fixed seed`,
    (...args: Parameters<typeof runLayoutSwap>) => {
      return runLayoutSwap(...args)
    },
  )

  oracleProperty({
    id: `includes-collection.held-ordered-repair`,
    law: {
      statement: heldOrderedRepairLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `The three enumerated intermediate and final child values.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [
      { intermediate: `A`, final: `A` },
      { intermediate: `B`, final: `A` },
      { intermediate: `B`, final: `C` },
    ],
    label: ({ intermediate, final }) =>
      `a held ordered child repair publishes ${intermediate}-to-${final} through the facade`,
    resolve: (cell) => ({ ...cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(heldOrderedRepairLaw, plan, observe, () =>
        judgeHeldOrderedChildRepair(plan.intermediate, plan.final),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-collection.held-truncate-reorder`,
    law: {
      statement: heldTruncateReorderLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One fixed history over controlled source Collections.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [
      `a held child truncate replay publishes an A-to-B-to-A reorder through the facade`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(heldTruncateReorderLaw, plan, observe, () =>
        judgeHeldTruncateReorder(),
      ),
    check: forwardAssertionJudgment,
  })

  const runOptimisticChildHistory = async ({
    group,
    insertedId,
    confirmedId,
    value,
  }: SampleOf<typeof optimisticChildArbitrary>) => {
    const { driver } = createOptimisticCollectionDriver(group)
    const rolledBack = {
      id: insertedId,
      parentGroup: group,
      value,
    }
    const confirmed = {
      id: confirmedId,
      parentGroup: group,
      value: value + 1,
    }

    await runTrace({
      steps: [
        { type: `insert`, row: rolledBack, settlement: `rollback` },
        { type: `insert`, row: confirmed, settlement: `confirm` },
        { type: `delete`, id: confirmedId, settlement: `rollback` },
        { type: `delete`, id: confirmedId, settlement: `confirm` },
      ],
      driver,
      projection: collectionProjection,
    })
  }

  oracleProperty({
    id: `includes-collection.rollback-retained-child`,
    law: {
      statement: rollbackRetainedChildLaw,
      authority: `Collection facades, event coherence, and route activation in packages/db/src/query/live/ARCHITECTURE.md (Nested materialization, Coherent publication), stated at the start of this owner.`,
      limits: `One rolled-back optimistic child insert and one retained-row corruption of its observation.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/indexes/btree-index.ts`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: [`removes a rolled-back optimistic child row`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(rollbackRetainedChildLaw, plan, observe, () =>
        observeRolledBackChild(() => undefined),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `optimistic rollback comparison rejects a retained child row`,
        law: rollbackRetainedChildLaw,
        // The former calibration body. Exactly the old matcher: any failure of
        // the shared comparison on the retained row counts as rejecting it; a
        // comparison that accepts it fails this calibration.
        driver: (plan, observe) =>
          recordAssertionJudgment(rollbackRetainedChildLaw, plan, observe, () =>
            observeRolledBackChild((observed, expected, row) => {
              const retained = structuredClone(observed)
              retained.rows[0]!.children.push(row)
              try {
                collectionProjection.assertEqual(retained, expected)
              } catch (error) {
                rejectAt(
                  `rollback retained child`,
                  error instanceof Error ? error : new Error(String(error)),
                )
              }
            }),
          ),
      },
    ],
  })

  registerIncludesProperty(
    [optimisticChildArbitrary],
    {
      property: optimisticChildProperty,
      runs: 20,
      fixedSeed: 1658104,
      owns: [
        `src/collection/index.ts#createCollection`,
        `src/indexes/btree-index.ts`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
      ],
    },
    `matches optimistic child settlement histories with a fixed seed`,
    (...args: Parameters<typeof runOptimisticChildHistory>) => {
      return runOptimisticChildHistory(...args)
    },
  )
})
