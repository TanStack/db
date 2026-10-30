# Issue 2305: framework row snapshot isolation

> **Historical initial evaluation.** The initial record below describes the first
> local repair. Its coverage, implementation, verification totals, and closure
> statements are superseded by the [prep-pr reevaluation](#prep-pr-reevaluation-2026-10-30).
> The original record remains intact so its claims and later corrections stay visible.

Evaluated 2026-10-30 against `c351fc04d7f70dc59bf92ecbed310f899b9511cd`
plus this working tree's changes. Source: [issue #2305](https://github.com/TanStack/db/issues/2305),
by Erik Müller (`asterikx`), including its reproduction and additional context;
there were no comments at the final source audit. Production and oracle repairs
are implemented locally. No commit or pull request was created.

## Law, experiment, and inference

No product-law decision is required. Framework materialization must preserve
borrowed Collection rows and immutable mutation snapshots. Authority:
[immutable updates](../../guides/mutations.md#update),
[PendingMutation.original](../../reference/interfaces/PendingMutation.md#original),
[ChangeMessage.previousValue](../../reference/interfaces/ChangeMessage.md#previousvalue),
and the [shared binding result contract](../../../packages/db/tests/conformance/contract.ts).
The receiving boundary is the real framework hook, not the core draft copier.

The old adapter suite compared current results. It did not retain source rows,
mutation originals, or previous event values across later materializations.
Thus a correct current result could hide damage to historical values. The core
optimistic-history owner judges settlement and handler payloads; it does not
mount a framework store. The repair belongs to the Frameworks coverage owner.

The new [row snapshot oracle](../../../packages/db/tests/conformance/row-snapshot-oracle.ts)
constructs expected rows independently from history version numbers. It keeps
those records separate from production inputs. It checks complete nested values
as well as current results and retained `get()`, `previousValue`, and
`mutation.original` references. Optimistic writes are checked while their
handler is held, and again after confirmation and settlement. Every retained
reference is checked again after subsequent updates.

The finite grammar enumerates four shapes (plain records, growing/shrinking
arrays, null-to-object introduction, and null-prototype records), three input
forms (callback, config, supplied Collection), and sync versus optimistic writes.
Each history applies three successive updates. Function-valued leaves protect
the existing non-JSON value domain. There are 24 histories per adapter, and 12
additional local-only source histories in Solid using the same model/check.

Reach is asserted separately for every input/write group. Each group reaches
its input and write path four times; each shape once; retained `previousValue`
and later-object admission four times; optimistic groups also retain an original
four times. Each local-only input reaches four histories. Exact counts are
asserted in addition to `createOracleReach`'s minimum checks. These are measured
finite histories, not a random campaign or proof over every possible history.

## RED, GREEN, and calibration

Before production changes, this command failed all six Solid input/write groups:

```sh
pnpm --filter @tanstack/solid-db exec vitest run tests/conformance.test.tsx -t row-snapshot-isolation --coverage.enabled=false
```

The sync groups rejected retained `previousValue.config.value` changing from 0
to 1. The optimistic groups rejected `mutation.original.config.value` changing
from 0 to 1 while the handler was pending. An earlier execution of the same
comparison rejected retained `Collection.get()` changing from 0 to 1. These
were assertion failures at the intended cuts. React and Vue passed the new law
on their unchanged production code before the Solid repair.

The repair copies the plain records and arrays that Solid stores mutate before
both initial store creation and later reconciliation. It retains opaque leaves,
accessors, enumerable flags, null prototypes, array shape, and shared graph
references. Copied data properties become writable for the store.
Existing keyed stores continue to provide Solid's row identity and reactivity.

The repaired branch passes. Temporary production mutants gave these outcomes:

| Wrong implementation | Result at the shared comparison |
| --- | --- |
| Original implementation, neither boundary copies | Six assertion failures: event previous value / mutation original |
| Copy only initial rows | Six assertion failures on the next update to an object introduced by an earlier update |
| Copy only incoming updates | Six assertion failures on the first retained nested value |
| Shallow-copy both boundaries | Six assertion failures on the first retained nested value |
| Proposed `structuredClone` at both boundaries | `DataCloneError` for the valid function-valued field; a runtime compatibility failure, not an oracle assertion kill |

The local-only receiving histories also fail all three inputs with the original
behavior restored, and pass the repair. They use actual `localOnlyCollectionOptions`
and `Collection.update`, reproducing the source path in the issue. This additional
provider witness was added after the initial Solid repair; the pre-edit RED gate
used the actual Solid host with the controlled sync source. All mutants were
removed after their runs.

Final verification:

- Solid full package: 136 tests passed, including row identity, DOM reuse,
  fine-grained reactivity, Suspense and local-only snapshot receiving checks.
- Complete shared conformance files: React 205, Preact 100, Vue 107,
  Svelte 104, Angular 62 tests passed. React registers two driver variants.
- `pnpm exec tsc --project packages/solid-db/tsconfig.json --noEmit` passed.
- ESLint on all changed TypeScript files, `pnpm lint:changed`, Prettier and
  `git diff --check` passed.
- Svelte initially needed built workspace dependencies; `pnpm --filter
  @tanstack/db... build` resolved that setup failure before its successful run.
- `pnpm size:compare --packages solid-db --no-scenarios`: +194 gzip bytes,
  +189 brotli bytes. The helper serves both admission boundaries; the tested
  smaller copying strategies violate the law. Retaining stores preserves
  existing granular identity. No core or other adapter production code changed.
  Test and documentation growth is separate from these shipped-byte figures.

## Lossless source-order finding ledger

| ID | Original claim / proposal | Technical verdict and evidence | Action / disposition | Durable value |
| --- | --- | --- | --- | --- |
| R1 | `createStore(value)` / `reconcile(nextValue)` mutate retained rows and shared nested source objects (`useLiveQuery.ts`, original lines 332–335). | Confirmed, high severity: silent historical-value corruption. Retained get/event values fail on unchanged HEAD. | `fixed-now`: detach mutable store containers at both boundaries. | Shared receiving oracle, complete nested comparisons. |
| R2 | `mutation.original` / `previousValue` can change, breaking undo/redo that replays originals. | Snapshot corruption confirmed at the pending-handler and later update cuts. The application's undo UI was not run. | `fixed-now`: same production repair, distinct original/event observations. | Preserve historical payloads across later materializations. |
| R3 | The supplied local-only, shallow-projection, nested-replacement reproduction should retain the original config value. | Confirmed by the same shared comparison through actual local-only Collection updates; original implementation fails, repair passes. | `duplicate` of R1; its unique receiving source path is retained. | Three local-only input witnesses use all four shapes, without separate expected answers. |
| R4 | rc.1/main and 0.2.45 have this mechanism; it is not browser-specific. | Current rc.1 source and Node-hosted Solid tests confirmed. Tag `@tanstack/solid-db@0.2.45` uses `setData(reconcile(Array.from(currentCollection.values())))`. The old release was source-inspected, not executed. | `duplicate` of R1; no historical-release patch proposed. | Preserve the version provenance and host limit. |
| R5 | Clone on store creation and on every update, specifically with `structuredClone`. | Both admission boundaries are necessary; the specific clone is too restrictive for valid function-valued rows. Its mutant throws `DataCloneError`. | `fixed-now` with a container-copy helper that preserves opaque leaves. | Later-object histories reject an initial-only cure; opaque leaves reject narrowing the value domain. |

Totals: **5 raw items = 3 fixed-now + 2 duplicates**. Zero confirmed-open,
deferred, stale, refuted, accepted-design, or design-decision items. No sibling
contract violation was found in the exercised histories. The final audit reread
the raw issue, including the version note, environment note, and proposed patch.
Item accounting and authorized repairs are complete within the stated boundary.

## Reviewer assessment

**Hire recommendation: yes, with a correction to the proposed cure.** The report
accurately identifies ownership aliasing, supplies a small public reproduction,
and connects it to valuable historical-value consumers. Its prioritization is
appropriate for silent undo data corruption. Signal is high. Its clone suggestion
recognizes both entry points, but does not consider valid opaque values or prove
that objects first admitted by an update remain isolated on later updates.
The shared suite now preserves both ideas. This is a strong bug report; it is
not a whole-PR review or evidence about the reporter's broader review work.

## Oracle conformance and remaining limits

- ORC-001–003: authority, independent scalar-input model, and literate contract,
  grammar, production driver and comparison are beside the executable check.
- ORC-004: all 24 finite combinations run; removing each dimension loses the
  corresponding witness. Three updates distinguish initial detachment from
  later admission. Updates to an absent key are excluded as illegal.
- ORC-005–006: real hooks and actual host scheduling reach the named cuts;
  original, initial-only, update-only and shallow-copy mutants fail assertions.
- ORC-007: no random property was introduced. The bounded grammar runs in full;
  `-t row-snapshot-isolation-<input>-<writes>` replays a receiving group directly.
- ORC-008–009: the model retains versioned expected rows because later updates
  distinguish historical versions. Model records do not represent mutable
  framework proxies; those remain live. No new production state was named.
- ORC-010: each history uses `ScenarioLifetime`; held handlers, subscriptions,
  mounted scopes and Collections release without discarding primary failures.
- ORC-011: no shared semantic-computation fault is hypothesized: the model
  constructs scalar-selected data and does not copy production materialization.
- ORC-012–016: this record ties evidence to the evaluated code; later-object
  admission is the neighboring distinguishing case; real framework drivers and
  local-only source supply receiving premises; declared reach is asserted; every
  retained history uses the shared model/check, without pinned expected answers.

The claim ends at one-row, three-update histories with these container shapes,
immutable function leaves, the held optimistic cut, and each framework's settled
cut. It does not establish every value type, arbitrary getters or cyclic updates,
callback-by-callback publication atomicity, failure/rollback schedules, real
browser rendering, or application undo UI behavior. The existing framework and
optimistic-history owners retain their other guarantees; none were relaxed.
There is no known in-scope counterexample. A future broader value or schedule
claim needs a corresponding grammar and observation in these owners.

PR readiness: **not assessed**. This task evaluated an issue and repaired a local
working tree; no PR, pushed repair head, or remote CI was evaluated.

Evaluated code fingerprint (SHA-256 over the ordered paths and contents of the
five changed TypeScript files): `4ce4f7ac3df872dbaa11a4a3ed039d3c81d283815b3c7c00bfa2837fb730b328`.

## Prep-pr reevaluation (2026-10-30)

The prep review evaluated the initial repair against refreshed `origin/main`,
`c351fc04d7f70dc59bf92ecbed310f899b9511cd`. The independent code review found
four production defects and two oracle enforcement gaps. Subsequent evaluation
found another adapter defect and two further oracle gaps. These findings
supersede the initial record's statement that no neighboring violation was known.
The simplification review found no useful optional code simplification. Its
follow-up supplied two compatibility constraints, preserved separately below.

### Lossless prep finding ledger

The B1–B6 order matches the comprehensive review's source-order inventory.
Aliases preserve the original reviewer identifiers. All confirmed findings
were P2. `fixed-now` describes a completed repair with executable evidence;
the two accepted constraints were not shipped defects.

| ID | Review claim, authority, and missing distinction | Evaluation and disposition |
| --- | --- | --- |
| B1 / PC2 | A global copy memo preserves sibling aliases. Splitting `left` from `right` leaves the hook at `left=1/right=1` while its source is `left=2/right=1`. The current-result law lacked alias-topology histories. | **fixed-now:** independent store paths receive independent container copies; ancestor tracking retains backedge detection. Split/merge/split histories reject the shared-alias mutant at the current-row comparison. |
| B2 / PC4 | `new Array(length)` loses an Array subclass's prototype and `total()` method. The original hook exposes the method. The receiving suite lacked subclass values and a method observation. | **fixed-now:** copied arrays retain their prototype. Independent model premises require methods on current and retained values when the source profile supplies them. The array-prototype mutant fails the subclass assertion. |
| B3 / PC1 | A preserved enumerable nested getter returns a source-owned plain object. Reconciliation changes a retained source getter's value from 0 to 1. The ownership law lacked accessor-returned containers. | **fixed-now:** enumerable accessors materialize detached writable values. Stable getter histories run through the same scalar model and historical-value check. Restored source getters fail historical-value assertions. |
| B4 / PC3 | A nested native Solid store reports accessor descriptors. Copying those descriptors creates getter-only backing fields, and the next update throws `TypeError`. The real-host proxy input was missing. | **fixed-now:** copy accessible enumerable values and omit the store's hidden symbol metadata. A real `createStore` driver seam exercises initial and later admissions. The descriptor mutant has a runtime failure after setup; this is distinct from an assertion rejection. |
| B5 / OE2 | `toMatchObject` accepts added ordinary root fields. A hostile driver corrupted 12 retained rows while four histories passed. The comparison observed a subset of the immutable snapshot. | **fixed-now:** compare complete selected values and recursive own-key sets. Ordinary root fields, nested fields, array holes, and own undefined fields remain distinguishable. Permanent wrong-observation controls use the shared checker. |
| B6 / OE1 | Projection and source teardown share one callback. A projection rejection prevents attempting source cleanup. ORC-010 requires resource release and distinct diagnostics. | **fixed-now:** independent ordered deferred callbacks attempt both cleanups. RED observed source attempts 0 versus projection attempts 7. GREEN preserves the original primary and cleanup Error identities through labelled aggregates. |
| B7 / PC5 | Solid treats assigning undefined as deletion, so a source row's own undefined field disappears from hook output. Reconciliation can also retain a stale own undefined field after full-sync omission. The exact-row law lacked these transitions. | **fixed-now:** restore or remove own undefined fields recursively after reconciliation. Public setter pulses notify enumeration and membership subscribers inside the store batch; raw definition preserves the final own undefined property. Root and nested values remain checked by the shared oracle. |
| B8 | A method check conditioned on the source's post-observation `instanceof` can erase its own premise. A hostile recorder stripped four source subclass prototypes while all seven histories passed. | **fixed-now:** method premises come from the independent model, including the source profile. Current and retained method checks now reject that same hostile driver at the initial receiving checkpoint. |
| B9 | Undefined fields only inside a newly admitted `extra` object do not establish restoration inside an existing nested container. A root-only repair could escape that witness. | **fixed-now:** scalar versions 1 and 2 give the existing config payload an own undefined field; version 3 removes it. The root-only-undefined mutant now fails recursive key comparisons. |
| S1 | Eagerly reading every accessor would invoke a nonenumerable getter that Solid's original `createStore` never reads. The review's throwing-getter probe recorded zero original reads versus one read and a throw for that proposed copier. | **accepted-design constraint:** preserve nonenumerable accessor descriptors. The final implementation evaluates enumerable accessors only. This avoided a proposed compatibility regression; it was not a defect in the earlier descriptor-preserving repair. |
| S2 | Omitting all nonenumerable symbols from a detected store also omits user-authored hidden symbols. Public `$PROXY` identifies a store, but private bookkeeping symbol identities are unavailable. | **accepted-design constraint:** retain the existing shared selected-value boundary, which excludes hidden symbols. Enumerable user symbols remain copied data. No hidden-symbol promise is introduced, and these histories do not establish general symbol-update fidelity. |

Prep totals: **11 raw items = 9 fixed-now + 2 accepted-design constraints**.
There are no optional simplifications, duplicates, confirmed-open adapter
findings, or discarded suggestions in this prep inventory. The original issue
inventory remains five separate historical items: three fixes and two duplicates.
Together the records account for 16 items: 12 fixes, two duplicates, and two
accepted constraints. The unresolved Core policy boundary below is recorded as
an explicit limit, not counted as a confirmed product-law violation.

### Prep reviewer assessment

The code review was accurate and had high signal: all six original findings
reproduced. It challenged both production compatibility and the oracle's ability
to detect corruption. P2 prioritization fits the demonstrated failures. The
follow-up review also exposed a false-green method premise and distinguished
Core draft behavior from adapter defects. Proposed repairs needed those broader
checks before they established closure. Hire recommendation: yes for this review
role, based on the executable counterexamples and successful calibrations.

The simplification review showed useful restraint: it proposed no unsupported
code reduction. Its hidden-getter probe and symbol-boundary analysis identified
concrete compatibility constraints before the proposed changes shipped. Its
final production review found no further actionable defect. Hire recommendation:
yes for this role; there is no demonstrated simplification benefit to claim.

### Contract and source-profile correction

The receiving law remains unchanged: materialization preserves borrowed rows,
mutation originals, and previous values; current results follow source rows.
The expanded comparison judges full values and exact recursive own keys.
It uses `toEqual` for values rather than inventing a draft-prototype policy.
Independent method assertions retain the subclass promise where the source
supplies it. Missing and own-undefined fields still fail in either direction.

Expanded optimistic histories initially failed in the unchanged React and Vue
adapters because the model predicted a confirming sync row at the held edit
checkpoint. Core-only probes separated those source transformations from
adapter defects. Deleting a draft field produces an own undefined patch field,
as the draft-detachment and flat-change-tracking owners state. Assigning a
null-prototype record or Array subclass currently emits an ordinary record or
Array through Core detachment. The adapter repair does not revise that policy.

Ordinary optimistic histories retain nested replacement and root deletion.
Their held model explicitly contains own `extra: undefined` after deletion;
full-sync confirmation removes the omitted field. Null-prototype, subclass,
and host-store histories change only the scalar during the held edit, then
confirm the full replacement through sync. Changing an object-valued sibling
can also cause Core to detach an unchanged subclass, so these scalar-only
histories change neither config nor extra. The local-only source profile
models its actual draft-confirmed rows, including own undefined deletes and
ordinary containers after draft replacement. These distinctions preserve
ownership and value observations without declaring Core's copier an oracle.

### Histories, paths, reach, and RED

Every common driver runs **42 bounded histories**: seven shapes, three input
forms, and sync versus optimistic writes. Solid also supplies native store
inputs, giving **48 histories**, and runs **24 local-only histories** across
the three input forms. React retains both existing suite registrations.
Each history applies three updates and rechecks every retained value.

Each input/write group asserts its own reach. Common groups reach their input,
write path, retained previous value, later admission, root-delete representation,
and nested own undefined seven times; each shape reaches once. Optimistic groups
retain originals seven times. Solid's corresponding counts are eight, and each
local-only input reaches eight histories. The object history keeps its config
container across versions, admits nested own undefined at version 1, and removes
it at version 3. This stable-container witness distinguishes recursive repair
from a root-only implementation. Exact count assertions accompany minimum reach.

Before the prep production repair, the expanded real Solid hook failed all six
shared groups and all three local-only groups. Independent cases completed
before a labelled aggregate reported their failures. The campaign exposed
alias-current-value mismatches, accessor historical corruption, lost subclass
methods, native-store runtime failures, and root own-key mismatches. The later
stable-container comparison rejects both absent and stale nested undefined keys.

```sh
pnpm --filter @tanstack/solid-db exec vitest run tests/conformance.test.tsx -t 'row-snapshot-isolation|local-only row snapshots' --coverage.enabled=false --maxWorkers=2
```

The RED evidence is retained locally in `prep-red.log` and `prep-final-red.log`
under `/private/tmp/issue-2305-audit/`. Core-only probes and unchanged-adapter
results separated draft normalization from adapter defects. The final
stable-container calibration and local-only host-proxy-assignment limit were
added after the generic repair; production needed no further behavior change
for those challenges. No oracle exclusion dismisses an adapter counterexample.

### Mutants, calibration, and verification

The restored final implementation passes the strengthened receiving suite.
The following temporary production mutants ran the callback sync, callback
optimistic, and actual local-only callback groups. Each failed all three groups;
the mutated source was restored after every run.

| Mutant | Observed rejection |
| --- | --- |
| Original copying behavior | Current-row and retained previous/original assertions. |
| Copy only initial values | Historical values introduced by preceding updates change. |
| Copy only updates | Initial borrowed snapshots change; current-result assertions also fail. |
| Restore globally shared alias copies | Current-row values disagree after alias splitting. |
| Drop copied Array prototypes | Independent source-supplied subclass assertion. |
| Preserve enumerable source getter descriptors | Historical assertions and native-store `TypeError` after setup. |
| Remove undefined-shape repair | Root and nested exact-key assertions, including stale undefined keys. |
| Repair undefined shape at root only | Nested exact-key assertions on the stable config container. |

The per-mutant logs are `prep-mutant-{original,initial-only,update-only,shared-alias,array-prototype,source-getters,no-undefined,root-only-undefined}.log`
in the same local audit directory. Assertion failures and the native-store
runtime failure are reported separately; no timeout or setup failure is cited
as a successful comparison rejection.

The ordinary DB calibration file has **11 passing tests**. Its wrong observations
cover added and missing root fields, own undefined fields, nested undefined
fields, and array holes versus own undefined elements. Its cleanup regressions
also preserve primary and secondary error identities. The ordinary Solid shape
test has two receiving cases: root and nested admission/removal, with separate
`Object.keys` and `in` subscribers. Core emits those full-row updates even when
only own-key presence changes. Both cases reject an alternate hook copy with
only `reconcileUndefined` removed and pass restored production. They observe
only final shapes and retain row identity. The isolated logs are
`/private/tmp/solid-shape-subscriptions/red.log` and `green-package.log`; an
earlier concurrent-mutant capture was detected, retained as `red-compound.log`,
and excluded from the isolated-mutant claim.

Final verification is **727 passing tests** across the complete files:
Solid 138, React 205, Preact 100, Vue 107, Svelte 104, Angular 62, and DB
calibration 11. The final row grammar was rechecked in every adapter after its
last extension. Type checking, changed-file ESLint, `pnpm lint:changed`,
Prettier, and `git diff --check` pass. The final size comparison against
`origin/main` is **+430 gzip bytes / +404 brotli bytes** for Solid.

### Updated oracle audit and limits

- ORC-001–003: the same public authority governs the independent scalar model,
  receiving source profiles, literate grammar, and exact public observations.
- ORC-004: bounded enumeration reconstructs the reported and adjacent cases;
  ablations lose aliases, accessors, methods, host stores, or source entry paths.
  Three updates distinguish later admission and removal. Absent-key updates
  remain excluded as illegal.
- ORC-005–006: real framework hooks reach held and settled cuts. Original,
  neighboring-design, wrong-observation, and runtime compatibility controls
  have the classified outcomes above. Stable nested admission/removal rejects
  a root-only repair.
- ORC-007: these are finite exhaustive histories, not an important random
  generated property. Fixed/random campaigns and seed shrinking do not apply;
  the input/write test selector directly replays a receiving group.
- ORC-008–009: versioned expected rows preserve distinctions that later writes
  can observe. Source profiles describe the receiving inputs, not mutable
  framework proxies or a replacement settlement model.
- ORC-010: independent deferred cleanups and labelled cause chains preserve
  the violated checkpoint, secondary diagnostics, and source teardown attempts.
- ORC-011: no shared value-computation fault requiring a second model was found.
  Core-only source-premise probes and hostile observation controls address the
  concrete profile and premise-erasure hypotheses without duplicating the oracle.
- ORC-012–016: this append preserves the loss audit, neighboring witnesses,
  receiving source paths, measured reach, and direct shared judgment. Calibration
  and notification examples remain in ordinary test files; all generated
  receiving histories use the same model and comparison.

The claim remains one key and three updates over the stated values, immutable
function leaves, stable enumerable getters, native Solid store inputs, source
profiles, and each driver's held/settled cuts. Hidden symbols retain the existing
selected-value exclusion. Arbitrary getters, cyclic updates, class private-state
cloning, general symbol updates, callback atomicity, other rollback schedules,
real-browser rendering, and the application's undo UI are not established.

One separate Core boundary remains unresolved: assigning a native Solid store
through `Collection.update` can promote its hidden bookkeeping symbols during
draft detachment. The supported policy for host-proxy assignment is not settled,
so this is not labelled a confirmed product-law violation. Owner: **Drafts and
native values**, with a maintainer support-policy decision and a real
`createStore` → `Collection.update` receiving witness still needed. That witness
must distinguish user keys from wrapper metadata and observe the stored and
retained values. Local-only histories therefore begin with a native store and
use ordinary replacements; controlled sync histories admit native stores on
every update. This limit does not exempt the adapter's direct store inputs.

No confirmed adapter counterexample remains inside the declared boundary.
Quality evaluation is complete; changeset and PR-body creation await the user's
next prep-pr gate. No remote CI or PR readiness claim follows from local checks.

Final evaluated code fingerprint: **`bf8ca3a767dc7d204a75a3f4d69386b58c8e9669fc22de59ce99244472600656`**.
This is SHA-256 over the 13 changed TypeScript paths in sorted repository-relative
order, each path followed by NUL, file contents, and NUL. It supersedes the initial
five-file fingerprint above.

## Subsequent materialization review

The ten-item external review and later independent findings changed the
materializer and snapshot model again. The append-only
[materialization review](2026-10-30-solid-row-materialization-review.md) records
that evaluation against published head `1d619bb67`, the repaired code commit,
final receiving reach, RED/GREEN/mutant evidence, and remaining limits. Its
current evidence supersedes the earlier implementation and coverage summaries
above without rewriting their historical claims.
