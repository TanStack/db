# High review: boundary-only metadata and hot paths

This record evaluates the ten findings supplied for PR #2356 at
`066d0dd26d9cf7829c986b5d3af1d76c1634e8a5`. Experiments start from pushed
predecessor `708a580980b9c7859a66700360b832eaaff046b5`. Intervening CI fixes do
not change the inspected hot paths. The companion
[manifest](2026-11-05-boundary-only-high-sources.json) identifies the repaired
source by SHA256 and retains the experiment log hashes. Earlier records remain
historical. Raw review and append-only scratch accounting are in
`/tmp/db-prep-pr-2026-11-05/review-high-10-ledger.md` on the authoring host.

## Laws, experiments and inferences

No new product decision is needed. The November 5 maintainer decision requires
authored intermediate fields and genuine metadata at Collection publication.
Whole-source selections retain source attribution. Other grouped projections
receive their output Collection's attribution. Architecture laws 2, 4, 8 and 9
also require contribution conservation, route correctness, descendants and
coherent publication. Cleanup optimizations cannot weaken these guarantees.

| Law and authority | Prior gap | Decisive experiment | Repair and scope |
| --- | --- | --- | --- |
| Distinguishable projected join contributions retain distinct public identities. Architecture contribution conservation. | The route owner did not cross independent source keys with matched fan-out and absent main sides. | All 48 expanded legal programs fail on predecessor production. An unmatched-only key repair still fails all 48. These are graph invariant failures after admission, before snapshot comparison. | Include joins use source-key pairs. The independent flat join compares Collection, array and materialized results at four cuts. Source-attributed whole-row selections retain the source key. |
| Inferred wrapped aggregates have the same implicit-group key and scalar value types as visible aggregates. Public query result contract. | The native owner varied visible aggregate depth, but not expression wrappers. | A legal generated consumer gives 35 TS2344 constraints: 27 missing-key and eight scalar-type failures. Ignoring provenance restores native constraint failures. | Type-only provenance crosses functions and conditionals. Aggregate value extraction unwraps the result. Ordinary expressions are controls. |
| Whole-source selections preserve source metadata at actual Collection publication. Approved boundary-only decision. | A first pair-key repair replaced the source key on matched nullable facade rows. | The unchanged publication owner rejects both initial-match histories, with source key `child` replaced by the pair serialization. | Finalization prefers genuine source identity for source-attributed join selections. The same owner then passes matched/unmatched departure and reentry. |
| Source payloads stay opaque during metadata cleanup. Architecture work contract. | The reviewed paths still copied roots, folded discarded group metadata and bypassed the compiled resolver cache. | Diagnostic counters measure the same five-row preload/update programs before and after repair. Existing value, attribution, route and lifecycle owners compare public results. | Remove discarded work and reuse cleaned roots/cache results. These counts establish work removal, not an elapsed-time promise. |

The join reference recomputes matches from ordinary source arrays. It does not
import production key serialization, route helpers or join operators. Its
recorder preserves missing and repeated contributions. Sorting uses projected
child IDs only, since this grammar does not promise an order. A wrong-result
calibration rejects omitted and duplicated contributions using the same checker.
Three parents exercise shared and disjoint routes. All source facts are present
before each eager synchronous observation. No missing-input hypothesis remains
at those cuts.

The finite join grammar has four join kinds, two source kinds per side, and
numeric/string/mixed source key domains: 48 programs. Each checks initial rows,
main departure, main reentry and child departure through three public include
forms. It reaches all 576 declared program/path/cut states once, with 1,728
parent/form/cut comparisons. Its fan-out defeats the narrow unmatched-only fix.
Removing either QueryRef axis loses a transport boundary. Removing mixed keys
loses independent typed domains. Removing reentry loses cancellation history.
It admits only supported equality joins and unique source keys. It filters
child-absent rows, so it does not claim every arbitrary FULL-join shape.

The native type grammar adds 27 wrapper forms and their ordinary controls to
all 24 row descriptions. It includes comparisons, boolean/unary functions,
strings, numeric functions, coalesce and conditional conditions/branches/defaults.
Ten nested coalesce wrappers reject a shallow repair. The model computes exact
keys and scalar shape from the authored source description, independently of
production expression classification. Actual public construction precedes
native compilation. The repaired owner passes 33 checks, with every one of 313
states reached 24 times. Explicit BasicExpression widening and the existing
six-or-more-pair caseWhen any overload erase input information and remain
outside the inferred-expression claim. Dynamic empty grouping remains the
separate, previously recorded type limitation. No runtime key loss is accepted.

Early type experiments contained TS2615/TS2769 setup failures and two illegal
string-expression arguments (TS2345). They receive no RED credit. The valid RED
contains only 35 TS2344 law-constraint diagnostics. Likewise, the first join
fixture omitted a required readEveryForm projection. Only corrected, admitted
runs supply the RED evidence.

## Lossless finding ledger

Each raw ID retains its original file/line reference. The review labels all ten
as high. Severity here follows demonstrated impact. A mixed finding can have a
repaired work claim and a rejected correctness explanation.

| ID | Original claim | Technical verdict and PR action | Durable value |
| --- | --- | --- | --- |
| NR01 | compiler/index.ts:1257 loses grouped pending/origin/Collection metadata, while group-by.ts:530-537 still reduces it. | Correctness is accepted-design under the approved output-Collection rule. Discarded reduction is confirmed and fixed-now. | Publication owner retains held-insert/settlement attribution. Remove unused group metadata computation. |
| NR02 | compiler/index.ts:1871 copies every union public container and adds ROW_METADATA even for null metadata. | Confirmed, fixed-now. Copy only non-null attribution. Missing/null both mean no attribution in this flat union namespace. | Union value, attribution and route owners preserve controls. |
| NR03 | compiler/index.ts:1239 copies grouped roots to add a key that publication immediately deletes. | Confirmed, fixed-now. Supply a missing generated key only at intermediate boundaries. | Native type owner protects intermediate keys. Publication owner protects output metadata. |
| NR04 | compiler/index.ts:1950 has dead metadataSources, root ternaries and non-reset inheritance. | Confirmed, fixed-now. Publication helper takes only selected value and metadata. | Simpler publication boundary, checked by the same attribution owners. |
| NR05 | compiler/index.ts:1032 double-spreads materialized namespaces and reintroduces stripped root state. | Redundant copies confirmed, fixed-now. Resolver output is reused. Restoring compiler namespace facts is necessary for transport, not a cleanup defect. | Restore only known namespace keys. Keep callback purity and materialized route witnesses. |
| NR06 | compiler/joins.ts:696 lets unmatched RIGHT/FULL joined QueryRefs donate keys and collide. | Confirmed correctness defect, fixed-now. Pair identities cover absent sides and matched fan-out. | Extended context-transport owner, all 48 legal programs. |
| NR07 | builder/types.ts:275 treats wrapped aggregates as ordinary expressions, omitting generated keys. | Confirmed type defect, fixed-now. Preserve inferred aggregate provenance and unwrap scalar aggregate results. | Extended native public-type owner and explicit-erasure limits. |
| NR08 | bucket-facade-adapter.ts:524 bypasses the resolution cache, repeating prepare/apply/previous-value resolution. | Confirmed, fixed-now. Cache by resolver and immutable row identity. Rollback clears both caches. | Facade lifecycle and rollback owners retain publication/next-use checks. |
| NR09 | route-metadata.ts:207/91 has unused recursive wrapper parameters and an unused stripRouteMetadata export. | Confirmed production cleanup, fixed-now. Wrappers are shallow-only and the unused export is removed. The generic recursive walker remains useful. | Cycle/descriptor coverage invokes that generic walker directly. |
| NR10 | route-metadata.ts:149 cleans plain Collection inputs and performs all six hasOwn probes after a hit. | Plain-source overhead confirmed, fixed-now through compile-time source classification. The after-hit allegation is refuted: ||= already short-circuited calls. | Keep parameterized Collection and QueryRef cleanup. New stripper returns at the first hit. |
| NR11 | Summary repeats grouped metadata qualification and wasted work. | Duplicate NR01. | Preserve both correctness qualification and work claim. |
| NR12 | Summary repeats unmatched joined-subquery collisions. | Duplicate NR06. | Preserve public include collision consequence. |
| NR13 | Summary names coalesce(sum(...)) and caseWhen inference. | Duplicate NR07. | Preserve those concrete forms in the wrapper grammar. |
| NR14 | Summary repeats dead parameters and exports. | Duplicate NR04/NR09. | Same source inventories and cleanup. |
| NR15 | Summary says extra copies matter in a performance PR. | Duplicate NR02/03/05/08/10. | Keep work counts separate from elapsed measurements. |
| NR16 | New sibling: matched fan-out collides for every join kind when one source key names several projected rows. | Confirmed, fixed-now with NR06. | Defeats an unmatched-only repair. |
| NR17 | New sibling: coalesce(count(...)) and scalar caseWhen expose Aggregate<number> instead of number. | Confirmed, fixed-now with NR07. | Eight generated scalar-type constraints on the selected description. |
| NR18 | Repair interaction: pair keys replace source metadata keys on whole-source facade selections. | Confirmed by the existing publication owner, fixed-now. | Retain matched/unmatched whole-source attribution as a neighboring-law control. |

The original review ran no tests or full tsc because its checkout lacked
node_modules. It ran one small type probe. This limits the original evidence,
without erasing any claim. All ten source findings have an action. At the
item level there are thirteen fixed-now items and five duplicates, including
three discovered siblings. NR01 separately accepts its correctness half and
NR10 refutes its short-circuit half. No finding is deferred or confirmed-open.
No raw footnote or summary claim remains unaccounted for.

## Work and latency evidence

Five reversible five-row diagnostics run preload and one source update, with
cardinality controls. Temporary counters were removed after both observations.
They are diagnostic instruments, not a new implementation-specific work budget.

| Work | Predecessor | Repair |
| --- | ---: | ---: |
| Group input metadata folds / group reductions | 7 / 2 | 0 / 0 |
| No-attribution union selected-row copies | 12 | 0 |
| Aggregate temporary selected-row copies | 6 | 0 |
| Compiled facade resolver executions | 17 | 11 |
| Root private probes: source / union / aggregate | 77 / 180 / 57 | 35 / 120 / 15 |
| Root private probes: inline / facade | 264 / 239 | 192 / 131 |

Five materialized callback input occurrences previously took two extra spreads
each. The repaired path reuses the fresh resolved namespace and restores only
compiler-owned namespace facts. An unchanged resolver result still receives one
fresh namespace before internal modification.

The local paired benchmark retains all case timings and three-repetition
samples in the [review measurement table](../../../scripts/bench/high-review-2026-11-05.csv).
It uses 100/1,000/10,000 levels, no/manual indexes, synced/optimistic writes,
100 iterations, 20 warmup writes and three fresh fixtures. The archived baseline
contains predecessor 708a58098 source. Candidate metadata reports the Git HEAD
beneath its working tree, so the manifest, not that field alone, identifies the
candidate source. The comparator uses the unchanged CI gate. No elapsed result
is inferred from the work counts. These runs do not establish zero overhead or
a universal noise ceiling.

All observed local comparisons remain recorded:

| Comparison | Overall writes | Overall cold | Gate |
| --- | ---: | ---: | --- |
| Initial repair / first predecessor baseline | 0.92x | 0.94x | PASS |
| Final repair / first predecessor baseline | 1.11x | 1.20x | PASS |
| Unchanged second / first predecessor baseline | 1.10x | 1.18x | PASS |
| Final repair / second predecessor baseline | 1.01x | 1.01x | PASS |

The final comparison against the first baseline has four diagnostic write
regression flags. None meets the CI failure rules. The unchanged baseline
also drifts, so elapsed evidence does not isolate a source-caused regression
or establish a speedup from this cleanup. The final source-key amendment ran
after the initial candidate, and both candidate observations remain available.
Thresholds did not change. Final shipped-size comparison against the PR merge
base adds 337 gzip bytes and 353 brotli bytes for DB. The typical app adds
89 gzip bytes and 54 brotli bytes. Group-by app gzip decreases by 99 bytes.

## Verification and calibration

- Runtime final: ten files, 7,416 tests pass. Context transport, publication,
  callback inputs, Effects, payload work, facade rollback/lifecycle, query shape
  and join-result keys all run at max two workers.
- Native public types: 33 checks pass. All 313 declared states reach 24 times.
- Full DB source/test tsc: zero diagnostics with a 12 GB heap.
- DB ESM/CJS and declaration builds pass. Supplemental callback/public type
  checks pass separately.
- Removing wrapper provenance fails native law constraints. Clearing only an
  unmatched join key fails all 48 fan-out programs during public-key reduction
  after admission. Missing/duplicate result controls fail the shared comparison.
- The first full runtime run fails two source-key publication assertions, then
  the final repair passes all 7,416. The RED remains in the manifest.
- functions.ts and types.ts transpile to identical JavaScript to predecessor
  708a58098 when comments are removed. The provenance repair adds no runtime
  marker or traversal.

Reproduce runtime checks with `pnpm --dir packages/db exec vitest run
--coverage.enabled=false --maxWorkers=2` and the ten files named in the manifest's
runtime command. Reproduce native type evidence with the same command and
`tests/query/virtual-row-fields-types-oracle.test.ts`. The first runtime command
mistakenly named a nonexistent collection-facade-lifecycle file. It receives no
coverage credit. Final verification uses the actual includes-collection owner.

## Oracle rubric self-review

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | Architecture conservation/publication and approved metadata policy authorize the laws. Limits stay explicit above. |
| ORC-002 | Flat joins and authored-shape native types do not reuse production classifiers. |
| ORC-003 | Changed owners retain opening contracts and prose beside models, grammars, drivers and comparisons. |
| ORC-004 | Finite products reconstruct unmatched collisions, matched fan-out and wrapped aggregates. Axes, ablation, admitted bounds and illegal inputs are described above. |
| ORC-005 | Real core Collection/include and native compiler entry points run. Required states count only admitted histories. All public include forms compare after each synchronous action. |
| ORC-006 | Original, narrow join mutant, provenance mutant, omission/duplication calibration and source-key publication RED are distinguished above. Graph failures are not comparison assertions. |
| ORC-007 | New dimensions are exhaustive finite enumerations, not random-property claims. Existing fixed/random campaigns and their budgets remain intact. |
| ORC-008 | New judgments recompute joins/types without a new state machine. Departures/reentry are explicit source-array histories. |
| ORC-009 | Model arrays represent source Collections. Public forms/cuts use glossary terms. No new subsystem state terminology. |
| ORC-010 | Existing cleanup helpers retain primary failures and run all cleanup. No new shrinking or capture mechanism. |
| ORC-011 | No specific shared semantic fault remains that needs a second model. Flat source-array join is independent of graph identity. |
| ORC-012 | This versioned record and companion manifest bind evidence and all dispositions. |
| ORC-013 | Matched/unmatched, fan-out, plain/QueryRef, typed keys and ordinary/wrapped expressions distinguish neighboring rules. |
| ORC-014 | Claims stop at eager controlled core sources and actual native TypeScript. Provider and framework timing are not inferred. |
| ORC-015 | Required join and native states fail the owners if not reached. Counts are above. |
| ORC-016 | Finite histories use shared model/driver/comparison. Wrong-result controls calibrate that comparison. Supplemental exact-expression checks stay outside oracle files. |

The declared bug classes are closed for these finite histories, production
paths and observation cuts. No known reachable violation remains inside those
claims. Async demand, arbitrary nesting, child-absent full joins, explicit type
erasure, installed-package types and framework/provider integration need their
own receiving evidence. The coverage map retains those boundaries. This record
does not turn a sampled or finite result into a universal proof.

## Reviewer assessment and readiness

Hire recommendation: yes. The reviewer identifies two consequential correctness/
type gaps and several real hot-path costs. Signal is high and locations are
precise. Static inspection also catches dead machinery missed by the earlier
passes. The reviewer qualifies the grouped-metadata design concern, which is
useful. The short-circuit allegation is wrong, the unmatched-only explanation
misses matched fan-out, and no runtime experiment supports the original report.
Require contract checks and executable validation before accepting severity or
a proposed cure. All confirmed work above is repaired and independently checked.

Review accounting and local implementation verification are complete. Remote CI
and the final pushed head require separate verification before a ready verdict.
The full repository pnpm test command was not run. Earlier branch-wide review
records and their accepted limits remain relevant.
