# PR #2171: oracle challenge

Reviewed source: `858b174a65f160d13d01f0324c7481cc8e4eba3a`.
This is a self-review. The author of the repairs designed these challenges
after inspecting the tests; they are not independent or held-out evidence.

The initial task was to identify concrete oracle improvements. The initial pass
below proposes 15. Two have executed distinguishing experiments. The remaining proposals
identify source-inspected gaps and experiments still needed. They are not
confirmed production bugs or completed oracle repairs. No production change or
permanent oracle extension was made during this audit.

The follow-up audit expands this plan to **26 checks** and maps **53 review
items plus four evidence caveats** in the
[review coverage matrix](2026-10-28-pr-2171-review-coverage-matrix.md).
That includes overlapping reports, non-runtime findings, and accepted product
choices. Three current failures now have executable witnesses: cached SSR
admission, hydration replacement of local option claims, and an unconfirmed
successful write in a documentation example. The follow-up evidence below
supersedes the initial pass's statement that it established no production defect.

## Why the previous green results were insufficient

The cache oracle compared admission alone. Its grammar coupled the two options
when both were present. The metadata oracle checked a broad set of query shapes
over a narrow history: one row, one held update, and successful settlement.
Its union fixtures always had an empty branch. The neighboring publication
oracle intentionally removed virtual fields before comparison.

Those instruments provide useful evidence, but their combination does not
establish the interactions they omit. More runs of the same grammar would not
repair these omissions. Earlier counts such as 144 cache cases and 409 metadata
cases describe executions, not comprehensive protection of the contracts.

Authority remains the maintainer decisions recorded in the existing owners,
the virtual-property contract in `docs/guides/live-queries.md`, and the live-query
architecture's Collection boundary and publication laws. These proposals do
not revise the accepted release policy, metadata attribution, or option
retention decisions.

## Executed challenges

All runs used the unchanged source revision above plus the stated temporary
edit. Source and test files were restored after each experiment. Raw logs are
task-local under `/private/tmp/rc2171-oracle-challenge/`.

Command, from `packages/db`:

```sh
../../node_modules/.bin/vitest run --config vite.config.ts \
  --coverage.enabled=false --typecheck.enabled=false \
  tests/live-query-cache-options-oracle.test.ts
```

### M1: reject only when every supplied option differs

Location: `packages/db/src/client.ts`, `_assertLiveQuerySources`.
Keep the original `rowOptions.some(...)` check, but additionally require:

```ts
rowOptions.every(
  (option, index) =>
    (option === undefined && record.rowOptions![index] === undefined) ||
    option !== record.rowOptions![index],
)
```

This wrong rule accepts two callers with different `getKey` references when
their configured `schema` reference is the same. The approved rule rejects
either differing reference under the same reusable identity.

The distinguishing driver edit keeps the schema reference unchanged in the
existing `option === 'both'` histories, while still changing `getKey`:

```ts
schema: different && option !== `both` ? { ...schema } : schema
```

| Execution                                    | Result                            |
| -------------------------------------------- | --------------------------------- |
| Unchanged production, existing grammar       | 144 passed                        |
| M1, existing grammar                         | 144 passed: survivor              |
| M1, distinguishing grammar                   | 12 assertion failures, 132 passed |
| Unchanged production, distinguishing grammar | 144 passed                        |

The failures were missing synchronous conflict errors or fulfilled promises
where observer preload owed a rejection. They were not setup or timeout errors.
This demonstrates improvement 1; it does not calibrate every proposed option
presence or framework path.

### M2: overwrite the claim before rejecting a conflicting caller

Location: the conflict branch of the same method. Insert this immediately
before the conflict error:

```ts
record.rowOptions = rowOptions
```

The first rejection still looks correct. A second attempt with the conflicting
options can now borrow the corrupted claim.

The distinguishing checker invokes the rejected synchronous action again and
requires the same conflict rejection. It retains the original model and first
comparison. This experiment extends preload and subscribe retries; the async
observer-preload retry remains future work.

| Execution                                        | Result                            |
| ------------------------------------------------ | --------------------------------- |
| M2, existing grammar                             | 144 passed: survivor              |
| M2, repeated-admission checker                   | 24 assertion failures, 120 passed |
| Unchanged production, repeated-admission checker | 144 passed                        |

Failures occurred at the repeated-admission assertion. This demonstrates the
claim-preservation part of improvement 2. It does not establish row, listener,
or resource non-interference after rejection.

## Concrete improvements

### 1. Vary cache options independently, including absence

**Owner:** `packages/db/tests/live-query-cache-options-oracle.ts`, its core
driver, and `packages/react-db/tests/cache-options-oracle.test.tsx`.

**Gap:** the `both` cell changes both references together. First and second
callers always have the same option presence.

**Change:** generate first/second declarations independently for each option:
absent, same reference, or different reference. Derive conflict from the pair
of declarations and query identity, rather than a single `different` flag.
Keep the default/default success case and both directions of absent/custom.
Use transforming schema fixtures where that boundary permits schemas.

**Witness and cut:** cache `(keyA, schemaA)`; request `(keyB, schemaA)` under
the same identity. Reject at admission; a distinct query key must succeed.
Declare reach for each single-axis conflict and each presence transition.
M1 is the executed calibration for the first missing distinction.

### 2. Compare cache state after rejection

**Owner:** the same cache model and receiving drivers.

**Gap:** the check ends at throw/rejection. It never asks whether the first
caller's result or resources remain usable.

**Change:** extend each rejection history with a repeated conflict, a compatible
third caller, and a source update. Compare original keys, schema output, rows,
and surviving subscriber delivery. Record public subscriber ownership before
and after the rejected attach, without requiring incidental private layouts.

**Witness and cut:** A establishes a result; B conflicts twice; A's compatible
peer still reads A's keys and receives the next update. No rejected listener
remains. Observe admission, the next source publication, and final cleanup.
M2 demonstrates one missing distinction. Also challenge a listener retained
before validation and a rejection that evicts the first result.

### 3. Control pending delivery and vary which caller establishes the result

**Owner:** the core cache driver and React receiving driver.

**Gap:** the first caller is always explicit preload. The source is a ready
local-only Collection. Omitting `await initial` exercises immediate result
reuse, but does not hold source delivery or prove a transport-pending premise.

**Change:** add an explicitly held source load. Assert that it started and
remains unresolved before the second caller. Cross preload-first and supported
observer-first registration with preload, subscribe, and render consumers.
Record reach separately for each path and pending/settled cut.

**Witness and cut:** attach a conflicting observer while A's source delivery is
held; it rejects immediately. Release A and verify its exact result. A wrong
implementation that validates options only after readiness must fail before
the release. A healthy compatible peer must continue waiting and then succeed.

### 4. Model option claims through hydration, failure, and consumption

**Owner:** extend the cache option model using the public lifecycle paths in
`packages/db/tests/db-client-preload-identity.test.ts`.

**Gap:** those paths already have source-object witnesses, but the row-option
oracle does not intersect them. A one-shot admission predicate cannot judge
when a claim begins or stops applying.

**Change:** retain the first local declarations while a result is reusable;
model retirement when a failed or consumed result is no longer reusable.
Generate pending/settled hydration, first local claim, a later hydration chunk,
conflicting reuse, result consumption/failure, and replacement reuse. Server
function references must never become local identity claims.

**Witness and cut:** hydrate, claim with A, hydrate a newer chunk, reject B;
consume or fail that stream, then allow a fresh B result. Compare public
dehydration, local row keys, and caller outcomes. Challenge both overwritten
local claims and claims retained forever. These experiments remain unrun.

### 5. Receive option laws in the other actual framework bindings

**Owner:** `packages/db/tests/conformance/contract.ts`, the shared conformance
suite, and each materially affected framework driver.

**Gap:** the new option-specific receiving evidence is React. Source-ID and
general conformance evidence does not establish this option-specific handoff.

**Change:** reuse the option judgment for independent DbClient callers through
each supported config entry point. Reuse inline-retention histories for
identity-comparing bindings, including Preact. Reactive bindings without a
DbClient follow their own documented recompilation law; do not impose React's
identity policy on them. Run real native scheduler cuts and render budgets.

**Witness and cut:** a normal render retains a comparing binding's Collection;
identity replacement applies new options; a separate conflicting cached caller
rejects before returning rows. A compare-options-by-reference-on-every-render
mutant must fail in each applicable host, not just a controlled core driver.

### 6. Compare complete metadata results and independently judged keys

**Owner:** `packages/db/tests/query/virtual-row-fields-oracle.test.ts`.

**Gap:** the 400 attribution histories read `live.toArray[0]`, check its label,
and compare metadata. Projected keys come from a clean sibling compiled by the
same machinery. Extra rows and shared key mistakes can escape that comparison.

**Change:** have the model predict every selected ordinary field, every row,
and multiplicity. Compare complete arrays or multisets as the query contract
requires. For ordinary projected roots, add explicit `getKey` functions with
independent expected keys. Keep default-key differential checks as supplemental
evidence; do not invent an undocumented composite-key encoding.

**Witness and cut:** two rows with distinct labels and model-derived projected
keys, followed by deletion of one. Observe preload and every publication.
Challenge an extra row, a missing non-first row, a lost `id`, and an incorrect
projected key shared by both compiler paths. None is calibrated here.

### 7. Populate multiple union branches simultaneously

**Owner:** the same metadata owner.

**Gap:** every union attribution history has one populated branch and one
empty branch. Either branch position is covered, simultaneous contributors are
not.

**Change:** generate nonempty branches with different source Collection IDs,
typed source keys, overlapping ordinary values, and independent pending writes.
Vary branch order, branch removal/reinsertion, and QueryRef consumption. Compare
all occurrences without collapsing them into a value-keyed Map.

**Witness and cut:** A and B both contribute; hold a mutation only on B, then
remove A's last contribution. Each remaining row must retain its own branch's
attribution at pending and settled cuts. Challenge a union-wide first-source
metadata owner and deduplication of distinct contributions. Duplicate public
key handling must follow the existing key contract, rather than inventing a
winner. These experiments remain unrun.

### 8. Change outer-join match topology during the history

**Owner:** the nullable-spread grammar in the metadata owner.

**Gap:** `matched`, spread order, and pending side vary, but match presence
remains static throughout each history.

**Change:** generate unmatched → matched → unmatched → matched transitions
through join-key updates and legal delete/reinsert actions. Cross both spread
orders and retain an untouched second parent as an isolation check. Compute the
last present source from the authored query and independent source rows.

**Witness and cut:** `{ ...a, ...b }` initially takes A's metadata, switches to
B when B matches, and returns to A after B leaves. Compare after each action
and inside its public callbacks. Challenge sticky ownership, first-spread
ownership, and clearing metadata when a later spread becomes null.

### 9. Exercise attribution through rejection and overlapping transactions

**Owner:** the metadata owner, receiving the settlement contract protected by
the optimistic-history owners.

**Gap:** its attribution histories use one held update followed by fulfillment.
They do not combine attribution with rejection or two independently pending
source transactions.

**Change:** generate fulfill/reject decisions, both settlement orders, and a
source update while an optimistic transaction remains held. Track authored
source snapshots and surviving overlays independently. Predict attribution
from the accepted source-versus-output rule at each cut.

**Witness and cut:** mutate A and B in a joined query; reject one while the other
persists. The selected source's pending state and origin must follow the
remaining transaction. New projections still receive output metadata.
Challenge premature clearing of pending state and retention of the rejected
source's metadata. Do not change optimistic snapshot policy to fit output.

### 10. Keep virtual fields in publication and downstream observations

**Owner:** the metadata owner plus the observation machinery of
`packages/db/tests/query/includes-publication-oracle.test.ts`.

**Gap:** the metadata owner checks snapshots at three cuts. The neighboring
publication oracle's `stripVirtualProperties` removes all `$` fields, so its
callback comparisons cannot supply metadata publication evidence.

**Change:** add a separate metadata observation alongside the existing
ordinary-value projection. Capture callback payloads, synchronous Collection
reads, and downstream selections of the four virtual fields. Require callbacks
for histories that owe them. Preserve prior observations before later writes.

**Witness and cut:** an optimistic source update changes label and pending
state in one publication. A callback must never see the new label with stale
attribution. Compare each layer at its own callback; do not require a downstream
layer to advance during its upstream callback. Challenge event-only stale
metadata and correct-after-a-microtask publication.

### 11. Run the attribution grammar through Collection facades and inline controls

**Owner:** the metadata owner, with a receiving driver using the facade
lifecycle histories owned by the includes Collection oracle.

**Gap:** facade projection and inline collision witnesses are supplemental fixed
tests in `virtual-row-fields.test.ts`. They do not receive the broad attribution
grammar or exercise attribution through bucket departure and reactivation.

**Change:** feed the same projection/collision model through root Collections,
Collection-valued includes, and inline-value controls. Vary active/empty/shared
buckets, route moves, child updates, and cleanup. Model facade lifetime
separately from row attribution; reuse the existing owner rather than creating
a competing lifecycle model.

**Witness and cut:** two parents share one child facade; one leaves while the
child has a pending write. The remaining parent's facade retains the right
source/output metadata. Inline projected `$key` values retain authored shape.
Challenge using the parent Collection ID for projected facade rows and enriching
inline values as Collection rows. Calibration remains unrun.

For A12's Effect claim, first inspect its public value contract separately.
An Effect does not publish through an output Collection. Do not infer an
output Collection ID law from the facade contract or treat every reserved
authored scalar as illegal. Its receiving driver must compare the contract
that actually applies; unresolved authority remains a limit of this plan.

### 12. Observe metadata inside functional callbacks

**Owner:** the metadata owner and
`packages/db/tests/query/includes-functional-projection-oracle.test.ts`.

**Gap:** the metadata grammar's functional QueryRef consumer returns the row
directly. Its final output check does not prove a callback could not use spoofed
input metadata to compute an ordinary scalar. The functional-input owner checks
materialized values, but does not supply this reserved-field collision grammar.

**Change:** generate a colliding inner projection through direct, QueryRef,
join, and union forms; capture public callback inputs and return an ordinary
`observedCollectionId` or pending badge derived from them. Keep the existing
rejection of compiled Collection-valued functional inputs.

**Witness and cut:** an inner new projection selects a fake `$collectionId`;
an outer callback copies its observed value into an ordinary field. Assert the
legitimate metadata at callback invocation and on the resulting scalar.
An outer-publication-only sanitizer must fail this check. Sanitizing the final
reserved fields is insufficient once user JavaScript consumed the fake value.

Maintainer decision, 2026-10-28: new projected subquery objects have their
reserved fields removed before a downstream `.fn.select()` callback. Direct
source rows retain source metadata. Inline include values retain authored
shape. This resolves O12's authority question; its receiving oracle remains
to be authored and independently reviewed before production repair.

Subsequent clarification, 2026-10-28: structured whole-row source spreads also
retain genuine source metadata at callback entry. The stripping rule applies
to projections that create their own row shape; it does not override the
existing source-owned spread rule.

### 13. Model release histories and receive them through packed artifacts

**Owner:** a new release-law model adjacent to
`scripts/version-packages.test.mjs` and `scripts/publish-packages.test.mjs`.
Keep their useful fixed regressions as replay inputs or supplemental tests.

**Gap:** version and publish tests use small separate workspaces and written
answers. The publishing callback records public names and prerelease state;
it does not observe the real Changesets command's registry operations or packed
dependency capabilities. Manifest peer strings alone cannot prove API support.

**Change:** generate legal sequences of changesets, version runs, repeated
no-op runs, publish failures/retries, and RC exit. Independently model patch
suffixes, minor candidate increments, precedence, consumed changesets, stable
1.x lines, and dist-tags. Include candidate and patch counters around 9/10.
Run the command boundary against a local registry fixture, never npm production.
Pack the real package inventory and receive representative application paths
with supported DB versions. Check that excluded 0.15 combinations are rejected
and RC combinations can execute newly required APIs.

**Witness and cut:** patch → patch → minor → repeated version → failed publish
→ retry → exit. Every packed manifest, selected tag, and consumed changeset
must match the model. Exercise Query failure reporting and offline outbox
restoration in installed fixtures. Challenge double-consumption, lexical RC
ordering, incorrect stable-package tags, and peers that claim absent methods.
The stable Query minor decision remains accepted policy, not an oracle defect.

### 14. Generate type inputs from the same boundary descriptions

**Owner:** `packages/db/tests/query/virtual-row-fields-oracle.test-d.ts`, with
ordinary mutation-handler type tests as supporting evidence.

**Gap:** the metadata type file has reusable expected type aliases but applies
them to hand-authored concrete queries. That does not meet ORC-016's generated
legal-input requirement or cover the runtime grammar's composition axes.

**Change:** generate legal TypeScript query inputs from row/value, projection,
nullability, union, and composition descriptions. A reusable independent law
predicts exposed metadata and nullability. Compile the generated inputs through
the public package exports, preserving diagnostic identity and source locations.
Add adapter handler-result forms with an independent Promise<void> admission
rule; runtime legacy-value tolerance is a separate JavaScript promise.

**Witness and cut:** vary a projected inline object, a whole-row child, a nullable
joined row, and discriminated union members without adding expected answers.
Reject enriched projected-value types, lost optionality, and accepted legacy
handler-result types. Do not use `any`, casts, or an unreachable callback to
manufacture a successful compile. These experiments remain unrun.

### 15. Preserve oracle failures when teardown also fails

**Owner:** both cache-option drivers and their shared test lifetime support.

**Gap:** their `finally` blocks run cleanup sequentially. An early cleanup
exception can replace the comparison failure and stop later cleanup. The
metadata owner already uses `checkWithCleanup`, including a calibration test;
that protection does not extend to the cache drivers.

**Change:** use cleanup support that attempts every owned release, preserves
the original law/checkpoint as the primary cause, and retains secondary errors.
Register partially acquired resources before subsequent steps can fail.

**Witness and cut:** cause a cache comparison mismatch, make observer disposal
fail, and verify that view, client, and source cleanup still run. The reported
cause must remain the comparison mismatch. Also check a failed mount before an
unmount handle becomes available. This is harness evidence, not a new product
recovery promise. Its fault-injection calibration remains unrun.

## Initial pass: implementation order and evidence limits

Start with 1–2: both have demonstrated survivors. Then add 6–10, since those
histories exercise the metadata boundaries that repeatedly escaped review.
Follow with cache lifecycle/host receiving work, facade/callback receiving
work, and release/type boundaries. Apply 15 to each driver as it changes.

For every implemented improvement, keep the old regressions, add the missing
grammar or observation, declare per-path reach, and run the unchanged baseline
before considering production changes. Demonstrate a relevant mutant failure
at the named comparison. Do not mark an item complete because this report
describes its experiment. No claim of universal correctness or zero future
reviewer findings follows from this audit.

The two demonstrated gaps remain open in the checked-in oracle. The remaining
13 proposals still need calibration. No production defect was established by
the experiments here. Only core cache comparisons were mutation-tested; the
React and other native-host counterparts were not run with these mutants.

After restoring every temporary edit, the core metadata and cache owners pass
together: 553 tests across two files. The existing release tests also pass:
11 tests. These are baseline checks; they do not implement the proposals or
establish full PR CI success.
`pnpm lint:changed`, the report's Prettier check, and `git diff --check` pass.
pnpm reports the existing node_modules/lockfile override mismatch; this audit
did not install dependencies or change the manifest or lockfile.

## Follow-up: make the plan account for every review item

The original 15 were insufficient. They concentrated on cache and metadata
interactions. They did not explicitly preserve several already repaired laws,
exercise documentation behavior, or require clean build and exact-head evidence.
Runtime oracles also cannot decide a maintainer's version policy or establish
that unused code has been removed.

The matrix preserves A01–A15 from the first supplied review, B01–B10 from the
next, C01–C15 from the latest supplied review, G01–G11 from GitHub review
comments, and W01–W02 from the bot's pre-merge warnings. B10 and C01 retain
both of their subclaims. Overlaps retain separate IDs. Four source caveats
remain explicit. The bot's reach-wording suggestion is separate from its
remaining `isPersisted` comment; the first inventory accidentally conflated them.

No new product decision is needed for these checks. The accepted policies
remain the authority. A request to identify sufficient improvements does not
make proposed checks into implemented coverage. Confirmed failures remain open.

### 16. Check cached server reads before any subscription

**Owner:** the shared cache option model and core driver, with a React
`renderToString` receiving driver alongside `cache-options-oracle.test.tsx`.

**Law and gap:** independent callers cannot borrow conflicting local row
behavior. The current owner reaches preload, observer preload, subscription,
and client render; it does not reach a cached `getServerSnapshot()` before
subscription. An SSR hook never subscribes, so that later guard cannot help.

**Change:** generate cached/uncached server reads, source-only/query preloads,
same/different/absent options, and keyed/derived identities. Reuse the admission
model. Require a cached row to be present before the conflicting read. Add a
browser hydration control under the same law, without inventing transportable
function identity.

**Witness and cut:** preload A, then server-render B with the same identity and
a different `getKey` or schema. Reject before returning A's snapshot. A same-option
caller succeeds. A guard placed only in subscription must fail. The core and
actual React server paths both fail this comparison on the current head.

### 17. Preserve mutation outcomes and explicit confirmation across adapters

**Owner:** Query's mutation histories in `ownership-lifecycle.oracle.test.ts`
and Electric's handler histories in `electric-oracle.property.test.ts`.

**Law and gap:** the handler's fulfilled/rejected outcome remains its outcome;
legacy return values are ignored at runtime. Query performs no automatic
refetch. A confirmed write survives settlement; an unconfirmed optimistic row
reverts. Types reject non-void handler results. These are approved decisions,
not an invitation to reinstate old automatic behavior.

**Change:** keep the existing 18 Query and 12 Electric histories in the required
validation set. Extend their grammar across CRUD, fulfillment/rejection,
legacy/void results, and no confirmation versus explicit refetch/direct write
or Electric acknowledgement. Cross delayed confirmation and ordered consumers
where those existing owners apply. Compare exact handler error identity, fetch
counts, public rows, and transaction outcome while held and at settlement.

**Witness and cut:** a successful server write followed by a legacy result
must not become a caller failure. A Query handler with no confirmation starts
no fetch. A documented successful-write example must use a confirmed history.
Earlier records calibrate the Electric rejection wrapper and Query automatic
refetch removal; this audit does not newly implement those owners.

### 18. Enforce external completion through transaction state and Offline restore

**Owner:** `optimistic-history-oracle.ts`, its outcomes driver, and the real
Offline restoration/settlement receiving paths.

**Law and gap:** external completion is admitted only for pending work. It
cannot turn failure into success or override persisting/completed work. The
first 15 proposals omitted this law even though the previous review added its
missing action to the primary model.

**Change:** retain pending/persisting/completed/failed starting states and
repeated completion attempts. Intersect them with restored outbox work, peer
ownership, and mutation outcomes that the Offline owners already express.
Compare public rows, terminal outcome, and transaction state after each action;
observe outbox deletion and caller settlement at the receiving boundary.

**Witness and cut:** fail a transaction, attempt external completion, and
require rejection without changed rows/outcome. Restore permitted pending
work as a compatible control. Removing the admission guard previously failed
four state histories. Packaged API availability is a separate O13/O22 check.

### 19. Release descriptor deferrals after failed or uncommitted renders

**Owner:** React's source-ID reuse oracle and descriptor-query binding driver;
use shared conformance receiving paths where another framework owns this law.

**Law and gap:** a rejected render cannot leave a descriptor Collection unable
to start for a later consumer. Mounted identity retention does not prove
partial-construction cleanup. The existing React owner already covers rejected
source-ID reuse, Suspense, infinite hooks, and multiple throwing starts; retain
that evidence rather than claiming a new model is needed.

**Change:** inventory render preparation steps that acquire deferrals. Generate
failure before/after each acquisition, suspended and abandoned renders, and
subsequent direct readers. Reuse the existing lifecycle judgment. Register
cleanup for partial construction and require per-hook reach.

**Witness and cut:** reject preparation after deferring a shared descriptor;
a later direct preload must reach ready and expose the authored row. A second
source throwing during release must not prevent a healthy third source from
starting. Mutants that omit release or stop after one failure must be rejected
at those public cuts, rather than by an unrelated cleanup error.

### 20. Observe proxy expressions through diagnostics and actual UI consumers

**Owner:** the virtual-field query law, index-suggestion tests, and a receiving
witness for the React Native shopping-list projection and badge.

**Law and gap:** the selected ordinary pending indicator must follow the source
row. JavaScript `!proxy` is a constant, not a query expression. An outer reserved
field receives output metadata. Correct generic metadata cannot prove that the
example actually consumes the ordinary field.

**Change:** generate pending/settled and true/false source states through
supported predicate, order, and projection expressions. Check both actual
result variation and the intended diagnostic path. Compile the example and
receive those states through its actual component, not a copied projection.

**Witness and cut:** hold a list write, observe the Saving badge, settle it,
and observe the badge clear. Ordinary projected `hasPendingWrites` must vary
while output `$hasPendingWrites` remains governed by the projection law.
Calibrate a JavaScript-negation replacement and a badge reading the reserved
property. Static wiring plus a core query test is useful but does not establish
native component execution.

### 21. Execute authored documentation and check migration/API consistency

**Owner:** `scripts/check-doc-snippets.mjs`, package type checks, and behavior
receivers reusing the relevant mutation/query models. Handwritten guide and
skill references are in scope; generated reference output remains CI-owned.

**Law and gap:** runnable guidance must resolve public exports and demonstrate
the behavior it promises. Existing removed-symbol searches and snippet
compilation cannot detect a successful POST whose optimistic row disappears.
An existing snippet baseline can also preserve a newly introduced diagnostic.

**Change:** extract the actual fenced snippet, supply only its documented
external collaborators, and run its successful and failing histories through
the matching model. Compile examples and skills against exports. Reject new
removed-symbol references outside explicitly marked historical/before examples;
compare diagnostic identities against the baseline without expanding it to
waive new regressions. Check prose for source/output attribution, explicit
confirmation, internal helpers, stable-minor upgrade costs, and removed APIs.

**Witness and cut:** the documented POST succeeds and the server owns the row;
at transaction settlement the Collection must show the confirmed row. An
unexported migration helper fails compilation. A remaining `isPersisted`
reference fails the current-API check. The successful POST witness is RED at
this head; broader generated docs receiving coverage remains proposed.

### 22. Validate the actual workspace before versioning and packed consumers after it

**Owner:** workspace install/build/typecheck CI, actual package inventory, and
the release model's package-consumer receiving fixture.

**Law and gap:** a truthful published peer range does not guarantee a local
workspace can build before the RC versions are written. Existing node_modules
can retain a symlink that a clean install will not create. The first plan's
packed-consumer checks omitted that pre-versioning boundary.

**Change:** use a disposable, clean, frozen install and the repo's package
build graph. Resolve every imported workspace API, including declaration/test
inputs and examples. Check the actual non-private inventory against the RC
changeset after main integration, including Convex and Preact. Verify local
workspace dev dependencies independently from published peer ranges. Then
version, pack, install, and execute supported consumers through O13.

**Witness and cut:** Offline has an RC-only peer while the local DB is still
0.15.2; workspace builds must resolve the local source via a workspace build
dependency. A persisted Query handler returning `{}` must fail the new void
contract's typecheck. Neither failure is established by an already linked
runtime test. Both source findings remain open; no fresh install was run here.

### 23. Check dead exports, branches, and duplicated wrappers with source evidence

**Owner:** production caller/export inventory, TypeScript control-flow checks,
and the shipped-byte comparison. This is a static review check, not a runtime
state model.

**Gap and change:** behavior tests cannot reject an unused warning helper,
an impossible SSR branch, an unused recompile mode, or equivalent duplicated
wrappers. Enumerate callers and exported uses before deletion; check narrowed
types and every framework's policy modes. Compare consolidated wrappers/types
and run their unchanged behavioral owners. Do not delete a shared policy merely
because React alone supplies a constant argument.

**Witness and cut:** leave an unreferenced warning export or dead mode in the
production inventory; require the source check to report it. Preserve a real
reactive-framework caller as a negative control for overbroad deletion. Compare
size after consolidation, without declaring a harmless internal branch a
product failure.

### 24. Measure repeated work independently from result correctness

**Owner:** a narrow compiler work probe and `pnpm size:compare`, supplementing
the metadata/functional-projection owners.

**Gap and change:** correct rows do not expose an alias-array or copy-closure
allocation per row. Instrument the relevant compile/evaluation site or use a
source/AST placement check. Compile once and process increasing row counts;
require compile-invariant source discovery to happen once per compilation.
Count copies only under the conditions that require a copy. Keep output
comparisons alongside these counters.

**Witness and cut:** hoistable alias discovery or closure construction inside
the row loop fails its deterministic count. An allocation required by a changed
row remains permitted. This is a proposed engineering work check; no new
wall-clock performance promise or measured slowdown is claimed.

### 25. Receive coded diagnostics and public APIs through published build artifacts

**Owner:** production error census, `scripts/test-production-errors.mjs`, and
`scripts/test-minified-db.mjs`, with affected adapter artifact checks.

**Law and gap:** adding a plain Error can bypass coded diagnostics and ship its
full text. Source-only testing does not establish production message erasure
or public export/name stability. The original plan omitted these existing
independent observations.

**Change:** include newly reachable identity/mutation errors and all affected
packages in the development census. Build actual ESM/CommonJS and minified
consumer entries; compare error codes/names and test message erasure. Keep
intentionally removed errors distinct from missing public exports in docs.

**Witness and cut:** an uncoded preparation error is reported by the census;
a newly introduced literal survives production bundling and fails erasure.
A documented helper missing from the public entry fails O21/O22 compilation.
Use existing calibrated owners; no new artifact run was performed here.

### 26. Tie all validation to the exact head and the path actually exercised

**Owner:** a validation manifest joining package/test inventory, oracle reach,
build fingerprints, and review-item reconstruction. This is execution gating,
not a universal correctness model.

**Gap and change:** three reported failures were in tests already on the PR.
They needed an ordinary full affected-test run. Other review runs lacked
Changesets dependencies, loaded stale DB builds, or reviewed a moving branch.
Record source head, build inputs/dist age, resolved DB entry/copy, test selection,
exit status, and per-host comparison reach. Run every affected changed test;
include newly merged packages. Rebuild before adapter receiving tests. A new
head invalidates affected evidence. Preserve every raw review ID, outside-diff
comment, additional suggestion, and setup caveat in the validation inventory.

**Witness and cut:** restore each stale assertion and require its own test to
fail. Remove a required host from the test selection and require the missing
reach to fail validation. A second/stale DB or absent Changesets dependency
must produce invalid setup, never a GREEN product result. Unrun checks remain
unrun even when another suite has thousands of passing cases.

## Follow-up experiments at unchanged `858b174a6`

These were temporary production drivers; no source repair or permanent test
extension was retained. The core/React drivers reuse
`checkCacheOptionAdmission` from the existing independent cache model. They
vary `getKey`, schema, and both, each with same/different references. Fixture
schema validation is an identity operation; these probes judge declaration
admission, not schema transformation.

| Path and named checkpoint                                                               | Expected under the approved law                                              | Observed comparison                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Core `getServerSnapshot()` after a one-row query preload, before any subscription       | Same options succeed; conflicting options throw before returning cached rows | Three assertion failures, three compatible controls pass         |
| Actual React `renderToString` with `DbProvider` and `useLiveQuery`, same cached premise | Same admission rule, through the real server host                            | Three assertion failures, three compatible controls pass         |
| `hydrate()` with a newer stream timestamp after local preload, then another preload     | Preserve the original local claim and reject conflicts                       | Three assertion failures, three compatible controls pass         |
| Actual error-handling guide's successful POST handler, then `when('settled')`           | Server row and Collection row agree after documented success                 | One row on the server, zero in the Collection: assertion failure |

The server runs stub `window` as undefined and do not subscribe. The hydration
run dehydrates the established query, checks its row exists, hydrates a stream
with `dehydratedAt + 1`, and checks that the newer timestamp replaced it before
admission. This distinguishes the real replacement path from ignored hydration.
The documentation run extracts the fenced setup before `// Usage` in
`## Transaction Error Handling`, transpiles it, and evaluates it with the real
Query Collection/QueryClient and a successful in-memory fetch collaborator.
It preloads an empty server, inserts the documented todo, awaits settlement,
and compares all authored ordinary fields with the server's independent row.

Commands used the root Vitest binary from each package, `--config vite.config.ts`,
`--coverage.enabled=false`, and `--typecheck.enabled=false`. Temporary test
paths were `tests/cache-review-coverage-probe.test.ts` in DB,
`tests/cache-server-review-probe.test.tsx` in React, and
`tests/doc-success-review-probe.test.ts` in Query. Drivers and logs are retained
in `/private/tmp/rc2171-oracle-challenge/` for this task. These paths are scratch
artifacts, not checked-in replay interfaces. The witness construction above
states the inputs and observations needed to reconstruct them.

The first documentation driver used a non-file `import.meta.url` under Vite
and failed setup. That run supplied no product evidence. Reading the actual doc
from the package working directory reached the row comparison and failed there.
All other RED results above were intended assertion failures, not timeouts or
teardown errors. No repair GREEN or hostile-mutant result is claimed for these
three current defects.

The existing external-completion, core option-identity, and index-warning files
also pass at this head: 58 tests across three files. Earlier review records
supply their historical RED/GREEN evidence. This bounded baseline does not
execute the new SSR/hydration histories in the checked-in test suite.

## What the expanded plan does and does not establish

Every identified review item has a concrete check and a distinguishing witness
in the matrix. Behavioral findings map to independent laws and receiving paths;
source/build/documentation findings map to appropriate checks. Accepted release
policies remain explicit costs, rather than defects a test should reject.

This is **plan accounting**, not demonstrated interception of all 53 items.
The expanded checks would need implementation and replay against each original
failure or a suitable mutant before making that stronger claim. Known gaps
remain assigned to their existing owners in the coverage map. The current SSR,
hydration, and documentation counterexamples prevent a readiness or bug-class
closure claim. No production fix, permanent oracle extension, commit, push,
generated-document edit, dependency installation, or lockfile change was made
in this audit.
