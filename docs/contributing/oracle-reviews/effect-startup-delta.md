# Effect startup delta follow-up

Current implementation: unordered Effects track keys only and preserve graph
update notifications. The [key-only review repair](#review-of-2b3dd8c2d-key-only-unordered-results)
supersedes the earlier retained-value/comparison designs below. Earlier counts,
fingerprints, commands and design claims apply only to their named subjects.

## Baseline restoration

This follow-up restores the accepted Effect metadata owner from
`db38b4e009146af53e46aeeef3206269f5968af8`, without editing its model, grammar,
driver, recorder, comparisons, or reach. Its SHA256 is
`4b738962e30f2b0f55b1894bab1f76334da8d66e6001773bbe24599408bb6130`.
The shared source-metadata model and cleanup support already exist on main.
The owner also rejoins the package's explicit `test:oracles` command.

The baseline is main `bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. Production was
unchanged in baseline restoration commit `9b03e639f769502dccccff7656ba85ab4ca124e8`.
That commit establishes a separately reviewable instrument before the repair.
No execution result was claimed at restoration. The maintainer subsequently
authorized targeted oracle tests, while retaining the prohibition on full builds.
The dated evidence below supersedes the pending execution status.

## Law and preserved evidence

Effect callbacks deliver the query's full before/after delta. An `update`
requires an occurrence that previously entered; a startup-only intermediate
change cannot invent such an occurrence. Explicitly selected source metadata,
previous values, event multiplicity, and active event-key intervals are part of
the comparison. Authority: public `EffectConfig` and `DeltaEvent`, the Effect
guide, `VirtualRowProps`, and the source settlement law. Batch partition is
unconstrained; the check allows empty batches and opaque event keys.

The reviewed pre-release owner has 200 finite histories across structured and
functional projections, single sources, LEFT joins, and both populated-union
orders. It varies independent optimistic outcomes, confirmations, settlement
order, remote followups, peer exit/reentry, and surviving-row next use. It checks
both batch and named callbacks at every declared action cut, continuing after
a mismatch so startup failure cannot erase later evidence.

The preserved review records 152 passes and 64 LEFT-join startup REDs, all
5,512 declared lane/channel/cut cells reached, and 2,692 of 2,756 checkpoint
comparisons passing. The failing checkpoint emits an update for a never-entered
unmatched occurrence. Five hostile callback overlays add intended comparison
failures; legal key renaming, fresh reentry keys and empty partitions retain the
baseline. These are historical results, not fresh results on this branch.

The complete applicable ORC-001 through ORC-016 evaluation, fingerprints,
calibrations, omission attacks and execution commands remain in
[chunk 16 of the accepted campaign record](2026-10-28-pr-2171-oracle-chunks.md#chunk-16-explicit-source-metadata-reaches-effect-deltas-reviewed).
The [release deferral](2026-10-29-pr-2171-deferred-oracles.md) retains the broader
P09–P12 and type-receiver scope. This restoration changes none of those verdicts.

## Baseline repair plan (completed below)

Before production changes, run the restored owner on unchanged main and retain
the actual callback mismatch and all per-cell reach. Then run the same owner
after the repair and with the original defect restored as a hostile mutant.
Preserve neighboring single-source/union behavior, both callback channels,
previous values, empty partitions, and later optimistic settlement/next use.

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm --filter @tanstack/db exec vitest run \
  tests/query/virtual-row-fields-effect-oracle.test.ts --coverage.enabled=false
```

Limits remain eager controlled core sources, scalar projections, one mutation
per source, and the named paths. This supplies no real-provider/framework,
arbitrary scheduling, ordered repair, same-source overlap, or callback-input
sanitization evidence. No GREEN, production repair, or bug-class closure is
claimed by this baseline restoration.

## Executed repair evidence (2026-10-29)

Review identity: baseline restoration `9b03e639f769502dccccff7656ba85ab4ca124e8`,
with production still identical to main
`bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. The repaired
`packages/db/src/query/effect.ts` has SHA256
`b9ea784afe07e156507079224885c73bd21e8633116c3344af809c09971b0879`.
The owner retains the restoration fingerprint above. No model, history,
recorder, comparison, reach requirement, or run budget changed after RED.
This record accompanies the production repair in PR #2301.

### Law, diagnosis, and repair

An Effect update describes a changed row that stays in the result. For a
preloaded LEFT join with a matched row and an unmatched anchor, startup owes
only the two entering occurrences. It owes no update for an intermediate
unmatched occurrence that never entered. The public Effect guide's delta
sections and `DeltaEvent.previousValue` establish this judgment independently
of the graph output.

The original classifier treated any insert plus delete as an unordered update.
Startup emits and retracts an intermediate unmatched row within one graph run.
Its inserted and deleted scalar projections are equal. The callback nevertheless
received that row as an update, followed by the two legitimate enters.
The update's previous and current values were identical, with all right fields
undefined. The independent before/after model rejected the extra event and the
absence of its prior enter in both callback channels.

The initial repair applied the existing `deepEquals` update condition to
unordered Effects. That design used no retained unordered result rows and
checked only scalar projections. The later membership repair retained values,
and the final key-only repair removes both unordered value retention and
comparison. These historical designs are not current implementation claims.

The earlier Effect examples lacked this exact startup delta comparison. The
restored owner checks the complete emitted delta and active key intervals,
rather than inferring correctness from final rows or selected event counts.
No missing-input hypothesis remains for this witness: both source Collections
finish preload before Effect creation, and the correct matched and anchor
enters arrive in the same startup ledger as the extra update.

### Results

The pre-edit inventory comprises structured and functional projections through
actual core `createEffect`, with onBatch and named handlers. Single sources,
LEFT joins and both populated-union orders receive the same source model.
There is no real-provider or framework claim requiring another receiving host.
The unchanged-production neighboring run preceded the production edit.

| Run | Passed / failed tests | Declared reach | Passing checkpoint comparisons |
| --- | --- | --- | --- |
| Unchanged production RED | 152 / 64 | All 5,512 cells: count 1 each | 2,692 / 2,756 |
| Repaired owner GREEN | 216 / 0 | All 5,512 cells: count 1 each | 2,756 / 2,756 |
| Original production restored as mutant | 152 / 64 | All 5,512 cells: count 1 each | 2,692 / 2,756 |
| Suppress all unordered updates mutant | 16 / 200 | All 5,512 cells: count 1 each | Later changed-value comparisons fail |
| Final restored repair plus neighboring suites | 1,906 / 0 | Effect cells unchanged: count 1 each | 2,756 / 2,756 Effect comparisons |

The 200 native histories comprise 8 single-source, 64 LEFT-join and 128 union
histories. The other 16 tests calibrate the shared judgment. Both structured and
functional LEFT-join startup cuts fail in RED. Every later cut continues and
passes, so startup failure does not hide settlement or next-use evidence.
The original mutant restores the entire production file byte-for-byte to the
baseline and reproduces the same startup assertion failures. The second mutant
requires `publishedRows` for updates, wrongly dropping all unordered updates.
It fails the intended changed-value comparisons in all 200 native histories.
Both outcomes are assertion failures at the shared comparison, not setup errors
or timeouts. Neither mutant remains in the source.

Neighboring suites pass 1,690 tests both before and after the production edit:
`effect.test.ts` (74), `effect-disposal-oracle.test.ts` (12), and
`query/virtual-row-fields-oracle.test.ts` (1,604). These retain skipInitial,
previous values, object-valued Set updates, source failure, ordered Effects,
disposal and root metadata observations within their existing bounds.
The baseline remote DB-1 job also fails the same 64 startup cases:
[run 40930211146](https://github.com/TanStack/db/actions/runs/40930211146/job/123646325441).

All local tests use Node 24.19.0 and installed Vitest 3.2.4 on macOS arm64.
The manifest requests Vitest 4.1.12. No dependencies or lockfiles changed.
Full builds remain unrun by maintainer instruction.

Commands run from `packages/db` using the worktree's installed binary:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 ../../node_modules/.bin/vitest run \
  --coverage.enabled=false tests/query/virtual-row-fields-effect-oracle.test.ts

../../node_modules/.bin/vitest run --coverage.enabled=false \
  tests/effect.test.ts tests/effect-disposal-oracle.test.ts \
  tests/query/virtual-row-fields-oracle.test.ts

TANSTACK_DB_ORACLE_STATISTICS=1 ../../node_modules/.bin/vitest run \
  --coverage.enabled=false tests/query/virtual-row-fields-effect-oracle.test.ts \
  tests/effect.test.ts tests/effect-disposal-oracle.test.ts \
  tests/query/virtual-row-fields-oracle.test.ts
```

Each executed command also uses default and JSON reporters. Full logs and JSON
reports remain in `/private/tmp/effect-startup-delta/` under `baseline-red`,
`baseline-neighbors`, `repaired-green`, `repaired-neighbors`, `original-mutant`,
`overcorrection-mutant`, and `final-green`. The finite owner reports every named
reach cell, so the table's count 1 applies to each lane/channel/cut separately.
It does not aggregate away a missing path. No random seed applies to this
exhaustive finite grammar. Running the whole owner reconstructs every witness.

### Self-review against the oracle rubric

The accepted chunk-16 audit remains applicable to the unchanged owner. This
follow-up adds executed evidence on the restored baseline and repaired source.
The review here is a self-review, not a fresh independent review.

| Requirement | Follow-up outcome |
| --- | --- |
| ORC-001 | Public delta law and bounded closure are stated above. |
| ORC-002 | Independent source projection and array differencing remain unchanged. No production classifier computes expected deltas. |
| ORC-003 | Restored literate owner keeps contract, model, grammar, driver and comparison together. |
| ORC-004 | All 200 finite histories run. Accepted reconstruction, ablation, range and exclusion controls remain unchanged. |
| ORC-005 | Actual core Effect callbacks supply both ledgers at every action cut. Preloaded inputs and complete startup output resolve the concrete input-sufficiency question. |
| ORC-006 | Original and overcorrection mutants fail the intended comparisons. All 16 checker controls pass on repaired production. |
| ORC-007 | Not triggered by a random property. This grammar exhausts its finite domain and has direct reconstruction. |
| ORC-008 | No reference-model state changes. Existing source visibility and active key intervals retain their accepted distinguishing actions. |
| ORC-009 | Existing source rows, optimistic state, source origins and active event-key intervals retain their documented mapping. |
| ORC-010 | Primary and cleanup errors remain distinguishable through the shared cleanup wrapper. The owner continues after mismatches and drains after disposal. |
| ORC-011 | No new concrete shared semantic fault requires a second formulation. The matched/unmatched startup result follows directly from the public delta contract. |
| ORC-012 | This versioned record identifies baseline and repaired source fingerprints, results, limits and every requirement. |
| ORC-013 | Equal intermediate startup values distinguish suppression. Later changed values, both settlements and next use reject suppress-all-updates. |
| ORC-014 | No real-provider or framework handoff claim. Sources are controlled core Collections. |
| ORC-015 | Every one of the 5,512 declared cells reaches count 1 in RED, GREEN and both mutant runs. |
| ORC-016 | The restored owner contains shared model/driver comparisons and checker calibrations. No independent expected-answer regression was added. |

### Closure and remaining limits

P09 is repaired within this contract × history × production-path × observation
boundary: exact scalar deltas for eager preloaded core Effects, the 200 stated
histories, both projection forms and both callback channels, at every declared
action cut. No known counterexample remains inside those exercised cells.
This does not establish arbitrary join multiplicity or scheduling, changing join
keys, same-source overlap, ordered repair, real providers/frameworks, or
callback-input sanitization. P10, P11/P12 and the other deferred runtime,
retention and public-type findings remain open under their existing owners.
No broader metadata or general delta-classifier closure follows.

## Subsequent prep-pr review

Review of `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba` found a newly exposed
factorial object-Set comparison path. The [historical Set-work repair](https://github.com/TanStack/db/blob/0b47ee825aaa0c36b199a3c42652cab8d9672ec9/docs/contributing/oracle-reviews/set-equality-work.md)
records its independent model, pre-edit RED, receiving paths, GREEN and mutants.
The scalar startup owner's native model and histories still pass all 216 cases.
Its separate opaque-key calibration repair is recorded below; startup and work
evidence alone would not close that test-integrity gap.

### Key-interval checker calibration

CodeRabbit review `5703351893` on `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba`
identified a compound-fault calibration. The `key-collision` and `key-change`
controls changed only batch keys. Named callbacks retained their original keys,
so cross-channel disagreement rejected the ledger even without the interval
judgment. The checker still enforced continuity; these controls did not isolate
it. ORC-006 requires sensitivity at the intended judgment.

The maintainer accepted this repair. Both controls now put the same bad key in
the matching named entry. `events()` constructs named entries directly from the
batch, preserving their order. No production behavior, independent model,
native history, assertion, exclusion, run budget or reach requirement changed.

Before repair, deleting the interval judgment leaves both controls passing:
the checker mutant survives. After coherent mutation, that deletion causes
exactly two expected-to-throw assertion failures. Removing only the key-stability
assertion from the full repaired owner gives **214 passes and those same two
failures**, with zero skipped tests. Cross-channel agreement therefore cannot
substitute for continuity enforcement.

At that earlier head, the repaired owner passed all **216 tests**. Combined
equality, Collection/Effect receiving, proxy-revert and startup checks passed
**619/619**, including the later-removed Set work. All 5,512 startup
reach cells still count 1; Set-work reach is unchanged. Targeted TypeScript,
ESLint, oracle lint and formatting pass. Tests use at most two workers; no full
build ran. Other applicable rubric outcomes above remain unchanged.

This is a test-integrity repair with a checker mutant, not a new production RED.
These update faults calibrate continuity for a live occurrence. They do not
independently mutate the distinct-key condition on a fresh enter, or establish
arbitrary graph, provider, framework or rich named-callback coverage.

The restoration and execution fingerprints above remain historical evidence.
The current owner intentionally changes only key-fault setup and its explanation.
Its SHA256 is `56de9e93892c6a4772f71846e25fc9e3700359b2cadbe3d6d9b359d7b9bcd46f`.
Review identity is parent `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba` plus that
fingerprint and the Set-work fingerprints. The combined command is recorded in
the Set-work review. Raw checker variants, reports and logs remain under
`/private/tmp/effect-startup-delta/prep-pr/key-calibration/accepted-cr1/`.

## Membership and coalesced source writes

The high review of `d97c1aaf412661e8d5d3e0d528fe5c4667f69d65` exposed a
remaining membership distinction. An absent key can receive insert/delete/insert
in one flush and must enter. A present key receiving delete/insert/delete must
exit. Fresh callable and private-field projections also exposed a startup update
for an unmatched occurrence that never entered. Presence cannot be inferred from
payload equality or gross insert/delete counts.

The existing owner adds 24 finite histories: scalar/callable/private payload,
one source/LEFT join, initially absent/present and separate/coalesced writes.
Independent source snapshots determine the whole expected delta at initial,
sequence, absent, reentry and next-use cuts. Both callback channels compare event
multiplicity, previous readable values and active opaque-key intervals. All 120
new cells reach once. The original 200 histories and 5,512 reach cells stay.
The rich recorder preserves payload kind and readable result, without a claim
about exact re-evaluated instance identity.

Before production edits, the expanded owner on unchanged `d97c1aaf4` failed
14 of these histories at delta/interval assertions. The complete recorded run
passed 631 tests and failed 16, including two separate Set stack probes. The
membership repair passes all 240 owner tests. Restoring the original classifier
fails 14 histories; inferring prior presence from net count alone fails all 24.
Public sync writes inside a real optimistic transaction's scheduler scope reach
the reported three-write histories. No production information is missing at
these observation cuts.

Every Effect now retains its preceding coherent result, including a skipped
initial baseline. Prior membership plus net multiplicity decides membership
at the next cut. Only a continued row compares values to decide an update.
An Effect without update/batch handlers refreshes retained values without that
comparison or an update dispatch, preserving its later exit's value. Public
`EffectConfig`, `DeltaEvent` and the Effect guide supply the authority.

The Effect production and owner files are unchanged from the verified subject
`375e9b26ca93b19cc266dd1ccdfcd10e97e820fc`. Their SHA256 values are:

```text
6835de1fc044efec14f80ce7aa546451c9c1ce6134a1c5198779ee5ebd45c8b9  packages/db/src/query/effect.ts
469415454de90a75db84caaa5b6893ae8fb54a1f85536872070f9a3c54ded1a6  packages/db/tests/query/virtual-row-fields-effect-oracle.test.ts
```

The [exact-head high-review record](https://github.com/TanStack/db/blob/0b47ee825aaa0c36b199a3c42652cab8d9672ec9/docs/contributing/oracle-reviews/effect-startup-high-review.md)
preserves all eight original findings, experiments, hostile variants, grammar
controls, rubric outcomes and reviewer assessment. That historical record's
647-test result includes the now-removed Set work. It is not the current count.
Current claims remain bounded to the declared eager controlled core histories.
Arbitrary provider/framework schedules, changing join keys/multiplicity and
exact rich-payload instance identity remain outside this instrument.

## Maintainer scope revision, 2026-10-30

The maintainer explicitly removed Set performance work from this PR because no
application performance problem had been reported. The old Set matcher returns
byte-for-byte, together with the existing `utils.1`–`utils.40` owner and registry.
New Set models, receivers, properties 41/42, scale/work guards and the dedicated
Set report are removed. Existing laws, comparisons, reach and budgets remain.
The Set work's own new guards retire only with this explicit scope decision.
Their known synthetic limitations remain recorded under the primary deep-equality
owner in the coverage map; resumption requires a maintainer request or a real
workload. Historical generators and full traces remain in commit `0b47ee825` and
`/private/tmp/effect-startup-delta/high-review/`.

The high-review ledger now has three Effect repairs (1, 2, 4), one accepted-design
semantic finding with a release-note correction (3), three explicitly deferred
Set findings (5–7), and one refuted coverage allegation (8). The original
factorial Set work is deferred with those findings. None is relabeled refuted or
closed by removing its test. The Effect membership repair, checker calibration,
callback comparison bypass and equal-projection suppression remain intact.

### Validation after Set removal

The six retained suites pass **581/581**, with zero failures or skipped tests.
They cover the existing change-event equality owner, ordinary utils tests,
proxy revert, ordinary Effects, Effect disposal and the Effect metadata owner.
All 240 metadata-owner tests pass. The original 5,512 reach cells and 120 added
membership cells each reach count 1. Targeted TypeScript, ESLint, oracle lint,
formatting and whitespace checks pass.

The executed local configuration uses the installed dependencies, jsdom,
`tests/test-setup.ts`, a source alias for `@tanstack/db-ivm`, no coverage, and
at most two workers:

```sh
node node_modules/vitest/vitest.mjs run \
  --config /private/tmp/effect-startup-delta/remove-set/focused.config.mjs \
  --reporter=default --reporter=json \
  --outputFile=/private/tmp/effect-startup-delta/remove-set/focused.json
```

The config, log and JSON report remain under that directory. The source alias
changes dependency resolution only. It does not replace the production driver
or independent comparison. The normal repository selectors name the same six
test files. Every `test:oracles` path exists after the removed receiver leaves
the script.

The maintainer separately authorized `pnpm size:compare`, including its normal
package builds. Against merge base `bea84cd4554b7bd49df50cb0c569a34d8b2cd915`,
the typical app remains **96,732 bytes gzip** (0-byte change). The Effects app
changes from **99,303 to 99,340 bytes gzip** (+37 bytes). All other app scenarios
remain unchanged. The DB package adds 20 bytes gzip. The log is
`/private/tmp/effect-startup-delta/remove-set/size-compare.log`.

These results supersede the earlier combined 619/647 counts for the current
scope. Those counts remain historical evidence for their stated subjects.
The Effect source and owner fingerprints above still identify the verified
implementation. Set production, its former `utils.1`–`utils.40` owner and its
registry are byte-identical to the merge base. No full repository test or build
ran beyond the separately authorized size comparison's normal package builds.

## Review of 2b3dd8c2d: key-only unordered results

The ten-item review targets `2b3dd8c2d0a0f98a858dc1d08182f6673c9a7836`.
It supplied no executed tests or builds. This evaluation is a self-review.
The maintainer explicitly chose: "Preserve existing notifications; use keys."
That decision supersedes the earlier general equal-projection suppression
policy recorded above. No oracle expectation changed to match production.
The new model ran RED before production changed.

### Law, experiment and inference

`EffectConfig`, `DeltaEvent` and the live-query guide promise complete delta
values at each callback cut. Handler subsets do not change an exit's current
value or an update's pre-batch value. React promises current callbacks without
remounting. The maintainer's decision preserves unordered graph notifications,
including equal projections, without adding value comparison or retention.

The primary owner adds a shared companion, `effect-callback-oracle.ts`, and an
actual React receiving driver. Sixty finite histories on each path cross:

- Scalar, keyless opaque class, keyed private-field class, prototype method over
  non-enumerable state, object Set and equal scalar projection.
- All callbacks, enter only, exit only, late update and late batch callbacks.
- Initial delivery and `skipInitial`.

Authored scalar source versions determine expected public readable payloads.
Classes and Sets are constructed only in the actual functional projection,
so source-Collection comparison cannot mask or create the reported output cost.
The model never imports production equality or its delta classifier. Both paths
compare initial delivery, an unobserved update, callback replacement, another
update, exit, reentry, next use and disposal. Source updates while absent are
excluded. Removing any profile loses its callback premise; removing any payload
loses its specific comparison boundary. All combinations run, and every one of
480 declared cells on each receiving path reaches once. Original 200/24
histories and their 5,512/120 cells remain unchanged.

The recorder reads actual public payloads, including private-state accessors,
and retains event multiplicity and previous values. Synthesized Set getters
count reads outside the recorder. The restored unordered path traverses no
payload leaves, for any callback profile. This bounds added traversal in these
histories, not Set runtime or arbitrary graphs. The original metadata histories
still check opaque-key intervals and both channels independently.

| Experiment | Result |
| --- | --- |
| Expanded tests on unchanged reviewed production | 264 pass, 96 intended failures: 56 core and 40 React. Original 240 tests pass. |
| Repaired core owner and React receiver | 360 pass, zero failures/skips. |
| Final eight targeted suites | 708 pass, zero failures/skips. |
| Reviewed classifier with refresh skipped for unobserved updates, older tests only | 314 pass; the 120 new histories are deliberately unselected for this diagnostic. The mutant survives. |
| Same stale-value mutant, expanded tests | 338 pass, 96 failures. An exit reports version 0 instead of current version 2. |
| Gross-count prior-membership mutant (`wasPresent = deletes > 0`) | 355 pass, 79 intended callback/membership failures. |

All ordinary runs and full mutant runs preserve per-path reach. The diagnostic
old-test selection is not a normal GREEN claim. Initial React module resolution
failed before collection; explicit aliases to the already-installed React 19.2.4
fixed that setup before the valid pre-production RED. No setup failure counts
as a product or mutant result.

The final repair retains only keys for unordered Effects. The first deletion
in a batch supplies its previous/exiting value. Ordered Effects still retain
coherent values across held graph runs and use their existing comparison.
`observesUpdates` and its creation-time snapshot are removed. Dynamic callback
lookup remains live. The redundant value fallbacks are removed; `deleteValue`
is now necessary for unordered delivery rather than dead state.

A deterministic cardinality probe at 8 and 64 rows confirms that reviewed
unordered Effects added one Map entry per result, holding the same row objects
as callbacks. It did not clone the rows. Disposal cleared that Map. The repaired
path retains no output values in a Map. No total-memory multiplier was measured.

### Lossless disposition

| ID | Technical verdict | PR action and durable value |
| --- | --- | --- |
| R2-01 | Extra per-row Map retention confirmed. "Full copy" and roughly double total memory are unsupported: rows are shared references. | Fixed now with key-only unordered tracking for every handler profile, rather than conditional retained values. |
| R2-02 | Confirmed new comparison path. Scalar sources that synthesize object Sets isolate it from source comparison. | Fixed now: unordered Effects never call the comparator. The removed Set rewrite stays removed. |
| R2-03 | Confirmed: React always supplies wrappers. The claimed unordered comparison bypass did not apply there. | Fixed now through the core repair and real React receiving witness. Existing ordered comparison is unchanged. |
| R2-04 | Confirmed test gap and mutant survival. | Fixed now with callback profiles, replacement, current exit values and a demonstrated stale-value mutant rejection. The obsolete optimization branch is removed. |
| R2-05 | Partially confirmed. Keyless private instances already compare by identity and notify. Keyed instances with constant enumerable fields can hide changed private/non-enumerable state and retain stale values. | Fixed now on the introduced unordered path. The grammar keeps both failing and non-failing representations. No new general class-equality contract is imposed on other callers. |
| R2-06 | Confirmed: the initial observer snapshot prevents later core update/batch installation. | Fixed now by removing the snapshot; actual core config mutation and React replacement both run through the shared comparison. |
| R2-07 | Dead fallbacks are confirmed at the reviewed Map-only subject. Deleting the accumulator field after the key-only repair would instead lose previous/exiting values. | Fixed now by removing redundant fallbacks and restoring the field's required role. No field removal is claimed. |
| R2-08 | Duplicate retention remedy of R2-01. "Wrong layer" is a design opinion, not a demonstrated contract violation. Prior membership is needed beyond a raw gross-count classification. | Duplicate of R2-01; keep this separate ID and its key-only suggestion. The maintainer selected the narrower design in the Effect boundary. |
| R2-09 | Confirmed ambiguous/stale evidence. | Fixed now: historical subjects are explicit, and current owner/receiver counts and implementation are separate. |
| R2-10 | Local-only traces are a durability limit. Squash does not automatically remove GitHub commit blobs: both this PR's earlier blob and merged #2299's pre-squash blob remain accessible. Future retention is not guaranteed by that observation. | Fixed now by retaining essential replay inputs below and finite histories in current versioned sources. Historical blob links are supplementary, and local logs are convenience artifacts. |

Accounting: **10 = 9 fixed-now + 1 duplicate**. Each technical qualification
above survives its action verdict. No new item is deferred. Previously removed
Set engineering work retains the maintainer's explicit scope decision and its
primary equality owner; resumption requires a maintainer request or an actual
workload. Removing the new unordered comparator caller resolves the new
interaction without reopening that optimization project.

Reviewer assessment: **lean hire for static defect discovery, with verification
required before approval**. Callback profiles, live replacement and React
wrappers expose important missing cases. The memory multiplier, blanket private
class claim, unconditional link-loss claim and field-deletion suggestion needed
qualification. The proposed membership-only direction was useful. Severity and
closure require executed evidence.

### Oracle review and remaining limits

This is bounded enforcement of unordered membership, notification compatibility
and callback-visible values for the declared eager source histories and actual
React commits. No known violation remains within these cells. It does not prove
arbitrary scheduling, provider delivery, changing join multiplicity, other
frameworks, ordered opaque-value semantics or exact rich-instance identity.
Other comparator callers retain their previously documented domains and limits.

| Requirement | Current evidence |
| --- | --- |
| ORC-001 | Public delta contracts and explicit maintainer notification decision above. |
| ORC-002 | Authored source-version model; no production comparator/classifier import. |
| ORC-003 | Companion explains contract, model, grammar, drivers and comparisons beside code. |
| ORC-004 | Full finite crossing reconstructs the reports, states axis ablations and bounds, and excludes updates of absent sources. |
| ORC-005 | Core callbacks and actual React hook; current readable values checked after each host/act cut. Scalar source facts arrive before projection. |
| ORC-006 | Stale-value and gross-count mutants fail intended exit/value/membership comparisons. The former survives the old tests. |
| ORC-007 | Not triggered: bounded finite histories, no random property or new run budget. |
| ORC-008 | No stateful reference-state expansion; one authored prior source version suffices for public delta values. |
| ORC-009 | Source version abstracts readable selected payload, with the mapping stated beside model and projection. |
| ORC-010 | Per-cut mismatches accumulate; shared cleanup preserves primary failure and separate cleanup diagnostics. Disposal has its own cut. |
| ORC-011 | No unresolved shared semantic fault is identified for this version-to-readable-payload relation. Other formulations remain outside the bounded claim. |
| ORC-012 | Reviewed head, exact fingerprints, experiments, all IDs and every rubric requirement are versioned here. |
| ORC-013 | Equal versus changed output, keyless versus keyed opaque state, callback presence/replacement and exit after unobserved updates distinguish neighboring wrong designs. |
| ORC-014 | Actual React renderHook/act supplies the callback-replacement premise; each path has separate reach. No other framework/provider claim. |
| ORC-015 | 480 cells per new path, each 1; original 5,512 and added membership 120 remain each 1. |
| ORC-016 | Finite histories use shared model/driver/comparison without per-case expected answers. Scratch retention probes are separate diagnostics. |

The final run selects utils oracle, utils, proxy revert, Effect, Effect disposal,
Effect metadata, React Effect callbacks and ordinary React Effect tests. It uses
jsdom, existing test setup, source aliases for DB/IVM, installed React 19.2.4,
Vitest 3.2.4, no coverage, and at most two workers. Standard selectors are:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false --maxWorkers=2 \
  tests/utils-oracle.property.test.ts tests/utils.test.ts \
  tests/proxy-revert-oracle.property.test.ts tests/effect.test.ts \
  tests/effect-disposal-oracle.test.ts tests/query/virtual-row-fields-effect-oracle.test.ts
pnpm --filter @tanstack/react-db exec vitest run --coverage.enabled=false --maxWorkers=2 \
  tests/effect-callback-oracle.test.tsx tests/useLiveQueryEffect.test.tsx
```

Local execution uses the same selectors in the source-alias config
`/private/tmp/effect-startup-delta/review-2b3dd8c/final.config.mjs`. Reports,
commands, original/mutant snapshots and the append-only raw review ledger remain
in that directory. These local files are supplementary to the versioned
histories, recipe and comparison. Targeted TypeScript and ESLint pass.
The authorized `pnpm size:compare` reports typical app 96,732→96,732 bytes gzip,
Effects app 99,303→99,309 (+6), and DB bundle 109,667→109,668 (+1), against merge
base `bea84cd45`. Other app scenarios are unchanged. No full test/build ran
beyond the size script's normal package builds.

Exact subject: reviewed parent plus the following final source fingerprints.
Documentation-only changes do not alter these executable subjects.

```text
354bbbcf9683c91047c61da1ea2323ed89623628eb6059dacfbb79bd56b85ce4  packages/db/src/query/effect.ts
47e862b092e643309bd804acab7c61c036ed7a345c873ca480f63b807aa4f24d  packages/db/tests/query/virtual-row-fields-effect-oracle.test.ts
ca9e1336e7ceeb243a8e32a49ad2c3c881deaa38334540e85f848122cbaf2d38  packages/db/tests/query/effect-callback-oracle.ts
9ed573ae14bf9bd87058c9136ef1de57f33422da235f6253a9c97f90599cf98e  packages/react-db/tests/effect-callback-oracle.test.tsx
```

### Deferred Set replay inputs

These inputs preserve the earlier synthetic findings without reinstating the
Set rewrite, test campaigns or work budgets. No application incident or new
latency guarantee follows. The existing `utils-oracle.property.test.ts` owner
remains responsible for change-event equality; the maintainer controls whether
to resume the excluded engineering work.

The factorial-work witness uses distinct object members. For size `n`, compare
`new Set(Array.from({length:n}, () => ({value:0})))` with a Set of `n-1` such
objects followed by `{value:1}`. The equality judgment is false. Instrument an
enumerable `value` getter to count reads. The earlier direct `n=4` experiment
observed 128 reads, against its proposed bound of 32. The eight-member Effect
receiver observed 219,200 reads against 1,296 while still returning the correct
equality result. Those engineering bounds are historical and retired.

The stack witness uses `n=2**13` words of 13 coordinates. Let `g(j)=j^(j>>1)`.
For right word `j`, coordinate `k` is a distinct instance of class First or
Second according to bit `k` of `g(j)`, with one enumerable `value:0` field.
Two different classes differ; a plain `{value:0}` can match either class.
Left word `i<n-1` follows right word `i`, replacing the coordinate that differs
from right word `i+1` with a plain record. The last left word copies right word
zero. Each outer Set member is its word array. The complete assignment is
`i -> (i+1)%n`, so equality is true. To create the false neighbor, change every
coordinate value in the last right word to 1, leaving an isolated unmatched
word. The earlier recursive matcher overflowed on both witnesses after setup.
This is a runtime failure, not an equality-assertion rejection. Smaller generated
versions used 2–6 bits and optional one-place right rotation. A recorded greedy
mutant replay used `utils.42`, seed `-75265719`, shrink path `1`; that retired
selector alone does not run on the current registry. The structural recipe
above supplies the inputs independently of the removed generator.

Historical reports at `0b47ee825aaa0c36b199a3c42652cab8d9672ec9` retain broader
experiments. Their links are supplementary; the current source tree now holds
these essential distinguishing inputs, observations and limits.
