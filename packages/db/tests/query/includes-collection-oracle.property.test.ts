import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  concat,
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../oracle-config.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import {
  assertDeleteIdentityEvents,
  assertFacadeRootSnapshots,
  assertRetiredFacade,
  createControlledCollection,
  expectedMaterializations,
} from './includes-collection-support.js'
import type { Collection } from '../../src/collection/index.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'
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
 * also varies optimistic confirmation and rollback. A bounded exhaustive lane covers every
 * two-step history in the smallest relationship domain. Random histories add
 * longer combinations and shrink failures.
 *
 * The Map model stores current source Collection rows. It combines all D2
 * relation, route, and bucket state into the public result recomputation; it
 * does not model acquisition ownership or publication scheduling. Callback
 * snapshots and change messages are separate public observations.
 *
 * Grammar controls: the fixed route-retirement, dormant-bucket, shared-bucket,
 * and child-order witnesses reconstruct the key relationship histories. The
 * generated action lane needs both parent and child writes: removing either
 * loses route transitions or child-only facade changes. Its IDs (parents 0–3,
 * children 10–14), groups (-3–3), values (-5–5), and 1–16 actions are bounded;
 * the exhaustive lane includes empty initial relations and zero actions. A
 * repeated key becomes an update, so the grammar rejects a duplicate insert.
 * The public-key lane crosses one-digit and two-digit IDs to expose lexical
 * sorting; allowing equal IDs would collapse the two-row premise. The order
 * lane uses adjacent swaps among 2–8 rows; a one-row case cannot move. The
 * optimistic lane uses group/value -10–10 and disjoint IDs 10–100/101–200.
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

type CollectionAction =
  | { type: `putParent`; row: ParentRow }
  | { type: `deleteParent`; id: number }
  | { type: `putChild`; row: ChildRow }
  | { type: `deleteChild`; id: number }

type ProjectedParent = {
  id: number
  group: number
  childrenReady: boolean
  children: Array<ChildRow>
  arrayChildren: Array<ChildRow>
  materializedChildren: Array<ChildRow>
}

type CollectionObservation = {
  rows: Array<ProjectedParent>
  publications: Array<Array<ProjectedParent>>
  events: Array<ParentEvent>
}

type EventValue = Pick<
  ProjectedParent,
  `id` | `group` | `arrayChildren` | `materializedChildren`
>

type ParentEvent = {
  type: `insert` | `update` | `delete`
  key: number | string
  value: EventValue
  previousValue?: EventValue
}

function projectEventValue(row: EventValue): EventValue {
  const children = (rows: Array<ChildRow>) =>
    rows.map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
  return {
    id: row.id,
    group: row.group,
    arrayChildren: children(row.arrayChildren),
    materializedChildren: children(row.materializedChildren),
  }
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

type CollectionContext = {
  parents: ControlledCollection<ParentRow>
  children: ControlledCollection<ChildRow>
  live: ReturnType<typeof createCollectionQuery>
  model: {
    parents: Map<number, ParentRow>
    children: Map<number, ChildRow>
  }
  publications: Array<Array<ProjectedParent>>
  events: Array<ParentEvent>
  before: Array<ProjectedParent>
  subscription?: { unsubscribe: () => void }
}

function createCollectionQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
  reuseChildRelation = true,
) {
  return createLiveQueryCollection((q) =>
    q
      .from({ parent: parents })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const createChildRows = () =>
          q
            .from({ child: children })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({
              id: child.id,
              parentGroup: child.parentGroup,
              value: child.value,
            }))
        const childRows = createChildRows()

        return {
          id: parent.id,
          group: parent.group,
          children: childRows,
          arrayChildren: toArray(
            reuseChildRelation ? childRows : createChildRows(),
          ),
          materializedChildren: materialize(
            reuseChildRelation ? childRows : createChildRows(),
          ),
        }
      }),
  )
}

type IncludedChildCollection = ReturnType<
  typeof createCollectionQuery
>[`toArray`][number][`children`]

function projectLive(
  live: ReturnType<typeof createCollectionQuery>,
): Array<ProjectedParent> {
  return [...live.values()].map((parent) => {
    const projectChildren = (rows: Iterable<ChildRow>) =>
      [...rows].map(({ id, parentGroup, value }) => ({
        id,
        parentGroup,
        value,
      }))

    return {
      id: parent.id,
      group: parent.group,
      childrenReady: parent.children.isReady(),
      children: projectChildren(parent.children.values()),
      arrayChildren: projectChildren(parent.arrayChildren),
      materializedChildren: projectChildren(parent.materializedChildren),
    }
  })
}

// This value model uses only current source Maps and the declared relation and
// child order. Facade identity has separate focused models below.
function recompute(context: CollectionContext): Array<ProjectedParent> {
  return [...context.model.parents.values()]
    .sort((left, right) => left.id - right.id)
    .map((parent) => {
      const children = [...context.model.children.values()]
        .filter((child) => child.parentGroup === parent.group)
        .sort((left, right) => left.id - right.id)
        .map((child) => ({ ...child }))

      return {
        ...parent,
        childrenReady: true,
        children,
        arrayChildren: children,
        materializedChildren: children,
      }
    })
}

function createCollectionDriver(
  initialParents: ReadonlyArray<ParentRow>,
  initialChildren: ReadonlyArray<ChildRow>,
  reuseChildRelation = true,
): TraceDriver<CollectionAction, CollectionContext> {
  return {
    setup() {
      const parents = createControlledCollection(
        `collection-oracle-parents`,
        initialParents,
      )
      const children = createControlledCollection(
        `collection-oracle-children`,
        initialChildren,
      )
      return {
        parents,
        children,
        live: createCollectionQuery(
          parents.collection,
          children.collection,
          reuseChildRelation,
        ),
        model: {
          parents: new Map(initialParents.map((row) => [row.id, { ...row }])),
          children: new Map(initialChildren.map((row) => [row.id, { ...row }])),
        },
        publications: [],
        events: [],
        before: [],
      }
    },
    async start(context) {
      await context.live.preload()
      context.before = recompute(context)
      context.subscription = context.live.subscribeChanges(
        (changes) => {
          context.publications.push(projectLive(context.live))
          context.events.push(
            ...changes.map((change) => ({
              type: change.type,
              key: change.key,
              value: projectEventValue(change.value),
              ...(change.previousValue
                ? { previousValue: projectEventValue(change.previousValue) }
                : {}),
            })),
          )
        },
        { includeInitialState: false },
      )
    },
    apply(action, context) {
      context.publications = []
      context.events = []
      context.before = recompute(context)
      switch (action.type) {
        case `putParent`: {
          const type = context.model.parents.has(action.row.id)
            ? `update`
            : `insert`
          context.model.parents.set(action.row.id, { ...action.row })
          context.parents.write(type, action.row)
          return
        }
        case `deleteParent`: {
          const previous = context.model.parents.get(action.id)
          if (!previous) return
          context.model.parents.delete(action.id)
          context.parents.write(`delete`, previous)
          return
        }
        case `putChild`: {
          const type = context.model.children.has(action.row.id)
            ? `update`
            : `insert`
          context.model.children.set(action.row.id, { ...action.row })
          context.children.write(type, action.row)
          return
        }
        case `deleteChild`: {
          const previous = context.model.children.get(action.id)
          if (!previous) return
          context.model.children.delete(action.id)
          context.children.write(`delete`, previous)
        }
      }
    },
    async cleanup(context) {
      context.subscription?.unsubscribe()
      await Promise.all([
        context.live.cleanup(),
        context.parents.collection.cleanup(),
        context.children.collection.cleanup(),
      ])
    },
  }
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
    entry.receipt = transaction.isPersisted.promise.then(
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
          await transaction.isPersisted.promise
        } else {
          context.model.children.delete(action.row.id)
          const message = `rollback insert`
          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
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
        await transaction.isPersisted.promise
      } else {
        context.model.children.set(action.id, previous)
        const message = `rollback delete`
        const persisted = transaction.isPersisted.promise.catch(() => undefined)
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
    expect(observed.rows).toEqual(expected.rows)
    expect(observed.publications).toEqual(expected.publications)
    // The mixed fixture has array/materialized siblings, so user-value changes
    // require root events. Separate tests cover bare-facade identity. Do not
    // prohibit metadata-only events for otherwise unchanged rows here.
    const changedKeys = new Set(expected.events.map((event) => event.key))
    expect(
      observed.events
        .filter((event) => changedKeys.has(event.key))
        .sort((a, b) => Number(a.key) - Number(b.key)),
    ).toEqual(expected.events)
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

// The model derives the expected parent rows from the current source Maps and
// the expected events from the prior and current rows. The projection passes it
// to every trace as `recompute`, so each history reaches it.
declareOracle({
  model: [recompute, diffParents, expectedOrderedRows],
})

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

// Enumeration proves the small finite domain. The generated lane explores
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

describe(`Collection-valued includes oracle`, () => {
  fcTest(
    `root event observations reject missing, repeated, and corrupt changed-row events`,
    async () => {
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
        for (const fault of [
          `missing`,
          `duplicate`,
          `value`,
          `previousValue`,
          `type`,
        ] as const) {
          const bad = structuredClone(observed)
          const event = bad.events[0]!
          if (fault === `missing`) bad.events = []
          else if (fault === `duplicate`)
            bad.events.push(structuredClone(event))
          else if (fault === `value`) event.value.arrayChildren[0]!.value = -999
          else if (fault === `previousValue`)
            event.previousValue!.materializedChildren[0]!.value = -999
          else event.type = `insert`
          // The previous checker accepted all these payload/count corruptions.
          expect(bad.rows).toEqual(expected.rows)
          expect(bad.publications).toEqual(expected.publications)
          expect(() =>
            collectionProjection.assertEqual(bad, expected),
          ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
        }
      } finally {
        await driver.cleanup(context)
      }
    },
  )

  for (const kind of [`insert`, `delete`] as const) {
    for (const failRollback of [false, true]) {
      fcTest(
        `settles ${kind} after a checkpoint failure (rollback throws=${failRollback})`,
        async () => {
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
          expect(primary.suppressed).toEqual(
            failRollback ? [cleanupError] : undefined,
          )
        },
      )
    }
  }

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

  oracleReplayTest(fcTest).prop([collectionScenarioArbitrary], {
    numRuns: oracleRuns(30),
    seed: 1_658_101,
  })(
    `keeps Collection, toArray, and materialize equivalent across fixed relationship histories`,
    runRelationshipHistory,
  )

  oracleReplayTest(fcTest, relationshipProperty).prop(
    [collectionScenarioArbitrary],
    oraclePropertyOptions(30, relationshipProperty),
  )(
    `keeps Collection, toArray, and materialize equivalent across random or replayed relationship histories`,
    runRelationshipHistory,
  )

  fcTest(
    `exhaustively matches every two-step history in the smallest relationship domain`,
    async () => {
      const initialStates = [
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
      const histories = enumerateActionSequences(exhaustiveActions, 2)

      for (const initial of initialStates) {
        for (const steps of histories) {
          try {
            await runTrace({
              steps,
              driver: createCollectionDriver(initial.parents, initial.children),
              projection: collectionProjection,
            })
          } catch (cause) {
            throw new Error(
              `Exhaustive Collection include history failed: ${JSON.stringify({ initial, steps })}`,
              { cause },
            )
          }
        }
      }
    },
  )

  fcTest(
    `publishes independently compiled equivalent child relations coherently`,
    () =>
      runTrace({
        steps: [{ type: `deleteChild`, id: 10 }],
        driver: createCollectionDriver(
          [{ id: 0, group: 0 }],
          [{ id: 10, parentGroup: 0, value: 0 }],
          false,
        ),
        projection: collectionProjection,
      }),
  )

  fcTest(`replays a dormant bucket when its first parent route activates`, () =>
    runTrace({
      steps: [{ type: `putParent`, row: { id: 1, group: 7 } }],
      driver: createCollectionDriver(
        [],
        [{ id: 10, parentGroup: 7, value: 1 }],
      ),
      projection: collectionProjection,
    }),
  )

  fcTest(`retiring a route leaves a held facade empty and ready`, async () => {
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
  })

  fcTest(`a delete event preserves the published facade identity`, async () => {
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
                matchesPublishedFacade:
                  change.value.children === publishedFacade,
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
  })

  fcTest(`facade public keys survive row cloning`, async () => {
    const driver = createCollectionDriver(
      [{ id: 1, group: 1 }],
      [{ id: 10, parentGroup: 1, value: 1 }],
    )
    const projection: TraceProjection<
      CollectionContext,
      { clonedKey: unknown },
      { clonedKey: number }
    > = {
      observe(context) {
        const facade = context.live.get(1)!.children
        const row = facade.get(10)!
        return { clonedKey: facade.getKeyFromItem({ ...row }) }
      },
      recompute: () => ({ clonedKey: 10 }),
      assertEqual(observed, expected) {
        expect(observed).toEqual(expected)
        return undefined
      },
    }

    await runTrace({ steps: [], driver, projection })
  })

  fcTest(`reactivating a retired route restores its current snapshot`, () =>
    runTrace({
      steps: [
        { type: `putParent`, row: { id: 1, group: 2 } },
        { type: `putParent`, row: { id: 1, group: 1 } },
      ],
      driver: createCollectionDriver(
        [{ id: 1, group: 1 }],
        [
          { id: 10, parentGroup: 1, value: 1 },
          { id: 20, parentGroup: 2, value: 2 },
        ],
      ),
      projection: collectionProjection,
    }),
  )

  fcTest(
    `facade application failure leaves no partial state or publication`,
    async () => {
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
    },
  )

  fcTest(`facade events observe the matching root publication`, async () => {
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
  })

  fcTest(
    `shared facades remain active until their last parent departs`,
    async () => {
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

      try {
        expect(context.live.get(2)!.children).toBe(sharedFacade)
        context.parents.write(`delete`, { id: 1, group: 1 })
        expect(context.live.get(2)!.children).toBe(sharedFacade)
        expect([...sharedFacade.keys()]).toEqual([10])
        expect(sharedFacade.status).toBe(`ready`)

        context.parents.write(`delete`, { id: 2, group: 1 })
        expect(context.live.toArray).toEqual([])
        expect(sharedFacade.toArray).toEqual([])
        expect(sharedFacade.status).toBe(`ready`)

        context.children.write(`insert`, { id: 20, parentGroup: 1, value: 2 })
        expect(context.live.toArray).toEqual([])
        expect(sharedFacade.toArray).toEqual([])
        expect(sharedFacade.status).toBe(`ready`)

        context.parents.write(`insert`, { id: 1, group: 1 })
        const reactivated = context.live.get(1)!.children
        expect(reactivated).not.toBe(sharedFacade)
        const assertCurrent = (value: number) => {
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
    },
  )

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
          facade: childRows(),
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

        expect(facadeIds).toEqual(expectedIds)
        expect(result.array.map((child) => child.id)).toEqual(expectedIds)
        expect(result.materialized.map((child) => child.id)).toEqual(
          expectedIds,
        )
        expect(result.first?.id).toBe(smallId)
        expect(result.joined).toBe(`${smallId}${wideId}`)
        // The public-key assertion rejects a plausible lexical reversal.
        expect(() =>
          expect([...facadeIds].reverse()).toEqual(expectedIds),
        ).toThrow()
      },
      () => [
        () => live.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ],
    )
  }

  oracleReplayTest(fcTest).prop([publicKeyOrderArbitrary], {
    numRuns: oracleRuns(20),
    seed: 1_658_102,
  })(
    `uses one raw public-key order across Collection and inline materializations with a fixed seed`,
    runPublicKeyOrder,
  )

  oracleReplayTest(fcTest, publicKeyOrderProperty).prop(
    [publicKeyOrderArbitrary],
    oraclePropertyOptions(20, publicKeyOrderProperty),
  )(
    `uses one raw public-key order across Collection and inline materializations with a random or replayed seed`,
    runPublicKeyOrder,
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
          facade: childRows(),
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
        expect(project()).toEqual({
          ...expectedMaterializations(initialIds),
          first: initialIds[0],
          joined: initialRows.map(({ label }) => label).join(``),
        })

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

        expect(live.get(1)!.facade).toBe(facade)
        expect(project()).toEqual({
          ...expectedMaterializations(expectedIds),
          first: expectedIds[0],
          joined: expectedIds.join(``),
        })
        // The same result check rejects a facade that kept its prior layout.
        expect(() =>
          expect(project()).toEqual({
            ...expectedMaterializations(initialIds),
            first: initialIds[0],
            joined: initialRows.map(({ label }) => label).join(``),
          }),
        ).toThrow()
      },
      () => [
        () => live.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ],
    )
  }

  oracleReplayTest(fcTest).prop([orderSwapArbitrary], {
    numRuns: oracleRuns(20),
    seed: 1_658_103,
  })(
    `propagates order-only child swaps through every materialization with a fixed seed`,
    runLayoutSwap,
  )

  oracleReplayTest(fcTest, layoutSwapProperty).prop(
    [orderSwapArbitrary],
    oraclePropertyOptions(20, layoutSwapProperty),
  )(
    `propagates order-only child swaps through every materialization with a random or replayed seed`,
    runLayoutSwap,
  )

  for (const { intermediate, final } of [
    { intermediate: `A`, final: `A` },
    { intermediate: `B`, final: `A` },
    { intermediate: `B`, final: `C` },
  ]) {
    fcTest(
      `a held ordered child repair publishes ${intermediate}-to-${final} through the facade`,
      async () => {
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
            children: q
              .from({ child: orderedChildren })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.rank)
              .select(({ child }) => ({ id: child.id, value: child.value })),
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
            expect(
              facade.toArray.map(({ id, value }) => ({ id, value })),
            ).toEqual(before)
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
            expect(
              facade.toArray.map(({ id, value }) => ({ id, value })),
            ).toEqual(before)
            expect(callbacks).toEqual([])

            holdRepair = false
            for (const release of held.splice(0)) release()
            await flushPromises()
            const after = expectedRows()
            expect(live.get(1)!.children).toBe(facade)
            expect(
              facade.toArray.map(({ id, value }) => ({ id, value })),
            ).toEqual(after)
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
      },
    )
  }

  fcTest(
    `a held child truncate replay publishes an A-to-B-to-A reorder through the facade`,
    async () => {
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
          children: q
            .from({ child: children })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.rank)
            .limit(2)
            .select(({ child }) => ({ id: child.id, value: child.value })),
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
          expect(
            facade.toArray.map(({ id, value }) => ({ id, value })),
          ).toEqual(before)
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
          expect(
            facade.toArray.map(({ id, value }) => ({ id, value })),
          ).toEqual(before)
          expect(callbacks).toEqual([])

          holdReplay = false
          for (const release of held.splice(0)) release()
          await flushPromises()
          const after = expectedRows()
          expect(live.get(1)!.children).toBe(facade)
          expect(
            facade.toArray.map(({ id, value }) => ({ id, value })),
          ).toEqual(after)
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
    },
  )

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

  fcTest(
    `optimistic rollback comparison rejects a retained child row`,
    async () => {
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
          const retained = structuredClone(observed)
          retained.rows[0]!.children.push(row)
          expect(() =>
            collectionProjection.assertEqual(retained, expected),
          ).toThrow()
        },
        () => [() => driver.cleanup(context)],
      )
    },
  )

  oracleReplayTest(fcTest).prop([optimisticChildArbitrary], {
    numRuns: oracleRuns(20),
    seed: 1_658_104,
  })(
    `matches optimistic child settlement histories with a fixed seed`,
    runOptimisticChildHistory,
  )

  oracleReplayTest(fcTest, optimisticChildProperty).prop(
    [optimisticChildArbitrary],
    oraclePropertyOptions(20, optimisticChildProperty),
  )(
    `matches optimistic child settlement histories with a random or replayed seed`,
    runOptimisticChildHistory,
  )
})
