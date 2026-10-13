# PR #2116: confirmed fixes found during unit-test retirement

The seven index, five non-finite comparison, two ordinary Temporal comparison,
and six Date/RegExp assertions retired by this PR have their own loss ledgers in
the [coverage map](../oracle-coverage.md#unit-test-retirement-transfers-in-pr-2116).
Those transfers did not authorize new product guarantees. Each additional fix
below has an accepted law, a failing observation before repair, an independent
receiving witness, and a bounded hostile challenge. `origin/main` was
`bbbf017ef5b3884515295a4225faacdfd814499e` for the baseline checks.

| Law and authority | Baseline failure | Receiving observation and hostile result | Limit |
| --- | --- | --- | --- |
| A full BasicIndex build keeps `undefined` at the configured nulls-first position. The default comparator and surviving ordered-index tests supply the rule. | Native `Array.sort` moved a raw `undefined` value last without calling the comparator. | The source-Map direct-index owner compares complete ordered reads after full build. The [build review](basic-index-nullish-build.md) records RED/GREEN and hostile evidence. | Default nullish order and bounded build histories. |
| Duration identity preserves all ten public fields. Changelog #1519 explicitly keeps equivalent displayed forms unequal for query equality; the Collection subscriber-mirror contract requires a changed row to reach its subscriber. | One second and 1000 milliseconds display alike. The former `deepEquals` and normalized index key treated them as equal, suppressing a Collection change message or returning a wrong exact match. The original implementation failed direct BasicIndex/BTreeIndex lookup, public scan and indexed `eq`, and constant and row-supplied `in` probes. | The deep-equality and change-event oracles compare a direct result, stored row, callback batch, and subscriber mirror. The Duration query owner checks ten fields through BasicIndex/BTreeIndex exact lookup and public `eq`, while the `in` evaluator owner uses constant and row-supplied lists. A seconds-only production mutant fails the adjacent-unit deep-equality property. Executed wrong-key controls reject display-string, sign-loss, and first-nonzero-field query keys; they were not production mutants. | Fixed replacement and single-row query histories; no arbitrary multirow update or live-query publication claim. |
| An indexed ZonedDateTime `orderBy` follows instant order, as promised by changelog #1519. A time-only Duration uses its elapsed-time order while keeping exact field identity. | Indexed first-row reads placed a later ZonedDateTime first when display text opposed epoch order, including a 9ns/10ns digit-width pair. PT120M also preceded PT1H under string-key order. | The Temporal index-order oracle compares exact direct BasicIndex/BTreeIndex reads and bounded public first rows, including an on-demand Collection. Adjacent nanoseconds at a large epoch reject `Number` precision loss. PT1H/PT60M exclusive cursors reject an exact-suffix tie-break; negative durations reject absolute-value order. The hostile reviewer found no sign mismatch in 2,000 seeded valid day/time pairs. | ZonedDateTime instant and time-only Duration order in the named fixed histories. Calendar units needing `relativeTo`, mixed Temporal kinds, custom index callbacks, and arbitrary update histories remain open. |
| A manual index cannot change the declared ascending `orderBy(rank).limit(1)` answer. Query order is public; index selection is physical planning. | A reverse manual BTree index made `currentStateAsChanges` return rank 30 instead of rank 10. | The custom-index selection oracle independently sorts two distinct numeric ranks and checks the direct public snapshot and an eager live-query result. The hostile reviewer found the direct path that the first witness missed; both paths now pass. An added compiler guard had no demonstrated effect on this witness and was removed. | Eager initial reads with distinct ranks; no callback-tie, on-demand, later-update, or work-bound claim. |
| Index updates conserve each source key even when number and string values occupy different comparison domains. | The old comparator could make `2` tie `"2"` while putting them on opposite sides of `"10"`; a direct deletion then duplicated or lost a key. | A source Map predicts full direct traversals after bounded delete/update/re-add actions, and a bounded indexed Collection read checks the public key set. The hostile reviewer confirmed the original comparator fails the source-Map comparison. | Key conservation, not a mixed-kind public order policy or all Collection histories. |
| An ordinary string beginning `\0tanstack-db:` obeys its declared string collation in indexed and scan reads. Internal Temporal order keys must not cause a tree to lose a neighboring ordinary string. | On `origin/main`, an en-US locale scan selected `\0tanstack-db:a` first while BasicIndex/BTreeIndex selected `tanstack-db:r`. Before the final kind classifier, deleting a neighboring ZonedDateTime or Duration also made BTreeIndex omit the surviving string. | The direct-index owner compares first public rows through scan and indexed paths under locale and custom string collations, with row IDs independent of label order. Two three-key BTree histories compare all surviving keys. The hostile reviewer ran 24 focused tests, 108 add/delete permutations, and a 27-value comparator transitivity sweep across five option variants. After the final classifier simplification, it also ran 3,456 four-key BasicIndex/BTreeIndex insertion/deletion histories (27,648 checkpoints) and a 16-value comparator sweep; no in-domain counterexample remained. | Named scalar, binary, Temporal, and string-kind histories. No arbitrary nested values, mixed-kind relative order, or arbitrary custom index `compareFn` guarantee. A separate two-value direct callback lane checks legacy scalar input kinds for immutable Date, Temporal.Instant, and Uint8Array values. |

## Design decisions and open work

The removed `subset-dedupe.test.ts` case that overrode `Date.getTime` and
`Uint8Array.slice` was omitted from the earlier retirement ledger. Its frozen
assertion checked that request transport kept the same `where` object and that
the evaluator produced the same answers before and after transport. A probe on
this PR still passes that case. The maintainer excluded guarantees after callers
modify standard data objects, so the overridden-method case has no receiving
oracle law. Immutable Date, byte-array, and Buffer request identity and matching
remain checked in `subset-dedupe.test.ts`; `immutable-demand-boundary.test.ts`
also checks the direct and deferred request handoff. This records the excluded
assertion explicitly rather than treating its deletion as a transfer.
The rewritten `binary-equality-work.test.ts` also stopped editing a compiled
byte literal in place. The evaluator still passes that old trace on this PR,
but in-place edits to standard values are outside the accepted contract. Its
fresh-value checks remain the supported equality and work witnesses.

The captured-`inArray` list rebuild and per-row custom index callback ordering
were proposed extensions, then withdrawn by the maintainer. This PR does not
promise behavior after callers modify standard data objects in place, unsigned
byte ordering, or special handling for malformed Temporal lookalikes. The
[deferred record](pr-2116-deferred-findings.md) keeps valid Temporal admission,
mixed-kind query order, the confirmed pre-existing indexed Temporal exception
gap, and earlier-branch observations separate from the confirmed fixes above.

The repeatable workflow is: freeze source assertions in a loss ledger; name
the receiving law and its limits; obtain a baseline failure before production
changes; extend an independent model at the public checkpoint; ask a fresh
hostile reviewer to attack authority, reach, and plausible mutants; then
recheck the exact committed head. A production-code budget is evaluated
separately from oracle and documentation growth. A green generated campaign
supports only its legal histories, paths, and observations.

## Production-code weight

Against the recorded `origin/main` baseline, the source diff under
`packages/db/src` adds 356 lines and removes 535, for **179 fewer production
lines**. The built DB ESM entry bundled with esbuild (`bundle`, `minify`,
`format: esm`, `platform: neutral`, `target: es2020`,
`NODE_ENV=production`; DB IVM, pacer-lite, and standard-schema external) is
335,613 bytes / 100,492 gzip at baseline and 336,504 bytes / 100,889 gzip at
executable head `905b93323`. That is **891 more minified bytes / 397 more gzip
bytes**. Both outputs use Node's `zlib.gzipSync`. The source-line budget is
negative; the consumer-bundle budget remains positive.

The later build-cache commit `ad6f22105` removes the obsolete `compareStored`
minifier entry and registers 23 private members that the cache check recognizes
as safe. Production TypeScript is unchanged from the reviewed executable head.
After a fresh build, the same consumer-bundle measurement is 335,182 bytes /
100,737 gzip: **431 fewer minified bytes / 245 more gzip bytes** than baseline.
The local cache check and minified public API check pass. This narrows, but does
not close, the consumer-bundle gap. The repository's separate compressed-size
check reports **395 fewer bytes** across its published ESM package files at
`ad6f22105`; that unbundled package measure is net negative.

## Exact-head hostile review of the index rewrite

The executable revision is `905b93323` (following `2f852dcd1`); the baseline
is `origin/main` `bbbf017ef5b3884515295a4225faacdfd814499e`. The rewrite
replaces BTree's per-exact ordered entries with comparator groups while keeping
exact membership separate. Its binary ownership history compares a source Map
with complete forward and reverse index reads. An intermediate PR rewrite lost
a surviving byte owner after a fresh equal-content removal. The published
parent `78bd4946b` passes the six final binary cases, so that particular RED
is **not** evidence of a pre-existing defect.

The hostile reviewer ran two wrong-output controls against the rewritten
BTree. One suppressed a surviving short-byte key after equal-content removal;
the oracle failed at the ordered-read length comparison. A second suppressed
one key after inserting two 8193-byte values that differ only in their last
byte. That mutant survived the first version of the binary lane because the
wide-byte case checked exact lookup only. The final oracle adds full forward
and reverse key conservation there; the same mutant then failed at that
comparison. The unmodified six cases passed. These controls are output
mutants, not claims that `origin/main` failed.

The final BasicIndex retains the original stable byte value in its sorted
array and reuses the normalization cache populated at admission. A direct
offset-view and Buffer probe preserved exact membership and ordered keys after
fresh equal-content removal. Callers who edit the retained byte array in
place have no promise. This removes a redundant byte copy without changing
the accepted immutable-value law. Duplicate-heavy insert and removal timings
were near parity in the bounded A/B probe. An attempted merge of Array and
ordinary-object index kinds was discarded: it produced a strict three-value
comparator cycle, so the separate kind remains.

The fresh review also reconstructed a public scan/index mismatch for mixed
`PlainDate`/`PlainDateTime` and for two `PlainMonthDay` values. The scan throws
as changelog #1519 requires, while either index returns rows. It reproduces
on clean `origin/main` and this head. The [deferred record](pr-2116-deferred-findings.md)
assigns the exception witness and ordered-query repair to the Temporal owner;
the bounded ZonedDateTime and time-only Duration claims above do not include
this case.

| Guide requirement | Exact-head result |
| --- | --- |
| ORC-001 contract and limits | Transfer ledgers trace the retired assertions; changelog #1519 and the surviving index interface give the separate Temporal and key-conservation laws. The coverage map names excluded mixed-kind order, mutation of standard values, and wider histories. |
| ORC-002 independent judgment | Source Maps, supplied Duration fields, and supplied Temporal instants predict results without importing index grouping, normalization, or comparator classifications. |
| ORC-003 literate responsibilities | The owners state each law before mechanics and explain the model, legal actions, direct or public production path, observation, and checkpoint beside the code. |
| ORC-004 generated grammar | The transfer ledgers account for reconstruction, ablation, bounded ranges, and excluded histories of the existing generated index lanes. The new binary lane is a fixed history, so the generated-grammar trigger does not apply to that lane. |
| ORC-005 path and observation | Complete returned arrays expose missing or duplicate keys in both directions; exact lookups expose byte-content errors. Collection reads and index spies establish the named public routes. No earlier-publication information claim is made. |
| ORC-006 checker calibration | Short-byte and 8193-byte wrong-output mutants failed at ordered-read assertions; the wide mutant first survived, motivating the final assertion. Existing transfer ledgers retain the other hostile controls. |
| ORC-007 fixed and random replay | The important generated index properties retain their documented fixed and seedless campaigns and direct seed/path replay. The fixed binary examples do not trigger this requirement. |
| ORC-008 model state | The source Map retains key ownership because a later delete or replacement can distinguish live rows; the binary fixed history adds no production-shaped index state. |
| ORC-009 vocabulary | Model puts, deletes, source keys, and ordered reads map to direct index actions and public observations. Comparator groups remain production storage, not reference-model state. |
| ORC-010 failure and cleanup | Existing generated drivers retain their replay context and failure cause; public Collection witnesses clean up in `finally`. The fixed direct binary cases acquire no external resource. |
| ORC-011 second formulation | No plausible fault shared by the source Map and index ownership model was identified inside the bounded transfer. The separately confirmed mixed-Temporal public error is recorded as an unresolved neighboring law, rather than inferred from direct index equality. |
| ORC-012 review record | This versioned record identifies the executable head, baseline, mutant outcomes, tests, size, and unresolved public path. |
| ORC-013 boundary witness | Nullish boundary controls, opposing 9ns/10ns display and instant order, adjacent large-epoch nanoseconds, and Duration display ties reject nearby wrong rules at their named checkpoints. |
| ORC-014 controlled premise | The controlled Collection fixtures support only their named Collection observations; no real-provider behavior is claimed, so the cross-provider handoff trigger does not apply. |

The DB source suite passed 13,192 tests in 282 files before the no-copy
follow-up. After that follow-up, the affected index and comparison files passed
623 tests, the built-package lane passed 291 tests, the minified DB check
passed, and the DB source TypeScript and affected-file lint checks passed.
Those runs cover the changed immutable-value paths; they do not establish
arbitrary later Collection histories or the deferred mixed-Temporal error.

## 2026-10-13 high-effort review of PR head `16b219224`

This addendum supersedes the earlier manual-index row's two-rank limit. The
earlier observations remain historical evidence. The follow-up tree has a
three-rank/two-row owner and one ordered-index eligibility check shared with
the mixed-kind repair. The reviewer withdrew the claimed wrong live-query
result after finding that its scratch test resolved `@tanstack/db-ivm` from a
different checkout. With the correct package, both the frozen PR head and
`origin/main` published the expected prefix before and after the reported
writes.

| Review IDs | Law, experiment, and action | Remaining limit |
| --- | --- | --- |
| R01, R10 | Index choice cannot change an ordered public prefix. The new scan-versus-index owner rejected the frozen type-name order in eight initial ascending cases. Its repaired 20 ascending and descending BasicIndex/BTreeIndex cases include paired source updates and a ReverseIndex route. Forcing the index-eligibility getter true rejects all ten original ascending histories. A retained on-demand BTree history starts with numbers, inserts and moves a bigint, deletes a prefix row, then requests a later window. It asserts each settled public prefix against independently sorted provider rows. The finite request supplies a missing row; the later request uses a cursor after the retained index has become ineligible for new ordered plans. Withholding either requested row fails the corresponding public assertion. A single physical and query comparator is unsafe here: the query comparator does not form a transitive total order for all mixed JavaScript values. | The eager histories and this retained on-demand paging history pass. The withheld-row controls challenge the provider result, not production code. Other provider paging sequences and repeated domain changes remain untested; the retained loader still traverses the index after eligibility changes. |
| R03 | The reviewer withdrew the `[20,30]` public-result claim after fixing the scratch test's cross-checkout `@tanstack/db-ivm` resolution. The corrected three-row eager fixture returns `[10,20]` on both the frozen PR and `origin/main`; the reviewer also checked the insert and delete checkpoints. Our widened owner independently sorts three ranks and compares eager and prepopulated on-demand public rows after preload. The compiler's ordered-index eligibility check stays because mixed-kind finding R01 needs it; the R03-only planner assertion was removed. | No confirmed live-query correctness defect remains for this fixture. Incomplete-provider paging and later updates are outside this owner. |
| R04 | Direct index callbacks retain the legacy scalar input kinds for immutable Date, Temporal.Instant, and Uint8Array values. Five of six new callback cells failed on frozen head; callback-only normalization makes all six pass, with raw-object and collapsed-position hostile controls rejected. | Two-value direct-add histories only; arbitrary callbacks and later updates are not claimed. |
| R06, R07 | BasicIndex now keeps admitted exact keys beside ordered representatives; a 64-row Temporal range and ordered read made zero `toString()` calls, down from 128. BTreeIndex keeps a comparator-tie bucket map after one exact bucket leaves; a return to the tie no longer copies every peer. | BasicIndex may retain one former representative per live exact group. No general heap limit is claimed beyond existing retained-index state. |
| R08, R09 | Object comparison does allocate temporary reference-identity tuples, but a bounded timing probe found no object throughput regression; no extra hot-path code was added without a demonstrated cost. Auto-index now shares `indexableOperations`, and `DurationFields` is defined once. | An allocation profile under a representative workload would be needed to establish a material R08 performance defect. |
| R02, R05, R11 | In-place byte edits can stale the normalized-key cache, and the overridden-method request test was omitted from the earlier retirement record. Both concern caller modification of standard data objects, which the maintainer excluded; fresh immutable matching and request identity remain covered. The reviewer's random index run supplied no seed, grammar, or count. | The cache holds one key per live byte array. The random run is stress evidence, not a witness for mixed public order or callback inputs. |

An adjacent previously recorded defect also changed under the mixed-domain
guard. On `origin/main`, ready BasicIndex and BTreeIndex direct ordered reads
returned a row for PlainDate beside PlainDateTime, or for two PlainMonthDays,
while the scan threw the `TypeError` promised by changelog #1519. The expanded
Temporal index-order owner now checks six scan/index cases at direct-read and
eager live-query checkpoints. All 68 tests in that file pass on this worktree.
The eager live-query paths already threw on `origin/main`; the repair evidence
is the indexed direct-read mismatch. On-demand and later-update exception
histories are not claimed.

The same rewrite repairs a separate PlainDate boundary under lexical string
collation. The supplied year fields require `-100000-01-01` before
`+010000-01-01`, while their display strings have the reverse lexical order.
The expanded Temporal owner rejects the two `origin/main` indexed direct-read
results, which selected the positive year; scan and eager live-query preload
already selected the negative year. Current BasicIndex and BTreeIndex direct
reads pass. This establishes the fixed ready-source history, not every
extended-year pair or on-demand publication.

The follow-up tree adds 406 and removes 541 production source lines against
`origin/main`, for **135 fewer lines**. A paired local minified build of the 105
DB JavaScript package files totals 205,973 gzip bytes, versus 206,122 for the
same files on `origin/main`: **149 fewer gzip bytes**. Bundling each built DB
ESM entry into one consumer file with esbuild instead yields 100,746 versus
100,544 gzip bytes: **202 more gzip bytes**. Separate-file and whole-bundle
compression have different dictionaries and tree-shaking boundaries. React DB
has no source change in this follow-up; the CI size action has not yet run on
the final pushed commit.
