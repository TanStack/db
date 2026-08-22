import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
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
