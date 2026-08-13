import { describe, expectTypeOf, it } from 'vitest'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
import type {
  UseLiveInfiniteQueryConfig,
  UseLiveInfiniteQueryReturn,
} from '../src/useLiveInfiniteQuery.svelte.js'
import type { Context, InitialQueryBuilder } from '@tanstack/db'

describe(`useLiveInfiniteQuery type assertions`, () => {
  it(`keeps legacy generic wrappers source-compatible`, () => {
    function acceptsContext<TContext extends Context>(
      _config: UseLiveInfiniteQueryConfig<TContext>,
      _result: UseLiveInfiniteQueryReturn<TContext>,
    ): void {}

    void acceptsContext
  })

  it(`preserves the awaitable fetch callback`, () => {
    expectTypeOf<
      UseLiveInfiniteQueryReturn<Context>[`fetchNextPage`]
    >().toEqualTypeOf<() => Promise<void>>()
  })

  it(`does not advertise disabled null queries`, () => {
    useLiveInfiniteQuery(
      // @ts-expect-error Infinite queries do not support disabled null queries.
      (_q: InitialQueryBuilder) => null,
      { pageSize: 5 },
    )
  })
})
