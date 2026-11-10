# H02 real QueryClient metadata receiving plan

Status: source-inspection proposal only. No test, build, lint, project verifier,
receiving process, process inventory, source edit, worktree creation, or
publication was performed for this plan. Root authorization is required before
implementation or an invocation. This plan grants neither.

## Decision and evidence boundary

Extend the existing virtual-row-fields oracle with a real QueryClient receiving
driver. Reuse its attribution and publication judgments. Compose them with the
existing H02 relational payload model and reload publication cuts. Do not create
a second metadata model, copy a production classifier, or weaken the payload
comparison.

The existing owner is already substantial. Its 1,056 attribution histories,
264 populated-union histories, changing-join timeline, callbacks, downstream
observations and facade histories remain credited within their stated bounds.
The remaining gap is real QueryClient reload/event scheduling, explicitly
excluded by the owner's timeline prose at line 1083.

Authority is clear for this work:

- `docs/guides/live-queries.md`, “Virtual properties,” supplies attribution by
  authored selection shape and the four public virtual fields.
- `packages/db/src/virtual-props.ts`, `VirtualRowProps` and `VirtualOrigin`,
  supplies row-key, pending-write and origin meanings.
- `packages/db/src/query/live/ARCHITECTURE.md`, “Coherent publication,”
  “Replay participants and failure,” and normative laws 9 and 16, supplies
  retained replacement and callback/read/downstream coherence.
- The exact metadata owner's `sourceOwnsMetadata`, `expectedAttributedRows`,
  `expectedMetadataChanges` and `checkMetadataPublications` enact these laws.

No new product decision is needed. The generated reference page
`docs/reference/interfaces/VirtualRowProps.md` has stale optional-field and
legacy `$synced` prose. It must not override the live-query guide, source
interface, accepted maintainer decision or exact owner. Repairing that page is
outside this plan.

The authority correction is
`../metadata-owner-exact-worktree-authority-correction-v1.md`, SHA256
`a18a81f020588d9514c53dd48d64df156b8c3236ad38db790b99c22545b94450`.
It corrects an inspection of the older repository-root owner. The exact H02
owner SHA256 is
`3b0b5cebd4e20505073c363d2670bc61528a79e13835711241667613c7c89258`.

Accepted V4 supplies one finite nonempty scope-key payload control. Its prior
payload is row 4/rank 40 and final payload is row 3/rank 30, with empty markers.
It records held provider answers, completed enqueue, answer execution, root and
downstream callbacks, final publication and cleanup. Its raw snapshots and
change values retain the virtual fields, but its payload judgment intentionally
does not enforce them. V4 is neither metadata GREEN nor strict-conflict GREEN.

## Isolate implementation from source563

The worktree
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1`
is frozen for the remaining baseline controls. Do not change any file, symlink,
dependency, Git state or generated output there while those controls use it.

After root reviews this proposal, create a separate receiving worktree using
the applicable worktree instructions. A suitable proposed name is
`.worktrees/codex-misfits-h02-metadata-receiving-v1`; it has not been created.
Use the exact H02 frozen main commit
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`. This is frozen current-main
provenance, not a claim that the remote cannot have advanced since its freeze.

Before edits in the new worktree:

1. Copy the exact H02 candidate's instrument and shared-instrument files from
   `../prepared-neighbor-controls-v4/source-freeze-v4.json` into the isolated
   checkout. Its SHA256 is
   `acd050dcb5ad16e0aea2bee3d039528f2a2e6c40d0766fce880c04974de8f74d`.
   Include all named scripts/configuration, transport, supervisor, fixture,
   model, replay and premise helpers. Do not substitute the older survey-root
   metadata owner or assume a Git checkout includes uncommitted H02 fixtures.
2. Verify every copied file against that frozen inventory. Preserve the exact
   metadata owner, grammar, source judgment, support, coverage, architecture,
   glossary and rubric identified by this plan's identity manifest.
3. Verify all production files against the freeze's production maps and its
   production identity
   `39dc1e0516c3ae10ecad9be17befcad1616209572ddd054cddc6823c49459451`.
   The copied receiving closure must remain the frozen current-main source;
   copying an instrument is not evidence that a different production closure
   is equivalent.
4. Reuse the freeze's installed Node and dependency targets through local
   reuse links. Do not install, alter locks, change overrides or modify the
   shared dependency targets. Preserve source aliases to the isolated checkout
   so workspace package links cannot redirect production to the survey tree.
   Rebind root-sensitive source-freeze paths to the new checkout; do not relax
   `resolveProgressRoot` or the source-binding guard.
5. Prepare a successor source/dependency/recipe freeze for this isolated tree.
   Preserve the original H02 freeze and artifacts. Record a path-to-hash delta:
   copied unchanged inputs, extraction-only inputs, new receiving inputs and
   unchanged production. A new recipe needs root admission before execution.

The current-main production source remains unchanged throughout baseline
metadata preparation and receiving. Candidate20 and H02 production edits are
separate work. Copying their later source into this baseline would invalidate
its pre-edit status.

## Concrete source edits, after authorization

All paths below are relative to the isolated checkout. This is a proposed edit
list, not a record of completed edits.

### Share the existing judgment without registering its tests

`packages/db/tests/query/virtual-row-fields-oracle.test.ts` currently keeps the
needed functions local. Do not import that `.test.ts` file from another runner.

Extract a directly named companion such as
`packages/db/tests/query/virtual-row-fields-publication-oracle.ts` containing:

- `sourceOwnsMetadata`, the attribution key/result types, the metadata part of
  `expectedAttributedRows`, `checkAttributedRows`, `publishedModelRows`,
  `expectedMetadataChanges` and `checkMetadataPublications`;
- the same authority, limits and `declareOracle` ownership beside those rules;
- no test registration and no new source-attribution cases.

`expectedAttributedRows` currently combines ordinary fixture projection and
metadata attribution. Keep its existing ordinary `id`/`label`/pending selection
in the owner. Delegate only its unchanged attribution branch to a generic
helper that receives independently selected ordinary rows. This allows H02's
`id`/`rank`/`markers` rows to use the same attribution rule without fictitious
`label` fields or duplicated metadata constants.

Keep `expectedSourceMetadata` in its existing source-oracle module and import
it. Keep `captureMetadataRows` as pure recorder support, either exported from
the ordinary support module or supplied by a directly named driver companion.
Do not place recorder-only machinery under a new oracle ownership claim.

Extraction proof must be explicit. Keep unchanged function bodies byte-for-byte
where possible and record old/new body hashes. The necessary generic row
parameterization needs a small pure equivalence comparison over the existing
attribution, union and timeline inputs, including their hostile controls.
Retain every original grammar case, reach declaration, run-budget key, campaign
and calibration. A source hash change is not automatically semantic drift;
neither is an import rewrite automatically proof of equivalence. Report the
changed bodies and evidence separately. No production bytes change.

### Add metadata observations to a separately selected receiving profile

Use `packages/query-db-collection/tests/queued-answer-progress-driver.ts` as the
real-host driver. Its QueryClient, public `markers.reload()`, provider holds,
actual key callbacks, queued-answer premise and release schedule are already
the required path. Keep the original H02 profiles and payload judgment intact.
Add a separately selected metadata receiving profile rather than silently
changing the already accepted V4 recipe.

The minimum primary lane retains the root's existing structured projection,
includes/window topology and default generated keys. Capture these facts before
reload: source/root/downstream Collection IDs, the authored selection shape and
raw public entry lists. IDs are fixture configuration facts, not values copied
from a row's `$collectionId`.

For every initial, held and final snapshot, and synchronously inside every root
and downstream callback, capture:

- the ordered raw row list with all ordinary fields and all four virtual fields
  read immediately;
- the public `Collection.entries()` list without collapsing it to a Map;
- every delivered message, key, type, value and present previousValue, with
  virtual values captured immediately;
- the phase and existing contiguous receipt sequence.

Add initial downstream rows, currently absent from `initial-publication`.
Preserve held root/downstream snapshots at the positive pending-provider cut
and final root/downstream snapshots. Do not wait until a later host turn to
capture callback state. Missing fields must remain detectable; explicit field
presence diagnostics can accompany the captured values. Do not fill missing
fields with defaults or serialize only a `hasVirtualProps` boolean.

For the downstream metadata receiver, select the upstream root's `$key`,
`$collectionId`, `$origin` and `$hasPendingWrites` into ordinary named fields,
alongside `id`, `rank` and `markers`, as the existing timeline already does.
Its own row metadata remains a separate output-Collection judgment. Root and
downstream output IDs must remain distinct. The original payload-only
downstream profile remains a control. Adding a consumer/projection requires
fresh path reach; accepted V4 is not execution evidence for the new profile.

Preserve original message ordering in raw receipts. Reuse the shared metadata
checker's order-insensitive event judgment only where its contract permits it.
The H02 payload checker continues to enforce root/downstream ordered payloads.
Do not sort raw actual snapshots, deduplicate messages or project away metadata
before this additional judgment.

The supervisor already forwards every raw receipt to its observer, but its
retained `outcome.receipts` list omits `downstream-change`. Include that phase
and the new metadata identity/capture phases in the retained semantic list so
offline verification can reproduce the live parent comparison. Preserve the
complete original JSONL and failure/cleanup diagnostics as well.

### Preserve generated-key freedom and include an independent contrast

Default compiler key encoding is not specified by this plan. The primary lane
must not hardcode it or infer expected keys from observed virtual `$key`.
Instead, supply the existing model's `outputKey(id)` parameter through a public
identity binding from the separately captured entry key for that ordinary row.
Validate the complete entry list against the independently modeled ordinary
rows before making that binding; reject extra, missing or duplicate occurrences.
Use prior bindings for delete/previous-value payloads and current bindings for
new rows. Require message keys and virtual keys to agree with that public key.
Do not sample `$key` to construct its own expectation. Keep the raw key values.

This is the existing VirtualRowProps key relation with an opaque public
identity, not a new compiler-key model. A consistently different generated
encoding remains allowed. It does not prove identity stability beyond the
declared history. A wrong virtual key relative to the public row/message key
must fail.

Add an authored-key contrast lane using independent configured `getKey`
functions for root and downstream. Compute its expected keys from authored IDs;
never call a production serializer. Give root and downstream different key
namespaces. This lane can reject consistent corruption of the configured key
contract that the default lane intentionally leaves free.

Architecture lines 118–121 warn that a joined query with custom keys uses keyed
reduction. Therefore this contrast cannot substitute for the default-key lane
or inherit its scheduling evidence. Report both reaches separately. Initially
both lanes use the existing ordinary projection. Structured-spread and direct
functional/provider-row attribution remain outside this smallest receiving
increment; their existing controlled-owner coverage is preserved.

## Histories and comparisons

Start with the accepted finite topology:
`query / microtask / scope / includes / window / nonemptyPrior`, keyShift 0,
rankScale 10. Change only the declared receiving profile and observations.
The smallest first receiving baseline is this history through both key lanes.
It must compare initial and held prior state, every reload callback's current
snapshot and event payload, downstream selected upstream metadata and own
metadata, and final state.

Derive ordinary expected values only from `modelProgressValue(history, final)`.
Feed those rows into the extracted metadata attribution rule using the authored
projection shape and known Collection IDs. This history has no optimistic
mutation: output pending is false and origin remote. It supplies no pending or
origin transition claim. Derive downstream selected fields from the modeled
root metadata, not from a captured root row.

Use the existing H02 prior/final publication rule to select the legal public
cut. Compare all metadata and ordinary fields against the same complete cut;
do not approve fields against separate explanations. Prior must remain at the
measured held-provider cut. During release, existing H02 allows complete prior
or complete final, with no regression after final. This plan does not impose
cross-Collection callback ordering or a new same-stack downstream propagation
guarantee.

Reuse `checkMetadataPublications` and `expectedMetadataChanges` for each
receiving layer's prior-to-final transition. Buffer all actual messages across
the permitted batch partition, while checking each callback snapshot against
its legal complete cut. Validate an unchanged/prior callback against the
unchanged model state; do not require every callback in the whole reload to
show final merely because the final checkpoint does. Require the aggregate
owed delta once per layer. Missing callbacks and repeated whole batches fail.
Maintain existing previous-value and public-event coherence checks.

After the finite receiving baseline, extend the shared history family with
nearby legal inputs: empty/nonempty prior, microtask/timer delivery, both key
lanes, and bounded key translation/rank scaling already supported by H02.
Keep the minimal topology reconstructible. Scope-key runs test neighboring
metadata with successful completion; subscription-key runs exercise the actual
conflict. Never aggregate them under one successful reach count. Preserve the
existing direct seed/path replay and paired fixed/random campaigns when this
is incorporated into a generated campaign. Do not lower existing budgets.

## Declared reach and pre-edit gate

Declare reach per cache-identity × key-lane × receiving-layer, with minimum one
distinct history per required state. Report measured counts, not planned counts.

Required successful baseline states are initial-publication-compared,
nonempty-prior, reload-started, positive-held-provider-read,
held-snapshot-compared, completed-enqueue, answer-executed,
callback-snapshot-compared, callback-message-metadata-compared,
final-publication-compared and worker-cleaned. Downstream additionally requires
selected-upstream-metadata-compared. Callback reaches require a real nonempty
owed change and successful comparison; looping over an empty callback list
must not mark them. Empty-prior histories have their own initial state.

The strict subscription-key lane additionally requires its actual physical
Query conflict, completed resolving enqueue and matching executed callback.
Its pre-edit target RED may stop before execution/final metadata. Record those
later states UNREACHED because of the reproduced progress defect; do not claim
pre-edit strict metadata GREEN or call it an instrument failure without evidence.
The successful scope-key receiver supplies its own neighboring metadata result,
not strict-path terminal evidence. Root must review that exact pre-edit
inventory before authorizing production work. A setup failure, a missing
required receiver, or a reachable unresolved metadata mismatch blocks that
gate. Post-repair strict metadata cuts must all reach and pass before closure.

No candidate-only state is credited by these baseline controls. No baseline
metadata run is authorized by this document.

## Witness and mutant obligations

Before production edits, calibrate the extracted comparison with wrong raw
observations at the same cuts. Each control must retain correct ordinary
payloads unless payload corruption is the intended fault:

| Wrong observation/design | Required rejection |
| --- | --- |
| Missing each virtual field, wrong owner, pending true, origin local | Initial/held/final metadata check, independently per layer |
| Final row with prior row's virtual key | Callback snapshot and final row comparison |
| Correct snapshot, wrong message value or previous-value metadata | Shared publication comparison |
| Correct root, corrupted downstream selected root metadata | Downstream ordinary-field comparison |
| Correct downstream selected fields, corrupted downstream own fields | Downstream own-metadata comparison |
| Duplicate/omitted event or repeated whole batch | Aggregate delta/publication check |
| Intermediate partial row or final-to-prior regression | Existing complete-cut payload check plus metadata check |
| Checker reads only final state | Callback-only corruption must still fail |
| Missing callback or dropped downstream receipt | Owed delta/reach failure, not a vacuous pass |
| Wrong configured key in authored-key lane | Independent authored-key expectation |
| Consistently renamed unspecified generated key | Allowed default-key control if public identity relations remain valid |

At least one admitted real receiving semantic mutant must carry a metadata
fault through the actual callback/snapshot recorder to the shared comparison.
Use a narrowly scoped temporary wrong attribution/publication implementation
in the isolated tree, with payloads and receiving premise unchanged. It must
reach the named metadata cut and fail there. Reverting a mutant and observing
GREEN is separate from the unchanged-production progress RED. A setup error,
source-binding rejection, OOM or watchdog timeout cannot count as a metadata
comparison kill. Pure wrong-receipt controls calibrate the checker but do not
replace this end-to-end handoff check.

An H02 progress mutant may stop before final metadata. Record that as progress
RED and terminal metadata UNREACHED; it is not a metadata-sensitivity kill.
Preserve exact production/model/instrument identities, primary mismatch,
replay history and distinct cleanup diagnostics for every admitted run.

## Completion evidence and remaining limits

Implementation closeout should report law/authority, per-lane reach counts,
unchanged-production baseline results, progress RED where relevant, repaired
GREEN, a receiving metadata mutant kill and coverage limits. Link the exact
reviewed source/recipe/result freezes. Add an ORC-001–016 outcome record when
claiming the receiving oracle repaired, distinguishing executed evidence from
source inspection. Use independent review before production or closure gates.

Update the existing virtual-row-fields coverage entry with only the measured
real QueryClient lanes. Keep its broader owner and budgets. Keep H02 payload
coverage described separately. The initial finite baseline is not generated
closure or universal provider conformance.

This increment does not establish arbitrary provider schedules, provider-row
source attribution, functional callback-input sanitization, all projection
shapes, facade receiving, nonempty inline child metadata, optimistic overlap,
rejected backend answers, permanent conflicting caches or framework receivers.
Those are limits, not changes to their accepted laws. A known reachable
counterexample in the declared lanes remains open and blocks a closure claim.
