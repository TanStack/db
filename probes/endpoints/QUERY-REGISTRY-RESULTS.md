# Retained query instances and the server registry

Mutations now send every retained, non-GCed query instance to a server-owned
registry. Definitions can live in other modules, including nested source
directories. The server registry does not depend on which components or routes
have executed. Optimistic propagation and conservative authoritative refresh
both cover parameterized collections.

```tsx
const { query, mutation } = endpoints(dbClient)
const listTodos = query({
  input: z.object({ completed: z.boolean() }),
  params: { completed },
  async handler(req, res) {
    const user = await requireUser(req)
    const todos = await db.select({
      id: todo.id,
      text: todo.text,
      completed: todo.completed,
      createdAt: todo.createdAt,
    }).from(todo).where(and(
      eq(todo.userId, user.id),
      eq(todo.completed, req.body.completed),
    )).orderBy(asc(todo.createdAt), asc(todo.id))
    return res.json(todos)
  },
})
```

`listTodos` remains an ordinary writable collection. Equal definition/parameter
pairs resolve to the same instance within a client; different parameters resolve
to distinct instances. Input property order does not change identity. The runtime
copies parameters so later edits to the caller's object cannot retarget a retained
collection. TypeScript checks parameter types against the input schema.

## Implementation

- The plugin discovers `src/**/endpoint.ts(x)` and `src/**/*.endpoint.ts(x)`.
  It extracts server query handlers and validators into server-only virtual
  modules. Only imports used by those handlers/validators are retained there;
  the registry does not execute React components to collect definitions.
- A request descriptor carries `{ id, definition, version, params }`. `id`
  identifies the client instance; `definition` identifies its server query.
  The source-module hash checks definition compatibility. This is not a data
  timestamp, PostgreSQL catalog fingerprint or LSN.
- The server validates all descriptors and parameter schemas before invoking the
  mutation. Unknown definitions, duplicate instance IDs, stale versions and bad
  parameters return `not-started`. This proves the handler did not run, so the
  client can retire the failed guess without treating it as an unknown write.
- Every admitted instance gets a full result after the handler completes, even
  if the handler errors after earlier commits. Reads retain the existing retry
  policy. Mutations are not queued or retried.
- The compiler substitutes `req.body.<field>` predicates into the client model
  using validated parameters. DB's evaluator still decides row membership.
- Relation identity includes the resolved database-module binding. Aliases in
  separate modules share a relation; unrelated database modules cannot collide
  just because they export the same table name. Same-relation projections must
  agree. Both registry compilation and client binding enforce that restriction.
- Registration, cleanup/restart and overlap reuse the existing authority
  coordinator. A collection added after submission joins a fresh authoritative
  read. Subscriber count does not decide retention.
- In development, endpoint source additions, changes and removals invalidate the
  registry and request a page reload. Existing client instances are not silently
  rebound to a changed definition.

The test fixture still obtains Alice/Bob scope through its existing request
envelope and `requireUser`. This work does **not** implement production
authentication. Parameters cannot inject a scope field into the strict query
schema; real authentication remains an adapter responsibility.

## Validation

The original failing contracts are saved in `registry-red.tap`. Two additional
red/green pairs cover confirmed design gaps:

1. An explicit pre-write rejection previously became an unknown remote operation.
   The new closure envelope allows a subsequent healthy mutation to complete.
2. Module-local projection checks could miss an incompatible optimistic recipient
   in another module. Client binding now rejects it before creating that recipient.

The full-stack fixture exercises six retained collections: base results and
false/true instances of peer definitions in another module. Across Alice and Bob,
with sibling and nested modules, **12 mutations / 38 checkpoints** passed. Eight
production client artifacts were inspected; direct raw/URL requests for the new
endpoint modules were rejected without exposing server bodies.

The generated concurrent campaign passed **three schemas × three histories**:
**27 mutations / 108 notifications / 90 checkpoints**. It varies write and response
order, schema columns, foreign keys, both scopes, cross-table handlers and errors
after commits. A separate trigger-fanout overlap control verifies server-only
effects across module boundaries.

All **32 top-level contract tests** pass, including the bundled runtime
regressions. Focused checks cover unimported query discovery, declared input
types, pre-write rejection, stable instance caching, defensive parameter copies,
collections without subscribers, GC/restart, late parameter-instance registration
and source-version mismatch. Application TypeScript checks pass.

Receipts are under `integrated-todo/evidence/`:

- `registry-red.tap`, `registry-admission-red.tap` / `registry-admission-green.tap`
- `registry-projection-red.tap` / `registry-projection-green.tap`
- `registry-final-contracts.tap`, `registry-lifetime.tap`
- `query-registry-final/report.json`, `registry-concurrent-final/report.json`
- `registry-trigger-overlap/report.json`

The trigger control passed **3 mutations / 12 notifications / 10 checkpoints**.
Its source update changes recipient rows through PostgreSQL triggers; those
parameterized recipient collections are declared in the other endpoint module.

## Limits

Inputs currently support required strings, booleans and safe integers in a literal
`z.object` schema. Range predicates require integer inputs. Nested, optional,
nullable, defaulted and transformed parameter schemas are rejected. Queries retain
the existing scalar/ordering grammar and required base row shape; joins remain
unsupported by the endpoint compiler.

Discovery is bounded to the source-tree filename convention and relative imports
of the prototype runtime/database module. Arbitrary package exports, barrel
resolution, custom database adapters and imported schemas need further design.
Unimported discovery has a compiler contract; this is not a full lazy-route HMR
or multi-deployment test. Definition versions cover authored module content, not
all transitive server dependencies or database schema changes.

At the end of this registry pass, no affected-set pruning or partial-row authority
patching was enabled. The server refreshed every submitted instance. Subset loading, LSN manifests and combined
SQL execution remain deferred or experimental as previously recorded.

A later [revision-tracking experiment](REFRESH-PRUNING.md) explored baseline
certificates and dependency revisions. Its database-mutating adapter and compiler
hook have been removed. Endpoints must not modify the user's PostgreSQL database;
compiled queries continue to use full refresh.
