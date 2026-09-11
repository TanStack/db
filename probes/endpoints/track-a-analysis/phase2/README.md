# Phase 2: shared SQL checking and actual diagnostic CLI

Seven semantic tests now pass after all seven failed against the preserved phase 1 baseline adapter. Four CLI/source-edit tests pass. Raw SQL and recognized Drizzle source now enter **the same SQL checker**. The original phase 1 report and results remain unchanged.

## Reproduce

Use phase 1's pinned install. From the worktree root:

```sh
# Expected exit 1: seven meaningful baseline failures.
PHASE2_BASELINE=1 node --test probes/endpoints/track-a-analysis/phase2/checker.test.mjs
# Expected exit 0: seven passing semantic tests.
node --test probes/endpoints/track-a-analysis/phase2/checker.test.mjs
# Expected exit 0: four passing CLI/edit tests.
node --test probes/endpoints/track-a-analysis/phase2/cli.test.mjs
```

`red-baseline.mjs` wraps the old phase 1 checker, which did not inspect selected-column SQL types/nullability and had no raw SQL adapter. `red-output.txt` captures actual assertion failures, not missing modules. The initial CLI test run (`cli-red-output.txt`) failed because the CLI did not exist; that is a missing capability test, **not** equivalent evidence of a semantic bug. The extra SQL comment placement test was added as a passing discriminator after implementation.

Versions unchanged: direct Node v22.13.1, Drizzle 0.45.1, PGlite 0.3.14 / embedded PostgreSQL 17.5, Babel parser 7.28.5, pgsql-ast-parser 12.0.1. No new packages, host service access, credentials or shared configuration.

## Results

| Gap and test | Baseline | Current result |
| --- | --- | --- |
| Selected column changes text → integer with same valid PK | Incorrectly supported | PASS: `SCHEMA_MISMATCH`, including actual ALTER TABLE and re-read catalog |
| Selected column becomes nullable | Incorrectly supported | PASS: `SCHEMA_MISMATCH` |
| Raw SQL and Drizzle SQL share checker and execute equal ordered rows | Raw SQL unavailable | PASS: identical semantic output and a,b PostgreSQL rows |
| Both SQL inputs report missing tie-breaker | Raw SQL unavailable | PASS: identical `ENDPOINT_ORDER_NOT_TOTAL` |
| SQL-side joins, projection aliases, expression order, OR predicate, missing key | Raw SQL unavailable | PASS: unsupported grammar or missing result key; no source adapter can bypass these checks |
| Missing schema identity, wrong parameter count/type | Not validated | PASS: explicit not checked |
| CLI violation → apply → supported/empty diagnostics | Missing CLI | PASS for both adapters |
| Source hash changed before repair | Missing CLI | PASS: `STALE_DIAGNOSTIC`, no write |
| Moved source prefix and decoy ORDER BY comments | Missing CLI | PASS: location follows AST; raw SQL insertion precedes the real statement semicolon and preserves both comments |
| Unsupported source versus cleared diagnosis | Missing CLI | PASS: exit 2 plus nonempty diagnostic, not supported/clear |

Captures: `semantic-results.json`, `green-output.txt`, `cli-green-output.txt`, `drizzle-delivery-results.json`, `sql-delivery-results.json`. Test runner status determines suite success; per-case captures are not a substitute. Baseline reruns write `baseline-results.json`, leaving successful semantic evidence intact.

## Boundaries and correspondence

`adapters.mjs` alone handles source syntax and mapping. The Drizzle adapter uses the phase 1 strict trusted-fixture recognizer, then constructs SQL with Drizzle; it does not import the authored file or execute the handler. The raw adapter sends SQL text directly and uses the SQL parser's token locations for edit placement. Both supply one text parameter and call `checkSql(input, context)` in `checker.mjs`. That checker never reads source text or source ranges.

`context.mjs` derives expected column names, SQL types and nullability from the same trusted Drizzle table object used by the Drizzle adapter. It normalizes only the fixture's known `timestamp` spelling to PostgreSQL's `timestamp without time zone`. Raw SQL uses this same explicitly supplied schema contract; no claim is made that raw SQL inherently carries an authored schema. Catalog observations come from a fresh, disposable PGlite table created from fixture DDL. The checker compares all five fixture column facts and requires a declared fixture schema identity, then checks valid unconditional non-null single-column index evidence.

This closes the demonstrated key-only false green for column types/nullability **within this fixture contract**. It does not resolve arbitrary project imports, schema defaults, collation/operator-class semantics, generated expressions, RLS, triggers, schema deployment identity, migration freshness or concurrent DDL. The identity label names the local fixture; requiring a label is not proof of deployment correspondence. Catalog indexes are observed but a persistent index-freshness lifecycle is not implemented.

The SQL grammar intentionally remains narrow: one unaliased todo table, direct unaliased column projection, `user_id = $1`, one text parameter, ascending `created_at`/`id`. Joins, limits, aliases, aggregate/expression columns, other predicates, unsupported clauses and multiple statements are not checked. Total order means SQL result order only; no wire, UI, auth or ID-immutability guarantee follows.

The checker does not use host advisors. The new host survey distinguishes catalog lints, SQL-text hypothetical-index advice, PL/pgSQL routine checking and workload telemetry. They cannot substitute for this result-key/order proof merely because all are called database checks. None of those host tools was run in this phase.

## CLI contract for Track C

```sh
node /ABS/track-a-analysis/phase2/cli.mjs check --adapter drizzle --file /ABS/copied-todo.ts
node /ABS/track-a-analysis/phase2/cli.mjs check --adapter sql --file /ABS/copied-todo.sql
node /ABS/track-a-analysis/phase2/cli.mjs apply --file /ABS/copied-todo.ts --diagnostic /ABS/previous-report.json
```

Check emits one JSON object, protocol `endpoints-probe/v1`, with:

- `status`: supported, violation or not checked. Exit codes: 0, 1, 2 respectively. Transport/setup errors use status error and exit 2.
- `source`: absolute file URI and SHA-256 of the checked source.
- `diagnostics`: complete current set; empty only for a supported result. Each diagnostic has code, message and 0-based LSP-style UTF-16 range. A repairable order violation also has absolute UTF-16 string offsets and `sourceHash` in `edit`.
- `rerun`: argv array with absolute Node executable, CLI file and source file. No working-directory guess is required.
- `check`: semantic result and schema/index evidence when available.
- `assumptions` and `versions`: explicit local fixture limits and observed runtime/database version.

Apply validates file URI and source hashes, validates edit bounds, then writes the caller-owned source. It emits `applied` with the new hash or `STALE_DIAGNOSTIC` with exit 2. Rerun is required to establish the repaired result. Track C owns its copied delivery fixture; Track A did not edit it.

The JSON producer supports full-set replacement but does not itself deliver notifications, bind LSP document versions, clear an editor or wake a model. Track C tests those boundaries separately. No combined Start/DB Todo integration is claimed.
