import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { persistedCollectionOptions } from '../src'
import type { CollectionConfig, WithVirtualProps } from '@tanstack/db'
import type { QueryCollectionUtils } from '@tanstack/query-db-collection'
import type { PersistedCollectionPersistence } from '../src'

/**
 * Browser export checks for the core persisted-options-type-oracle.test-d.ts contract.
 * Type checks only.
 */
type Row = { id: string; title: string; completed: boolean }
declare const persistence: PersistedCollectionPersistence

describe(`Browser persisted option composition`, () => {
  it(`wraps a schema-free CollectionConfig without explicit type arguments`, () => {
    const utils = { titleLength: (title: string) => title.length }
    const config: CollectionConfig<Row, string, never, typeof utils> = {
      id: `ordinary-config`,
      getKey: (row) => row.id,
      sync: { sync: () => {} },
      utils,
    }
    const collection = createCollection(
      persistedCollectionOptions({ ...config, persistence }),
    )

    collection.insert({ id: `row`, title: `input`, completed: false })
    expectTypeOf(collection.get(`row`)).toEqualTypeOf<
      WithVirtualProps<Row, string> | undefined
    >()
    expectTypeOf(collection.get).parameters.toEqualTypeOf<[string]>()
    expectTypeOf(collection.utils.titleLength).toEqualTypeOf<
      typeof utils.titleLength
    >()
    // @ts-expect-error title must be a string
    collection.insert({ id: `row`, title: 1, completed: false })
    // @ts-expect-error keys must be strings
    collection.get(1)
    // @ts-expect-error titleLength takes a string
    collection.utils.titleLength(1)
  })

  it(`infers row, key, and utility types from Query Collection options`, () => {
    const queryOptions = queryCollectionOptions({
      id: `query-config`,
      queryClient: new QueryClient(),
      queryKey: [`rows`],
      queryFn: (): Promise<Array<Row>> => Promise.resolve([]),
      getKey: (row) => row.id,
    })
    const collection = createCollection(
      persistedCollectionOptions({ ...queryOptions, persistence }),
    )

    collection.insert({ id: `row`, title: `input`, completed: false })
    expectTypeOf(collection.get(`row`)).toEqualTypeOf<
      WithVirtualProps<Row, string> | undefined
    >()
    expectTypeOf(collection.get).parameters.toEqualTypeOf<[string]>()
    expectTypeOf(collection.utils).toEqualTypeOf<
      QueryCollectionUtils<Row, string, Row>
    >()
    expectTypeOf(collection.utils.refetch).toEqualTypeOf<
      QueryCollectionUtils<Row, string>[`refetch`]
    >()
    collection.utils.refetch({ throwOnError: true })
    collection.utils.writeInsert({
      id: `row`,
      title: `input`,
      completed: false,
    })
    collection.utils.writeDelete(`row`)
    // @ts-expect-error writeInsert requires a string title
    collection.utils.writeInsert({ id: `row`, title: 1, completed: false })
    // @ts-expect-error writeDelete requires a string key
    collection.utils.writeDelete(1)
    // @ts-expect-error throwOnError must be a boolean
    collection.utils.refetch({ throwOnError: `yes` })
    // @ts-expect-error Query Collection has no awaitTxId method
    collection.utils.awaitTxId(1)
  })
})
