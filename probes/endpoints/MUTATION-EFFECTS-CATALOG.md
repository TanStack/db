# Mutation effects and reconciliation boundaries

The safe fallback is to re-run every retained query **after the relevant commits**, under the caller's authorization, against an authority that can see those commits. A handler's direct SQL targets and `RETURNING` rows do not prove the full write set. Nor does a completed handler prove that a background job has finished.

This is a design inventory, not a claim of PostgreSQL feature coverage. Documentation references below use PostgreSQL 18; the executable PGlite campaigns record their own engine version. The current fixture uses PostgreSQL 17.5. A named case becomes tested only when an executed witness is saved.

## Two registries

The client should send **all retained, non-GCed query instances** with a mutation. This includes collections without subscribers. An instance descriptor needs the registered definition ID and validated parameters; lifetime/version information must prevent a response for an old instance from replacing its successor. Authorization comes from the server request, never a client-supplied claim of scope.

The server needs a build-wide query-definition registry, including definitions in other modules and lazy routes. That registry owns executable SQL/handlers and their input validators. The browser supplies identities and inputs, never executable SQL. The prototype now discovers endpoint definitions across its source tree, including unimported modules, and sends retained scalar-parameter instances. It validates every descriptor before a mutation starts. See [implementation and limits](QUERY-REGISTRY-RESULTS.md); arbitrary package discovery and production authentication remain outside this fixture.

The server can intersect possible effects with requested instances when it has a complete dependency proof. Otherwise it refreshes every requested instance. A missing or stale registry entry must produce an explicit recovery/error path; silently skipping it would falsely settle the mutation. Queries registered after submission need the existing overlap/lifetime repair rules. No global enumeration of other users' collections is needed.

Disjoint writes alone do not establish that the client's earlier baseline is
current. The [revision-tracking experiment](REFRESH-PRUNING.md) explored that gap,
but its database observer adapter has been removed. **Endpoints must not modify
the user's PostgreSQL database**: no framework triggers, counters, functions,
extensions or required migrations. Dependency proofs must respect this boundary;
otherwise refresh every retained instance. Existing application triggers and
other indirect effects remain part of the oracle's input space.

Optimistic routing uses the same retained-instance inventory but a different authority: authored guesses plus proven relational rules. It does not pretend to predict arbitrary server triggers or outside systems.

## Catalog

“Refresh” below means a fresh authoritative result, not an exact row patch. None of these entries alone grants permission to prune affected queries.

| Effect family | Concrete example / oracle dimension | Required treatment |
| --- | --- | --- |
| BEFORE row rewrite | Normalize text; replace a key, timestamp, tenant, or completion flag | Preserve the authored guess until authority arrives; install actual projected rows, including membership/order changes. |
| BEFORE row suppression | Trigger returns NULL for UPDATE or DELETE | A successful handler can change zero rows. Do not treat success as confirmation of the optimistic value. |
| Row trigger fanout | Updating one task updates all project summaries | Direct target rows do not bound recipients. Follow a proven transitive effect set or refresh all retained queries. |
| Recursive trigger chain | Task → project → account, or a guarded same-table update | One-hop dependency analysis is insufficient. Cycles and data-dependent termination require a conservative boundary. |
| Statement/transition trigger | An UPDATE affects 0, 1, or many rows; trigger reads OLD/NEW TABLE | Model the statement's row set and statement-level invocation, not one callback per input row. |
| Deferred constraint trigger | A trigger writes another relation or rejects at transaction end | Wait for commit outcome before authority reads and transaction settlement. |
| FK delete actions | CASCADE, SET NULL, SET DEFAULT; composite and self references | Rows can disappear or leave a query without a direct handler statement. Include downstream triggers. |
| FK key-update actions | Changing a parent key moves child references | Identity and relationships can change together; deletion/insertion patches need complete evidence. |
| Constraint rejection | CHECK, UNIQUE, exclusion, NOT NULL, immediate/deferred FK | Check actual committed state after errors; distinguish a rolled-back statement from earlier committed handler work. |
| Defaults and identity | Server assigns key/time/default via an expression | Client values are guesses. Server-generated identity needs a correspondence rule before exact patches can replace temporary keys. |
| Generated columns | Stored expression changes when an input changes | Column-level affected-set analysis must include generated dependencies. Version-specific virtual columns need separate cells. |
| Updatable view / INSTEAD OF trigger | A view write modifies several base tables | The named view is not the write set. Resolve its write behavior or use unknown effects. |
| Rewrite rule | Rule replaces or adds SQL statements | Analyze the rewritten behavior, not merely the handler's syntax. |
| UPSERT / MERGE | Conflict takes an UPDATE path; multiple action types fire triggers | Generate conflict and non-conflict paths, trigger combinations, zero matches, and competing writers. |
| Data-modifying CTE | One statement moves rows with DELETE RETURNING and INSERT | Do not assume textual execution order or that sibling reads see sibling writes. |
| SQL/PL function or procedure | A function writes hidden tables; dynamic SQL chooses a relation | Imported names and catalog dependencies alone are not a complete effect proof. Unknown bodies remain unknown. |
| Partition movement / inheritance | UPDATE moves a row into another partition | Logical and physical relation identity differ. Trigger effects can differ by destination partition. |
| Bulk and whole-relation operations | COPY, multi-row UPDATE, TRUNCATE CASCADE | Row-count and trigger semantics differ. Generate empty/many-row inputs and relation-wide invalidation. |
| Multiple handler transactions | First statement commits, second throws; procedure commits internally | Handler rejection does not imply rollback. Reconcile actual state and preserve the error. |
| Savepoint / caught exception | Roll back part of the work, then continue | The effect set includes only surviving writes; a conservative superset remains safe. |
| Sequence state | nextval consumed before conflict or rollback | Row rollback does not rewind sequences. Do not assert gapless IDs or equate sequence state with table snapshots. |
| RLS / role / tenant changes | Membership policy reads a roles table that a mutation changes | A query can change while its visible base table is untouched. Re-run authorization and policy-dependent reads. |
| SECURITY DEFINER / search_path | Function sees or writes objects under another role/name resolution | Bind object identity and security context before deriving effects. Never trust the client to choose that context. |
| Session state and temporary objects | SET LOCAL changes a function's result; pooled sessions differ | Read semantics depend on more than table contents. Require a declared stable execution context or exclude optimization. |
| Time/random/volatile reads | A SELECT calls a writing function, nextval, or random | Retry and read batching can change behavior. Side-effecting reads are outside automatic retry/batching until an explicit contract exists. |
| Materialized views / caches | Base write leaves a materialized view stale until REFRESH | Refetching the materialized view does not update it. State exactly which stored authority the endpoint promises. |
| DDL / event triggers | ALTER/DROP changes schemas, policies, trigger bodies or dependencies | Invalidate compiled capability proofs and registry versions; a row refresh cannot repair an invalid schema contract. |
| Awaited external API | API commits to PG before returning, then the handler returns | Fresh reads may cover it only if the API promises that completion and the reader can see that authority. |
| Delayed API / worker / outbox | Handler enqueues a job; job commits after the response | Requires a later invalidation signal, polling, or explicit refresh. Mutation settlement cannot certify future writes. |
| NOTIFY and listeners | Commit emits a notification; listener later performs another write | Notification delivery is not completion of listener work. Use it as a signal with a fresh read and a recovery strategy. |
| FDW / remote database | A function writes through postgres_fdw | Local commit and visibility assumptions cannot be generalized to every remote authority. Require an adapter contract and real multi-server tests. |
| Replicas / independent writers | Refetch reaches lagging replica; another actor commits mid-read | A fresh HTTP request is not a freshness proof. Need visibility guarantees, snapshot coordination or later repair. |
| External irreversible effects | Charge, email, object-store write, network callback | PG reconciliation does not undo these. Do not retry mutations merely because authority reads failed. |

Trigger behavior, cascades, and partition movement: [trigger overview](https://www.postgresql.org/docs/18/trigger-definition.html). Transition tables, constraint timing and column-specific invocation: [CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html). FK actions and rejection rules: [constraints](https://www.postgresql.org/docs/18/ddl-constraints.html).

Generated values: [generated columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html). Rewritten writes: [rules](https://www.postgresql.org/docs/18/rules-update.html). CTE execution: [WITH](https://www.postgresql.org/docs/18/queries-with.html). Whole-relation effects: [TRUNCATE](https://www.postgresql.org/docs/18/sql-truncate.html). Partition UPDATE behavior: [UPDATE](https://www.postgresql.org/docs/18/sql-update.html).

Hidden function dependencies: [dependency tracking](https://www.postgresql.org/docs/18/ddl-depend.html). Read purity and snapshot behavior: [volatility](https://www.postgresql.org/docs/18/xfunc-volatility.html). Security context: [CREATE FUNCTION](https://www.postgresql.org/docs/18/sql-createfunction.html), [row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html). Procedure commit and exception boundaries: [transaction management](https://www.postgresql.org/docs/18/plpgsql-transactions.html). Non-rollback sequence state: [sequence functions](https://www.postgresql.org/docs/18/functions-sequence.html).

Delayed signals: [NOTIFY](https://www.postgresql.org/docs/18/sql-notify.html). Remote authority: [postgres_fdw](https://www.postgresql.org/docs/18/postgres-fdw.html). Read snapshots: [transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html). Stored view freshness: [materialized views](https://www.postgresql.org/docs/18/rules-materializedviews.html). Schema events: [event triggers](https://www.postgresql.org/docs/18/event-triggers.html). External API/worker policies in this catalog are design deductions, not PostgreSQL guarantees.

## Generator dimensions and evidence

Cross effect families with zero/one/many changed rows; direct and transitive recipients; query entry/exit; scopes; success, suppression, rejection, partial commit; transaction timing; concurrent delivery order; retained and GCed collections; and single/multiple server authorities. Report execution, optimistic propagation, affected-set proof, patching and refresh separately. A fixture that merely declares a trigger is not an executed trigger witness.

The initial effect campaign adds six executable families: BEFORE rewrite, suppression, rejection, AFTER fanout, transition-table UPDATE, and an initially deferred constraint trigger. It keeps client optimism unchanged and compares confirmed collections with an independent SQL model. Controlled writes originate on one row; transition-table behavior for bulk/zero-row statements remains untested. Deferred effects currently use an implicit single-statement transaction, not a multi-statement commit barrier. Generated cases disable extra handler cross-writes so they do not silently claim recursive trigger coverage.

The delayed-write control waits until a mutation settles, commits a separate write, proves the client still holds the previous snapshot without a signal, and then explicitly refetches to repair it. This is a boundary witness, not an implemented push channel or a real external-API integration.

## Consequences for joins and combined reads

For a many-to-one join, child ID can identify a result only if the parent key is unique. Parent changes can affect many child results; an inner join can admit rows the client has never received. A joined result alone therefore does not prove enough source coverage to calculate every optimistic insertion. Initial join experiments must state whether both complete input relations are available and must not turn that experimental assumption into an endpoint requirement without a design decision.

Combining several pure SELECTs into one SQL statement can give them one statement snapshot. It does not automatically share scans, reduce result bytes, or expose writes from a data-modifying sibling CTE. Compare separate post-commit reads with a combined **read-only** statement; preserve independent query ordering, empty results, authorization, typed decoding and result identity. Reject side-effecting/locking/context-sensitive reads from that optimization until their semantics are specified.

Cross-module and unimported-definition registry tests now exist, including parameterized collections and overlapping mutations. Keep those laws when adding affected-set pruning: even perfect SQL dependency analysis is insufficient if the mutation handler cannot execute a selected query.
