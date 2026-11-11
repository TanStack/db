import { expect } from 'vitest'
import { oracleAssertion } from '../oracle-assertion-adapter.js'
import {
  compareChildren,
  normalizeNested,
} from './includes-cross-formulation-support.js'
import type {
  ChildRow,
  NormalizedParent,
  ParentRow,
} from './includes-cross-formulation-support.js'

// The independent relationship model, the TLP partition check, and the two
// named scenarios of the cross-formulation oracle. They moved here unchanged
// from includes-cross-formulation-oracle.property.test.ts so that its ordinary
// model and checker calibrations in includes-cross-formulation.test.ts can
// import them without registering the oracle's properties again. This module
// registers no tests.

export type CrossFormulationAction =
  // `put` is model shorthand for a Collection insert when the id is absent
  // and a Collection update when it is present. Deletes of absent ids are
  // model no-ops; the driver does not send a source change for them.
  | { type: `putParent`; row: ParentRow }
  | { type: `deleteParent`; id: number }
  | { type: `putChild`; row: ChildRow }
  | { type: `deleteChild`; id: number }

export type CrossFormulationScenario = {
  parents: Array<ParentRow>
  children: Array<ChildRow>
  pivot: number
  actions: Array<CrossFormulationAction>
}

// This is the independent relationship model. It uses only current source
// Maps, strict group equality, and the declared total orders.
export function recomputeNestedModel(
  parents: Map<number, ParentRow>,
  children: Map<number, ChildRow>,
): Array<NormalizedParent> {
  return normalizeNested(
    [...parents.values()].map((parent) => ({
      ...parent,
      children: [...children.values()].filter(
        (child) => child.parentGroup === parent.group,
      ),
    })),
  )
}

export function recomputeWindowedModel(
  parents: ReadonlyMap<number, ParentRow>,
  children: ReadonlyMap<number, ChildRow>,
  offset: number,
  limit: number,
): Array<NormalizedParent> {
  return normalizeNested(
    [...parents.values()].map((parent) => ({
      ...parent,
      children: [...children.values()]
        .filter((child) => child.parentGroup === parent.group)
        .sort(compareChildren)
        .slice(offset, offset + limit),
    })),
  )
}

export function assertTlpPartitions(
  results: ReadonlyArray<ReadonlyArray<ChildRow>>,
  sourceRows: ReadonlyArray<ChildRow>,
  pivot: number,
  context: string,
): void {
  const partitions = [`predicate`, `complement`, `unknown`] as const
  oracleAssertion(
    'includes cross-formulation-oracle.property comparison 318',
    () =>
      expect(results, `${context} partition count`).toHaveLength(
        partitions.length,
      ),
  )
  for (const [index, partition] of partitions.entries()) {
    // This is a direct finite relation over source values, independent of the
    // query evaluator. A union could be complete with rows in wrong branches.
    const expected = sourceRows
      .filter((child) => {
        if (child.score === null) return partition === `unknown`
        return partition === (child.score < pivot ? `predicate` : `complement`)
      })
      .sort(compareChildren)
    oracleAssertion(
      'includes cross-formulation-oracle.property comparison 328',
      () =>
        expect(results[index], `${context} ${partition} partition`).toEqual(
          expected,
        ),
    )
  }
}

export const sharedRouteDeletionScenario: CrossFormulationScenario = {
  parents: [
    { id: 0, group: 0, position: 0 },
    { id: 1, group: 0, position: 0 },
  ],
  children: [
    { id: 10, parentGroup: 0, score: null, position: 0 },
    { id: 11, parentGroup: 0, score: null, position: 0 },
    { id: 12, parentGroup: 0, score: null, position: 0 },
  ],
  pivot: 0,
  actions: [{ type: `deleteChild`, id: 10 }],
}

export const partitionAndRouteScenario: CrossFormulationScenario = {
  parents: [
    { id: 0, group: 0, position: 1 },
    { id: 1, group: 0, position: 0 },
  ],
  children: [
    { id: 10, parentGroup: 0, score: null, position: 2 },
    { id: 11, parentGroup: 0, score: -1, position: 1 },
    { id: 12, parentGroup: 1, score: 1, position: 0 },
  ],
  pivot: 0,
  actions: [
    { type: `putParent`, row: { id: 0, group: 1, position: 1 } },
    {
      type: `putChild`,
      row: { id: 12, parentGroup: 0, score: 1, position: 0 },
    },
    { type: `putParent`, row: { id: 0, group: 0, position: -1 } },
  ],
}
