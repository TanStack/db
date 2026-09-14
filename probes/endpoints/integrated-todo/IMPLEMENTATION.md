Current coherence work: [authority coordinator, tests and limits](../design/authority-coordinator/README.md). The [first coherence draft](../design/representation/implementation-draft.md) remains the historical design baseline.

# Endpoint prototype: taking stock

The prototype now supports a complete TodoMVC interaction flow on top of
component-authored endpoints, real TanStack DB collections/transactions, and
Drizzle queries against PGlite. The development app is at localhost:4191.
The checkout was last fast-forwarded to origin/main at 2645a08c9 (DB 0.9.0).
This snapshot includes the core ordering fix and the probes directory.

## Authored API

```tsx
const dbClient = useDbClient()
const { query, mutation } = endpoints(dbClient)
const listTodos = query({ input, async handler(req, res) { /* SQL */ } })
const addTodo = mutation({
  input,
  onMutate({ input }) { listTodos.insert(/* optimistic row */) },
  async handler(req, res) { /* SQL write */ },
})
```

The real component has listTodos, addTodo, editTodo, setCompleted, and deleteTodos.
The standard React DbProvider owns the client. There is no extra endpoint
provider, `.collection` accessor, write-forwarding wrapper, or mutation alias.
`listTodos` is the ordinary writable Query Collection. Mutation calls return
Transaction synchronously; persistence is observed through isPersisted.promise.

## What is implemented

| Layer | Current behavior |
|---|---|
| Endpoint compilation | Hoists server handlers into Start RPCs; leaves optimistic callbacks in component scope; preserves source spans; rejects server captures of component state/client. |
| Identity and scope | Caches endpoint collections and mutation functions per DbClient; stable across renders; separate Alice/Bob fixture scopes. |
| Server ordering | Extracts the supported ascending createdAt/id SQL order and configures the client collection comparator. |
| Core DB fix | Merges optimistic inserts/changed sort values into sorted synced iteration. Tests cover ties, both directions, updates, deletes, rollback. |
| Mutations | Fans ordinary optimistic writes into compatible retained query collections. Installs inline authority for isolated actions; overlapping actions wait for known handler outcomes and a covering read before settling together. Handler errors may preserve partially committed server data. No preload inside mutationFn. |
| Authority | Cancels obsolete Query requests and queued adapter applications. Tracks remote outcomes separately from Transaction receipts. Covers late and restarted collections; retains unresolved remote obligations after local rollback or transport failure. |
| Publication | Installs each covered collection and retires its owned overlay before change callbacks run. Reentrant notifications preserve causal order; public rollback batches all recipient collections. |
| Scheduling | No automatic mutation queue. Calls start independently; UI controls do not await or block on persistence. Status observes completion; dismissible, accessible error toasts report failed writes without stealing input focus. |
| Client queries | DB predicates for All/Active/Completed, active-count aggregation, and active/completed ID selections for bulk actions. No server filter request. |
| Todo interactions | Add; toggle one/all; mixed checkbox; edit with double-click or Enter/F2; Enter/blur save; Escape cancel; empty edit deletes; delete; clear completed; pluralized count. |
| UX parity | Initial/continued input focus, hash routes, back/forward, filter restoration on reload, hidden empty toolbar/summary, hidden editing controls, conditional clear/delete controls. Removed the arbitrary 200-character cap. |
| Storage | PGlite in the server process, backed by .data/todos by default. Same instance reused on dev module reload. TODO_DB_PATH selects another path or memory://. No Docker needed. |
| Test separation | Browser instrumentation injected only in browser-test mode; authored component has no test globals/effects. |

The UI does not restore a rejected insert's text into the input: doing so can
overwrite a newer draft. The optimistic row rolls back and the error is shown.

## Verification

Current dev tests cover CRUD, optimistic membership, mixed state, rollback,
concurrent inserts, focus, URL/reload/back/forward, and visibility. The audit
reporter captures before/after observations. A separate test imports the actual
app database module in two processes and verifies a saved row survives close
and reopen. TypeScript, eight compiler checks, and the production build pass.
Current coordinator verification includes 352 DB/adapter boundary tests, actual
runtime regressions, and generated concurrent browser sequences against independent
PostgreSQL. See the coordinator report for counts, receipts, and test limits.

During this work a deliberately faster update overtook a delayed insert of the
same row. A temporary runtime queue prevented that, but was removed after user
review because implicit scheduling is outside the intended API. The original
failure receipt is evidence/overlap-red.log. The final regression tests concurrent
independent inserts and normal completion after persistence; it does not claim
that application-level write conflict resolution is solved. The current coordinator
accepts server execution order and prevents response arrival order from selecting
stale client authority; it does not reorder server writes.

Production UI tests and endpoint lifecycle/binding/callback tests are recorded
under evidence/parity-*. Older receipts may describe earlier implementations;
use the final run logs rather than treating every historical PASS as current.

## What remains bounded or unproven

- The compiler/runtime now also cover generated scalar tables with the same base
  row shape and required scalar query parameters. Cross-module discovery and
  retained instances are implemented; see [registry coverage](../QUERY-REGISTRY-RESULTS.md)
  and [SQL coverage](../SQL-COVERAGE-RESULTS.md). Arbitrary
  parameterized endpoints, projections, sorts, joins, and move-stable IDs are not
  established. IDs are based on module/component/declaration identity.
- Queries support the checked ascending createdAt/id case; unsupported sort
  shapes are rejected rather than silently dropped.
- No automatic mutation ordering, write retries, durable offline queue, or conflict
  resolution. Reads retry three times at 1s, 2s, and 4s. Exhaustion exposes an error;
  a later covering read can recover known handler outcomes without repeating a write.
  Unknown transport outcomes require server closure evidence that this prototype
  cannot yet retrieve. A read or reload is not proof that an unacknowledged handler stopped.
- Actions with no optimistic target remain unsupported. Extra server writes absent
  from onMutate are covered by conservative authoritative refresh; predicting those
  effects optimistically is not claimed.
- PGlite is a local single-process store, not a shared PostgreSQL service.
  Concurrent app processes must use distinct TODO_DB_PATH values. Schema setup
  is idempotent creation, not migrations.
- Alice/Bob selection and probe-control are test fixtures, not production auth.
  The control route can erase fixture data; this app must remain local.
- No claim of SSR hydration, full navigation during pending writes, cross-tab
  coherence, offline behavior, or cross-browser parity. Chrome is tested.
- The notebook styling and server-backed storage intentionally differ from the
  TodoMVC submission template. They are not being replaced with its CSS or
  localStorage conventions.

## Earlier investigation work

Track A explored source/query/schema correspondence and repair diagnostics.
Track B explored compiler/server-boundary and source-map behavior.
Track C explored agent feedback and diagnostic delivery. Their phase reports
remain under the sibling track directories. Full CLI source/schema receipts and
independent compiler safety checks target earlier revisions, not the current
component-bound compiler. The new [E2E oracle](./tests/oracles/README.md) now
checks server canaries, client maps, and unsafe imports against the current API.
