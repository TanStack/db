# @tanstack/convex-db-collection

Subscribe to Convex query results with TanStack DB. Supports `ConvexClient`, `ConvexReactClient`, generated query types, automatic reactive pagination, local queries, optimistic mutation handlers, and durable offline writes through TanStack’s outbox.

See the [Convex collection guide](https://tanstack.com/db/latest/docs/collections/convex-collection) for setup, mutation handling, generated IDs, and supported behavior.

Run `pnpm --filter @tanstack/convex-db-collection test:e2e` to start isolated local Convex backends and test both clients, server page splits, and durable replay after process death. The suite also fetches pinned official pagination and authenticated chat examples to check integration with application code maintained outside this adapter. It needs network access to GitHub and the Convex backend download, but no cloud project or production credentials. Authentication uses a real Anonymous-provider sign-in with temporary signing keys. These checks do not exercise production cloud infrastructure or third-party OAuth services.
