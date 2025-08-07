import type { CollectionImpl } from "../../collection.js"
import type { Aggregate, BasicExpression, OrderByDirection } from "../ir.js"
import type { QueryBuilder } from "./index.js"
import type { ResolveType } from "../../types.js"

export interface Context {
  // The collections available in the base schema
  baseSchema: ContextSchema
  // The current schema available (includes joined collections)
  schema: ContextSchema
  // the name of the source that was used in the from clause
  fromSourceName: string
  // Whether this query has joins
  hasJoins?: boolean
  // Mapping of table alias to join type for easy lookup
  joinTypes?: Record<
    string,
    `inner` | `left` | `right` | `full` | `outer` | `cross`
  >
  // The result type after select (if select has been called)
  result?: any
}

export type ContextSchema = Record<string, unknown>

export type Source = {
  [alias: string]: CollectionImpl<any, any> | QueryBuilder<Context>
}

// Helper type to infer collection type from CollectionImpl
// This uses ResolveType directly to ensure consistency with collection creation logic
export type InferCollectionType<T> =
  T extends CollectionImpl<infer U, any, any, infer TSchema, any>
    ? ResolveType<U, TSchema, U>
    : never

// Helper type to create schema from source
export type SchemaFromSource<T extends Source> = Prettify<{
  [K in keyof T]: T[K] extends CollectionImpl<any, any, any, any, any>
    ? InferCollectionType<T[K]>
    : T[K] extends QueryBuilder<infer TContext>
      ? GetResult<TContext>
      : never
}>

// Helper type to get all aliases from a context
export type GetAliases<TContext extends Context> = keyof TContext[`schema`]

// Callback type for where/having clauses
export type WhereCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Callback return type for select clauses
// Allows nested object structures for projection
type SelectValue = 
  | BasicExpression 
  | Aggregate 
  | RefProxy 
  | RefProxyFor<any> 
  | Ref<any>
  | undefined
  | { [key: string]: SelectValue }
  | PrecomputeRefStructure<any>
  | Array<Ref<any>>
  | true  // For __refProxy property in spreads
  | Array<string>  // For __path property in spreads
  | any  // For __type property in spreads

export type SelectObject<
  T extends Record<string, SelectValue> = Record<string, SelectValue>,
> = T

// Helper type to get the result type from a select object
export type ResultTypeFromSelect<TSelectObject> = {
  [K in keyof TSelectObject]: TSelectObject[K] extends RefProxy<infer T>
    ? T
    : TSelectObject[K] extends Ref<infer T>
      ? T
    : TSelectObject[K] extends Ref<infer T> | undefined
      ? T | undefined
    : TSelectObject[K] extends RefProxy<infer T> | undefined
      ? T | undefined
    : TSelectObject[K] extends BasicExpression<infer T>
      ? T
    : TSelectObject[K] extends Aggregate<infer T>
      ? T
    : TSelectObject[K] extends RefProxyFor<infer T>
      ? T
    : TSelectObject[K] extends undefined
      ? undefined
    : TSelectObject[K] extends { __type: infer U }
      ? U
    : TSelectObject[K] extends Record<string, any>
      ? TSelectObject[K] extends { __refProxy: true }
        ? never // This is a RefProxy, handled above
        : ResultTypeFromSelect<TSelectObject[K]> // Recursive for nested objects
      : never
}

// Callback type for orderBy clauses
export type OrderByCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

export type OrderByOptions = {
  direction?: OrderByDirection
  nulls?: `first` | `last`
} & StringSortOpts

export type StringSortOpts =
  | {
      stringSort?: `lexical`
    }
  | {
      stringSort?: `locale`
      locale?: string
      localeOptions?: object
    }

export type CompareOptions = {
  direction: OrderByDirection
  nulls: `first` | `last`
  stringSort: `lexical` | `locale`
  locale?: string
  localeOptions?: object
}

// Callback type for groupBy clauses
export type GroupByCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Callback type for join on clauses
export type JoinOnCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

// Type for creating RefProxy objects based on context
// This handles optionality logic and precomputes the ref structure directly
export type RefProxyForContext<TContext extends Context> = {
  [K in keyof TContext[`schema`]]: IsExactlyUndefined<TContext[`schema`][K]> extends true
    ? // T is exactly undefined
      RefProxy<TContext[`schema`][K]>
    : IsOptional<TContext[`schema`][K]> extends true
      ? // T is optional (T | undefined) but not exactly undefined
        RefProxy<NonUndefined<TContext[`schema`][K]>> | undefined
      : // T is not optional - always wrap in RefProxy for top-level schema types
        RefProxy<TContext[`schema`][K]>
}

// Helper type to check if T is exactly undefined
type IsExactlyUndefined<T> = [T] extends [undefined] ? true : false

// Helper type to check if T includes undefined (is optional)
type IsOptional<T> = undefined extends T ? true : false

// Helper type to extract non-undefined type
type NonUndefined<T> = T extends undefined ? never : T

// Precompute the ref structure for an object type
// This transforms { bio: string, contact: { email: string } } into
// { bio: Ref<string>, contact: { email: Ref<string> } }
// Only leaf values are wrapped in RefProxy, intermediate objects remain plain
export type PrecomputeRefStructure<T extends Record<string, any>> = {
  [K in keyof T]: IsExactlyUndefined<T[K]> extends true
    ? Ref<T[K]>
    : IsOptional<T[K]> extends true
      ? NonUndefined<T[K]> extends Record<string, any>
        ? PrecomputeRefStructure<NonUndefined<T[K]>> | undefined
        : Ref<NonUndefined<T[K]>> | undefined
      : T[K] extends Record<string, any>
        ? PrecomputeRefStructure<T[K]>
        : Ref<T[K]>
}

// Helper type for backward compatibility and reusable query callbacks
// This is a simplified version that just handles the optionality logic
export type RefProxyFor<T> = IsExactlyUndefined<T> extends true
  ? RefProxy<T>
  : IsOptional<T> extends true
    ? NonUndefined<T> extends Record<string, any>
      ? PrecomputeRefStructure<NonUndefined<T>> | undefined
      : RefProxy<T>
    : T extends Record<string, any>
      ? PrecomputeRefStructure<T>
      : RefProxy<T>

type OmitRefProxy<T> = Omit<T, `__refProxy` | `__path` | `__type`>

// The core RefProxy interface with recursive structure
export type RefProxy<T = any> = {
  /** @internal */
  readonly __refProxy: true
  /** @internal */
  readonly __path: Array<string>
  /** @internal */
  readonly __type: T
} & (T extends undefined
  ? {}
  : T extends Record<string, any>
    ? {
        [K in keyof T]: IsExactlyUndefined<T[K]> extends true
          ? Ref<T[K]>
          : IsOptional<T[K]> extends true
            ? NonUndefined<T[K]> extends Record<string, any>
              ? RefProxy<NonUndefined<T[K]>> | undefined
              : Ref<NonUndefined<T[K]>> | undefined
            : T[K] extends Record<string, any>
              ? RefProxy<T[K]>
              : Ref<T[K]>
      }
    : {})

// Helper type to extract only the user-facing properties for spreading
export type SpreadableRefProxy<T> = T extends Record<string, any>
  ? {
      [K in keyof T]: IsExactlyUndefined<T[K]> extends true
        ? Ref<T[K]>
        : IsOptional<T[K]> extends true
          ? NonUndefined<T[K]> extends Record<string, any>
            ? RefProxy<NonUndefined<T[K]>> | undefined
            : Ref<NonUndefined<T[K]>> | undefined
          : T[K] extends Record<string, any>
            ? RefProxy<T[K]>
            : Ref<T[K]>
    }
  : {}

// Clean branded type for better IDE display  
// This creates a distinct type that displays as Ref<T> but is structurally compatible
export type Ref<T> = {
  readonly __refProxy: true
  readonly __path: Array<string>  
  readonly __type: T
}

// Helper type to apply join optionality immediately when merging contexts
export type MergeContextWithJoinType<
  TContext extends Context,
  TNewSchema extends ContextSchema,
  TJoinType extends `inner` | `left` | `right` | `full` | `outer` | `cross`,
> = {
  baseSchema: TContext[`baseSchema`]
  // Apply optionality immediately to the schema
  schema: ApplyJoinOptionalityToMergedSchema<
    TContext[`schema`],
    TNewSchema,
    TJoinType,
    TContext[`fromSourceName`]
  >
  fromSourceName: TContext[`fromSourceName`]
  hasJoins: true
  // Track join types for reference
  joinTypes: (TContext[`joinTypes`] extends Record<string, any>
    ? TContext[`joinTypes`]
    : {}) & {
    [K in keyof TNewSchema & string]: TJoinType
  }
  result: TContext[`result`]
}

// Helper type to apply join optionality when merging new schema
export type ApplyJoinOptionalityToMergedSchema<
  TExistingSchema extends ContextSchema,
  TNewSchema extends ContextSchema,
  TJoinType extends `inner` | `left` | `right` | `full` | `outer` | `cross`,
  TFromSourceName extends string,
> = {
  // Apply optionality to existing schema based on new join type
  [K in keyof TExistingSchema]: K extends TFromSourceName
    ? // Main table becomes optional if the new join is a right or full join
      TJoinType extends `right` | `full`
      ? TExistingSchema[K] | undefined
      : TExistingSchema[K]
    : // Other tables remain as they are (already have their optionality applied)
      TExistingSchema[K]
} & {
  // Apply optionality to new schema based on join type
  [K in keyof TNewSchema]: TJoinType extends `left` | `full`
    ? // New table becomes optional for left and full joins
      TNewSchema[K] | undefined
    : // New table is required for inner and right joins
      TNewSchema[K]
}

// Helper type to get the result type from a context
export type GetResult<TContext extends Context> = Prettify<
  TContext[`result`] extends object
    ? TContext[`result`]
    : TContext[`hasJoins`] extends true
      ? // Optionality is already applied in the schema, just return it
        TContext[`schema`]
      : // Single table query - return the specific table
        TContext[`schema`][TContext[`fromSourceName`]]
>

// Helper type to apply join optionality to the schema based on joinTypes
export type ApplyJoinOptionalityToSchema<
  TSchema extends ContextSchema,
  TJoinTypes extends Record<string, string>,
  TFromSourceName extends string,
> = {
  [K in keyof TSchema]: K extends TFromSourceName
    ? // Main table (from source) - becomes optional if ANY right or full join exists
      HasJoinType<TJoinTypes, `right` | `full`> extends true
      ? TSchema[K] | undefined
      : TSchema[K]
    : // Joined table - check its specific join type AND if it's affected by subsequent joins
      K extends keyof TJoinTypes
      ? TJoinTypes[K] extends `left` | `full`
        ? TSchema[K] | undefined
        : // For inner/right joins, check if this table becomes optional due to subsequent right/full joins
          // that don't include this table
          IsTableMadeOptionalBySubsequentJoins<
              K,
              TJoinTypes,
              TFromSourceName
            > extends true
          ? TSchema[K] | undefined
          : TSchema[K]
      : TSchema[K]
}

// Helper type to check if a table becomes optional due to subsequent joins
type IsTableMadeOptionalBySubsequentJoins<
  TTableAlias extends string | number | symbol,
  TJoinTypes extends Record<string, string>,
  TFromSourceName extends string,
> = TTableAlias extends TFromSourceName
  ? // Main table becomes optional if there are any right or full joins
    HasJoinType<TJoinTypes, `right` | `full`>
  : // Joined tables are not affected by subsequent joins in our current implementation
    false

// Helper type to check if any join has one of the specified types
export type HasJoinType<
  TJoinTypes extends Record<string, string>,
  TTargetTypes extends string,
> = true extends {
  [K in keyof TJoinTypes]: TJoinTypes[K] extends TTargetTypes ? true : false
}[keyof TJoinTypes]
  ? true
  : false

// Helper type to merge contexts (for joins) - backward compatibility
export type MergeContext<
  TContext extends Context,
  TNewSchema extends ContextSchema,
> = MergeContextWithJoinType<TContext, TNewSchema, `left`>

// Type for join callbacks that doesn't apply optionality - both tables are available
export type MergeContextForJoinCallback<
  TContext extends Context,
  TNewSchema extends ContextSchema,
> = {
  baseSchema: TContext[`baseSchema`]
  // Merge schemas without applying join optionality - both are non-optional in join condition
  schema: TContext[`schema`] & TNewSchema
  fromSourceName: TContext[`fromSourceName`]
  hasJoins: true
  joinTypes: TContext[`joinTypes`] extends Record<string, any>
    ? TContext[`joinTypes`]
    : {}
  result: TContext[`result`]
}

// Helper type for updating context with result type
export type WithResult<TContext extends Context, TResult> = Prettify<
  Omit<TContext, `result`> & {
    result: Prettify<TResult>
  }
>

// Helper type to simplify complex types for better editor hints
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}
