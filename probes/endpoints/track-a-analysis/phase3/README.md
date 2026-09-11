# Phase 3: analyze the integrated Todo source

The source adapter now accepts the actual integrated Todo's full TSX module while checking only `listTodos`. The SQL checker from phase 2 remains unchanged. Four adapter tests, four evidence tests and one CLI contract test pass. Running-app correspondence evidence is recorded separately from these fixture tests.

## Reproduce the bounded tests

From the repository root, with the pinned Track A dependencies installed:

```sh
PHASE3_BASELINE=1 node --test probes/endpoints/track-a-analysis/phase3/adapter.test.mjs
PHASE3_BASELINE=1 node --test probes/endpoints/track-a-analysis/phase3/evidence.test.mjs
node --test probes/endpoints/track-a-analysis/phase3/adapter.test.mjs
node --test probes/endpoints/track-a-analysis/phase3/evidence.test.mjs
node --test probes/endpoints/track-a-analysis/phase3/cli.test.mjs
```

Both baseline commands are expected to fail. The first retains phase 2's adapter: full TSX fails its parser/grammar. The second creates a separate disposable database instead of checking the supplied running-app receipt, so all four provenance assertions fail. These are distinct failure classes. The passing CLI test uses an explicitly **synthetic snapshot**, not a running app.

Versions remain Node v22.13.1, Drizzle 0.45.1, PGlite 0.3.14, Babel parser 7.28.5 and pgsql-ast-parser 12.0.1. No dependency/configuration changes were made outside this phase3 directory. Phase 1/2 files and evidence were preserved.

## Supported source and tests

`adapter.mjs` parses TSX, selects the named `listTodos` variable, checks exact imported query/db/table/auth/operator/zod bindings against a declared contract, and requires `query({ input:z.object({}), async handler(req,res){...} })`. It isolates the handler without evaluating the module and reuses the earlier narrow recognizer. It translates recognized spans back to the original source offsets.

This permits sibling mutation declarations, their `onMutate` callback and the React component to coexist in the authored module. It does **not** check their effects, validate the optimistic lifecycle, certify module side effects, or infer arbitrary helper behavior. Computed/spread options, imported operator changes and response transforms remain not checked.

The fixture includes orderBy decoys in a comment, sibling mutation and JSX attribute. Tests prove the repair changes the actual query order only, preserves the entire mutation/UI suffix, reparses and clears the SQL order violation. `integrated-source-adapter.json` records a separate parse of the actual app source, including exact handler/field/predicate/response source spans and SQL/parameters; it alone is not runtime evidence.

## Schema and running-source evidence

`make-contract.mjs` binds this reviewed specimen to the known five-column schema and SHA-256 hashes of its schema, runtime and compiler files. It reads those files; it does not evaluate arbitrary app modules or claim to discover arbitrary schemas. The schema contract is explicitly the shared disposable Todo schema. Default expressions, auth, RLS, triggers, deployment identity and live migration freshness remain outside the checker.

`evidence.mjs` consumes a snapshot from the actual app's `/probe-control` endpoint. It requires:

- Local database instance ID, capture time and PostgreSQL version.
- A compiler-supplied original endpoint source hash matching the current file.
- Runtime Drizzle schema facts matching the declared column contract, and actual PostgreSQL column/index observations.
- Current schema/runtime/compiler file hashes matching declared dependencies.

The CLI additionally compares its exact lowered SQL and parameter values with the handler's logged query. It reports `RUNTIME_QUERY_MISMATCH` if the trace is missing or differs. It never creates a replacement database to satisfy the integrated check.

The snapshot is caller-captured evidence from a local test process, not remote attestation. The compiler's source receipt, schema snapshot and query log establish a bounded local correspondence. They do not prove an arbitrary deployment or eliminate every concurrent-change race. After repairing the source, the old snapshot must fail `STALE_RUNTIME_SOURCE` until the app rebuilds, executes the new list query and supplies a fresh snapshot. Updating only the source receipt while retaining an old query fails the independent SQL comparison.

## CLI for the full repair loop

```sh
node /ABS/phase3/make-contract.mjs /ABS/integrated-todo /ABS/contract.json
node /ABS/phase3/cli.mjs check --file /ABS/integrated-todo/src/endpoint.tsx --contract /ABS/contract.json --snapshot /ABS/snapshot.json
node /ABS/phase3/cli.mjs apply --file /ABS/integrated-todo/src/endpoint.tsx --diagnostic /ABS/diagnostic.json
```

After apply: wait for rebuild, execute listTodos, capture a new `/probe-control` snapshot, then run the supplied absolute `rerun` argv. Rebuilding also requires updating the binding contract if a hashed dependency changed; regenerating a contract is an explicit trust operation for the reviewed local files, not evidence that arbitrary changes remain correct.

Protocol `endpoints-probe/v2` retains full-set diagnostics, absolute file URI/hash, 0-based UTF-16 source ranges and hash-guarded absolute edit offsets. It adds endpoint identity, runtime comparison, source correspondence and snapshot provenance. Exit 0 means supported/clear, 1 means an order violation, and 2 means not checked or tool error. Unsupported/stale evidence is never represented as an empty successful result.

Track A initially owned no integrated app files. The coordinator then explicitly extended ownership to the query order only for the live repair exercise below. Runtime, compilation, app behavior and collection lifecycle remain the integrated Todo worker's scope.

## Actual local app receipt

`integrated-snapshot.json` was captured by a read-only GET to `http://127.0.0.1:4191/probe-control` after the real browser list query ran. It reports database instance `dfb3fd8e-198e-46a3-b842-96065167e7a6`, PostgreSQL 17.5, actual expected/observed schema and index evidence, and the executed query for `alice`.

`integrated-check.json` records **supported**, `SQL_KEY_ORDER_SUPPORTED`, and an exact SQL/parameter match. The compiler-reported source hash and current file hash are both `a315c86b2f55d546909b414e17ba9144c6a1aba1130a72039943653a11fc33a4`. This is a real app-source → generated handler receipt → logged SQL → actual app PostgreSQL schema → shared checker path, bounded by the stated local specimen assumptions. That first capture already included `createdAt,id`; the separately authorized live repair exercise below then tested the bad and repaired actual app revisions.

A real concurrent dependency edit was detected during this capture: the runtime file changed between contract creation and the first check. `integrated-stale-dependency.json` records `STALE_DEPENDENCY`; `stale-integration-contract.json` preserves the old hash. Regenerating the reviewed binding contract produced the successful check. These receipts describe their capture revisions; future file changes should invalidate them.

For a fresh local capture (only while that app process is running):

```sh
curl --fail --silent http://127.0.0.1:4191/probe-control --output /ABS/new-snapshot.json
```

The initial snapshot capture performed no POST, reset, source edit or app mutation. The later explicitly authorized exercise edited only query order. Localhost/browser access required scoped sandbox escalation; no credentials were used.

## Actual app source → agent repair → live clear: PASS

The coordinator authorized a live exercise and the Todo worker froze source/runtime/compiler during it. `live-repair.mjs` changed only listTodos' order, launched a separate Chrome 152.0.7977.83 client and used actual collection preload plus read-only GET snapshots. It performed no control POST, reset or mutation.

1. Removed the authored `id` tie-breaker. The browser executed the changed handler; its original-source receipt and SQL trace matched the bad file. The shared checker emitted the actual source-located `ENDPOINT_ORDER_NOT_TOTAL` diagnostic (`live-diagnostic.json`).
2. Applied that diagnostic with the hash-guarded CLI. The same agent performed the repair using its known protocol; this was not a blinded fresh-agent test.
3. Rechecking the old snapshot failed `STALE_RUNTIME_SOURCE` (`live-stale-snapshot-check.json`). Merely editing source did not count as clearing the live issue.
4. Reloaded/preloaded the actual repaired app and captured a new database/source/query snapshot. The checker returned supported, empty diagnostics and exact runtime SQL/parameter match (`live-cleared.json`).
5. Restored the original argument whitespace, making the endpoint file byte-identical to its starting value. Reloaded/preloaded once more and captured a final supported check with the original source SHA-256 (`live-final-check.json`). The original bytes are preserved in `live-original-endpoint.tsx`.

`live-repair-results.json` records all executed Node argv, source hashes, instance receipts and step results. `live-repair-output.txt` records process success. Captured snapshots are `live-bad-snapshot.json`, `live-fixed-snapshot.json` and `live-final-snapshot.json`; compiler hot reload recreated the disposable database between some revisions, so instance IDs are retained rather than treating them as one persistent database. No claim of persistence across a server reload is made.

Rerun only while the local specimen is running and its worker has agreed to the same source freeze:

```sh
node probes/endpoints/track-a-analysis/phase3/live-repair.mjs
```

The script requires the known starting query spelling, changes only that occurrence, and restores the original endpoint bytes in `finally`, including on failure. Its success result requires a final actual running-app check after restoration. This completes the requested local source-located diagnostic/repair/rerun loop; it does not broaden the static analysis grammar or establish production deployment behavior.

## Final current frozen-runtime receipt

After the Todo worker's runtime cleanup fix and final dev browser tests, a separate read-only capture at `2026-09-10T20:20:00.562Z` passed against the final frozen files. Use `final-current-contract.json`, `final-current-snapshot.json` and `final-current-check.json` for this revision. Result: **supported**, `SQL_KEY_ORDER_SUPPORTED`, exact runtime query match, database instance `fb858858-c6ab-4c37-80fc-0e1173400d5c`, original endpoint hash `a315c86b2f55d546909b414e17ba9144c6a1aba1130a72039943653a11fc33a4`.

Historical `integrated-*` and `live-*` receipts remain unchanged; their dependency hashes intentionally refer to earlier runtime revisions. This final check concerns source/SQL/schema correspondence. The integrated Todo worker separately owns the cleanup, lifecycle and UI test results.
