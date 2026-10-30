# Distinct collision review — 2026-10-30

Source: [issue 2306](https://github.com/TanStack/db/issues/2306), by CaliLuke.
The issue has no comments. Reviewed baseline: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.
Implementation: local changes on `codex/fix-distinct-hash-collisions`, based on
fresh `origin/main`. No fix commit or pull request was pushed. This is a
self-review of the repair, not an independent reviewer verdict.

## Law, experiment, inference, and repair

**Law.** Distinct returns one occurrence of each positively supported selected
value. Unequal selections remain separate even when their hashes collide.
The authority is [Distinct in the live-query guide](../../guides/live-queries.md#distinct)
and the existing incrementalization owner's DBSP accumulation/difference law.
The project glossary explicitly says a matching digest does not establish D2
value identity. No new product law or maintainer decision is needed.

**Existing enforcement.** The incrementalization owner recomputed reductions,
joins, groups, and windows, but never constructed `distinct()`. Its model was
not wrong about distinct; the production path and collision-value dimension
were absent. The hash identity oracle promises equal values have equal digests,
not that every unequal value has a different digest. It cannot discharge an
operator's equality obligation.

**Experiment.** Before any production edit, the new distinct extension used the
existing incrementalization comparison with actual native-hash collisions.
Both selected-value and default-tuple D2 paths failed the weighted delta check
at checkpoint 2. Ordered and unordered public live-query Collections also
failed their snapshot comparison at that checkpoint. These were value
assertion failures, not setup failures or timeouts. A noncolliding anchor
remained present in the failing observations.

**Inference.** A digest selected the entire identity class and its count, and
also became the output row key. These are two enforcement gaps. Buckets with
independent counts alone still lose rows when downstream Collections receive
one output key for two selections.

**Repair.** Each hash bucket now checks D2 value equality before sharing a count.
The first entry keeps the existing hash key; colliding entries receive numeric
keys above the 32-bit hash range. An entry retains the representative it emitted,
so a later retraction removes that same row. Zero-count entries are removed only
after the whole graph batch, preserving cancellation and continuous support.
The repair reuses `equalHashValues`, removes repeated hashing during emission,
and preserves the existing sign-crossing rules. It does not rely on a larger
probabilistic digest or a partial structural serializer.

## Evidence block

- **Reach:** Each of the fixed and random campaigns runs 100 generated histories
  per path. The five declared conditions are colliding values together,
  duplicate support, partial removal, last removal while a collision peer stays,
  and reinsertion. Every condition was reached by 100 histories in each campaign
  for selected-value D2, default-tuple D2, unordered public Collection, and
  ordered public Collection. D2 checks both atomic and legal unit-split delivery
  for each history. There are 800 generated histories, before counting that
  second D2 delivery schedule.
- **RED:** On unchanged production, the two commands below failed all four
  generated tests in their respective files. The D2 checker calibration passed.
  Public failure observations omitted a member of native collision pair
  `item-42425` / `item-53868` in the recorded initial process. The issue's exact
  seeded pair was subsequently checked against the restored original operator:
  both digests were `2650141082`, and only `item-90754` remained. That last run
  is supplemental original-operator calibration; the native receiving-path RED
  runs supplied the pre-production-edit gate.
- **GREEN:** The final commands below passed 20 D2 tests and 43 public-query
  tests, including the exact reported pair. Both package TypeScript checks,
  explicit ESLint, `pnpm lint:changed`, and `git diff --check` passed.
- **Mutant:** Restoring the original operator fails at checkpoint 2. Equality
  buckets that still emit the hash as every entry's key fail the public snapshot
  comparison at checkpoint 2. Capping each equality entry's support at one
  fails the D2 delta comparison at checkpoint 4, when partial removal must keep
  a value present. Each mutant was removed; none is part of the final changes.
- **Limits:** The generated payload domain is immutable string/integer records,
  not the whole D2 value-identity domain. There is no claim about representative
  choice among differing unselected fields, ordering semantics, intermediate
  source-transaction publications, framework rendering, every hash seed, or
  digest collision freedom. The public API tested here is re-exported unchanged
  by React DB. Historical published package installations and Bun were not
  independently rerun; current source reproduces the exact reported behavior.
  There is no known remaining counterexample in the declared collision class.

Initial RED commands:

```sh
pnpm --filter @tanstack/db-ivm exec vitest run tests/distinct-incrementalization-oracle.property.test.ts --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/query/distinct-collision-oracle.test.ts --coverage.enabled=false
```

Final GREEN commands:

```sh
pnpm --filter @tanstack/db-ivm exec vitest run tests/distinct-incrementalization-oracle.property.test.ts tests/incrementalization-law-oracle.property.test.ts tests/operators/distinct.test.ts --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/query/distinct-reported-collision.test.ts tests/query/distinct-collision-oracle.test.ts tests/query/distinct.test.ts --coverage.enabled=false
pnpm --filter @tanstack/db-ivm typecheck
pnpm --filter @tanstack/db exec tsc --noEmit -p tsconfig.test.json
pnpm lint:changed
```

Direct replay was checked against both the original and repaired operators:

```sh
TANSTACK_DB_ORACLE_PROPERTY=ivm.distinct-collisions TANSTACK_DB_ORACLE_SEED=1041521789 TANSTACK_DB_ORACLE_PATH=0:0:0:0:0 pnpm --filter @tanstack/db-ivm exec vitest run tests/distinct-incrementalization-oracle.property.test.ts -t 'tuple.*random' --coverage.enabled=false
TANSTACK_DB_ORACLE_PROPERTY=query.distinct-collisions TANSTACK_DB_ORACLE_SEED=-1901465925 TANSTACK_DB_ORACLE_PATH=0:0:0 pnpm --filter @tanstack/db exec vitest run tests/query/distinct-collision-oracle.test.ts -t 'ordered=false.*random' --coverage.enabled=false
```

The guarded replay recorder confirmed the selected properties, seed, and path.
Each original-operator replay rejected one history at checkpoint 2. On repaired
production the replays passed; fast-check visited 40 and 23 histories while
reconstructing their now-passing shrink paths. Fixed campaigns stood aside.
Collision class labels reconstruct the semantic history; the fixture discovers
an actual collision in each native hash session, so concrete row integers can
vary between processes.

## Lossless finding ledger

| ID | Original claim and proposed action | Evidence and technical verdict | Action | Durable destination |
| --- | --- | --- | --- | --- |
| R1 | Hash-only multiplicities and output identity silently merge unequal selections. Reported with React DB 0.5.12 / DB 0.15.2 / IVM 0.2.0 and React DB 1.0.0-rc.1, Bun 1.4.4 on macOS arm64. With initialization random fixed at 0.5, selections `{id:'item-51277',value:51277}` and `{id:'item-90754',value:90754}` produce one row, missing 51277; expected two. Without distinct both survive. | Confirmed on current source: pre-edit native D2 and public RED, and exact seeded original-operator replay. Published versions and Bun were not reinstalled. Severity P1: silent data loss. | fixed-now | Shared recomputation model, generated collision histories, public receiving driver, and seeded replay. |
| R2 | Without a fixed seed, sufficiently many unequal rows lose rows; the collision pair varies by process. | Confirmed mechanism with native randomized initialization: fixture search finds an unequal colliding pair and the public path loses a member. The persistent campaign uses that pair, not a large-input performance test. No throughput or cardinality threshold is claimed. Severity P1. | fixed-now | Native collision discovery in both D2 modes and the public driver; no production hash mock. |
| R3 | Incremental insertion/deletion multiplicities can affect a different colliding logical row. | Confirmed shared-counter defect. Generated histories cross both insertion orders, duplicate support, partial and final removal, simultaneous replacement and reinsertion. Parent fails on insertion before later cuts; the capped-support mutant reaches and fails partial removal at checkpoint 4. Final output agrees at every cut. Severity P1. | fixed-now | Same law/grammar, with five declared reaches per receiving path, and the capped-support mutant calibration. |
| R4 | Collision-safe equality buckets or structural identity are needed; a larger probabilistic hash only reduces frequency. | Correct. A finite digest cannot be an injective identity for this unbounded value domain. Existing structural identities are partial, so equality buckets are the direct complete fallback. Shared-output-key mutant proves the additional identity obligation. | fixed-now | Equality-checked entries and separate collision keys in `DistinctOperator`; retained noncollision keys and existing tests. |

The original report has no footnotes, capped findings, deferred suggestions, or
comments beyond these claims. The expected/actual pair, version/environment
claims, no-distinct control, native-seed claim, multiplicity consequence, source
location, both repair alternatives, and larger-hash caveat are all retained.
No sibling defect remains open. No deferral, exclusion, or law narrowing was
used to make the comparisons pass.

## Reviewer assessment

**Hire recommendation on this sample: yes.** The report is technically accurate,
high signal, and correctly prioritizes silent corruption. Its isolated public
reproduction, exact seed, two release families, negative control, and source
explanation show strong debugging depth. The proposed repairs target equality
rather than collision probability. The report also identifies incremental
consequences; the repair adds the missing support-history evidence. One report
cannot establish the reviewer's general performance. The useful addition is a
generated oracle and a public output-key witness, rather than a correction to
the report's diagnosis.

## Oracle conformance self-audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Unique-selection authority and limits are stated beside the model and above. |
| ORC-002 | Expected results use named-field equality and full recomputation; production hashing only selects adversarial fixtures. |
| ORC-003 | Shared module explains law, model and grammar; D2 and public files explain paths, observations and checkpoints. |
| ORC-004 | Original pair is replayed. Both orders and together/separate insertion are generated; removing either loses a collision regime. Support 2–4 reaches duplicate and partial removal; tails have 0–12 worlds of 0–8 slots with labels 0–2. Slots construct legal unique source keys and exclude negative source support and invalid fixture labels. An anchor and net-zero D2 cancellation distinguish nearby unaffected cases. Larger counts need only range expansion. |
| ORC-005 | Real D2 distinct and public select/distinct, ordered and unordered, are exercised. Comparisons preserve omissions and duplicates. Every source write is applied before its snapshot assertion; no concrete missing-source-information hypothesis was identified. |
| ORC-006 | Three production mutants fail the intended value comparisons; bad snapshot controls also reject omissions, duplicates and substitutions. |
| ORC-007 | Fixed seed 2306 and unseeded campaigns use identical grammar, budget, driver and comparison. Captured seed/path replays were checked. No commands arbitrary is used. |
| ORC-008 | The reference recomputes from a complete input relation; it adds no incremental subsystem state. |
| ORC-009 | Class labels are explicitly model-only; slots map to unique source row keys. |
| ORC-010 | Existing public `withOracleCleanup` releases retention, query and source while preserving primary and secondary failures. D2 fixtures own no asynchronous resources. |
| ORC-011 | No concrete shared semantic fault requiring a second formulation was identified. Fixture-defined named-field equality is independent of production equality. |
| ORC-012 | This versioned record ties outcomes, commands, limits, and the source fingerprints below to the reviewed baseline. |
| ORC-013 | Duplicate support followed by partial then last removal distinguishes boolean-presence counting; collision peers and an anchor distinguish shared-count and shared-key designs. |
| ORC-014 | No controlled external-provider premise is claimed. Native-hash collisions reach the real public core API. React re-exports it; render scheduling remains outside this claim. |
| ORC-015 | Five declared conditions each reach 100 histories in every fixed/random campaign, separately for each receiving path. |
| ORC-016 | The seeded regression replays the same shared judgment; it has no hand-written expected result. Oracle files contain only reusable law executions/calibrations. |

## Shipped bytes and final accounting

`pnpm size:compare --packages db-ivm,db --files` compared the working source with
`c351fc04d`: db-ivm grows **99 gzip / 86 brotli bytes**, db is unchanged, and
the typical app grows **82 gzip / 157 brotli bytes**. Source minification adds
185 bytes in distinct. The repair consolidates updates by entry and removes
second hashing calls; collision equality, per-value counts and independent
numeric identities require the remaining state. Hash enlargement cannot remove
that state correctly. Replacing it with the partial structural identity would
still require a collision-safe fallback. Tests add 432 lines; no production
refactor was traded for a weaker comparison.

Loss audit: **4 raw items = 4 fixed-now**. No confirmed-open, stale, refuted,
accepted-design, deferred, design-decision, or duplicate item remains. Item
accounting, implementation, and bounded oracle repair are complete. This is
finite evidence, not a proof over every JavaScript value or history.

**PR readiness: not assessed.** There is no fix PR or pushed fix commit, and
remote CI was not run. The local repair and listed checks are complete.

## Reviewed source fingerprints

The baseline HEAD above plus these SHA-256 digests identifies the reviewed local tree.

```text
1f3f5c4d85c0bb1b9c3be57e5dca567a358d6e41a0191cc7fddae6bae5e170d9  packages/db-ivm/src/operators/distinct.ts
789345c21ac3fa1d13b6af671686f9ba1cbfee2027479f0efd9849884b389a6e  packages/db-ivm/tests/distinct-incrementalization-oracle.ts
c935d1ab1803f0bd3a81f86bee431f5237811ef3c148933f8fd64456ab74a8b4  packages/db-ivm/tests/distinct-incrementalization-oracle.property.test.ts
0ca0a116a74c239f4f4d09072604e14806967f9c0aa0c4721721e74f876c680c  packages/db/tests/query/distinct-collision-oracle.test.ts
af173f3d6bd7f2f49ac7007c000874f0282772c2feb14373bbbca6b35f5169e3  packages/db/tests/query/distinct-reported-collision.test.ts
570856fac722eb60e36da37208858300e181ee16011c86817746d34043a4fc49  packages/db/tests/oracle-config.ts
```


## Follow-up: reduce production weight

The preceding evidence and fingerprints describe the initial repair. This
follow-up supersedes its implementation, size, and final-check accounting;
the law, model, grammar, observation cuts, comparisons, budgets, and limits
remain unchanged.

The final operator keeps a named tuple for each equality entry: selected
identity, emitted row, support multiplicity, and prior visibility. A set of
touched hashes replaces the separate map of pending entry multiplicities.
Support accumulates in the entry, and one bucket pass decides visibility and
removes zero-support entries after the entire batch. This removes the separate
before/after count bookkeeping and duplicated sign-crossing branches while
preserving cancellation. The constructor alone owns the default selector.
Noncolliding output keys remain their original hashes. Collision entries now
use decreasing negative keys, disjoint from unsigned hash digests; this
supersedes the initial repair's increasing keys above the hash range.

`output` and `tap` both invoke the callback once per message and forward that
same message. `output.ts` now re-exports `TapOperator` and `tap` under the existing
public names, removing the duplicate operator and graph construction. The
existing output, graph and graph-work tests exercise this shared implementation.
No tap-specific test file was run.

The following alternatives were measured and discarded:

| Alternative | db-ivm gzip / brotli delta | Typical app gzip / brotli delta | Reason |
| --- | --- | --- | --- |
| Reuse graph input construction in five factories | +88 / +100 | +72 / +105 | Repeated factory code already compresses well; raw savings did not improve the relevant totals enough. |
| Shared unary factory helper | +86 / +90 | +61 / +167 | Added helper and call plumbing outweighed compressed savings. |
| Derive per-input visibility deltas and consolidate | +30 / +20 | -5 / +87 | Removed stored visibility but added consolidation work and grew typical app brotli more. |

Final command: `pnpm size:compare --packages db-ivm,db --files`, against the
same `c351fc04d` baseline:

| Target | gzip delta | brotli delta |
| --- | --- | --- |
| db-ivm package | +17 bytes | +10 bytes |
| db package | 0 | 0 |
| Typical app | -21 bytes | +17 bytes |

Distinct adds 56 minified module bytes; sharing output/tap removes 300. The
typical app is net negative in gzip, but this is **not** a net-negative result
across both compression formats and package totals. Equality buckets and
independent collision identities still require state that the defective
hash-only implementation omitted. Further unrelated cleanup or code golf was
not used to claim success. Comments, descriptive names, test comparisons and
run budgets were preserved. Test additions remain 432 lines, separate from
production bytes.

Final validation passes 39 D2/operator/graph tests and 43 public-query tests.
The same 800 generated histories reach all five conditions, separately for
selected/default-tuple and ordered/unordered public paths, with no reduced
budget. The exact seeded pair still has digest 2650141082 and both rows survive.
Both package TypeScript checks pass. Restoring the original operator rejects
checkpoint 2; forcing colliding entries to share output keys rejects the public
snapshot at checkpoint 2; capping support at one rejects partial removal at
checkpoint 4. Each mutant was removed and the final operator restored.

The D2 GREEN command now additionally includes
`tests/operators/output.test.ts tests/graph.test.ts tests/d2-work.test.ts`.
The public GREEN command is unchanged. These measurements and tests establish
the stated finite claim; they do not change the limits or PR-readiness verdict
recorded above. All repair changes remain uncommitted and unpushed.

Formatting, explicit ESLint, `pnpm lint:changed`, and `git diff --check`
passed for this final tree. Final follow-up SHA-256 fingerprints:

```text
e11db3407cc67be12aedd954039ccb91bc8f69cfe551bb96cf3a7aaf9d965cd9  packages/db-ivm/src/operators/distinct.ts
fde0fbe1a785eeff9873f9954528f1ceb162cfb4ff5ac64eb2ad9d39526938ca  packages/db-ivm/src/operators/output.ts
789345c21ac3fa1d13b6af671686f9ba1cbfee2027479f0efd9849884b389a6e  packages/db-ivm/tests/distinct-incrementalization-oracle.ts
c935d1ab1803f0bd3a81f86bee431f5237811ef3c148933f8fd64456ab74a8b4  packages/db-ivm/tests/distinct-incrementalization-oracle.property.test.ts
0ca0a116a74c239f4f4d09072604e14806967f9c0aa0c4721721e74f876c680c  packages/db/tests/query/distinct-collision-oracle.test.ts
af173f3d6bd7f2f49ac7007c000874f0282772c2feb14373bbbca6b35f5169e3  packages/db/tests/query/distinct-reported-collision.test.ts
570856fac722eb60e36da37208858300e181ee16011c86817746d34043a4fc49  packages/db/tests/oracle-config.ts
```


## Prep-PR independent review and evaluation

The prep-pr workflow ran a separate simplification reviewer and five code-review
angles against fresh `origin/main=c351fc04d`. The angles were instructions,
obvious bugs, git history, prior PR comments, and contract/oracle integrity.
The simplifier proposed no changes. The reviewers found no production defect.
Their evidence questions were evaluated without a confidence cutoff; all raw
candidates and historical remarks are retained below.

**Law and experiment.** The unique-selection law and its authority remain
unchanged. The fixture must establish the noncolliding anchor claimed by this
record. Before the fixture edit, two scratch calibrations failed: a constant
digest returned an anchor instead of rejecting setup, and a digest that collided
at `-1` but differed at `-2` returned the wrong anchor. These are fixture-premise
assertion failures, not native-seed product counterexamples. After the edit,
both calibrations pass. The fixture now searches up to 500,000 negative record
values for a digest-distinct anchor and rejects setup if none exists. The native
D2 and public campaigns pass with the same model, histories, comparisons,
checkpoints and budgets. The temporary calibration file was removed.

**Inference and limits.** The review exposed an unverified fixture premise and
an implicit finite bound, not another production violation. Executable prose
and the coverage entry now explicitly state that generated histories exercise
**two unequal members of one collision bucket**, plus the verified noncolliding
anchor. The repair has no two-entry restriction. No three-or-more collision-member
campaign is claimed; that broader domain remains a limit of the same
incrementalization owner. This states the existing grammar, rather than narrowing
it or excluding a previously exercised history. A nested-combination campaign
would expand the current flat-record payload domain.

| ID | Raw claim or historical suggestion | Evaluation and action | Durable value |
| --- | --- | --- | --- |
| I1 | P3/confidence 50: make collision cardinality explicit, or add a third-entry-discard mutant and four nested combinations of the native pair. | **fixed-now:** the existing two-member bound is explicit in executable prose, coverage and this record. There is no production cardinality cap; no broader campaign is claimed. No product RED is appropriate for the documentation claim. | Exact finite evidence and the proposed broader witness remain discoverable here. |
| I2 | P3/confidence 50: `make(-1)` was called noncolliding without checking its digest. A supplied constant digest returned `[7,7,7]`; no native violating seed was found. | **fixed-now:** constructive anchor search and bounded setup rejection. Two helper RED assertions become GREEN, and native production paths remain GREEN. | The fixture now establishes the premise independently of the expected-row model. |
| H1 | [Per-element multiplicity callback proposal](https://github.com/TanStack/db/pull/335#discussion_r2254882559), with [explicit maintainer deferral](https://github.com/TanStack/db/pull/335#discussion_r2272473062). | **accepted-design:** the linked decision leaves callbacks at whole-message granularity; each MultiSet preserves its weights. This repair does not reopen that API proposal. | Retain the historical decision when considering callback APIs. |
| H2 | [Multiset-level batching proposal](https://github.com/TanStack/db/pull/335#discussion_r2281485169). | **already-fixed:** current tap/output callbacks receive and forward one whole message. | Preserve message granularity while sharing implementation. |
| H3 | [Avoid large intermediate strings](https://github.com/TanStack/db/pull/491#issuecomment-3265962737). | **already-fixed:** this repair uses native hashing and equality, with no production structural serialization. | Retain the allocation guidance. |
| H4 | [Unconsumed-stream retention leak](https://github.com/TanStack/db/pull/550#issuecomment-3290946939). | **already-fixed:** removed reader-retention machinery is not reintroduced by the alias. | Preserve stream ownership and the existing graph construction. |
| H5 | [Old leftover logging remark](https://github.com/TanStack/db/pull/526#discussion_r2337124698). | **stale:** no corresponding production logging exists in this diff. Test-only diagnostic output records reach and fixture digests. | Keep production logging distinct from oracle evidence. |

Historical source review also covered #330, #335, #491, #526, #550, #2108,
and #2278. No contract requiring separate tap/output constructor identity or a
particular unselected-field representative was found.

**Reviewer assessment:** hire recommendation on this sample is yes. The reviewers
kept fixture evidence separate from product corruption, followed source/history
and authority, and preserved uncertainty. The simplifier avoided style-only
rewrites and retained the meaningful removal of duplicate code. This judgment
is limited to these reviews.

**Validation:** the full db-ivm suite passes 48 files / 636 tests with
`--maxWorkers=2`. After the fixture edit, its five D2 oracle tests and the public
suite's 43 tests pass. Both scratch fixture calibrations pass. Every declared
condition reaches 100 histories per campaign/path, totaling the same 800
histories. The exact reported digests remain `2650141082`. Original-operator
D2 and public campaigns reject checkpoint 2; shared-output-key mutation rejects
public checkpoint 2; capped-support mutation rejects D2 checkpoint 4. All
mutations were restored. Production source and its measured bytes are unchanged
by this review. The four retained test files now total 442 lines.

**Loss audit:** seven raw items = two fixed-now, one accepted-design, three
already-fixed and one stale. The simplifier submitted no item or edit. No raw
candidate, optional remark or historical comment was removed by a confidence
threshold. Item accounting and authorized evidence repairs are complete; no
production defect or law decision remains open in this review. Changeset,
commit, PR creation and remote CI still await the prep-pr workflow's explicit
confirmation gate. This is not a remote-CI or merge-readiness verdict.

Final prep-review source fingerprints (SHA-256):

```text
e11db3407cc67be12aedd954039ccb91bc8f69cfe551bb96cf3a7aaf9d965cd9  packages/db-ivm/src/operators/distinct.ts
fde0fbe1a785eeff9873f9954528f1ceb162cfb4ff5ac64eb2ad9d39526938ca  packages/db-ivm/src/operators/output.ts
8885d30946aa35c15cdedde29ef3c57420f15f0db683f582566b54653d05885d  packages/db-ivm/tests/distinct-incrementalization-oracle.ts
c935d1ab1803f0bd3a81f86bee431f5237811ef3c148933f8fd64456ab74a8b4  packages/db-ivm/tests/distinct-incrementalization-oracle.property.test.ts
0ca0a116a74c239f4f4d09072604e14806967f9c0aa0c4721721e74f876c680c  packages/db/tests/query/distinct-collision-oracle.test.ts
af173f3d6bd7f2f49ac7007c000874f0282772c2feb14373bbbca6b35f5169e3  packages/db/tests/query/distinct-reported-collision.test.ts
570856fac722eb60e36da37208858300e181ee16011c86817746d34043a4fc49  packages/db/tests/oracle-config.ts
```


## Publication approval

The user approved the changeset, commit, push and PR-creation phase after the
prep review. This supersedes the confirmation-pending status above. Both
TypeScript checks, explicit ESLint, formatting, `pnpm lint:changed` and
`git diff --check` pass for the prep-review tree. The source fingerprints above
remain current. The published PR and CI will provide subsequent verification;
the local evidence alone does not establish merge readiness.


## Published CI and CodeRabbit follow-up

This entry evaluates published head `973b0a0376b88ac8fe53495f58b5237d6eab47b0`
and [CodeRabbit review 5714853334](https://github.com/TanStack/db/pull/2309#pullrequestreview-5714853334).
The complete review, inline comment 4425543635, and mutable summary 6526868450
were preserved before probes. The summary covered the same commit. An
append-only scratch ledger inventories findings and optional suggestions;
this section preserves their final dispositions. No production code changed.

**Law and experiment.** A claimed collision witness must establish its collision
premise. This follows the rubric's path/reach and checker-calibration requirements
(ORC-005, ORC-006 and ORC-015). Printing digests alone supplied no enforcement.
Changing only initialization from `Math.random = () => 0.5` to `0.25` made the
unchanged reported-pair test pass with digests `3921157555` and `3428378875`.
This is a false-green calibration, not another product counterexample.
After adding the equality premise assertion, the identical mutation fails at
that assertion before creating any Collection. Restoring `0.5` passes with
both digests `2650141082`. The shared independent snapshot judgment is unchanged.

The generated owner already discovers real collisions constructively and
rejects exhausted setup. Its histories, model, public observations, comparisons,
limits and budgets need no change for this fixed-witness omission. The new
check rejects invalid setup; the previously recorded original-operator,
shared-output-key and capped-support mutants establish product sensitivity.
The evidence does not extend the flat-record or two-collision-member domain.

| ID | Original claim or suggestion | Technical verdict, action and durable value |
| --- | --- | --- |
| CR1 | Minor: the reported-pair regression only prints digests; changed seeding could make it pass without a collision. Import `expect` and assert equality, retaining stdout and `checkDistinctSnapshot`. | **fixed-now.** The alternate-seed false green and repaired assertion failure confirm the exact test-integrity defect. The native-seed replay and generated public paths pass. Retain the setup assertion and shared judgment. |
| CR2 | Review prompt optionally suggests another local CodeRabbit CLI review. | **already-fixed.** Its independent-review objective is supplied by the completed prep review and this actual remote review. No additional CLI installation or execution is needed. |
| CR3 | Summary scope warning: output/tap consolidation has no demonstrated connection to issue 2306; remove it or move it to another PR. | **refuted.** The user's explicit shipped-byte reduction request authorizes this consolidation. Its measured savings, unchanged message behavior and full IVM checks are recorded above. Retain the change and exact mixed compressed-size results. |
| CR4 | Summary documentation warning: 75% coverage is below an 80% threshold across four functions/seven files, with three unsupported skips; document missing functions. | **refuted as a required repair.** The report names no missing function or concrete explanation gap. The threshold is a bot default, with no corresponding repository requirement. Production has operator/factory documentation and local explanations of representatives, collision keys and cancellation; the model/grammar/checker/fixture have proportional contract prose. Preserve the raw percentage as unverified tooling output; it does not establish a documentation defect. |
| CR5 | Finishing-touch suggestion: generate docstrings in this branch or another PR. | **duplicate of CR4.** Both automation destinations remain recorded; neither identifies another explanation gap. |
| CR6 | Finishing-touch suggestion: generate unit tests in this branch or another PR. | **already-fixed.** The generic testing objective is covered by the shared-model replay, generated fixed/random histories, public receiving drivers, declared reaches and rejected mutants. No uncovered law is identified. |

**Reviewer assessment:** hire recommendation on this sample is yes, with
qualifications. CR1 accurately identifies a test-integrity flaw, assigns suitable
minor severity, and proposes an idiomatic minimal fix. The scope warning lacks
user-request context; the generic tooling suggestions reduce signal. This
sample supports no broader claim about reviewer performance.

**CI registration repair.** The first remote replay job and a local run failed
`names an owner for every registered property`, naming `ivm.distinct-collisions`
and `query.distinct-collisions`. Their registration in `oracle-config.ts` lacked
manifest owner mappings. The aggregate Test job consequently failed its
all-groups-success gate. The manifest now supplies each actual owner and random
campaign test-name selector. This is replay metadata, with no model or product
behavior change. The same local replay suite passes **41 tests**.

Guarded direct replays also pass and record exactly one execution of the requested
property/seed/path: IVM seed `1041521789`, path `0:0:0:0:0`, tuple mode, 40
histories; public seed `-1901465925`, path `0:0:0`, unordered mode, 23 histories.
Both reach all five declared conditions. The IVM guard's first async-reporter
attempt rejects the synchronous property; its supported sync fallback succeeds.
That first setup rejection is not a product failure.

Verification commands use `--maxWorkers=2 --coverage.enabled=false`:

- `pnpm --filter @tanstack/db exec vitest run tests/oracle-replay.test.ts`
- `pnpm --filter @tanstack/db exec vitest run tests/query/distinct-collision-oracle.test.ts tests/query/distinct-reported-collision.test.ts`

The second command passes five tests, including 400 generated public histories;
each declared condition reaches 100 histories per fixed/random and ordered/
unordered campaign. The alternate-seed calibration uses the same reported-pair
command and changes no production hash function. TypeScript, explicit ESLint,
Prettier, `pnpm lint:changed` and `git diff --check` validate the follow-up.

**Loss audit:** six review items = one fixed-now, two already-fixed, two refuted,
and one duplicate. The full raw review and mutable summary were reread, including
pre-merge warnings and finishing-touch suggestions. Positive checks, walkthrough,
merge-risk wording and bot UI controls contain no additional repair claim.
No confirmed-open item, deferral, product-law revision or production edit remains.
This completes review accounting and the bounded evidence repair. Remote CI for
the follow-up commit still determines CI status; this entry alone is not a
whole-PR readiness verdict.

Follow-up SHA-256 fingerprints (other prep-review fingerprints remain current):

```text
9745b7fe682277a998a20e00f6d6ab2801c6f8ba064a7be83ca395f5b52c32a7  packages/db/tests/oracle-replay-manifest.ts
09f6d6820dd204bf6cd96a11311d6c0ccd45a386f85bef9174c2860388fb6226  packages/db/tests/query/distinct-reported-collision.test.ts
```

## Follow-up: ten user-supplied code-reading candidates

Reviewed source: `973b0a0376b88ac8fe53495f58b5237d6eab47b0`.
Evaluation parent: `3fc1cb8e824720ebccd5dfeb4fe34f8cad207607`.
This entry supersedes the earlier output/tap compatibility and coverage claims.
It is a self-review with executable challenges, not an independent verifier.
The complete raw review and append-only working ledger remain in
`/tmp/db-2309-review-user-candidates/`; no candidate was dropped.

### Law, experiments, inference and repair

The accepted laws remain positive-support distinct membership and full-row
contribution conservation. The live-query guide supplies distinct authority;
`ARCHITECTURE.md`, “Weighted relations and public keys”, requires a negative
row to retract the same contribution. No first/last representative policy is
added. The maintainer explicitly chose to leave implicit keys unspecified
across query rebuilds and use `getKey` when stable keys are needed. The guide
now records that decision.

Before production repairs, the primary owner gained a wider grammar and full
emitted-relation comparison, and the existing includes structural owner gained
a receiving lane. All comparisons passed unchanged production. The following
hostile experiments then identified missing enforcement:

- A mutant that substitutes each retracting input for the stored emitted row
  passes all five old distinct tests. All four wider campaigns reject its
  positive original-row/negative different-row residue. Fixed seed `2309`,
  path `0:0:0`, fails at atomic checkpoint 4 and a split checkpoint within
  world 3. This confirms U1's missing unselected-payload dimension and the
  correctness of retaining the emitted contribution.
- A mutant that uses `-1` for every collision output key passes all five old
  tests. It fails all four wider campaigns when a third member arrives or a
  removed hash-key member leaves a hole. Fixed seed `2309`, path `0:0:0`,
  fails at atomic checkpoint 5 or split world 6. This confirms U3's missing
  bucket-cardinality/arrival dimension.
- The original digest-only operator fails both Collection-valued includes
  campaigns at public checkpoint 2 (fixed seed `2309`, path `0:0:0`). Both
  inline controls pass. `createActiveBuckets` is used only for Collection
  facades, so the witness distinguishes the actual affected path.
- A public API regression checks an OutputOperator subclass with an unrelated
  `inner()` method. The alias invokes that method and suppresses the output
  callback (0 calls instead of 1). Restoring the original exported class
  makes the test pass and preserves its constructor name, base and independent
  `instanceof` relationships. This repair removes the API change entirely.

The wider D2 grammar permutes four verified unequal native-collision members,
varies duplicate counts 2–4 and unselected variants 0–3, removes a member before
later arrivals, and adds up to twelve random worlds of up to eight slots plus
empty/reinsert boundaries. Every atomic/split fixed/random 100-history campaign
reaches unequal unselected payloads, three colliding members, later arrival after
removal, and empty output after unequal payloads in **100 histories each**.
The full-row comparison sums signed output without discarding negative residue
or duplicate representatives. It derives supported selections independently
from model labels and permits representative choice and arbitrary numerical
keys, while requiring simultaneous key uniqueness.

The includes lane reuses the original distinct support grammar and the primary
includes full-tree recompute. It searches actual serialized numeric-group route
keys for collisions. Each inline/Collection fixed/random 100-history campaign
reaches collision coexistence, duplicate support, partial removal, last removal
and reinsertion in **100 histories each**. Each source transaction is followed
by a public row comparison. Existing top-level ordered/unordered and selected/
default-tuple campaigns keep their original budgets.

The initial attempt to compose a root collision into nested values failed its
fixture premise: final digests can collide without equal inner object digests.
That was a setup failure, not product RED. The final family search verifies all
four actual digests. Missing property registration and a sandbox-rejected tsx
CLI IPC socket were also setup failures. Normal registration and `node --import
tsx` repair those test paths without changing production or comparisons.

### Lossless item audit

| ID | Claim and verdict | PR action and retained value |
| --- | --- | --- |
| U1 | Confirmed test gap, not an incorrect production retraction. First and last payloads differed only outside the old grammar. | **fixed-now:** full-row contribution checker, variable unselected data, generated removal and replay witness. Last-input mutant changes old GREEN to new RED. |
| U2 | True at reviewed `973b0a037`; current head already asserts equal digests. | **already-fixed:** retain altered-initialization calibration and current seeded test. |
| U3 | Prefix-only sample reaches all five old states in 100/100 cases. Tail ablation claim is true. The scaffold does vary order, insertion grouping and support. Independent input reach after successful driver checks is valid. Larger buckets were genuinely absent. | **fixed-now:** four-member family and new-member-after-removal grammar. Reused-key mutant survives old owner and fails wider owner. |
| U4 | No collision-specific Collection active-bucket witness existed. | **fixed-now:** primary includes receiving lane, separate form/campaign reach and original-operator public RED. Inline remains a useful unaffected control. |
| U5 | Identity and emitted-row references increase retained representation, including namespaced compiler rows. They are references, not deep copies. No measured heap-byte or latency result was supplied. | **accepted-design:** exact identity and conservation require information beyond a digest and one retained emitted contribution. State scales with supported classes; zero entries/buckets are removed. Keep the cost explicit. |
| U6 | Equality allocates a Map even for the same reference: 100 direct calls allocate 100 Maps. “Every diff” overstates this because empty buckets perform no comparison. `structuralIdentity` is partial and has known #2192 unsoundness. | **fixed-now:** identity/reference equality short-circuit avoids unnecessary deep comparison inside distinct. Preserve structural equality for fresh objects. Reject universal structuralIdentity substitution: functions have no key; unequal function-valued RegExp lastIndex values share a defined key. |
| U7 | Filtering every touched bucket creates an array and stores it again even with no removal. | **fixed-now:** compact in place and delete only empty buckets. Deterministic 100-support-update probe changes filter calls 100→0 and bucket-map writes 101→1. |
| U8 | Valid independent Index collision, incorrect claim that moving this repair there covers all four operators. Distinct has no Index. | **refuted** as relocation. Preserve sibling S1 below, exact trace, primary owner and receiving-work obligation. GroupBy also has its own structuralIdentity path and #2192. |
| U9 | Arrival-order-dependent implicit collision keys are confirmed. Stable keys across builds were not promised. | **accepted-design:** explicit maintainer decision keeps keys unspecified; guide recommends `getKey`. Live simultaneous key uniqueness is checked and calibrated. |
| U10 | Alias changes public class identity/name/base/instanceof and breaks valid subclass dispatch. Simplification scope was authorized, semantic API changes were not. | **fixed-now:** restore original OutputOperator and keep the failing API regression. No alias API change remains for the changeset to document. |

**Accounting:** ten raw items = six fixed-now + one already-fixed + two
accepted-design + one refuted. No raw item is deferred or unaccounted for.

**Sibling S1 remains open:** under fixed module initialization `Math.random =
() => 0.5`, the reported two plain records both hash to `2650141082`.
`Index.addValue('k', [a, 1])` followed by `[b, 1]` returns only `b × 2`;
`reduce(values => values)` repeats that result. Direct distinct emits both
values with unit support. This is a separate storage boundary, not a distinct
implementation dependency. The coverage map now records the exact trace under
`index-refinement-oracle.property.test.ts`, with the missing structural value
history and reduce/join receiving witnesses. No claim that #2309 repairs
Index/reduce/join/groupBy collision safety is made. This preserves the
reviewer's repair-location question without silently expanding this PR into a
shared storage rewrite.

**Reviewer assessment:** hire for code review, with a requirement to verify
behavioral claims. The reviewer found useful false-green tests, a missing
receiving boundary and an actual public API risk. Severity ordering mixed
coverage, necessary state cost and proposed policy. Universal structuralIdentity
replacement and Index-only relocation were unsound. The original review ran
no tests or typecheck, so these were candidates until the experiments above.

### Evidence block and limits

- **Law:** positive-support distinct membership and exact full-row retraction,
  from the guide and materialization weighted-relation contract.
- **Reach:** 400 wider D2 histories and 400 includes histories, in addition to
  the prior 800 histories. Every declared state reaches 100 histories on
  each independently counted normal campaign/path.
- **RED:** commands below reject the last-input and reused-key mutants in the
  wider owner, and the original operator in Collection includes. The output
  API test also fails before its repair. Production was restored after every
  temporary mutant.
- **GREEN:** the same core/public comparisons pass with repaired production.
  The full IVM suite passes, the full includes owner plus public distinct
  tests passes, package TypeScript checks pass, and guarded replay validates
  each new property. Final command results are recorded below.
- **Mutant:** original digest-only, last-input retraction and reused collision
  key. Failures are value/contribution assertions at the stated checkpoints,
  not setup failures or timeouts.
- **Limits:** four immutable nested collision selections plus an anchor at
  D2, two numeric-group route collisions plus an anchor through includes,
  finite source worlds and applied-transaction checkpoints. No arbitrary
  mutable payload, getter, framework render, intermediate source publication,
  or general Index collision-safety claim. Representative selection and
  cross-build implicit numerical-key equality remain unspecified.

Grammar controls: the fixed replay reconstructs the unequal-payload removal.
The generated scaffold reconstructs late arrivals after removal in every
member permutation. Removing variants makes the retraction mutant equivalent
within the prior domain; removing the third-member dimension makes the reused
key mutant survive. Tail ablation preserves scaffold reaches and loses extra
arbitrary replacement histories, so reach is not advertised as tail coverage.
World slots always have one source row and nonnegative support. A deletion of
an absent source slot is not generated. Atomic and split paths share the
model/check, and split comparisons run after each unit graph drain. Input
labels are explicitly model-only identities for fixture-defined unequal values.

ORC audit: 001–007 and 009–010, 012–016 have the contract, independent model,
nearby prose, bounded histories/ablation, real drivers/checkpoints, calibrated
mutants, equal fixed/random budgets/replay, model vocabulary, failure-preserving
cleanup (includes), versioned evidence, adjacent support/cardinality cases,
receiving witnesses, separate reach and shared-check regression described
above. ORC-008 does not add a new stateful reference: full recomputation and
signed output accumulation remain the judgment. ORC-011 adds no second copied
model: the named masking hypothesis was loss of full payload multiplicity,
which the raw signed-relation observer now distinguishes. Includes already
uses an independent relationship recompute. This is bounded evidence rather
than a universal proof.

Validation commands use `--maxWorkers=2 --coverage.enabled=false`:

```sh
pnpm --filter @tanstack/db-ivm test --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/query/includes-oracle.property.test.ts tests/query/distinct-collision-oracle.test.ts tests/query/distinct-reported-collision.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/oracle-replay.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db-ivm exec tsc --noEmit
pnpm --filter @tanstack/db exec tsc --noEmit
pnpm lint:changed
pnpm size:compare --packages db-ivm,db --files
```

Guarded direct replays, from each package directory:

```sh
TANSTACK_DB_ORACLE_PROPERTY=ivm.distinct-representatives TANSTACK_DB_ORACLE_SEED=2309 TANSTACK_DB_ORACLE_PATH=0:0:0 node --import tsx ../db/tests/oracle-replay.ts tests/distinct-representative-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
TANSTACK_DB_ORACLE_PROPERTY=includes.bucket-collisions TANSTACK_DB_ORACLE_SEED=2309 TANSTACK_DB_ORACLE_PATH=0:0:0 node --import tsx tests/oracle-replay.ts tests/query/includes-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
```

The final size comparison against `c351fc04d` gives typical app **+42 gzip /
+124 brotli bytes**, db-ivm **+57 / +51**, and db **0 / 0**. This replaces the
prior alias-based size result. The unsafe output alias is rejected despite its
size saving. StructuralIdentity-only storage is rejected because it loses
supported value distinctions. The in-place bucket refactor removes transient
arrays/map writes, but the exact identity, emitted row and independent output
key still cost bytes. No net-negative shipped-byte claim is made. Oracle tests
and documentation grow separately from shipped code.

Final local results: **642 IVM tests**, **269 includes/public distinct tests**,
**41 replay guard tests** pass. Both package TypeScript checks, explicit ESLint,
Prettier, `lint:changed`, and `git diff --check` pass. New guarded replays
complete two executions each at seed `2309`, path `0:0:0` (synchronous fallback
for D2). The fetched main advanced only by unrelated Effect fix #2301; the
merge-base remains `c351fc04d`. Remote CI must verify the newly pushed head.

Final source SHA-256 fingerprints:

```text
84bfe3138e810f5c93e1412071c3e5e8c91a919225a09b10b69ec394a8d90416  packages/db-ivm/src/operators/distinct.ts
0968eb6580a7d3ad2b2a36846c8ad175c97e588da6d1dfdadc2caaebe63bc703  packages/db-ivm/src/operators/output.ts
5bb1867a6e228c24120ed299cb99ea0b8b00dfcf864516aff2bb6a1cf5492b5e  packages/db-ivm/tests/distinct-incrementalization-oracle.ts
0e41ff998185cd002678abaec7b257c7b0a01ed1dad7041b44c88967350b93d8  packages/db-ivm/tests/distinct-representative-oracle.property.test.ts
f8908d69a0c93cc84f55dd791f9c1736ce28d9e79c97f7924266319aa64ceb4f  packages/db-ivm/tests/operators/output.test.ts
fa9eb3f861837027563417f31e97f3a0aa49f182b414660de3f656f531559a1a  packages/db/tests/query/includes-oracle.property.test.ts
74c6d4e1d1b8076c6d1e5ee06baf7d5e71731e968594388d933858504de39cea  packages/db/tests/oracle-config.ts
d1c0849f46b471cce367516b431c549ff2e50d26efa58ca384d7a4b8337ca2d8  packages/db/tests/oracle-replay-manifest.ts
```


## Follow-up: oracle challenge and broader byte reduction

Starting head: `f115d5f38b11dc5b62a0ce0b4e5b694c1d1aedac`.
This is a self-review. The source fingerprints and final checks below pin the
executable tree committed with this record. No product-law decision changed.

### Law, experiment and inference

The same positive-support and exact-contribution laws apply. An output that
removes duplicate inputs still carries a source payload; it cannot invent an
unselected value. Representative choice remains free. The reference records
historically introduced (member, variant) pairs, separately from the production
objects. It does not require a live source slot or promise first/last selection.

Two one-decision mutants passed all five prior wider-owner tests:

1. Replace an emitted row with `{ ...value[1], variant: 999 }`.
2. Replace structural matching with `candidate === identity`.

The first survived because the checker only constrained selected membership
and contribution counts. The second survived because the selector returned
the same fixture objects repeatedly. The repaired owner constructs fresh equal
selections, gives production copies separate from the model, and checks output
payload provenance. It passed unchanged production before the shipped-code
refactors. Both mutants then failed at the intended contribution comparison:
fabrication at checkpoint 1, reference-only matching by checkpoint 2 or a split
removal. Final-tree reruns fail five production-driver tests for each mutant;
the independent wrong-observation calibration passes. Neither result is a setup
failure. Every temporary source edit was restored.

All five declared reaches, including fresh equal selections, occur in 100
histories in each atomic/split fixed/random campaign. The prior budgets are
unchanged. The history domain, reconstruction, ablation, range and exclusion
remain those of the preceding review; removing fresh realization makes the
reference-only mutant equivalent on this driver, and removing provenance lets
the fabricated-payload mutant survive. The model uses scalar copies, not
production hash/equality helpers. The keys retain only simultaneous uniqueness.
Limits: four immutable nested collision selections and an anchor, historical
rather than support-epoch provenance, and graph-drain/applied-transaction cuts.

### What would have caught every review item?

No one correctness oracle judges all ten candidates. A design cost or an
unspecified policy must not become a failing product law just to fill a table.
The following portfolio would have exposed each question before review:

| Item | Necessary instrument | Current state |
| --- | --- | --- |
| U1 | Signed full-row accumulation with unequal unselected payloads; last-input retraction mutant | Enforced by the wider distinct owner; provenance now also rejects invented payloads. |
| U2 | Assert the native-collision premise before the real query, including altered initialization | Retained in the public seeded regression. |
| U3 | Three or more colliders, removal followed by a new arrival, measured per-path reach, and generator ablation | Four colliders and reused-key calibration remain; fresh equal selections are now measured too. |
| U4 | A public receiving driver at every distinct call site, with a real collision premise | Top-level query and Collection includes paths retain their witnesses; inline includes supplies an unaffected control. |
| U5 | Retained-state cardinality relative to supported identities, plus a heap probe for byte claims | The extra references remain an accepted design cost. No measured heap-byte claim or universal memory budget is made. |
| U6 | Independent value-identity model plus receiving histories over its rich domain; deterministic comparison/allocation counters | Hash identity covers rich semantics; the fresh-object distinct receiving gap is repaired. Broader rich-value distinct receiving histories remain explicitly open. The shared comparator now avoids memo allocation for references and primitives. |
| U7 | A repeated-support work probe that counts filter allocations and bucket Map writes | Earlier 100→0 filter and 101→1 write measurements remain. These are diagnostic work counts, not a new public latency promise. |
| U8 | The Index multiset model extended with structural collisions, then reduce/join receiving drivers | Known sibling defect and exact trace remain assigned to the Index primary owner in the coverage map. It is outside this distinct repair. |
| U9 | Contract review followed by only the promised key assertions | Your decision leaves cross-build implicit keys unspecified; simultaneous uniqueness remains checked and `getKey` supplies stability. |
| U10 | Exported-constructor and subclass-dispatch compatibility tests | The retained OutputOperator regression would reject the alias, and its public class/base remain unchanged. |

Thus the behavioral gaps need histories, observations and receiving drivers;
fixture integrity needs premise assertions; public API refactors need
compatibility evidence; resource judgments need measurements and a declared
budget. More arbitrary runs cannot replace any missing distinction.

### Shipped-code refactors

Nine unary factories now share graph wiring in `src/unary-operator.ts`:
map, filter, tap, output, consolidate, distinct, reduce, top-K and grouped top-K.
Every exported class keeps its constructor, inheritance and dispatch. The
helper is internal to the package's public exports. Writer creation, operator
IDs, reader connection, constructor arguments and registration order are the
same. Existing operator, API and incrementalization tests judge this unchanged
contract; no oracle expectation was relaxed.

TopKState computes support before/after directly instead of allocating a
return object from a private one-use helper. Grouped top-K similarly inlines
its one-use state lookup, processing and empty-group cleanup. No retained
relation state or empty-window signal is removed.

Equality keeps its public two-argument function and all value rules, but uses
a module-level recursive worker and creates pair memoization only when object
bodies need comparison. This removes per-call worker/key-helper closures and
moves the reference shortcut out of distinct into the shared comparator.
A deterministic probe replaces the Map constructor after module loading:
100 same-reference calls allocate **100→0** Maps, 100 unequal primitive calls
allocate **100→0**, and 100 fresh structural-equality calls allocate **100→100**
(the positive control). Cyclic equality, rich value identity and top-K receiving
comparisons pass. This measures constructor calls, not heap bytes or latency.

An additional reduce helper extraction was tried and rejected: it added
per-output method dispatch and did not give a useful compressed-byte improvement.
The original reduce phases and accumulation remain. Combining those phases was
also rejected on inspection: Index's structural merging can make their order
observable in the retained representative. No such rewrite was made. The
unsafe OutputOperator alias and structuralIdentity-only design remain rejected.

`pnpm size:compare --packages db-ivm,db --files`, against merge-base
`c351fc04d`, now reports:

| Target | Gzip delta | Brotli delta |
| --- | ---: | ---: |
| Typical app | -144 bytes | -55 bytes |
| db-ivm | -94 bytes | -70 bytes |
| db | 0 bytes | 0 bytes |

Every app scenario shrinks in gzip. Two feature scenarios still grow in brotli:
includes **+65 bytes**, paced mutations **+72 bytes**. This supersedes the prior
+42/+124 typical-app result; it is not a claim that every bundle shrinks in both
formats. Tests and documentation grow separately from shipped code.

### Evidence and remaining work

- **Law:** preserve supported selected identities, exact emitted contributions
  and source payload provenance, under the existing distinct and weighted-
  relation contracts. Public operator API and value identity remain unchanged.
- **Reach:** all five wider-owner states, 100 histories per normal delivery/
  campaign combination. Existing receiving budgets are retained.
- **RED:** fabricated-payload and reference-only mutants passed the old owner
  and fail the new owner at the contribution comparison. No baseline product
  defect was found here; these are false-green oracle repairs.
- **GREEN:** the extended owner passed before production refactors. Final
  validation and source fingerprints are recorded below.
- **Mutant:** the two exact edits above, with raw logs in
  `/tmp/db-2309-old-*.log`, `/tmp/db-2309-new-*.log`, and
  `/tmp/db-2309-final-*.log`.
- **Limits:** finite immutable fixture histories and stated checkpoints; rich
  value distinct receiving histories and the known Index collision remain
  separately tracked. No new representative policy, memory cap, latency,
  arbitrary mutation, framework or intermediate-publication promise.

ORC audit: 001–007 and 009–010, 012–016 retain the prior contract/grammar/
receiving/replay evidence, with the two new calibration results and fresh reach
above. ORC-008 retains only introduced scalar payloads because membership alone
cannot distinguish genuine and invented representatives; removing that history
makes the fabrication mutant pass. This is historical provenance, not a model
of production storage. ORC-011's named masking hypothesis is the member-only
observation; a provenance comparison supplies the additional independent
judgment without adding a copied engine. No excluded history, lowered budget,
or revised expected product answer was used to obtain GREEN.


### Final follow-up validation

The final executable tree passed **643 IVM tests in 49 files** and **310 tests
in four includes/public-distinct/replay files**. Both package TypeScript checks
passed. Explicit ESLint on each changed source/test file, source Prettier,
`pnpm lint:changed`, and `git diff --check` passed. The complete root test suite
was not run. The source parent remains `f115d5f38b11dc5b62a0ce0b4e5b694c1d1aedac`;
fetched main still shares merge-base `c351fc04d7f70dc59bf92ecbed310f899b9511cd`.

Reproducible GREEN commands from the worktree root:

```sh
pnpm --filter @tanstack/db-ivm exec vitest run --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/query/includes-oracle.property.test.ts tests/query/distinct-collision-oracle.test.ts tests/query/distinct-reported-collision.test.ts tests/oracle-replay.test.ts --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db-ivm typecheck
pnpm --filter @tanstack/db exec tsc --noEmit -p tsconfig.test.json
pnpm lint:changed
pnpm size:compare --packages db-ivm,db --files
git diff --check
```

The production-mutant command selects the representative owner:

```sh
pnpm --filter @tanstack/db-ivm exec vitest run tests/distinct-representative-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
```

With either exact mutant above, the old owner passed five tests. With final
source and the extended owner, each mutant fails five production-driver tests
with `distinct representative contribution diverged`; the checker calibration
passes. Unchanged production passed the extended owner before refactoring.

Guarded replay from `packages/db-ivm`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=ivm.distinct-representatives TANSTACK_DB_ORACLE_SEED=2309 TANSTACK_DB_ORACLE_PATH=0:0:0 node --import tsx ../db/tests/oracle-replay.ts tests/distinct-representative-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false
```

It completed two synchronous executions, each with positive witnesses for both
random delivery tests, 63 passing histories per test and all reaches at 63.
Replay reconstruction does not lower the normal 100-history campaign budgets.
No install override was needed. Remote CI must judge the new commit separately
from the previously green parent.

Final executable SHA-256 fingerprints follow. The commit containing this record
pins these files and the associated evidence together:

```text
ad1cd3aa5f8d24e44283344d92999db5e2bf3c9a41313c72e48193d8bb0fc521  packages/db-ivm/src/hashing/hash.ts
37498a3aebbbb873fba4edd43bb96e55c4c36cf02289f077596d8022b2def64b  packages/db-ivm/src/operators/consolidate.ts
0ee97ed063dfee5fe8d6f19d8b906dd1e4319c1af1ddc45d0894118ef8e68aac  packages/db-ivm/src/operators/distinct.ts
de3359cc4d4bced50b793949e07766a0dd348be74953c5f4dff14909e7b399ec  packages/db-ivm/src/operators/filter.ts
1abf73d613a478f3aac6c6df64a0d4a3f5aad7ddb8f4feedbd4e174ea1151472  packages/db-ivm/src/operators/groupedTopKWithFractionalIndex.ts
78c32b424fa143d3e6181a02ff020cbbacbd6d5abff1edac8468ccd75fe6d5b0  packages/db-ivm/src/operators/map.ts
e931418d4fbbc063f069ae1f223eaf2c8c7c47cb9a649bed2cb9afa78c5423fb  packages/db-ivm/src/operators/output.ts
8137fcbd9a7802115d8a402aefe491eba2425da093a090b451ba08a30815d671  packages/db-ivm/src/operators/reduce.ts
2c7958b6ce81dadd00dfec62a04c2546f838d03e7650b25d8556a310067b492c  packages/db-ivm/src/operators/tap.ts
657cda03b0081656f4d22883bc5f1bd9ad3689e6361ff22e5138f7b427ceef6a  packages/db-ivm/src/operators/topKState.ts
00aa1aa0a0a9c9a073562ed931b81dd6145be322388874cc2d9c3be506156f52  packages/db-ivm/src/operators/topKWithFractionalIndex.ts
c8bef95bd62ff9bb8fc0c445adc6df7749af4d59d43121549b94fe7f398d7682  packages/db-ivm/src/unary-operator.ts
3d89f1397f5df85afcc96223584039e60e60fe8773088a3edc512e9f72297cee  packages/db-ivm/tests/distinct-incrementalization-oracle.ts
dd09682e882d09148af8d2e791136e15e5ef0383d445f2d4047dc7791dac8381  packages/db-ivm/tests/distinct-representative-oracle.property.test.ts
```
