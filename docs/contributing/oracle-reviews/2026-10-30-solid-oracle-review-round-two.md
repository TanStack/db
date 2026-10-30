# PR 2307: second independent oracle review

Five independent reviewers used `oracle-review` on code commit
`77c27a9d9031d58362d779d029cebd4928238e81`, against base
`0531c50ad419a1b51ad3e27e3632e70be3c6bdb3`. The evaluation used
`evaluate-review`. This record supplements the earlier
[native-store review](2026-10-30-solid-native-store-review.md); its historical
findings, decisions, and process qualifications remain intact.

## Laws, experiments, and repairs

**Borrowed source values remain unchanged.** Immutable updates,
`PendingMutation.original`, `ChangeMessage.previousValue`, and the shared
framework result contract supply authority. The snapshot owner previously
checked retained rows but could miss corruption confined to the latest source
row. A fault control passed twenty actual Solid histories despite fifteen
corrupted source containers. Three controlled variants also escaped the old
checker: current source, newly admitted change value, and initial borrowed row.

The owner now captures initial and admitted references before materialization
and compares current source rows at every initial, held-handler, and settled
cut. Expectations remain earlier admitted facts, independent of adapter code.
All 45 receiving groups / 828 finite histories and eighteen calibrations pass.
Each group requires complete reach for all three added observations. The same
real Solid fault control now fails at `current source row a`, 999 versus 3.

**Current tracked consumers observe admitted user values.** The Solid overview
promises reactive updates; the shared framework result contract preserves user
fields. Existing accepted values include functions, inherited-name shadows,
null-prototype nested objects, and live nested getters. Untracked comparisons
did not test their interaction in a real Solid consumer. Native callable reads
could throw through a shadowed `hasOwnProperty`, and stable-root replacements
could leave callable or `__proto__` consumers stale. Inherited array methods and
callable getter results supplied adjacent witnesses.

The primary Solid owner adds 33 callable, eighteen reserved-field, and eighteen
array-method histories across callback/config/supplied-Collection inputs. It
checks actual tracked function identity, receiver-sensitive results, signal-only
changes, omission/readmission, exact helper-name shadows, source preservation,
and quiet unrelated consumers. Source-admission premises precede receiving
credit. Root getters remain subject to Core admission; nested callable getters
are the live-getter witness.

Native setters and nodes still own updates. A read facade handles live accessor
results and inherited methods without invoking Solid's user-shadowed helper.
Admission seeds native data nodes for callable data and the reserved field.
Bookkeeping identities and resource tracking remain transparent.

**Unchanged admitted children retain identity and complete values.** The
maintainer's native-store decision permits replacing changed nested containers,
while unchanged source containers retain identity. Twenty-four added histories
cross one/two array levels, three inputs, and ordinary/native parent transitions.
Twelve wrapper-switching histories failed before repair; twelve same-wrapper
controls passed. Source child identity is asserted before checking actual `For`
mounts. Memo lookup now uses the canonical native backing node.

The existing reorder check also ignored tail values. Two reviewers independently
showed a wrong native setter could publish `[10, 99]` instead of `[10, 0]` while
all 240 original Solid tests passed. Every reordered element's current scalar,
identity, and rendered position is now compared using immutable admitted facts.
All twelve original reorder histories reject that mutant at value assertions.
No production reorder repair was necessary.

**Selection constructs results without modifying borrowed source paths.**
Authority is the select/spread guide and live materialization's pure-composition
law. Nested authored objects replace earlier fields; dotted paths preserve
unrelated siblings. The old grammar tested root and nested selection separately.
Their overlap exposed source mutation, nonconfigurable-input redefinition, and
incorrect retention of fields absent from an authored replacement object.

The existing public-field companion now supplies thirty overlap cells: three
destinations, four expression operations, two source descriptor policies, plus
six functional Core controls. Four Core paths use fresh independent sources.
Twenty-four legal expression cells also use every real framework callback/config
driver. Each cell checks selected output, current source, retained source, and
descriptor admission at three stages, with twelve required checkpoints.
Unkeyed functional projections remain Core-only because they lack the stable
query identity required by React and Preact. Fresh expression controls supply
the receiving neighbors instead.

Before production edits, Core reported eighteen failures and 168 passing tests.
Every one of fourteen actual receiving groups reported eighteen failing overlap
cells and six passing controls. The repair emits fresh-object operations for
authored nested objects and shares one output-ownership resolver between nested
spreads and dotted writes. It copies borrowed paths before modifying them.
No descriptor-specific workaround weakens source preservation.

A follow-up review found E2: defining a configurable `length` on an owned array
throws. Six additional ordinary/subclass-array cells cross the same three
destinations and selected lengths zero, one, and two. Before that repair, all
six failed on Core and every receiving group; old controls passed. Source
length and intrinsic descriptor premises remained intact. The driver records
post-admission mount errors and continues each stage's comparisons, so an early
throw cannot evade reach accounting. The writer preserves existing own property
attributes when changing its value; new output fields retain ordinary attributes.

## Lossless finding ledger

IDs retain reviewer source order; independently reported duplicates remain rows.
Severity is P2 for behavioral findings. Scope notes do not assert product bugs.

| ID | Original claim | Evaluation and action | Durable owner or value |
| --- | --- | --- | --- |
| S1 | Newly current borrowed source escapes snapshot comparison | `fixed-now`; controlled and real-host fault rejection | Shared snapshot owner; current/initial/admitted references at every cut |
| G1 | Native/ordinary parent switch remounts unchanged child | `fixed-now`; twelve REDs and twelve controls before canonical memo repair | Solid native-parent grammar and actual `For` observations |
| F1 | Overlapping nested spread redefines nonconfigurable source data | `fixed-now`; all Core/receiving paths reject old compiler | Public-field overlap grammar and output ownership |
| F2 | Overlapping writes mutate current and retained source rows | `fixed-now`; baseline age did not waive the defect | Same owner; current and retained source comparisons |
| R1 | Tracked callable reads crash or stay stale with helper-name shadows/null prototypes | `fixed-now`; actual three-input receiving histories | Solid callable grammar, exact shadow and tracked-result comparisons |
| R2 | Reorder comparison misses tail corruption | `fixed-now`; full value/render comparison rejects twelve cases | Solid reorder owner |
| E1 | Independent second-element corruption survives complete package | `duplicate` of R2; complete 240-test survivor retained as evidence | Same repair; no separate production defect inferred |
| E-H1 | Initial historical local-only gate followed first repair | `stale`; recorded historical process variance, not retroactively repaired | Earlier snapshot record; subsequent repairs require receiving RED before edits |
| G-N1 | Module-global immutable memo survives selected tests | `accepted-design`; bounded survival does not imply a forbidden output-alias topology | Approved immutable nested replacement law; preserve implementation freedom |
| S-N1 | Snapshot owner does not compare keyed state | `accepted-design`; keyed state remains in neighboring shared result laws | Do not expand this partial preservation claim into whole-adapter proof |
| R1a | Live getter returning callable defeats data-node-only fix | `fixed-now`; separate signal-only result histories | Same callable owner; accessor-result read facade |
| R1b | Own reserved root field misses first tracked replacement | `fixed-now`; initially absent/undefined/value and omission/readmission cases | Same Solid owner; cold native-node admission |
| F3 | Flattened nested literal retains earlier spread fields | `fixed-now`; flatten-only mutant fails selected shape with sources intact | Public-field fresh-object replacement model |
| R1c | Inherited array/subclass methods fail behind helper-name shadows | `fixed-now`; eighteen histories include omission/readmission neighbors | Same Solid owner; method reads use exposed receiver |
| E2 | Dotted array-length write throws after ownership repair | `fixed-now`; six added cells fail before repair on Core and every host | Same public-field owner; intrinsic writable-field range |

Totals: **15 items = eleven fixed-now + one duplicate + one stale + two
accepted-design**. No review item is deferred or left confirmed-open. The stale
process item cannot be erased by a later passing run. No new law decision was
required. Raw reviews, probes, and the append-only intake ledger are task-local
under `/private/tmp/issue-2305-audit/review-11/`; the decisive evidence is recorded
here so the conclusion does not depend on those temporary files.

All five reviewers merit a hire recommendation within their scopes. Each
supplied executable counterexamples, distinguished oracle faults from shipped
defects, and retained relevant controls. Reactivity and field reviewers found
baseline defects without dismissing them. The independent reorder findings
corroborate one gap rather than inflating the distinct-defect count. Suggested
repairs were useful, but the data-node-only candidate was incomplete for getter
results, and runtime failures receive no assertion-calibration credit.

## Guide conformance and finite limits

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001/002 | Public immutable/result/projection contracts and explicit maintainer decisions; expected admitted facts/scalar shapes do not use production materialization or compiler logic. |
| ORC-003 | Each changed owner explains its contract, model, finite grammar, real entry point, observations, and checkpoint beside executable code. |
| ORC-004 | Added dimensions reconstruct every reported witness. Removing overlap, native-parent switching, callable/getter/method values, or the current-source cut loses a demonstrated counterexample. Bounds and controls appear above. Unsafe alias paths and invalid unkeyed functional receiving inputs remain rejected. |
| ORC-005 | Actual source admission precedes each receiving assertion. Current, retained, rendered, and tracked observations remain distinct. E2 mount failures are recorded after source admission, not treated as setup success. |
| ORC-006 | Original implementations, narrow wrong repairs, current-source corruption, and reordered-tail corruption are rejected. Runtime errors, assertion failures, surviving equivalent designs, and setup failures are recorded separately. |
| ORC-007 | New histories use bounded enumeration. No sampled campaign was added, and no existing run budget was lowered or removed. |
| ORC-008/009 | Retained facts distinguish later corruption; native source identity distinguishes unchanged children. Stage numbers are model-only selectors. Shared concepts use glossary terms. |
| ORC-010 | Existing independent resource cleanup and primary/secondary error preservation remain. E2 records mount failures and retries later stages without fabricating a handle. |
| ORC-011 | Functional Core projections independently challenge expression overlap. Relational source facts and alternate legal-source calibrations avoid coupling expectations to Core normalization. |
| ORC-012 | This versioned record retains findings, exact source identity, chronology, finite evidence, and limits. |
| ORC-013 | Same-wrapper controls, data/getter controls, omission/readmission, fresh-object/dotted updates, and zero/one/two array lengths distinguish nearby wrong rules. |
| ORC-014/015 | All three Solid inputs and every required real framework callback/config path ran before their production repair; each declares its own reach. Helper visibility and supplied-Collection graph work retain their earlier narrower claims. |
| ORC-016 | Finite cases and regression inputs share their owners' models and comparisons. Ordinary calibration examples remain in the calibration file. |

The evidence concerns the finite admitted value grammar, four Core selection
paths, actual framework scheduler cuts, and the named initial/held/settled
observations. It does not prove arbitrary cycles, deep recursion, arbitrary
getter/setter bodies, complete descriptor/class fidelity, callback atomicity,
other settlement schedules, external providers, or native browser rendering.
Changed nested proxies may be replaced, as explicitly approved. Native Solid
proxy assignment through Core drafts retains its separate Drafts support-policy
boundary. No new exclusion weakens a tested contract. Work instrumentation
retains the earlier factor-32 per-distinct-container regression budget; it is
neither an elapsed-time measurement nor a public SLO.

E2's array evidence uses three dense scalar entries and selected lengths 0/1/2.
It does not establish sparse arrays, growing or invalid lengths, or arbitrary
array-subclass behavior. General root Object-prototype method lifecycle is not
claimed by the inherited-array-method family. No counterexample in those
unexercised regimes was established by this review.

## Exact code and verification

Production and oracle repairs are commit
`5e7bda09f2e97b927a365d46fa2dd4e6a2224591`. Integration commit
`f67a87671c8694313f8db9684d16f6291fac9efc` merges main
`a2f346596c34faa7e65211134194337bd2e0007d`. The three production source hashes
remain identical after integration:

```text
70396560a8a16ff5f5113c3cfcb8f75c513563255163acd4affb4801790efc56  packages/solid-db/src/store-materialization.ts
60ff0338e10ff65f8babc23d498156e9746ea20a7524d6efbfd28b67d6f80f58  packages/solid-db/src/useLiveQuery.ts
9546b43f29c2e782cc239cc379cb5e4e662435b938355a9881be7e9953a2e37b  packages/db/src/query/compiler/select.ts
```

Before integration, the final Core owner and select/alias/container-copy
neighbors pass 223 tests. The wider select/compiler/builder/spread/functional/
alias neighborhood passes 325 tests. The six real frameworks pass all fourteen
destination groups, with 420 overlap histories and 1,260 new selected-result
cuts. Every one of the 144 Core path histories and 420 receiving histories
reaches each of its twelve declared checkpoints exactly once. Each records
zero result mismatches and runtime failures. The earlier 819 context, 1,200
field, and 840 receiving-destination comparisons remain.

After integration, all 333 Solid tests pass without type errors. The Core
owner, select, aliases, container-copy, snapshot calibration, and restarted
subscription boundary tests pass all 248 tests. The lifecycle publication
owner passes 145 tests with the previously failing seed `-1439698414`, path
`1:22`, selected for replay. Main's #2313 fixes the separately reported #2310;
that issue is closed. This PR does not alter its lifecycle model or expectations.

Final integrated snapshot/destination replay also passes on React (sixteen
groups), Preact/Vue/Svelte/Angular (eight groups each), and the full Solid run
above, without type errors. These retain all 45 snapshot groups and fourteen
destination groups, including actual local-only Solid histories. The lifecycle
random/replay property additionally passes alone with the same seed and shrink
path. Core and Solid builds, `pnpm lint:changed`, and whitespace checks pass.

Reproduction commands from the repository root:

```sh
pnpm --filter @tanstack/db build
pnpm --filter @tanstack/solid-db exec vitest run --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/query/includes-context-transport-oracle.test.ts tests/query/select.test.ts tests/query/validate-aliases.test.ts tests/query/public-container-copy.test.ts tests/conformance/row-snapshot-calibration.test.ts tests/collection-restart-publication-boundaries.test.ts --maxWorkers=2 --coverage.enabled=false
TANSTACK_DB_ORACLE_PROPERTY=subscription-lifecycle.publication-history TANSTACK_DB_ORACLE_SEED=-1439698414 TANSTACK_DB_ORACLE_PATH=1:22 pnpm --filter @tanstack/db exec vitest run tests/collection-subscription-lifecycle-publication-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm lint:changed
```

For receiving replay, select `row-snapshot-isolation|public-field-destination`
in each framework's conformance runner. React/Solid use
`tests/conformance.test.tsx`, Preact/Vue/Angular use
`tests/conformance.test.ts`, and Svelte uses
`tests/conformance.svelte.test.ts`. Solid's full command also runs local-only
snapshots. `TANSTACK_DB_ORACLE_STATISTICS=1` and `--disableConsoleIntercept`
retain each field history's reach record.

Hostile checks distinguish three Core wrong designs: restoring the original
compiler gives eighteen failures, omitting fresh-object operations gives twelve
selected-shape failures with sources intact, and bypassing borrowed-path copies
gives six source/retained-source failures. The pre-E2 writer and ignored-length
mutants each fail six array cells. The latter has 72 selected-result failures
and zero runtime errors. The pre-E2 variant has 72 primary intrinsic-length
errors and 54 secondary reads of absent correlated results. Secondary reads
are not counted as additional defects or independent witnesses.

Solid's old memo key fails twelve identity comparisons with twelve controls
passing. Removing node seeding gives twelve stale-value assertions and nine
post-setup callable runtime failures. Removing the getter or inherited-method
bypass gives six post-setup runtime failures each. Four separate wrong-observation
calibrations reject incorrect callable/method results using the same comparisons.
These runtime outcomes are not described as assertion kills. The reorder-tail
mutant fails all twelve original reorder value comparisons. Source-only
corruption fails the strengthened shared snapshot comparison.

The final helper is 192 lines, compared with 136 at the reviewed native cut
and 330 before the native-store redesign. A same-tool externalized hook build
changes from 4,792 minified / 2,032 gzip / 1,865 brotli bytes to
5,623 / 2,296 / 2,111: +831 / +264 / +246 bytes. These are isolated hook
measurements with Core, Solid, and primitives externalized, not application
timings or release-package size.

The final independent follow-up passes the original E2 public witness and all
six new primary-oracle cells without type errors. It finds no further supported
defect or overconstraint in the bounded final repair. Local review accounting
and implementation are complete within the stated limits. Final pushed-head CI
status is a separate PR observation, not supplied by local test results.
