// Grammar and model checks for ordered-lifecycle-oracle.property.test.ts.
// They run no production: each finite grammar names each cell once, the
// nullable-order model agrees with its independent palette table, the
// initial-settlement check rejects the old Promise-wrapped observation, and
// the fixed-seed nullable grammar generates every value and lifecycle
// dimension. The law and the production comparisons are in that oracle file;
// the grammars, models, and checks are in ordered-lifecycle-model-oracle.ts.
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleFixedSeed } from '../oracle-config.js'
import {
  assertInitialSettlementObservation,
  expectNullableOrderMatchesPalette,
  expectedInitialSettlementObservation,
  fullSourceSettlementCells,
  initialFallbackCells,
  initialSettlementCells,
  lifecycleProductCells,
  nullableDirectionCells,
  nullableLifecycleArbitrary,
  nullableLifecycleCells,
} from './ordered-lifecycle-model-oracle.js'

describe(`synchronous initial settlement refinement`, () => {
  it(`enumerates every initial path and settlement cell exactly once`, () => {
    expect(initialSettlementCells).toHaveLength(4)
    expect(
      new Set(initialSettlementCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(4)
  })

  it(`rejects the old Promise-wrapped observation at the synchronous checkpoint`, () => {
    expect(() =>
      assertInitialSettlementObservation(
        expectedInitialSettlementObservation(`promise`),
        `synchronous`,
      ),
    ).toThrow()
  })
})

describe(`ordered lifecycle product`, () => {
  it(`keeps all 192 declared histories distinct`, () => {
    expect(lifecycleProductCells).toHaveLength(192)
    expect(
      new Set(lifecycleProductCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(192)
  })
})

describe(`initial locale-string fallback oracle`, () => {
  it(`enumerates every index, settlement, and row-order cell exactly once`, () => {
    expect(initialFallbackCells).toHaveLength(8)
    expect(
      new Set(initialFallbackCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(8)
  })
})

describe(`nullable multi-term lifecycle product`, () => {
  it(`anchors the nullable reference and controlled provider to an independent order palette`, () => {
    for (const primaryNulls of [`first`, `last`] as const)
      for (const primaryDirection of [`asc`, `desc`] as const)
        for (const secondaryNulls of [`first`, `last`] as const)
          for (const secondaryDirection of [`asc`, `desc`] as const) {
            const primary = {
              nulls: primaryNulls,
              direction: primaryDirection,
            }
            const secondary = {
              nulls: secondaryNulls,
              direction: secondaryDirection,
            }
            expectNullableOrderMatchesPalette(primary, secondary)
          }
  })

  it(`enumerates every nullable lifecycle and direction-overlay cell exactly once`, () => {
    expect(nullableLifecycleCells).toHaveLength(22)
    expect(
      new Set(nullableLifecycleCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(22)
    expect(
      nullableLifecycleCells.some(
        (scenario) =>
          scenario.nullable?.primary.nulls === `first` &&
          scenario.acquisitionPath === `prefix` &&
          scenario.repair,
      ),
    ).toBe(false)
    expect(nullableDirectionCells).toHaveLength(4)
    expect(
      new Set(nullableDirectionCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(4)
  })

  it(`generates the nullable value and lifecycle dimensions`, () => {
    const sample = fc.sample(
      nullableLifecycleArbitrary,
      oracleFixedSeed(93472, { numRuns: 100 }),
    )
    expect(new Set(sample.map((scenario) => scenario.acquisitionPath))).toEqual(
      new Set([`prefix`, `boundary`, `full-source`]),
    )
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.primary.nulls)),
    ).toEqual(new Set([`first`, `last`]))
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.secondary.nulls)),
    ).toEqual(new Set([`first`, `last`]))
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.primary.direction)),
    ).toEqual(new Set([`asc`, `desc`]))
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.secondary.direction)),
    ).toEqual(new Set([`asc`, `desc`]))
    expect(
      new Set(
        sample.map(
          (scenario) =>
            `${scenario.nullable!.primary.direction}/${scenario.nullable!.secondary.direction}`,
        ),
      ),
    ).toEqual(new Set([`asc/asc`, `asc/desc`, `desc/asc`, `desc/desc`]))
    expect(sample.some((scenario) => scenario.repair)).toBe(true)
    expect(sample.some((scenario) => scenario.syncRun === `restart`)).toBe(true)
  })
})

describe(`synchronous initial full-source settlement refinement`, () => {
  it(`enumerates every full-source feature and settlement cell exactly once`, () => {
    expect(fullSourceSettlementCells).toHaveLength(8)
    expect(
      new Set(fullSourceSettlementCells.map((cell) => JSON.stringify(cell)))
        .size,
    ).toBe(8)
  })
})
