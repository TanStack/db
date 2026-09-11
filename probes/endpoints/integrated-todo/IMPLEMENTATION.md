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
| Mutations | Captures ordinary collection mutations in transactions, calls the server, awaits target refetch before settlement, rolls back failed optimistic state. Callback throws also roll back. No preload inside mutationFn. |
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
The 69 targeted core collection tests passed after syncing main; core code has
not changed since that run.

During this work a deliberately faster update overtook a delayed insert of the
same row. A temporary runtime queue prevented that, but was removed after user
review because implicit scheduling is outside the intended API. The original
failure receipt is evidence/overlap-red.log. The final regression tests concurrent
independent inserts and normal completion after persistence; it does not claim
that arbitrary same-row request reordering is solved.

Production UI tests and endpoint lifecycle/binding/callback tests are recorded
under evidence/parity-*. Older receipts may describe earlier implementations;
use the final run logs rather than treating every historical PASS as current.

## What remains bounded or unproven

- The compiler/runtime target this Todo schema and empty query input. Arbitrary
  parameterized endpoints, projections, sorts, joins, and move-stable IDs are not
  established. IDs are based on module/component/declaration identity.
- Queries support the checked ascending createdAt/id case; unsupported sort
  shapes are rejected rather than silently dropped.
- No automatic mutation ordering, retries, durable offline queue, or conflict
  resolution. Same-row requests can race. A failed refetch can roll back the
  local overlay even after the server write committed.
- Empty optimistic transactions are rejected. Non-optimistic endpoints and
  cross-collection writes absent from onMutate are not supported claims.
- PGlite is a local single-process store, not a shared PostgreSQL service.
  Concurrent app processes must use distinct TODO_DB_PATH values. Schema setup
  is idempotent creation, not migrations.
- Alice/Bob selection and probe-control are test fixtures, not production auth.
  The control route can erase fixture data; this app must remain local.
- No claim of SSR hydration, navigation during pending writes, cross-tab
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
component-bound compiler. Extending those checks to the current API remains work.
