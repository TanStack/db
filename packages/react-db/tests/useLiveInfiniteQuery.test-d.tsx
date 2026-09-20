import { describe, expectTypeOf, it } from 'vitest'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import type { Collection, Context, NonSingleResult } from '@tanstack/db'
import type {
  UseLiveInfiniteQueryConfig,
  UseLiveInfiniteQueryReturn,
} from '../src/useLiveInfiniteQuery'

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

  it(`preserves pre-created collection row, key, and utility types`, () => {
    type Post = { id: `post-${number}`; title: string }
    type PostKey = Post[`id`]
    type PostUtils = { refreshPost: (key: PostKey) => Promise<void> }

    const collection = null as unknown as Collection<Post, PostKey, PostUtils> &
      NonSingleResult
    const result = useLiveInfiniteQuery(collection, { pageSize: 5 })

    expectTypeOf(result.data).toEqualTypeOf<Array<Post>>()
    expectTypeOf(result.pages).toEqualTypeOf<Array<Array<Post>>>()
    expectTypeOf(result.state).toEqualTypeOf<Map<PostKey, Post>>()
    expectTypeOf(result.collection).toEqualTypeOf<typeof collection>()
    expectTypeOf(result.collection.utils.refreshPost).toEqualTypeOf<
      (key: PostKey) => Promise<void>
    >()

    // @ts-expect-error The collection overload must not erase row fields to any.
    result.data[0]!.missing
    // @ts-expect-error The collection overload must preserve the collection key.
    result.state.get(`not-a-post-key`)
  })
})
