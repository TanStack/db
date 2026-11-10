import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import {
  arbitraryNonIndexEntries,
  expectPermutedHashes,
} from './hash-value-oracle.js'

describe(`law checker calibration`, () => {
  it(`rejects an insertion-order-sensitive result but accepts equal structures`, () => {
    oracleRoute(`calibration`)
    const entries: Array<[string, number]> = [
      [`key:left`, 1],
      [`key:right`, 2],
    ]
    expect(() =>
      expectPermutedHashes(entries, (value) =>
        Object.keys(value as object)[0] === `key:left` ? 1 : 2,
      ),
    ).toThrow()
    expectPermutedHashes(entries)
    // The reach guard must also reject a nominal reversal of index keys.
    expect(() =>
      expectPermutedHashes([
        [`0`, 1],
        [`1`, 2],
      ]),
    ).toThrow()
  })

  it(`shrinks and replays an injected equality-law failure`, () => {
    oracleRoute(`calibration`)
    const property = fc.property(arbitraryNonIndexEntries, (entries) => {
      let calls = 0
      expectPermutedHashes(entries, () => ++calls)
    })
    const failed = fc.check(property, { seed: 1657021, numRuns: 100 })
    expect(failed.failed).toBe(true)
    expect(failed.counterexample).not.toBeNull()
    expect(failed.numShrinks).toBeGreaterThan(0)
    if (failed.counterexamplePath === null) {
      throw new Error(`Expected a counterexample path for replay`)
    }
    const replayed = fc.check(property, {
      seed: failed.seed,
      path: failed.counterexamplePath,
      numRuns: 100,
      endOnFailure: true,
    })
    expect(replayed.failed).toBe(true)
    expect(replayed.counterexample).toEqual(failed.counterexample)
  })
})
