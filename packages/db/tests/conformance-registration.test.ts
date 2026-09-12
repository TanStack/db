import { expect, it } from 'vitest'
import { scenarioRegistry } from './conformance/registration'

it.each([undefined, []])(
  `registers distinct scenario laws with gaps=%s`,
  (gaps) => {
    const registry = scenarioRegistry(gaps)
    registry.register(`first`)
    registry.register(`second`)
    expect(registry.size).toBe(2)
    expect(() => registry.register(`first`)).toThrow(
      `Duplicate conformance scenario: first`,
    )
    expect(registry.size).toBe(2)
  },
)

it.each([[`real-law`], [`misspelled-law`], [`one`, `two`]])(
  `rejects whole-test failure waivers %# before registration`,
  (...gaps) => {
    expect(() => scenarioRegistry(gaps)).toThrow(
      `approved exact failure signature`,
    )
  },
)
