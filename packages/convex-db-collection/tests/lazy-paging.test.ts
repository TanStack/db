/**
 * Fixed scenarios for lazy paging configuration: a malformed order declaration
 * fails before a subscription can acquire state. The lazy-paging laws and their
 * generated histories are owned by lazy-paging-oracle.property.test.ts. These
 * fixed tests compare with written values and have no oracle owner (tracked in
 * #2264).
 */
import { expect, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { lazyQuery } from './lazy-paging-driver'
import type { LazyRow } from './lazy-paging-model-oracle'
import type { ConvexPaginatedCollectionConfig } from '../src/index'

// Configuration contradictions fail before a subscription can acquire state.
it.each([
  { field: `rank`, direction: `sideways` },
  { field: 1, direction: `asc` },
  { field: ``, direction: `asc` },
])(`rejects malformed order declarations %j`, (queryOrder) => {
  expect(() =>
    convexPaginatedCollectionOptions({
      client: {},
      query: lazyQuery,
      queryArgs: {},
      syncMode: `on-demand`,
      queryOrder,
      getKey: (row: LazyRow) => row.id,
    } as unknown as ConvexPaginatedCollectionConfig<typeof lazyQuery>),
  ).toThrow(TypeError)
})
