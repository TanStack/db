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
| An ordinary string beginning `\0tanstack-db:` obeys its declared string collation in indexed and scan reads. Internal Temporal order keys must not cause a tree to lose a neighboring ordinary string. | On `origin/main`, an en-US locale scan selected `\0tanstack-db:a` first while BasicIndex/BTreeIndex selected `tanstack-db:r`. Before the final kind classifier, deleting a neighboring ZonedDateTime or Duration also made BTreeIndex omit the surviving string. | The direct-index owner compares first public rows through scan and indexed paths under locale and custom string collations, with row IDs independent of label order. Two three-key BTree histories compare all surviving keys. The hostile reviewer ran 24 focused tests, 108 add/delete permutations, and a 27-value comparator transitivity sweep across five option variants. After the final classifier simplification, it also ran 3,456 four-key BasicIndex/BTreeIndex insertion/deletion histories (27,648 checkpoints) and a 16-value comparator sweep; no in-domain counterexample remained. | Named scalar, binary, Temporal, and string-kind histories. No arbitrary nested values, mixed-kind relative order, or custom index `compareFn` guarantee. |

## Design decisions and open work

The captured-`inArray` list rebuild and per-row custom index callback ordering
were proposed extensions, then withdrawn by the maintainer. This PR does not
promise behavior after callers modify standard data objects in place, unsigned
byte ordering, or special handling for malformed Temporal lookalikes. The
[deferred record](pr-2116-deferred-findings.md) keeps valid Temporal admission,
mixed-kind query order, and earlier-branch observations separate from the
confirmed fixes above.

The repeatable workflow is: freeze source assertions in a loss ledger; name
the receiving law and its limits; obtain a baseline failure before production
changes; extend an independent model at the public checkpoint; ask a fresh
hostile reviewer to attack authority, reach, and plausible mutants; then
recheck the exact committed head. A production-code budget is evaluated
separately from oracle and documentation growth. A green generated campaign
supports only its legal histories, paths, and observations.

## Production-code weight

Against the recorded `origin/main` baseline, the final source diff under
`packages/db/src` adds 200 lines and removes 211, for **11 fewer production
lines**. The built DB ESM entry bundled with esbuild (`bundle`, `minify`,
`format: esm`, `platform: neutral`, `NODE_ENV=production`; DB IVM, pacer-lite,
and standard-schema external) is 334,795 bytes / 100,227 gzip at baseline and
335,886 bytes / 100,644 gzip for this change. That is **1,091 more minified
bytes / 417 more gzip bytes**. The source-line budget is negative; the bundle
budget is still positive. The remaining runtime addition is concentrated in
distinct index-storage comparison and exact Temporal keys, which the bounded
fixes above require. Do not treat source-line reduction as a bundle-size win.
