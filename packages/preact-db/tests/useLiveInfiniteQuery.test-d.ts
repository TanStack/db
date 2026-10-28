import { describe, expectTypeOf, it } from 'vitest'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import type { OutputWithVirtual } from '../../db/tests/utils'

type Post = { id: string; title: string; rank: number }

const posts = createCollection(
  mockSyncCollectionOptions<Post>({
    id: `type-posts`,
    getKey: (post) => post.id,
    initialData: [],
  }),
)

describe(`useLiveInfiniteQuery types`, () => {
  it(`types pages of a query callback`, () => {
    const result = useLiveInfiniteQuery(
      (q) =>
        q
          .from({ post: posts })
          .orderBy(({ post }) => post.rank, `desc`)
          .select(({ post }) => ({ id: post.id, title: post.title })),
      { pageSize: 10 },
    )
    expectTypeOf(result.data).toMatchTypeOf<
      Array<OutputWithVirtual<{ id: string; title: string }>>
    >()
    expectTypeOf(result.pages).toMatchTypeOf<
      Array<Array<OutputWithVirtual<{ id: string; title: string }>>>
    >()
    expectTypeOf(result.pageParams).toEqualTypeOf<Array<number>>()
    expectTypeOf(result.fetchNextPage).toEqualTypeOf<() => Promise<void>>()
    expectTypeOf(result.hasNextPage).toEqualTypeOf<boolean>()
    expectTypeOf(result.isEnabled).toEqualTypeOf<true>()
  })

  it(`types pages of a supplied live-query Collection`, () => {
    const ranked = createLiveQueryCollection((q) =>
      q.from({ post: posts }).orderBy(({ post }) => post.rank),
    )
    const result = useLiveInfiniteQuery(ranked, { pageSize: 5 })
    expectTypeOf(result.pages).toMatchTypeOf<
      Array<Array<OutputWithVirtual<Post>>>
    >()
  })

  it(`accepts queryKey for functional variants`, () => {
    useLiveInfiniteQuery(
      (q) =>
        q
          .from({ post: posts })
          .fn.where(({ post }) => post.rank > 0)
          .orderBy(({ post }) => post.rank),
      { pageSize: 5, queryKey: [`ranked`] },
    )
  })
})
