import { describe, test } from 'vitest'
import { createNestedCollectionFixture } from './includes-space-oracle-fixture.js'

describe(`nested Collection materialization`, () => {
  test(`constructs and preloads the 20-by-2-by-5-by-10 tree`, async ({
    bench,
  }) => {
    // Bounded sampling: Vitest 5 takes these run options on the registration.
    await bench(
      `constructs and preloads the 20-by-2-by-5-by-10 tree`,
      async () => {
        const fixture = await createNestedCollectionFixture(20)
        try {
          await fixture.live.preload()
        } finally {
          await fixture.cleanup()
        }
      },
    ).run({
      iterations: 10,
      time: 0,
      warmupIterations: 2,
      warmupTime: 0,
    })
  })
})
