# One-component Todo integration

**Working in real development and production browsers:** the authored query and mutation in `src/endpoint.tsx` compile into Start server functions and client descriptors. The generated runtime creates a real TanStack DB Query Collection and transaction. The server executes Drizzle queries against disposable PGlite / PostgreSQL. No external database or production credentials are used.

See [the TodoMVC loss audit](./TODOMVC-AUDIT.md) for verified parity gaps. The
mixed-state checkbox is fixed; passing CRUD tests does not mean full TodoMVC parity.

## TodoMVC update (current)

Synced this checkout to `origin/main` at `ad043b745` (DB 0.9.0), preserving
its optimistic collection ordering changes. The app now supports completion,
text editing (double-click or Enter/F2; Enter/blur saves, Escape cancels),
deletion, toggle all, clear completed, and All/Active/Completed filters.
Empty edits delete the task. All writes remain scoped to the fixture user.

Filtering, the active count, and the active/completed bulk selections use local
TanStack DB live queries. Filtering sends no RPC. The displayed query orders by
createdAt and id. Mutations call the bare `listTodos` collection directly and
synchronously return a `Transaction`; UI settlement observes
`transaction.isPersisted.promise`. The UI waits for initial readiness and keeps
one write pending at a time. The runtime awaits the target adapter's refetch,
with no preload inside mutationFn.

`tests/todomvc.mjs` exercises the real UI and database in dev and production:
optimistic filtering before the delayed server write, no filter RPC, editing,
cancel/blur, update rejection rollback, bulk completion, deletion, empty edits,
clear completed, reload, and separate fixture users. Evidence is prefixed
`todomvc-`: red/green browser logs, production browser log, lifecycle regression,
8 compiler checks, 69 core collection tests, TypeScript and production build.
The screenshot is `evidence/todomvc.png`. Run this test against the ordinary
server, without the browser harness:

```sh
node tests/todomvc.mjs
PROBE_URL=http://127.0.0.1:4192 node tests/todomvc.mjs
```

Deleting the home-level node_modules exposed missing type dependencies. The
probe now declares @standard-schema/spec and maps it and Pacer's subpath types
locally, so typechecking no longer depends on ancestor-installed packages.
Older evidence and phase descriptions below remain historical unless explicitly
revalidated above.

## Run

### Browser harness

The authored Todo contains no browser-test effect, global, readiness marker or
runtime-inspection import. `tests/browser-harness.ts` owns that instrumentation.
`tests/harness-plugin.mjs` injects its hook only in the explicit `browser-test`
Vite mode. Normal dev and production builds omit it; UI smoke tests verify that
`window.todoProbe` is absent. A scan also found no test-hook strings in the normal
production client JavaScript.

For collection/lifecycle tests, start a separate server in one terminal:

```sh
node node_modules/vite/bin/vite.js --mode browser-test --host 127.0.0.1 --port 4193
```

Then run `node tests/browser.mjs`, `node tests/order.mjs` and
`node tests/binding.mjs` from another terminal. Those tests default to port 4193.
All pass with the extracted harness. The generic `test` mode initially returned
404 for this Start app; the dedicated mode above serves it correctly.
Use `tests/ui-smoke.mjs` for the normal uninstrumented dev/production demos.
Current evidence is `harness-*` and `clean-component-*`. The harness server was
stopped after verification; the ordinary demo servers remain running.

### Current bound API experiment

The component now uses the existing React DB provider and hook:

```tsx
const dbClient = useDbClient()
const { query, mutation } = endpoints(dbClient)
const listTodos = query({ /* inline input and server handler */ })
const addTodo = mutation({ /* inline input, onMutate and server handler */ })
const { data } = useLiveQuery(listTodos)
// The form calls addTodo(input) directly.
```

There is no separate endpoint provider or `const add = addTodo` alias. Endpoint
runtime state is cached in a WeakMap keyed by the actual provider's DbClient;
transactions and source collections use that same client. Compiler-generated
IDs retain query and mutation identities across renders. The browser identity
test confirms this for the current component.

`bound-transform.mjs` lifts server functions from direct component declarations,
retains optimistic callbacks in component scope, and rejects server captures of
the client or component state. Eight compiler checks pass. The existing bounded
analyzer extracts ascending createdAt/id order and configures the collection sort;
unsupported sorts or transformed responses reject. This is still the narrow
Todo schema and empty-input specimen, not a general endpoint compiler.

`listTodos` is one normal Query Collection. The second live-query collection,
write forwarding, and virtual-property type assertion have been removed. Its
normal insert/update/delete methods operate on that same collection. Generated
server ordering configures its comparison function.

The core iteration gap is now fixed: with a configured comparator, optimistic
inserts and changed sort values merge into the sorted synced rows. Only the
optimistic overlay is sorted, followed by a linear merge; iteration costs
O(m log m + n) for m optimistic rows and n synced rows. Collections without a
custom comparator retain their existing iteration behavior. Two core regression
cases fail without this change and pass with it, covering both directions,
ties, moved updates, deletes and rollback. All 66 targeted tests pass across
optimistic-ordering, deterministic-ordering and collection suites.

Latest evidence uses `single-collection-` prefixes. The identity browser test
asserts that the transaction's collection is exactly `listTodos`, not another
collection behind a write adapter. The dev lifecycle/order/typecheck/build
checks pass. The earlier `bound-` evidence below describes the preceding API
experiment and is retained as history.

Current evidence is prefixed `bound-`: compiler, dev lifecycle, real form,
identity, ordering and production build. The earlier five-case independent
compiler suite and full source/schema CLI receipts describe older compiler and
top-level-declaration revisions. The phase-3 CLI adapter has not yet been
extended to component-bound declarations; those receipts must not be presented
as verification of this revision. The new compiler does reuse its strict
handler recognizer for generated order metadata.

Earlier ordering fix (superseded by the bound API): the UI explicitly ordered its React live query by
`createdAt` ascending, then `id` ascending, matching the server query. Fetching
ordered SQL rows did not impose ordering on `useLiveQuery(collection)`.
`tests/order.mjs` failed before the fix and passes in dev and production. It
inserts temporary optimistic rows whose creation, insertion and ID orders differ,
including tied timestamps, checks DOM order, then rolls them back. Earlier tests
checked membership and settlement rather than relative row order, so they missed
this bug. Evidence: `order-red.json`, `order-dev-green.json`, and
`order-production-green.json`. The reload assertion ran against empty server
data; it is not independent evidence of persisted-row ordering.

Run with `node tests/order.mjs`; set `PROBE_URL` and `PROBE_LABEL` for production.
TypeScript and production build pass after this change. Earlier source-hash
receipts describe the prior revision; the follow-up receipt is
`../track-a-analysis/phase3/order-fix-check.json`.

From this directory, with Node 24.5.0 and the pinned dependencies installed. The observed executable is `/opt/homebrew/Cellar/node/24.5.0/bin/node`; use it explicitly if your shell selects another Node version.

```sh
# This investigation reused exact cached packages, with paths in evidence/versions.json.
# Optional cache install (never edits the donor checkout):
node tests/setup.mjs /Users/kylemathews/programs/tanstack-db/node_modules/.pnpm /Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/track-a-analysis/node_modules
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191
# Separate terminal; checks the ordinary UI without instrumentation.
node tests/ui-smoke.mjs

# Production:
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4192
PROBE_URL=http://127.0.0.1:4192 PROBE_LABEL=production node tests/ui-smoke.mjs
```

Open [development notebook](http://127.0.0.1:4191/) or [production notebook](http://127.0.0.1:4192/). `?scope=bob` selects the other disposable notebook. Browser tests reset the server's local data before running; don't run them during a manual demo.

The dependency versions and canonical cache paths are recorded in `evidence/versions.json`. DB, DB IVM, React DB and Query Collection are **this checkout's source**, resolved by explicit Vite/TypeScript aliases, not an unrelated published DB package. External dependency deduplication resolves React correctly across those source roots. The existing pnpm cache plus Track A’s installed PGlite were used. The two-source setup command was validated into a fresh temporary node_modules directory (`evidence/setup-check.log`); a fresh online install was not tested. The server data is in-memory PostgreSQL and lasts for the server process, including browser reloads, but not server restart. Endpoint source rebuild/HMR can also recreate the database instance; the repair exercise observed this.

## Observed tests

| Test | Development | Production |
|---|---|---|
| Client UUID inserts into actual optimistic transaction before server write | PASS | PASS |
| Delayed write and delayed refetch retain row and `persisting` transaction | PASS | PASS |
| Promise resolves and transaction completes only after refetch | PASS | PASS |
| Alice mutation refetches Alice collection; Bob client/collection remain untouched | PASS | PASS |
| Server rejection fails transaction, removes optimistic row, writes no DB row | PASS | PASS |
| Write succeeds then refetch fails: promise rejects, optimistic row rolls back, committed server row remains | PASS | PASS |
| Later successful refetch recovers that persisted row | PASS | PASS |
| Server Zod input rejection rolls back empty-text insert | PASS | PASS |
| Reload reads persisted rows from PostgreSQL | PASS | PASS |
| Browser page errors | None | None |

The test reads actual collection rows, `Transaction.state`, pending/resolved transaction persistence outcome, and SQL/control snapshots. It does not infer settlement from a spinner. `requireUser` applies delayed/failed reads only for compiler-tagged query requests, so the post-write read failure cannot be confused with a mutation auth failure before insertion.

`tests/replay-red.mjs` temporarily removes the runtime's awaited refetch, runs the same browser safety assertion, and restores the file in `finally`. The deliberate mutant failed with `resolved` where `pending` was required after the write. This is an integration test mutation, not a previously shipped bug. The final normal browser test is green. The prior callback fixture could not catch this class because it never created a DB transaction or inspected collection settlement.

A second meaningful regression reproduced a callback throwing after its first insert: the transaction stayed `pending` and retained the row. The runtime now rolls it back and consumes its rejected settlement before rethrowing the callback error; the test observes `failed`, no retained row and no RPC invocation. Empty optimistic callbacks also fail explicitly without calling the server. Evidence: `callback-red.json` → `callback-green.json`. This test uses a labeled callback fixture descriptor and a stub RPC to prove work never reaches the transport; normal Todo lifecycle tests use the real server/database.

`node tests/ui-smoke.mjs` and its production URL variant also submit the actual rendered form, wait for `Saved`, and inspect the resulting PostgreSQL row. They leave clean demo data and capture `dev-ui.png` / `production-ui.png`.

Results: `evidence/dev-browser.json`, `production-browser.json`, `red-no-refetch-browser.json`; screenshots `dev.png` and `production.png`; build/typecheck logs and version/source hashes. The independent compiler safety worker tests the extended compiler in `../track-b-compilation/phase3-validation`; original phase-2 tests and artifacts are untouched.

## Authored and generated boundaries

`src/endpoint.tsx` contains the query handler, mutation handler, Zod input validation, optimistic callback and Todo UI. Imported `database.server.ts` supplies a real Drizzle schema/database and the explicit auth/test fixture. The compiler preserves input/handler/callback authored spans with the prior MagicString transform and delegates server-code extraction to Start.

The compiler accepts direct top-level `const query({input, async handler(...) {...}})` and `const mutation({input, onMutate(...) {...}, async handler(...) {...}})` declarations. Imports must bind `query`/`mutation` from `./runtime` without aliases, and `z` from `zod`. Calls hidden in nested scopes, spreads, extra/duplicate properties, indirect handlers, receiver semantics and wrong bindings reject. `endpoint.tsx` is an explicit filename boundary. The generated helper bindings and declaration names remain probe-level conventions; move-stable endpoint IDs are not established.

The runtime **authors** the row-key policy `row.id`, the empty-query-input policy, and endpoint-ID/scope query keys. Analysis provides independent key/order/schema evidence through Track A; it does not yet emit this metadata into the compiler. The adapter normalizes no date itself: tested Start serialization preserves Date values through this transport. UI insertion order is not an independent proof of SQL ordering.

`endpoints(dbClient)` binds the declarations to the standard React DB provider's client. Each client has a QueryClient and endpoint collection cache. Transaction targets come from actual optimistic mutations, and each target is refetched with `throwOnError:true` before settlement. An empty optimistic transaction is explicitly rejected. Non-optimistic mutations, cross-collection writes not represented in onMutate, SSR hydration, and navigation/scope switching during an in-flight mutation are not supported claims.

Scopes `alice` and `bob` are user-selectable disposable fixture identities passed in the validated RPC envelope. **This is not authentication or authorization.** `/probe-control` is an unauthenticated fixture-only control/evidence route; it must never be deployed. The demo listens on loopback. Auth refresh, permission transitions, RLS, durable deduplication and production credential handling are not implemented.

## Real analysis evidence

`GET /probe-control` captures catalog columns/indexes from the same running PostgreSQL instance as the app, the same Drizzle table's expected column facts, database version, instance ID, capture time, last executed SELECT plus parameters, and the compiler-injected SHA-256 of original endpoint source. `evidence/*-schema.json` captures these outputs. Track A's phase-3 adapter checks the full authored TSX and compares its lowered SQL to that actual runtime SQL. It rejects source-revision mismatch instead of certifying a different running build. Root coordinates the intentionally broken-order → source-located repair → exact rerun demonstration, with evidence under Track A's phase-3 directory.

This snapshot demonstrates local source/schema/query correspondence at a captured instant. It is not deployment or migration freshness, arbitrary handler analysis, optimizer advice, or proof for an external database. The PostgreSQL key/order checker remains its declared narrow single-table grammar.

## Failed attempts and limits

Initial dev startup required scoped sandbox permission to listen on loopback. Port 4190 was rejected by browser Fetch as a reserved port; the demo uses 4191/4192. Direct aliases to React's CommonJS entry broke Vite SSR (`module is not defined`); source package aliases plus dependency deduplication fixed that and passed dev/prod builds. A first TSX fixture had a missing JSX expression brace and failed before source extraction; corrected before browser testing. TypeScript source-package resolution needed explicit React types and `noUnusedLocals` to match the checkout's existing expect-error usage. No shared repository configuration changed.

The tested safety boundary is explicit server modules / `.server.ts` naming plus source-map policy, not detection of arbitrary sensitive modules. Public static assets, arbitrary virtual modules and every dev error/stream payload are outside the prior guard's scope. Server build/source maps are server artifacts. The test control endpoint is intentionally not a production API.

Final local server sessions retained for the demo: dev port 4191 (`exec` session 28626), production preview port 4192 (session 82935). Final UI smoke resets fixture flags to zero/false and leaves one saved task in each server's database. Current screenshots are `evidence/dev-ui.png` and `evidence/production-ui.png`. These process identifiers are session-local operational receipts, not persistent service configuration.
