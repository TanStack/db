# Next.js Example: Request + Process Scoped DB SSR

This file shows proposed usage of the APIs from `SSR_DESIGN.md`.

## 1) Shared Server Environment

```ts
// app/db/server-shared.ts
import { createDbSharedEnvironment } from '@tanstack/db/ssr'

// One shared environment per server process/runtime instance.
export const sharedDbEnv = createDbSharedEnvironment()
```

Alternative global-backed shared environment (ergonomic process scope):

```ts
// app/db/server-shared.ts
import { createDbSharedEnvironment } from '@tanstack/db/ssr'

const DB_SHARED_ENV_KEY = Symbol.for(`@tanstack/db/ssr-shared-env`)
const globalStore = globalThis as Record<PropertyKey, unknown>

export const sharedDbEnv = (globalStore[DB_SHARED_ENV_KEY] ??=
  createDbSharedEnvironment()) as ReturnType<typeof createDbSharedEnvironment>
```

## 2) Server Collection Factory (Mixed Scope)

```ts
// app/db/createServerCollections.ts
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

type CreateServerCollectionsArgs = {
  request: Request
  shared: ReturnType<typeof import('@tanstack/db/ssr').createDbSharedEnvironment>
}

export function createServerCollections({ request, shared }: CreateServerCollectionsArgs) {
  const sharedQueryClient = shared.getOrCreate(`catalog-query-client`, () => new QueryClient())
  const catalogCollection = shared.getOrCreate(`catalog-collection`, () =>
    createCollection(
      queryCollectionOptions({
        id: `catalog`,
        queryKey: [`catalog`],
        queryClient: sharedQueryClient,
        queryFn: fetchCatalogRows,
        getKey: (row) => row.id,
      }),
    ),
  )

  const requestQueryClient = new QueryClient()
  const userId = getUserIdFromRequest(request)
  const accountCollection = createCollection(
    queryCollectionOptions({
      id: `account`,
      queryKey: [`account`, userId],
      queryClient: requestQueryClient,
      queryFn: () => fetchAccountRows(userId),
      getKey: (row) => row.id,
    }),
  )

  return {
    catalog: catalogCollection, // process scope
    account: accountCollection, // request scope
  }
}
```

## 3) Server Component Route (Prefetch + Dehydrate)

```tsx
// app/store/page.tsx
import {
  createDbRequestScope,
  prefetchDbQuery,
  dehydrateDbScope,
} from '@tanstack/db/ssr'
import { HydrationBoundary } from '@tanstack/react-db/hydration'
import { sharedDbEnv } from '@/db/server-shared'
import { createServerCollections } from '@/db/createServerCollections'
import { StorePageClient } from './StorePageClient'

export default async function StorePage() {
  const scope = createDbRequestScope({
    shared: sharedDbEnv,
    createCollections: ({ shared }) =>
      createServerCollections({ request: getRequest(), shared }),
    collectionScopes: {
      catalog: `process`,
      account: `request`,
    },
  })

  try {
    await prefetchDbQuery(scope, {
      id: `catalog-grid`,
      query: ({ q, collections }) =>
        q.from({ c: collections.catalog }).orderBy(({ c }) => c.name),
      ssr: {
        explicitlySerialized: true,
      },
    })

    await prefetchDbQuery(scope, {
      id: `account-summary`,
      query: ({ q, collections }) =>
        q.from({ a: collections.account }).findOne(),
    })

    const dehydratedState = await dehydrateDbScope(scope, {
      includeQueries: true,
      includeCollections: {
        // `catalog-grid` is explicitly serialized as a live query above.
        // Only snapshot `account` collection state here.
        include: [`account`],
        includeSyncState: true,
      },
    })

    return (
      <HydrationBoundary state={dehydratedState}>
        <StorePageClient />
      </HydrationBoundary>
    )
  } finally {
    await scope.cleanup()
  }
}
```

## 4) Client Component (Hydrate Query + Optional Collection Snapshot)

```tsx
'use client'

import { useLiveQuery } from '@tanstack/react-db'
import { useHydrateCollections } from '@tanstack/react-db/hydration'
import { clientCollections } from '@/db/clientCollections'

export function StorePageClient() {
  // Proposed helper: apply snapshot rows + sync metadata once.
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
    <div>
      <h1>Store</h1>
      <p>{account?.email}</p>
      <ul>
        {catalog.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </div>
  )
}
```

## 5) Resume Metadata and Truncate Fallback

Expected behavior after `useHydrateCollections`:

1. If sync metadata is compatible, collection sync resumes from hydrated state.
2. If incompatible or missing, policy `onIncompatibleSyncState: 'truncate'` triggers a truncate-style restart and full refetch.

## 5.1) Explicit Query Serialization Behavior

In this example:

1. `catalog-grid` uses `ssr.explicitlySerialized: true`, so its live query payload is dehydrated by query id.
2. That explicit mode skips auto-marking `catalog` collection as used for snapshot dehydration.
3. `account` still uses normal collection-used tracking and is snapshot dehydrated.

## 6) Route Loader Style Example (Next.js Pages Router)

Next.js App Router does not expose a dedicated route `loader` API. The loader-style equivalent is `getServerSideProps` in Pages Router.

```tsx
// pages/store.tsx
import type { GetServerSideProps } from 'next'
import {
  createDbRequestScope,
  prefetchDbQuery,
  dehydrateDbScope,
} from '@tanstack/db/ssr'
import { HydrationBoundary } from '@tanstack/react-db/hydration'
import { sharedDbEnv } from '@/db/server-shared'
import { createServerCollections } from '@/db/createServerCollections'

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const scope = createDbRequestScope({
    shared: sharedDbEnv,
    createCollections: ({ shared }) =>
      createServerCollections({ request: ctx.req as unknown as Request, shared }),
    collectionScopes: {
      catalog: `process`,
      account: `request`,
    },
  })

  try {
    await prefetchDbQuery(scope, {
      id: `catalog-grid`,
      query: ({ q, collections }) =>
        q.from({ c: collections.catalog }).orderBy(({ c }) => c.name),
      ssr: {
        explicitlySerialized: true,
      },
    })

    return {
      props: {
        dehydratedState: await dehydrateDbScope(scope, {
          includeQueries: true,
        }),
      },
    }
  } finally {
    await scope.cleanup()
  }
}

export default function StorePage(props: { dehydratedState: unknown }) {
  return (
    <HydrationBoundary state={props.dehydratedState}>
      <StorePageClient />
    </HydrationBoundary>
  )
}
```
