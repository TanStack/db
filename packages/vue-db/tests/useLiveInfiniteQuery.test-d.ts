import { describe, expectTypeOf, it } from 'vitest'
import { shallowRef } from 'vue'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { InitialQueryBuilder } from '@tanstack/db'

type Post = {
  id: string
  createdAt: number
}

describe(`useLiveInfiniteQuery type assertions`, () => {
  it(`preserves query and pre-created collection result types`, () => {
    const posts = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `vue-infinite-types`,
        getKey: (post) => post.id,
        initialData: [],
      }),
    )

    const queryResult = useLiveInfiniteQuery(
      (q: InitialQueryBuilder) =>
        q.from({ posts }).orderBy(({ posts: post }) => post.createdAt, `desc`),
      { pageSize: 5 },
    )
    expectTypeOf(queryResult.data.value[0]!.id).toEqualTypeOf<string>()
    expectTypeOf(queryResult.data.value[0]!.createdAt).toEqualTypeOf<number>()
    expectTypeOf(queryResult.fetchNextPage()).toEqualTypeOf<Promise<void>>()

    const livePosts = createLiveQueryCollection((q: InitialQueryBuilder) =>
      q.from({ posts }).orderBy(({ posts: post }) => post.createdAt, `desc`),
    )
    const collectionResult = useLiveInfiniteQuery(shallowRef(livePosts), {
      pageSize: 5,
      getNextPageParam: (lastPage) => lastPage[0]?.createdAt,
    })

    expectTypeOf(collectionResult.data.value[0]!.id).toEqualTypeOf<string>()
    expectTypeOf(
      collectionResult.data.value[0]!.createdAt,
    ).toEqualTypeOf<number>()
    expectTypeOf(collectionResult.state.value.get(`1`)?.id).toEqualTypeOf<
      string | undefined
    >()

    useLiveInfiniteQuery(
      // @ts-expect-error Infinite queries cannot use a single-result query.
      (q: InitialQueryBuilder) =>
        q
          .from({ posts })
          .orderBy(({ posts: post }) => post.createdAt, `desc`)
          .findOne(),
      { pageSize: 5 },
    )

    useLiveInfiniteQuery(
      // @ts-expect-error Infinite queries do not support disabled null queries.
      (_q: InitialQueryBuilder) => null,
      { pageSize: 5 },
    )
  })
})
