# Ordered Effect startup oracle review

## Reviewed state

- Base commit: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
- Reviewed change: the Git tree containing this record, the ordered-work oracle
  extension, and the coverage-map update. The eventual commit and pull request
  identify that immutable tree.
- Primary executable owner:
  `packages/db/tests/query/ordered-work-oracle.property.test.ts`.

A file cannot contain the hash of its own commit. This record fixes the
comparison base and the changed tree's contents.

## Claim and limits

The live-query architecture requires ordered Effect callbacks to retain the
last complete result while an authoritative repair advances the private D2
graph. The first callback after startup must represent the completed ordered
window, even if another source's subscription synchronously changes the
ordered source before all subscriptions exist.

The fixed history begins with two numeric ranks and an indexed width-one
request. The first request installs row 1. Subscribing to an empty sibling
source then updates row 1 from rank 1 to rank 3. The independent final order is
row 2 at rank 2, then row 1 at rank 3. The Effect must emit one `enter` for row
2. A transient `enter` for row 1 violates the callback-publication gate.

This witness covers one synchronous update through an in-memory on-demand
source, a direct LEFT join, and one indexed ordered request. It does not prove
other source orders, multiple buffered changes, asynchronous changes during
startup, or remote provider ordering. Those nearby histories remain with the
ordered-work owner in the coverage map.

## ORC-001 through ORC-011

| Requirement | Outcome | Evidence |
| --- | --- | --- |
| ORC-001: contract authority and limits | Pass | The architecture's ordered request and Effect callback gate sections authorize repair before callback publication. This record bounds the witness. |
| ORC-002: independent judgment | Pass | The two-row numeric rank order and expected single `enter` come from the source truth Map, not the ordered loader or D2's comparator. |
| ORC-003: distinguishable responsibilities | Pass | The oracle header states the law. The fixed-history comment states the model and schedule. The two Collections and `createEffect` drive production. Exact batches and the repair request are checked after startup and microtasks settle. |
| ORC-004: generated-history grammar controls | Not applicable | This adds a fixed controlled history to an existing oracle; it does not claim generated coverage for this startup schedule. |
| ORC-005: production path and observation | Pass | The sibling `subscribeChanges` hook checks the first ordered request, its one-row limit, and row 1's installed source value before the synchronous rank update. It records that the hook ran. `onBatch` captures every public delta batch. |
| ORC-006: checker calibration | Pass | Replacing the buffered drain's `handleSourceChanges` call with direct `sendChangesToD2` fails the exact batch assertion. With the final provider fixture, the mutant emits `enter` for row 1 instead of row 2. This is an assertion failure at the callback checkpoint. |
| ORC-007: fixed/random campaigns and replay | Not applicable | The new lane is a fixed witness. It does not change the existing generated ordered-work campaigns or replay interface. |
| ORC-008: stateful-model minimality | Not applicable | The witness adds no state to an existing reference model. |
| ORC-009: vocabulary mapping | Pass | Source Collection, ordered request, repair, private D2 graph, and Effect callback use the architecture and project glossary meanings. The source truth Map is fixture data, not a second production lifecycle. |
| ORC-010: failure fidelity and cleanup | Pass | `withHistoryCleanup` preserves a primary startup or batch assertion while disposing the Effect and cleaning both Collections. The recorded mutant reached the batch comparison. |
| ORC-011: independent second formulation | Not applicable | No plausible shared semantic fault in the two-row numeric order needs a second query formulation for this callback-gate claim. The public batch and provider repair request give separate observations of the same startup history. |

ORC-012 is satisfied by this base-identified review record and its link from
the coverage map. The pull request records the final immutable commit.

## Verification

On the unmodified production code, the focused witness passes. Both ordered
owners pass 340 tests. The `@tanstack/db-ivm` and `@tanstack/db` builds,
`tsc --noEmit -p packages/db/tsconfig.json`, and changed-file ESLint pass.
The temporary mutant was restored before the green run.

## External review follow-up

The review of local and remote-tracking commit
`72aa5af26513e725dfdaae84e11d810cf42b8070` found three test/release
hygiene issues. The PR adds no published code, so the patch changeset was
removed under the repository's release guidance.

The startup test used one `flushPromises()` turn before comparing batches. An
adversarial callback that queued a duplicate batch through two nested timers
passed that comparison. Draining the controlled timer queue before the exact
batch comparison made the same wrong callback fail. The synchronous provider
fixture schedules no later external work, so that queue drain is the test's
callback observation cut.

The sibling-subscription hook also applied its rank update on every call.
One extra subscription after Effect startup failed at the row-rank setup
assertion, and one before startup failed at the ordered-request setup assertion.
The hook now applies the update only on its first invocation after the initial
ordered request. Both extra-subscription probes pass with that guard, while
the existing `changedDuringStart` and exact batch assertions still require the
intended history and public result.
