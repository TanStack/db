import { describe, test } from 'vitest'
import type { TraceProjection } from './trace-runner.js'

describe(`trace projection types`, () => {
  test(`rejects an async assertEqual at compile time`, () => {
    const asyncAssertionProjection: TraceProjection<undefined, number> = {
      observe: () => 0,
      recompute: () => 0,
      // @ts-expect-error trace assertions must finish synchronously
      assertEqual: async () => {
        await Promise.resolve()
      },
    }

    void asyncAssertionProjection
  })
})
