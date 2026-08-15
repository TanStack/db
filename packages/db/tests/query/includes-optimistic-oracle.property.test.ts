import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withExpectedRejection,
} from '../utils.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { runTrace } from '../trace-runner.js'
import type { AssertionDifference } from '../expected-failure.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'

type RootRow = {
  id: number
  group: number
  value: number
  position: number
}

type ChildRow = RootRow & {
  parentGroup: number
}

type SyncChange<T> = {
  type: `insert` | `update` | `delete`
  value: T
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

type RelationshipNode = Record<string, unknown> & {
  id: number
  children?: unknown
}

function isRelationshipNode(value: unknown): value is RelationshipNode {
  return (
    typeof value === `object` &&
    value !== null &&
    `id` in value &&
    typeof value.id === `number`
  )
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

type SettlingTransaction = {
  isPersisted: { promise: Promise<unknown> }
}

type PendingOptimisticChange = {
  transaction: SettlingTransaction
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

let nextHarnessId = 0

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
) {
  const options = mockSyncCollectionOptions<T>({
    id: `${name}-${nextHarnessId++}`,
    getKey: (row) => row.id,
    initialData: initialData.map((row) => ({ ...row })),
  })
  options.sync.rowUpdateMode = `full`
  const collection = createCollection(options)

  const writeBatch = (changes: ReadonlyArray<SyncChange<T>>) => {
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
    writeBatch,
    resolveSync: options.utils.resolveSync,
    rejectSync: options.utils.rejectSync,
  }
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

function replaceDirectChildren(
  value: unknown,
  parentId: number,
  children: ReadonlyArray<OracleNode>,
): unknown | undefined {
  if (!Array.isArray(value)) return undefined

  let replacements = 0
  const visit = (entries: ReadonlyArray<unknown>): Array<unknown> =>
    entries.map((entry) => {
      if (!isRelationshipNode(entry)) return entry
      if (entry.id === parentId) {
        replacements += 1
        return { ...entry, children }
      }
      if (!Array.isArray(entry.children)) return entry
      return { ...entry, children: visit(entry.children) }
    })

  const replaced = visit(value)
  return replacements === 1 ? replaced : undefined
}

function matchesExactly(actual: unknown, expected: unknown): boolean {
  try {
    expect(actual).toEqual(expected)
    return true
  } catch {
    return false
  }
}

function classifyRetainedDetachedGrandchild(
  { actual, expected }: AssertionDifference,
  retainedChildren: ReadonlyArray<OracleNode>,
) {
  const expectedWithOnlyKnownDefect = replaceDirectChildren(
    expected,
    11,
    retainedChildren,
  )
  return (
    expectedWithOnlyKnownDefect !== undefined &&
    matchesExactly(actual, expectedWithOnlyKnownDefect)
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
) {
  const message = `optimistic relationship oracle rollback`
  const persisted = transaction.isPersisted.promise.catch(() => undefined)
  await withExpectedRejection(message, async () => {
    source.rejectSync(new Error(message))
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
        await rollback(source, transaction)
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
        context.pending.set(step.handle, {
          transaction,
          level: step.level,
          id: step.id,
          row: applyPatch(current, step.patch),
        })
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
        await rollback(source, pending.transaction)
        return
      }

      assertMatchingConfirmation(pending, step.authoritative)
      source.writeBatch([{ type: `update`, value: step.authoritative }])
      context.levels[pending.level - 1]!.set(step.authoritative.id, {
        ...step.authoritative,
      })
      // Sync delivery must not displace the pending optimistic projection.
      checkpoint()
      source.resolveSync()
      await pending.transaction.isPersisted.promise
      context.pending.delete(step.handle)
    },
    cleanup: async ({ live, sources, pending }) => {
      for (const [handle, change] of pending) {
        pending.delete(handle)
        await rollback(childSource(sources, change.level), change.transaction)
      }
      await live.cleanup()
      await Promise.all([
        sources.roots.collection.cleanup(),
        ...sources.levels.map(({ collection }) => collection.cleanup()),
      ])
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

function retainedDetachedChildren(routes: RouteValues): Array<OracleNode> {
  return [
    {
      id: 21,
      group: routes.original + 1000,
      value: 210,
      position: 0,
      children: [],
    },
  ]
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
  fcTest(`known-defect classifier rejects collateral corruption`, () => {
    const routes: RouteValues = {
      rootA: 10,
      rootB: 100,
      rootC: 200,
      original: 300,
      optimistic: 400,
      authoritative: 500,
    }
    const expected = [
      {
        id: 1,
        group: routes.rootA,
        value: 10,
        position: 0,
        children: [
          {
            id: 11,
            group: routes.optimistic,
            value: 110,
            position: 0,
            children: [],
          },
        ],
      },
    ]
    const actual = [
      {
        id: 1,
        group: routes.rootA,
        value: 999,
        position: 0,
        children: [
          {
            id: 11,
            group: routes.optimistic,
            value: 110,
            position: 0,
            children: retainedDetachedChildren(routes),
          },
        ],
      },
    ]

    expect(
      classifyRetainedDetachedGrandchild(
        { actual, expected },
        retainedDetachedChildren(routes),
      ),
    ).toBe(false)
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

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
    `known defect: an optimistic rekey detaches its old descendants immediately`,
    async (routes) => {
      await expectAssertionFailure(
        async () => {
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
        {
          checkpoint: 1,
          classify: (difference) =>
            classifyRetainedDetachedGrandchild(
              difference,
              retainedDetachedChildren(routes),
            ),
        },
      )()
    },
  )

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
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

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
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

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
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

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
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

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
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

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
    `restores a rekey after a sibling enters its old route`,
    async (routes) => {
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
    },
  )

  fcTest.prop([routeValuesArbitrary], { numRuns: 12 })(
    `supports repeated rollback and confirmation histories`,
    async (routes) => {
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
    },
  )
})
