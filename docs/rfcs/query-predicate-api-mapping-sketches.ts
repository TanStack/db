/**
 * Implementation Sketches for Query Predicate to API Mapping
 *
 * KEY PRINCIPLE: All types flow from the collection's item type T.
 * Users should NEVER need to manually specify types.
 */

// =============================================================================
// SETUP: Example types
// =============================================================================

type ExternalAccountId = string & { __brand: 'ExternalAccountId' }

interface Account {
  externalId: ExternalAccountId
}

interface AccountExternalData {
  accountId: ExternalAccountId
  data: object
  status?: string
}

interface Product {
  id: string
  categoryId: string
  price: number
  name: string
}

declare function fetchAccountsExternalData(
  ids: ExternalAccountId[],
  status?: string
): Promise<AccountExternalData[]>

// Placeholder types from the library
type LoadSubsetOptions = {
  where?: unknown
  orderBy?: unknown
  limit?: number
}
type QueryFunctionContext = { meta: { loadSubsetOptions?: LoadSubsetOptions } }
type QueryClient = unknown

// =============================================================================
// OPTION 1: Declarative Required Predicates (RECOMMENDED)
// =============================================================================

namespace Option1_DeclarativePredicates {
  // ---------------------------------------------------------------------------
  // Type utilities
  // ---------------------------------------------------------------------------

  type PredicateOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

  // Map operator to value type
  type OperatorValueType<TField, Op extends PredicateOperator> = Op extends 'in'
    ? Array<TField>
    : TField

  // Predicate spec: either shorthand string or full object
  type PredicateSpec =
    | PredicateOperator // shorthand, required by default
    | { operator: PredicateOperator; required?: boolean }

  // Normalize shorthand to full spec
  type NormalizeSpec<S extends PredicateSpec> = S extends PredicateOperator
    ? { operator: S; required: true }
    : S

  // Predicates declaration constrained to keys of T
  type PredicatesDeclaration<T extends object> = {
    [K in keyof T]?: PredicateSpec
  }

  // Compute the values object from predicates declaration
  type PredicateValues<
    T extends object,
    P extends PredicatesDeclaration<T>,
  > = {
    [K in keyof P as P[K] extends undefined ? never : K]: NormalizeSpec<
      NonNullable<P[K]>
    > extends { operator: infer Op extends PredicateOperator; required: true }
      ? OperatorValueType<K extends keyof T ? T[K] : never, Op>
      : NormalizeSpec<NonNullable<P[K]>> extends {
            operator: infer Op extends PredicateOperator
          }
        ? OperatorValueType<K extends keyof T ? T[K] : never, Op> | undefined
        : never
  }

  // ---------------------------------------------------------------------------
  // Collection config with predicates
  // ---------------------------------------------------------------------------

  interface QueryCollectionConfig<
    T extends object,
    P extends PredicatesDeclaration<T> = Record<string, never>,
  > {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    predicates?: P
    // queryFn signature changes based on whether predicates is defined
    queryFn: P extends Record<string, never>
      ? (ctx: QueryFunctionContext) => Promise<T[]>
      : (ctx: QueryFunctionContext, predicates: PredicateValues<T, P>) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  // Factory function that infers T from getKey/queryFn and P from predicates
  function queryCollectionOptions<
    T extends object,
    P extends PredicatesDeclaration<T> = Record<string, never>,
  >(config: QueryCollectionConfig<T, P>): QueryCollectionConfig<T, P> {
    return config
  }

  // ---------------------------------------------------------------------------
  // Usage examples
  // ---------------------------------------------------------------------------

  // Example 1: Simple required predicate
  const example1 = queryCollectionOptions({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],

    // ✅ 'accountId' autocompletes and type-checks against AccountExternalData
    // ❌ 'acountId' would be a compile error (typo!)
    predicates: {
      accountId: 'in',
    },

    // ✅ accountId is automatically ExternalAccountId[]
    // No manual type annotation needed!
    queryFn: async (ctx, { accountId }) => {
      return fetchAccountsExternalData(accountId)
    },

    getKey: (data: AccountExternalData) => data.accountId,
    queryClient: {} as QueryClient,
  })

  // Example 2: Required + optional predicates
  const example2 = queryCollectionOptions({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],

    predicates: {
      accountId: 'in', // Required
      status: { operator: 'eq', required: false }, // Optional
    },

    queryFn: async (ctx, { accountId, status }) => {
      // accountId: ExternalAccountId[] (always present)
      // status: string | undefined (may be absent)
      return fetchAccountsExternalData(accountId, status)
    },

    getKey: (data: AccountExternalData) => data.accountId,
    queryClient: {} as QueryClient,
  })

  // Example 3: Multiple predicates for products
  const example3 = queryCollectionOptions({
    syncMode: 'on-demand',
    queryKey: ['products'],

    predicates: {
      categoryId: 'in', // string[]
      price: { operator: 'gt', required: false }, // number | undefined
    },

    queryFn: async (ctx, { categoryId, price }) => {
      // categoryId: string[]
      // price: number | undefined
      const params = new URLSearchParams()
      params.set('categories', categoryId.join(','))
      if (price !== undefined) {
        params.set('min_price', String(price))
      }
      const response = await fetch(`/api/products?${params}`)
      return response.json()
    },

    getKey: (data: Product) => data.id,
    queryClient: {} as QueryClient,
  })

  // Example 4: No predicates (backward compatible)
  const example4 = queryCollectionOptions({
    syncMode: 'eager',
    queryKey: ['all-products'],

    // No predicates - queryFn has original signature
    queryFn: async (ctx) => {
      const response = await fetch('/api/products')
      return response.json()
    },

    getKey: (data: Product) => data.id,
    queryClient: {} as QueryClient,
  })
}

// =============================================================================
// OPTION 2: Predicate Mapper Function
// =============================================================================

namespace Option2_MapperFunction {
  // ---------------------------------------------------------------------------
  // Typed filter helper (automatically knows about T)
  // ---------------------------------------------------------------------------

  type TypedFilters<T extends object> = {
    requireIn<K extends keyof T & string>(field: K): Array<T[K]>
    optionalIn<K extends keyof T & string>(field: K): Array<T[K]> | undefined
    requireEq<K extends keyof T & string>(field: K): T[K]
    optionalEq<K extends keyof T & string>(field: K): T[K] | undefined
    requireGt<K extends keyof T & string>(field: K): T[K]
    optionalGt<K extends keyof T & string>(field: K): T[K] | undefined
    requireLt<K extends keyof T & string>(field: K): T[K]
    optionalLt<K extends keyof T & string>(field: K): T[K] | undefined
  }

  // ---------------------------------------------------------------------------
  // Collection config with mapPredicates
  // ---------------------------------------------------------------------------

  interface QueryCollectionConfig<T extends object, TArgs = void> {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    // mapPredicates receives typed helper based on T
    mapPredicates?: (
      opts: LoadSubsetOptions | undefined,
      filters: TypedFilters<T>
    ) => TArgs
    // queryFn receives TArgs (inferred from mapPredicates return type)
    queryFn: TArgs extends void
      ? (ctx: QueryFunctionContext) => Promise<T[]>
      : (ctx: QueryFunctionContext, args: TArgs) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  function queryCollectionOptions<T extends object, TArgs = void>(
    config: QueryCollectionConfig<T, TArgs>
  ): QueryCollectionConfig<T, TArgs> {
    return config
  }

  // ---------------------------------------------------------------------------
  // Usage examples
  // ---------------------------------------------------------------------------

  // Example 1: Simple mapper
  const example1 = queryCollectionOptions({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],

    mapPredicates: (opts, filters) => {
      // ✅ 'accountId' autocompletes
      // ❌ 'acountId' would be compile error
      return filters.requireIn('accountId')
      // Returns ExternalAccountId[] (inferred from T['accountId'])
    },

    // ✅ accountIds is ExternalAccountId[] (inferred from mapPredicates)
    queryFn: async (ctx, accountIds) => {
      return fetchAccountsExternalData(accountIds)
    },

    getKey: (data: AccountExternalData) => data.accountId,
    queryClient: {} as QueryClient,
  })

  // Example 2: Complex mapping to object
  const example2 = queryCollectionOptions({
    syncMode: 'on-demand',
    queryKey: ['products'],

    mapPredicates: (opts, filters) => ({
      categoryIds: filters.requireIn('categoryId'), // string[]
      minPrice: filters.optionalGt('price'), // number | undefined
      maxPrice: filters.optionalLt('price'), // number | undefined
    }),

    queryFn: async (ctx, { categoryIds, minPrice, maxPrice }) => {
      // All types inferred automatically
      const params = new URLSearchParams()
      params.set('categories', categoryIds.join(','))
      if (minPrice !== undefined) params.set('min_price', String(minPrice))
      if (maxPrice !== undefined) params.set('max_price', String(maxPrice))
      const response = await fetch(`/api/products?${params}`)
      return response.json()
    },

    getKey: (data: Product) => data.id,
    queryClient: {} as QueryClient,
  })
}

// =============================================================================
// OPTION 3: Collection Parameters (Query Builder Integration)
// =============================================================================

namespace Option3_CollectionParameters {
  // ---------------------------------------------------------------------------
  // Parameterized collection types
  // ---------------------------------------------------------------------------

  interface QueryCollectionConfig<
    T extends object,
    TParam extends keyof T & string = never,
  > {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    // Parameter field must be a valid key of T
    parameter?: TParam
    // queryFn receives array of T[TParam] when parameter is defined
    queryFn: [TParam] extends [never]
      ? (ctx: QueryFunctionContext) => Promise<T[]>
      : (ctx: QueryFunctionContext, values: Array<T[TParam]>) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  // Collection with parameter info embedded in type
  interface ParameterizedCollection<
    T extends object,
    TParam extends keyof T & string,
  > {
    __item: T
    __param: TParam
    __paramType: T[TParam]
  }

  function queryCollectionOptions<
    T extends object,
    TParam extends keyof T & string = never,
  >(config: QueryCollectionConfig<T, TParam>) {
    return config as unknown as ParameterizedCollection<T, TParam>
  }

  // ---------------------------------------------------------------------------
  // Query builder types (conceptual)
  // ---------------------------------------------------------------------------

  // From clause that requires parameter for parameterized collections
  type FromSource<TCollection> = TCollection extends ParameterizedCollection<
    infer T,
    infer TParam
  >
    ? {
        [alias: string]: TCollection
      } & {
        // Must provide the parameter!
        [K in TParam]: Array<T[TParam]> | SubqueryProducingType<T[TParam]>
      }
    : { [alias: string]: TCollection }

  type SubqueryProducingType<T> = { __produces: T }

  // ---------------------------------------------------------------------------
  // Usage examples
  // ---------------------------------------------------------------------------

  // Define collection with parameter
  const accountExternalDataCollection = queryCollectionOptions<
    AccountExternalData,
    'accountId'
  >({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],

    // Parameter field validated against AccountExternalData
    parameter: 'accountId',

    // queryFn receives ExternalAccountId[] (inferred from T['accountId'])
    queryFn: async (ctx, accountIds) => {
      return fetchAccountsExternalData(accountIds)
    },

    getKey: (data) => data.accountId,
    queryClient: {} as QueryClient,
  })

  // In query builder (conceptual):
  // q.from({
  //   data: accountExternalDataCollection,
  //   accountId: subquery.select(x => x.externalId),  // Type checked!
  // })
}

// =============================================================================
// IMPLEMENTATION: Core type utilities for Option 1
// =============================================================================

namespace Implementation {
  /**
   * These are the core type utilities needed to implement Option 1.
   * They demonstrate how types flow from T without manual annotations.
   */

  type PredicateOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

  // Map operator to resulting value type
  type OperatorToValueType<TFieldType, Op extends PredicateOperator> =
    Op extends 'in' ? Array<TFieldType> : TFieldType

  // Predicate spec can be shorthand or full object
  type PredicateSpec =
    | PredicateOperator
    | { operator: PredicateOperator; required?: boolean }

  // Extract operator from spec
  type ExtractOperator<S extends PredicateSpec> = S extends PredicateOperator
    ? S
    : S extends { operator: infer Op extends PredicateOperator }
      ? Op
      : never

  // Check if spec is required
  type IsRequired<S extends PredicateSpec> = S extends PredicateOperator
    ? true // Shorthand is required by default
    : S extends { required: false }
      ? false
      : true // Object without required: false is required

  // Predicates must be valid keys of T
  type PredicatesFor<T extends object> = {
    [K in keyof T]?: PredicateSpec
  }

  // Compute predicate values object
  type ComputePredicateValues<
    T extends object,
    P extends PredicatesFor<T>,
  > = {
    // Only include keys that are defined in P
    [K in keyof P as P[K] extends undefined ? never : K]:
      // Get the field type from T
      K extends keyof T
        ? // Get operator from the predicate spec
          ExtractOperator<NonNullable<P[K]>> extends infer Op extends PredicateOperator
          ? // Map to value type
            IsRequired<NonNullable<P[K]>> extends true
            ? OperatorToValueType<T[K], Op>
            : OperatorToValueType<T[K], Op> | undefined
          : never
        : never
  }

  // ---------------------------------------------------------------------------
  // Example: Show type computation
  // ---------------------------------------------------------------------------

  type ExamplePredicates = {
    accountId: 'in'
    status: { operator: 'eq'; required: false }
  }

  // This computes to:
  // {
  //   accountId: ExternalAccountId[]  // Required array
  //   status: string | undefined       // Optional single value
  // }
  type ExampleValues = ComputePredicateValues<AccountExternalData, ExamplePredicates>

  // Verify the types
  const _check: ExampleValues = {
    accountId: ['abc' as ExternalAccountId], // ExternalAccountId[]
    status: undefined, // string | undefined
  }
}

export {}
