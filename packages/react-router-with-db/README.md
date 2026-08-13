# @tanstack/react-router-with-db

TanStack Router and TanStack Start SSR integration for TanStack DB.

```tsx
const dbClient = new DbClient()
const router = createRouter({
  routeTree,
  context: { dbClient },
})

export default routerWithDbClient(router, dbClient)
```

The adapter provides the client, hydrates critical collection state, and streams
`useLiveSuspenseQuery` calls discovered during server rendering. Streamed
promises resolve to normalized collection rows, not live-query result snapshots.

See the [SSR and Hydration guide](../../docs/guides/ssr.md).
