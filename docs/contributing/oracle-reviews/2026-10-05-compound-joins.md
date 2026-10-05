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
