import { describe, expectTypeOf, it } from 'vitest'
import type { CleanupFn } from '../src/types'

describe(`CleanupFn compatibility`, () => {
  it(`accepts contextual-void and asynchronous cleanup callbacks`, () => {
    const values: Array<number> = []
    const contextualVoid: CleanupFn = () => values.push(1)
    const asynchronous: CleanupFn = async () => Promise.resolve()

    expectTypeOf(contextualVoid).toMatchTypeOf<CleanupFn>()
    expectTypeOf(asynchronous).toMatchTypeOf<CleanupFn>()
  })
})
