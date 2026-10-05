# Compound joins: fresh implementation and oracle evidence

Reviewed implementation: `d64ba0aa66dca3651b41c1b4ac20edfaa1526bf4`.
Feature commit: `a3911f6eb97fcceb319272dba3c3a877222c6890`.
Main merged: `931e8346f5df09b68f436e7ed589a7f46e766104`.
Date: 2026-10-05. Local branch: `codex/compound-joins-861`; no push.

The user requested a fresh implementation of PR #861 as a feature, with its
old implementation and examples removed first. The earlier
[assessment](pr-861-compound-join-relevance.md) applies to the discarded code.
The replacement extends the current equality, identity, and route contracts.
It stores the whole predicate in `JoinClause.on`, validates nonempty nested
AND-of-equalities, and uses graph-scoped component equality identities. The
first equality supplies candidate demand; every equality controls matching.
No new runtime state machine, fallback lifecycle, or dependency was added.

Direct IR consumers must replace `left`/`right` with an `on` expression. Public
builder syntax for existing single equalities is unchanged. Existing IR tests
were migrated mechanically, preserving their laws and assertions.

## Contract, grammar, and limits

The live-query architecture's Identity and route-context laws supply value and
parent semantics. The feature request authorizes compound equality syntax;
`ARCHITECTURE.md` and the live-query guide now state that extension.

- **Relational owner:** `cold-join-reconciliation-oracle.test.ts`. A label table
  declares 23 representative values and their equality classes independently
  of production normalization. Nested loops recompute exact ID-pair bags and
  unmatched outer rows. Public rows, size, and an event-reconstructed replica
  are compared after preload and every applied sync transaction.
- **Identity owner:** `identity-output-shape-oracle.test.ts`. Independent numeric
  nested loops supply expected public rows for four predicate variants across
  direct, from-QueryRef, and joined-QueryRef boundaries. Only after output is
  checked do identity and compiler cache-equivalence assertions run. Reordering,
  reversing, and duplicating terms preserve identity; changing the later field
  changes identity and cannot reuse the subquery.
- **Transport owner:** `includes-context-transport-oracle.test.ts`. Independent
  numeric source-pair recomputation checks a parent value used only in the
  second equality. The finite grammar crosses both operand sides and direct
  versus joined QueryRef sources. Collection, array, and materialized forms
  are compared after preload, a parent update, and updates to each child side.

The generated relational grammar has 0–4 distinct keys per source, keys 0–3,
23 value labels, a second component in `{0, 1, null}`, a third in `{0, 1}`,
2–3 terms, and 0–8 keyed put/remove steps. It varies term order, nesting,
independent operand direction, all four join types, scan/eager-index paths,
and eager/controlled-cold acquisition. Remove-absent is a driver no-op; writes
use insert/update according to installed keys. The nonselected revision field
makes reference-only replacements observable to source change detection.

The larger fixed matrix separately covers all 23 values together, nulls in
both tuple positions, and leave/restore/delete/reinsert histories. Each local
matching distinction can be reconstructed in the generated domain by retaining
its relevant rows and relabeling IDs and ordinary numeric equality classes.
The larger matrix itself is outside the generated four-row bound.

Each axis has a distinguishing purpose: labels reject structural/JSON equality;
nulls reject null matching; width rejects partial tuple matches; term order
prevents lazy candidate filtering from masking bad tuple equality; reversal
requires independent operand analysis; nesting exercises recursive admission;
join type preserves unmatched rows; updates exercise retractions and restored
matches; indexes and cold sources cross different acquisition paths. OR,
inequalities, empty AND, and an invalid nested term are explicit rejection
controls. Wider tuples and arbitrary expression trees are not established.

The cold provider publishes its finite table on demand. This proves controlled
acquisition and result truth, not provider I/O, eviction/reentry, minimal demand,
or performance. Async/optimistic/paginated/deeper include cross-products and
framework consumer caches remain scoped follow-ups in the coverage map.

## RED, calibration, and GREEN receipts

The first oracle run occurred after restoring the old PR's production files
and example-test file to main. Its 17 feature cases failed at join admission.
On the reviewed revision, copying only the merged main's builder back produced
21 feature-case failures at the same admission boundary; four invalid-predicate
controls passed. This latter receipt is specifically a builder-boundary check,
not an all-main integration run.

Temporary mutants were restored after each run. The final source remained
unchanged. These receipts distinguish assertion failures from pre-check errors:

| Wrong design | Mutation | Observed result |
| --- | --- | --- |
| Only the first equality matters | Compiler condition list sliced to its first entry | 13 failures at exact public-pair assertions; includes the generated property |
| Raw JSON defines tuple equality | Normalized component array replaced by `JSON.stringify(values)` | Distinct objects, opposite infinities, and Date/ISO-string pairs fail public-pair assertions; BigInt separately fails during evaluation before publication |
| Predicate does not affect identity | Canonical join predicate replaced with constant TRUE | All three identity cells fail the unequal-identity assertion after independently checking public rows |
| Predicate does not affect cache equivalence | `normalizeQuery` omits `on` | All three cells fail the cache-equivalence assertion |
| Only first joined operand discovers parent routing | Parent-use scan restricted to first condition | Direct-source/joined-side cell fails public forms immediately after preload; the other three cells pass |
| Only first equality contributes parent references | Both builder walkers visit only first AND term | All four transport cells fail public forms immediately after preload |

The initial raw-JSON mutation name filter selected no tests. It was classified
as unreached, not a kill. Inspection identified the candidate-filter masking
risk, so term-order variation and explicit safe-first-term witnesses were added
before the corrected run.
An initial omitted-identity mutation passed `undefined` to the canonicalizer;
that was a pre-check error, not a semantic kill. The constant-predicate mutant
above reaches and fails the intended identity assertion.

The property runs 60 histories with fixed seed `861593`, then the identical
property and budget without a seed. Direct replay selects only the requested
lane. The drop-equality mutant shrank to seed `861593`, path
`1:1:2:2:3:3:3:3:3:3:3:3`. The guarded command below executed exactly one case,
failed at the public-pair checkpoint with that mutant, then passed after restore:

```sh
cd packages/db
TANSTACK_DB_ORACLE_PROPERTY=cold-join.compound \
TANSTACK_DB_ORACLE_SEED=861593 \
TANSTACK_DB_ORACLE_PATH=1:1:2:2:3:3:3:3:3:3:3:3 \
node --import tsx tests/oracle-replay.ts \
  tests/query/cold-join-reconciliation-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Final regression: **858 tests passed in 20 files**. This includes all compiler
suites, join/builder/optimizer suites, the three changed oracle owners, stable
identity, join-result-key, includes-query-shape, and includes-cross-formulation.
DB build and declaration emit passed, as did the DB TypeScript check. Changed
TypeScript lint passed with six pre-existing async-without-await warnings.
`git diff --check` passed. No full monorepo or framework campaign is claimed.

Frozen installation was blocked by registry errors (configured proxy 403,
public registry 503). Verification used the main checkout's installed external
dependencies and this worktree's built DB/IVM packages. This is not a clean
frozen-install CI receipt. Missing Expo example dependencies emit warnings.

## Oracle-guide audit

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Contract and limits are stated in each executable owner and above. |
| ORC-002 | Label equality and numeric nested loops do not call production semantic helpers to compute expected rows. Identity helpers are observations under test. |
| ORC-003 | Existing literate owners now contain adjacent compound law, model, grammar, driver, and checkpoint prose/code. |
| ORC-004 | Reconstruction, per-axis contribution, bounds, and invalid neighboring forms are recorded above. |
| ORC-005 | Public query construction, preload, sync commits, exact row bags, events, and all materialization forms execute; failures identify reached checkpoints. |
| ORC-006 | Six wrong designs are rejected at the relevant comparisons; pre-check and unreached attempts are separately classified. |
| ORC-007 | Identical fixed/random grammar and 60-run budget; property registry, manifest filter, and guarded red/green seed-and-path replay. No commands arbitrary is used. |
| ORC-008 | Model state is only current keyed source rows. Key, equality-class label, and component values distinguish future matching or removal; no production indexes/caches/transitions are duplicated. |
| ORC-009 | Value labels abstract equality classes; installed-key bookkeeping and revision belong to the driver. The replica folds public events, not internal D2 state. |
| ORC-010 | Existing cleanup helpers preserve primary failures and secondary diagnostics. Construction is inside cleanup ownership; identity drivers register each created live query immediately. |
| ORC-011 | No additional shared-model semantic fault was identified requiring a second formulation. Independent label/numeric models plus mutations distinguish the reported wrong designs. Existing single-equality predicate comparisons remain intact. |
| ORC-012 | This versioned record identifies the exact reviewed implementation, evidence, and remaining owners. |
| ORC-013 | True matches and same-prefix/later-component mismatches, real nulls, missing outer peers, and same-correlation/different-parent-parameter cases distinguish nearby wrong rules. |
| ORC-014 | Controlled provider boundary is explicit; real-provider acquisition is not claimed and is assigned in the coverage map. |

## Code weight

Compared with merged main, production TypeScript changes are **+73 / −67,
net +6 lines in eight files**, including comments and blank lines. Tests are
**+938 / −133, net +805 lines in eleven files**, including mechanical migration
of direct IR fixtures. Before this evidence record, docs and the changeset are
+196 / −3 lines; the architecture document is counted as documentation, not
production code. These are source-line counts, not bundle-byte measurements.


## Review follow-up: acquisition premise and test maintenance

Review started at `cb1262754aecc6ebc8de975f0b2b0581fd29a9ad`. The fixes are
in `dc78e6947441a51e2317f6fb9bd99232bdcc0ced`. This section is a later receipt;
the implementation, counts, and environment limits above retain their original
revision scope. This review changed tests and documentation only. Production
weight remains net +6 source lines against merged main.

The compound oracle incorrectly required acquisition when the atom component
was nonnull but the other component was null. A null first demand key can
correctly produce an unmatched LEFT row without acquiring the right source.
The violated test law was conditional acquisition: a positive witness requires
a satisfiable tuple. Result truth does not require minimal candidate demand.
The original generator already reached this overlap; the assertion premise was
wrong. The fixed seed had missed it, and an independently generated history
exposed it.

The exact failing history had left row `{id: 0, atom: 0, b: null, c: 0}`, empty
right rows and steps, LEFT join, width two, `atomFirst: false`, no nesting or
reversal, cold source, and indexing off. Public rows, size, and the event
replica were correct before the acquisition assertion failed.

This guarded replay ran exactly one case and failed before the fix, then
passed with the corrected premise:

```sh
cd packages/db
TANSTACK_DB_ORACLE_PROPERTY=cold-join.compound \
TANSTACK_DB_ORACLE_SEED=3 \
TANSTACK_DB_ORACLE_PATH=39:1:1:2:2:2:3 \
node --import tsx tests/oracle-replay.ts \
  tests/query/cold-join-reconciliation-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

The oracle now pins 16 premise cells: scan/eager indexes, both term orders,
nonnull/null atoms, and nonnull/null second components. Before the fix, the
null-first cells failed in both index modes; the other 14 passed. All 16 pass
after requiring both components to be nonnull for positive acquisition.
No zero-acquisition assertion was added for unsatisfiable tuples.

Two calibration tests hide acquisition on a satisfiable tuple whose empty
right source produces the same unmatched output. Both reject the hidden
observation. A temporary broad waiver of the positive acquisition assertion
made both calibration tests fail because their checks incorrectly resolved.
Restoring the assertion made both green. Thus the fix does not waive required
acquisition merely because row output happens to be correct.

Maintenance changes reuse the existing `createEq` helper in 41 optimizer
fixtures, attach expected semantics to named identity variants, replace two
nested grammar ternaries with explicit branches, format the lazy-demand
fixture, and correct the contradictory coverage-map sentence. No contract was
changed to fit a production result. Both identity and cache-equivalence source
mutants still fail all three compound boundary cells at their intended
assertions; after restoration, those three cells pass.

Validation at the fix revision: **876 tests passed in 20 files**, DB TypeScript
passed, changed-test ESLint passed with two existing async-without-await
warnings, formatting passed, and `git diff --check` passed. One intermediate
type check rejected passing the now-two-parameter history driver directly to
fast-check; a one-argument callback fixed the inference without changing the
grammar. The original build receipt remains valid for unchanged production
sources; no new clean-install or full-monorepo receipt is claimed.

All 26 review items were accounted for: six fixed, eight refuted within their
stated paths, three deferred, and nine duplicates. The residual measurement
and evidence questions have durable destinations in the Compound joins section
of the [coverage map](../oracle-coverage.md): candidate-demand minimality,
single-equality allocation cost, and a hypothetical throwing-unsubscribe path.
No measured performance regression or reachable cleanup failure was supplied.
These limits do not establish untested provider or lifecycle cross-products.


## External review follow-up: null demand and filtered acquisition

Reviewed head: `ee490df80d200f701df805faf81d8105ba492527`.
Fix revision: `de61f1dd32737da86a3d1d9503b3134e078b06a9`.
Comparison base: `84dc899bfc8d6a16487c1584dbb1cb177109aacc`.
These later receipts supersede the earlier deferral of null-tuple candidate
demand and operand-array cost. Historical counts above retain their scope.

A LEFT join over `{sku: 1, region: null}` and `{sku: 2, region: null}` requested
`sku IN (1)`. Deleting the first row left that request active. Public unmatched
rows were correct, but neither tuple justified keyed acquisition. The shared
unmatched key kept the first raw demand representative. Both pipelines now
suppress raw demand whenever their tuple is unsatisfiable.

The compiler demand oracle models a keyed table and recomputes the first-field
set from nonnull tuples after each graph turn. Its eight histories cross
LEFT/RIGHT, two/three components, both orders, shared primary keys, null and
undefined, and put/remove/restore. Before repair six cells failed exact demand
comparison and two controls passed. All eight now pass. The public adapter
probe now observes no requests before or after deletion while unmatched rows
remain correct. Other acquisition-minimality and asynchronous provider claims
remain outside this finite compiler boundary.

The cold provider now interprets direct-field IN requests using independent
atom equality labels. Four cold-load witnesses use distinct component values
1, 7, and 9 across both term orders and index modes. A source mutant that uses
the last field with the first field's values passes all four with the former
whole-table provider. With the filtered provider, all four fail at public-pair
comparison: an unmatched row appears instead of the matching pair. Restoring
production returns GREEN. An earlier broad mutation run already failed a
non-cold generated history under the original fixture; the review's blanket
claim that wrong demand could never be detected was too broad. The missing
regime was this controlled cold adapter boundary.

The per-row extractor now evaluates the first operand directly and constructs
one normalized tuple only for multiple equalities. Instrumentation at the
operand-array creation sites, restored after each run, measured these counts
with 10,000 input rows on each side and 10,000 matching pairs:

| Representation | Single equality | Two equalities |
| --- | ---: | ---: |
| Reviewed head | 20,000 | 40,000 |
| Fix | 0 | 20,000 |
| Always construct a tuple alternative | 20,000 | 20,000 |

These counts exclude existing stream/output arrays. They measure allocations,
not elapsed runtime or retained heap. The always-tuple alternative passed 258
relevant tests, but restores the single-equality cost. It remains unselected.
No new production state, dependency, or fallback was added.

At the fix revision, temporary source mutants produced these outcomes:

- Restoring raw demand for unmatched keys: six demand assertion failures.
- Dropping later equalities: thirteen relational assertion failures.
- Raw JSON tuple equality: three public-pair assertion failures, plus a BigInt
  evaluation error before publication. The latter is not an assertion kill.

The observation-level hide-acquisition control remains useful to calibrate the
positive acquisition assertion. ORC-006 and ORC-013 explicitly do not require
permanent source mutants. The source mutation receipts above complement that
control without adding mutation infrastructure to ordinary CI.

The other review outcomes are bounded:

- Field-to-literal equality passes builder syntax checks and fails compilation
  with `InvalidJoinConditionSourceMismatchError` on both main and the reviewed
  branch. This is a source-binding error, not a newly accepted valid join.
  Architecture admission specifically rejects OR and non-equality predicates;
  it does not promise builder-time source binding. The guide and agent skill
  now state where literal filters belong and when source binding fails.
- First-equality planning is intentional. Probes distinguish a full-source
  request for computed-first, SKU IN for plain-first, and region IN for
  region-first. The guide and agent skill now explain that work difference.
- Both builder and compiler use the shared syntax validator. The compiler also
  accepts direct IR and binds source aliases. Removing a validation boundary
  would need a separate representation design and measured compile-work benefit.
- The old assessment already identified itself as superseded. It is now a short
  historical pointer that preserves access to its exact old diagnostics.

Final validation: **888 tests passed in 20 files** after restoring every source
variant. DB build/declaration output, DB TypeScript, changed-file ESLint (two
existing warnings), formatting, and whitespace checks passed. An initial
wrong-directory test invocation failed before execution and is not RED evidence.
The first literal probe used the wrong live-query overload; the corrected
`{query}` probe reaches the compiler and establishes the stated behavior.

Production weight is now **+84 / -74, net +10 source lines** in eight TypeScript
files against the comparison base. Tests are +1,132 / -127, net +1,005 lines.
Documentation and executable contract prose are separate from production.
The previous +281-byte gzip receipt belongs to `ee490df80`; a later CI size
check must measure this revision. Current provider, temporal, cleanup, and
performance limits remain owned in the coverage map.
