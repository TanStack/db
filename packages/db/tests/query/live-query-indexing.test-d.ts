import { expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { Query } from '../../src/query/builder/index.js'
import {
  createLiveQueryCollection,
  liveQueryCollectionOptions,
} from '../../src/query/live-query-collection.js'
import type { ExtractContext } from '../../src/query/builder/index.js'
import type { LiveQueryHookConfig } from '../../src/query/live/types.js'

test(`indexing config preserves inferred live-query rows`, () => {
  const source = createCollection({
    getKey: (row: { id: number; rank: number }) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const direct = createLiveQueryCollection({
    query: (q) =>
      q.from({ row: source }).select(({ row }) => ({ rank: row.rank })),
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
  })
  const options = createCollection(
    liveQueryCollectionOptions({
      query: (q) =>
        q.from({ row: source }).select(({ row }) => ({ rank: row.rank })),
      autoIndex: `off`,
      defaultIndexType: BasicIndex,
    }),
  )
  const query = new Query()
    .from({ row: source })
    .select(({ row }) => ({ rank: row.rank }))
  const hookConfig = {
    query,
    autoIndex: `eager`,
    defaultIndexType: BasicIndex,
  } satisfies LiveQueryHookConfig<ExtractContext<typeof query>>
  expectTypeOf(direct.toArray[0]!.rank).toEqualTypeOf<number>()
  expectTypeOf(options.toArray[0]!.rank).toEqualTypeOf<number>()
  expectTypeOf(hookConfig.query).toEqualTypeOf<typeof query>()
})
