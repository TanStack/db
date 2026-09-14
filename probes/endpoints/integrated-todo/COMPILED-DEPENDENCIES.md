# Compile-time dependency discovery

The compiler combines direct Drizzle handler analysis with a PostgreSQL schema
snapshot to emit read and write dependency sets. Mutation requests only match
those sets and execute selected result reads. They perform no schema queries,
schema locks, or added proof transactions. No tracking objects are installed in
application PostgreSQL.

Unknown analysis keeps the full-refetch path. Every affected retained collection
still participates, including collections with no subscribers. Optimistic
recipients and collections without a confirmed baseline always require authority.
Explicit refetch and overlapping-action recovery retain their broad reads.

## Build setup

Run from the application root with `pg` installed and `DATABASE_URL` already set
in the build environment:

```sh
node compile-schema.mjs src/database.server.ts
```

The positional path identifies the module exporting `db`; the default is
`src/database.server.ts`. The tool connects through `pg`, inspects catalogs in a
read-only build transaction, and writes `.endpoints/schema.json`. It does not
evaluate application modules or store the connection string. This directory is
ignored by Git and blocked from client loading.

The probe's `prebuild` and `predev` scripts run this step. Direct Vite invocation
bypasses those hooks; run the schema command first when using Vite directly.
Without `DATABASE_URL`, the command removes old evidence and compilation uses
unknown dependencies. Inspection failure also removes old evidence and fails the
build. Missing, malformed, or fingerprint-invalid snapshots use the fallback.

The snapshot must describe the database and schema used by the named `db`
export. Schema migrations, role/search-path changes, or connection changes require
regeneration and rebuilding before serving with the new configuration. Matching
the snapshot to deployment is a build contract; requests do not detect drift.
Other connection setups currently use the fallback. The bundled PGlite Todo app
does not automatically get a snapshot from this PostgreSQL CLI.

## Supported boundary

The direct handler grammar accepts one awaited Drizzle select, insert, update,
or delete, simple predicates/order/limit/offset, primitive Zod object inputs and
direct result returns. It resolves named table imports and reexports from
`pgTable` or `pgSchema(...).table`, and a recognized `drizzle` database export.
Table identities include the database binding, schema and table name.

The schema classifier accepts a conservative set of native heap tables, built-in
column types and ordinary indexes. It expands foreign-key cascade and set actions
transitively, tracking whether each step deletes or updates. An unsupported
recipient makes the entire write footprint unknown.

User triggers, views, policies, inheritance/partitions, custom types, generated
columns, expression/partial/custom indexes and check/exclusion constraints retain
fallbacks. Defaults and identity columns block write proofs. Reads of ordinary
defaulted columns remain eligible. This is deliberately narrower than PostgreSQL.

When that grammar cannot establish a footprint, `function-dependencies.mjs`
follows local/imported functions, named/default/namespace imports and reexports,
returned service objects, closure and callback arguments, and database handles
passed through transaction parameters. It collects a union over branches, loops,
multiple statements and exception paths. Reads inside a mutation do not become
writes. Ordinary Zod parsing and supported pure transforms are recognized.

Unresolved external calls, recursive/reassigned functions, raw SQL, effectful
validators and unsupported syntax remain unknown. SQL/coercion arguments may not
contain executable objects: a driver's `toPostgres` callback can hide writes.
Runtime Drizzle column hooks are rejected. The analysis assumes standard,
unmodified Drizzle, built-ins and driver behavior; it is not a whole-program proof
against monkeypatches or arbitrary driver middleware. Analysis has a fixed work
budget and falls back when exceeded. It never executes application modules.

Kitchen AI now uses ordinary services instead of tRPC. Its actual build-time
diagnostic still reports unknown footprints for all eight queries and ten actions:
the Better Auth factory is unresolved, and ingredient creation also reaches an
unsupported enum factory. Its schema contains types/defaults outside the current
classifier. No application schema snapshot or Kitchen read savings are claimed.

Schema and inspected source fingerprints contribute to endpoint definition
versions. Vite watches the snapshot and resolved binding modules. Catalog and
compiler code stay outside generated request handlers and client artifacts.

## Oracle and evidence

`tests/oracles/compiled-dependencies.mjs` generates actual endpoint modules,
inspects disposable PGlite schemas, compiles the modules, and runs real Drizzle,
registry, serialization and DB collections. A separate PGlite instance executes
independently rendered SQL for expected results. Expected values do not come from
the inferred footprints. Assertions check immediate optimism, settled rows,
result-read counts and absence of runtime catalog queries/locks/transactions.

The generator covers two to four tables, schema-qualified duplicate table names,
inserts/updates/deletes, errors, absent optimistic rows, FK cascades and a user
trigger. It does not cover the full supported SQL grammar. A deterministic trigger
control also proves the oracle rejects a deliberately omitted trigger effect.

Seed **9122602**, 20 generated scenarios × 3 histories plus the trigger control:

- 301 operations and 946 authoritative collection comparisons.
- 402 result reads executed; 544 skipped.
- Zero runtime catalog queries.

The initial companion browser campaign builds two actual applications and exercises HTTP:
six operations, 18 comparisons, 11 reads and seven skipped reads. Eight client
artifacts pass the server-code boundary checks. Both generated campaigns use PGlite; the build CLI is separately checked against
a disposable PostgreSQL database, as described below.
These are synthetic read counts, not application latency measurements.

The expanded helper campaign (same seed, 20 scenarios × three histories plus
two controls) compiles direct and multi-module service variants, including a
write several calls deep into a second table with no optimistic recipient. It
passes 269 operations, 755 authority comparisons, 403 result reads and 352 skipped
reads. Deliberately omitting a helper's second-table effect fails on stale data.
The helper browser campaign passes two builds, six operations, 18 comparisons and
eight client-artifact checks. Evidence is under `evidence/function-dependencies*`
and `evidence/function-dependency-browser`.

Kitchen's tRPC-free app passes its production build, typecheck, targeted lint and
232 PostgreSQL/browser collection comparisons. Thirty-four client JavaScript
artifacts contain none of the checked server implementation markers. These app
tests exercise the full-refetch fallback.

The actual `pg` schema CLI now has a disposable PostgreSQL integration control:
`node tests/oracles/schema-postgres.mjs` (requires the Kitchen test database on
port 55480). It caught `name[]` decoding as text in `pg`; the catalog query now
returns `text[]`. PGlite-only tests did not cover this driver boundary. A separate
Vite 8 regression prevents compiler watch files becoming client imports; dev
watching uses the server watcher instead of transform `addWatchFile`.

```sh
npm run test:contracts
npm run typecheck
npm run test:oracles:compiled
npm run test:oracles:compiled-browser
# Expected failure; preserve the successful evidence separately.
ENDPOINT_COMPILED_MUTANT=ignore-triggers ENDPOINT_ORACLE_OUTPUT=evidence/compiled-dependencies-mutant npm run test:oracles:compiled
```

Reports and red/green receipts are under `evidence/compiled-dependencies`,
`evidence/compiled-dependencies-mutant` and `evidence/compiled-dependency-browser`.
