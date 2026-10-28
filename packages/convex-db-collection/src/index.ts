import { createConvexOptions } from './options'
import { subscribeQuery } from './subscription'
import type { ConvexCollectionUtils } from './options'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ConvexCollectionClient } from './subscription'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'
import type { BaseCollectionConfig, CollectionConfig } from '@tanstack/db'

export type { ConvexCollectionUtils } from './options'
export type { ConvexCollectionClient } from './subscription'

type QueryRow<TQuery extends FunctionReference<`query`>> =
  FunctionReturnType<TQuery> extends ReadonlyArray<infer TRow extends object>
    ? TRow
    : never

export type ConvexCollectionConfig<
  TQuery extends FunctionReference<`query`>,
  TItem extends object = QueryRow<TQuery>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1<TItem, TItem> = never,
> = Omit<
  BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils>,
  `syncMode` | `utils` | `schema`
> & {
  /** Share the client used for mutations, authentication, and reconnects. */
  client: ConvexCollectionClient
  query: TQuery
  queryArgs: FunctionArgs<TQuery>
  /** Reports subscription and result-conversion failures, including after readiness. */
  onError?: (error: unknown) => void
} & ([TSchema] extends [never] ? { schema?: never } : { schema: TSchema }) &
  (
    | {
        /** Convert an envelope or nullable result into the complete set of rows. */
        select: (result: FunctionReturnType<TQuery>) => ReadonlyArray<TItem>
      }
    | (FunctionReturnType<TQuery> extends ReadonlyArray<TItem>
        ? { select?: never }
        : never)
  )

/** Mirror one authoritative Convex query result. Filters and joins run in DB. */
export function convexCollectionOptions<
  TQuery extends FunctionReference<`query`>,
  TItem extends object = QueryRow<TQuery>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1<TItem, TItem> = never,
>(
  config: ConvexCollectionConfig<TQuery, TItem, TKey, TSchema>,
): CollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils> & {
  utils: ConvexCollectionUtils
} & ([TSchema] extends [never] ? unknown : { schema: TSchema }) {
  const { client, query, queryArgs, ...options } = config
  return createConvexOptions(options, (receive, fail) =>
    subscribeQuery(client, query, queryArgs, receive, fail),
  )
}

export {
  convexPaginatedCollectionOptions,
  type ConvexPaginatedCollectionConfig,
  type ConvexQueryOrder,
} from './paginated-options'
