# Convex oracle repairs, October 26

PR: <https://github.com/TanStack/db/pull/2230>.
Review parent: `de7cf8de13f14dfa0d4ce6676452eb231ef215e2`.
Reviewed implementation revision: `5aebb71f90919697b459b38673a0aa5fef00a0b2`.
The [source manifest](2026-10-26-convex-oracle-source.json) identifies the exact tested files. Older
records and shrink paths remain evidence for their named revisions.

These are oracle and test-runner repairs. Production sources are unchanged.
The parent implementation passes the stronger comparisons. RED below means a
hostile implementation rejected by the repaired owner, not a baseline product
failure. Private production mutants were restored after each experiment.

## Law and repaired distinctions

The authority is the public [Convex collection guide](../../collections/convex-collection.md),
the [offline transaction guide](../../guides/offline-transactions.md), and the
Collection lifecycle and optimistic-history contracts named in AGENTS.md.

| Owner | Promised observation and missing distinction repaired |
| --- | --- |
| Snapshot | Latest valid selected rows replace the complete keyed public result. Numeric and string keys retain their types, including `1` versus `'1'`. Constructive prefixes require omission, field removal, empty/reintroduction, duplicate rejection and recovery. |
| Ownership | One concrete options object has one Collection owner. Direct/shallow reuse, fresh factory calls and descriptors are crossed with idle, ready and cleaned-up cuts; confirmation and sibling cleanup remain independent. |
| Primary pagination | Every ordered `select` array and keyed public publication is complete. During each coherent source revision the trace permits prior snapshots followed by current snapshots, including repeats, and forbids prefixes or stale rollback. Pending replacement ranges retain only the prior complete result. The omitted default accepts 10,000 and rejects 10,001 rows. |
| Offline bridge | Rejected durable source acceptance is terminal until cleanup/restart, including rejection after accepted empty or nonempty rows. Exact error identity, prior application rows, changed/unchanged cached retries and fresh-run recovery are checked. Ordered bridge stages and cold acceptance retain separate judgments. |
| Shared codec and Convex receiver | Fresh durable readers preserve each supplied original, modified and changes operand independently, including native values and removed fields. Real CRUD supplies independently authored before/after values. Expected observations are captured before the writer; an in-place mutation cannot rewrite the expected original. |
| Backend crashes | Durable admission precedes provider calls; restart keeps the key and produces one application after known or uncertain completion acknowledgement. Reach is credited only after actual disk/server/replay comparisons. |
| Public pagination receiver | Every observed select/publication must equal a complete authored ledger revision available at that moment, including live writes and TCP reconnect through both SDKs and three query forms. Future writes cannot excuse an earlier observation. |

## RED and hostile controls

The original review executed five false-green designs: numeric-key
stringification, prefix-before-full pagination, default cap 9,999, terminal
acceptance only over empty Collections, and v4 original-from-modified routing.
The repaired owners reject all five at their intended comparisons. An
independent cross-review also found and executed an in-place original-corruption
survivor; capturing the expected original before the writer closes that gap.

| Isolated wrong design | Intended rejection and adjacent witness |
| --- | --- |
| Stringify snapshot map keys | Typed public entries differ. The adjacent stringified delete-key design also fails when a numeric row is omitted. Seed `20261022`, path `0:0:0:0:0`; restored replay passes. |
| Publish one-row prefix, then full rows | Retained select trace rejects the prefix. Primary seed `20261022`, path `0:0:0:0:0:0:0:0:0:0`; direct RED and restored GREEN. Adjacent current→empty→current fails monotonicity. The real public receiver rejects the same prefix in all six histories; publication-only diagnostic also fails both SDK histories. |
| Default cap 9,999 or 10,001 | Exact 10,000 acceptance rejects the former; 10,001 overflow rejects the latter. Both fail assertions rather than timing out. Configured-cap replay uses seed `20261023`, path `0:0`. |
| Latch acceptance failure only when Collection is empty | Accepted-nonempty prefix followed by rejected insert resolves a retry that must reject. Seed `20261023`, path `0:0`; intended promise assertion RED and restored direct GREEN. |
| Encode v4 original from modified | Both codec owners reject at `original operand`. The narrower update-only routing mutant also fails: shared seed `20261022`, path `2:1:1:1:1:1`; Convex path `2:1:1:1`. Direct restored replay passes. |
| Update-only `Object.assign(mutation.original, mutation.modified)` before encoding | Both previous repaired owners passed because expected original aliased the writer input. Capturing its observation before writer entry makes both fail at `original operand`, with the same update replay coordinates above; restored production passes. |
| Omit uncertain backend acknowledgement histories | Grammar/runner negative control fails `uncertain-acknowledgement (0)` for each operation. This calibrates reach enforcement, not a provider mutation kill. Normal real-backend campaigns reach both acknowledgement cuts. |

These results are intended assertion failures. Setup failures, absent runtime
downloads, discovery warnings and timeouts are not counted as rejected mutants.
Fixed default-cap cases and six public receiving histories are deliberate fixed
witnesses, alongside the generated primary owners.

## Reach and GREEN

Normal generated properties run identical fixed and unseeded campaigns with
fresh ledgers and a minimum of one history for every declared state. Counts are
histories, not callbacks or events. Every normal report is retained in
[the reach record](2026-10-26-convex-oracle-reach.json). Explicit seed/path replay runs directly,
sets fast-check's run budget to one and bypasses campaign minima. Reconstructing
a shrink path can still evaluate its callback more than once.

| Owner | Actual normal reach in each lane |
| --- | --- |
| Snapshot | All 13 declared states reach 150 histories: string/numeric/mixed/equal-looking typed keys, selected-key representation, omitted key/field, empty, reintroduction, duplicate rejection, valid recovery, valid start and invalid start. |
| Ownership | All 15 states reach 60: four construction/reuse forms × three lifecycle cuts, independent confirmation, rightful owner after rejected reuse and after sibling cleanup. |
| Pagination rows/work/bound | All ten states reach 60: complete nonempty/empty, required/recommended split, pending with prior snapshot, public publication, initial multi-range exhaustion, acceptance at cap, overflow retention and shrink recovery. |
| Offline bridge/source/acceptance | All 22 states reach 60: four stage outcomes; idle/pending/startup-error/empty/rows/error/cleanup/provider-recovery; first-empty/first-rows/accepted-empty-insert/accepted-row-insert/update/delete/replacement/unchanged-cache-retry/changed-cache-retry/restart-recovery. |
| Shared codec | 60 histories per lane; all ten CRUD, operand-separation, equal/changed/removed-field update and native-class states exceed the minimum. Exact fixed/random counts are in the JSON record. |
| Convex values | 100 histories per lane; all 12 CRUD, operand, native-class, nested-container and undefined states exceed the minimum. Exact counts are in the JSON record. |
| Backend insert/update | Six actual process histories per operation per lane: admission/replay 6, known/uncertain acknowledgement 3 each, int64/special-float/bytes 2 each. |
| Backend delete | Six actual process histories per lane: admission/replay 6, known/uncertain 3 each. Total backend crash histories: 36. |

The complete validation run passed 64 adapter tests, 302 offline-engine tests,
seven campaign/reach helper tests, and all 18 real-backend tests. The final
two-file codec follow-up passes after capturing expected original observations
before writer entry. Offline typecheck and build pass with a test-only tsconfig
that permits the shared helper import; production build configuration is
unchanged. Configured ESLint, oracle lint and diff checks pass.

Commands from the repository root (the environment setting suppresses pnpm's
automatic dependency revalidation for this already installed local workspace):

```sh
pnpm_config_verify_deps_before_run='' pnpm --filter @tanstack/convex-db-collection test
pnpm_config_verify_deps_before_run='' pnpm --filter @tanstack/offline-transactions exec vitest run
pnpm_config_verify_deps_before_run='' pnpm --filter @tanstack/offline-transactions typecheck
pnpm_config_verify_deps_before_run='' pnpm --filter @tanstack/offline-transactions build
pnpm_config_verify_deps_before_run='' pnpm --filter @tanstack/db exec vitest run tests/oracle-campaign.test.ts tests/oracle-reach.test.ts
CI=1 pnpm_config_verify_deps_before_run='' pnpm --filter @tanstack/convex-db-collection test:e2e
pnpm_config_verify_deps_before_run='' pnpm lint:changed
```

Replay selectors remain those in the coverage map. For example, set
`CONVEX_SNAPSHOT_ORACLE_SEED=20261022` and
`CONVEX_SNAPSHOT_ORACLE_PATH=0:0:0:0:0` when selecting the snapshot owner.
Shared codec uses `OFFLINE_CODEC_ORACLE`; Convex codec uses
`CONVEX_VALUES_ORACLE`. No commands arbitrary is used, so there is no command
`replayPath` interface. Old backend paths identify the old grammar; the new
constructive bundles change those coordinates.

## Grammar controls and review outcomes

Reconstruction includes every original false-green witness, the adjacent
mutants above, and their direct restored replays. Constructive prefixes retain
arbitrary suffixes and generated values. Ablating numeric keys loses typed-key
discrimination; omitting earlier accepted rows loses later-rejection evidence;
merging codec operands loses update routing; retaining only the final callback
loses partial/stale trace evidence; omitting uncertain acknowledgement loses
the named crash cut and fails reach.

Domains remain bounded: snapshot uses three key slots, 0–5 rows and 1–30 suffix
snapshots; numeric key parameters lie in -100..100. Pagination crosses page
sizes 1–2 and 3–4 with all split policies, a 3→8 prefix, generated replacements
and a final empty result. Shared codec uses arrays of 1–5 native leaves;
Convex trees have depth two and arrays up to three. Binary sizes are 0–12 and
0–8 respectively. Acceptance scenes vary values and retry order/counts.
Backend bundles vary payloads and acknowledgement order within six actual
histories per operation/lane. Duplicate-key proposals are invalid but remain
explicit rejection inputs; malformed cursor tokens, out-of-range native
integers, update/delete of absent fixture rows and simultaneous uncontrolled
source revisions are outside these legal grammars.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Authority and bounded omissions are stated beside each owner and above. No product promise was changed to match output. |
| ORC-002 | Expected arrays/typed entries, dependency prefixes, authored operand observations and append ledger are independent of production transitions. The codec cross-review found and removed a mutable expected-input alias. Core's supplied mutation composition, native brand checks and test storage are explicit trusted boundaries. |
| ORC-003 | Each changed owner retains opening contract prose and distinguishes grammar, model, real entry point, recorder and comparison. Campaign/reach utilities supply execution support, not another product oracle. |
| ORC-004 | Reconstruction, ablation, bounded ranges and nearby invalid inputs are accounted for above; constructive prefixes add reach without removing suffix variation. |
| ORC-005 | Real Collections, OutboxManager/fresh readers and actual backend processes reach their named public comparisons. Retained callbacks represent intermediate violations. No concrete missing-information hypothesis remains for these controlled checkpoints; arbitrary Convex query translation is outside scope. |
| ORC-006 | Every repaired false-green distinction has an executed hostile comparison failure. Backend enforcement has a separately labeled omitted-state control. |
| ORC-007 | Fresh fixed/random lanes use one callback and budget; direct captured RED/restored GREEN replay is exercised. Seven helper tests include lane separation, seed zero/path forwarding, run budget and independence from unrelated DB replay selectors. |
| ORC-008 | Retained prior/current pagination phase distinguishes a later stale callback. Accepted rows plus terminal failure distinguish same-cache retry from restarted acceptance. Allowed receiving revisions are frozen at observation time so future ledger writes cannot rewrite prior judgments. No production cursor state is copied into the value model. |
| ORC-009 | Source acceptance versus visibility follows the Collection contract. Scene names and reach states map to concrete fixture cuts in owner prose. Backend counts distinguish bundles from actual process histories. |
| ORC-010 | Cleanup harnesses preserve original comparison failures; direct shrinking reproduces their named assertions. Assertions in the public receiver run outside provider callbacks so they cannot turn into projection errors. Broader infrastructure failure handling is not newly proved. |
| ORC-011 | No unresolved named shared semantic fault requires another model for these repairs. Independent reviewers challenged pagination, codec and acceptance/backend/helper changes; the expected-original alias challenge was executed and fixed. Arbitrary query semantics and native persistence-fault refinement remain outside scope. |
| ORC-012 | This exact-source record gives the applicable outcomes, original/adjacent witnesses and remaining limits. Closure is confined to the tested contract × grammar × path × observation cells. |
| ORC-013 | Exact 10,000/10,001 cases reject either adjacent default. Accepted empty/nonempty scenes distinguish the terminality boundary. Distinct and equal-payload real updates distinguish operand routing. Prior/current/prefix traces distinguish trace consequences. Other untested reusable boundaries retain their existing owners. |
| ORC-014 | Real public queries supply actual cursor continuation, ordered pages and reconnect through both SDKs. Their append ledger checks complete available revisions; it cannot reuse the synchronous revision-step checker because stream delivery can precede the writer acknowledgement and does not label revision boundaries. Drift risk is limited explicitly: within-phase monotonicity, arbitrary update/delete and split scheduling remain primary controlled-owner evidence. Backend native payloads receive disk/process/server transport for a bounded subset; native storage failures remain unresolved in their existing owners. |
| ORC-015 | Every changed important generated property declares states and enforces per-lane minimum one. Actual counts are versioned in the companion JSON. Fixed public histories/default-cap examples are not generated campaigns, so this trigger does not apply to those cases. |

## Limits

No on-demand functionality was added. The adapter remains eager and drains the
fixed server query. Lazy cursor acquisition could use the existing on-demand
protocol; a separate factory is not inherently required. Arbitrary DB filters
and ordering cannot automatically become arguments to an application-defined
Convex function. Every successful load would still owe its requested subset.

The public receiving relation proves completeness and availability, not
within-phase monotonicity; the primary pagination owner checks that relation.
These repairs do not prove arbitrary concurrent source revisions, cloud
hosting, atomic cross-Collection publication, cold backend replay with native
disk failure, multi-tab/atomic batches, power-loss behavior, arbitrary custom
objects/cycles or stricter byte/peak-memory/lifetime-subscription bounds.
The coverage map retains the existing owners for those laws.
