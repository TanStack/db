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

## Design Principle: Reuse Existing Collection Types

**Key insight**: The collection already knows its item type `T` via `QueryCollectionConfig<T>`.
We should NOT require users to repeat type annotations - all type inference should flow
automatically from the collection's existing type parameter.

```typescript
// ❌ BAD - requires user to manually specify type
const filters = extractTypedFilters<AccountExternalData>(ctx.meta.loadSubsetOptions);

// ✅ GOOD - type flows from collection definition
queryCollectionOptions({
  // Collection already knows T = AccountExternalData from getKey, queryFn return type, etc.
  predicates: { accountId: 'in' },  // Validated against T's fields
  queryFn: (ctx, { accountId }) => {
    // accountId automatically typed as ExternalAccountId[]
    // (T['accountId'] = ExternalAccountId, 'in' operator = array)
  }
})
```

---

## Option 1: Declarative Required Predicates (Recommended)

### Concept

Allow collections to declare their required predicates upfront. The system validates them
and passes typed values to `queryFn`. **Types are automatically inferred from the collection's
item type `T` - no manual type annotations needed.**

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

    // Declare predicates - field names are validated against T
    // ✅ 'accountId' autocompletes and type-checks against AccountExternalData
    // ❌ 'acountId' would be a compile error (typo!)
    predicates: {
      accountId: 'in',
    },

    // queryFn receives typed predicates - NO manual type annotation needed!
    queryFn: async (ctx, { accountId }) => {
      // ✅ accountId is automatically ExternalAccountId[]
      // (inferred from T['accountId'] + 'in' operator)
      return fetchAccountsExternalData(accountId);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### With Optional Predicates

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    predicates: {
      accountId: 'in',                              // Required
      status: { operator: 'eq', required: false },  // Optional
    },

    queryFn: async (ctx, { accountId, status }) => {
      // accountId: ExternalAccountId[] (always present)
      // status: string | undefined (may be absent)
      return fetchAccountsExternalData(accountId, status);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### How Types Flow (Implementation)

```typescript
// The key insight: T is already known from the collection config
type QueryCollectionConfig<
  T extends object,  // <-- This is already inferred from getKey, queryFn return, etc.
  // ...
> = {
  // Predicates keys are constrained to keyof T
  predicates?: {
    [K in keyof T]?: PredicateOperator | { operator: PredicateOperator; required?: boolean }
  };

  // queryFn's second arg is automatically typed based on predicates + T
  queryFn: (
    ctx: QueryFunctionContext,
    predicates: InferPredicateValues<T, typeof predicates>
  ) => Promise<T[]>;
}

// Type computation happens automatically:
// 1. predicates: { accountId: 'in' }
// 2. T = AccountExternalData, so T['accountId'] = ExternalAccountId
// 3. 'in' operator means Array<T['accountId']> = ExternalAccountId[]
// 4. queryFn receives { accountId: ExternalAccountId[] }
```

### Shorthand Syntax Options

```typescript
// Option A: String shorthand (required by default)
predicates: {
  accountId: 'in',      // Required, ExternalAccountId[]
  category: 'eq',       // Required, string
}

// Option B: Object for optional + extra config
predicates: {
  accountId: { operator: 'in' },                    // Required (default)
  status: { operator: 'eq', required: false },      // Optional
  price: { operator: 'gt', required: false },       // Optional
}

// Option C: Tuple shorthand [operator, required?]
predicates: {
  accountId: ['in'],           // Required
  status: ['eq', false],       // Optional
}
```

### Pros
- ✅ Zero manual type annotations - everything inferred from T
- ✅ Field names validated at compile time (typos caught!)
- ✅ Fully type-safe predicate values in queryFn
- ✅ Declarative - clear what the collection needs
- ✅ Self-documenting API requirements
- ✅ Could enable compile-time query validation (future)

### Cons
- ❌ API surface change to QueryCollectionConfig
- ❌ Additional generic type parameter complexity internally
- ❌ Doesn't handle complex predicates (nested fields, OR conditions)

---

## Option 2: Predicate Mapper Function

### Concept

Add a `mapPredicates` function that transforms `LoadSubsetOptions` into typed args.
**The mapper receives a typed helper that knows about `T`, so no manual type annotations needed.**

### API Design

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // mapPredicates receives a typed helper based on T
    mapPredicates: (opts, filters) => {
      // filters.requireIn knows valid field names from T
      // ✅ 'accountId' autocompletes
      // ❌ 'acountId' would be compile error
      return filters.requireIn('accountId');
      // Returns ExternalAccountId[] (inferred from T['accountId'])
    },

    // queryFn receives the return type of mapPredicates
    queryFn: async (ctx, accountIds) => {
      // ✅ accountIds is ExternalAccountId[] (inferred, not annotated!)
      return fetchAccountsExternalData(accountIds);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### With Multiple Fields

```typescript
const collection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["products"],

    mapPredicates: (opts, filters) => ({
      // All field names validated against Product type
      categoryIds: filters.requireIn('categoryId'),   // string[]
      minPrice: filters.optionalGt('price'),          // number | undefined
      maxPrice: filters.optionalLt('price'),          // number | undefined
    }),

    queryFn: async (ctx, { categoryIds, minPrice, maxPrice }) => {
      // All types inferred from T and operators
      return api.getProducts({ categoryIds, minPrice, maxPrice });
    },

    getKey: (data) => data.id,
    queryClient,
  })
);
```

### How the Typed Helper Works

```typescript
// The filters helper is automatically typed based on T
type TypedFilters<T> = {
  requireIn<K extends keyof T & string>(field: K): Array<T[K]>;
  optionalIn<K extends keyof T & string>(field: K): Array<T[K]> | undefined;
  requireEq<K extends keyof T & string>(field: K): T[K];
  optionalEq<K extends keyof T & string>(field: K): T[K] | undefined;
  requireGt<K extends keyof T & string>(field: K): T[K];
  // ... etc
};

// In QueryCollectionConfig<T>:
mapPredicates?: (
  opts: LoadSubsetOptions | undefined,
  filters: TypedFilters<T>  // <-- Automatically typed based on T!
) => TArgs;

queryFn: (ctx: Context, args: TArgs) => Promise<T[]>;  // TArgs inferred from mapPredicates
```

### Pros
- ✅ Zero manual type annotations
- ✅ Field names validated at compile time
- ✅ Full control over mapping logic
- ✅ Can handle complex transformations
- ✅ Flexible - return any shape from mapPredicates

### Cons
- ❌ Still requires writing mapping code (but it's type-safe!)
- ❌ Two functions to maintain (mapPredicates + queryFn)
- ❌ No compile-time query validation

---

## Option 3: Collection Parameters (Query Builder Integration)

### Concept

Collections declare a "parameter" - a field they need values for. The query builder
validates that queries provide this parameter. **Types flow from the collection's
item type - the parameter field must be a valid field of `T`.**

### API Design

```typescript
interface AccountExternalData {
  accountId: ExternalAccountId;
  data: object;
}

// Define collection with parameter requirement
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Declare parameter - field name validated against T
    // ✅ 'accountId' is a valid field of AccountExternalData
    // ❌ 'acountId' would be compile error
    parameter: 'accountId',  // Will receive ExternalAccountId[] (T['accountId'][])

    // queryFn receives typed parameter - type inferred from T['accountId']
    queryFn: async (ctx, accountIds) => {
      // ✅ accountIds is ExternalAccountId[] (no annotation needed!)
      return fetchAccountsExternalData(accountIds);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);

// Query builder validates parameter is provided
createCollection(
  liveQueryCollectionOptions({
    query: (q) =>
      q.from({
        data: accountExternalDataCollection,
        // ✅ Type checked - must provide values assignable to ExternalAccountId
        accountId: q
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
         // Parameter binding - type checked!
         using: ({ account }) => account.externalId  // Must be ExternalAccountId
       })
       .select(({ account, data }) => ({ ...account, ...data })),
    startSync: true,
  })
);
```

### How Types Flow

```typescript
// Collection knows T = AccountExternalData
// parameter: 'accountId' means:
//   1. Validate 'accountId' ∈ keyof T ✓
//   2. Parameter type = Array<T['accountId']> = ExternalAccountId[]
//   3. queryFn receives (ctx, accountIds: ExternalAccountId[])

// In query builder:
// q.from({ data: collection, accountId: subquery })
//   1. Check collection has parameter 'accountId'
//   2. Check subquery result type assignable to ExternalAccountId
//   3. Compile error if types don't match!
```

### Pros
- ✅ Zero manual type annotations
- ✅ Compile-time validation in query builder (queries MUST provide parameter)
- ✅ Clean, declarative API
- ✅ Clear separation between "what data is needed" and "how to fetch it"
- ✅ Enables smart batching of requests

### Cons
- ❌ Significant query builder changes required
- ❌ New concept to learn (parameterized collections)
- ❌ Only works for single-field parameters (not complex predicates)
- ❌ Breaking change to collection config types

---

## Option 4: Predicate Adapters (Reusable Patterns)

### Concept

Create reusable predicate adapter patterns for common API integration scenarios.
**Adapters are typed based on the collection's `T`, no manual annotations needed.**

### API Design

```typescript
// Adapters know about T when attached to a collection
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Adapter field names validated against T
    adapter: byField('accountId', 'in', {
      transform: (ids) => ({ ids: ids.join(',') })
      // ids is ExternalAccountId[] - inferred from T['accountId']
    }),

    // queryFn receives transformed value
    queryFn: async (ctx, { ids }) => {
      // ids is string (from transform return type)
      return fetch(`/api/accounts?ids=${ids}`).then(r => r.json());
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Composable Adapters

```typescript
// Compose multiple field adapters
const collection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["products"],

    adapter: composeAdapters(
      // Field names validated against Product type
      byField('categoryId', 'in'),      // string[]
      byField('price', 'gt', { as: 'minPrice' }),  // number
      byField('price', 'lt', { as: 'maxPrice' }),  // number
      withPagination(),
    ),

    queryFn: async (ctx, params) => {
      // params: { categoryId: string[], minPrice: number, maxPrice: number, page?: number, limit?: number }
      return api.fetchProducts(params);
    },

    getKey: (data) => data.id,
    queryClient,
  })
);
```

### Pre-built Adapters for Common Backends

```typescript
import { restApiAdapter, hasuraAdapter } from '@tanstack/db-adapters';

// REST API - auto-converts predicates to query params
const collection = createCollection(
  queryCollectionOptions({
    adapter: restApiAdapter('/api/products', {
      // Field mappings validated against T
      category: 'cat',
      price: { gt: 'min_price', lt: 'max_price' },
    }),
    queryFn: async (ctx, { url }) => fetch(url).then(r => r.json()),
    getKey: (data) => data.id,
    queryClient,
  })
);

// Hasura/GraphQL - auto-converts to where clause
const collection = createCollection(
  queryCollectionOptions({
    adapter: hasuraAdapter(),  // Uses T for field validation
    queryFn: async (ctx, { where, order_by, limit }) => {
      return graphql.query({ query: PRODUCTS_QUERY, variables: { where, order_by, limit } });
    },
    getKey: (data) => data.id,
    queryClient,
  })
);
```

### Pros
- ✅ Zero manual type annotations
- ✅ Field names validated at compile time
- ✅ Reusable patterns across collections
- ✅ Ecosystem potential (adapters for Supabase, Prisma, etc.)
- ✅ Flexible composition

### Cons
- ❌ Another abstraction layer to learn
- ❌ May not cover all edge cases
- ❌ Adapter library maintenance burden

---

## Recommendation

Based on the analysis, I recommend **Option 1: Declarative Required Predicates** as the primary solution.

### Why Option 1?

1. **Zero manual type annotations** - Types flow from `T`
2. **Minimal API change** - Just add `predicates` to config
3. **Compile-time field validation** - Typos caught immediately
4. **Declarative** - Clear what the collection needs
5. **Simple mental model** - No new concepts beyond "declare what you need"

### Proposed API

```typescript
const accountExternalDataCollection = createCollection(
  queryCollectionOptions({
    syncMode: "on-demand",
    queryKey: ["accounts", "externalData"],

    // Declare predicates - field names validated against T
    predicates: {
      accountId: 'in',  // Required, ExternalAccountId[]
    },

    // queryFn receives typed predicates
    queryFn: async (ctx, { accountId }) => {
      // accountId is ExternalAccountId[] - automatically inferred!
      return fetchAccountsExternalData(accountId);
    },

    getKey: (data) => data.accountId,
    queryClient,
  })
);
```

### Future Enhancement: Query Builder Integration (Option 3)

Once Option 1 is stable, Option 3 (Collection Parameters) could be added for
compile-time query validation:

```typescript
// Future: queries that don't provide required predicates fail at compile time
q.from({
  data: accountExternalDataCollection,
  accountId: subquery.select(x => x.externalId),  // Type checked!
})
```

---

## Open Questions

1. **How should nested field paths be handled?** (e.g., `user.address.city`)
   - Could use dot notation: `predicates: { 'address.city': 'eq' }`
   - Or nested objects: `predicates: { address: { city: 'eq' } }`

2. **Should we support OR conditions in required predicates?**
   - Current design assumes AND-ed predicates
   - OR might need different API: `predicates: { $or: [{ status: 'eq' }, { priority: 'eq' }] }`

3. **How do declared predicates interact with predicate pushdown optimization?**
   - Declared predicates should inform what can be pushed down
   - May enable more aggressive optimization

4. **What happens if a query doesn't provide all required predicates?**
   - Runtime error (current behavior)?
   - TypeScript error (with Option 3)?
   - Or both?

5. **How do we handle dynamic/runtime-determined predicates?**
   - Some use cases need predicates that vary based on runtime conditions
   - May need escape hatch for complex scenarios

6. **Should `predicates` be mutually exclusive with raw `loadSubsetOptions` access?**
   - Or can they coexist for migration/flexibility?

---

## Comparison Summary

| Option | Manual Types | Field Validation | Compile-Time Query Check | Effort |
|--------|--------------|------------------|--------------------------|--------|
| 1. Declarative Predicates | ❌ None | ✅ Yes | ❌ No | Low |
| 2. Mapper Function | ❌ None | ✅ Yes | ❌ No | Low |
| 3. Collection Parameters | ❌ None | ✅ Yes | ✅ Yes | High |
| 4. Predicate Adapters | ❌ None | ✅ Yes | ❌ No | Medium |

---

## Related Work

- **TanStack Query** - `meta` typing via module augmentation
- **Prisma** - Typed query builder with compile-time field validation
- **tRPC** - End-to-end type safety between client and server
- **Drizzle ORM** - Type-safe SQL query builder
- **Zod** - Runtime schema validation with TypeScript inference
- **GraphQL Code Generator** - Types generated from schema
