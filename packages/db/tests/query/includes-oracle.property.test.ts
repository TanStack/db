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
import { flushPromises } from '../utils.js'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplaySkips,
  oracleRuns,
} from '../oracle-config.js'
import { runTrace } from '../trace-runner.js'
import {
  classifyScenarioSyntax,
  cleanupStructuralTrace,
  createStructuralTraceContext,
  createStructuralTraceDriver,
} from './includes-structural-driver.js'
import {
  createControlledCollection,
  createSources,
  plainSubquery,
  refsInclude,
  releasePendingWork,
  stripVirtualProperties,
  trackPendingWork,
  withPendingWorkCleanup,
} from './includes-structural-support.js'
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
  updateModel,
} from './includes-route-grammar-oracle.js'
import {
  applyScopedWrite,
  canonicalScopedAliases,
  classifyScopedNaming,
  createModelState,
  createScopedQuery,
  createScopedSources,
  normalizeScopedRows,
  recomputeScopedRows,
  scopedScenarioArbitrary,
  sortedRequests,
} from './includes-scope-identity-oracle.js'
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
import type {
  ChildRow,
  PendingWork,
  RootRow,
  Sources,
} from './includes-structural-support.js'
import type { TraceDriver, TraceProjection } from '../trace-runner.js'
import type { OracleSyncChange as SyncChange } from './includes-oracle-helpers.js'
import type {
  HistoryAction,
  Scenario,
  StructuralTraceContext,
} from './includes-structural-driver.js'
import type {
  ScopedAliases,
  ScopedPart,
  ScopedRef,
  ScopedResultRow,
  ScopedScenario,
  ScopedShape,
} from './includes-scope-identity-oracle.js'

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

// Each generated structural matrix keeps its historical seed and also samples
// a fresh seed at the same budget. A seed-and-path replay runs only its named
// property; other matrix cells cannot delay or obscure that reproduction.
function generatedCampaigns(runs: number, property: string, fixedSeed: number) {
  if (oracleReplayRequested()) {
    return oracleReplaySkips(property)
      ? []
      : [{ label: `replay`, options: oraclePropertyOptions(runs, property) }]
  }

  return [
    { label: `fixed`, options: { numRuns: oracleRuns(runs), seed: fixedSeed } },
    { label: `random`, options: oraclePropertyOptions(runs, property) },
  ]
}

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
      // Root delete/reinsert has a focused history matrix below. Keep this
      // unconstrained corpus small enough to shrink to one clear action.
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

// This grammar constructs legal row histories. The Map model below, not the
// grammar, decides their expected nested result.
const scenarioArbitrary: fc.Arbitrary<Scenario> = depthArbitrary.chain(
  (depth) =>
    fc
      .array(actionArbitrary(depth), { minLength: 1, maxLength: 18 })
      .map((history) => ({
        depth,
        history: ensureActionsTargetRows(history),
      })),
)

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    scenarioArbitrary,
    classifyScenarioSyntax,
    oraclePropertyOptions(1_000, `includes.scenario-statistics`),
  )
}

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
declareOracle({
  check: [
    expectScenarioMatches,
    expectFullRowBatchScenarioMatches,
    expectFlatMaterializationScenarioMatches,
    expectMaterializeScenarioMatches,
  ],
  model: [
    recompute,
    recomputeFullRowBatchScenario,
    recomputeFlatMaterialization,
    recomputeMaterialize,
  ],

  grammar: [independentTransitionPrefix],
})

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

type VisibleRelationshipScenarios = {
  transitionOnly: VisibleRelationshipScenario
  stateful: VisibleRelationshipScenario
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

function createInitiallySharedRouteResubscribeScenario(
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

type HistoryScenarioPair = {
  control: FullRowBatchScenario
  greenVariants?: ReadonlyArray<FullRowBatchScenario>
  candidate: FullRowBatchScenario
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

function createRekeyRouteReuseScenarios(
  options: RekeyRouteReuseOptions,
): HistoryScenarioPair {
  const { depth } = options
  const { prefix, rekey, reuse } = createRekeyRouteReuseFixture(options)

  return {
    control: { depth, steps: [...prefix, reuse] },
    candidate: { depth, steps: [...prefix, rekey, reuse] },
  }
}

function createIntraBatchRekeyRouteReuseScenarios(
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

function rekeyRouteReuseScenarioArbitrary(
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

function movedChildReplacementMirrorsArbitrary(
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

type RelationshipBatchDelivery = `split` | `atomic`
type RelationshipBatchOrder = `delete-insert` | `insert-delete`
type ReplacementPublicId = `same` | `new`
type ReplacementRoute = `handoff` | `fresh`
type AncestorUpdateShape = `route-only` | `route-and-position`

type RelationshipBatchShape = {
  delivery: RelationshipBatchDelivery
  order: RelationshipBatchOrder
  publicId: ReplacementPublicId
  route: ReplacementRoute
  ancestorUpdate: AncestorUpdateShape
}

type RelationshipBatchShapeOptions = GeneratedBranchOptions & {
  shape: RelationshipBatchShape
  replacementId: number
  replacementGroup: number
  replacementValue: number
  replacementPosition: number
  movedPosition: number
}

function createRelationshipBatchShapeScenarios({
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

const relationshipBatchFixtureArbitrary: fc.Arbitrary<
  Omit<RelationshipBatchShapeOptions, `shape`>
> = fc.record({
  ...generatedBranchArbitraries,
  replacementId: fc.integer({ min: 3_000, max: 3_200 }),
  replacementGroup: fc.integer({ min: 2_700, max: 2_900 }),
  replacementValue: fc.integer({ min: -3, max: 3 }),
  replacementPosition: fc.integer({ min: -2, max: 2 }),
  movedPosition: fc.constantFrom(-2, -1, 1, 2),
})

type RelationshipBatchShapeCell = {
  shape: RelationshipBatchShape
  scenarios: HistoryScenarioPair
}

function createRelationshipBatchShapeMatrix(
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

function createSharedRouteLifetimeScenarios(
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

async function expectHistoryScenarioPairMatches({
  control,
  greenVariants = [],
  candidate,
}: HistoryScenarioPair): Promise<void> {
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
        pendingWork: new Set(),
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

const {
  control: rekeyRouteReuseControl,
  candidate: rekeyRouteResurrectionScenario,
} = createRekeyRouteReuseScenarios({
  depth: 2,
  sourceBranch: 0,
  branches: transitionHistoryBranches,
  rekeyGroup: 2_100,
  insertedId: 3_000,
  insertedValue: 0,
  insertedPosition: 0,
})

const {
  control: childReplacementControl,
  candidate: movedSubtreeChildReplacementScenario,
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
    `rejects an omitted child at its first public checkpoint`,
    async () => {
      const row = { id: 1, parentGroup: 1, group: 1, value: 1, position: 0 }
      await expect(
        runTrace({
          steps: [
            { ...row, type: `put`, level: 0 },
            { ...row, type: `put`, level: 1 },
          ] as Array<HistoryAction>,
          driver: createStructuralTraceDriver(1),
          projection: {
            ...structuralProjection,
            observe: (context) => {
              const actual = structuralProjection.observe(context)
              if (!context.levels[0]!.has(row.id)) return actual
              // First verify the real query result. Then inject one plausible
              // wrong public result to calibrate the comparison at this cut.
              structuralProjection.assertEqual(
                actual,
                structuralProjection.recompute(context),
              )
              return [{ id: 1, group: 1, value: 1, position: 0, children: [] }]
            },
          },
        }),
      ).rejects.toMatchObject({ checkpoint: 3 })
    },
  )

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

  fcTest(`reconstructs every supported two-transition placement`, () => {
    // The generated green product is depth 1–4, both transition kinds in
    // both positions, and every supported insertion level. Rekey needs a
    // child level. Rekey with two descendant levels has narrower explicit
    // composed witnesses at [depth, target] = [3, 1] and [4, 2], but is
    // outside this generated green family.
    const expectedCounts = {
      reparent: { reparent: [1, 5, 9, 13], rekey: [0, 2, 2, 2] },
      rekey: { reparent: [0, 2, 2, 2], rekey: [0, 1, 1, 1] },
    } as const
    for (const depth of [1, 2, 3, 4] as const) {
      for (const first of [`reparent`, `rekey`] as const) {
        for (const second of [`reparent`, `rekey`] as const) {
          const placements = transitionHistoryPlacements(depth, first, second)
          expect(placements).toHaveLength(
            expectedCounts[first][second][depth - 1]!,
          )
          const [generated] = fc.sample(
            transitionHistoryScenariosArbitrary(depth, first, second, 0),
            { seed: 1725, numRuns: 1 },
          )
          expect(generated).toHaveLength(placements.length)
          for (const [index, scenario] of generated!.entries()) {
            const placement = placements[index]!
            const insertedLevels = scenario.steps
              .slice(scenario.historyStartStepIndex)
              .filter((step) =>
                step.changes.some((change) => change.type === `insert`),
              )
              .map((step) => step.level)
            expect(insertedLevels).toEqual(placement.insertedLevels)
            expectEveryHistoryStepVisible(scenario)
          }
        }
      }
    }

    // A nearby invalid history attempts to rekey without seeding the child
    // route. The constructor rejects it before the production driver runs.
    expect(() =>
      createTransitionHistoryScenario({
        depth: 3,
        targetLevel: 2,
        firstTransition: `rekey`,
        secondTransition: `reparent`,
        sourceBranch: 0,
        branches: transitionHistoryBranches,
        rekeyGroups: [2_100, 2_400],
        insertedLevels: [2, 2],
        insertedValues: [1, 2],
        insertedPositions: [-2, 2],
      }),
    ).toThrow(/Rekey histories must seed the new child route/)
  })

  fcTest(
    `keeps each route-history topology and destination in the grammar`,
    () => {
      expect(independentTransitionShapes).toEqual([
        `ancestor-descendant`,
        `descendant-ancestor`,
        `sibling`,
        `cross-branch`,
        `root`,
      ])
      expect(destinationHistories).toEqual([
        `fresh`,
        `restore`,
        `merge-split`,
        `retired`,
      ])
      const branches = transitionHistoryBranches
      const shapeTraces = independentTransitionShapes.map((shape) => {
        const descriptors = independentTransitionDescriptors(
          shape,
          branches,
          [2_100, 2_500],
        )
        const scenario = createRouteLifecycleScenario({
          depth: 3,
          branches,
          prefixSteps: independentTransitionPrefix(shape, branches),
          descriptors,
        })
        expectEveryRouteTransitionVisible(scenario)
        return JSON.stringify(
          scenario.transitionStepIndexes.map((stepIndex) =>
            relationshipOnly(
              recomputeFullRowBatchScenario(scenario, stepIndex + 1),
            ),
          ),
        )
      })
      // Removing one named shape drops one distinct public relationship trace.
      expect(new Set(shapeTraces).size).toBe(5)

      const destinationTraces = destinationHistories.map((history) => {
        const descriptors = destinationHistoryDescriptors(
          history,
          branches,
          2_100,
        )
        const scenario = createRouteLifecycleScenario({
          depth: 3,
          branches,
          descriptors,
        })
        expectEveryRouteTransitionVisible(scenario)
        return JSON.stringify(
          scenario.transitionStepIndexes.map((stepIndex) =>
            relationshipOnly(
              recomputeFullRowBatchScenario(scenario, stepIndex + 1),
            ),
          ),
        )
      })
      expect(new Set(destinationTraces).size).toBe(4)

      // The fixture bands admit both endpoints without overlapping route keys.
      for (const [idBase, groupBase, otherIdBase, otherGroupBase, fresh] of [
        [100, 600, 1_100, 1_600, 2_100],
        [500, 1_000, 1_500, 2_000, 2_400],
      ] as const) {
        const edgeBranches = [
          { idBase, groupBase },
          { idBase: otherIdBase, groupBase: otherGroupBase },
        ] as const
        for (const history of destinationHistories) {
          const scenario = createRouteLifecycleScenario({
            depth: 3,
            branches: edgeBranches,
            descriptors: destinationHistoryDescriptors(
              history,
              edgeBranches,
              fresh,
            ),
          })
          expectEveryRouteTransitionVisible(scenario)
        }
      }
    },
  )

  fcTest(`reconstructs and distinguishes the split/atomic batch matrix`, () => {
    const fixture = {
      leftIdBase: 100,
      leftGroupBase: 600,
      rightIdBase: 1_100,
      rightGroupBase: 1_600,
      replacementId: 3_000,
      replacementGroup: 2_700,
      replacementValue: -3,
      replacementPosition: -2,
      movedPosition: 2,
    }
    const candidate = (
      change: Partial<RelationshipBatchShape> = {},
    ): FullRowBatchScenario =>
      createRelationshipBatchShapeScenarios({
        ...fixture,
        shape: {
          delivery: `split`,
          order: `delete-insert`,
          publicId: `new`,
          route: `handoff`,
          ancestorUpdate: `route-only`,
          ...change,
        },
      }).candidate
    const final = (scenario: FullRowBatchScenario) =>
      recomputeFullRowBatchScenario(scenario, scenario.steps.length)

    let cells = 0
    for (const publicId of [`same`, `new`] as const) {
      for (const route of [`handoff`, `fresh`] as const) {
        for (const ancestorUpdate of [
          `route-only`,
          `route-and-position`,
        ] as const) {
          const matrix = createRelationshipBatchShapeMatrix(
            fixture,
            publicId,
            route,
            ancestorUpdate,
          )
          expect(matrix).toHaveLength(publicId === `same` ? 2 : 4)
          expect(matrix.map(({ shape }) => shape.delivery)).toContain(`split`)
          expect(matrix.map(({ shape }) => shape.delivery)).toContain(`atomic`)
          if (publicId === `same`)
            expect(
              matrix.every(({ shape }) => shape.order === `delete-insert`),
            ).toBe(true)
          else
            expect(matrix.map(({ shape }) => shape.order)).toContain(
              `insert-delete`,
            )
          cells += matrix.length
        }
      }
    }
    expect(cells).toBe(24)

    // Ablating any semantic axis removes a distinct public observation or
    // checkpoint. Delivery and order agree only at the terminal state: their
    // intermediate cuts, which the production driver checks, differ.
    const baseline = candidate()
    expect(final(candidate({ publicId: `same` }))).not.toEqual(final(baseline))
    expect(final(candidate({ route: `fresh` }))).not.toEqual(final(baseline))
    expect(
      final(candidate({ ancestorUpdate: `route-and-position` })),
    ).not.toEqual(final(baseline))
    const atomic = candidate({ delivery: `atomic` })
    expect(atomic.steps).toHaveLength(baseline.steps.length - 1)
    expect(final(atomic)).toEqual(final(baseline))
    const insertFirst = candidate({ order: `insert-delete` })
    expect(final(insertFirst)).toEqual(final(baseline))
    expect(
      recomputeFullRowBatchScenario(insertFirst, insertFirst.steps.length - 1),
    ).not.toEqual(
      recomputeFullRowBatchScenario(baseline, baseline.steps.length - 1),
    )

    // Same-id insert-before-delete is excluded from this grammar because its
    // intermediate cut can hold two rows with one public key. This check
    // proves the generator omits that schedule; it does not test a product
    // rejection. The fixture extremes stay within disjoint key bands.
    for (const edgeFixture of [
      fixture,
      {
        ...fixture,
        leftIdBase: 500,
        leftGroupBase: 1_000,
        rightIdBase: 1_500,
        rightGroupBase: 2_000,
        replacementId: 3_200,
        replacementGroup: 2_900,
        replacementValue: 3,
        replacementPosition: 2,
        movedPosition: -2,
      },
    ]) {
      const matrix = createRelationshipBatchShapeMatrix(
        edgeFixture,
        `same`,
        `handoff`,
        `route-only`,
      )
      expect(matrix.some(({ shape }) => shape.order === `insert-delete`)).toBe(
        false,
      )
      for (const { scenarios } of matrix) {
        expect(final(scenarios.candidate)).not.toEqual(final(scenarios.control))
      }
    }
  })

  fcTest(`keeps retired-route and moved-child matrix cuts distinct`, () => {
    for (const depth of [2, 3, 4] as const) {
      for (const sourceBranch of [0, 1] as const) {
        const [split] = fc.sample(
          rekeyRouteReuseScenarioArbitrary(depth, sourceBranch),
          { seed: 1726, numRuns: 1 },
        )
        const [atomic] = fc.sample(
          rekeyRouteReuseScenarioArbitrary(
            depth,
            sourceBranch,
            createIntraBatchRekeyRouteReuseScenarios,
          ),
          { seed: 1733, numRuns: 1 },
        )
        expect(split).toBeDefined()
        expect(atomic).toBeDefined()
        const outcome = (scenario: FullRowBatchScenario) =>
          relationshipOnly(
            recomputeFullRowBatchScenario(scenario, scenario.steps.length),
          )
        expect(outcome(split!.candidate)).not.toEqual(outcome(split!.control))
        expect(split!.candidate.steps).toHaveLength(
          split!.control.steps.length + 1,
        )
        expect(outcome(atomic!.candidate)).toEqual(outcome(atomic!.control))
        const controlLast = atomic!.control.steps.at(-1)!
        const candidateLast = atomic!.candidate.steps.at(-1)!
        expect(controlLast.changes.map(({ type }) => type)).toEqual([
          `insert`,
          `update`,
        ])
        expect(candidateLast.changes.map(({ type }) => type)).toEqual([
          `update`,
          `insert`,
        ])
      }
    }

    // Replacing a moved child needs a grandchild that can expose the route.
    // This is the depth/target-level range of the generated mirror family.
    for (const [depth, targetLevel] of [
      [3, 1],
      [4, 1],
      [4, 2],
    ] as const) {
      for (const sourceBranch of [0, 1] as const) {
        const [mirrors] = fc.sample(
          movedChildReplacementMirrorsArbitrary(
            depth,
            targetLevel,
            sourceBranch,
          ),
          { seed: 1727, numRuns: 1 },
        )
        for (const order of branchDeliveryOrders) {
          const pair = mirrors![order]
          const outcome = (scenario: FullRowBatchScenario) =>
            recomputeFullRowBatchScenario(scenario, scenario.steps.length)
          expect(pair.greenVariants).toHaveLength(2)
          expect(outcome(pair.candidate)).not.toEqual(outcome(pair.control))
          for (const atomic of pair.greenVariants!)
            expect(outcome(atomic)).toEqual(outcome(pair.candidate))
        }
      }
    }
    expect(() =>
      createMovedChildReplacementScenarios({
        depth: 3,
        targetLevel: 2,
        sourceBranch: 0,
        branches: transitionHistoryBranches,
        insertedId: 3_000,
        insertedValue: 0,
        insertedPosition: 0,
      }),
    ).toThrow(/needs a visible grandchild/)
  })

  fcTest(
    `a root entering a live route receives its ordered snapshot`,
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

      await expectFullRowBatchScenarioMatches(scenario)
    },
  )

  for (const [shapeIndex, shape] of independentTransitionShapes.entries()) {
    const property = `includes.matrix.independent-${shape}`
    const arbitrary = independentTransitionScenarioArbitrary(shape)
    for (const { label, options } of generatedCampaigns(
      4,
      property,
      1734 + shapeIndex,
    )) {
      fcTest.prop([arbitrary], options)(
        `matches recomputation for independent ${shape} relationship targets [${property}, ${label}]`,
        async (scenario) => {
          expectEveryRouteTransitionVisible(scenario)
          await expectFullRowBatchScenarioMatches(scenario)
        },
      )
    }
  }

  for (const [historyIndex, history] of destinationHistories.entries()) {
    const property = `includes.matrix.destination-${history}`
    const arbitrary = destinationHistoryScenarioArbitrary(history)
    for (const { label, options } of generatedCampaigns(
      4,
      property,
      1740 + historyIndex,
    )) {
      fcTest.prop([arbitrary], options)(
        `matches recomputation for the ${history} route destination history [${property}, ${label}]`,
        async (scenario) => {
          expectEveryRouteTransitionVisible(scenario)
          await expectFullRowBatchScenarioMatches(scenario)
        },
      )
    }
  }

  for (const parentLevel of [0, 1, 2] as const) {
    for (const enteringRow of [0, 1] as const) {
      fcTest(
        `matches recomputation when level-${parentLevel} row ${enteringRow} enters a live shared route`,
        () =>
          expectHistoryScenarioPairMatches(
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
        expectHistoryScenarioPairMatches(
          createSnapshotOnResubscribeScenarios(parentLevel),
        ),
    )

    fcTest(
      `matches recomputation when an initially shared level-${parentLevel} route retires, changes, and resubscribes`,
      () =>
        expectHistoryScenarioPairMatches(
          createInitiallySharedRouteResubscribeScenario(parentLevel),
        ),
    )
  }

  for (const materialization of [`array`, `concat`] as const) {
    fcTest(`${materialization} follows an intra-batch child hand-off`, () =>
      expectFlatMaterializationScenarioMatches(
        materialization,
        intraBatchChildHandOffScenario,
      ),
    )
  }

  for (const [depth, targetLevel] of [
    [3, 1],
    [4, 1],
    [4, 2],
  ] as const) {
    fcTest(
      `later updates propagate through a reparented subtree at depth ${depth}, level ${targetLevel}`,
      () =>
        expectFullRowBatchScenarioMatches(
          createReparentedSubtreeUpdateScenario(depth, targetLevel),
        ),
    )
  }

  fcTest(`rekeying a row detaches two descendant levels`, () =>
    expectFullRowBatchScenarioMatches(minimalRekeyScenario),
  )

  fcTest(`reusing a rekeyed row's old route does not resurrect its child`, () =>
    expectFullRowBatchScenarioMatches(rekeyRouteResurrectionScenario),
  )

  fcTest(
    `matches recomputation when sharing a route without rekeying its existing row`,
    () => expectFullRowBatchScenarioMatches(rekeyRouteReuseControl),
  )

  fcTest(`replacing a moved subtree child retains its grandchild`, () =>
    expectFullRowBatchScenarioMatches(movedSubtreeChildReplacementScenario),
  )

  fcTest(
    `matches recomputation when replacing a child without reparenting its ancestor`,
    () => expectFullRowBatchScenarioMatches(childReplacementControl),
  )

  for (const depth of [2, 3, 4] as const) {
    for (const sourceBranch of [0, 1] as const) {
      const retiredProperty = `includes.matrix.retired-route-${depth}-${sourceBranch}`
      const retiredArbitrary = rekeyRouteReuseScenarioArbitrary(
        depth,
        sourceBranch,
      )
      for (const { label, options } of generatedCampaigns(
        4,
        retiredProperty,
        1726 + depth * 10 + sourceBranch,
      )) {
        fcTest.prop([retiredArbitrary], options)(
          `reuses a retired route at depth ${depth}, branch ${sourceBranch} [${retiredProperty}, ${label}]`,
          expectHistoryScenarioPairMatches,
        )
      }

      const intraBatchProperty = `includes.matrix.intra-batch-route-${depth}-${sourceBranch}`
      const intraBatchArbitrary = rekeyRouteReuseScenarioArbitrary(
        depth,
        sourceBranch,
        createIntraBatchRekeyRouteReuseScenarios,
      )
      for (const { label, options } of generatedCampaigns(
        4,
        intraBatchProperty,
        1733 + depth * 10 + sourceBranch,
      )) {
        fcTest.prop([intraBatchArbitrary], options)(
          `handles intra-batch rekey then retired-route reuse at depth ${depth}, branch ${sourceBranch} [${intraBatchProperty}, ${label}]`,
          expectHistoryScenarioPairMatches,
        )
      }
    }
  }

  for (const parentLevel of [0, 1] as const) {
    fcTest(
      `a departed level-${parentLevel} shared-route subscriber ignores later child updates`,
      () =>
        expectHistoryScenarioPairMatches(
          createSharedRouteLifetimeScenarios(parentLevel),
        ),
    )
  }

  for (const depth of [3, 4] as const) {
    for (let targetLevel = 1; targetLevel <= depth - 2; targetLevel++) {
      for (const sourceBranch of [0, 1] as const) {
        const property = `includes.matrix.moved-child-${depth}-${targetLevel}-${sourceBranch}`
        const arbitrary = movedChildReplacementMirrorsArbitrary(
          depth,
          targetLevel as IncludeDepth,
          sourceBranch,
        )
        for (const { label, options } of generatedCampaigns(
          4,
          property,
          1727 + depth * 100 + targetLevel * 10 + sourceBranch,
        )) {
          fcTest.prop([arbitrary], options)(
            `matches forward/reverse delivery mirrors when replacing a moved child at depth ${depth}, level ${targetLevel}, source ${sourceBranch} [${property}, ${label}]`,
            async (scenarios) => {
              for (const deliveryOrder of branchDeliveryOrders) {
                await expectHistoryScenarioPairMatches(scenarios[deliveryOrder])
              }
            },
          )
        }
      }
    }
  }

  for (const [publicIdIndex, publicId] of (
    [`same`, `new`] as const
  ).entries()) {
    for (const [routeIndex, route] of (
      [`handoff`, `fresh`] as const
    ).entries()) {
      for (const [updateIndex, ancestorUpdate] of (
        [`route-only`, `route-and-position`] as const
      ).entries()) {
        const property = `includes.matrix.batch-${publicId}-${route}-${ancestorUpdate}`
        for (const { label, options } of generatedCampaigns(
          4,
          property,
          1738 + publicIdIndex * 100 + routeIndex * 10 + updateIndex,
        )) {
          fcTest.prop([relationshipBatchFixtureArbitrary], options)(
            `matches the split/atomic replacement matrix for ${publicId} public id, ${route} route, ${ancestorUpdate} [${property}, ${label}]`,
            async (fixture) => {
              const cells = createRelationshipBatchShapeMatrix(
                fixture,
                publicId,
                route,
                ancestorUpdate,
              )
              const finalStates = cells.map(({ scenarios: { candidate } }) =>
                recomputeFullRowBatchScenario(
                  candidate,
                  candidate.steps.length,
                ),
              )

              // Delivery boundaries and change order must not affect the final
              // recompute semantics for one generated fixture.
              expect(finalStates.length).toBeGreaterThan(1)
              for (const finalState of finalStates.slice(1)) {
                expect(finalState).toEqual(finalStates[0])
              }

              for (const {
                scenarios: { control, candidate },
              } of cells) {
                await expectFullRowBatchScenarioMatches(control)
                await expectFullRowBatchScenarioMatches(candidate)
              }
            },
          )
        }
      }
    }
  }

  const flatMaterializationProperty = `includes.matrix.flat-materialization`
  const flatMaterializationArbitraries: [
    fc.Arbitrary<FlatMaterialization>,
    fc.Arbitrary<FullRowBatchScenario>,
  ] = [
    fc.constantFrom<FlatMaterialization>(`array`, `concat`),
    flatMaterializationScenarioArbitrary,
  ]
  for (const { label, options } of generatedCampaigns(
    30,
    flatMaterializationProperty,
    1721,
  )) {
    fcTest.prop(flatMaterializationArbitraries, options)(
      `matches recomputation for flat materializations [${flatMaterializationProperty}, ${label}]`,
      (kind, scenario) =>
        expectFlatMaterializationScenarioMatches(kind, scenario),
    )
  }

  for (const depth of [1, 2, 3, 4] as const) {
    const property = `includes.matrix.full-row-${depth}`
    const arbitrary = fullRowBatchScenarioAtDepthArbitrary(depth)
    for (const { label, options } of generatedCampaigns(
      10,
      property,
      1719 + depth,
    )) {
      fcTest.prop([arbitrary], options)(
        `matches recomputation for visible multi-row batches at depth ${depth} [${property}, ${label}]`,
        expectFullRowBatchScenarioMatches,
      )
    }

    const transitions: Array<VisibleRelationshipTransition> = [
      `reparent`,
      `rekey`,
    ]
    for (const transition of transitions) {
      for (let targetLevel = 1; targetLevel <= depth; targetLevel++) {
        const visibleProperty = `includes.matrix.visible-${depth}-${transition}-${targetLevel}`
        const visibleArbitrary = visibleRelationshipScenarioArbitrary(
          depth,
          transition,
          targetLevel as IncludeDepth,
        )
        for (const { label, options } of generatedCampaigns(
          4,
          visibleProperty,
          1721 + depth + targetLevel,
        )) {
          fcTest.prop([visibleArbitrary], options)(
            `matches recomputation for a visible ${transition} at depth ${depth}, level ${targetLevel} [${visibleProperty}, ${label}]`,
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
                await expectFullRowBatchScenarioMatches(scenario)
              }
            },
          )
        }
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
          const property = `includes.matrix.transition-${depth}-${firstTransition}-${secondTransition}-${sourceBranch}`
          const arbitrary = transitionHistoryScenariosArbitrary(
            depth,
            firstTransition,
            secondTransition,
            sourceBranch,
          )
          for (const { label, options } of generatedCampaigns(
            3,
            property,
            1725 +
              depth * 100 +
              firstIndex * 10 +
              secondIndex * 2 +
              sourceBranch,
          )) {
            fcTest.prop([arbitrary], options)(
              `matches recomputation for ${firstTransition} → ${secondTransition} histories at depth ${depth}, branch ${sourceBranch} [${property}, ${label}]`,
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
  }

  for (const [depth, targetLevel] of [
    [3, 1],
    [4, 2],
  ] as const) {
    for (const sourceBranch of [0, 1] as const) {
      for (const [firstTransition, secondTransition] of [
        [`rekey`, `rekey`],
        [`rekey`, `reparent`],
        [`reparent`, `rekey`],
      ] as const) {
        fcTest(
          `matches composed ${firstTransition} → ${secondTransition} with two descendant levels at depth ${depth}, branch ${sourceBranch}`,
          async () => {
            const childLevel = (targetLevel + 1) as IncludeDepth
            const scenario = createTransitionHistoryScenario({
              depth,
              targetLevel,
              firstTransition,
              secondTransition,
              sourceBranch,
              branches: transitionHistoryBranches,
              rekeyGroups: [2_100, 2_400],
              insertedLevels: [childLevel, childLevel],
              insertedValues: [31, 47],
              insertedPositions: [1, -1],
            })
            expectEveryHistoryStepVisible(scenario)
            await expectFullRowBatchScenarioMatches(scenario)
          },
        )
      }
    }
  }

  fcTest(`nested scalar materialization follows a reference update`, () =>
    runTrace({
      steps: [
        { type: `insert`, insert: `root-1` },
        { type: `insert`, insert: `middle-1` },
        { type: `insert`, insert: `shared-1` },
        { type: `insert`, insert: `leaf-1` },
        { type: `redirectMiddle`, id: 1, sharedId: 2 },
      ],
      driver: createMaterializeTraceDriver(false),
      projection: materializeProjection,
    }),
  )

  fcTest(`matches recomputation for full-row sync batches`, async () => {
    await runTrace({
      steps: fullRowBatchTrace,
      driver: createFullRowBatchTraceDriver(1),
      projection: structuralProjection,
    })
  })

  fcTest(`a reinserted parent drops its old shared route`, () =>
    expectFullRowBatchScenarioMatches(fullRowSharedRoutingSeed),
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

  for (const { label, options } of generatedCampaigns(
    40,
    `includes.incremental-history`,
    1711,
  )) {
    fcTest.prop([scenarioArbitrary], options)(
      `matches naive recomputation after every incremental change [${label}]`,
      expectScenarioMatches,
    )
  }

  const distinctMaterializationArbitrary = materializeScenarioArbitrary.filter(
    ({ sharedIntermediate }) => !sharedIntermediate,
  )
  for (const { label, options } of generatedCampaigns(
    30,
    `includes.nested-scalar-materialization`,
    1712,
  )) {
    fcTest.prop([distinctMaterializationArbitrary], options)(
      `matches recomputation for nested scalar materialization [${label}]`,
      expectMaterializeScenarioMatches,
    )
  }

  const alphaArbitraries: [
    fc.Arbitrary<Array<RootRow>>,
    fc.Arbitrary<Array<ChildRow>>,
  ] = [
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
  ]
  for (const { label, options } of generatedCampaigns(
    25,
    `includes.alpha-renaming`,
    1713,
  )) {
    fcTest.prop(alphaArbitraries, options)(
      `is unchanged by alpha-renaming, sibling declaration order, or an unrelated sibling [${label}]`,
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
                  .select(({ child }) => ({
                    id: child.id,
                    value: child.value,
                  })),
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

          // The outer queries have no orderBy: this retains their traversal
          // equivalence witness, not a general root-order contract. Child order
          // remains explicit and must not be normalized away.
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
  }

  const confirmedValueArbitrary = fc
    .integer({ min: -5, max: 5 })
    .filter((value) => value !== 0)
  for (const { label, options } of generatedCampaigns(
    15,
    `includes.optimistic-convergence`,
    1714,
  )) {
    fcTest.prop([confirmedValueArbitrary], options)(
      `optimistic updates converge to confirmed-only state [${label}]`,
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

        const pending = new Set<PendingWork>()
        await withPendingWorkCleanup(
          pending,
          [live, roots.collection, children.collection],
          async () => {
            await live.preload()
            const transaction = children.collection.update(1, (draft) => {
              draft.value = confirmedValue
            })
            const entry = trackPendingWork(
              pending,
              transaction,
              children.resolveSync,
            )
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
            releasePendingWork(pending, entry, children.resolveSync)
            await transaction.isPersisted.promise

            expect(stripVirtualProperties(live.toArray)).toEqual([
              { id: 1, children: [{ id: 1, value: confirmedValue }] },
            ])
          },
        )
      },
    )
  }

  fcTest(`confirmed child reorder matches recomputation`, () =>
    expectScenarioMatches(confirmedChildReorderSeed),
  )

  fcTest(`shared scalar materialization preserves the deepest row`, () =>
    expectMaterializeScenarioMatches(sharedMaterializeSeed),
  )
})

/**
 * # Does an alias name in one scope leak into another?
 *
 * Law: ARCHITECTURE.md normative law 1. Changing an accepted alias in a
 * structured plan to another legal name cannot change an explicitly projected
 * result when its references are renamed with it. Alias-observing functional
 * callbacks are outside this equivalence. Aliases are lexical names; a
 * `SourceId` is the plan's identity for one Collection reference
 * (§Identity). Sibling scopes may reuse names, and a nested scope may shadow
 * an ancestor while captured references retain their original binding.
 *
 * Bug class: a plan rewrite loses a `SourceId`, or alias text otherwise
 * decides which source's input, request, or remap is used. A sibling source
 * with the same name then supplies the wrong rows. Issue #1975 reached it
 * through optimizer predicate pushdown into a joined `from()` subquery.
 *
 * Grammar, model, driver, and observation live in
 * `includes-scope-identity-oracle.ts`. The grammar crosses three topologies
 * that place a rewritable source beside a same-named sibling source:
 * `fromSubquery`, `unionBranch`, and a top-level pure `wrapper` beside a join
 * subquery. The subquery varies joins (none, refs, refs then notes), LEFT or
 * INNER refs joins, zero to two predicates in separate or combined form, a
 * plain, ordered-and-limited, or DISTINCT body, and whole-row or field
 * selection. The include varies its body (direct, joined, a `unionAll()`
 * with an anchor join, or a `from()` subquery that reads the parent row),
 * `toArray()` or `materialize()`, its source, an extra child predicate, and
 * outer spread or field selection. Sources are
 * eager or on-demand finite providers. Alias slots draw from a three-name
 * pool, so cross-scope reuse is frequent.
 *
 * Legality follows the documented lexical rules: one scope and the branches
 * of one `unionAll()` keep their names distinct; ancestor shadowing is legal.
 * One in four scenarios draws any naming. A same-scope or union-branch repeat
 * must be rejected when the query is created. The exact-key companion
 * `includes-alias-shadowing-oracle.test.ts` checks public aliases that this
 * model intentionally removes from explicitly projected rows.
 *
 * Checks at each checkpoint (after preload and after every source write):
 *
 * 1. The canonical all-distinct naming equals a plain recomputation of the
 *    current source rows. This judges the shape independently of aliases.
 * 2. The generated naming equals the canonical naming. This is the law.
 * 3. For on-demand sources, each Collection receives the same `loadSubset`
 *    WHERE clauses under both namings. Requests name Collection fields, not
 *    aliases, so they must match exactly as bags.
 *
 * Limits: the model covers this grammar only. Rows and members are compared
 * as bags because no query here promises an order. Public key shape,
 * publication events, observer timing, unload, and nested includes are outside
 * this owner; the exact-key, publication, and recomputation owners cover their
 * stated shapes.
 * The review record is
 * `docs/contributing/oracle-reviews/issue-1975-scope-identity.md`.
 */
async function expectScopedNamingRejected(
  scenario: ScopedScenario,
  naming: `sameScope`,
) {
  const sources = createScopedSources(scenario)
  let created: ReturnType<typeof createScopedQuery> | undefined
  try {
    expect(
      () => {
        created = createScopedQuery(scenario.shape, scenario.aliases, sources)
      },
      `${naming} naming ${JSON.stringify(scenario.aliases)} must be rejected`,
    ).toThrow()
  } finally {
    await created?.cleanup()
    await Promise.all(
      Object.values(sources).map((source) => source.collection.cleanup()),
    )
  }
}

async function expectScopedAlphaRenamingHolds(
  scenario: ScopedScenario,
  expectedAfterPreload?: Array<ScopedResultRow>,
) {
  const naming = classifyScopedNaming(scenario.shape, scenario.aliases)
  if (naming === `sameScope`) {
    await expectScopedNamingRejected(scenario, naming)
    return
  }
  const canonicalNames = canonicalScopedAliases(scenario.shape)
  const canonicalSources = createScopedSources(scenario)
  const renamedSources = createScopedSources(scenario)
  const state = createModelState(scenario)
  const canonical = createScopedQuery(
    scenario.shape,
    canonicalNames,
    canonicalSources,
  )
  const renamed = createScopedQuery(
    scenario.shape,
    scenario.aliases,
    renamedSources,
  )

  const check = (checkpoint: string) => {
    const label = `${checkpoint}, naming ${JSON.stringify(scenario.aliases)}`
    expect(
      normalizeScopedRows(canonical.toArray),
      `${label}: canonical naming against recomputation`,
    ).toEqual(normalizeScopedRows(recomputeScopedRows(scenario.shape, state)))
    expect(
      normalizeScopedRows(renamed.toArray),
      `${label}: generated naming against canonical naming`,
    ).toEqual(normalizeScopedRows(canonical.toArray))
    if (scenario.mode === `onDemand`) {
      expect(
        sortedRequests(renamedSources),
        `${label}: loadSubset requests per Collection`,
      ).toEqual(sortedRequests(canonicalSources))
    }
  }

  let primary: unknown
  try {
    await Promise.all([canonical.preload(), renamed.preload()])
    await flushPromises()
    if (expectedAfterPreload) {
      expect(normalizeScopedRows(canonical.toArray)).toEqual(
        normalizeScopedRows(expectedAfterPreload),
      )
    }
    check(`after preload`)
    for (const [index, write] of scenario.writes.entries()) {
      applyScopedWrite([canonicalSources, renamedSources], state, write)
      await flushPromises()
      check(`after write ${index} (${JSON.stringify(write)})`)
    }
  } catch (error) {
    primary = error
  }

  // Cleanup failures must not replace the violated law.
  const cleanup = await Promise.allSettled([
    canonical.cleanup(),
    renamed.cleanup(),
    ...[canonicalSources, renamedSources].flatMap((sources) =>
      Object.values(sources).map((source) => source.collection.cleanup()),
    ),
  ])
  const cleanupErrors = cleanup.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (primary !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primary, ...cleanupErrors],
      `scoped alpha-renaming failed, and cleanup also failed`,
      { cause: primary },
    )
  }
  if (primary !== undefined) throw primary
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `scoped oracle cleanup failed`)
  }
}

const scopedPartRows: Array<ScopedPart> = [
  { id: 1, active: true },
  { id: 2, active: true },
  { id: 3, active: false },
]
const scopedRefRows: Array<ScopedRef> = [
  { id: 10, partId: 1, clientId: 1 },
  { id: 11, partId: 1, clientId: 2 },
  { id: 20, partId: 2, clientId: 2 },
  { id: 30, partId: 3, clientId: 1 },
]
const scopedNoteRows: Array<ScopedRef> = [
  { id: 100, partId: 1, clientId: 1 },
  { id: 200, partId: 2, clientId: 1 },
]

function pinnedScenario(
  shape: ScopedShape,
  aliases: ScopedAliases,
): ScopedScenario {
  return {
    shape,
    mode: `eager`,
    aliases,
    parts: scopedPartRows,
    refs: scopedRefRows,
    notes: scopedNoteRows,
    writes: [],
  }
}

/**
 * Each optimizer witness failed on the unrepaired optimizer and passes with
 * the repair. The joined-union witness guards a legal naming that an
 * overbroad shadowing check once rejected. Together they reach every optimizer site that once re-minted a
 * SourceId; the review record maps each site to its killing witness.
 */
const pinnedScopeWitnesses: Array<[string, ScopedScenario]> = [
  [
    `an include reuses the join alias of a joined subquery`,
    pinnedScenario(
      {
        topology: `fromSubquery`,
        subquery: {
          ...plainSubquery,
          predicates: [`joinedClient`, `subActive`],
        },
        include: { ...refsInclude, form: `materialize` },
      },
      { outer: `part`, sub: `part`, joined: `ref`, noted: `n`, include: `ref` },
    ),
  ],
  [
    `an include reuses the second join alias`,
    pinnedScenario(
      {
        topology: `fromSubquery`,
        subquery: { ...plainSubquery, joins: `refsThenNotes` },
        include: refsInclude,
      },
      { outer: `o`, sub: `s`, joined: `j`, noted: `k`, include: `k` },
    ),
  ],
  [
    `an include reuses the source alias of an ordered, limited subquery`,
    pinnedScenario(
      {
        topology: `fromSubquery`,
        subquery: { ...plainSubquery, body: `orderedLimit` },
        include: refsInclude,
      },
      { outer: `o`, sub: `p`, joined: `j`, noted: `n`, include: `p` },
    ),
  ],
  [
    `an include reuses the source alias of a DISTINCT subquery`,
    pinnedScenario(
      {
        topology: `fromSubquery`,
        subquery: { ...plainSubquery, body: `distinct`, subSelect: `fields` },
        include: refsInclude,
      },
      { outer: `o`, sub: `p`, joined: `j`, noted: `n`, include: `p` },
    ),
  ],
  [
    `an include reuses the source alias of a joined union branch`,
    pinnedScenario(
      {
        topology: `unionBranch`,
        subquery: { ...plainSubquery, subSelect: `fields` },
        include: refsInclude,
      },
      {
        outer: `o`,
        sub: `x`,
        joined: `j`,
        noted: `n`,
        include: `x`,
        inactive: `y`,
      },
    ),
  ],
  [
    `an include on a joined union reuses a branch alias`,
    pinnedScenario(
      { topology: `unionParent`, includeSource: `refs` },
      { activeBranch: `x`, inactiveBranch: `y`, anchor: `a`, include: `x` },
    ),
  ],
  [
    `an include shadows its parent source alias`,
    {
      ...pinnedScenario(
        {
          topology: `fromSubquery`,
          subquery: plainSubquery,
          include: refsInclude,
        },
        { outer: `x`, sub: `p`, joined: `j`, noted: `n`, include: `x` },
      ),
      writes: [
        {
          source: `refs`,
          type: `put`,
          row: { id: 40, partId: 2, clientId: 1 },
        },
        { source: `parts`, type: `put`, row: { id: 4, active: true } },
      ],
    },
  ],
  [
    `a nested include source shadows its outer include source`,
    pinnedScenario(
      {
        topology: `fromSubquery`,
        subquery: plainSubquery,
        include: { ...refsInclude, body: `nestedFrom` },
      },
      {
        outer: `o`,
        sub: `p`,
        joined: `j`,
        noted: `n`,
        includeOuter: `x`,
        include: `x`,
      },
    ),
  ],
  [
    `a join subquery reuses the alias of a collapsed pure wrapper`,
    pinnedScenario(
      { topology: `wrapper`, wrapperJoin: `inner` },
      { wrapped: `x`, joinSub: `k`, joinSource: `x` },
    ),
  ],
]

describe(`includes alpha-renaming across lexical scopes`, () => {
  fcTest(
    `an include that reuses a joined subquery alias keeps the reported rows`,
    // Issue #1975: only part 1 has a ref for client 1; parts 1 and 2 are
    // active.
    () =>
      expectScopedAlphaRenamingHolds(
        {
          ...pinnedScopeWitnesses[0]![1],
          parts: [
            { id: 1, active: true },
            { id: 2, active: true },
          ],
          refs: [
            { id: 10, partId: 1, clientId: 1 },
            { id: 20, partId: 2, clientId: 2 },
          ],
          notes: [],
        },
        [{ id: 1, active: true, members: [{ id: 10, clientId: 1 }] }],
      ),
  )

  for (const [name, scenario] of pinnedScopeWitnesses) {
    for (const mode of [`eager`, `onDemand`] as const) {
      fcTest(`${name} [${mode}]`, () =>
        expectScopedAlphaRenamingHolds({ ...scenario, mode }),
      )
    }
  }

  for (const { label, options } of generatedCampaigns(
    80,
    `includes.scoped-alpha-renaming`,
    1715,
  )) {
    fcTest.prop([scopedScenarioArbitrary], options)(
      `is unchanged when lexical scopes reuse alias names [${label}]`,
      (scenario) => expectScopedAlphaRenamingHolds(scenario),
      // Each run builds four live queries; scale with the run budget.
      Math.max(5_000, oracleRuns(80) * 50),
    )
  }
})
