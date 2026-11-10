# Actual v3 receiving qualification

The exact scope/default, positive-quarter-2 receiving case passed. The captured
outer command exited 0, and its supervised receiving child exited 0. One test
passed and nineteen tests were skipped. This qualifies that fixed receiving
case, subject to the existing provenance limits below. Root classification is
still required. This report admits no further runtime.

The reviewed source packet has recorded HEAD
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`. Its frozen source tree, rather than
the coordinator's moving working tree, is the subject. The source freeze is
`d651df85eb08ff46d8e68bd01b6fcc644f18a6a8efbb4b52ef557af0fd6a2fcd`.
The actual result freeze is
`19e653540452eaa9df8230f32e7a4de68238a2a059ef26ab180ed9005218fc66`.

## Law, experiment, and inference

Architecture law 9 requires reads, events, and downstream queries to observe
the same complete graph result. The virtual-row-fields owner additionally
requires correct output attribution and complete prior values. The recorder
must preserve observation-stage boundaries so the post-run checker applies
the same stage judgment as the realtime checker. ORC-005 and ORC-010 require
that capture retain the distinctions needed by those comparisons.

The v2 result failed after its child exited successfully: its retained trace
dropped the follow-up boundaries while retaining the later rank-35 callback.
The parent consequently judged that callback against the rank-30 reload stage.
The actual v2 failure, its raw receipts, and its source/result freezes remain
unchanged. That failure was a recorder defect, not a product RED result.

The independently reviewed v3 source correction retained the two missing
boundaries. It changed no production file, model, comparison, driver, finalizer,
or budget. Earlier pure controls showed the old selector reproducing the
failure and the corrected selector preserving the same shared checks. This
actual run supplies the separately admitted receiving witness for that source
correction; this audit launched no native test.

The raw v3 trace contains 206 contiguous receipts. The exact frozen selector
projects them to the 23 recorded outcome receipts. It now retains
`followup-start` at sequence 162 and `followup-publication` at sequence 185,
alongside the actual root and downstream callbacks at 182 and 183.

The observed sequence is coherent:

- Initial and held public snapshots contain row 4 at rank 40.
- The completed reload publishes row 3 at rank 30 at both receiving layers.
- Source acceptance precedes source application at sequence 177. The new
  acquisition reaches fulfilled applied settlement at 181.
- Each layer emits exactly one update of the retained public key from rank 30
  to 35. Each `previousValue` is the complete rank-30 row, including all four
  virtual fields. The other fields remain unchanged in this bounded profile.
- Accumulating all actual change messages independently reproduces each
  callback's synchronous entries and rows, including empty batches. The
  downstream callback's upstream entries match the root callback's entries.
- The final follow-up reads match both callbacks, report ready without a sync
  error, and precede normal worker cleanup at 206.

The original and preserved raw files agree byte for byte: 1,948 inner files
contain 31,374,418 bytes; three outer files contain 13,685 bytes. The audit also
rehashes the prior failed v2 capture, all 589 frozen v3 source files, all 511
declared production files, 2,544 own payload files in nine named dependencies,
the four reuse links, the Node binary, and both lockfiles. These checks pass.

The pre-run and captured prelaunch source preflights agree except for their
declared gate and the latter's passive candidate inventory. Post-run source
identities agree. Root's accepted shared-toolchain recovery and its four
prerequisite pointers retain their pinned hashes. This does not broaden that
recovery's accepted scope or create a new dependency baseline.

## Execution and provenance

The captured launcher process names the admitted direct zsh command and exact
binding. The stored tool completion reports outer exit 0 separately from child
exit 0. The recorded unique candidate agrees with the canonical history,
selected source root, prepared/supervisor records, writer, and worker start;
it was absent from the passive baseline. Selection was not based on first-new
or modification time.

The recorded original identities are outer PID/PGID 12461, receiving parent
12597, detached leader/target group 12600, and writer 12603. Six captured
absence checks report empty process matches and ESRCH for those recorded
identities. This audit made no process probe or signal call.

The supervisor finishes in `final-with-binding`, after 2,443 ms, with maximum
sampled group RSS of 481,460,224 bytes. It records no kill, heap diagnostic,
prefix violation, warning, primary realtime observation error, or cleanup error.
The unchanged containment is 20,000 ms wall, 1 GiB group RSS, 384 MiB heap,
and 1,000 ms post-enqueue window. The test's 60-second timeout is not a hard
outer watchdog.

Binding verification reports 815 bound module entries and no failures. The
163-module startup seal, five evaluated registry cuts, captured evaluated/V8
bytes, and later sealed-module identities agree. Positive callback stacks
include the real source-update path. These observations preserve the existing
limits: startup compilation may include unused scripts; the inspector stops
before the history; this is not precise runtime coverage.

All 31 required reach counters are reported as one. The frozen parent `run()`
awaits receipt processing, validates the outcome, then calls `metadata.finish()`.
The selected fixed callback awaits `run()` before `reach.assertReached()`.
Its passing result supports completion of both calls under the existing
source-to-parent invocation assumption. There is no dedicated runtime finish
or reach-assert receipt, and no new V8/invocation provenance for the parent
checker. Counter output alone would not have established this: v2 printed the
same counters before failing ahead of finish.

## Scope and remaining work

This case receives a direct eager source-sync update through an established
real QueryClient graph. Its output metadata is stable. Copying current metadata
onto a correct prior ordinary row is therefore equivalent within this profile;
the full-current-row control's rejection does not establish changing-metadata
sensitivity.

No strict conflicting-cache progress repair, generated campaign, fetched-marker
transition, changing-metadata behavior, production-mutant result, or bug-class
closure follows. The supervisor also lacks a persisted initial actual getpgid;
its recorded target-group absence retains that limit. The nine package-own
maps do not establish complete transitive host/native/dist equivalence.

The v3 selector defect is repaired and its same-path fixed receiving result is
qualified. Broader metadata and progress obligations remain with their existing
owners. No oracle or production repair was made by this reviewer. Whole-PR
readiness is not assessed.

## Evidence ledger

This is a continuation of the existing review, not a new external-review item
inventory. No raw finding is dropped or reclassified by this result.

| Claim | Verdict | Evidence and action |
| --- | --- | --- |
| Corrected selector preserves follow-up stages | Confirmed | Raw-to-retained exact projection includes sequences 162 and 185; earlier source/pure calibration remains preserved. |
| Same fixed receiving case is GREEN | Qualified | Actual outer 0 / child 0, one selected test passed, all 31 required counters, exact source/order/pass finalizer evidence with the stated limit. Root classification is next. |
| Actual same-key prior-value receiving path reached | Confirmed | Root 182 and downstream 183 each contain one complete rank-30 to rank-35 update; callbacks, accumulated events, and final reads agree. |
| Product bug class is closed | Not established or claimed | This is one fixed stable-metadata source-update case. No product change, generated campaign, or production mutant ran. |

The author correctly separated v2's recorder failure from product behavior and
kept the scope of v3 credit bounded. This pass adds no hiring assessment of the
original external reviewer; that assessment belongs to the consolidated review.

## Reviewer artifacts

The independent read/hash/JSON audit passed with exit 0:

```text
python3 -I -B <this directory>/metadata-update-receiving-actual-review-v3.py
```

Audit JSON SHA256:
`5285efff4745919f55366d6b566aa580cdb73350076c9ae7d3976eb473ea2918`

Audit script SHA256:
`f2912d163bd1dbd914d6e27a967934747bc8421628d5bf12d6c96c33be3b7897`

Only additive reviewer artifacts were written. There was no native launch,
process probe, source edit, install, lint invocation, Git/PR action, or canonical
import. The coordinator owns the next documentation lint gate. Slot 4 is
returned idle with this report; no next command is admitted.
