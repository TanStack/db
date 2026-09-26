import { describe, expectTypeOf, it } from 'vitest'
import type { CleanupFn } from '../src/types'

describe(`CleanupFn compatibility`, () => {
  it(`accepts contextual-void and asynchronous cleanup callbacks`, () => {
    expectTypeOf<() => number>().toMatchTypeOf<CleanupFn>()
    expectTypeOf<() => Promise<void>>().toMatchTypeOf<CleanupFn>()
  })
})
