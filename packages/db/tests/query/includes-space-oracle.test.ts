import { describe, expect, it } from 'vitest'
import { LIVE_QUERY_INTERNAL } from '../../src/query/live/internal.js'
import { createNestedCollectionFixture } from './includes-space-oracle-fixture.js'

describe(`nested Collection materialization space oracle`, () => {
  it(`constructs exactly one facade per reachable bucket`, async () => {
    const fixture = await createNestedCollectionFixture(20)
    try {
      await fixture.live.preload()

      expect(
        fixture.live.utils[LIVE_QUERY_INTERNAL].getBucketFacadeMetrics(),
      ).toEqual({
        created: fixture.expectedFacadeCount,
        active: fixture.expectedFacadeCount,
        retired: 0,
      })
    } finally {
      await fixture.cleanup()
    }
  })
})
