/**
 * Implementation Sketches for Query Predicate to API Mapping
 *
 * This file contains TypeScript implementation sketches for the various
 * options discussed in query-predicate-api-mapping.md
 */

// =============================================================================
// SETUP: Types used across all examples
// =============================================================================

type ExternalAccountId = string & { __brand: 'ExternalAccountId' }

interface Account {
  externalId: ExternalAccountId
}

interface AccountExternalData {
  accountId: ExternalAccountId
  data: object
}

declare function fetchAccountsExternalData(
  ids: ExternalAccountId[]
): Promise<AccountExternalData[]>

// Placeholder types from the library
type LoadSubsetOptions = {
  where?: BasicExpression<boolean>
  orderBy?: OrderBy
  limit?: number
}
type BasicExpression<T> = unknown
type OrderBy = unknown
type QueryFunctionContext = { meta: { loadSubsetOptions?: LoadSubsetOptions } }
type QueryClient = unknown
type Collection<T> = unknown
type QueryCollectionConfig<T> = unknown

// =============================================================================
// OPTION 1: Schema-Aware Typed Filter Extraction
// =============================================================================

namespace Option1 {
  // The extraction helper type
  type FilterExtractor<T> = {
    requireIn<K extends keyof T & string>(field: K): Array<T[K]>
    optionalIn<K extends keyof T & string>(field: K): Array<T[K]> | undefined
    requireEq<K extends keyof T & string>(field: K): T[K]
    optionalEq<K extends keyof T & string>(field: K): T[K] | undefined
    requireGt<K extends keyof T & string>(field: K): T[K]
    requireLt<K extends keyof T & string>(field: K): T[K]
    optionalGt<K extends keyof T & string>(field: K): T[K] | undefined
    optionalLt<K extends keyof T & string>(field: K): T[K] | undefined
  }

  // Implementation
  function extractTypedFilters<T extends object>(
    options: LoadSubsetOptions | undefined
  ): FilterExtractor<T> {
    // const { filters } = parseLoadSubsetOptions(options)
    const filters: Array<{
      field: string[]
      operator: string
      value: unknown
    }> = []

    const findFilter = (field: string, operator: string) =>
      filters.find(
        (f) =>
          f.field.length === 1 && f.field[0] === field && f.operator === operator
      )

    return {
      requireIn(field) {
        const filter = findFilter(field, 'in')
        if (!filter) {
          throw new Error(`Required 'in' filter for field '${field}' not found`)
        }
        return filter.value as any
      },
      optionalIn(field) {
        return findFilter(field, 'in')?.value as any
      },
      requireEq(field) {
        const filter = findFilter(field, 'eq')
        if (!filter) {
          throw new Error(`Required 'eq' filter for field '${field}' not found`)
        }
        return filter.value as any
      },
      optionalEq(field) {
        return findFilter(field, 'eq')?.value as any
      },
      requireGt(field) {
        const filter = findFilter(field, 'gt')
        if (!filter) {
          throw new Error(`Required 'gt' filter for field '${field}' not found`)
        }
        return filter.value as any
      },
      requireLt(field) {
        const filter = findFilter(field, 'lt')
        if (!filter) {
          throw new Error(`Required 'lt' filter for field '${field}' not found`)
        }
        return filter.value as any
      },
      optionalGt(field) {
        return findFilter(field, 'gt')?.value as any
      },
      optionalLt(field) {
        return findFilter(field, 'lt')?.value as any
      },
    }
  }

  // Usage example
  async function exampleUsage(ctx: QueryFunctionContext) {
    const filters = extractTypedFilters<AccountExternalData>(
      ctx.meta.loadSubsetOptions
    )

    // ✅ Type error if field doesn't exist: filters.requireIn('nonexistent')
    // ✅ Returns ExternalAccountId[] automatically
    const accountIds = filters.requireIn('accountId')

    return fetchAccountsExternalData(accountIds)
  }
}

// =============================================================================
// OPTION 2: Declarative Required Predicates
// =============================================================================

namespace Option2 {
  // Type utilities
  type OperatorValueType<T, Op extends string> = Op extends 'in'
    ? Array<T>
    : Op extends 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
      ? T
      : never

  type PredicateSpec = {
    operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
    required?: boolean
  }

  type PredicateDefinition<T extends object> = {
    [K in keyof T]?: PredicateSpec | 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
  }

  // Normalize shorthand ('in') to full spec ({ operator: 'in', required: true })
  type NormalizeSpec<S> = S extends string
    ? { operator: S; required: true }
    : S extends PredicateSpec
      ? S
      : never

  type PredicateValues<
    T extends object,
    P extends PredicateDefinition<T>,
  > = {
    [K in keyof P as P[K] extends undefined ? never : K]: NormalizeSpec<
      P[K]
    > extends {
      operator: infer Op extends string
      required: true
    }
      ? OperatorValueType<K extends keyof T ? T[K] : never, Op>
      : NormalizeSpec<P[K]> extends { operator: infer Op extends string }
        ? OperatorValueType<K extends keyof T ? T[K] : never, Op> | undefined
        : never
  }

  // Extended config type
  interface QueryCollectionConfigWithPredicates<
    T extends object,
    P extends PredicateDefinition<T> = Record<string, never>,
  > {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    requiredPredicates?: P
    queryFn: (
      ctx: QueryFunctionContext,
      predicates: PredicateValues<T, P>
    ) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  // Factory function
  function queryCollectionOptions<
    T extends object,
    P extends PredicateDefinition<T> = Record<string, never>,
  >(config: QueryCollectionConfigWithPredicates<T, P>) {
    return config
  }

  // Usage example
  const exampleConfig = queryCollectionOptions<
    AccountExternalData,
    { accountId: 'in'; status: { operator: 'eq'; required: false } }
  >({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],
    requiredPredicates: {
      accountId: 'in',
      status: { operator: 'eq', required: false },
    },
    queryFn: async (ctx, predicates) => {
      // ✅ predicates.accountId is ExternalAccountId[]
      // ✅ predicates.status is string | undefined
      return fetchAccountsExternalData(predicates.accountId)
    },
    getKey: (data) => data.accountId,
    queryClient: {} as QueryClient,
  })
}

// =============================================================================
// OPTION 3: Predicate Mapper Function
// =============================================================================

namespace Option3 {
  interface QueryCollectionConfigWithMapper<T extends object, TArgs> {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    mapPredicates: (options: LoadSubsetOptions | undefined) => TArgs
    queryFn: (ctx: QueryFunctionContext, args: TArgs) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  function queryCollectionOptions<T extends object, TArgs>(
    config: QueryCollectionConfigWithMapper<T, TArgs>
  ) {
    return config
  }

  // Usage example
  const exampleConfig = queryCollectionOptions<
    AccountExternalData,
    ExternalAccountId[]
  >({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],
    mapPredicates: (opts) => {
      // Use Option1's extractTypedFilters here
      // const filters = extractTypedFilters<AccountExternalData>(opts)
      // return filters.requireIn('accountId')
      return [] as ExternalAccountId[] // placeholder
    },
    queryFn: async (ctx, accountIds) => {
      // ✅ accountIds is typed as ExternalAccountId[]
      return fetchAccountsExternalData(accountIds)
    },
    getKey: (data) => data.accountId,
    queryClient: {} as QueryClient,
  })
}

// =============================================================================
// OPTION 4: Collection Parameters (Query Builder Integration)
// =============================================================================

namespace Option4 {
  // Parameter definition
  interface CollectionParameter<TName extends string, TType> {
    name: TName
    type: TType
    required?: boolean
  }

  // Collection config with parameter
  interface ParameterizedCollectionConfig<
    T extends object,
    TParam extends CollectionParameter<string, unknown>,
  > {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    parameter: TParam
    queryFn: (ctx: QueryFunctionContext, param: TParam['type']) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  // Query builder types
  interface ParameterizedCollection<
    T extends object,
    TParamName extends string,
    TParamType,
  > {
    __item: T
    __paramName: TParamName
    __paramType: TParamType
  }

  // From clause that accepts parameters
  type FromWithParams<TSource> = TSource extends ParameterizedCollection<
    infer T,
    infer TParamName,
    infer TParamType
  >
    ? { [K in TParamName]: TParamType } & { collection: TSource }
    : { collection: TSource }

  // Factory
  function createParameterizedCollection<
    T extends object,
    TParamName extends string,
    TParamType,
  >(
    config: ParameterizedCollectionConfig<
      T,
      CollectionParameter<TParamName, TParamType>
    >
  ): ParameterizedCollection<T, TParamName, TParamType> {
    return {} as any
  }

  // Usage example
  const accountExternalDataCollection = createParameterizedCollection<
    AccountExternalData,
    'accountIds',
    ExternalAccountId[]
  >({
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],
    parameter: {
      name: 'accountIds',
      type: [] as ExternalAccountId[],
    },
    queryFn: async (ctx, accountIds) => {
      // ✅ accountIds is ExternalAccountId[]
      return fetchAccountsExternalData(accountIds)
    },
    getKey: (data) => data.accountId,
    queryClient: {} as QueryClient,
  })

  // In query builder (conceptual)
  // q.from({
  //   data: accountExternalDataCollection,
  //   accountIds: subquery.select(x => x.externalId)  // Type checked!
  // })
}

// =============================================================================
// OPTION 5: Predicate Adapters
// =============================================================================

namespace Option5 {
  // Adapter definition
  interface PredicateAdapter<TInput, TOutput> {
    extract: (options: LoadSubsetOptions | undefined) => TInput
    transform: (input: TInput) => TOutput
    validate?: (input: TInput) => void
  }

  // Helper to create adapters
  function createFieldAdapter<
    T extends object,
    K extends keyof T & string,
    Op extends 'eq' | 'in' | 'gt' | 'lt',
    TOutput,
  >(config: {
    field: K
    operator: Op
    required?: boolean
    transform: (
      value: Op extends 'in' ? Array<T[K]> : T[K]
    ) => TOutput
  }): PredicateAdapter<Op extends 'in' ? Array<T[K]> : T[K], TOutput> {
    return {
      extract: (options) => {
        // Extract from loadSubsetOptions
        return undefined as any // placeholder
      },
      transform: config.transform,
      validate: config.required
        ? (input) => {
            if (input === undefined) {
              throw new Error(`Required field '${config.field}' not provided`)
            }
          }
        : undefined,
    }
  }

  // Compose multiple adapters
  function composeAdapters<TAdapters extends Record<string, PredicateAdapter<any, any>>>(
    adapters: TAdapters
  ): PredicateAdapter<
    { [K in keyof TAdapters]: ReturnType<TAdapters[K]['extract']> },
    { [K in keyof TAdapters]: ReturnType<TAdapters[K]['transform']> }
  > {
    return {
      extract: (options) => {
        const result: any = {}
        for (const [key, adapter] of Object.entries(adapters)) {
          result[key] = adapter.extract(options)
        }
        return result
      },
      transform: (input) => {
        const result: any = {}
        for (const [key, adapter] of Object.entries(adapters)) {
          result[key] = adapter.transform((input as any)[key])
        }
        return result
      },
    }
  }

  // Config with adapter
  interface QueryCollectionConfigWithAdapter<T extends object, TOutput> {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    predicateAdapter: PredicateAdapter<any, TOutput>
    queryFn: (ctx: QueryFunctionContext, params: TOutput) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  // Usage example
  const byAccountIds = createFieldAdapter<AccountExternalData, 'accountId', 'in', { ids: string }>({
    field: 'accountId',
    operator: 'in',
    required: true,
    transform: (ids) => ({ ids: ids.join(',') }),
  })

  const exampleConfig: QueryCollectionConfigWithAdapter<AccountExternalData, { ids: string }> = {
    syncMode: 'on-demand',
    queryKey: ['accounts', 'externalData'],
    predicateAdapter: byAccountIds,
    queryFn: async (ctx, { ids }) => {
      // ✅ ids is string
      const response = await fetch(`/api/accounts?ids=${ids}`)
      return response.json()
    },
    getKey: (data) => data.accountId,
    queryClient: {} as QueryClient,
  }
}

// =============================================================================
// OPTION 6: Enhanced parseLoadSubsetOptions with Schema
// =============================================================================

namespace Option6 {
  type OperatorValueType<T, Op extends string> = Op extends 'in'
    ? Array<T>
    : Op extends 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
      ? T
      : never

  type ExpectedFilter = {
    operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
    required?: boolean
  }

  type ExpectedFilters<T> = {
    [K in keyof T]?: ExpectedFilter
  }

  type ParsedFilters<T, E extends ExpectedFilters<T>> = {
    [K in keyof E]: E[K] extends { operator: infer Op extends string; required: true }
      ? OperatorValueType<K extends keyof T ? T[K] : never, Op>
      : E[K] extends { operator: infer Op extends string }
        ? OperatorValueType<K extends keyof T ? T[K] : never, Op> | undefined
        : never
  }

  interface ParsedResult<T, E extends ExpectedFilters<T>> {
    filters: ParsedFilters<T, E>
    sorts: Array<{ field: string[]; direction: 'asc' | 'desc' }>
    limit?: number
  }

  // Enhanced parseLoadSubsetOptions
  function parseLoadSubsetOptions<
    T extends object,
    E extends ExpectedFilters<T> = Record<string, never>,
  >(
    options: LoadSubsetOptions | undefined,
    config?: { expect?: E }
  ): ParsedResult<T, E> {
    const rawFilters: Array<{
      field: string[]
      operator: string
      value: unknown
    }> = [] // Would come from actual parsing

    const filters: Record<string, unknown> = {}

    if (config?.expect) {
      for (const [fieldName, spec] of Object.entries(config.expect)) {
        const filter = rawFilters.find(
          (f) =>
            f.field.length === 1 &&
            f.field[0] === fieldName &&
            f.operator === (spec as ExpectedFilter).operator
        )

        if ((spec as ExpectedFilter).required && !filter) {
          throw new Error(
            `Required filter '${fieldName}' with operator '${(spec as ExpectedFilter).operator}' not found`
          )
        }

        filters[fieldName] = filter?.value
      }
    }

    return {
      filters: filters as ParsedFilters<T, E>,
      sorts: [],
      limit: options?.limit,
    }
  }

  // Usage example
  async function exampleUsage(ctx: QueryFunctionContext) {
    const parsed = parseLoadSubsetOptions<
      AccountExternalData,
      {
        accountId: { operator: 'in'; required: true }
        status: { operator: 'eq'; required: false }
      }
    >(ctx.meta.loadSubsetOptions, {
      expect: {
        accountId: { operator: 'in', required: true },
        status: { operator: 'eq', required: false },
      },
    })

    // ✅ parsed.filters.accountId is ExternalAccountId[] (required, never undefined)
    // ✅ parsed.filters.status is string | undefined (optional)

    return fetchAccountsExternalData(parsed.filters.accountId)
  }
}

// =============================================================================
// BONUS: Hybrid Approach - Combining Options
// =============================================================================

namespace HybridApproach {
  /**
   * This combines the best of several options:
   * - Declarative predicate requirements (Option 2)
   * - Type-safe extraction (Option 1/6)
   * - Clean queryFn signature (Option 3)
   */

  type Operator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

  type OperatorValueType<T, Op extends Operator> = Op extends 'in'
    ? Array<T>
    : T

  // Builder pattern for declaring predicates
  class PredicateBuilder<
    T extends object,
    TRequired extends Record<string, unknown> = Record<string, never>,
    TOptional extends Record<string, unknown> = Record<string, never>,
  > {
    private _required: Array<{ field: string; operator: Operator }> = []
    private _optional: Array<{ field: string; operator: Operator }> = []

    require<K extends keyof T & string, Op extends Operator>(
      field: K,
      operator: Op
    ): PredicateBuilder<
      T,
      TRequired & { [P in K]: OperatorValueType<T[K], Op> },
      TOptional
    > {
      this._required.push({ field, operator })
      return this as any
    }

    optional<K extends keyof T & string, Op extends Operator>(
      field: K,
      operator: Op
    ): PredicateBuilder<
      T,
      TRequired,
      TOptional & { [P in K]: OperatorValueType<T[K], Op> | undefined }
    > {
      this._optional.push({ field, operator })
      return this as any
    }

    build(): {
      required: typeof this._required
      optional: typeof this._optional
      _types: { required: TRequired; optional: TOptional }
    } {
      return {
        required: this._required,
        optional: this._optional,
        _types: {} as any,
      }
    }
  }

  function definePredicates<T extends object>() {
    return new PredicateBuilder<T>()
  }

  // Config type
  type PredicatesResult<B> = B extends PredicateBuilder<any, infer R, infer O>
    ? R & O
    : never

  interface QueryCollectionConfigHybrid<
    T extends object,
    TBuilder extends PredicateBuilder<T, any, any>,
  > {
    syncMode?: 'eager' | 'on-demand'
    queryKey: unknown[]
    predicates: ReturnType<TBuilder['build']>
    queryFn: (
      ctx: QueryFunctionContext,
      params: PredicatesResult<TBuilder>
    ) => Promise<T[]>
    getKey: (item: T) => string | number
    queryClient: QueryClient
  }

  // Usage
  const predicates = definePredicates<AccountExternalData>()
    .require('accountId', 'in')
    .optional('data', 'eq')
    .build()

  // The queryFn would receive:
  // { accountId: ExternalAccountId[], data: object | undefined }
}

export {}
