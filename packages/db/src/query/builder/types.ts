import type { CollectionImpl } from "../../collection.js"
import type { Aggregate, BasicExpression, OrderByDirection } from "../ir.js"
import type { QueryBuilder } from "./index.js"
import type { ResolveType } from "../../types.js"

/**
 * Context - The central state container for query builder operations
 *
 * This interface tracks all the information needed to build and type-check queries:
 *
 * **Schema Management**:
 * - `baseSchema`: The original tables/collections from the `from()` clause
 * - `schema`: Current available tables (expands with joins, contracts with subqueries)
 *
 * **Query State**:
 * - `fromSourceName`: Which table was used in `from()` - needed for optionality logic
 * - `hasJoins`: Whether any joins have been added (affects result type inference)
 * - `joinTypes`: Maps table aliases to their join types for optionality calculations
 *
 * **Result Tracking**:
 * - `result`: The final shape after `select()` - undefined until select is called
 *
 * The context evolves through the query builder chain:
 * 1. `from()` sets baseSchema and schema to the same thing
 * 2. `join()` expands schema and sets hasJoins/joinTypes
 * 3. `select()` sets result to the projected shape
 */
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

/**
 * ContextSchema - The shape of available tables/collections in a query context
 *
 * This is simply a record mapping table aliases to their TypeScript types.
 * It evolves as the query progresses:
 * - Initial: Just the `from()` table
 * - After joins: Includes all joined tables with proper optionality
 * - In subqueries: May be a subset of the outer query's schema
 */
export type ContextSchema = Record<string, unknown>

/**
 * Source - Input definition for query builder `from()` clause
 *
 * Maps table aliases to either:
 * - `CollectionImpl`: A database collection/table
 * - `QueryBuilder`: A subquery that can be used as a table
 *
 * Example: `{ users: usersCollection, orders: ordersCollection }`
 */
export type Source = {
  [alias: string]: CollectionImpl<any, any> | QueryBuilder<Context>
}

/**
 * InferCollectionType - Extracts the TypeScript type from a CollectionImpl
 *
 * This helper ensures we get the same type that would be used when creating
 * the collection itself. It uses the internal `ResolveType` logic to maintain
 * consistency between collection creation and query type inference.
 *
 * The complex generic parameters extract:
 * - U: The base document type
 * - TSchema: The schema definition
 * - The resolved type combines these with any transforms
 */
export type InferCollectionType<T> =
  T extends CollectionImpl<infer U, any, any, infer TSchema, any>
    ? ResolveType<U, TSchema, U>
    : never

/**
 * SchemaFromSource - Converts a Source definition into a ContextSchema
 *
 * This transforms the input to `from()` into the schema format used throughout
 * the query builder. For each alias in the source:
 * - Collections → their inferred TypeScript type
 * - Subqueries → their result type (what they would return if executed)
 *
 * The `Prettify` wrapper ensures clean type display in IDEs.
 */
export type SchemaFromSource<T extends Source> = Prettify<{
  [K in keyof T]: T[K] extends CollectionImpl<any, any, any, any, any>
    ? InferCollectionType<T[K]>
    : T[K] extends QueryBuilder<infer TContext>
      ? GetResult<TContext>
      : never
}>

/**
 * GetAliases - Extracts all table aliases available in a query context
 *
 * Simple utility type that returns the keys of the schema, representing
 * all table/collection aliases that can be referenced in the current query.
 */
export type GetAliases<TContext extends Context> = keyof TContext[`schema`]

/**
 * WhereCallback - Type for where/having clause callback functions
 *
 * These callbacks receive a `refs` object containing RefProxy instances for
 * all available tables. The callback should return a boolean expression
 * that will be used to filter query results.
 *
 * Example: `(refs) => eq(refs.users.age, 25)`
 */
export type WhereCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

/**
 * SelectValue - Union of all valid values in a select clause
 *
 * This type defines what can be used as values in the object passed to `select()`.
 *
 * **Core Expression Types**:
 * - `BasicExpression`: Function calls like `upper(users.name)`
 * - `Aggregate`: Aggregations like `count()`, `avg()`
 * - `RefProxy/Ref`: Direct field references like `users.name`
 *
 * **JavaScript Literals** (for constant values in projections):
 * - `string`: String literals like `'active'`, `'N/A'`
 * - `number`: Numeric literals like `0`, `42`, `3.14`
 * - `boolean`: Boolean literals `true`, `false`
 * - `null`: Explicit null values
 *
 * **Advanced Features**:
 * - `undefined`: Allows optional projection values
 * - `{ [key: string]: SelectValue }`: Nested object projection
 * - `PrecomputeRefStructure<any>`: Spread operations like `...users`
 *
 * Note: The runtime spread implementation uses internal RefProxy properties
 * but these are hidden from the type system for cleaner typing.
 *
 * Examples:
 * ```typescript
 * select({
 *   id: users.id,
 *   name: users.name,
 *   status: 'active',        // string literal
 *   priority: 1,             // number literal
 *   verified: true,          // boolean literal
 *   notes: null,             // explicit null
 *   profile: {
 *     name: users.name,
 *     email: users.email
 *   }
 * })
 * ```
 */
type SelectValue =
  | BasicExpression
  | Aggregate
  | RefProxy
  | RefProxyFor<any>
  | Ref<any>
  | string // String literals
  | number // Numeric literals
  | boolean // Boolean literals
  | null // Explicit null
  | undefined // Optional values
  | { [key: string]: SelectValue }
  | PrecomputeRefStructure<any>
  | SpreadableRefProxy<any> // For spread operations without internal properties
  | Array<Ref<any>>

// Recursive shape for select objects allowing nested projections
type SelectShape = { [key: string]: SelectValue | SelectShape }

/**
 * SelectObject - Wrapper type for select clause objects
 *
 * This ensures that objects passed to `select()` have valid SelectValue types
 * for all their properties. It's a simple wrapper that provides better error
 * messages when invalid selections are attempted.
 */
export type SelectObject<T extends SelectShape = SelectShape> = T

/**
 * ResultTypeFromSelect - Infers the result type from a select object
 *
 * This complex type transforms the input to `select()` into the actual TypeScript
 * type that the query will return. It handles all the different kinds of values
 * that can appear in a select clause:
 *
 * **Ref/RefProxy Extraction**:
 * - `RefProxy<T>` → `T`: Extracts the underlying type
 * - `Ref<T> | undefined` → `T | undefined`: Preserves optionality
 * - `Ref<T> | null` → `T | null`: Preserves nullability
 *
 * **Expression Types**:
 * - `BasicExpression<T>` → `T`: Function results like `upper()` → `string`
 * - `Aggregate<T>` → `T`: Aggregation results like `count()` → `number`
 *
 * **JavaScript Literals** (pass through as-is):
 * - `string` → `string`: String literals remain strings
 * - `number` → `number`: Numeric literals remain numbers
 * - `boolean` → `boolean`: Boolean literals remain booleans
 * - `null` → `null`: Explicit null remains null
 *
 * **Nested Objects** (recursive):
 * - Plain objects are recursively processed to handle nested projections
 * - RefProxy objects are detected and excluded from recursion
 *
 * **Special Cases**:
 * - `undefined` → `undefined`: Direct undefined values
 * - Objects with `__type` → the type (for internal RefProxy handling)
 *
 * Example transformation:
 * ```typescript
 * // Input:
 * { id: Ref<number>, name: Ref<string>, status: 'active', count: 42, profile: { bio: Ref<string> } }
 *
 * // Output:
 * { id: number, name: string, status: 'active', count: 42, profile: { bio: string } }
 * ```
 */
export type ResultTypeFromSelect<TSelectObject> = {
  [K in keyof StripInternalKeys<TSelectObject>]: StripInternalKeys<TSelectObject>[K] extends RefProxy<
    infer T
  >
    ? T
    : StripInternalKeys<TSelectObject>[K] extends Ref<infer T>
      ? T
      : StripInternalKeys<TSelectObject>[K] extends Ref<infer T> | undefined
        ? T | undefined
        : StripInternalKeys<TSelectObject>[K] extends Ref<infer T> | null
          ? T | null
          : StripInternalKeys<TSelectObject>[K] extends
                | RefProxy<infer T>
                | undefined
            ? T | undefined
            : StripInternalKeys<TSelectObject>[K] extends RefProxy<
                  infer T
                > | null
              ? T | null
              : StripInternalKeys<TSelectObject>[K] extends BasicExpression<
                    infer T
                  >
                ? T
                : StripInternalKeys<TSelectObject>[K] extends Aggregate<infer T>
                  ? T
                  : StripInternalKeys<TSelectObject>[K] extends string
                    ? string
                    : StripInternalKeys<TSelectObject>[K] extends number
                      ? number
                      : StripInternalKeys<TSelectObject>[K] extends boolean
                        ? boolean
                        : StripInternalKeys<TSelectObject>[K] extends null
                          ? null
                          : StripInternalKeys<TSelectObject>[K] extends undefined
                            ? undefined
                            : StripInternalKeys<TSelectObject>[K] extends {
                                  __type: infer U
                                }
                              ? U
                              : StripInternalKeys<TSelectObject>[K] extends Record<
                                    string,
                                    any
                                  >
                                ? ResultTypeFromSelect<
                                    StripInternalKeys<
                                      StripInternalKeys<TSelectObject>[K]
                                    >
                                  >
                                : never
}

// Helper to strip internal RefProxy keys from any object type
type StripInternalKeys<T> =
  T extends Record<string, any>
    ? Omit<T, `__refProxy` | `__path` | `__type`>
    : T

/**
 * OrderByCallback - Type for orderBy clause callback functions
 *
 * Similar to WhereCallback, these receive refs for all available tables
 * and should return expressions that will be used for sorting.
 *
 * Example: `(refs) => refs.users.createdAt`
 */
export type OrderByCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

/**
 * OrderByOptions - Configuration for orderBy operations
 *
 * Combines direction and null handling with string-specific sorting options.
 * The intersection with StringSortOpts allows for either simple lexical sorting
 * or locale-aware sorting with customizable options.
 */
export type OrderByOptions = {
  direction?: OrderByDirection
  nulls?: `first` | `last`
} & StringSortOpts

/**
 * StringSortOpts - Options for string sorting behavior
 *
 * This discriminated union allows for two types of string sorting:
 * - **Lexical**: Simple character-by-character comparison (default)
 * - **Locale**: Locale-aware sorting with optional customization
 *
 * The union ensures that locale options are only available when locale sorting is selected.
 */
export type StringSortOpts =
  | {
      stringSort?: `lexical`
    }
  | {
      stringSort?: `locale`
      locale?: string
      localeOptions?: object
    }

/**
 * CompareOptions - Final resolved options for comparison operations
 *
 * This is the internal type used after all orderBy options have been resolved
 * to their concrete values. Unlike OrderByOptions, all fields are required
 * since defaults have been applied.
 */
export type CompareOptions = {
  direction: OrderByDirection
  nulls: `first` | `last`
  stringSort: `lexical` | `locale`
  locale?: string
  localeOptions?: object
}

/**
 * GroupByCallback - Type for groupBy clause callback functions
 *
 * These callbacks receive refs for all available tables and should return
 * expressions that will be used for grouping query results.
 *
 * Example: `(refs) => refs.orders.status`
 */
export type GroupByCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

/**
 * JoinOnCallback - Type for join condition callback functions
 *
 * These callbacks receive refs for all available tables (including the newly
 * joined table) and should return a boolean expression defining the join condition.
 *
 * Important: The newly joined table is NOT marked as optional in this callback,
 * even for left/right/full joins, because optionality is applied AFTER the join
 * condition is evaluated.
 *
 * Example: `(refs) => eq(refs.users.id, refs.orders.userId)`
 */
export type JoinOnCallback<TContext extends Context> = (
  refs: RefProxyForContext<TContext>
) => any

/**
 * RefProxyForContext - Creates ref proxies for all tables/collections in a query context
 *
 * This is the main entry point for creating ref objects in query builder callbacks.
 * It handles optionality by placing undefined/null OUTSIDE the RefProxy to enable
 * JavaScript's optional chaining operator (?.):
 *
 * Examples:
 * - Required field: `RefProxy<User>` → user.name works
 * - Optional field: `RefProxy<User> | undefined` → user?.name works
 * - Nullable field: `RefProxy<User> | null` → user?.name works
 *
 * The key insight is that `RefProxy<User | undefined>` would NOT allow `user?.name`
 * because the undefined is "inside" the proxy, but `RefProxy<User> | undefined`
 * does allow it because the undefined is "outside" the proxy.
 */
export type RefProxyForContext<TContext extends Context> = {
  [K in keyof TContext[`schema`]]: IsExactlyUndefined<
    TContext[`schema`][K]
  > extends true
    ? // T is exactly undefined - wrap in RefProxy as-is
      RefProxy<TContext[`schema`][K]>
    : IsExactlyNull<TContext[`schema`][K]> extends true
      ? // T is exactly null - wrap in RefProxy as-is
        RefProxy<TContext[`schema`][K]>
      : IsOptional<TContext[`schema`][K]> extends true
        ? // T is optional (T | undefined) but not exactly undefined
          // Extract the non-undefined part and place undefined outside
          RefProxy<NonUndefined<TContext[`schema`][K]>> | undefined
        : IsNullable<TContext[`schema`][K]> extends true
          ? // T is nullable (T | null) but not exactly null
            // Extract the non-null part and place null outside
            RefProxy<NonNull<TContext[`schema`][K]>> | null
          : // T is not optional or nullable - always wrap in RefProxy for top-level schema types
            RefProxy<TContext[`schema`][K]>
}

/**
 * Type Detection Helpers
 *
 * These helpers distinguish between different kinds of optionality/nullability:
 * - IsExactlyUndefined: T is literally `undefined` (not `string | undefined`)
 * - IsOptional: T includes undefined (like `string | undefined`)
 * - IsExactlyNull: T is literally `null` (not `string | null`)
 * - IsNullable: T includes null (like `string | null`)
 *
 * The [T] extends [undefined] pattern prevents distributive conditional types,
 * ensuring we check the exact type rather than distributing over union members.
 */

// Helper type to check if T is exactly undefined
type IsExactlyUndefined<T> = [T] extends [undefined] ? true : false

// Helper type to check if T is exactly null
type IsExactlyNull<T> = [T] extends [null] ? true : false

// Helper type to check if T includes undefined (is optional)
type IsOptional<T> = undefined extends T ? true : false

// Helper type to check if T includes null (is nullable)
type IsNullable<T> = null extends T ? true : false

/**
 * Type Extraction Helpers
 *
 * These helpers extract the "useful" part of a type by removing null/undefined:
 * - NonUndefined: `string | undefined` → `string`
 * - NonNull: `string | null` → `string`
 */

// Helper type to extract non-undefined type
type NonUndefined<T> = T extends undefined ? never : T

// Helper type to extract non-null type
type NonNull<T> = T extends null ? never : T

/**
 * PrecomputeRefStructure - Transforms object types into ref structures
 *
 * This is a key architectural decision: only LEAF values are wrapped in Ref<T>,
 * while intermediate objects remain as plain TypeScript objects. This allows:
 *
 * 1. Natural spread operator: `...user.profile` works because profile is a plain object
 * 2. Clean type display: Objects show their actual structure, not RefProxy internals
 * 3. Better IDE experience: Autocomplete works on intermediate objects
 *
 * Examples:
 * Input:  { bio: string, contact: { email: string, phone?: string } }
 * Output: { bio: Ref<string>, contact: { email: Ref<string>, phone: Ref<string> | undefined } }
 *
 * The recursion handles nested objects while preserving optionality/nullability:
 * - For optional objects: The object structure is preserved, undefined goes outside
 * - For optional leaves: Ref<T> | undefined (undefined outside the Ref)
 * - For nullable objects: The object structure is preserved, null goes outside
 * - For nullable leaves: Ref<T> | null (null outside the Ref)
 */
export type PrecomputeRefStructure<T extends Record<string, any>> = {
  [K in keyof T]: IsExactlyUndefined<T[K]> extends true
    ? Ref<T[K]>
    : IsExactlyNull<T[K]> extends true
      ? Ref<T[K]>
      : IsOptional<T[K]> extends true
        ? NonUndefined<T[K]> extends Record<string, any>
          ? // Optional object: recurse on non-undefined version, place undefined outside
            PrecomputeRefStructure<NonUndefined<T[K]>> | undefined
          : // Optional leaf: wrap in Ref, place undefined outside
            Ref<NonUndefined<T[K]>> | undefined
        : IsNullable<T[K]> extends true
          ? NonNull<T[K]> extends Record<string, any>
            ? // Nullable object: recurse on non-null version, place null outside
              PrecomputeRefStructure<NonNull<T[K]>> | null
            : // Nullable leaf: wrap in Ref, place null outside
              Ref<NonNull<T[K]>> | null
          : T[K] extends Record<string, any>
            ? // Non-optional/nullable object: recurse to handle nested structure
              PrecomputeRefStructure<T[K]>
            : // Non-optional/nullable leaf: wrap in Ref
              Ref<T[K]>
}

/**
 * RefProxyFor - Backward compatibility wrapper for creating refs from any type
 *
 * This is a simplified version of the ref creation logic that can be used
 * for individual types rather than entire query contexts. It's useful for:
 * - Standalone composable functions
 * - Reusable query fragments
 * - Backward compatibility with existing code
 *
 * It follows the same principles as PrecomputeRefStructure and RefProxyForContext:
 * - Place undefined/null outside refs for optional chaining support
 * - Only wrap leaf values in RefProxy/Ref
 * - Preserve object structures for spread operations
 */
export type RefProxyFor<T> =
  IsExactlyUndefined<T> extends true
    ? RefProxy<T>
    : IsOptional<T> extends true
      ? NonUndefined<T> extends Record<string, any>
        ? PrecomputeRefStructure<NonUndefined<T>> | undefined
        : RefProxy<T>
      : T extends Record<string, any>
        ? PrecomputeRefStructure<T>
        : RefProxy<T>

/**
 * RefProxy - The core ref interface that powers the query builder
 *
 * This is the foundational type that represents a reference to a value in the query.
 * It contains internal metadata for tracking the path to the value and its type,
 * plus user-facing properties that mirror the structure of the referenced type.
 *
 * Key features:
 * 1. **Internal metadata**: __refProxy, __path, __type for runtime and type system
 * 2. **Recursive structure**: Object properties become nested RefProxy/Ref types
 * 3. **Optionality handling**: undefined/null are placed outside refs for ?. support
 * 4. **Type preservation**: The structure mirrors the original type as closely as possible
 * 5. **Spread support**: Internal properties are hidden during spread operations
 *
 * Examples:
 * RefProxy<string> → { __refProxy: true, __path: [...], __type: string }
 * RefProxy<{name: string}> → {
 *   __refProxy: true, __path: [...], __type: {...},
 *   name: Ref<string>  // Clean display, same as RefProxy<string>
 * }
 *
 * The intersection (&) with the conditional type ensures that:
 * - For primitive types: Only internal metadata is added
 * - For object types: Properties are recursively transformed with optionality preserved
 * - For undefined: No additional properties (just metadata)
 * - For spreads: Internal properties are excluded from type checking
 */
export type RefProxy<T = any> = {
  /** @internal - Runtime marker to identify ref proxy objects */
  readonly __refProxy: true
  /** @internal - Path segments for building query expressions */
  readonly __path: Array<string>
  /** @internal - Type information for TypeScript inference */
  readonly __type: T
} & (T extends undefined
  ? {} // undefined types get no additional properties
  : T extends Record<string, any>
    ? {
        // Object types get recursive property transformation
        [K in keyof T]: IsExactlyUndefined<T[K]> extends true
          ? Ref<T[K]> // Exactly undefined: wrap in Ref as-is
          : IsExactlyNull<T[K]> extends true
            ? Ref<T[K]> // Exactly null: wrap in Ref as-is
            : IsOptional<T[K]> extends true
              ? NonUndefined<T[K]> extends Record<string, any>
                ? RefProxy<NonUndefined<T[K]>> | undefined // Optional object
                : Ref<NonUndefined<T[K]>> | undefined // Optional leaf
              : IsNullable<T[K]> extends true
                ? NonNull<T[K]> extends Record<string, any>
                  ? RefProxy<NonNull<T[K]>> | null // Nullable object
                  : Ref<NonNull<T[K]>> | null // Nullable leaf
                : T[K] extends Record<string, any>
                  ? RefProxy<T[K]> // Required object: full RefProxy
                  : Ref<T[K]> // Required leaf: clean Ref display
      }
    : {}) // Primitive types get no additional properties

/**
 * SpreadableRefProxy - Type for spread operations that excludes internal properties
 *
 * This type represents what you get when you spread a RefProxy. It omits the internal
 * properties (__refProxy, __path, __type) and only includes the user-facing properties
 * that should be part of the spread operation.
 *
 * This enables clean spread operations like:
 * ```typescript
 * select({
 *   id: employees.id,
 *   name: employees.name,
 *   ...employees.profile  // Only spreads bio, skills, contact - not __refProxy etc.
 * })
 * ```
 */
export type SpreadableRefProxy<T> = Omit<
  RefProxy<T>,
  `__refProxy` | `__path` | `__type`
>

/**
 * Ref - The user-facing ref type with clean IDE display
 *
 * Structurally compatible with `RefProxy<T>` so runtime proxies can be used
 * wherever a `Ref<T>` is expected, while hiding internal proxy properties.
 *
 * - For object types: exposes the same nested property structure, with leaves
 *   typed as `Ref<Leaf>` and optionality/nullability preserved outside the Ref.
 * - For primitives: an opaque branded wrapper so hovers show `Ref<T>`.
 */
declare const RefBrand: unique symbol
type RefLeaf<T> = { readonly [RefBrand]?: T }
export type Ref<T = any> = T extends undefined
  ? RefLeaf<T>
  : T extends Record<string, any>
    ? {
        [K in keyof T]: IsExactlyUndefined<T[K]> extends true
          ? Ref<T[K]>
          : IsExactlyNull<T[K]> extends true
            ? Ref<T[K]>
            : IsOptional<T[K]> extends true
              ? NonUndefined<T[K]> extends Record<string, any>
                ?
                    | (Ref<NonUndefined<T[K]>> | RefProxy<NonUndefined<T[K]>>)
                    | undefined
                : Ref<NonUndefined<T[K]>> | undefined
              : IsNullable<T[K]> extends true
                ? NonNull<T[K]> extends Record<string, any>
                  ? (Ref<NonNull<T[K]>> | RefProxy<NonNull<T[K]>>) | null
                  : Ref<NonNull<T[K]>> | null
                : T[K] extends Record<string, any>
                  ? Ref<T[K]> | RefProxy<T[K]>
                  : Ref<T[K]>
      } & RefLeaf<T>
    : RefLeaf<T>

/**
 * MergeContextWithJoinType - Creates a new context after a join operation
 *
 * This is the core type that handles the complex logic of merging schemas
 * when tables are joined, applying the correct optionality based on join type.
 *
 * **Key Responsibilities**:
 * 1. **Schema Merging**: Combines existing schema with newly joined tables
 * 2. **Optionality Logic**: Applies join-specific optionality rules:
 *    - `LEFT JOIN`: New table becomes optional
 *    - `RIGHT JOIN`: Existing tables become optional
 *    - `FULL JOIN`: Both existing and new become optional
 *    - `INNER JOIN`: No tables become optional
 * 3. **State Tracking**: Updates hasJoins and joinTypes for future operations
 *
 * **Context Evolution**:
 * - `baseSchema`: Unchanged (always the original `from()` tables)
 * - `schema`: Expanded with new tables and proper optionality
 * - `hasJoins`: Set to true
 * - `joinTypes`: Updated to track this join type
 * - `result`: Preserved from previous operations
 */
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

/**
 * ApplyJoinOptionalityToMergedSchema - Applies optionality rules when merging schemas
 *
 * This type implements the SQL join optionality semantics:
 *
 * **For Existing Tables**:
 * - `RIGHT JOIN` or `FULL JOIN`: Main table (from fromSourceName) becomes optional
 * - Other join types: Existing tables keep their current optionality
 * - Previously joined tables: Keep their already-applied optionality
 *
 * **For New Tables**:
 * - `LEFT JOIN` or `FULL JOIN`: New table becomes optional
 * - `INNER JOIN` or `RIGHT JOIN`: New table remains required
 *
 * **Examples**:
 * ```sql
 * FROM users LEFT JOIN orders  -- orders becomes optional
 * FROM users RIGHT JOIN orders -- users becomes optional
 * FROM users FULL JOIN orders  -- both become optional
 * FROM users INNER JOIN orders -- both remain required
 * ```
 *
 * The intersection (&) ensures both existing and new schemas are merged
 * into a single type while preserving all table references.
 */
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

/**
 * GetResult - Determines the final result type of a query
 *
 * This type implements the logic for what a query returns based on its current state:
 *
 * **Priority Order**:
 * 1. **Explicit Result**: If `select()` was called, use the projected type
 * 2. **Join Query**: If joins exist, return all tables with proper optionality
 * 3. **Single Table**: Return just the main table from `from()`
 *
 * **Examples**:
 * ```typescript
 * // Single table query:
 * from({ users }).where(...) // → User[]
 *
 * // Join query without select:
 * from({ users }).leftJoin({ orders }, ...) // → { users: User, orders: Order | undefined }[]
 *
 * // Query with select:
 * from({ users }).select({ id: users.id, name: users.name }) // → { id: number, name: string }[]
 * ```
 *
 * The `Prettify` wrapper ensures clean type display in IDEs by flattening
 * complex intersection types into readable object types.
 */
export type GetResult<TContext extends Context> = Prettify<
  TContext[`result`] extends object
    ? TContext[`result`]
    : TContext[`hasJoins`] extends true
      ? // Optionality is already applied in the schema, just return it
        TContext[`schema`]
      : // Single table query - return the specific table
        TContext[`schema`][TContext[`fromSourceName`]]
>

/**
 * ApplyJoinOptionalityToSchema - Legacy helper for complex join scenarios
 *
 * This type was designed to handle complex scenarios with multiple joins
 * where the optionality of tables might be affected by subsequent joins.
 * Currently used in advanced join logic, but most cases are handled by
 * the simpler `ApplyJoinOptionalityToMergedSchema`.
 *
 * **Logic**:
 * 1. **Main Table**: Becomes optional if ANY right or full join exists in the chain
 * 2. **Joined Tables**: Check their specific join type for optionality
 * 3. **Complex Cases**: Handle scenarios where subsequent joins affect earlier tables
 *
 * This is primarily used for edge cases and may be simplified in future versions
 * as the simpler merge-based approach covers most real-world scenarios.
 */
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

/**
 * IsTableMadeOptionalBySubsequentJoins - Checks if later joins affect table optionality
 *
 * This helper determines if a table that was initially required becomes optional
 * due to joins that happen later in the query chain.
 *
 * **Current Implementation**:
 * - Main table: Becomes optional if any right/full joins exist
 * - Joined tables: Not affected by subsequent joins (simplified model)
 *
 * This is a conservative approach that may be extended in the future to handle
 * more complex join interaction scenarios.
 */
type IsTableMadeOptionalBySubsequentJoins<
  TTableAlias extends string | number | symbol,
  TJoinTypes extends Record<string, string>,
  TFromSourceName extends string,
> = TTableAlias extends TFromSourceName
  ? // Main table becomes optional if there are any right or full joins
    HasJoinType<TJoinTypes, `right` | `full`>
  : // Joined tables are not affected by subsequent joins in our current implementation
    false

/**
 * HasJoinType - Utility to check if any join in a chain matches target types
 *
 * This type searches through all recorded join types to see if any match
 * the specified target types. It's used to implement logic like "becomes optional
 * if ANY right or full join exists in the chain".
 *
 * **How it works**:
 * 1. Maps over all join types, checking each against target types
 * 2. Creates a union of boolean results
 * 3. Uses `true extends Union` pattern to check if any were true
 *
 * **Example**:
 * ```typescript
 * HasJoinType<{ orders: 'left', products: 'right' }, 'right' | 'full'>
 * // → true (because products is a right join)
 * ```
 */
export type HasJoinType<
  TJoinTypes extends Record<string, string>,
  TTargetTypes extends string,
> = true extends {
  [K in keyof TJoinTypes]: TJoinTypes[K] extends TTargetTypes ? true : false
}[keyof TJoinTypes]
  ? true
  : false

/**
 * MergeContextForJoinCallback - Special context for join condition callbacks
 *
 * This type creates a context specifically for the `onCallback` parameter of join operations.
 * The key difference from `MergeContextWithJoinType` is that NO optionality is applied here.
 *
 * **Why No Optionality?**
 * In SQL, join conditions are evaluated BEFORE optionality is determined. Both tables
 * must be treated as available (non-optional) within the join condition itself.
 * Optionality is only applied to the result AFTER the join logic executes.
 *
 * **Example**:
 * ```typescript
 * .leftJoin({ orders }, (refs) => {
 *   // refs.users is NOT optional here - we can access users.id directly
 *   // refs.orders is NOT optional here - we can access orders.userId directly
 *   return eq(refs.users.id, refs.orders.userId)
 * })
 * .where((refs) => {
 *   // NOW refs.orders is optional because it's after the LEFT JOIN
 *   return refs.orders?.status === 'pending'
 * })
 * ```
 *
 * The simple intersection (&) merges schemas without any optionality transformation.
 */
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

/**
 * WithResult - Updates a context with a new result type after select()
 *
 * This utility type is used internally when the `select()` method is called
 * to update the context with the projected result type. It preserves all
 * other context properties while replacing the `result` field.
 *
 * **Usage**:
 * When `select()` is called, the query builder uses this type to create
 * a new context where `result` contains the shape of the selected fields.
 *
 * The double `Prettify` ensures both the overall context and the nested
 * result type display cleanly in IDEs.
 */
export type WithResult<TContext extends Context, TResult> = Prettify<
  Omit<TContext, `result`> & {
    result: Prettify<TResult>
  }
>

/**
 * Prettify - Utility type for clean IDE display
 *
 * This type flattens complex intersection types and conditional types
 * into simple object types for better readability in IDE tooltips and
 * error messages.
 *
 * **How it works**:
 * The mapped type `{ [K in keyof T]: T[K] }` forces TypeScript to
 * evaluate all the properties of T, and the intersection with `{}`
 * flattens the result into a single object type.
 *
 * **Example**:
 * ```typescript
 * // Without Prettify: { name: string } & { age: number } & SomeComplexType
 * // With Prettify: { name: string; age: number; ...otherProps }
 * ```
 */
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}
