import type { CollectionImpl } from "../../collection.js"
import type { QueryBuilder } from "./index.js"

export interface Context {
  // The collections available in the base schema
  baseSchema: Record<string, any>
  // The current schema available (includes joined collections)
  schema: Record<string, any>
  // Whether this query has joins
  hasJoins?: boolean
  // The result type after select (if select has been called)
  result?: any
}

export type Source = {
  [alias: string]: CollectionImpl<any, any> | QueryBuilder<any>
}

// Helper type to infer collection type from CollectionImpl
export type InferCollectionType<T> =
  T extends CollectionImpl<infer U> ? U : never

// Helper type to create schema from source
export type SchemaFromSource<T extends Source> = {
  [K in keyof T]: T[K] extends CollectionImpl<infer U>
    ? U
    : T[K] extends QueryBuilder<infer C>
      ? C extends { result: infer R }
        ? R
        : C extends { schema: infer S }
          ? S
          : never
      : never
}

// Helper type to get all aliases from a context
export type GetAliases<TContext extends Context> = keyof TContext[`schema`]

// Callback type for where/having clauses
export type WhereCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Callback type for select clauses
export type SelectCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => Record<string, any>

// Callback type for orderBy clauses
export type OrderByCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Callback type for groupBy clauses
export type GroupByCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Callback type for join on clauses
export type JoinOnCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Type for creating RefProxy objects based on context
export type RefProxyForContext<TContext extends Context> = {
  [K in keyof TContext[`schema`]]: RefProxyFor<TContext[`schema`][K]>
}

// Helper type to create RefProxy for a specific type
export type RefProxyFor<T> = OmitRefProxy<
  {
    [K in keyof T]: T[K] extends Record<string, any>
      ? RefProxyFor<T[K]> & RefProxy<T[K]>
      : RefProxy<T[K]>
  } & RefProxy<T>
>

type OmitRefProxy<T> = Omit<T, `__refProxy` | `__path` | `__type`>

// The core RefProxy interface
export interface RefProxy<T = any> {
  /** @internal */
  readonly __refProxy: true
  /** @internal */
  readonly __path: Array<string>
  /** @internal */
  readonly __type: T
}

// Helper type to merge contexts (for joins)
export type MergeContext<
  TContext extends Context,
  TNewSchema extends Record<string, any>,
> = {
  baseSchema: TContext[`baseSchema`]
  schema: TContext[`schema`] & TNewSchema
  hasJoins: true
  result: TContext[`result`]
}

// Helper type for updating context with result type
export type WithResult<TContext extends Context, TResult> = Omit<
  TContext,
  `result`
> & {
  result: TResult
}

// Helper type to get the result type from a context
export type GetResult<TContext extends Context> =
  TContext[`result`] extends undefined
    ? TContext[`hasJoins`] extends true
      ? TContext[`schema`]
      : TContext[`schema`]
    : TContext[`result`]
