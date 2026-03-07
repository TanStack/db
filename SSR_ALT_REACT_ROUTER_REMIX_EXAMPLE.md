# React Router / Remix Example (Alt API): Per-Loader Scope with Merge

This example uses per-loader scopes with nested `ProvideDbScope` merge.

React Router loaders run in parallel and each must return serializable data independently.
A shared scope would require a coordination mechanism the framework does not provide,
so each loader owns its own scope lifecycle: create, preload, serialize, cleanup.

Nested `ProvideDbScope` providers merge their state on the client so child routes
contribute additional data to the scope visible to their descendants.

## 1) Shared Getters

```ts
// app/db/getters.ts
import type { DbScope } from '@tanstack/db/ssr'
import { defineCollection, defineLiveQuery } from '@tanstack/db/ssr'
import { eq, liveQueryCollectionOptions } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

export const getCatalogCollection = defineCollection((scope?: DbScope) =>
  queryCollectionOptions({
    id: `catalog`,
    queryKey: [`catalog`],
    queryFn: fetchCatalogRows,
    getKey: (row) => row.id,
  }),
)

export const getAccountCollection = defineCollection(
  ({ userId }: { userId: string }, scope: DbScope) =>
    queryCollectionOptions({
      id: `account:${userId}`,
      queryKey: [`account`, userId],
      queryFn: () => fetchAccountRows(userId),
      getKey: (row) => row.id,
    }),
  { scope: 'required' },
)

export const getCatalogGridLiveQuery = defineLiveQuery((scope?: DbScope) =>
  liveQueryCollectionOptions({
    id: `catalog-grid`,
    query: (q) =>
      q.from({ c: getCatalogCollection(scope) }).orderBy(({ c }) => c.name),
    ssr: { serializes: true },
  }),
)

export const getAccountSummaryLiveQuery = defineLiveQuery(
  ({ userId }: { userId: string }, scope: DbScope) =>
    liveQueryCollectionOptions({
      id: `account-summary:${userId}`,
      query: (q) =>
        q.from({ a: getAccountCollection({ userId }, scope) }).findOne(),
      ssr: { serializes: true },
    }),
  { scope: 'required' },
)

export const getCatalogCategoryLiveQuery = defineLiveQuery(
  ({ category }: { category: string }, scope?: DbScope) =>
    liveQueryCollectionOptions({
      id: `catalog-category:${category}`,
      query: (q) =>
        q
          .from({ c: getCatalogCollection(scope) })
          .where(({ c }) => eq(c.category, category)),
      ssr: { serializes: true },
    }),
)
```

## 2) Parent Route Loader

```ts
// app/routes/store.tsx
import { json } from 'react-router'
import { createDbScope } from '@tanstack/db/ssr'
import {
  getAccountCollection,
  getAccountSummaryLiveQuery,
  getCatalogGridLiveQuery,
} from '@/db/getters'

export async function loader({ request }: LoaderFunctionArgs) {
  const dbScope = createDbScope()
  const userId = getUserIdFromRequest(request)

  try {
    const accountCollection = getAccountCollection({ userId }, dbScope)
    const catalogGrid = getCatalogGridLiveQuery(dbScope)
    const accountSummary = getAccountSummaryLiveQuery({ userId }, dbScope)

    await Promise.all([catalogGrid.preload(), accountSummary.preload()])

    dbScope.include(accountCollection)

    return json({
      userId,
      dbState: dbScope.serialize(),
    })
  } finally {
    await dbScope.cleanup()
  }
}
```

## 3) Parent Route Component + Client View

```tsx
// app/routes/store.tsx (continued)
import { ProvideDbScope } from '@tanstack/react-db/ssr'
import { useLoaderData, Outlet } from 'react-router'
import { StoreView } from '@/components/store-view'

export default function StoreRoute() {
  const { dbState, userId } = useLoaderData<typeof loader>()

  return (
    <ProvideDbScope state={dbState}>
      <StoreView userId={userId} />
      {/* Child route renders inside Outlet. Its ProvideDbScope
          merges with this one so descendants see combined state. */}
      <Outlet />
    </ProvideDbScope>
  )
}
```

```tsx
// app/components/store-view.tsx
import { useLiveQuery } from '@tanstack/react-db'
import { useDbScope } from '@tanstack/react-db/ssr'
import {
  getAccountSummaryLiveQuery,
  getCatalogGridLiveQuery,
} from '@/db/getters'

export function StoreView({ userId }: { userId: string }) {
  const scope = useDbScope()
  const catalogGrid = getCatalogGridLiveQuery(scope)
  const accountSummary = getAccountSummaryLiveQuery({ userId }, scope)

  const { data: catalog } = useLiveQuery(catalogGrid)
  const { data: account } = useLiveQuery(accountSummary)

  return (
    <section>
      <h1>Store</h1>
      <p>{account?.email}</p>
      <ul>
        {catalog.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </section>
  )
}
```

## 4) Child Route with Nested ProvideDbScope

```tsx
// app/routes/store.catalog.$category.tsx
import { json, useLoaderData } from 'react-router'
import { createDbScope } from '@tanstack/db/ssr'
import { ProvideDbScope } from '@tanstack/react-db/ssr'
import { useDbScope } from '@tanstack/react-db/ssr'
import { useLiveQuery } from '@tanstack/react-db'
import { getCatalogCategoryLiveQuery } from '@/db/getters'

export async function loader({ params }: LoaderFunctionArgs) {
  const dbScope = createDbScope()
  const category = params.category ?? `all`

  try {
    const categoryQuery = getCatalogCategoryLiveQuery({ category }, dbScope)
    await categoryQuery.preload()

    return json({
      category,
      dbState: dbScope.serialize(),
    })
  } finally {
    await dbScope.cleanup()
  }
}

export default function CatalogCategoryRoute() {
  const { dbState, category } = useLoaderData<typeof loader>()

  // This ProvideDbScope nests inside the parent route's ProvideDbScope.
  // On the client, state merges: useDbScope() in descendants sees both
  // the parent's account/catalog data and this route's category data.
  return (
    <ProvideDbScope state={dbState}>
      <CategoryView category={category} />
    </ProvideDbScope>
  )
}

function CategoryView({ category }: { category: string }) {
  const scope = useDbScope()
  const categoryQuery = getCatalogCategoryLiveQuery({ category }, scope)
  const { data: items } = useLiveQuery(categoryQuery)

  return (
    <section>
      <h2>{category}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </section>
  )
}
```

## How Merge Works

The component tree during SSR looks like:

```
<ProvideDbScope state={parentDbState}>    ← parent route
  <StoreView />
  <Outlet>
    <ProvideDbScope state={childDbState}> ← child route
      <CategoryView />
    </ProvideDbScope>
  </Outlet>
</ProvideDbScope>
```

On the client:

1. The outer `ProvideDbScope` creates a scope hydrated from `parentDbState`.
2. The inner `ProvideDbScope` merges `childDbState` into the parent scope.
3. `useDbScope()` inside `CategoryView` returns the merged scope.
4. Collection snapshots are deduplicated by `id`. On conflict, the entry with the later `generatedAt` timestamp wins; equal timestamps fall back to child-wins.
5. Live query payloads are deduplicated by `id`. On conflict, the entry with the later `updatedAt` timestamp wins; equal timestamps fall back to child-wins.
6. During initial SSR, timestamps are nearly identical so tree position (child wins) is the effective tiebreaker. During client-side transitions, timestamp comparison prevents stale cached parent data from overwriting fresher child data.

## Notes

1. Each loader owns its own scope lifecycle: create, serialize, cleanup.
2. The tradeoff is that collections used by both parent and child loaders are separate instances on the server (different scopes), so data may be fetched twice. This is acceptable when loaders run in parallel and cannot share state.
3. On the client, memoization uses the nearest scope, so collection instances are shared within the merged subtree.
