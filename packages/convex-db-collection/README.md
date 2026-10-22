# @tanstack/convex-db-collection

Subscribe to Convex query results with TanStack DB. Supports `ConvexClient`, `ConvexReactClient`, generated query types, automatic reactive pagination, local queries, optimistic mutation handlers, and durable offline writes through TanStack’s outbox.

See the [Convex collection guide](https://tanstack.com/db/latest/docs/collections/convex-collection) for setup, mutation handling, generated IDs, and supported behavior.

Run `pnpm --filter @tanstack/convex-db-collection test:e2e` to start an isolated real Convex backend and test both clients, server page splits, and durable replay after process death.
