// Grammar and model checks for the includes recompute oracle in
// includes-oracle.property.test.ts. They run no production: each builds
// route-history scenarios from the grammar and steps the independent
// relationship model over them, so they test the oracle's own grammar.
import { fc } from '@fast-check/vitest'
import { describe, expect, test } from 'vitest'
import { oracleFixedSeed } from '../oracle-config.js'
import {
  createRouteLifecycleScenario,
  rowAt,
  transitionHistoryBranches,
} from './includes-route-grammar-oracle.js'
import {
  branchDeliveryOrders,
  createIntraBatchRekeyRouteReuseScenarios,
  createMovedChildReplacementScenarios,
  createRelationshipBatchShapeMatrix,
  createRelationshipBatchShapeScenarios,
  createTransitionHistoryScenario,
  destinationHistories,
  destinationHistoryDescriptors,
  expectEveryHistoryStepVisible,
  expectEveryRouteTransitionVisible,
  hasDirectChild,
  independentTransitionDescriptors,
  independentTransitionPrefix,
  independentTransitionShapes,
  movedChildReplacementMirrorsArbitrary,
  recomputeFullRowBatchScenario,
  rekeyRouteReuseScenarioArbitrary,
  relationshipOnly,
  transitionHistoryPlacements,
  transitionHistoryScenariosArbitrary,
} from './includes-history-grammar-oracle.js'
import type { FullRowBatchScenario } from './includes-route-grammar-oracle.js'
import type { RelationshipBatchShape } from './includes-history-grammar-oracle.js'

describe(`includes recompute oracle grammar`, () => {
  test(`the sibling topology targets rows under one parent`, () => {
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

  test(`the descendant remains attached before its ancestor moves`, () => {
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

  test(`reconstructs every supported two-transition placement`, () => {
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
            oracleFixedSeed(1725, { numRuns: 1 }),
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

  test(`keeps each route-history topology and destination in the grammar`, () => {
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
  })

  test(`reconstructs and distinguishes the split/atomic batch matrix`, () => {
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

  test(`keeps retired-route and moved-child matrix cuts distinct`, () => {
    for (const depth of [2, 3, 4] as const) {
      for (const sourceBranch of [0, 1] as const) {
        const [split] = fc.sample(
          rekeyRouteReuseScenarioArbitrary(depth, sourceBranch),
          oracleFixedSeed(1726, { numRuns: 1 }),
        )
        const [atomic] = fc.sample(
          rekeyRouteReuseScenarioArbitrary(
            depth,
            sourceBranch,
            createIntraBatchRekeyRouteReuseScenarios,
          ),
          oracleFixedSeed(1733, { numRuns: 1 }),
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
          oracleFixedSeed(1727, { numRuns: 1 }),
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
})
