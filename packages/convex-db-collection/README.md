# @tanstack/convex-db-collection

Subscribe to Convex query results with TanStack DB. Supports `ConvexClient`, `ConvexReactClient`, generated query types, automatic reactive pagination, local queries, optimistic mutation handlers, and durable offline writes through TanStack’s outbox.

See the [Convex collection guide](https://tanstack.com/db/latest/docs/collections/convex-collection) for setup, mutation handling, generated IDs, and supported behavior.

Run `pnpm --filter @tanstack/convex-db-collection test:e2e` to start isolated local Convex backends and test both clients, server page splits, and durable replay after process death. The suite also fetches pinned official pagination and authenticated chat examples to check integration with application code maintained outside this adapter. It needs network access to GitHub and the Convex backend download, but no cloud project or production credentials. Authentication uses a real Anonymous-provider sign-in with temporary signing keys. These checks do not exercise production cloud infrastructure or third-party OAuth services.

The paginated factory supports `syncMode: 'on-demand'` for one fixed query with an explicit numeric `queryOrder`. Ordered DB windows acquire the required prefix and complete boundary ties. General filters and orders are not translated into Convex queries; see the guide for the supported profile.

Run `pnpm --filter @tanstack/convex-db-collection test:e2e:lazy` for the local lazy-paging receiving checks. `CONVEX_TEST_BACKEND_VERSION` can select an already downloaded backend version when the version service is unavailable.

The lazy receipt and window oracles run matching fixed and random campaigns.
Set `CONVEX_LAZY_ORACLE_RUNS_MULTIPLIER=3` to deepen the revalidation and backend
boundary families. Replay a captured failure with the reported seed and shrink
path in `CONVEX_REVALIDATION_ORACLE_SEED/PATH` or
`CONVEX_BOUNDARY_ORACLE_SEED/PATH`. Run backend commands serially: the local
Convex CLI checks its default port across checkouts. Concurrent unit campaigns
also need separate coverage report directories.
