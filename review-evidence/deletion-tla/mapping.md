# Formal model traceability and limits

The source specimen is PR #1179 at local/remote head
`34eb98b16d6174d1722878de3cb3b2cd5dc4dabe` plus its existing uncommitted law audit.
Source pointers refer to the inspected working tree, not an assertion that its
contents equal that commit. No production source changed during this task.

## Authorities

| ID  | Source                                                                                                                                                         | Used for                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| S1  | [prior exploratory grammar](../deletion-design-grammar/model.md), P1–P10 and U1–U3                                                                             | Proposed policies and unresolved product choices; not approved behavior                                                      |
| S2  | [native deletion research](../deletion-design-research.md), C1–C4 and native queue witness                                                                     | Close differs from native completion; name queue selects current database; blockers prevent completion                       |
| S3  | [lifecycle grammar](../../packages/db/tests/collection-subscription-lifecycle-grammar-oracle.ts) and [glossary](../../docs/contributing/glossary.md)           | Sync-run authority, cleanup meaning and public-status vocabulary                                                             |
| S4  | [optimistic oracle](../../packages/db/tests/optimistic-history-oracle.ts), opening contract                                                                    | Accepted sync work applies; acceptance differs from publication; handler settlement drops optimism and publishes queued work |
| S5  | [adapter](../../packages/indexeddb-db-collection/src/indexeddb.ts), persist/confirm/restore/acceptMutations/clear/import                                       | Current production cuts and shared descriptor ownership                                                                      |
| S6  | [core state](../../packages/db/src/collection/state.ts), truncate publication; [lifecycle](../../packages/db/src/collection/lifecycle.ts), markReady/markError | Truncate can restore readiness; error alone is recoverable                                                                   |
| S7  | [hostile assay](../deletion-design-grammar/hostile-assay.md) and retained probes                                                                               | Source-to-model boundary observations, including clear/import recovery                                                       |
| S8  | [manual-transaction witness](accepted-before-close.test.ts) / [receipt](results/accepted-before-close.log)                                                     | Public adapter path for acceptance before close and publication afterward                                                    |

The TLA+ models share no production helpers. They specify candidate rules plus
sourced environment/core semantics. This is formal design analysis, not a new
production oracle owner; existing transport, settlement, compatibility, optimistic
and browser suites retain their respective contracts and implementation drivers.

## Retirement model

| Variable/action                                        | Meaning and authority                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`, `closeReason`, `status`, `Close`               | Native admission and public status are separate. Proposed managed close/upgrade/delete notification is atomic before application-visible error; S1/S2. User-callback reentrancy is not simulated.                            |
| `retired`                                              | Observation of the proposed retirement notification; not a core Collection state or sync-run generation. Explicit-close negative control closes without notification.                                                        |
| `readKind`, `readPending`, `FinishRead`                | One initial or replacement restore result; S3/S5/S7. Completion after close has no adapter publication authority. The result value/native read queue is abstracted away.                                                     |
| `late`, startup actions                                | A later Collection using a retired descriptor may briefly load, then errors; it may not falsely become ready. This adds a lifecycle observation, not a third writer.                                                         |
| `kind`, `decision`                                     | Authored provider intent and application decision. Put combines insert/update; valid Collection CRUD admission, schemas and keys lie outside this model. Clear/import are distinct replacement operations.                   |
| `native`, `nativeQueue`, `nativeCommits`               | Admission, commit/abort, FIFO conflicting-store commit order. A queued transaction may abort early. The commit sequence is a diagnostic ledger; no row-order proof follows from it.                                          |
| `confirmation`, `accepted`, `pendingSync`, `published` | Each operation belongs to a separate Collection. Each pending set entry projects a one-entry per-Collection queue. Ordinary acceptance waits for its optimistic handler to finish; replacement publishes immediately. S4/S5. |
| `FinishHandler`, `handlerDone`                         | Combines the core boundary that drops optimism and publishes accepted work; S4. Application delay after manual acceptance is valid by S8. No general microtask scheduling claim is made for automatic handlers.              |
| `caller`, `SettleCaller`                               | Public promise outcome after actual native outcome and handler completion; S1/S4/S5. Closure alone cannot convert a commit to failure.                                                                                       |
| `Policy=finish`                                        | Analyst-proposed new confirmations may be submitted after closure for native-committed operations. Current truncate cannot implement the required error-preserving replacement unchanged.                                    |
| `Policy=suppress`                                      | Analyst-proposed NEW confirmations are suppressed after closure. Already accepted work survives. This refines the ambiguous F1 wording and explicitly loses universal confirmation at success.                               |

## Invariants

| Invariant                           | Law / independent comparison                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ClosedConnectionsDoNotBecomeReady` | Closed managed descriptor versus every associated status, P3–P5; checks any transition, including implicit readiness                 |
| `ReadAuthority`                     | Recorded read publication checkpoint versus native closure, P5                                                                       |
| `AdmissionAuthority`                | Recorded admission checkpoint versus connection openness, P3                                                                         |
| `NativeAdmissionAccounting`         | Native queue membership/uniqueness equals admitted, unfinished operations                                                            |
| `TruthfulSettlement`                | Caller result versus native terminal result, P7                                                                                      |
| `AcceptedWorkIsAccountedFor`        | Accepted obligations equal pending plus published obligations, S4; no silent abandonment without cleanup                             |
| `OnlyCommittedWritesPublish`        | Mutation publication requires actual native commit, P7                                                                               |
| `AcceptedWorkPrecedesCaller`        | An accepted own confirmation is published before its caller's successful settlement, S4 under the one-operation-per-Collection bound |
| `FinishPolicyConfirms`              | The stronger success/publication law for the finish policy, P8                                                                       |
| `StrictPublicationSilence`          | Deliberately challenged claim: forbidden later publication conflicts with existing accepted work                                     |
| `EverySuccessIsConfirmed`           | Deliberately challenged under suppression; identifies its explicit contract loss                                                     |

`TypeOK` is the tenth default invariant. These invariants judge the formal actions,
not TypeScript traces. Negative controls change transition rules or environment
boundaries; some (admitting a native transaction after close, ignoring an external
blocker) deliberately violate platform assumptions. They calibrate the model and
must not be reported as reproduced platform bugs or needed recovery machinery.

The one-operation `FairSpec` requires weak fairness of decision arrival, admission,
native terminal outcome, confirmation, handler completion and caller settlement.
It proves conditional progress over 3,496 states. Its no-fairness control permits
infinite stuttering. No source promises eventual application-handler completion,
external blocker release, or a bounded browser timeout. No two-Collection liveness
proof is claimed.

## Deletion queue model

`position` projects a fixed native connection queue: delete A; two consecutive
opens of B plus initial restoration; delete B. The opens create a managed peer
and unmanaged blocker before the second delete's turn. `Recreate` combines these
steps; messages between those opens are outside the grammar. Both deletes can
have been invoked while the original descriptor existed, but `target` records
the actual dataset selected when that request's native turn begins.

`database`, `target` and A/B row markers are checker-only lifetime observations.
They are not persisted identities or a proposed production protocol. `managed`,
`blockers` and `transactionActive` distinguish close admission from actual native
deletion eligibility. `nativeSuccess` and `callerSuccess` separate native success
from its arbitrarily delayed callback. No time bound or eventual callback delivery
is assumed.

The five default invariants are type correctness, no native deletion while
blocked, no caller success before native success, no old receipt emptying extant
B, and no ready status on an affected closed managed connection. The extra
descriptor-binding invariant is deliberately false under S2's by-name semantics.

This model does not cover an unbounded request queue, multiple database names,
native error outcomes, raw-handle disposal, storage eviction, or arbitrary browser
delivery behavior. It does preserve the blocked-two-lifetime counterexample at
separate storage, Collection, and caller observations. The retirement model checks
native commit/abort outcomes; combining the two models into an unbounded protocol
has not been proved.

## Development and evidence receipts

- Docker was installed but its daemon was unavailable in the preceding analysis;
  the system Java launcher had no runtime. This run downloaded an official
  temporary Temurin JRE and the skill's pinned TLA+ JAR, verified both checksums,
  and executed actual TLC. No container/model-checker result is simulated.
- TLC's Java management socket needed permission outside the filesystem sandbox.
  The first sandboxed smoke invocation failed before exploration; this is not a
  negative model control. The subsequent positive and deliberately weakened
  bundled controls both produced the intended results.
- An initial deletion-model parser error used numeric record fields. It was
  corrected to a function over lifetime IDs; parser failure was never counted
  as a detected invariant violation.
- A pre-final retirement model constrained every native terminal event to queue
  order. Source review widened the grammar to allow earlier abort of a queued
  transaction while preserving commit order. All final checks were rerun. The
  widened model adds transitions but not distinct states in these configurations.
- The model does not add an immediate-error requirement for later startup. The
  prior Python model's timing correction is preserved here as loading→error.
- All final source/configuration hashes are attached to each checker receipt.
  Generated TLC state databases, the JAR, and the JRE remain scratch dependencies.
  Only source, configurations, runner, metadata and human-readable logs are saved
  with this review artifact.
- The final companion refinement probe is a single passing fake-IDB test. It
  supports one important model path; it is not a formal refinement proof or a
  native-browser conformance run. Existing production deletion tests remain red.
