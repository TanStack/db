import { describe, expectTypeOf, it } from 'vitest'
import type {
  UseLiveInfiniteQueryConfig,
  UseLiveInfiniteQueryReturn,
} from '../src/useLiveInfiniteQuery'
import type { Context } from '@tanstack/db'

describe(`useLiveInfiniteQuery type assertions`, () => {
  it(`does not advertise a server-page callback`, () => {
    expectTypeOf<
      Extract<keyof UseLiveInfiniteQueryConfig<Context>, `getNextPageParam`>
    >().toEqualTypeOf<never>()
  })

  it(`keeps legacy generic wrappers source-compatible`, () => {
    function acceptsContext<TContext extends Context>(
      _config: UseLiveInfiniteQueryConfig<TContext>,
      _result: UseLiveInfiniteQueryReturn<TContext>,
    ): void {}

    void acceptsContext
  })

  it(`exposes the controller fetch promise`, () => {
    expectTypeOf<
      UseLiveInfiniteQueryReturn<Context>[`fetchNextPage`]
    >().toEqualTypeOf<() => Promise<void>>()
  })
})
