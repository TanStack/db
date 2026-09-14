# SQL-effect compiler integration

The endpoint compiler now uses the SQL-effect analyzer. Kitchen's port passes with selective refresh for all eight queries and ten mutations. Unsupported analysis still sends full results; no runtime catalog inspection or compiler-generated auth was added.

## Compiler changes

- Build artifacts use format 2 and contain the facts needed for SQL routine, default, index and foreign-key analysis. Missing or old artifacts yield unknown dependencies. The build CLI obtains the facts in one catalog statement; request code receives only dependency identities.
- Direct Drizzle statements, discovered helper statements and inline transaction statements feed one relation/event worklist. Update assignments retain database column names. Reused builders union their assignments, including both orders of a foreign-key and ordinary-column update.
- Literal SQL templates passed to ``db.execute(sql`…`)`` reach the SQL parser. Primitive literals and fields from the admitted primitive input schemas become parameters. Dynamic SQL fragments, arbitrary interpolated objects and unresolved receivers fall back. Static SQL-function bodies can supply hidden reads and writes.
- Insert defaults are included when a runtime value might be undefined. Native enums do not make an entire table unknown. Built-in clock and UUID functions have no table-write effect, while queries whose values vary independently retain an unknown read result. The contracts use PostgreSQL's [enum implementation](https://www.postgresql.org/docs/17/catalog-pg-enum.html), [time functions](https://www.postgresql.org/docs/17/functions-datetime.html), and [UUID function](https://www.postgresql.org/docs/17/functions-uuid.html); application functions with those names do not inherit a built-in contract.
- Unsupported procedural triggers still force fallback for the matching write event. A trigger on UPDATE does not make DELETE or ordinary SELECT unknown. FK propagation uses the event and potentially changed columns.

The closed Drizzle expression grammar is still bounded. This is not general JavaScript effect analysis, arbitrary SQL-template construction, complete PostgreSQL overload resolution or full SQL support. `INSERT ... DEFAULT VALUES` remains an unsupported textual parser form in the current parser, although Drizzle's analyzed insert events account for potentially selected defaults.

## Red/green and application evidence

The expanded compiler oracle first rejected the old integration because a pure SQL function in an expression index refreshed three collections instead of one. The new path passes that same case. An injected omission of SQL-function bodies causes stale collection data; its saved case reproduces the same violation and passes without the omission.

The final generated compiler campaign uses 20 scenarios × three histories, plus fixed controls: **274 operations**, with no cleanup errors. It checks immediate optimism, independently queried settled values, exact read obligations and absence of request-time catalog queries. Generated dimensions include SQL-function reads/writes, native defaults, expression indexes, helpers, inline transactions, trigger fallback and FK effects. The separate browser campaign passes **nine operations, 13 result reads and 14 skipped reads**, with client-artifact server-code checks.

**90 contract tests and typecheck pass.** The tests also caught a mistake introduced during this integration: assigning column metadata on a reused builder overwrote earlier assignments. A focused compiler-aliasing control fails before the union repair and passes afterward. This tests a static binding boundary rather than claiming a new generated runtime history for primary-key renaming. The browser fixture also needed to copy the newly imported analyzer module before its build could run; that setup failure is not a semantic oracle kill.

Kitchen's actual compiled handlers pass **88 collection comparisons** and exact affected-collection counts. Ordinary edits refresh one of eight collections; ingredient/tag creation refreshes three; recipe creation/deletion refreshes four; ingredient deletion refreshes two. All 18 endpoint declarations have known SQL dependencies. Diagnostics explicitly preserve the calls outside SQL analysis, including auth, AI and Trello helpers.

The real-session Kitchen browser test passes **232 comparisons**, including rollback, overlapping writes, cascade deletion and anonymous rejection. Its production build and typecheck pass. All **34 client JavaScript files** exclude the checked database, secret, external-service and analyzer/registry markers. These checks used the disposable database on port 55480. Live AI/Trello effects and deployment remain untested. The application still links the local prototype rather than a published Endpoints package.

Receipts are in [effect-compiler-integration](evidence/effect-compiler-integration/manifest.json); Kitchen also keeps the application receipts in its migration worktree. Each run records its own source state. Older receipts are retained as historical evidence, not relabeled as byte-identical final runs.

## Broader PostgreSQL input generation

We examined [SQLsmith](https://github.com/anse1/sqlsmith), [SQLancer](https://github.com/sqlancer/sqlancer), and [waxsql](https://github.com/pgexperts/waxsql). The first pilot uses pinned **waxsql 1.0.0** as an external typed input generator. It supplies schemas, data and queries without importing the Endpoints analyzer. It is a candidate input source, not an assertion that one generator covers PostgreSQL.

The retained pilot contains **12 schemas × 12 queries = 144 queries**, with complexity levels 1, 3, 5, 8, 12 and 20. PostgreSQL planned **142**. The analyzer admitted **39** and returned unknown for **103**. A partial oracle verifies that admitted dependencies include relations visible in PostgreSQL's verbose plan. Removing a planned relation fails that law, reproduces on replay and passes without the fault.

The input pipeline also exposed **six cyclic-FK data-generation failures** and **two planning-time division-by-zero errors**. They remain explicit in the report. Data-generation failure does not hide a schema's queries from the planning survey; those cases are marked as lacking loaded data. The report's `generationClean` is false. Its passing oracle outcome means only the named plan-dependency law passed for admitted, successfully planned queries.

This pilot does **not** run arbitrary generated queries through browser collections, compare their values after mutations, shrink their SQL ASTs, or establish exact dependencies. A query plan can omit a dependency through pruning; absence from the plan is not a skip proof. The current full-stack campaigns remain the authority for their admitted histories. The next expansion should connect a validated, populated external corpus to those campaigns and add mutation generation and structural shrinking, while preserving generation failures as their own outcome.

To reproduce from this directory, install the pinned generator in a temporary Python environment using [pg-corpus-requirements.txt](tests/oracles/pg-corpus-requirements.txt), then run:

```sh
python tests/oracles/generate-pg-corpus.py --schemas 12 --queries 12 --seed 20260914 --output /tmp/pg-corpus.json
# Requires the isolated endpoints_generated database at 127.0.0.1:55480
# and this prototype's Homebrew psql path.
node tests/oracles/pg-corpus.mjs /tmp/pg-corpus.json
ENDPOINT_ORACLE_TEST_FAULT=omit-plan-relation node tests/oracles/pg-corpus.mjs /tmp/pg-corpus.json
node tests/oracles/pg-corpus.mjs --replay evidence/effect-compiler-integration/pg-corpus-red/replay.json
```

The corpus retains generator source hashes, schema/query seeds and raw inputs. [Broad-input receipts](evidence/effect-compiler-integration/manifest.json) preserve the partial-oracle controls and the generation failures. None of the documented auth, subset, external-freshness or PostgreSQL-grammar deferrals is silently promoted to supported behavior here.
