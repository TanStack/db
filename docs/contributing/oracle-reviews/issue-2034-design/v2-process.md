# Temporal persistence v2: process and controls


Frozen before tests/production changes. Reconstruction: Date controls and the
reported Temporal loss map to M1–M3/E1; current SQL/residual stages map to M4/E2;
ordinary action folding and #2002 receipts map to M6/E3/E4. The revised grammar
does not change those lifecycle laws.
Ablation: remove M1 -> type erasure; M2 -> uncovered carriers/collisions;
M3 -> precision/calendar errors; M4 -> lost candidates or unused indexes;
M5 -> unsupported total ordering; M6 -> false-green model or partial durable
state; M7 -> repeated permanent wire failure; M8 -> ambiguous upgrade claims.
Negative cases: spoofed Temporal tags must not create native values; unsupported
native kinds must not become empty objects. Range beyond the declared query
domain is unproved. No independently held-out range source is available. Formal
model checking is inapplicable: no state machine is added or replaced.
Adjacent transformations retained: shared codec substitution; native SQL/index
representation augmentation; explicit unsupported-boundary exclusion. The user
selected their combination. Additional framework/lifecycle alternatives are not
needed. Model decomposition can hide host/transport behavior; E4 and the stated
receiving limits prevent borrowing that evidence from SQLite.

Execution: add witnesses to E1–E4, observe failures on unmodified production,
implement M1–M8, then run affected owners and static checks. Record concrete
results and remaining limits after execution. A green final-row check alone
does not establish SQL selectivity or native-host support.


## Source and authority ledger

S1: production base e21c280f3c4e56f6c0d05ec0eed87db29c623489, including
#2002; the paths below and their existing executable owners constrain the repair.
S2: [initial reproduction](../issue-2034-temporal-persistence.md) records the
reported native loss; the [v1 stress readings](README.md) record the earlier
hostile, fracture and tension probes. They are not new independent v2 assays.
S3: user-required properties are native reconstruction, permission to replace
old data, and integration with existing SQL/residual mechanisms. The latest
instruction explicitly authorizes grammar → relevant oracles → implementation.
Other preservation properties are sourced contracts or exploratory engineering
inferences, not independently user-confirmed new product choices.

| Observation or requirement | Source entrance | Inferred implementation rule |
| --- | --- | --- |
| Native values become empty records; Date/string controls survive | sqlite-value.ts; encode/decodePersistedJsonValue; typed-value owner | M1–M3 registered codec and separate identities |
| Runtime predicates and expression indexes must match; cleanup follows SQL | compileSqlExpression; expression-index owner | M4 shared native representations |
| DB comparison distinguishes canonical identity from chronological rank | DB Temporal comparison/equality; precision/calendar fixtures | M3/M5 rank/text reference model |
| Repeated actions validate before folded durable writes | ordinary-transaction-work-oracle.ts | M6 retain immutable native values in the independent Map model |
| Wrapper serializes index metadata and owns receipts/remote demand | persisted.ts; Collection indexes.ts; persisted-oracle.test.ts | M2/M7 preserve index literals and exclude invalid wire input |
| Old erased objects carry no reconstruction information | reproduction; user replacement permission | M8 additive format plus existing explicit reset options |

All source paths above are relative to their owning package; exact changed
source paths/hashes are in the evidence layer. The public guide documents the
user-visible constructor, query and receiving limits.

## Reconstruction, ablation and admission audit

C1 Reconstruction: the reported row/nesting/metadata/replay loss maps to E1;
selective queries and actual index use map to E2; action-order/rollback maps to
E3; wrapper receipt and permanent-input behavior map to E4. Original Date and
string cells remain controls. D1–D4 were discovered at those real entrances,
then recorded as addenda rather than silently changing M1–M8.

C2 Ablation: M1 removal permits type erasure; M2 removal loses a carrier or
marker-shaped record; M3 removal permits lexical precision/calendar ordering;
M4 removal loses candidates, Boolean polarity or index use; M5 removal invents
an unsupported total order; M6 removal hides invalid overwritten actions or
allows partial durable state; M7 removal admits permanent transport retries;
M8 removal implies erased bytes or old readers can recover native values.
Only those distinctions survive. Case ranks, observations and runtime names
are model annotations, not additional product primitives.

C3 Range: independently held-out range evidence is untested; all precision,
calendar, native-brand, routing and SQL cases here helped construct or verify
this repair. They cannot also count as independent universality evidence.

C4 Exclusion: ordinary records with a spoofed own tag stay plain; invalid
native brands and unsupported native kinds reject. Cross-kind ordered operands,
arbitrary native arithmetic and untested host/transport routes remain outside
the claimed domain. Missing global constructors are explicit failure inputs.

C5 Executable controls: original production, a lexical-key mutant, native
ordinary-work histories, paired-IN and marker-path counterexamples, routing
barriers and scalar membership indexes. The evidence layer records assertion
failures separately from rejected index DDL. No timeout or setup error is
counted as an assertion kill.

C6 Formal modeling: this grammar specifies value representations and exclusions
inside the existing lifecycle owners; it does not introduce a new transition
system or liveness claim. No new TLA+/TLC run is claimed. The routing addendum is
bounded by the executable hydration barrier and existing wrapper campaigns;
passing tests do not prove all possible schedules. This is a deliberate limit
of the static grammar plus existing-owner approach.

C7 Generation/compression: retain only F1–F3 in the model. A custom codec registry,
a replacement query pipeline, a new retry machine and a general cross-kind
order add unsupported mechanisms or erase named invariants. They were excluded.

## Freeze and projection trace

The original v2 M1–M8/E1–E4 text was saved before implementation. The complete
support package is frozen after D1–D4 and final validation; the brief is then
regenerated from that package. The original exploratory v1 remains unchanged.

| Consequential brief claim | Support |
| --- | --- |
| Native types and existing SQL/residual pipeline are preserved | M1–M5; E1/E2; F1/F2 |
| Rows, metadata, replay and index literals share encoding | M2; D1/D2; E1–E3 |
| Native chronology differs from canonical equality | M3; E1/E2; lexical mutant |
| Retry admission remains narrow; routing can change during hydration | M7; D3; E4; routing RED/green |
| Index definitions require an equivalent non-subquery form | M4; D4; membership DDL/green |
| Existing action/rollback/receipt laws remain | M6; E3/E4; final affected suite |
| Counts, static checks, limitations and code weight | Evidence receipt and source hashes |
| Old data/reconstruction limits and untested routes | M8; C3/C4/C6; evidence owner gaps |

Layer reconstruction: the brief retains native kind/value, efficient SQL plus
cleanup, equality/order distinction, action/rollback laws, constructor/route
limits, overwrite policy, bounded evidence and absence of a universal proof.
The linked model recovers all legal transformations and exclusions; evidence
recovers concrete checkpoints; this process layer recovers observation versus
inference, ablation, missing range evidence and formal-model limits. No claim is
introduced only in the brief. Decomposition still hides untested host behavior
and schedules; those losses remain explicit in the package and coverage map.
