# TrailBase persisted hydration lifecycle gap

Starting head: `5feb26616a8357853454c2f9ff2ce0b0adb9c908`.
This is the author's executable gap investigation, not an independent review.
It follows the earlier diff-focused audit's surviving M150 cancellation guard.

## Law and missing observation

Cleanup retires a sync run. A list or persisted-baseline completion from that
run cannot change a cleaned-up Collection or a replacement run. The replacement
must retain its own reader and continue accepting events. Accepted durable rows
survive cleanup; the new complete eager result replaces them. Authority:
TrailBase's existing lifecycle law in `tests/ORACLE.md`, the glossary's cleanup
and sync-run contracts, and the shared persisted-startup complete-result law.
The SQLite guide's "Render after SQLite restore" section separately governs
readiness. Restored rows alone do not imply adapter readiness.

The previous persisted-startup grammar never cleaned up during the added
`hydrateBaseline()` await. The lifecycle grammar tested late subscribe/list
results without this persisted composition. Thus neither comparison established
the guard's exact public/durable boundary. A surviving mutant was a real gap in
the evidence, but did not itself establish a production defect.

## Primary-oracle extension

`lifecycle-oracle.property.test.ts` remains the primary lifecycle runner. Its new
directly named companion `lifecycle-hydration-oracle.ts` supplies a small row-set
projection of that law. `lifecycle-hydration-driver.ts` runs real TrailBase sync
inside `persistedCollectionOptions` on each receiving host. It calls actual
baseline hydration before holding its completion. This permits the new run to
use the database while the old continuation is pending, instead of trapping
cleanup behind an unrelated SQLite writer lock.

Three key-subset inputs vary saved, old-listed, and replacement rows. Old work
either completes its list and waits at hydration, or rejects its pending list
after cleanup. The latter is an adjacent earlier boundary and is not counted as
hydration reach. Resume cuts are cleaned-up, replacement loading, or replacement
ready. Default rendering and network-first rendering before its deadline both
remain loading until the source marks ready. Every history finally delivers a
new replacement event.

The shared judgment compares public rows, durable rows, and status after old
work resumes, after replacement readiness, and after the later event. It also
checks cleanup's old `AbortError`, exactly one old source cancellation, reader
release/continued ownership, final replacement release, and error reports
through final cleanup. Obsolete old `begin` attempts are counted for mutant
reach, but the law does not promise zero internal work after cancellation.

## Grammar controls

The original M150 witness reconstructs as saved mask 3, completed old mask 1,
replacement mask 6, and old hydration resumed after replacement readiness.
The fixed corpus reconstructs this in both render configurations and also
resumes at cleaned-up and replacement-loading cuts. Adjacent histories reject
the old list, or make the replacement empty. A rejected list carries old mask
0 because it delivers no row payload; varying an ignored payload would only
duplicate the same history.

Saved rows distinguish durable retention across cleanup. Old listed rows
distinguish accepted pre-hydration writes from the pending omission sweep.
Replacement rows distinguish obsolete insertion, overwrite, and deletion.
The three resume cuts separate authority after cleanup, during a new load, and
after its complete result. List completion versus rejection separates the
hydration continuation from its adjacent error path. The two render options
exercise the same cleanup law through both documented startup configurations;
the long network deadline deliberately leaves the fallback transition to its
existing startup owner.

All eight subsets of three string keys are legal, including empty, identical,
disjoint, and partially overlapping sets. The later key 3 distinguishes a live
replacement reader from a correct result followed by a dead listener. Negative
or out-of-range row masks and resume-before-cleanup histories are outside the
grammar. A rejected list cannot enter the hydration-held state; reach labels
for listed-row overlap/omission also require actual list completion.

## Executed evidence

The initial receiving setup used numeric keys with a controlled host whose
fixture accepts only string keys. That was a fixture failure, not product RED.
An initial readiness assumption also disagreed with the documented SQLite
contract. The model now follows that section: ordinary restore leaves status
loading, and the unfinished old preload rejects when cleanup retires it.
Neither correction changed production or relaxed a prior comparison.

The first corrected unmutated run passes 54 selected checks: 48 fixed histories,
four generated registrations of 50 histories each, and two checker calibrations.
The 99 unselected neighboring tests are not credited by this filtered run.
All nine states are reached separately in every generated host/campaign.

The final unchanged-production command also ran every neighboring registration:

```sh
pnpm --config.verifyDepsBeforeRun=false exec vitest run \
  --config .review-2367/shared-startup.config.ts --maxWorkers=1 \
  packages/trailbase-db-collection/tests/lifecycle-oracle.property.test.ts
```

Result: **153 passed**, including the 99 neighbors excluded from the first
selected run. The new campaigns each execute 50 histories. Reach from that
full run is recorded below; every declared minimum is one per campaign.

| Declared state | Controlled fixed | Controlled fresh | Node SQLite fixed | Node SQLite fresh |
| --- | ---: | ---: | ---: | ---: |
| hydration-held-cleanup | 24 | 22 | 24 | 22 |
| late-list-rejection | 26 | 28 | 26 | 28 |
| resume-cleaned-up | 20 | 21 | 20 | 19 |
| resume-replacement-loading | 13 | 16 | 13 | 12 |
| resume-replacement-ready | 17 | 13 | 17 | 19 |
| empty-replacement | 5 | 7 | 5 | 9 |
| nonempty-replacement | 45 | 43 | 45 | 41 |
| new-row-outside-old-list | 18 | 11 | 18 | 12 |
| old-row-omitted | 11 | 17 | 11 | 10 |

The package's `tsc --noEmit` and scoped ESLint commands pass. No campaign run
budget was lowered. Production remains unchanged.

## M150 experiment and calibration

An isolated copy of `trailbase.ts` removes only the cancellation return after
`await persistence.hydrateBaseline()`. The unchanged source file was never
overwritten. The first attempt failed during scratch-module resolution of
`@tanstack/store`, before any test ran; it is setup failure, not a mutant kill.
After resolving that copy's import through the package's installed dependency,
the same 24 fixed histories per Node host all pass: **48 comparisons GREEN**.

The replacement-ready witness uses saved mask 3, old mask 1, replacement mask 6.
Both hosts and both render configurations record exactly one obsolete `begin`
attempt. Thus this is reached continuation work, not an unreached mutation.
Public and durable rows remain the replacement rows with value 3. The later
key 3 with value 4 arrives, the old reader stays released, the replacement
reader remains usable and releases at final cleanup, and no error is reported.

The outcome is **equivalence within this tested persisted lifecycle domain**.
The wrapper's `sourceParamsFor` retires old `begin`, `write`, `commit`, status,
and metadata authority after cleanup. Core's sync-callback epoch independently
fences retired callbacks. Removing the adapter's local return permits redundant
internal attempts but grants no authority to publish or persist them. A
zero-internal-work promise would be a new law, so it was not invented to kill
this mutant. The cancellation return remains useful and remains in production.
The updated gap CLI calls this same post-hydration edit M151 and independently
reports `survived` / `no-observed-difference`.

The permanent wrong-observation controls erase replacement rows from the
`retiredResume` checkpoint and require the common comparison to reject them.
A scratch driver transformation applies that same row loss to the generated
property. It fails at the intended public-row comparison and shrinks to:

```json
{"previous":0,"replacement":1,"initialRender":"default","resumeAt":"replacement-ready","oldList":"complete","old":0}
```

Captured campaign seed: `-703652111`; shrink path: `0:0:1:0:2:2`.
The guarded replay reproduces that exact `retiredResume` mismatch, with one
execution witness reporting `failed: true`. Removing the scratch row loss and
replaying the same coordinates passes through each Node host, each with one
execution witness reporting `failed: false`:

```sh
TANSTACK_DB_ORACLE_SEED=-703652111 \
TANSTACK_DB_ORACLE_PATH=0:0:1:0:2:2 \
TANSTACK_DB_ORACLE_PROPERTY=trailbase.lifecycle.persisted-hydration.controlled \
pnpm --config.verifyDepsBeforeRun=false exec node --import tsx \
  packages/db/tests/oracle-replay.ts \
  --config .review-2367/shared-startup.config.ts --maxWorkers=1 \
  packages/trailbase-db-collection/tests/lifecycle-oracle.property.test.ts
```

The second receiving replay changes only the property suffix to `node-sqlite`.
The failing calibration uses `.review-2367/trailbase-gap/replay-calibration.config.ts`
instead of the ordinary config. Scratch logs retain the source-mutant,
calibration, replay, typecheck, and lint results.

## Author's rubric audit

This is a self-audit of the new projection against production head
`5feb26616a8357853454c2f9ff2ce0b0adb9c908`, before production edits.

| Requirement | Evidence |
| --- | --- |
| ORC-001 | Existing cleanup/sync-run, complete eager-result, and documented SQLite readiness authorities are stated beside the model; finite limits follow. |
| ORC-002 | Pure set/Map recomputation uses history scalars, with no production transition or classifier imports. |
| ORC-003 | Opening prose, reference computation, grammar, named production driver, and three-cut comparison remain visible in directly named modules. |
| ORC-004 | Reconstruction, ablation, finite ranges, and rejected nearby forms are documented above. Rejected lists have no redundant payload axis. |
| ORC-005 | Real TrailBase and persisted wrapper execute. Actual hydration is held after its work; old completion, replacement readiness, and subsequent event are observed. No missing-input hypothesis remains at those cuts. |
| ORC-006 | Permanent row-loss controls fail the shared comparison. The isolated guard edit reaches obsolete work and is classified as scoped equivalence. |
| ORC-007 | Equal 50-history fixed/fresh campaigns per host, campaign seed 728159, and checked seed-plus-path failure and clean replays. No commands grammar is used. |
| ORC-008 | Not triggered: this projection recomputes observations from a complete finite history rather than introducing persistent reference-machine state. |
| ORC-009 | The file identifies a row-set projection of the primary lifecycle law. Its three checkpoint names map directly to cleanup/replacement boundaries. |
| ORC-010 | Common failure-preserving cleanup retains primary and cleanup errors; error reports remain append-only through cleanup and final reader release is checked. |
| ORC-011 | Not triggered: no named shared semantic fault requires a different formulation. The readiness assumption was checked against the public SQLite contract. |
| ORC-012 | This versioned record names the production head, each applicable outcome, exact mutation classification, and remaining receiving limits. |
| ORC-013 | Replacement-ready and replacement-loading witnesses distinguish late old deletion/overwrite from preserved new rows; empty and nonempty replacement both run. |
| ORC-014 | Controlled persistence and real Node SQLite use the same law, grammar, driver, and comparison. Chromium OPFS receiving results are recorded by the parent integration. RecordApi remains controlled. |
| ORC-015 | All nine actual-entry states have enforced minimum-one reach separately per host and campaign, with counts above. |
| ORC-016 | Fixed histories replay the shared model and comparison. Calibration supplies wrong observations to that same judgment; no separate concrete product answers are embedded in examples. |

## Limits

This projection exercises one cleanup and one replacement run with three string
keys and numeric values, plus a distinct later event key. The RecordApi boundary
and native stream are controlled. It claims no deployed TrailBase SDK-wire
behavior, arbitrary I/O failure, concurrent user mutation, overlapping loads,
unbounded row count, or every intermediate publication. Those broader contracts
remain with their existing primary owners.
