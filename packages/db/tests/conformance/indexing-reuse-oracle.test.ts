/**
 * Calibrate the shared initial-binding identity comparison over its existing
 * finite grammar. Each pair of admitted declarations supplies the opposite of
 * the promised identity relation: an overshared or undershared output. Rejected
 * declarations supply no output and impose no output-identity comparison.
 * This tests checker sensitivity, not another production receiving path.
 */
import { expect, test } from 'vitest'
import { BTreeIndex, BasicIndex } from '../../src'
import { declareOracle } from '../oracle-declaration'
import { oracleRoute } from '../oracle-config'
import {
  expectIndexingReuse,
  expectedIndexing,
  expectedIndexingReuse,
  indexConfigurationLabel,
  indexConfigurationPairs,
  indexConfigurations,
} from './indexing-config-oracle'

const histories = indexConfigurationPairs(
  indexConfigurations({
    indexTypes: { basic: BasicIndex, btree: BTreeIndex },
  }),
)
// Owns no production entry: this file calibrates the shared identity checker
// with planted wrong relations, so it judges no production code.
declareOracle({
  grammar: [indexConfigurationPairs],
  model: [expectedIndexing, expectedIndexingReuse],
  check: [expectIndexingReuse],
})

test.each(histories)(
  `identity comparison rejects the opposite relation: %j`,
  ({ first, second, identity }) => {
    oracleRoute(`calibration`)
    const left = expectedIndexing(first).rejects ? undefined : {}
    const right = expectedIndexing(second).rejects ? undefined : {}
    if (!left || !right) {
      expect(() =>
        expectIndexingReuse(left, right, first, second, identity),
      ).not.toThrow()
    } else {
      const wrong = expectedIndexingReuse(first, second, identity)
        ? right
        : left
      expect(() =>
        expectIndexingReuse(left, wrong, first, second, identity),
      ).toThrow()
    }
  },
)

// Renaming constructor functions cannot collapse two grammar cells. This is a
// registration-label calibration; it claims no particular bundler output.
test.each([`BasicIndex`, `x`])(
  `configuration labels survive equal names: %s`,
  (name) => {
    oracleRoute(`case`)
    const basic = class extends BasicIndex {}
    const btree = class extends BTreeIndex {}
    Object.defineProperty(basic, `name`, { value: name })
    Object.defineProperty(btree, `name`, { value: name })
    const driver = { indexTypes: { basic, btree } }
    const settings = indexConfigurations(driver)
    const labels = settings.map((setting) =>
      indexConfigurationLabel(setting, driver),
    )
    expect(new Set(labels).size).toBe(settings.length)
  },
)
