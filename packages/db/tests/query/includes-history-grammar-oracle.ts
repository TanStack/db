import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { oracleAssertion } from '../oracle-assertion-adapter.js'
import {
  assertDisjointRelationshipKeys,
  batchChild,
  batchRoot,
  createConnectedBatchBranches,
  createRouteLifecycleScenario,
  createVisibleRelationshipScenario,
  otherBranch,
  rowAt,
  transitionHistoryBranches,
  updateFullRowBatchModels,
} from './includes-route-grammar-oracle.js'
import type {
  ConnectedBranch,
  FullRowBatchScenario,
  FullRowBatchStep,
  IncludeDepth,
  RouteLifecycleScenario,
  RouteTransitionDescriptor,
  VisibleRelationshipScenario,
  VisibleRelationshipScenarioOptions,
  VisibleScalarNoise,
} from './includes-route-grammar-oracle.js'
import type { ChildRow, RootRow } from './includes-structural-support.js'
import type { OracleSyncChange as SyncChange } from './includes-oracle-helpers.js'

// The relationship model and the route-history grammar of the includes
// recompute oracle, moved here unchanged from includes-oracle.property.test.ts:
// recompute, its full-row batch replay, the relationship projection, and the
// transition, destination, batch-shape, rekey, and moved-child scenario
// constructors and arbitraries. The oracle drives production through them; the
// ordinary grammar checks in includes-history-grammar.test.ts step the model
// over them. This module registers no tests.

export type HistoryAction = {
  type: `put` | `delete` | `optimisticConfirm` | `optimisticRollback`
  level: 0 | IncludeDepth
  id: number
  parentGroup: number
  group: number
  value: number
  position: number
}

export function levelArbitrary(
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

export type OracleNode = RootRow & {
  children?: Array<OracleNode>
}

export type RelationshipNode = {
  id: number
  value?: unknown
  children?: unknown
}

export function isRelationshipNode(value: unknown): value is RelationshipNode {
  return (
    typeof value === `object` &&
    value !== null &&
    `id` in value &&
    typeof value.id === `number`
  )
}

export function findRelationshipNode(
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

export function hasDirectChild(
  value: unknown,
  parentId: number,
  childId: number,
) {
  const parent = findRelationshipNode(value, parentId)
  return (
    Array.isArray(parent?.children) &&
    parent.children.some(
      (child) => isRelationshipNode(child) && child.id === childId,
    )
  )
}

export type RelationshipProjectionNode = {
  id: number
  children?: Array<RelationshipProjectionNode>
}

export function relationshipOnly(
  nodes: ReadonlyArray<OracleNode>,
): Array<RelationshipProjectionNode> {
  return nodes.map(({ id, children }) => ({
    id,
    ...(children ? { children: relationshipOnly(children) } : {}),
  }))
}

export function compareRows(left: RootRow, right: RootRow): number {
  return left.position - right.position || left.id - right.id
}

// This is intentionally independent of the live-query implementation. It is
// the simple, full-recompute semantics reference for the incremental system.
export function recompute(
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

export type VisibleRelationshipTransition = `reparent` | `rekey`
export type BranchDeliveryOrder = `forward` | `reverse`
export const branchDeliveryOrders: ReadonlyArray<BranchDeliveryOrder> = [
  `forward`,
  `reverse`,
]

export function deliverBranches(
  branches: readonly [ConnectedBranch, ConnectedBranch],
  order: BranchDeliveryOrder,
): readonly [ConnectedBranch, ConnectedBranch] {
  return order === `forward` ? branches : [branches[1], branches[0]]
}

export function deliveredBranchIndex(
  branch: 0 | 1,
  order: BranchDeliveryOrder,
): 0 | 1 {
  return order === `forward` ? branch : otherBranch(branch)
}

export type VisibleRelationshipScenarios = {
  transitionOnly: VisibleRelationshipScenario
  stateful: VisibleRelationshipScenario
}

export function visibleRelationshipScenarioArbitrary(
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
      afterValues: fc.array(scalarNoiseArbitrary(`after`, branchArbitrary), {
        minLength: 1,
        maxLength: 5,
      }),
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
        const connectedNoise: Array<VisibleScalarNoise> = [
          beforeNoise,
          ...extraBeforeNoise,
          ...afterValues,
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

export type GeneratedBranchOptions = {
  leftIdBase: number
  leftGroupBase: number
  rightIdBase: number
  rightGroupBase: number
}

export const generatedBranchArbitraries = {
  leftIdBase: fc.integer({ min: 100, max: 500 }),
  leftGroupBase: fc.integer({ min: 600, max: 1_000 }),
  rightIdBase: fc.integer({ min: 1_100, max: 1_500 }),
  rightGroupBase: fc.integer({ min: 1_600, max: 2_000 }),
}

export function createGeneratedBranches({
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

export type TransitionHistoryScenario = FullRowBatchScenario & {
  historyStartStepIndex: number
}

export type TransitionHistoryScenarioOptions = {
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

export function createTransitionHistoryScenario({
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
  // so those histories remain shrinkable without masking later steps.
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

export function transitionHistoryPlacements(
  depth: IncludeDepth,
  firstTransition: VisibleRelationshipTransition,
  secondTransition: VisibleRelationshipTransition,
): Array<{
  targetLevel: IncludeDepth
  insertedLevels: readonly [IncludeDepth, IncludeDepth]
}> {
  // A rekey needs one child level so it changes relationship membership. It
  // also fails when two descendant levels remain. The single-transition matrix
  // covers that failure and will turn red when this continuation can be widened.
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

export function transitionHistoryScenariosArbitrary(
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

export function expectEveryHistoryStepVisible(
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
    oracleAssertion('includes oracle.property comparison 1610', () =>
      expect(after).not.toEqual(before),
    )
  }
}

export function expectEveryRouteTransitionVisible(
  scenario: RouteLifecycleScenario,
): void {
  for (const stepIndex of scenario.transitionStepIndexes) {
    const before = relationshipOnly(
      recomputeFullRowBatchScenario(scenario, stepIndex),
    )
    const after = relationshipOnly(
      recomputeFullRowBatchScenario(scenario, stepIndex + 1),
    )
    oracleAssertion('includes oracle.property comparison 1624', () =>
      expect(after).not.toEqual(before),
    )
  }
}

export const independentTransitionShapes = [
  `ancestor-descendant`,
  `descendant-ancestor`,
  `sibling`,
  `cross-branch`,
  `root`,
] as const

export type IndependentTransitionShape =
  (typeof independentTransitionShapes)[number]

export function independentFreshRoutesArbitrary(
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

export function independentTransitionDescriptors(
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

export function independentTransitionPrefix(
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

export function independentTransitionScenarioArbitrary(
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

export const destinationHistories = [
  `fresh`,
  `restore`,
  `merge-split`,
  `retired`,
] as const

export type DestinationHistory = (typeof destinationHistories)[number]

export function destinationHistoryDescriptors(
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

export function destinationHistoryScenarioArbitrary(
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

export function createInitiallySharedRoutePrefix(
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

export function createMergeIntoSharedRouteScenarios(
  parentLevel: 0 | 1 | 2,
  enteringRow: 0 | 1,
): HistoryScenarioPair {
  const depth = (parentLevel + 1) as IncludeDepth
  const branches = transitionHistoryBranches
  const existingRow = otherBranch(enteringRow)
  const sharedRoute = branches[existingRow].groupBase + parentLevel
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
  }
}

export function createSharedRouteLastSubscriberScenario(
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

export function createSnapshotOnResubscribeScenarios(
  parentLevel: 0 | 1 | 2,
): HistoryScenarioPair {
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

export function createInitiallySharedRouteResubscribeScenario(
  parentLevel: 0 | 1 | 2,
): HistoryScenarioPair {
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
  }
}

export type HistoryScenarioPair = {
  control: FullRowBatchScenario
  greenVariants?: ReadonlyArray<FullRowBatchScenario>
  candidate: FullRowBatchScenario
}

export type RekeyRouteReuseOptions = {
  depth: 2 | 3 | 4
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  rekeyGroup: number
  insertedId: number
  insertedValue: number
  insertedPosition: number
}

export function createRekeyRouteReuseFixture({
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

  return {
    prefix,
    rekey,
    reuse: insertOldRoute,
  }
}

export function createRekeyRouteReuseScenarios(
  options: RekeyRouteReuseOptions,
): HistoryScenarioPair {
  const { depth } = options
  const { prefix, rekey, reuse } = createRekeyRouteReuseFixture(options)

  return {
    control: { depth, steps: [...prefix, reuse] },
    candidate: { depth, steps: [...prefix, rekey, reuse] },
  }
}

export function createIntraBatchRekeyRouteReuseScenarios(
  options: RekeyRouteReuseOptions,
): HistoryScenarioPair {
  const { depth } = options
  const { prefix, rekey, reuse } = createRekeyRouteReuseFixture(options)
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
  }
}

export function rekeyRouteReuseScenarioArbitrary(
  depth: 2 | 3 | 4,
  sourceBranch: 0 | 1,
  createScenario: (
    options: RekeyRouteReuseOptions,
  ) => HistoryScenarioPair = createRekeyRouteReuseScenarios,
): fc.Arbitrary<HistoryScenarioPair> {
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

export type MovedChildReplacementOptions = {
  depth: 3 | 4
  targetLevel: IncludeDepth
  sourceBranch: 0 | 1
  branches: readonly [ConnectedBranch, ConnectedBranch]
  insertedId: number
  insertedValue: number
  insertedPosition: number
}

export function createMovedChildReplacementScenarios({
  depth,
  targetLevel,
  sourceBranch,
  branches,
  insertedId,
  insertedValue,
  insertedPosition,
}: MovedChildReplacementOptions): HistoryScenarioPair {
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
  return {
    control: { depth, steps: [...prefix, ...replaceChild] },
    greenVariants: [
      atomicReplacement(`delete-first`),
      atomicReplacement(`insert-first`),
    ],
    candidate: { depth, steps: [...prefix, reparent, ...replaceChild] },
  }
}

export function movedChildReplacementMirrorsArbitrary(
  depth: 3 | 4,
  targetLevel: IncludeDepth,
  sourceBranch: 0 | 1,
): fc.Arbitrary<Record<BranchDeliveryOrder, HistoryScenarioPair>> {
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

export type RelationshipBatchDelivery = `split` | `atomic`
export type RelationshipBatchOrder = `delete-insert` | `insert-delete`
export type ReplacementPublicId = `same` | `new`
export type ReplacementRoute = `handoff` | `fresh`
export type AncestorUpdateShape = `route-only` | `route-and-position`

export type RelationshipBatchShape = {
  delivery: RelationshipBatchDelivery
  order: RelationshipBatchOrder
  publicId: ReplacementPublicId
  route: ReplacementRoute
  ancestorUpdate: AncestorUpdateShape
}

export type RelationshipBatchShapeOptions = GeneratedBranchOptions & {
  shape: RelationshipBatchShape
  replacementId: number
  replacementGroup: number
  replacementValue: number
  replacementPosition: number
  movedPosition: number
}

export function createRelationshipBatchShapeScenarios({
  shape,
  replacementId,
  replacementGroup,
  replacementValue,
  replacementPosition,
  movedPosition,
  ...branchOptions
}: RelationshipBatchShapeOptions): HistoryScenarioPair {
  const depth = 3
  const branches = createGeneratedBranches(branchOptions)
  assertDisjointRelationshipKeys(depth, branches, {
    extraIds: shape.publicId === `new` ? [replacementId] : [],
    extraGroups: shape.route === `fresh` ? [replacementGroup] : [],
  })

  const source = branches[0]
  const destination = branches[1]
  const prefix = createConnectedBatchBranches(depth, branches)
  const targetLevel = 1
  const childLevel = 2
  const targetId = source.idBase + targetLevel
  const childId = source.idBase + childLevel
  const targetGroup = source.groupBase + targetLevel
  const childGroup = source.groupBase + childLevel
  const currentTarget = {
    ...batchChild(targetId, source.groupBase, targetId, 0),
    group: targetGroup,
  }
  const movedTarget = {
    ...currentTarget,
    parentGroup: destination.groupBase,
    position:
      shape.ancestorUpdate === `route-and-position`
        ? movedPosition
        : currentTarget.position,
  }
  const currentChild = {
    ...batchChild(childId, targetGroup, childId, 0),
    group: childGroup,
  }
  const replacementChild = {
    ...currentChild,
    id: shape.publicId === `same` ? childId : replacementId,
    group: shape.route === `handoff` ? childGroup : replacementGroup,
    value: replacementValue,
    position: replacementPosition,
  }
  const replacementChanges: Array<SyncChange<ChildRow>> =
    shape.order === `delete-insert`
      ? [
          { type: `delete`, value: currentChild },
          { type: `insert`, value: replacementChild },
        ]
      : [
          { type: `insert`, value: replacementChild },
          { type: `delete`, value: currentChild },
        ]
  const replacementSteps: Array<FullRowBatchStep> =
    shape.delivery === `atomic`
      ? [{ level: childLevel, changes: replacementChanges }]
      : replacementChanges.map((change): FullRowBatchStep => ({
          level: childLevel,
          changes: [change],
        }))
  const positionOnlyTarget = {
    ...currentTarget,
    position: movedTarget.position,
  }
  const controlMoveSteps: Array<FullRowBatchStep> =
    shape.ancestorUpdate === `route-and-position`
      ? [
          {
            level: targetLevel,
            changes: [{ type: `update`, value: positionOnlyTarget }],
          },
        ]
      : []

  return {
    // The same replacement history without the relationship move is the
    // adjacent control for every shape cell. Preserve the position change so
    // the only candidate difference is route membership.
    control: {
      depth,
      steps: [...prefix, ...controlMoveSteps, ...replacementSteps],
    },
    candidate: {
      depth,
      steps: [
        ...prefix,
        {
          level: targetLevel,
          changes: [{ type: `update`, value: movedTarget }],
        },
        ...replacementSteps,
      ],
    },
  }
}

export const relationshipBatchFixtureArbitrary: fc.Arbitrary<
  Omit<RelationshipBatchShapeOptions, `shape`>
> = fc.record({
  ...generatedBranchArbitraries,
  replacementId: fc.integer({ min: 3_000, max: 3_200 }),
  replacementGroup: fc.integer({ min: 2_700, max: 2_900 }),
  replacementValue: fc.integer({ min: -3, max: 3 }),
  replacementPosition: fc.integer({ min: -2, max: 2 }),
  movedPosition: fc.constantFrom(-2, -1, 1, 2),
})

export type RelationshipBatchShapeCell = {
  shape: RelationshipBatchShape
  scenarios: HistoryScenarioPair
}

export function createRelationshipBatchShapeMatrix(
  fixture: Omit<RelationshipBatchShapeOptions, `shape`>,
  publicId: ReplacementPublicId,
  route: ReplacementRoute,
  ancestorUpdate: AncestorUpdateShape,
): Array<RelationshipBatchShapeCell> {
  const cells: Array<RelationshipBatchShapeCell> = []

  for (const delivery of [`split`, `atomic`] as const) {
    for (const order of [`delete-insert`, `insert-delete`] as const) {
      // Inserting the same public id before the batch retires its existing row is a
      // duplicate-key error, not a valid alternate delivery of the same final
      // state. The new-id cells exercise insert-before-delete in both forms.
      if (publicId === `same` && order === `insert-delete`) continue
      const shape = {
        delivery,
        order,
        publicId,
        route,
        ancestorUpdate,
      } satisfies RelationshipBatchShape
      cells.push({
        shape,
        scenarios: createRelationshipBatchShapeScenarios({
          ...fixture,
          shape,
        }),
      })
    }
  }

  return cells
}

export function createSharedRouteLifetimeScenarios(
  parentLevel: 0 | 1,
): HistoryScenarioPair {
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
  }
}

export function recomputeFullRowBatchScenario(
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
