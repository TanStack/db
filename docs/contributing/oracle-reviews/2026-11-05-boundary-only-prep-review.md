# Boundary-only metadata: prep review

This record follows the [implementation snapshot](2026-11-05-boundary-only-metadata.md).
The review started with that uncommitted implementation on
`8feab6ea3eaae4456f738da39fa93508ddd5cc01`, also the fetched `origin/main`.
The maintainer's boundary-only decision remains the authority: intermediate
values retain authored fields; actual Collection publication supplies genuine
metadata. No further product-law change was needed for these repairs.

## Publication attribution and nested propagation

**Law.** Structured whole-source selections/spreads and functional direct-source
returns retain genuine source attribution. Authored overrides cannot forge it.
An implicit joined namespace combines sources and receives output Collection
metadata. Internal materialization must preserve parent correlation and complete
descendant values while callbacks remain free of private compiler state.
Authority: the maintainer decision and the live architecture's route-context,
nested-propagation and publication laws.

**Gap and repair.** MAT-1 and MAT-2 shared a missing boundary: resolving inherited
inline inputs removed attribution and route sidecars from the internal
namespace. The compiler now retains that namespace bookkeeping while replacing
its aliases with resolved values. Callback sanitation remains at the public
input boundary. RUNTIME-1 assigned main-source metadata to an implicit joined
namespace; this output now retains output attribution. The extended route
grammar also exposed SIBLING-1: joined QueryRefs dropped inherited include
descriptors, so even expression selections lost grandchildren. The join compiler
now propagates those descriptors into the containing query.

**Reach.** The publication owner adds 102 finite histories: implicit single/join
and functional direct-source returns after absent/array/singleton input,
direct/QueryRef receivers, each source's held write and every authored collision.
It compares physical entry keys and full readable rows at initial preload,
held mutation, settlement without confirmation and remote next use. Its 72
declared path/source/cut states cover 408 comparisons: 24 implicit states each
reach once and 48 inline-return states each reach eight times.

The route owner adds FROM/JOIN QueryRef × expression/functional return ×
array/materialized inherited input. Three parents have disjoint and shared
routes. All three outer forms are observed at initial, parent move, child move,
grandchild update, empty result and reactivation. All 432 comparison states
and eight callback-group states each reach once. Independent
source-array recomputation supplies expected membership; missing grandchildren
remain `undefined` in observations, so omission cannot pass as an empty value.

**RED.** Before any production repair in this review, the publication owner
failed 56 of 1,706 tests; all 1,604 prior tests passed. Four implicit joined
histories and 52 materialized direct-return histories failed. The route owner
failed six of 202 tests, with all 192 prior tests passing. FROM/functional
histories lost children; JOIN expression and functional histories lost
grandchildren. The publication command was:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm --dir packages/db exec vitest run \
  --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false \
  tests/query/virtual-row-fields-oracle.test.ts
```

The route command substitutes
`tests/query/includes-context-transport-oracle.test.ts`.

**GREEN.** The repaired four-owner run passes 6,883 tests: publication,
route-context transport, callback input and nested payload work. A broader run
passes 9,819 tests in 25 runtime files. The final four-owner rerun after the
minimal attribution branch adjustment also passes 6,883 tests.

**Mutants.** Three separate semantic reversions fail assertions in the two
extended owners (1,908 tests): remove internal namespace-sidecar preservation,
56 failures; restore implicit main-source attribution, four failures; discard
joined include descriptors, four failures. Sources were restored byte-for-byte
after each. These were comparison failures, not setup errors or timeouts.
The attribution mutant preceded the final narrowing of that branch to the
witnessed `query.join` condition; the final owner rerun binds the narrowed code.

**Limits.** These extensions cover eager synchronous sources, one QueryRef
receiving boundary, two child rows and one successful held mutation. They do
not establish arbitrary recursive depth, rejected-write combinations, provider
delivery, framework timing, callback counts or ordered-result guarantees.
Existing temporal/publication owners retain their separate claims.

## Payload checker independence

ORACLE-4 was an enforcement defect in the test, without a demonstrated
production mutation. Expected document content shared the object supplied to
production. A hostile `document.tick = -1` mutation falsely passed both prior
campaigns. Expected content now comes independently from block count and tick;
a separate assertion retains the source-reference identity law. The same
mutation then fails value assertions on all fourteen paths in both campaigns
(seed 2355, path `0`). Four retained wrong-observation calibrations exercise the
shared checker. The full work owner passes 51 tests. Its grammar, descriptor
budget, observation cuts and fixed/fresh run counts remain unchanged. Descriptor
counts still measure only metadata discovery through the two instrumented APIs.

## Public types

**Law.** Structured references preserve authored intermediate fields and their
types, without inventing metadata. Statically empty grouping contributes no
key; nonempty grouping or a visible aggregate contributes a missing intermediate
key. Publication still replaces reserved names. Authority: the maintainer's
boundary-only decision, the established grouping behavior and public-type owner.

**Reach and repair.** The same 24 finite source descriptions add 48 structured
reference states, 12 selected-context states, 48 grouping-boundary states and
12 aggregate depth/collision states. Structured WHERE/SELECT and grouped HAVING
use authored fields; QueryRef values, inline results and Collection rows share
the independent declared-shape check. Empty callbacks/helpers before/after
selection, accumulated grouping and explicit-context helpers distinguish nearby
legal forms. Depths 0/7/8/9/10/16 distinguish removing the cutoff from moving it.
The compiler no longer enriches structured source/selected refs. An empty-list
overload retains the previous context; aggregate inspection stops at expressions,
wrappers and exact recursive ancestors instead of a numeric depth cap.

**RED and chronology.** Legal public construction and source consumers rejected
TYPE-1, TYPE-2 and TYPE-3 before production edits. The initial decisive replay
reported 222 TS2344 constraints, and the full campaign failed 24 consumers with
nine passing controls. Ten pre-edit selected-context reserved-name constraints
also independently rejected TYPE-SIBLING-1. Sixteen additional scalar-carrier
constraints in that first replay had an invalid expected type and are **not
credited as product evidence**: public `Ref<literal>` is a recursive mapped Ref,
whereas a structured field uses the carrier
`PublicRef<{ value: declaredLiteral }>['value']`.

After the first static repair, that expected carrier was corrected. All three
original builder files were restored and their hashes verified. The corrected
replay failed 214 TS2344 constraints only, including the same ten selected-name
failures and eight genuine selected-scalar mismatches. This scalar-value witness
is retrospective relative to the first edit; it is not a strict pre-edit
witness. The earlier legal name comparison already exposed the selected-root
enrichment defect. Syntax/admission fixture failures were separately corrected
before the review-wide production gate and are not counted as RED.

**GREEN and mutants.** The final owner passes 33 checks; the existing strict/loose
grouping mode checks pass five. The final-checker original-all reversion rejects
214 native constraints. Isolated original context enrichment, selected-context
enrichment, unconditional grouping and depth-eight cutoff reject 164, 18, 32 and
eight constraints respectively. All are TS2344 comparison failures; no setup
error or timeout supplies rejection. Original sources were restored byte-for-byte
after each mutant. Source-only TypeScript has zero diagnostics, and the ESM/CJS
declaration build passes. The three builder files emit identical JavaScript
before/after these type repairs, with comments removed.

**Limits.** This is source-public inference evidence. Installed-package resolution,
framework handler inference, broad dynamic key-list emptiness and aggregate
expressions that erase provenance remain separate limits in the coverage map.
The empty-list repair does not claim to infer arbitrary runtime array lengths.
The normal logger suppressed per-state counters. A diagnostic-only file writer
then captured the existing counters during the same full 33-check command:
all 256 declared states reached 24 times. By family: root 40, inline 26,
authored 48, structured refs 48, selected context 12, grouped 18, grouping
boundary 48, aggregate depth 12 and four remaining admission/reference states.
The owner was restored byte-for-byte after capture; its SHA-256 is
`945b3a87eef798d163f72211b5f9dda9b7f567ee9b3278643c087b85c2253b2c`.

An additional public native/runtime probe executes the coverage map's broad
key-array trace. `Array<PublicRef<{ id: number }>['id']>` initialized to `[]`
selects the general grouping overload: TypeScript accepts the intermediate
`$key` assignment to `string | number` with zero diagnostics, while the callback
observes `undefined` and no `$key` property. Pre-2312 sources reproduce it.
This separately recorded dynamic-emptiness inference gap is outside the
statically empty-list repair; no runtime grouping behavior was changed.

## Lossless review ledger

Raw reports and exact logs are preserved under `/tmp/db-prep-pr-2026-11-05`.
The append-only scratch ledger records the review-wide oracle plan and global
RED gate before production changes. Invalid static fixtures were repaired
before that gate; their setup failures are not counted as product RED.

| ID | Claim and technical verdict | Action and durable evidence |
| --- | --- | --- |
| S1 | P3: the join merge closure has one caller; inlining preserves statement order. | Approved and applied; preserves alias deletion/replacement order. See the S1 follow-up below; no latency claim. |
| S2 | P3: the retired inline-policy argument and pure flags are unused. | Approved and applied; existing input owner passes 4,924 checks. See S2 below. |
| MAT-1 | P1: inline input resolution erased genuine source attribution. | Fixed; publication grammar, RED56 and namespace mutant above. |
| MAT-2 | P1: the same boundary erased correlation and lost children. | Fixed; route grammar, RED6 and namespace mutant above. |
| RUNTIME-1 | P1: implicit joined outputs inherited repeated source keys/Collection ID. | Fixed; implicit output grammar and attribution mutant above. |
| TYPE-1 | P2: structured QueryRef refs fabricated metadata/corrupted authored types. | Fixed; type repair and generated receiving evidence above. |
| TYPE-2 | P2: statically empty grouping promised an absent key. Independently reproduced on base and candidate. | Retained for repair despite being pre-existing; static empty/nonempty/accumulation grammar. |
| TYPE-3 | P2: depth-eight aggregate cutoff lost the generated intermediate key. | Type repair with depth neighbors; distinct from wrapped-expression provenance limit. |
| BENCH-1 | P3: suite CSV omits scenario, yielding 72 duplicate identifiers across 504 observations. | Approved and repaired from original reports; all 504 timing rows remain unchanged. See BENCH-1 below. |
| BENCH-2 | New remote three-repetition calibration remains unobserved. | Accepted evidence limit, disclosed in benchmark README and final PR. |
| BENCH-3 | Legacy reports lack repeated-range gating. | Accepted design: documented single-run support; actual CI supplies three repetitions; 19 CLI controls pass. |
| BENCH-4 | Fabricated scalar/sample reports can disagree. | Harness derives both from the same observations; no actual workflow violation demonstrated. External input-integrity idea retained here. |
| BENCH-5 | Within-query geometric means permit offsets. | Accepted declared policy; independent localized gate covers persistent large case shifts. |
| BENCH-6 | Fixed candidate-before-base order can bias timing. | Accepted measurement limit; no demonstrated threshold violation or direction-bias claim. |
| BENCH-7 | Nested fixtures allocate even for flat queries. | Identical fixtures on both variants, outside timed sections; no invalid comparison demonstrated. GC independence is not claimed. |
| ORACLE-1 | Prior callback normalization was retired. | Accepted design under explicit maintainer decision; historical evidence retained. |
| ORACLE-2 | Descriptor counters miss other traversal algorithms. | Accepted bounded work law; elapsed measurements are separate evidence. |
| ORACLE-3 | Input owner omits actual flat-union root metadata. | Accepted observation split; publication owner judges genuine attribution. |
| ORACLE-4 | Shared expected payload could hide production mutation. | Fixed checker independence; hostile false-GREEN then RED, clean GREEN51 above. |
| ORACLE-5 | Omitting selected context could conceal private symbols. | Already fixed before review: symbols captured before omission; original RED198 and mutant in implementation record. |
| MAT-3 | Two compiled resolver calls could repeat work. | No measured regression or once-only contract; implementation freedom retained. Profiling idea preserved here. |
| TYPE-R1 | General intermediate type enrichment removed. | Duplicate of approved policy ORACLE-1; source ID retained. |
| TYPE-R2 | Wrapped aggregate expression erases type provenance. | Existing recorded inference limit, with concrete trace and public-type owner in coverage map. |
| TYPE-R3 | Dictionary publication intersections might conflict. | Original reviewer clarified this was only an unverified hypothesis, without a consumer or violated law. Refuted as a finding, not an executable refutation of dictionary behavior. |
| SIBLING-1 | Joined QueryRefs lost inherited grandchildren even in expression controls. | Fixed descriptor propagation; generated JOIN route cells and hostile mutant above. |
| TYPE-SIBLING-1 | Structured selected-context roots had the same enrichment as TYPE-1. | Fixed; added to static receiving grammar before repair; chronology above. |

The raw inventory contains 24 items; the two sibling violations remain distinct.
Reviewer assessment: **hire: yes**. The team produced independent public
counterexamples, precise missing grammar dimensions and useful low-cost cleanup
suggestions. TYPE-2's initial introduced classification needed correction;
TYPE-R3 remained speculation. The simplifier correctly retained distinct cache
roles, sidecars, compiled resolution and generic adapter fallback.

## Evidence locations and interpretation

`publication-red-detail.log`, `publication-red-results.json` and
`publication-red-manifest.json` retain publication RED and pre-edit source
hashes. `mat-2-context-transport-red-refined.log` and
`mat-2-context-transport-full-red.log` retain route observations and reach.
`runtime-final-green.log` and `runtime-broad-green.log` retain GREEN;
`mutant-*.log` and `runtime-mutants.json` retain mutation/restoration evidence.
`oracle4-hostile-before.log`, `oracle4-hostile-after.log` and
`oracle4-green.log` retain the checker calibration. These local logs supplement
the versioned laws, counts and source bindings in this record.

The source-public static owner and runtime Collection paths provide different
judgments. A source-only compiler check does not establish installed-package
resolution, and a successful core receiver does not establish provider or
framework scheduling. Whole-PR readiness requires the final pushed head and
remote CI; this record alone supplies neither.

The [source and reach manifest](2026-11-05-boundary-only-prep-sources.json)
records every changed production/oracle/harness/workflow SHA-256, the three raw
benchmark report hashes and every measured state count. Diagnostic-only file
writers captured normal-run counters: 1,908 runtime tests pass, publication
counts are 24 states at one and 48 at eight, and all 440 route/callback states
reach once. Both runtime owners and the type owner were restored byte-for-byte.
The type reach command passes 33 checks in 84.39 seconds. Source-only TypeScript
and declaration builds pass; an earlier whole-test-tree TypeScript run exceeded
the default 4 GB heap and is not a passing check.

## Final latency and shipped size

The [bracketed measurements](../../../scripts/bench/boundary-only-prep-bracket-2026-11-05.csv)
retain all 756 observations, including scenario identity. The sequence is
pre-2312 sources, final reviewed candidate, then unchanged pre-2312 sources.
Each report covers 84 cases with three fresh fixtures, 100 measured writes and
20 warmups on Node 24.19.0 / Apple M5 Max. No agent test or build ran alongside
these measurements. Other machine activity was not measured.

Both archived baselines contain DB sources from `035a5260`, the exact current
harness and current dependencies/built db-ivm. This isolates DB source versions;
it does not reconstruct the historical dependency installation. The reports'
automatic git SHA names the containing checkout (`8feab6ea3`); the CSV records
the actual source variant. The final source manifest linked below binds the
candidate, harness and raw reports. CI instead compares the PR's merge base.

| Comparison | Overall writes | Overall cold | Nested writes | Nested cold | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Candidate / first baseline | 1.138× | 1.354× | 1.114× | 1.396× | FAIL: issue-detail cold mean 1.568× |
| Candidate / second baseline | 1.038× | 1.051× | 1.038× | 1.157× | PASS |
| Second / first unchanged baseline | 1.096× | 1.288× | 1.074× | 1.207× | PASS |

The baseline drift explains why the first pair cannot establish a source-only
regression. The later PASS cannot erase that failure either. The earlier
0.88×/0.91× figures describe a different implementation snapshot and run. These
finite observations establish neither identical latency nor universal zero
overhead. The new gate's thresholds were not changed after the failing result.

For the reported 10,000-issue case with no manual indexes, synced cold times
are 63.124 / 67.367 / 65.224 ms, and optimistic cold times are
50.606 / 86.135 / 80.985 ms, in sequence. Candidate write medians are
0.023375 ms synced and 0.159042 ms optimistic. Historical regressed main took
about 2,090 ms cold in this case; that earlier separate run establishes the
large regression's scale, not a controlled ratio against these final samples.
Deterministic zero payload-descriptor work and the original-implementation
mutants supply the algorithmic repair evidence independently of timing drift.

`pnpm size:compare --files` completes successfully against the merge base.
DB grows 480 gzip / 391 brotli bytes; the typical app grows 74 gzip bytes and
shrinks 10 brotli bytes; the includes app grows 403 gzip / 347 brotli bytes.
Removing the dual callback views and their recursive substitutions simplifies
the compiler. The compiled include-path resolver adds code to avoid payload
traversal while retaining materialized children and public-container semantics.
Removing namespace attribution or inherited descriptors is smaller but fails
the review mutants; removing distinct cache roles couples independent windows.
The retained generic adapter walker serves callers without compiled paths.
These obligations account for the remaining byte growth. Oracle, CSV and
documentation growth is separate from shipped production bytes.

## Oracle conformance for the prep repairs

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001–003 | Each owner states authority and limits beside its independent model, grammar, real driver and comparison. The policy authority is the maintainer decision, not observed output. |
| ORC-004 | The grammar reconstructs each review trace. Removing FROM/JOIN, expression/functional, inline form, source attribution or collision axes loses distinct REDs. Empty/nonempty and accumulated groups, aggregate depths 7/8/9 and depth 16 provide adjacent bounds. Collection-valued functional inputs, opaque facades and optionless indexes remain rejected neighbors. |
| ORC-005 | Public Collection entries and readable rows at four publication cuts, all nested values at six route cuts, and native contextual/inline/publication types reach their comparisons. Eager sources provide the required facts before comparison; no further missing-input hypothesis was identified. |
| ORC-006 | Original namespace/attribution/descriptor mutants and isolated type mutants fail the intended comparisons. ORACLE-4's driver mutation exposes the old false GREEN and fails the repaired checker. No setup error or timeout is counted as a kill. |
| ORC-007 | New publication, route and type dimensions are bounded finite enumerations. The unchanged work property retains equal fixed/fresh budgets and direct seed/path replay; its hostile replay uses seed 2355/path 0. |
| ORC-008 | No stateful reference-model state is added or merged in these repairs. Expected payload content is stateless recomputation; publication and route models retain their existing lifecycle distinctions. |
| ORC-009 | Collection publication, route, source attribution and checkpoint names use the glossary. Declared type-shape and payload abstractions are distinct from runtime classifier state. |
| ORC-010 | Existing failure-preserving cleanup remains in use. Aggregate route mismatches retain every cut; native diagnostics preserve file/span/code. No shrinking or cleanup waiver was added. |
| ORC-011 | The named shared-mutation fault is addressed by independently reconstructed document values plus a separate identity check. No additional shared-semantic-fault hypothesis needing a second formulation was identified. |
| ORC-012 | This versioned record binds the reviewed sources and records bug-class boundaries, original/neighboring witnesses, mutant results and limits. |
| ORC-013 | Authored/no-collision, implicit single/joined, expression/functional, empty/nonempty grouping and depth 7/8/9/16 witnesses distinguish nearby wrong rules. The hostile mutants reject those wrong consequences. |
| ORC-014 | Claims stop at real core Collection and native source-TypeScript boundaries. No controlled fixture is promoted to provider, installed-package or framework scheduling evidence. |
| ORC-015 | Publication: 72 states, 408 comparisons. Route transport: 432 comparison states plus eight callback-group states. Public types: all 256 declared states reach 24 times. Counts and diagnostic restoration are retained with source bindings. |
| ORC-016 | Finite histories and generated native consumers share independent models and comparisons; wrong-observation controls calibrate those same checks. Supplemental descriptor examples stay in an ordinary test file. |

## Loss audit and readiness

The final audit returned to both raw reports, including their rejected
candidates, validation appendices and uncapped observations. All 24 original
IDs and both sibling violations appear above:

**26 = 9 fixed-now + 3 confirmed-open optional suggestions + 10 accepted-design
or evidence-limit entries + 1 already-fixed + 1 stale + 1 duplicate + 1 refuted
as a review finding.** There are no deferred repairs or unresolved product-law
decisions in this inventory. The three optional suggestions are S1, S2 and
BENCH-1; they await the prep-pr walkthrough. The recorded dynamic-emptiness and
wrapped-expression inference gaps remain separate, pre-existing type-owner
work and prevent any claim of complete grouping inference.

The bounded attribution, route and authored-type classes above have generated
receiving witnesses and hostile rejection evidence. This does not prove every
query shape or zero elapsed overhead. Whole-PR readiness is **unproven** until
the approved final head is pushed and remote checks run. In particular, the
new remote three-repetition policy has no observed CI history yet.

Final `pnpm lint:changed`, changed-file Prettier checks and `git diff --check`
pass. The source/reach manifest matches all 26 recorded code files. No oracle
run budget was lowered or removed during the prep-review repairs.

## Approved follow-up: S1

The maintainer approved inlining the single-use join merge helper. The same
object spread, missing-main alias deletions, joined-alias replacement/deletion
and source-context merge retain their evaluation order. This refactor changes
no promised behavior; existing input, join-shape, route-context and join-key
owners pass all 5,148 tests. Formatting and whitespace checks pass.

The source manifest preserves the measured/reviewed implementation hashes and
adds the successor join-source hash under `approvedFollowups`. Timing samples
above precede this cleanup; no elapsed-time improvement is claimed.
`pnpm size:compare --files` after S1 passes: DB +480 gzip / +370 brotli bytes,
typical app +45 gzip / −95 brotli bytes, includes app +385 gzip / +301 brotli
bytes against the merge base. These supersede the earlier size figures for the
current source. The ledger now has ten fixed items and two optional choices
pending (S2 and BENCH-1); all other dispositions are unchanged.

## Approved follow-up: S2

The maintainer approved removing the unused `_inline` formal parameter, five
pure argument flags and the dead calibration local. The independent model body
and history grammar remain byte-for-byte identical after removing that formal
parameter. No receiver, observation cut, comparison, reach declaration or run
budget changes. The same boundary-only law and its recorded RED/mutant evidence
continue to apply; this cleanup adds no product behavior requiring a new RED.

The callback-input owner passes all 4,924 tests, including its existing hostile
observation controls. Formatting and whitespace checks pass. The source manifest
adds the three successor test/driver hashes under `approvedFollowups`. Production
sources and timing/size measurements are unaffected. Eleven review items are now
fixed; BENCH-1 is the only optional choice still pending.

## Approved follow-up: BENCH-1 and final accounting

The maintainer approved restoring the `scenario` column in the historical
whole-suite CSV. Each of 504 rows was matched to the original JSON report by
its existing identity, repetition and exact numeric samples. Every pre-existing
column, timing string and row position is preserved. Including scenario makes
all 504 identifiers unique. The source manifest retains both original report
hashes and the CSV's before/after hashes. No benchmark was rerun for this
label repair, and no timing conclusion changed.

All three optional suggestions are approved and complete. The final loss audit
is **26 = 12 fixed-now + 10 accepted-design/evidence-limit entries + 1 already-fixed
+ 1 stale + 1 duplicate + 1 refuted as a review finding**. No review item is
unaccounted for, deferred, or waiting on a product-law decision. Historical
stage totals above remain the record of their respective checkpoints.
The separately recorded inference and measurement limits still apply.

This completes the optional walkthrough. Changeset/PR preparation awaits the
prep-pr workflow's final maintainer confirmation. No commit, push or PR has
been created in this worktree yet; remote CI readiness remains unproven.
