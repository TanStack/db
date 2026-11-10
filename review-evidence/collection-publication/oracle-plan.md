# Collection public snapshot oracle plan

Authority: maintainer decision in this task, 2026-10-30. A truncate replay keeps its replacement private to direct Collection reads and subscribers until successful coherent publication. Failure retains the last good public rows and reports its error. Folding subscriber changes agrees with direct reads at publication cuts.

This deliberately supersedes the owner's old rule that direct reads observe independently installed source rows while a subscription retains older rows. Production output does not authorize the new prediction.

## Distinguishing predictions before editing

Start with public row a=1 and retained demand a. Truncate, start replay, and hold its load.

- Old direct-read prediction: no rows (the truncate already cleared installed source rows).
- New direct-read prediction: a=1, matching the retained public snapshot.
- Both subscriber predictions: a=1, with no replacement batch.

Deliver a replacement row a=2 while another replay acquisition remains held.

- Old direct-read prediction: a=2.
- New direct-read prediction: a=1 until coherent publication.
- Failed replay prediction: a=1 remains public at a quiet cut; error identity is preserved.
- Successful authoritative retry prediction: direct reads and folded subscriber rows advance together to the complete replacement.

Last-owner retirement retains the existing distinction: an unfailed retired replay can publish its coherent held rows; failed work cannot authorize replacement. Cleanup invalidates the old run and clears direct Collection rows. A surviving subscription may retain its old fold until the next run publishes; fold/direct equality is claimed at coherent publication cuts, not at the cleanup boundary.

## Affected receiving cuts

The existing Collection lifecycle publication owner receives the changed law through subscribeChanges and direct get/values/toArray reads. It must observe truncate setup, partial replacement delivery, held sibling work, quiet failure, failed-owner retirement, successful retry, and cleanup/restart fencing. Existing status, error, exact-batch, source-write cancellation and terminal-unsubscribe checks remain.

Compiled queries, framework bindings, Query Collection adapters, persisted adapters and real-host publication are receiving obligations owned by ROOT and other agents. This controlled Collection witness does not close them.

## Receipt feasibility gate

commit() returns an applied receipt: fulfillment promises visible writes. A successful subset load waits for receipts establishing its result. Withholding public replacement until replay success can therefore create a cycle: load waits for receipt; replay waits for load; receipt waits for replay publication. The driver must observe commit submission without awaiting it first, while retaining the adapter's receipt-before-load-success rule. A timeout at that cycle is a protocol blocker, not the public-snapshot law RED. Do not redefine an applied receipt as acceptance or report setup failure as a product assertion.

## Execution plan and limits

Extend the existing primary owner, not a second independent owner. Preserve its 60-run fixed/random budgets and existing comparisons except the explicitly superseded direct-read policy. Add generated reach, replayable structural histories, and hostile wrong-observation calibration. First obtain an assertion RED at a named public observation on unchanged production. ROOT keeps production unchanged until all required receiving RED gates are satisfied. No green or closure claim follows from this plan.

## Obtained evidence before production changes

Production stayed at origin/main c351fc04d. The first execution was a setup failure: includeInitialState:true created an additional unbounded retained demand. It is preserved in core-public-snapshot-first-red.* and is not a law RED. The repaired driver starts with an empty Collection and observes the complete baseline through an unfiltered subscription with includeInitialState:false, then authors exactly two subset demands.

The second execution produced an assertion RED: fixed seed 20261030, path 0, initial [], replacement [{id:a,value:1}], resolve. At candidate-applied-while-sibling-held, get returned the candidate while the public model and full-state subscriber fold remained empty. All read facets and index keys were captured.

Final normal generated campaigns use the same grammar, driver, comparison and 60-run budget, without fixed examples displacing generated samples. Eight normal replay-example tests use the same judgment. Both failure continuations execute before comparisons throw. Final fixed RED: seed 20261030, path 0:0:0:0:1:1. Final random RED: seed -81254994, path 1:0:0:0:1. Both campaigns stopped early at the visibility law. Logs: core-public-snapshot-final-campaigns.stdout.log and .stderr.log.

The fixed campaign's first generated input executed two continuations. Both reached held truncate, candidate commit, equal follow-up, quiet failure, cleanup fencing, and restarted publication. One reached failed retirement; one reached successful retry. These are two continuations of one generated input, not two independent generated inputs. Shrink reach is reported separately in the raw packet. The minimum-five full campaign obligation remains unsatisfied because production is RED.

Direct replay of seed 20261030 and path 0:0:0:0:1:1 reproduced initial [], replacement [{id:a,value:0},{id:d,value:3}], resolve. The held direct-read mismatch was unchanged. Logs: core-public-snapshot-direct-replay.*. The direct invocation used TANSTACK_DB_ORACLE_PROPERTY=subscription-lifecycle.atomic-public-snapshot, TANSTACK_DB_ORACLE_SEED=20261030 and TANSTACK_DB_ORACLE_PATH=0:0:0:0:1:1, then /usr/local/bin/node ../../node_modules/vitest/vitest.mjs run --config /tmp/collection-publication-core.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --fileParallelism=false tests/collection-subscription-lifecycle-publication-oracle.property.test.ts -t 'checks atomic Collection public snapshots' from packages/db. The private config merges the ordinary package configuration, uses /tmp/collection-publication-core-vite-cache, and binds @tanstack/db-ivm to this worktree's source.

The checker calibration passed. It rejects leaked candidate rows, missing and extra rows, absent direct-read inventory, absent full-state fold, missing indexed keys, and successful publication attributed to a rejected history. This is wrong-observation calibration. No repaired-production GREEN or production-mutant result is claimed.

The focused TypeScript check passed after binding existing Node type definitions (core-public-snapshot-typecheck-v2.*). Standard ESLint passed after lint-only import ordering and mandatory-fold validation cleanup (core-eslint-final-v2.*). The required node scripts/agent-lint-feedback.mjs --format=text --event=stop passed with empty logs (core-oracle-lint-final-v2.*). Per ROOT's design-exploration steering, no further runtime followed those lint-only edits.

Final source SHA-256 values:

- Shared companion: 667a18a15a0ab5ee918b71b16c61149ed0d2076e08822896aabd7c841ed36d53.
- Primary owner: c863ebb41a4b1120b113c9fa00aeef4b0ca5aaadd22b40415f6a8282acc40003.

## Requirement audit for this extension

| Requirement | Evidence or remaining limit |
| --- | --- |
| ORC-001 | Maintainer decision above; cleanup-time equality, base/metadata, optimistic overlays and multiple subscribers remain open. |
| ORC-002 | Shared expected rows derive only from the authored initial/replacement snapshots and allowed phase. |
| ORC-003 | Shared companion states authority/limits, grammar, model and comparison; primary extension explains provider delivery and receipt observations. |
| ORC-004 | Grammar varies empty/one/three initial rows, empty/same/overlap/disjoint replacements, equal/changed values, and success/failure. Duplicate keys and successful completion of a rejected history are excluded. No exhaustive grammar-completeness claim. |
| ORC-005 | Real createCollection/subscribeChanges/index calls; two retained replay requests measured. get/has/size/keys/values/entries/toArray and indexed selection recorded at callbacks and authored cuts. |
| ORC-006 | Wrong-observation calibration passed and unchanged production fails the intended visibility comparison. No production mutant or repair claimed. |
| ORC-007 | Identical 60-run fixed/random campaigns register normally; both RED; exact fixed seed/path replay reproduced. |
| ORC-008 | Shared result model is stateless; driver keeps only authored delivery, settlement, receipt, and observation information. No new production-state mirror. |
| ORC-009 | held/failed/complete are explicitly observation phases, not Collection statuses. |
| ORC-010 | All observed mismatch cuts and receipt states are retained in raw packets before cleanup; mismatch errors retain causes. Cleanup-fault calibration is not supplied by this extension. |
| ORC-011 | No separate alternate-result formulation added. Receipt/publication feasibility is the named unresolved protocol conflict, not an alternative expected-row rule. |
| ORC-012 | This table records the extension's results; it does not audit all legacy owner cases. |
| ORC-013 | Empty baseline/nonempty candidate and nonempty baseline/empty candidate distinguish both directions of the visibility boundary; equal follow-up and quiet-failure cuts remain observable. |
| ORC-014 | Controlled core adapter only. Query and persisted receiving evidence belongs to their assigned drivers. No native/browser-provider claim. |
| ORC-015 | Declared lifecycle reaches and minimum five exist; early RED means no full-budget reach or bug-class closure claim. Generated and shrink counts remain distinct. |
| ORC-016 | Fixed inputs and hostile observations use the shared model/check; new tests contain no separate handwritten expected public row answer. |

The old owner's direct-installed-source assertion remains a superseded expectation to revise with a coherent protocol; the new law is a separate normal property. The current work is an executable RED design constraint. It does not establish that withholding commit receipts is a valid implementation: applied receipts promise public visibility and successful adapter loads await them. No production code changed.
