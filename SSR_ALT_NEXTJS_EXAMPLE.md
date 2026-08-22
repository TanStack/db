# Next.js Example (Alt API): Per-Page Scope

This example uses per-page scope placement.

In Next.js App Router, layouts are cached across navigations and are not re-executed per
request, so there is no per-request root entry point that can create a shared scope.
Each page server component creates its own scope, serializes before returning JSX,
and provides state to a single `ProvideDbScope` per page.

In Next.js Pages Router, `getServerSideProps` is the natural scope boundary: one scope
per page load, serialize and cleanup within the same function.

Additional conventions:

1. Parameterless getters avoid `{}` placeholders.
2. Request-sensitive getters use `scope: 'required'`.
3. Both routers transfer via `state` payload.
4. Cleanup runs after `serialize()` in the same function.

## 1) Shared Getters

```ts
// app/db/getters.ts
import { QueryClient } from '@tanstack/query-core'
import type { DbScope } from '@tanstack/db/ssr'
import { defineCollection, defineLiveQuery } from '@tanstack/db/ssr'
import { liveQueryCollectionOptions } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const globalCatalogQueryClient = new QueryClient()
const scopedQueryClients = new WeakMap<DbScope, QueryClient>()

function getScopedQueryClient(scope: DbScope): QueryClient {
  let queryClient = scopedQueryClients.get(scope)
  if (!queryClient) {
    queryClient = new QueryClient()
    scopedQueryClients.set(scope, queryClient)
  }
  return queryClient
}

// Process/global collection. Scope is optional.
export const getCatalogCollection = defineCollection((scope) =>
  queryCollectionOptions({
    id: `catalog`,
    queryKey: [`catalog`],
    queryClient: scope ? getScopedQueryClient(scope) : globalCatalogQueryClient,
    queryFn: fetchCatalogRows,
    getKey: (row) => row.id,
  }),
)

// Request-sensitive collection. Scope required.
export const getAccountCollection = defineCollection(
  ({ userId }: { userId: string }, scope: DbScope) =>
    queryCollectionOptions({
      id: `account:${userId}`,
      queryKey: [`account`, userId],
      queryClient: getScopedQueryClient(scope),
      queryFn: () => fetchAccountRows(userId),
      getKey: (row) => row.id,
    }),
  { scope: 'required' },
)

export const getCatalogGridLiveQuery = defineLiveQuery((scope) =>
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
```

## 2) App Router Server Component (RSC-Safe)

```tsx
// app/store/page.tsx
import { cookies } from 'next/headers'
import { createDbScope } from '@tanstack/db/ssr'
import { ProvideDbScope } from '@tanstack/react-db/ssr'
import {
  getAccountCollection,
  getAccountSummaryLiveQuery,
  getCatalogGridLiveQuery,
} from '@/db/getters'
import { StorePageClient } from './StorePageClient'

export default async function StorePage() {
  const cookieStore = await cookies()
  const userId = getUserIdFromCookies(cookieStore)
  const dbScope = createDbScope()

  try {
    const accountCollection = getAccountCollection({ userId }, dbScope)
    const catalogGrid = getCatalogGridLiveQuery(dbScope)
    const accountSummary = getAccountSummaryLiveQuery({ userId }, dbScope)

    await Promise.all([catalogGrid.preload(), accountSummary.preload()])

    dbScope.include(accountCollection)
    const dbState = dbScope.serialize()

    // In RSC flows, passing `state` avoids relying on post-render scope lifetime.
    return (
      <ProvideDbScope state={dbState}>
        <StorePageClient userId={userId} />
      </ProvideDbScope>
    )
  } finally {
    await dbScope.cleanup()
  }
}
```

## 3) Client Component

```tsx
'use client'

import { useLiveQuery } from '@tanstack/react-db'
import { useDbScope } from '@tanstack/react-db/ssr'
import {
  getAccountSummaryLiveQuery,
  getCatalogGridLiveQuery,
} from '@/db/getters'

export function StorePageClient({ userId }: { userId: string }) {
  const scope = useDbScope()
  const catalogGrid = getCatalogGridLiveQuery(scope)
  const accountSummary = getAccountSummaryLiveQuery({ userId }, scope)

  const { data: catalog } = useLiveQuery(catalogGrid)
  const { data: account } = useLiveQuery(accountSummary)

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

## 4) Pages Router Loader-Style Example

```tsx
// pages/store.tsx
import type { GetServerSideProps } from 'next'
import { createDbScope } from '@tanstack/db/ssr'
import { ProvideDbScope } from '@tanstack/react-db/ssr'
import { getAccountCollection, getAccountSummaryLiveQuery } from '@/db/getters'
import { StorePageClient } from '@/app/store/StorePageClient'

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const dbScope = createDbScope()
  const userId = getUserIdFromCookies(ctx.req.cookies)

  try {
    const accountCollection = getAccountCollection({ userId }, dbScope)
    const accountSummary = getAccountSummaryLiveQuery({ userId }, dbScope)

    await accountSummary.preload()
    dbScope.include(accountCollection)

    return {
      props: {
        userId,
        dbState: dbScope.serialize(),
      },
    }
  } finally {
    await dbScope.cleanup()
  }
}

export default function StorePage(props: { userId: string; dbState: unknown }) {
  return (
    <ProvideDbScope state={props.dbState}>
      <StorePageClient userId={props.userId} />
    </ProvideDbScope>
  )
}
```

## 5) Process-Scoped Pattern

```ts
// global/process memoization
const catalog = getCatalogCollection()
```

```ts
// request lifecycle binding
const account = getAccountCollection({ userId }, dbScope)
```

## Why Per-Page Scope for Next.js

1. App Router layouts (`layout.tsx`) are React Server Components that can be cached and reused across navigations. They do not re-execute per request, so they cannot host a per-request scope.
2. Page server components (`page.tsx`) do execute per request, making them the correct scope boundary.
3. `getServerSideProps` in Pages Router is inherently per-page per-request.
4. Unlike TanStack Start, Next.js does not have a per-request router creation step or middleware context that flows to both data loading and rendering. The natural boundary is the page.
