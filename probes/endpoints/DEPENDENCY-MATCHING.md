# Dependency matching: first oracle and implementation

The server registry now skips a retained collection's result read when its
complete read dependencies are disjoint from the mutation's complete write
effects. Unknown reads or writes require full refresh. The matcher changes no
PostgreSQL objects and introduces no authored endpoint option.

The compiler now derives footprints for a bounded grammar of direct Drizzle
handlers using a build-time PostgreSQL schema snapshot. See
[compiled dependencies](integrated-todo/COMPILED-DEPENDENCIES.md) for that path,
its separate oracle and its limits. Kitchen AI's opaque service calls still have
unknown footprints and refresh all retained collections. The original matcher
oracle below supplies fixture footprints; its counts are not app measurements.

## Contract

External-write discovery is outside mutation reconciliation. An unrelated
collection may retain its old baseline until polling, an event, or explicit
`collection.utils.refetch()` updates it. A selected collection's full read still
includes all current PostgreSQL rows, including external changes.

Read footprints must include every dependency: joined relations, predicates,
aggregates, views, authorization, functions and other hidden inputs. Write
footprints must include indirect effects such as triggers and foreign-key
actions, and cover partial commits before a handler throws. Table identity must
include database authority and schema. `null` means unknown; `[]` proves no
dependencies. The existing optimistic relation model is not such a proof.

The internal `registerQuery` accepts complete read dependencies. The internal
`refreshRegisteredMutation` accepts a write-footprint provider, consulted after
the handler closes on success or failure. An absent or throwing provider falls
back to all reads. These are server integration boundaries, not client-supplied
SQL, public endpoint options, or inferred effects from optimistic callbacks.

Every descriptor is admitted before executing the write, including instances
that might later be skipped. The client sends the retained set plus whether
each instance has a confirmed baseline and received an optimistic mutation.
Those flags can force a read; they cannot establish disjointness. Missing
baselines and optimistic recipients require authority even when server writes
are disjoint. Subscriber count has no role.

Responses explicitly account for every requested instance with a snapshot,
an existing certified-unchanged entry, or an `unaffected: [{id}]` entry. The
client rejects omissions, duplicates, unknown identities and unaffected entries
for optimistic or uninitialized collections. Unaffected means only “this
mutation cannot affect this query,” not “PostgreSQL has not changed.” The client
leaves those rows installed, while publishing authority and retiring optimism
together. Overlap or collection lifetime changes still force a fresh full read.

## Oracle and results

`tests/oracles/dependencies.mjs` generates N schemas and runs X histories per
schema, with fast-check shrinking and replay. Real Drizzle reads, the server
registry, response serialization and DB client collections form the SUT. The
oracle issues separately rendered SQL to PostgreSQL for expected query values.
It does not obtain expected rows from response snapshots or matcher metadata.
Read-count assertions separately reject unnecessary refetches.

The initial campaign uses two to five integer-valued tables across two schemas,
including the same table name in both. It exercises base views, filters, a join,
an aggregate, unknown reads, optimistic fanout, changed server targets, no-op
writes, multi-table writes, partial-commit errors, unknown effects, unrelated
external writes and an actual PostgreSQL trigger. A separate executed control
checks an `ON DELETE SET NULL` recipient whose filtered result loses a row.
Only full base views participate in this fixture's optimistic propagation;
joins and aggregates are checked at authoritative reconciliation.

Seed **9122601**, 30 generated scenarios × 3 histories, plus a trigger control:

- 494 mutation operations; 3,967 optimistic and 3,967 authority comparisons.
- 2,908 result reads executed; 1,059 skipped (26.7% of candidate reads).
- A separate foreign-key control passed.
- Deliberately omitting a trigger or foreign-key recipient fails against PG.

These are synthetic workload counts, not app latency measurements. Footprints
are generated fixture facts, so their discovery cost is unmeasured. The browser
registry oracle separately passed two compiled programs, 12 operations and 38
checkpoints, and checked eight client artifacts for server-code leakage. That
browser run covers the default unknown-footprint fallback; selective matching
is exercised by the in-process stack and actual serializer contract test.

The generator found an existing runtime bug: an identical optimistic update
created no row mutation, causing Endpoints to reject the action before invoking
the server. The minimal history was two identical updates. Endpoints now
executes and tracks the server operation even when the optimistic transaction
is empty. DB's ordinary empty-transaction behavior remains unchanged. A focused
red/green test verifies the action stays pending until server authority arrives.

## Run and discovery boundary

From `integrated-todo`:

```sh
npm run test:oracles:dependencies
npm run test:contracts
npm run typecheck
ENDPOINT_ORACLE_SEED=9122601 ENDPOINT_ORACLE_SCENARIOS=30 ENDPOINT_ORACLE_SEQUENCES=3 npm run test:oracles:dependencies
# Expected failures; separate evidence directories preserve the successful run.
ENDPOINT_DEPENDENCY_MUTANT=omit-trigger ENDPOINT_ORACLE_OUTPUT=evidence/dependency-matching-mutant npm run test:oracles:dependencies
ENDPOINT_DEPENDENCY_MUTANT=omit-fk ENDPOINT_ORACLE_OUTPUT=evidence/dependency-matching-fk-mutant npm run test:oracles:dependencies
```

Use `ENDPOINT_ORACLE_PATH` with the recorded seed to replay a fast-check shrink.
Evidence is in `integrated-todo/evidence/dependency-*`.

The compiler derives bounded footprints during compilation, with a separate
generated-program oracle to reject missed dependencies. Schema inspection runs at compilation time, not
inside mutations. Requests only match precomputed footprints; they do not query
catalogs, acquire schema locks, or open extra transactions to prove dependencies.
Schema changes require rebuilding the generated metadata. Missing or unsupported
schema evidence yields unknown footprints and full refresh.

Visible DML targets alone do not
prove the absence of triggers, functions, policies or FK actions. Unsupported
handler or schema features keep the current fallback. Explicit
refetch and overlap repair remain broad; narrowing them is separate work.
