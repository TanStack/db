import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  concat,
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withExpectedRejection,
} from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { ChangeMessage } from '../../src/types.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'

type ParentRow = {
  id: number
  group: number
}

type ChildRow = {
  id: number
  parentGroup: number
  value: number
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

type ControlledCollection<T extends { id: number }> = {
  collection: Collection<T>
  write: (type: `insert` | `update` | `delete`, value: T) => void
  writeBatch: (
    changes: ReadonlyArray<{
      type: `insert` | `update` | `delete`
      value: T
    }>,
  ) => void
  resolveSync: () => void
  rejectSync: (error: Error) => void
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

let nextCollectionOracleId = 0

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
): ControlledCollection<T> {
  const options = mockSyncCollectionOptions<T>({
    id: `${name}-${nextCollectionOracleId++}`,
    getKey: (row) => row.id,
    initialData: initialData.map((row) => ({ ...row })),
    autoIndex: `eager`,
  })
  options.sync.rowUpdateMode = `full`
  const collection = createCollection(options)
  const writeBatch: ControlledCollection<T>[`writeBatch`] = (changes) => {
    options.utils.begin()
    for (const change of changes) {
      options.utils.write({
        type: change.type,
        value: { ...change.value },
      })
    }
    options.utils.commit()
  }

  return {
    collection,
    write(type, value) {
      writeBatch([{ type, value }])
    },
    writeBatch,
    resolveSync: options.utils.resolveSync,
    rejectSync: options.utils.rejectSync,
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

describe(`Collection-valued includes oracle`, () => {
  fcTest.prop([collectionScenarioArbitrary], oraclePropertyOptions(30))(
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
      const nodes = createControlledCollection<NodeRow>(`rollback-nodes`, [
        initialParent,
        initialChild,
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
              .where(({ child }) => eq(child.group, parent.group)),
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
      const originalGetKey = live.config.getKey
      live.config.getKey = (row) => {
        if (row.value === 2) throw new Error(`root key failed`)
        return originalGetKey(row)
      }

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
        ).toThrow(`root key failed`)
        expect(live.get(1)!.value).toBe(1)
        expect(facade.get(10)!.value).toBe(1)
        expect(rootPublications).toEqual([])
        expect(childPublications).toEqual([])

        live.config.getKey = originalGetKey
        nodes.writeBatch([
          {
            type: `update`,
            value: { ...initialParent, value: 3 },
          },
          {
            type: `update`,
            value: { ...initialChild, value: 3 },
          },
        ])
        expect(live.get(1)!.value).toBe(3)
        expect(facade.get(10)!.value).toBe(3)
        expect(rootPublications).toHaveLength(1)
        expect(childPublications).toHaveLength(1)
      } finally {
        live.config.getKey = originalGetKey
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
    oraclePropertyOptions(20),
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

  fcTest.prop(
    [
      fc.record({
        group: fc.integer({ min: -10, max: 10 }),
        insertedId: fc.integer({ min: 10, max: 100 }),
        confirmedId: fc.integer({ min: 101, max: 200 }),
        value: fc.integer({ min: -10, max: 10 }),
      }),
    ],
    oraclePropertyOptions(20),
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
