# PowerSync Direct decoder admission and refusal evidence

Production reviewed: `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`.
Production remained unchanged throughout these runs. The pre-edit inventory was
recorded in `.review-2377/parse-pre-edit.md` before test edits. This report
records added portfolio coverage; it reports no newly found production defect.

## Law and authority

`docs/collections/powersync-direct-collection.md`, Creating Collections, promises
validation, boolean/Date conversion, and preserved ids. Its Error Handling
section promises stopped synchronization on parse failure. The glossary's
loading error and sync error laws distinguish pre-readiness failure from a
terminal error after readiness, when rows and ready status remain usable.
Whole-batch publication uses the accepted Collection publication contract.
The previous eager FID-1 receiver cast JSON unchanged and explicitly excluded
undecodable rows; the previous parse example covered only one live thrown row.

## Pre-edit receiving inventory

| Required path | Controlled premise | Public observation cut |
| --- | --- | --- |
| Direct adapter and real standalone SDK in Node 26 | NDJSON checkpoint with valid, throwing or changed-id row decoding | Exact public rows and every publication; initial-load outcome; status and health; stopped provider and resource release after SDK consumption. |
| Same production composition in actual Chromium | Same histories and judgment, delivered through browser fetch and Web Streams | The same initial-load, publication, health and cleanup cuts. This receiving witness ran before production edits. |

The inventory excluded arbitrary schema policy, remote-service behavior,
reload, mutation, on-demand loading and persistence from this family. Their
separate owners retain those obligations. The former eager owner supplies valid
FID-1 judgments but excludes undecodable rows, so refusal requires this separate
admission judgment.

## Paths, histories and observations

The real `@powersync/standalone-client` receives controlled NDJSON checkpoints.
The direct adapter and actual Collection execute decoding and application.
Generated histories vary initial/live phase, valid/throw/changed-id outcome,
1–4 rows, refusal position, same/fresh keys, native Date meaning and boolean
values. Initial/live × throw/changed-id × first/middle/last has distinct
constructed states; each builder keeps unconstrained generated coordinates.
A fixed live-middle-refusal history uses the same driver, model and judgment.

Before target delivery the driver records the coherent baseline. During target
delivery every subscribeChanges callback records the complete public rows. The
status-ready callback records native row values at the readiness notification.
After actual SDK consumption and its finite promise continuations, comparison
checks exact values and types, every publication, readiness settlement, status,
exact authored parse failure or normalized identity-refusal category, terminal
health, stopped provider, and actual resource releases. The direct receiver
separately declares table-listener/status-listener/stream-lease positive
witnesses. The shared release law permits a receiver with another resource shape.

The reference computes expected native value coordinates and keyed membership.
It does not call the parser, inspect SDK table state or copy admission branches.
Source encoding uses ISO strings and integer booleans; expectations use numeric
epochs and boolean application values.

## RED / GREEN / mutant

No production RED was found in this family. Both receiver paths are GREEN on
unchanged production. This is deliberately reported as neighboring coverage,
not as evidence of fixing a nonexistent source defect.

Commands (Node 26 directory prepended to PATH):

- From `packages/powersync-direct-collection`:
  `pnpm exec vitest run tests/decode-refusal-oracle.property.test.ts`
- From `packages/browser-db-sqlite-persistence`:
  `pnpm exec vitest run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-decode-oracle.browser.test.ts`

Each property runs 80 generated histories at fixed seed 2377 and 80 at a fresh
seed, plus 23 randomized constructions and the fixed history in each campaign.
Every declared state's minimum is one, enforced by its named builder and a
local WeakMap obligation for generated builder outputs. Every missing-state
control is explicitly bound to its builder. The final reach table records the
complete campaign totals. Local raw logs are `.review-2377/parse-green.log` and `.review-2377/parse-browser.log`.

Bound observation mutants are rejected by the same `decode admission` judgment:
wrong rows inside readiness; Date changed to string; a publication from a
refused batch; missing terminal health; one allocated but unreleased resource;
and a missing receiving-resource witness. These are assertion kills at the delivery observation, not timeout,
setup or runtime-error evidence. Every constructed-state omission is rejected
under `constructed builder reach`.

An initial browser invocation failed to bind its local server with EPERM. It
executed no histories and is a setup failure. The authorized rerun used the
required local Vite listener and actual Chromium.

## Oracle guide account

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Satisfied: the parse contract, Collection publication law, loading-error and sync-error authority, and bounded limits are stated above. |
| ORC-002 | Satisfied: expected native value coordinates and keyed membership do not read the parser or SDK state. |
| ORC-003 | Satisfied: shared model, grammar, production driver, comparison and receiving registrations explain their separate responsibilities beside executable code. |
| ORC-004 | Satisfied: the prior live parse-refusal witness is reconstructible; phase, outcome, position and overlap each supply the distinctions above. Bounds include singleton batches, both booleans and epoch zero. Modulo construction excludes invalid positions; the union excludes unknown outcomes. |
| ORC-005 | Satisfied: parser ids and resource allocations witness the SDK path; callbacks retain partial-output evidence, including the ready notification. No missing-source-information hypothesis was identified: the checkpoint reaches the parser before comparison. |
| ORC-006 | Satisfied: bound observation mutants fail the same delivery judgment. Missing-state mutants fail the construction judgment. All are assertion kills. |
| ORC-007 | Satisfied: fixed and fresh campaigns share model, grammar, driver, comparison and budget. Both exact property/seed/path/unit guarded replays below executed once. Command replay paths do not apply: there is no command grammar. |
| ORC-008 | No mutable reference state machine is introduced. Stateless recomputation retains phase because identical refusal must leave empty initial rows but retain already-ready rows after a valid initial load. |
| ORC-009 | Satisfied: `DecodeValue` is a model-only encoding of native public values; initial/live qualify delivery phase rather than introduce Collection status values. |
| ORC-010 | Satisfied: `withOracleCleanup` preserves primary and secondary diagnostics; captured values retain primitive meaning before cleanup. |
| ORC-011 | Conditional trigger not identified: no plausible shared semantic fault requiring another formulation was found. Parser output is compared with independent application coordinates. |
| ORC-012 | Satisfied for this bounded coverage claim: this versioned record records each requirement, observations, controls, replay execution, reach and limits. It claims no production bug repair. |
| ORC-013 | Satisfied: first/middle/last × phase/outcome constructions distinguish prefix publication, omitted id validation and incorrect post-ready status changes. The ready-value mutant distinguishes a wrong initial readiness observation. |
| ORC-014 | Satisfied within the controlled protocol boundary: Node and actual Chromium use the same family and production driver. A deployed PowerSync service is outside the claim. |
| ORC-015 | Satisfied: all 23 states have generated constructions, bound omission controls and separate obligations for generated builder outputs; every state meets minimum one in both hosts and campaigns. |
| ORC-016 | Satisfied: registrations use `oracleProperty` through the shared oracle suite. The fixed history shares its model, production driver and judgment; no ordinary examples or concrete expected answers were added to oracle files. |

## Review round 1

Fresh reviewer identified that a generic three-resource minimum imposed the
Direct receiver's resource shape on other adapters. Accepted and repaired:
required kinds are now an explicit direct receiving declaration; shared release
checks quantify over actual resources. A bound missing-witness control checks
that receiving premise independently. The author also added the exact public
row-value observation inside the ready notification before the final source
freeze. Full Node and Chromium campaigns passed after both refinements.
Production remained unchanged.

## Limits

No arbitrary schema, remote PowerSync deployment, on-demand parsing, reload,
persistence, mutation, nullable/custom application values or cross-framework
claim. The browser witness receives the same critical parse contract through
browser Web Streams; other supported hosts are unmeasured. Other task owners
cover eager lifecycle, reload, subsets, write confirmation and persisted startup.

## Final validation

- Node: 105/105 passed.
- Actual Chromium: 105/105 passed.
- Targeted ESLint: zero errors and warnings.
- Scoped TypeScript checking passed for the Node and browser decode registrations
  and their transitive sources.
- At this validation cut, full package TypeScript checking reported three errors
  in `browser-db-sqlite-persistence/src/wa-sqlite-driver.ts`: the persistence-core
  package declarations were not built. No decode/refusal errors remained. The
  local diagnostics are `.review-2377/parse-types.log`; the successful scoped
  check is `.review-2377/parse-scoped-types.log`.

Final campaign reach, summing generated and constructed units (fixed histories do not supply the required minimum):

| State | Node fixed | Node fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: |
| initial-changed-id | 14 | 23 | 14 | 24 |
| initial-changed-id-first | 7 | 12 | 7 | 14 |
| initial-changed-id-last | 5 | 10 | 5 | 9 |
| initial-changed-id-middle | 4 | 3 | 4 | 6 |
| initial-throw | 21 | 19 | 21 | 20 |
| initial-throw-first | 7 | 7 | 7 | 9 |
| initial-throw-last | 11 | 5 | 11 | 11 |
| initial-throw-middle | 6 | 7 | 6 | 3 |
| initial-valid | 8 | 10 | 8 | 7 |
| live-changed-id | 22 | 20 | 22 | 23 |
| live-changed-id-first | 10 | 8 | 10 | 7 |
| live-changed-id-last | 10 | 8 | 10 | 11 |
| live-changed-id-middle | 5 | 5 | 5 | 7 |
| live-fresh | 33 | 23 | 33 | 23 |
| live-overlap | 27 | 28 | 27 | 29 |
| live-throw | 26 | 20 | 26 | 14 |
| live-throw-first | 13 | 9 | 13 | 4 |
| live-throw-last | 9 | 12 | 9 | 5 |
| live-throw-middle | 7 | 2 | 7 | 7 |
| live-valid | 12 | 11 | 12 | 15 |
| refusal-first | 37 | 36 | 37 | 34 |
| refusal-last | 35 | 35 | 35 | 36 |
| refusal-middle | 22 | 17 | 22 | 23 |

## Checked direct replay evidence

Executed on the same frozen six-file SHA-256 snapshot recorded below, against unchanged production head
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. The guard checked the exact
property/seed/path witness and required nonzero execution, beyond test exit.

From `packages/powersync-direct-collection` (Node 26 on PATH):

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter-conformance.decode-refusal.powersync-direct TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' node --import tsx ../db/tests/oracle-replay.ts tests/decode-refusal-oracle.property.test.ts
```

Result: exit 0, one passed, 104 skipped; guard witness was property
`adapter-conformance.decode-refusal.powersync-direct`, seed 2377, path `0`,
`numRuns: 1`, `failed: false`, `executions: 1`, asynchronous witness mode.
The selected history reached live changed-id refusal at the last row with an
existing-key overlap. Local raw output: `.review-2377/parse-node-replay.log`.

From `packages/browser-db-sqlite-persistence` (Node 26 on PATH):

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter-conformance.decode-refusal.powersync-direct.chromium TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated' pnpm exec tsx ../db/tests/oracle-replay.ts --config vitest.adapter-oracles.config.ts e2e/powersync-direct-decode-oracle.browser.test.ts
```

Result: exit 0, one passed, 104 skipped; guard witness was property
`adapter-conformance.decode-refusal.powersync-direct.chromium`, seed 2377,
path `0`, `numRuns: 1`, `failed: false`, `executions: 1`, asynchronous
witness mode. It reached the same refusal shape through actual Chromium.
Local raw output: `.review-2377/parse-chromium-replay.log`.

The original Node attempt used the tsx CLI, whose IPC pipe was denied by the
sandbox before the guard started. Retrying with `node --import tsx` avoided
that unnecessary IPC server. The failed setup attempt supplies no replay
execution evidence. The Chromium guard used the already authorized local Vite
listener. No source edits were made for replay.

## Frozen source snapshot

These are the exact parse source files approved by the independent laws reviewer
and used for the full campaigns and guarded replays above. No source edits were
made while adding this review record. The six-entry manifest SHA-256 is
`fb2793559c5ecd042b343ee5a2b5ed274488529060af855ead5ecd3b05931270`.

```text
fd038f6260d75d478737ba608984d859d3483a05b7738bed562cab6e5f91dac0  packages/db-adapter-conformance/tests/decode-refusal-oracle.ts
abdf02a89381390d9fed97ccef88350d15c684aa1a7c2168bc13b29330123b87  packages/db-adapter-conformance/tests/decode-refusal-driver.ts
c74ca67b3e32b4ffab1c795a9731f6a3e5ff57eae5f68890d18ca360d0ea04e5  packages/db-adapter-conformance/tests/decode-refusal-oracle-suite.ts
9704616fb202c2bbdc8147e387f07b41d6b4387fb6f2c506003c73cd8867f535  packages/powersync-direct-collection/tests/decode-refusal-driver.ts
91ceb118bcaab0c3a1acf9508c2fce96b2c669438ca46b5fb71a4ea7b5509890  packages/powersync-direct-collection/tests/decode-refusal-oracle.property.test.ts
dcd9bd11bdd049ff0ad1a1dc80afa29c83ffede472e2828111a7280a6bf44a68  packages/browser-db-sqlite-persistence/e2e/powersync-direct-decode-oracle.browser.test.ts
```

Independent reviewer `oracle_diff_laws` approved this exact six-file amendment
after verifying the manifest, public contract, shared model, receiving driver,
registrations, calibrations and raw full/replay logs. The reviewer confirmed
207/207 Node and actual Chromium checks, all 47 per-mode states and one guarded
execution of each new middle-refusal replay. Production still had the original
`4caf…` / `73a8…` hashes. No required correction remained.


## Append-only amendment: on-demand parse receiving path

The preceding eager-only record and its source hashes remain historical. The
completeness audit identified a missing receiving path: the public parse
contract also applies to on-demand Collections. This amendment extends the same
independent model, history grammar, production driver and comparison. It adds no
persistence claim and changes no production source.

The pre-edit inventory was recorded in
`.review-2377/parse-ondemand-pre-edit.md` before amendment test edits. For the
entire pre-production gate, the restored original production files had these
SHA-256 values:

```text
4cafcd3e53977c30511a85e1482be2e0bda2ad75ab0788d1d49e71a8db78761f  packages/powersync-direct-collection/src/index.ts
73a8f7e6112f4d3192ce309c9f5bce8bb0f0eedb371ad4b755130dec13437495  packages/powersync-direct-collection/src/subsets.ts
```

### Authority and promised cuts

The direct adapter guide's parse contract applies to every synced row. Its
on-demand section promises that a query is ready after the requested streams
have synced. The glossary distinguishes Collection readiness from
initial-query readiness and distinguishes a loading error from a sync error.
The public error-handling guide says a ready query retains its status and rows
when its source has a sync problem; its health tree exposes the source problem.

An on-demand source becomes ready before an initial query's streams arrive.
The source-ready notification therefore legitimately contains no requested
rows. Parsing refusal while the initial query waits must leave the source
ready with the exact parse failure on source health. The initial query must
reject without a ready notification or partial publication. Its acquisition
rejection may have another cause, so the comparison does not force its rejection
to equal the source parse error. A previously ready query instead retains its
baseline rows and ready status on live refusal, while its source health node
retains the source parse cause.

| Required receiving path | Controlled premise | Compared public observations |
| --- | --- | --- |
| Node 26, real on-demand source and live-query Collections over the real standalone SDK | The actual query invokes `getSubscriptions` and obtains the rows stream; valid/throw/changed-id initial or live batches cross fetch and the SDK | Before stream delivery: source ready with no rows and query loading/pending. During delivery: every source and query publication. At readiness: separate source and query row snapshots. After SDK consumption: exact source/query rows, statuses, source preload and query settlement, query rejection presence, exact source parse health in both health trees, provider lifetime and resource releases. |
| Actual Chromium, same source/query composition and shared judgment | The same generated grammar crosses browser fetch and Web Streams | The same cuts; per-mode constructions prevent the Node receiver or eager receiver from supplying this path's reach. |
| Existing eager Node and Chromium receivers | The original grammar coordinates and laws remain available with eager mode | Every prior state and comparison is preserved, now qualified with the eager receiving mode. |

The grammar adds `mode: eager | on-demand`. Each previous 23-state reach
obligation now has one construction per receiving mode; a further state records
source-ready/query-pending, for 47 declared states. Every builder preserves
unconstrained generated coordinates and has a bound missing-state control.
The original 80-history run budget remains unchanged for both campaigns. A
fixed eager regression still uses the shared model, driver and comparison.
No new independent model or on-demand-stream-family edits were introduced.

### Original-production results and calibration

No production defect was found in the added receiving path. On the original
source hashes above, final full campaigns passed **207/207 Node** and
**207/207 actual Chromium**. Scoped TypeScript checking and targeted ESLint also
passed. Local raw logs are `.review-2377/parse-ondemand-node.log` and
`.review-2377/parse-ondemand-chromium.log`.

From `packages/powersync-direct-collection`, with Node 26 on PATH:

```sh
pnpm exec vitest run tests/decode-refusal-oracle.property.test.ts --coverage.enabled=false
```

From `packages/browser-db-sqlite-persistence`, with Node 26 on PATH:

```sh
pnpm exec vitest run --config vitest.adapter-oracles.config.ts e2e/powersync-direct-decode-oracle.browser.test.ts
```

The Node final rerun disables coverage output to avoid a shared report-directory
lock while independent review and guarded replay processes run. An earlier
concurrent invocation failed on that lock before executing histories; it is a
setup diagnostic, not a RED result. The complete earlier original-source Node
campaign also passed before the final prose comments were added. Both final
commands above ran the frozen amendment source recorded below.

Six additional bound observation mutants are rejected at the shared delivery
comparison: premature query readiness at the held-stream cut; wrong query
values inside its ready notification; an initial query refusal that fulfills;
a ready source incorrectly becoming a loading error; a query health tree that
loses its source parse cause; and a refused live batch that publishes through
the query. These are assertion kills. Original value, refusal, health, resource
and missing-reach controls remain present.

### Checked amendment replay

Both guarded replays select the new constructed initial-query middle-refusal
history. They ran on the exact amendment hashes below and on the original
production hashes above.

From `packages/powersync-direct-collection`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter-conformance.decode-refusal.powersync-direct TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated on-demand:initial-throw-middle' node --import tsx ../db/tests/oracle-replay.ts tests/decode-refusal-oracle.property.test.ts
```

From `packages/browser-db-sqlite-persistence`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=adapter-conformance.decode-refusal.powersync-direct.chromium TANSTACK_DB_ORACLE_SEED=2377 TANSTACK_DB_ORACLE_PATH=0 TANSTACK_DB_ORACLE_UNIT='random seed: generated on-demand:initial-throw-middle' node --import tsx ../db/tests/oracle-replay.ts --config vitest.adapter-oracles.config.ts e2e/powersync-direct-decode-oracle.browser.test.ts
```

Each guard exited 0 and recorded the exact requested property, seed 2377,
path `0`, `numRuns: 1`, `failed: false`, `executions: 1` in asynchronous witness
mode. Each Vitest child reported one passed and 206 skipped. The history reached
on-demand initial throw at the middle row and source-ready/query-pending.
Local raw logs are `.review-2377/parse-ondemand-node-replay.log` and
`.review-2377/parse-ondemand-chromium-replay.log`.

A first root-directory invocation selected no test file. The guard correctly
rejected its zero-execution result. The successful commands above used each
package directory. That failed setup supplies no product or replay evidence.

### Amendment oracle guide account

| Requirement | Amendment outcome |
| --- | --- |
| ORC-001 | The same public parse promise applies on-demand; separate source/query readiness and health authority is stated above. Limits still exclude persistence and arbitrary schemas. |
| ORC-002 | The independent native-coordinate and keyed-membership judgment is preserved. No SDK or query controller rule computes expectations. |
| ORC-003 | Prose beside the model and shared driver explains the source/query gate distinction, actual acquisition, readiness snapshots and publication cuts. |
| ORC-004 | The grammar reconstructs all prior eager histories and adds both receiving modes. Removing mode loses source-ready versus query-loading behavior; phase/outcome/position/overlap retain their earlier semantic roles. Each mode has singleton and multirow domains; invalid positions remain excluded by construction. |
| ORC-005 | Actual `getSubscriptions` calls, returned sync mode, SDK resources and public query outcomes witness the on-demand path. Source and query observations are recorded independently. |
| ORC-006 | All six new bound controls and every per-mode omission control pass by detecting the intended wrong observation, with no timeout or setup kill claim. |
| ORC-007 | Identical 80-history fixed/fresh campaigns remain; exact checked Node and Chromium replay commands above each executed the new state once. No command grammar is used. |
| ORC-008 | The stateless model gains separate query facts. Equal source ready states require different observations before and after initial-query readiness; phase retains this necessary distinction. |
| ORC-009 | Receiving mode names the actual sync mode. Source readiness and initial-query readiness keep their canonical meanings; the model-only value encoding is unchanged. |
| ORC-010 | Both source and query callbacks are removed; query cleanup precedes source cleanup. The shared cleanup helper still preserves primary and secondary failures. |
| ORC-011 | No new plausible shared semantic fault requiring another formulation was identified; native output is still compared with independent coordinates. |
| ORC-012 | This append-only record preserves the prior evidence and separately records amendment authority, paths, results, controls, replay, reach and exact source hashes. |
| ORC-013 | Initial and live refusal distinguish source readiness from query readiness; middle-refusal histories distinguish whole-batch admission from publishing a valid prefix. |
| ORC-014 | The actual Chromium receiver reuses the same model, grammar, shared production driver and comparison. Only the protocol service remains controlled; no remote-service claim is added. |
| ORC-015 | Every prior state is required independently per mode, plus the source-ready/query-pending state. All 47 constructed obligations and local generated-builder obligations are enforced and calibrated. |
| ORC-016 | Existing `oracleProperty` registrations and fixed shared history remain. No unit examples or independent expected-value assertions were added. |

### Amendment reach

These totals sum generated and constructed campaign units. Fixed histories do
not supply the required minimum. Every declared state retains minimum one in
each fixed/fresh campaign and in each host.

| State | Node fixed | Node fresh | Chromium fixed | Chromium fresh |
| --- | ---: | ---: | ---: | ---: |
| eager:initial-changed-id | 13 | 12 | 13 | 12 |
| eager:initial-changed-id-first | 7 | 6 | 7 | 6 |
| eager:initial-changed-id-last | 5 | 5 | 5 | 3 |
| eager:initial-changed-id-middle | 3 | 2 | 3 | 5 |
| eager:initial-throw | 15 | 9 | 15 | 15 |
| eager:initial-throw-first | 7 | 4 | 7 | 9 |
| eager:initial-throw-last | 6 | 5 | 6 | 5 |
| eager:initial-throw-middle | 4 | 2 | 4 | 5 |
| eager:initial-valid | 5 | 6 | 5 | 5 |
| eager:live-changed-id | 9 | 14 | 9 | 13 |
| eager:live-changed-id-first | 2 | 6 | 2 | 6 |
| eager:live-changed-id-last | 4 | 5 | 4 | 7 |
| eager:live-changed-id-middle | 3 | 4 | 3 | 2 |
| eager:live-fresh | 19 | 20 | 19 | 14 |
| eager:live-overlap | 13 | 18 | 13 | 20 |
| eager:live-throw | 18 | 16 | 18 | 13 |
| eager:live-throw-first | 10 | 7 | 10 | 7 |
| eager:live-throw-last | 10 | 9 | 10 | 4 |
| eager:live-throw-middle | 2 | 3 | 2 | 3 |
| eager:live-valid | 5 | 8 | 5 | 8 |
| eager:refusal-first | 26 | 23 | 26 | 28 |
| eager:refusal-last | 25 | 24 | 25 | 19 |
| eager:refusal-middle | 12 | 11 | 12 | 15 |
| on-demand:initial-changed-id | 18 | 11 | 18 | 20 |
| on-demand:initial-changed-id-first | 10 | 3 | 10 | 8 |
| on-demand:initial-changed-id-last | 9 | 7 | 9 | 9 |
| on-demand:initial-changed-id-middle | 3 | 3 | 3 | 5 |
| on-demand:initial-throw | 13 | 14 | 13 | 10 |
| on-demand:initial-throw-first | 3 | 5 | 3 | 3 |
| on-demand:initial-throw-last | 5 | 5 | 5 | 4 |
| on-demand:initial-throw-middle | 6 | 4 | 6 | 4 |
| on-demand:initial-valid | 3 | 7 | 3 | 3 |
| on-demand:live-changed-id | 12 | 11 | 12 | 11 |
| on-demand:live-changed-id-first | 4 | 4 | 4 | 3 |
| on-demand:live-changed-id-last | 5 | 5 | 5 | 4 |
| on-demand:live-changed-id-middle | 4 | 3 | 4 | 5 |
| on-demand:live-fresh | 12 | 17 | 12 | 12 |
| on-demand:live-overlap | 16 | 13 | 16 | 16 |
| on-demand:live-throw | 10 | 9 | 10 | 12 |
| on-demand:live-throw-first | 3 | 4 | 3 | 4 |
| on-demand:live-throw-last | 5 | 4 | 5 | 3 |
| on-demand:live-throw-middle | 3 | 2 | 3 | 5 |
| on-demand:live-valid | 6 | 10 | 6 | 5 |
| on-demand:refusal-first | 20 | 16 | 20 | 18 |
| on-demand:refusal-last | 24 | 21 | 24 | 20 |
| on-demand:refusal-middle | 16 | 12 | 16 | 19 |
| on-demand:source-ready-query-pending | 62 | 62 | 62 | 61 |

### Frozen amendment source snapshot

The six-entry amendment manifest SHA-256 is
`862d050ddd65a423da5e40e626ca91e604f7bbc10a8c1ba9109b1015b08fcf14`.
The prior six-entry manifest above remains historical; it is not silently
replaced by this amendment.

```text
fcbff16b5565c99e0b7d299dec25d97f0e822bbd8fe9450a2967be2da82f6f0b  packages/db-adapter-conformance/tests/decode-refusal-oracle.ts
7a05862732a9d2d1aad50e9f1e36a1ebafcb2be30be885e9d5fd8d6e90bf6b4f  packages/db-adapter-conformance/tests/decode-refusal-driver.ts
d04e205a913b50e67da468d1297d70e985f0430464c7be182fdb59d16a4dc8f4  packages/db-adapter-conformance/tests/decode-refusal-oracle-suite.ts
6f04ca7dd5166211d28f45c31b9be6f00306751bdb1fe39667ab84a185b7df0b  packages/powersync-direct-collection/tests/decode-refusal-driver.ts
91ceb118bcaab0c3a1acf9508c2fce96b2c669438ca46b5fb71a4ea7b5509890  packages/powersync-direct-collection/tests/decode-refusal-oracle.property.test.ts
dcd9bd11bdd049ff0ad1a1dc80afa29c83ffede472e2828111a7280a6bf44a68  packages/browser-db-sqlite-persistence/e2e/powersync-direct-decode-oracle.browser.test.ts
```


## Receiving amendment: released acquisition and active successor

The saved-cache repair may replay an on-demand acquisition after its first
checkpoint. The former decoder fixture supplied only one HTTP response and
could leave the SDK's real successor request unanswered. The Direct receiving
factory now binds a checkpoint to the actual request it captured and supplies
the same authored batch only to a genuinely different open successor. The
shared neutral input ledger observes actual SDK waits and commit receipts;
no expected rows, query outcome or readiness determines delivery completion.

That valid path exposed a formulation defect in the resource comparison: it
required every historical resource to stay unreleased until the entire source
run stopped. The glossary's acquisition-release contract and the stable
Collection lifecycle grammar permit core to release one acquisition while a
successor remains active. The corrected resource law requires one release for
each core-released acquisition or stopped-run resource, zero for each active
resource, and zero premature releases even if core releases it later.

The instrument maps each unique authored subscription array to the actual core
`LoadSubsetOptions` received by its mapper. The actual SDK acquisition must
receive that same array; a missing correspondence fails the premise. The
resource records core's request-signal abort or actual unload call separately
from the adapter's internal SDK wait signal. Only the former grants acquisition
release authority. The recorder snapshots that authority at each actual release,
so a later core release cannot excuse an earlier adapter release. Parser-observed
refusal authorizes terminal run cleanup. Every historical acquisition remains
in the observation; no released record is filtered away.

An explicit `retireDemand` history independently establishes the condition,
without requiring any optional cache policy. A temporary real public live query
starts an acquisition, then unsubscribes and cleans up before any source rows
arrive. The original judged query is subsequently created and receives the
unchanged authored input. Five fresh constructions per campaign require an
actual core-released lease with one release alongside a live successor with
zero releases and successful next use. Old constructed histories retain
`retireDemand: false`.

With the old comparison, ten generated construction units failed at the
semantic resource comparison. The corrected comparison passes the complete
unchanged-production family: **228/228 Node, 13.73 s**, including the ordinary
cleanup control, and **227/227 actual Chromium, 41.90 s**. All 48 declared
states are measured. New-state reach was 11 fixed / 15 random histories on
Node and 11 fixed / 12 random on Chromium, including the five required fresh
constructions per campaign. Four bound wrong observations reject a missing
retired release, an early release despite later core release, a duplicate
release, and an early release of the active successor.

A reviewer identified that the first temporary-query prelude had awaited work
outside source cleanup ownership. Outer cleanup now owns the source before
those awaits, and temporary-query cleanup is registered before callback-capable
subscription/preload calls. An ordinary failed-input control preserves the
exact primary error as the AggregateError cause and checks one unload and one
source cleanup. The initial fixed-history unmapper failure and incomplete
120-second neighbor attempts are setup/incomplete diagnostics, not semantic RED
or GREEN evidence. The completed campaigns contain no setup failures.

The [retirement snapshot](2026-11-17-powersync-direct-decode-retirement-snapshot.json)
has SHA256 `f9d8a34945a100865e761a9af225f5a80b7079f22ed5213a5f82cf9832d08ce3`.
It records eight receiving files, canonical `1ec1defd` / `20f8ed31` source
fingerprints, and four log fingerprints. Full runs precede only an opening
comment authority citation and a stricter ordinary identity assertion.
Independent review accepted that narrow carry, passed 21 selected Node tests,
20 actual Chromium tests and the final identity control, and approved the
bounded amendment. Production did not change.

Commands from the respective package directories use the established Node 26
executable and the prior browser configuration. Node selects
`tests/decode-refusal-oracle.property.test.ts tests/decode-refusal-cleanup.test.ts`
with `--coverage.enabled=false --typecheck.enabled=false --maxWorkers=1`.
Chromium selects `e2e/powersync-direct-decode-oracle.browser.test.ts` with
`--config vitest.adapter-oracles.config.ts --fsModuleCache=false --maxWorkers=1`.
The old comparison used the same Node receiver with
`-t 'generated on-demand:retired-demand-with-active-successor'` before its
resource conditional was corrected. Raw logs are
`.review-2377/direct-decode-public-retirement-old-checker-red.log` and
`.review-2377/direct-decode-retirement-frozen-{node,browser}.log`.

This is a correction to an overstrong oracle resource condition and a receiving
input repair. It does not claim a new decoder production defect, arbitrary
thrown-value coverage, cached initial SDK callback coverage, or general query
ownership coverage. Those additional decoder receiving paths are inventoried
separately before any further source change.

## Final cause and cached-startup repair, 2026-11-18

The decoder owner now covers two additional receiving dimensions: arbitrary
JavaScript values thrown by `parse`, and rows retained by an idle actual SDK
before Collection startup. The final source is `index6b0a8092` with unchanged
`subsets20f8ed31`. The final evidence manifest is
[the cause/cache evidence](2026-11-17-powersync-direct-decode-cause-cache-final-evidence.json),
SHA256 `44d4e485357f2276b2ea6531a2132726d0071123a7ace6262cc4c817d1e0de19`.
It records current source/instrument hashes, both complete campaign logs,
per-state reach, exact receiving observations, and isolated source transforms.

The old owner exercised cold initial/live input and an ordinary `Error`.
It never supplied cached startup input before handler construction, a value
whose `instanceof` inspection throws, or a value whose `String` conversion
throws. Its existing terminal-health and resource comparisons could detect
both defects once the grammar and receiving recorder supplied those paths.
The false green therefore came from missing receiving dimensions, rather
than authority to accept the existing output.

An initial model extension overconstrained on-demand cached readiness. The
public on-demand readiness law certifies permission to acquire data, while
query readiness certifies its requested rows. The model now allows coherent
before-readiness and after-readiness source cuts, selected by recorded public
ready/parser-refusal order. It never selects a cut from final source status.
Valid source readiness may contain either no rows or the complete admitted
batch. Prefix publication remains forbidden. This correction follows the
public law; current production output supplies no authority for it.

The receiving driver prewarms the actual SDK through its HTTP checkpoint,
public listener, acquisition and synchronization wait, then releases all warm
resources. It verifies that the SDK is idle, the provider request is closed,
and the authored rows remain cached before creating the Collection. New source
resources are accounted separately. Synchronous subscription errors are kept as
observations, so an invented `CollectionConfigurationError` cannot disappear
inside setup.

### Evidence block

- **Law:** the Direct Errors contract says every parser throw stops sync.
  Before source readiness the Collection errors; afterward it keeps rows and
  readiness and exposes terminal health. Each admitted batch publishes whole
  or not at all. A valid on-demand configuration returns its actual subset
  handlers even if cached decoding fails during startup. Authority is
  `docs/collections/powersync-direct-collection.md#errors`, the glossary's
  loading/sync error and publication contracts, and `SyncConfig.fail(error:
  unknown)`. No new raw-cause identity or fallback-message promise is imposed.
- **Reach:** all **72** declared states were reached in each fixed and random
  campaign on both hosts. Each ordinary state has a constructed builder;
  retirement keeps five fresh constructions. Every new cause/cache state has
  measured receiving reach. The manifest retains each campaign unit's counts
  and totals; the minimum across states is one per campaign.
- **RED:** canonical `index1ec1defd/subsets20f8ed31` stayed unchanged through
  the approved pre-edit gates. The v3 full receiving runs produced **42
  semantic campaign failures per host** and **24 calibration failures per host
  whose clean baseline already failed**. Those calibration failures receive
  no mutant credit. Node was 66 failed/268 passed; Chromium was 66 failed/261
  passed. The first sandboxed browser attempt failed at localhost setup and
  receives no product evidence credit.
- **Exact RED cells:** a construction's failure can shrink outside its named
  cell. The named-unit list in the v3 RED record is therefore not cell-specific
  proof. Separate retained authored histories and actual SDK raw observations
  resolve that attribution: **20 semantic RED cells and 16 GREEN neighbors on
  each host**, with every one of the 24 new declared cells actually reached.
  These histories use the same model, driver and comparison. Both reviewers
  recomputed the shared check over all 72 observations before source changes.
- **GREEN:** the repaired full family passes **334/334 native Node 26** and
  **327/327 actual Chromium** checks. The exact 36 receiving histories pass on
  each host. The Node total includes seven ordinary model/cleanup controls;
  those controls are not additional product campaign evidence.
- **Mutants:** isolated transforms restore only unsafe cause inspection or
  only returning cleanup instead of the real handlers after cached startup
  abort. Unsafe inspection gives **18 semantic failures/18 passing neighbors**
  on each host. Missing handlers gives **five configuration failures/31
  passing neighbors** on each host. Both reach the intended shared comparison;
  neither is classified by setup failure or timeout. Canonical source files
  stay unchanged during the transforms.
- **Permitted alternative:** a separate isolated source variant calls
  `markReady()` immediately before attaching the on-demand listener. The
  existing later call is idempotent. All six cached on-demand cases pass on
  each host. The valid case records empty source rows at first readiness; all
  five refusal cases record actual source-ready before parser-refusal, source
  status ready, and query failure. This is a positive implementation-freedom
  control, not a mutant kill.
- **Limits:** four throw shapes (ordinary Error, null-prototype object,
  throwing primitive conversion and throwing prototype inspection), one
  table/stream, 1–4 generated rows, one initial and at most one live batch,
  optional pending-query retirement, and the two named actual SDK hosts.
  This evidence does not establish arbitrary SDK/provider scheduling, other
  schema conversions, persistence, reload or mutation behavior. Those remain
  with their existing oracle owners. Sampled histories are not a universal
  proof.

The production repair forwards the unknown thrown value directly to core's
`fail`, which owns guarded problem description. It removes redundant hazardous
inspection and conversion. Real subset handlers are constructed before the
callback-capable listener is attached. A synchronous cached refusal cleans
that owner and still returns its valid handler shape. Handler construction
acquires no SDK resource and calls no mapper. Ordinary eager readiness,
listener/status/lease ordering, replacement logic and valid parser behavior
remain unchanged. Independent source review accepts bounded carry of prior
main/cursor/mapper evidence within those unchanged paths, retaining the older
execution fingerprints. New cause/cache claims use the new receiving evidence.

### Failure fidelity and verification

The recorder preserves a completed raw observation beside each cleanup error,
so teardown cannot replace a semantic mismatch before the remote registrar
judges it. Before recording completes, the original error remains the
AggregateError cause and cleanup errors remain secondary. Runtime diagnostics
read Error name/message once and retain only strings. Ordinary controls cover
cyclic properties, changing getters, unprintable causes, and both completed
and incomplete recording failures.

A control caught an integration defect while this amendment was in progress:
`retainOracleCleanupObservation` had snapshotted the cleanup list before the
recorder incrementally registered resources. It now builds guarded cleanup
steps in the recorder's `finally` block. Thirteen generic controls and seven
Direct controls pass. Independent old/new controls show static-list behavior
unchanged and reject the prior dynamic-registration omission with strict
error identities. The shared-helper audit records its wider applicability;
older receiving evidence keeps its historical fingerprints.

ORC-001 through ORC-010 are covered by the contract, independent authored
value model, literate source, bounded grammar, actual SDK receiving cuts,
calibrations, paired campaigns/direct replays, ordered source-cut abstraction,
shared vocabulary and failure-preserving cleanup above. ORC-011's concrete
shared-fault concern was an overstrong cached-readiness interpretation; the
actual permitted-order variant distinguishes it. ORC-012 is this versioned
record plus the exact evidence manifest. ORC-013 uses valid/refused,
initial/live, ordinary/unprintable and cold/cached neighbors. ORC-014 uses
actual SDK input on Node and Chromium; remote service conformance is not
claimed. ORC-015 records all 72 states with builder obligations and
missing-state controls. ORC-016 keeps fixed histories and calibrations inside
the shared oracle; ordinary harness/model controls remain ordinary test files.

Commands from the relevant package directory use the recorded Node 26 binary
and `../../node_modules/vitest/vitest.mjs`. Full Node selects
`tests/decode-refusal-oracle.property.test.ts tests/decode-refusal-cleanup.test.ts tests/decode-refusal-model.test.ts`
with `--coverage.enabled=false --typecheck.enabled=false --maxWorkers=1`.
Full Chromium selects `e2e/powersync-direct-decode-oracle.browser.test.ts`
with `--config vitest.adapter-oracles.config.ts --fsModuleCache=false --maxWorkers=1`.
The exact-cell runner and transform hashes, raw observations and per-host
results are in the manifest. Package TypeScript and scoped ESLint pass.

Independent final enforcement review approved `index6b0a8092/subsets20f8ed31`
and manifest `44d4e485` after checking all 17 current file hashes, 12 log
hashes, observation hashes, full campaign reach and isolated source-transform
hashes. Its independent actual Node SDK witnesses now observe terminal health,
one release and an idle client for the unprintable cause. Cached source and
query subscription admission has no configuration error; the original
ordinary parser cause remains the later preload rejection. The reviewer also
inspected handler construction, invalidation and the once-only late unlisten.

The bounded historical carry covers valid-parser and ordinary Error paths:
forwarding the same ordinary Error changes no cause, early handler construction
allocates no acquisition or mapper work, and ordinary listener/status/lease
ordering and replacement semantics are unchanged. Prior main/cursor/mapper
runs keep their original source fingerprints. Their evidence does not receive
new arbitrary-cause or cached-refusal credit. The installed SDK checkpoint-event
release and independently documented runtime support blockers remain separate.

Independent adversarial review also grants final bounded approval of manifest
`44d4e485` at `index6b0a8092/subsets20f8ed31`. It verified 17 current file
hashes, 12 log hashes, all eight versioned observation hashes and all three
transformed-source hashes. It recomputed every retained comparison and rebuilt
all 77 campaign-unit reach maps per campaign from the logs. All 72 states
were reached in each fixed/random campaign on each host. It accepts the erased
type annotation and the historical bounded source-domain carry. No actionable
finding remains within this decoder scope. Package TypeScript, scoped ESLint,
Prettier, `pnpm lint:changed` and `git diff --check` pass.
