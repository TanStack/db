import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withExpectedRejection,
} from '../utils.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'

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

type SyncChange<T> = {
  type: `insert` | `update` | `delete`
  value: T
}

type PublicationAction =
  | { type: `parentScalar`; value: number }
  | { type: `childScalar`; value: number }
  | { type: `parentRoute`; group: number }
  | { type: `atomicReplace`; group: number; value: number }
  | { type: `optimisticConfirm`; value: number }
  | { type: `optimisticRollback`; value: number }
  | { type: `parentThenChild`; parentValue: number; childValue: number }

let nextCollectionId = 0

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
) {
  const options = mockSyncCollectionOptions<T>({
    id: `${name}-${nextCollectionId++}`,
    getKey: (row) => row.id,
    initialData: initialData.map((row) => ({ ...row })),
  })
  const collection = createCollection(options)

  const writeBatch = (changes: ReadonlyArray<SyncChange<T>>): void => {
    options.utils.begin()
    for (const change of changes) options.utils.write(change)
    options.utils.commit()
  }

  return {
    collection,
    write(type: SyncChange<T>[`type`], value: T): void {
      writeBatch([{ type, value: { ...value } }])
    },
    writeBatch,
    resolveSync: options.utils.resolveSync,
    rejectSync: options.utils.rejectSync,
  }
}

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
}

type PublicationContext = {
  sources: {
    parents: ReturnType<typeof createControlledCollection<ParentRow>>
    children: ReturnType<typeof createControlledCollection<ChildRow>>
    otherChildren: ReturnType<typeof createControlledCollection<ChildRow>>
    metadata: ReturnType<typeof createControlledCollection<MetadataRow>>
  }
  queries: ReturnType<typeof createLayeredQuery>
  model: {
    parents: Map<number, ParentRow>
    children: Map<number, ChildRow>
    otherChildren: Map<number, ChildRow>
  }
}

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
  observe: ({ queries }) => ({
    q1: stripVirtualProperties(queries.q1.toArray) as Array<PublishedRow>,
    q2: stripVirtualProperties(queries.q2.toArray) as Array<PublishedRow>,
  }),
  recompute: (context) => {
    const expected = recomputeRows(context)
    return {
      q1: expected.map((row) => structuredClone(row)),
      q2: expected.map((row) => structuredClone(row)),
    }
  },
  assertEqual: (observed, expected) => {
    expect(observed).toEqual(expected)
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
    start: async ({ queries }) => {
      await queries.q1.preload()
      await queries.q2.preload()
    },
    apply: async (action, context, checkpoint) => {
      if (action.type === `parentThenChild`) {
        const parent = context.model.parents.get(initialParent.id)
        const child = context.model.children.get(initialChild.id)
        if (!parent || !child) throw new Error(`Missing publication fixture`)

        const nextParent = { ...parent, value: action.parentValue }
        context.sources.parents.write(`update`, nextParent)
        context.model.parents.set(nextParent.id, { ...nextParent })

        checkpoint()

        const nextChild = { ...child, value: action.childValue }
        context.sources.children.write(`update`, nextChild)
        context.model.children.set(nextChild.id, { ...nextChild })
        return
      }

      if (action.type === `childScalar`) {
        const currentChild = context.model.children.get(initialChild.id)
        if (!currentChild) throw new Error(`Missing publication child`)
        const nextChild = { ...currentChild, value: action.value }
        context.sources.children.write(`update`, nextChild)
        context.model.children.set(nextChild.id, { ...nextChild })
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
        context.sources.parents.writeBatch([
          { type: `delete`, value: { ...current } },
          { type: `insert`, value: { ...next } },
        ])
        context.model.parents.set(next.id, { ...next })
        return
      }

      if (
        action.type === `optimisticConfirm` ||
        action.type === `optimisticRollback`
      ) {
        const transaction = context.sources.parents.collection.update(
          next.id,
          (draft) => {
            draft.value = next.value
          },
        )
        const previous = { ...current }
        context.model.parents.set(next.id, { ...next })

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
          await settleRollback(
            context.sources.parents.rejectSync,
            transaction.isPersisted.promise,
          )
          context.model.parents.set(previous.id, previous)
        }

        if (optimisticFailure) throw optimisticFailure
        return
      }

      context.sources.parents.write(`update`, next)
      context.model.parents.set(next.id, { ...next })
    },
    cleanup: async ({ queries, sources }) => {
      await queries.q2.cleanup()
      await queries.q1.cleanup()
      await Promise.all([
        sources.parents.collection.cleanup(),
        sources.children.collection.cleanup(),
        sources.otherChildren.collection.cleanup(),
        sources.metadata.collection.cleanup(),
      ])
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

describe(`layered-query publication oracle`, () => {
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
      fcTest.prop([changedValueArbitrary], oraclePropertyOptions(12))(
        `publishes #1713 updates through a ${q1Shape} Q1 and ${q2Shape} Q2`,
        async (value) => {
          await expectPublicationMatches(
            { type: `parentScalar`, value },
            false,
            q1Shape,
            q2Shape,
          )
        },
      )

      fcTest.prop(
        [changedValueArbitrary, changedChildValueArbitrary],
        oraclePropertyOptions(12),
      )(
        `recovers a ${q1Shape} Q1 and ${q2Shape} Q2 after a child update`,
        async (parentValue, childValue) => {
          await expectPublicationMatches(
            { type: `parentThenChild`, parentValue, childValue },
            false,
            q1Shape,
            q2Shape,
          )
        },
      )

      fcTest.prop([changedValueArbitrary], oraclePropertyOptions(8))(
        `publishes optimistic state before confirmation through a ${q1Shape} Q1 and ${q2Shape} Q2`,
        async (value) => {
          await expectPublicationMatches(
            { type: `optimisticConfirm`, value },
            true,
            q1Shape,
            q2Shape,
          )
        },
      )

      fcTest.prop([changedValueArbitrary], oraclePropertyOptions(8))(
        `publishes state after optimistic confirmation through a ${q1Shape} Q1 and ${q2Shape} Q2`,
        async (value) => {
          await expectPublicationMatches(
            { type: `optimisticConfirm`, value },
            false,
            q1Shape,
            q2Shape,
          )
        },
      )
    }
  }

  fcTest.prop([changedChildValueArbitrary], oraclePropertyOptions(100))(
    `publishes child-only scalar updates through both layers`,
    async (value) => {
      await expectPublicationMatches({ type: `childScalar`, value })
    },
  )

  fcTest.prop([fc.constantFrom(20, 30)], oraclePropertyOptions(100))(
    `compares route transitions at both query layers`,
    async (group) => {
      await expectPublicationMatches({ type: `parentRoute`, group })
    },
  )

  fcTest.prop(
    [
      fc.record({
        group: fc.constantFrom(10, 20, 30),
        value: changedValueArbitrary,
      }),
    ],
    oraclePropertyOptions(100),
  )(`compares atomic parent replacements at both query layers`, async (row) => {
    await expectPublicationMatches({ type: `atomicReplace`, ...row })
  })

  fcTest.prop([changedValueArbitrary], oraclePropertyOptions(100))(
    `publishes restored state after optimistic rollback`,
    async (value) => {
      await expectPublicationMatches({
        type: `optimisticRollback`,
        value,
      })
    },
  )
})
