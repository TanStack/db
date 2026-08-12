import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  concat,
  createLiveQueryCollection,
  eq,
  materialize,
  queryOnce,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  withExpectedRejection,
} from '../utils.js'
import { runTrace } from '../trace-runner.js'
import type {
  TraceCheckpoint,
  TraceDriver,
  TraceProjection,
} from '../trace-runner.js'

type IncludeDepth = 1 | 2 | 3 | 4

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

type HistoryAction = {
  type: `put` | `delete` | `optimisticConfirm` | `optimisticRollback`
  level: 0 | IncludeDepth
  id: number
  parentGroup: number
  group: number
  value: number
  position: number
}

type Scenario = {
  depth: IncludeDepth
  history: Array<HistoryAction>
}

type OracleNode = RootRow & {
  children?: Array<OracleNode>
}

type MaterializeRoot = { id: number; middleId: number }
type MaterializeMiddle = { id: number; sharedId: number }
type MaterializeShared = { id: number; leafId: number }
type MaterializeLeaf = { id: number; value: number }

type MaterializeTree = {
  id: number
  middle:
    | {
        id: number
        sharedId: number
        shared:
          | {
              id: number
              leafId: number
              leaf: MaterializeLeaf | undefined
            }
          | undefined
      }
    | undefined
}

type MaterializeInsert =
  | `root-1`
  | `root-2`
  | `middle-1`
  | `middle-2`
  | `shared-1`
  | `shared-2`
  | `leaf-1`
  | `leaf-2`

type MaterializeScenario = {
  sharedIntermediate: boolean
  insertOrder: Array<MaterializeInsert>
}

const depthArbitrary = fc.constantFrom<IncludeDepth>(1, 2, 3, 4)

function levelArbitrary(
  depth: IncludeDepth,
): fc.Arbitrary<HistoryAction[`level`]> {
  switch (depth) {
    case 1:
      return fc.constantFrom(0, 1)
    case 2:
      return fc.constantFrom(0, 1, 2)
    case 3:
      return fc.constantFrom(0, 1, 2, 3)
    case 4:
      return fc.constantFrom(0, 1, 2, 3, 4)
  }
}

function actionArbitrary(depth: IncludeDepth): fc.Arbitrary<HistoryAction> {
  return fc.record({
    type: fc.constantFrom(
      `put`,
      `delete`,
      `optimisticConfirm`,
      `optimisticRollback`,
    ),
    level: levelArbitrary(depth),
    id: fc.integer({ min: 0, max: 5 }),
    parentGroup: fc.integer({ min: 0, max: 2 }),
    group: fc.integer({ min: 0, max: 2 }),
    value: fc.integer({ min: -3, max: 3 }),
    position: fc.integer({ min: -2, max: 2 }),
  })
}

function ensureActionsTargetRows(
  history: Array<HistoryAction>,
): Array<HistoryAction> {
  const keysByLevel = Array.from({ length: 5 }, () => new Set<number>())
  const positionsByLevel = Array.from(
    { length: 5 },
    () => new Map<number, number>(),
  )

  return history.map((action) => {
    const keys = keysByLevel[action.level]!
    const positions = positionsByLevel[action.level]!
    const normalizePut = (): HistoryAction => {
      keys.add(action.id)
      const position = positions.get(action.id) ?? action.position
      positions.set(action.id, position)
      return { ...action, type: `put`, position }
    }

    if (action.type === `put`) {
      return normalizePut()
    }
    if (keys.size === 0) {
      return normalizePut()
    }

    const existingKeys = [...keys]
    const id = existingKeys[action.id % existingKeys.length]!
    if (action.type === `delete`) {
      keys.delete(id)
      positions.delete(id)
    }
    return { ...action, id }
  })
}

const scenarioArbitrary: fc.Arbitrary<Scenario> = depthArbitrary.chain(
  (depth) =>
    fc
      .array(actionArbitrary(depth), { minLength: 1, maxLength: 18 })
      .map((history) => ({
        depth,
        history: ensureActionsTargetRows(history),
      })),
)

const materializeScenarioArbitrary: fc.Arbitrary<MaterializeScenario> = fc
  .boolean()
  .chain((sharedIntermediate) => {
    const inserts: Array<MaterializeInsert> = sharedIntermediate
      ? [`root-1`, `root-2`, `middle-1`, `middle-2`, `shared-1`, `leaf-1`]
      : [
          `root-1`,
          `root-2`,
          `middle-1`,
          `middle-2`,
          `shared-1`,
          `shared-2`,
          `leaf-1`,
          `leaf-2`,
        ]

    return fc
      .shuffledSubarray(inserts, {
        minLength: inserts.length,
        maxLength: inserts.length,
      })
      .map((insertOrder) => ({ sharedIntermediate, insertOrder }))
  })

const sharedMaterializeSeed: MaterializeScenario = {
  sharedIntermediate: true,
  insertOrder: [
    `root-2`,
    `middle-2`,
    `root-1`,
    `middle-1`,
    `shared-1`,
    `leaf-1`,
  ],
}

const confirmedChildReorderSeed: Scenario = {
  depth: 2,
  history: [
    {
      type: `put`,
      level: 0,
      id: 0,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: 0,
    },
    {
      type: `put`,
      level: 1,
      id: 1,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: -1,
    },
    {
      type: `put`,
      level: 1,
      id: 2,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: -1,
    },
    {
      type: `put`,
      level: 1,
      id: 1,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: 0,
    },
  ],
}

let nextHarnessId = 0

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: Array<T> = [],
  rowUpdateMode: `partial` | `full` = `partial`,
) {
  const options = mockSyncCollectionOptions<T>({
    id: `${name}-${nextHarnessId++}`,
    getKey: (row) => row.id,
    initialData,
  })
  options.sync.rowUpdateMode = rowUpdateMode
  const collection = createCollection(options)
  const writeBatch = (changes: ReadonlyArray<SyncChange<T>>): void => {
    options.utils.begin()
    changes.forEach((change) => options.utils.write(change))
    options.utils.commit()
  }

  return {
    collection,
    write(type: `insert` | `update` | `delete`, value: T): void {
      writeBatch([{ type, value }])
    },
    writeBatch,
    resolveSync(): void {
      options.utils.resolveSync()
    },
    rejectSync(error: Error): void {
      options.utils.rejectSync(error)
    },
  }
}

function compareRows(left: RootRow, right: RootRow): number {
  return left.position - right.position || left.id - right.id
}

// This is intentionally independent of the live-query implementation. It is
// the simple, full-recompute semantics reference for the incremental system.
function recompute(
  roots: Map<number, RootRow>,
  levels: Array<Map<number, ChildRow>>,
  depth: IncludeDepth,
): Array<OracleNode> {
  const materializeLevel = (
    level: number,
    parentGroup: number,
  ): Array<OracleNode> =>
    [...levels[level]!.values()]
      .filter((row) => row.parentGroup === parentGroup)
      .sort(compareRows)
      .map((row) => {
        const node: OracleNode = {
          id: row.id,
          group: row.group,
          value: row.value,
          position: row.position,
        }
        if (level + 1 < depth) {
          node.children = materializeLevel(level + 1, row.group)
        }
        return node
      })

  return [...roots.values()].sort(compareRows).map((root) => ({
    id: root.id,
    group: root.group,
    value: root.value,
    position: root.position,
    children: materializeLevel(0, root.group),
  }))
}

// Collection delivery metadata is independent of include materialization.
// Compare only the user-defined row shape modeled by the recompute oracle.
function stripVirtualProperties(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVirtualProperties)
  }
  if (!value || typeof value !== `object`) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith(`$`))
      .map(([key, entry]) => [key, stripVirtualProperties(entry)]),
  )
}

type Sources = ReturnType<typeof createSources>

function createIncrementalQuery(depth: IncludeDepth, sources: Sources) {
  const { roots } = sources
  const [level1, level2, level3, level4] = sources.levels

  switch (depth) {
    case 1:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
                .where(({ child }) => eq(child.parentGroup, root.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => ({
                  id: child.id,
                  group: child.group,
                  value: child.value,
                  position: child.position,
                })),
            ),
          })),
      )
    case 2:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
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
                      .from({ grandchild: level2.collection })
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
                      })),
                  ),
                })),
            ),
          })),
      )
    case 3:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
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
                      .from({ grandchild: level2.collection })
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
                            .from({ greatGrandchild: level3.collection })
                            .where(({ greatGrandchild }) =>
                              eq(greatGrandchild.parentGroup, grandchild.group),
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.position,
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.id,
                            )
                            .select(({ greatGrandchild }) => ({
                              id: greatGrandchild.id,
                              group: greatGrandchild.group,
                              value: greatGrandchild.value,
                              position: greatGrandchild.position,
                            })),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      )
    case 4:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
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
                      .from({ grandchild: level2.collection })
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
                            .from({ greatGrandchild: level3.collection })
                            .where(({ greatGrandchild }) =>
                              eq(greatGrandchild.parentGroup, grandchild.group),
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.position,
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.id,
                            )
                            .select(({ greatGrandchild }) => ({
                              id: greatGrandchild.id,
                              group: greatGrandchild.group,
                              value: greatGrandchild.value,
                              position: greatGrandchild.position,
                              children: toArray(
                                q
                                  .from({ finalChild: level4.collection })
                                  .where(({ finalChild }) =>
                                    eq(
                                      finalChild.parentGroup,
                                      greatGrandchild.group,
                                    ),
                                  )
                                  .orderBy(
                                    ({ finalChild }) => finalChild.position,
                                  )
                                  .orderBy(({ finalChild }) => finalChild.id)
                                  .select(({ finalChild }) => ({
                                    id: finalChild.id,
                                    group: finalChild.group,
                                    value: finalChild.value,
                                    position: finalChild.position,
                                  })),
                              ),
                            })),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      )
  }
}

function createSources(rowUpdateMode: `partial` | `full` = `partial`) {
  return {
    roots: createControlledCollection<RootRow>(
      `oracle-roots`,
      [],
      rowUpdateMode,
    ),
    levels: [
      createControlledCollection<ChildRow>(`oracle-level-1`, [], rowUpdateMode),
      createControlledCollection<ChildRow>(`oracle-level-2`, [], rowUpdateMode),
      createControlledCollection<ChildRow>(`oracle-level-3`, [], rowUpdateMode),
      createControlledCollection<ChildRow>(`oracle-level-4`, [], rowUpdateMode),
    ] as const,
  }
}

function sameRoot(left: RootRow, right: RootRow): boolean {
  return (
    left.group === right.group &&
    left.value === right.value &&
    left.position === right.position
  )
}

function sameChild(left: ChildRow, right: ChildRow): boolean {
  return left.parentGroup === right.parentGroup && sameRoot(left, right)
}

async function settleOptimisticAction(
  action: HistoryAction,
  resolveSync: () => void,
  rejectSync: (error: Error) => void,
  persistedPromise: Promise<unknown>,
): Promise<void> {
  if (action.type === `optimisticConfirm`) {
    resolveSync()
    await persistedPromise
    return
  }

  const message = `oracle optimistic rollback`
  const persisted = persistedPromise.catch(() => undefined)
  await withExpectedRejection(message, async () => {
    rejectSync(new Error(message))
    await persisted
    await flushPromises()
  })
}

function expectAssertionFailure<TArgs extends Array<unknown>>(
  assertion: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args) => {
    await expect(assertion(...args)).rejects.toMatchObject({
      name: `AssertionError`,
    })
  }
}

async function applyAction(
  action: HistoryAction,
  sources: Sources,
  roots: Map<number, RootRow>,
  levels: Array<Map<number, ChildRow>>,
  assertMatches: TraceCheckpoint,
): Promise<void> {
  if (action.level === 0) {
    const current = roots.get(action.id)
    if (action.type === `delete`) {
      if (current) {
        sources.roots.write(`delete`, current)
        roots.delete(action.id)
      }
      return
    }

    // Keep correlation keys stable in green fuzz histories. The known
    // correlation-key update failure has its own deterministic seed below.
    const next: RootRow = {
      id: action.id,
      group: current?.group ?? action.group,
      value: action.value,
      position:
        action.type === `put` ? action.position : (current?.position ?? 0),
    }

    if (action.type !== `put` && !current) return
    if (action.type !== `put` && current && sameRoot(current, next)) return

    if (
      action.type === `optimisticConfirm` ||
      action.type === `optimisticRollback`
    ) {
      const transaction = sources.roots.collection.update(
        action.id,
        (draft) => {
          draft.group = next.group
          draft.value = next.value
        },
      )
      roots.set(action.id, next)
      assertMatches()

      if (action.type === `optimisticConfirm`) {
        sources.roots.write(`update`, next)
      }
      await settleOptimisticAction(
        action,
        sources.roots.resolveSync,
        sources.roots.rejectSync,
        transaction.isPersisted.promise,
      )
      if (action.type === `optimisticRollback`) {
        roots.set(action.id, current!)
        assertMatches()
      }
      return
    }

    sources.roots.write(current ? `update` : `insert`, next)
    roots.set(action.id, next)
    return
  }

  const level = action.level - 1
  const model = levels[level]!
  const source = sources.levels[level]!
  const current = model.get(action.id)
  if (action.type === `delete`) {
    if (current) {
      source.write(`delete`, current)
      model.delete(action.id)
    }
    return
  }

  // Keep correlation keys stable in green fuzz histories. The known
  // correlation-key update failure has its own deterministic seed below.
  const next: ChildRow = {
    id: action.id,
    parentGroup: current?.parentGroup ?? action.parentGroup,
    group: current?.group ?? action.group,
    value: action.value,
    position:
      action.type === `put` ? action.position : (current?.position ?? 0),
  }

  if (action.type !== `put` && !current) return
  if (action.type !== `put` && current && sameChild(current, next)) return

  if (
    action.type === `optimisticConfirm` ||
    action.type === `optimisticRollback`
  ) {
    const transaction = source.collection.update(action.id, (draft) => {
      draft.parentGroup = next.parentGroup
      draft.group = next.group
      draft.value = next.value
    })
    model.set(action.id, next)
    assertMatches()

    if (action.type === `optimisticConfirm`) {
      source.write(`update`, next)
    }
    await settleOptimisticAction(
      action,
      source.resolveSync,
      source.rejectSync,
      transaction.isPersisted.promise,
    )
    if (action.type === `optimisticRollback`) {
      model.set(action.id, current!)
      assertMatches()
    }
    return
  }

  source.write(current ? `update` : `insert`, next)
  model.set(action.id, next)
}

async function cleanupSources(sources: Sources) {
  await Promise.all(
    [sources.roots, ...sources.levels].map(({ collection }) =>
      collection.cleanup(),
    ),
  )
}

type StructuralTraceContext = {
  depth: IncludeDepth
  sources: Sources
  incremental: ReturnType<typeof createIncrementalQuery>
  roots: Map<number, RootRow>
  levels: Array<Map<number, ChildRow>>
}

function createStructuralTraceContext(
  depth: IncludeDepth,
  rowUpdateMode: `partial` | `full` = `partial`,
): StructuralTraceContext {
  const sources = createSources(rowUpdateMode)
  return {
    depth,
    sources,
    incremental: createIncrementalQuery(depth, sources),
    roots: new Map<number, RootRow>(),
    levels: Array.from({ length: 4 }, () => new Map<number, ChildRow>()),
  }
}

async function cleanupStructuralTrace({
  incremental,
  sources,
}: Pick<StructuralTraceContext, `sources`> & {
  incremental: { cleanup: () => Promise<void> }
}): Promise<void> {
  await incremental.cleanup()
  await cleanupSources(sources)
}

function createStructuralTraceDriver(
  depth: IncludeDepth,
): TraceDriver<HistoryAction, StructuralTraceContext> {
  return {
    setup: () => createStructuralTraceContext(depth),
    start: ({ incremental }) => incremental.preload(),
    apply: (action, context, checkpoint) =>
      applyAction(
        action,
        context.sources,
        context.roots,
        context.levels,
        checkpoint,
      ),
    cleanup: cleanupStructuralTrace,
  }
}

type FullRowBatchStep =
  | { level: 0; changes: Array<SyncChange<RootRow>> }
  | { level: IncludeDepth; changes: Array<SyncChange<ChildRow>> }

type FullRowBatchInput = {
  level: 0 | IncludeDepth
  changes: Array<{
    type: `put` | `delete`
    id: number
    parentGroup: number
    group: number
    value: number
    position: number
  }>
}

type FullRowBatchScenario = {
  depth: IncludeDepth
  steps: Array<FullRowBatchStep>
}

function updateModel<T extends { id: number }>(
  model: Map<number, T>,
  changes: ReadonlyArray<SyncChange<T>>,
): void {
  for (const change of changes) {
    if (change.type === `delete`) {
      model.delete(change.value.id)
    } else {
      model.set(change.value.id, change.value)
    }
  }
}

function createFullRowBatchTraceDriver(
  depth: IncludeDepth,
): TraceDriver<FullRowBatchStep, StructuralTraceContext> {
  return {
    setup: () => createStructuralTraceContext(depth, `full`),
    start: ({ incremental }) => incremental.preload(),
    apply: (step, { sources, roots, levels }) => {
      if (step.level === 0) {
        sources.roots.writeBatch(step.changes)
        updateModel(roots, step.changes)
        return
      }

      const level = step.level - 1
      sources.levels[level]!.writeBatch(step.changes)
      updateModel(levels[level]!, step.changes)
    },
    cleanup: cleanupStructuralTrace,
  }
}

function batchRoot(
  id: number,
  group: number,
  value = id * 10,
  position = id - 1,
): RootRow {
  return { id, group, value, position }
}

function batchChild(
  id: number,
  parentGroup: number,
  value = id * 10,
  position = id - 1,
): ChildRow {
  return { id, parentGroup, group: id * 10, value, position }
}

const fullRowBatchTrace: Array<FullRowBatchStep> = [
  {
    level: 0,
    changes: [
      { type: `insert`, value: batchRoot(1, 1) },
      { type: `insert`, value: batchRoot(2, 2) },
    ],
  },
  {
    level: 1,
    changes: [
      { type: `insert`, value: batchChild(1, 1, 10, 0) },
      { type: `insert`, value: batchChild(2, 1, 20, 1) },
      { type: `insert`, value: batchChild(3, 2, 30, 0) },
    ],
  },
  {
    level: 1,
    changes: [
      { type: `update`, value: batchChild(1, 2, 11, 0) },
      { type: `update`, value: batchChild(2, 1, 22, 1) },
    ],
  },
  {
    level: 1,
    changes: [
      { type: `delete`, value: batchChild(3, 2, 30, 0) },
      { type: `insert`, value: batchChild(4, 2, 40, 1) },
    ],
  },
]

const fullRowSharedRoutingSeed: FullRowBatchScenario = {
  depth: 1,
  steps: [
    {
      level: 0,
      changes: [
        { type: `insert`, value: batchRoot(0, 2, 0, 0) },
        { type: `insert`, value: batchRoot(1, 2, 0, 0) },
      ],
    },
    {
      level: 0,
      changes: [{ type: `delete`, value: batchRoot(1, 2, 0, 0) }],
    },
    {
      level: 0,
      changes: [{ type: `insert`, value: batchRoot(1, 0, 0, 0) }],
    },
    {
      level: 1,
      changes: [{ type: `insert`, value: batchChild(0, 2, 0, 0) }],
    },
  ],
}

function fullRowBatchInputArbitrary(
  depth: IncludeDepth,
  levels: `all` | `children`,
  maxBatchSize = 3,
): fc.Arbitrary<FullRowBatchInput> {
  const levelsArbitrary =
    levels === `all`
      ? levelArbitrary(depth)
      : fc.integer({ min: 1, max: depth }).map((level) => level as IncludeDepth)

  return levelsArbitrary.chain((level) =>
    fc
      .uniqueArray(
        fc.record({
          // Root delete/reinsert has a known failing seed below. Keep the
          // generated green corpus out of that class while still generating
          // inserts, replacements, and multi-change batches at the root.
          type:
            level === 0
              ? fc.constant(`put` as const)
              : fc.constantFrom(`put` as const, `delete` as const),
          id: fc.integer({ min: 0, max: 5 }),
          parentGroup: fc.integer({ min: 0, max: 4 }),
          group: fc.integer({ min: 0, max: 4 }),
          value: fc.integer({ min: -3, max: 3 }),
          position: fc.integer({ min: -2, max: 2 }),
        }),
        {
          selector: (change) => change.id,
          minLength: 1,
          maxLength: maxBatchSize,
        },
      )
      .map((changes) => ({ level, changes })),
  )
}

function createConnectedBatchPrefix(
  depth: IncludeDepth,
): Array<FullRowBatchStep> {
  // Generated ids stop at 5, so this path survives every later batch and
  // guarantees that the selected depth is observable at every checkpoint.
  const steps: Array<FullRowBatchStep> = [
    {
      level: 0,
      changes: [{ type: `insert`, value: batchRoot(100, 100, 100, 0) }],
    },
  ]

  for (let level = 1; level <= depth; level++) {
    steps.push({
      level: level as IncludeDepth,
      changes: [
        {
          type: `insert`,
          value: {
            ...batchChild(100 + level, 99 + level, 100 + level, 0),
            group: 100 + level,
          },
        },
      ],
    })
  }

  return steps
}

function normalizeFullRowBatchInputs(
  depth: IncludeDepth,
  inputs: Array<FullRowBatchInput>,
  allowChildRelationshipUpdates: boolean,
): FullRowBatchScenario {
  const roots = new Map<number, RootRow>([[100, batchRoot(100, 100, 100, 0)]])
  const levels = Array.from(
    { length: 4 },
    (_, level) =>
      new Map<number, ChildRow>(
        level < depth
          ? [
              [
                101 + level,
                {
                  ...batchChild(101 + level, 100 + level, 101 + level, 0),
                  group: 101 + level,
                },
              ],
            ]
          : [],
      ),
  )
  const steps = createConnectedBatchPrefix(depth)

  for (const input of inputs) {
    if (input.level === 0) {
      const changes = input.changes.map((change): SyncChange<RootRow> => {
        const current = roots.get(change.id)
        if (change.type === `delete` && current) {
          roots.delete(change.id)
          return { type: `delete`, value: current }
        }

        const value: RootRow = {
          id: change.id,
          group: current ? current.group : change.group,
          value: change.value,
          position: change.position,
        }
        roots.set(value.id, value)
        return { type: current ? `update` : `insert`, value }
      })
      steps.push({ level: 0, changes })
      continue
    }

    const model = levels[input.level - 1]!
    const changes = input.changes.map((change): SyncChange<ChildRow> => {
      const current = model.get(change.id)
      if (change.type === `delete` && current) {
        model.delete(change.id)
        return { type: `delete`, value: current }
      }

      const value: ChildRow = {
        id: change.id,
        parentGroup:
          !allowChildRelationshipUpdates && current
            ? current.parentGroup
            : change.parentGroup,
        group:
          !allowChildRelationshipUpdates && current
            ? current.group
            : change.group,
        value: change.value,
        position: change.position,
      }
      model.set(value.id, value)
      return { type: current ? `update` : `insert`, value }
    })
    steps.push({ level: input.level, changes })
  }

  return { depth, steps }
}

function fullRowBatchScenarioArbitrary(
  allowChildRelationshipUpdates: boolean,
  levels: `all` | `children` = `all`,
  maxBatchSize = 3,
): fc.Arbitrary<FullRowBatchScenario> {
  return depthArbitrary.chain((depth) =>
    fc
      .array(fullRowBatchInputArbitrary(depth, levels, maxBatchSize), {
        minLength: 1,
        maxLength: 10,
      })
      .map((inputs) =>
        normalizeFullRowBatchInputs(
          depth,
          inputs,
          allowChildRelationshipUpdates,
        ),
      ),
  )
}

async function expectFullRowBatchScenarioMatches({
  depth,
  steps,
}: FullRowBatchScenario): Promise<void> {
  await runTrace({
    steps,
    driver: createFullRowBatchTraceDriver(depth),
    projection: structuralProjection,
  })
}

type FlatMaterialization = `array` | `concat`

function createFlatMaterializationQuery(
  materialization: FlatMaterialization,
  sources: Sources,
) {
  if (materialization === `array`) {
    return createLiveQueryCollection((q) =>
      q
        .from({ root: sources.roots.collection })
        .orderBy(({ root }) => root.position)
        .orderBy(({ root }) => root.id)
        .select(({ root }) => ({
          id: root.id,
          group: root.group,
          children: materialize(
            q
              .from({ child: sources.levels[0].collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({ id: child.id, value: child.value })),
          ),
        })),
    )
  }

  return createLiveQueryCollection((q) =>
    q
      .from({ root: sources.roots.collection })
      .orderBy(({ root }) => root.position)
      .orderBy(({ root }) => root.id)
      .select(({ root }) => ({
        id: root.id,
        group: root.group,
        content: concat(
          toArray(
            q
              .from({ child: sources.levels[0].collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .select(({ child }) => child.value),
          ),
        ),
      })),
  )
}

type FlatMaterializationContext = Omit<
  StructuralTraceContext,
  `incremental`
> & {
  incremental: ReturnType<typeof createFlatMaterializationQuery>
}

function createFlatMaterializationDriver(
  materialization: FlatMaterialization,
): TraceDriver<FullRowBatchStep, FlatMaterializationContext> {
  return {
    setup: () => {
      const sources = createSources(`full`)
      return {
        depth: 1,
        sources,
        incremental: createFlatMaterializationQuery(materialization, sources),
        roots: new Map<number, RootRow>(),
        levels: Array.from({ length: 4 }, () => new Map<number, ChildRow>()),
      }
    },
    start: ({ incremental }) => incremental.preload(),
    apply: (step, { sources, roots, levels }) => {
      if (step.level === 0) {
        sources.roots.writeBatch(step.changes)
        updateModel(roots, step.changes)
        return
      }

      if (step.level !== 1) {
        throw new Error(`Flat materialization only supports depth 1`)
      }
      sources.levels[0].writeBatch(step.changes)
      updateModel(levels[0]!, step.changes)
    },
    cleanup: cleanupStructuralTrace,
  }
}

type FlatMaterializationResult = Array<
  | {
      id: number
      group: number
      children: Array<{ id: number; value: number }>
    }
  | { id: number; group: number; content: string }
>

function recomputeFlatMaterialization(
  materialization: FlatMaterialization,
  roots: Map<number, RootRow>,
  children: Map<number, ChildRow>,
): FlatMaterializationResult {
  return [...roots.values()].sort(compareRows).map((root) => {
    const matching = [...children.values()]
      .filter((child) => child.parentGroup === root.group)
      .sort(compareRows)
    return materialization === `array`
      ? {
          id: root.id,
          group: root.group,
          children: matching.map(({ id, value }) => ({ id, value })),
        }
      : {
          id: root.id,
          group: root.group,
          content: matching.map(({ value }) => String(value)).join(``),
        }
  })
}

function flatMaterializationProjection(
  materialization: FlatMaterialization,
): TraceProjection<
  FlatMaterializationContext,
  unknown,
  FlatMaterializationResult
> {
  return {
    observe: ({ incremental }) => stripVirtualProperties(incremental.toArray),
    recompute: ({ roots, levels }) =>
      recomputeFlatMaterialization(materialization, roots, levels[0]!),
    assertEqual: (observed, expected) => {
      expect(observed).toEqual(expected)
      return undefined
    },
  }
}

const flatMaterializationScenarioArbitrary = fc
  .array(fullRowBatchInputArbitrary(1, `all`), {
    minLength: 1,
    maxLength: 12,
  })
  .map((inputs) => normalizeFullRowBatchInputs(1, inputs, false))

async function expectFlatMaterializationScenarioMatches(
  materialization: FlatMaterialization,
  scenario: FullRowBatchScenario,
): Promise<void> {
  await runTrace({
    steps: scenario.steps,
    driver: createFlatMaterializationDriver(materialization),
    projection: flatMaterializationProjection(materialization),
  })
}

const structuralProjection: TraceProjection<
  StructuralTraceContext,
  unknown,
  Array<OracleNode>
> = {
  observe: ({ incremental }) => stripVirtualProperties(incremental.toArray),
  recompute: ({ roots, levels, depth }) => recompute(roots, levels, depth),
  assertEqual: (observed, expected) => {
    expect(observed).toEqual(expected)
  },
}

async function expectScenarioMatches(scenario: Scenario): Promise<void> {
  await runTrace({
    steps: scenario.history,
    driver: createStructuralTraceDriver(scenario.depth),
    projection: structuralProjection,
  })
}

function createMaterializeSources() {
  return {
    roots: createControlledCollection<MaterializeRoot>(`materialize-roots`),
    middles:
      createControlledCollection<MaterializeMiddle>(`materialize-middles`),
    shared: createControlledCollection<MaterializeShared>(`materialize-shared`),
    leaves: createControlledCollection<MaterializeLeaf>(`materialize-leaves`),
  }
}

type MaterializeSources = ReturnType<typeof createMaterializeSources>

type MaterializeModels = {
  roots: Map<number, MaterializeRoot>
  middles: Map<number, MaterializeMiddle>
  shared: Map<number, MaterializeShared>
  leaves: Map<number, MaterializeLeaf>
}

type MaterializeTraceStep =
  | { type: `insert`; insert: MaterializeInsert }
  | { type: `incrementLeaf`; id: number }
  | { type: `redirectMiddle`; id: number; sharedId: number }

type MaterializeTraceContext = {
  sharedIntermediate: boolean
  sources: MaterializeSources
  live: ReturnType<typeof createMaterializeQuery>
  models: MaterializeModels
}

function createMaterializeQuery(sources: MaterializeSources) {
  return createLiveQueryCollection((q) =>
    q
      .from({ root: sources.roots.collection })
      .orderBy(({ root }) => root.id)
      .select(({ root }) => ({
        id: root.id,
        middle: materialize(
          q
            .from({ middle: sources.middles.collection })
            .where(({ middle }) => eq(middle.id, root.middleId))
            .select(({ middle }) => ({
              id: middle.id,
              sharedId: middle.sharedId,
              shared: materialize(
                q
                  .from({ shared: sources.shared.collection })
                  .where(({ shared }) => eq(shared.id, middle.sharedId))
                  .select(({ shared }) => ({
                    id: shared.id,
                    leafId: shared.leafId,
                    leaf: materialize(
                      q
                        .from({ leaf: sources.leaves.collection })
                        .where(({ leaf }) => eq(leaf.id, shared.leafId))
                        .select(({ leaf }) => ({
                          id: leaf.id,
                          value: leaf.value,
                        }))
                        .findOne(),
                    ),
                  }))
                  .findOne(),
              ),
            }))
            .findOne(),
        ),
      })),
  )
}

function recomputeMaterialize(
  roots: Map<number, MaterializeRoot>,
  middles: Map<number, MaterializeMiddle>,
  sharedRows: Map<number, MaterializeShared>,
  leaves: Map<number, MaterializeLeaf>,
): Array<MaterializeTree> {
  return [...roots.values()]
    .sort((left, right) => left.id - right.id)
    .map((root) => {
      const middle = middles.get(root.middleId)
      if (!middle) return { id: root.id, middle: undefined }

      const shared = sharedRows.get(middle.sharedId)
      return {
        id: root.id,
        middle: {
          id: middle.id,
          sharedId: middle.sharedId,
          shared: shared
            ? {
                id: shared.id,
                leafId: shared.leafId,
                leaf: leaves.get(shared.leafId),
              }
            : undefined,
        },
      }
    })
}

function insertMaterializeRow(
  insert: MaterializeInsert,
  sharedIntermediate: boolean,
  sources: MaterializeSources,
  models: MaterializeModels,
): void {
  switch (insert) {
    case `root-1`:
    case `root-2`: {
      const row = { id: insert === `root-1` ? 1 : 2, middleId: 1 }
      if (insert === `root-2`) row.middleId = 2
      sources.roots.write(`insert`, row)
      models.roots.set(row.id, row)
      return
    }
    case `middle-1`:
    case `middle-2`: {
      const id = insert === `middle-1` ? 1 : 2
      const row = { id, sharedId: sharedIntermediate ? 1 : id }
      sources.middles.write(`insert`, row)
      models.middles.set(row.id, row)
      return
    }
    case `shared-1`:
    case `shared-2`: {
      const id = insert === `shared-1` ? 1 : 2
      const row = { id, leafId: id }
      sources.shared.write(`insert`, row)
      models.shared.set(row.id, row)
      return
    }
    case `leaf-1`:
    case `leaf-2`: {
      const id = insert === `leaf-1` ? 1 : 2
      const row = { id, value: id * 10 }
      sources.leaves.write(`insert`, row)
      models.leaves.set(row.id, row)
    }
  }
}

async function cleanupMaterializeSources(sources: MaterializeSources) {
  await Promise.all(
    Object.values(sources).map(({ collection }) => collection.cleanup()),
  )
}

function createMaterializeTraceSteps(
  insertOrder: Array<MaterializeInsert>,
): Array<MaterializeTraceStep> {
  const steps: Array<MaterializeTraceStep> = insertOrder.map((insert) => ({
    type: `insert`,
    insert,
  }))

  for (const insert of insertOrder) {
    if (insert === `leaf-1` || insert === `leaf-2`) {
      steps.push({ type: `incrementLeaf`, id: insert === `leaf-1` ? 1 : 2 })
    }
  }

  return steps
}

function createMaterializeTraceDriver(
  scenarioSharedIntermediate: boolean,
): TraceDriver<MaterializeTraceStep, MaterializeTraceContext> {
  return {
    setup: () => {
      const sources = createMaterializeSources()
      return {
        sharedIntermediate: scenarioSharedIntermediate,
        sources,
        live: createMaterializeQuery(sources),
        models: {
          roots: new Map<number, MaterializeRoot>(),
          middles: new Map<number, MaterializeMiddle>(),
          shared: new Map<number, MaterializeShared>(),
          leaves: new Map<number, MaterializeLeaf>(),
        },
      }
    },
    start: ({ live }) => live.preload(),
    apply: (step, { models, sources, sharedIntermediate }) => {
      if (step.type === `insert`) {
        insertMaterializeRow(step.insert, sharedIntermediate, sources, models)
        return
      }

      if (step.type === `redirectMiddle`) {
        const middle = models.middles.get(step.id)
        if (!middle) throw new Error(`Missing middle ${step.id} in trace model`)
        const updated = { ...middle, sharedId: step.sharedId }
        sources.middles.write(`update`, updated)
        models.middles.set(updated.id, updated)
        return
      }

      const leaf = models.leaves.get(step.id)
      if (!leaf) throw new Error(`Missing leaf ${step.id} in trace model`)
      const updated = { ...leaf, value: leaf.value + 1 }
      sources.leaves.write(`update`, updated)
      models.leaves.set(updated.id, updated)
    },
    cleanup: async ({ live, sources }) => {
      await live.cleanup()
      await cleanupMaterializeSources(sources)
    },
  }
}

const materializeProjection: TraceProjection<
  MaterializeTraceContext,
  unknown,
  Array<MaterializeTree>
> = {
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: ({ models }) =>
    recomputeMaterialize(
      models.roots,
      models.middles,
      models.shared,
      models.leaves,
    ),
  assertEqual: (observed, expected) => {
    expect(observed).toEqual(expected)
  },
}

async function expectMaterializeScenarioMatches({
  sharedIntermediate,
  insertOrder,
}: MaterializeScenario): Promise<void> {
  await runTrace({
    steps: createMaterializeTraceSteps(insertOrder),
    driver: createMaterializeTraceDriver(sharedIntermediate),
    projection: materializeProjection,
  })
}

const intraBatchChildHandOffScenario: FullRowBatchScenario = {
  depth: 1,
  steps: [
    {
      level: 0,
      changes: [
        { type: `insert`, value: batchRoot(0, 1, 0, 0) },
        { type: `insert`, value: batchRoot(1, 3, 0, 0) },
      ],
    },
    {
      level: 1,
      changes: [
        { type: `insert`, value: batchChild(5, 3, 0, 0) },
        { type: `insert`, value: batchChild(1, 1, 0, 0) },
      ],
    },
    {
      level: 1,
      changes: [
        { type: `update`, value: batchChild(1, 0, 0, 0) },
        { type: `update`, value: batchChild(5, 1, 0, 0) },
      ],
    },
  ],
}

describe(`includes recompute oracle`, () => {
  for (const materialization of [`array`, `concat`] as const) {
    fcTest(
      `discovered trace: ${materialization} follows an intra-batch child hand-off`,
      expectAssertionFailure(async () => {
        await expectFlatMaterializationScenarioMatches(
          materialization,
          intraBatchChildHandOffScenario,
        )
      }),
    )
  }

  fcTest.prop(
    [
      fc.constantFrom<FlatMaterialization>(`array`, `concat`),
      flatMaterializationScenarioArbitrary,
    ],
    {
      numRuns: 30,
      seed: 1721,
    },
  )(`matches recomputation for flat materializations`, (kind, scenario) =>
    expectFlatMaterializationScenarioMatches(kind, scenario),
  )

  fcTest.prop([fullRowBatchScenarioArbitrary(false)], {
    numRuns: 40,
    seed: 1719,
  })(
    `matches recomputation for generated full-row batches at every depth`,
    expectFullRowBatchScenarioMatches,
  )

  fcTest.prop([fullRowBatchScenarioArbitrary(true, `children`, 1)], {
    numRuns: 40,
    seed: 1721,
  })(
    `matches recomputation for single-row child reparenting and rekeying`,
    expectFullRowBatchScenarioMatches,
  )

  fcTest(
    `discovered seed: nested scalar materialization follows a reference update`,
    expectAssertionFailure(async () => {
      await runTrace({
        steps: [
          { type: `insert`, insert: `root-1` },
          { type: `insert`, insert: `middle-1` },
          { type: `insert`, insert: `shared-1` },
          { type: `insert`, insert: `leaf-1` },
          { type: `redirectMiddle`, id: 1, sharedId: 2 },
        ],
        driver: createMaterializeTraceDriver(false),
        projection: materializeProjection,
      })
    }),
  )

  fcTest(`matches recomputation for full-row sync batches`, async () => {
    await runTrace({
      steps: fullRowBatchTrace,
      driver: createFullRowBatchTraceDriver(1),
      projection: structuralProjection,
    })
  })

  fcTest(
    `discovered seed: a reinserted parent drops its old shared route`,
    expectAssertionFailure(() =>
      expectFullRowBatchScenarioMatches(fullRowSharedRoutingSeed),
    ),
  )

  fcTest(`supports repeated optimistic rollbacks in one history`, async () => {
    await expectScenarioMatches({
      depth: 1,
      history: [
        {
          type: `put`,
          level: 0,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 0,
          position: 0,
        },
        {
          type: `put`,
          level: 1,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 0,
          position: 0,
        },
        {
          type: `optimisticRollback`,
          level: 1,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 1,
          position: 0,
        },
        {
          type: `optimisticRollback`,
          level: 1,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 2,
          position: 0,
        },
      ],
    })
  })

  fcTest.prop([scenarioArbitrary], { numRuns: 40 })(
    `matches naive recomputation after every incremental change`,
    expectScenarioMatches,
  )

  fcTest.prop(
    [
      materializeScenarioArbitrary.filter(
        ({ sharedIntermediate }) => !sharedIntermediate,
      ),
    ],
    { numRuns: 30 },
  )(
    `matches recomputation for nested scalar materialization`,
    expectMaterializeScenarioMatches,
  )

  fcTest.prop(
    [
      fc.uniqueArray(
        fc.record({
          id: fc.integer({ min: 0, max: 5 }),
          group: fc.integer({ min: 0, max: 2 }),
          value: fc.integer({ min: -3, max: 3 }),
          position: fc.integer({ min: -2, max: 2 }),
        }),
        { selector: (row) => row.id, minLength: 1, maxLength: 5 },
      ),
      fc.uniqueArray(
        fc.record({
          id: fc.integer({ min: 0, max: 7 }),
          parentGroup: fc.integer({ min: 0, max: 2 }),
          group: fc.integer({ min: 0, max: 2 }),
          value: fc.integer({ min: -3, max: 3 }),
          position: fc.integer({ min: -2, max: 2 }),
        }),
        { selector: (row) => row.id, maxLength: 7 },
      ),
    ],
    { numRuns: 25 },
  )(
    `is unchanged by alpha-renaming, sibling declaration order, or an unrelated sibling`,
    async (rootRows, childRows) => {
      const roots = createControlledCollection<RootRow>(
        `metamorphic-roots`,
        rootRows,
      )
      const children = createControlledCollection<ChildRow>(
        `metamorphic-children`,
        childRows,
      )
      const unrelated = createControlledCollection<ChildRow>(
        `metamorphic-unrelated`,
        childRows.map((row) => ({ ...row, id: row.id + 100 })),
      )

      try {
        const baseline = await queryOnce((q) =>
          q.from({ parent: roots.collection }).select(({ parent }) => ({
            id: parent.id,
            group: parent.group,
            children: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => ({ id: child.id, value: child.value })),
            ),
          })),
        )
        const renamed = await queryOnce((q) =>
          q.from({ r: roots.collection }).select(({ r }) => ({
            id: r.id,
            group: r.group,
            children: toArray(
              q
                .from({ c: children.collection })
                .where(({ c }) => eq(c.parentGroup, r.group))
                .orderBy(({ c }) => c.position)
                .orderBy(({ c }) => c.id)
                .select(({ c }) => ({ id: c.id, value: c.value })),
            ),
          })),
        )
        const withUnrelatedSibling = await queryOnce((q) =>
          q.from({ r: roots.collection }).select(({ r }) => ({
            unrelated: toArray(
              q
                .from({ u: unrelated.collection })
                .where(({ u }) => eq(u.parentGroup, r.group))
                .select(({ u }) => ({ id: u.id })),
            ),
            id: r.id,
            group: r.group,
            children: toArray(
              q
                .from({ c: children.collection })
                .where(({ c }) => eq(c.parentGroup, r.group))
                .orderBy(({ c }) => c.position)
                .orderBy(({ c }) => c.id)
                .select(({ c }) => ({ id: c.id, value: c.value })),
            ),
          })),
        )
        const withReorderedSiblings = await queryOnce((q) =>
          q.from({ r: roots.collection }).select(({ r }) => ({
            id: r.id,
            group: r.group,
            children: toArray(
              q
                .from({ c: children.collection })
                .where(({ c }) => eq(c.parentGroup, r.group))
                .orderBy(({ c }) => c.position)
                .orderBy(({ c }) => c.id)
                .select(({ c }) => ({ id: c.id, value: c.value })),
            ),
            unrelated: toArray(
              q
                .from({ u: unrelated.collection })
                .where(({ u }) => eq(u.parentGroup, r.group))
                .select(({ u }) => ({ id: u.id })),
            ),
          })),
        )

        expect(stripVirtualProperties(renamed)).toEqual(
          stripVirtualProperties(baseline),
        )
        expect(
          stripVirtualProperties(
            withUnrelatedSibling.map(
              ({ unrelated: _unrelated, ...row }) => row,
            ),
          ),
        ).toEqual(stripVirtualProperties(baseline))
        expect(stripVirtualProperties(withReorderedSiblings)).toEqual(
          stripVirtualProperties(withUnrelatedSibling),
        )
      } finally {
        await Promise.all([
          roots.collection.cleanup(),
          children.collection.cleanup(),
          unrelated.collection.cleanup(),
        ])
      }
    },
  )

  fcTest.prop(
    [fc.integer({ min: -5, max: 5 }).filter((value) => value !== 0)],
    { numRuns: 15 },
  )(
    `optimistic updates converge to confirmed-only state`,
    async (confirmedValue) => {
      const roots = createControlledCollection<RootRow>(`convergence-roots`, [
        { id: 1, group: 1, value: 0, position: 0 },
      ])
      const children = createControlledCollection<ChildRow>(
        `convergence-children`,
        [
          {
            id: 1,
            parentGroup: 1,
            group: 1,
            value: 0,
            position: 0,
          },
        ],
      )
      const live = createLiveQueryCollection((q) =>
        q.from({ root: roots.collection }).select(({ root }) => ({
          id: root.id,
          children: toArray(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .select(({ child }) => ({
                id: child.id,
                value: child.value,
              })),
          ),
        })),
      )

      try {
        await live.preload()
        const transaction = children.collection.update(1, (draft) => {
          draft.value = confirmedValue
        })
        expect(stripVirtualProperties(live.toArray)).toEqual([
          { id: 1, children: [{ id: 1, value: confirmedValue }] },
        ])

        children.write(`update`, {
          id: 1,
          parentGroup: 1,
          group: 1,
          value: confirmedValue,
          position: 0,
        })
        children.resolveSync()
        await transaction.isPersisted.promise

        expect(stripVirtualProperties(live.toArray)).toEqual([
          { id: 1, children: [{ id: 1, value: confirmedValue }] },
        ])
      } finally {
        await live.cleanup()
        await Promise.all([
          roots.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest.prop([fc.constant(confirmedChildReorderSeed)], {
    numRuns: 1,
    seed: 2051245230,
  })(
    `regression seed: confirmed child reorder matches recomputation`,
    expectScenarioMatches,
  )

  // These known failures must reject with the oracle's assertion mismatch.
  // A fixed bug or an unrelated runtime error makes the matching test fail.
  fcTest.prop([fc.constant(sharedMaterializeSeed)], {
    numRuns: 1,
    seed: 1685,
  })(
    `known seed: shared scalar materialization preserves the deepest row`,
    expectAssertionFailure(expectMaterializeScenarioMatches),
  )

  fcTest.prop([fc.constant(`correlation-key-update`)], {
    numRuns: 1,
    seed: 1658,
  })(
    `discovered seed: parent correlation-key update rematerializes children`,
    expectAssertionFailure(async () => {
      const roots = createControlledCollection<RootRow>(
        `correlation-seed-roots`,
      )
      const children = createControlledCollection<ChildRow>(
        `correlation-seed-children`,
      )
      const live = createLiveQueryCollection((q) =>
        q.from({ root: roots.collection }).select(({ root }) => ({
          id: root.id,
          group: root.group,
          children: toArray(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .select(({ child }) => ({ id: child.id })),
          ),
        })),
      )

      try {
        await live.preload()
        children.write(`insert`, {
          id: 1,
          parentGroup: 0,
          group: 0,
          value: 0,
          position: 0,
        })
        children.write(`insert`, {
          id: 2,
          parentGroup: 1,
          group: 0,
          value: 0,
          position: 0,
        })
        roots.write(`insert`, { id: 1, group: 1, value: 0, position: 0 })
        roots.write(`update`, { id: 1, group: 0, value: 0, position: 0 })

        expect(stripVirtualProperties(live.toArray)).toEqual([
          { id: 1, group: 0, children: [{ id: 1 }] },
        ])
      } finally {
        await live.cleanup()
        await Promise.all([
          roots.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    }),
  )

  fcTest.prop([fc.constant(`#1454`)], { numRuns: 1, seed: 1454 })(
    `known seed: alpha-renaming a duplicate sibling alias preserves results`,
    expectAssertionFailure(async () => {
      const roots = createControlledCollection<RootRow>(`alias-seed-roots`, [
        { id: 1, group: 1, value: 0, position: 0 },
      ])
      const issues = createControlledCollection<ChildRow>(`alias-seed-issues`, [
        {
          id: 10,
          parentGroup: 1,
          group: 10,
          value: 10,
          position: 0,
        },
      ])
      const tags = createControlledCollection<ChildRow>(`alias-seed-tags`, [
        {
          id: 20,
          parentGroup: 1,
          group: 20,
          value: 20,
          position: 0,
        },
      ])

      try {
        const uniqueAliases = await queryOnce((q) =>
          q.from({ root: roots.collection }).select(({ root }) => ({
            id: root.id,
            issues: toArray(
              q
                .from({ issue: issues.collection })
                .where(({ issue }) => eq(issue.parentGroup, root.group))
                .select(({ issue }) => ({ id: issue.id })),
            ),
            tags: toArray(
              q
                .from({ tag: tags.collection })
                .where(({ tag }) => eq(tag.parentGroup, root.group))
                .select(({ tag }) => ({ id: tag.id })),
            ),
          })),
        )
        const duplicateAliases = await queryOnce((q) =>
          q.from({ root: roots.collection }).select(({ root }) => ({
            id: root.id,
            issues: toArray(
              q
                .from({ item: issues.collection })
                .where(({ item }) => eq(item.parentGroup, root.group))
                .select(({ item }) => ({ id: item.id })),
            ),
            tags: toArray(
              q
                .from({ item: tags.collection })
                .where(({ item }) => eq(item.parentGroup, root.group))
                .select(({ item }) => ({ id: item.id })),
            ),
          })),
        )

        expect(stripVirtualProperties(duplicateAliases)).toEqual(
          stripVirtualProperties(uniqueAliases),
        )
      } finally {
        await Promise.all([
          roots.collection.cleanup(),
          issues.collection.cleanup(),
          tags.collection.cleanup(),
        ])
      }
    }),
  )

  fcTest.prop([fc.constant(`#1444`)], { numRuns: 1, seed: 1444 })(
    `regression seed: optimistic child reorder matches recomputation`,
    async () => {
      const roots = createControlledCollection<RootRow>(`order-seed-roots`, [
        { id: 1, group: 1, value: 0, position: 0 },
      ])
      const children = createControlledCollection<ChildRow>(
        `order-seed-children`,
        [
          {
            id: 1,
            parentGroup: 1,
            group: 1,
            value: 1,
            position: 0,
          },
          {
            id: 2,
            parentGroup: 1,
            group: 1,
            value: 2,
            position: 1,
          },
        ],
      )
      const live = createLiveQueryCollection((q) =>
        q.from({ root: roots.collection }).select(({ root }) => ({
          id: root.id,
          children: toArray(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .orderBy(({ child }) => child.position)
              .select(({ child }) => ({
                id: child.id,
                position: child.position,
              })),
          ),
        })),
      )

      try {
        await live.preload()
        children.collection.update([1, 2], (drafts) => {
          drafts[0]!.position = 1
          drafts[1]!.position = 0
        })

        expect(stripVirtualProperties(live.toArray)).toEqual([
          {
            id: 1,
            children: [
              { id: 2, position: 0 },
              { id: 1, position: 1 },
            ],
          },
        ])
      } finally {
        await live.cleanup()
        await Promise.all([
          roots.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )
})
