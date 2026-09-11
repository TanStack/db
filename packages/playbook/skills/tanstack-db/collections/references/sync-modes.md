# Sync Modes

Control how data loads into QueryCollections.

## Overview

| Mode          | Load Behavior                         | Best For                   |
| ------------- | ------------------------------------- | -------------------------- |
| `eager`       | Load all upfront                      | Small datasets (<10k rows) |
| `on-demand`   | Load only what queries request        | Large datasets (>50k rows) |
| `progressive` | Load subset first, full in background | Collaborative apps         |

## Eager Mode (Default)

Loads entire dataset on first access:

```tsx
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,
    syncMode: 'eager', // Default
  }),
)
```

**Pros:**

- Simplest mental model
- All data available immediately for queries
- No network requests when filtering/sorting

**Cons:**

- Slow initial load for large datasets
- Memory usage for full dataset

**Best for:**

- User preferences
- Small reference tables
- Data that's mostly accessed

## On-Demand Mode

Loads only what queries request:

```tsx
const productsCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['products'],
    queryFn: async (ctx) => {
      const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      return api.products.search(params)
    },
    getKey: (item) => item.id,
    syncMode: 'on-demand',
  }),
)

// Only loads electronics products
const { data } = useLiveQuery((q) =>
  q
    .from({ product: productsCollection })
    .where(({ product }) => eq(product.category, 'electronics'))
    .limit(50),
)
```

**Pros:**

- Fast initial load
- Low memory usage
- Scales to any dataset size

**Cons:**

- Network request on each new query pattern
- Can't query data that isn't loaded

**Best for:**

- Product catalogs
- Search interfaces
- Large datasets where most data isn't accessed

## Progressive Mode

Loads query subset immediately, syncs full dataset in background:

```tsx
const issuesCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['issues'],
    queryFn: async (ctx) => {
      if (ctx.meta?.loadSubsetOptions) {
        // First: load what query needs
        return api.issues.search(
          parseLoadSubsetOptions(ctx.meta.loadSubsetOptions),
        )
      }
      // Then: load everything in background
      return api.issues.getAll()
    },
    getKey: (item) => item.id,
    syncMode: 'progressive',
  }),
)
```

**Pros:**

- Instant first paint
- Eventually has all data for fast local queries
- Good for collaborative apps

**Cons:**

- More complex implementation
- Uses more memory than on-demand

**Best for:**

- Issue trackers (like Linear)
- Collaborative documents
- Apps that benefit from local-first after initial sync

## Predicate Push-Down

With `on-demand` and `progressive`, query predicates are passed to queryFn:

```tsx
queryFn: async (ctx) => {
  const options = ctx.meta?.loadSubsetOptions
  // options contains:
  // - where: query conditions
  // - limit: row limit
  // - offset: pagination offset
  // - orderBy: sort specification

  const params = parseLoadSubsetOptions(options)
  return api.fetch(params)
}
```

### parseLoadSubsetOptions

Helper to convert predicates to API params:

```tsx
import { parseLoadSubsetOptions } from '@tanstack/query-db-collection'

const params = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
// {
//   where: { category: 'electronics', price_lt: 100 },
//   limit: 50,
//   offset: 0,
//   orderBy: [{ field: 'price', direction: 'asc' }]
// }
```

## Delta Loading

TanStack DB automatically optimizes loading:

```tsx
// First query loads category=electronics
const q1 = q.where(({ p }) => eq(p.category, 'electronics'))

// Second query expands to include clothing
const q2 = q.where(({ p }) =>
  or(eq(p.category, 'electronics'), eq(p.category, 'clothing')),
)
// Only loads clothing, keeps electronics from cache
```

## Choosing a Mode

```
┌─────────────────────────────────────────────────────────────┐
│                    How much data?                           │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         < 10k rows      10k-50k rows     > 50k rows
              │               │               │
              ▼               ▼               ▼
           EAGER         PROGRESSIVE      ON-DEMAND
```

**Additional considerations:**

- Need instant filtering on all data? → eager or progressive
- Search/filter is primary use case? → on-demand
- Collaborative with real-time updates? → progressive
- Memory-constrained environment? → on-demand

## Combining Modes

Different collections can use different modes:

```tsx
// Small reference data: eager
const categoriesCollection = createCollection(
  queryCollectionOptions({
    syncMode: 'eager',
    ...
  })
)

// Large catalog: on-demand
const productsCollection = createCollection(
  queryCollectionOptions({
    syncMode: 'on-demand',
    ...
  })
)

// Collaborative data: progressive
const issuesCollection = createCollection(
  queryCollectionOptions({
    syncMode: 'progressive',
    ...
  })
)
```
