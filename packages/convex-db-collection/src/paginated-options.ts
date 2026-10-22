import { createConvexOptions } from './options'
import { subscribePages } from './pagination'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { BaseCollectionConfig } from '@tanstack/db'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from 'convex/server'
import type { ConvexCollectionUtils } from './options'
import type { ConvexCollectionClient } from './subscription'

type PaginatedRow<TQuery extends FunctionReference<`query`>> =
  FunctionReturnType<TQuery> extends PaginationResult<infer TRow extends object>
    ? TRow
    : never

export type ConvexPaginatedCollectionConfig<
  TQuery extends FunctionReference<`query`>,
  TItem extends object = PaginatedRow<TQuery>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1<TItem, TItem> = never,
> = Omit<
  BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils, unknown>,
  `syncMode` | `utils` | `schema`
> & {
  client: ConvexCollectionClient
  query: TQuery
  queryArgs: Omit<FunctionArgs<TQuery>, `paginationOpts`>
  pageSize?: number
  onError?: (error: unknown) => void
} & ([TSchema] extends [never] ? { schema?: never } : { schema: TSchema }) &
  (FunctionReturnType<TQuery> extends PaginationResult<object>
    ? unknown
    : never) &
  (FunctionArgs<TQuery> extends { paginationOpts: PaginationOptions }
    ? unknown
    : never) &
  (
    | {
        select: (
          rows: ReadonlyArray<PaginatedRow<TQuery>>,
        ) => ReadonlyArray<TItem>
      }
    | (PaginatedRow<TQuery> extends TItem ? { select?: never } : never)
  )

/** Automatically subscribe to every page, retaining fixed reactive cursor ranges. */
export function convexPaginatedCollectionOptions<
  TQuery extends FunctionReference<`query`>,
  TItem extends object = PaginatedRow<TQuery>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1<TItem, TItem> = never,
>(config: ConvexPaginatedCollectionConfig<TQuery, TItem, TKey, TSchema>) {
  const { client, query, queryArgs, pageSize = 100, ...options } = config
  return createConvexOptions<
    ReadonlyArray<PaginatedRow<TQuery>>,
    TItem,
    TKey,
    TSchema
  >(options, (receive, fail) =>
    subscribePages(client, query, queryArgs, pageSize, receive, fail),
  )
}
