import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { flushPromises, withExpectedRejection } from '../utils.js'
import {
  cleanupPendingWork,
  createSources,
  releasePendingWork,
  trackPendingWork,
} from './includes-structural-support.js'
import type { IncludeDepth } from './includes-route-grammar-oracle.js'
import type {
  ChildRow,
  PendingWork,
  RootRow,
  Sources,
} from './includes-structural-support.js'
import type { TraceCheckpoint, TraceDriver } from '../trace-runner.js'

// Structural trace driver shared by the includes oracle and its unit tests.
// It applies legal row histories to the incremental query and mirrors each
// write into the row maps that the oracle recompute model reads. This module
// declares no model. The recompute model, its declared checks, and the
// generated campaigns stay in includes-oracle.property.test.ts.

export type HistoryAction = {
  type: `put` | `delete` | `optimisticConfirm` | `optimisticRollback`
  level: 0 | IncludeDepth
  id: number
  parentGroup: number
  group: number
  value: number
  position: number
}

export type Scenario = {
  depth: IncludeDepth
  history: Array<HistoryAction>
}

// This is syntax distribution, not delivered transition coverage. Route
// assignments below do not restore rollbacks or skip absent/no-op actions.
export function classifyScenarioSyntax({
  depth,
  history,
}: Scenario): Array<string> {
  const routesByLevel = Array.from(
    { length: depth + 1 },
    () => new Map<number, { parentGroup: number; group: number }>(),
  )
  let relationshipChanges = 0

  for (const action of history) {
    const routes = routesByLevel[action.level]!
    if (action.type === `delete`) {
      routes.delete(action.id)
      continue
    }

    const previous = routes.get(action.id)
    if (
      previous &&
      (previous.group !== action.group ||
        (action.level > 0 && previous.parentGroup !== action.parentGroup))
    ) {
      relationshipChanges += 1
    }
    routes.set(action.id, {
      parentGroup: action.parentGroup,
      group: action.group,
    })
  }

  return [
    `depth=${depth}`,
    `syntactic-route-changes=${
      relationshipChanges === 0
        ? `none`
        : relationshipChanges === 1
          ? `one`
          : `many`
    }`,
    `has-optimistic-syntax=${history.some((action) =>
      action.type.startsWith(`optimistic`),
    )}`,
    `has-delete-syntax=${history.some((action) => action.type === `delete`)}`,
  ]
}

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
  pending: Set<PendingWork>,
  entry: PendingWork,
): Promise<void> {
  if (action.type === `optimisticConfirm`) {
    releasePendingWork(pending, entry, resolveSync)
    await persistedPromise
    return
  }

  const message = `oracle optimistic rollback`
  const persisted = persistedPromise.catch(() => undefined)
  await withExpectedRejection(message, async () => {
    releasePendingWork(pending, entry, () => rejectSync(new Error(message)))
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
  pending: Set<PendingWork>,
): Promise<void> {
  if (action.level === 0) {
    const current = roots.get(action.id)
    if (action.type === `delete`) {
      if (current) {
        sources.roots.write(`delete`, current)
        roots.delete(action.id)
        assertMatches()
      }
      return
    }

    const next: RootRow = {
      id: action.id,
      group: action.group,
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
      const entry = trackPendingWork(
        pending,
        transaction,
        sources.roots.resolveSync,
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
        pending,
        entry,
      )
      if (action.type === `optimisticRollback`) {
        roots.set(action.id, current!)
        assertMatches()
      }
      return
    }

    sources.roots.write(current ? `update` : `insert`, next)
    roots.set(action.id, next)
    assertMatches()
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
      assertMatches()
    }
    return
  }

  const next: ChildRow = {
    id: action.id,
    parentGroup: action.parentGroup,
    group: action.group,
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
    const entry = trackPendingWork(pending, transaction, source.resolveSync)
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
      pending,
      entry,
    )
    if (action.type === `optimisticRollback`) {
      model.set(action.id, current!)
      assertMatches()
    }
    return
  }

  source.write(current ? `update` : `insert`, next)
  model.set(action.id, next)
  assertMatches()
}

export type StructuralTraceContext = {
  depth: IncludeDepth
  sources: Sources
  incremental: ReturnType<typeof createIncrementalQuery>
  roots: Map<number, RootRow>
  levels: Array<Map<number, ChildRow>>
  pendingWork: Set<PendingWork>
}

export function createStructuralTraceContext(
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
    pendingWork: new Set(),
  }
}

export async function cleanupStructuralTrace({
  incremental,
  sources,
  pendingWork,
}: Pick<StructuralTraceContext, `sources` | `pendingWork`> & {
  incremental: { cleanup: () => Promise<void> }
}): Promise<void> {
  await cleanupPendingWork(pendingWork, [
    incremental,
    sources.roots.collection,
    ...sources.levels.map(({ collection }) => collection),
  ])
}

export function createStructuralTraceDriver(
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
        context.pendingWork,
      ),
    cleanup: cleanupStructuralTrace,
  }
}
