# Rejected revision-tracking experiment

**Current constraint: Endpoints must not modify the user's PostgreSQL database.**
No framework-installed triggers, counter tables, functions, extensions, or required
migrations. Kyle stated: “We can't modify people's postgres”. The trigger/counter
adapter violated that constraint and has been removed, along with its compiler
hook and dedicated benchmark runners. It ran only in disposable oracle databases;
the ordinary Todo app never installed it.

The records below preserve the experiment and its receipts. They are not the
current implementation plan. Generic baseline protocol/serialization tests remain,
but no compiled endpoint supplies a revision provider; all retained queries refresh.

Kyle also corrected the latency interpretation: loopback hides the benefit of
sending fewer bytes. These results measure local overhead and byte reductions,
not whether smaller responses improve latency over a real network. Network
measurements remain outstanding; they are not the reason this adapter was rejected.

## Historical experiment

A disjoint mutation write set is insufficient: the client's baseline may predate
another committed write. The first experiment therefore skips a query only when
its complete read dependencies have the same revision as a server-issued result
that the client has installed. This is a deliberately narrow dependency proof,
not a general SQL effect analyzer or a default migration for applications.

## Laws

1. Every retained instance is admitted before the handler starts. Parameters,
   definition versions and scope remain server-validated.
2. Only the server can issue a baseline token. Its cache entry binds the query
   object, definition/version, instance, parameters, scope and dependency revision.
3. Capture the revision **before** reading rows from the same primary authority.
   Never attach a later revision to earlier rows. A concurrent commit can make
   the certificate conservative and require another read.
4. Compare revisions after the handler finishes, including partial-commit errors.
   Equal complete dependencies permit reuse. Missing tokens, eviction, process
   restart, unknown dependencies or unavailable tracking require full snapshots.
5. The response explicitly lists unchanged instances and echoes their tokens.
   The client checks the tokens against its submitted confirmed baseline and
   requires exactly one full snapshot or unchanged entry per retained instance.
   Optimistic rows never establish a baseline.
6. Publish snapshots and retire optimistic overlays together. Existing overlap,
   stale-read and lifetime rules still force a fresh read. Ordinary reads clear
   tokens; they do not silently inherit provenance from an earlier result.

## First adapter

The server registry accepts an optional trusted revision reader. Its result must
cover **every** dependency of the query. No reader means unknown. The compiler
uses it only when the server database module explicitly exports and imports
`endpointReadRevision` alongside its trusted database/table bindings. It never
accepts dependency declarations from the browser.

The experimental PGlite adapter installs per-table transactional revision counters
and statement triggers for INSERT, UPDATE, DELETE and TRUNCATE. Actual writes from
triggers, foreign-key actions and functions reach the recipient's observer, so
opaque DML is covered without inferring its effects from source syntax. Tables
whose revisions did not change can skip their reads. Zero-row statements can
advance a revision unnecessarily; that is conservative.

The counter and triggering write share a transaction, so rollback rolls both
back. Deferred triggers must finish at commit before reconciliation. These
choices follow PostgreSQL's [trigger transaction semantics](https://www.postgresql.org/docs/18/trigger-definition.html)
and [statement/TRUNCATE trigger rules](https://www.postgresql.org/docs/current/sql-createtrigger.html).

This adapter requires a fixed schema, protected observer objects, a primary
reader, built-in scalar heap tables and stable fixture authorization. It checks
for RLS, inheritance/partitions, rewrite rules, unsupported column types and
missing/disabled observers and declines proofs for those shapes. Runtime DDL,
replacing observer code, privileged disable/write/re-enable cycles, custom auth
functions with hidden dependencies, session-dependent results and replica reads
are outside its contract. They require an adapter that can detect them; they
must not opt into this one. Delayed external writes still need a later signal,
just as full refetch does. This is not a production authorization implementation.

Installation is explicit and limited to disposable oracle databases. The ordinary
Todo app retains full refresh. The adapter adds write work and per-table counter
contention, and catalog/revision reads have a cost. Measure them, not just skipped
result queries, before deciding whether this scheme belongs in the framework.

## Validation

See the accompanying evidence under `integrated-todo/evidence/pruning-*`.
Results and performance measurements are appended after execution.

## Executed results

The optimization works within the adapter's contract, but this pass does **not**
justify enabling it by default. Fewer result bytes did not produce a clear local
latency improvement. One retained collection got worse on both dimensions.

Each performance case ran the same generated program and two histories under
both strategies, alternating strategy order by case. The first mutation of each
history establishes certificates and is recorded separately; the table reports
medians of eight subsequent mutations. Baseline has no revision triggers.
Selective timing includes its observer writes and catalog/revision reads.

| Retained queries | Rows per relevant table | Client ms, full → selective | Response bytes, full → selective | Request bytes, full → selective | SQL calls, full → selective |
| --- | --- | --- | --- | --- | --- |
| 1 | 4 | 5.5 → 7.0 | 2,262 → 2,463 | 841 → 906 | 2 → 3 |
| 2 | 60 | 12.4 → 12.2 | 53,938 → 27,598 | 1,134 → 1,264 | 3 → 4 |
| 6 (two tables) | 4 | 9.8 → 11.4 | 5,066 → 3,910 | 2,533 → 2,923 | 7 → 6 |
| 9 (three tables) | 60 | 27.0 → 26.5 | 87,331 → 30,958 | 3,527 → 4,112 | 10 → 7 |

SQL counts include the mutation and proof queries, not just result SELECTs. The
counter update executes inside the trigger; its CPU and locking cost is included
in elapsed time, but it is not another client-issued SQL call. The two-collection
case saves about 48% of total request-plus-response bytes while adding one SQL
call. The nine-collection case saves about 61% of total bytes. The latency
samples are small and local: differences of 0.2–0.5 ms are not a demonstrated
speedup. WAN transfer and real PostgreSQL contention remain unmeasured.

Validation passed:

- **42 top-level contracts**, including the actual DB runtime regressions, and
  application TypeScript checks.
- **30 generated SQL histories / 276 checkpoints / 483 reads skipped** against
  a separate PG reference with no tracking or trigger code. Dimensions include
  UPSERT, DELETE, TRUNCATE, rollback, errors after commit, earlier external writes
  and a hidden trigger recipient. Separate controls cover FK cascade, deferred
  commit effects, RLS exclusion and disabled observation.
- **91 full-stack mutations / 204 checkpoints** across the two benchmark query
  shapes, sibling/nested parameterized collections, trigger/deferred-write
  controls, and a concurrent trigger replay. The concurrent replay observed
  16 notifications and still repaired from fresh authority. Focused runtime
  tests exercise overlapping responses that actually reuse installed tokens.
- Production client artifacts and raw-source boundaries were checked. Benchmark
  and effect runs also reject the revision adapter's SQL marker in client code.

Three red/green findings strengthened the tests:

1. **Serialization boundary:** pinned Seroval 1.5.0 changes quoted object keys on
   a JSON round trip. Parameterized instance IDs are JSON strings, so a keyed
   certificate record could not survive transport. The response now uses arrays
   of `{ id, certificate }`. A regression uses the installed serializer. This is
   a protocol workaround; Seroval itself was not modified.
2. **Schema identity:** a same-named table in another schema could borrow a public
   table's revision reader. The adapter now rejects non-public registration and
   returns no proof for a non-public lookup. The missing generator dimension was
   qualified relation identity, not row mutation variety.
3. **Unsafe pruning control:** a mutant that freezes the trigger recipient's
   revision fails with seed `911051`, path `0:0:0:0:0:0:0:0`. It shrinks to two
   UPSERTs on the source table. The oracle catches the missing indirect effect;
   it does not copy the tracker when computing expected rows.

The first effect browser run also exposed a harness phase error: allowing the
server to settle while asserting the optimistic DOM compares different phases
when a trigger changes the answer. Effect controls now hold the write through
that checkpoint; their elapsed times include oracle work and are not benchmarks.

## Receipts and replay

All paths below are relative to `integrated-todo/evidence/`:

- `pruning-red.tap`, `pruning-green.tap`, `pruning-runtime-red.tap`,
  `pruning-runtime-green.tap`: first protocol red/green.
- `pruning-serializer-red.tap`, `pruning-serializer-green.tap`: serializer failure
  and transport-safe response regression.
- `pruning-schema-red.tap`, `pruning-schema-green.tap`: schema isolation.
- `pruning-mutant.tap`: expected failure from missing trigger effects.
- `pruning-final-contracts.tap`: final contracts and PG oracle.
- `pruning-browser-final/report.json`: six/nine retained collections.
- `pruning-browser-simple/report.json`: one/two retained collections.
- `pruning-browser-effects-final/report.json`: fanout and deferred trigger controls.
- `pruning-concurrent-trigger/report.json`: concurrent trigger replay.

Historical commands used for the receipts below (the removed adapter runners are no longer available). Current validation uses `npm run test:contracts` and `npm run typecheck` from `integrated-todo`:

```sh
npm run test:contracts
npm run typecheck
npm run test:oracles:pruning
ENDPOINT_PRUNING_SIMPLE=1 ENDPOINT_ORACLE_OUTPUT=evidence/pruning-browser-simple npm run test:oracles:pruning
ENDPOINT_PRUNING_EFFECTS=1 ENDPOINT_ORACLE_SEQUENCES=1 ENDPOINT_PRUNING_SAMPLES=3 ENDPOINT_PRUNING_STRATEGIES=selective ENDPOINT_ORACLE_OUTPUT=evidence/pruning-browser-effects-final npm run test:oracles:pruning
ENDPOINT_ORACLE_PRUNING=1 ENDPOINT_ORACLE_EFFECTS=1 ENDPOINT_ORACLE_OUTPUT=evidence/pruning-concurrent-trigger node tests/oracles/concurrent.mjs --replay tests/fixtures/registry-trigger-overlap.json
# Must fail: missed transitive recipient.
ENDPOINT_PRUNING_MUTANT=miss-trigger-recipient node --experimental-strip-types --test tests/pg-revision.test.mjs
```
