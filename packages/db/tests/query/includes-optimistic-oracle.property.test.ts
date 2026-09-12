import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import { runTrace } from '../trace-runner.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import { createControlledCollection as createOracleControlledCollection } from './includes-oracle-helpers.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { OracleSyncChange as SyncChange } from './includes-oracle-helpers.js'

type RootRow = {
  id: number
  group: number
  value: number
  position: number
}

type ChildRow = RootRow & {
  parentGroup: number
}

type ChildLevel = 1 | 2 | 3

type ChildPatch = Partial<
  Pick<ChildRow, `parentGroup` | `group` | `value` | `position`>
>

type OptimisticStep = {
  type: `optimistic`
  handle: string
  level: ChildLevel
  id: number
  patch: ChildPatch
}

type OptimisticRelationshipStep =
  | OptimisticStep
  | {
      type: `optimisticRollback`
      level: ChildLevel
      id: number
      patch: ChildPatch
      beforeRollback?: {
        level: ChildLevel
        changes: ReadonlyArray<SyncChange<ChildRow>>
      }
    }
  | {
      type: `confirm`
      handle: string
      authoritative: ChildRow
    }
  | { type: `rollback`; handle: string }
  | {
      type: `sync`
      level: ChildLevel
      changes: ReadonlyArray<SyncChange<ChildRow>>
    }

type OracleNode = RootRow & {
  children?: Array<OracleNode>
}

type ControlledCollection<T extends { id: number }> = ReturnType<
  typeof createControlledCollection<T>
>

type Sources = {
  roots: ControlledCollection<RootRow>
  levels: readonly [
    ControlledCollection<ChildRow>,
    ControlledCollection<ChildRow>,
    ControlledCollection<ChildRow>,
  ]
}

type LevelRows = readonly [
  ReadonlyArray<ChildRow>,
  ReadonlyArray<ChildRow>,
  ReadonlyArray<ChildRow>,
]

type SettlingTransaction = ReturnType<
  ControlledCollection<ChildRow>[`collection`][`update`]
>

type PendingRuntimeMutation = {
  transaction: SettlingTransaction
  level: ChildLevel
  syncReleaseAttempted: boolean
  syncReleased: boolean
  settled: boolean
  receipt: Promise<void>
}

type PendingOptimisticChange = {
  transaction: SettlingTransaction
  runtime: PendingRuntimeMutation
  level: ChildLevel
  id: number
  row: ChildRow
}

type OptimisticContext = {
  sources: Sources
  live: ReturnType<typeof createOptimisticQuery>
  roots: Map<number, RootRow>
  levels: Array<Map<number, ChildRow>>
  pending: Map<string, PendingOptimisticChange>
  runtimePending: Set<PendingRuntimeMutation>
}

function trackRuntimeMutation(
  context: OptimisticContext,
  level: ChildLevel,
  transaction: SettlingTransaction,
): PendingRuntimeMutation {
  const entry: PendingRuntimeMutation = {
    transaction,
    level,
    syncReleaseAttempted: false,
    syncReleased: false,
    settled: false,
    receipt: Promise.resolve(),
  }
  context.runtimePending.add(entry)
  const settled = () => {
    entry.settled = true
    if (entry.syncReleased) context.runtimePending.delete(entry)
  }
  // Both outcomes are handled before a checkpoint or sibling source write.
  entry.receipt = transaction.isPersisted.promise.then(settled, settled)
  return entry
}

function releaseRuntimeMutation(
  context: OptimisticContext,
  entry: PendingRuntimeMutation,
  release: () => void,
): void {
  // Do not retry an uncertain release that throws after consuming its gate.
  entry.syncReleaseAttempted = true
  release()
  entry.syncReleased = true
  if (entry.settled) context.runtimePending.delete(entry)
}

function assertCanStartOptimisticChange(
  pending: ReadonlyMap<string, Pick<PendingOptimisticChange, `level`>>,
  level: ChildLevel,
  handle?: string,
): void {
  if (handle !== undefined && pending.has(handle)) {
    throw new Error(`Duplicate optimistic handle ${handle}`)
  }
  const sameLevel = [...pending.entries()].find(
    ([, change]) => change.level === level,
  )
  if (sameLevel) {
    throw new Error(
      `Level ${level} already has pending optimistic handle ${sameLevel[0]}`,
    )
  }
}

function assertMatchingConfirmation(
  pending: Pick<PendingOptimisticChange, `id`>,
  authoritative: Pick<ChildRow, `id`>,
): void {
  if (authoritative.id !== pending.id) {
    throw new Error(
      `Confirmation row ${authoritative.id} does not match pending row ${pending.id}`,
    )
  }
}

type RouteValues = {
  rootA: number
  rootB: number
  rootC: number
  original: number
  optimistic: number
  authoritative: number
}

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
) {
  return createOracleControlledCollection(name, initialData, {
    rowUpdateMode: `full`,
  })
}

function createSources(
  roots: ReadonlyArray<RootRow>,
  levels: LevelRows,
): Sources {
  return {
    roots: createControlledCollection(`optimistic-oracle-roots`, roots),
    levels: [
      createControlledCollection(`optimistic-oracle-level-1`, levels[0]),
      createControlledCollection(`optimistic-oracle-level-2`, levels[1]),
      createControlledCollection(`optimistic-oracle-level-3`, levels[2]),
    ],
  }
}

function childSource(sources: Sources, level: ChildLevel) {
  switch (level) {
    case 1:
      return sources.levels[0]
    case 2:
      return sources.levels[1]
    case 3:
      return sources.levels[2]
  }
}

function createOptimisticQuery(sources: Sources) {
  const [children, grandchildren, leaves] = sources.levels
  return createLiveQueryCollection((q) =>
    q
      .from({ root: sources.roots.collection })
      .orderBy(({ root }) => root.position)
      .orderBy(({ root }) => root.id)
      .select(({ root }) => ({
        id: root.id,
        group: root.group,
        value: root.value,
        position: root.position,
        children: toArray(
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, root.group))
            .orderBy(({ child }) => child.position)
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({
              id: child.id,
              group: child.group,
              value: child.value,
              position: child.position,
              children: toArray(
                q
                  .from({ grandchild: grandchildren.collection })
                  .where(({ grandchild }) =>
                    eq(grandchild.parentGroup, child.group),
                  )
                  .orderBy(({ grandchild }) => grandchild.position)
                  .orderBy(({ grandchild }) => grandchild.id)
                  .select(({ grandchild }) => ({
                    id: grandchild.id,
                    group: grandchild.group,
                    value: grandchild.value,
                    position: grandchild.position,
                    children: toArray(
                      q
                        .from({ leaf: leaves.collection })
                        .where(({ leaf }) =>
                          eq(leaf.parentGroup, grandchild.group),
                        )
                        .orderBy(({ leaf }) => leaf.position)
                        .orderBy(({ leaf }) => leaf.id)
                        .select(({ leaf }) => ({
                          id: leaf.id,
                          group: leaf.group,
                          value: leaf.value,
                          position: leaf.position,
                        })),
                    ),
                  })),
              ),
            })),
        ),
      })),
  )
}

function cloneMap<T extends { id: number }>(rows: ReadonlyArray<T>) {
  return new Map(rows.map((row) => [row.id, { ...row }]))
}

function applyPatch(row: ChildRow, patch: ChildPatch): ChildRow {
  return { ...row, ...patch }
}

function visibleLevels(context: OptimisticContext) {
  const levels = context.levels.map(
    (level) => new Map([...level].map(([id, row]) => [id, { ...row }])),
  )

  for (const { level, id, row } of context.pending.values()) {
    const rows = levels[level - 1]!
    rows.set(id, { ...row })
  }
  return levels
}

function compareRows(left: RootRow, right: RootRow) {
  return left.position - right.position || left.id - right.id
}

function recompute(context: OptimisticContext): Array<OracleNode> {
  const levels = visibleLevels(context)
  const materialize = (level: number, parentGroup: number): Array<OracleNode> =>
    [...levels[level]!.values()]
      .filter((row) => row.parentGroup === parentGroup)
      .sort(compareRows)
      .map(({ parentGroup: _parentGroup, ...row }) => ({
        ...row,
        ...(level + 1 < levels.length
          ? { children: materialize(level + 1, row.group) }
          : {}),
      }))

  return [...context.roots.values()].sort(compareRows).map((root) => ({
    ...root,
    children: materialize(0, root.group),
  }))
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

function updateModel(
  model: Map<number, ChildRow>,
  changes: ReadonlyArray<SyncChange<ChildRow>>,
) {
  for (const change of changes) {
    if (change.type === `delete`) model.delete(change.value.id)
    else model.set(change.value.id, { ...change.value })
  }
}

async function rollback(
  source: ControlledCollection<ChildRow>,
  transaction: SettlingTransaction,
  context: OptimisticContext,
  runtime: PendingRuntimeMutation,
) {
  const message = `optimistic relationship oracle rollback`
  const persisted = transaction.isPersisted.promise.catch(() => undefined)
  await withExpectedRejection(message, async () => {
    releaseRuntimeMutation(context, runtime, () =>
      source.rejectSync(new Error(message)),
    )
    await persisted
    await flushPromises()
  })
}

function createDriver(
  roots: ReadonlyArray<RootRow>,
  levelRows: LevelRows,
): TraceDriver<OptimisticRelationshipStep, OptimisticContext> {
  return {
    setup: () => {
      const sources = createSources(roots, levelRows)
      return {
        sources,
        live: createOptimisticQuery(sources),
        roots: cloneMap(roots),
        levels: levelRows.map(cloneMap),
        pending: new Map(),
        runtimePending: new Set(),
      }
    },
    start: ({ live }) => live.preload(),
    apply: async (step, context, checkpoint) => {
      if (step.type === `optimisticRollback`) {
        assertCanStartOptimisticChange(context.pending, step.level)
        const source = childSource(context.sources, step.level)
        const transaction = source.collection.update(step.id, (draft) => {
          Object.assign(draft, step.patch)
        })
        const runtime = trackRuntimeMutation(context, step.level, transaction)
        if (step.beforeRollback) {
          const beforeRollbackSource = childSource(
            context.sources,
            step.beforeRollback.level,
          )
          beforeRollbackSource.writeBatch(step.beforeRollback.changes)
          updateModel(
            context.levels[step.beforeRollback.level - 1]!,
            step.beforeRollback.changes,
          )
        }
        // This compound action checks the settled state. The immediate state is
        // checked separately so its known mismatch cannot abort the rollback.
        // Its normal same-source sibling commit is queued during persistence;
        // invoking writeBatch does not establish sibling delivery at this cut.
        await rollback(source, transaction, context, runtime)
        return
      }

      if (step.type === `optimistic`) {
        assertCanStartOptimisticChange(context.pending, step.level, step.handle)
        const source = childSource(context.sources, step.level)
        const current = visibleLevels(context)[step.level - 1]!.get(step.id)
        if (!current) throw new Error(`Unknown optimistic row ${step.id}`)
        const transaction = source.collection.update(step.id, (draft) => {
          Object.assign(draft, step.patch)
        })
        const runtime = trackRuntimeMutation(context, step.level, transaction)
        context.pending.set(step.handle, {
          transaction,
          runtime,
          level: step.level,
          id: step.id,
          row: applyPatch(current, step.patch),
        })
        checkpoint()
        return
      }

      if (step.type === `sync`) {
        const source = childSource(context.sources, step.level)
        source.writeBatch(step.changes)
        updateModel(context.levels[step.level - 1]!, step.changes)
        return
      }

      const pending = context.pending.get(step.handle)
      if (!pending) throw new Error(`Unknown optimistic handle ${step.handle}`)
      const source = childSource(context.sources, pending.level)

      if (step.type === `rollback`) {
        context.pending.delete(step.handle)
        await rollback(source, pending.transaction, context, pending.runtime)
        return
      }

      assertMatchingConfirmation(pending, step.authoritative)
      source.writeBatch([{ type: `update`, value: step.authoritative }])
      context.levels[pending.level - 1]!.set(step.authoritative.id, {
        ...step.authoritative,
      })
      // Sync delivery must not displace the pending optimistic projection.
      checkpoint()
      releaseRuntimeMutation(context, pending.runtime, source.resolveSync)
      await pending.transaction.isPersisted.promise
      context.pending.delete(step.handle)
    },
    cleanup: async (context) => {
      const { live, sources, pending, runtimePending } = context
      const entries = [...runtimePending]
      const errors: Array<unknown> = []
      const attempt = (work: () => void) => {
        try {
          work()
        } catch (error) {
          errors.push(error)
        }
      }
      for (const entry of entries) {
        if (
          entry.transaction.state === `pending` ||
          entry.transaction.state === `persisting`
        )
          attempt(() => {
            entry.transaction.rollback()
          })
        if (!entry.syncReleaseAttempted)
          attempt(() =>
            releaseRuntimeMutation(
              context,
              entry,
              childSource(sources, entry.level).resolveSync,
            ),
          )
      }
      // Failed rollback/release can leave a receipt pending. Dispose resources
      // even then; receipt rejection handlers are already attached.
      if (errors.length === 0)
        await Promise.all(entries.map(({ receipt }) => receipt))
      pending.clear()
      const results = await Promise.allSettled(
        [
          live,
          sources.roots.collection,
          ...sources.levels.map((source) => source.collection),
        ].map(async (collection) => {
          await collection.cleanup()
        }),
      )
      for (const result of results)
        if (result.status === `rejected`) errors.push(result.reason as unknown)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw new AggregateError(
          errors,
          `Optimistic relationship cleanup failed`,
        )
    },
  }
}

const projection: TraceProjection<
  OptimisticContext,
  unknown,
  Array<OracleNode>
> = {
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute,
  assertEqual: (actual, expected) => {
    expect(actual).toEqual(expected)
  },
}

function firstChild(routes: RouteValues, patch: ChildPatch = {}): ChildRow {
  return {
    id: 11,
    parentGroup: routes.rootA,
    group: routes.original,
    value: 110,
    position: 0,
    ...patch,
  }
}

function fixture(routes: RouteValues) {
  const roots: Array<RootRow> = [
    { id: 1, group: routes.rootA, value: 10, position: 0 },
    { id: 2, group: routes.rootB, value: 20, position: 1 },
    { id: 3, group: routes.rootC, value: 30, position: 2 },
  ]
  const levels: LevelRows = [
    [firstChild(routes)],
    [
      {
        id: 21,
        parentGroup: routes.original,
        group: routes.original + 1000,
        value: 210,
        position: 0,
      },
    ],
    [
      {
        id: 31,
        parentGroup: routes.original + 1000,
        group: routes.original + 2000,
        value: 310,
        position: 0,
      },
    ],
  ]
  return { roots, levels }
}

async function expectHistoryMatches(
  routes: RouteValues,
  steps: ReadonlyArray<OptimisticRelationshipStep>,
) {
  const { roots, levels } = fixture(routes)
  await runTrace({ steps, driver: createDriver(roots, levels), projection })
}

const routeValuesArbitrary: fc.Arbitrary<RouteValues> = fc.record({
  // Routes are equality keys. Disjoint ranges preserve distinctness while
  // letting FastCheck shrink each semantic role independently.
  rootA: fc.integer({ min: 10, max: 90 }),
  rootB: fc.integer({ min: 100, max: 180 }),
  rootC: fc.integer({ min: 200, max: 280 }),
  original: fc.integer({ min: 300, max: 380 }),
  optimistic: fc.integer({ min: 400, max: 480 }),
  authoritative: fc.integer({ min: 500, max: 580 }),
})

describe(`optimistic relationship-transition oracle`, () => {
  for (const pending of [false, true]) {
    fcTest(`observes queued sibling delivery with pending=${pending}`, async () => {
      const routes: RouteValues = {
        rootA: 10,
        rootB: 100,
        rootC: 200,
        original: 300,
        optimistic: 400,
        authoritative: 500,
      }
      const { roots, levels } = fixture(routes)
      const sibling: ChildRow = {
        id: 12,
        parentGroup: 10,
        group: 300,
        value: 120,
        position: 1,
      }
      const changes: Array<SyncChange<ChildRow>> = [
        { type: `insert`, value: sibling },
      ]
      const driver = createDriver(roots, levels)
      const events: Array<{ type: string; row: ChildRow }> = []
      let unsubscribe: (() => void) | undefined
      let siblingCuts = 0
      let runtime: PendingRuntimeMutation | undefined
      const descendants = [
        {
          id: 21,
          group: 1300,
          value: 210,
          position: 0,
          children: [{ id: 31, group: 2300, value: 310, position: 0 }],
        },
      ]
      const published = (optimistic: boolean) => [
        {
          id: 1,
          group: 10,
          value: 10,
          position: 0,
          children: optimistic
            ? [{ id: 11, group: 400, value: 110, position: 0, children: [] }]
            : [
                {
                  id: 11, group: 300, value: 110, position: 0,
                  children: descendants,
                },
                {
                  id: 12, group: 300, value: 120, position: 1,
                  children: descendants,
                },
              ],
        },
        { id: 2, group: 100, value: 20, position: 1, children: [] },
        { id: 3, group: 200, value: 30, position: 2, children: [] },
      ]
      await runTrace({
        steps: [
          pending
            ? {
                type: `optimisticRollback`,
                level: 1,
                id: 11,
                patch: { group: 400 },
                beforeRollback: { level: 1, changes },
              }
            : { type: `sync`, level: 1, changes },
          {
            type: `sync`,
            level: 2,
            changes: [
              { type: `update`, value: { ...levels[1][0]!, value: 211 } },
            ],
          },
        ] satisfies Array<OptimisticRelationshipStep>,
        driver: {
          ...driver,
          setup: async () => {
            const context = await driver.setup()
            const source = context.sources.levels[0]
            const subscription = source.collection.subscribeChanges(
              (batch) => {
                events.push(...batch.map(({ type, value }) => ({
                  type,
                  row: { ...value },
                })))
              },
              { includeInitialState: false },
            )
            unsubscribe = () => subscription.unsubscribe()
            const writeBatch = source.writeBatch
            source.writeBatch = (batch) => {
              const eventStart = events.length
              runtime = [...context.runtimePending][0]
              writeBatch(batch)
              siblingCuts += 1
              const actual = {
                present: source.collection.has(12),
                row: source.collection.get(12),
                events: events.slice(eventStart),
                rows: stripVirtualProperties(context.live.toArray),
              }
              expect(actual.present).toBe(!pending)
              if (pending) expect(actual.row).toBeUndefined()
              else expect(actual.row).toMatchObject(sibling)
              expect(actual.rows).toEqual(published(pending))
              if (pending) {
                expect(actual.events).toEqual([])
                expect(runtime?.transaction.state).toBe(`persisting`)
                expect(runtime?.settled).toBe(false)
              } else {
                expect(runtime).toBeUndefined()
                expect(actual.events).toContainEqual({
                  type: `insert`, row: expect.objectContaining(sibling),
                })
              }
            }
            return context
          },
          apply: async (step, context, checkpoint) => {
            await driver.apply(step, context, checkpoint)
            if (step.level === 1) {
              if (pending) {
                await runtime!.receipt
                expect(runtime!.settled).toBe(true)
                expect(runtime!.transaction.state).toBe(`failed`)
              }
              expect(context.sources.levels[0].collection.get(12)).toMatchObject(
                sibling,
              )
              expect(events).toContainEqual({
                type: `insert`, row: expect.objectContaining(sibling),
              })
              expect(stripVirtualProperties(context.live.toArray)).toEqual(
                published(false),
              )
            }
          },
          cleanup: async (context) => {
            const results = await Promise.allSettled([
              Promise.resolve().then(() => unsubscribe?.()),
              Promise.resolve().then(() => driver.cleanup(context)),
            ])
            const errors = results.flatMap((result): Array<unknown> =>
              result.status === `rejected` ? [result.reason as unknown] : [],
            )
            if (errors.length === 1) throw errors[0]
            if (errors.length > 1)
              throw new AggregateError(errors, `Sibling observation cleanup failed`)
          },
        },
        projection,
      })
      expect(siblingCuts).toBe(1)
    })
  }

  for (const compound of [false, true]) {
    for (const cleanupFails of [false, true]) {
      fcTest(
        `cleans failed optimistic work (compound=${compound}, cleanup failure=${cleanupFails})`,
        async () => {
          const routes: RouteValues = {
            rootA: 10,
            rootB: 100,
            rootC: 200,
            original: 300,
            optimistic: 400,
            authoritative: 500,
          }
          const { roots, levels } = fixture(routes)
          const driver = createDriver(roots, levels)
          const failure = new Error(`optimistic action failed`)
          const cleanupFailure = new Error(`live cleanup failed after disposal`)
          let context: OptimisticContext | undefined
          let failedTransaction: SettlingTransaction | undefined
          const fail = (current: OptimisticContext): never => {
            const runtime = [...current.runtimePending][0]
            expect(runtime).toBeDefined()
            failedTransaction = runtime!.transaction
            throw failure
          }
          const step: OptimisticRelationshipStep = compound
            ? {
                type: `optimisticRollback`,
                level: 1,
                id: 11,
                patch: { group: routes.optimistic },
                beforeRollback: {
                  level: 1,
                  changes: [
                    {
                      type: `insert`,
                      value: {
                        id: 12,
                        parentGroup: routes.rootA,
                        group: routes.original,
                        value: 120,
                        position: 1,
                      },
                    },
                  ],
                },
              }
            : {
                type: `optimistic`,
                handle: `failed`,
                level: 1,
                id: 11,
                patch: { parentGroup: routes.rootB },
              }
          await expect(
            runTrace({
              steps: [step],
              driver: {
                ...driver,
                setup: async () => {
                  const current = await driver.setup()
                  context = current
                  if (compound) {
                    const source = current.sources.levels[0]
                    const writeBatch = source.writeBatch
                    source.writeBatch = (changes) => {
                      writeBatch(changes)
                      fail(current)
                    }
                  }
                  if (cleanupFails) {
                    const cleanup = current.live.cleanup.bind(current.live)
                    current.live.cleanup = async () => {
                      await cleanup()
                      throw cleanupFailure
                    }
                  }
                  return current
                },
              },
              projection: {
                ...projection,
                assertEqual: (actual, expected) => {
                  projection.assertEqual(actual, expected)
                  if (!compound && context!.pending.size > 0) fail(context!)
                  return undefined
                },
              },
            }),
          ).rejects.toBe(failure)
          expect(
            (failure as Error & { suppressed?: Array<unknown> }).suppressed,
          ).toEqual(cleanupFails ? [cleanupFailure] : undefined)
          if (!context) throw new Error(`Expected initialized trace context`)
          expect(failedTransaction?.state).toBe(`failed`)
          expect(context.pending.size).toBe(0)
          expect(context.runtimePending.size).toBe(0)
          for (const collection of [
            context.live,
            context.sources.roots.collection,
            ...context.sources.levels.map((source) => source.collection),
          ])
            expect(collection.status).toBe(`cleaned-up`)
        },
      )
    }
  }

  fcTest(`checks the optimistic overlay before yielding from apply`, async () => {
    const routes: RouteValues = {
      rootA: 10,
      rootB: 100,
      rootC: 200,
      original: 300,
      optimistic: 400,
      authoritative: 500,
    }
    const { roots, levels } = fixture(routes)
    const driver = createDriver(roots, levels)
    await runTrace({
      steps: [
        {
          type: `optimistic` as const,
          handle: `immediate`,
          level: 1 as const,
          id: 11,
          patch: { parentGroup: routes.rootB },
        },
      ],
      driver: {
        ...driver,
        apply: (step, context, checkpoint) => {
          let checkpoints = 0
          const applied = driver.apply(step, context, () => {
            checkpoints += 1
            return checkpoint()
          })
          const checkpointsBeforeYield = checkpoints
          return Promise.resolve(applied).then(() => {
            expect(checkpointsBeforeYield).toBe(1)
          })
        },
      },
      projection,
    })
  })

  fcTest(
    `rejects optimistic handles the sync mock cannot settle independently`,
    () => {
      const pending = new Map([[`first`, { level: 1 as const }]])

      expect(() => assertCanStartOptimisticChange(pending, 2, `first`)).toThrow(
        /Duplicate optimistic handle first/,
      )
      expect(() =>
        assertCanStartOptimisticChange(pending, 1, `second`),
      ).toThrow(/Level 1 already has pending optimistic handle first/)
      expect(() => assertMatchingConfirmation({ id: 11 }, { id: 12 })).toThrow(
        /Confirmation row 12 does not match pending row 11/,
      )
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.rekey-detach`),
  )(
    `an optimistic rekey detaches its old descendants immediately`,
    async (routes) => {
      await expectHistoryMatches(routes, [
        {
          type: `optimistic`,
          handle: `rekey`,
          level: 1,
          id: 11,
          patch: { group: routes.optimistic },
        },
      ])
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.rekey-rollback`),
  )(
    `restores the authoritative relationship after an optimistic rekey rolls back`,
    async (routes) => {
      await expectHistoryMatches(routes, [
        {
          type: `optimisticRollback`,
          level: 1,
          id: 11,
          patch: { group: routes.optimistic },
        },
      ])
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.descendant-rollback`),
  )(
    `rolls back a descendant update made while its ancestor is reparented`,
    async (routes) => {
      await expectHistoryMatches(routes, [
        {
          type: `optimistic`,
          handle: `reparent`,
          level: 1,
          id: 11,
          patch: { parentGroup: routes.rootB },
        },
        {
          type: `optimistic`,
          handle: `descendant`,
          level: 2,
          id: 21,
          patch: { value: 211 },
        },
        { type: `rollback`, handle: `descendant` },
        { type: `rollback`, handle: `reparent` },
      ])
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.ancestor-rollback`),
  )(
    `rolls back a reparented ancestor while its descendant update remains pending`,
    async (routes) => {
      await expectHistoryMatches(routes, [
        {
          type: `optimistic`,
          handle: `reparent`,
          level: 1,
          id: 11,
          patch: { parentGroup: routes.rootB },
        },
        {
          type: `optimistic`,
          handle: `descendant`,
          level: 2,
          id: 21,
          patch: { value: 211 },
        },
        { type: `rollback`, handle: `reparent` },
        { type: `rollback`, handle: `descendant` },
      ])
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.confirm-same-route`),
  )(
    `settles a confirmed optimistic reparent on the same authoritative route`,
    async (routes) => {
      await expectHistoryMatches(routes, [
        {
          type: `optimistic`,
          handle: `reparent`,
          level: 1,
          id: 11,
          patch: { parentGroup: routes.rootB },
        },
        {
          type: `confirm`,
          handle: `reparent`,
          authoritative: firstChild(routes, {
            parentGroup: routes.rootB,
          }),
        },
        {
          type: `sync`,
          level: 2,
          changes: [
            {
              type: `update`,
              value: {
                id: 21,
                parentGroup: routes.original,
                group: routes.original + 1000,
                value: 211,
                position: 0,
              },
            },
          ],
        },
      ])
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.confirm-different-route`),
  )(
    `settles a confirmed optimistic reparent on a different authoritative route`,
    async (routes) => {
      await expectHistoryMatches(routes, [
        {
          type: `optimistic`,
          handle: `reparent`,
          level: 1,
          id: 11,
          patch: { parentGroup: routes.rootB },
        },
        {
          type: `confirm`,
          handle: `reparent`,
          authoritative: firstChild(routes, {
            parentGroup: routes.rootC,
            group: routes.authoritative,
            value: 111,
          }),
        },
        {
          type: `sync`,
          level: 2,
          changes: [
            {
              type: `update`,
              value: {
                id: 21,
                parentGroup: routes.authoritative,
                group: routes.original + 1000,
                value: 211,
                position: 0,
              },
            },
          ],
        },
      ])
    },
  )

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.sibling-route-rollback`),
  )(`restores a rekey after a sibling enters its old route`, async (routes) => {
    await expectHistoryMatches(routes, [
      {
        type: `optimisticRollback`,
        level: 1,
        id: 11,
        patch: { group: routes.optimistic },
        beforeRollback: {
          level: 1,
          changes: [
            {
              type: `insert`,
              value: {
                id: 12,
                parentGroup: routes.rootA,
                group: routes.original,
                value: 120,
                position: 1,
              },
            },
          ],
        },
      },
      {
        type: `sync`,
        level: 2,
        changes: [
          {
            type: `update`,
            value: {
              id: 21,
              parentGroup: routes.original,
              group: routes.original + 1000,
              value: 211,
              position: 0,
            },
          },
        ],
      },
    ])
  })

  fcTest.prop(
    [routeValuesArbitrary],
    oraclePropertyOptions(12, `includes-optimistic.repeated-history`),
  )(`supports repeated rollback and confirmation histories`, async (routes) => {
    await expectHistoryMatches(routes, [
      {
        type: `optimistic`,
        handle: `first`,
        level: 1,
        id: 11,
        patch: { parentGroup: routes.rootB },
      },
      { type: `rollback`, handle: `first` },
      {
        type: `optimistic`,
        handle: `second`,
        level: 1,
        id: 11,
        patch: { parentGroup: routes.rootB },
      },
      {
        type: `confirm`,
        handle: `second`,
        authoritative: firstChild(routes, {
          parentGroup: routes.rootB,
        }),
      },
      {
        type: `optimisticRollback`,
        level: 1,
        id: 11,
        patch: { group: routes.optimistic },
      },
      {
        type: `sync`,
        level: 2,
        changes: [
          {
            type: `update`,
            value: {
              id: 21,
              parentGroup: routes.original,
              group: routes.original + 1000,
              value: 212,
              position: 0,
            },
          },
        ],
      },
    ])
  })
})
