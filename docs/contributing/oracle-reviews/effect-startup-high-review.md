# Effect and Set high-review evaluation

## Subject and laws

The supplied review targeted PR #2301 at exact head
`d97c1aaf412661e8d5d3e0d528fe5c4667f69d65`. It contained eight hypotheses,
removed duplicates, and supplied no executed reproduction. This record evaluates
all eight. The append-only raw ledger and full logs are retained under
`/private/tmp/effect-startup-delta/high-review/`.

Effect callbacks describe result membership before and after a publication:
absent/present enters, present/absent exits, and changed present/present updates.
`EffectConfig`, `DeltaEvent`, and the Effects delta table in the live-query guide
supply the authority. Projection equality cannot establish prior membership.
Change-event equality intentionally permits plain/keyed-class compatibility;
a source edit outside the projected result need not produce an update.

Set change-event equality requires a complete one-to-one assignment, including
plain/keyed-class overlap and homologous cycles. The glossary, `deepEquals`, and
the existing descriptor owner supply the authority. Matching many flat members
must return its equality judgment without consuming one JavaScript stack frame
per member. AGENTS.md's efficiency guidance also motivates removing avoidable
allocation and scanning; these measurements establish no latency SLA.

## Experiments before production edits

The whole-review plan grouped membership/value/work findings 1–4, Set assignment
and work findings 5–7, and generator-integrity finding 8. Production files were
byte-identical to the reviewed head until the extended oracle completed RED.

The Effect owner adds 24 finite histories: scalar/callable/private-field payload,
one source/LEFT join, initially absent/present, and separate/coalesced source
transactions. Public sync writes inside a real optimistic transaction's scheduler
scope reconstruct both reported three-write sequences. Independent source
snapshots determine the expected delta. Both callback channels compare event
multiplicity, previous readable values, and active opaque-key intervals at
initial, sequence, absent, reentry and next-use cuts. The rich recorder preserves
payload kind and readable result; it makes no exact instance-identity claim.
The 120 new reach cells all execute once. Original 200 histories remain intact.

The Set owner adds Gray-code descriptor chains. A supplied complete bijection
proves the positive judgment; an isolated column proves the negative judgment.
This small partial specification does not reproduce production's matching walk.
`utils.42` generates lengths 4–64, insertion order and both judgments in each
history, with the existing 100-run fixed/fresh campaign and replay interface.
Two finite 8,192-member cases run through the same model, driver and comparison.
An ordinary source getter and observer-only transforms measured work separately.
No framework/provider behavior is inferred from controlled eager sources.

Unchanged production: **631 passed, 16 failed**, across seven targeted suites.
Fourteen Effect histories fail membership assertions; both finite Set witnesses
throw `RangeError: Maximum call stack size exceeded` during real comparison.
The original 216 Effect tests and other five neighboring suites pass. The
instrumented classifier sees balanced absent startup contributions and the
reported 2/1 and 1/2 insert/delete multiplicities on the real public path.
There is no missing-source-information hypothesis at these cuts.

The exact seven-suite command, used for RED and GREEN, was:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 node node_modules/vitest/vitest.mjs run \
  --config /private/tmp/effect-startup-delta/prep-pr/set-repair/final.config.mjs \
  --reporter=default --reporter=json \
  --outputFile=/private/tmp/effect-startup-delta/high-review/green-sparse-final.json
```

The scratch config selects utils, utils oracle, Set receivers, proxy revert,
Effect, Effect disposal and Effect metadata suites. It uses jsdom, the package
test setup, a source alias for `@tanstack/db-ivm`, two workers and no coverage.
The RED report is `extended-red-final.json`; the same selected paths and budgets
run in GREEN. Mutant configs differ only by the named source transform.
Replay adds `TANSTACK_DB_ORACLE_PROPERTY=utils.42`,
`TANSTACK_DB_ORACLE_SEED=-75265719`, `TANSTACK_DB_ORACLE_PATH=1`, and `-t '42:'`.

## Repair and inference

Every Effect now retains its preceding coherent result membership, including a
skipped initial baseline. Membership plus the net multiplicity decides enter,
exit or continued presence. Value equality decides only a continued row's
update. Retaining rows also preserves the previous callback value; this costs
one map entry and retained row per current result. There is no output Collection.
When neither update nor batch is observed, the runner refreshes retained values
without comparing or dispatching an update, preserving a later exit's value.

Set matching now uses an explicit augmenting-path stack, cached candidate
comparisons and shared active ancestors. An aligned free diagonal needs one
candidate check. The final free column can be rejected immediately when isolated.
A displaced member tries the successor of its former assignment, then wraps
through every candidate. This retains complete reassignment rather than greedy
pairing. Edge storage is linear for aligned Sets and quadratic in the general
case; arbitrary nested graph complexity remains outside the work claim.

The same seven suites now give **647 passed, zero failed**. All 120 new Effect
reach cells have count 1; the original 5,512 cells remain at count 1. Both Set
chain states reach 200 across the two campaigns; each large scale state reaches
once. Existing `utils.41` states remain 200 each and all 180 Set receiver cells
remain once. Targeted TypeScript, ESLint, changed-oracle lint, formatting and
whitespace checks pass. No full build, installation or lockfile edit occurred.

Hostile experiments use Vite `enforce: pre` transforms, leaving checkout sources
unchanged:

| Wrong design | Outcome at the intended boundary |
| --- | --- |
| Exact-head Effect classifier | 14 of 24 new histories fail delta/interval assertions; 10 pass. |
| Infer prior presence from net count alone | All 24 histories fail neighboring delta/previous-value comparisons. |
| Exact-head recursive Set matcher | Small campaigns pass; both 8,192-member comparisons overflow. This is a runtime failure after setup, not a value-assertion kill. |
| Greedy Set matcher with reassignment removed | All four `utils.41`/`utils.42` campaigns reject false inequality. |
| Direct captured replay | `utils.42`, seed `-75265719`, path `1`: one assertion failure under greedy matching, one pass under repaired production. Fixed campaign stands aside. |

An initial transform experiment ran after TypeScript processing: whole-file
overlays failed setup, and a type-annotated greedy replacement did not install.
Those runs are retained and excluded from mutant evidence. The first iterative
breadth-first candidate was interrupted for excessive work on the finite scale
witness; no GREEN is attributed to it. The final depth-first candidate passes
without changing any reach, assertions or budgets.

Work probes on identical inputs:

| Input | Reviewed head | Repaired |
| --- | --- | --- |
| Effect replacement, enter/exit handlers only | 4 selected leaf reads | 2 reads; no update callback |
| Same replacement, update or batch handler | 4 reads | 4 reads; corresponding update delivered |
| Aligned object Sets, sizes 8/32/128/512 | 8/32/128/512 ancestor-map copies; 36/528/8,256/131,328 occupied-prefix checks | Zero map copies; 8/32/128/512 candidate calls |

## Finding ledger and reviewer assessment

Technical validity, PR action and durable value remain separate. Raw findings
retain their source-order IDs in the scratch ledger.

| ID | Technical verdict and severity | PR action / durable value |
| --- | --- | --- |
| HIGH2301-1 | Confirmed, high: callable and opaque payloads expose the phantom startup update. Nondeterminism is unnecessary to establish the defect. | Fixed now; retain representation-independent membership histories. No general promise about nondeterministic projections is introduced. |
| HIGH2301-2 | Confirmed, high: both grouped three-write sequences emit update instead of enter/exit. Net count alone is insufficient. | Fixed now; retained membership plus net count, with separate/coalesced and next-use witnesses. |
| HIGH2301-3 | Described suppression is real; the correctness accusation conflicts with accepted projected-result/change-event equality semantics. | Accepted design for semantics. Changeset now explicitly documents general equal-projection suppression and class/plain compatibility remains tested. |
| HIGH2301-4 | Confirmed avoidable work, low; no measured latency consequence. | Fixed now; handler demand bypasses comparison while retained state stays current. Preserve the deterministic work probe. |
| HIGH2301-5 | Confirmed redundant per-pair map allocation, low. | Fixed now; share active ancestors, preserving cycle and assignment comparisons. |
| HIGH2301-6 | Confirmed quadratic occupied-prefix scanning for aligned Sets, medium. | Fixed now; direct diagonal path measured at one candidate call per member. No general linear-matching claim. |
| HIGH2301-7 | Confirmed flat-member stack overflow, medium. The reviewed code inherited this risk. | Fixed now; iterative reassignment with shared generated and finite scale judgments. Arbitrary nested depth is distinct. |
| HIGH2301-8 | Refuted as stated: ORC permits bounded exhaustive structural dimensions. The scalar arbitrary generates real variation. | No grammar removal. Same-arbitrary sample at fixed seed has 69 scalar values and both reversals; reach 200 never meant 200 distinct shapes. New structural-length coverage belongs to finding 7. |

Loss audit: **8 = 6 fixed-now + 1 accepted-design + 1 refuted**. There are no
review-item deferrals, duplicate dispositions or known open violations in this
bounded repair. The documentation subclaim of item 3 is also repaired. There
are no newly confirmed sibling defects outside those IDs. This is a self-review;
no new independent reviewer was delegated.

Reviewer recommendation: **lean hire for defect discovery, with verification
required before approval**. Prioritization was good: both leading hypotheses
reproduced through public APIs. Six useful engineering findings survived. The
report supplied no executed evidence, suggested net count without prior
membership, treated accepted equality as a correctness defect, and incorrectly
called finite enumeration pinned-only coverage. It is useful hypothesis input,
not sufficient PR approval evidence.

## Oracle conformance and limits

| Requirement | Evidence / applicability |
| --- | --- |
| ORC-001–003 | Accepted authority, explicit limits, independent snapshot/descriptor judgments and prose beside contract, grammar, driver and check. |
| ORC-004 | Reconstruction: both coalesced sequences and long chains. Ablation: representations expose equality-dependent startup; grouping exposes net membership; length exposes flat recursion; isolated column distinguishes false. Bounds are 24 finite histories, generated 4–64 and finite 8,192 members. Illegal source actions and unsupported non-witness descriptor graphs are excluded. |
| ORC-005–006 | Actual public callbacks/direct equality run before edits; both channels and future cuts are compared. Original and adjacent wrong implementations fail as classified above. |
| ORC-007 | `utils.42` runs identical fixed/fresh 100-run campaigns. Captured seed/path replay executes directly. Finite histories and scale cases are deliberately exhaustive/fixed, not random campaigns. |
| ORC-008–009 | Effect expected results remain stateless source recomputation; the callback ledger retains active opaque-key intervals only. Readable rich payload is an explicit abstraction of production values. Set descriptors represent independently authored member compatibility. |
| ORC-010 | Effect failures accumulate without stopping later cuts; shared cleanup preserves primary and secondary failures. Set witnesses own no external resources. Replay retains the same false-equality violation. |
| ORC-011 | No unresolved shared semantic-fault hypothesis: source recomputation differs from weighted deltas; supplied bijection/isolation differs from matching search. These formulations are directly exercised. |
| ORC-012–014 | This versioned record identifies subject, paths, bounds and mutants. Triggering and adjacent controls include balanced/unbalanced, present/absent, scalar/rich, assigned/isolated and separate/coalesced cases. No controlled premise is credited to a real external provider or framework. |
| ORC-015–016 | Reach counts above; fixed witnesses use shared model/driver/check, with no private expected answers or ordinary unit tests added to oracle files. |

The law is encoded and asserted at every cut within the stated finite grammar.
Evidence does not prove arbitrary histories, changing join keys/multiplicity,
provider timing, framework callbacks, exact rich-payload instance identity, or
arbitrary cycle topology/nested-value depth. Existing ordered repair, scalar
metadata, Set receiving, draft comparison and disposal tests remain green. No
assertion, equality law, run budget or reach minimum was weakened.

Whole-PR readiness is separate: the old 26 green checks cover `d97c1aaf4`.
Final-head remote CI and review must cover the new patch before merge readiness
can be claimed. No merge is authorized by this evaluation.

## Reviewed source fingerprints

These SHA256 values identify the repaired executable subject against parent
`d97c1aaf412661e8d5d3e0d528fe5c4667f69d65`. They exclude this evidence record.

```text
6835de1fc044efec14f80ce7aa546451c9c1ce6134a1c5198779ee5ebd45c8b9  packages/db/src/query/effect.ts
1cad064d83d744c0616fe84066b19b753fbad00d543b69f6944bfb06de2f0ff7  packages/db/src/utils.ts
469415454de90a75db84caaa5b6893ae8fb54a1f85536872070f9a3c54ded1a6  packages/db/tests/query/virtual-row-fields-effect-oracle.test.ts
6203a3d9bd5663a5ee7c14b5c66e0e139bbf7fe2d9afb09650cd01e31c1760f1  packages/db/tests/set-equality-oracle.ts
c84a3d24f2ed2cbb251c5ea758c36a36234fef18e09d82a608929d696e1d6816  packages/db/tests/utils-oracle.property.test.ts
043e546f9a2bf3ba52395c8c9d203456bf63f4fa481b0b4883fe4a56b24f448e  packages/db/tests/oracle-config.ts
```

## Exact reviewed repair commit

The executable subject is `375e9b26ca93b19cc266dd1ccdfcd10e97e820fc`.
The source fingerprints above match that commit after the pre-commit hooks.
This appended entry binds the 647-test GREEN, 22 diagnostic passes, targeted
type/lint checks and eight-item audit to that exact subject. The following
documentation commit adds only this binding, without changing executable code.
