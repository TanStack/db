// The route-lifecycle and visible-relationship history grammar for the
// includes recompute oracle in includes-oracle.property.test.ts. The builders
// here construct legal route histories and reject illegal ones; they compute no
// expected result. The model that predicts each result is the oracle file's
// recompute, and the grammar's law is owned by that oracle.
import type { OracleSyncChange as SyncChange } from './includes-oracle-helpers.js'
import type { ChildRow, RootRow } from './includes-structural-support.js'

/**
 * # Does the incremental include graph equal full relationship recomputation?
 *
 * Authority: `packages/db/src/query/live/ARCHITECTURE.md`, normative laws
 * 1, 3–5, and 8. This owner checks inline result values and order through the
 * public live-query Collection after each synchronous source change.
 *
 * This is the central structural oracle for inline includes. Production updates
 * nested results incrementally. The reference stores source rows in plain Maps
 * and rebuilds the whole tree after every meaningful checkpoint.
 *
 * The suite protects five groups of laws:
 *
 * 1. Inserts, updates, deletes, and optimistic settlement match recomputation
 *    at one to four include levels.
 * 2. Rekey and reparent histories preserve route ownership through fresh,
 *    shared, retired, restored, merged, and split routes.
 * 3. Atomic and split full-row batches produce the same tree when they encode
 *    the same logical source state.
 * 4. Nested scalar materialization follows reference changes and shared paths.
 * 5. Alpha-renaming, sibling order, and unrelated siblings do not change the
 *    relevant result, including when sibling scopes such as a `from()`
 *    subquery and an include reuse alias names.
 *
 * These laws use a model graph, not one universal controller. The structural
 * node recomputes relationship trees. A separate scalar-reference node follows
 * explicit foreign keys. Metamorphic checks compare equivalent query forms.
 * Scenario builders describe legal route histories, but they do not compute
 * the expected result.
 *
 * The trace runner checks each intermediate cut that the contract exposes.
 * Focused pinned histories preserve small boundary cases. Random or replayed
 * campaigns explore longer action sequences and wider route values. Other
 * include suites own Collection facades, demand lifetime, functional callbacks,
 * and publication coherence.
 *
 * Known limits: the structural histories use numeric correlation groups,
 * finite row IDs, one to four levels, and the declared transition shapes.
 * Their public-row checks protect those represented histories at the named
 * checkpoints; they do not prove every route relation state or source schedule.
 * This file owns further structural route witnesses. The architecture's
 * executable-contract map assigns other include boundaries to their suites.
 */

export type IncludeDepth = 1 | 2 | 3 | 4

export type FullRowBatchStep =
  | { level: 0; changes: Array<SyncChange<RootRow>> }
  | { level: IncludeDepth; changes: Array<SyncChange<ChildRow>> }

export type FullRowBatchScenario = {
  depth: IncludeDepth
  steps: Array<FullRowBatchStep>
}

export function updateModel<T extends { id: number }>(
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

export function updateFullRowBatchModels(
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

export function batchRoot(
  id: number,
  group: number,
  value = id * 10,
  position = id - 1,
): RootRow {
  return { id, group, value, position }
}

export function batchChild(
  id: number,
  parentGroup: number,
  value = id * 10,
  position = id - 1,
): ChildRow {
  return { id, parentGroup, group: id * 10, value, position }
}

export type ConnectedBranch = {
  idBase: number
  groupBase: number
}

export function createConnectedBatchBranches(
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

export function otherBranch(branch: 0 | 1): 0 | 1 {
  return branch === 0 ? 1 : 0
}

export type VisibleRelationshipScenario = FullRowBatchScenario & {
  transitionStepIndex: number
}

export type VisibleScalarNoise = {
  side: `before` | `after`
  level: 0 | IncludeDepth
  branch: 0 | 1
  value: number
  position: number
}

export type VisibleRelationshipScenarioOptions = {
  depth: IncludeDepth
  targetLevel: IncludeDepth
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  noise: ReadonlyArray<VisibleScalarNoise>
} & (
  | { transition: `reparent`; rekeyGroup?: never }
  | { transition: `rekey`; rekeyGroup: number }
)

export function assertDisjointRelationshipKeys(
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

export function createVisibleRelationshipScenario(
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

export type RouteDestination = {
  strategy: `fresh` | `restore` | `merge` | `split` | `retired`
  route: number
}

// Route lifecycle descriptors form a constrained design grammar. A numeric
// `route` is a model-only parent group value for one include edge, not a
// production BucketKey or route-relation row. `strategy` classifies legal
// histories for generation; the Map recomputation still supplies the answer.
// Constructors reject combinations that do not name a real lifecycle state.
export type RouteTransitionDescriptor = {
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

export type RouteLifecycleScenario = FullRowBatchScenario & {
  transitionStepIndexes: ReadonlyArray<number>
}

export type RouteLifecycleScenarioOptions = {
  depth: IncludeDepth
  branches: readonly [ConnectedBranch, ConnectedBranch]
  descriptors: ReadonlyArray<RouteTransitionDescriptor>
  prefixSteps?: ReadonlyArray<FullRowBatchStep>
  trailingSteps?: ReadonlyArray<FullRowBatchStep>
}

export function rowAt(
  branches: readonly [ConnectedBranch, ConnectedBranch],
  row: 0 | 1,
  level: 0 | IncludeDepth,
): number {
  return branches[row].idBase + level
}

export function applyRouteLifecycleStep(
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

export function routeIdentity(level: 0 | IncludeDepth, route: number): string {
  // This oracle has one include edge per level, so level plus correlation value
  // is the complete route identity. Equal values at different levels are not
  // the same subscription lifecycle.
  return `${level}:${route}`
}

export function createRouteLifecycleScenario({
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

export const transitionHistoryBranches = [
  { idBase: 100, groupBase: 600 },
  { idBase: 1_100, groupBase: 1_600 },
] as const
