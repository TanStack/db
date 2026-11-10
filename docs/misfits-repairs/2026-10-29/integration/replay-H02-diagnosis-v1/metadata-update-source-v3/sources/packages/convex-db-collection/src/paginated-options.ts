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

/** Leading numeric order of the fixed server query. Trailing DB order terms
 * are local: each acquisition establishes the complete leading-value tie. */
export type ConvexQueryOrder<TRow> = {
  field: {
    [K in keyof TRow]-?: TRow[K] extends number ? K : never
  }[keyof TRow] &
    string
  direction: `asc` | `desc`
}

export type ConvexPaginatedCollectionConfig<
  TQuery extends FunctionReference<`query`>,
  TItem extends object = PaginatedRow<TQuery>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1<TItem, TItem> = never,
> = Omit<
  BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils>,
  `syncMode` | `utils` | `schema`
> & {
  client: ConvexCollectionClient
  query: TQuery
  queryArgs: Omit<FunctionArgs<TQuery>, `paginationOpts`>
  pageSize?: number
  /** Maximum accepted rows in the retained query prefix. Defaults to 10,000. */
  maxRows?: number
  onError?: (error: unknown) => void
} & ([TSchema] extends [never] ? { schema?: never } : { schema: TSchema }) &
  (FunctionReturnType<TQuery> extends PaginationResult<object>
    ? unknown
    : never) &
  (FunctionArgs<TQuery> extends { paginationOpts: PaginationOptions }
    ? unknown
    : never) &
  (
    | ({ syncMode?: `eager`; queryOrder?: never } & (
        | {
            select: (
              rows: ReadonlyArray<PaginatedRow<TQuery>>,
            ) => ReadonlyArray<TItem>
          }
        | (PaginatedRow<TQuery> extends TItem ? { select?: never } : never)
      ))
    | ({
        syncMode: `on-demand`
        queryOrder: ConvexQueryOrder<PaginatedRow<TQuery>>
        select?: never
      } & (PaginatedRow<TQuery> extends TItem ? unknown : never))
  )

/** Retain reactive cursor ranges; on-demand mode acquires only the prefix needed by active subsets. */
export function convexPaginatedCollectionOptions<
  TQuery extends FunctionReference<`query`>,
  TItem extends object = PaginatedRow<TQuery>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1<TItem, TItem> = never,
>(config: ConvexPaginatedCollectionConfig<TQuery, TItem, TKey, TSchema>) {
  const {
    client,
    query,
    queryArgs,
    pageSize = 100,
    maxRows = 10_000,
    queryOrder,
    ...options
  } = config
  if (options.syncMode === `on-demand` && (options.select || !queryOrder)) {
    throw new TypeError(
      `Convex on-demand paging requires queryOrder and does not support select.`,
    )
  }
  const declaredOrder: { field: unknown; direction: unknown } | undefined =
    queryOrder
  if (
    declaredOrder &&
    (typeof declaredOrder.field !== `string` ||
      !declaredOrder.field ||
      (declaredOrder.direction !== `asc` && declaredOrder.direction !== `desc`))
  ) {
    throw new TypeError(
      `Convex queryOrder requires a numeric field and asc or desc direction.`,
    )
  }
  return createConvexOptions<
    ReadonlyArray<PaginatedRow<TQuery>>,
    TItem,
    TKey,
    TSchema
  >(options, (receive, fail) =>
    subscribePages(
      client,
      query,
      queryArgs,
      pageSize,
      maxRows,
      receive,
      fail,
      options.syncMode === `on-demand` ? queryOrder : undefined,
    ),
  )
}
