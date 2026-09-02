import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { Collection } from '../../src/collection/index.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { ChangeMessage, SyncConfig } from '../../src/types.js'

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
type PendingPublicationOperation = `insert` | `update` | `delete`
type PendingPublicationDepth = `direct` | `layered`
type PendingPublicationShape = `passThrough` | `orderBy` | `select`
type PendingPublicationSettlement = `succeeds` | `rejects`
type SourceConfirmationOperation = `insert` | `update` | `delete`
type SourceConfirmationInterleaving =
  | `handlerEcho`
  | `replacementWhilePending`
  | `replacementAfterSuccess`
type SourceConfirmationSettlement = `succeeds` | `rejects`

type PendingPublicationRow = {
  id: number
  value: number
}

type PendingPublicationEvent =
  | {
      type: `insert` | `delete`
      key: number
      value: PendingPublicationRow
    }
  | {
      type: `update`
      key: number
      value: PendingPublicationRow
      previousValue: PendingPublicationRow
    }

type PendingPublicationSourceChange = {
  operation: PendingPublicationOperation
  row: PendingPublicationRow
}

type PendingPublicationScenario = {
  optimisticOperation: PendingPublicationOperation
  sourceChanges: ReadonlyArray<PendingPublicationSourceChange>
  sameKey: boolean
}

type OffDiagonalSameKeyHistory = PendingPublicationScenario & {
  name: string
}

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

const pendingPublicationOperations = [`insert`, `update`, `delete`] as const
const pendingPublicationDepths = [`direct`, `layered`] as const
const pendingPublicationShapes = [`passThrough`, `orderBy`, `select`] as const
const pendingPublicationSettlements = [`succeeds`, `rejects`] as const

const optimisticExistingRow: PendingPublicationRow = { id: 1, value: 10 }
const sourceExistingRow: PendingPublicationRow = { id: 2, value: 20 }
const optimisticInsertedRow: PendingPublicationRow = { id: 3, value: 30 }
const sourceInsertedRow: PendingPublicationRow = { id: 4, value: 15 }

const offDiagonalSameKeyHistories = [
  {
    name: `source inserts then updates the optimistic insert key`,
    optimisticOperation: `insert`,
    sourceChanges: [
      { operation: `insert`, row: { id: 3, value: 20 } },
      { operation: `update`, row: { id: 3, value: 15 } },
    ],
    sameKey: true,
  },
  {
    name: `source inserts then deletes the optimistic insert key`,
    optimisticOperation: `insert`,
    sourceChanges: [
      { operation: `insert`, row: { id: 3, value: 20 } },
      { operation: `delete`, row: { id: 3, value: 20 } },
    ],
    sameKey: true,
  },
  {
    name: `source deletes the optimistic update key`,
    optimisticOperation: `update`,
    sourceChanges: [{ operation: `delete`, row: { ...optimisticExistingRow } }],
    sameKey: true,
  },
  {
    name: `source updates the optimistic delete key`,
    optimisticOperation: `delete`,
    sourceChanges: [{ operation: `update`, row: { id: 1, value: 5 } }],
    sameKey: true,
  },
] as const satisfies ReadonlyArray<OffDiagonalSameKeyHistory>

function pendingOperationRow(
  operation: PendingPublicationOperation,
  owner: `optimistic` | `source`,
): PendingPublicationRow {
  if (owner === `optimistic`) {
    if (operation === `insert`) return { ...optimisticInsertedRow }
    if (operation === `update`) return { ...optimisticExistingRow, value: 11 }
    return { ...optimisticExistingRow }
  }

  if (operation === `insert`) return { ...sourceInsertedRow }
  if (operation === `update`) return { ...sourceExistingRow, value: 5 }
  return { ...sourceExistingRow }
}

function applyPendingOperation(
  rows: Map<number, PendingPublicationRow>,
  operation: PendingPublicationOperation,
  row: PendingPublicationRow,
): void {
  if (operation === `delete`) rows.delete(row.id)
  else rows.set(row.id, { ...row })
}

function expectedPendingRows(
  rows: ReadonlyMap<number, PendingPublicationRow>,
  shape: PendingPublicationShape,
  orderedBase: ReadonlyMap<number, PendingPublicationRow> = rows,
): Array<PendingPublicationRow> {
  if (shape !== `orderBy`) {
    return [...rows.values()]
      .map((row) => ({ ...row }))
      .sort((left, right) => left.id - right.id)
  }

  const baseKeys = [...orderedBase.values()]
    .sort((left, right) => left.value - right.value || left.id - right.id)
    .map((row) => row.id)
  const optimisticOnlyKeys = [...rows.keys()]
    .filter((key) => !orderedBase.has(key))
    .sort((left, right) => left - right)
  return [...baseKeys, ...optimisticOnlyKeys]
    .filter((key) => rows.has(key))
    .map((key) => ({ ...rows.get(key)! }))
}

function expectedPendingEvent(
  type: PendingPublicationOperation,
  key: number,
  before: ReadonlyMap<number, PendingPublicationRow>,
  after: ReadonlyMap<number, PendingPublicationRow>,
): PendingPublicationEvent {
  if (type === `insert`) {
    return { type, key, value: { ...after.get(key)! } }
  }
  if (type === `delete`) {
    return { type, key, value: { ...before.get(key)! } }
  }
  return {
    type,
    key,
    value: { ...after.get(key)! },
    previousValue: { ...before.get(key)! },
  }
}

function pendingPublicationRowsEqual(
  left: PendingPublicationRow | undefined,
  right: PendingPublicationRow | undefined,
): boolean {
  return left?.id === right?.id && left?.value === right?.value
}

function expectedPendingTransition(
  key: number,
  before: ReadonlyMap<number, PendingPublicationRow>,
  after: ReadonlyMap<number, PendingPublicationRow>,
  includeLogicalNoopUpdate = false,
): PendingPublicationEvent | undefined {
  const previousValue = before.get(key)
  const value = after.get(key)
  if (!previousValue && !value) return undefined
  if (!previousValue) return { type: `insert`, key, value: { ...value! } }
  if (!value) return { type: `delete`, key, value: { ...previousValue } }
  if (
    !includeLogicalNoopUpdate &&
    pendingPublicationRowsEqual(previousValue, value)
  ) {
    return undefined
  }
  return {
    type: `update`,
    key,
    value: { ...value },
    previousValue: { ...previousValue },
  }
}

function pendingPublicationEvent(
  change: ChangeMessage<PendingPublicationRow, number>,
): PendingPublicationEvent {
  const value = { id: change.value.id, value: change.value.value }
  if (change.type !== `update`) {
    return { type: change.type, key: Number(change.key), value }
  }
  return {
    type: `update`,
    key: Number(change.key),
    value,
    previousValue: {
      id: change.previousValue!.id,
      value: change.previousValue!.value,
    },
  }
}

function createPendingPublicationQuery(
  source: Collection<PendingPublicationRow, number>,
  shape: PendingPublicationShape,
) {
  return createLiveQueryCollection({
    id: `pending-publication-${shape}-${nextCollectionId++}`,
    query: (query) => {
      const rows = query.from({ row: source })
      if (shape === `orderBy`) {
        return rows.orderBy(({ row }) => row.value)
      }
      if (shape === `select`) {
        return rows.select(({ row }) => ({ id: row.id, value: row.value }))
      }
      return rows
    },
    getKey: (row) => row.id,
  })
}

function observePendingPublication(
  collection: Collection<PendingPublicationRow, number>,
  shape: PendingPublicationShape,
) {
  const batches: Array<Array<PendingPublicationEvent>> = []
  const callbackSnapshots: Array<Array<PendingPublicationRow>> = []
  const currentRows = () => {
    const rows = collection.toArray.map((row) => ({
      id: row.id,
      value: row.value,
    }))
    return shape === `orderBy`
      ? rows
      : rows.sort((left, right) => left.id - right.id)
  }
  const subscription = collection.subscribeChanges(
    (changes) => {
      batches.push(changes.map(pendingPublicationEvent))
      callbackSnapshots.push(currentRows())
    },
    { includeInitialState: false },
  )

  return { batches, callbackSnapshots, currentRows, subscription }
}

async function expectSourcePublicationDuringPendingMutation(
  scenario: PendingPublicationScenario,
  depth: PendingPublicationDepth,
  shape: PendingPublicationShape,
  settlement: PendingPublicationSettlement,
): Promise<void> {
  const { optimisticOperation, sourceChanges, sameKey } = scenario
  const initialRows = [optimisticExistingRow, sourceExistingRow]
  const initialState = new Map(
    initialRows.map((row) => [row.id, { ...row }] as const),
  )
  const source = createControlledCollection(
    `pending-publication-source`,
    initialRows,
  )
  const q1 = createPendingPublicationQuery(source.collection, shape)
  const q2 = createPendingPublicationQuery(q1, shape)
  const target = depth === `direct` ? q1 : q2
  const persistence = createDeferred<void>()
  const settlementError = new Error(`pending publication rollback`)

  await target.preload()
  const terminal = observePendingPublication(target, shape)
  const intermediate =
    depth === `layered` ? observePendingPublication(q1, shape) : undefined

  const optimisticRow = pendingOperationRow(optimisticOperation, `optimistic`)
  const insertTarget = target.insert.bind(target) as unknown as (
    row: PendingPublicationRow,
  ) => unknown
  const mutate = createOptimisticAction<PendingPublicationOperation>({
    onMutate: (operation) => {
      if (operation === `insert`) {
        insertTarget(optimisticRow)
      } else if (operation === `update`) {
        target.update(optimisticRow.id, (draft) => {
          draft.value = optimisticRow.value
        })
      } else {
        target.delete(optimisticRow.id)
      }
    },
    mutationFn: () => persistence.promise,
  })

  const transaction = mutate(optimisticOperation)
  const afterOptimistic = new Map(initialState)
  applyPendingOperation(afterOptimistic, optimisticOperation, optimisticRow)
  const optimisticEvent = expectedPendingEvent(
    optimisticOperation,
    optimisticRow.id,
    initialState,
    afterOptimistic,
  )

  try {
    expect(terminal.batches).toEqual([[optimisticEvent]])
    expect(terminal.callbackSnapshots).toEqual([
      expectedPendingRows(afterOptimistic, shape, initialState),
    ])
    expect(terminal.currentRows()).toEqual(
      expectedPendingRows(afterOptimistic, shape, initialState),
    )
    if (intermediate) {
      expect(intermediate.batches).toEqual([])
      expect(intermediate.callbackSnapshots).toEqual([])
      expect(intermediate.currentRows()).toEqual(
        expectedPendingRows(initialState, shape),
      )
    }

    const afterSource = new Map(initialState)
    let whilePending = new Map(afterOptimistic)
    const intermediateSourceBatches: Array<Array<PendingPublicationEvent>> = []
    const intermediateSourceSnapshots: Array<Array<PendingPublicationRow>> = []
    const terminalSourceBatches: Array<Array<PendingPublicationEvent>> = []
    const terminalSourceSnapshots: Array<Array<PendingPublicationRow>> = []

    for (const { operation, row } of sourceChanges) {
      const beforeSource = new Map(afterSource)
      const beforeTerminal = new Map(whilePending)
      source.write(operation, row)
      applyPendingOperation(afterSource, operation, row)

      intermediateSourceBatches.push([
        expectedPendingEvent(operation, row.id, beforeSource, afterSource),
      ])
      intermediateSourceSnapshots.push(expectedPendingRows(afterSource, shape))

      const nextTerminal = new Map(afterSource)
      applyPendingOperation(nextTerminal, optimisticOperation, optimisticRow)
      const terminalSourceEvent = expectedPendingTransition(
        row.id,
        beforeTerminal,
        nextTerminal,
      )
      if (terminalSourceEvent) {
        terminalSourceBatches.push([terminalSourceEvent])
        terminalSourceSnapshots.push(
          expectedPendingRows(nextTerminal, shape, afterSource),
        )
      }
      whilePending = nextTerminal
    }

    if (intermediate) {
      expect(intermediate.batches).toEqual(intermediateSourceBatches)
      expect(intermediate.callbackSnapshots).toEqual(
        intermediateSourceSnapshots,
      )
      expect(intermediate.currentRows()).toEqual(
        expectedPendingRows(afterSource, shape),
      )
    }

    expect(terminal.batches).toEqual([
      [optimisticEvent],
      ...terminalSourceBatches,
    ])
    expect(terminal.callbackSnapshots).toEqual([
      expectedPendingRows(afterOptimistic, shape, initialState),
      ...terminalSourceSnapshots,
    ])
    expect(terminal.currentRows()).toEqual(
      expectedPendingRows(whilePending, shape, afterSource),
    )

    if (settlement === `succeeds`) {
      persistence.resolve()
      await transaction.isPersisted.promise
    } else {
      persistence.reject(settlementError)
      await expect(transaction.isPersisted.promise).rejects.toBe(
        settlementError,
      )
    }
    await flushPromises()

    const settlementEvent = expectedPendingTransition(
      optimisticRow.id,
      whilePending,
      afterSource,
      sameKey,
    )
    const settlementBatches = settlementEvent ? [[settlementEvent]] : []
    expect(terminal.batches).toEqual([
      [optimisticEvent],
      ...terminalSourceBatches,
      ...settlementBatches,
    ])
    expect(terminal.callbackSnapshots).toEqual([
      expectedPendingRows(afterOptimistic, shape, initialState),
      ...terminalSourceSnapshots,
      ...settlementBatches.map(() =>
        expectedPendingRows(afterSource, shape, afterSource),
      ),
    ])
    expect(terminal.currentRows()).toEqual(
      expectedPendingRows(afterSource, shape, afterSource),
    )
    if (intermediate) {
      expect(intermediate.batches).toEqual(intermediateSourceBatches)
      expect(intermediate.callbackSnapshots).toEqual(
        intermediateSourceSnapshots,
      )
      expect(intermediate.currentRows()).toEqual(
        expectedPendingRows(afterSource, shape),
      )
    }
  } finally {
    persistence.resolve()
    await transaction.isPersisted.promise.catch(() => undefined)
    intermediate?.subscription.unsubscribe()
    terminal.subscription.unsubscribe()
    await q2.cleanup()
    await q1.cleanup()
    await source.collection.cleanup()
  }
}

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
      fcTest.prop(
        [changedValueArbitrary],
        oraclePropertyOptions(
          12,
          `includes-publication.parent-scalar.${q1Shape}.${q2Shape}`,
        ),
      )(
        `publishes scalar parent updates through a ${q1Shape} Q1 and ${q2Shape} Q2`,
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
        oraclePropertyOptions(
          12,
          `includes-publication.parent-then-child.${q1Shape}.${q2Shape}`,
        ),
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

      fcTest.prop(
        [changedValueArbitrary],
        oraclePropertyOptions(
          8,
          `includes-publication.optimistic-before-confirm.${q1Shape}.${q2Shape}`,
        ),
      )(
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

      fcTest.prop(
        [changedValueArbitrary],
        oraclePropertyOptions(
          8,
          `includes-publication.optimistic-after-confirm.${q1Shape}.${q2Shape}`,
        ),
      )(
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

  fcTest.prop(
    [changedChildValueArbitrary],
    oraclePropertyOptions(100, `includes-publication.child-scalar`),
  )(
    `publishes child-only scalar updates through both layers`,
    async (value) => {
      await expectPublicationMatches({ type: `childScalar`, value })
    },
  )

  fcTest.prop(
    [fc.constantFrom(20, 30)],
    oraclePropertyOptions(100, `includes-publication.parent-route`),
  )(`compares route transitions at both query layers`, async (group) => {
    await expectPublicationMatches({ type: `parentRoute`, group })
  })

  fcTest.prop(
    [
      fc.record({
        group: fc.constantFrom(10, 20, 30),
        value: changedValueArbitrary,
      }),
    ],
    oraclePropertyOptions(
      100,
      `includes-publication.atomic-parent-replacement`,
    ),
  )(`compares atomic parent replacements at both query layers`, async (row) => {
    await expectPublicationMatches({ type: `atomicReplace`, ...row })
  })

  fcTest.prop(
    [changedValueArbitrary],
    oraclePropertyOptions(100, `includes-publication.optimistic-rollback`),
  )(`publishes restored state after optimistic rollback`, async (value) => {
    await expectPublicationMatches({
      type: `optimisticRollback`,
      value,
    })
  })
})

describe(`source publication across pending derived mutations`, () => {
  for (const settlement of pendingPublicationSettlements) {
    it(`keeps ordinary source sync parked while layered graph publication ${settlement}`, async () => {
      let sync!: Parameters<
        SyncConfig<PendingPublicationRow, number>[`sync`]
      >[0]
      const source = createCollection<PendingPublicationRow, number>({
        id: `ordinary-source-prefix-${nextCollectionId++}`,
        getKey: (row) => row.id,
        sync: {
          sync: (methods) => {
            sync = methods
            methods.markReady()
          },
        },
      })
      await source.preload()
      sync.begin()
      sync.write({ type: `insert`, value: { ...optimisticExistingRow } })
      sync.write({ type: `insert`, value: { ...sourceExistingRow } })
      const initialReceipt = sync.commit()
      if (initialReceipt !== true) await initialReceipt

      const q1 = createPendingPublicationQuery(source, `passThrough`)
      const q2 = createPendingPublicationQuery(q1, `select`)
      await q2.preload()
      const observed = observePendingPublication(q2, `select`)
      const persistence = createDeferred<void>()
      const settlementError = new Error(`ordinary source prefix rollback`)
      const mutate = createOptimisticAction({
        onMutate: () => {
          source.update(1, (draft) => {
            draft.value = 11
          })
        },
        mutationFn: () => persistence.promise,
      })
      const transaction = mutate()

      try {
        expect(q2.get(1)?.value).toBe(11)
        observed.batches.length = 0
        observed.callbackSnapshots.length = 0

        sync.begin()
        sync.write({ type: `update`, value: { id: 2, value: 5 } })
        const parkedReceipt = sync.commit()
        expect(parkedReceipt).not.toBe(true)
        if (parkedReceipt === true) {
          throw new Error(`ordinary source sync did not park`)
        }
        let parkedReceiptSettled = false
        void parkedReceipt.then(() => {
          parkedReceiptSettled = true
        })
        await flushPromises()

        expect(parkedReceiptSettled).toBe(false)
        expect(source.get(2)?.value).toBe(20)
        expect(q2.get(2)?.value).toBe(20)
        expect(
          observed.batches.flat().filter((event) => event.key === 2),
        ).toEqual([])

        if (settlement === `succeeds`) {
          persistence.resolve()
          await transaction.isPersisted.promise
        } else {
          persistence.reject(settlementError)
          await expect(transaction.isPersisted.promise).rejects.toBe(
            settlementError,
          )
        }
        await parkedReceipt
        await flushPromises()

        expect(parkedReceiptSettled).toBe(true)
        expect(source.get(2)?.value).toBe(5)
        expect(q2.get(2)?.value).toBe(5)
        expect(
          observed.batches.flat().filter((event) => event.key === 2),
        ).toEqual([
          {
            type: `update`,
            key: 2,
            value: { id: 2, value: 5 },
            previousValue: { id: 2, value: 20 },
          },
        ])
      } finally {
        persistence.resolve()
        await transaction.isPersisted.promise.catch(() => undefined)
        observed.subscription.unsubscribe()
        await q2.cleanup()
        await q1.cleanup()
        await source.cleanup()
      }
    })
  }

  async function expectSourceConfirmationPreservesGraphIntegrity(
    operation: SourceConfirmationOperation,
    depth: PendingPublicationDepth,
    interleaving: SourceConfirmationInterleaving,
    settlement: SourceConfirmationSettlement,
  ) {
    type Row = { id: number; value: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const handlerCanFinish = createDeferred<void>()
    let echoFromHandler = interleaving === `handlerEcho`
    let handlerFailure =
      settlement === `rejects`
        ? new Error(`source confirmation handler rejection`)
        : undefined

    const commitSync = async () => {
      const receipt = sync.commit()
      if (receipt !== true) await receipt
    }

    const source = createCollection<Row, number>({
      id: `same-key-source-confirmation-${nextCollectionId++}`,
      getKey: (row) => row.id,
      sync: {
        sync: (config) => {
          sync = config
          config.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        if (!echoFromHandler) {
          if (interleaving === `replacementWhilePending`) {
            await handlerCanFinish.promise
          }
          if (handlerFailure) throw handlerFailure
          return
        }
        sync.begin()
        sync.write({
          type: `insert`,
          value: transaction.mutations[0].modified,
        })
        await commitSync()
        if (handlerFailure) throw handlerFailure
      },
      onUpdate: async ({ transaction }) => {
        if (!echoFromHandler) {
          if (interleaving === `replacementWhilePending`) {
            await handlerCanFinish.promise
          }
          if (handlerFailure) throw handlerFailure
          return
        }
        sync.begin()
        sync.write({
          type: `update`,
          value: transaction.mutations[0].modified,
        })
        await commitSync()
        if (handlerFailure) throw handlerFailure
      },
      onDelete: async ({ transaction }) => {
        if (!echoFromHandler) {
          if (interleaving === `replacementWhilePending`) {
            await handlerCanFinish.promise
          }
          if (handlerFailure) throw handlerFailure
          return
        }
        sync.begin()
        sync.write({
          type: `delete`,
          key: transaction.mutations[0].key,
        })
        await commitSync()
        if (handlerFailure) throw handlerFailure
      },
    })
    await source.preload()

    if (operation !== `insert`) {
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: 0 } })
      await commitSync()
    }

    const q1 = createLiveQueryCollection({
      id: `same-key-source-confirmation-query-${nextCollectionId++}`,
      query: (q) =>
        q.from({ row: source }).select(({ row }) => ({
          id: row.id,
          value: row.value,
        })),
      getKey: (row) => row.id,
    })
    const q2 =
      depth === `layered`
        ? createLiveQueryCollection({
            id: `same-key-source-confirmation-layer-${nextCollectionId++}`,
            query: (q) =>
              q.from({ row: q1 }).select(({ row }) => ({
                id: row.id,
                value: row.value,
              })),
            getKey: (row) => row.id,
          })
        : undefined
    const query = q2 ?? q1
    const sourceEvents: Array<{
      type: string
      key: string | number
      value?: number
    }> = []
    const queryEvents: Array<{
      type: string
      key: string | number
      value?: number
    }> = []
    const sourceSubscription = source.subscribeChanges((changes) => {
      sourceEvents.push(
        ...changes.map((change) => ({
          type: change.type,
          key: change.key,
          value: change.value.value,
        })),
      )
    })
    const subscription = query.subscribeChanges((changes) => {
      queryEvents.push(
        ...changes.map((change) => ({
          type: change.type,
          key: change.key,
          value: change.value.value,
        })),
      )
    })

    try {
      await query.preload()

      const firstTransaction = (() => {
        switch (operation) {
          case `insert`:
            return source.insert({ id: 1, value: 1 })
          case `update`:
            return source.update(1, (draft) => {
              draft.value = 1
            })
          case `delete`:
            return source.delete(1)
        }
      })()
      sourceEvents.length = 0
      queryEvents.length = 0

      if (interleaving === `replacementWhilePending`) {
        sync.begin()
        sync.truncate()
        sync.write({ type: `insert`, value: { id: 1, value: 99 } })
        await commitSync()

        if (operation === `delete`) {
          expect(source.get(1)).toBeUndefined()
          expect(query.get(1)).toBeUndefined()
        } else {
          expect(source.get(1)?.value).toBe(1)
          expect(source.get(1)?.$synced).toBe(false)
          expect(query.get(1)?.value).toBe(1)
        }
        expect(sourceEvents).toEqual(
          operation === `delete`
            ? []
            : [
                { type: `delete`, key: 1, value: 1 },
                { type: `insert`, key: 1, value: 1 },
              ],
        )
        expect(queryEvents).toEqual([])

        handlerCanFinish.resolve()
      }
      if (handlerFailure) {
        await expect(firstTransaction.isPersisted.promise).rejects.toBe(
          handlerFailure,
        )
        handlerFailure = undefined
      } else {
        await firstTransaction.isPersisted.promise
      }

      if (interleaving === `replacementAfterSuccess`) {
        sync.begin()
        sync.truncate()
        sync.write({ type: `insert`, value: { id: 1, value: 99 } })
        await commitSync()
      }

      if (interleaving !== `handlerEcho` && settlement === `succeeds`) {
        if (operation === `delete`) {
          expect(source.get(1)).toBeUndefined()
          expect(query.get(1)).toBeUndefined()
        } else {
          expect(source.get(1)?.value).toBe(1)
          expect(source.get(1)?.$synced).toBe(false)
          expect(query.get(1)?.value).toBe(1)
        }

        echoFromHandler = true
        await source.insert({ id: 2, value: 2 }).isPersisted.promise

        // A replacement is not confirmation, so the optimistic value survives
        // it. Once persistence has succeeded, however, the next ordinary sync
        // drain retires an unconfirmed direct overlay and reveals the base.
        expect(source.get(1)?.value).toBe(99)
        expect(source.get(1)?.$synced).toBe(true)
        expect(query.get(1)?.value).toBe(99)

        sync.begin()
        if (operation === `delete`) {
          sync.write({ type: `delete`, key: 1 })
        } else {
          sync.write({ type: `update`, value: { id: 1, value: 1 } })
        }
        await commitSync()
      }

      if (
        interleaving === `replacementWhilePending` &&
        settlement === `rejects`
      ) {
        expect(source.get(1)?.value).toBe(99)
        expect(source.get(1)?.$synced).toBe(true)
        expect(query.get(1)?.value).toBe(99)
        echoFromHandler = true
      } else if (operation === `delete`) {
        expect(source.get(1)).toBeUndefined()
        expect(query.get(1)).toBeUndefined()
      } else {
        expect(source.get(1)?.value).toBe(1)
        expect(source.get(1)?.$synced).toBe(true)
        expect(query.get(1)?.value).toBe(1)
      }

      const probeTransaction =
        operation === `delete` &&
        !(
          interleaving === `replacementWhilePending` && settlement === `rejects`
        )
          ? source.insert({ id: 1, value: 2 })
          : source.update(1, (draft) => {
              draft.value = 2
            })
      await probeTransaction.isPersisted.promise

      expect(source.get(1)?.value).toBe(2)
      expect(source.get(1)?.$synced).toBe(true)
      expect(query.get(1)?.value).toBe(2)
    } finally {
      subscription.unsubscribe()
      sourceSubscription.unsubscribe()
      if (q2) await q2.cleanup()
      await q1.cleanup()
      await source.cleanup()
    }
  }

  for (const depth of pendingPublicationDepths) {
    for (const interleaving of [
      `handlerEcho`,
      `replacementWhilePending`,
      `replacementAfterSuccess`,
    ] as const satisfies ReadonlyArray<SourceConfirmationInterleaving>) {
      for (const settlement of [
        `succeeds`,
        `rejects`,
      ] as const satisfies ReadonlyArray<SourceConfirmationSettlement>) {
        if (
          interleaving === `replacementAfterSuccess` &&
          settlement === `rejects`
        ) {
          continue
        }
        for (const operation of [
          `insert`,
          `update`,
          `delete`,
        ] as const satisfies ReadonlyArray<SourceConfirmationOperation>) {
          it(`preserves ${depth} graph integrity after a same-key optimistic ${operation} with ${interleaving} that ${settlement}`, async () => {
            await expectSourceConfirmationPreservesGraphIntegrity(
              operation,
              depth,
              interleaving,
              settlement,
            )
          })
        }
      }
    }
  }

  for (const depth of pendingPublicationDepths) {
    for (const shape of pendingPublicationShapes) {
      for (const settlement of pendingPublicationSettlements) {
        for (const optimisticOperation of pendingPublicationOperations) {
          for (const sourceOperation of pendingPublicationOperations) {
            it(`publishes a disjoint source ${sourceOperation} through a ${depth} ${shape} query while an optimistic ${optimisticOperation} ${settlement}`, async () => {
              await expectSourcePublicationDuringPendingMutation(
                {
                  optimisticOperation,
                  sourceChanges: [
                    {
                      operation: sourceOperation,
                      row: pendingOperationRow(sourceOperation, `source`),
                    },
                  ],
                  sameKey: false,
                },
                depth,
                shape,
                settlement,
              )
            })
          }

          it(`retains a same-key source ${optimisticOperation} through a ${depth} ${shape} query while its optimistic mutation ${settlement}`, async () => {
            await expectSourcePublicationDuringPendingMutation(
              {
                optimisticOperation,
                sourceChanges: [
                  {
                    operation: optimisticOperation,
                    row: pendingOperationRow(optimisticOperation, `optimistic`),
                  },
                ],
                sameKey: true,
              },
              depth,
              shape,
              settlement,
            )
          })
        }

        for (const history of offDiagonalSameKeyHistories) {
          it(`retains the synced base when the ${history.name} through a ${depth} ${shape} query and the optimistic mutation ${settlement}`, async () => {
            await expectSourcePublicationDuringPendingMutation(
              history,
              depth,
              shape,
              settlement,
            )
          })
        }
      }
    }
  }
})
