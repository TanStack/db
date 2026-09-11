# Track A: bounded handler, Drizzle and PostgreSQL probe

The simple fixture supports a source-located order repair. Eight tests pass. This is a disposable analysis experiment, not the integrated Endpoints Todo or a general JavaScript analyzer.

## Run and versions

From the repository worktree:

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix probes/endpoints/track-a-analysis
node --test probes/endpoints/track-a-analysis/probe.test.mjs
```

`npm test --prefix probes/endpoints/track-a-analysis` also works. On this host npm's script PATH resolves Node v24.5.0, whereas direct `node` resolves v22.13.1; both passed. The captured `test-output.txt` uses direct Node. `results.json` records the actual runtime. npm 11.11.0; pnpm 11.1.0 was inventoried but not used. Install initially stalled under restricted network; scoped npm installation outside the sandbox completed. No credentials or external database were used.

Pinned by package-lock.json: Drizzle ORM 0.45.1, PGlite 0.3.14, Babel parser 7.28.5, pgsql-ast-parser 12.0.1. PGlite reports PostgreSQL 17.5 compiled with Emscripten 3.1.74. It runs real embedded PostgreSQL catalog queries and SQL in memory; this is not a connection to a deployed server.

Repository baseline: `68366ecaeef6c12a13402b558bd4a68d7519442f`. Workspace: `/Users/kylemathews/.codex/worktrees/e079/tanstack-db`. The historical checkout in the handoff was not edited. Only this probe directory is owned by Track A.

## Test results

| Obligation | Result | Evidence / limit |
| --- | --- | --- |
| Fields, predicate, params and SQL | PASS | Four selected fields, user equality and `$1`/`['u']` checked against exact SQL; actual PG execution returns only a,b |
| Source location and order repair | PASS | `fixtures/todo.ts:11:8`; createdAt alone violates rule; append `, asc(todo.id)`; reparsing, SQL rebuilding and PG execution pass with a,b order |
| Stale edit refusal | PASS | SHA-256 mismatch rejects even an appended newline |
| Join duplication | PASS negative | Actual join returns a,a; AST extraction says unsupported innerJoin |
| Nullable uniqueness | PASS negative | Actual UNIQUE accepts NULL,NULL; catalog key classifier says nullable key |
| Partial uniqueness | PASS negative | Partial UNIQUE accepts a,a outside active predicate; classifier says predicate not established |
| Returned key omitted | PASS negative | Valid table PK cannot certify projection without id |
| Source/deployed key drift | PASS negative | Drop todo PK in same disposable database; unchanged source no longer supported |
| Helpers, branches, response map, operator/binding changes | PASS negative | Explicit not-checked reasons; changed predicate and descending order also rejected |
| Arbitrary handler, full schema/deployment matching, UI order, integrated Todo | NOT TESTED | Not established by this fixture suite |

`results.json` contains successful per-case assertions, exact SQL/params, row witnesses, schema metadata, catalog index definition, source spans/hash, diagnostic and edit. Whole-suite status is the runner exit status and `test-output.txt`; the JSON writer does not claim whole-suite success if another test fails. `TEST-PLAN.md` preceded implementation. Initial execution failed on missing dependencies, not a semantic red test; all implemented behavior tests then passed. No claim of test-driven bug repair is made.

## What actually connects to what

1. Babel parses the authored fixture without importing or executing it. The recognizer accepts only the declared trusted fixture imports, one query with a three-statement async handler, direct auth binding, a single table, explicit selected columns, the exact user equality predicate, ascending createdAt/id terms, and direct `res.json(todos)`. It records authored spans, not generated SQL offsets.
2. The probe lowers those recognized facts into a fresh Drizzle QueryBuilder using its own known schema and a supplied test user ID. Drizzle `.toSQL()` exports that separately constructed query. This is **not** obtaining a query object from executing the original handler. The auth function, endpoint API and response serializer are fixture assumptions; their implementations do not exist here.
3. Drizzle `getTableConfig` records the trusted schema object's column names, primary flags and nullability. PGlite creates a manually matching DDL fixture. Catalog inspection checks table name and id's non-null, valid, ready, unconditional, non-expression, single-column unique index evidence. It does not compare all selected-column types, full schema fingerprints, migration identity or deployment identity. A PG primary key also does not establish ID immutability across updates.
4. pgsql-ast-parser independently parses the generated SQL, checking a single SELECT. It supplies no schema-derived proof. The narrow source grammar excludes joins/aggregates/transforms before the key rule uses base-table evidence.
5. The order diagnostic refers back to the source orderBy span. A SHA-256 guard prevents applying the edit to a changed source revision. The repaired fixture is reparsed and rebuilt, and its SQL executes with the tested tie-breaker. No SQL-to-source inverse mapping is needed for this restricted append operation.

The key classifier deliberately rejects nullable/partial indexes even when some stronger predicate reasoning could make them safe. Those negative fixtures call the same classifier used by the Todo check, with their own matching table catalog rows; they are not rejected merely because their table names differ from Todo.

## Approaches actually tried

| Approach | Observed capability | Wrapping and boundary |
| --- | --- | --- |
| Drizzle standalone QueryBuilder + toSQL | Exact parameterized export; no database needed | A builder must already exist; cannot discover opaque handlers |
| Drizzle getTableConfig | Authored column/PK/nullability metadata | Trusted schema object only; not deployed truth |
| Babel source parsing + narrow recognizer | Handler facts and source-preserving append repair | Custom grammar checks; fixture import contract, no project symbol/type resolver |
| pgsql-ast-parser | Parses generated SELECT | JS SQL parser, not libpg_query or PG semantic analyzer; only this emitted grammar tested |
| PGlite PG catalog + query execution | Constraint facts and concrete counterexamples | Embedded PG 17.5 only; no deployed-server permissions/freshness tests |

Rejected as sufficient on their own: builder export cannot establish handler coverage; parser syntax cannot prove result uniqueness; unique index presence cannot establish non-null/conditional/result-level uniqueness; one executed dynamic branch cannot certify all branches. SafeQL, PgTyped, sqlc and libpg_query were not installed or executed; survey descriptions are not measured comparisons.

## Remaining integration decisions

The next combined experiment needs an explicit authoring/symbol-resolution contract, a source-schema binding shared with compilation, a chosen deployment/schema freshness policy, and a public response/serialization contract. The diagnostic should gain endpoint identity, URI and dependency versions when connected to Track B/C. This probe establishes SQL total order for a restricted result, not visible collection/UI order. No Start transform, runtime collection, optimistic action, wire response, auth guarantee or agent delivery ran in this track.
