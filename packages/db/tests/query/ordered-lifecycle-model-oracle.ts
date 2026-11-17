/**
 * The finite grammars, the nullable-order model and its palette, and the
 * initial-settlement model and check of
 * `ordered-lifecycle-oracle.property.test.ts`, moved unchanged so that the
 * grammar and model checks in `ordered-lifecycle-model.test.ts` can read
 * them. That oracle file states the law and its authority. This module
 * registers no tests.
 */
import { isDeepStrictEqual } from 'node:util'
import { expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { fullSourceFeatures } from './ordered-lifecycle-support.js'
import type {
  InitialSettlementObservation,
  InitialSettlementShape,
} from './ordered-lifecycle-support.js'

export type OrderTerm = { direction: `asc` | `desc`; nulls: `first` | `last` }
export type AcquisitionPath = `page` | `prefix` | `boundary` | `full-source`
// The controlled providerResponse gate models a provider response, not the
// loadSubset result. Both delivery schedules await establishing applied receipts
// before acquisition fulfillment; only their order around this response differs.
export type Scenario = {
  acquisitionPath: AcquisitionPath
  delivery: `before-provider-response` | `after-provider-response`
  window: `keep` | `widen`
  outcome: `resolve` | `reject` | `abort-error`
  syncRun: `retain` | `restart`
  barrier: `initial` | `replay`
  rankOffset?: number
  rankStep?: number
  nullable?: { primary: OrderTerm; secondary: OrderTerm }
  repair?: boolean
}

export function compareNullable(
  left: unknown,
  right: unknown,
  term: OrderTerm,
): number {
  if (left === right) return 0
  if (left === null) return term.nulls === `first` ? -1 : 1
  if (right === null) return term.nulls === `first` ? 1 : -1
  if (typeof left !== `number` || typeof right !== `number`)
    throw new Error(`numeric/null palette only`)
  return (left < right ? -1 : 1) * (term.direction === `asc` ? 1 : -1)
}

// This fixed nine-row palette is a second formulation of the nullable order.
// Primary groups are null, -2, +2; each group has secondary null, +2, -2.
// The table states the expected group order without calling compareNullable.
// Each unique ID occurs once. This checks the full ID order; the warm zero-window
// witness and lifecycle result checks own emptiness and row payloads.
export function expectedNullablePaletteIds(
  primary: OrderTerm,
  secondary: OrderTerm,
): Array<number> {
  const primaryGroups = {
    'first/asc': [0, 1, 2],
    'first/desc': [0, 2, 1],
    'last/asc': [1, 2, 0],
    'last/desc': [2, 1, 0],
  } as const
  const secondaryPositions = {
    'first/asc': [0, 2, 1],
    'first/desc': [0, 1, 2],
    'last/asc': [2, 1, 0],
    'last/desc': [1, 2, 0],
  } as const
  return primaryGroups[`${primary.nulls}/${primary.direction}`].flatMap(
    (group) =>
      secondaryPositions[`${secondary.nulls}/${secondary.direction}`].map(
        (position) => 3 * group + position + 1,
      ),
  )
}

/**
 * The nullable reference order, compareNullable over the nine-row palette with
 * ties by ID, must list IDs in the order that expectedNullablePaletteIds states
 * for these term directions and null placements. The palette is written as a
 * table, so this comparison is the refinement check of the reference against it.
 */
export function expectNullableOrderMatchesPalette(
  primary: OrderTerm,
  secondary: OrderTerm,
): void {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    primary: [null, -2, 2][Math.floor(index / 3)]!,
    secondary: [null, 2, -2][index % 3]!,
  }))
  const actual = [...rows]
    .sort(
      (a, b) =>
        compareNullable(a.primary, b.primary, primary) ||
        compareNullable(a.secondary, b.secondary, secondary) ||
        a.id - b.id,
    )
    .map(({ id }) => id)
  expect(actual).toEqual(expectedNullablePaletteIds(primary, secondary))
}

export const acquisitionPaths: ReadonlyArray<AcquisitionPath> = [
  `page`,
  `prefix`,
  `boundary`,
  `full-source`,
]

export function expectedInitialSettlementObservation(
  settlement: InitialSettlementShape,
): InitialSettlementObservation {
  return settlement === `synchronous`
    ? { rows: [1, 2], status: `ready` }
    : { rows: [], status: `loading` }
}

export function assertInitialSettlementObservation(
  observed: InitialSettlementObservation,
  settlement: InitialSettlementShape,
): void {
  const expected = expectedInitialSettlementObservation(settlement)
  if (!isDeepStrictEqual(observed, expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(observed)}`,
    )
  }
}

export const initialSettlementCells = ([`eager`, `off`] as const).flatMap(
  (autoIndex) =>
    ([`synchronous`, `promise`] as const).map((settlement) => ({
      autoIndex,
      settlement,
    })),
)

export const lifecycleProductCells: Array<Scenario> = acquisitionPaths.flatMap(
  (acquisitionPath) =>
    ([`before-provider-response`, `after-provider-response`] as const).flatMap(
      (delivery) =>
        ([`keep`, `widen`] as const).flatMap((window) =>
          ([`resolve`, `reject`, `abort-error`] as const).flatMap((outcome) =>
            ([`retain`, `restart`] as const).flatMap((syncRun) =>
              ([`initial`, `replay`] as const).map((barrier) => ({
                acquisitionPath,
                delivery,
                window,
                outcome,
                syncRun,
                barrier,
              })),
            ),
          ),
        ),
    ),
)

export const initialFallbackCells = ([`eager`, `off`] as const).flatMap(
  (autoIndex) =>
    ([`synchronous`, `promise`] as const).flatMap((settlement) =>
      ([`distinct`, `tied`] as const).map((order) => ({
        autoIndex,
        settlement,
        order,
      })),
    ),
)

export const nullableLifecycleCells: Array<Scenario> = (
  [`first`, `last`] as const
)
  .flatMap((primaryNulls) =>
    ([`first`, `last`] as const).flatMap((secondaryNulls) =>
      ([`prefix`, `boundary`] as const).flatMap((acquisitionPath) =>
        ([`resolve`, `repair`, `restart`] as const).map(
          (mode) =>
            ({
              nullable: {
                primary: { direction: `asc`, nulls: primaryNulls },
                secondary: { direction: `desc`, nulls: secondaryNulls },
              },
              acquisitionPath:
                acquisitionPath === `boundary` && primaryNulls === `first`
                  ? `full-source`
                  : acquisitionPath,
              delivery: `before-provider-response`,
              window: `widen`,
              outcome: mode === `repair` ? `reject` : `resolve`,
              syncRun: mode === `restart` ? `restart` : `retain`,
              barrier: mode === `repair` ? `replay` : `initial`,
              repair: mode === `repair`,
            }) as const,
        ),
      ),
    ),
  )
  // Null-leading completion acquires full source and retires its prefix.
  // Replay can hold that full demand, but cannot target the retired prefix.
  .filter(
    (scenario) =>
      !(
        scenario.nullable.primary.nulls === `first` &&
        scenario.acquisitionPath === `prefix` &&
        scenario.repair
      ),
  )
export const nullableDirectionCells = ([`asc`, `desc`] as const).flatMap(
  (primaryDirection) =>
    ([`asc`, `desc`] as const).map((secondaryDirection) => ({
      primaryDirection,
      secondaryDirection,
    })),
)

export const nullableLifecycleArbitrary = fc
  .record({
    scenario: fc.constantFrom(...nullableLifecycleCells),
    primaryDirection: fc.constantFrom(`asc` as const, `desc` as const),
    secondaryDirection: fc.constantFrom(`asc` as const, `desc` as const),
    rankOffset: fc.integer({ min: -20, max: 20 }),
    rankStep: fc.integer({ min: 1, max: 5 }),
  })
  .map(
    ({
      scenario,
      primaryDirection,
      secondaryDirection,
      rankOffset,
      rankStep,
    }): Scenario => ({
      ...scenario,
      rankOffset,
      rankStep,
      nullable: {
        primary: {
          ...scenario.nullable!.primary,
          direction: primaryDirection,
        },
        secondary: {
          ...scenario.nullable!.secondary,
          direction: secondaryDirection,
        },
      },
    }),
  )

export const fullSourceSettlementCells = fullSourceFeatures.flatMap((feature) =>
  ([`synchronous`, `promise`] as const).map((settlement) => ({
    feature,
    settlement,
  })),
)
