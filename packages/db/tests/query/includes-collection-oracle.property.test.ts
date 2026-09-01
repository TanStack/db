import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import { LIVE_QUERY_INTERNAL } from '../../src/query/live/internal.js'
import {
  add,
  caseWhen,
  concat,
  count,
  createLiveQueryCollection,
  eq,
  gt,
  lt,
  materialize,
  multiply,
  sum,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import { createControlledCollection as createOracleControlledCollection } from './includes-oracle-helpers.js'
import type { Collection } from '../../src/collection/index.js'
import type { ChangeMessage } from '../../src/types.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'

type ParentRow = {
  id: number
  group: number
}

type ChildRow = {
  id: number
  parentGroup: number
  value: number
}

type LayoutSwapScenario = {
  length: number
  swapIndex: number
}

type FacadeCandidateScanScenario = {
  candidatePosition: `first` | `last`
  finalLayout: `moved` | `restored`
}

class ThrowingUpdateIndex extends BasicIndex<number> {
  throwAfterUpdate = false
  throwAfterBuild = false

  override update(key: number, oldItem: unknown, newItem: unknown): void {
    super.update(key, oldItem, newItem)
    if (this.throwAfterUpdate) throw new Error(`root index failed`)
  }

  override build(entries: Iterable<[number, unknown]>): void {
    super.build(entries)
    if (this.throwAfterBuild) throw new Error(`root index rebuild failed`)
  }
}

const exhaustiveLayoutSwapScenarios: Array<LayoutSwapScenario> = Array.from(
  { length: 9 },
  (_, offset) => offset + 4,
).flatMap((length) =>
  Array.from({ length: length - 3 }, (_, offset) => ({
    length,
    swapIndex: offset + 1,
  })),
)

const layoutSwapScenarioArbitrary: fc.Arbitrary<LayoutSwapScenario> = fc
  .integer({ min: 4, max: 12 })
  .chain((length) =>
    fc.integer({ min: 1, max: length - 3 }).map((swapIndex) => ({
      length,
      swapIndex,
    })),
  )

const facadeCandidateScanScenarios: ReadonlyArray<FacadeCandidateScanScenario> =
  [
    { candidatePosition: `first`, finalLayout: `moved` },
    { candidatePosition: `first`, finalLayout: `restored` },
    { candidatePosition: `last`, finalLayout: `moved` },
    { candidatePosition: `last`, finalLayout: `restored` },
  ]

type ProjectedChildChange = {
  type: `insert` | `update` | `delete`
  key: number
  value: ChildRow
  previousValue?: ChildRow
}

function projectChildChange(
  change: ChangeMessage<ChildRow, string | number>,
): ProjectedChildChange {
  const projectRow = ({ id, parentGroup, value }: ChildRow): ChildRow => ({
    id,
    parentGroup,
    value,
  })
  return {
    type: change.type,
    key: Number(change.key),
    value: projectRow(change.value),
    ...(change.previousValue
      ? { previousValue: projectRow(change.previousValue) }
      : {}),
  }
}

type ProjectedValueChange = {
  type: `insert` | `update` | `delete`
  key: number
  value: number
  previousValue?: number
}

function projectValueChange(
  change: ChangeMessage<{ value: number }, string | number>,
): ProjectedValueChange {
  return {
    type: change.type,
    key: Number(change.key),
    value: change.value.value,
    ...(change.previousValue
      ? { previousValue: change.previousValue.value }
      : {}),
  }
}

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
  subscription?: { unsubscribe: () => void }
}

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
): ControlledCollection<T> {
  return createOracleControlledCollection(name, initialData, {
    autoIndex: `eager`,
    rowUpdateMode: `full`,
  })
}

function expectedMaterializations<T>(rows: ReadonlyArray<T>) {
  return {
    facade: [...rows],
    array: [...rows],
    materialized: [...rows],
  }
}

async function expectRootAndFacadeLayoutSwap({
  length,
  swapIndex,
}: LayoutSwapScenario): Promise<void> {
  type OrderedChild = ChildRow & { position: number }
  const parents = createControlledCollection(`layout-swap-parents`, [
    { id: 1, group: 1 },
  ])
  const initialRows: Array<OrderedChild> = Array.from(
    { length },
    (_, index) => ({
      id: index + 1,
      parentGroup: 1,
      value: index + 1,
      position: index,
    }),
  )
  const children = createControlledCollection<OrderedChild>(
    `layout-swap-children`,
    initialRows,
  )
  const root = createLiveQueryCollection((q) =>
    q
      .from({ child: children.collection })
      .orderBy(({ child }) => child.position)
      .select(({ child }) => ({ id: child.id, value: child.value })),
  )
  const nested = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      children: q
        .from({ child: children.collection })
        .where(({ child }) => eq(child.parentGroup, parent.group))
        .orderBy(({ child }) => child.position)
        .select(({ child }) => ({ id: child.id, value: child.value })),
    })),
  )
  let rootSubscription: { unsubscribe: () => void } | undefined
  let facadeSubscription: { unsubscribe: () => void } | undefined

  try {
    await Promise.all([root.preload(), nested.preload()])
    const facade = nested.get(1)!.children
    const rootRevision = root._layoutRevision
    const facadeRevision = facade._layoutRevision
    const rootPublicationSizes: Array<number> = []
    const facadePublicationSizes: Array<number> = []
    const rootCallbackKeys: Array<Array<number>> = []
    const facadeCallbackKeys: Array<Array<number>> = []
    rootSubscription = root.subscribeChanges(
      (changes) => {
        rootPublicationSizes.push(changes.length)
        rootCallbackKeys.push(root.toArray.map(({ id }) => id))
      },
      { includeInitialState: false },
    )
    facadeSubscription = facade.subscribeChanges(
      (changes) => {
        facadePublicationSizes.push(changes.length)
        facadeCallbackKeys.push(facade.toArray.map(({ id }) => id))
      },
      { includeInitialState: false },
    )
    const expectedKeys = initialRows.map(({ id }) => id)
    ;[expectedKeys[swapIndex], expectedKeys[swapIndex + 1]] = [
      expectedKeys[swapIndex + 1]!,
      expectedKeys[swapIndex]!,
    ]
    const first = initialRows[swapIndex]!
    const second = initialRows[swapIndex + 1]!

    children.writeBatch([
      {
        type: `update`,
        value: { ...first, position: second.position },
      },
      {
        type: `update`,
        value: { ...second, position: first.position },
      },
    ])

    expect(root.toArray.map(({ id }) => id)).toEqual(expectedKeys)
    expect(facade.toArray.map(({ id }) => id)).toEqual(expectedKeys)
    expect(root._layoutRevision).toBe(rootRevision + 1)
    expect(facade._layoutRevision).toBe(facadeRevision + 1)
    expect(rootPublicationSizes).toEqual([0])
    expect(facadePublicationSizes).toEqual([0])
    expect(rootCallbackKeys).toEqual([expectedKeys])
    expect(facadeCallbackKeys).toEqual([expectedKeys])
  } finally {
    rootSubscription?.unsubscribe()
    facadeSubscription?.unsubscribe()
    await Promise.all([
      root.cleanup(),
      nested.cleanup(),
      parents.collection.cleanup(),
      children.collection.cleanup(),
    ])
  }
}

async function expectFacadeCandidateScan({
  candidatePosition,
  finalLayout,
}: FacadeCandidateScanScenario): Promise<void> {
  type OrderedChild = ChildRow & { position: number }
  const parents = createControlledCollection(`candidate-scan-parents`, [
    { id: 1, group: 1 },
  ])
  const initialRows: ReadonlyArray<OrderedChild> = [
    { id: 10, parentGroup: 1, value: 10, position: 0 },
    { id: 20, parentGroup: 1, value: 20, position: 1 },
    { id: 30, parentGroup: 1, value: 30, position: 2 },
  ]
  const children = createControlledCollection<OrderedChild>(
    `candidate-scan-children`,
    initialRows,
  )
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      children: q
        .from({ child: children.collection })
        .where(({ child }) => eq(child.parentGroup, parent.group))
        .orderBy(({ child }) => child.position)
        .select(({ child }) => ({ value: child.value })),
    })),
  )
  let subscription: { unsubscribe: () => void } | undefined
  let restoreFacadeGetKey: (() => void) | undefined

  try {
    await live.preload()
    const facade = live.get(1)!.children
    const keys = () => [...facade.keys()].map(Number)
    const values = () => facade.toArray.map(({ value }) => value)
    const publications: Array<Array<ProjectedValueChange>> = []
    const callbackKeys: Array<Array<number>> = []
    const callbackValues: Array<Array<number>> = []
    subscription = facade.subscribeChanges(
      (batch) => {
        publications.push(batch.map(projectValueChange))
        callbackKeys.push(keys())
        callbackValues.push(values())
      },
      { includeInitialState: false },
    )
    const revision = facade._layoutRevision
    const candidateRow = initialRows[candidatePosition === `first` ? 0 : 1]!
    const valueRow = initialRows[candidatePosition === `first` ? 1 : 0]!
    const changedKeyOrder: Array<number> = []
    const originalGetKey = facade.config.getKey
    facade.config.getKey = (row) => {
      const key = Number(originalGetKey(row))
      if (
        (key === candidateRow.id || key === valueRow.id) &&
        !changedKeyOrder.includes(key)
      ) {
        changedKeyOrder.push(key)
      }
      return key
    }
    restoreFacadeGetKey = () => {
      facade.config.getKey = originalGetKey
    }
    const valueUpdate = {
      type: `update` as const,
      value: { ...valueRow, value: valueRow.value + 1 },
    }
    const orderUpdates = [
      {
        type: `update` as const,
        value: { ...candidateRow, position: 3 },
      },
      ...(finalLayout === `restored`
        ? [
            {
              type: `update` as const,
              value: candidateRow,
            },
          ]
        : []),
    ]

    children.writeBatch(
      candidatePosition === `first`
        ? [...orderUpdates, valueUpdate]
        : [valueUpdate, ...orderUpdates],
    )

    const expectedKeys =
      finalLayout === `moved`
        ? initialRows
            .filter(({ id }) => id !== candidateRow.id)
            .map(({ id }) => id)
            .concat(candidateRow.id)
        : initialRows.map(({ id }) => id)
    const expectedValues = expectedKeys.map((id) =>
      id === valueRow.id ? valueRow.value + 1 : id,
    )
    if (finalLayout === `moved`) {
      expect(changedKeyOrder).toEqual([10, 20])
      expect(changedKeyOrder[candidatePosition === `first` ? 0 : 1]).toBe(
        candidateRow.id,
      )
    } else {
      expect(changedKeyOrder).toEqual([valueRow.id])
    }
    expect(keys()).toEqual(expectedKeys)
    expect(values()).toEqual(expectedValues)
    expect(publications).toEqual([
      [
        {
          type: `update`,
          key: valueRow.id,
          value: valueRow.value + 1,
          previousValue: valueRow.value,
        },
      ],
    ])
    expect(callbackKeys).toEqual([expectedKeys])
    expect(callbackValues).toEqual([expectedValues])
    expect(facade._layoutRevision).toBe(
      revision + (finalLayout === `moved` ? 1 : 0),
    )
  } finally {
    restoreFacadeGetKey?.()
    subscription?.unsubscribe()
    await Promise.all([
      live.cleanup(),
      parents.collection.cleanup(),
      children.collection.cleanup(),
    ])
  }
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
      }
    },
    async start(context) {
      await context.live.preload()
      context.subscription = context.live.subscribeChanges(
        () => context.publications.push(projectLive(context.live)),
        { includeInitialState: false },
      )
    },
    apply(action, context) {
      context.publications = []
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

const collectionProjection: TraceProjection<
  CollectionContext,
  CollectionObservation
> = {
  observe: (context) => ({
    rows: projectLive(context.live),
    publications: context.publications,
  }),
  recompute: (context) => {
    const rows = recompute(context)
    return {
      rows,
      publications: context.publications.map(() => rows),
    }
  },
  assertEqual(observed, expected) {
    expect(observed).toEqual(expected)
    return undefined
  },
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

type PendingFacadeOperation = `insert` | `update` | `delete`
type PendingFacadeOptimisticOperation = Exclude<
  PendingFacadeOperation,
  `insert`
>
type PendingFacadeKeyRelation = `disjoint-key` | `same-key`
type PendingFacadeShape = `unordered` | `ordered`

const pendingFacadeOptimisticOperations = [`update`, `delete`] as const
const pendingFacadeSourceOperations = [`insert`, `update`, `delete`] as const
const pendingFacadeSettlements = [`resolve`, `reject`] as const
const pendingFacadeKeyRelations = [`disjoint-key`, `same-key`] as const
const pendingFacadeShapes = [`unordered`, `ordered`] as const
const pendingFacadeInitialRows: ReadonlyArray<ChildRow> = [
  { id: 10, parentGroup: 1, value: 10 },
  { id: 20, parentGroup: 1, value: 20 },
]

function pendingOptimisticFacadeRow(
  operation: PendingFacadeOptimisticOperation,
): ChildRow {
  if (operation === `update`) {
    return { id: 10, parentGroup: 1, value: 11 }
  }
  return { id: 10, parentGroup: 1, value: 10 }
}

function pendingSourceFacadeRow(
  operation: PendingFacadeOperation,
  keyRelation: PendingFacadeKeyRelation,
): ChildRow {
  if (operation === `insert`) {
    return { id: 40, parentGroup: 1, value: 40 }
  }
  if (keyRelation === `same-key`) {
    return {
      id: 10,
      parentGroup: 1,
      value: operation === `update` ? 21 : 10,
    }
  }
  if (operation === `update`) {
    return { id: 20, parentGroup: 1, value: 21 }
  }
  return { id: 20, parentGroup: 1, value: 20 }
}

function applyPendingFacadeOperation(
  rows: Map<number, ChildRow>,
  operation: PendingFacadeOperation,
  row: ChildRow,
): void {
  if (operation === `delete`) rows.delete(row.id)
  else rows.set(row.id, { ...row })
}

function expectedPendingFacadeRows(
  rows: ReadonlyMap<number, ChildRow>,
  shape: PendingFacadeShape = `unordered`,
  orderRows: ReadonlyMap<number, ChildRow> = rows,
): Array<ChildRow> {
  return [...rows.values()]
    .map((row) => ({ ...row }))
    .sort((left, right) => {
      if (shape === `unordered`) return left.id - right.id
      const leftOrder = orderRows.get(left.id)?.value
      const rightOrder = orderRows.get(right.id)?.value
      if (leftOrder === rightOrder) return left.id - right.id
      if (leftOrder === undefined) return 1
      if (rightOrder === undefined) return -1
      return leftOrder - rightOrder
    })
}

function projectPendingFacadeRows(
  rows: ReadonlyArray<ChildRow>,
  shape: PendingFacadeShape,
): Array<ChildRow> {
  const projected = rows.map(({ id, parentGroup, value }) => ({
    id,
    parentGroup,
    value,
  }))
  return shape === `ordered`
    ? projected
    : projected.sort((left, right) => left.id - right.id)
}

function expectedPendingFacadeChange(
  before: ReadonlyMap<number, ChildRow>,
  after: ReadonlyMap<number, ChildRow>,
  key: number,
): ProjectedChildChange | undefined {
  const previousValue = before.get(key)
  const value = after.get(key)
  if (
    previousValue?.id === value?.id &&
    previousValue?.parentGroup === value?.parentGroup &&
    previousValue?.value === value?.value
  ) {
    return undefined
  }
  if (!previousValue && value) {
    return { type: `insert`, key, value: { ...value } }
  }
  if (previousValue && !value) {
    return { type: `delete`, key, value: { ...previousValue } }
  }
  if (!previousValue || !value) return undefined
  return {
    type: `update`,
    key,
    value: { ...value },
    previousValue: { ...previousValue },
  }
}

describe(`Collection-valued includes oracle`, () => {
  fcTest.prop(
    [collectionScenarioArbitrary],
    oraclePropertyOptions(30, `includes-collection.relationship-history`),
  )(
    `keeps Collection, toArray, and materialize equivalent across generated relationship histories`,
    ({ parentGroup, childValue, actions }) =>
      runTrace({
        steps: actions,
        driver: createCollectionDriver(
          [{ id: 0, group: parentGroup }],
          [{ id: 10, parentGroup, value: childValue }],
        ),
        projection: collectionProjection,
      }),
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
    const driver = createCollectionDriver(
      [{ id: 1, group: 1 }],
      [{ id: 10, parentGroup: 1, value: 1 }],
    )
    const lifecycleDriver: TraceDriver<CollectionAction, CollectionContext> = {
      ...driver,
      apply(action, context, checkpoint) {
        retiredFacade ??= context.live.get(1)?.children
        return driver.apply(action, context, checkpoint)
      },
    }
    const projection: TraceProjection<
      CollectionContext,
      { rows: Array<ProjectedParent>; retiredStatus: string | undefined }
    > = {
      observe: (context) => ({
        rows: projectLive(context.live),
        retiredStatus: retiredFacade?.status,
      }),
      recompute: (context) => ({
        rows: recompute(context),
        retiredStatus:
          context.model.parents.size === 0 ? `ready` : retiredFacade?.status,
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

    expect(retiredFacade?.toArray).toEqual([])
    await expect(retiredFacade?.preload()).resolves.toBeUndefined()
  })

  fcTest(`a delete event preserves the published facade identity`, async () => {
    let publishedFacade: IncludedChildCollection | undefined
    let previousFacadeMatched = true
    const driver = createCollectionDriver(
      [{ id: 1, group: 1 }],
      [{ id: 10, parentGroup: 1, value: 1 }],
    )
    const eventDriver: TraceDriver<CollectionAction, CollectionContext> = {
      ...driver,
      async start(context) {
        await driver.start?.(context)
        publishedFacade = context.live.get(1)?.children
        context.subscription = context.live.subscribeChanges(
          (changes: Array<ChangeMessage<any, any>>) => {
            for (const change of changes) {
              if (change.type === `delete`) {
                previousFacadeMatched =
                  change.value.children === publishedFacade
              }
            }
          },
          { includeInitialState: false },
        )
      },
    }
    const projection: TraceProjection<
      CollectionContext,
      { previousFacadeMatched: boolean }
    > = {
      observe: () => ({ previousFacadeMatched }),
      recompute: () => ({ previousFacadeMatched: true }),
      assertEqual(observed, expected) {
        expect(observed).toEqual(expected)
        return undefined
      },
    }

    await runTrace({
      steps: [{ type: `deleteParent`, id: 1 }],
      driver: eventDriver,
      projection,
    })
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

  fcTest(
    `root application failure rolls back a prepared facade publication`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const initialParent: NodeRow = {
        id: 1,
        kind: `parent`,
        group: 1,
        value: 1,
      }
      const initialChild: NodeRow = {
        id: 10,
        kind: `child`,
        group: 1,
        value: 1,
      }
      const initialSibling: NodeRow = {
        id: 20,
        kind: `child`,
        group: 1,
        value: 2,
      }
      const nodes = createControlledCollection<NodeRow>(`rollback-nodes`, [
        initialParent,
        initialChild,
        initialSibling,
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: q
              .from({ child: nodes.collection })
              .where(({ child }) => eq(child.kind, `child`))
              .where(({ child }) => eq(child.group, parent.group))
              .orderBy(({ child }) => child.value),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootIndex = live.createIndex((row) => row.value, {
        indexType: ThrowingUpdateIndex,
      }) as ThrowingUpdateIndex
      const rootPublications: Array<unknown> = []
      const childPublications: Array<unknown> = []
      const rootCallbackFacadeSnapshots: Array<{
        rows: Array<{ id: number; value: number }>
        stateRevision: number
        layoutRevision: number
      }> = []
      const rootSubscription = live.subscribeChanges(
        (batch) => {
          rootPublications.push(...batch)
          rootCallbackFacadeSnapshots.push({
            rows: facade.toArray.map(({ id, value }) => ({ id, value })),
            stateRevision: facade._stateRevision,
            layoutRevision: facade._layoutRevision,
          })
        },
        { includeInitialState: false },
      )
      const childSubscription = facade.subscribeChanges(
        (batch) => childPublications.push(...batch),
        { includeInitialState: false },
      )
      const childObserver = createLiveQueryObserver(facade)
      let observerNotifications = 0
      childObserver.subscribe(() => observerNotifications++)
      observerNotifications = 0
      const observerBeforeFailure = childObserver.getSnapshot()
      const rootStateRevisionBeforeFailure = live._stateRevision
      const rootLayoutRevisionBeforeFailure = live._layoutRevision
      const childStateRevisionBeforeFailure = facade._stateRevision
      const childLayoutRevisionBeforeFailure = facade._layoutRevision
      rootIndex.throwAfterUpdate = true

      try {
        expect(() =>
          nodes.writeBatch([
            {
              type: `update`,
              value: { ...initialParent, value: 2 },
            },
            {
              type: `update`,
              value: { ...initialChild, value: 3 },
            },
            {
              type: `update`,
              value: { ...initialSibling, value: 0 },
            },
          ]),
        ).toThrow(`root index failed`)
        expect(live.get(1)!.value).toBe(1)
        expect([...rootIndex.equalityLookup(1)]).toEqual([1])
        expect([...rootIndex.equalityLookup(2)]).toEqual([])
        expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
          { id: 10, value: 1 },
          { id: 20, value: 2 },
        ])
        expect(rootPublications).toEqual([])
        expect(childPublications).toEqual([])
        expect(rootCallbackFacadeSnapshots).toEqual([])
        expect(live._stateRevision).toBe(rootStateRevisionBeforeFailure)
        expect(live._layoutRevision).toBe(rootLayoutRevisionBeforeFailure)
        expect(facade._stateRevision).toBe(childStateRevisionBeforeFailure)
        expect(facade._layoutRevision).toBe(childLayoutRevisionBeforeFailure)
        expect(childObserver.getSnapshot()).toBe(observerBeforeFailure)
        expect(observerNotifications).toBe(0)

        rootIndex.throwAfterUpdate = false
        // Only the root changes on retry. The child deltas consumed by the
        // failed graph turn must remain staged until the whole publication
        // commits; the source will not emit them again.
        nodes.write(`update`, { ...initialParent, value: 3 })
        expect(live.get(1)!.value).toBe(3)
        expect([...rootIndex.equalityLookup(1)]).toEqual([])
        expect([...rootIndex.equalityLookup(3)]).toEqual([1])
        expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
          { id: 20, value: 0 },
          { id: 10, value: 3 },
        ])
        expect(rootPublications).toHaveLength(1)
        expect(childPublications).toHaveLength(2)
        expect(rootCallbackFacadeSnapshots).toEqual([
          {
            rows: [
              { id: 20, value: 0 },
              { id: 10, value: 3 },
            ],
            stateRevision: childStateRevisionBeforeFailure + 1,
            layoutRevision: childLayoutRevisionBeforeFailure + 1,
          },
        ])
        expect(facade._stateRevision).toBe(childStateRevisionBeforeFailure + 1)
        expect(facade._layoutRevision).toBe(
          childLayoutRevisionBeforeFailure + 1,
        )
        expect(childObserver.getSnapshot()).not.toBe(observerBeforeFailure)
        expect(observerNotifications).toBe(1)
      } finally {
        rootIndex.throwAfterUpdate = false
        childObserver.dispose()
        rootSubscription.unsubscribe()
        childSubscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(
    `root restore failure preserves the install error and releases facade rollback`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const initialParent: NodeRow = {
        id: 1,
        kind: `parent`,
        group: 1,
        value: 1,
      }
      const initialChild: NodeRow = {
        id: 10,
        kind: `child`,
        group: 1,
        value: 1,
      }
      const nodes = createControlledCollection<NodeRow>(
        `root-restore-failure-nodes`,
        [initialParent, initialChild],
      )
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: q
              .from({ child: nodes.collection })
              .where(({ child }) => eq(child.kind, `child`))
              .where(({ child }) => eq(child.group, parent.group)),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootIndex = live.createIndex((row) => row.value, {
        indexType: ThrowingUpdateIndex,
      }) as ThrowingUpdateIndex
      const rootPublications: Array<unknown> = []
      const childPublications: Array<unknown> = []
      const rootSubscription = live.subscribeChanges(
        (batch) => rootPublications.push(...batch),
        { includeInitialState: false },
      )
      const childSubscription = facade.subscribeChanges(
        (batch) => childPublications.push(...batch),
        { includeInitialState: false },
      )
      const rootRevision = live._stateRevision
      const childRevision = facade._stateRevision
      rootIndex.throwAfterUpdate = true
      rootIndex.throwAfterBuild = true

      try {
        expect(() =>
          nodes.writeBatch([
            {
              type: `update`,
              value: { ...initialParent, value: 2 },
            },
            {
              type: `update`,
              value: { ...initialChild, value: 2 },
            },
          ]),
        ).toThrow(`root index failed`)
        expect(live.status).toBe(`error`)
        expect(live.get(1)!.value).toBe(1)
        expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
          { id: 10, value: 1 },
        ])
        expect(rootPublications).toEqual([])
        expect(childPublications).toEqual([])
        expect(live._stateRevision).toBe(rootRevision)
        expect(facade._stateRevision).toBe(childRevision)

        rootIndex.throwAfterUpdate = false
        rootIndex.throwAfterBuild = false
        nodes.write(`update`, { ...initialParent, value: 3 })

        expect(live.status).toBe(`ready`)
        expect(live.get(1)!.value).toBe(3)
        expect(facade.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
          { id: 10, value: 2 },
        ])
        expect(rootPublications).toHaveLength(1)
        expect(childPublications).toHaveLength(1)
        expect(live._stateRevision).toBe(rootRevision + 1)
        expect(facade._stateRevision).toBe(childRevision + 1)
      } finally {
        rootIndex.throwAfterUpdate = false
        rootIndex.throwAfterBuild = false
        rootSubscription.unsubscribe()
        childSubscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(
    `child-only changes flush the facade without republishing the parent`,
    async () => {
      const parents = createControlledCollection(`facade-only-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection(`facade-only-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => ({
          id: parent.id,
          children: q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group)),
        })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootPublications: Array<unknown> = []
      const childPublications: Array<unknown> = []
      const rootSubscription = live.subscribeChanges(
        (batch) => rootPublications.push(...batch),
        { includeInitialState: false },
      )
      const childSubscription = facade.subscribeChanges(
        (batch) => childPublications.push(...batch),
        { includeInitialState: false },
      )

      try {
        children.write(`update`, {
          id: 10,
          parentGroup: 1,
          value: 2,
        })

        expect(rootPublications).toEqual([])
        expect(childPublications).toHaveLength(1)
        expect(live.get(1)!.children).toBe(facade)
        expect(
          [...facade.values()].map(({ id, parentGroup, value }) => ({
            id,
            parentGroup,
            value,
          })),
        ).toEqual([{ id: 10, parentGroup: 1, value: 2 }])
      } finally {
        rootSubscription.unsubscribe()
        childSubscription.unsubscribe()
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  for (const { throwingParentId, position, failure } of [
    { throwingParentId: 1, position: `first`, failure: `error` },
    { throwingParentId: 2, position: `middle`, failure: `undefined` },
    { throwingParentId: 3, position: `last`, failure: `null` },
  ] as const) {
    fcTest(
      `a throwing ${position} facade callback does not suppress sibling publications`,
      async () => {
        const parents = createControlledCollection(`callback-error-parents`, [
          { id: 1, group: 1 },
          { id: 2, group: 2 },
          { id: 3, group: 3 },
        ])
        const children = createControlledCollection(`callback-error-children`, [
          { id: 10, parentGroup: 1, value: 1 },
          { id: 20, parentGroup: 2, value: 2 },
          { id: 30, parentGroup: 3, value: 3 },
        ])
        const live = createLiveQueryCollection((q) =>
          q
            .from({ parent: parents.collection })
            .orderBy(({ parent }) => parent.id)
            .select(({ parent }) => ({
              id: parent.id,
              children: q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group)),
            })),
        )

        await live.preload()
        const facades = [1, 2, 3].map((parentId) => ({
          parentId,
          collection: live.get(parentId)!.children,
        }))
        const callbackParentIds: Array<number> = []
        const callbackError =
          failure === `error`
            ? new Error(`facade ${throwingParentId} callback failed`)
            : failure === `undefined`
              ? undefined
              : null
        const subscriptions = facades.map(({ parentId, collection }) =>
          collection.subscribeChanges(
            () => {
              callbackParentIds.push(parentId)
              if (parentId === throwingParentId) throw callbackError
              if (position === `first` && parentId === 3) {
                throw new Error(`later facade callback failed`)
              }
            },
            { includeInitialState: false },
          ),
        )

        try {
          let didThrow = false
          let publicationError: unknown
          try {
            children.writeBatch([
              {
                type: `update`,
                value: { id: 10, parentGroup: 1, value: 11 },
              },
              {
                type: `update`,
                value: { id: 20, parentGroup: 2, value: 12 },
              },
              {
                type: `update`,
                value: { id: 30, parentGroup: 3, value: 13 },
              },
            ])
          } catch (error) {
            didThrow = true
            publicationError = error
          }

          expect(didThrow).toBe(true)
          expect(publicationError).toBe(callbackError)
          expect(callbackParentIds).toEqual([1, 2, 3])
          expect(
            facades.map(({ collection }) => collection.toArray[0]!.value),
          ).toEqual([11, 12, 13])
        } finally {
          for (const subscription of subscriptions) subscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
          ])
        }
      },
    )
  }

  fcTest(
    `cleanup during root publication suppresses a prepared facade callback`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const nodes = createControlledCollection<NodeRow>(
        `prepared-facade-cleanup`,
        [
          { id: 1, kind: `parent`, group: 1, value: 1 },
          { id: 10, kind: `child`, group: 1, value: 1 },
        ],
      )
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: q
              .from({ child: nodes.collection })
              .where(({ child }) => eq(child.kind, `child`))
              .where(({ child }) => eq(child.group, parent.group)),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootSnapshots: Array<{
        status: string
        rows: Array<{ id: number; value: number }>
      }> = []
      const facadeSnapshots: Array<{
        status: string
        rows: Array<{ id: number; value: number }>
      }> = []
      let cleanupPromise: Promise<void> | undefined
      const rootSubscription = live.subscribeChanges(
        () => {
          rootSnapshots.push({
            status: facade.status,
            rows: facade.toArray.map(({ id, value }) => ({ id, value })),
          })
          cleanupPromise = facade.cleanup()
        },
        { includeInitialState: false },
      )
      const facadeSubscription = facade.subscribeChanges(
        () => {
          facadeSnapshots.push({
            status: facade.status,
            rows: facade.toArray.map(({ id, value }) => ({ id, value })),
          })
        },
        { includeInitialState: false },
      )

      try {
        nodes.writeBatch([
          {
            type: `update`,
            value: { id: 1, kind: `parent`, group: 1, value: 2 },
          },
          {
            type: `update`,
            value: { id: 10, kind: `child`, group: 1, value: 2 },
          },
        ])
        await cleanupPromise

        expect(rootSnapshots).toEqual([
          {
            status: `ready`,
            rows: [{ id: 10, value: 2 }],
          },
        ])
        expect(facadeSnapshots).toEqual([])
        expect(facade.status).toBe(`cleaned-up`)
        expect(facade.toArray).toEqual([])
      } finally {
        rootSubscription.unsubscribe()
        facadeSubscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(`cleanup cancels every handle in a prepared publication`, async () => {
    const rows = createControlledCollection(`prepared-publication-cleanup`, [
      { id: 1, value: 1 },
    ])
    await rows.collection.preload()
    const callbackValues: Array<Array<number>> = []
    const subscription = rows.collection.subscribeChanges(
      (batch) => {
        callbackValues.push(batch.map((change) => change.value.value))
      },
      { includeInitialState: false },
    )

    try {
      const firstPublication = rows.collection._deferPublication()
      rows.write(`update`, { id: 1, value: 2 })
      const secondPublication = rows.collection._deferPublication()
      rows.write(`update`, { id: 1, value: 3 })
      firstPublication.prepare()
      secondPublication.prepare()

      expect(rows.collection.get(1)!.value).toBe(3)
      expect(rows.collection.status).toBe(`ready`)

      await rows.collection.cleanup()
      firstPublication.publish()
      secondPublication.publish()

      expect(callbackValues).toEqual([])
      expect(rows.collection.status).toBe(`cleaned-up`)
      expect(rows.collection.toArray).toEqual([])
    } finally {
      subscription.unsubscribe()
      await rows.collection.cleanup()
    }
  })

  fcTest(
    `coherent nested publication advances every revision before callbacks`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child` | `grandchild`
        parentGroup: number
        group: number
        value: number
      }
      const initialRows: Array<NodeRow> = [
        {
          id: 1,
          kind: `parent`,
          parentGroup: 0,
          group: 1,
          value: 1,
        },
        {
          id: 10,
          kind: `child`,
          parentGroup: 1,
          group: 10,
          value: 1,
        },
        {
          id: 20,
          kind: `child`,
          parentGroup: 1,
          group: 20,
          value: 2,
        },
        {
          id: 100,
          kind: `grandchild`,
          parentGroup: 10,
          group: 100,
          value: 1,
        },
        {
          id: 200,
          kind: `grandchild`,
          parentGroup: 10,
          group: 200,
          value: 2,
        },
      ]
      const nodes = createControlledCollection<NodeRow>(
        `nested-publication-revisions`,
        initialRows,
      )
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: q
              .from({ child: nodes.collection })
              .where(({ child }) => eq(child.kind, `child`))
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.value)
              .select(({ child }) => ({
                id: child.id,
                value: child.value,
                grandchildren: q
                  .from({ grandchild: nodes.collection })
                  .where(({ grandchild }) => eq(grandchild.kind, `grandchild`))
                  .where(({ grandchild }) =>
                    eq(grandchild.parentGroup, child.group),
                  )
                  .orderBy(({ grandchild }) => grandchild.value),
              })),
          })),
      )

      await live.preload()
      const childFacade = live.get(1)!.children
      const grandchildFacade = childFacade.get(10)!.grandchildren
      const childStateRevision = childFacade._stateRevision
      const childLayoutRevision = childFacade._layoutRevision
      const grandchildStateRevision = grandchildFacade._stateRevision
      const grandchildLayoutRevision = grandchildFacade._layoutRevision
      const callbackSnapshots: Array<{
        childRows: Array<{ id: number; value: number }>
        childStateRevision: number
        childLayoutRevision: number
        grandchildRows: Array<{ id: number; value: number }>
        grandchildStateRevision: number
        grandchildLayoutRevision: number
      }> = []
      const subscription = live.subscribeChanges(
        () => {
          callbackSnapshots.push({
            childRows: childFacade.toArray.map(({ id, value }) => ({
              id,
              value,
            })),
            childStateRevision: childFacade._stateRevision,
            childLayoutRevision: childFacade._layoutRevision,
            grandchildRows: grandchildFacade.toArray.map(({ id, value }) => ({
              id,
              value,
            })),
            grandchildStateRevision: grandchildFacade._stateRevision,
            grandchildLayoutRevision: grandchildFacade._layoutRevision,
          })
        },
        { includeInitialState: false },
      )

      try {
        nodes.writeBatch([
          { type: `update`, value: { ...initialRows[0]!, value: 3 } },
          { type: `update`, value: { ...initialRows[1]!, value: 4 } },
          { type: `update`, value: { ...initialRows[2]!, value: 3 } },
          { type: `update`, value: { ...initialRows[3]!, value: 4 } },
          { type: `update`, value: { ...initialRows[4]!, value: 3 } },
        ])

        expect(callbackSnapshots).toEqual([
          {
            childRows: [
              { id: 20, value: 3 },
              { id: 10, value: 4 },
            ],
            childStateRevision: childStateRevision + 1,
            childLayoutRevision: childLayoutRevision + 1,
            grandchildRows: [
              { id: 200, value: 3 },
              { id: 100, value: 4 },
            ],
            grandchildStateRevision: grandchildStateRevision + 1,
            grandchildLayoutRevision: grandchildLayoutRevision + 1,
          },
        ])
      } finally {
        subscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(
    `window callback-created source work follows the current facade publication`,
    async () => {
      const parents = createControlledCollection(`reentrant-window-parents`, [
        { id: 1, rank: 1, group: 1 },
        { id: 2, rank: 2, group: 2 },
      ])
      const children = createControlledCollection(`reentrant-window-children`, [
        { id: 10, group: 1, value: 1 },
        { id: 20, group: 2, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.group, parent.group)),
          })),
      )

      await live.preload()
      const observations: Array<{
        eventValues: Array<number>
        visibleValue: number
        revision: number
      }> = []
      let childSubscription: { unsubscribe: () => void } | undefined
      let preparedRevision = -1
      let reentered = false
      const rootSubscription = live.subscribeChanges(
        () => {
          if (reentered) return
          reentered = true
          const facade = live.get(2)!.children
          preparedRevision = facade._stateRevision
          childSubscription = facade.subscribeChanges(
            (batch) => {
              observations.push({
                eventValues: batch.map((change) => change.value.value),
                visibleValue: facade.get(20)!.value,
                revision: facade._stateRevision,
              })
            },
            { includeInitialState: false },
          )
          children.write(`update`, { id: 20, group: 2, value: 3 })
        },
        { includeInitialState: false },
      )

      try {
        const result = live.utils.setWindow({ offset: 0, limit: 2 })
        if (result instanceof Promise) await result
        await flushPromises()

        expect(children.collection.get(20)!.value).toBe(3)
        expect(live.get(2)!.children.get(20)!.value).toBe(3)
        expect(observations).toEqual([
          {
            eventValues: [1],
            visibleValue: 1,
            revision: preparedRevision,
          },
          {
            eventValues: [3],
            visibleValue: 3,
            revision: preparedRevision + 1,
          },
        ])
      } finally {
        rootSubscription.unsubscribe()
        childSubscription?.unsubscribe()
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  for (const turnOrigin of [`source`, `window`] as const) {
    for (const callbackAction of [`source-write`, `set-window`] as const) {
      fcTest(
        `${turnOrigin} graph turns serialize callback ${callbackAction} work`,
        async () => {
          const parents = createControlledCollection(
            `callback-origin-parents`,
            [
              { id: 1, rank: 1, group: 1, value: 1 },
              { id: 2, rank: 2, group: 2, value: 1 },
            ],
          )
          const children = createControlledCollection(
            `callback-origin-children`,
            [
              { id: 10, group: 1, value: 1 },
              { id: 20, group: 2, value: 1 },
            ],
          )
          const live = createLiveQueryCollection((q) =>
            q
              .from({ parent: parents.collection })
              .orderBy(({ parent }) => parent.rank)
              .limit(1)
              .select(({ parent }) => ({
                id: parent.id,
                value: parent.value,
                children: q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.group, parent.group)),
              })),
          )

          await live.preload()
          const rootLayouts: Array<Array<number>> = []
          const rootWindows: Array<
            { offset: number; limit: number } | undefined
          > = []
          const childBatches: Array<Array<number>> = []
          let childSubscription: { unsubscribe: () => void } | undefined
          let childRevision = -1
          let actionResult: true | Promise<void> | undefined
          let acted = false
          const rootSubscription = live.subscribeChanges(
            () => {
              rootLayouts.push(live.toArray.map(({ id }) => id))
              rootWindows.push(live.utils.getWindow())
              if (acted) return
              acted = true
              if (callbackAction === `source-write`) {
                const parentId = turnOrigin === `window` ? 2 : 1
                const childId = parentId === 1 ? 10 : 20
                const facade = live.get(parentId)!.children
                childRevision = facade._stateRevision
                childSubscription = facade.subscribeChanges(
                  (batch) => {
                    childBatches.push(batch.map((change) => change.value.value))
                  },
                  { includeInitialState: false },
                )
                children.write(`update`, {
                  id: childId,
                  group: parentId,
                  value: 3,
                })
              } else {
                actionResult = live.utils.setWindow(
                  turnOrigin === `window`
                    ? { offset: 1, limit: 1 }
                    : { offset: 0, limit: 2 },
                )
              }
            },
            { includeInitialState: false },
          )

          try {
            if (turnOrigin === `source`) {
              parents.write(`update`, {
                id: 1,
                rank: 1,
                group: 1,
                value: 2,
              })
            } else {
              const result = live.utils.setWindow({ offset: 0, limit: 2 })
              if (result instanceof Promise) await result
            }
            if (actionResult instanceof Promise) await actionResult
            await flushPromises()

            if (callbackAction === `source-write`) {
              const parentId = turnOrigin === `window` ? 2 : 1
              const childId = parentId === 1 ? 10 : 20
              const facade = live.get(parentId)!.children
              expect(facade.get(childId)!.value).toBe(3)
              expect(childBatches.at(-1)).toEqual([3])
              expect(facade._stateRevision).toBe(childRevision + 1)
              expect(rootWindows).toEqual([
                turnOrigin === `window`
                  ? { offset: 0, limit: 2 }
                  : { offset: 0, limit: 1 },
              ])
            } else if (turnOrigin === `source`) {
              expect(rootLayouts).toEqual([[1], [1, 2]])
              expect(rootWindows).toEqual([
                { offset: 0, limit: 1 },
                { offset: 0, limit: 2 },
              ])
              expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
              expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
            } else {
              expect(rootLayouts).toEqual([[1, 2], [2]])
              expect(rootWindows).toEqual([
                { offset: 0, limit: 2 },
                { offset: 1, limit: 1 },
              ])
              expect(live.toArray.map(({ id }) => id)).toEqual([2])
              expect(live.utils.getWindow()).toEqual({ offset: 1, limit: 1 })
            }
          } finally {
            rootSubscription.unsubscribe()
            childSubscription?.unsubscribe()
            await Promise.all([
              live.cleanup(),
              parents.collection.cleanup(),
              children.collection.cleanup(),
            ])
          }
        },
      )
    }
  }

  fcTest(
    `a rejected nested window restores its parent operation's window`,
    async () => {
      const parents = createControlledCollection(`nested-window-parents`, [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({ id: parent.id })),
      )

      await live.preload()
      const nestedFailure = new Error(`nested window failed`)
      const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
      const runGraph = Reflect.get(builder, `maybeRunGraphFn`) as () => void
      let failNextGraph = false
      Reflect.set(builder, `maybeRunGraphFn`, () => {
        runGraph()
        if (failNextGraph) {
          failNextGraph = false
          builder.recordSubsetError(nestedFailure)
        }
      })

      const rootLayouts: Array<Array<number>> = []
      let nestedError: unknown
      let acted = false
      const rootSubscription = live.subscribeChanges(
        () => {
          rootLayouts.push(live.toArray.map(({ id }) => id))
          if (acted) return
          acted = true
          failNextGraph = true
          try {
            live.utils.setWindow({ offset: 1, limit: 1 })
          } catch (error) {
            nestedError = error
          }
        },
        { includeInitialState: false },
      )

      try {
        live.utils.setWindow({ offset: 0, limit: 2 })

        expect(nestedError).toBe(nestedFailure)
        expect(rootLayouts[0]).toEqual([1, 2])
        expect(rootLayouts.at(-1)).toEqual([1, 2])
        expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
      } finally {
        rootSubscription.unsubscribe()
        await Promise.all([live.cleanup(), parents.collection.cleanup()])
      }
    },
  )

  fcTest(
    `a rejected nested window preserves its parent operation outcome`,
    async () => {
      const parents = createControlledCollection(`parent-window-outcome`, [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({ id: parent.id })),
      )

      await live.preload()
      const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
      const originalWindowFn = Reflect.get(builder, `windowFn`) as (options: {
        offset?: number
        limit?: number
      }) => void
      const parentOutcome = createDeferred<{
        collectionId: string
        demand: { limit: number }
        generation: number
        extent: `exhausted`
      }>()
      Reflect.set(builder, `windowFn`, (options: { limit?: number }) => {
        originalWindowFn(options)
        if (options.limit === 2) {
          builder.trackSubsetLoadOperationPromise(parentOutcome.promise, `root`)
        }
      })
      const nestedFailure = new Error(`nested failed`)
      const runGraph = Reflect.get(builder, `maybeRunGraphFn`) as () => void
      let failNested = false
      Reflect.set(builder, `maybeRunGraphFn`, () => {
        runGraph()
        if (!failNested) return
        failNested = false
        builder.recordSubsetError(nestedFailure)
      })
      let nestedError: unknown
      let acted = false
      const subscription = live.subscribeChanges(
        () => {
          if (acted) return
          acted = true
          failNested = true
          try {
            live.utils.setWindow({ offset: 1, limit: 1 })
          } catch (error) {
            nestedError = error
          }
        },
        { includeInitialState: false },
      )

      try {
        const parentReady = live.utils.setWindow({ offset: 0, limit: 2 })
        expect(parentReady).toBeInstanceOf(Promise)
        expect(nestedError).toBe(nestedFailure)
        parentOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await parentReady
        expect(live.utils[LIVE_QUERY_INTERNAL].getLastWindowOutcomes()).toEqual(
          [expect.objectContaining({ demand: { limit: 2 } })],
        )
      } finally {
        subscription.unsubscribe()
        parentOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await Promise.all([live.cleanup(), parents.collection.cleanup()])
      }
    },
  )

  fcTest(
    `a rejected nested window restores its parent operation for follow-up work`,
    async () => {
      const parents = createControlledCollection(`parent-window-follow-up`, [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({ id: parent.id })),
      )

      await live.preload()
      const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
      const rollbackOutcome = createDeferred<{
        collectionId: string
        demand: { limit: number }
        generation: number
        extent: `exhausted`
      }>()
      const afterCatchOutcome = createDeferred<{
        collectionId: string
        demand: { limit: number }
        generation: number
        extent: `exhausted`
      }>()
      const originalWindowFn = Reflect.get(builder, `windowFn`) as (options: {
        limit?: number
      }) => void
      let parentWindowCalls = 0
      Reflect.set(builder, `windowFn`, (options: { limit?: number }) => {
        originalWindowFn(options)
        if (options.limit === 2 && ++parentWindowCalls === 2) {
          builder.trackSubsetLoadOperationPromise(
            rollbackOutcome.promise,
            `rollback`,
          )
        }
      })
      const nestedFailure = new Error(`nested failed`)
      const runGraph = Reflect.get(builder, `maybeRunGraphFn`) as () => void
      let failNested = false
      Reflect.set(builder, `maybeRunGraphFn`, () => {
        runGraph()
        if (!failNested) return
        failNested = false
        builder.recordSubsetError(nestedFailure)
      })
      let nestedError: unknown
      let acted = false
      const subscription = live.subscribeChanges(
        () => {
          if (acted) return
          acted = true
          failNested = true
          try {
            live.utils.setWindow({ offset: 1, limit: 1 })
          } catch (error) {
            nestedError = error
          }
          builder.trackSubsetLoadOperationPromise(
            afterCatchOutcome.promise,
            `after-catch`,
          )
        },
        { includeInitialState: false },
      )

      try {
        const parentReady = live.utils.setWindow({ offset: 0, limit: 2 })
        expect(nestedError).toBe(nestedFailure)
        expect(parentReady).toBeInstanceOf(Promise)
        rollbackOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        afterCatchOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await parentReady
        expect(live.utils[LIVE_QUERY_INTERNAL].getLastWindowOutcomes()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceId: `rollback`,
              demand: { limit: 2 },
            }),
            expect.objectContaining({
              sourceId: `after-catch`,
              demand: { limit: 2 },
            }),
          ]),
        )
      } finally {
        subscription.unsubscribe()
        rollbackOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        afterCatchOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await Promise.all([live.cleanup(), parents.collection.cleanup()])
      }
    },
  )

  fcTest(
    `a rejected nested window restores a waiting parent operation`,
    async () => {
      const parents = createControlledCollection(`waiting-window-parent`, [
        { id: 1, rank: 1, value: 1 },
        { id: 2, rank: 2, value: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({ id: parent.id, value: parent.value })),
      )

      await live.preload()
      const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
      type Outcome = {
        collectionId: string
        demand: { limit: number }
        generation: number
        extent: `exhausted`
      }
      const initialOutcome = createDeferred<Outcome>()
      const beforeNestedOutcome = createDeferred<Outcome>()
      const rollbackOutcome = createDeferred<Outcome>()
      const afterCatchOutcome = createDeferred<Outcome>()
      const originalWindowFn = Reflect.get(builder, `windowFn`) as (options: {
        limit?: number
      }) => void
      let parentWindowCalls = 0
      Reflect.set(builder, `windowFn`, (options: { limit?: number }) => {
        originalWindowFn(options)
        if (options.limit !== 2) return
        parentWindowCalls++
        if (parentWindowCalls === 1) {
          builder.trackSubsetLoadOperationPromise(
            initialOutcome.promise,
            `initial`,
          )
        } else if (parentWindowCalls === 2) {
          builder.trackSubsetLoadOperationPromise(
            rollbackOutcome.promise,
            `rollback`,
          )
        }
      })

      const parentReady = live.utils.setWindow({ offset: 0, limit: 2 })
      expect(parentReady).toBeInstanceOf(Promise)

      const nestedFailure = new Error(`nested failed`)
      const runGraph = Reflect.get(builder, `maybeRunGraphFn`) as () => void
      let failNested = false
      Reflect.set(builder, `maybeRunGraphFn`, () => {
        runGraph()
        if (!failNested) return
        failNested = false
        builder.recordSubsetError(nestedFailure)
      })
      let nestedError: unknown
      let acted = false
      const subscription = live.subscribeChanges(
        () => {
          if (acted) return
          acted = true
          builder.trackSubsetLoadOperationPromise(
            beforeNestedOutcome.promise,
            `before-nested`,
          )
          failNested = true
          try {
            live.utils.setWindow({ offset: 1, limit: 1 })
          } catch (error) {
            nestedError = error
          }
          builder.trackSubsetLoadOperationPromise(
            afterCatchOutcome.promise,
            `after-catch`,
          )
        },
        { includeInitialState: false },
      )

      try {
        parents.write(`update`, { id: 1, rank: 1, value: 3 })
        expect(nestedError).toBe(nestedFailure)
        expect(parentWindowCalls).toBe(2)
        expect(live.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
          { id: 1, value: 3 },
          { id: 2, value: 2 },
        ])
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })

        let parentSettled = false
        void Promise.resolve(parentReady).then(() => {
          parentSettled = true
        })
        initialOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await flushPromises()
        expect(parentSettled).toBe(false)

        beforeNestedOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await flushPromises()
        expect(parentSettled).toBe(false)

        rollbackOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await flushPromises()
        expect(parentSettled).toBe(false)

        afterCatchOutcome.resolve({
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted`,
        })
        await parentReady
        expect(
          live.utils[LIVE_QUERY_INTERNAL].getLastWindowOutcomes().map(
            ({ sourceId }) => sourceId,
          ),
        ).toEqual([`initial`, `before-nested`, `rollback`, `after-catch`])
      } finally {
        subscription.unsubscribe()
        const outcome = {
          collectionId: `parents`,
          demand: { limit: 2 },
          generation: 1,
          extent: `exhausted` as const,
        }
        initialOutcome.resolve(outcome)
        beforeNestedOutcome.resolve(outcome)
        rollbackOutcome.resolve(outcome)
        afterCatchOutcome.resolve(outcome)
        await Promise.all([live.cleanup(), parents.collection.cleanup()])
      }
    },
  )

  fcTest(
    `an older failed window cannot restore over a newer nested window`,
    async () => {
      const parents = createControlledCollection(`stale-window-parents`, [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({ id: parent.id })),
      )

      await live.preload()
      const outerFailure = new Error(`outer window failed`)
      const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
      const rootLayouts: Array<Array<number>> = []
      let acted = false
      const rootSubscription = live.subscribeChanges(
        () => {
          rootLayouts.push(live.toArray.map(({ id }) => id))
          if (acted) return
          acted = true
          live.utils.setWindow({ offset: 1, limit: 1 })
          builder.recordSubsetError(outerFailure)
        },
        { includeInitialState: false },
      )

      try {
        expect(() => live.utils.setWindow({ offset: 0, limit: 2 })).toThrow(
          outerFailure,
        )

        expect(rootLayouts).toEqual([[1, 2], [2]])
        expect(live.toArray.map(({ id }) => id)).toEqual([2])
        expect(live.utils.getWindow()).toEqual({ offset: 1, limit: 1 })
      } finally {
        rootSubscription.unsubscribe()
        await Promise.all([live.cleanup(), parents.collection.cleanup()])
      }
    },
  )

  fcTest(
    `failed window restoration serializes callback-created source work`,
    async () => {
      const parents = createControlledCollection(`rollback-window-parents`, [
        { id: 1, rank: 1, group: 1 },
        { id: 2, rank: 2, group: 2 },
      ])
      const children = createControlledCollection(`rollback-window-children`, [
        { id: 10, group: 1, value: 1 },
        { id: 20, group: 2, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.rank)
          .limit(1)
          .select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.group, parent.group)),
          })),
      )

      await live.preload()
      const failure = new Error(`requested window failed`)
      const builder = live.utils[LIVE_QUERY_INTERNAL].getBuilder()
      const runGraph = Reflect.get(builder, `maybeRunGraphFn`) as () => void
      let failRequestedWindow = true
      Reflect.set(builder, `maybeRunGraphFn`, () => {
        runGraph()
        if (failRequestedWindow) {
          failRequestedWindow = false
          builder.recordSubsetError(failure)
        }
      })

      const facade = live.get(1)!.children
      const rootLayouts: Array<Array<number>> = []
      const rootWindows: Array<{ offset: number; limit: number } | undefined> =
        []
      const childBatches: Array<Array<number>> = []
      let sawRequestedWindow = false
      let acted = false
      const rootSubscription = live.subscribeChanges(
        () => {
          const layout = live.toArray.map(({ id }) => id)
          rootLayouts.push(layout)
          rootWindows.push(live.utils.getWindow())
          if (layout.length === 2) sawRequestedWindow = true
          if (!sawRequestedWindow || acted || layout.length !== 1) return
          acted = true
          children.write(`update`, { id: 10, group: 1, value: 3 })
        },
        { includeInitialState: false },
      )
      const childSubscription = facade.subscribeChanges(
        (batch) => {
          childBatches.push(batch.map((change) => change.value.value))
        },
        { includeInitialState: false },
      )

      try {
        expect(() => live.utils.setWindow({ offset: 0, limit: 2 })).toThrow(
          failure,
        )

        expect(rootLayouts).toEqual([[1, 2], [1]])
        expect(rootWindows).toEqual([
          { offset: 0, limit: 2 },
          { offset: 0, limit: 1 },
        ])
        expect(live.toArray.map(({ id }) => id)).toEqual([1])
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
        expect(live.utils.lastSubsetError).toBe(failure)
        expect(facade.get(10)!.value).toBe(3)
        expect(childBatches.at(-1)).toEqual([3])
      } finally {
        rootSubscription.unsubscribe()
        childSubscription.unsubscribe()
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  for (const settlement of pendingFacadeSettlements) {
    for (const optimisticOperation of pendingFacadeOptimisticOperations) {
      for (const sourceOperation of pendingFacadeSourceOperations) {
        for (const keyRelation of pendingFacadeKeyRelations) {
          if (sourceOperation === `insert` && keyRelation === `same-key`) {
            continue
          }
          for (const shape of pendingFacadeShapes) {
            fcTest(
              `publishes an ${shape} ${keyRelation} source ${sourceOperation} while a facade ${optimisticOperation} ${settlement}s`,
              async () => {
                const parents = createControlledCollection(
                  `pending-facade-parents`,
                  [{ id: 1, group: 1 }],
                )
                const children = createControlledCollection(
                  `pending-facade-children`,
                  pendingFacadeInitialRows,
                )
                const live = createLiveQueryCollection((q) =>
                  q
                    .from({ parent: parents.collection })
                    .select(({ parent }) => {
                      const childRows = q
                        .from({ child: children.collection })
                        .where(({ child }) =>
                          eq(child.parentGroup, parent.group),
                        )
                      return {
                        id: parent.id,
                        children:
                          shape === `ordered`
                            ? childRows.orderBy(({ child }) => child.value)
                            : childRows,
                      }
                    }),
                )
                const persistence = createDeferred<void>()

                await live.preload()
                const facade = live.get(1)!.children
                const childRows = () =>
                  projectPendingFacadeRows(facade.toArray, shape)
                const rootRows = () =>
                  live.toArray.map(
                    ({ id: parentId, children: rootFacade }) => ({
                      id: parentId,
                      children: projectPendingFacadeRows(
                        rootFacade.toArray,
                        shape,
                      ),
                    }),
                  )
                const rootPublications: Array<unknown> = []
                const childPublications: Array<Array<ProjectedChildChange>> = []
                const childCallbackSnapshots: Array<{
                  facade: Array<ChildRow>
                  root: ReturnType<typeof rootRows>
                }> = []
                const rootSubscription = live.subscribeChanges(
                  (batch) => rootPublications.push(batch),
                  { includeInitialState: false },
                )
                const childSubscription = facade.subscribeChanges(
                  (batch) => {
                    childPublications.push(batch.map(projectChildChange))
                    childCallbackSnapshots.push({
                      facade: childRows(),
                      root: rootRows(),
                    })
                  },
                  { includeInitialState: false },
                )
                const optimisticRow =
                  pendingOptimisticFacadeRow(optimisticOperation)
                const sourceRow = pendingSourceFacadeRow(
                  sourceOperation,
                  keyRelation,
                )
                const mutate = createOptimisticAction<void>({
                  onMutate: () => {
                    if (optimisticOperation === `update`) {
                      facade.update(optimisticRow.id, (draft) => {
                        draft.value = optimisticRow.value
                      })
                    } else {
                      facade.delete(optimisticRow.id)
                    }
                  },
                  mutationFn: () => persistence.promise,
                })
                const transaction = mutate()
                const initialRows = new Map(
                  pendingFacadeInitialRows.map(
                    (row) => [row.id, { ...row }] as const,
                  ),
                )
                const afterOptimistic = new Map(initialRows)
                applyPendingFacadeOperation(
                  afterOptimistic,
                  optimisticOperation,
                  optimisticRow,
                )
                const afterSource = new Map(initialRows)
                applyPendingFacadeOperation(
                  afterSource,
                  sourceOperation,
                  sourceRow,
                )
                const whilePending = new Map(afterSource)
                applyPendingFacadeOperation(
                  whilePending,
                  optimisticOperation,
                  optimisticRow,
                )
                const expectedOptimisticChange = expectedPendingFacadeChange(
                  initialRows,
                  afterOptimistic,
                  optimisticRow.id,
                )
                const expectedSourceChange = expectedPendingFacadeChange(
                  afterOptimistic,
                  whilePending,
                  sourceRow.id,
                )
                const expectedSettlementChange = expectedPendingFacadeChange(
                  whilePending,
                  afterSource,
                  optimisticRow.id,
                )
                const optimisticRows = expectedPendingFacadeRows(
                  afterOptimistic,
                  shape,
                  initialRows,
                )
                const pendingRows = expectedPendingFacadeRows(
                  whilePending,
                  shape,
                  afterSource,
                )
                const settledRows = expectedPendingFacadeRows(
                  afterSource,
                  shape,
                  afterSource,
                )
                const sourceLayoutChanged =
                  shape === `ordered` &&
                  (optimisticRows.length !== pendingRows.length ||
                    optimisticRows.some(
                      (row, index) => row.id !== pendingRows[index]?.id,
                    ))
                const expectedSourcePublication = expectedSourceChange
                  ? [expectedSourceChange]
                  : sourceLayoutChanged
                    ? []
                    : undefined
                const expectedSourcePublications = [
                  [expectedOptimisticChange],
                  ...(expectedSourcePublication
                    ? [expectedSourcePublication]
                    : []),
                ]
                const expectedSourceSnapshots = [
                  {
                    facade: optimisticRows,
                    root: [{ id: 1, children: optimisticRows }],
                  },
                  ...(expectedSourcePublication
                    ? [
                        {
                          facade: pendingRows,
                          root: [{ id: 1, children: pendingRows }],
                        },
                      ]
                    : []),
                ]
                const expectedSettledPublications = [
                  ...expectedSourcePublications,
                  ...(expectedSettlementChange
                    ? [[expectedSettlementChange]]
                    : []),
                ]
                const expectedSettledSnapshots = [
                  ...expectedSourceSnapshots,
                  ...(expectedSettlementChange
                    ? [
                        {
                          facade: settledRows,
                          root: [{ id: 1, children: settledRows }],
                        },
                      ]
                    : []),
                ]

                try {
                  expect(transaction.state).toBe(`persisting`)
                  expect(childRows()).toEqual(optimisticRows)
                  expect(rootPublications).toEqual([])
                  expect(childPublications).toEqual([
                    [expectedOptimisticChange],
                  ])
                  expect(childCallbackSnapshots).toEqual(
                    expectedSourceSnapshots.slice(0, 1),
                  )

                  children.write(sourceOperation, sourceRow)

                  expect(live.get(1)!.children).toBe(facade)
                  expect(childRows()).toEqual(pendingRows)
                  expect(rootPublications).toEqual([])
                  expect(childCallbackSnapshots).toEqual(
                    expectedSourceSnapshots,
                  )
                  expect(childPublications).toEqual(expectedSourcePublications)

                  const persisted = transaction.isPersisted.promise.catch(
                    () => undefined,
                  )
                  if (settlement === `resolve`) persistence.resolve()
                  else persistence.reject(new Error(`facade mutation rejected`))
                  await persisted
                  await flushPromises()

                  expect(childRows()).toEqual(settledRows)
                  expect(rootPublications).toEqual([])
                  expect(childPublications).toEqual(expectedSettledPublications)
                  expect(childCallbackSnapshots).toEqual(
                    expectedSettledSnapshots,
                  )
                } finally {
                  persistence.resolve()
                  await transaction.isPersisted.promise.catch(() => undefined)
                  rootSubscription.unsubscribe()
                  childSubscription.unsubscribe()
                  await Promise.all([
                    live.cleanup(),
                    parents.collection.cleanup(),
                    children.collection.cleanup(),
                  ])
                }
              },
            )
          }
        }
      }
    }
  }

  for (const settlement of pendingFacadeSettlements) {
    fcTest(
      `publishes a non-projected same-key order move while its facade update ${settlement}s`,
      async () => {
        type OrderedSourceChild = ChildRow & { position: number }
        const parents = createControlledCollection(`hidden-order-parents`, [
          { id: 1, group: 1 },
        ])
        const children = createControlledCollection<OrderedSourceChild>(
          `hidden-order-children`,
          [
            { id: 10, parentGroup: 1, value: 10, position: 0 },
            { id: 20, parentGroup: 1, value: 20, position: 1 },
          ],
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.position)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                value: child.value,
              })),
          })),
        )
        const persistence = createDeferred<void>()

        await live.preload()
        const facade = live.get(1)!.children
        const ids = () => facade.toArray.map(({ id }) => id)
        const values = () => facade.toArray.map(({ value }) => value)
        const publications: Array<Array<ProjectedChildChange>> = []
        const callbackIds: Array<Array<number>> = []
        const callbackValues: Array<Array<number>> = []
        const subscription = facade.subscribeChanges(
          (batch) => {
            publications.push(batch.map(projectChildChange))
            callbackIds.push(ids())
            callbackValues.push(values())
          },
          { includeInitialState: false },
        )
        const mutate = createOptimisticAction<void>({
          onMutate: () => {
            facade.update(10, (draft) => {
              draft.value = 11
            })
          },
          mutationFn: () => persistence.promise,
        })
        const transaction = mutate()
        const revisionBeforeSource = facade._layoutRevision

        try {
          expect(ids()).toEqual([10, 20])
          expect(values()).toEqual([11, 20])
          expect(publications).toEqual([
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 11 },
                previousValue: { id: 10, parentGroup: 1, value: 10 },
              },
            ],
          ])

          children.write(`update`, {
            id: 10,
            parentGroup: 1,
            value: 10,
            position: 2,
          })

          expect(ids()).toEqual([20, 10])
          expect(values()).toEqual([20, 11])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 1)
          expect(publications).toEqual([
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 11 },
                previousValue: { id: 10, parentGroup: 1, value: 10 },
              },
            ],
            [],
          ])
          expect(callbackIds).toEqual([
            [10, 20],
            [20, 10],
          ])
          expect(callbackValues).toEqual([
            [11, 20],
            [20, 11],
          ])

          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          if (settlement === `resolve`) persistence.resolve()
          else persistence.reject(new Error(`hidden order mutation rejected`))
          await persisted
          await flushPromises()

          expect(ids()).toEqual([20, 10])
          expect(values()).toEqual([20, 10])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 1)
          expect(publications).toEqual([
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 11 },
                previousValue: { id: 10, parentGroup: 1, value: 10 },
              },
            ],
            [],
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 10 },
                previousValue: { id: 10, parentGroup: 1, value: 11 },
              },
            ],
          ])
          expect(callbackIds).toEqual([
            [10, 20],
            [20, 10],
            [20, 10],
          ])
          expect(callbackValues).toEqual([
            [11, 20],
            [20, 11],
            [20, 10],
          ])
        } finally {
          persistence.resolve()
          await transaction.isPersisted.promise.catch(() => undefined)
          subscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
          ])
        }
      },
    )
  }

  for (const settlement of pendingFacadeSettlements) {
    fcTest(
      `publishes an independent joined order move while a facade update ${settlement}s`,
      async () => {
        type SortRow = { id: number; childId: number; position: number }
        const parents = createControlledCollection(`joined-order-parents`, [
          { id: 1, group: 1 },
        ])
        const children = createControlledCollection(`joined-order-children`, [
          { id: 10, parentGroup: 1, value: 10 },
          { id: 20, parentGroup: 1, value: 20 },
        ])
        const sorts = createControlledCollection<SortRow>(
          `joined-order-sorts`,
          [
            { id: 100, childId: 10, position: 0 },
            { id: 200, childId: 20, position: 1 },
          ],
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .join({ sort: sorts.collection }, ({ child, sort }) =>
                eq(child.id, sort.childId),
              )
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ sort }) => sort.position)
              .select(({ child }) => child),
          })),
        )
        const persistence = createDeferred<void>()

        await live.preload()
        const facade = live.get(1)!.children
        const ids = () => facade.toArray.map(({ id }) => id)
        const values = () => facade.toArray.map(({ value }) => value)
        const publications: Array<Array<ProjectedChildChange>> = []
        const callbackIds: Array<Array<number>> = []
        const callbackValues: Array<Array<number>> = []
        const subscription = facade.subscribeChanges(
          (batch) => {
            publications.push(batch.map(projectChildChange))
            callbackIds.push(ids())
            callbackValues.push(values())
          },
          { includeInitialState: false },
        )
        const mutate = createOptimisticAction<void>({
          onMutate: () => {
            facade.update(10, (draft) => {
              draft.value = 11
            })
          },
          mutationFn: () => persistence.promise,
        })
        const transaction = mutate()
        const revisionBeforeSource = facade._layoutRevision

        try {
          expect(ids()).toEqual([10, 20])
          expect(values()).toEqual([11, 20])

          sorts.write(`update`, { id: 100, childId: 10, position: 2 })

          expect(ids()).toEqual([20, 10])
          expect(values()).toEqual([20, 11])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 1)
          expect(publications).toEqual([
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 11 },
                previousValue: { id: 10, parentGroup: 1, value: 10 },
              },
            ],
            [],
          ])
          expect(callbackIds).toEqual([
            [10, 20],
            [20, 10],
          ])
          expect(callbackValues).toEqual([
            [11, 20],
            [20, 11],
          ])

          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          if (settlement === `resolve`) persistence.resolve()
          else persistence.reject(new Error(`joined order mutation rejected`))
          await persisted
          await flushPromises()

          expect(ids()).toEqual([20, 10])
          expect(values()).toEqual([20, 10])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 1)
          expect(publications).toEqual([
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 11 },
                previousValue: { id: 10, parentGroup: 1, value: 10 },
              },
            ],
            [],
            [
              {
                type: `update`,
                key: 10,
                value: { id: 10, parentGroup: 1, value: 10 },
                previousValue: { id: 10, parentGroup: 1, value: 11 },
              },
            ],
          ])
          expect(callbackIds).toEqual([
            [10, 20],
            [20, 10],
            [20, 10],
          ])
          expect(callbackValues).toEqual([
            [11, 20],
            [20, 11],
            [20, 10],
          ])
        } finally {
          persistence.resolve()
          await transaction.isPersisted.promise.catch(() => undefined)
          subscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
            sorts.collection.cleanup(),
          ])
        }
      },
    )
  }

  for (const settlement of pendingFacadeSettlements) {
    fcTest(
      `keeps a projected optimistic value visible through a same-key base reinsert that ${settlement}s`,
      async () => {
        type OrderedSourceChild = ChildRow & { position: number }
        const parents = createControlledCollection(`reinsert-order-parents`, [
          { id: 1, group: 1 },
        ])
        const sourceRows: ReadonlyArray<OrderedSourceChild> = [
          { id: 10, parentGroup: 1, value: 10, position: 0 },
          { id: 20, parentGroup: 1, value: 20, position: 1 },
        ]
        const children = createControlledCollection(
          `reinsert-order-children`,
          sourceRows,
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.position)
              .select(({ child }) => ({ value: child.value })),
          })),
        )
        const persistence = createDeferred<void>()

        await live.preload()
        const facade = live.get(1)!.children
        const keys = () => [...facade.keys()].map(Number)
        const values = () => facade.toArray.map(({ value }) => value)
        const publications: Array<Array<ProjectedValueChange>> = []
        const callbackKeys: Array<Array<number>> = []
        const callbackValues: Array<Array<number>> = []
        const subscription = facade.subscribeChanges(
          (batch) => {
            publications.push(batch.map(projectValueChange))
            callbackKeys.push(keys())
            callbackValues.push(values())
          },
          { includeInitialState: false },
        )
        const mutate = createOptimisticAction<void>({
          onMutate: () => {
            facade.update(10, (draft) => {
              draft.value = 11
            })
          },
          mutationFn: () => persistence.promise,
        })
        const transaction = mutate()

        try {
          expect(transaction.state).toBe(`persisting`)
          expect(keys()).toEqual([10, 20])
          expect(values()).toEqual([11, 20])
          publications.length = 0
          callbackKeys.length = 0
          callbackValues.length = 0
          const revisionBeforeSource = facade._layoutRevision

          children.write(`delete`, sourceRows[0]!)

          expect(keys()).toEqual([20, 10])
          expect(values()).toEqual([20, 11])
          expect(publications).toEqual([[]])
          expect(callbackKeys).toEqual([[20, 10]])
          expect(callbackValues).toEqual([[20, 11]])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 1)

          children.write(`insert`, sourceRows[0]!)

          expect(keys()).toEqual([10, 20])
          expect(values()).toEqual([11, 20])
          expect(publications).toEqual([[], []])
          expect(callbackKeys).toEqual([
            [20, 10],
            [10, 20],
          ])
          expect(callbackValues).toEqual([
            [20, 11],
            [11, 20],
          ])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 2)

          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          if (settlement === `resolve`) persistence.resolve()
          else persistence.reject(new Error(`reinsert mutation rejected`))
          await persisted
          await flushPromises()

          expect(keys()).toEqual([10, 20])
          expect(values()).toEqual([10, 20])
          expect(publications).toEqual([
            [],
            [],
            [
              {
                type: `update`,
                key: 10,
                value: 10,
                previousValue: 11,
              },
            ],
          ])
          expect(callbackKeys).toEqual([
            [20, 10],
            [10, 20],
            [10, 20],
          ])
          expect(callbackValues).toEqual([
            [20, 11],
            [11, 20],
            [10, 20],
          ])
          expect(facade._layoutRevision).toBe(revisionBeforeSource + 2)
        } finally {
          persistence.resolve()
          await transaction.isPersisted.promise.catch(() => undefined)
          subscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
          ])
        }
      },
    )
  }

  for (const settlement of pendingFacadeSettlements) {
    for (const targetPosition of [`first`, `last`] as const) {
      fcTest(
        `publishes a base-to-optimistic-suffix move only when a ${targetPosition} row changes layout and ${settlement}s`,
        async () => {
          type OrderedSourceChild = ChildRow & { position: number }
          const parents = createControlledCollection(`suffix-order-parents`, [
            { id: 1, group: 1 },
          ])
          const target: OrderedSourceChild = {
            id: 10,
            parentGroup: 1,
            value: 10,
            position: targetPosition === `first` ? 0 : 1,
          }
          const peer: OrderedSourceChild = {
            id: 20,
            parentGroup: 1,
            value: 20,
            position: targetPosition === `first` ? 1 : 0,
          }
          const children = createControlledCollection(`suffix-order-children`, [
            target,
            peer,
          ])
          const live = createLiveQueryCollection((q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              children: q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .orderBy(({ child }) => child.position)
                .select(({ child }) => ({ value: child.value })),
            })),
          )
          const persistence = createDeferred<void>()

          await live.preload()
          const facade = live.get(1)!.children
          const keys = () => [...facade.keys()].map(Number)
          const values = () => facade.toArray.map(({ value }) => value)
          const publications: Array<Array<ProjectedValueChange>> = []
          const callbackKeys: Array<Array<number>> = []
          const subscription = facade.subscribeChanges(
            (batch) => {
              publications.push(batch.map(projectValueChange))
              callbackKeys.push(keys())
            },
            { includeInitialState: false },
          )
          const mutate = createOptimisticAction<void>({
            onMutate: () => {
              facade.update(10, (draft) => {
                draft.value = 11
              })
            },
            mutationFn: () => persistence.promise,
          })
          const transaction = mutate()

          try {
            expect(keys()).toEqual(
              targetPosition === `first` ? [10, 20] : [20, 10],
            )
            expect(values()).toEqual(
              targetPosition === `first` ? [11, 20] : [20, 11],
            )
            publications.length = 0
            callbackKeys.length = 0
            const revisionBeforeSource = facade._layoutRevision

            children.write(`delete`, target)

            expect(keys()).toEqual([20, 10])
            expect(values()).toEqual([20, 11])
            expect(publications).toEqual(targetPosition === `first` ? [[]] : [])
            expect(callbackKeys).toEqual(
              targetPosition === `first` ? [[20, 10]] : [],
            )
            expect(facade._layoutRevision).toBe(
              revisionBeforeSource + (targetPosition === `first` ? 1 : 0),
            )

            const persisted = transaction.isPersisted.promise.catch(
              () => undefined,
            )
            if (settlement === `resolve`) persistence.resolve()
            else persistence.reject(new Error(`suffix mutation rejected`))
            await persisted
            await flushPromises()

            expect(keys()).toEqual([20])
            expect(values()).toEqual([20])
            expect(publications.at(-1)).toEqual([
              {
                type: `delete`,
                key: 10,
                value: 11,
              },
            ])
            expect(callbackKeys.at(-1)).toEqual([20])
            expect(facade._layoutRevision).toBe(
              revisionBeforeSource + (targetPosition === `first` ? 1 : 0),
            )
          } finally {
            persistence.resolve()
            await transaction.isPersisted.promise.catch(() => undefined)
            subscription.unsubscribe()
            await Promise.all([
              live.cleanup(),
              parents.collection.cleanup(),
              children.collection.cleanup(),
            ])
          }
        },
      )
    }
  }

  for (const settlement of pendingFacadeSettlements) {
    fcTest(
      `does not publish a same-source order move across an optimistically deleted peer that ${settlement}s`,
      async () => {
        type OrderedSourceChild = ChildRow & { position: number }
        const parents = createControlledCollection(`hidden-peer-parents`, [
          { id: 1, group: 1 },
        ])
        const children = createControlledCollection<OrderedSourceChild>(
          `hidden-peer-children`,
          [
            { id: 10, parentGroup: 1, value: 10, position: 0 },
            { id: 20, parentGroup: 1, value: 20, position: 1 },
          ],
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.position)
              .select(({ child }) => ({ value: child.value })),
          })),
        )
        const persistence = createDeferred<void>()

        await live.preload()
        const facade = live.get(1)!.children
        const keys = () => [...facade.keys()].map(Number)
        const values = () => facade.toArray.map(({ value }) => value)
        const publications: Array<Array<ProjectedValueChange>> = []
        const callbackKeys: Array<Array<number>> = []
        const subscription = facade.subscribeChanges(
          (batch) => {
            publications.push(batch.map(projectValueChange))
            callbackKeys.push(keys())
          },
          { includeInitialState: false },
        )
        const mutate = createOptimisticAction<void>({
          onMutate: () => facade.delete(10),
          mutationFn: () => persistence.promise,
        })
        const transaction = mutate()

        try {
          expect(keys()).toEqual([20])
          expect(values()).toEqual([20])
          publications.length = 0
          callbackKeys.length = 0
          const revisionBeforeSource = facade._layoutRevision

          children.write(`update`, {
            id: 20,
            parentGroup: 1,
            value: 20,
            position: -1,
          })

          expect(keys()).toEqual([20])
          expect(values()).toEqual([20])
          expect(publications).toEqual([])
          expect(callbackKeys).toEqual([])
          expect(facade._layoutRevision).toBe(revisionBeforeSource)

          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          if (settlement === `resolve`) persistence.resolve()
          else persistence.reject(new Error(`hidden peer mutation rejected`))
          await persisted
          await flushPromises()

          expect(keys()).toEqual([20, 10])
          expect(values()).toEqual([20, 10])
          expect(publications).toEqual([
            [{ type: `insert`, key: 10, value: 10 }],
          ])
          expect(callbackKeys).toEqual([[20, 10]])
          expect(facade._layoutRevision).toBe(revisionBeforeSource)
        } finally {
          persistence.resolve()
          await transaction.isPersisted.promise.catch(() => undefined)
          subscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
          ])
        }
      },
    )
  }

  for (const settlement of pendingFacadeSettlements) {
    fcTest(
      `does not publish a joined order move across an optimistically deleted peer that ${settlement}s`,
      async () => {
        type SortRow = { id: number; childId: number; position: number }
        const parents = createControlledCollection(`joined-hidden-parents`, [
          { id: 1, group: 1 },
        ])
        const children = createControlledCollection(`joined-hidden-children`, [
          { id: 10, parentGroup: 1, value: 10 },
          { id: 20, parentGroup: 1, value: 20 },
        ])
        const sorts = createControlledCollection<SortRow>(
          `joined-hidden-sorts`,
          [
            { id: 100, childId: 10, position: 0 },
            { id: 200, childId: 20, position: 1 },
          ],
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .join({ sort: sorts.collection }, ({ child, sort }) =>
                eq(child.id, sort.childId),
              )
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ sort }) => sort.position)
              .select(({ child }) => ({ value: child.value })),
          })),
        )
        const persistence = createDeferred<void>()

        await live.preload()
        const facade = live.get(1)!.children
        const keys = () => [...facade.keys()].map(Number)
        const values = () => facade.toArray.map(({ value }) => value)
        const publications: Array<Array<ProjectedValueChange>> = []
        const callbackKeys: Array<Array<number>> = []
        const subscription = facade.subscribeChanges(
          (batch) => {
            publications.push(batch.map(projectValueChange))
            callbackKeys.push(keys())
          },
          { includeInitialState: false },
        )
        const mutate = createOptimisticAction<void>({
          onMutate: () => facade.delete(10),
          mutationFn: () => persistence.promise,
        })
        const transaction = mutate()

        try {
          expect(keys()).toEqual([20])
          expect(values()).toEqual([20])
          publications.length = 0
          callbackKeys.length = 0
          const revisionBeforeSource = facade._layoutRevision

          sorts.write(`update`, { id: 200, childId: 20, position: -1 })

          expect(keys()).toEqual([20])
          expect(values()).toEqual([20])
          expect(publications).toEqual([])
          expect(callbackKeys).toEqual([])
          expect(facade._layoutRevision).toBe(revisionBeforeSource)

          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          if (settlement === `resolve`) persistence.resolve()
          else persistence.reject(new Error(`joined hidden peer rejected`))
          await persisted
          await flushPromises()

          expect(keys()).toEqual([20, 10])
          expect(values()).toEqual([20, 10])
          expect(publications).toEqual([
            [{ type: `insert`, key: 10, value: 10 }],
          ])
          expect(callbackKeys).toEqual([[20, 10]])
          expect(facade._layoutRevision).toBe(revisionBeforeSource)
        } finally {
          persistence.resolve()
          await transaction.isPersisted.promise.catch(() => undefined)
          subscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
            sorts.collection.cleanup(),
          ])
        }
      },
    )
  }

  fcTest(
    `does not publish an order token change that preserves facade layout`,
    async () => {
      type OrderedSourceChild = ChildRow & { position: number }
      const parents = createControlledCollection(`stable-order-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection<OrderedSourceChild>(
        `stable-order-children`,
        [
          { id: 10, parentGroup: 1, value: 10, position: 0 },
          { id: 20, parentGroup: 1, value: 20, position: 2 },
        ],
      )
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => ({
          id: parent.id,
          children: q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.position)
            .select(({ child }) => ({
              id: child.id,
              parentGroup: child.parentGroup,
              value: child.value,
            })),
        })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const publications: Array<Array<ProjectedChildChange>> = []
      const subscription = facade.subscribeChanges(
        (batch) => publications.push(batch.map(projectChildChange)),
        { includeInitialState: false },
      )
      const revision = facade._layoutRevision

      try {
        children.write(`update`, {
          id: 10,
          parentGroup: 1,
          value: 10,
          position: 1,
        })

        expect(facade.toArray.map(({ id }) => id)).toEqual([10, 20])
        expect(facade._layoutRevision).toBe(revision)
        expect(publications).toEqual([])
      } finally {
        subscription.unsubscribe()
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  for (const settlement of pendingFacadeSettlements) {
    for (const optimisticOperation of pendingFacadeOptimisticOperations) {
      fcTest(
        `retires unrelated facade rows while a facade ${optimisticOperation} ${settlement}s`,
        async () => {
          const parents = createControlledCollection(
            `retiring-facade-parents`,
            [{ id: 1, group: 1 }],
          )
          const children = createControlledCollection(
            `retiring-facade-children`,
            pendingFacadeInitialRows,
          )
          const live = createLiveQueryCollection((q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              children: q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group)),
            })),
          )
          const persistence = createDeferred<void>()

          await live.preload()
          const facade = live.get(1)!.children
          const facadeRows = () =>
            facade.toArray
              .map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
              .sort((left, right) => left.id - right.id)
          const rootPublications: Array<
            Array<{ type: `insert` | `update` | `delete`; key: number }>
          > = []
          const rootCallbackFacades: Array<Array<ChildRow>> = []
          const childPublications: Array<Array<ProjectedChildChange>> = []
          const childCallbackFacades: Array<Array<ChildRow>> = []
          const publicationTimeline: Array<`root` | `facade`> = []
          const rootSubscription = live.subscribeChanges(
            (batch) => {
              publicationTimeline.push(`root`)
              rootPublications.push(
                batch.map(({ type, key }) => ({ type, key: Number(key) })),
              )
              rootCallbackFacades.push(facadeRows())
            },
            { includeInitialState: false },
          )
          const childSubscription = facade.subscribeChanges(
            (batch) => {
              publicationTimeline.push(`facade`)
              childPublications.push(batch.map(projectChildChange))
              childCallbackFacades.push(facadeRows())
            },
            { includeInitialState: false },
          )
          const mutate = createOptimisticAction<void>({
            onMutate: () => {
              if (optimisticOperation === `update`) {
                facade.update(10, (draft) => {
                  draft.value = 11
                })
              } else {
                facade.delete(10)
              }
            },
            mutationFn: () => persistence.promise,
          })
          const transaction = mutate()
          const initialRows = new Map(
            pendingFacadeInitialRows.map(
              (row) => [row.id, { ...row }] as const,
            ),
          )
          const optimisticRow = pendingOptimisticFacadeRow(optimisticOperation)
          const afterOptimistic = new Map(initialRows)
          applyPendingFacadeOperation(
            afterOptimistic,
            optimisticOperation,
            optimisticRow,
          )
          const emptyBase = new Map<number, ChildRow>()
          const whilePending = new Map(emptyBase)
          applyPendingFacadeOperation(
            whilePending,
            optimisticOperation,
            optimisticRow,
          )
          const optimisticRows = expectedPendingFacadeRows(afterOptimistic)
          const pendingRows = expectedPendingFacadeRows(whilePending)
          const expectedOptimisticChange = expectedPendingFacadeChange(
            initialRows,
            afterOptimistic,
            optimisticRow.id,
          )!
          const expectedRetirementChange = expectedPendingFacadeChange(
            afterOptimistic,
            whilePending,
            20,
          )!
          const expectedSettlementChange = expectedPendingFacadeChange(
            whilePending,
            emptyBase,
            optimisticRow.id,
          )

          try {
            expect(facadeRows()).toEqual(optimisticRows)
            expect(childPublications).toEqual([[expectedOptimisticChange]])
            expect(childCallbackFacades).toEqual([optimisticRows])
            expect(publicationTimeline).toEqual([`facade`])
            publicationTimeline.length = 0

            parents.write(`delete`, { id: 1, group: 1 })

            expect(live.has(1)).toBe(false)
            expect(facadeRows()).toEqual(pendingRows)
            expect(rootPublications).toEqual([[{ type: `delete`, key: 1 }]])
            expect(rootCallbackFacades).toEqual([pendingRows])
            expect(childPublications).toEqual([
              [expectedOptimisticChange],
              [expectedRetirementChange],
            ])
            expect(childCallbackFacades).toEqual([optimisticRows, pendingRows])
            expect(publicationTimeline).toEqual([`root`, `facade`])

            const persisted = transaction.isPersisted.promise.catch(
              () => undefined,
            )
            if (settlement === `resolve`) persistence.resolve()
            else persistence.reject(new Error(`facade mutation rejected`))
            await persisted
            await flushPromises()

            expect(facadeRows()).toEqual([])
            expect(rootPublications).toEqual([[{ type: `delete`, key: 1 }]])
            expect(childPublications).toEqual([
              [expectedOptimisticChange],
              [expectedRetirementChange],
              ...(expectedSettlementChange ? [[expectedSettlementChange]] : []),
            ])
            expect(childCallbackFacades.at(-1)).toEqual([])
          } finally {
            persistence.resolve()
            await transaction.isPersisted.promise.catch(() => undefined)
            rootSubscription.unsubscribe()
            childSubscription.unsubscribe()
            await Promise.all([
              live.cleanup(),
              parents.collection.cleanup(),
              children.collection.cleanup(),
            ])
          }
        },
      )
    }
  }

  for (const settlement of pendingFacadeSettlements) {
    fcTest(
      `publishes a nested facade source update while a same-key delete ${settlement}s`,
      async () => {
        const parents = createControlledCollection(`nested-facade-parents`, [
          { id: 1, group: 1 },
        ])
        const children = createControlledCollection(`nested-facade-children`, [
          { id: 100, parentGroup: 1, group: 7 },
        ])
        const grandchildren = createControlledCollection(
          `nested-facade-grandchildren`,
          [
            { id: 10, parentGroup: 7, value: 10 },
            { id: 20, parentGroup: 7, value: 20 },
          ],
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .select(({ child }) => ({
                id: child.id,
                group: child.group,
                grandchildren: q
                  .from({ grandchild: grandchildren.collection })
                  .where(({ grandchild }) =>
                    eq(grandchild.parentGroup, child.group),
                  ),
              })),
          })),
        )
        const persistence = createDeferred<void>()

        await live.preload()
        const childFacade = live.get(1)!.children
        const grandchildFacade = childFacade.get(100)!.grandchildren
        const grandchildRows = () =>
          grandchildFacade.toArray
            .map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
            .sort((left, right) => left.id - right.id)
        const rootPublications: Array<unknown> = []
        const childPublications: Array<unknown> = []
        const grandchildPublications: Array<Array<ProjectedChildChange>> = []
        const callbackRows: Array<Array<ChildRow>> = []
        const rootSubscription = live.subscribeChanges(
          (batch) => rootPublications.push(batch),
          { includeInitialState: false },
        )
        const childSubscription = childFacade.subscribeChanges(
          (batch) => childPublications.push(batch),
          { includeInitialState: false },
        )
        const grandchildSubscription = grandchildFacade.subscribeChanges(
          (batch) => {
            grandchildPublications.push(batch.map(projectChildChange))
            callbackRows.push(grandchildRows())
          },
          { includeInitialState: false },
        )
        const mutate = createOptimisticAction<void>({
          onMutate: () => grandchildFacade.delete(10),
          mutationFn: () => persistence.promise,
        })
        const transaction = mutate()

        try {
          expect(grandchildRows()).toEqual([
            { id: 20, parentGroup: 7, value: 20 },
          ])
          expect(grandchildPublications).toEqual([
            [
              {
                type: `delete`,
                key: 10,
                value: { id: 10, parentGroup: 7, value: 10 },
              },
            ],
          ])

          grandchildren.write(`update`, {
            id: 10,
            parentGroup: 7,
            value: 21,
          })

          expect(grandchildRows()).toEqual([
            { id: 20, parentGroup: 7, value: 20 },
          ])
          expect(rootPublications).toEqual([])
          expect(childPublications).toEqual([])
          expect(grandchildPublications).toHaveLength(1)
          expect(callbackRows).toEqual([
            [{ id: 20, parentGroup: 7, value: 20 }],
          ])

          const persisted = transaction.isPersisted.promise.catch(
            () => undefined,
          )
          if (settlement === `resolve`) persistence.resolve()
          else persistence.reject(new Error(`nested facade mutation rejected`))
          await persisted
          await flushPromises()

          expect(grandchildRows()).toEqual([
            { id: 10, parentGroup: 7, value: 21 },
            { id: 20, parentGroup: 7, value: 20 },
          ])
          expect(rootPublications).toEqual([])
          expect(childPublications).toEqual([])
          expect(grandchildPublications).toEqual([
            [
              {
                type: `delete`,
                key: 10,
                value: { id: 10, parentGroup: 7, value: 10 },
              },
            ],
            [
              {
                type: `insert`,
                key: 10,
                value: { id: 10, parentGroup: 7, value: 21 },
              },
            ],
          ])
          expect(callbackRows.at(-1)).toEqual([
            { id: 10, parentGroup: 7, value: 21 },
            { id: 20, parentGroup: 7, value: 20 },
          ])
        } finally {
          persistence.resolve()
          await transaction.isPersisted.promise.catch(() => undefined)
          rootSubscription.unsubscribe()
          childSubscription.unsubscribe()
          grandchildSubscription.unsubscribe()
          await Promise.all([
            live.cleanup(),
            parents.collection.cleanup(),
            children.collection.cleanup(),
            grandchildren.collection.cleanup(),
          ])
        }
      },
    )
  }

  for (const settlement of pendingFacadeSettlements) {
    for (const optimisticOperation of pendingFacadeOptimisticOperations) {
      fcTest(
        `retires a nested facade while its ${optimisticOperation} ${settlement}s`,
        async () => {
          const parents = createControlledCollection(`nested-retire-parents`, [
            { id: 1, group: 1 },
          ])
          const children = createControlledCollection(
            `nested-retire-children`,
            [{ id: 100, parentGroup: 1, group: 7 }],
          )
          const grandchildren = createControlledCollection(
            `nested-retire-grandchildren`,
            [
              { id: 10, parentGroup: 7, value: 10 },
              { id: 20, parentGroup: 7, value: 20 },
            ],
          )
          const live = createLiveQueryCollection((q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              children: q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .select(({ child }) => ({
                  id: child.id,
                  group: child.group,
                  grandchildren: q
                    .from({ grandchild: grandchildren.collection })
                    .where(({ grandchild }) =>
                      eq(grandchild.parentGroup, child.group),
                    ),
                })),
            })),
          )
          const persistence = createDeferred<void>()

          await live.preload()
          const childFacade = live.get(1)!.children
          const grandchildFacade = childFacade.get(100)!.grandchildren
          const grandchildRows = () =>
            grandchildFacade.toArray
              .map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
              .sort((left, right) => left.id - right.id)
          const rootPublications: Array<unknown> = []
          const childPublications: Array<{
            type: `insert` | `update` | `delete`
            key: number
            id: number
            group: number
            grandchildren: boolean
          }> = []
          const childCallbackSnapshots: Array<{
            childIds: Array<number>
            grandchildRows: Array<ChildRow>
          }> = []
          const grandchildPublications: Array<Array<ProjectedChildChange>> = []
          const grandchildCallbackRows: Array<Array<ChildRow>> = []
          const rootSubscription = live.subscribeChanges(
            (batch) => rootPublications.push(batch),
            { includeInitialState: false },
          )
          const childSubscription = childFacade.subscribeChanges(
            (batch) => {
              childPublications.push(
                ...batch.map(({ type, key, value }) => ({
                  type,
                  key: Number(key),
                  id: value.id,
                  group: value.group,
                  grandchildren: value.grandchildren === grandchildFacade,
                })),
              )
              childCallbackSnapshots.push({
                childIds: childFacade.toArray.map(({ id }) => id),
                grandchildRows: grandchildRows(),
              })
            },
            { includeInitialState: false },
          )
          const grandchildSubscription = grandchildFacade.subscribeChanges(
            (batch) => {
              grandchildPublications.push(batch.map(projectChildChange))
              grandchildCallbackRows.push(grandchildRows())
            },
            { includeInitialState: false },
          )
          const optimisticRow = pendingOptimisticFacadeRow(optimisticOperation)
          const mutate = createOptimisticAction<void>({
            onMutate: () => {
              if (optimisticOperation === `update`) {
                grandchildFacade.update(10, (draft) => {
                  draft.value = optimisticRow.value
                })
              } else {
                grandchildFacade.delete(10)
              }
            },
            mutationFn: () => persistence.promise,
          })
          const transaction = mutate()
          const initialRows = new Map<number, ChildRow>([
            [10, { id: 10, parentGroup: 7, value: 10 }],
            [20, { id: 20, parentGroup: 7, value: 20 }],
          ])
          const afterOptimistic = new Map(initialRows)
          const nestedOptimisticRow = { ...optimisticRow, parentGroup: 7 }
          applyPendingFacadeOperation(
            afterOptimistic,
            optimisticOperation,
            nestedOptimisticRow,
          )
          const emptyBase = new Map<number, ChildRow>()
          const whilePending = new Map(emptyBase)
          applyPendingFacadeOperation(
            whilePending,
            optimisticOperation,
            nestedOptimisticRow,
          )
          const optimisticRows = expectedPendingFacadeRows(afterOptimistic)
          const pendingRows = expectedPendingFacadeRows(whilePending)
          const optimisticChange = expectedPendingFacadeChange(
            initialRows,
            afterOptimistic,
            10,
          )!
          const retirementChange = expectedPendingFacadeChange(
            afterOptimistic,
            whilePending,
            20,
          )!
          const settlementChange = expectedPendingFacadeChange(
            whilePending,
            emptyBase,
            10,
          )

          try {
            expect(grandchildRows()).toEqual(optimisticRows)

            children.write(`delete`, {
              id: 100,
              parentGroup: 1,
              group: 7,
            })

            expect(live.has(1)).toBe(true)
            expect(childFacade.toArray).toEqual([])
            expect(grandchildRows()).toEqual(pendingRows)
            expect(rootPublications).toEqual([])
            expect(childPublications).toEqual([
              {
                type: `delete`,
                key: 100,
                id: 100,
                group: 7,
                grandchildren: true,
              },
            ])
            expect(childCallbackSnapshots).toEqual([
              { childIds: [], grandchildRows: pendingRows },
            ])
            expect(grandchildPublications).toEqual([
              [optimisticChange],
              [retirementChange],
            ])
            expect(grandchildCallbackRows).toEqual([
              optimisticRows,
              pendingRows,
            ])

            const persisted = transaction.isPersisted.promise.catch(
              () => undefined,
            )
            if (settlement === `resolve`) persistence.resolve()
            else persistence.reject(new Error(`nested retirement rejected`))
            await persisted
            await flushPromises()

            expect(childFacade.toArray).toEqual([])
            expect(grandchildRows()).toEqual([])
            expect(rootPublications).toEqual([])
            expect(grandchildPublications).toEqual([
              [optimisticChange],
              [retirementChange],
              ...(settlementChange ? [[settlementChange]] : []),
            ])
          } finally {
            persistence.resolve()
            await transaction.isPersisted.promise.catch(() => undefined)
            rootSubscription.unsubscribe()
            childSubscription.unsubscribe()
            grandchildSubscription.unsubscribe()
            await Promise.all([
              live.cleanup(),
              parents.collection.cleanup(),
              children.collection.cleanup(),
              grandchildren.collection.cleanup(),
            ])
          }
        },
      )
    }
  }

  fcTest(
    `outer fn.select recomputes nested values after a union branch include changes`,
    async () => {
      const messages = createControlledCollection(`fn-select-messages`, [
        { id: 1, group: 1 },
      ])
      const tools = createControlledCollection(`fn-select-tools`, [
        { id: 2, group: 2 },
      ])
      const children = createControlledCollection(`fn-select-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) => {
        const messageRows = q
          .from({ message: messages.collection })
          .select(({ message }) => ({
            kind: `message` as const,
            id: message.id,
            children: toArray(
              q
                .from({ messageChild: children.collection })
                .where(({ messageChild }) =>
                  eq(messageChild.parentGroup, message.group),
                )
                .select(({ messageChild }) => ({
                  id: messageChild.id,
                  value: messageChild.value,
                })),
            ),
          }))
        const toolRows = q
          .from({ tool: tools.collection })
          .select(({ tool }) => ({
            kind: `tool` as const,
            id: tool.id,
          }))

        return q.unionAll(messageRows, toolRows).fn.select((row) => ({
          kind: row.kind,
          id: row.id,
          payload: { children: row.children },
        }))
      })

      try {
        await live.preload()
        const message = live.toArray.find((row) => row.kind === `message`)!
        expect(message.payload.children).toEqual([{ id: 10, value: 1 }])

        children.write(`update`, {
          id: 10,
          parentGroup: 1,
          value: 2,
        })
        expect(
          live.toArray.find((row) => row.kind === `message`)!.payload.children,
        ).toEqual([{ id: 10, value: 2 }])
      } finally {
        await Promise.all([
          live.cleanup(),
          messages.collection.cleanup(),
          tools.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `fn.select rejects query values returned during include rematerialization`,
    async () => {
      const messages = createControlledCollection(`fn-select-reject-messages`, [
        { id: 1, group: 1 },
      ])
      const tools = createControlledCollection(`fn-select-reject-tools`, [
        { id: 2, group: 2 },
      ])
      const children = createControlledCollection(`fn-select-reject-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) => {
        const messageRows = q
          .from({ message: messages.collection })
          .select(({ message }) => ({
            kind: `message` as const,
            id: message.id,
            children: toArray(
              q
                .from({ messageChild: children.collection })
                .where(({ messageChild }) =>
                  eq(messageChild.parentGroup, message.group),
                ),
            ),
          }))
        const toolRows = q
          .from({ tool: tools.collection })
          .select(({ tool }) => ({
            kind: `tool` as const,
            id: tool.id,
          }))

        return q.unionAll(messageRows, toolRows).fn.select((row) => {
          const includedChildren =
            row.kind === `message`
              ? (row.children as typeof row.children | null)
              : null

          return {
            kind: row.kind,
            id: row.id,
            leakedQuery:
              includedChildren?.[0]?.value === 2
                ? q.from({ child: children.collection })
                : null,
          } as any
        })
      })

      try {
        await live.preload()

        expect(() =>
          children.write(`update`, {
            id: 10,
            parentGroup: 1,
            value: 2,
          }),
        ).toThrow(`fn.select() cannot return a child query builder`)
      } finally {
        await Promise.all([
          live.cleanup(),
          messages.collection.cleanup(),
          tools.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `rejects collapsed contributors that disagree by value, order, or outgoing route`,
    async () => {
      type CommentRow = {
        id: number
        userId: number
        text: string
      }
      const users = createControlledCollection(`congruence-users`, [
        { id: 1, group: 1 },
      ])

      const expectIncrementalRejection = async (
        mode: `value` | `order`,
      ): Promise<void> => {
        const comments = createControlledCollection<CommentRow>(
          `congruence-${mode}-comments`,
          [{ id: 1, userId: 1, text: `first` }],
        )
        const live = createLiveQueryCollection({
          query: (q) => {
            const joined = q
              .from({ comment: comments.collection })
              .join({ user: users.collection }, ({ comment, user }) =>
                eq(comment.userId, user.id),
              )
            return mode === `value`
              ? joined.select(({ comment }) => ({
                  publicId: comment.userId,
                  visible: comment.text,
                }))
              : joined
                  .orderBy(({ comment }) => comment.id)
                  .select(({ comment }) => ({
                    publicId: comment.userId,
                    visible: `same`,
                  }))
          },
          getKey: (row) => row.publicId,
        })

        try {
          await live.preload()
          expect(() =>
            comments.write(`insert`, {
              id: 2,
              userId: 1,
              text: mode === `value` ? `second` : `ignored`,
            }),
          ).toThrow(`not congruent`)
        } finally {
          await live.cleanup()
          await comments.collection.cleanup()
        }
      }

      await expectIncrementalRejection(`value`)
      await expectIncrementalRejection(`order`)

      const parents = createControlledCollection(`congruence-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection<ChildRow>(
        `congruence-children`,
        [],
      )
      const routed = createLiveQueryCollection({
        query: (q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            publicId: 1,
            visible: `same`,
            children: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group)),
            ),
          })),
        getKey: (row) => row.publicId,
      })

      try {
        await routed.preload()
        expect(() => parents.write(`insert`, { id: 2, group: 2 })).toThrow(
          `not congruent`,
        )
      } finally {
        await routed.cleanup()
        await Promise.all([
          parents.collection.cleanup(),
          children.collection.cleanup(),
          users.collection.cleanup(),
        ])
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
    const callbackSnapshots: Array<{
      group: number | undefined
      usesOldFacade: boolean
      rows: Array<number>
    }> = []
    const subscription = oldFacade.subscribeChanges(
      () => {
        const current = context.live.get(1)
        callbackSnapshots.push({
          group: current?.group,
          usesOldFacade: current?.children === oldFacade,
          rows: current
            ? [...current.children.keys()].filter(
                (key): key is number => typeof key === `number`,
              )
            : [],
        })
      },
      { includeInitialState: false },
    )

    try {
      context.parents.write(`update`, { id: 1, group: 2 })
      expect(callbackSnapshots).toEqual([
        { group: 2, usesOldFacade: false, rows: [20] },
      ])
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
      } finally {
        await driver.cleanup(context)
      }
    },
  )

  fcTest(`a matched null singleton remains null`, async () => {
    type NullableChild = { id: number; parentGroup: number; value: null }
    const parents = createControlledCollection(`nullable-oracle-parents`, [
      { id: 1, group: 1 },
    ])
    const children = createControlledCollection<NullableChild>(
      `nullable-oracle-children`,
      [{ id: 10, parentGroup: 1, value: null }],
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => ({
        id: parent.id,
        value: materialize(
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .select(({ child }) => child.value)
            .findOne(),
        ),
      })),
    )

    try {
      await live.preload()
      expect(live.get(1)!.value).toBeNull()
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  })

  fcTest.prop(
    [
      fc.record({
        smallId: fc.integer({ min: 2, max: 9 }),
        wideId: fc.integer({ min: 10, max: 19 }),
      }),
    ],
    oraclePropertyOptions(20, `includes-collection.public-key-order`),
  )(
    `uses one raw public-key order across Collection and inline materializations`,
    async ({ smallId, wideId }) => {
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

      try {
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
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `propagates an order-only child move through every materialization`,
    async () => {
      type OrderedChild = ChildRow & { position: number; label: string }
      const parents = createControlledCollection(`order-move-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection<OrderedChild>(
        `order-move-children`,
        [
          { id: 10, parentGroup: 1, value: 1, position: 0, label: `a` },
          { id: 20, parentGroup: 1, value: 2, position: 1, label: `b` },
        ],
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

      try {
        await live.preload()
        const facade = live.get(1)!.facade
        const revision = facade._layoutRevision
        expect(project()).toEqual({
          ...expectedMaterializations([10, 20]),
          first: 10,
          joined: `ab`,
        })

        children.write(`update`, {
          id: 10,
          parentGroup: 1,
          value: 1,
          position: 2,
          label: `a`,
        })

        expect(live.get(1)!.facade).toBe(facade)
        expect(facade._layoutRevision).toBeGreaterThan(revision)
        expect(project()).toEqual({
          ...expectedMaterializations([20, 10]),
          first: 20,
          joined: `ba`,
        })
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `publishes every bounded internal order-only swap through root and facade producers`,
    async () => {
      const observedCells: Array<string> = []
      for (let length = 4; length <= 12; length++) {
        for (let swapIndex = 1; swapIndex <= length - 3; swapIndex++) {
          await expectRootAndFacadeLayoutSwap({ length, swapIndex })
          observedCells.push(`${length}:${swapIndex}`)
        }
      }

      expect(observedCells).toEqual(
        exhaustiveLayoutSwapScenarios.map(
          ({ length, swapIndex }) => `${length}:${swapIndex}`,
        ),
      )
    },
  )

  fcTest.prop([layoutSwapScenarioArbitrary], {
    ...oraclePropertyOptions(20, `includes-collection.layout-swap`),
  })(
    `publishes replayable random internal order-only swaps through root and facade producers`,
    expectRootAndFacadeLayoutSwap,
  )

  fcTest(
    `scans every changed facade key before deciding whether layout may differ`,
    async () => {
      const observedScenarios: Array<string> = []
      for (const candidatePosition of [`first`, `last`] as const) {
        for (const finalLayout of [`moved`, `restored`] as const) {
          await expectFacadeCandidateScan({ candidatePosition, finalLayout })
          observedScenarios.push(`${candidatePosition}:${finalLayout}`)
        }
      }

      expect(observedScenarios).toEqual(
        facadeCandidateScanScenarios.map(
          ({ candidatePosition, finalLayout }) =>
            `${candidatePosition}:${finalLayout}`,
        ),
      )
    },
  )

  fcTest(
    `reconstructs nested conditional includes through guard transitions`,
    async () => {
      type GuardedParent = ParentRow & { active: boolean }
      const parents = createControlledCollection<GuardedParent>(
        `guarded-parents`,
        [{ id: 1, group: 1, active: true }],
      )
      const children = createControlledCollection(`guarded-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => {
          const childRows = () =>
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                value: child.value,
              }))

          return {
            id: parent.id,
            profile: caseWhen(
              eq(parent.active, true),
              {
                kind: `active` as const,
                facade: childRows(),
                array: toArray(childRows()),
                materialized: materialize(childRows()),
              },
              { kind: `inactive` as const },
            ),
          }
        }),
      )

      const project = () => {
        const profile = live.get(1)!.profile
        if (profile.kind === `inactive`) return profile
        const rows = (values: Iterable<ChildRow>) =>
          [...values].map(({ id, value }) => ({ id, value }))
        return {
          kind: profile.kind,
          facade: rows(profile.facade.values()),
          array: rows(profile.array),
          materialized: rows(profile.materialized),
        }
      }

      try {
        await live.preload()
        const initialProfile = live.get(1)!.profile
        if (initialProfile.kind === `inactive`) {
          throw new Error(
            `Expected the initial conditional branch to be active`,
          )
        }
        const initialFacade = initialProfile.facade
        expect(project()).toEqual({
          kind: `active`,
          ...expectedMaterializations([{ id: 10, value: 1 }]),
        })

        parents.write(`update`, { id: 1, group: 1, active: false })
        expect(project()).toEqual({ kind: `inactive` })
        expect(initialFacade.toArray).toEqual([])
        expect(initialFacade.status).toBe(`ready`)
        children.write(`insert`, { id: 20, parentGroup: 1, value: 2 })
        expect(project()).toEqual({ kind: `inactive` })

        parents.write(`update`, { id: 1, group: 1, active: true })
        const reactivatedProfile = live.get(1)!.profile
        if (reactivatedProfile.kind === `inactive`) {
          throw new Error(`Expected the conditional branch to reactivate`)
        }
        expect(reactivatedProfile.facade).not.toBe(initialFacade)
        expect(project()).toEqual({
          kind: `active`,
          ...expectedMaterializations([
            { id: 10, value: 1 },
            { id: 20, value: 2 },
          ]),
        })
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `matches recomputation for correlated aggregate child relations`,
    async () => {
      const parents = createControlledCollection(`aggregate-parents`, [
        { id: 1, group: 1, factor: 1 },
        { id: 2, group: 1, factor: -1 },
        { id: 3, group: 2, factor: 2 },
      ])
      const children = createControlledCollection(`aggregate-children`, [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value: 2 },
        { id: 30, parentGroup: 2, value: 5 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.id)
          .select(({ parent }) => {
            const summaries = () =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({
                  parentGroup: child.parentGroup,
                  count: count(child.id),
                  total: sum(multiply(child.value, parent.factor)),
                }))
            const total = () =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .select(({ child }) => ({
                  count: count(child.id),
                  total: sum(multiply(child.value, parent.factor)),
                }))

            return {
              id: parent.id,
              facade: summaries(),
              array: toArray(summaries()),
              materialized: materialize(summaries()),
              implicit: materialize(total()),
            }
          }),
      )

      type Summary = { parentGroup: number; count: number; total: number }
      const project = () =>
        live.toArray.map((row) => {
          const clean = (values: Iterable<Summary>) =>
            [...values].map(({ parentGroup, count: size, total }) => ({
              parentGroup,
              count: size,
              total,
            }))
          return {
            id: row.id,
            facade: clean(row.facade.values()),
            array: clean(row.array),
            materialized: clean(row.materialized),
            implicit: row.implicit.map(({ count: size, total }) => ({
              count: size,
              total,
            })),
          }
        })

      const expected = (groupOneTotal: number, groupOneCount: number) => [
        {
          id: 1,
          ...expectedMaterializations([
            { parentGroup: 1, count: groupOneCount, total: groupOneTotal },
          ]),
          implicit: [{ count: groupOneCount, total: groupOneTotal }],
        },
        {
          id: 2,
          ...expectedMaterializations([
            {
              parentGroup: 1,
              count: groupOneCount,
              total: -groupOneTotal,
            },
          ]),
          implicit: [{ count: groupOneCount, total: -groupOneTotal }],
        },
        {
          id: 3,
          ...expectedMaterializations([
            { parentGroup: 2, count: 1, total: 10 },
          ]),
          implicit: [{ count: 1, total: 10 }],
        },
      ]

      try {
        await live.preload()
        expect(project()).toEqual(expected(3, 2))

        children.write(`update`, { id: 20, parentGroup: 1, value: 7 })
        expect(project()).toEqual(expected(8, 2))

        children.write(`delete`, { id: 10, parentGroup: 1, value: 1 })
        expect(project()).toEqual(expected(7, 1))
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `evaluates correlated having clauses with parent context`,
    async () => {
      type HavingParent = ParentRow & { threshold: number }
      const parents = createControlledCollection<HavingParent>(
        `having-parents`,
        [
          { id: 1, group: 1, threshold: 1 },
          { id: 2, group: 1, threshold: 3 },
        ],
      )
      const children = createControlledCollection(`having-children`, [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.id)
          .select(({ parent }) => {
            const summaries = () =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .having(({ child }) => gt(count(child.id), parent.threshold))
                .select(({ child }) => ({ count: count(child.id) }))

            return {
              id: parent.id,
              facade: summaries(),
              array: toArray(summaries()),
              materialized: materialize(summaries()),
            }
          }),
      )

      const project = () =>
        live.toArray.map((row) => {
          const counts = (values: Iterable<{ count: number }>) =>
            [...values].map(({ count: size }) => size)
          return {
            id: row.id,
            facade: counts(row.facade.values()),
            array: counts(row.array),
            materialized: counts(row.materialized),
          }
        })

      try {
        await live.preload()
        expect(project()).toEqual([
          { id: 1, ...expectedMaterializations([2]) },
          { id: 2, ...expectedMaterializations([]) },
        ])

        parents.write(`update`, { id: 2, group: 1, threshold: 1 })
        expect(project()).toEqual([
          { id: 1, ...expectedMaterializations([2]) },
          { id: 2, ...expectedMaterializations([2]) },
        ])
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(`routes changes to non-key parent filter inputs`, async () => {
    type FilterParent = ParentRow & { threshold: number }
    const parents = createControlledCollection<FilterParent>(
      `parent-filter-input-parents`,
      [{ id: 1, group: 1, threshold: 2 }],
    )
    const children = createControlledCollection(
      `parent-filter-input-children`,
      [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value: 3 },
      ],
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const childRows = () =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .where(({ child }) => lt(child.value, parent.threshold))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({ id: child.id, value: child.value }))

        return {
          id: parent.id,
          facade: childRows(),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
        }
      }),
    )

    const project = () => {
      const row = live.get(1)!
      const ids = (values: Iterable<{ id: number }>) =>
        [...values].map(({ id }) => id)
      return {
        facade: ids(row.facade.values()),
        array: ids(row.array),
        materialized: ids(row.materialized),
      }
    }

    try {
      await live.preload()
      expect(project()).toEqual(expectedMaterializations([10]))

      parents.write(`update`, { id: 1, group: 1, threshold: 4 })
      expect(project()).toEqual(expectedMaterializations([10, 20]))

      parents.write(`update`, { id: 1, group: 1, threshold: 0 })
      expect(project()).toEqual(expectedMaterializations([]))
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  })

  fcTest(`routes changes to parent-dependent child ordering`, async () => {
    type OrderingParent = ParentRow & { direction: number }
    const parents = createControlledCollection<OrderingParent>(
      `parent-order-input-parents`,
      [
        { id: 1, group: 1, direction: 1 },
        { id: 2, group: 1, direction: -1 },
      ],
    )
    const children = createControlledCollection(`parent-order-input-children`, [
      { id: 10, parentGroup: 1, value: 1 },
      { id: 20, parentGroup: 1, value: 2 },
    ])
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const childRows = () =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => multiply(child.value, parent.direction))
            .select(({ child }) => ({ id: child.id, value: child.value }))

        return {
          id: parent.id,
          facade: childRows(),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
        }
      }),
    )

    const project = (id: number) => {
      const row = live.get(id)!
      const rows = (values: Iterable<{ id: number; value: number }>) =>
        [...values].map(({ id: childId, value }) => ({ id: childId, value }))
      return {
        facade: rows(row.facade.values()),
        array: rows(row.array),
        materialized: rows(row.materialized),
      }
    }

    try {
      await live.preload()
      const ascendingFacade = live.get(1)!.facade
      const descendingFacade = live.get(2)!.facade
      expect(project(1)).toEqual(
        expectedMaterializations([
          { id: 10, value: 1 },
          { id: 20, value: 2 },
        ]),
      )
      expect(project(2)).toEqual(
        expectedMaterializations([
          { id: 20, value: 2 },
          { id: 10, value: 1 },
        ]),
      )
      expect(ascendingFacade).not.toBe(descendingFacade)

      parents.write(`update`, { id: 1, group: 1, direction: -1 })
      expect(live.get(1)!.facade).toBe(descendingFacade)
      expect(ascendingFacade.toArray).toEqual([])
      expect(project(1)).toEqual(
        expectedMaterializations([
          { id: 20, value: 2 },
          { id: 10, value: 1 },
        ]),
      )
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  })

  fcTest(`routes changes to parent-dependent child joins`, async () => {
    type JoinParent = ParentRow & { offset: number }
    type JoinedChild = ChildRow & { tagId: number }
    type Tag = { id: number; label: string }
    const parents = createControlledCollection<JoinParent>(
      `parent-join-parents`,
      [
        { id: 1, group: 1, offset: 0 },
        { id: 2, group: 1, offset: 1 },
      ],
    )
    const children = createControlledCollection<JoinedChild>(
      `parent-join-children`,
      [{ id: 10, parentGroup: 1, value: 1, tagId: 1 }],
    )
    const tags = createControlledCollection<Tag>(`parent-join-tags`, [
      { id: 1, label: `direct` },
      { id: 2, label: `offset` },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const childRows = () =>
            q
              .from({ child: children.collection })
              .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
                eq(tag.id, add(child.tagId, parent.offset)),
              )
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .select(({ child, tag }) => ({
                id: child.id,
                label: tag.label,
              }))

          return {
            id: parent.id,
            facade: childRows(),
            array: toArray(childRows()),
            materialized: materialize(childRows()),
          }
        }),
    )

    const project = (id: number) => {
      const row = live.get(id)!
      const labels = (values: Iterable<{ label: string }>) =>
        [...values].map(({ label }) => label)
      return {
        facade: labels(row.facade.values()),
        array: labels(row.array),
        materialized: labels(row.materialized),
      }
    }

    try {
      await live.preload()
      const directFacade = live.get(1)!.facade
      const offsetFacade = live.get(2)!.facade
      expect(directFacade).not.toBe(offsetFacade)
      expect(project(1)).toEqual(expectedMaterializations([`direct`]))
      expect(project(2)).toEqual(expectedMaterializations([`offset`]))

      parents.write(`update`, { id: 1, group: 1, offset: 1 })
      expect(live.get(1)!.facade).toBe(offsetFacade)
      expect(directFacade.toArray).toEqual([])
      expect(project(1)).toEqual(expectedMaterializations([`offset`]))
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
        tags.collection.cleanup(),
      ])
    }
  })

  fcTest.prop(
    [
      fc.record({
        group: fc.integer({ min: -10, max: 10 }),
        insertedId: fc.integer({ min: 10, max: 100 }),
        confirmedId: fc.integer({ min: 101, max: 200 }),
        value: fc.integer({ min: -10, max: 10 }),
      }),
    ],
    oraclePropertyOptions(20, `includes-collection.optimistic-child-history`),
  )(
    `matches recomputation through optimistic child insert and delete confirmation and rollback`,
    async ({ group, insertedId, confirmedId, value }) => {
      type OptimisticAction =
        | { type: `insert`; row: ChildRow; settlement: `confirm` | `rollback` }
        | { type: `delete`; id: number; settlement: `confirm` | `rollback` }
      const base = createCollectionDriver([{ id: 1, group }], [])
      const driver: TraceDriver<OptimisticAction, CollectionContext> = {
        ...base,
        async apply(action, context, checkpoint) {
          context.publications = []
          if (action.type === `insert`) {
            const transaction = context.children.collection.insert({
              ...action.row,
            })
            context.model.children.set(action.row.id, { ...action.row })
            checkpoint()
            context.publications = []
            if (action.settlement === `confirm`) {
              context.children.write(`insert`, action.row)
              context.children.resolveSync()
              await transaction.isPersisted.promise
            } else {
              context.model.children.delete(action.row.id)
              const message = `rollback insert`
              const persisted = transaction.isPersisted.promise.catch(
                () => undefined,
              )
              await withExpectedRejection(message, async () => {
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
          context.model.children.delete(action.id)
          checkpoint()
          context.publications = []
          if (action.settlement === `confirm`) {
            context.children.write(`delete`, previous)
            context.children.resolveSync()
            await transaction.isPersisted.promise
          } else {
            context.model.children.set(action.id, previous)
            const message = `rollback delete`
            const persisted = transaction.isPersisted.promise.catch(
              () => undefined,
            )
            await withExpectedRejection(message, async () => {
              context.children.rejectSync(new Error(message))
              await persisted
              await flushPromises()
            })
          }
        },
      }
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
    },
  )
})
