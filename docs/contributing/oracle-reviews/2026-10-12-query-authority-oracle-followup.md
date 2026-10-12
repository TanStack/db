# Query authority oracle follow-up — 2026-10-12

Four independent oracle reviewers examined PR #2065 at
`ebf7d024766dd70fb675ab57e6909f4419660562`. This record evaluates their
read-only findings and the subsequent oracle/documentation repair at
`c277333c4d605b7533096676f201a86c92e11325`. The reviewers covered shared
cache projection, fetch ordering, ownerless and persisted settlement, and
checker calibration. The scratch intake preserved every provisional claim
before verification. No production code changed in this follow-up.

## Laws, experiments, and inference

The [Query Collection guide](../../collections/query-collection.md#direct-writes-and-query-sync)
is the public authority. The maintainer also specified that the Query cache is
the source of truth and Collections project it. Compatible eager Collections
therefore share a representable cache edit. An on-demand peer that has already
acquired that exact Query projects the edit; an unacquired peer needs its own
server result. The ownership oracle now crosses both peer timings and a derived
eager peer select. Both public Collections, the cache, and provider call count
are compared at the write and held-fetch cuts. The mixed-mode source-reading
claim was a useful missing law boundary, not a demonstrated product bug.

For a returned key held by overlapping on-demand subsets, the later-started
successful fetch controls the public value while row ownership is continuous.
The earlier oracle checked both settlement orders and owner releases, but the
guide did not state the lifetime boundary. An executed two-cache probe found
that after *all* owners release, reacquiring only the older Query with infinite
`staleTime` and `gcTime` projects its cached older value without a request. A
new legal oracle lane checks that older and newer cache entries each project
their own value on separate reacquisition. This is consistent with the Query
cache contract; it is not global last-fetch-ever precedence.

A complete unbounded matching result can retire an omitted **ownerless direct
row**. It does not prove absence across another subset's retained Query cache.
An executed probe inserted x directly, settled a later empty matching result,
then settled an older overlapping response containing x: x disappeared and then
reappeared. A second probe showed the same return without a direct write. These
traces are real, but the accepted law orders two results that *return* the same
key and the omission law concerns an ownerless row at its own result boundary.
Negative authority across different Query entries would be a new product law.
It would need a model for a complete scope's absent-key claim, controls for
disjoint and windowed results, and a bounded retirement rule for old cached
Queries. The guide and coverage map now state this limit; the proposed stronger
law remains a design question rather than a claimed repaired defect.

The confirmed defect was in the oracle's legal-history grammar. Twenty-eight
ownership histories used `eq('field', value)`, which compares two constants;
several authored provider rows lay outside the declared scope. The seven-case
overlap model could pass an illegal history. All 28 sites now use real
`IR.PropRef` field operands or legal union predicates; four multi-row fixtures
needed union scopes. Two adjacent example tests were corrected too. The overlap
driver now checks that its authored rows satisfy their actual predicates; it
does not use the production expression compiler to calculate expected public
rows. Reintroducing the literal-field predicate at the repaired head made all
seven overlap cases fail at that admission guard; restoring it passed. This is
an oracle integrity RED/GREEN, not a newly discovered production failure.

The ownerless oracle gained empty disjoint, offset, and cursor neighbors,
matching and disjoint compound predicates, and a real SQLite restart with a
disjoint durable sibling. A proposed public assertion for that sibling was
rejected during testing: after restart, its on-demand scope had not been
acquired, so durable presence was the valid observation. The final test checks
the matching row's public and durable retirement and the sibling's durable
preservation. A broad-predicate mutant failed three scope assertions; a
window-classification mutant failed five, including empty offset and cursor
cases. These checks protect the conditional omission rule without promoting an
unacquired durable row into public state.

The cursor integration oracle's manual-write property is important generated
coverage. It now has identical 50-run fixed-seed (`20261012`) and seedless
campaigns for three cache shapes, plus direct seed/path replay. Its opening and
local prose state the manual-write law, expected row fold, grammar, production
path, checkpoints, and limits. A temporary page-cache fault failed the page
state assertion and shrank to seed `20261012`, path `0:0:0:0:0`; direct replay
reproduced the same assertion. A simultaneous cleanup fault retained the law
failure as `AggregateError.cause` and recorded cleanup separately. Both faults
were removed.

## Lossless finding ledger

The IDs preserve each reviewer's claims, including early claims later corrected
by that reviewer. “Fixed” here means the oracle/documentation gap was repaired;
it does not imply a production patch.

| ID | Original claim and evidence | Technical verdict and PR action | Durable value |
| --- | --- | --- | --- |
| A0 | “Query cache is source of truth” seemed to conflict with accepted on-demand local rows; source reasoning. | **Fixed now:** guide and coverage distinguish the unacquired local-write exception from an acquired cache projection. | Shared-cache authority boundary. |
| A1 | Mixed eager/on-demand sharing might leak a local edit to B; source-only, originally citing the unacquired-peer rule. | **Duplicate of S1:** reviewer corrected the rule's premise before testing. | Active versus unacquired peer witness. |
| P1 | Later complete omission followed by older matching response may revive x; source-only. | **Design decision:** same cross-scope negative-authority question as M1, with a direct row. No accepted promise yet forbids the later Query projection. | Explicit excluded schedule and proposed absent-key model. |
| M1 | Controlled direct-insert/empty-result/older-result probe made x disappear then return. | **Design decision:** observed behavior confirmed; stronger global-absence law remains unapproved. | Exact settlement-order witness and window/disjoint controls for any future law. |
| F1 | Full release and older-cache reacquisition might replay an old value; source-inferred. | **Duplicate of OF1:** executed and scoped below. | Reacquisition dimension. |
| S1 | Active mixed-mode B may project A's eager cache edit; source-traced, unexecuted at review. | **Fixed now:** paired active/unacquired oracle histories pass at write, held-fetch, cache, and provider-count cuts. | Mixed sync-mode grammar. |
| S2 | Derived eager peer select may miss a representable writer edit; source-only. | **Fixed now:** direct-property writer and filtered peer history passes without a request. | Distinguishes writer patchability from reader projection. |
| OF1 | Executed newer-value then full-release/old-cache replay with no new provider call. | **Fixed now:** guide's lifetime qualifier and oracle reacquisition lane match Query cache authority. The original “bug” label was overbroad. | Continuous-ownership versus new projection distinction. |
| OF2 | Executed newer empty scope followed by older returned x, without a direct write. | **Design decision:** returned-key law does not order negative claims from separate Queries. | Separate cross-scope absence proposal. |
| OWNERLESS-1 | Source-only direct-insert variant of P1. | **Duplicate of P1/M1.** | Per-key absent-position design sketch. |
| OWNERLESS-2 | Empty disjoint/offset/cursor and compound scope could evade current matrix; source-only. | **Fixed now:** legal neighboring histories pass; broad-predicate and window mutants fail at public-row settlement. | Conditional completeness/membership law. |
| OWNERLESS-3 | One-row unfiltered SQLite witness could miss broad durable deletion; source-only. | **Fixed now, bounded:** filtered SQLite witness keeps a disjoint sibling durable; no claim of public visibility before that scope loads. A persisted-only broad-deletion mutant was not run. | Durable receiving boundary and remaining mutant idea. |
| M2 | Seven overlap histories used literal/literal predicates and out-of-scope provider rows; source and QueryFn metadata. | **Fixed now:** legal scopes plus provider admission guard; restored old predicate fails seven cases. | Invalid-history classifier. |
| M3 | Versioned review lacked per-ORC outcomes; source-only. | **Fixed now:** requirement audit below, tied to repaired commit. | Guide conformance and explicit limits. |
| O3 | Cursor property had one seedless normal campaign; source-only. | **Fixed now:** equal fixed/seedless campaigns and checked direct replay. | ORC-007 enforcement. |
| O4 | Cursor manual-write law and grammar lacked opening/local prose; source-only. | **Fixed now:** literate contract, fold, grammar, limits and checkpoints. | ORC-001/003/004 evidence. |
| O5 | Final review record lacked ORC-012 audit; source-only. | **Duplicate of M3.** | Exact-head requirement record. |
| M4 | Twenty-eight ownership and two adjacent test literal-field scopes; source inventory. | **Fixed now:** every inventoried site repaired; 863 ownership/Query tests passed before later witness additions. | Same-class fixture audit. |
| S3 | Cursor cleanup could mask a property failure and skip QueryClient release; source audit. | **Fixed now:** cleanup diagnostics accumulate outside fast-check's verdict; simultaneous fault control retained the primary failure. | ORC-010 failure fidelity. |

The raw count is **19**: 12 fixed, four duplicates, and three design
questions. No item is silently deferred. The three design IDs concern one
unapproved cross-scope absence rule; their executed traces remain available
for a future explicit law decision. The reviewers' corrections matter: neither
OF1 nor S1 establishes the production bug initially suggested.

## ORC-001–014 audit at the repaired code commit

| Requirement | Outcome and evidence or non-applicability |
| --- | --- |
| ORC-001 | **Met for the bounded claims.** The guide supplies shared-cache, returned-key, direct-write, and scoped-omission authority; the ownership opening and cursor opening state their laws and limits. Cross-scope negative authority is expressly outside the current promise. |
| ORC-002 | **Met.** Ownership expectations fold authored fetch/write positions and owner claims; cursor expected rows are cloned and folded independently of Query cache updates. The production expression compiler validates fixture legality only, not expected public values. |
| ORC-003 | **Met.** Ownership prose separates law, reference, seven-history matrix, real QueryClient driver, and public checkpoints. Cursor opening/local prose explains its manual-write law, row fold, 1–8-step grammar, real pager path, and per-write comparisons. |
| ORC-004 | **Met for the new generated cursor property.** Count 2–6, operations 1–8, and position 0–10 include both endpoints. A count-2 history of delete-0, delete-0, then update-0 reconstructs empty-to-insert recovery; one-step insert/update/delete histories are each constructible. Removing a write kind, position variation, or one of raw-sibling/raw-nested/selected-envelope shapes loses a distinct cache action or placement. Duplicate initial IDs are excluded as invalid keyed Collection input; overlapping fetches and derived selects are valid but outside this bounded grammar. Ownership matrices are finite enumeration, so the generated-grammar trigger does not apply to them. |
| ORC-005 | **Met at named cuts.** Real QueryClient and Collections expose public rows, cache data, provider calls, and exact result settlement. Node SQLite supplies matching-row retirement and disjoint durable preservation. The full package run passed 1,257 tests in 36 files, with no type errors. |
| ORC-006 | **Met for repaired claims.** Literal-field mutant failed seven overlap cases at admission; broad predicate mutant failed three scope cases; window mutant failed five; cursor page-cache fault failed and replayed the page-state assertion. Temporary mutants were restored. The original production behavior was not changed in this follow-up. |
| ORC-007 | **Met for the important cursor property.** Each of three shapes runs the same generator/checker/50-run budget once with seed `20261012` and once seedless. Replay selected the same property directly with seed/path `20261012`/`0:0:0:0:0`, ran one case, and reproduced the failed checkpoint. The ownership fixed histories are not important generated properties. |
| ORC-008 | **Met for model-state changes.** An accepted fetch position is distinguishable by a later older settlement; owner identity by a later release. In cursor, expected rows are distinguishable by the next update/delete and nextId by the next insert after deletion; collapsing either changes future public rows. No production state was copied into the reference. |
| ORC-009 | **Met.** “Query,” “Collection,” “owner,” “scope,” “fetch,” and “public row” follow the project glossary. Model-only positions map to authored operation order; `expected` and `nextId` are local row/key holders, not renamed subsystem states. |
| ORC-010 | **Met.** Ownership cleanup aggregates secondary failures. Cursor teardown attempts source and client release, retains the primary property failure as cause, and reports cleanup failures separately; an injected simultaneous fault verified that form. |
| ORC-011 | **Not triggered for these repairs.** No named semantic fault shared by the independent row/owner reference and production required a second formulation. The real SQLite case is a receiving boundary, not asserted to be an independent semantic model. The negative-scope proposal awaits a product law before modeling. |
| ORC-012 | **Met by this record for the repaired commit.** All other numbered requirements have outcomes here. The claimed class is limited to legal predicate histories, returned-key overlap under continuous ownership, representable cache projection, and scoped ownerless omission at named public/cache/durable cuts. The original and adjacent witnesses and wrong designs are above; open negative-scope and larger schedules remain in the coverage map. |
| ORC-013 | **Met within bounded laws.** Active versus unacquired peers, continuous ownership versus full release/reacquisition, complete matching versus disjoint/windowed empty results, and legal versus literal field predicates are neighboring premise controls. Their cache, public-row, provider-count, and durable checkpoints distinguish the wrong rules. |
| ORC-014 | **Met for the claimed receiving boundary.** Real Query Core supplies shared Query cache notifications and refetches; managed node SQLite supplies filtered complete response persistence. The cursor property uses a controlled in-memory page provider and makes no external-provider claim. Non-node persistence and external durable writers remain outside the evidence. |

The full Query Collection suite passed 1,257 tests after the witness additions;
the cursor integration file passed 47 tests after its final teardown refactor.
Package TypeScript typecheck and build passed. ESLint had no errors (26
warnings in changed test files), Prettier and `git diff --check` passed. The
literal-predicate, broad-scope, and window mutants were run against the
repaired commit and restored without changing the committed tree. This record
does not claim production fixes or universal coverage of arbitrary overlapping
requests.

The four reviewers gave strong exploratory signal. One found a real test
integrity defect across 30 sites and calibrated it; another executed both
cache-replay and omission counterexamples; the others identified legal scope,
persisted, and mixed-mode boundaries. Several initial claims were revised
after checking the actual guide premise or the cache authority model. **Hire
for exploratory review, with executable calibration before product-bug
sign-off.**
