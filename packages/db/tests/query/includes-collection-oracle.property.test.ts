import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  materialize,
} from '../../src/query/index.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { runTrace } from '../trace-runner.js'
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
) {
  return createLiveQueryCollection((q) =>
    q
      .from({ parent: parents })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => ({
        id: parent.id,
        group: parent.group,
        children: q
          .from({ child: children })
          .where(({ child }) => eq(child.parentGroup, parent.group))
          .orderBy(({ child }) => child.id)
          .select(({ child }) => ({
            id: child.id,
            parentGroup: child.parentGroup,
            value: child.value,
          })),
      })),
  )
}

type IncludedChildCollection = ReturnType<
  typeof createCollectionQuery
>[`toArray`][number][`children`]

function projectLive(
  live: ReturnType<typeof createCollectionQuery>,
): Array<ProjectedParent> {
  return [...live.values()].map((parent) => ({
    id: parent.id,
    group: parent.group,
    childrenReady: parent.children.isReady(),
    children: [...parent.children.values()]
      .map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
      .sort((left, right) => left.id - right.id),
  }))
}

function recompute(context: CollectionContext): Array<ProjectedParent> {
  return [...context.model.parents.values()]
    .sort((left, right) => left.id - right.id)
    .map((parent) => ({
      ...parent,
      childrenReady: true,
      children: [...context.model.children.values()]
        .filter((child) => child.parentGroup === parent.group)
        .sort((left, right) => left.id - right.id)
        .map((child) => ({ ...child })),
    }))
}

function createCollectionDriver(
  initialParents: ReadonlyArray<ParentRow>,
  initialChildren: ReadonlyArray<ChildRow>,
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
        live: createCollectionQuery(parents.collection, children.collection),
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

describe(`Collection-valued includes oracle`, () => {
  fcTest.prop([collectionScenarioArbitrary], { numRuns: 30 })(
    `matches recomputation and publishes coherent snapshots across generated relationship histories`,
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

  fcTest(
    `discovered trace: retiring a route cleans up its facade`,
    async () => {
      let retiredFacade: IncludedChildCollection | undefined
      const driver = createCollectionDriver(
        [{ id: 1, group: 1 }],
        [{ id: 10, parentGroup: 1, value: 1 }],
      )
      const lifecycleDriver: TraceDriver<CollectionAction, CollectionContext> =
        {
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
            context.model.parents.size === 0
              ? `cleaned-up`
              : retiredFacade?.status,
        }),
        assertEqual(observed, expected) {
          expect(observed).toEqual(expected)
          return undefined
        },
      }

      await expectAssertionFailure(
        () =>
          runTrace({
            steps: [{ type: `deleteParent`, id: 1 }],
            driver: lifecycleDriver,
            projection,
          }),
        {
          checkpoint: 1,
          classify: ({ actual, expected }) =>
            JSON.stringify(actual) ===
              JSON.stringify({ rows: [], retiredStatus: `ready` }) &&
            JSON.stringify(expected) ===
              JSON.stringify({ rows: [], retiredStatus: `cleaned-up` }),
        },
      )()
    },
  )

  fcTest(
    `discovered trace: a delete event preserves the published facade identity`,
    async () => {
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
                    change.previousValue?.children === publishedFacade
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

      await expectAssertionFailure(
        () =>
          runTrace({
            steps: [{ type: `deleteParent`, id: 1 }],
            driver: eventDriver,
            projection,
          }),
        {
          checkpoint: 1,
          classify: ({ actual, expected }) =>
            JSON.stringify(actual) ===
              JSON.stringify({ previousFacadeMatched: false }) &&
            JSON.stringify(expected) ===
              JSON.stringify({ previousFacadeMatched: true }),
        },
      )()
    },
  )

  fcTest(
    `discovered trace: facade public keys survive row cloning`,
    async () => {
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

      await expectAssertionFailure(
        () => runTrace({ steps: [], driver, projection }),
        {
          checkpoint: 0,
          classify: ({ actual, expected }) =>
            JSON.stringify(actual) ===
              JSON.stringify({ clonedKey: undefined }) &&
            JSON.stringify(expected) === JSON.stringify({ clonedKey: 10 }),
        },
      )()
    },
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
      const internalConfig = (
        facade._state as unknown as {
          config: typeof facade.config
        }
      ).config
      const originalGetKey = internalConfig.getKey
      internalConfig.getKey = (row) => {
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
          },
        ])
        expect(changes).toEqual([])
      } finally {
        internalConfig.getKey = originalGetKey
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

  fcTest(
    `discovered trace: a matched null singleton remains null`,
    expectAssertionFailure(
      async () => {
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
      },
      { message: `expected undefined to be null` },
    ),
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
    { numRuns: 20 },
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
          if (action.type === `insert`) {
            const transaction = context.children.collection.insert({
              ...action.row,
            })
            context.model.children.set(action.row.id, { ...action.row })
            checkpoint()
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
