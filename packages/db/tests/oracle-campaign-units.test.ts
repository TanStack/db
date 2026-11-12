/**
 * The campaign-unit contract that the oracle files' reach hooks rely on.
 *
 * Every reach hook that counts aggregate reach runs only for the test names
 * that `isGeneratedOracleCampaign` recognizes. The names come from the pinned
 * @tanstack/oracles. This file registers one real generated property, records
 * the names of the tests it registered, and fails unless the predicate names
 * its random campaign and its fixed-seed campaign. A rename upstream then
 * fails here, instead of skipping every reach hook in silence.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  assertGeneratedCampaignUnits,
  oracleProperty,
  pass,
} from './oracle-config.js'

describe(`generated campaign units`, () => {
  const names: Array<string> = []
  beforeEach(({ task }) => {
    names.push(task.name)
  })
  afterAll(() => {
    assertGeneratedCampaignUnits(names)
  })
  oracleProperty({
    id: `oracle-campaign-units.contract`,
    law: {
      statement: `A generated property registers a random campaign and a fixed-seed campaign that the reach hooks recognize.`,
      authority: `The campaign units of the pinned @tanstack/oracles, on which every reach hook in this repository depends.`,
      limits: `One trivial integer property.`,
    },
    histories: { arbitrary: fc.integer(), runs: 2, fixedSeeds: [1] },
    model: () => null,
    driver: (history, observe) => {
      observe(`history`, history)
    },
    check: () => pass,
  })
})

describe(`the campaign-unit guard`, () => {
  it(`rejects names whose generated suffix changed`, () => {
    expect(() =>
      assertGeneratedCampaignUnits([
        `random seed: sampled`,
        `fixed seed 1: sampled`,
        `determinism`,
      ]),
    ).toThrow(/names no random campaign/)
    expect(() =>
      assertGeneratedCampaignUnits([`random seed: generated`, `determinism`]),
    ).toThrow(/names no fixed-seed campaign/)
    expect(() =>
      assertGeneratedCampaignUnits([
        `random seed: generated`,
        `fixed seed 1: generated`,
      ]),
    ).not.toThrow()
  })
})
