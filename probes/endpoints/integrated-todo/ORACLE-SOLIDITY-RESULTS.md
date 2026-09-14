# Oracle audit repairs

The nine confirmed findings from the [fresh loss audit](../design/field-trip-optimistic-coherence/oracle-guidance-reaudit/EVALUATION.md) are repaired. This pass improves test evidence and adds a cold retained collection history. It establishes no new production data bug. The audit and its original evaluation remain unchanged; the ledger records the follow-up dispositions.

## Repairs and controls

| Finding | Change | Evidence |
| --- | --- | --- |
| OG-02 | Concurrent delivery waits for a token recorded inside client response processing before checking the held sibling. | Actual caller block cannot finish while that receipt is withheld; generated browser waves check receipt order. |
| OG-03 | All six fault namespaces report requested, applied and reached status. A failure earns intended-rejection credit only when the original failing case reached the selected fault and rejected its named law. | Namespace tests, cross-case attribution control, runtime ordering, compiler trigger, FK and SQL-effect mutants; an unselected index branch reports unreached and exits nonzero. |
| OG-04 | Freeze the full drained publication batch before comparing its first event. | Generated batches retain changes, indices and later events after the first mismatch, even when the source objects are changed during cleanup. |
| OG-05 | Failure identity preserves operation, collection, field and membership/order distinctions while ignoring incidental row positions. | Field and order controls fail against the old identity; saved ordering failure reproduces as the same violation and passes without the fault. |
| OG-06 | One outer dependency scenario owns all of its histories and the shrink decision. | Actual caller extraction fails against the earlier commit and stops at the first unrelated failure after repair. |
| OG-07 | Compiled-browser and loading experiments use the full failure lifecycle and accept saved inputs for replay. | Wrong-row/render controls save original and reduced packets; compiled replay reproduces the same violation. Both saved inputs pass without their faults. |
| OG-08 | Hash executable references, renderers, fixtures, workspace sources, package identities and generated/mutated artifacts. | Provenance sensitivity test; campaign reports include source hashes and actual bundle/artifact hashes. This is provenance, not proof of reference independence. |
| OG-09 | Attach rejection handling immediately, retain the original observation promises and collect secondary failures on every exit. | Actual response-handler control preserves a primary row mismatch and a later response failure. Browser campaigns complete with empty cleanup-error lists. |
| OG-10 | Bind a cold query after loading warm peers, then mutate in the same turn. Check its empty baseline, the request's hasBaseline=false, independent expected rows and exact mutation refresh obligations. | Seven cold histories in the final SQL-effect run. Preloading the cold peer is rejected by the cold-baseline law. Background reads are counted separately. |

The [evidence directory](evidence/oracle-solid-repairs/MANIFEST.json) keeps red receipts, replay packets, green reports and the infrastructure failure described below. Every report carries its own source hashes; earlier controls are not presented as runs of a later byte-identical tree.

## Validation

- 88 contract tests pass, including 12 evidence-helper tests and six tests of actual caller/source boundaries. Typecheck passes.
- The 125 relevant DB transaction, scheduler, coordinated-publication and authority-permit tests pass. These validate the earlier production work committed in this turn; the audit repairs change only the test harness.
- Final campaigns pass 145 operations: Todo browser 19, generated SQL browser 7, concurrent generated browser 6, dependency registry/client 46, compiled dependency registry/client 33, SQL-effect registry/client 34. The last campaign covers 10 histories, seven cold, with 153 startup/background reads recorded separately from mutation refresh reads.
- The fixed compiled-browser replay passes six operations. The saved loading case passes with both full and adaptive encoding. This is a replay check, not a new broad loading benchmark.
- Ordering and compiled-browser fault replays reproduce the same violation and pass when the fault is removed. The ordering replay has no secondary errors. Compiler, FK and effect controls reject their intended laws; the conditional absent-index control reports unreached. This is not a claim that every available mutant was killed in this pass.

The first combined browser run completed its row checks but failed while retrieving dev-script response bodies from Chrome (`Network.getResponseBody`: no resource). It is retained as infrastructure failure, not discarded or counted as a semantic fault kill. The isolated Todo rerun passes with no observation errors. Its dependence on parallel load has not been proved.

Two fixture/edit mistakes occurred during repair: an initial cold-read gate blocked coordinated warm preloading, and an artifact-hash call was accidentally inserted into source-map validation. Neither counts as a production bug or a killed semantic mutant. The cold fixture now binds after warm loading. A test rejects forbidden server source graphs while accepting safe client maps; its red receipt records the source-map edit failure. The stale ordering-mutant source needle was also repaired and is checked against the current runtime with TypeScript parsing.

## Reproduction and limits

Run from this directory with Node 24 and dependencies installed:

```sh
npm run test:contracts
npm run typecheck
ENDPOINT_ORACLE_SCENARIOS=3 ENDPOINT_ORACLE_SEQUENCES=2 node tests/oracles/sql-effect-rules.mjs
ENDPOINT_ORACLE_MUTANT=omit-order node tests/oracles/e2e.mjs --replay evidence/oracle-solid-repairs/order-replay-red/replay.json
node tests/oracles/e2e.mjs --replay evidence/oracle-solid-repairs/order-replay-red/replay.json
```

Browser runners need local server access and Chrome. Fault runs deliberately exit nonzero; inspect both the semantic outcome and the control attribution. Historical caller red uses `ENDPOINT_BOUNDARY_REVISION=66f9a61a6` for the original four boundary tests. The later runtime-mutant and source-map controls test separate seams.

OG-01 remains optional reporting work. All nine explicit scope deferrals, twelve preserved obligations and four audit evidence limits remain in the lossless ledger. This pass does not add arbitrary PostgreSQL generation, every React-commit observation, general overlapping histories, subset transport, external freshness, durability or WAN latency evidence. The new SQL-effect kernel remains separate from the older compiler integration. Correctness still depends on the stated endpoint/authority contract and independent expected values; hashes, PGlite instances and green controls alone cannot prove that contract complete.
