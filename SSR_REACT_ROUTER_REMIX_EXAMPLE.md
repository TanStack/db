# React Router / Remix Example: Request + Process Scoped DB SSR

This file shows proposed usage for React Router and Remix style loader contexts.

## 1) Shared Environment

```ts
// app/db/server-shared.ts
import { createDbSharedEnvironment } from '@tanstack/db/ssr'

export const sharedDbEnv = createDbSharedEnvironment()
```

## 2) Build Request Context with DB Scope

```ts
// app/server/context.ts
import { createDbRequestScope } from '@tanstack/db/ssr'
import { sharedDbEnv } from '@/db/server-shared'
import { createServerCollections } from '@/db/createServerCollections'

export async function createRequestContext(request: Request) {
  const dbScope = createDbRequestScope({
    shared: sharedDbEnv,
    createCollections: ({ shared }) =>
      createServerCollections({ request, shared }),
    collectionScopes: {
      catalog: `process`,
      account: `request`,
    },
  })

  return { dbScope }
}
```

For Remix this can be wired through `getLoadContext`.
For React Router this can be attached through middleware/context APIs.

## 2.1) Remix `getLoadContext` Example

```ts
// server.ts (Remix adapter entry)
import { createRequestContext } from '@/server/context'

export default createRequestHandler({
  build,
  mode: process.env.NODE_ENV,
  getLoadContext: async (req) => {
    return createRequestContext(req)
  },
})
```

## 3) Loader Prefetch + Dehydrate

```ts
// app/routes/store.tsx
import {
  prefetchDbQuery,
  dehydrateDbScope,
} from '@tanstack/db/ssr'

export async function loader({ context }: LoaderFunctionArgs) {
  const { dbScope } = context

  try {
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

    return json({
      dehydratedState: await dehydrateDbScope(dbScope, {
        includeQueries: true,
        includeCollections: {
          // `catalog-grid` is explicitly serialized as a live query above.
          // Only snapshot `account` collection state here.
          include: [`account`],
          includeSyncState: true,
        },
      }),
    })
  } finally {
    await dbScope.cleanup()
  }
}
```

## 4) Route Component

```tsx
// app/routes/store.tsx
import { HydrationBoundary } from '@tanstack/react-db/hydration'
import { useLoaderData } from 'react-router'

export default function StoreRoute() {
  const { dehydratedState } = useLoaderData<typeof loader>()
  return (
    <HydrationBoundary state={dehydratedState}>
      <StoreView />
    </HydrationBoundary>
  )
}
```

## 5) Client View

```tsx
// app/components/store-view.tsx
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

## 6) Resume and Restart Behavior

After snapshot hydration:

1. If sync metadata is usable, sync resumes from that metadata.
2. If metadata is unusable or missing, policy `onIncompatibleSyncState: 'truncate'` triggers restart from a clean synced state.

## 6.1) Explicit Query Serialization Behavior

In this example:

1. `catalog-grid` sets `ssr.explicitlySerialized: true`, so that live query is dehydrated directly.
2. That mode skips auto-marking `catalog` collection as used from this query.
3. `account` remains collection-driven and is snapshot dehydrated.

## 7) React Router Data Route Loader Example

```ts
// app/routes/catalog.tsx (React Router)
import { eq } from '@tanstack/db'

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { dbScope } = context

  await prefetchDbQuery(dbScope, {
    id: `catalog-category-${params.category ?? `all`}`,
    query: ({ q, collections }) => {
      const base = q.from({ c: collections.catalog })
      return params.category
        ? base.where(({ c }) => eq(c.category, params.category))
        : base
    },
  })

  return null
}
```
