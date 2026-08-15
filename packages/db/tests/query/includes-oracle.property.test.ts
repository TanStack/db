import { isDeepStrictEqual } from 'node:util'
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
import { expectAssertionFailure } from '../expected-failure.js'
import { runTrace } from '../trace-runner.js'
import type { AssertionDifference } from '../expected-failure.js'
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

type RelationshipNode = {
  id: number
  value?: unknown
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

function findRelationshipNode(
  value: unknown,
  id: number,
): RelationshipNode | undefined {
  if (!Array.isArray(value)) return undefined

  for (const entry of value) {
    if (!isRelationshipNode(entry)) continue
    if (entry.id === id) return entry
    const nested = findRelationshipNode(entry.children, id)
    if (nested) return nested
  }
  return undefined
}

function hasDirectChild(value: unknown, parentId: number, childId: number) {
  const parent = findRelationshipNode(value, parentId)
  return (
    Array.isArray(parent?.children) &&
    parent.children.some(
      (child) => isRelationshipNode(child) && child.id === childId,
    )
  )
}

function classifyUnexpectedSharedRoute(
  { actual, expected }: AssertionDifference,
  unexpectedParentId: number,
  expectedParentId: number,
  childId: number,
): boolean {
  const expectedParent = findRelationshipNode(expected, expectedParentId)
  const expectedWithSharedRoute = replaceDirectChildren(
    expected,
    unexpectedParentId,
    Array.isArray(expectedParent?.children) ? expectedParent.children : [],
  )
  return (
    !hasDirectChild(expected, unexpectedParentId, childId) &&
    hasDirectChild(expected, expectedParentId, childId) &&
    isDeepStrictEqual(actual, expectedWithSharedRoute)
  )
}

function classifyMissingReplacementChild(
  { actual, expected }: AssertionDifference,
  replacementRowId: number,
  childId: number,
): boolean {
  const expectedWithoutChild = removeDirectChild(expected, replacementRowId, [
    childId,
  ])
  return (
    findRelationshipNode(expected, replacementRowId) !== undefined &&
    hasDirectChild(expected, replacementRowId, childId) &&
    isDeepStrictEqual(actual, expectedWithoutChild)
  )
}

function classifyMissingSharedRouteSnapshot(
  { actual, expected }: AssertionDifference,
  enteringParentId: number,
  existingParentId: number,
  childIds: number | ReadonlyArray<number>,
): boolean {
  const expectedChildIds = Array.isArray(childIds) ? childIds : [childIds]
  const expectedWithoutSnapshot = removeDirectChild(
    expected,
    enteringParentId,
    expectedChildIds,
  )
  return (
    expectedChildIds.every(
      (childId) =>
        hasDirectChild(expected, enteringParentId, childId) &&
        hasDirectChild(actual, existingParentId, childId) &&
        hasDirectChild(expected, existingParentId, childId),
    ) && isDeepStrictEqual(actual, expectedWithoutSnapshot)
  )
}

function removeDirectChild(
  value: unknown,
  parentId: number,
  childIds: ReadonlyArray<number>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => removeDirectChild(entry, parentId, childIds))
  }
  if (typeof value !== `object` || value === null) return value

  const isParent = isRelationshipNode(value) && value.id === parentId
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === `children` && isParent && Array.isArray(entry)
        ? entry
            .filter(
              (child) =>
                !isRelationshipNode(child) || !childIds.includes(child.id),
            )
            .map((child) => removeDirectChild(child, parentId, childIds))
        : removeDirectChild(entry, parentId, childIds),
    ]),
  )
}

function replaceDirectChildren(
  value: unknown,
  parentId: number,
  children: ReadonlyArray<unknown>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceDirectChildren(entry, parentId, children),
    )
  }
  if (typeof value !== `object` || value === null) return value

  const isParent = isRelationshipNode(value) && value.id === parentId
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === `children` && isParent
        ? children
        : replaceDirectChildren(entry, parentId, children),
    ]),
  )
}

type RelationshipProjectionNode = {
  id: number
  children?: Array<RelationshipProjectionNode>
}

function relationshipOnly(
  nodes: ReadonlyArray<OracleNode>,
): Array<RelationshipProjectionNode> {
  return nodes.map(({ id, children }) => ({
    id,
    ...(children ? { children: relationshipOnly(children) } : {}),
  }))
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
  return levelArbitrary(depth).chain((level) =>
    fc.record({
      // Root delete/reinsert has a deterministic expected-failure trace below.
      // Keep the green fuzz corpus from rediscovering the same defect class.
      type:
        level === 0
          ? fc.constantFrom(
              `put` as const,
              `optimisticConfirm` as const,
              `optimisticRollback` as const,
            )
          : fc.constantFrom(
              `put` as const,
              `delete` as const,
              `optimisticConfirm` as const,
              `optimisticRollback` as const,
            ),
      level: fc.constant(level),
      id: fc.integer({ min: 0, max: 5 }),
      parentGroup: fc.integer({ min: 0, max: 2 }),
      group: fc.integer({ min: 0, max: 2 }),
      value: fc.integer({ min: -3, max: 3 }),
      position: fc.integer({ min: -2, max: 2 }),
    }),
  )
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

function updateFullRowBatchModels(
  step: FullRowBatchStep,
  roots: Map<number, RootRow>,
  levels: Array<Map<number, ChildRow>>,
): void {
  if (step.level === 0) {
    updateModel(roots, step.changes)
  } else {
    updateModel(levels[step.level - 1]!, step.changes)
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
      } else {
        sources.levels[step.level - 1]!.writeBatch(step.changes)
      }
      updateFullRowBatchModels(step, roots, levels)
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

type ConnectedBranch = {
  idBase: number
  groupBase: number
}

function createConnectedBatchBranches(
  depth: IncludeDepth,
  branches: ReadonlyArray<ConnectedBranch> = [
    { idBase: 100, groupBase: 100 },
    { idBase: 200, groupBase: 200 },
  ],
): Array<FullRowBatchStep> {
  const steps: Array<FullRowBatchStep> = [
    {
      level: 0,
      changes: branches.map(({ idBase, groupBase }) => ({
        type: `insert`,
        value: batchRoot(idBase, groupBase, idBase, 0),
      })),
    },
  ]

  for (let level = 1; level <= depth; level++) {
    steps.push({
      level: level as IncludeDepth,
      changes: branches.map(({ idBase, groupBase }) => ({
        type: `insert`,
        value: {
          ...batchChild(
            idBase + level,
            groupBase + level - 1,
            idBase + level,
            0,
          ),
          group: groupBase + level,
        },
      })),
    })
  }

  return steps
}

function normalizeFullRowBatchInputs(
  depth: IncludeDepth,
  inputs: Array<FullRowBatchInput>,
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
        parentGroup: current ? current.parentGroup : change.parentGroup,
        group: current ? current.group : change.group,
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

function fullRowBatchScenarioAtDepthArbitrary(
  depth: IncludeDepth,
): fc.Arbitrary<FullRowBatchScenario> {
  return fc
    .array(fullRowBatchInputArbitrary(depth, `all`), {
      minLength: 1,
      maxLength: 10,
    })
    .map((inputs) => {
      const noise = normalizeFullRowBatchInputs(depth, inputs).steps.slice(
        depth + 1,
      )
      const changes: Array<SyncChange<ChildRow>> = [100, 200].map((rootId) => ({
        type: `update`,
        value: {
          ...batchChild(
            rootId + depth,
            rootId + depth - 1,
            rootId + depth + 1,
            0,
          ),
          group: rootId + depth,
        },
      }))

      return {
        depth,
        steps: [
          ...createConnectedBatchBranches(depth),
          ...noise,
          { level: depth, changes },
        ],
      }
    })
}

type VisibleRelationshipTransition = `reparent` | `rekey`
type BranchDeliveryOrder = `forward` | `reverse`
const branchDeliveryOrders: ReadonlyArray<BranchDeliveryOrder> = [
  `forward`,
  `reverse`,
]

function otherBranch(branch: 0 | 1): 0 | 1 {
  return branch === 0 ? 1 : 0
}

function deliverBranches(
  branches: readonly [ConnectedBranch, ConnectedBranch],
  order: BranchDeliveryOrder,
): readonly [ConnectedBranch, ConnectedBranch] {
  return order === `forward` ? branches : [branches[1], branches[0]]
}

function deliveredBranchIndex(
  branch: 0 | 1,
  order: BranchDeliveryOrder,
): 0 | 1 {
  return order === `forward` ? branch : otherBranch(branch)
}

type VisibleRelationshipScenario = FullRowBatchScenario & {
  transitionStepIndex: number
}

type VisibleRelationshipScenarios = {
  transitionOnly: VisibleRelationshipScenario
  stateful: VisibleRelationshipScenario
}

type VisibleScalarNoise = {
  side: `before` | `after`
  level: 0 | IncludeDepth
  branch: 0 | 1
  value: number
  position: number
}

type VisibleRelationshipScenarioOptions = {
  depth: IncludeDepth
  targetLevel: IncludeDepth
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  noise: ReadonlyArray<VisibleScalarNoise>
} & (
  | { transition: `reparent`; rekeyGroup?: never }
  | { transition: `rekey`; rekeyGroup: number }
)

function assertDisjointRelationshipKeys(
  depth: IncludeDepth,
  branches: readonly [ConnectedBranch, ConnectedBranch],
  {
    extraIds = [],
    extraGroups = [],
  }: {
    extraIds?: ReadonlyArray<number>
    extraGroups?: ReadonlyArray<number>
  } = {},
): void {
  const ids = [
    ...branches.flatMap(({ idBase }) =>
      Array.from({ length: depth + 1 }, (_, level) => idBase + level),
    ),
    ...extraIds,
  ]
  const groups = [
    ...branches.flatMap(({ groupBase }) =>
      Array.from({ length: depth + 1 }, (_, level) => groupBase + level),
    ),
    ...extraGroups,
  ]
  if (
    new Set(ids).size !== ids.length ||
    new Set(groups).size !== groups.length
  ) {
    throw new Error(`Visible relationship keys overlap`)
  }
}

function createVisibleRelationshipScenario(
  options: VisibleRelationshipScenarioOptions,
): VisibleRelationshipScenario {
  const { depth, transition, targetLevel, sourceBranch, branches, noise } =
    options
  assertDisjointRelationshipKeys(
    depth,
    branches,
    transition === `rekey` ? { extraGroups: [options.rekeyGroup] } : {},
  )
  const steps = createConnectedBatchBranches(depth, branches)
  const roots = new Map<number, RootRow>()
  const levels = Array.from({ length: 4 }, () => new Map<number, ChildRow>())

  for (const step of steps) {
    updateFullRowBatchModels(step, roots, levels)
  }

  const appendNoise = (entry: VisibleScalarNoise): void => {
    const branch = branches[entry.branch]
    if (entry.level === 0) {
      const current = roots.get(branch.idBase)!
      const value = {
        ...current,
        value: entry.value,
        position: entry.position,
      }
      roots.set(value.id, value)
      steps.push({ level: 0, changes: [{ type: `update`, value }] })
      return
    }

    const model = levels[entry.level - 1]!
    const current = model.get(branch.idBase + entry.level)!
    const value = {
      ...current,
      value: entry.value,
      position: entry.position,
    }
    model.set(value.id, value)
    steps.push({
      level: entry.level,
      changes: [{ type: `update`, value }],
    })
  }

  for (const entry of noise.filter(({ side }) => side === `before`)) {
    appendNoise(entry)
  }

  const source = branches[sourceBranch]
  const destination = branches[otherBranch(sourceBranch)]
  const targetModel = levels[targetLevel - 1]!
  const current = targetModel.get(source.idBase + targetLevel)!
  const value: ChildRow = {
    ...current,
    parentGroup:
      transition === `reparent`
        ? destination.groupBase + targetLevel - 1
        : current.parentGroup,
    group: transition === `rekey` ? options.rekeyGroup : current.group,
  }
  const transitionStepIndex = steps.length
  steps.push({
    level: targetLevel,
    changes: [{ type: `update`, value }],
  })
  targetModel.set(value.id, value)

  for (const entry of noise.filter(({ side }) => side === `after`)) {
    appendNoise(entry)
  }

  return {
    depth,
    steps,
    transitionStepIndex,
  }
}

function visibleRelationshipScenarioArbitrary(
  depth: IncludeDepth,
  transition: VisibleRelationshipTransition,
  targetLevel: IncludeDepth,
): fc.Arbitrary<VisibleRelationshipScenarios> {
  const branchArbitrary = fc.constantFrom<0 | 1>(0, 1)
  const scalarNoiseArbitrary = (
    side: VisibleScalarNoise[`side`],
    branch: fc.Arbitrary<0 | 1>,
  ): fc.Arbitrary<VisibleScalarNoise> =>
    fc.record({
      side: fc.constant(side),
      level: levelArbitrary(depth),
      branch,
      value: fc.integer({ min: -3, max: 3 }),
      position: fc.integer({ min: -2, max: 2 }),
    })

  return fc
    .record({
      sourceBranch: branchArbitrary,
      leftIdBase: fc.integer({ min: 100, max: 500 }),
      leftGroupBase: fc.integer({ min: 600, max: 1_000 }),
      rightIdBase: fc.integer({ min: 1_100, max: 1_500 }),
      rightGroupBase: fc.integer({ min: 1_600, max: 2_000 }),
      rekeyGroup: fc.integer({ min: 2_100, max: 2_500 }),
      beforeNoise: scalarNoiseArbitrary(`before`, branchArbitrary),
      extraBeforeNoise: fc.array(
        scalarNoiseArbitrary(`before`, branchArbitrary),
        { maxLength: 4 },
      ),
      afterValues: fc.array(
        fc.record({
          level: levelArbitrary(depth),
          value: fc.integer({ min: -3, max: 3 }),
          position: fc.integer({ min: -2, max: 2 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    })
    .map(
      ({
        sourceBranch,
        leftIdBase,
        leftGroupBase,
        rightIdBase,
        rightGroupBase,
        rekeyGroup,
        beforeNoise,
        extraBeforeNoise,
        afterValues,
      }) => {
        const stableBranch = otherBranch(sourceBranch)
        // Updating two descendant levels after a reparent exposes a separate
        // known defect, captured for every failing depth/level below. Keep the
        // generated corpus green by updating only the branch that did not move.
        const connectedNoise: Array<VisibleScalarNoise> = [
          beforeNoise,
          ...extraBeforeNoise,
          ...afterValues.map((entry) => ({
            ...entry,
            side: `after` as const,
            branch: stableBranch,
          })),
        ]
        const options = {
          depth,
          targetLevel,
          sourceBranch,
          branches: [
            { idBase: leftIdBase, groupBase: leftGroupBase },
            { idBase: rightIdBase, groupBase: rightGroupBase },
          ],
          ...(transition === `rekey`
            ? { transition, rekeyGroup }
            : { transition }),
        } satisfies Omit<VisibleRelationshipScenarioOptions, `noise`>

        return {
          transitionOnly: createVisibleRelationshipScenario({
            ...options,
            noise: [],
          }),
          stateful: createVisibleRelationshipScenario({
            ...options,
            noise: connectedNoise,
          }),
        }
      },
    )
}

type GeneratedBranchOptions = {
  leftIdBase: number
  leftGroupBase: number
  rightIdBase: number
  rightGroupBase: number
}

const generatedBranchArbitraries = {
  leftIdBase: fc.integer({ min: 100, max: 500 }),
  leftGroupBase: fc.integer({ min: 600, max: 1_000 }),
  rightIdBase: fc.integer({ min: 1_100, max: 1_500 }),
  rightGroupBase: fc.integer({ min: 1_600, max: 2_000 }),
}

function createGeneratedBranches({
  leftIdBase,
  leftGroupBase,
  rightIdBase,
  rightGroupBase,
}: GeneratedBranchOptions): readonly [ConnectedBranch, ConnectedBranch] {
  return [
    { idBase: leftIdBase, groupBase: leftGroupBase },
    { idBase: rightIdBase, groupBase: rightGroupBase },
  ]
}

type TransitionHistoryScenario = FullRowBatchScenario & {
  historyStartStepIndex: number
}

type TransitionHistoryScenarioOptions = {
  depth: IncludeDepth
  targetLevel: IncludeDepth
  firstTransition: VisibleRelationshipTransition
  secondTransition: VisibleRelationshipTransition
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  rekeyGroups: readonly [number, number]
  insertedLevels: readonly [IncludeDepth, IncludeDepth]
  insertedValues: readonly [number, number]
  insertedPositions: readonly [number, number]
}

function createTransitionHistoryScenario({
  depth,
  targetLevel,
  firstTransition,
  secondTransition,
  sourceBranch,
  branches,
  rekeyGroups,
  insertedLevels,
  insertedValues,
  insertedPositions,
}: TransitionHistoryScenarioOptions): TransitionHistoryScenario {
  // Fresh keys keep this matrix green through both transitions. Separate
  // state-aware families below reuse retired routes and replace existing rows,
  // so those known failures remain shrinkable without masking later steps.
  const insertedRows = [
    {
      id: 3_000,
      group: 2_700,
      value: insertedValues[0],
      position: insertedPositions[0],
    },
    {
      id: 3_001,
      group: 2_800,
      value: insertedValues[1],
      position: insertedPositions[1],
    },
  ] as const
  assertDisjointRelationshipKeys(depth, branches, {
    extraIds: insertedRows.map(({ id }) => id),
    extraGroups: [...rekeyGroups, ...insertedRows.map(({ group }) => group)],
  })

  const steps = createConnectedBatchBranches(depth, branches)
  const historyStartStepIndex = steps.length
  const source = branches[sourceBranch]
  let current = {
    ...batchChild(
      source.idBase + targetLevel,
      source.groupBase + targetLevel - 1,
      source.idBase + targetLevel,
      0,
    ),
    group: source.groupBase + targetLevel,
  }
  const appendStep = (
    level: IncludeDepth,
    changes: Array<SyncChange<ChildRow>>,
  ): void => {
    steps.push({ level, changes })
  }
  const insertRow = (
    row: (typeof insertedRows)[number],
    level: IncludeDepth,
  ): ChildRow => {
    if (level !== targetLevel && level !== targetLevel + 1) {
      throw new Error(`History inserts must touch the target or its child`)
    }
    return {
      ...row,
      parentGroup: level === targetLevel ? current.parentGroup : current.group,
    }
  }
  const transition = (
    kind: VisibleRelationshipTransition,
    rekeyGroup: number,
  ): void => {
    const currentParentBranch = branches.findIndex(
      ({ groupBase }) => current.parentGroup === groupBase + targetLevel - 1,
    )
    if (currentParentBranch !== 0 && currentParentBranch !== 1) {
      throw new Error(`Transition target has no visible parent branch`)
    }
    const destination = branches[otherBranch(currentParentBranch)]
    current = {
      ...current,
      parentGroup:
        kind === `reparent`
          ? destination.groupBase + targetLevel - 1
          : current.parentGroup,
      group: kind === `rekey` ? rekeyGroup : current.group,
    }
    appendStep(targetLevel, [{ type: `update`, value: current }])
  }
  const interleaveTransition = (
    kind: VisibleRelationshipTransition,
    rekeyGroup: number,
    row: (typeof insertedRows)[number],
    level: IncludeDepth,
  ): void => {
    if (kind === `rekey`) {
      if (level !== targetLevel + 1) {
        throw new Error(`Rekey histories must seed the new child route`)
      }
      transition(kind, rekeyGroup)
      appendStep(level, [{ type: `insert`, value: insertRow(row, level) }])
      return
    }

    const inserted = insertRow(row, level)
    appendStep(level, [{ type: `insert`, value: inserted }])
    transition(kind, rekeyGroup)
    appendStep(level, [{ type: `delete`, value: inserted }])
  }

  interleaveTransition(
    firstTransition,
    rekeyGroups[0],
    insertedRows[0],
    insertedLevels[0],
  )
  interleaveTransition(
    secondTransition,
    rekeyGroups[1],
    insertedRows[1],
    insertedLevels[1],
  )

  return {
    depth,
    steps,
    historyStartStepIndex,
  }
}

function transitionHistoryPlacements(
  depth: IncludeDepth,
  firstTransition: VisibleRelationshipTransition,
  secondTransition: VisibleRelationshipTransition,
): Array<{
  targetLevel: IncludeDepth
  insertedLevels: readonly [IncludeDepth, IncludeDepth]
}> {
  // A rekey needs one child level so it changes relationship membership. It
  // also fails when two descendant levels remain. The single-transition matrix
  // pins that failure and will turn red when this continuation can be widened.
  const minimumTargetLevel =
    firstTransition === `rekey` || secondTransition === `rekey`
      ? Math.max(1, depth - 1)
      : 1
  const maximumTargetLevel =
    firstTransition === `rekey` || secondTransition === `rekey`
      ? depth - 1
      : depth
  const placements: Array<{
    targetLevel: IncludeDepth
    insertedLevels: readonly [IncludeDepth, IncludeDepth]
  }> = []

  for (let level = minimumTargetLevel; level <= maximumTargetLevel; level++) {
    const targetLevel = level as IncludeDepth
    const insertedLevels = (
      transition: VisibleRelationshipTransition,
    ): ReadonlyArray<IncludeDepth> =>
      transition === `rekey`
        ? [(targetLevel + 1) as IncludeDepth]
        : targetLevel < depth
          ? [targetLevel, (targetLevel + 1) as IncludeDepth]
          : [targetLevel]

    for (const firstInsertedLevel of insertedLevels(firstTransition)) {
      for (const secondInsertedLevel of insertedLevels(secondTransition)) {
        placements.push({
          targetLevel,
          insertedLevels: [firstInsertedLevel, secondInsertedLevel],
        })
      }
    }
  }

  return placements
}

function transitionHistoryScenariosArbitrary(
  depth: IncludeDepth,
  firstTransition: VisibleRelationshipTransition,
  secondTransition: VisibleRelationshipTransition,
  sourceBranch: 0 | 1,
): fc.Arbitrary<ReadonlyArray<TransitionHistoryScenario>> {
  const placements = transitionHistoryPlacements(
    depth,
    firstTransition,
    secondTransition,
  )

  return fc
    .record({
      ...generatedBranchArbitraries,
      firstRekeyGroup: fc.integer({ min: 2_100, max: 2_300 }),
      secondRekeyGroup: fc.integer({ min: 2_400, max: 2_600 }),
      firstInsertedValue: fc.integer({ min: -3, max: 3 }),
      secondInsertedValue: fc.integer({ min: -3, max: 3 }),
      firstInsertedPosition: fc.integer({ min: -2, max: 2 }),
      secondInsertedPosition: fc.integer({ min: -2, max: 2 }),
    })
    .map(
      ({
        leftIdBase,
        leftGroupBase,
        rightIdBase,
        rightGroupBase,
        firstRekeyGroup,
        secondRekeyGroup,
        firstInsertedValue,
        secondInsertedValue,
        firstInsertedPosition,
        secondInsertedPosition,
      }) =>
        placements.map(({ targetLevel, insertedLevels }) =>
          createTransitionHistoryScenario({
            depth,
            targetLevel,
            firstTransition,
            secondTransition,
            sourceBranch,
            branches: createGeneratedBranches({
              leftIdBase,
              leftGroupBase,
              rightIdBase,
              rightGroupBase,
            }),
            rekeyGroups: [firstRekeyGroup, secondRekeyGroup],
            insertedLevels,
            insertedValues: [firstInsertedValue, secondInsertedValue],
            insertedPositions: [firstInsertedPosition, secondInsertedPosition],
          }),
        ),
    )
}

function expectEveryHistoryStepVisible(
  scenario: TransitionHistoryScenario,
): void {
  for (
    let stepIndex = scenario.historyStartStepIndex;
    stepIndex < scenario.steps.length;
    stepIndex++
  ) {
    const before = relationshipOnly(
      recomputeFullRowBatchScenario(scenario, stepIndex),
    )
    const after = relationshipOnly(
      recomputeFullRowBatchScenario(scenario, stepIndex + 1),
    )
    expect(after).not.toEqual(before)
  }
}

type RouteDestination = {
  strategy: `fresh` | `restore` | `merge` | `split` | `retired`
  route: number
}

type RouteTransitionDescriptor = {
  row: 0 | 1
  stepsBefore?: ReadonlyArray<FullRowBatchStep>
} & (
  | {
      kind: `reparent`
      level: IncludeDepth
      destination: { strategy: `merge`; route: number }
    }
  | {
      kind: `rekey`
      level: 0 | IncludeDepth
      destination: RouteDestination
    }
)

type RouteLifecycleScenario = FullRowBatchScenario & {
  transitionStepIndexes: ReadonlyArray<number>
}

type RouteLifecycleScenarioOptions = {
  depth: IncludeDepth
  branches: readonly [ConnectedBranch, ConnectedBranch]
  descriptors: ReadonlyArray<RouteTransitionDescriptor>
  prefixSteps?: ReadonlyArray<FullRowBatchStep>
  trailingSteps?: ReadonlyArray<FullRowBatchStep>
}

function rowAt(
  branches: readonly [ConnectedBranch, ConnectedBranch],
  row: 0 | 1,
  level: 0 | IncludeDepth,
): number {
  return branches[row].idBase + level
}

function applyRouteLifecycleStep(
  step: FullRowBatchStep,
  roots: Map<number, RootRow>,
  levels: Array<Map<number, ChildRow>>,
  seenRoutes: Set<string>,
  retiredRouteOwners: Map<string, number>,
): void {
  const rows = step.level === 0 ? roots : levels[step.level - 1]!
  const previousRouteOwners = new Map<number, Set<number>>()

  for (const change of step.changes) {
    const previous = rows.get(change.value.id)
    if (!previous) continue
    const owners = previousRouteOwners.get(previous.group) ?? new Set<number>()
    owners.add(previous.id)
    previousRouteOwners.set(previous.group, owners)
  }

  updateFullRowBatchModels(step, roots, levels)

  for (const row of rows.values()) {
    const route = routeIdentity(step.level, row.group)
    seenRoutes.add(route)
    retiredRouteOwners.delete(route)
  }
  for (const [route, previousOwners] of previousRouteOwners) {
    if ([...rows.values()].some((row) => row.group === route)) continue
    const retiredRoute = routeIdentity(step.level, route)
    if (previousOwners.size === 1) {
      retiredRouteOwners.set(retiredRoute, [...previousOwners][0]!)
    } else {
      retiredRouteOwners.delete(retiredRoute)
    }
  }
}

function routeIdentity(level: 0 | IncludeDepth, route: number): string {
  // This oracle has one include edge per level, so level plus correlation value
  // is the complete route identity. Equal values at different levels are not
  // the same subscription lifecycle.
  return `${level}:${route}`
}

function createRouteLifecycleScenario({
  depth,
  branches,
  descriptors,
  prefixSteps = createConnectedBatchBranches(depth, branches),
  trailingSteps = [],
}: RouteLifecycleScenarioOptions): RouteLifecycleScenario {
  const seenRoutes = new Set<string>()
  const retiredRouteOwners = new Map<string, number>()

  const steps = [...prefixSteps]
  const roots = new Map<number, RootRow>()
  const levels = Array.from({ length: 4 }, () => new Map<number, ChildRow>())
  for (const step of steps) {
    applyRouteLifecycleStep(step, roots, levels, seenRoutes, retiredRouteOwners)
  }

  const transitionStepIndexes: Array<number> = []
  for (const descriptor of descriptors) {
    const destination = descriptor.destination as RouteDestination
    if (descriptor.kind === `reparent` && destination.strategy !== `merge`) {
      throw new Error(
        `reparent transitions only support live merge destinations`,
      )
    }
    for (const step of descriptor.stepsBefore ?? []) {
      steps.push(step)
      applyRouteLifecycleStep(
        step,
        roots,
        levels,
        seenRoutes,
        retiredRouteOwners,
      )
    }

    const id = rowAt(branches, descriptor.row, descriptor.level)
    const rowsAtLevel =
      descriptor.level === 0
        ? [...roots.values()]
        : [...levels[descriptor.level - 1]!.values()]
    const current = rowsAtLevel.find((row) => row.id === id)
    if (!current) throw new Error(`Missing transition row ${id}`)
    const currentRoute =
      descriptor.kind === `rekey`
        ? current.group
        : (current as ChildRow).parentGroup
    const destinationRows =
      descriptor.kind === `rekey`
        ? rowsAtLevel
        : descriptor.level === 1
          ? [...roots.values()]
          : [...levels[descriptor.level - 2]!.values()]
    const destinationIsLive = destinationRows.some(
      (row) => row.group === descriptor.destination.route,
    )
    const currentRouteUsers = rowsAtLevel.filter((row) =>
      descriptor.kind === `rekey`
        ? row.group === currentRoute
        : (row as ChildRow).parentGroup === currentRoute,
    ).length
    const destinationRoute = routeIdentity(
      descriptor.level,
      descriptor.destination.route,
    )
    const retiredOwner = retiredRouteOwners.get(destinationRoute)

    switch (descriptor.destination.strategy) {
      case `fresh`:
        if (seenRoutes.has(destinationRoute)) {
          throw new Error(`fresh route must never have been used`)
        }
        break
      case `restore`:
        if (destinationIsLive || retiredOwner !== id) {
          throw new Error(`restore route must have been retired by this row`)
        }
        break
      case `merge`:
        if (
          !destinationIsLive ||
          descriptor.destination.route === currentRoute
        ) {
          throw new Error(`merge route must be live and different`)
        }
        break
      case `split`:
        if (seenRoutes.has(destinationRoute)) {
          throw new Error(`split destination must be unused`)
        }
        if (currentRouteUsers < 2) {
          throw new Error(`split source route must be shared`)
        }
        break
      case `retired`:
        if (
          destinationIsLive ||
          retiredOwner === undefined ||
          retiredOwner === id
        ) {
          throw new Error(`retired route must have been retired by another row`)
        }
        break
    }

    let step: FullRowBatchStep
    if (descriptor.level === 0) {
      const root = roots.get(id)
      if (!root) throw new Error(`Missing transition root ${id}`)
      step = {
        level: 0,
        changes: [
          {
            type: `update`,
            value: { ...root, group: descriptor.destination.route },
          },
        ],
      }
    } else {
      const child = levels[descriptor.level - 1]!.get(id)
      if (!child) throw new Error(`Missing transition child ${id}`)
      step = {
        level: descriptor.level,
        changes: [
          {
            type: `update`,
            value:
              descriptor.kind === `rekey`
                ? { ...child, group: descriptor.destination.route }
                : {
                    ...child,
                    parentGroup: descriptor.destination.route,
                  },
          },
        ],
      }
    }
    transitionStepIndexes.push(steps.length)
    steps.push(step)
    applyRouteLifecycleStep(step, roots, levels, seenRoutes, retiredRouteOwners)
  }

  steps.push(...trailingSteps)
  return { depth, steps, transitionStepIndexes }
}

function expectEveryRouteTransitionVisible(
  scenario: RouteLifecycleScenario,
): void {
  for (const stepIndex of scenario.transitionStepIndexes) {
    const before = relationshipOnly(
      recomputeFullRowBatchScenario(scenario, stepIndex),
    )
    const after = relationshipOnly(
      recomputeFullRowBatchScenario(scenario, stepIndex + 1),
    )
    expect(after).not.toEqual(before)
  }
}

const independentTransitionShapes = [
  `ancestor-descendant`,
  `descendant-ancestor`,
  `sibling`,
  `cross-branch`,
  `root`,
] as const

type IndependentTransitionShape = (typeof independentTransitionShapes)[number]

function independentFreshRoutesArbitrary(
  shape: IndependentTransitionShape,
): fc.Arbitrary<readonly [number, number]> {
  const first = fc.integer({ min: 2_100, max: 2_400 })
  if (shape === `sibling`) {
    return fc.tuple(first, fc.integer({ min: 2_500, max: 2_800 }))
  }
  if (shape === `ancestor-descendant` || shape === `root`) {
    return first.map((route) => [route, 2_500] as const)
  }
  return fc.constant([2_100, 2_500] as const)
}

function independentTransitionDescriptors(
  shape: IndependentTransitionShape,
  branches: readonly [ConnectedBranch, ConnectedBranch],
  freshRoutes: readonly [number, number],
): ReadonlyArray<RouteTransitionDescriptor> {
  switch (shape) {
    case `ancestor-descendant`:
      return [
        {
          kind: `reparent`,
          level: 1,
          row: 0,
          destination: {
            strategy: `merge`,
            route: branches[1].groupBase,
          },
        },
        {
          kind: `rekey`,
          level: 2,
          row: 0,
          destination: { strategy: `fresh`, route: freshRoutes[0] },
        },
      ]
    case `descendant-ancestor`:
      return [
        {
          kind: `rekey`,
          level: 2,
          row: 0,
          destination: { strategy: `fresh`, route: freshRoutes[0] },
        },
        {
          kind: `reparent`,
          level: 1,
          row: 0,
          destination: {
            strategy: `merge`,
            route: branches[1].groupBase,
          },
        },
      ]
    case `sibling`:
      return [
        {
          kind: `rekey`,
          level: 2,
          row: 0,
          destination: { strategy: `fresh`, route: freshRoutes[0] },
        },
        {
          kind: `rekey`,
          level: 2,
          row: 1,
          destination: { strategy: `fresh`, route: freshRoutes[1] },
        },
      ]
    case `cross-branch`:
      return [
        {
          kind: `reparent`,
          level: 2,
          row: 0,
          destination: {
            strategy: `merge`,
            route: branches[1].groupBase + 1,
          },
        },
        {
          kind: `reparent`,
          level: 2,
          row: 1,
          destination: {
            strategy: `merge`,
            route: branches[0].groupBase + 1,
          },
        },
      ]
    case `root`:
      return [
        {
          kind: `rekey`,
          level: 0,
          row: 0,
          destination: { strategy: `fresh`, route: freshRoutes[0] },
        },
        {
          kind: `reparent`,
          level: 1,
          row: 1,
          destination: { strategy: `merge`, route: freshRoutes[0] },
        },
      ]
  }
}

function independentTransitionPrefix(
  shape: IndependentTransitionShape,
  branches: readonly [ConnectedBranch, ConnectedBranch],
): Array<FullRowBatchStep> {
  const prefix = createConnectedBatchBranches(3, branches)
  if (shape !== `sibling`) return prefix

  const secondSiblingId = rowAt(branches, 1, 2)
  return prefix.map((step) =>
    step.level === 2
      ? {
          ...step,
          changes: step.changes.map((change) =>
            change.value.id === secondSiblingId
              ? {
                  ...change,
                  value: {
                    ...change.value,
                    parentGroup: branches[0].groupBase + 1,
                  },
                }
              : change,
          ),
        }
      : step,
  )
}

function independentTransitionScenarioArbitrary(
  shape: IndependentTransitionShape,
): fc.Arbitrary<RouteLifecycleScenario> {
  return fc
    .record({
      ...generatedBranchArbitraries,
      freshRoutes: independentFreshRoutesArbitrary(shape),
    })
    .map(({ freshRoutes, ...branchOptions }) => {
      const branches = createGeneratedBranches(branchOptions)
      return createRouteLifecycleScenario({
        depth: 3,
        branches,
        prefixSteps: independentTransitionPrefix(shape, branches),
        descriptors: independentTransitionDescriptors(
          shape,
          branches,
          freshRoutes,
        ),
      })
    })
}

const destinationHistories = [
  `fresh`,
  `restore`,
  `merge-split`,
  `retired`,
] as const

type DestinationHistory = (typeof destinationHistories)[number]

function destinationHistoryDescriptors(
  history: DestinationHistory,
  branches: readonly [ConnectedBranch, ConnectedBranch],
  freshRoute: number,
): ReadonlyArray<RouteTransitionDescriptor> {
  const originalRoute = branches[0].groupBase + 2
  const sharedRoute = branches[1].groupBase + 2
  const first: RouteTransitionDescriptor = {
    kind: `rekey`,
    level: 2,
    row: 0,
    destination: { strategy: `fresh`, route: freshRoute },
  }

  switch (history) {
    case `fresh`:
      return [first]
    case `restore`:
      return [
        first,
        {
          ...first,
          destination: { strategy: `restore`, route: originalRoute },
        },
      ]
    case `merge-split`:
      return [
        {
          ...first,
          destination: { strategy: `merge`, route: sharedRoute },
        },
        {
          ...first,
          destination: { strategy: `split`, route: freshRoute },
        },
      ]
    case `retired`:
      return [
        first,
        {
          kind: `rekey`,
          level: 2,
          row: 1,
          destination: { strategy: `retired`, route: originalRoute },
        },
      ]
  }
}

function destinationHistoryScenarioArbitrary(
  history: DestinationHistory,
): fc.Arbitrary<RouteLifecycleScenario> {
  return fc
    .record({
      ...generatedBranchArbitraries,
      freshRoute: fc.integer({ min: 2_100, max: 2_400 }),
    })
    .map(({ freshRoute, ...branchOptions }) => {
      const branches = createGeneratedBranches(branchOptions)
      return createRouteLifecycleScenario({
        depth: 3,
        branches,
        descriptors: destinationHistoryDescriptors(
          history,
          branches,
          freshRoute,
        ),
      })
    })
}

function createInitiallySharedRoutePrefix(
  depth: IncludeDepth,
  parentLevel: 0 | 1 | 2,
  branches: readonly [ConnectedBranch, ConnectedBranch],
  enteringRow: 0 | 1 = 1,
): Array<FullRowBatchStep> {
  const enteringId = rowAt(branches, enteringRow, parentLevel)
  const sharedRoute = branches[otherBranch(enteringRow)].groupBase + parentLevel
  return createConnectedBatchBranches(depth, branches).map((step) => {
    if (step.level !== parentLevel) return step

    if (step.level === 0) {
      return {
        level: 0,
        changes: step.changes.map((change) =>
          change.value.id === enteringId
            ? { ...change, value: { ...change.value, group: sharedRoute } }
            : change,
        ),
      }
    }

    return {
      level: step.level,
      changes: step.changes.map((change) =>
        change.value.id === enteringId
          ? { ...change, value: { ...change.value, group: sharedRoute } }
          : change,
      ),
    }
  })
}

function createMergeIntoSharedRouteScenarios(
  parentLevel: 0 | 1 | 2,
  enteringRow: 0 | 1,
): ClassifiedHistoryScenario {
  const depth = (parentLevel + 1) as IncludeDepth
  const branches = transitionHistoryBranches
  const childLevel = depth
  const existingRow = otherBranch(enteringRow)
  const sharedRoute = branches[existingRow].groupBase + parentLevel
  const enteringParentId = rowAt(branches, enteringRow, parentLevel)
  const childId = rowAt(branches, existingRow, childLevel)
  const candidate = createRouteLifecycleScenario({
    depth,
    branches,
    descriptors: [
      {
        kind: `rekey`,
        level: parentLevel,
        row: enteringRow,
        destination: { strategy: `merge`, route: sharedRoute },
      },
    ],
  })
  expectEveryRouteTransitionVisible(candidate)

  return {
    control: {
      depth,
      steps: createInitiallySharedRoutePrefix(
        depth,
        parentLevel,
        branches,
        enteringRow,
      ),
    },
    candidate,
    candidateCheckpoint: candidate.steps.length,
    classify: (difference) =>
      classifyMissingSharedRouteSnapshot(
        difference,
        enteringParentId,
        rowAt(branches, existingRow, parentLevel),
        childId,
      ),
  }
}

function createSharedRouteLastSubscriberScenario(
  parentLevel: 0 | 1 | 2,
): FullRowBatchScenario {
  const depth = (parentLevel + 1) as IncludeDepth
  const branches = transitionHistoryBranches
  const childLevel = depth
  const sharedRoute = branches[0].groupBase + parentLevel
  const childId = rowAt(branches, 0, childLevel)
  const child = {
    ...batchChild(childId, sharedRoute, childId, 0),
    group: branches[0].groupBase + childLevel,
  }
  const descriptors: ReadonlyArray<RouteTransitionDescriptor> = [
    {
      kind: `rekey`,
      level: parentLevel,
      row: 0,
      destination: { strategy: `split`, route: 2_100 + parentLevel },
    },
    {
      kind: `rekey`,
      level: parentLevel,
      row: 1,
      destination: { strategy: `fresh`, route: 2_200 + parentLevel },
    },
  ]
  const scenario = createRouteLifecycleScenario({
    depth,
    branches,
    descriptors,
    prefixSteps: createInitiallySharedRoutePrefix(depth, parentLevel, branches),
    trailingSteps: [
      {
        level: childLevel,
        changes: [
          { type: `update`, value: { ...child, value: child.value + 1 } },
        ],
      },
    ],
  })
  expectEveryRouteTransitionVisible(scenario)
  return scenario
}

function createSnapshotOnResubscribeScenarios(
  parentLevel: 0 | 1 | 2,
): Pick<ClassifiedHistoryScenario, `control` | `candidate`> {
  const depth = (parentLevel + 1) as IncludeDepth
  const branches = transitionHistoryBranches
  const childLevel = depth
  const originalRoute = branches[0].groupBase + parentLevel
  const childId = rowAt(branches, 0, childLevel)
  const child = {
    ...batchChild(childId, originalRoute, childId, 0),
    group: branches[0].groupBase + childLevel,
  }
  const updatedChild = { ...child, value: child.value + 1 }
  const prefix = createConnectedBatchBranches(depth, branches)
  const childUpdate: FullRowBatchStep = {
    level: childLevel,
    changes: [{ type: `update`, value: updatedChild }],
  }
  const candidate = createRouteLifecycleScenario({
    depth,
    branches,
    descriptors: [
      {
        kind: `rekey`,
        level: parentLevel,
        row: 0,
        destination: { strategy: `fresh`, route: 2_300 + parentLevel },
      },
      {
        kind: `rekey`,
        level: parentLevel,
        row: 0,
        destination: { strategy: `restore`, route: originalRoute },
        stepsBefore: [childUpdate],
      },
    ],
  })
  expectEveryRouteTransitionVisible(candidate)
  const control: FullRowBatchScenario = {
    depth,
    steps: [...prefix, childUpdate],
  }

  return {
    control,
    candidate,
  }
}

function createInitiallySharedRouteResubscribeScenario(
  parentLevel: 0 | 1 | 2,
): ClassifiedHistoryScenario {
  const depth = (parentLevel + 1) as IncludeDepth
  const branches = transitionHistoryBranches
  const childLevel = depth
  const sharedRoute = branches[0].groupBase + parentLevel
  const childId = rowAt(branches, 0, childLevel)
  const child = {
    ...batchChild(childId, sharedRoute, childId, 0),
    group: branches[0].groupBase + childLevel,
  }
  const scenario = createRouteLifecycleScenario({
    depth,
    branches,
    prefixSteps: createInitiallySharedRoutePrefix(depth, parentLevel, branches),
    descriptors: [
      {
        kind: `rekey`,
        level: parentLevel,
        row: 0,
        destination: { strategy: `split`, route: 2_100 + parentLevel },
      },
      {
        kind: `rekey`,
        level: parentLevel,
        row: 1,
        destination: { strategy: `fresh`, route: 2_200 + parentLevel },
      },
      {
        kind: `rekey`,
        level: parentLevel,
        row: 1,
        destination: { strategy: `restore`, route: sharedRoute },
        stepsBefore: [
          {
            level: childLevel,
            changes: [
              {
                type: `update`,
                value: { ...child, value: child.value + 1 },
              },
            ],
          },
        ],
      },
    ],
  })
  expectEveryRouteTransitionVisible(scenario)
  return {
    control: createSharedRouteLastSubscriberScenario(parentLevel),
    candidate: scenario,
    candidateCheckpoint: scenario.steps.length,
    classify: (difference) =>
      classifyUnexpectedSharedRoute(
        difference,
        rowAt(branches, 0, parentLevel),
        rowAt(branches, 1, parentLevel),
        childId,
      ),
  }
}

type ClassifiedHistoryScenario = {
  control: FullRowBatchScenario
  greenVariants?: ReadonlyArray<FullRowBatchScenario>
  candidate: FullRowBatchScenario
  candidateCheckpoint: number
  classify: (difference: AssertionDifference) => boolean
}

type RekeyRouteReuseOptions = {
  depth: 2 | 3 | 4
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  rekeyGroup: number
  insertedId: number
  insertedValue: number
  insertedPosition: number
}

function createRekeyRouteReuseFixture({
  depth,
  sourceBranch,
  branches,
  rekeyGroup,
  insertedId,
  insertedValue,
  insertedPosition,
}: RekeyRouteReuseOptions): {
  prefix: Array<FullRowBatchStep>
  rekey: FullRowBatchStep
  reuse: FullRowBatchStep
  classify: (difference: AssertionDifference) => boolean
} {
  const targetLevel = (depth - 1) as IncludeDepth
  assertDisjointRelationshipKeys(depth, branches, {
    extraIds: [insertedId],
    extraGroups: [rekeyGroup],
  })

  const prefix = createConnectedBatchBranches(depth, branches)
  const source = branches[sourceBranch]
  const parentGroup = source.groupBase + targetLevel - 1
  const oldGroup = source.groupBase + targetLevel
  const inserted = {
    ...batchChild(insertedId, parentGroup, insertedValue, insertedPosition),
    group: oldGroup,
  }
  const insertOldRoute: FullRowBatchStep = {
    level: targetLevel,
    changes: [{ type: `insert`, value: inserted }],
  }
  const rekey: FullRowBatchStep = {
    level: targetLevel,
    changes: [
      {
        type: `update`,
        value: {
          ...batchChild(
            source.idBase + targetLevel,
            parentGroup,
            source.idBase + targetLevel,
            0,
          ),
          group: rekeyGroup,
        },
      },
    ],
  }

  const retiredRowId = source.idBase + targetLevel
  const childId = source.idBase + targetLevel + 1

  return {
    prefix,
    rekey,
    reuse: insertOldRoute,
    classify: (difference) =>
      classifyUnexpectedSharedRoute(
        difference,
        retiredRowId,
        insertedId,
        childId,
      ),
  }
}

function createRekeyRouteReuseScenarios(
  options: RekeyRouteReuseOptions,
): ClassifiedHistoryScenario {
  const { depth } = options
  const { prefix, rekey, reuse, classify } =
    createRekeyRouteReuseFixture(options)

  return {
    control: { depth, steps: [...prefix, reuse] },
    candidate: { depth, steps: [...prefix, rekey, reuse] },
    candidateCheckpoint: prefix.length + 2,
    classify,
  }
}

function createIntraBatchRekeyRouteReuseScenarios(
  options: RekeyRouteReuseOptions,
): ClassifiedHistoryScenario {
  const { depth } = options
  const { prefix, rekey, reuse, classify } =
    createRekeyRouteReuseFixture(options)
  if (rekey.level === 0 || rekey.level !== reuse.level) {
    throw new Error(`Intra-batch route reuse must share a child level`)
  }

  return {
    control: {
      depth,
      steps: [
        ...prefix,
        { level: rekey.level, changes: [...reuse.changes, ...rekey.changes] },
      ],
    },
    candidate: {
      depth,
      steps: [
        ...prefix,
        { level: rekey.level, changes: [...rekey.changes, ...reuse.changes] },
      ],
    },
    candidateCheckpoint: prefix.length + 1,
    classify,
  }
}

function rekeyRouteReuseScenarioArbitrary(
  depth: 2 | 3 | 4,
  sourceBranch: 0 | 1,
  createScenario: (
    options: RekeyRouteReuseOptions,
  ) => ClassifiedHistoryScenario = createRekeyRouteReuseScenarios,
): fc.Arbitrary<ClassifiedHistoryScenario> {
  return fc
    .record({
      ...generatedBranchArbitraries,
      rekeyGroup: fc.integer({ min: 2_100, max: 2_600 }),
      insertedId: fc.integer({ min: 3_000, max: 3_200 }),
      insertedValue: fc.integer({ min: -3, max: 3 }),
      insertedPosition: fc.integer({ min: -2, max: 2 }),
    })
    .map(
      ({
        leftIdBase,
        leftGroupBase,
        rightIdBase,
        rightGroupBase,
        rekeyGroup,
        insertedId,
        insertedValue,
        insertedPosition,
      }) =>
        createScenario({
          depth,
          sourceBranch,
          branches: createGeneratedBranches({
            leftIdBase,
            leftGroupBase,
            rightIdBase,
            rightGroupBase,
          }),
          rekeyGroup,
          insertedId,
          insertedValue,
          insertedPosition,
        }),
    )
}

type MovedChildReplacementOptions = {
  depth: 3 | 4
  targetLevel: IncludeDepth
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  insertedId: number
  insertedValue: number
  insertedPosition: number
}

function createMovedChildReplacementScenarios({
  depth,
  targetLevel,
  sourceBranch,
  branches,
  insertedId,
  insertedValue,
  insertedPosition,
}: MovedChildReplacementOptions): ClassifiedHistoryScenario {
  if (targetLevel + 2 > depth) {
    throw new Error(`Child replacement needs a visible grandchild`)
  }
  assertDisjointRelationshipKeys(depth, branches, {
    extraIds: [insertedId],
  })

  const prefix = createConnectedBatchBranches(depth, branches)
  const source = branches[sourceBranch]
  const destination = branches[otherBranch(sourceBranch)]
  const targetGroup = source.groupBase + targetLevel
  const childLevel = (targetLevel + 1) as IncludeDepth
  const childGroup = source.groupBase + childLevel
  const existingChild = {
    ...batchChild(
      source.idBase + childLevel,
      targetGroup,
      source.idBase + childLevel,
      0,
    ),
    group: childGroup,
  }
  const replacementChild = {
    ...batchChild(insertedId, targetGroup, insertedValue, insertedPosition),
    group: childGroup,
  }
  const replaceChild: Array<FullRowBatchStep> = [
    {
      level: childLevel,
      changes: [{ type: `delete`, value: existingChild }],
    },
    {
      level: childLevel,
      changes: [{ type: `insert`, value: replacementChild }],
    },
  ]
  const reparent: FullRowBatchStep = {
    level: targetLevel,
    changes: [
      {
        type: `update`,
        value: {
          ...batchChild(
            source.idBase + targetLevel,
            destination.groupBase + targetLevel - 1,
            source.idBase + targetLevel,
            0,
          ),
          group: targetGroup,
        },
      },
    ],
  }
  const atomicReplacement = (
    order: `delete-first` | `insert-first`,
  ): FullRowBatchScenario => ({
    depth,
    steps: [
      ...prefix,
      reparent,
      {
        level: childLevel,
        changes:
          order === `delete-first`
            ? [
                { type: `delete`, value: existingChild },
                { type: `insert`, value: replacementChild },
              ]
            : [
                { type: `insert`, value: replacementChild },
                { type: `delete`, value: existingChild },
              ],
      },
    ],
  })
  const grandchildId = source.idBase + targetLevel + 2

  return {
    control: { depth, steps: [...prefix, ...replaceChild] },
    greenVariants: [
      atomicReplacement(`delete-first`),
      atomicReplacement(`insert-first`),
    ],
    candidate: { depth, steps: [...prefix, reparent, ...replaceChild] },
    candidateCheckpoint: prefix.length + 3,
    classify: (difference) =>
      classifyMissingReplacementChild(difference, insertedId, grandchildId),
  }
}

function movedChildReplacementMirrorsArbitrary(
  depth: 3 | 4,
  targetLevel: IncludeDepth,
  sourceBranch: 0 | 1,
): fc.Arbitrary<Record<BranchDeliveryOrder, ClassifiedHistoryScenario>> {
  return fc
    .record({
      ...generatedBranchArbitraries,
      insertedId: fc.integer({ min: 3_000, max: 3_200 }),
      insertedValue: fc.integer({ min: -3, max: 3 }),
      insertedPosition: fc.integer({ min: -2, max: 2 }),
    })
    .map(
      ({
        leftIdBase,
        leftGroupBase,
        rightIdBase,
        rightGroupBase,
        insertedId,
        insertedValue,
        insertedPosition,
      }) => {
        const branches = createGeneratedBranches({
          leftIdBase,
          leftGroupBase,
          rightIdBase,
          rightGroupBase,
        })
        const createMirror = (deliveryOrder: BranchDeliveryOrder) =>
          createMovedChildReplacementScenarios({
            depth,
            targetLevel,
            sourceBranch: deliveredBranchIndex(sourceBranch, deliveryOrder),
            branches: deliverBranches(branches, deliveryOrder),
            insertedId,
            insertedValue,
            insertedPosition,
          })

        return {
          forward: createMirror(`forward`),
          reverse: createMirror(`reverse`),
        }
      },
    )
}

function createSharedRouteLifetimeScenarios(
  parentLevel: 0 | 1,
): ClassifiedHistoryScenario {
  if (parentLevel === 0) {
    const departed = batchRoot(100, 600, 100, 0)
    const remaining = batchRoot(1_100, 600, 1_100, 1)
    const child = { ...batchChild(101, 600, 101, 0), group: 601 }
    const controlSteps: Array<FullRowBatchStep> = [
      { level: 0, changes: [{ type: `insert`, value: departed }] },
      { level: 1, changes: [{ type: `insert`, value: child }] },
      {
        level: 0,
        changes: [{ type: `update`, value: { ...departed, group: 700 } }],
      },
      {
        level: 1,
        changes: [
          { type: `update`, value: { ...child, value: child.value + 1 } },
        ],
      },
    ]
    const candidateSteps: Array<FullRowBatchStep> = [
      {
        level: 0,
        changes: [
          { type: `insert`, value: departed },
          { type: `insert`, value: remaining },
        ],
      },
      ...controlSteps.slice(1),
    ]

    return {
      control: { depth: 1, steps: controlSteps },
      candidate: { depth: 1, steps: candidateSteps },
      candidateCheckpoint: candidateSteps.length,
      classify: (difference) =>
        classifyUnexpectedSharedRoute(
          difference,
          departed.id,
          remaining.id,
          child.id,
        ),
    }
  }

  const root = batchRoot(100, 600, 100, 0)
  const departed = { ...batchChild(101, 600, 101, 0), group: 601 }
  const remaining = { ...batchChild(1_101, 600, 1_101, 1), group: 601 }
  const child = { ...batchChild(102, 601, 102, 0), group: 602 }
  const controlSteps: Array<FullRowBatchStep> = [
    { level: 0, changes: [{ type: `insert`, value: root }] },
    { level: 1, changes: [{ type: `insert`, value: departed }] },
    { level: 2, changes: [{ type: `insert`, value: child }] },
    {
      level: 1,
      changes: [{ type: `update`, value: { ...departed, group: 700 } }],
    },
    {
      level: 2,
      changes: [
        { type: `update`, value: { ...child, value: child.value + 1 } },
      ],
    },
  ]
  const candidateSteps: Array<FullRowBatchStep> = [
    controlSteps[0]!,
    {
      level: 1,
      changes: [
        { type: `insert`, value: departed },
        { type: `insert`, value: remaining },
      ],
    },
    ...controlSteps.slice(2),
  ]

  return {
    control: { depth: 2, steps: controlSteps },
    candidate: { depth: 2, steps: candidateSteps },
    candidateCheckpoint: candidateSteps.length,
    classify: (difference) =>
      classifyUnexpectedSharedRoute(
        difference,
        departed.id,
        remaining.id,
        child.id,
      ),
  }
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

async function expectClassifiedHistoryFailure({
  control,
  greenVariants = [],
  candidate,
  candidateCheckpoint,
  classify,
}: ClassifiedHistoryScenario): Promise<void> {
  await expectFullRowBatchScenarioMatches(control)
  for (const greenVariant of greenVariants) {
    await expectFullRowBatchScenarioMatches(greenVariant)
  }
  await expectAssertionFailure(
    () => expectFullRowBatchScenarioMatches(candidate),
    { checkpoint: candidateCheckpoint, classify },
  )()
}

async function expectClassifiedHistoryMatches({
  control,
  greenVariants = [],
  candidate,
}: Pick<
  ClassifiedHistoryScenario,
  `control` | `greenVariants` | `candidate`
>): Promise<void> {
  await expectFullRowBatchScenarioMatches(control)
  for (const greenVariant of greenVariants) {
    await expectFullRowBatchScenarioMatches(greenVariant)
  }
  await expectFullRowBatchScenarioMatches(candidate)
}

function recomputeFullRowBatchScenario(
  { depth, steps }: FullRowBatchScenario,
  stepCount: number,
): Array<OracleNode> {
  const roots = new Map<number, RootRow>()
  const levels = Array.from({ length: 4 }, () => new Map<number, ChildRow>())

  for (const step of steps.slice(0, stepCount)) {
    updateFullRowBatchModels(step, roots, levels)
  }

  return recompute(roots, levels, depth)
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
  .map((inputs) => normalizeFullRowBatchInputs(1, inputs))

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

function createReparentedSubtreeUpdateScenario(
  depth: 3 | 4,
  targetLevel: 1 | 2,
): VisibleRelationshipScenario {
  return createVisibleRelationshipScenario({
    depth,
    transition: `reparent`,
    targetLevel,
    sourceBranch: 0,
    branches: [
      { idBase: 100, groupBase: 600 },
      { idBase: 1_100, groupBase: 1_600 },
    ],
    noise: [targetLevel + 1, targetLevel + 2].map((level) => ({
      side: `after`,
      level: level as IncludeDepth,
      branch: 0,
      value: 1,
      position: 0,
    })),
  })
}

const minimalRekeyScenario = createVisibleRelationshipScenario({
  depth: 3,
  transition: `rekey`,
  targetLevel: 1,
  sourceBranch: 0,
  branches: [
    { idBase: 100, groupBase: 600 },
    { idBase: 1_100, groupBase: 1_600 },
  ],
  rekeyGroup: 2_100,
  noise: [],
})

const transitionHistoryBranches = [
  { idBase: 100, groupBase: 600 },
  { idBase: 1_100, groupBase: 1_600 },
] as const

// The first rekey is correct on its own. Reusing its old correlation key for a
// new visible row then resurrects the detached descendant under the old row.
const {
  control: rekeyRouteReuseControl,
  candidate: rekeyRouteResurrectionScenario,
  candidateCheckpoint: rekeyRouteResurrectionCheckpoint,
  classify: classifyRekeyRouteResurrection,
} = createRekeyRouteReuseScenarios({
  depth: 2,
  sourceBranch: 0,
  branches: transitionHistoryBranches,
  rekeyGroup: 2_100,
  insertedId: 3_000,
  insertedValue: 0,
  insertedPosition: 0,
})

// The reparent and delete are each correct. Replacing the moved row's child
// under the same correlation key then loses the existing grandchild snapshot.
const {
  control: childReplacementControl,
  candidate: movedSubtreeChildReplacementScenario,
  candidateCheckpoint: movedSubtreeChildReplacementCheckpoint,
  classify: classifyMovedSubtreeChildReplacement,
} = createMovedChildReplacementScenarios({
  depth: 3,
  targetLevel: 1,
  sourceBranch: 0,
  branches: transitionHistoryBranches,
  insertedId: 3_000,
  insertedValue: 0,
  insertedPosition: 0,
})

describe(`includes recompute oracle`, () => {
  fcTest(
    `shared-route snapshot classification rejects extra corruption`,
    () => {
      const expected = [
        { id: 1, value: 10, children: [{ id: 3, value: 30 }] },
        { id: 2, value: 20, children: [{ id: 3, value: 30 }] },
      ]
      const actual = [
        { id: 1, value: 11, children: [] },
        { id: 2, value: 20, children: [{ id: 3, value: 31 }] },
      ]

      expect(
        classifyMissingSharedRouteSnapshot({ actual, expected }, 1, 2, 3),
      ).toBe(false)
    },
  )

  fcTest(
    `unexpected shared-child classification rejects extra corruption`,
    () => {
      const expected = [
        { id: 1, value: 10, children: [] },
        { id: 2, value: 20, children: [{ id: 3, value: 30 }] },
      ]
      const actual = [
        { id: 1, value: 11, children: [{ id: 3, value: 30 }] },
        { id: 2, value: 20, children: [{ id: 3, value: 31 }] },
      ]

      expect(classifyUnexpectedSharedRoute({ actual, expected }, 1, 2, 3)).toBe(
        false,
      )
    },
  )

  fcTest(`missing replacement classification rejects extra corruption`, () => {
    const expected = [
      { id: 1, value: 10, children: [{ id: 3, value: 30 }] },
      { id: 2, value: 20, children: [] },
    ]
    const actual = [
      { id: 1, value: 11, children: [] },
      { id: 2, value: 21, children: [] },
    ]

    expect(classifyMissingReplacementChild({ actual, expected }, 1, 3)).toBe(
      false,
    )
  })

  fcTest(`rejects subscriber lifecycle labels on reparent transitions`, () => {
    expect(() =>
      createRouteLifecycleScenario({
        depth: 3,
        branches: transitionHistoryBranches,
        descriptors: [
          {
            kind: `reparent`,
            level: 2,
            row: 0,
            destination: { strategy: `fresh`, route: 2_100 },
          } as unknown as RouteTransitionDescriptor,
        ],
      }),
    ).toThrow(/reparent transitions only support live merge destinations/)
  })

  fcTest(`scopes rekey route histories to their include level`, () => {
    expect(() =>
      createRouteLifecycleScenario({
        depth: 3,
        branches: transitionHistoryBranches,
        descriptors: [
          {
            kind: `rekey`,
            level: 1,
            row: 0,
            destination: { strategy: `fresh`, route: 2_100 },
          },
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `fresh`, route: 2_100 },
          },
        ],
      }),
    ).not.toThrow()
  })

  fcTest(`the sibling topology targets rows under one parent`, () => {
    const branches = transitionHistoryBranches
    const prefix = independentTransitionPrefix(`sibling`, branches)
    const levelTwo = prefix.find((step) => step.level === 2)
    if (!levelTwo || levelTwo.level !== 2) throw new Error(`Missing level 2`)
    const first = levelTwo.changes.find(
      (change) => change.value.id === rowAt(branches, 0, 2),
    )
    const second = levelTwo.changes.find(
      (change) => change.value.id === rowAt(branches, 1, 2),
    )
    if (!first || !second) throw new Error(`Missing sibling targets`)

    expect(first.value.parentGroup).toBe(second.value.parentGroup)
  })

  fcTest(`the descendant remains attached before its ancestor moves`, () => {
    const branches = transitionHistoryBranches
    const scenario = createRouteLifecycleScenario({
      depth: 3,
      branches,
      descriptors: independentTransitionDescriptors(
        `descendant-ancestor`,
        branches,
        [2_100, 2_500],
      ),
    })
    const ancestorTransitionStep = scenario.transitionStepIndexes[1]
    if (ancestorTransitionStep === undefined) {
      throw new Error(`Missing ancestor transition`)
    }
    const beforeAncestorMove = recomputeFullRowBatchScenario(
      scenario,
      ancestorTransitionStep,
    )

    expect(
      hasDirectChild(
        beforeAncestorMove,
        rowAt(branches, 0, 1),
        rowAt(branches, 0, 2),
      ),
    ).toBe(true)
  })

  fcTest(
    `discovered trace: a root entering a live route misses its ordered snapshot`,
    async () => {
      const branches = transitionHistoryBranches
      const prefix = createConnectedBatchBranches(1, branches)
      const childStep = prefix.find((step) => step.level === 1)
      if (!childStep || childStep.level !== 1)
        throw new Error(`Missing children`)
      const scenario: FullRowBatchScenario = {
        depth: 1,
        steps: [
          prefix[0]!,
          {
            level: 1,
            changes: [
              ...childStep.changes,
              {
                type: `insert`,
                value: {
                  ...batchChild(3_000, branches[0].groupBase, 3_000, -1),
                  group: 2_500,
                },
              },
            ],
          },
          {
            level: 0,
            changes: [
              {
                type: `update`,
                value: batchRoot(
                  branches[1].idBase,
                  branches[0].groupBase,
                  branches[1].idBase,
                  0,
                ),
              },
            ],
          },
        ],
      }

      await expectAssertionFailure(
        () => expectFullRowBatchScenarioMatches(scenario),
        {
          checkpoint: 3,
          classify: (difference) =>
            classifyMissingSharedRouteSnapshot(
              difference,
              branches[1].idBase,
              branches[0].idBase,
              [3_000, branches[0].idBase + 1],
            ),
        },
      )()
    },
  )

  for (const [shapeIndex, shape] of independentTransitionShapes.entries()) {
    fcTest.prop([independentTransitionScenarioArbitrary(shape)], {
      numRuns: 4,
      seed: 1734 + shapeIndex,
    })(
      `matches recomputation for independent ${shape} relationship targets`,
      async (scenario) => {
        expectEveryRouteTransitionVisible(scenario)
        await expectFullRowBatchScenarioMatches(scenario)
      },
    )
  }

  for (const [historyIndex, history] of destinationHistories.entries()) {
    fcTest.prop([destinationHistoryScenarioArbitrary(history)], {
      numRuns: 4,
      seed: 1740 + historyIndex,
    })(
      `matches recomputation for the ${history} route destination history`,
      async (scenario) => {
        expectEveryRouteTransitionVisible(scenario)
        await expectFullRowBatchScenarioMatches(scenario)
      },
    )
  }

  for (const parentLevel of [0, 1, 2] as const) {
    for (const enteringRow of [0, 1] as const) {
      // Only roots currently miss an existing shared-route snapshot; nested
      // subscribers receive the snapshot and remain green controls.
      const expectsFailure = parentLevel === 0
      fcTest(
        expectsFailure
          ? `discovered trace: root ${enteringRow} entering a live shared route receives its snapshot`
          : `matches recomputation when level-${parentLevel} row ${enteringRow} enters a live shared route`,
        () =>
          (expectsFailure
            ? expectClassifiedHistoryFailure
            : expectClassifiedHistoryMatches)(
            createMergeIntoSharedRouteScenarios(parentLevel, enteringRow),
          ),
      )
    }

    fcTest(
      `matches recomputation when the last level-${parentLevel} shared-route subscriber leaves`,
      () =>
        expectFullRowBatchScenarioMatches(
          createSharedRouteLastSubscriberScenario(parentLevel),
        ),
    )

    fcTest(
      `matches recomputation after a level-${parentLevel} route resubscribes`,
      () =>
        expectClassifiedHistoryMatches(
          createSnapshotOnResubscribeScenarios(parentLevel),
        ),
    )

    fcTest(
      parentLevel === 0
        ? `discovered trace: an initially shared root route retires, changes, and resubscribes`
        : `matches recomputation when an initially shared level-${parentLevel} route retires, changes, and resubscribes`,
      () =>
        (parentLevel === 0
          ? expectClassifiedHistoryFailure
          : expectClassifiedHistoryMatches)(
          createInitiallySharedRouteResubscribeScenario(parentLevel),
        ),
    )
  }

  fcTest(`rejects invalid route destination strategies`, () => {
    const branches = transitionHistoryBranches
    const ownRoute = branches[0].groupBase + 2
    const otherRoute = branches[1].groupBase + 2
    const freshRoute = 2_100
    const invalidCases: ReadonlyArray<{
      descriptors: ReadonlyArray<RouteTransitionDescriptor>
      message: RegExp
    }> = [
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `fresh`, route: otherRoute },
          },
        ],
        message: /fresh route must never have been used/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `restore`, route: ownRoute },
          },
        ],
        message: /restore route must have been retired by this row/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `fresh`, route: freshRoute },
          },
          {
            kind: `rekey`,
            level: 2,
            row: 1,
            destination: { strategy: `restore`, route: ownRoute },
          },
        ],
        message: /restore route must have been retired by this row/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `merge`, route: freshRoute },
          },
        ],
        message: /merge route must be live and different/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `merge`, route: ownRoute },
          },
        ],
        message: /merge route must be live and different/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `split`, route: freshRoute },
          },
        ],
        message: /split source route must be shared/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `merge`, route: otherRoute },
          },
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `split`, route: ownRoute },
          },
        ],
        message: /split destination must be unused/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `retired`, route: otherRoute },
          },
        ],
        message: /retired route must have been retired by another row/,
      },
      {
        descriptors: [
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `fresh`, route: freshRoute },
          },
          {
            kind: `rekey`,
            level: 2,
            row: 0,
            destination: { strategy: `retired`, route: ownRoute },
          },
        ],
        message: /retired route must have been retired by another row/,
      },
    ]

    for (const invalidCase of invalidCases) {
      expect(() =>
        createRouteLifecycleScenario({
          depth: 3,
          branches,
          descriptors: invalidCase.descriptors,
        }),
      ).toThrow(invalidCase.message)
    }
  })

  fcTest(`rejects overlapping visible relationship keys`, () => {
    const base = {
      depth: 4,
      transition: `rekey`,
      targetLevel: 1,
      sourceBranch: 0,
      noise: [],
    } as const
    const collisions: Array<{
      branches: readonly [ConnectedBranch, ConnectedBranch]
      rekeyGroup: number
    }> = [
      {
        branches: [
          { idBase: 100, groupBase: 600 },
          { idBase: 102, groupBase: 1_600 },
        ],
        rekeyGroup: 2_100,
      },
      {
        branches: [
          { idBase: 100, groupBase: 600 },
          { idBase: 1_100, groupBase: 602 },
        ],
        rekeyGroup: 2_100,
      },
      {
        branches: [
          { idBase: 100, groupBase: 600 },
          { idBase: 1_100, groupBase: 1_600 },
        ],
        rekeyGroup: 603,
      },
    ]

    for (const collision of collisions) {
      expect(() =>
        createVisibleRelationshipScenario({
          ...base,
          ...collision,
        }),
      ).toThrow(/overlap/)
    }
  })

  for (const materialization of [`array`, `concat`] as const) {
    fcTest(
      `discovered trace: ${materialization} follows an intra-batch child hand-off`,
      expectAssertionFailure(
        async () => {
          await expectFlatMaterializationScenarioMatches(
            materialization,
            intraBatchChildHandOffScenario,
          )
        },
        { checkpoint: 3 },
      ),
    )
  }

  for (const [depth, targetLevel] of [
    [3, 1],
    [4, 1],
    [4, 2],
  ] as const) {
    fcTest(
      `discovered trace: later updates propagate through a reparented subtree at depth ${depth}, level ${targetLevel}`,
      expectAssertionFailure(
        () =>
          expectFullRowBatchScenarioMatches(
            createReparentedSubtreeUpdateScenario(depth, targetLevel),
          ),
        { checkpoint: depth + 4 },
      ),
    )
  }

  fcTest(
    `discovered trace: rekeying a row detaches two descendant levels`,
    expectAssertionFailure(
      () => expectFullRowBatchScenarioMatches(minimalRekeyScenario),
      { checkpoint: 5 },
    ),
  )

  fcTest(
    `discovered trace: reusing a rekeyed row's old route does not resurrect its child`,
    expectAssertionFailure(
      () => expectFullRowBatchScenarioMatches(rekeyRouteResurrectionScenario),
      {
        checkpoint: rekeyRouteResurrectionCheckpoint,
        classify: classifyRekeyRouteResurrection,
      },
    ),
  )

  fcTest(
    `matches recomputation when sharing a route without rekeying its existing row`,
    () => expectFullRowBatchScenarioMatches(rekeyRouteReuseControl),
  )

  fcTest(
    `discovered trace: replacing a moved subtree child retains its grandchild`,
    expectAssertionFailure(
      () =>
        expectFullRowBatchScenarioMatches(movedSubtreeChildReplacementScenario),
      {
        checkpoint: movedSubtreeChildReplacementCheckpoint,
        classify: classifyMovedSubtreeChildReplacement,
      },
    ),
  )

  fcTest(
    `matches recomputation when replacing a child without reparenting its ancestor`,
    () => expectFullRowBatchScenarioMatches(childReplacementControl),
  )

  for (const depth of [2, 3, 4] as const) {
    for (const sourceBranch of [0, 1] as const) {
      fcTest.prop([rekeyRouteReuseScenarioArbitrary(depth, sourceBranch)], {
        numRuns: 4,
        seed: 1726 + depth * 10 + sourceBranch,
      })(
        `discovered histories: reusing a retired route at depth ${depth}, branch ${sourceBranch}`,
        expectClassifiedHistoryFailure,
      )

      fcTest.prop(
        [
          rekeyRouteReuseScenarioArbitrary(
            depth,
            sourceBranch,
            createIntraBatchRekeyRouteReuseScenarios,
          ),
        ],
        {
          numRuns: 4,
          seed: 1733 + depth * 10 + sourceBranch,
        },
      )(
        `discovered histories: intra-batch rekey then retired-route reuse at depth ${depth}, branch ${sourceBranch}`,
        expectClassifiedHistoryFailure,
      )
    }
  }

  for (const parentLevel of [0, 1] as const) {
    fcTest(
      `discovered trace: a departed level-${parentLevel} shared-route subscriber receives later child updates`,
      () =>
        expectClassifiedHistoryFailure(
          createSharedRouteLifetimeScenarios(parentLevel),
        ),
    )
  }

  for (const depth of [3, 4] as const) {
    for (let targetLevel = 1; targetLevel <= depth - 2; targetLevel++) {
      for (const sourceBranch of [0, 1] as const) {
        fcTest.prop(
          [
            movedChildReplacementMirrorsArbitrary(
              depth,
              targetLevel as IncludeDepth,
              sourceBranch,
            ),
          ],
          {
            numRuns: 4,
            seed: 1727 + depth * 100 + targetLevel * 10 + sourceBranch,
          },
        )(
          `classifies forward/reverse delivery mirrors when replacing a moved child at depth ${depth}, level ${targetLevel}, source ${sourceBranch}`,
          async (scenarios) => {
            for (const deliveryOrder of branchDeliveryOrders) {
              const deliveredSource = deliveredBranchIndex(
                sourceBranch,
                deliveryOrder,
              )
              // At depth 4, level 2, replacement stays green only when the
              // moved branch was delivered second. The mirrors share one
              // generated fixture, so delivery order is the only difference.
              const expectsFailure =
                depth !== 4 || targetLevel !== 2 || deliveredSource !== 1
              await (
                expectsFailure
                  ? expectClassifiedHistoryFailure
                  : expectClassifiedHistoryMatches
              )(scenarios[deliveryOrder])
            }
          },
        )
      }
    }
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

  for (const depth of [1, 2, 3, 4] as const) {
    fcTest.prop([fullRowBatchScenarioAtDepthArbitrary(depth)], {
      numRuns: 10,
      seed: 1719 + depth,
    })(
      `matches recomputation for visible multi-row batches at depth ${depth}`,
      expectFullRowBatchScenarioMatches,
    )

    const transitions: Array<VisibleRelationshipTransition> = [
      `reparent`,
      `rekey`,
    ]
    for (const transition of transitions) {
      for (let targetLevel = 1; targetLevel <= depth; targetLevel++) {
        // Incremental routing fails to fully detach a rekeyed row when two or
        // more descendant include levels still hang below it.
        const expectsFailure =
          transition === `rekey` && targetLevel + 2 <= depth
        fcTest.prop(
          [
            visibleRelationshipScenarioArbitrary(
              depth,
              transition,
              targetLevel as IncludeDepth,
            ),
          ],
          {
            numRuns: 4,
            seed: 1721 + depth + targetLevel,
          },
        )(
          expectsFailure
            ? `discovered trace: a visible rekey at depth ${depth}, level ${targetLevel}`
            : `matches recomputation for a visible ${transition} at depth ${depth}, level ${targetLevel}`,
          async (scenarios) => {
            for (const scenario of [
              scenarios.transitionOnly,
              scenarios.stateful,
            ]) {
              const beforeTransition = recomputeFullRowBatchScenario(
                scenario,
                scenario.transitionStepIndex,
              )
              const result = recomputeFullRowBatchScenario(
                scenario,
                scenario.transitionStepIndex + 1,
              )

              expect(result).not.toEqual(beforeTransition)
              if (expectsFailure) {
                await expectAssertionFailure(
                  () => expectFullRowBatchScenarioMatches(scenario),
                  { checkpoint: scenario.transitionStepIndex + 1 },
                )()
              } else {
                await expectFullRowBatchScenarioMatches(scenario)
              }
            }
          },
        )
      }
    }
  }

  for (const depth of [1, 2, 3, 4] as const) {
    const transitions: Array<VisibleRelationshipTransition> = [
      `reparent`,
      `rekey`,
    ]
    for (const [firstIndex, firstTransition] of transitions.entries()) {
      for (const [secondIndex, secondTransition] of transitions.entries()) {
        if (
          transitionHistoryPlacements(depth, firstTransition, secondTransition)
            .length === 0
        ) {
          continue
        }

        for (const sourceBranch of [0, 1] as const) {
          fcTest.prop(
            [
              transitionHistoryScenariosArbitrary(
                depth,
                firstTransition,
                secondTransition,
                sourceBranch,
              ),
            ],
            {
              numRuns: 3,
              seed:
                1725 +
                depth * 100 +
                firstIndex * 10 +
                secondIndex * 2 +
                sourceBranch,
            },
          )(
            `matches recomputation for ${firstTransition} → ${secondTransition} histories at depth ${depth}, branch ${sourceBranch}`,
            async (scenarios) => {
              for (const scenario of scenarios) {
                expectEveryHistoryStepVisible(scenario)
                await expectFullRowBatchScenarioMatches(scenario)
              }
            },
          )
        }
      }
    }
  }

  fcTest(
    `discovered seed: nested scalar materialization follows a reference update`,
    expectAssertionFailure(
      async () => {
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
      },
      { checkpoint: 5 },
    ),
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
    expectAssertionFailure(
      () => expectFullRowBatchScenarioMatches(fullRowSharedRoutingSeed),
      { checkpoint: 4 },
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
    expectAssertionFailure(expectMaterializeScenarioMatches, { checkpoint: 6 }),
  )

  fcTest.prop([fc.constant(`correlation-key-update`)], {
    numRuns: 1,
    seed: 1658,
  })(
    `discovered seed: parent correlation-key update rematerializes children`,
    expectAssertionFailure(
      async () => {
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
      },
      { message: /children/ },
    ),
  )

  fcTest.prop([fc.constant(`#1454`)], { numRuns: 1, seed: 1454 })(
    `known seed: alpha-renaming a duplicate sibling alias preserves results`,
    expectAssertionFailure(
      async () => {
        const roots = createControlledCollection<RootRow>(`alias-seed-roots`, [
          { id: 1, group: 1, value: 0, position: 0 },
        ])
        const issues = createControlledCollection<ChildRow>(
          `alias-seed-issues`,
          [
            {
              id: 10,
              parentGroup: 1,
              group: 10,
              value: 10,
              position: 0,
            },
          ],
        )
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
      },
      { message: /deeply equal/ },
    ),
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
