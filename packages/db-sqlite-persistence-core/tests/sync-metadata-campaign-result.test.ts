import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { keptMetadataDurabilityHistoriesArbitrary } from '../../db/tests/sync-metadata-session-oracle'
import { requireExecutedHistory } from './sync-metadata-campaign-result'

it(`rejects the obsolete shrink path that fast-check accepts without executing a history`, async () => {
  // `0:999` asks for a shrink step that does not exist, which fast-check
  // accepts and answers with no history under any version; a path that
  // merely runs deeper than one version's shrink tree, such as `0:0:0` under
  // fast-check 3, can be a real history under another.
  for (const path of [`0`, `0:999`]) {
    let calls = 0
    const result = await fc.check(
      fc.asyncProperty(keptMetadataDurabilityHistoriesArbitrary, () => {
        calls++
        return Promise.resolve()
      }),
      {
        seed: 2220031,
        path,
        numRuns: 1,
      },
    )
    expect(result.failed).toBe(false)
    if (path === `0`) {
      expect(calls).toBe(1)
      expect(() => requireExecutedHistory(`calibration`, result)).not.toThrow()
    } else {
      expect(calls).toBe(0)
      expect(() => requireExecutedHistory(`calibration`, result)).toThrow(
        `executed no history`,
      )
    }
  }
})
