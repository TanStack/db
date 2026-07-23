# TanStack Start Example (Alt API): Single Root Scope

This example uses the preferred single root scope strategy:

1. Create scope once per request in `createRouter()`.
2. All loaders share the scope via router context.
3. Root component serializes during render (after all loaders complete).
4. Middleware handles cleanup.

## 1) Shared Getters

```ts
// src/db/getters.ts
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

## 2) Router Creation

```ts
// src/router.tsx
import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { createDbScope } from '@tanstack/db/ssr'
import { routeTree } from './routeTree.gen'

export function createRouter() {
  const queryClient = new QueryClient()
  const dbScope = createDbScope()

  return createTanStackRouter({
    routeTree,
    context: {
      queryClient,
      dbScope,
    },
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
```

TanStack Start calls `createRouter()` per server request, so `dbScope` is request-scoped automatically.

## 3) Middleware: Cleanup After Response

```ts
// src/start/middleware/db-scope.ts
import { createMiddleware } from '@tanstack/start'

export const dbScopeMiddleware = createMiddleware().server(
  async ({ next, context }) => {
    try {
      return await next()
    } finally {
      await context.dbScope.cleanup()
    }
  },
)
```

Cleanup runs after the full response lifecycle, not inside individual loaders.

## 4) Root Route: Serialize and Provide

```tsx
// src/routes/__root.tsx
import { createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { DbScope } from '@tanstack/db/ssr'
import { ProvideDbScope } from '@tanstack/react-db/ssr'

interface RouterContext {
  queryClient: QueryClient
  dbScope: DbScope
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  const { dbScope } = Route.useRouteContext()

  // During SSR, all matched loaders have completed before this renders.
  // serialize() captures the fully-populated scope.
  const dbState = dbScope.serialize()

  return (
    <ProvideDbScope state={dbState}>
      <Outlet />
    </ProvideDbScope>
  )
}
```

## 5) Route Loader: Use Shared Scope

```tsx
// src/routes/store.tsx
import { createFileRoute } from '@tanstack/react-router'
import { getWebRequest } from '@tanstack/start'
import {
  getAccountCollection,
  getAccountSummaryLiveQuery,
  getCatalogGridLiveQuery,
} from '@/db/getters'
import { StoreView } from './store-view'

export const Route = createFileRoute(`/store`)({
  loader: async ({ context }) => {
    const { dbScope } = context
    const request = getWebRequest()
    const userId = getUserIdFromRequest(request)

    // Collections are memoized per scope + params.
    // Multiple loaders using the same scope share instances.
    const accountCollection = getAccountCollection({ userId }, dbScope)
    const catalogGrid = getCatalogGridLiveQuery(dbScope)
    const accountSummary = getAccountSummaryLiveQuery({ userId }, dbScope)

    await Promise.all([catalogGrid.preload(), accountSummary.preload()])

    dbScope.include(accountCollection)

    // Return application data only. No dbState here.
    return { userId }
  },
  component: StoreRouteComponent,
})

function StoreRouteComponent() {
  const { userId } = Route.useLoaderData()

  // No ProvideDbScope needed here. Root provides it.
  return <StoreView userId={userId} />
}
```

## 6) Child Route Loader

```tsx
// src/routes/store.$category.tsx
import { createFileRoute } from '@tanstack/react-router'
import { getCatalogCategoryLiveQuery } from '@/db/getters'

export const Route = createFileRoute(`/store/$category`)({
  loader: async ({ context, params }) => {
    const { dbScope } = context
    const category = params.category ?? `all`

    // Uses the same shared scope. getCatalogCollection(scope) inside
    // getCatalogCategoryLiveQuery returns the same memoized instance
    // that the parent loader already created.
    const categoryQuery = getCatalogCategoryLiveQuery({ category }, dbScope)
    await categoryQuery.preload()

    return { category }
  },
  component: CategoryRouteComponent,
})

function CategoryRouteComponent() {
  const { category } = Route.useLoaderData()

  // No ProvideDbScope needed here either.
  return <CategoryView category={category} />
}
```

## 7) Client Views

```tsx
// src/routes/store-view.tsx
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
    <main>
      <h1>Store</h1>
      <p>{account?.email}</p>
      <ul>
        {catalog.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </main>
  )
}
```

## Why Single Root Scope Works Here

1. `createRouter()` runs once per server request, so `dbScope` is naturally request-scoped.
2. Router context is available to both loaders and components.
3. All matched loaders complete before the component tree renders during SSR.
4. `serialize()` in the root component captures everything every loader contributed.
5. Memoization deduplicates: if parent and child loaders both call `getCatalogCollection(dbScope)`, they get the same instance and the data is fetched once.
6. Cleanup in middleware runs after the full render lifecycle.
