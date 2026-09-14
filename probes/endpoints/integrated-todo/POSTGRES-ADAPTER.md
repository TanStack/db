# Postgres.js adapter

The [Postgres.js adapter](src/postgres-adapter.server.ts) defaults to prepared, extended-protocol execution. It uses the app's existing client and pool. There is no separate read database or optimization flag.

In a server-only database module:

```ts
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { postgresAdapter } from './postgres-adapter.server'

const client = postgres(process.env.DATABASE_URL!, { max: 10 })
export const db = drizzle(postgresAdapter(client))
```

Use `db` in query and mutation handlers as usual. The refresh helper still waits for the handler outcome and then runs independent reads concurrently. The driver can pipeline compatible prepared queries; Endpoints does not add a scheduler, reserve a connection, change pool sizing or combine SQL statements.

The facade preserves the driver's pending-query object, generic result/custom-parameter types, and Drizzle's binding and mapping. It supplies preparation defaults to `unsafe()`, which Drizzle uses internally. SQL and parameters are passed through unchanged. Mutation statements use the same adapter defaults without changing their SQL, invocation count or awaiting behavior.

An app that disables preparation with `postgres(url, { prepare: false })` keeps that choice. Explicit per-query options also take precedence. The existing client still owns connections and shutdown; the adapter does not create another pool. Transaction and reserved-client methods delegate unchanged: clients returned by those methods retain their native behavior and may not use this optimization. No new transaction or shared-snapshot guarantee is implied.

The adapter is server-only and is rejected by the client-build boundary. The demo still uses PGlite; apps choosing Postgres.js use this adapter in their ordinary server database setup. No PostgreSQL extensions, tracking tables or migrations are required.

## Verification

The [network oracle](../pipelined-reads/oracle.mjs) imports this implementation rather than an experimental copy. It compares native, default Drizzle, adapted Drizzle and pooled adapted Drizzle results against independent PGlite SQL. Wire controls check both actual pipelining and the global preparation opt-out. Adapter contract tests cover argument forwarding, frozen options, pending-query identity, pool settings, error identity and client/server builds. Type checks cover generic results, custom PostgreSQL types and Drizzle integration.

From `../pipelined-reads`, run `npm run test:adapter` and `npm run typecheck`. For the generated network oracle, start its [disposable PostgreSQL fixture](../pipelined-reads/README.md) and run `npm test`.

The [earlier benchmark](../pipelined-reads/RESULTS.md) shows why this is useful for network-bound reads. It also shows why applications retain control of pooling: a pool can execute slow independent reads concurrently. Cold statements, other driver versions and transaction/pooler configurations can change the benefit.
