# Component endpoints and TodoMVC prototype

See [Taking stock](./IMPLEMENTATION.md) for the API, implemented layers,
verification, and remaining limits; [the audit](./TODOMVC-AUDIT.md) tracks
TodoMVC parity. The [generated E2E oracle](./tests/oracles/README.md) checks
active collections against independent PGlite and records known failures. [Earlier development notes](./HISTORY.md) preserve historical
experiments and receipts rather than describing the current app.

Vite setup uses one plugin entry point. It installs compilation and server-code
protection together, before TanStack Start:

```ts
import { endpoints } from './transform.mjs'

plugins: [endpoints(), tanstackStart(), react()]
```

Endpoint declarations can also live at module scope. See the
[implementation and regression receipts](./MODULE-EXPORTS.md).

```ts
// todos.endpoint.ts
import { dbClient } from './db-client'
import { endpoints } from './runtime'

const { query, mutation } = endpoints(dbClient)
export const listTodos = query({ /* input, schema, handler */ })
export const updateTodo = mutation({ /* input, onMutate, handler */ })

// A route or component imports the actual collection and action.
import { listTodos, updateTodo } from './todos.endpoint'
useLiveQuery(listTodos)
updateTodo({ id, text }) // synchronous Transaction
```

Imports create stable collections without dispatching reads. Preloading,
subscribing, or mutation reconciliation starts data loading. Lazy route modules
can therefore register endpoints when their code loads. Server registry discovery
still finds their query handlers before the browser imports them.

An application may provide `endpointScope` as a string or a synchronous getter.
The runtime resolves it when a read or action starts. Kitchen uses one client per
browser page and waits for its session in the authenticated route. The client
pins its first valid scope and rejects a different scope; account changes require
a new client (Kitchen reloads on logout). Server-rendered applications still need
request-scoped clients; a module singleton is not a per-request session store.

The [first coherence draft](../design/representation/implementation-draft.md) adds cross-query optimism and inline authoritative results, with measured costs and explicit scope limits.

The [authority coordinator](../design/authority-coordinator/README.md) extends it
to overlapping actions, stale reads, and collection restart. It includes the
Ground Condition, state machine, fresh hostile audit, and concurrent full-stack
PostgreSQL oracle. Run `npm run test:oracles:concurrent` for that campaign.

The [SQL coverage expansion](../SQL-COVERAGE-RESULTS.md) adds generated scalar
schemas, foreign-key and concurrent mutation tests, and measured shared-row response
encoding. Run `npm run test:oracles:sql` and `npm run test:oracles:loading`.

The [query registry](../QUERY-REGISTRY-RESULTS.md) adds cross-module server reads
and retained parameterized collections. Run `npm run test:oracles:registry`.

The [revision-tracking experiment](../REFRESH-PRUNING.md) is rejected: Endpoints
must not modify the user's PostgreSQL database. Its trigger/counter adapter and
compiler integration were removed; results remain as historical evidence.

The [Postgres.js adapter](POSTGRES-ADAPTER.md) defaults to prepared execution
over the app's existing pool, enabling compatible reads to pipeline. Explicit
preparation opt-outs remain honored. The demo itself continues to use PGlite.

## External changes and explicit refetch

Query endpoints retain the query collection utilities on the bare collection:

```ts
await listTodos.utils.refetch({ throwOnError: true })
```

Apps can invoke this from polling or an external event callback. Query error
and fetch state, plus `utils.clearError()`, retain their query collection types.
Endpoints does not promise to discover unrelated external writes after each
mutation; polling, external events, or a sync engine own that freshness policy.
Mutation reconciliation must refresh every retained collection the mutation
can affect, including indirect writes. Unknown effects require a conservative
fallback.

The [dependency matcher](../DEPENDENCY-MATCHING.md) can narrow mutation reads
when the server supplies complete read and write footprints. The compiler derives
these for bounded direct Drizzle handlers from a build-time schema snapshot;
see [setup and limits](COMPILED-DEPENDENCIES.md). Missing evidence and unsupported
handlers still refresh all retained collections. Explicit refetch and
overlapping-action recovery also keep the full-read path. Existing oracle cases
that require unrelated external changes to appear after a mutation test the
broader fallback behavior, not the required contract for selective refresh.

## Run

From this directory with the pinned package.json dependencies installed:

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191
```

Open http://127.0.0.1:4191/. PGlite runs in this server process and stores data
in ignored `.data/todos`. Set `TODO_DB_PATH` for another location or `memory://`
for disposable storage. Do not share one data directory between processes.
The app has fixture users and a reset endpoint; keep it on loopback.

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/server-order.test.mjs
node tests/todomvc.mjs
node tests/todomvc-parity.mjs
node tests/todomvc-audit.mjs
node tests/persistence.mjs
node node_modules/vite/bin/vite.js build
TODO_DB_PATH=memory:// node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4194
```

Browser tests reset the fixture database. Run them against an isolated server
when keeping manual demo data. Set PROBE_URL for the server under test.

For endpoint lifecycle/identity tests, start an isolated instrumented server:

```sh
TODO_DB_PATH=memory:// node node_modules/vite/bin/vite.js --mode browser-test --host 127.0.0.1 --port 4193
node tests/browser.mjs
node tests/binding.mjs
node tests/callback-error.mjs
```

The normal component/build has no test globals. Vite and TypeScript resolve DB,
DB IVM, React DB, and Query Collection directly to this checkout's sources.
The cached dependency setup helper and its historical receipts are described
in HISTORY.md; they do not depend on ~/node_modules.

## Mutation input errors

The bound Endpoints API validates a mutation request before loading its query
registry or entering the application handler. A schema rejection returns a
`not-started` response with code `INVALID_INPUT` and structured Zod issue codes,
paths and messages. Paths are request-relative, for example
`['input', 'new_tags', 0, 'name']`. Parsed values, including transforms and
coercions, reach `req.body` without a second parse.

The action’s `tx.isPersisted.promise` rejects with `InvalidInputError`, exported
from the runtime. Callers can inspect `error.code` and `error.issues` to show
field errors. The client drops only that action’s optimistic overlay and remote
obligation, preserving confirmed data and sibling actions. The rejection starts
no write retry or reconciliation and does not set collection read errors.
Overlapping valid writes still use the normal conservative authority repair.

A thrown transport error, even one carrying the same code, is not proof that
execution stopped. Malformed validation envelopes likewise retain the unknown
outcome policy. Errors thrown after application code starts still reconcile,
since the handler may have written before failing.

Validation was red/green verified with the compiled PGlite oracle. Generated
histories include fractional values rejected by integer input schemas, both
with and without an optimistic row, followed by valid writes. The real-browser
companion checks typed errors, immediate optimism, rollback and zero SQL across
three compiled app setups. Runtime tests cover repeated rejection, both orders
of overlapping responses, malformed envelopes and explicit refetch afterward.
