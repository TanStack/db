# TanStack Start Example: Request + Process Scoped DB SSR

This file shows proposed usage for TanStack Start with the same core SSR APIs.

## 1) Shared Environment

```ts
// src/db/server-shared.ts
import { createDbSharedEnvironment } from '@tanstack/db/ssr'

export const sharedDbEnv = createDbSharedEnvironment()
```

## 2) Middleware: Create Request Scope and Store in Context

```ts
// src/start/middleware/db-scope.ts
import { createMiddleware } from '@tanstack/start'
import { createDbRequestScope } from '@tanstack/db/ssr'
import { sharedDbEnv } from '@/db/server-shared'
import { createServerCollections } from '@/db/createServerCollections'

export const dbScopeMiddleware = createMiddleware().server(async ({ request, next }) => {
  const dbScope = createDbRequestScope({
    shared: sharedDbEnv,
    createCollections: ({ shared }) =>
      createServerCollections({ request, shared }),
    collectionScopes: {
      catalog: `process`,
      account: `request`,
    },
  })

  try {
    return await next({
      context: {
        dbScope,
      },
    })
  } finally {
    await dbScope.cleanup()
  }
})
```

## 3) Route Loader: Prefetch with Request Scope

```tsx
// src/routes/store.tsx
import {
  prefetchDbQuery,
  dehydrateDbScope,
} from '@tanstack/db/ssr'
import { createFileRoute } from '@tanstack/react-router'
import { HydrationBoundary } from '@tanstack/react-db/hydration'

export const Route = createFileRoute(`/store`)({
  loader: async ({ context }) => {
    const { dbScope } = context

    await prefetchDbQuery(dbScope, {
      id: `catalog-grid`,
      query: ({ q, collections }) =>
        q.from({ c: collections.catalog }).orderBy(({ c }) => c.name),
      ssr: {
        explicitlySerialized: true,
      },
    })

    await prefetchDbQuery(dbScope, {
      id: `account-summary`,
      query: ({ q, collections }) =>
        q.from({ a: collections.account }).findOne(),
    })

    return {
      dehydratedState: await dehydrateDbScope(dbScope, {
        includeQueries: true,
        includeCollections: {
          // `catalog-grid` is explicitly serialized as a live query above.
          // Only snapshot `account` collection state here.
          include: [`account`],
          includeSyncState: true,
        },
      }),
    }
  },
  component: StoreRouteComponent,
})

function StoreRouteComponent() {
  const { dehydratedState } = Route.useLoaderData()
  return (
    <HydrationBoundary state={dehydratedState}>
      <StoreView />
    </HydrationBoundary>
  )
}
```

## 3.1) Child Route Loader Example

A nested route can prefetch only its own query ids while reusing the same request scope from middleware context.

```tsx
// src/routes/store.$category.tsx
import { createFileRoute } from '@tanstack/react-router'
import { eq } from '@tanstack/db'
import { prefetchDbQuery } from '@tanstack/db/ssr'

export const Route = createFileRoute(`/store/$category`)({
  loader: async ({ params, context }) => {
    const { dbScope } = context

    await prefetchDbQuery(dbScope, {
      id: `catalog-category-${params.category}`,
      query: ({ q, collections }) =>
        q
          .from({ c: collections.catalog })
          .where(({ c }) => eq(c.category, params.category)),
    })

    return null
  },
  component: CategoryView,
})
```

## 4) Client View

```tsx
// src/routes/store-view.tsx
import { useLiveQuery } from '@tanstack/react-db'
import { useHydrateCollections } from '@tanstack/react-db/hydration'
import { clientCollections } from '@/db/clientCollections'

export function StoreView() {
  useHydrateCollections({
    collections: clientCollections,
  })

  const { data: catalog } = useLiveQuery({
    id: `catalog-grid`,
    query: (q) => q.from({ c: clientCollections.catalog }),
    ssr: {
      explicitlySerialized: true,
    },
  })

  const { data: account } = useLiveQuery({
    id: `account-summary`,
    query: (q) => q.from({ a: clientCollections.account }).findOne(),
  })

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

## 5) Why This Works

1. Request data (`account`) is isolated in request scope.
2. Shared read-mostly data (`catalog`) uses process scope.
3. `catalog-grid` uses `ssr.explicitlySerialized: true`, so query dehydration is used and `catalog` is not auto-marked used for snapshot dehydration.
4. Query and collection hydration reuse one cross-framework SSR core.
5. Sync metadata can resume when possible, else truncate-and-restart.
