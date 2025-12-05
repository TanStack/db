# RFC: Typed Query Predicate to API Mapping

## Problem Statement

When using `syncMode: 'on-demand'` with query collections, developers must manually parse `loadSubsetOptions` to extract predicates and map them to API parameters. This process has several pain points:

### Current Pain Points

1. **No type safety on field names** - String comparisons like `field[0] === "externlId"` can have typos that go uncaught at compile time

2. **Filter values are untyped** - Must cast values manually: `accountIdFilter.value as ExternalAccountId[]`

3. **Verbose boilerplate** - Every on-demand collection requires similar parsing code

4. **No static enforcement** - Cannot declare that a collection REQUIRES certain predicates to function

5. **Runtime errors only** - Missing required filters only discovered at runtime

### Example of Current Pain (from Discord)

```typescript
type ExternalAccountId = string & { __brand: "ExternalAccountId" };

interface AccountExternalData {
  accountId: ExternalAccountId;
  data: object;
}

const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],
    queryFn: ({ meta }) => {
      const { filters } = parseLoadSubsetOptions(meta?.loadSubsetOptions);

      // ❌ No type checking on field name - typo goes uncaught!
      const accountIdFilter = filters.find(
        ({ operator, field }) =>
          operator === "in" && field.length === 1 && field[0] === "externlId" // TYPO!
      );

      // ❌ Runtime error if filter missing
      if (!accountIdFilter) throw Error("Must provide a filter for accountId");

      // ❌ Must cast - no type inference
      const accountIds = accountIdFilter.value as ExternalAccountId[];

      return fetchAccountsExternalData(accountIds);
    },
    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### User's Desired API (from Discord)

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],
    // Imaginary API - typed args directly
    queryFn: (_, args: ExternalAccountId[]) => {
      return fetchAccountsExternalData(args);
    },
    getKey: (data) => data.accountId,
    queryClient,
  })
);

createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q.from({
        data: accountExternalDataCollection,
        // Imaginary API - type-checked arg binding
        args: q
          .from({ account: accountCollection })
          .select(({ account }) => account.externalId),
      }),
    startSync: true,
  })
);
```

---

## Option 1: Schema-Aware Typed Filter Extraction

### Concept

Leverage the collection's item type to generate a typed filter extraction helper that knows about all valid field names and their types.

### API Design

```typescript
interface AccountExternalData {
  accountId: ExternalAccountId;
  data: object;
}

const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],
    queryFn: async (ctx) => {
      // Schema-aware typed extraction
      const filters = extractTypedFilters<AccountExternalData>(
        ctx.meta.loadSubsetOptions
      );

      // ✅ Type error if field doesn't exist on AccountExternalData
      // ✅ Returns ExternalAccountId[] automatically
      const accountIds = filters.requireIn('accountId');

      return fetchAccountsExternalData(accountIds);
    },
    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Implementation Sketch

```typescript
type FilterExtractor<T> = {
  // For 'in' operator - returns array of the field type
  requireIn<K extends keyof T & string>(field: K): Array<T[K]>;
  optionalIn<K extends keyof T & string>(field: K): Array<T[K]> | undefined;

  // For 'eq' operator - returns the field type
  requireEq<K extends keyof T & string>(field: K): T[K];
  optionalEq<K extends keyof T & string>(field: K): T[K] | undefined;

  // For range operators
  requireGt<K extends keyof T & string>(field: K): T[K];
  requireLt<K extends keyof T & string>(field: K): T[K];
  // ... etc
};

function extractTypedFilters<T extends object>(
  options: LoadSubsetOptions | undefined
): FilterExtractor<T> {
  const { filters } = parseLoadSubsetOptions(options);

  return {
    requireIn(field) {
      const filter = filters.find(
        f => f.field.length === 1 && f.field[0] === field && f.operator === 'in'
      );
      if (!filter) {
        throw new Error(`Required 'in' filter for field '${field}' not found`);
      }
      return filter.value;
    },
    optionalIn(field) {
      const filter = filters.find(
        f => f.field.length === 1 && f.field[0] === field && f.operator === 'in'
      );
      return filter?.value;
    },
    // ... other methods
  };
}
```

### Pros
- ✅ Type-safe field names (caught at compile time)
- ✅ Return types inferred from schema
- ✅ Minimal API surface change
- ✅ Can be implemented as a utility without changing core
- ✅ Gradual adoption - existing code continues to work

### Cons
- ❌ Still requires manual extraction calls inside queryFn
- ❌ Cannot statically verify that queries provide required filters
- ❌ Runtime errors still possible if filter not provided by query

---

## Option 2: Declarative Required Predicates

### Concept

Allow collections to declare their required predicates upfront, with the system validating them and passing typed values to queryFn.

### API Design

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Declare required predicates
    requiredPredicates: {
      accountId: 'in',  // or { operator: 'in', required: true }
    } as const,

    // queryFn receives typed predicates object
    queryFn: async (ctx, predicates) => {
      // ✅ predicates.accountId is typed as ExternalAccountId[]
      return fetchAccountsExternalData(predicates.accountId);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Advanced Version with Full Type Inference

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Type-safe predicate declarations
    predicates: definePredicates<AccountExternalData>()
      .require('accountId', 'in')    // ExternalAccountId[]
      .optional('status', 'eq'),      // string | undefined

    queryFn: async (ctx, { accountId, status }) => {
      // accountId: ExternalAccountId[] (required)
      // status: string | undefined (optional)
      return fetchAccountsExternalData(accountId, status);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Implementation Approach

```typescript
type OperatorValueType<T, Op extends string> =
  Op extends 'in' ? Array<T> :
  Op extends 'eq' | 'gt' | 'gte' | 'lt' | 'lte' ? T :
  never;

type PredicateDefinition<T extends object> = {
  [K in keyof T]?: {
    operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
    required?: boolean;
  };
};

type PredicateValues<T extends object, P extends PredicateDefinition<T>> = {
  [K in keyof P]: P[K] extends { operator: infer Op extends string; required: true }
    ? OperatorValueType<T[K & keyof T], Op>
    : P[K] extends { operator: infer Op extends string }
    ? OperatorValueType<T[K & keyof T], Op> | undefined
    : never;
};

interface QueryCollectionConfig<
  T extends object,
  P extends PredicateDefinition<T> = {},
  // ... other generics
> {
  requiredPredicates?: P;
  queryFn: (
    ctx: QueryFunctionContext,
    predicates: PredicateValues<T, P>
  ) => Promise<T[]>;
  // ...
}
```

### Pros
- ✅ Fully type-safe predicate access
- ✅ Declarative - clear what the collection needs
- ✅ Could enable compile-time validation of queries
- ✅ Self-documenting API requirements

### Cons
- ❌ Larger API surface change
- ❌ Complex type machinery
- ❌ Migration effort for existing collections
- ❌ Doesn't handle complex predicate patterns (nested fields, OR conditions)

---

## Option 3: Predicate Mapper Function

### Concept

Add a separate `mapPredicates` function that transforms raw LoadSubsetOptions into typed args, keeping queryFn focused on data fetching.

### API Design

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Transform predicates to typed args
    mapPredicates: (opts): ExternalAccountId[] => {
      const filters = extractTypedFilters<AccountExternalData>(opts);
      return filters.requireIn('accountId');
    },

    // queryFn receives the mapped args
    queryFn: async (ctx, accountIds) => {
      // ✅ accountIds is typed as ExternalAccountId[]
      return fetchAccountsExternalData(accountIds);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### With Validation

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    mapPredicates: {
      // Schema for validation
      schema: z.object({
        accountIds: z.array(z.string().brand('ExternalAccountId')),
      }),
      // Transform function
      transform: (opts) => {
        const filters = parseLoadSubsetOptions(opts);
        const inFilter = filters.filters.find(
          f => f.field[0] === 'accountId' && f.operator === 'in'
        );
        return { accountIds: inFilter?.value ?? [] };
      },
    },

    queryFn: async (ctx, { accountIds }) => {
      return fetchAccountsExternalData(accountIds);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Pros
- ✅ Clean separation of concerns
- ✅ Full control over mapping logic
- ✅ Can handle complex transformations
- ✅ Typed args in queryFn
- ✅ Optional schema validation

### Cons
- ❌ Still requires writing mapping code
- ❌ No compile-time query validation
- ❌ Two functions to maintain (mapPredicates + queryFn)

---

## Option 4: Collection Parameters (Query Builder Integration)

### Concept

Allow collections to declare explicit typed parameters that must be provided when used in queries. This enables compile-time checking that queries provide required data.

### API Design

```typescript
// Define collection with typed parameter
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Declare the parameter this collection needs
    parameter: {
      name: 'accountIds',
      type: {} as ExternalAccountId[],  // Type marker
    },

    // queryFn receives typed parameter
    queryFn: async (ctx, accountIds: ExternalAccountId[]) => {
      return fetchAccountsExternalData(accountIds);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);

// Query builder knows about required parameters
createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q.from({
        data: accountExternalDataCollection,
        // ✅ Type checked - must provide ExternalAccountId[]
        accountIds: q
          .from({ account: accountCollection })
          .select(({ account }) => account.externalId),
      }),
    startSync: true,
  })
);
```

### Alternative: Using `with` clause

```typescript
createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q.from({ account: accountCollection })
       .with({
         data: accountExternalDataCollection,
         // Bind parameter from query context
         using: ({ account }) => ({
           accountIds: account.externalId  // Auto-collected into array
         })
       })
       .select(({ account, data }) => ({ ...account, ...data })),
    startSync: true,
  })
);
```

### Implementation Considerations

This would require:
1. New generic type parameter on collection config for parameters
2. Query builder changes to accept and validate parameters
3. Runtime collection of parameter values during query execution
4. Predicate generation from parameters (for caching/deduplication)

### Pros
- ✅ Compile-time validation that queries provide required data
- ✅ Clean, declarative API
- ✅ Clear separation between "what data is needed" and "how to fetch it"
- ✅ Enables smart batching of requests

### Cons
- ❌ Significant query builder changes
- ❌ New concept to learn
- ❌ May not cover all predicate patterns (complex WHERE clauses)
- ❌ Breaking change to collection config types

---

## Option 5: Predicate Adapters (Reusable Patterns)

### Concept

Create reusable predicate adapter patterns for common API integration scenarios.

### API Design

```typescript
// Define reusable adapter
const byIds = createPredicateAdapter({
  field: 'accountId' as const,
  operator: 'in' as const,
  required: true,
  transform: (ids: ExternalAccountId[]) => ({
    queryParams: { ids: ids.join(',') },
  }),
});

const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Use the adapter
    predicateAdapter: byIds,

    // queryFn receives transformed value
    queryFn: async (ctx, { queryParams }) => {
      return fetch(`/api/accounts?${new URLSearchParams(queryParams)}`);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Composable Adapters

```typescript
// Compose multiple adapters
const accountDataAdapter = composeAdapters(
  byField('accountId', 'in', { required: true }),
  byField('status', 'eq', { required: false }),
  withPagination(),
);

const collection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],
    predicateAdapter: accountDataAdapter,
    queryFn: async (ctx, params) => {
      // params is typed based on composed adapters
      // { accountId: ExternalAccountId[], status?: string, page?: number, limit?: number }
      return api.fetchAccounts(params);
    },
    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Pre-built Adapters Library

```typescript
import {
  restApiAdapter,
  graphqlAdapter,
  hasuraAdapter,
  supabaseAdapter
} from '@tanstack/db-adapters';

// REST API with standard query params
const collection = createCollection(
  queryCollectionOptions({
    predicateAdapter: restApiAdapter({
      baseUrl: '/api/products',
      mapping: {
        category: 'category',
        price: { gt: 'min_price', lt: 'max_price' },
      }
    }),
    queryFn: async (ctx, { url }) => fetch(url).then(r => r.json()),
    // ...
  })
);

// GraphQL/Hasura style
const collection = createCollection(
  queryCollectionOptions({
    predicateAdapter: hasuraAdapter<Product>(),
    queryFn: async (ctx, { where, order_by, limit }) => {
      return graphql.query({ query: PRODUCTS_QUERY, variables: { where, order_by, limit } });
    },
    // ...
  })
);
```

### Pros
- ✅ Reusable patterns across collections
- ✅ Can create ecosystem of adapters for common backends
- ✅ Type-safe with good inference
- ✅ Flexible composition

### Cons
- ❌ Another abstraction layer
- ❌ May not cover all edge cases
- ❌ Learning curve for adapter patterns

---

## Option 6: Enhanced parseLoadSubsetOptions with Schema

### Concept

Enhance the existing `parseLoadSubsetOptions` to accept a schema/type parameter for better type inference.

### API Design

```typescript
import { parseLoadSubsetOptions } from '@tanstack/db';

const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],
    queryFn: async (ctx) => {
      // Pass schema type for type-safe access
      const parsed = parseLoadSubsetOptions<AccountExternalData>(
        ctx.meta.loadSubsetOptions,
        {
          // Declare expected filters with their operators
          expect: {
            accountId: { operator: 'in', required: true },
            status: { operator: 'eq', required: false },
          }
        }
      );

      // ✅ Type safe: parsed.filters.accountId is ExternalAccountId[]
      // ✅ Type safe: parsed.filters.status is string | undefined
      // ✅ Throws if accountId filter missing (required: true)

      return fetchAccountsExternalData(
        parsed.filters.accountId,
        parsed.filters.status
      );
    },
    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Implementation

```typescript
type ExpectedFilters<T> = {
  [K in keyof T]?: {
    operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
    required?: boolean;
  };
};

type ParsedFilters<T, E extends ExpectedFilters<T>> = {
  [K in keyof E]: E[K] extends { operator: infer Op; required: true }
    ? OperatorValueType<T[K & keyof T], Op & string>
    : E[K] extends { operator: infer Op }
    ? OperatorValueType<T[K & keyof T], Op & string> | undefined
    : never;
};

function parseLoadSubsetOptions<
  T extends object,
  E extends ExpectedFilters<T> = {}
>(
  options: LoadSubsetOptions | undefined,
  config?: { expect?: E }
): {
  filters: ParsedFilters<T, E>;
  sorts: ParsedOrderBy[];
  limit?: number;
} {
  // Implementation validates and extracts typed filters
}
```

### Pros
- ✅ Minimal API change - enhances existing function
- ✅ Backward compatible
- ✅ Opt-in type safety
- ✅ Validation at parse time

### Cons
- ❌ Still inside queryFn (not declarative at collection level)
- ❌ No compile-time query validation
- ❌ Slightly verbose declaration

---

## Recommendation

Based on the analysis, I recommend a **phased approach**:

### Phase 1: Enhanced Type-Safe Extraction (Low effort, high value)

Implement **Option 6** (Enhanced parseLoadSubsetOptions) as it:
- Requires minimal changes
- Is backward compatible
- Provides immediate type safety benefits
- Can be shipped quickly

```typescript
// Quick win - type-safe extraction
const parsed = parseLoadSubsetOptions<AccountExternalData>(
  ctx.meta.loadSubsetOptions,
  { expect: { accountId: { operator: 'in', required: true } } }
);
```

### Phase 2: Declarative Predicates (Medium effort)

Implement **Option 2** (Declarative Required Predicates) to allow collections to declare their requirements upfront:

```typescript
// Declarative requirements
const collection = createCollection(
  queryCollectionOptions({
    requiredPredicates: { accountId: 'in' },
    queryFn: async (ctx, { accountId }) => { /* typed */ },
  })
);
```

### Phase 3: Query Builder Integration (Higher effort, highest value)

Implement **Option 4** (Collection Parameters) for compile-time query validation:

```typescript
// Full type safety across query boundaries
q.from({
  data: accountExternalDataCollection,
  accountIds: subquery.select(x => x.id), // Compile-time checked
})
```

---

## Open Questions

1. **How should nested field paths be handled?** (e.g., `user.address.city`)

2. **Should we support OR conditions in required predicates?**

3. **How do collection parameters interact with predicate pushdown optimization?**

4. **Should parameters be passed via join conditions vs explicit args?**

5. **How do we handle dynamic/runtime-determined predicates?**

---

## Related Work

- TanStack Query's `meta` typing via module augmentation
- Prisma's typed query builder
- tRPC's end-to-end type safety
- GraphQL's typed variables
- Drizzle ORM's type-safe query builder
