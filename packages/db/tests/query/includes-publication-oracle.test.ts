import { setImmediate as yieldToRunner } from 'node:timers/promises'
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { SyncConfig } from '../../src/types.js'

/**
 * # What makes a layered publication coherent?
 *
 * A source write can update a parent, its materialized children, and a query
 * that reads the first query. The public contract does not permit a torn row at
 * any one layer. When that layer invokes a listener, its installed reads,
 * callback rows, and change payloads must describe the same complete result.
 *
 * A plain Map model recomputes both child arrays from current parent and child
 * rows. The production driver builds two live-query layers. Q1 covers direct
 * and joined source forms. Q2 covers pass-through, filter, order, and projection.
 * After each synchronous source checkpoint, the oracle compares both layers
 * with the model and checks each callback since the prior checkpoint.
 *
 * The action grammar covers parent-only changes, child-only changes, route
 * moves, atomic replacement, optimistic confirmation and rollback, and two
 * consecutive source writes. Fault controls corrupt transient reads, callback
 * snapshots, optimistic state, and source-settled state. This proves that a
 * final settled read alone is not the oracle.
 *
 * Q1 and Q2 can notify at different moments. Coherence applies within each
 * callback and its own layer. The test does not require Q2 to advance while a
 * Q1 callback is still running.
 *
 * Authority: ARCHITECTURE.md, "Coherent publication", "Atomic window
 * publication", and normative laws 8–9. The model combines source Collection
 * rows into the two queries' public rows; it does not model graph relations,
 * scheduling, or callback order. The joined shape has fixed metadata, and Q2
 * has one parent row, so its orderBy cell checks publication through that
 * operator rather than multi-row sort semantics. Controlled source writes do
 * not establish any real provider's event schedule. Held repair below covers
 * one two-row root reorder, not Collection-valued child facades, cleanup, or
 * concurrent optimistic changes during repair; the coverage map owns those
 * neighboring limits.
 *
 * Grammar: one existing parent, two child rows per child source, and fixed
 * joined metadata. Each action updates an existing key; missing-key updates
 * are excluded. The fixed plain-action list reaches the two-write path;
 * a fixed cell and generated properties reach optimistic confirmation, while
 * a generated property reaches rollback. Removing an action kind loses its
 * publication path; removing a Q1/Q2 shape loses that graph path. Rollback
 * runs in the direct pass-through shape. The other plain actions cross all
 * shapes in the fixed list. Generated scalar values exclude initial values.
 * Their domain spans -100..100, with -100, -1, 1, and 100 as margins; child
 * values add 0 and 2.
 * Route targets cover occupied group 20 and empty group 30. Atomic
 * replacement also covers unchanged group 10. These are bounded one-action
 * value campaigns, not arbitrary interleaved histories.
 */

type ParentRow = {
  id: number
  group: number
  value: number
}

type ChildRow = {
  id: number
  parentGroup: number
  value: number
}

type MetadataRow = {
  id: number
  parentId: number
}

type PublishedRow = {
  item: ParentRow
  children: Array<ChildRow>
  otherChildren: Array<ChildRow>
}

type Q2Shape = `passThrough` | `where` | `orderBy` | `select`
type Q1Shape = `direct` | `joined`

const initialParent: ParentRow = { id: 1, group: 10, value: 0 }
const initialChild: ChildRow = { id: 100, parentGroup: 10, value: 1 }
const initialChildren: ReadonlyArray<ChildRow> = [
  initialChild,
  { id: 200, parentGroup: 20, value: 2 },
]
const initialOtherChildren: ReadonlyArray<ChildRow> = [
  { id: 300, parentGroup: 10, value: 3 },
  { id: 400, parentGroup: 20, value: 4 },
]

type PublicationAction =
  | { type: `parentScalar`; value: number }
  | { type: `childScalar`; value: number }
  | { type: `parentRoute`; group: number }
  | { type: `atomicReplace`; group: number; value: number }
  | { type: `optimisticConfirm`; value: number }
  | { type: `optimisticRollback`; value: number }
  | { type: `parentThenChild`; parentValue: number; childValue: number }

let nextCollectionId = 0

function createLayeredQuery(
  parents: ReturnType<typeof createControlledCollection<ParentRow>>,
  children: ReturnType<typeof createControlledCollection<ChildRow>>,
  otherChildren: ReturnType<typeof createControlledCollection<ChildRow>>,
  metadata: ReturnType<typeof createControlledCollection<MetadataRow>>,
  q1Shape: Q1Shape,
  q2Shape: Q2Shape,
) {
  const q1 = createLiveQueryCollection({
    id: `publication-q1-${nextCollectionId++}`,
    query: (q) => {
      const source = q.from({ item: parents.collection })
      const parentRows =
        q1Shape === `direct`
          ? source
          : source.join(
              { metadata: metadata.collection },
              ({ item, metadata: rowMetadata }) =>
                eq(item.id, rowMetadata.parentId),
              `inner`,
            )

      return parentRows.select(({ item }) => ({
        item,
        children: materialize(
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, item.group))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({
              id: child.id,
              parentGroup: child.parentGroup,
              value: child.value,
            })),
        ),
        otherChildren: materialize(
          q
            .from({ otherChild: otherChildren.collection })
            .where(({ otherChild }) => eq(otherChild.parentGroup, item.group))
            .orderBy(({ otherChild }) => otherChild.id)
            .select(({ otherChild }) => ({
              id: otherChild.id,
              parentGroup: otherChild.parentGroup,
              value: otherChild.value,
            })),
        ),
      }))
    },
    getKey: (row) => row.item.id,
  })
  const id = `publication-q2-${nextCollectionId++}`
  const q2 = (() => {
    switch (q2Shape) {
      case `passThrough`:
        return createLiveQueryCollection({
          id,
          query: (q) => q.from({ row: q1 }),
          getKey: (row) => row.item.id,
        })
      case `where`:
        return createLiveQueryCollection({
          id,
          query: (q) =>
            q
              .from({ row: q1 })
              .where(({ row }) => eq(row.item.id, initialParent.id)),
          getKey: (row) => row.item.id,
        })
      case `orderBy`:
        return createLiveQueryCollection({
          id,
          query: (q) =>
            q.from({ row: q1 }).orderBy(({ row }) => row.item.value),
          getKey: (row) => row.item.id,
        })
      case `select`:
        return createLiveQueryCollection({
          id,
          query: (q) =>
            q.from({ row: q1 }).select(({ row }) => ({
              item: row.item,
              children: row.children,
              otherChildren: row.otherChildren,
            })),
          getKey: (row) => row.item.id,
        })
    }
  })()
  return { q1, q2 }
}

function stripVirtualProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVirtualProperties)
  if (!value || typeof value !== `object`) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith(`$`))
      .map(([key, entry]) => [key, stripVirtualProperties(entry)]),
  )
}

type PublicationObservation = {
  q1: Array<PublishedRow>
  q2: Array<PublishedRow>
  callbacks: Array<CallbackObservation>
}

type CallbackObservation = {
  layer: `q1` | `q2`
  previousDeliveredRows: Array<PublishedRow>
  rows: Array<PublishedRow>
  expected: Array<PublishedRow>
  changes: Array<{
    type: `insert` | `update` | `delete`
    key: number
    value: PublishedRow
    previousValue?: PublishedRow
  }>
}

type PublicationContext = {
  sources: {
    parents: ReturnType<typeof createControlledCollection<ParentRow>>
    children: ReturnType<typeof createControlledCollection<ChildRow>>
    otherChildren: ReturnType<typeof createControlledCollection<ChildRow>>
    metadata: ReturnType<typeof createControlledCollection<MetadataRow>>
  }
  queries: ReturnType<typeof createLayeredQuery>
  callbacks: Array<CallbackObservation>
  unsubscribe: Array<() => void>
  // Model-only subscriber ledger: equal current Collection rows can produce
  // insert or update on the next delivery depending on prior callback reach.
  lastDeliveredRows: Record<CallbackObservation[`layer`], Array<PublishedRow>>
  model: {
    parents: Map<number, ParentRow>
    children: Map<number, ChildRow>
    otherChildren: Map<number, ChildRow>
  }
}

// This model uses only source Maps, equality, and the declared child order. It
// does not read either live query or any materialization state.
function recomputeRows(context: PublicationContext): Array<PublishedRow> {
  return [...context.model.parents.values()]
    .sort((left, right) => left.id - right.id)
    .map((parent) => ({
      item: { ...parent },
      children: [...context.model.children.values()]
        .filter((child) => child.parentGroup === parent.group)
        .sort((left, right) => left.id - right.id)
        .map((child) => ({ ...child })),
      otherChildren: [...context.model.otherChildren.values()]
        .filter((child) => child.parentGroup === parent.group)
        .sort((left, right) => left.id - right.id)
        .map((child) => ({ ...child })),
    }))
}

const publicationProjection: TraceProjection<
  PublicationContext,
  PublicationObservation
> = {
  // Observe both final reads and rows captured inside each listener. A later
  // repair cannot hide a callback-time tear.
  observe: ({ queries, callbacks }) => ({
    q1: stripVirtualProperties(queries.q1.toArray) as Array<PublishedRow>,
    q2: stripVirtualProperties(queries.q2.toArray) as Array<PublishedRow>,
    callbacks,
  }),
  recompute: (context) => {
    const expected = recomputeRows(context)
    return {
      q1: expected.map((row) => structuredClone(row)),
      q2: expected.map((row) => structuredClone(row)),
      callbacks: [],
    }
  },
  assertEqual: (observed, expected) => {
    expect(observed.q1).toEqual(expected.q1)
    expect(observed.q2).toEqual(expected.q2)
    // Each layer's own callback must be coherent. This makes no claim that
    // Q2 has already advanced while Q1's earlier callback is running.
    for (const callback of observed.callbacks) {
      expect(callback.rows).toEqual(callback.expected)
      // This grammar retains one parent key. A subscription's first delivery
      // inserts it; later callbacks update it from that layer's last delivery.
      // The stream starts empty even when the Collection already has a row.
      const previous = callback.previousDeliveredRows[0]
      expect(
        callback.changes.map(({ type, key, value, previousValue }) => ({
          type,
          key,
          value,
          previousValue,
        })),
      ).toEqual([
        {
          type: previous ? `update` : `insert`,
          key: initialParent.id,
          value: callback.expected[0],
          previousValue: previous,
        },
      ])
    }
    return undefined
  },
}

async function settleRollback(
  rejectSync: (error: Error) => void,
  persisted: Promise<unknown>,
): Promise<void> {
  const message = `publication oracle rollback`
  const outcome = persisted.catch(() => undefined)
  await withExpectedRejection(message, async () => {
    rejectSync(new Error(message))
    await outcome
    await flushPromises()
  })
}

function createPublicationDriver(
  q1Shape: Q1Shape,
  q2Shape: Q2Shape,
  checkpointOptimistic = false,
): TraceDriver<PublicationAction, PublicationContext> {
  // The driver sends each action through real source, optimistic, graph, and
  // Collection publication boundaries. The checkpoint marks each synchronous
  // state that a caller can observe before the returned Promise settles.
  return {
    setup: () => {
      const parents = createControlledCollection(`publication-parents`, [
        initialParent,
      ])
      const children = createControlledCollection(
        `publication-children`,
        initialChildren,
      )
      const otherChildren = createControlledCollection(
        `publication-other-children`,
        initialOtherChildren,
      )
      const metadata = createControlledCollection(`publication-metadata`, [
        { id: initialParent.id, parentId: initialParent.id },
      ])
      if (q1Shape === `joined`) {
        parents.collection.createIndex((row) => row.id, {
          indexType: BasicIndex,
        })
      }
      return {
        sources: { parents, children, otherChildren, metadata },
        queries: createLayeredQuery(
          parents,
          children,
          otherChildren,
          metadata,
          q1Shape,
          q2Shape,
        ),
        callbacks: [],
        unsubscribe: [],
        lastDeliveredRows: { q1: [], q2: [] },
        model: {
          parents: new Map([[initialParent.id, { ...initialParent }]]),
          children: new Map(
            initialChildren.map((child) => [child.id, { ...child }]),
          ),
          otherChildren: new Map(
            initialOtherChildren.map((child) => [child.id, { ...child }]),
          ),
        },
      }
    },
    start: async (context) => {
      const { queries } = context
      await queries.q1.preload()
      await queries.q2.preload()
      for (const layer of [`q1`, `q2`] as const) {
        const subscription = queries[layer].subscribeChanges((changes) => {
          const rows = stripVirtualProperties(
            queries[layer].toArray,
          ) as Array<PublishedRow>
          context.callbacks.push({
            layer,
            previousDeliveredRows: context.lastDeliveredRows[layer],
            rows,
            expected: recomputeRows(context),
            changes: stripVirtualProperties(
              changes,
            ) as CallbackObservation[`changes`],
          })
          context.lastDeliveredRows[layer] = structuredClone(rows)
        })
        context.unsubscribe.push(() => subscription.unsubscribe())
      }
    },
    apply: async (action, context, checkpoint) => {
      if (action.type === `parentThenChild`) {
        const parent = context.model.parents.get(initialParent.id)
        const child = context.model.children.get(initialChild.id)
        if (!parent || !child) throw new Error(`Missing publication fixture`)

        const nextParent = { ...parent, value: action.parentValue }
        context.model.parents.set(nextParent.id, { ...nextParent })
        context.sources.parents.write(`update`, nextParent)

        checkpoint()

        const nextChild = { ...child, value: action.childValue }
        context.model.children.set(nextChild.id, { ...nextChild })
        context.sources.children.write(`update`, nextChild)
        checkpoint()
        return
      }

      if (action.type === `childScalar`) {
        const currentChild = context.model.children.get(initialChild.id)
        if (!currentChild) throw new Error(`Missing publication child`)
        const nextChild = { ...currentChild, value: action.value }
        context.model.children.set(nextChild.id, { ...nextChild })
        context.sources.children.write(`update`, nextChild)
        checkpoint()
        return
      }

      const current = context.model.parents.get(initialParent.id)
      if (!current) throw new Error(`Missing publication parent`)

      const next: ParentRow = {
        ...current,
        group:
          action.type === `parentRoute` || action.type === `atomicReplace`
            ? action.group
            : current.group,
        value: `value` in action ? action.value : current.value,
      }

      if (action.type === `atomicReplace`) {
        context.model.parents.set(next.id, { ...next })
        context.sources.parents.writeBatch([
          { type: `delete`, value: { ...current } },
          { type: `insert`, value: { ...next } },
        ])
        checkpoint()
        return
      }

      if (
        action.type === `optimisticConfirm` ||
        action.type === `optimisticRollback`
      ) {
        const previous = { ...current }
        context.model.parents.set(next.id, { ...next })
        const transaction = context.sources.parents.collection.update(
          next.id,
          (draft) => {
            draft.value = next.value
          },
        )

        let optimisticFailure: unknown
        if (checkpointOptimistic) {
          try {
            checkpoint()
          } catch (error) {
            optimisticFailure = error
          }
        }

        if (action.type === `optimisticConfirm`) {
          context.sources.parents.write(`update`, next)
          context.sources.parents.resolveSync()
          await transaction.isPersisted.promise
        } else {
          context.model.parents.set(previous.id, previous)
          await settleRollback(
            context.sources.parents.rejectSync,
            transaction.isPersisted.promise,
          )
        }

        if (optimisticFailure) throw optimisticFailure
        return
      }

      context.model.parents.set(next.id, { ...next })
      context.sources.parents.write(`update`, next)
      checkpoint()
    },
    cleanup: async ({ queries, sources, unsubscribe }) => {
      await withHistoryCleanup(
        async () => undefined,
        () => [
          ...unsubscribe,
          () => queries.q2.cleanup(),
          () => queries.q1.cleanup(),
          () => sources.parents.collection.cleanup(),
          () => sources.children.collection.cleanup(),
          () => sources.otherChildren.collection.cleanup(),
          () => sources.metadata.collection.cleanup(),
        ],
      )
    },
  }
}

async function expectPublicationMatches(
  action: PublicationAction,
  checkpointOptimistic = false,
  q1Shape: Q1Shape = `direct`,
  q2Shape: Q2Shape = `passThrough`,
): Promise<void> {
  await runTrace({
    steps: [action],
    driver: createPublicationDriver(q1Shape, q2Shape, checkpointOptimistic),
    projection: publicationProjection,
  })
}

const q2Shapes = [`passThrough`, `where`, `orderBy`, `select`] as const
const q1Shapes = [`direct`, `joined`] as const

// Both ordinary campaigns use the same arbitrary, driver, comparison, and
// budget. A seed/path request runs only its directly replayed campaign.
const fixedPublicationSeed = 1813
function publicationCampaigns(baseRuns: number, property: string) {
  const options = oraclePropertyOptions(baseRuns, property)
  if (options.seed !== undefined) return [{ name: `replay`, options }]
  return [
    {
      name: `fixed seed ${fixedPublicationSeed}`,
      options: { ...options, seed: fixedPublicationSeed },
    },
    { name: `random seed`, options },
  ]
}

describe(`layered-query publication oracle`, () => {
  // Completed-promise histories can starve worker RPC replies at high run counts.
  // Yield between whole tests, never inside a publication trace or checkpoint.
  afterEach(() => yieldToRunner())

  const changedValueArbitrary = fc.oneof(
    fc.integer({ min: -100, max: -1 }),
    fc.integer({ min: 1, max: 100 }),
  )
  const changedChildValueArbitrary = fc.oneof(
    fc.integer({ min: -100, max: 0 }),
    fc.integer({ min: 2, max: 100 }),
  )

  for (const q1Shape of q1Shapes) {
    for (const q2Shape of q2Shapes) {
      it(`observes every plain write before yielding through ${q1Shape}/${q2Shape}`, async () => {
        const actions: Array<PublicationAction> = [
          { type: `parentScalar`, value: 7 },
          { type: `childScalar`, value: 8 },
          { type: `parentRoute`, group: 20 },
          { type: `atomicReplace`, group: 30, value: 9 },
          { type: `parentThenChild`, parentValue: 10, childValue: 11 },
        ]
        const driver = createPublicationDriver(q1Shape, q2Shape)
        await runTrace({
          steps: actions,
          driver: {
            ...driver,
            apply: (action, context, checkpoint) => {
              const beforeCallbacks = context.callbacks.length
              let reached = 0
              const result = driver.apply(action, context, () => {
                reached++
                return checkpoint()
              })
              // Capture before awaiting the async action's returned Promise.
              const synchronousCount = reached
              return Promise.resolve(result).then(() => {
                for (const layer of [`q1`, `q2`] as const) {
                  expect(
                    context.callbacks
                      .slice(beforeCallbacks)
                      .some((callback) => callback.layer === layer),
                  ).toBe(true)
                }
                expect(synchronousCount).toBe(
                  action.type === `parentThenChild` ? 2 : 1,
                )
              })
            },
          },
          projection: publicationProjection,
        })
      })

      it(`rejects a transient layered tear through ${q1Shape}/${q2Shape}`, async () => {
        const run = (observeInsideAction: boolean) => {
          let transient = false
          const driver = createPublicationDriver(q1Shape, q2Shape)
          return runTrace({
            steps: [{ type: `parentScalar` as const, value: 7 }],
            driver: {
              ...driver,
              apply: (action, context, checkpoint) => {
                transient = true
                queueMicrotask(() => {
                  transient = false
                })
                return driver.apply(
                  action,
                  context,
                  observeInsideAction ? checkpoint : () => undefined,
                )
              },
            },
            projection: {
              ...publicationProjection,
              observe: (context) => {
                const observed = publicationProjection.observe(context)
                if (transient) observed.q2[0]!.item.value = -999
                return observed
              },
            },
          })
        }
        // The old settled-only observation misses this test-owned fault.
        await expect(run(false)).resolves.toBeUndefined()
        await expect(run(true)).rejects.toMatchObject({
          name: `TraceAssertionError`,
          checkpoint: 1,
        })
      })

      it(`rejects a callback-only tear before reads recover through ${q1Shape}/${q2Shape}`, async () => {
        const driver = createPublicationDriver(q1Shape, q2Shape)
        let reached = 0
        const context = await driver.setup()
        try {
          await driver.start?.(context)
          await driver.apply(
            { type: `parentScalar`, value: 7 },
            context,
            () => undefined,
          )
          const callback = context.callbacks.find(
            (entry) => entry.layer === `q2`,
          )
          expect(callback).toBeDefined()
          callback!.rows[0]!.item.value = -999
          reached++
          // The installed final reads still agree. This fault corrupts only the
          // captured callback and repairs it before the write returns.
          const observed = publicationProjection.observe(context)
          const expected = publicationProjection.recompute(context)
          expect(observed.q1).toEqual(expected.q1)
          expect(observed.q2).toEqual(expected.q2)
          expect(() =>
            publicationProjection.assertEqual(observed, expected),
          ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
          // Repair the row capture, then remove the whole change batch. The
          // same callback-time comparison must reject a missing public event.
          callback!.rows = structuredClone(callback!.expected)
          callback!.changes = []
          expect(() =>
            publicationProjection.assertEqual(
              publicationProjection.observe(context),
              expected,
            ),
          ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
          expect(reached).toBe(1)
        } finally {
          await driver.cleanup(context)
        }
      })

      it(`checks both sides of confirmation through ${q1Shape}/${q2Shape}`, async () => {
        for (const fault of [`none`, `optimistic`, `confirmed`] as const) {
          const driver = createPublicationDriver(q1Shape, q2Shape, true)
          let phase: `initial` | `optimistic` | `confirmed` = `initial`
          const seen: Array<string> = []
          let hits = 0
          const run = runTrace({
            steps: [{ type: `optimisticConfirm` as const, value: 7 }],
            driver: {
              ...driver,
              apply: async (action, context, checkpoint) => {
                phase = `optimistic`
                await driver.apply(action, context, checkpoint)
                phase = `confirmed`
              },
            },
            projection: {
              ...publicationProjection,
              observe: (context) => {
                seen.push(phase)
                const observed = publicationProjection.observe(context)
                if (phase === fault) {
                  observed.q2[0]!.item.value = -999
                  hits++
                }
                return observed
              },
            },
          })
          if (fault === `none`) {
            await run
            expect(seen).toEqual([`initial`, `optimistic`, `confirmed`])
            expect(hits).toBe(0)
          } else {
            await expect(run).rejects.toMatchObject({
              name: `TraceAssertionError`,
            })
            expect(hits).toBe(1)
          }
        }
      })

      for (const campaign of publicationCampaigns(
        12,
        `includes-publication.parent-scalar.${q1Shape}.${q2Shape}`,
      )) {
        fcTest.prop([changedValueArbitrary], campaign.options)(
          `publishes parent scalar updates through a ${q1Shape} Q1 and ${q2Shape} Q2 (${campaign.name})`,
          async (value) => {
            await expectPublicationMatches(
              { type: `parentScalar`, value },
              false,
              q1Shape,
              q2Shape,
            )
          },
        )
      }

      for (const campaign of publicationCampaigns(
        12,
        `includes-publication.parent-then-child.${q1Shape}.${q2Shape}`,
      )) {
        fcTest.prop(
          [changedValueArbitrary, changedChildValueArbitrary],
          campaign.options,
        )(
          `recovers a ${q1Shape} Q1 and ${q2Shape} Q2 after a child update (${campaign.name})`,
          async (parentValue, childValue) => {
            await expectPublicationMatches(
              { type: `parentThenChild`, parentValue, childValue },
              false,
              q1Shape,
              q2Shape,
            )
          },
        )
      }

      for (const campaign of publicationCampaigns(
        16,
        `includes-publication.optimistic-before-confirm.${q1Shape}.${q2Shape}`,
      )) {
        fcTest.prop([changedValueArbitrary], campaign.options)(
          `publishes optimistic state before and after confirmation through a ${q1Shape} Q1 and ${q2Shape} Q2 (${campaign.name})`,
          async (value) => {
            await expectPublicationMatches(
              { type: `optimisticConfirm`, value },
              true,
              q1Shape,
              q2Shape,
            )
          },
        )
      }
    }
  }

  for (const campaign of publicationCampaigns(
    100,
    `includes-publication.child-scalar`,
  )) {
    fcTest.prop([changedChildValueArbitrary], campaign.options)(
      `publishes child-only scalar updates through both layers (${campaign.name})`,
      async (value) => {
        await expectPublicationMatches({ type: `childScalar`, value })
      },
    )
  }

  for (const campaign of publicationCampaigns(
    100,
    `includes-publication.parent-route`,
  )) {
    fcTest.prop([fc.constantFrom(20, 30)], campaign.options)(
      `compares route transitions at both query layers (${campaign.name})`,
      async (group) => {
        await expectPublicationMatches({ type: `parentRoute`, group })
      },
    )
  }

  for (const campaign of publicationCampaigns(
    100,
    `includes-publication.atomic-parent-replacement`,
  )) {
    fcTest.prop(
      [
        fc.record({
          group: fc.constantFrom(10, 20, 30),
          value: changedValueArbitrary,
        }),
      ],
      campaign.options,
    )(
      `compares atomic parent replacements at both query layers (${campaign.name})`,
      async (row) => {
        await expectPublicationMatches({ type: `atomicReplace`, ...row })
      },
    )
  }

  for (const campaign of publicationCampaigns(
    100,
    `includes-publication.optimistic-rollback`,
  )) {
    fcTest.prop([changedValueArbitrary], campaign.options)(
      `publishes restored state after optimistic rollback (${campaign.name})`,
      async (value) => {
        await expectPublicationMatches({
          type: `optimisticRollback`,
          value,
        })
      },
    )
  }
})

/**
 * A held ordered repair can run the graph several times before one public
 * publication. Row 1 moves behind row 2 while its payload changes A→B→A.
 * The expected public snapshot comes from sorting source rows, not from
 * intermediate retractions. Subscribers receive one layout notification
 * with no value-change message. The A→B→A cell rejects the wrong rule that an
 * unchanged final value needs no layout notification. A final-value C cell
 * checks a value update.
 */
describe(`held include publication`, () => {
  it.each([
    { intermediate: `A`, final: `A` },
    { intermediate: `B`, final: `A` },
    { intermediate: `B`, final: `C` },
  ])(
    `compares the final $intermediate to $final row with the last public snapshot`,
    async ({ intermediate, final }) => {
      type Row = { id: number; rank: number; value: string }
      const sourceRows = new Map<number, Row>([
        [1, { id: 1, rank: 1, value: `A` }],
        [2, { id: 2, rank: 2, value: `X` }],
      ])
      const expectedRows = () =>
        [...sourceRows.values()]
          .sort((left, right) => left.rank - right.rank)
          .map(({ id, value }) => ({
            id,
            value,
            children: id === 1 ? [10] : [],
          }))

      let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let holdRepair = false
      const held: Array<() => void> = []
      let requests = 0
      const source = createCollection<Row, number>({
        id: `held-publication-source-${nextCollectionId++}`,
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
                if (requests === 1) {
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
      const children = createControlledCollection(`held-publication-child`, [
        { id: 10, parentId: 1 },
      ])
      children.collection.createIndex((child) => child.parentId, {
        indexType: BasicIndex,
      })
      const query = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ parent: source })
            .orderBy(({ parent }) => parent.rank)
            .limit(2)
            .select(({ parent }) => ({
              id: parent.id,
              value: parent.value,
              children: materialize(
                q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parentId, parent.id))
                  .select(({ child }) => ({ id: child.id })),
              ),
            })),
        getKey: (row) => row.id,
      })
      const snapshot = () =>
        query.toArray.map(({ id, value, children: childRows }) => ({
          id,
          value,
          children: childRows.map(({ id: childId }) => childId),
        }))
      const callbacks: Array<{
        rows: ReturnType<typeof snapshot>
        changes: Array<{
          type: string
          key: string | number
          value?: string
          previousValue?: string
        }>
      }> = []
      const effectBatches: Array<
        Array<{
          type: string
          key: string | number
          value: string
          previousValue: string | undefined
        }>
      > = []
      let effect: ReturnType<typeof createEffect> | undefined
      let unsubscribe: (() => void) | undefined

      await withHistoryCleanup(
        async () => {
          await query.preload()
          effect = createEffect<{ id: number; value: string }, number>({
            query: (q) =>
              q
                .from({ parent: source })
                .orderBy(({ parent }) => parent.rank)
                .limit(2)
                .select(({ parent }) => ({
                  id: parent.id,
                  value: parent.value,
                })),
            skipInitial: true,
            onBatch: (events) => {
              effectBatches.push(
                events.map((event) => ({
                  type: event.type,
                  key: event.key,
                  value: event.value.value,
                  previousValue:
                    event.type === `update`
                      ? event.previousValue.value
                      : undefined,
                })),
              )
            },
          })
          await flushPromises()
          const before = snapshot()
          expect(before).toEqual(expectedRows())
          const subscription = query.subscribeChanges(
            (changes) => {
              callbacks.push({
                rows: snapshot(),
                changes: changes.map((change) =>
                  change.type === `update`
                    ? {
                        type: change.type,
                        key: change.key,
                        value: change.value.value,
                        previousValue: change.previousValue?.value,
                      }
                    : { type: change.type, key: change.key },
                ),
              })
            },
            { includeInitialState: false },
          )
          unsubscribe = () => subscription.unsubscribe()

          holdRepair = true
          const write = (row: Row) => {
            sourceRows.set(row.id, { ...row })
            sync.begin()
            sync.write({ type: `update`, value: { ...row } })
            expect(sync.commit()).toBe(true)
          }
          write({ id: 1, rank: 2.5, value: `A` })
          write({ id: 1, rank: 2.5, value: intermediate })
          write({ id: 1, rank: 2.5, value: final })
          expect(held.length).toBeGreaterThan(0)
          expect(snapshot()).toEqual(before)
          expect(callbacks).toEqual([])
          expect(effectBatches).toEqual([])

          holdRepair = false
          for (const release of held.splice(0)) release()
          await flushPromises()
          const after = expectedRows()
          expect(snapshot()).toEqual(after)
          expect(callbacks).toEqual([
            {
              rows: after,
              changes:
                final === `A`
                  ? []
                  : [
                      {
                        type: `update`,
                        key: 1,
                        value: final,
                        previousValue: `A`,
                      },
                    ],
            },
          ])
          expect(effectBatches).toEqual(
            final === `A`
              ? []
              : [
                  [
                    {
                      type: `update`,
                      key: 1,
                      value: final,
                      previousValue: `A`,
                    },
                  ],
                ],
          )
        },
        () => [
          () => {
            holdRepair = false
            for (const release of held) release()
          },
          () => unsubscribe?.(),
          () => effect?.dispose(),
          () => query.cleanup(),
          () => source.cleanup(),
          () => children.collection.cleanup(),
        ],
      )
    },
  )
})
