# PR #2171 oracle implementation chunks

Production baseline: `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
All entries below describe test/document changes on that unchanged production.
The maintainer requires every oracle chunk to finish before production repair.
RED results are therefore retained; no product-readiness or bug-class closure
claim is made. The 26-check proposal and 53-item matrix remain the work inventory.
Generated API documentation is excluded.

## Chunk 1: independent cached options and public observations

**Law and authority.** The maintainer's independent-caller decision requires
same-identity getKey/schema declarations to agree by reference, including
absence. Distinct query keys permit independent behavior. SSR initial views
remain frozen at their capture cut (`docs/guides/ssr.md`, “Prepare every server
snapshot”). Mounted inline retention is a separate owner.

**Inventory and grammar.** Six declaration pairs per option cross independently
with derived/keyed identity and same/distinct key: 144 bounded histories. Core
adds held/settled writes and five paths: explicit preload, observer preload,
subscribe, cached server read and preload after positively observed newer
hydration replacement. React supplies mounted hooks and actual renderToString;
these are separate receiving paths, never inferred from a core result.
Schemas test runtime declaration identity only; no transform/type support is
claimed. The domains are exhaustive at these bounds, so ORC-007 random campaigns
do not add a missing finite case. A key cannot change under the same model
identity without a conflict; a distinct key is its legal neighboring control.

**Observations and reach.** Each core path reaches 288 histories, including 144
held deliveries. Each path reaches 32 getKey-only, 32 schema-only and 64 both
conflict premises; 144 distinct-key controls; getKey/schema addition 48 each and
removal 24 each. These premise counts are recorded before the actual admission
comparison; a failed comparison does not claim later checkpoints ran. Preload,
observer preload and subscribe each complete admission/retry/original reuse/
source-update comparisons in all 288. Server-read completes those in 224;
hydrate-preload in 160. Each React receiver reaches 16/16/32 independent/both
conflict premises, 72 distinct-key controls, additions 24 each, removals 12 each.
Client admission/retry/original reuse and settled keyed-row comparisons run in
all 144 histories. SSR completes admission/retry/original reuse in 80.

Original custom keys use `first-id`, second custom keys use `other-id`, and the
default uses `id`; losing any declaration is observable. Both successful callers
and the original after rejected retries retain exact keys and ordinary fields.
Core checks every callback after the next atomic source publication and no
callback for a refused listener. React checks accepted rows immediately and
after its async act flush. The server held-row check compares the initial empty
view, rather than incorrectly requiring later writes to rewrite the capture.

**Baseline result.** Run the root Vitest binary from each package with
`run --config vite.config.ts --coverage.enabled=false --typecheck.enabled=false`.
Core selector: `tests/live-query-cache-options-oracle.test.ts`: 192 assertion
failures and 1,314 passes (1,440 histories plus 66 checker controls). The failures
are missing conflicts at 64 settled SSR and 128 held/settled hydration admissions.
React selector: `tests/cache-options-oracle.test.tsx`: 64 SSR assertion failures,
224 passes; zero scheduling warnings after the native handoff correction.
`tests/utils.test.ts`: 132 passes, including three cleanup-failure positions.
DB/React TypeScript checks pass. These are intended assertion failures, not setup,
runtime or timeout evidence. Scratch logs: `chunk1-core-final.log`,
`chunk1-react-settled.log`, and `chunk1-core-rereview.log` under
`/private/tmp/rc2171-oracle-challenge/`. Set
`TANSTACK_DB_ORACLE_STATISTICS=1` to print the reach counts.

**Calibration.** The shared comparison rejects accepted conflicts on both retry
attempts, wrong second/original keys, and an earlier wrong callback followed by
a correct callback. The prior challenge record retains executed production
mutants for all-options-must-differ and overwrite-before-throw guards. Those
historical experiments are not fresh mutation evidence for the expanded paths.
The cleanup fault injection varies the failing release position and checks the
original mismatch remains the cause, the secondary failure stays distinct, and
all later releases run. No production edit, even a temporary repair, was made.

**Review.** Independent subagents `cache_oracle_review` and
`cache_receivers_review` applied oracle-review. Their first rounds found
last-only callbacks, weak reach cells, indistinguishable original keys and a
missing React settled observation. These are corrected. Final rounds found no
further supported defect in this bounded scope. The receiver reviewer separately
ran the three cleanup controls: three passed. Challenges that shaped this chunk
are retained evidence, not held-out evidence.

**ORC accounting.** 001–005: authority, independent declaration model, literate
layers, bounded reference/presence grammar and public receiving cuts described
above. 006: wrong-observation controls described above. 007: finite exhaustive
grammar, random/shrink campaigns inapplicable. 008: stateless comparison, no
stateful transition revision. 009: declaration labels denote references or
absence, not production cache state. 010: fault injection and all-resource
cleanup. 011: no concrete shared semantic hypothesis requiring a second model;
the accepted reference rule is independent of hash/guard internals. 012: this
versioned record, without a closure claim. 013: single-axis conflicts and added/
removed neighbors distinguish wrong coupled rules. 014: actual React client and
server receiving paths; broader hosts remain pending. 015: per-path counts
above. 016: oracle tests use shared judgments; cleanup examples stay in ordinary
utils tests.

**Remaining work.** O01 and O02 are implemented within the declared boundary;
O03 held-delivery and O16 cached-SSR witnesses are implemented, while O03
first-registrant variation and O04 failure/consumption/transport remain pending.
O15 has generic cleanup fidelity evidence but is not closed for every partially
constructed native host. Other frameworks, hydrateRoot, semantic equivalence of
functions and schema transformations remain outside this chunk. Product GREEN
and fresh production-mutant campaigns are deferred until all oracle chunks
finish. The reachable SSR/hydration counterexamples keep the product class open.

## Chunk 2: hydrated claim lifetime and framework receiving paths

**Law and inventory.** A portable result contains no server getKey/schema
references. Its first local caller claims them; a newer payload retains those
claims, while failure or consumption retires them. Authority: the maintainer's
option decision, the source-claim lifetime in `db-client-preload-identity.test.ts`,
and the SSR guide's matching-result configuration requirement. React and Preact
compare inline query identity; Preact has no DbClient hook input. Svelte is the
other public client-backed hook. Vue, Solid and Angular expose no DbClient input;
their client-free reactive compilation policy is not changed into React retention.

**Model, grammar and observations.** The lifecycle owner uses one independent
active/retired judgment over named declarations. It runs 2,160 bounded histories:
72 same-identity declaration pairs, three first local claimants (preload,
observer preload and server read), active/replaced/failed/consumed results,
pending/settled transport, plus replacement and failure before original pending
transport release. Server configuration has equivalent key/schema semantics
with independent references. Actual server dehydration is scanned for callables
before a JSON round trip, so serialization cannot silently hide leaked claims.
Pending conflicts/retries are checked before delivery; compatible promises stay
pending. Newer payloads have different ordinary labels. A pending replacement
is checked immediately and again after obsolete transport settles. Initial
transport failure checks exact error identity on the claimant and compatible
pending peers, then fresh local admission. Consumed/failed results accept the
new declaration and expose its independent local keys after live handoff.

Per first-claimant path: 720 portable premises, 432 pending premises;
384 pending-conflict and 48 pending-compatible histories reach comparison.
Pending replacement reaches 64 conflicts and eight compatible controls;
pending failure reaches the same split. All 72 pending-failure histories reach
failed-stream absence and retired reuse. On the unchanged RED baseline only
eight compatible pending replacements reach the post-obsolete comparison;
64 stop earlier at the intended missing-conflict assertion. The later check is
present, but no evidence claims those blocked conflict histories completed it.
Phase × conflict/compatible reach prevents borrowing a retirement witness from
an active-result case. Full counts print with TANSTACK_DB_ORACLE_STATISTICS=1.

**Result and calibration.** The DB lifecycle selector
`tests/live-query-cache-lifecycle-oracle.test.ts` gives 640 admission assertion
failures and 1,526 passes, including six checker controls. There are 576 missing
replacement conflicts and 64 settled server-first missing claims. No setup,
timeout or unhandled-error failure is counted. The shared judgments reject
leaked callables, a no-claim policy and a forever-claim policy. The same pending
and replacement comparisons observe the actual open product defects; production
GREEN and fresh repaired-production mutants remain deferred.

The shared immutable capture/checker in `live-query-bound-options-oracle.ts`
is received by the existing 12 React retention histories and six new Preact
histories. Each Preact history reaches rerender, source update and changed
identity; each option has two histories and each identity mode three. A render
budget rejects rebuild loops. Six hostile in-place config replacements prove
that mutating the original Collection cannot mutate the expected references.
React cleanup now attempts every returned mount's release while retaining the
primary mismatch. Svelte receives the 144 independent cached-option histories
through actual effect roots and flushSync; all admission/retry/original reads
pass, including 16 key-only, 16 schema-only, 32 both conflicts and 72 distinct
key controls. It compares accepted keyed rows after native effect delivery.

Commands use each package's root Vitest binary/config with coverage/typecheck
disabled for runtime. Preact selector `tests/bound-options-oracle.test.ts`:
12 passed (six host histories plus six controls). Svelte selector
`tests/cache-options-oracle.svelte.test.ts`: 144 passed. React selector
`tests/source-id-reuse-oracle.test.tsx -t 'retains inline options'`: 12 passed,
80 other histories outside that selector. DB/Preact/React TypeScript checks and
Svelte's test:types pass. Lint:changed passes with only the pre-existing installed
lockfile/override mismatch warning. Scratch logs use `chunk2-*` under the task's
existing scratch directory; lifecycle final is `chunk2-lifecycle-r4.log`.

**Review and ORC accounting.** Fresh independent reviewers
`cache_lifecycle_review` and `framework_options_review` applied oracle-review.
Their findings added before-release pending comparisons, pending replacement,
phase/schedule-specific conflict reach, equivalent server keys, immutable option
capture, and failure-preserving React cleanup. The lifecycle reviewer reran the
final full suite and confirmed the same 640/1,526 split. The framework reviewer
independently ran all three host selectors. Final reviews found no additional
supported defect within these boundaries.

ORC-001–005: authority, independent active/retired rule, literate responsibilities,
finite legal timelines and positively observed native/transport cuts above.
006: callable, opposite-policy and in-place-mutation controls. 007: bounded
exhaustiveness rather than random sampling. 008: retaining a claim distinguishes
changed-declaration reuse; failure/consumption removes it, with active neighbors
proving the distinction is needed. 009: declaration labels denote local refs;
portable results and local claims remain distinct. 010: error identity and all
returned-resource cleanup; generic throwing-cleanup calibration is in chunk 1.
011: no remaining named shared semantic hypothesis requiring a second model.
012: this record preserves open product results. 013: active/retired and
before/after transport neighbors. 014: actual Preact/Svelte schedulers receive
the shared judgment. 015: per-path phase/schedule reach above. 016: all oracle
cases replay common judgments; controls supply hostile observations to them.

**Limits and next work.** This completes the declared O04 transport, first-local
claim and retirement timelines, and O05's applicable native receiving paths.
It does not prove arbitrary stream interleavings, hydrateRoot, Svelte SSR,
Svelte continuing source publications, schema transformations, or cleanup before
a native mount returns. O15 still needs partial-construction fault injection;
O03 first result registration without an existing transported result remains
separate. These limits remain owned by the cache/binding owners. No production
file, dependency installation, generated doc, commit or push changed.

## Chunk 3: complete metadata results and populated unions

**Law and authority.** Public virtual-row properties and ARCHITECTURE's facade
boundary require structured whole-row/spread and functional direct-source
results to retain source metadata. New projected objects receive output
Collection metadata (maintainer decision). Authored reserved names cannot choose
attribution. This chunk extends O06/O07's snapshot boundary; it does not claim
callback, facade-lifecycle or functional-input coverage.

**Model and legal grammar.** Authored source facts and pending-key sets predict
every ordinary selected field and all four virtual fields. No source row or
compiler classifier supplies expected values. The 1,056 attribution histories
retain all prior compositions, add a second source row and its deletion, and
cross independently configured keys with default-key differential checks.
Only the latter consult a sibling query for undocumented compiler key encoding.
Both boolean collision values and legal local origin distinguish authored
values from output metadata. Direct-source callbacks cannot add collisions;
that nearby invalid combination is excluded by grammar. Collisions cross
single/joined sources and direct, recursive, joined, functional and union
consumers, so removing any such axis loses its receiving path.

Another 264 histories populate two union branches with numeric 1 and string
"1", different source IDs and equal labels. They cross branch order, QueryRef
consumption, either pending branch, five projection shapes and reserved-name
collisions. A peer is deleted and reinserted while the other branch persists;
settlement without confirmation restores its independent authored base. The
custom public key preserves typed identity, avoiding an invalid duplicate-key
winner policy. Model objects never cross into production without copies.

**Observation and calibration.** Public toArray snapshots are compared at
preload, held mutation, peer deletion/reinsertion and settlement. The comparison
normalizes only unspecified order and retains duplicates, every ordinary field
and all metadata. Fourteen wrong-result controls cover both source/output
policy and reject omitted/duplicated second rows, missing ordinary IDs, wrong
keys, union-wide ownership and stale pending/origin. Allowed reverse order
passes. These are checker calibrations, not fresh production mutants. Full
production repair and its RED/GREEN/mutant record remain deferred by instruction.

**Reach and unchanged baseline.** 1,343 tests pass: 1,320 attribution histories,
eight prior nullable-spread histories, one prior classification case and14
checker controls. Multi-row/deletion reach1,056 each, independent-output-key
reach384, simultaneous populated/typed/reinserted union reach264 each, and
true-authored output-pending discrimination reach192. Each of24 union
path × source/output policy × pending-side × held/reinserted/settled cells
reaches18 source-owned or48 output-owned histories. The oracle asserts all
these states; a missing receiving path cannot borrow another path's count.
Command: package-root Vitest with config, coverage and runtime typecheck flags
listed above, selector tests/query/virtual-row-fields-oracle.test.ts. Final
log: chunk3-metadata-collisions.log. DB tsc --noEmit was clean before the final
collision-value grammar addition; the final type/lint check is recorded below.

**Independent review.** metadata_complete_review and metadata_union_review
applied oracle-review and ran the tests independently. Findings corrected:
position-dependent pending wait, source/model object sharing, aggregate reach,
missing row2 metadata controls, and false-only authored pending collisions.
Final union review independently passed1,343 tests with all required reach
(chunk3-union-review-final.log). No further supported executable defect was
found in this bounded scope.

**ORC accounting.** 001–003: authority, independent authored-fact judgment and
literate boundaries above. 004: reconstruction of prior forms, meaningful
composition/key/branch/collision axes, typed-key margins and direct-return
collision exclusion. 005: full public snapshots at positively reached cuts.
006:14 calibrated controls, including legal reordered positives. 007: finite
exhaustive grammar, random/shrink campaigns inapplicable. 008: direct
recomputation; pending facts distinguish held/settled rows. 009: authored facts
and pending-key sets denote source state and active optimistic overlays.
010: held gates settle before all-resource failure-preserving cleanup.
011: independent configured keys address the shared-default-key hypothesis;
no further named shared fault requires another formulation. 012: this record
and updated coverage map preserve limits. 013: true/false collisions and
source/output, either branch and peer-return neighbors distinguish wrong laws.
014: controlled core only, no real-provider/framework handoff claim. 015:
per-path counts above. 016: new histories and controls use the shared model/check.

**Limits.** Dynamic join matches, rejection/overlap, callback/downstream
metadata, facade activation/retirement, functional callback inputs and generated
public types remain separate work. Default compiler-key encoding remains a
supplemental differential observation. No production file or generated doc
changed. No commit or push was made.

## Chunk 4: join transitions, independent write outcomes and publication

**Law and authority.** The accepted source/output attribution rule applies at
each publication. ARCHITECTURE's coherent-publication law requires installed
reads and change payloads to agree; downstream callbacks are judged at their
own layer, without requiring downstream advancement inside an upstream callback.
The optimistic-history owner supplies settlement and first-queued-confirmation
origin rules. This is O08–O10's bounded core receiving witness.

**Model, grammar and observations.** A full left join is recomputed from
independent authored rows and separate optimistic snapshots. The driver has
112 finite histories: five projection shapes, spread order where meaningful,
join-key versus membership transitions, independent success/rejection with
separate errors, and either settlement order. A held left write spans unmatched,
matched, unmatched and rematched cuts. A right write then overlaps and receives
a queued same-key source update. The unconfirmed left row restores its base;
the right source confirmation becomes local only after successful work. A later
remote write distinguishes consumed attribution. An untouched parent remains.

Every action compares full root/downstream snapshots and every recorded
callback's installed read, change value and previous value. Raw metadata is
captured at callback time. Deltas across the entire callback trace must equal
the independent before/after delta; message multiplicity survives capture.
Batch partition is permitted. Initial-state subscriptions establish subscriber
replicas before update classification is judged. The first attempted driver
omitted that premise and got valid insert messages for first delivery; that was
a fixture error, not product RED. Another run failed only on undeclared reach
names; that was harness setup, also not product evidence.

**Reach and unchanged baseline.** Full owner: 1,463 passed, including prior
1,343 cases,112 histories and eight new checker controls. For each projection
shape/topology, all rematched-held/two-pending/first-settled/both-settled/remote
cuts and root/downstream held callbacks run. Spread shapes reach16 histories
per such cell; other shapes reach8. Either rejection reaches8/4, both rejection
reaches4/2, and either settlement order reaches8/4 respectively. All120 required
states are asserted by createOracleReach. Final runtime log:
chunk4-metadata-r2.log. Commands use the same package Vitest invocation as above.
No unchanged-production defect was found in these histories. Controls reject
stale installed metadata, stale event origin, wrong previous values, duplicated
messages/whole batches, missing messages/callbacks and an earlier bad callback
followed by a correct final read. No production-mutant or repaired-production
GREEN is claimed.

**Review.** Fresh metadata_timeline_review and metadata_publication_review
applied oracle-review. They identified duplicated whole batches passing the
checker, grouped unsubscribe cleanup, and missing both-reject histories with
separate caller errors. All are repaired. Both independently passed1,463 tests
(chunk4-metadata-independent-r2.log and chunk4-publication-review.log). The final
bounded verdict found no further supported executable defect.

**ORC accounting.** 001–003: authorities and literate, independent recomputation
above. 004: initial absence/presence, both topology transitions, meaningful
spread order, caller outcomes and settlement order distinguish the grammar;
missing-key updates and same-source overlap are excluded from this domain.
005: public snapshots, callback reads/payloads and downstream scalar projection
at named cuts. 006: eight wrong-observation controls, including duplicate traces.
007: exhaustive finite grammar, random/shrink campaigns inapplicable.
008: separate base/overlay/pending/origin facts distinguish acceptance,
settlement and later writes. 009: model facts map to applied source rows,
optimistic snapshots and pending writes, not D2 graph state. 010: both gates
settle and independent subscription/Collection cleanup entries attempt all
resources; capture preserves earlier metadata. 011: no identified shared
semantic fault needs a second formulation. 012: this record and coverage map.
013: matched/unmatched, held/settled, local/remote and separate errors distinguish
nearby wrong rules. 014: controlled core scope; no provider/framework handoff.
015:120 path states above. 016: histories and calibrations use shared judgments.

**Limits.** Same-source overlapping writes, truncate, dynamic joins beyond LEFT,
provider/framework scheduling, facades and partial-construction cleanup remain
open under their recorded owners. Production files, generated docs, package
manifests and lockfiles remain unchanged; no commit or push was made.

## Chunk 5: facade metadata, active intervals and inline values

**Law and authority.** ARCHITECTURE's Nested materialization section applies
the Collection metadata boundary to facade rows and preserves authored inline
values. Parents sharing an active bucket share its ready facade. Last-route
departure retires that interval; reactivation gets a new facade. These histories
have no facade-local optimistic mutations, which could legally keep retired
handles nonempty. This is bounded O11 receiving coverage.

**Model and grammar.** The primary includes owner now recomputes active bucket
intervals from the complete current route groups. Model-only interval tokens
name lifetimes, not production IDs. Complete inputs avoid redundant route-count
state. The metadata receiver crosses 33 projection/collision descriptions,
populated/empty destinations and child success/rejection: 132 histories.
Sharing, one-route departure, last-route departure, held reactivation,
settlement, later source update and resharing compare every child row and all
four metadata fields. Facade output uses its public ID; source-owned rows use
the independently supplied source ID. Inline toArray/materialize comparisons
preserve authored shape. Reads of all four source virtual fields make inline
spread values explicit rather than depending on property enumerability.

**Results and calibration.** Unchanged production passes 1,632 tests across
both owners (1,599 metadata, 33 includes). Six lifetime controls reject split
sharing, retargeting, stale retired rows/status, missing groups and a cleaned-up
active empty facade; four inline controls reject facade enrichment. The first
checker accepted that active-empty survivor. The review's actual checker probe
now fails at the intended readiness assertion. No production repair GREEN or
production mutant is claimed. Logs: chunk5-ready-final.log,
chunk5-facade-lifecycle-rereview.log and chunk5-active-empty-probe-rejected.log.
DB types and lint:changed pass (chunk5-db-types-final.log and
chunk5-lint-final.log).

**Reach and review.** Every declared lifecycle cut reaches 32 histories per
ordinary shape and four for direct functional returns. Each facade/inline form
reaches nonempty held/reactivated observations. Active-empty-ready has the same
32/four counts. facade_metadata_review and facade_lifecycle_review used
oracle-review; the latter found the readiness gap, verified its rejection and
independently passed the full suite. No further supported bounded defect found.

**ORC accounting.** 001–003: authority, limits and literate independent models.
004: shared/sole/absent routes, populated/empty destinations, return intervals
and caller outcomes distinguish each axis; inactive groups have no route.
005: actual public facades and inline values at every named cut. 006: ten
hostile controls plus the actual former checker survivor. 007: exhaustive finite
grammar, so random/replay campaign requirements do not apply. 008–009: active
interval and next token are minimal lifetime facts mapped to public facade
sharing; complete route inputs supply current activity. 010: pending mutation
settles before all-resource failure-preserving cleanup. 011: no new shared-fault
hypothesis requires another formulation. 012: this versioned record at unchanged
858b174a65f160d13d01f0324c7481cc8e4eba3a. 013: last-route and reactivation
neighbors distinguish reuse/retargeting. 014: controlled core receiving scope.
015: per-shape/form cuts above. 016: histories and controls use shared judgments.

**Limits.** Single-source string child keys only; composite key encoding,
facade-local mutations, construction failures, Effects and provider/framework
scheduling remain separate work. No production or generated docs changed.

## Chunk 6: generated public metadata types and nullable facade receiving path

**Law and authority.** VirtualRowProps and ARCHITECTURE's Nested materialization
section supply readonly metadata at Collection roots, source-row metadata on
whole rows and authored shapes for inline values. A nullable selection is either
a complete source row or an empty object. Publishing that object through a
facade supplies required metadata in both cases, while ordinary fields remain
absent in the empty case. The ordinary optional-fields type tests also establish
required selected properties whose value can be undefined. This is bounded O14
core-source coverage; adapter handler-result generation remains pending.

**Model and grammar.** Twenty-four finite row descriptions cross three key
domains, two ordinary scalar types, nested optionality and discriminated unions.
Each receives the five projection/eight composition descriptions shared with the
runtime owner. Seven child shapes cross the legal facade/toArray/materialize/findOne forms:
66 query witnesses per description, plus query/index nested refs and
virtual-field removal. Array/Date facade projections are illegal and excluded;
their inline forms remain. Inputs import the public source entry. Every generated body also executes
public query/index construction before compilation, with reverse-order
failure-preserving cleanup. The generated index explicitly chooses BTreeIndex.
Two admission controls preserve the illegal opaque-facade and missing-index-type
fixtures as rejected grammar neighbors. Type erasure prints import-free source
before rebinding; an earlier emit-only removal produced db_1 setup errors and
supplies no product evidence. A recursive type
signature preserves per-member keys, values, optionality and readonly modifiers;
Date built-ins stay opaque while their extra properties are checked. Arrays
retain element shape, mutability and extra fields. Bidirectional signature
comparison permits duplicate equivalent union members, which strict generic
Equal incorrectly rejected in the first draft. Missing whole rows use a
complete-or-absent alternative rather than Partial, which would admit partial
source rows. Expected types come from declarations and authoring shape.

Concrete helper examples moved from virtual-row-fields-oracle.test-d.ts to the
ordinary virtual-row-fields-reference-types.test-d.ts. They remain supplemental.
The normal package oracle script selects the generated owner. Every compiler
diagnostic, including dependencies, is retained with its file/span/code.

**Baseline and receiving evidence.** On unchanged production, all 24 generated
descriptions fail only Observation_nullable_whole_facade: inferred ordinary
fields are falsely required because the empty alternative disappears. This is a
new production type defect, deliberately unrepaired. Every one of 69 declared
type-comparison states and construction-admitted reaches in all 24 histories; this counts comparison
reach, not successful histories. The runtime owner adds two legal correlated
histories, initially matched/unmatched, each changing match presence twice.
Complete source rows retain source metadata; empty facade rows receive output
metadata, while inline values stay empty. The runtime owner passes 1,604 tests, including three nullable-boundary checker
controls.
Default empty-row key encoding is only checked against the facade's own public
keys, so no independent encoding claim is made. Generated imports judge public
source types, not published declaration resolution.

The first generator used invalid root/union API calls. The first runtime draft
omitted required include correlation, and another draft omitted explicit index
type. Those runs failed setup and supply no product RED. After fixture repair,
the source compiler reaches only the intended law mismatch, and the runtime
receiving comparisons pass. Logs: chunk6-independent-types-review-v3.log,
chunk6-independent-runtime-review.log and chunk6-runtime-final.log. Final DB TypeScript and lint results appear with the construction evidence
below. Final-delta runtime review passes 1,604 tests; the second reviewer
independently passed all 24 public construction bodies before the permanent
construction driver was added.

**Calibration and review.** Seven controls reject enriched inline values, lost
nullability, one mutable metadata union branch, nested any, Date metadata any,
optional nested metadata and nested readonly changes. Each starts with an
accepted generated neighbor. Its hostile compilation must contain only TS2344
Assert failures at generated Observation/Removal aliases; syntax/setup errors
cannot count. metadata_types_review found the per-union-member readonly,
Date-any and nested-shape survivors; the revised checker rejects each at the
intended type comparison. Its independent complete run has 24 intended RED and
seven calibration passes, with every type state reached 24 times. A second receiver review found the illegal opaque facade and optionless index
inputs. Both are corrected and retained as actual admission calibrations. Its
independent two-owner run has 24 intended RED and 1,611 passes. The permanent construction driver then passed independent re-review: 24 intended
type failures and nine controls pass; all 70 states reach 24 histories, including
construction admission. Log: chunk6-construction-independent-final.log. Main
agrees (chunk6-construction-r3.log). Final package types and lint pass:
chunk6-construction-types-r2.log and chunk6-construction-lint.log.

**ORC accounting.** 001–003: public/architecture authority and visible textual
models, source grammar, compiler and comparison. 004: key domains, optional
nested values, discriminated unions and every meaningful projection/composition
cell; invalid boolean keys and nullable source Collections are excluded.
005: real compiler public-source imports and actual runtime facade transitions.
006: seven intended diagnostic controls, three nullable-runtime controls,
two construction admission controls and rejected actual checker survivors.
007: exhaustive finite domains, no random campaign obligation. 008: stateless
type judgment, so state minimization does not apply. 009: authoring descriptions
map directly to user syntax; signatures are model-only type observations.
010: compiler source is memory-only, all diagnostics retained; runtime resources
use failure-preserving cleanup. 011: runtime nullable receiving witness supplies
the distinguishing non-type observation for the lost-empty-row hypothesis.
012: this record at unchanged 858b174a65f160d13d01f0324c7481cc8e4eba3a.
013: matched/unmatched, projected/whole, nullable/required and per-member modifier
neighbors reject nearby wrong laws. 014: core-source type and controlled runtime
scope; built/npm/provider receiving claims remain open. 015: 69 type cells plus construction-admitted at
24 histories plus two runtime match states reached by both initial conditions.
016: generated public consumers use one independent law; retained concrete
assertions are ordinary supplemental files.

**Limits.** Built declarations/npm, adapter handler admission, opaque facade
forms (rejected by admission), nullable QueryRef-facade runtime paths and provider/framework
scheduling remain separate work. Known production type RED prevents a closure
claim. No production, generated documentation, manifest dependency or lockfile
repair was made; the package change only selects the test owner.

Chunk 6 reviewed test-source SHA-256 fingerprints (before later chunks):

- `packages/db/tests/query/virtual-row-fields-types-oracle.test.ts`: `65508306911b9c1082181cad2b7467a858a86823bc33228665f2affe5f1edfe4`
- `packages/db/tests/query/virtual-row-fields-grammar-oracle.ts`: `e9587864267256821b898d671c982dc81b3403e8fdb0ef7f20b6d96f0fb1c23b`
- `packages/db/tests/query/virtual-row-fields-oracle.test.ts`: `a2e1e963a9e365cc0ff6cfaa1223c1aacd3e1fc62aa9f5b7aea9c20dc3eaa2c8`

## Chunk 7 — mutation outcome versus explicit confirmation

**Law and scope.** Handler Promise outcomes and source confirmation are independent.
Discarded values affect neither. Query handler completion starts no fetch.
Authority: accepted first-RC maintainer decisions and the optimistic-history
acceptance/settlement contract. The shared pure model rebuilds one edited key
and an optional peer from authored inputs. It contains no Query/SDK classifier.
This chunk does not close O17's ordered/later-application paths.

**Grammar, path and cuts.** 78 Query +42 Electric bounded histories cross CRUD,
absent/present peer, fulfilled void/legacy results, reject-before-write and
reject-after-write. Only fulfilled handlers have a return-value axis; only
written histories request confirmation. Query uses none/refetch/direct write;
Electric uses none/explicit txid. An actual QueryClient and Electric adapter
receive held provider responses. Cuts separately observe handler entry, server
write, requested acknowledgement, accepted acknowledgement, the settlement
waiter, final settlement, and later source confirmation for unconfirmed writes.
Complete ordinary rows include an unchanged scalar and peer when present.
Exact error identity, transaction state, utility outcome and real work counters
are retained. Frozen settlement rows are rechecked after later confirmation.

**Baseline.** Unchanged production 858b174a65f160d13d01f0324c7481cc8e4eba3a.
Full Query owner 253 passes; full Electric owner105 passes; shared13 controls
pass. Logs chunk7-query-r2.log, chunk7-electric-r2.log, chunk7-model-r2.log.
No new production RED was established by this chunk. Query/Electric package
types pass (chunk7-querytypes-r2.log, chunk7-electrictypes-r2.log); lint exits0
after import-order correction (two existing warnings in the large Query owner).
No production change, repair GREEN or source-mutant execution is claimed.

**Reach.** Every declared description cell reaches once. Query cuts: entry78,
server-written72, requested-refetch24, accepted-confirmation48, settlement78,
waiter78 and late-confirmation24. Electric: entry42, server-written36,
requested-txid18, accepted-txid18, settlement42, waiter42 and late-confirmation18.
Each local history asserts its applicable cut reach.

**Calibration/review.** Thirteen shared controls reject extra Query or SDK work,
omitted peers, partial server replacement, changed success/failure verdicts,
replaced error identity, lost accepted data, leaked optimistic rows, premature
waiter state, duplicated writes and early acknowledgement. Controls first pass
a legal neighbor through the same comparison. Query reviewer caught lost empty
Collection margins and unconditional afterAll reach that broke unrelated replay.
Peer absence restores the margins, and nested suites isolate reach. Electric
reviewer caught a constant work recorder and immediate stream delivery hiding
early acknowledgement. Actual SDK counters and the requested-wait cut fix both.
Independent final review: Query78 +controls13; Electric42 +controls13.
Logs chunk7-query-r3-independent-review.log, chunk7-electric-independent-r2.log,
chunk7-shared-controls-independent-review.log, chunk7-calibration-independent-r2.log.
Unrelated filtered tests pass in both packages. Reviewers named two next witnesses:
post-handler external refetch application (leaked active-handler count) and
rejecting ordered handlers. Those are required next-subchunk work, not waived.

**ORC accounting.**001–003: accepted contract, independent row recomputation,
visible grammar/driver/check.004: every meaningful finite cell, empty/peer margins,
CRUD and outcome ablations; returned values after throws and prewrite confirmation
are excluded.005: real public Collection mutations, utility calls and waiter cuts;
server facts are supplied before each claimed observation.006:13 intended
wrong-observation controls.007: exhaustive finite grammar, no random obligation.
008: model retains only edited-key membership/version and outcome distinctions
that change these public cuts.009: server-written combines backend write/response;
source acceptance and transaction settlement remain separate.010: all gates
release; verdict/Collection/client cleanup each receive an attempt and primary
errors survive.011: no new shared-fault hypothesis needing a second reference;
independent reviewers reconstructed post-write rejection from the acceptance law.
012:this exact-head record.013:no-confirmation versus explicit confirmation,
rejection before/after write and requested/accepted neighbors.014:controlled
ShapeStream boundary only, no live-provider claim.015:per-description and local
cut reach above.016:shared model/check and generated receivers; calibration-only
owner contains no standalone product examples.

## Chunk 8 — ordered mutation outcomes and refetch after handler exit

**Law.** Handler failure and accepted source confirmation remain independent
through the ordered Query receiver. After every handler exits, a later public
refetch again waits for its application obligation. Authority: optimistic
settlement, Query explicit-refetch documentation and the wrapping-sync receipt
contract. A wrapping sync may publish rows before its durable receipt settles;
pending receipt and old public rows are not synonyms.

**Owners/model.** `optimistic-ordered-refetch-oracle.test.ts` recomputes the
window by filtering/sorting/slicing the independent backend ledger. The existing
Query ownership call-obligation ledger governs post-handler settlement, composed
with `checkPostHandlerRefetch`'s whole-snapshot and waiter checks. Neither model
imports Query's handler count, result classifiers or persistence queue.

**Grammar/path.** Ordered: CRUD ×fulfilled void/legacy or rejection before a
write/after explicit confirmation ×optional invalidation while held =24 histories.
They observe immediate optimistic windows and callbacks, bounded refill, held
invalidation/report, exact handler failure/state and the final ordered fixed
point. The original two update/fulfilled-void traces retain invalidation head5.
Insert uses head6 to avoid colliding with its local key5. Source/index/live-query
acquisitions register cleanup before subsequent setup can fail. Three controls
reject lost committed data, legacy-value failure and reversed order.

Post-handler: six CRUD ×fulfilled/rejected histories use a real persisted Query
Collection. After its handler settles, a later refetch's actual durable commit
is held, with no optimistic transaction remaining. A task boundary lets the
utility process completed Query fetch work while the receipt remains held.
The utility must remain pending; either whole old/new snapshot is allowed then.
After release its own waiter must read the complete new rows. Three controls
reject premature receipt fulfillment, partial rows and stale waiter rows.

**Calibration failures repaired in the oracle.** The first draft required old
rows during the durable hold; source rows already publish there, so those six
failures were a wrong observation/model cut, not a production defect. The next
draft read pending at Query's early flag change. A reviewer removed only the
handler-count decrement with a Vite in-memory transform; production files were
never edited. It ran the faulty wrapper but all9 tests survived, exposing the
timing gap. Keeping the receipt held through a task boundary then rejected all
six histories at the intended pending-versus-resolved comparison; three controls
still pass. Logs chunk8-leaked-count-mutant-independent-review.log,
chunk8-leaked-count-instrumented-independent-review.log and
chunk8-leaked-count-task-turn-independent-review.log. Permanent-source rerun and
final reviewer verdicts follow below.

**Final chunk8 evidence.** Query full ownership262 +ordered27 =289 passes
(chunk8-runtime-final.log). Package types and lint exit0; lint retains two
existing warnings in the large ownership file. Reviewer mutation_query_review
passes the permanent nine-test post-handler scope and confirms the in-memory
counter mutant fails all six histories at the intended comparison, with all
three controls passing (chunk8-post-handler-r3-independent-review.log,
chunk8-leaked-count-r3-independent-review.log). All12 declared cut/description
states reach once. Reviewed owner fingerprint:
`d9699cf0554bcc58bc9966be51d0b5f8c622b9f6f14e61344fce05420535029b`.
Reviewer mutation_ordered_review passes27 tests and the control-only selector
passes3 with24 skipped. Every ordered description state reaches once; local
cuts:optimistic24, fixed-point24, bounded-refill16, held-report12 and
handler-confirmation18. Logs chunk8-ordered-resumed-final-review.log and
chunk8-ordered-selector-resumed-review.log. Ordered fingerprint:
`462f432f7b20797b8326dc50ae9feb9db177354c802c40d3aad53a46e65a493d`.
No further supported oracle defect remains within either bounded scope.

**ORC accounting.**001–003: contract authority and independent ledger/window
models beside the driver/comparison.004: CRUD, before/after rejection and
invalidation axes; old update witnesses retained; never returning after a
throw and duplicate insert keys are excluded.005: actual Query/Collection/
persisted adapter paths, controlled backend/receipt premises supplied before
the cuts.006: six wrong-observation controls plus intended in-memory counter
mutant rejection; the initial survivor and false row-hiding draft are classified
above.007: finite exhaustive descriptions, no random campaign requirement.
008: promise outcome/obligation state retained separately from publication;
ordered expected results are stateless recomputation.009: the call ledger's
application obligation includes the wrapping sync's durable receipt; an
ordered final cut is its eventual fixed point, not the mutation waiter.010:
release gates, attempt each cleanup, preserve original failure.011:no unresolved
shared semantic-fault hypothesis requiring a second reference.012:this record
at unchanged858b174a65f160d13d01f0324c7481cc8e4eba3a.013:prewrite rejection
versus accepted postwrite rejection, and pending receipt versus settled receipt
distinguish neighboring wrong rules.014:controlled provider/storage boundaries;
no live/native provider claim.015:declared reach above.016:all regressions use
the shared models; controls challenge the same checks.

**Remaining bounds.** Fixed two-row numeric ordered window, one handler at a
time, no ordered persistence wrapper, no entire settlement callback trace,
no late application rejection, and no real SQLite/provider receiving claim.
The Query delay cut and ordered receiver are distinct paths; their combined
arbitrary network scheduling is not established. Types remain next chunk.
Production repairs remain deferred.

## Chunk 9: generated public mutation-handler types

**Law and authority.** The approved Query/Electric migration requires
Promise<void> handlers. Fulfilled void/undefined, rejected async work and a
synchronously throwing never-returning handler are admitted. Fulfilled values
and synchronous void are rejected. This law is independent of adapter types.

**Grammar and receiving paths.** The new DB owner
`mutation-handler-types-oracle.test.ts` generates36 consumers: both adapters,
three key domains, two scalar domains, schema absent/present and, for Query,
rows/envelope select. Each consumer crosses Config annotation, explicit and
inferred factories, CRUD and13 result descriptions:4,212 cells. All702 named
adapter/schema/data/surface/CRUD/result states reach six histories. Positive
neighbors prove each actual public source overload accepts the surrounding
consumer. Invalid imports or dependency diagnostics cannot supply a rejection.
Packed declarations and npm resolution remain O22.

**Review repairs and calibration.** Two independent oracle reviewers found
missing schema/select receivers and an overly permissive diagnostic classifier.
An in-memory schema-only widening survived the original1,404 cells. The expanded
grammar supplies those paths. Diagnostics now owe a Promise<void> incompatibility
anchored on the CRUD property. Distinct auxiliary overload errors are allowed;
exact duplicates and every diagnostic on an admitted candidate are rejected.
The six permanent controls remove a rejection, duplicate one, substitute a setup
code, append a positive-handler rejection, substitute unrelated same-code text,
or move the actual incompatibility into the callback body.

The compiler reviewer independently passes42 tests and scans all36 descriptions:
2,592 primary diagnostics, all anchored to the intended CRUD identifiers. Its
actual-compiler substitution probe replaces63 forbidden-result diagnostics per
adapter with body-local Promise<void> assignment errors while preserving the
nine synchronous-void primary diagnostics. Every local error satisfies the old
file/line/code/declaration/cause guards; the new handler-anchor membership check
rejects them. Both the prior same-code substitution and global Promise<any>
widening are rejected. Broad Promise<unknown> attempts were setup failures and
are not kill evidence. Warm compiler A→B→A equals cold B, including restored
handler rejections. No source production mutation was made; probes use overlays.

**Results.** Main42 passes in chunk9-handler-types-final.log; compiler reviewer42
passes in chunk9-handler-compiler-final-baseline.log. Additional logs:
chunk9-handler-anchor-calibration.log, chunk9-all-diagnostic-anchors.log and
chunk9-compiler-probes-substitution-r2.log. DB types and lint pass (r4 logs).
The package oracle selector includes the owner. This chunk reports no new
production defect. Product repairs remain deferred.

**ORC accounting.**001–003: authority, independent output/transport rule and
literate visible responsibilities.004: schema/select/surface axes reconstruct
public overloads; key/scalar domains keep input shapes legal; synchronous void
and fulfilled value exclusions are explicit.005: actual source entry imports
and retained compiler diagnostics.006: controls and executed mutants above.
007: bounded exhaustive grammar, random/replay campaigns inapplicable.008:
stateless admission law.009: result descriptions are generated input facts.
010: no temporary files or acquired runtime resources; dependency diagnostics
remain visible.011:no unresolved shared semantic-fault hypothesis requiring a
second model.012:this versioned record at unchanged858b174a6.013:fulfilled
undefined versus object, synchronous throw versus synchronous void, and schema
versus absent-schema distinguish adjacent rules.014:actual TypeScript compiler;
no packed-artifact handoff claim.015:702 states each6.016:every consumer and
control uses the same model/check, with no isolated concrete type assertions.

**Limits.** Finite generated row/result descriptions and the installed compiler
version. Schema transformations, arbitrary provider utility types, packed
ESM/CJS declarations, npm peer resolution and application migration remain
separate receiving evidence. Reviewer final receiver-specific mutant evidence
is appended below when complete.

**Final receiving review.** handler_types_review independently passes42 tests;
all702 states reach6. A Query schema+select overload-local widening passes the
plain rows, plain envelope and schema rows consumers, then fails the schema
envelope candidate-membership comparison. Electric's overload-local widening
instead causes dependency TS2352: setup failure, no kill evidence. The global
Electric widening and permanent controls retain their narrower evidence.
An add-only diagnostic on an admitted handler fails independently with every
negative diagnostic preserved. Logs:chunk9-handler-types-independent-review-final.log,
handler-types-query-schema-select-local-mutant-r2.log,
handler-types-electric-schema-local-mutant-r2.log and
handler-types-final-positive-auxiliary.log. Final owner fingerprint:
`59afc1991c1ffd2362922ca3e8a1ce7ee307ca3b7bc40cb05e9ffd3bad699ca3`.
Both reviewers find no remaining supported defect in the bounded source scope.

## Chunk 10: external completion and Offline restoration

**Law and authority.** Core's transaction admission permits external completion
only while pending. A failed snapshot stays failed even when independently
admitted Offline outbox work later succeeds. The README's per-ID settlement
contract requires that outbox work to keep its own provider outcome and deletion
obligation. Core rollback cancels directly overlapping pending snapshots; it
does not cancel their durable provider work. Completion releases the snapshot's
pending-write contribution before its settlement observer runs.

**Core grammar and evidence.** The outcomes owner now runs264 finite completion
histories: four admission states, five absent/pending/persisting same/other-key
peer kinds, four source shapes (none, target, unowned key, truncate), plus a
peer-key source for distinct-key peers, each with1–3 completion attempts. The
former12 histories remain prefixes. The primary model compares rows, metadata,
publication cuts, immutable requests, outcomes and states after every action;
tails settle independent peers and apply later source rows. Each history reaches
both comparison-completed cuts once. Full owner287 passes.

Review found that external completion omitted the primary driver's waiter-time
row comparison. A deferred-touch in-memory mutant survived all263 tests in the
first draft. Adding the same waiter snapshot comparison used for normal
settlement leaves unchanged production287 GREEN and rejects the mutant with39
intended assertion failures, including six new peer-key witnesses. Removing the
pending-only admission guard fails242 tests. Failures retain the primary
mismatch and distinct cleanup diagnostics through the established helper.
Reviewer handler_compiler_review finds no remaining supported core defect.
Logs:chunk10-core-final-independent-baseline.log,
chunk10-core-final-deferred-touch.log, chunk10-completion-guard-removal.log.
Fingerprints:primary model/driver
`e3df9fb84cbe0ca4212d8f314ddc34f9d7e9d20879db2651c056c56765028892`;
outcomes owner
`ee937b8c3191d3c827be4420e42a157d28a068a9fc2a6a6e82df940f9d33b523`.

**Real Offline receiver.** The settlement owner expands the old four restores
to60 histories:2/3 transactions, every success/failure mask, shared/disjoint
width1/2 and partial-overlap chains of width2. Alternating authored field edits
preserve the initial/value-edit/flag-edit snapshot law: a later flag-only
snapshot carries the earlier authored value. A stateless prefix fold predicts
provider-applied rows, surviving optimistic snapshots, pending keys, core
restoration states, per-ID outcomes, complete calls and remaining outbox IDs.
The actual executor receives serialized mutations from the real outbox encoder.
Raw restore registration IDs are checked before building a lookup, preserving
duplicate evidence. Every provider tail is held. Actual waiter callbacks eagerly
copy ordinary rows and pending flags; later reads cannot move that cut.

Intentional provider failures may warn with their exact authored Error. Another
exception cannot substitute for that allowed reason. The first draft captured
console.error only and falsely passed while console.warn reported cleanup
exceptions. The corrected recorder/check catches14 real failures: a successful
replay calls completeWithoutCommit on a snapshot a sibling already rolled back.
The per-ID waiter has resolved, and all preceding ordinary rows, pending flags,
server rows, states, calls and outbox assertions agree; cleanup then throws
TransactionNotPendingCommitError. Shared widths1/2 and chain width2 fail for FT,
FTF,TFT,FTT; shared widths1/2 also fail for FFT. Chain FFT passes, distinguishing
direct overlap cancellation from an unsupported transitive rule. All production
repairs are deferred by the maintainer's instruction.

**Results and reach.** Final whole settlement owner:14 intended failures,
73 passes (87 total, including seven new checker controls). Scoped receiver:
14 failures,53passes,20 skipped. Of220 declared registration/settlement cuts,
214 reach once; six final cuts for shared/chain FTF/FTT are blocked by earlier
RED comparisons. Those assertions stay present; no later-cut coverage is claimed.
Core and Offline package types pass after correcting one test-only index-signature
mismatch; lint passes with the existing dependency override mismatch warning.
Logs:chunk10-offline-full.log,chunk10-restored-r4.log,
chunk10-db-types-r2.log,chunk10-offline-types-r2.log,chunk10-lint-final.log.

**Calibration and review.** Seven controls reject extra errors/warnings, leaked
pending flags, stale waiter flags, resurrected failed state, early peer success
and a missing row. Reviewer handler_types_review independently reproduces the
same14 RED failures and53 scoped passes. Removing only restoration touch fails
pending metadata on otherwise unchanged rows, including an all-success shared
history. Deferring that touch lets later reads recover but fails recorded
waiter metadata, including an all-success three-transaction history. Each mutant
campaign gives44failures/23passes; the all-success witnesses distinguish those
mutant failures from the14 baseline product failures. An initial overlay config
attempt failed setup and supplies no kill evidence. Logs:
chunk10-restored-no-touch-mutant-r2.log,
chunk10-restored-deferred-touch-mutant.log. Offline owner fingerprint:
`83eb5551300ebb702e119174a2352c985ad6086cefa18042cc5c947c3c89e91a`.
No further supported oracle defect remains in this bounded receiving scope.

**ORC accounting.**001–003: transaction/README authority, independent prefix
and primary row models, literate layers.004: old prefixes retained, repeated
admission/peer/source/mask/width/overlap axes distinguish adjacent legal cases;
duplicate outbox IDs, nested rollback cascades and completed source ownership
are excluded by the stated grammar.005: real core calls and real Offline
restore/provider/outbox paths, eager waiter/public metadata observations.
006: controls, intended comparison kills and earlier survivors classified above.
007: finite exhaustive new grammars; existing fixed/random settlement campaigns
remain unchanged.008: failed core snapshot versus successful outbox work and
pending versus persisting peers remain distinct.009: snapshot/provider/outbox
terms stay separate.010: all gates/releases attempted, seed primary preserved,
console spies restored before resource cleanup so secondary failures remain
visible.011: chain histories challenge transitive cancellation; no remaining
shared-fault hypothesis needs another model.012:this record on858b174a6.
013: failed versus pending admission, direct versus chain overlap and waiter
versus later read distinguish wrong rules.014: actual executor receives the
controlled storage/provider premises; native/provider durability remains open.
015:core264×two completed cuts; Offline214/220 as bounded above.016:all new
histories and controls share models/checkers.

**Limits.** Core completion+touch path, one Collection,2/3 restored transactions,
width1/2, unmarked whole-row insert/update records, controlled in-memory storage
and provider, Node/jsdom observations. Deletes, retries, terminal phases,
multicollection work, real native storage and multi-owner schedules remain
separate owners. The14 reachable product counterexamples keep this class open.

## Chunk 11: rejected renders and independent descriptor startup

Source remains `858b174a65f160d13d01f0324c7481cc8e4eba3a`; no production
repair, generated-document edit, commit, dependency install or lockfile change.
This chunk strengthens O19 and O15 at native React/Svelte boundaries.

**Law and authority.** A rejected preparation or uncommitted render cannot keep
an independently read descriptor Collection from starting and serving its row.
Releasing one descriptor's deferral cannot stop at a sibling's startup failure.
Each source owns its eager/lazy start policy; the preparation rejection remains
the caller's rejection. Healthy returned adapter resources clean up once.
Authority is the existing source-ID/descriptor cleanup contract, the SSR guide's
client-owned descriptor lifetimes, and the glossary's crash/cleanup laws.

**Grammar and reach.** The React source-ID owner now runs 344 release histories:
applicable causes × derived/explicit-key ordinary/infinite/Suspense paths ×
initial mounts/rerenders × hook/preload/start/direct-subscription readers.
Source-ID collision needs a prior claim, and explicit keys intentionally bypass
source-ID/derived-IR rejection. Each history reaches `prepared`, `reader-ready`
and `source-update` (344 each, 1,032 cuts). Preparation reach checks descriptor
materialization, intended rejection class or exact authored error identity, and
execution after the hook for authored throws/suspensions. Four checker controls
reject missing/extra start, wrong value and duplicate rows.

The shared `descriptor-start-release-oracle.ts` judgment has 85 finite histories:
zero through three acquired sources, every failed-start mask, and independently
every eager-start mask, followed by a throwing factory and an unvisited tail.
React's three hooks receive 255 histories; Svelte's native effect root receives 85. Each reaches rejection, independent demand and cleanup (255/85 of each,
1,020 cuts). Checks compare successful factory counts before any test demand,
exact preparation failure identity, starts, complete ordinary rows/status and
healthy-resource cleanup counts. References are retained across client cleanup;
reacquiring a Collection would exercise restart instead of the cleanup cut.

Reconstruction includes the old two-throwing-starts-before-healthy witness.
Deleting prefix length loses before/after acquisition cases. Deleting the failure
mask loses the first-exception blocking distinction. Deleting independent policy
masks loses mixed eager/lazy neighbors. Zero acquisition is the boundary control;
a mask naming a source outside its acquired prefix is invalid. The bounded
enumeration is direct replay through its parameterized test name, not a random
campaign. A removed dependency-array SSR cause required `usesDeps=true`; every
current hook supplied false. The removed API therefore contributed no executed
history, and no current public behavior was retired.

**Review repairs and calibration.** Independent reviewers
`handler_compiler_review` and `handler_types_review` found:

1. A direct-subscription reader used an empty callback and read Collection
   storage. A memory mutant dropping update deliveries reached 122 drops and
   passed all 86 subscription histories. Recording a callback-derived replica
   makes the same mutant fail all 86 at the updated-row comparison.
2. Boundary text alone accepted unrelated render errors. Cause-specific class or
   authored identity checks and after-hook execution markers now validate the
   intended path before reach. Replacing the preparation rejection with a later
   source error fails 255 React histories at the exact-error comparison; four
   controls pass.
3. Uniform source policies could not distinguish applying one source's policy to
   all siblings. Independent per-source eager masks expanded 30 to 85 histories.

A memory overlay that stops resuming after the first startup exception fails
12 React histories and 32 Svelte histories at rejection: later starts stay zero,
status stays idle, and healthy rows are missing. Other cells can legitimately
recover during React retries; those cells are not credited as kills. No mutant
modified production files. Removing only the outer Suspense wrapper's catch
survives and its injected marker is unreached: current failures occur in the
shared ordinary-hook preparation first. This is an explicit limit, and the
coverage map's stale blanket claim that every hook's own boundary was killed is
corrected.

**Results.** Independent final runs pass 638 React tests (370 complete source-ID
owner, 259 startup owner including four controls, nine ordinary tests) and 85
Svelte histories. Native partial-construction fault injection in the ordinary
React file throws after acquiring a mount but before returning its handle. Root
inventory cleanup releases its subscriber, a later cleanup still runs, and the
primary/secondary Error identities survive in the AggregateError.
React/Svelte typechecks, changed-file lint and diff whitespace checks pass.
The existing node_modules/lockfile override mismatch is preserved.

Initial draft failures were setup mistakes, not production RED evidence:
passing a callback instead of an array to cleanup; retaining a constant explicit
key while changing the authored query; re-acquiring Collections after cleanup;
and not catching an intentionally failing lazy start. Two scratch overlays
resolved built output and never applied; they supply no kill evidence. A
review run spanning the policy-field edit had transient calibration errors and
is excluded. Final logs supersede these runs.

**ORC outcome and limits.** ORC-001–006, 008–010, 013, 015–016 have the law,
independent source-fact judgment, grammar controls, public native paths,
calibrations, reach and failure-preserving cleanup above. ORC-007 is inapplicable
to the finite enumeration. No additional concrete shared-fault hypothesis
requires a second formulation under ORC-011. ORC-014 is bounded to native
React/Svelte with controlled synchronous adapters, not arbitrary provider
behavior. This versioned entry supplies ORC-012. Sources throw Error values;
arbitrary thrown values, provider cleanup before returning a resource handle,
async startup failures, and arbitrary render schedules remain outside scope.
Abandoned-render histories establish eventual release on the encountered
schedules without separately measuring both reader-versus-reclamation orders.
The outer Suspense catch remains unreached. No product repair/closure is claimed.

Evidence directory: `/private/tmp/rc2171-oracle-challenge/`.
Final baseline: `chunk11-final-react-independent-review.log`,
`chunk11-final-svelte-independent-review.log`, `chunk11-release-r4.log`.
Mutants: `chunk11-drop-subscription-updates-repaired.log`,
`chunk11-stop-first-release-final-mutant.log`,
`chunk11-stop-first-svelte-final-mutant.log`,
`chunk11-replaced-rejection-final-mutant.log`.
Types/lint: `chunk11-react-types-final.log`, `chunk11-svelte-types-final.log`,
`chunk11-lint-final.log`.
Fingerprints (SHA256): source-ID owner
`af236fff80f7d21be7d458b0be70416ec48d08f8fb26c3f762f2f3e91a9d28a0`;
shared startup model
`c6c9bd6ab72ae057062da04f4d81be953b4387cb70950ee8add5b9c37da13add`.

## Chunk 12: first registration without a transported query result

Reviewed unchanged production HEAD: `858b174a65f160d13d01f0324c7481cc8e4eba3a`.

**Law and paths.** The approved local-declaration admission rule also applies
when no query result has been preloaded or transported. First registration must
retain the caller's getKey/schema claim before another same-identity caller can
read or attach. Conflicts depend on supplied declarations, so a held source
cannot defer their rejection until delivery. Compatible callers retain the
original keys and ordinary values. The SSR guide's initial server capture stays
initial until observer attachment and its microtask handoff; it is not a live
server view. The shared reference judgment remains independent of cache/hash
machinery.

**Grammar and observations.** Core now crosses 144 declaration histories with
three first claimants (explicit preload, streaming observer preload and server
read), five receiving paths and held/settled source delivery: 4,320 histories.
Each of the 15 routes reaches 288 first registrations and 144 held deliveries.
Public dehydration proves no prior query result and positive first registration.
The server-first driver preloads only its source. Two admission attempts,
compatible original reuse, callback-derived rows, exact keys, source updates and
subscriber ownership remain checked. Removing claimant variation loses the
observer registration path; removing held delivery loses conflict rejection
before readiness. The finite domain includes absent/added/removed declarations
and independent references; schema transformations remain excluded.

The new React `cache-first-registration-oracle.test.tsx` uses actual
`renderToPipeableStream` for both ordinary and Suspense readers. Its 1,152
histories cross the same declarations with first reader, second preload/server
caller and held/ready delivery. Streaming is enabled without Router transport
or hydration seeds. Every raw render error is validated, including later errors
after an expected conflict. Compatible reuse continues through a core observer
and the next source update. The file supplies no client DOM receiving claim.
Aborted renders retain the exact authored abort diagnostic and all render
completion promises settle during cleanup.

**Instrument repairs.** Independent oracle-review agents
`handler_compiler_review` and `handler_types_review` challenged the driver:

- Initial source writes shared the flat expected row objects. A mutant corrupted
  initial labels and left later updates distinct; both core and React retained
  their baseline outcomes, demonstrating a false green. All five cache drivers
  now write copies. The same mutant produces 4,320 core history failures (66
  controls pass) and 1,152 new React failures. Previously passing compatible
  cells fail the authored ordinary-row comparison. Existing admission failures
  are not credited again as mutant kills.
- A wrongly accepted observer preload could remain pending while delivery was
  held, preventing cleanup. The shared checker now records promise outcome at
  one host-task cut before delivery. Pending and fulfilled outcomes fail there;
  the original rejection judgment still rejects unrelated errors. Four checker
  controls pass. An unconditional observer-options omission now finishes with
  assertion failures and releases the provider, rather than timing out.
- Focused checker selection previously ran zero histories but asserted all route
  reach. Execution is now recorded before each fixture starts; every executed
  route retains all declared-state requirements. Four selected controls and one
  selected complete route (288 histories) pass separately. The parent inspected
  this selector repair independently.

**Unchanged-production results.** Core: 640 intended admission failures and
3,750 passes (4,390 tests). New React first-registration receiver: 192 intended
failures and 960 passes. Existing core lifecycle: 640 intended failures and
1,526 passes. Existing React cache receiver: 64 intended failures and 224 passes.
Svelte cache receiver: 144 passes. These are product RED evidence, not repaired
GREEN. Baseline controls and neighboring legal histories supply bounded GREEN.
DB/React TypeScript and the changed-file lint implementation pass. The pnpm
wrapper in one review attempted automatic install and stopped before installation;
the exact lint script was then run directly. The existing override mismatch is
preserved; no dependency or lockfile change was made.

**Calibration.** Omitting observer registration's row options adds 448 core
assertion failures (1,088 fail / 3,302 pass), including 64 held observer-preload
cells now rejected at the pre-delivery outcome cut. No timeout or suite error
remains. React's unconditional omission adds 128 failures (320 fail / 832 pass),
through held Suspense registration. A ready-only omission legitimately survives
React because ready server capture establishes the claim first; it adds 192
core failures. Source mutation uses memory overlays only. Initial filtered probes
with aggregate reach errors, a pnpm setup abort, unsupported mixed renderer
warnings in an abandoned draft and a pre-repair hanging omission supply no
intended-comparison evidence. Final runs supersede them.

**Review scope.** ORC-001–006, 009–010 and 013–016 are supported by the authority,
independent declaration judgment, finite grammar, real paths, public cuts,
calibrations, cleanup and per-route reach above. ORC-007 is inapplicable to this
exhaustive finite enumeration. ORC-008 introduces no new stateful reference
transition. No concrete shared semantic fault requires a second formulation
under ORC-011. This append-only head-specific record supplies ORC-012. Both
reviewers found no remaining supported blocker in the stated boundary. Schema
transformations, arbitrary transport/concurrent schedules, Router delivery,
hydrateRoot and first-registration receivers in other frameworks remain open
limits. No production repair or product-class closure is claimed.

Evidence directory: `/private/tmp/rc2171-oracle-challenge/`.
Baseline: `chunk12-held-admission-route-final-review.log`,
`chunk12-react-first-final-independent-review.log`, `chunk12-svelte-final.log`.
Controls: `chunk12-held-controls-route-final-review.log`,
`chunk12-selected-route-final-review.log`.
Mutants: `chunk12-omit-observer-row-options-final.log`,
`chunk12-core-initial-shared-row-mutant-before.log`,
`chunk12-core-initial-shared-row-mutant-after.log`, with equivalent React logs.
Core test SHA256:
`7ebf875a183111904b46d7905de3572287ccee5f28af9c7267f9969c9b7d60aa`.
Shared checker SHA256:
`05b42da4457279807137f408d9184e8c3bd0e57fbdc636199e465895e512d7e1`.
React first-registration driver SHA256:
`2247d32fc1e47c95136dafcf796f6c6a8dd8b93124d05b7981043156dafdd9e5`.

## Chunk 13: release histories, actual Changesets commands and finite replay

Production remains unchanged at `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
This chunk changes tests and their lint/replay instruments only.

**Authority and independent judgment.** CONTRIBUTING.md's Changesets/Releases
policy defines first `1.0.0-rc.1`, patch suffix increments, minor/major candidate
increments, stable semver/latest and candidate rc tags. The stable Query minor
is an explicit maintainer decision, not a rejected semver policy. The new
`scripts/release-history-oracle.js` uses numeric tuples and an authored pending/
consumed/token ledger. It imports no Changesets planner or production version
helper. A bounded workspace:* dependency model requires a patch when its exact
published target changes; compatible peers retain their range. Arbitrary semver
range planning is outside this model.

**Version grammar and cuts.** Seventy-two histories cross first/candidate-nine/
patch-nine boundaries, direct versus peer stable dependencies, minor/major
precedence, insertion order and three exit forms (no pending work, stable-only,
candidate-plus-stable). Each runs first seeding, standalone stable work, mixed
work, no-op versioning, strongest pending bump, independent candidate work and
exit. Every action compares manifests, version-attributed changelog token bags,
consumed IDs, retained files, dependency protocols and private package state.
No-op actions compare all fixture bytes. The real Changesets CLI supplies pre
entry/exit. Fourteen first-seed failure histories cross seven failure points
with both dependency profiles, then compare exact restoration and successful
retry. The after-apply fault first observes generated changelog bytes, so it
cannot pass by failing before those files exist.

Each version history enforces its own required cuts. The normal campaign also
enforces aggregate reach: first candidate, standalone stable work, mixed work,
precedence, no-op and post-exit no-op each occur 72 times; each numeric-nine
boundary and exit form occurs 24 times; stable-dependent exit occurs 36 times;
consumed-minor/pending-patch exit occurs 24 times. Each of the 14 failure/profile
states occurs once. Removing standalone stable work loses a plan with no
candidate release. Removing no-candidate exits hides synthetic exit planning.
Unknown packages, reused IDs and unsupported bump values are outside the grammar.

**Actual command receiver.** `publish-history-oracle.property.test.js` invokes
production `publishDuringRc` with its default command. A strict local pnpm shim
forwards to the installed real Changesets CLI; registry info/publish shims supply
only metadata and retain every raw attempt, selected tag, version, access and
success. They select no tag. Forty histories cross four numeric versions,
stable/only-RC/never/current histories and publish failure in either phase.
Already-current versions cannot have a publish failure; those cells are excluded.
Partial successful writes persist through retry. Each attempt must restore
manifest/pre-state bytes. Every public fixture package must have an info request;
success bags preserve duplicates and omissions while allowing independent order.
All 40 histories reach registry reads/restoration; 24 reach controlled failure
and retry. Twenty-eight pass the final judgment and 12 fail there as described
below. Six permanent wrong-observation controls challenge multiplicity, omission,
tag, version, registry and access.

**Independent review repairs.** `handler_types_review` found batched stable-only
work and candidate work on every exit. The expanded grammar rejects an omitted
synthetic exit plan that survived the former 36 tests. It also requested a real
late write fault; removing changelog backups now fails after-apply restoration.
`facade_metadata_review` challenged duplicate/foreign argument masking, inherited
Git configuration, unknown-command lock cleanup and an overly strict command
shape that disallowed a legitimate explicit tag. Strict shims now reject malformed
arguments, isolate Git/npm configuration without repurposing HOME, and permit
known explicit rc/latest forwarding. Six ordinary fixture controls cover this
boundary. The receiver supplies command evidence, not npm HTTP or installation.

**Finite replay.** Registered properties `scripts.release-version` and
`scripts.release-seed-failure` use the standard PROPERTY/SEED/PATH interface.
PATH is one finite case index; SEED is required request identity, not a source
of random cases. Direct replay runs that case and preserves its local cuts.
The shared manifest points at the actual script runner. A completed finite
comparison emits a truthful witness without fabricated fast-check RunDetails.
Setup before comparison emits none. The wrapper preserves primary, witness and
cleanup failures, including thrown undefined. Nineteen ordinary controls pass;
41 existing shared replay checks pass. Independent matching/mismatching-channel
and real EISDIR probes, actual guarded replays and a wrong-family zero-execution
control test the new API. These probes do not close the older standalone writer
policy conflict P03, which remains recorded separately.

**Lint instrument law.** Canonical replay exposed a false positive: recorded
`numRuns: 1` was treated as a one-run random input budget. Before changing that
test tool, the new `scripts/eslint-plugin-oracle/replay-observation-oracle.test.js`
ran an independent authored-intent source model. It knows the program's role;
it does not parse the generated source or reproduce the rule's AST classifier.
The final grammar contains 3,848 programs and two checker controls: location,
annotation, value flow, binding spelling, type-query and JSON binding axes,
plus five custom-hook initializer forms at otherwise admissible recording states.
All 1,924 declared states reach twice. The repaired allowance recognizes only
the shared writer's typed plain-data record, exclusively serialized by standard
unshadowed one-argument JSON.stringify. Actual budgets, aliases, exports,
mutations, field reads, replacers and custom toJSON/prototype hooks stay reported.
Type-only references and declarations do not invent runtime shadows; a hidden
outer runtime shadow still matters.

Every newly exposed distinction ran RED before its tool repair: two original
false positives, eight export/type-query mismatches, 32 JSON type/value
mismatches and 200 custom-hook escapes. Final source owner plus ordinary pins
passes 3,984 tests. A broad binding-flow bypass fails 520 comparisons; removing
the plain-initializer guard fails 200. Both fail at the report comparison.
The controlled premise trusts unmodified standard built-ins; this is not whole-
program runtime dataflow analysis. Other serializers/destructuring/intermodule
flows are outside the allowance. A calibration-only selector runs two checks;
any entered source campaign still owes every declared source state. An ordinary
subprocess control retains that selection behavior (bounded 16 MiB output).

**Results and calibration.** Version/seed: 86 pass. Publish: 34 pass (28 histories
plus six controls), 12 intended tag assertion failures. In those 12 only-RC
histories, real Changesets selects latest for both candidate packages; expected
rc remains unchanged. This is P01, deliberately unrepaired. Fixture controls:
19 pass; shared replay: 41 pass; classifier: 3,984 pass. DB TypeScript and final
changed-file oracle lint pass. Canonical hostile replays reject missing exit
planning at direct-dependent path 12, missing changelog backup after application
and missing local reach. Peer-only path 0 legitimately survives the exit mutant;
it cannot observe a stable direct-dependent bump. Each failed canonical replay
emits an exact failed:true witness. No package install, production repair,
commit, push or generated-reference change occurred.

Initial attempts using an unavailable vi.getConfig, a nonexistent shared-replay
config, a private selector rejected by lint, old zero-campaign reach behavior,
and an undersized subprocess output buffer are setup/harness failures, not
product RED or mutant kills. Earlier classifier runs with reach marked after
the assertion are superseded. Runtime evidence is reused only where final source
fingerprints did not change during later test-tool repairs.

**ORC outcome.** 001–006: explicit policy, independent ledger/source-intent model,
literate layers, bounded legal grammar, actual CLI/parser paths, public file/
request/report observations and hostile calibrations above. 007 is inapplicable
to exhaustive finite enumeration; canonical direct replay is nevertheless tested.
008–009: pending/consumed work and numeric counters retain distinguishable future
actions; source intent is explicitly model-only. 010: exact rollback and
failure-preserving cleanup/witness controls. 011: no unaddressed shared-semantic
hypothesis in the declared boundary. 012: this head-specific versioned entry.
013: standalone stable work, no-pending exit, numeric 9/10 neighbors and
independent registry shapes distinguish the weaker rules. 014: actual Changesets
command/parser reception; npm HTTP, tarballs, installed consumers, credential
services and Actions remain separate. 015: local and aggregate reach above.
016: histories and calibrations share their judgment; ordinary harness examples
remain in ordinary test files. Independent reviewers found no remaining supported
blocker in this bounded chunk. No product-class closure is claimed.

Evidence directory: `/private/tmp/rc2171-oracle-challenge/`.
Runtime: `chunk13-release-version-final-r7.log`,
`chunk13-publish-final-r7.log`, `chunk13-fixture-final-r7.log`,
`chunk13-shared-replay-r7.log`.
Classifier: `chunk13-lint-observation-independent-final-r9.log`.
Mutants: `chunk13-exit-plan-mutant-r9.log`,
`chunk13-changelog-mutant-r8.log`, `chunk13-local-reach-mutant-r8.log`;
source-classifier RED/GREEN/mutant logs have the chunk13-lint-observation prefix.
Final lint: `chunk13-lint-final-r12.log`; types: `chunk13-db-types-final.log`.
SHA256 model: `ad378df8f61783fbdba2d53609de5a62b1e5b0f8e0f15643753c55744c4baf8d`;
version runner: `79567b1d43b48d7c9d1d0125057b1056f7eb024bfe8a4456646d16f5d99b0eb3`;
publish runner: `512218cbed6cfdd007620a3fed1ae1ce34a303a72fa0cf5dc30ad66b960856b7`;
fixture: `a4c3a87dd719160866d6fd2749d55996df2f4e1e40f8fadced4025c4391fcc29`;
classifier owner: `f4e51294ebcfefc2bfdb9127dae91a5f557a75b7e1e2763635038e60fd308f4d`;
classifier rule: `3a8139f2c2fa1fd55291ce68ab3593dad754b14ad35e3bf9cbe367e676a9fa28`.

### Work remaining after chunk 13

Production repair stays deferred. O13 now has version and actual Changesets
command evidence; chunk 14 is the real loopback HTTP/npm receiving witness.
Packed consumers and clean workspace/build reception remain O22. Test:release
and CI wiring for the new script owners remains part of final O26 execution;
the PR's existing test:lint-rules already discovers their property files.

The following boundaries still need implementation/review before the campaign
can finish:

- Transforming schema retention through actual client mutations in the shared
  bound-options owner and React/Preact receivers (O05). Schemas do not transform
  synced query rows. Runtime absent/trim/uppercase probes establish the correct
  mutation observation. Typed live-query schema support remains an existing
  separately recorded limitation.
- Effect source metadata copied to ordinary selected fields, with exact batch
  and named delta value/previousValue ledgers (O06–O11 receiving limit). Effects
  have no output Collection ID. Implicit reserved Effect-root attribution is
  not authorized by the Collection decision.
- O12 subquery reserved-field sanitation still awaits the already-asked
  maintainer decision. Do not silently select a normative answer.
- O20 proxy diagnostics and actual ListsScreen/ListCard via controlled React DOM
  host primitives; native emulator/renderer tools are unavailable. The actual
  component scratch probe shows Saving absent/held/settled transitions. It
  supplies no native-host scheduling claim.
- O21 actual fenced mutation guidance through the shared confirmation judgment,
  active API consistency and diagnostic-specific snippet baselines. The actual
  error-handling POST retains its current intended stale-Collection RED. P02
  identifies another stale current instruction.
- O22 clean frozen install/build graph, public package packing and supported/
  rejected installed consumers. Inventory25 is correct. Offline lacks a local
  DB project edge in pnpm's closure; the lock still contains its DB link, so
  installation failure itself is unproven. The exact SQLite core source
  typecheck already fails on the Promise<{}> handler (G08).
- O23 retired exports/modes/wrappers; O24 compile-invariant work placement;
  O25 built diagnostics and ESM/CommonJS/public export receiving checks. Read-
  only inventory finds the originally cited code already removed/hoisted.
  Calibrated checks must preserve that evidence without inventing an all-adapter
  coded-message promise. Preact intentionally lacks CJS; Svelte has a distinct
  build layout. O26 must tie actual selected/build inputs and all remaining
  affected validation to exact fingerprints, and retain P03's older writer
  policy conflict rather than declaring the whole instrumentation class closed.

## Chunk 14: actual npm/pnpm HTTP publication

Library production remains unchanged at
`858b174a65f160d13d01f0324c7481cc8e4eba3a`. The release publisher is deliberately
unrepaired. This chunk adds a receiving driver and fixture controls.

**Law and receiving boundary.** The accepted release policy and chunk 13's
independent `expectedPublishes` ledger still require candidates on `rc`, stable
packages on `latest`, and each unpublished version once. The new
`scripts/publish-http-oracle.property.test.js` invokes the default production
publisher through actual Changesets 2.29.8, npm 11.17.0 and pnpm 11.1.0. A child
registry binds a loopback ephemeral port because the production command blocks
its parent event loop. It supplies authored package metadata and controlled
failure responses; it never chooses the client's tag. Raw GET/PUT records retain
origin, attempted identity, access, tag, failure and duplicate multiplicity.
The server reads each actual uploaded tarball's manifest without extracting
paths and checks its name, version, byte length and digest before recording it.
Requests are persisted before the HTTP response, so response receipt establishes
that the recorder has the request.

**Grammar and observations.** Fourteen histories select candidate
`1.0.0-rc.1.10` from the shared grammar. Stable, prior-RC, never-published and
already-current histories cross every possible failure phase. Prior-RC and
current metadata separately use an `rc` tag alone or an additional `latest`
alias. This distinction matters to actual npm's default metadata lookup.
Each failure history receives one controlled HTTP 400 and retries over retained
successful publications. Already-current versions have no injected publication
failure. Both attempts compare exact manifest/pre-state bytes before judging
raw failed attempts, fulfillment, packed identities, final publication bags
and registry state. Independent package order is permitted; duplicate or omitted
successes are not. A failed retry is recorded before comparison, so it cannot
escape as an unexamined command error.

Final measured reach: `registry-read` and `restored` each occur in all 14
histories; `controlled-failure`, `partial-publication` and `retry` each occur in
eight. Later `packed-upload` occurs ten times, `already-current` once and
`compared` eight times. The six intended RED histories stop at earlier violated
comparisons; they do not receive credit for unreached later states. Each passing
history enforces its own declared reach. Optional statistics report zeros on
RED histories too, while preserving the primary error if reporting fails.

**RED and neighboring results.** The focused HTTP command is:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 node node_modules/vitest/vitest.mjs run \
  --config scripts/oracle-scripts.vitest.config.mjs \
  scripts/publish-http-oracle.property.test.js
```

It has 11 passes (eight histories and three origin controls) and six assertion
failures. Three prior-RC histories with a `latest` alias fail the shared tag
comparison: candidates use `latest` (P01). Three RC-only/no-latest histories
fail the no-republication comparison: an already-current release, plus retries
after candidate failure from prior-RC and never-published starting states,
attempt to upload an existing RC and receive HTTP 409 (P05). Exact local byte
restoration is checked before those failures. No library repair GREEN is claimed.
The real receiving path expands the earlier shim's evidence; it does not make
the shim's RC-only metadata forms equivalent to actual npm lookup.

**Fixture repairs and calibration.** The receiver discovers installed tools,
isolates npm/Git configuration, uses fixture credentials and preserves HOME.
Its disposable workspace disables pnpm's automatic dependency installation and
supplies local links only for packing. An early pnpm probe attempted automatic
installation against the fixture registry and failed before Changesets; it is
a setup failure, not product evidence or a successful install. Initial loopback
and `ps` EPERM results are also setup failures; final local-only runs use the
necessary socket/owned-child access.

Owned process groups bound the command and include its descendants. Eight
ordinary controls check successful/timeout descendant termination, executable
startup failure, bounded output, primary and secondary termination errors,
callback Error/undefined preservation and unsupported routes. The output control
first failed because an exact 16 MiB boundary discarded later chunks and
reported timeout. An independent trace then exposed repeated group signals after
the first successful kill. Counting incoming bytes before truncation and making
termination one-shot repair these test-tool defects. Final eight controls pass;
three repeated formerly failing overflow probes also pass. The secondary-error
control first ran GREEN after a concurrent helper change; no original RED is
claimed for that subcase. The earlier misleading scratch filename
`chunk14-secondary-control-red.log` contains that GREEN result.

The shared publish checker adds only an optional expected registry argument;
its original fixed-origin default remains. All six existing checker controls
and three new default/variable/foreign-origin controls pass. The version model
is unchanged, so the 86 version/seed histories are not rerun for this parameter.
Raw observed origins are never normalized to the expected origin.

**Independent review and ORC outcome.** `facade_metadata_review` independently
executed the HTTP histories and fixture controls, challenged tool portability,
process ownership, response/record ordering, failure fidelity and raw duplicate
observation, then accepted the bounded instrument. ORC-001–006 have the policy,
shared independent ledger, finite grammar, actual client/server path, full raw
attempts and wrong-tag/duplicate/origin witnesses above. ORC-007 is inapplicable
to this finite enumeration. ORC-008–009 retain registry versions, tags and
partial success because retry distinguishes them. ORC-010 has the cleanup and
diagnostic controls. No further concrete shared-model fault invokes ORC-011.
This head-specific entry supplies ORC-012. ORC-013 has the RC-only/latest-alias
neighbor; ORC-014 receives metadata through actual clients; ORC-015 has local
measured reach. Under ORC-016, ordinary fixture controls remain separate.

Limits: four fixture packages, one candidate version, the installed tool
versions, POSIX process groups and controlled HTTP responses. Tarball dependency
closure, exports, installed consumer APIs, clean workspace installation,
production authentication and GitHub Actions remain separate O22/O25/O26 work.
No commit, push, installation workaround or generated-reference edit occurred.

Evidence directory: `/private/tmp/rc2171-oracle-challenge/`.
Final baseline/reach: `chunk14-http-baseline-final-r3.log`.
Independent HTTP: `chunk14-http-independent-final.log`.
Controls: `chunk14-http-fixture-controls-final-r2.log`,
`chunk14-http-fixture-independent-r3.log`,
`chunk14-output-bound-independent-r3.log`,
`chunk14-checker-calibrations-r1.log`.
Instrument REDs: `chunk14-fixture-process-controls-r1.log`,
`chunk14-output-bound-kill-trace.log`.
Final lint: `chunk14-lint-final-r4.log`.
SHA256 model:
`973e20a17d2faaafb2b459eab904008b85304a7722bdf92f1fb4dd86f8292759`;
HTTP owner:
`bc919160a72f3a6ce87c24f4a929ea113febec42fac78ae349df46e6e39cf10e`;
fixture:
`2390c87bacc10b4f948d58ec3724d01297bfb3f7d2587173f09eaa7f8c0d0dc7`;
registry:
`5847b68adc499871b4c6958fa204fd8dc124f6d554bc02ae388d2f739f010d95`;
runner:
`e804c8674a25f8ef18a937d79208e6e592ea0f3d78dc1f4fc908b7146c969618`;
ordinary controls:
`ac3062fa2b910c769bc3553bf7e9c72b779355c9f6f582f4a6b01c2fedd8cafe`.

### Work remaining after chunk 14

The HTTP release receiver above is now reviewed. Chunk 15 begins the transforming
schema/client-mutation receiving extension described after chunk 13. Effect
metadata, the pending O12 authority decision, actual UI/doc guidance, clean
workspace and packed consumers, calibrated source/artifact checks and final
exact-input validation/CI wiring remain. All library repairs stay deferred.

## Chunk 15: bound schemas govern client mutations (reviewed)

Frozen production head: `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
Independent reviewer: `handler_types_review`; author: `facade_lifecycle_review`.
No library production file changed. The schema guide's client-input contract
and the maintainer's identity-retention decision authorize this receiving law:
sync rows stay raw; same-identity renders retain schema/key behavior; query or
queryKey replacement applies the proposed behavior to the next mutation.

The shared `live-query-bound-options-oracle.ts` now models all nine ordered
absent/trim/uppercase schema pairs, two identity boundaries, independently
same/different key proposals and two padded lowercase inputs. Its word/ASCII
computation is independent of the fixture's String transformations. React live,
ready-source React Suspense and Preact live each execute 72 native histories.
Held updates compare immediate Collection reads, committed hook data/state and
handler original/modified/changes, followed by raw synced updates, identity
replacement and a further mutation. Ordinary own enumerable fields remain
observable; only four virtual metadata fields are removed from this judgment.

Independent GREEN: 216 native histories and 72 shared calibration tests pass.
The 72 calibrations reject 3,816 wrong observations and accept 648 permitted
unordered comparisons; those are checker evidence, not native histories.
All 2,592 path × history × cut reach cells execute exactly once. The twelve
cuts distinguish raw initial/source/followup input, held mutations, settlement
and replacement. DB, React and Preact typechecks and changed-file lint pass.

Review exposed two instrument defects. Loose equality admitted extra own
undefined fields; five independent rejection probes reproduced this before
strict equality repaired it. Omitting the final next-use mutation originally
left the whole run green because repeated reaches collapsed into earlier cuts.
Distinct followup-held/settled declarations now reject that omission, after
individual assertions pass. Read-only hostile overlays that preserve configured
schema references but bypass validation fail 192 immediate native value
comparisons, while 24 absent-schema controls pass. Corrupting initial or later
production sync inputs fails every native history at the raw-row comparison.
These are intended assertion/reach failures, not setup errors or timeouts.

ORC-001–005: authority, finite bounds, literate independent model, all native
receiving paths and value checkpoints are explicit. ORC-006: checker controls,
validator bypass, input corruption and omission attacks reject as above.
ORC-007 does not apply to this exhaustive finite grammar. ORC-008–009: binding
phase is model-only and identity replacement distinguishes retained options;
twelve observation cuts do not introduce a second production state machine.
ORC-010: cleanup preserves failures while releasing handler gates, transactions,
hosts and Collections; hostile runs exit without timeout. ORC-011: review found
no remaining concrete shared-semantic-fault hypothesis in this bounded model.
ORC-012: this frozen record supplies review evidence. ORC-013: all ordered
schema pairs, both identity boundaries and independent key proposals distinguish
wrong retention policies. ORC-014: the three real hook paths receive the same
model, without broader provider claims. ORC-015: all 2,592 cells have min=max=1;
live-only, Suspense-only and calibration-only selections each pass 72 tests,
while a partial entered-host selection fails mandatory lane reach.
ORC-016: native histories and generated calibration observations share the
model and refinement checks; no fixed expectations were added to oracle files.

Limits: valid synchronous schemas, flat scalar ordinary rows, explicit string
keys and mutations settled before identity replacement. Ready-source Suspense
does not establish initial suspended retry. There is no SSR, concurrent-render,
provider or typed-schema claim: the public schema option remains typed never.
Default-getKey absence, invalid/async schemas and mutations spanning replacement
remain outside this receiver. Passing bounded histories do not prove universal
production correctness or finish the campaign.

Evidence directory: `/private/tmp/rc2171-oracle-challenge/`.
Independent GREEN: `chunk15-react-independent-final-r1.log`,
`chunk15-preact-independent-final-r1.log`.
Author GREEN: `chunk15-react-final-r1.log`, `chunk15-preact-final-r1.log`.
Controls: `chunk15-react-schema-bypass-mutant-r1.log`,
`chunk15-preact-schema-bypass-mutant-r1.log`,
`chunk15-{react,preact}-{initial,later}-input-mutant-r1.log`,
`chunk15-omit-followup-mutant-before-r1.log`,
`chunk15-omit-followup-mutant-final-r2.log`.
Types: `chunk15-{db,react-db,preact-db}-types-final-r1.log`.
Lint: `chunk15-lint-changed-final-r1.log`.
Strict-undefined instrument RED/GREEN:
`chunk15-extra-undefined-calibration-r1.log` (five failed rejection checks),
`chunk15-extra-undefined-calibration-r2.log` (five pass).
Selectors: `chunk15-live-only-selection-final-r2.log`,
`chunk15-suspense-only-selection-final-r2.log`,
`chunk15-controls-only-selection-final-r2.log`,
`chunk15-partial-live-selection-final-r2.log`.
SHA256 shared model:
`c6b6da5fe6bbeb0d3d6dd8e389d2825468acc7aa94ecb1ece11fb741bf85952a`;
support:
`ed4bd6bb340d8d16d64914d500e14c597f28ef124ce0439cae6d606770b81e75`;
React:
`8d4707534b5962b8f249885b10104045869a86d9e86faf8c8e0ac289866b41c6`;
Preact:
`97c32b831caf5e7d4c6349197e356594fffee0c0b4cfc113a479717fe3a76f0c`.

### Work remaining after chunk 15

Effect metadata is the next edit chunk. Pending O12 authority, actual UI/doc
guidance, clean workspace and packed consumers, calibrated source/artifact
checks and exact-input validation/CI wiring remain. Library repairs stay
deferred until all oracle chunks are through independent review.

### Subsequent authority for O12

The maintainer answered the pending callback-input question on 2026-10-28:
strip reserved metadata fields from new projected subquery objects before
downstream `.fn.select()`; direct source rows keep metadata and inline include
values keep authored shape. The earlier pending references describe the state
at their recorded review. O12 can now proceed as the next chunk after Effect
metadata review. This decision changes no production file.

Pre-edit O12 inspection identified one narrower authority edge: structured
whole-row spreads have an existing source-owned attribution law, although they
construct an object. The maintainer has been asked whether that rule also
preserves metadata at callback entry. New-shape projections, direct source
returns and inline values have the decision above; spread-dependent assertions
remain pending that answer.

The maintainer subsequently chose preservation for structured whole-row source
spreads at callback entry. O12's authority is now complete: direct source rows
and structured whole-row spreads retain genuine source metadata; own-shape
projections lose reserved fields; inline values retain authored shape.

### Remaining receiving plans (read-only preparation)

These plans do not claim implemented coverage. Chunk 16 Effect metadata is
currently under construction and independent review. Its first LEFT-join run
exposed P09's phantom initial update; raw startup observations remain retained.
The revised driver will collect cut-labelled mismatches and continue through
the authored history, distinguishing exercised cuts from passing comparisons.
O12 callback-input work starts only after this chunk's review finishes.

During chunk 16 review, omitting the right-source remote-followup action from
both authored model and driver preserved every aggregate reach and the same
64 startup REDs. The independent read-only attack demonstrates a reach gap,
not another production bug. Side-specific followup/pending/acceptance/settlement
declarations and actual held-handler premises are being added before final
review. Evidence: `chunk16-before-side-reach-{baseline,omission}.log` under the
scratch directory. This is an in-progress note, not a reviewed-chunk verdict.

O21 is divided into actual mutation-fence receiving, diagnostic-specific snippet
baseline checks, and active/historical guidance checks. Its read-only baseline
is 802 snippets in 300 files, 252 known failures including 59 parse failures,
zero new failures. The successful unconfirmed POST reproduction still lives
only in scratch; the durable mutation owner currently supplies checker controls,
so a real fenced receiving driver remains necessary. Shared mutation judgment
must accept complete authored row shapes rather than force todo snippets into
the existing numeric id/name/stable fixture. Required confirmation derives from
the guidance obligation, never from whether a snippet calls refetch. P02/P04/
P06/P07 and candidate P08 remain under these checks. Authored guidance is not
repaired yet.

O20 mounts actual ListsScreen and its private ListCard through a controlled
ReactDOM/RN-primitive host. No native tooling is available. The old unsaved
screen probe establishes feasibility only and needs retained rerun evidence.
Reuse the source metadata and mutation judgment, deduplicate React runtimes,
and judge Saving after delivered delay callbacks without inventing an exact
200 ms product threshold. Include fulfilled/rejected, confirmed/unconfirmed,
early/delayed settlement, independent peers and next-use histories.

O22 stages a clean snapshot without node_modules/dist, attempts frozen offline
installation, then actual build graph and source typechecks. Missing cache is
a setup failure. Preserve the confirmed persisted-handler TS2769 and missing
Offline build-graph edge separately from unproven frozen-install failure; the
committed lock already links DB. Run the actual version CLI in staging only.
The proposed four release cuts (RC1, RC1.1, RC2, stable) receive all 25 public
tarball manifests/exports, 32 minimal installed Query/Offline runtime histories,
eight declaration consumers and strict positive/negative peer installations.
Installed consumers must resolve only disposable packed entries, with no source
alias or DB/adapter override standing in for peer admission. Existing workspace
installation and user lock/override state remain untouched.

O23–25 use calibrated, narrow source-maintenance/work checks and actual supported
artifact formats. Core's coded-error law does not imply zero plain errors in
all adapters. The census omits errors.ts, TSX and Svelte files, so an adapter
inventory needs explicit public classes and package-aware source enumeration.
Preact and Solid are ESM-only; Svelte has its distinct svelte-package output.
The current minified tool's db-ivm source alias cannot prove packed-artifact
reception. Fresh builds, fingerprints and bundle-input checks are required.

O26 joins all affected selections, per-path reach, exact source/build inputs and
CI entry points without duplicate script-owner execution. P03's standalone
recorder currently throws EISDIR before owner analysis in three of twelve real
RunDetails boundary cases. Planned test-infrastructure repair separates a
nonthrowing recording outcome from a caller wrapper that preserves owner
failure as primary and writer failure as secondary, failing on writer-only
failure. This is authorized routine harness design under ORC-010. An artificial
two-body it.fails experiment does not establish a legal-owner counterexample
and is not another confirmed defect. Guarded child-process witnesses remain
necessary. No library repair, commit, push or dependency workaround is part of
these read-only preparations.

Additional O26 instrumentation audit: chunk 16's finite owner initially
inherited createOracleReach's seed/path exemption despite having no replay
mode. With an unrelated seed, a partial single-source selection passed while
omitting required join/union lanes. Effect now declares its finite replay
policy explicitly; independent final verification is pending. The remaining
campaign finite owners are being inventoried read-only for the same class,
distinguishing actual direct replay from irrelevant seed inputs and wholly
unentered campaigns. Evidence before repair:
`chunk16-independent-replay-env-selector-before.log`. No library defect or
repair is inferred from this test-infrastructure failure.

## Chunk 16: explicit source metadata reaches Effect deltas (reviewed)

Production head remains `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
Author: `metadata_timeline_review`; independent reviewer:
`effect_metadata_review`. No library implementation changed.

VirtualRowProps/VirtualOrigin, public DeltaEvent/EffectConfig and the Effect
guide authorize the law: source metadata explicitly selected into ordinary
fields reaches both actual onBatch and named callbacks, with exact values,
previous values and multiplicity. No output Collection exists for an Effect;
this owner assigns no implicit root metadata or Collection ID. Event keys are
opaque: distinct active occurrences have distinct keys, updates retain the
active key, exit retires it, and reentry may choose a fresh key. Typed source
keys are independently compared through the ordinary observedKey field.

The independent model authors base rows, overlays, queued confirmations and
applied origins, recomputes projected rows and differences before/after arrays.
The small source judgment is shared with the existing root metadata owner;
output attribution remains separate. The finite grammar executes 200 native
histories: structured/functional selection, single source, LEFT join with both
matched and unmatched rows, and populated unions in both branch orders.
Confirmation masks, outcomes and two-source settlement orders vary independently.
Held writes, accepted-but-held confirmation, each settlement, remote followups,
peer exit/reentry, survivor next-use and final drain are compared. Both ledgers
preserve every event and copy scalar fields before later source changes.

Independent baseline at the final freeze: 64 initial LEFT-join assertion REDs
and 152 passes (136 native histories plus 16 controls). All 5,512 per-history ×
channel × applicable-cut reach cells execute exactly once. Of 2,756 combined
checkpoint comparisons, 2,692 pass; every mismatch is at initial delivery.
Each history collects cut-labelled errors and continues authored actions, so
the initial defect neither disappears nor prevents later evidence. P09 is the
actual startup update for a never-entered unmatched occurrence, after its load
settled. No class closure or product GREEN is claimed.

Review repaired four instrument gaps with prior executed evidence. Omitting a
right-source followup from both model and driver escaped aggregate reach;
per-lane side cuts now fail exactly the two missing channel cells. Checker-only
selection previously failed all native reach; wholly unentered native campaigns
now stand aside while partial entered selections still owe every lane. A new
nonempty-batch assertion rejected lawful empty partitions; it had no public
authority in this owner's unconstrained partition judgment, so it was removed
and replaced with permitted empty-partition controls. Finally, an unrelated
replay seed disabled finite reach: eight selected histories passed before the
explicit finite policy. They now fail for 5,376 missing cells, while seeded
checker-only selection passes all 16 controls. Invalid seed/path invocations
without required property selection were setup failures, not rejection evidence.

Five deliberately wrong production overlays change named dispatch, substitute
current for previous value, duplicate delayed events, collide active keys, or
add an own undefined field. Each adds intended comparison failures in all 200
native histories; all 16 controls pass. The joined baseline RED is distinguished
from the added mutant violations. Lawful opaque-key renaming, fresh reentry keys
and empty partitions preserve exactly the baseline result. No production file
was changed for these overlays. Existing root metadata coverage remains
1,604/1,604 GREEN after extraction; six ordinary regression/cleanup controls pass.
DB TypeScript and scoped ESLint exit zero; ESLint retains two existing
require-await warnings in the root owner.

ORC-001–006: sourced bounded law, independent recomputation, literate layers,
exhaustive legal grammar, actual callback receiving paths and calibrated wrong
observations/overlays. ORC-007 is inapplicable to finite enumeration. ORC-008:
settlement distinguishes base/overlay/confirmation/origin; no production queue
is reconstructed. ORC-009: source/public delta vocabulary and opaque active
intervals are explicit. ORC-010: cut and later driver errors remain aggregated;
copied ledgers and shared failure-preserving cleanup retain the first mismatch.
ORC-011: no further concrete shared-semantic-fault hypothesis remained in scope.
ORC-012: this frozen independent review record. ORC-013: confirmation/outcome
neighbors, typed 1/"1", both settlement orders and exit/reentry distinguish the
law. ORC-014: controlled eager core sources only, no real-provider claim.
ORC-015: all 5,512 cells reach once, source/partial/seeded selector attacks and
unentered controls above. ORC-016: generated histories and calibration observations
use the same independent judgment, without fixed product expected answers.

Limits: flat scalar projections, eager controlled sources, one persisting
mutation per source, and the named single/LEFT-join/populated-union paths.
No arbitrary provider scheduling, frameworks, ordered repair, same-source
overlap, callback-input sanitization or exact internal graph-run callback-count
claim follows. P09 stays open for the later production-repair phase.

Final evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk16-independent-baseline-final-r3.log`,
`chunk16-independent-reach-final-r3.json`,
`chunk16-independent-replay-env-selector-before.log`,
`chunk16-independent-replay-env-selector-after-r3.log`,
`chunk16-independent-replay-env-checker-r3.log`.
The `chunk16-independent-*-final-r2.log` overlays remain applicable: the only
later source difference is the explicit finite reach option/comment; model,
driver, recorder and comparisons are unchanged. Earlier gap evidence:
`chunk16-before-side-reach-{baseline,omission}.log`,
`chunk16-independent-checker-selector-before.log`,
`chunk16-independent-empty-partition-before.log`,
`chunk16-one-lane-omission-after.log`.
Author checks: `chunk16-{effect,eslint,typecheck}-final.log`,
`chunk16-root-extraction-r2.log`, `chunk16-ordinary-controls.log`.
SHA256 Effect owner:
`4b738962e30f2b0f55b1894bab1f76334da8d66e6001773bbe24599408bb6130`;
source judgment:
`d60c483456f6d222060976ebd10dd68ddbb9481c685f785f7a36e0c82ec1f80f`;
root owner:
`c925791e375f2f2a0941e0ab35b965cabe89570fb13a981b14826b874eaca98f`.

### Work remaining after chunk 16

O12's callback-input metadata law now has full maintainer authority and is the
next edit chunk. Actual guidance and example UI, clean installed/packed
consumers, source/work/artifact checks, final exact-input validation/CI wiring
and the broader finite-reach/P03 instrumentation work remain. The read-only
finite audit has already reconstructed the seed bypass in Preact; its wider
inventory belongs to O26, without erasing prior normal-run evidence. All
library production repairs remain deferred until every oracle chunk is through.

The read-only finite inventory is preserved in
`2026-10-28-pr-2171-finite-reach-inventory.md` with 19 source fingerprints:
28 default-policy sites need examination/repair; five other files have explicit
policies, including genuine release replay, and must not be sweep-changed.
Only Preact's irrelevant-seed bypass has an executed receiving witness so far;
the other rows are source inspection, not independently executed failures.
Exact-final-hash chunk 16 type/lint logs are
`chunk16-typecheck-final-r2.log` and `chunk16-eslint-final-r2.log`.

Read-only O21a refinement: parameterize the existing mutation judgment with
complete before/optimistic/confirmed/peer rows, retaining numeric defaults and
existing callers. Actual handlers use string todo IDs and text/completed or
product fields; no field-dropping projection into name/stable is acceptable.
The proposed receiving inventory is 18 fences, 30 current handler ASTs (21 Query,
nine Electric), plus three explicitly negative Before/WRONG examples. Three
collaborator outcomes and peer absence/presence give 186 histories (130 Query,
56 Electric); negative examples use only successful collaborators. This is
exact-handler reception through real adapters, not full schema/query/component
execution. It must retain the successful unconfirmed POST RED and rerun all
unchanged default adapter/ordered/post-handler evidence after generalization.

Independent pre-edit O21a review identified a necessary distinction: the old
reject-after-write histories reject after confirmation acceptance, while an API
collaborator can commit and reject before returning to its handler. The latter
never reaches the handler's later refetch/acknowledgement, so its settled
Collection may correctly retain the old base even though server data changed.
Confirmation intent and independently authored confirmation acceptance must be
separate. Preserve old default histories and the unconfirmed-success RED;
do not infer either promise from observed utility calls.

## Chunk 17: metadata is correct before functional callbacks (reviewed)

Production executable baseline: `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
Author: `metadata_types_review`; independent reviewer: `handler_types_review`.
Only narrow architecture contract prose changed under src; no executable
library repair, generated documentation, installation, commit or push occurred.

The two maintainer decisions authorize this law: direct source rows and
structured whole-row source spreads expose genuine metadata before downstream
fn.select, including when a source spread selects conflicting reserved names.
Own-shape projections, including functional new objects/spreads, expose none
of the four reserved fields. Nested inline values keep authored selected shape;
compiled Collection-valued inputs reject before callback invocation. The
architecture now states this boundary explicitly. Metadata's readable presence
and value matter; genuine source metadata's own-property layout is not promised.
Ordinary selected fields, including nested authored reserved names, retain
strict own shape and own undefined.

The small input model uses authored source facts and the shared source metadata
judgment, not compiler provenance. Thirty-three legal shape/collision
descriptions cross seven consumers and two actual compiler receivers: root and
correlated inline child, 462 histories. Two direct-source controls, 66 nested
array/materialized preservation histories and 33 Collection-input rejections
complete 563 native histories. Seventeen controls calibrate the same judgments.
Typed numeric/string peers, each-name/all/no collisions and both authored
pending booleans distinguish sanitizer shortcuts. QueryRefs reach depth two,
with one LEFT join and both populated union positions.

Actual callback inputs are copied before returning an ordinary observed value.
Every captured input must match one coherent authored before/after source row;
this permits legitimate retractions without accepting old/new field mixtures.
Startup joins may lack a side, but established public output is the strict
after-state. Initial readiness, held successful mutation, settlement and later
remote use all execute. Errors accumulate through those four cuts and are
thrown inside failure-preserving cleanup. Final publication cannot erase a bad
input already copied into an ordinary nested output.

Independent final result: 580 tests, 377 pass and 203 intended
MetadataCallbackOracleFailure REDs, all from correlated-child receivers.
Root's 231 histories, nested inline preservation, direct-source controls and
Collection rejection pass. P10's leaks/spoofing remain unfixed. All 1,856 callback
and 297 inline/rejection states reach their minimum once (2,153 total), including
later cuts after an earlier mismatch. Valid unrelated seed/path/property inputs
still run the full matrix. Seventeen checker controls pass with native campaigns
unentered; the two inherited-field controls pass independently. Selecting only
two native direct-source histories fails mandatory missing-matrix reach, with
or without unrelated seed configuration. An invalid unknown-property selection
was a setup error and is not counted as rejection evidence.

Review corrected a representation overconstraint before acceptance. Genuine
metadata need not be own; the checker now compares readable presence/value.
Nested authored inline fields are ordinary children data and remain strictly
compared. Two durable controls reject replacing an authored nested field or an
own undefined with inheritance. Independent scratch probes also reject mixed
before-label/current-pending facts and verify that an initial correlated-child
RED retains callback observations/reach at all four cuts. Illegal initial
correlation and mixed-key ordering fixtures were repaired as setup premises,
not claimed as product RED. Raw structured literal undefined remains a separate
P11 investigation, not an approved normalization or a law of this model.

Existing owners remain unchanged in behavior: root metadata 1,604 GREEN,
functional projection 125 GREEN, functional boundary 18 GREEN; Effect retains
152 passes/64 known P09 REDs. Whole DB test TypeScript, targeted ESLint and
changed-file lint pass; two pre-existing require-await warnings remain.

ORC-001–006: explicit decisions/architecture, independent authored facts,
literate layers, finite legal syntax/path grammar, real root/child callbacks,
ordinary derived outputs and 17 calibrated controls plus actual P10 REDs.
ORC-007 is inapplicable to bounded enumeration, with replaying:false explicit.
ORC-008: complete before/after facts distinguish retractions, without a second
queue model. ORC-009: callback input differs from published row; top-level
metadata descriptor freedom differs from nested authored shape. ORC-010:
all-cut reports and failure-preserving cleanup retain primary violations.
ORC-011: no further concrete shared-semantic-fault hypothesis remained.
ORC-012: this exact frozen record. ORC-013: individual/all/no collisions,
booleans, source/new/inline boundaries, typed peers and four cuts distinguish
the law. ORC-014: controlled core boundary only. ORC-015: all 2,153 states reach,
including valid seeded/unentered/partial selection controls. ORC-016: every
history/control uses the shared independent judgments, without fixed product
answers. This is instrument acceptance, not closure of P10's production class.

Limits: bounded syntax/key grammar, one held successful mutation, flat inline
children, QueryRef depth at most two and one LEFT join. Schemas, complex
descriptors/prototypes, greater depth, other joins, same-key overlapping
transactions, truncate and real provider/framework paths are outside it.

Evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk17-independent-final-full.{json,log}`,
`chunk17-independent-final-seed.log`,
`chunk17-independent-final-controls.log`,
`chunk17-independent-final-unentered.log`,
`chunk17-independent-final-partial-seed.log`,
`chunk17-independent-controls.{test.ts,log}`.
Pre-delta no-seed selector: `chunk17-independent-partial-selection.log`.
Author current checks: `chunk17-final-delta-{full,lint,types,lint-changed}.log`.
SHA256 model:
`8ed276ebe90b678ad94ccfa83fbd76b3c0d0cbcb6e3397ffce7bd4ff6de76d1c`;
driver:
`330d7e0084af2848aed36829f5194c000e224be72141b71a35d0971cf847d84d`;
runner:
`817e7d63c4d560b511727f92434f2a176ba32342fd40d78adecf84a5d410d7a7`;
shared grammar:
`301154bdaa1fe42fbd9b0f668947bac3a54f7cdb33a83cd4df7579a9f12c16c1`;
source judgment:
`d60c483456f6d222060976ebd10dd68ddbb9481c685f785f7a36e0c82ec1f80f`;
architecture contract:
`fdfa5e2adef393dfd0818d2847ce1af22d231ff513fdaa07a0c34802e3a84ecb`.

### Work remaining after chunk 17

Actual mutation guidance reception (O21a) is next. P11 literal semantics has
read-only evidence and needs owner/law scope and its own oracle work. Actual
example UI, diagnostic/guidance consistency, clean installed/packed consumers,
source/work/artifact checks and final finite-reach/P03/input-manifest/CI work
remain. P09, P10 and every earlier production RED stay deferred for the later
repair phase.

## Chunk 18: actual authored mutation handlers (reviewed)

Executable production baseline remains `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
Author: `handler_compiler_review`; independent reviewer: `mutation_electric_review`.
No library, guidance, generated-documentation, dependency or lockfile repair,
commit or push occurred. The first pnpm exec attempted automatic dependency
verification and aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
Subsequent commands use installed Node entry points directly. Initial combined
runtime/typecheck rootDir errors are setup evidence, not product failures.

Law: recommended successful handlers explicitly confirm their server changes
before settlement. Legacy returned values coordinate nothing. Authority is the
maintainer's explicit-confirmation decision, the optimistic acceptance/settlement
owner and the current After/CORRECT guidance. An API can commit and reject before
its handler reaches confirmation; that transaction may correctly settle on old
Collection base. Later explicit confirmation exposes committed server data
without changing the captured settlement-waiter rows. Resolved HTTP failure
differs from transport rejection. Its independently specified Error kind/message
is checked before comparing actual handler and transaction rejection identity.

The shared mutation model now accepts complete authored rows while preserving
all original defaults. `confirmationEntry: unreachable` distinguishes API
rejection before acknowledgement from the old rejection-after-acceptance lane.
The new documentation owner supplies a separate actual-handler Promise judgment.
Expected values never come from observed utility calls or Collection output.
Strict ordinary rows preserve Dates and own undefined; metadata remains with its
own owner. API request operands are checked and used to construct the controlled
server ledger, rather than installing expected rows irrespective of the request.

Eighteen actual fences supply 30 current handlers (21 Query, nine Electric) and
three explicit Before/WRONG examples. Current handlers cross success, rejection
before write and rejection after server write, with absent/present peer. Four
additional fetch histories resolve HTTP 503 before/after server commit with both
peer states. This is 190 bounded histories: 134 Query and 56 Electric. Only exact
initializer ASTs execute. Real QueryClient/Query and Electric adapters receive
controlled backend/SDK collaborators. Source delivery and actual utility
acceptance are separately held and observed; no missing confirmation is supplied.

Independent frozen baseline: Query 132 PASS and two intended G01 settled-row REDs;
Electric 56 PASS; 43 shared/checker/ordinary support controls PASS. Query reaches
134 handler entries/API requests/settlement waiters, 90 server writes, 40 of 42
required acceptances, 32 of 34 required source holds and 48 later confirmations.
G01's missing acknowledgement stages/comparisons remain zero and separately fail
reach; declared intent earns no execution credit. Electric reaches 56 entries/API
requests/waiters, 38 writes, 18 acceptances/holds and 20 later confirmations.
The frozen waiter is checked again after later source confirmation. Default
receivers still pass: Query 78 mutation plus six post-handler histories and three
controls (87), Electric 42, ordered refetch 24 histories plus three controls (27).

Independent review found and repaired an instrumentation false green. An exit
gate kept the transaction pending after the actual handler returned. In-memory
transpile overlays removed exactly one actual refetch or awaitTxId await; both
wrong handlers passed at the initial freeze with all selected reach satisfied.
R3 removes that return gate and observes the actual extracted handler Promise.
A Node event-loop turn drains runnable continuations while real source delivery
remains held. Only the accepted asynchronous utility return is held for its
accepted-before-handler-return cut. Identical omitted-await overlays now fail
at `confirmation-requested: actual documented handler Promise`, without timeout.
Removing the HTTP status guard fails its independent handler-outcome comparison.
Removing await from already accepted synchronous writeUpsert and writeBatch
neighbors remains permitted and passes. Await spelling is not itself a law.

Review also demonstrated an overbroad seed rejection: a valid shared seed failed
before any native handler ran. R3 follows the shared configuration contract:
seed 42 preserves full outcomes/reach, an own finite case plus seed 1 passes,
and unrelated actual path replay skips all 134/56 cases. A partial native
`mutations-after` selection runs six passing cases and skips 128, then fails
missing declared reach equally with seed unset or 42. Exact finite selection uses
`TANSTACK_DB_DOCUMENTED_MUTATION_CASE`; G01 replay preserves its settled mismatch.
Own selector reduction and unrelated shared seeds are separate policies.

Direct bounded TypeScript, targeted ESLint and changed-file lint pass. Runtime
commands use the installed Vitest entry from each package, with coverage and
typecheck disabled; typechecking is a separate command. This does not claim
whole-workspace type correctness. The independent reviewer checked all seven
frozen SHA256 values before and after its native, selector, original-owner and
overlay executions, and found no further supported instrument defect.

ORC-001–006: explicit authority, independent shared outcome/handler judgments,
literate layers, bounded exact-handler grammar, real adapter cuts, full rows and
executed hostile controls. ORC-007: randomized campaigns are inapplicable to this
finite enumeration; own direct replay is verified. ORC-008–009: API commit,
confirmation entry/acceptance, handler settlement and transaction settlement are
independently distinguishable. ORC-010: exact errors, frozen waiter rows and
failure-preserving all-resource cleanup. ORC-011: no further concrete shared
semantic hypothesis requiring a second formulation remains after the direct
handler observation repair; no universal independence claim follows. ORC-012:
this versioned frozen entry. ORC-013: genuine holds reject detached confirmation,
while synchronous accepted-write neighbors remain lawful. ORC-014: no real
provider/host handoff is claimed beyond the controlled boundary. ORC-015: actual
per-case stages and comparison counts above, including G01's unreached stages.
ORC-016: fixed histories use the shared judgment; extraction/request/selector
examples remain in ordinary support tests. This is instrument acceptance,
not a full GREEN, readiness or production bug-class closure claim.

Limits: selected initializer ASTs, one edited key and optional peer. Full
factories, schemas, query/component execution, awaitMatch/timeout guidance,
concurrent handlers, persistence wrappers, durable direct-write receipt holding,
live Electric/backend providers and framework scheduler cuts remain outside it.
G01 stays open for the later repair phase.

Evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk18-author-evidence-r3.md`, `chunk18-freeze-r3-sha256.json`,
`chunk18-{query,electric,controls}-independent-r3.log`,
`chunk18-original-{query-owners,electric-owner}-r3.log`,
`chunk18-ordered-owner-r3.log`, `chunk18-unawaited-{query,electric}-before-r2.log`,
`chunk18-unawaited-{query,electric}-r3.log`, `chunk18-http-status-guard-r3.log`,
`chunk18-write-{upsert,batch}-neighbor-r3.log`, `chunk18-seed-before-query.log`,
`chunk18-partial-query-{no-seed,seed}-r3.log`,
`chunk18-{query,electric}-seed-r3.log`,
`chunk18-{query,electric}-unrelated-path-r3.log`,
`chunk18-{typecheck,eslint,lint-changed}-r3.log`.
Frozen file hashes:

- Shared mutation model: `a521be9b638934556542837670261c1cb0eee0eae44c9912968c1add40a14e8d`.
- Documentation owner: `478405dd2af4964da9c3981caa5ddaba6e792e2151c2c1c9faf6e03e53c6f0d2`.
- Support driver: `d35aad2629ef81d9f8ccec7226e33e85be08df00119bf838714a2d3a0bc826d7`.
- Documentation controls: `450e51629ce8a885211dd35c4c1941d5e3585864053b405bf3bdc2d08254bf65`.
- Ordinary support tests: `8a7778c86642d10e0fa74382b859e42ad2dd7191c52ea34624937ef95c00a85e`.
- Query receiver: `86092d4b33c4640a78fe5e385ad9afcffb4fb9af9d5cc8fc66957ab2c78fbdc3`.
- Electric receiver: `72ced5986b32722b9bdb2a891bd634d0e7bb8d064e72474c37aa275ba5039dbe`.

### Work remaining after chunk 18

P11 now has separately supported runtime literal-preservation and public type
inference findings. Its next three review gates are shared root/QueryRef runtime,
same-model correlated inline array/singleton/facade receivers, and exact public
type receivers. Current rejection of a broader mixed-expression array is an
unresolved admission question, not authority that the input is invalid. Types
judge required keys; runtime judges own properties. The corrected pre-edit
inventory and evidence manifest are retained in scratch. Actual example UI,
diagnostic/guidance consistency, clean installed/packed consumers, source/work/
artifact checks and O26 finite-reach/P03/input-manifest/CI work remain. Every
library and guidance repair remains deferred until all oracle chunks finish.

## Chunk 19: selected literal values at root and QueryRef boundaries

Accepted after independent oracle review at unchanged production HEAD
`858b174a65f160d13d01f0324c7481cc8e4eba3a`. The final R2 freeze changes three
files: the shared literal model, its production driver, and the existing
`subquery-user-value-oracle.test.ts` registration owner. The independent reviewer
found one conformance defect: the companion module lacked its own declaration.
R2 adds only that declaration and its import. Removing those additions
reconstructs the exact R1 hash; both evidence sets remain available.

Law and authority: selected null and undefined pass through, and recursive
authored records preserve their selected members, including empty records.
The public builder descriptions at `builder/types.ts:402–437`, plus the
architecture's user-value and publication laws, supply this authority.
Ordinary JavaScript interprets test-only data/reference descriptions. The model
imports no production IR or semantic classifier. Virtual-field attribution and
public type accuracy remain separate judgments.

Before edits, 48 exact emitted public query forms compiled without diagnostics.
Nested omission then exposed empty-record loss. Five adjacent forms were
predicted from the same recursive-record law before their addition; their
20 exact translations also compiled without diagnostics. The expanded grammar
has 17 forms, two property positions and two receivers: 68 histories, each
observed at initial readiness and two synchronous full-row source commits.

RED on unchanged production: **103 tests, 85 pass and 18 fail**. The new
histories contribute 50 passes and 18 intended assertion failures: eight P11
undefined-to-null cases and ten P12 empty-container-loss cases. The other
passing tests are six existing relational histories, 24 hostile controls,
four lawful controls and one grammar calibration. An independent one-row
P12 witness selects only id/version references and `value: {}`; no raw nullish
member is needed to expose the missing selected property.

Reach: all **204 receiving states and 102 QueryRef callback states** execute
exactly once. Root independently verified frozen hashes, reran the native owner
and recomputed these counts. Eager tagged captures retain own undefined,
absence, null, dense array indices/length, complete ordinary rows, event
type/key/current/previous values, event-time public reads and callback inputs.
All lawful later cuts are recorded before judgment, so initial REDs do not
erase subsequent evidence. Cleanup diagnostics remain distinct.

The shared comparison rejects 24 wrong observations, including container loss,
wrong or duplicate changes, stale previous values, mixed callback inputs and
missing current callback inputs. Four positive controls preserve legal event
partition, change ordering, repeated callbacks and empty startup callbacks.
Independent scratch controls additionally verify immutable nested capture,
root-only metadata exclusion and continuation through all cuts of an actual
failing QueryRef history. Partial native selection still fails missing reach
with a valid unrelated shared seed/path; calibration-only selection passes.

Strict compilation of the actual three-file authored program has zero
diagnostics. It proves driver admission, not public inferred-type correctness.
Targeted ESLint, formatting and scoped diff checks pass. R1 and R2 changed-file
lint both pass. The final R2 hashes were verified again after lint.

ORC-001–006: authority, independent judgment, literate responsibilities,
finite legal grammar, actual public receivers and executed negative/positive
controls are evidenced above. ORC-007 does not apply to exhaustive finite
enumeration; selection/reach behavior is checked. ORC-008–009: stateless
before/after recomputation and explicitly mapped expression descriptions avoid
duplicated lifecycle machinery. ORC-010: eager capture, continued lawful cuts
and separate cleanup diagnostics; cleanup-fault injection remains unclaimed.
ORC-011: no concrete remaining shared-semantic hypothesis requires another
formulation. ORC-012: this exact R2 versioned entry and the independent audit.
ORC-013: undefined/null/omission, raw/explicit/reference, pure/mixed and
empty/nonempty neighbors distinguish the wrong rules. ORC-014: the claim ends
at controlled core sync sources. ORC-015: all 306 declared states execute and
partial campaigns fail. ORC-016: every history and calibration uses the same
model/check; there are no standalone concrete type assertions.

Limits: dense finite arrays, bounded records and two source updates. Correlated
arrays/singletons/facades and generated public-type receivers remain separate
sequential gates. Sparse authored arrays, symbols, descriptor flags, arbitrary
recursion, cleanup/restart, provider/framework scheduling and broad mixed
raw-nullish/IR.Value admission are unproved. The latter admission question is
not an invalid-input exclusion. All product REDs remain open; this accepts an
instrument, not a production repair, GREEN result or PR readiness claim.

Evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk19-freeze-manifest.json`, `chunk19-r2-freeze-manifest.json`,
`chunk19-freeze-evidence.md`, `chunk19-reproduction-commands.md`,
`chunk19-typecheck.mjs`, `chunk19-root-native.log`,
`chunk19-independent-r2-{native,types,controls,partial-seed}.log`,
`chunk19-emitted-types-preedit.log`, `chunk19-empty-container-types-preedit.log`,
`chunk19-minimal-empty-record-red.log`, `chunk19-r1-r2-model.diff`.
Final frozen file hashes:

- Model: `898ef5e00aec151cbb9367dc1f8b0fe5f488b02e75f57f504dc8224b9dbdc5b6`.
- Driver: `4afcf5213153c285ba9e917fffd6e44c816bf0953bdd872aced065a087e865d9`.
- Registration owner: `3cb39cfb878b7bbd8682838cc1958c70dc36536c2ea0de200f2952ba18f44ebf`.

### Work remaining after chunk 19

Next are same-model correlated inline array/singleton/facade receivers, followed
by exact public-type receivers. The actual example UI, guidance/diagnostic
consistency, clean installed/packed consumers, source/work/artifact checks and
O26 finite-reach/P03/input-manifest/CI work remain. Source-inspected P13/P14
guidance conflicts join that inventory. Library and guidance repairs remain
deferred until all oracle chunks finish.

## Chunk 20: correlated literal receiving paths

Accepted after independent oracle review at unchanged production HEAD
`858b174a65f160d13d01f0324c7481cc8e4eba3a`. Freeze manifest SHA256:
`df44856c6d4772f3af501cfb4a0abc82e40cc1e8605a721852a3fe2787de097b`.
Four new test modules supply the materialization judgment, concrete factories,
production driver and campaign. The fifth frozen input is DB's package manifest,
which registers the new campaign once and preserves earlier registrations.
Accepted chunk 19 files remain unchanged.

The same ordinary-JavaScript literal model now receives 17 forms × two selected
positions × direct/QueryRef child composition × four public materializers:
`toArray`, array `materialize`, singleton `materialize`, and Collection-valued
`include`. Architecture's nested-materialization/publication laws add ordered
children, canonical empty values and coherent Collection-facade observations.
Two parents share a populated bucket, a third has an empty bucket, and two
atomic full-row child updates reuse the literal source states. The existing
facade interval judgment checks handle identity; it is not reimplemented here.

Exact public queries compiled before receiver edits. The first native run
rejected 136 QueryRef constructions before comparison: their outer child had
no correlation WHERE. Public live-query guidance at lines 1307–1323 requires
the child query's own WHERE to contain the parent/child equality. This is missing
premise evidence, not a literal-law RED. The revised legal query explicitly
selects `routeGroup`, correlates it in the outer WHERE, captures that complete
authored callback input and removes only that field in the actual returned
JavaScript object. No recorder normalization hides it. Every revised exact form,
including a later lexical rename to satisfy lint, compiled before factory edits.

Native result: **305 tests, 233 pass and 72 intended assertion REDs**. The 272
main histories supply 200 passes and 72 failures exposing the same P11/P12
literal defects through all four materializers and both child compositions.
All **3,264 declared path × cut states** execute exactly once, including public
rows, root events, legal functional inputs and facade events/identity/empty
readiness. No driver-execution failures remain. Independent native and unrelated
seed-123 runs match. Root separately verifies all five hashes and reproduces
the 72/233 result and 272 distinct main titles.

Every observation retains complete ordinary rows, ordered inline values and
facade layouts, event type/key/current/previous values, callback-time root and
facade snapshots, authored callback inputs and retained inline values. Facade
handles in old parent payloads remain live; inline snapshots remain immutable.
All lawful later cuts run before judgment, preserving the first mismatch and
distinct execution/cleanup diagnostics. No compiled Collection-valued include
enters a parent functional callback.

Review repaired three instrumentation boundaries. Facade rows and event-time
layouts now use ordered comparison, so bag equality cannot hide reversal.
Startup callback inputs may have the canonical empty child value before the
initial snapshot arrives; each complete current parent must still be consumed
by readiness. This prospective correction follows the architecture, with old
and new predictions recorded before editing; the native run already passed
that facet. After readiness, atomic before/after comparisons remain strict.
One initial startup calibration mutated an aliased public array. Those runs are
preserved but excluded from RED evidence; the corrected isolated callback
control rejects three inputs under the copied old checker and passes under the
corrected law. Wrong partial/mixed startup inputs still fail.

Vitest's formatted table labels also truncated distinct cells into duplicate
names: the first JSON has 272 main histories but 221 unique names. Literal
titles now preserve all 272 IDs. Exact failing and benign selectors each enter
one intended cell; even a passing selected cell fails mandatory missing-matrix
reach. Calibration-only selections enter no campaign, and unrelated seeds do
not waive reach. O26 separately inventories similar title-identification gaps
in older accepted campaigns without retracting their normal reach evidence.

All **29 hostile wrong-observation controls and four lawful controls** pass.
These are checker calibrations, not production mutants. Six independent
scratch controls isolate facade layout, previous event values, startup callback
freedom, complete ready inputs, mixed/routing-field corruption and continuation
of an actual failing singleton. They verify intended violation names and
unchanged unrelated public facets. The reviewer source-audited all shipped
attacks for calibration alias leakage. Strict authored-program TypeScript
compilation has zero diagnostics; targeted lint, formatting and scoped diff
checks pass. The existing installed-dependency mismatch remains unchanged.

ORC-001–006: public authority, independent literal/materialization judgment,
literate responsibilities, exact legal grammar, actual receiving paths and
isolated negative/positive controls. ORC-007 is inapplicable to exhaustive
finite syntax; exact selection/reach is verified. ORC-008: stateless
recomputation plus the existing facade interval model. ORC-009: explicit
data-description and routing-field mappings. ORC-010: eager captures, all-cut
continuation and distinct cleanup diagnostics; cleanup-fault injection remains
unclaimed. ORC-011: no concrete remaining shared-semantic hypothesis requires a
second formulation. ORC-012: this exact frozen record and independent audit.
ORC-013: empty/full, ordered/reversed, literal/carrier and startup/ready neighbors
distinguish the wrong rules. ORC-014: controlled eager sources only. ORC-015:
all 3,264 states execute once and partial selections fail. ORC-016: all histories
and calibrations use shared judgments, without standalone expected product rows.

Limits: finite dense values, fixed routes, eager controlled sources and two
atomic child updates. Providers, framework schedules, arbitrary recursion,
descriptors, metadata attribution, optimistic histories and route churn remain
outside this slice. Public inferred-type accuracy is the next gate. All 72
production REDs remain open; instrument acceptance is not a GREEN repair or
PR readiness claim.

Evidence under `/private/tmp/rc2171-oracle-challenge/`: `chunk20-freeze.json`,
`chunk20-preedit{,-v2,-v3}-inventory.json`, `chunk20-native-first.{log,json}`,
`chunk20-native-final.{log,json}`, `chunk20-root-native.{log,json}`,
`chunk20-independent-*`, `chunk20-exact-selection.{log,json}`,
`chunk20-unrelated-seed.log`, `chunk20-startup-prediction-before.json`,
`chunk20-startup-control-{before,after}.log`, retained
`chunk20-startup-control-aliased-{before,after}.log`,
`chunk20-root-title-collision-before.json`, `chunk20-root-order-control-after.log`,
`chunk20-runner-registration.diff`, and `chunk20-types-final.log`.
Frozen artifact hashes:

- Model: `87b11a0f33f7d6da215470c0a1e2d331484463735a8e974698e5d95ca9bf954d`.
- Factories: `c0dc046789b30179a43d3e7bb9405b232709a47611e7c214826e14ac4d60ca70`.
- Driver: `36dacf502763f264a57e9e3e7c4d9a241c450437e2d13088b8c135a9d8cc0b86`.
- Campaign: `17c701f2c31bfa74888777e817e5357d87b16413228c8ebc30adc3fac3153f7c`.
- Package input: `8838fe02c99c58b51535823e3f3e565fa61e2a2433d89d239dde7636ae8ffb57`.

### Work remaining after chunk 20

Next is the generated public-type slice for the exact accepted standalone and
correlated syntax. Actual example UI, diagnostics/guidance consistency,
P14's swallowed source-health call outcome, clean installed/packed consumers,
source/work/artifact checks, and O26 finite-reach/replay/input-manifest/CI work
remain. The O21 plan preserves historical diagnostic-baseline reconstruction:
today's errors cannot be automatically adopted through old file/hash waivers.
Library and guidance repairs remain deferred until all oracle chunks finish.


## Chunk 21: exact source-public literal type receivers

Authored and frozen for independent review at unchanged executable-library HEAD
`858b174a65f160d13d01f0324c7481cc8e4eba3a`. This entry does not claim independent
acceptance. Three new test files supply an independent recursive type law,
compiler/source driver and finite campaign. Accepted chunk 19/20 runtime inputs
and DB's package manifest remain unchanged.

**Law and authority.** The public `ResultTypeFromSelect` documentation at
`builder/types.ts:402–437` promises exact null/undefined, extracted reference
values and recursive selected records. The live-query guide's select and virtual
properties sections distinguish selected ordinary values from the separate
public-output virtual layer. Architecture's nested-materialization and callback
input laws supply array, absent singleton, Collection and strict own-shape
callback boundaries. The model imports authored history descriptions, with no
production conditional-type, IR-classifier or projection helper. Primitive
literal widening remains permitted within its kind; `{}` means an empty
declared static surface, not an exact empty runtime inhabitant set.

**Paths and reach.** The campaign extracts the accepted runtime AST expressions
into 68 standalone and 272 correlated concrete modules. Query syntax is guarded
against semantic drift. Actual callback inputs are marked before the real
consume call and routing-field destructuring. Each module receives actual
QueryResult and inferred Collection-row types; correlated paths add child,
inline/singleton or public facade/get/toArray/downstream markers. There are
1,870 marker judgments and 2,550 declared syntax/admission/marker states.
TypeScript 5.9.3 compiles every source without diagnostics against this
checkout's public `src/index.ts`; strict null checks are enabled. All 2,550
states execute exactly once. All 387 test names and 340 native IDs are unique.
The exact 340 sources and their fingerprints are retained in scratch evidence.

**RED.** The corrected native run and unrelated seed-1 run agree: 387 tests,
107 passes and 280 intended assertion failures. Of 340 native histories,
60 pass and 280 fail. Forty histories infer raw null/undefined as unknown;
272 expose forbidden contextual-input metadata or its propagation into nested
inline values, with 32 overlapping. No other native mismatch category remains.
Every marker comparison executes before the history reports its mismatches.
These are pre-repair observations; no production change is included.

**Formulation correction.** The initial admission-clean run judged public
QueryResult roots too strictly. Before editing that model, a retained authority
note recorded old/new predictions and followed the guide's public-output
promise to its source. Root and the independent reviewer approved the bounded
correction before editing: exclude exactly four virtual fields at named public
query-output and actual published/source Collection row roots from this
ordinary-value judgment. Callback inputs and nested inline shapes remain
strict. Ordinary `routeGroup` is required on the actual routed input and omitted
only by the authored rest destructuring. Raw-nullish unknown remains RED. No
metadata correctness follows from the separate-layer exclusion. Full static
callback metadata coverage belongs to existing
`virtual-row-fields-types-oracle.test.ts`; this slice adds receiving evidence
for that accepted law, rather than changing product policy.

**Controls and selection.** All 47 controls pass: 34 compiler-recorded wrong
static observations, eight AST/actual-marker-binding attacks, two lawful
formatting freedoms and three native marker-isolation controls. Wrong answers
include any/unknown/never, lost nullish alternatives, optional selected members,
wrong containers/array mutability, facade/get loss, routing-field corruption and
reserved-name leakage at strict inputs/inline children. These are checker
calibrations, not production mutants. Checker-only selection passes 47 tests
and leaves native reach unentered. Selecting the positive standalone zero cell
passes its actual comparison but fails the mandatory missing-matrix reach,
even with an unrelated shared seed; 386 tests are skipped. Exhaustive finite
syntax has no seed replay waiver.

**Setup failures kept separate.** The first exported synthetic receiver hit
TS4058 declaration portability before any intended law comparison. The current
source-public inference module has an unexported synthetic wrapper; native
query inference is unchanged. This repairs the test path but does not establish
that exported inferred factories are unsupported. The exact repro and a
handoff preserve exported factory, exported Collection, explicit declaration
settings, and source versus built/installed controls for O22. An early AST
printer also treated trailing commas as drift; semantic canonicalization now
permits formatting while preserving ordered node kinds, names and children.
Neither setup failure is counted as intended product RED.

**ORC review.** ORC-001–006: independent authority-derived recursive judgment,
literate responsibilities, exact legal inputs, actual compiler receivers,
per-marker observations and executed wrong-result controls are recorded above.
ORC-004 reconstruction/ablation/range: 17 accepted forms cross root/nested
positions, direct/QueryRef and all four correlated materializers. Removing each
axis loses its matching callback/container obligation. AST controls reject
nearby cast, carrier, routing and marker substitutions. ORC-007 is inapplicable
to finite exhaustive syntax; selection/reach remains enforced. ORC-008–009:
stateless static surfaces, explicit separate virtual-layer and authored
routing-field abstractions, with no lifecycle state model. ORC-010: compiler
diagnostics retain file/span/code and remain separate from all type judgments;
no runtime cleanup or shrink path is involved. ORC-011: direct public compiler
facts avoid DB helper-alias self-agreement; no remaining concrete shared-semantic
hypothesis requires another model in this slice. ORC-012: this frozen entry and
the pending independent audit. ORC-013: exact nullish/omission, required/optional,
raw/explicit/reference, mutable/readonly/tuple and facade/inline neighbors reject
wrong boundaries. ORC-014: actual installed TypeScript source-public compiler,
with packed/npm receiving work explicitly deferred. ORC-015: every declared
state reaches once; a partial native selection fails. ORC-016: all native and
calibration judgments reuse the recursive type law, with no standalone
concrete type assertions.

**Limits.** This checks selected declared value surfaces, property optionality,
nullish alternatives and array mutability, not ordinary-record readonly
modifiers or metadata correctness at excluded output roots. Empty-array element
precision is unclaimed beyond no any. Broader mixed raw-nullish/IR.Value array
admission remains unresolved; no rejected form is silently blessed. Runtime
publication, provider/framework scheduling, arbitrary recursion and packed
exports are separate owners. The 280 product REDs remain open. Production
repair, GREEN result, production-mutant kill and PR readiness are unclaimed.

Evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk21-native-r3.{json,log}`, `chunk21-native-seed.{json,log}`,
`chunk21-corrected-marker-failures.json`, `chunk21-{compiler,reach}.json`,
`chunk21-controls-only.{json,log}`, `chunk21-partial.{json,log}`,
`chunk21-consumer-inventory.json` and `chunk21-consumers/`,
`chunk21-output-vs-input-authority.md`,
`chunk21-exported-receiver-{repro.mts,o22-handoff.md}`,
`chunk21-metadata-type-owner-next-plan.md`, `chunk21-types-r3.log` and
`chunk21-eslint-r2.log`. The final freeze manifest records source and evidence
hashes after formatting and changed-file lint.


### Chunk 21 R2: declared record capabilities

Independent frozen review reproduced the original native/seed/reach evidence
and found a recorder defect. A callable or constructable record with no named
members was recorded as an empty record. The model therefore accepted an
inferred `value: () => void` or `value: new () => {}` for authored `value: {}`.
This concerns declared static capabilities, not the empty-record inhabitant
limit: the wrong type permits invocation that the selected object does not.

The original manifest, logs and exact three source files are preserved in
`chunk21-freeze.json` and `chunk21-r1-source/`. Before changing the recorder or
comparison, eight calibration histories add call/construct signatures to the
existing empty/nonempty selected record forms at existing root/nested positions.
All eight fail because the old shared judgment returns zero violations; lawful
companions admit. R2 records call/construct presence with public TypeScript APIs
and rejects invented signatures in the existing recursive record rule.

The R2 native campaign has **395 tests, 115 passes and the same 280 intended
native REDs**; its failed native test-name set exactly matches R1. All 340
consumers still admit without diagnostics, all 2,550 states execute once and
all 395 titles are unique. All **55 controls** pass, including 42 compiler
recorder controls. Package TypeScript compilation and targeted ESLint pass.
This repairs an instrument only. It changes no product behavior or expected
native law, and supplies no production GREEN or closure claim. The R1
partial-selection and unrelated-seed evidence remains unchanged.

R2 evidence uses the same scratch directory: `chunk21-r2-signatures-red.*`,
`chunk21-r2-native.*`, `chunk21-r2-{compiler,reach}.json`,
`chunk21-r2-{types,eslint}.log`, and `chunk21-r2-freeze.json`. Independent R2
acceptance remains pending. All prior limits and deferred owners still apply.

Independent R2 review accepted the bounded instrument at the exact frozen
sources. Owned files, accepted inputs and preserved R1 snapshots match their
hashes. The independent native run reproduces 395 tests: 115 pass and the same
280 native assertion REDs, with all 2,550 states once and 395 unique titles.
Twenty independent compiler/AST controls pass, including both original erased
signature witnesses. Strict three-file authored-program typechecking has zero
diagnostics. The eight retained pre-repair controls demonstrate the old
checker failed at its intended comparison. Independent evidence:
`chunk21-independent-r2-native.{log,json}`,
`chunk21-independent-r2-controls.log` and
`chunk21-independent-r2-typecheck.log`. R1 full-seed, checker-only and partial
selection evidence remains preserved. No supported finding remains within this
bounded slice; native product REDs and all stated limits remain open. Final R2
freeze manifest SHA256:
`da237233542b78a0de9eb836ecbeed12b6b14c2e80f91837eb577c8813bcf0a7`.

## Chunk 22: publication eligibility without dist-tags

Accepted at merged HEAD `5fa6eca05530bb9e1f4748b7c00ae60976da2808` with the
publisher unchanged. The independent release ledger still defines eligibility
by exact registry-version membership. Candidate uploads use rc and stable
uploads use latest; partial successful uploads survive retry. Missing tags do
not permit another upload. Repairing historical wrong tags is unclaimed.

The existing HTTP receiver retains all 14 histories and adds 15. New histories
cross absent/stale tags with present/missing exact versions, reversed
heterogeneous candidate versions and mixed current/missing packages. Later
candidate failure occurs only after observing an actual successful candidate
upload, independent of package order. Independent review added the exact P01
aftermath (older rc / current latest) and stable current versions without a
latest tag. Invalid tags pointing at nonexistent versions remain excluded.

The real default publisher runs through npm 11.17.0, pnpm 11.1.0 and Changesets
2.29.8. The isolated HTTP registry checks first-GET facts, raw attempts, actual
packed identity/digest and final registry state. Exact local restoration covers
pre.json and four public fixture manifests before subsequent judgments. An
early stable duplicate is compared before requiring candidate metadata; that
history records candidate reach zero.

Native result: 35 tests, 21 passes / 14 intended assertion REDs. Seven reject
wrong tags (P01); seven reject real duplicate attempts (P05). The old histories
retain eight native passes / six REDs. Stable/candidate metadata reach is
29/28, restoration 29, completed comparison 15, packed upload 19, and controlled
failure/partial success/retry 11 each. Heterogeneous versions reach eight,
mixed presence four, and actual candidate-success-before-failure two. The
retained raw per-history records include all unreached zeros. Sibling version,
seed and command campaigns give 120 passes / 12 original tag REDs; ordinary
fixture/publisher controls give 29 passes. Scoped and branch oracle lint pass.

Fresh-tool scratch hosts use an explicit node_modules link to Gate A's installed
Vitest 4.1.12 tools; source/config hashes match the worktree. This is test-tool
reuse, not another clean install or installed-package consumer. Gate A's 3,400
frozen source hashes remain unchanged. The initial socket EPERM is a setup
failure and supplies no product evidence.

Independent reviewer `facade_metadata_review` accepted v2 after independently
running seven new neighbors across v1/v2. They observed the stable-path pair of
409 responses before any candidate GET and the exact wrong-tag aftermath's
zero-upload pass. Root verified all final source/evidence hashes and parsed
35 unique titles with the authored 21/14 split; root did not rerun the full
HTTP campaign. Exact-title replay selected one stable-path RED with 34 tests
unselected. Production remains unrepaired.

ORC-001–006: authority, independent ledger, literate layers, reconstruction,
real HTTP comparisons and calibrated raw multiplicity are retained. ORC-007
random campaigns do not apply to this finite enumeration; actual title replay
is verified. ORC-008–009: no reference state-machine change; versions, tags and
uploads retain distinct meanings. ORC-010: raw primary failures and existing
cleanup controls are preserved. ORC-011: no additional shared-semantic fault
requiring a second model was identified. ORC-012: exact record and frozen
independent audit are retained. ORC-013: target presence, absent/stale tags,
stable/candidate paths, reversed versions and retained-success neighbors
distinguish wrong rules. ORC-014: actual tools receive controlled HTTP facts;
public npm infrastructure/authentication is unclaimed. ORC-015: mandatory
per-history/path reach, including zero later reach, is measured. ORC-016:
histories and calibrations reuse the shared judgment; ordinary controls remain
separate.

Evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk22-author-evidence-v2.md`, `chunk22-http-v2-{traces,evidence}.json`,
`chunk22-command-neighbors-v2.json`, `chunk22-controls-v2.log`,
`chunk22-independent-review-v2.md`, and `chunk22-root-validation.json`.
Final freeze SHA256:
`62d27c1e152e5ce77d09ba4d863b0685370df15342fac69f2fc132db49a09a66`.
Independent review SHA256:
`e4d4a9cabdc4e8961a4785d67b948694a3384ad2e90d707d827efdc83cba8fc8`.
Limits remain four fixture packages, bounded versions/histories, POSIX process
cleanup and controlled registry. Arbitrary topologies, public credentials,
Actions, installed APIs/declarations and production GREEN/mutant closure remain
unclaimed.

## Chunk 23: constructive deferred-row order reach

Accepted at merged HEAD `5fa6eca05530bb9e1f4748b7c00ae60976da2808`.
The SortedMap law and independent Map/full-sort model are unchanged: a row
changed while still deferred sorts by its current value at the restoring read.
The CI failure was reach four against minimum five, without a row mismatch.

The generated prefix places a peer, defers a distinct target, moves the target
across the peer and compares the restoring read. A clear then restores the
original empty starting condition before executing the entire original random
suffix. Both comparator directions distinguish stale placement. All four
fixed examples, random domains, seed 20260912, both 100-run budgets and the
minimum five remain. Reach is credited only at a successful promised-order
comparison; equal ranks, replacements, deletions, clear and unpromised order
receive no credit.

Native and independent runs pass 48/48 tests: 26 oracle/calibration tests and
22 supplemental ordinary examples. Each comparator campaign reaches the
changed-deferred comparison 96 times. Positive read/prune controls reach 16;
negative controls reach zero. An omitted-observation challenge fails the
unchanged reach obligation, separately from the product-mutant result. Exact
native and in-memory eager-placement-mutant replays each execute one actual
history. Native passes; the mutant fails the shared ordering comparison with
current row values in stale order. Full DB test-project typechecking and direct
lint pass. A pnpm freshness-triggered install attempt aborted and supplies no
lint evidence.

Independent reviewer `metadata_timeline_review` accepted the frozen oracle
SHA256 `0c56bb680efba1fa1c66ec5d0da02716324f12d9383159a2321adced2a375754`.
Root verified the saved source, evidence and scratch-config hashes and the
48-pass native report; root did not rerun the campaign. Production is unchanged.
The 3,400 Gate A source files remain intact. Evidence under
`/private/tmp/rc2171-oracle-challenge/`: `chunk23-author-evidence.md`,
`chunk23-independent-review.md`, `chunk23-freeze.json` and
`chunk23-root-validation.json`. Freeze SHA256:
`9f9df6df1cd9da3e592d3aa6e44c2bc9674f2f4138fa4366a1ef8c1e3c670406`.
Independent review SHA256:
`fe53302e71ef0d1f6e9d902295eb3f56c1aceccf2e3faf2ada66b38dbd7a5bd5`.

ORC-001–006 retain the accepted authority, independent model, literate layers,
unchanged suffix grammar, actual read and mutant comparison. ORC-007 retains
fixed/random parity and verified direct replay. ORC-008–010 concern reach-only
bookkeeping and preserve primary failure identity. ORC-011 has no new named
shared semantic fault requiring another formulation. This exact record supplies
ORC-012. ORC-013–016 have the crossing-rank distinction, unchanged internal
receiving scope, measured reach and separate ordinary examples. No replay of
the original CI random history is claimed because its seed/path was not saved.
Other reach states remain sampled. Existing key, comparator and mutation-during-
iteration limits remain; no public Collection or provider expansion follows.

## Chunk 24 — declared ordinary metadata type receivers

Author freeze on merged head `5fa6eca05530bb9e1f4748b7c00ae60976da2808`.
Independent review is pending. Production is unchanged.

The existing public metadata type owner now imports the receiver-types oracle
and native compiler support. Its original 24 source-description campaigns remain.
The separate chunk-21 owner and its 374 strict callback/parent markers remain
byte-identical. This extension enumerates 34 context families over those same
24 source descriptions: 14 recursive callbacks, 16 direct/QueryRef child
materializers and four source-row positive neighbors, for 816 receiving pairs.

The declared ordinary shape has required id, scalar, selected payload and
routeGroup members. An optional source profile yields a required selected value
that permits undefined. The nested ordinary record deliberately uses all four
reserved field names with ordinary source-derived types. The child callback
observes its real input before removing routeGroup with rest destructuring.
Inline parents observe the resulting child values before publication. Compiled
Collection-valued includes stay outside parent functional callbacks. Their
published facade row, get, downstream callback, QueryResult and Collection
receivers supply separate positive observations.

- **Law:** ARCHITECTURE.md's reserved-public-field callback law requires own-shape
  selected inputs to remain ordinary before user JavaScript. Its nested
  materialization law preserves inline shape and publishes Collection metadata
  at facade boundaries. The existing public type law supplies readonly virtual
  fields, union members, ordinary property modifiers and nullable get results.
- **Reach:** all 816 consumers admit with zero diagnostics. The independent
  signature law judges 4,608 actual type markers. All 6,240 declared
  syntax/admission/marker states execute exactly once. The finite policy is
  explicit: an entered subset owes the entire receiving matrix; unrelated seed
  settings waive none; controls-only selection enters no native matrix.
- **RED:** unchanged production has 684 failing new histories: 672 expose the
  ordinary callback/parent/inline metadata leak, and 12 expose loss of
  discriminant-specific ordinary fields through structured source spreads.
  The other 132 histories pass. The original 24 native campaigns remain RED.
  A full run has 882 distinct titles: 174 pass and 708 intended native REDs.
- **GREEN:** all 42 compiler/checker/AST controls pass, as does strict checking
  of the three authored files and targeted oracle lint. Targeted ESLint has
  zero errors and one existing require-await warning in the legacy construction
  helper. No repaired-production GREEN is claimed.
- **Mutant:** wrong observations pass source admission but fail the same
  independent judgment for fabricated input metadata, lost source metadata,
  nested ordinary reserved fields, routing fields, readonly/optional modifiers,
  wrong singleton/array/facade containers and missing absence. AST controls
  reject model-rebound or late markers, wrong rest bindings and forced callback,
  query or result inference. These are checker/syntax controls, not a
  production mutation campaign.
- **Limits:** the new functions are compiled rather than invoked. Runtime
  callback ownership remains with the existing metadata input owner. This does
  not establish built declarations, npm resolution, provider/framework timing,
  arbitrary recursion or exact allocation provenance for opaque equal-typed
  callbacks. No production repair or bug-class closure is claimed.

The static allocation limitation was executed separately before this edit.
A cast-free annotated callback returning its source row and one returning
`Object.assign({}, row)` have equal callback signatures, returned public query
and output types, downstream input types and downstream query types under
TypeScript 5.9.3, with zero diagnostics. That evidence prevents opposite static
expectations based only on syntax known to the generator. It grants no exception
for the 374 existing knowable ordinary-shape markers, and changes no runtime
law. Top-level reserved-name collisions also retain their explicitly recorded
static provenance limit.

Author tools are borrowed from the fresh Gate-A installation through symlinks,
without installs or dependency/version changes. Initial author runs inherited
Vite's package-local `.vite/vitest` cache, and configuration bundling could use
`.vite-temp` through those symlinks. That prevents a no-cache-write claim.
All 3,400 frozen Gate-A source files and critical module, lock and executable
digests remain unchanged. The final author configuration uses a separate scratch
cacheDir and the runner config loader. Shared caches were not cleaned up.

The reproducible host is `/private/tmp/rc2171-oracle-challenge/chunk24-host`.
From its `packages/db` directory, the full native command is:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 node ../../node_modules/vitest/vitest.mjs run --config ../../chunk24.config.mts --configLoader runner tests/query/virtual-row-fields-types-oracle.test.ts
```

The source/host/input/result hashes and exact reporter commands are preserved in
`/private/tmp/rc2171-oracle-challenge/chunk24-freeze.json`. The actual 24 generated
modules and 816 marker descriptions are retained alongside that manifest.
The prior rejected optional-source-root fixture and its TS2769 diagnostics remain
in the R2 artifacts. A legal LEFT-joined callback receives undefined at absence;
it now returns an ordinary record containing that optional selected value,
rather than attempting to publish undefined as a root row. Those admission
errors are separate from the intended native type-law REDs above.

ORC-001–006: authority, independent declared type signatures, literate layers,
bounded grammar and admission, actual unannotated markers and sensitive controls
are present. Each source/API/receiver dimension supplies a named distinction;
removing union sources loses the 12 spread counterexamples, and removing nested
reserved fields loses the recursive ordinary-name boundary. ORC-007 and ORC-008
are inapplicable to this exhaustive stateless grammar. ORC-009 uses Collection,
QueryRef, facade, input and publication as defined in the glossary; context-family
is only a source-grammar grouping. ORC-010 preserves admission diagnostics before
law comparisons and does not allocate runtime resources; the original runtime
construction cleanup remains intact. ORC-011 adds no speculative second semantic
model; the equal-type experiment records the concrete inference limitation.
ORC-012 uses this versioned record and exact frozen artifacts. ORC-013 pairs
ordinary pre-publication input with genuine source and published-facade metadata,
and checks nested ordinary names and rest removal. ORC-014 makes no provider or
runtime handoff claim. ORC-015 measures every finite receiving state, including
partial/unrelated-seed rejection. ORC-016 keeps all native inputs and hostile
observations on the shared generated signature judgment; supplemental concrete
helper tests remain in their ordinary files.

### Chunk 24 R2 — retain the actual functional callback boundary

Independent review found a recorder gap in the R1 syntax guard. Moving the whole
callbackInput marker stanza into an unannotated map helper could reconstruct a
clean ordinary record from the real input. The real fn.select input still had
unwanted metadata, but the displaced source admitted without diagnostics and
all four type judgments passed. The syntax guard also accepted it. The retained
reviewer script and result are `chunk24-independent-bindings.mjs` and
`chunk24-independent-bindings-result.json` in the scratch evidence directory.

The new shared-grammar calibration first failed against the unchanged R1 guard:
`chunk24-r2-helper-red.json` records its single intended assertion RED. Source
admission and all type judgments succeeded first; this is an observation-boundary
failure rather than a type-law or setup failure. The guard now requires the
containing arrow to be the actual fn.select argument. A rest declaration must
also be direct in that same block. The calibration then passes, retaining its
zero-diagnostic, all-type-judgments-pass premise.

The 816 native pairs, 4,608 marker laws and 6,240 finite reach states are
unchanged. R1 sources were reconstructed and verified byte-for-byte against
`chunk24-freeze.json`; `chunk24-r1-source/` preserves them. The RED calibration
sources are separately retained in `chunk24-r2-prerepair-source/`. R1 review and
author evidence remain unchanged. R2 adds one checker calibration, for 43 total
controls; it changes no production code or source-type expectation. The native
672 metadata-leak and 12 union-spread failures remain open. R2 hashes and final
comparison results are in `chunk24-r2-freeze.json`; independent re-review is
pending.

R2 author result: 883 unique tests, 175 pass and the same 708 intended native
REDs. All 882 prior title/status pairs remain unchanged. The 43 checker/AST
controls pass, all 6,240 receiving states still count one, and strict authored
TypeScript plus targeted lint pass. A passing positive-only selection with an
unrelated seed still fails the missing finite reach obligation. The R2 freeze
SHA256 is `3ccfabf4cd7a94f7e39a2438740d9c0c01fcbde1aebceeb945d85e4b97c285bf`.

### Chunk 24 R2 independent acceptance

Reviewer `/root/handler_types_review` independently accepted the bounded R2
scope. Its full native result has the same 883 unique titles and statuses:
175 pass, 708 intended native REDs. All 6,240 reach states count one. A
controls-only run passes 43 controls with 840 native tests skipped and no
unentered-matrix reach failure. A valid unrelated-seed positive-only selection
passes one native history, skips 882 tests and fails the 6,234 missing-state
reach obligation. An earlier malformed replay setup remains recorded without
evidence credit. Strict checking of the three authored files passes.

The reviewer's exact helper relocation retains zero diagnostics and four true
type judgments, but the repaired observation guard rejects its map callback.
Ten additional independent compiler controls reject one wrong facet each,
covering required selected and nested fields, nested null, call/construct
capabilities, union fields, readonly modifiers, array any and Date extras.
There is no remaining supported oracle gap within this bounded static slice.
Production defects remain RED; this acceptance authorizes no runtime ownership,
opaque-allocation provenance, built declaration, npm or provider/framework claim.

The final reviewer report is
`/private/tmp/rc2171-oracle-challenge/chunk24-independent-review.md`, SHA256
`8b79a8ab77f9cc5c5722b0958909cb166fcdc91288524e073310ad5b008d1ab5`.
The report's artifact index is `chunk24-independent-review-manifest.json` in
that directory. It indexes independent native, controls, valid partial, reach,
strict-type, helper-boundary and facet-control results. R1's accepted helper
false green and R2's rejection remain separately reproducible.

The original-worktree `pnpm lint:changed` closeout attempt invoked pnpm's
freshness install and aborted before module removal with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No install completed. The exact
underlying `node scripts/agent-lint-feedback.mjs` ran directly instead; scoped
and whole-branch direct oracle lint pass. No pnpm command ran in the borrowed-tool
hosts. No dependency/version workaround or generated API documentation changed.
## Chunk 25: native Solid publication recording and CI import census

Independently accepted at production HEAD
`5fa6eca05530bb9e1f4748b7c00ae60976da2808`, freeze SHA256
`96059399e2365b02b83e2cac2e73fb792f2215c4b31df9c10f412243ee66620f`.
The four owned paths change only test machinery: Solid's conformance driver,
the shared suite and its small publication checker, and the ordinary operator
import census. No library, release-tool, dependency or generated-doc edit ran.

**Law and authority.** Solid's public result is a callable Accessor. The shared
conformance contract and publication-log cut require settled selected rows to
match the independent source/history model. Empty loading turns remain legal;
earlier turns may not contain the previous source/group's IDs. The old recorder
read removed `.data` fields, while the old subset check silently accepted the
resulting undefined. This repairs the observation, without changing scheduling
or query-identity policy.

**RED and GREEN.** Before fixing either recorder site, the stronger shared
comparison gives 60 passes and two intended Solid assertion failures. Full
Solid source typechecking also rejects `.data` and broad fixture indexing.
The ordinary import census gives one obsolete-import failure and 18 passes.
After invoking both Accessors, retaining literal fixture keys and removing the
obsolete census entry, native Solid has 62 passes with typechecking enabled;
whole-package tsc has zero diagnostics. Census/operator cases give 19 passes.
The affected actual React, Preact, Vue, Svelte and Angular selections give
10, 5, 5, 5 and 3 passes respectively. Unselected scenarios receive no credit.

**Reach and hostile checks.** Every one of seven receiving registrations keeps
all 32 source-ID histories; React registers twice. Reactive drivers each reach
32 initial and nine swapped nonempty comparisons. Pooled counters deduplicate
within their one history, so independent per-target observations additionally
verify both unconditional cuts in every registration: b has exact final
data/state IDs [2], and a has [1,3]. Eight checker controls preserve allowed
empty/loading prefixes and empty modeled results, while rejecting omitted,
undefined, dropped and stale final publications and stale prefixes.

Independent in-memory effect-reader and first-turn-reader mutants fail at the
shared selected-row comparison. The effect mutant fails both stories; the
first-turn mutant fails source-ID swapping while pooled publication is repaired
within the permitted turn. That pooled survival is not counted as a kill.
Returned mounts dispose exactly once under both failures: 3/3 and 8/8. The
original assertion remains primary through ScenarioLifetime. An early typed
scratch observer failed transformation before tests and receives no kill credit.

Root verified all 233 source, 15 config and 50 evidence hashes before this
append. The independent reviewer verified the same frozen inputs and all
3,400 Gate A source hashes plus critical tool hashes/mtimes. Exact pre-fix
Solid bytes are retained; one formatting-only blank-line difference in a later
reconstruction was reconciled against that original hash. Neither that
reconstruction nor root's hash check substitutes for independent execution.

ORC-001–006 retain public/shared authority, independent source rows, literate
layers, unchanged grammar, real receiving paths and calibrated comparisons.
ORC-007–008 are inapplicable to this finite grammar with unchanged model state.
ORC-009 preserves canonical binding and publication vocabulary. ORC-010 has
measured primary-error and disposal fidelity. ORC-011 has no new named shared
semantic fault requiring another model. This record supplies ORC-012.
ORC-013 distinguishes missing/stale output from legal loading/model-empty
neighbors. ORC-014 has actual framework receiving hosts with controlled source
sync, without a backend/device claim. ORC-015 measures each registration and
both pooled targets without lowering budgets. ORC-016 keeps the declared
checker separate from ordinary driver controls.

Evidence under `/private/tmp/rc2171-oracle-challenge/`:
`chunk25-author-evidence.md`, `chunk25-independent-review.md`,
`chunk25-independent-evidence.json`, `chunk25-independent-final-integrity.json`
and `chunk25-root-validation.json`. Independent report SHA256:
`1400b016e492c5e65aa84f1622292df76a98bade26386d52e07b98dc03a5dd20`.
The claim remains bounded to the existing list-query cuts: no arbitrary
scheduler interleavings, within-turn transients, findOne, complete status or
keyed-state traces, backend/provider behavior or native-device scheduling.


## Chunk 26: generated error catalog observation and command ownership

Reviewed merged HEAD: `5fa6eca05530bb9e1f4748b7c00ae60976da2808` plus the four frozen test/support paths in `chunk26-r3-freeze.json`. Reviewer: `/root/facade_metadata_review`. This is an independent review under `.agents/skills/oracle-review/SKILL.md`; the rubric, glossary, coverage-map Production error messages owner, source oracle, fixture, CLI controls, command controls, actual old generator, and erasure boundary were read. No production/tooling repairs, generated-page edits, installations, commits, or pushes were performed by this reviewer.

### Verdict

ACCEPT the R3 oracle/control chunk as a bounded pre-repair gate. The named class-link comparison gap is repaired. No further finding remains inside that named gap. The old CLI and root commands still produce twelve intended assertion failures; this verdict does not claim product GREEN or authorize broader closure. Root controls repair authorization and the versioned coverage/review record.

### Independent execution and provenance

The reviewer checked670 recorded source/host/config/protected/artifact hashes against the R3 freeze: zero mismatches. The four active and host test/support paths match. All154 DB/IVM source paths match their captured bytes, both old root command bodies remain unchanged, and the protected generator, erasure implementation, full catalogs, sample arguments, census, formatter, and tracked generated errors page remain unchanged. An additional fresh check of the immutable GateA source manifest found3400 matching records and zero mismatches. GateA supplies installed test tools only; no clean-install, packed-consumer, or fresh-build credit is claimed.

From `/private/tmp/rc2171-oracle-challenge/chunk26-host/packages/db`, the reviewer independently ran:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 node ../../node_modules/vitest/vitest.mjs run --config ../../chunk26-db.config.mts --configLoader runner --coverage.enabled=false tests/production-error-messages-oracle.test.ts tests/generate-error-docs.test.ts tests/error-docs-commands.test.ts --reporter=default --reporter=json --outputFile=/private/tmp/rc2171-oracle-challenge/chunk26-r3-independent-native.json
```

Result:39tests,27PASS,12intended assertionRED. Every status matches the author's R3 run by full test name; all prior38statuses are unchanged. The17 existing runtime/class/source-census checks pass. Four shared-checker calibrations pass. CLI ordinary controls retain6PASS/9RED; controlled root invocation controls retain2RED. The actual copied old CLI exits0 and emits empty stdout, which reaches the catalog comparison and fails the missing DuplicateDbInstanceError heading. Declared reach is cli-stdout-received1/catalog-compared0; completed-comparison0 follows from the intended assertion mismatch, rather than a fixture setup failure. The test process exits1 for these assertions. Vite also prints missing Expo tsconfig warnings for unrelated example directories; all selected39tests execute, so those warnings are not credited as RED evidence.

### Concrete comparison challenge and correction

The class-link law requires an HTML ID matching each coded production-message URL. The R2 checker parsed raw Markdown as HTML. In a separate disposable copy, the reviewer moved only the first required class anchor, error-2, into the actual generator's canonical fenced text-message form. The unchanged shared checker accepted that wrong observation: the negative calibration failed with `expected [Function] to throw an error`. No frozen source was changed. The installed marked17 renderer independently renders that fenced anchor as escaped code with zero HTML IDs, whereas raw DOM parsing reports error-2. This is an enforcement/model-observation defect under the accepted link law, rather than a proposal for a new renderer contract.

The author retained the failing old-checker calibration before repairing the oracle. R3 excludes canonical generator text fences before class-ID extraction, retains HTML parsing for element/quote/attribute-spacing freedom, and states the bounded extraction limit beside the checker. The reviewer executed the repaired negative calibration through the same checker: PASS. The existing class-anchor calibration also executes the alternate span/single-quoted/spaced-ID positive observation and then rejects the deleted ID: PASS. Neither calibration derives expected catalog facts from renderer output.

The original missing-class-anchor acceptance is separately preserved in the author's earlier old-checker negative calibration. Both oracle repairs change only comparison/calibration logic, with original runtime/source/census laws and old tooling unchanged.

### Rubric outcomes

| Requirement | Outcome |
| --- | --- |
| ORC-001 | PASS within scope. Frozen catalogs and established coded-link contract supply catalog authority; user decision supplies generated-doc ownership. Runtime, bundle and host limits remain distinct. |
| ORC-002 | PASS. Expected codes, names, files and targets come from frozen facts; production generator supplies observations only. The synthetic calibration page supplies minimal facts, not copied rendering machinery. |
| ORC-003 | PASS. Opening prose and adjacent checker/fixture prose distinguish authority, full-catalog input, copied production CLI, stdout checkpoint, comparison and limits. |
| ORC-004 | Not newly triggered: full frozen catalog census is fixed exhaustive input, not a new generated-history claim. Ordinary CLI/control tables remain bounded examples. |
| ORC-005 | PASS as pre-repair evidence. Actual copied old source/full catalogs reach stdout and the real comparison. Empty stdout is representable and rejected. No completed-comparison/product-GREEN claim is made. |
| ORC-006 | PASS. Missing heading, missing class ID, missing site anchor and fenced-only class ID are rejected by the shared comparison; the old fenced-ID checker demonstrably accepted the wrong observation. Native old-tooling failures occur at assertions. |
| ORC-007 | No new important generated property: no new random/replay obligation for this fixed catalog census. Existing unchanged campaigns are not credited as rerun here. |
| ORC-008 | Not triggered: no stateful reference-model change. |
| ORC-009 | PASS. No new model-only subsystem state or lifecycle vocabulary; catalog/stdout/checkpoint retain their direct meanings. |
| ORC-010 | PASS by inspection and native execution. Disposable synchronous fixture preserves primary body failure, including thrown undefined, retains cleanup diagnostics through AggregateError, and releases temporary directories. |
| ORC-011 | PASS for the concrete named shared-semantics hypothesis. Actual installed Markdown rendering distinguishes code text from HTML IDs; R3 adds the same wrong-observation calibration. No general Markdown-equivalence claim is made. |
| ORC-012 | This exact-head/freeze report records all outcomes, execution and limits; root must retain the report/hash in its versioned review record. This is an oracle gate, not bug-class/product closure. |
| ORC-013 | PASS within bounded controls. Valid HTML-ID variants versus absent/fenced-only ID distinguish target semantics; missing/stale pages and invalid-argument controls distinguish the named CLI boundaries. |
| ORC-014 | PASS with explicit limits. Real Node runs the copied source CLI. Controlled erasure/Typedoc recipients prove root-command wiring only; real bundle erasure, actual Typedoc and release Actions remain later receiving gates. |
| ORC-015 | PASS for reported reach. The actual stdout boundary is reached1; completed comparison0 is honestly recorded during intended RED. No generated-history reach claim is added. |
| ORC-016 | PASS. New oracle tests are shared-checker calibrations and the production receiver. Ordinary CLI expectations and root invocation examples stay in ordinary test files. |

### Limits and next evidence

This acceptance is limited to the actual frozen catalogs, current generator source and canonical fenced-message class-ID distinction. It does not establish arbitrary Markdown layouts, full rendered-heading validation, duplicate-heading multiplicity, every prose/template byte, all possible CLI argument lists, asynchronous fixture bodies, pnpm lifecycle execution, installed-package consumers, browser host behavior, or CI/Actions execution. Existing runtime/source/census checks remain supplemental to their declared frozen-input scope. The erasure script itself remains unchanged and must later run against freshly admitted ESM/CommonJS dist while generated docs are stale. The real docs-generation/Typedoc path must later run in an isolated generation workspace, followed by generator --check. Later tooling repair still needs native GREEN and restored-old-source hostile-mutant evidence before product closure. The user prohibition on committing generated docs remains in force.

### Evidence hashes

- `chunk26-r3-freeze.json`: `2baf81b3904bf1f8005dee31aef2b0c7b2d46bb2b758825ee59ecffaa3fbce7f`
- `chunk26-r3-independent-native.json`: `e53c6525a97ffb73f00f7881fb9abff5ea56160a35ebd970ee616ba6168924c0`
- `chunk26-r3-independent-native.log`: `8033eae6254b1bb62f9f333de2bee63cbf6b842d55a0f4978f59728b6304d805`
- `chunk26-independent-fenced-id.json`: `e19d6c3b0f5117f6a6740d5e1ad17930dd64670a41649a0693beb541743e0774`
- `chunk26-independent-fenced-id.log`: `8a86ccb9dd59201e722036ee701b9fe69d072588db4eeb158504fed6d64d48fa`
- `chunk26-independent-fenced-renderer.json`: `f85c7153269d4c2bfd08641d56ea40c7150143f84ad07c6fe7df386ca3c7ffcf`

Root verified 658 frozen scope/host/config/artifact hashes and 12 protected files before repair. No mismatches. The 26-chunk oracle phase is independently accepted; accepted REDs remain release repair gates or explicitly recorded follow-up scope. No executable production repair preceded this checkpoint.
