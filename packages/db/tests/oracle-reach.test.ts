import { describe, expect, it } from 'vitest'
import { createOracleReach } from './oracle-reach.js'

describe(`createOracleReach`, () => {
  it(`fails for a declared state that no history entered`, () => {
    const reach = createOracleReach(`example`, [`seen`, `unseen`] as const)
    reach.beginHistory()
    reach.reach(`seen`)
    expect(() => reach.assertReached()).toThrow(/unseen \(0\)/)
  })

  it(`counts a history once per state`, () => {
    const reach = createOracleReach(`example`, [`state`] as const, {
      minimum: 2,
    })
    reach.beginHistory()
    reach.reach(`state`)
    reach.reach(`state`)
    expect(reach.counts().get(`state`)).toBe(1)
    expect(() => reach.assertReached()).toThrow(/state \(1\)/)
    reach.beginHistory()
    reach.reach(`state`)
    expect(() => reach.assertReached()).not.toThrow()
  })

  it(`rejects an undeclared state`, () => {
    const reach = createOracleReach(`example`, [`state`] as const)
    expect(() => reach.reach(`other` as unknown as `state`)).toThrow(
      /undeclared reach state other/,
    )
  })
})
