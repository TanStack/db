# Audit fixes and restored design constraints

This revision implements the accepted fixes from the fracture scan, hostile audit and loss audit. The frozen grammar and audit receipts remain historical evidence. This document adds the revised contracts and restores distinctions the first draft compressed away; it is not a new Design Grammar run.

## Handler outcome and authority are separate

A handler is not a database transaction. It can commit one statement and fail on the next. The response now carries a handler outcome independently of its reconciliation outcome. Unknown effects still require every retained, non-GCed query to be read, even when the handler throws. Only reads retry, with three retries at 1/2/4 seconds.

| Handler | Reconciliation | Client behavior |
| --- | --- | --- |
| Completed | Complete snapshots | Install authority, then resolve persistence and retire the overlay. |
| Failed | Complete snapshots | Install authority, then reject persistence with the handler error and retire the overlay. Committed data remains. |
| Either | Exhausted reads | Surface a read error for every requested collection, preserve the handler outcome in the response, and reject persistence. A later fresh read restores authority. No rollback claim is made. |
| Either | Invalid response | Reject before installing any snapshot and mark the requested collections with a read error. |

A malformed response includes missing, duplicate or unexpected query identities, duplicate row keys, invalid row values, or an invalid envelope. Validation precedes all collection writes. This does not promise atomic publication across otherwise valid snapshots.

The existing transaction overlay still owns whole optimistic row snapshots. Authoritative writes occur through ordinary collection sync utilities; failure retires the guess rather than undoing database commits. Actions still return a Transaction synchronously, with no mutation queue.

## Declaration identity and ordering

Declaration identities include the module identity and lexical declaration ordinal as well as readable local names. Distinct scopes may repeat component, query and mutation names. The ordinal counts declarations with the same local names in lexical traversal order. Unrelated imports and test instrumentation cannot change it. Compiling the same source produces the same identities across renders; a compile-time duplicate guard rejects collisions. This is not an identity migration contract across source edits, builds or HMR.

The supported string ordering now follows Unicode code-point order, which agrees with UTF-8 byte order for valid Unicode strings under PostgreSQL `C` collation. Tests derive the expected order from PGlite, including BMP and supplementary-plane keys, and exercise both loaded and optimistic rows. Locale/ICU collations, invalid Unicode strings and other database codecs remain outside this slice. Deployments must not silently claim the `C` comparator supports other collations.

## Restored grammar distinctions

The [multi-table source](../ground-conditions-multitable.md) and [loss ledger](./audit/loss-multitable.md) constrain later generalization:

- **Mutation reads, possible writes, observed effects and guessed effects are different facts.** Reads explain decisions and dependencies; possible writes bound conservative invalidation; observed effects describe what actually happened; guesses drive overlays. An observer is useful for skipping reads only when its coverage is complete across relevant tables, indirect writes and commit boundaries. An opaque handler error does not prove an empty effect set.
- **Dependencies include absence and authorization.** NOT EXISTS, outer joins and zero-count results can change when an absent row appears. Permission changes can alter visibility without changing a projected row. A set of loaded entity keys is not a complete dependency description.
- **Support can be sufficient or insufficient.** A fully loaded joined result can sometimes provide all data needed for an exact local update. Missing partners require more support or fallback. If both join inputs change, account for the cross-term between their deltas; do not miss it or count it twice.
- **Aggregates have different support needs.** Counts need multiplicity; distinct counts need per-value support; removing a minimum or maximum can require replacement candidates. A generic “aggregate supported” flag loses those distinctions. Limited queries similarly require replacement rows when membership or rank changes.
- **Small writes can cause large result changes.** A shared parent or permission update may affect many rows and collections. Payload size is bounded by result change, not mutation input size.

These are preserved design obligations, not new implementation claims. The current executable model still supports full Todo rows, all/completed predicates, ascending createdAt/id order, a stable loaded collection set, and sequential oracle histories. Multi-table compilation, effect capture, joins, aggregates, top-k, arbitrary fallback execution and lifecycle/concurrency protocols remain future work.

## Restore separate safety and cost decisions

Read selection, optimistic derivation, authoritative result derivation, delta encoding, shared SQL and shared result encoding each require their own evidence. Unknown analysis disables the dependent optimization; full authoritative results remain the baseline. Safe execution, safe optimization and a measured benefit are separate gates.

The [result-sharing experiment](../ground-conditions-result-sharing.md) held delivery at **one browser response** and compared **3/1/1 database calls**. It did not measure browser round-trip savings. Its [receipt](../result-sharing-measurements.json) found:

| Workload | Full gzip bytes | Shared gzip bytes | Observation |
| --- | ---: | ---: | --- |
| 1,000-row buckets, high overlap | 17,321 | 11,537 | About 33% smaller |
| 1,000-row buckets, disjoint | 18,711 | 24,918 | About 33% larger |

At 100 rows with overlap, raw JSON fell about 55%, while gzip fell only about 7%. The shared SQL candidate retained per-result scans and sorts and built repeated SQL results before deduplicating in JS. In the large disjoint case, local total medians were 17.661 ms for independent execution and 18.716 ms for shared execution. These are warm local observations, not a production winner or a profitability threshold.

Shared encoding also requires compatible scoped projections and values, correct output identity and multiplicity, ordered references, and exact empty results. Matching entity keys alone does not establish compatibility. Following already computed result references is decoding, not client query evaluation or shared query support.

The later inline-versus-refetch browser comparison measured **1 versus 3 browser requests**, decoded response bodies and harness elapsed time. It answers a different question. Neither those timings nor the earlier local SQL/encoding timings measure deployed end-to-end latency. The original sharing oracle covered 30 histories, 131 steps and 327 checkpoints for reconstruction; it did not prove compiler classification, optimism or browser publication. Preserve that evidence separately from the full-stack coherence oracle.

## Test gaps closed

| Audit finding | Why previous tests missed it | New coverage |
| --- | --- | --- |
| Commit followed by handler failure | Rejection was injected before SQL | Actual PGlite partial commit; client authority before rejection; generated post-commit errors crossed with read retries/failure |
| Repeated declaration names | One component and unique local names | Compiler regression and generated nested scopes with repeated names |
| Wrong Unicode order | ASCII-only keys | PGlite ordering regression and generated Unicode seed/insert keys |
| Recipient selection tied to guesses | Server mostly copied intent, only trimming text | Independent membership changes, other-row effects and no-ops; wrong-recipient negative control |
| Malformed authority | Server always returned valid snapshots | Deterministic corruptions and 100 generated malformed responses; no partial baseline replacement |

The expanded generator exposed a test-fixture error: initial and inserted Unicode IDs could share the same prefix and operation index. Seed and insertion namespaces are now separate. That failure occurred in the reference before invoking the SUT and is not counted as a framework or DB defect.

The existing Todo browser regression caught a second identity boundary during this work: byte offsets changed when preceding plugins inserted test instrumentation, causing client and server IDs to disagree. A failing compiler regression now covers that transformation; declaration ordinals replace byte offsets.

## Validation receipts

- [Initial red regressions](../../integrated-todo/evidence/audit-fixes-red.tap): post-commit authority loss, duplicate declaration identities, Unicode order, malformed response handling, and the revised handler envelope failed before fixes.
- [Instrumentation identity red](../../integrated-todo/evidence/audit-fixes-identity-red.tap) and [green](../../integrated-todo/evidence/audit-fixes-identity-green.tap): unrelated imports no longer change endpoint identities.
- [Final contracts](../../integrated-todo/evidence/audit-fixes-contracts-final.tap): 18 top-level checks passed, including a bundled runtime suite with four checks and 100 generated malformed responses. TypeScript and `git diff --check` passed.
- [Four full-stack campaigns](../../integrated-todo/evidence/audit-fixes-final/report.json): N=2 programs per campaign, X=3 sequences, up to 3 generated steps; 10 builds, 27 sequences, 73 operations, 316 checkpoints, 40 client artifacts. Controls, retry recovery, coherence and exhausted reads all passed. This run started before the final identity refinement.
- [Final identity/coherence campaign](../../integrated-todo/evidence/audit-fixes-identity-oracle/report.json): 4 builds, 8 sequences, 23 operations, 77 checkpoints, 16 client artifacts passed with declaration ordinals. Includes repeated lexical names and independent server-effect witnesses.
- [Wrong-recipient negative control](../../integrated-todo/evidence/audit-fixes-recipient-mutant/report.json): deliberately failed the first independent membership-change checkpoint. The correct conservative selector passed that witness in both successful campaigns.
- [Generator repair replay](../../integrated-todo/evidence/audit-fixes-generator-replay/report.json): the saved ID-collision sequence passed after separating ID namespaces.
- [Client-refetch comparison control](../../integrated-todo/evidence/audit-fixes-refetch-control/report.json): passed one independent-effect operation over two collections with three browser requests. This is a correctness/control check, not a new speed comparison.
- [Todo browser regression](../../integrated-todo/evidence/audit-fixes-final-browser.json) and [binding regression](../../integrated-todo/evidence/audit-fixes-final-identity.json) passed after the identity refinement. Callback-error/empty-transaction checks also passed against the isolated in-memory server.

Each generated program receives a production build and server/client artifact checks. The tests still execute browser behavior against a dev server. No DB-core defect, broad SQL support, concurrent settlement proof or production performance gain is claimed.
