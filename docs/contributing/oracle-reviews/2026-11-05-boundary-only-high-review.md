# High review: boundary-only metadata and hot paths

This record evaluates the ten findings supplied for PR #2356 at
`066d0dd26d9cf7829c986b5d3af1d76c1634e8a5`. Experiments start from pushed
predecessor `708a580980b9c7859a66700360b832eaaff046b5`. Intervening CI fixes do
not change the inspected hot paths. The companion
[manifest](2026-11-05-boundary-only-high-sources.json) identifies the repaired
source by SHA256 and retains the experiment log hashes. Earlier records remain
historical. Raw review and append-only scratch accounting are in
`/tmp/db-prep-pr-2026-11-05/review-high-10-ledger.md` on the authoring host.

The final amendment below supersedes historical source-key policy, size figures
and readiness statements. Earlier experiment entries remain unchanged.

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
| NR10 | route-metadata.ts:149 cleans plain Collection inputs and performs all six hasOwn probes after a hit. | Plain-source overhead confirmed, fixed-now through compile-time source classification. The after-hit allegation is refuted: `\|\|=` already short-circuited calls. | Keep parameterized Collection and QueryRef cleanup. New stripper returns at the first hit. |
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


## Follow-up on bd3f574ec: shipped size and additional CI review

This append-only amendment qualifies the earlier closure and size statements.
The maintainer requires a net decrease in shipped JavaScript, rather than a
net decrease in production source lines. The prior +337 gzip/+353 brotli DB
measurement does not meet that requirement. Subsequent intermediate size
measurements are experiments, not the final acceptance result.

CodeRabbit review 5791093838 covers bd3f574ec. Every new occurrence is retained
in the scratch ledger, including the full inline bodies. Its dispositions are:

| Occurrence | Verdict and action | Surviving value |
| --- | --- | --- |
| 4485255659, NR10 table pipes split cells | Confirmed, fixed-now. Escape both pipes in the operator. | Readable lossless finding table. |
| 4485255663, whole-source join fan-out collapses under source keys | Confirmed. The initial disposition was design-decision because the accepted source-key rule conflicted with contribution conservation. | Cross whole-source selections with one-to-many joins and observe every public include form. |
| Mutable summary: 39.58% documentation versus 80%, 48 functions, four unsupported | Refuted as a repository requirement. No maintainer or repository rule establishes this threshold. | Add explanatory prose where a specific ambiguity warrants it. |
| Mutable summary: aggregate-operator type provenance scope | Already evaluated with NR07. Generated native consumers require provenance and it emits no JavaScript. | Retain ordinary expression controls and explicit-erasure limits. |
| Older mutable 4484649660: make cleanup callback async | Refuted on current source. checkWithCleanup accepts a synchronous callback or Promise<void>. Native type owner passes 33 checks. | Keep async cleanup support without unnecessary Promise creation. |

The public probe for 4485255663 joins one child to two matches, selecting the
whole child. Both toArray() and include() return one row with source key 10.
This is executable evidence of lost join multiplicity, rather than a proposed
implementation preference. The maintainer then approved pair keys for joined
results, while retaining the source's origin, pending-write and Collection-ID
attribution. This revises the source-key portion of the earlier decision and
NR18's neighboring-law control. A joined row's identity represents the pair.
The remaining source fields continue to describe attribution. The historical
source-key RED above remains valid evidence of that earlier contract, but is
not an obligation under the revised contract. The pair-key experiment and
current readiness verdict are recorded below after enforcement is complete.

### Copy-law sibling and independent evidence

A new sibling defect loses an array's derived or null prototype during shallow
cleanup and generic graph copying. Architecture's cleanup contract promises
preserved prototypes, descriptors and user symbols without accessor execution.
Existing ordinary tests varied null record prototypes but only native arrays.
The metadata and payload-work owners judge different boundaries, so the new
public-container-copy owner independently judges this copy relation.

- **Law:** A necessary cleanup copy changes only the private keys or declared
  include leaves, retaining prototype, descriptors, user symbols and source
  immutability. An unchanged value retains identity.
- **Reach:** Each generated input executes 24 programs: four resolver paths,
  three array prototypes and changed/unchanged controls. Sizes range from zero
  to eight, scalar values from -1 to 1, with sparse slots and locked-length
  variation. Fixed seed 2355 and fresh seed 937318538 each reach every state
  eight times, giving 384 comparisons in the combined run.
- **RED:** Before the prototype production edit, the new owner rejects six
  changed derived/null cells on shallow, generic and compiled-root paths.
  Compiled declared-path controls already preserve prototypes. Direct replay
  at seed 937318538, path 0 rejects the same six cells.
- **GREEN:** The shared shell allocator preserves array prototypes. Focused
  oracle, ordinary copy and facade checks pass 37/37, and direct replay passes.
- **Mutant:** Replacing the shared array shell with [] fails all eight changed
  derived/null cells, including the compiled include path, at prototype checks.
- **Limits:** The observation is resolver return. This does not claim arbitrary
  graph topology, cross-realm hosts, exotic built-ins, framework/provider
  behavior or descriptor preservation at Collection publication.

The model captures descriptors/prototypes before invoking production. It does
not import production classification or copying helpers. The compiled path
obtains its resolver through the real Query builder and materialization plan.
Sparse slots, readonly named data, an accessor, hidden fields and a hidden user
symbol distinguish tempting spread-based copies. Existing cycle/sharing tests
remain supplemental. No test or run budget was removed. The first supplemental
type attempt used an unavailable fast-check type and receives no type-GREEN
credit. The corrected final native check passes all 85 checks with no errors.

### Group-stage CI calibration

Local execution reproduces the remote DB shard's 21 stale metadata expectations
out of 35 component tests. Boundary-only publication retires that component's
source-derived pending/origin/Collection-ID expectations. The old argument also
occupied a different parameter after the reducer signature changed. This is an
expectation/owner repair with unchanged production, not production-bug evidence.

The renamed group-by-pipeline oracle retains all 30 explicit/implicit grouping,
none/plain/wrapped selection and five-HAVING programs. Each compares empty,
populated, member-move/value-change, empty-after-delete and reentry snapshots
against the independent partition/sum model: 150 checked component snapshots.
Four incorrect observations exercise the same checker: missing group, wrong
key, wrong value and duplicate weight. All are rejected. Five ordinary source
state/admission controls remain in the ordinary test file. Final component
checks pass 39/39, and the unchanged public metadata owner passes 1,714/1,714.
This does not relax any actual Collection metadata comparison or remove a
random run budget. Limits remain numeric grouping/sums and synchronous D2
drains, with public attribution and routes owned by their existing instruments.

### Size experiments and latency observations

The type-only caseWhen tuple signature removes the overload ladder while
preserving the existing six-or-more-pair fallback. Removing redundant and/or
overloads also emits identical JavaScript to bd3f574ec. A const-tuple inference
experiment narrowed object branch fields, failed 24 native histories, and was
rejected. The nonconst form passes the native owner. It is not a runtime size
reduction by itself.

Shallow cleanup no longer enters the generic graph walker. Generic graph copy
allocates every dirty shell before descriptor replacement, retaining cycles
and shared references. Facade resolution uses one resolver-indexed cache and
a stable callback. Merging source metadata and routing into one alias-entry
map was rejected because it adds allocation and lookup work to metadata-only
QueryRefs without a measured benefit. Source-line savings do not justify that
latency tradeoff.

The measurement table now retains six runs, 504 rows, including the simplified
working tree before the pair-key amendment and a third unchanged predecessor
control. That candidate versus the third control measures 1.00x overall writes
and 0.96x cold, with one diagnostic write flag and no gate failure. Every query
geometric mean passes the unchanged gate. These observations do not establish
zero overhead or a source-caused speedup. The candidate's reported Git SHA is
bd3f574ec beneath uncommitted source; the companion manifest binds that source
separately. Later semantic edits require their own verification.

The current remote checks still cover bd3f574ec: 23 pass, while Minified DB
public API, Test (db-1) and composite Test fail. The local mangle-cache and
group-stage repairs address diagnosed causes, but do not establish remote
success until the final changes are pushed and rerun.

### Shipped JavaScript acceptance experiment

Production callers always provide the compiled include resolver when creating
facades. The internal BucketFacadeAdapter and generic resolver are absent from
the public package exports. Requiring that existing dependency explicitly lets
the generic recursive walker leave public-index bundles. Direct component
receivers still pass the same helper explicitly. Its copy, cycle and reference
checks remain intact. This is an internal dependency change, not a weakened
public cleanup law.

Before requiring the dependency, the modified direct receivers pass 58/58 on
unchanged production defaults. Afterward, seven focused files pass 234/234,
including real compiled callbacks and the fourteen-path opaque-payload work
owner. Rollback retains outer Map identities, adopts already-isolated inner
snapshot Maps/Sets once, and records written keys directly without temporary
key arrays. A rejected outer-Map replacement failed the nested rollback
receiver; the corrected implementation preserves that comparison. No oracle
model, grammar, assertion or run budget is relaxed by these refactors.

A generic copy's allocated shell now doubles as its dirty marker. Every dirty
shell exists before descriptor links are filled, preserving shared references
and cycles without a separate flag/allocation pass. Mangle-cache validation
accepts 434 safe private names. The earlier source-only overload reduction is
not counted as shipped-code removal.

Immediately before the pair-key amendment, exact merge-base 8feab6ea3 versus
working source measures:

| Fixture | Base minified JS | Working JS | JS delta | Gzip delta | Brotli delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full public export bundle | 363,269 | 363,084 | -185 | -108 | -184 |
| Ordinary app | 316,001 | 315,702 | -299 | -185 | -147 |
| App with includes | 324,489 | 324,935 | +446 | +57 | -38 |

The full bundle and ordinary app meet the shipped-size requirement in this
experiment. The includes fixture remains larger in raw JavaScript and gzip.
All eight app scenarios were measured; the other seven shrink in gzip. The sum
of all minified ESM JavaScript modules, including development branches,
decreases from 728,187 to 726,627 bytes (-1,560). That distribution measure is
distinct from an app's tree-shaken production bundle.

Commands: `pnpm size:compare --packages db --base 8feab6ea3 --exact-base
--rebuild`, plus the manifest-bound measure-shipped-js.mjs probe. Its production
bundling premises and gzip/brotli values match the repository size script.
The final pair-key source requires a final measurement below.

The size-continuation ledger also preserves rejected ideas: const-tuple type
inference, direct adoption of outer rollback Maps, a merged source-context map,
and a proposed compiled-resolver representation rewrite. The first three have
counterevidence above. The resolver rewrite was unnecessary after the explicit
internal dependency removed the generic walker from shipped public bundles,
and was not implemented. Accepted changes preserve existing public histories,
comparisons and budgets. Type-only source deletion receives no shipped-size
credit.


## Final pair-key and shipped-size amendment

The maintainer requires negative shipped JavaScript overall and explicitly
chooses pair keys for joined results. The November 5 decision supersedes NR18's
historical source-key requirement. Structured whole-source selections and direct
functional source returns keep source origin, pending-write state and Collection
ID; their published key identifies the joined result. Inline authored fields
remain intact. Explicit custom keys retain congruent contributor reduction.

### Joined occurrence evidence

- **Law and authority:** Each default-key joined occurrence remains separately
  observable. A published row's $key equals its actual Collection entry key.
  Source attribution's other three fields remain genuine. Authority: the
  maintainer's pair-key decision and architecture contribution conservation.
- **Reach:** The primary join-result-key owner crosses all four join kinds,
  selected side, direct/QueryRef composition, four projection forms, authored
  collisions where applicable, and default/custom keys: 192 finite programs.
  Each checks initial publication, held selected-source mutation, peer departure,
  rejoin, settlement and remote update through root Collection, Collection
  facade, toArray and materialize receivers. All 4,608 declared receiving states
  reach at least once. Two 80-history campaigns add random and fixed inputs:
  352 histories and 8,448 new comparisons in the normal run.
- **RED:** Before the production amendment, the extended join and metadata
  owners fail 219 of 1,914 tests. Missing required source IDs, invalid QueryRef
  correlation and NaN admission setup failures receive no RED credit.
- **GREEN:** The same two owners pass 1,914/1,914 on final production. The
  generated public metadata judgment retains non-key attribution and authored
  inline values. Custom keys intentionally differ from source IDs. Temporal
  key-set checks preserve identity across value changes and departure/rejoin.
- **Mutants:** Separately restoring source-key preference in routing and in
  published metadata rejects 130/200 join tests each at the shared comparisons.
  A direct replay of property join-result-key.whole-source, seed -540621864,
  path 0:0:0:0:0 rejects restored source-key behavior and passes after byte-exact
  source restoration. The captured trace selects the left whole row in a direct
  inner join, with string and infinite source keys. Replay runs one selected
  property and intentionally skips the other campaign and reach requirements.
- **Limits:** Eager core/mock sources, two joined sources and bounded updates;
  no provider-delivery or framework-scheduling claim. Arbitrary overlapping
  writes, larger join chains and unbounded query shapes are not established.
  The detailed reach log was truncated, so it is not a parseable exact-count
  artifact. Finite enumeration and enforced reach assertions establish >=1 for
  each declared state; no larger per-state count is claimed.

Commands (from the worktree, each with at most two workers):

```sh
pnpm --dir packages/db exec vitest run tests/query/join-result-key-oracle.property.test.ts tests/query/virtual-row-fields-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
TANSTACK_DB_ORACLE_SEED=-540621864 TANSTACK_DB_ORACLE_PATH=0:0:0:0:0 TANSTACK_DB_ORACLE_PROPERTY=join-result-key.whole-source pnpm --dir packages/db exec vitest run tests/query/join-result-key-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
```

The source-key preference is removed from the small metadata sidecar for joined
rows. Publication supplies the actual result key; routed rows use their computed
pair identity. This adds no recursive payload traversal.

### Final source measurements and checks

Exact merge-base 8feab6ea3 versus final working source:

| Fixture | Base minified JS | Final JS | JS delta | Gzip delta | Brotli delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full public export bundle | 363,269 | 363,114 | -155 | -94 | -85 |
| Ordinary app | 316,001 | 315,735 | -266 | -170 | -158 |
| App with includes | 324,489 | 324,968 | +479 | +73 | -18 |

All emitted minified ESM JavaScript modules, with development branches retained,
shrink from 728,187 to 726,520 bytes (-1,667). The shipped-size requirement is
met overall. The includes fixture still grows in raw JS and gzip. Source-line
negativity is not required and is not claimed. The size command remains
`pnpm size:compare --packages db --base 8feab6ea3 --exact-base --rebuild`.

The seventh retained local benchmark uses final production and identical
candidate/predecessor harnesses: 84 cases, three fresh-fixture repetitions,
100 writes and 20 warmups. Its 130-file source binding matches before and after
execution. Against the third unchanged 708a58098 predecessor control, it measures
0.91x overall writes and 0.80x cold, with no diagnostic flags and a PASS from the
unchanged CI gate. The CSV now preserves seven runs / 588 cases. Earlier noisy
and failed observations remain. This is evidence against a large regression
in these cases, not a zero-overhead or precise speedup claim.

Final local verification on the same production source:

- DB shard 1: 198 files / 16,367 tests pass, with no type errors.
- Affected runtime run: 16 files / 7,802 tests pass.
- Full DB source/test tsc: zero diagnostics (12 GB heap).
- Minified public API: 113 error names, index metadata, query rows and live
  updates pass. Mangle-cache validation accepts 434 safe names.
- Native type owner: 33 checks; supplemental type checks: 85. Builder functions
  emit identical JavaScript to bd3f574ec.
- Source size/build, scoped lint and direct replay pass. Final repository
  lint/diff checks and remote CI are recorded after commit below.

The complete repository pnpm test command was not run. A nonexistent optional
changeset-checker script and an earlier tsc setup failure receive no check credit.

### Final loss accounting

NR01–NR15 preserve every raw finding and summary claim. Ten primary findings
are fixed, with NR01's attribution half accepted-design and NR10's after-hit
probe allegation refuted. NR16/17 siblings are fixed. NR18's historical source
key law is superseded by the explicit pair-key decision; the replacement law is
enforced above. Item accounting: 18 = 12 fixed-now + 5 duplicates + 1
accepted-design. No original item is deferred or confirmed-open.

CodeRabbit occurrences from review 5791093838/bd3f574ec: table pipes and whole
source fan-out are fixed-now; the unconfigured docstring threshold and async
callback requirement are refuted; aggregate provenance scope is already
addressed. Five occurrences = 2 fixed-now + 2 refuted + 1 already-fixed.

The size-continuation ledger preserves all simplifications: SS01 tuple types,
SS02 shallow descriptors, SS03 all-shells-before-links, SS05 unified resolver
cache, SS07 isolated inner rollback snapshots, SS08 inlined write setup, SS09
shared cleanup loop, SS10 shell-as-dirty-marker and SS11 explicit resolver are
accepted internal refactors. SS04 array prototypes and SS13 mangle-cache safety
are fixed-now. SS06 outer Map replacement and SS12 merged source-context maps
are rejected with counterevidence. SS14 is approved group-stage test calibration.
SS15 remains an open Collection admission sibling outside the joined-result
repair. SS16, an unneeded compiled-resolver representation rewrite, is rejected
without implementation. Accounting: 16 = 9 internal refactors + 2 fixed-now + 3
rejected proposals + 1 accepted-design + 1 confirmed-open outside this claim.
No oracle run budget was deliberately lowered or removed.

SS15's exact public witness is recorded in the coverage map under the Collection
mutation-startup owner: an unchanged NaN key fails ordinary optimistic update
admission before the joined observation cut. Sync NaN join histories remain.
The update grammar uses a different matched row for optimistic mutation. This
PR does not fix optimistic NaN admission or claim closure for it; that owner
retains the trace and issue #2264 as its durable destination.

Reviewer recommendation remains hire: high useful signal on types, keys and
work, with source-only evidence and two partially incorrect explanations.
All raw occurrences and rejected ideas have durable destinations. The bounded
join/copy/type laws above have RED/GREEN and calibration evidence. PR readiness
still requires the final pushed head's remote checks and new-review accounting;
the old bd3f574ec check failures do not describe final-source CI.

Final precommit checks: pnpm lint:changed, Prettier on all changed TS/JSON/MD,
and git diff --check pass. PR prose has zero hard STE violations; the two
advisories are the required checklist wording. No lowered/removed oracle
budget report was emitted. Remote checks are still pending the new push.

## CI follow-up on 1498a8101

Two test-integration gaps are confirmed and repaired without production changes.
The minified job passes cache validation, build, public API, client-only bundles
and production error text, then fails 14 direct facade tests against dist. The
build correctly omits the unused generic resolver export. The direct driver
injected that missing export. Its flat row/root-reference fixtures now supply
their explicit flat resolver. No assertion or fixture value changes; generic
copy and nested compiled receiving owners remain. Local dist RED reproduces the
14 failures. After driver repair, all six dist files / 367 tests pass, and all
15 source component tests pass. The initial local attempt used stale dist and
is a setup failure, not RED evidence; rebuilding precedes the valid RED.

The replay lane also exposes missing manifest owners for the two newly
registered properties. Existing replay tests reject exactly that gap: full
local RED is 116 passed / one failed, and the focused owner check fails.
Registering join-result-key.whole-source and query.public-container-copy repairs
the portfolio. All 69 manifest judgments pass. Guarded direct replays of both
properties report the exact requested owner, seed/path, one execution and
nonzero completed runs. No replay guard, comparison or run budget changes.

The new remote benchmark is not green. Run
[42105504239](https://github.com/TanStack/db/actions/runs/42105504239) reports
0.63x overall writes / 0.51x cold, but its localized gate rejects comment-count
cold hydration at 1,000 rows, no indexes, optimistic mode. Base cold samples are
8.597094, 7.248325 and 7.265830 ms; candidate samples are 17.483109, 17.383462
and 16.623491 ms. Every candidate exceeds the complete base range by the
unchanged relative/absolute floors. The median increases 139.2%, from 7.266 to
17.383 ms. The query's geometric means still improve 9.7% writes / 13.5% cold;
this cannot cancel the case failure. No sample is discarded or called noise
without repeated evidence. The next source-identical benchmark will test
repeatability; these two test-driver repairs do not change production or harness.
All 504 new repetition rows remain in
[the CI table](../../../scripts/bench/boundary-only-ci-2026-11-05.csv), alongside
the earlier remote pair. The manifest binds the downloaded complete JSONs and
report. PR readiness remains unproven while this localized failure is unresolved.

Loss accounting adds CI01 (dist driver) and CI02 (replay registration), both
fixed-now with the evidence above. CI03 (localized cold timing) remains
confirmed-open pending the source-identical repeat. Earlier review occurrences
remain accounted for: GitHub re-associated async-callback and gate-wording
comments, but the current helper accepts void or Promise and the current report
already says every repetition. The mutable summary still covers bd3f574ec and
is not fresh review evidence for 1498a8101. The bot marks both original table
pipes and whole-source fan-out comments addressed by 1498a81.

## f34738e69 repeat and fixture isolation

CI03 reproduces remotely on source-identical f34738e69, run
[42106831377](https://github.com/TanStack/db/actions/runs/42106831377).
Overall ratios are 0.62x writes / 0.51x cold. The same 1,000-row, unindexed,
optimistic comment-count case fails. Base samples are 8.471143, 9.203844 and
8.600227 ms; candidate samples are 14.805505, 19.699914 and 17.413126 ms.
Every result is retained in the CI table, now 1,512 repetition rows. The dist
and replay repairs pass remotely. This repeat is evidence against dismissing
the localized failure as an isolated outlier.

The CI runtime matters: local Node 24.19 missed this case, while Node 24.8
reproduces it. In the original local CPU profile, base samples are 5.274, 4.086
and 4.820 ms; candidate samples are 10.521, 8.918 and 7.954 ms. Sample windows
are bounded by monotonic timestamps around the same preload. A separately
calibrated inspector profile supplies the profile-clock offset; summing samples
in those windows attributes 12.292 ms of candidate time to garbage collection,
versus no sampled GC in the base windows. Non-GC work is not exactly equal, and
sampling cannot establish exact function costs.

Every fixture previously populated every issue's 20-block rich-text document,
even for queries that never read documents. That creates substantial unrelated
allocation before each timed hydration. A diagnostic full collection immediately
before hydration, using those original complete fixtures, changes the formerly
failing median to 5.618 ms base / 4.524 ms candidate. The diagnostic preserves
source rows and query shape. It is not the committed measurement policy. An
inspector-started profile also changes GC scheduling and does not reproduce the
slowdown; its samples remain bound in the manifest rather than being discarded.

The harness now populates document trees only for the document query. It still
constructs the same issue, user and comment sources. A deterministic fixture
audit compares all 42 scale/index/query configurations before and after this
change: 126 source fingerprints are identical, all six document-case fixtures
are identical, and the other 36 document fixtures are empty. The original
nested-document query, result assertions, normal GC, writes, repetitions and
regression thresholds remain. No production or oracle code changes. This is a
benchmark fixture repair, so the appropriate instruments are source-data
fingerprints, actual timed runs and existing gate tests; it changes no product
law and needs no new product oracle.

Both source trees run the corrected full harness under Node 24.8 sequentially.
The exact base source archive is 8feab6ea3 and candidate production is f34738e69.
The unchanged gate passes: 0.61x writes / 0.51x cold, with no diagnostic flags.
The formerly failing optimistic case is 4.584000, 4.148917, 4.069292 ms base
versus 4.117292, 3.547250, 3.342959 ms candidate. All 504 repetition observations
are in query-fixture-isolation-2026-11-05.csv. The local archive runner reports
its working-directory Git SHA; the original JSON is preserved, and a separate
annotated report names its actual source archive for the comparator. No timing
or case is edited. The manifest binds both reports and imported source paths.

Limits: these controls identify fixture-dependent GC scheduling. They do not
prove zero runtime overhead, bound every application's GC pauses, or replace a
fresh remote measurement. CI03 remains confirmed-open until the corrected
harness passes the unchanged gate on CI. The shipped-size evidence remains
current because packages/db/src, packages/db-ivm/src and the mangle cache are
unchanged. All 19 benchmark-gate tests pass, including hostile report and timing
controls. No threshold or oracle budget changes.

### New CodeRabbit review accounting

Review 5792063975 covers f34738e69, from bd3f574ec. It contains no new inline
code findings. Its raw body and mutable summary 6666306571 are preserved in the
poll snapshot bound by the manifest. The following ledger includes the summary's
qualifications, not only its formal warning:

| ID | Original claim or suggestion | Technical verdict and evidence | PR action / durable value |
| --- | --- | --- | --- |
| CRF01 | Docstrings cover 45%, below a required 80%; add missing docstrings. | The bot reports its default, not a repository requirement; it says no repository configuration applied. No authoritative 80% rule exists in the repository. | duplicate of the previously refuted docstring requirement; preserve as optional documentation feedback, no blanket prose expansion. |
| CRF02 | Minimal merge risk, no concrete blocker; benchmark awaits a repeat. | The repeat confirms the failure. The bot's broad readiness inference is unsupported by its own unexplained-gate qualification. | refuted readiness claim; CI03 remains the canonical open item. |
| CRF03 | The latest head lacks fresh remote performance evidence; ignored CSVs were not inspected. | This was a real evidence limit in its supplied context. Both remote repeats and all source bindings now remain recorded; a corrected-harness CI result is still required. | duplicate of CI03; retained in this record and the measurement tables. |
| CRF04 | Confirm joined public pair keys are intended because the issue does not request them explicitly. | The maintainer explicitly chose pair identities, retaining non-key source attribution. The join oracle covers 4,608 states and rejects source-key preference. | accepted-design, with authority and calibration above. |
| CRF05 | Confirm aggregate provenance, caseWhen and select type changes are necessary. | Existing native-type RED evidence identifies wrapped aggregates; provenance closes that class, and tuple inference replaces repetitive overloads. The final 33 owner / 85 supplemental checks and full tsc pass. | already-fixed coverage question; preserve the independent type evidence and declared inference limits. |

Loss accounting: five occurrences = two duplicates + one refuted + one
accepted-design + one already-fixed. The earlier NR/SS/CI ledgers retain their
identities and counts. This review is useful for identifying its own evidence
limits, but it offers no fresh executable counterexample and overlooks the
known gate failure in its merge-risk conclusion. It does not independently
establish readiness or warrant hiring for performance diagnosis. No new
behavioral finding requires an oracle change. The original high review's
correctness and efficiency findings remain accounted for in the earlier ledger.


## eb9ba9aca follow-up: passing CI and dynamic grouping types

The corrected benchmark passes the unchanged gate on remote run 42109495232.
Candidate merge b2ac23b7d4117eacdc666d1c2c22464171b8e3d9 has parents
8feab6ea3eaae4456f738da39fa93508ddd5cc01 and
eb9ba9acab93878233572addbf6358a8df6c046c. Overall ratios are 0.62x writes
and 0.49x cold, with no regression flags. Nested-document writes improve by
91.0% and hydration by 97.1% across configurations. The former failing case
has base repetitions 5.695476, 5.509726, 5.676848 ms and candidate repetitions
6.471167, 8.893417, 4.791310 ms. Their ranges overlap. This passes the gate,
but does not establish zero overhead. All 504 observations join the retained
historical passes and failures in boundary-only-ci-2026-11-05.csv. CI03 is now
fixed-now; the preceding pending description remains a historical observation.

### Type law and test gap

CodeRabbit review 5792245070, covering eb9ba9aca, identifies a real remaining
inference gap. A broad declared group-key array admits an empty value. The
public type must admit the missing generated key at the QueryRef and inline
boundaries. Nonempty grouping or aggregates still contribute a required key.
Authored key fields remain authored, and Collection publication supplies its
required metadata. Authority is the existing boundary-only decision and the
public-type owner's declared-shape law, not the old overload's output. The
coverage map already named the witness but did not authorize it as a product
limitation. The repair location is the type inference and the missing grammar.

The pre-edit oracle extension adds 15 list forms across six authored-field
choices and 24 source descriptions. Callback and helper forms cross mutable,
readonly and empty-or-one tuple declarations with empty and nonempty values.
A statically nonempty tuple and both accumulation orders provide neighbors.
The existing shared model constructs expected shapes from those declarations.
The actual public construction runs before TypeScript checks QueryRef callback,
inline receiving and Collection publication types. No separate pinned expected
answer or production grouping classifier computes the model.

A corrected runtime probe confirms that the empty list exposes no own `$key`
and the nonempty list exposes key 1, through both QueryRef and inline results.
The first attempted native RED fails during construction because the bare
nonempty callback did not bring the grouping compiler. It receives no RED
credit. Adding an empty `groupKeys` carrier admits the same callback grammar.
The corrected pre-edit run fails all 24 generated consumers with TS2344 shape
constraints, while nine calibration/admission checks pass. It runs on eb9ba9aca
before the first production edit. The first repair attempt still fails the
mutable-array and tuple-union distinctions. The final helper tests the whole
declared return type for empty-only and possibly-empty values. Intersection
preserves any earlier definite grouping. Const inference retains literal tuple
facts. These are type-only changes: all three modified builder files emit
byte-identical JavaScript against eb9ba9aca. The measured shipped-size deltas
therefore remain -155 full-export bytes and -1,667 emitted minified ESM bytes.

### Evidence and limits

- **Law:** The declared key-list possibilities determine missing-key optionality.
  Authored keys and actual Collection metadata retain their separate rules.
- **Reach:** All changed grouping-list/collision states run under each of the
  24 source descriptions, with actual construction and three receiving types.
  State counts and exact commands are bound in the adjacent source manifest.
- **RED:** `pnpm --dir packages/db exec vitest run tests/query/virtual-row-fields-types-oracle.test.ts --maxWorkers=2`
  gives 24 failed / nine passed on the unchanged parent after setup correction.
- **GREEN:** The same native owner and supplemental type checks pass after the
  repair. Full DB source/test TypeScript reports zero diagnostics.
- **Mutant:** Requiring keys for all possible lists, omitting keys for all arrays,
  and erasing earlier definite grouping each fail TS2344 shape constraints in
  the same generated consumer. None fails admission, parsing or setup.
- **Limits:** This finite grammar covers the declared list forms above through
  source public types. It does not recover facts erased to `any`, including
  the existing explicit-context-only helper generic. Built declarations and
  installed-package consumers remain separate receiving paths. Runtime timing
  is unchanged because the emitted JavaScript is identical. No oracle budget
  or performance threshold decreases.

ORC audit: ORC-001/002 authority and independent declared-shape judgment remain
above; ORC-003 prose, grammar, production construction and comparison stay in
the owner. ORC-004 reconstruction covers the original empty-array witness;
removing list form, runtime choice, wrapper or accumulation axes loses a distinct
legal neighbor. Key/value/optionality/union source axes retain their earlier
roles. Illegal non-record facades and optionless indexes remain admission
controls. ORC-005 observes all three named public receiving types after legal
construction, with source facts present at inference. ORC-006 and ORC-013 use
the three isolated wrong designs. ORC-007 does not apply to exhaustive finite
consumer generation; there is no random campaign. ORC-008 does not apply to a
stateless type law. ORC-009 uses existing grouping and publication terms.
ORC-010 retains diagnostics and existing cleanup. ORC-011 uses runtime empty
and nonempty observations as a separate formulation of key presence, without
claiming runtime performance from types. ORC-012 binds this review to the
manifest's sources and evidence. ORC-014 uses the actual TypeScript compiler,
public construction and receiving paths rather than a controlled compiler.
ORC-015 retains declared reach; ORC-016 uses the shared shape model for every
new finite input. No ordinary type examples enter the oracle.

### Loss audit and reviewer assessment

The raw review body, mutable summary, inline comments and conversation comments
were inspected together. The seven source-order occurrences remain distinct:

| ID | Original claim or suggestion | Technical verdict and evidence | PR action / durable value |
| --- | --- | --- | --- |
| CRE01 | Possibly-empty readonly array callbacks incorrectly require `$key`; only scalar/nonempty lists should require it. | Confirmed by runtime and native RED. Optional missing keys preserve both empty and nonempty outcomes; accumulation and authored-key neighbors reject narrow repairs. | fixed-now; existing public-type owner, coverage map and this record. |
| CRE02 | Docstring coverage is 45%, below a required 80%; add missing docstrings. | No repository authority establishes that bot default as a requirement. | duplicate of CRF01 and the earlier refutation; optional documentation feedback remains preserved. |
| CRE03 | The current head lacks fresh remote performance evidence and the localized gate remains unresolved. | Stale after remote run 42109495232 passes unchanged thresholds. The bot's supplied context ended before that result. | stale; retain the exact fresh run and both earlier failures. |
| CRE04 | Reviewers should confirm joined pair keys are intended. | The maintainer explicitly selected pair keys with the other three source-attribution fields retained. | duplicate of CRF04; decision and generated joined-identity evidence remain above. |
| CRE05 | Reviewers should confirm aggregate provenance, caseWhen and select type changes are necessary. | The prior native RED/GREEN establishes the wrapped-aggregate and value-type gaps. | duplicate of CRF05; preserve the type evidence and explicit-erasure limits. |
| CRE06 | Ignored measurement CSVs were excluded and not inspected. | Accurate evidence limit in the review's context, not a code defect. The manifest and versioned tables retain the observations. | accepted-design for that review's evidence scope, without reducing this PR's measurement obligation. |
| CRE07 | Suggested reviewer `kevin-dp`. | Optional routing suggestion, without a technical claim. | accepted-design as optional routing feedback; no assignment or message sent. |

Loss accounting: seven occurrences = one fixed-now + three duplicates + one
stale + two accepted-design. No confirmed-open, deferred or design-decision item
remains in this review. The original ten findings and all sibling findings
retain their earlier ledger entries. The fresh review is accurate and useful
on the dynamic-list inference boundary, but it repeats stale measurement and
design questions without reconciling their recorded evidence. Hire with
supervision for type-boundary review; do not rely on its broad readiness or
performance conclusions. CI and readiness remain separate final-head gates.
