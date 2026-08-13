import { describe, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
import type { InitialQueryBuilder } from '@tanstack/db'

type Post = {
  id: string
  createdAt: number
}

describe(`useLiveInfiniteQuery type assertions`, () => {
  it(`rejects a single-result query`, () => {
    const posts = createCollection(
      mockSyncCollectionOptions<Post>({
        id: `svelte-infinite-types`,
        getKey: (post) => post.id,
        initialData: [],
      }),
    )

    useLiveInfiniteQuery(
      // @ts-expect-error Infinite queries cannot use a single-result query.
      (q: InitialQueryBuilder) =>
        q
          .from({ posts })
          .orderBy(({ posts: post }) => post.createdAt, `desc`)
          .findOne(),
      { pageSize: 5 },
    )
  })
})
