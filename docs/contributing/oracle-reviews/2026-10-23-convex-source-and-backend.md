# Independent review of Convex snapshot, ownership, bridge, and backend oracles

Reviewed implementation head: `6511ee4ed0940cd54ee58ceeba7202ca859344b3`.

The reviewer did not author these semantic models. The reviewer changed their
cleanup harness after finding that cleanup could replace a primary mismatch.
Pagination is excluded from this independent verdict because the reviewer
implemented its changes; another reviewer covers that owner.

## Scope and observations

- Snapshot owner: `packages/convex-db-collection/tests/snapshot-oracle.property.test.ts`.
  Last valid keyed source array, including absent fields and duplicate rejection,
  through raw arrays and a successful uppercase text projection. Observations are
  public keyed rows and error presence after synchronous delivery.
- Ownership owner: `packages/convex-db-collection/tests/ownership-oracle.property.test.ts`.
  Concrete option identity admission and independent fresh/descriptor owners,
  across idle, ready, and cleanup checkpoints. Observations are construction
  rejection and public rows after cached mutation confirmation.
- Bridge owner: `packages/convex-db-collection/tests/offline-oracle.property.test.ts`.
  Ordered stages and retry classification, plus cold real-Collection source
  acceptance and rejected durable acceptance through cleanup/restart. Observations are stage traces, settlement, provider subscription
  admission, and public rows before/after the first source delivery.
- Backend receiving owner: `packages/convex-db-collection/e2e/backend-oracle.test.ts`.
  Real range pagination and durable insert/update/delete replay through process
  death. The replay observations are durable receipt key, server application
  counter, complete server fields, and complete replayed Collection fields.
- SDK receiving support: `packages/convex-db-collection/tests/sdk.test.ts`.
  Both SDK clients receive subscriptions, mutation timestamp transitions,
  reconnects, and sibling listener cleanup. These focused tests do not own
  another independent state model.

Fresh independent execution before the final freeze passed 28 checks across
snapshot, ownership, bridge, SDK, and pagination support. The author then ran
the new durable-acceptance rejection property with 60 fixed and 60 random
histories and direct replay after the independent finding described below.
The final source tree is pinned above; this record adds review evidence after
that implementation commit without changing its production or test sources.

The backend author reports all nine final backend tests green after the adapter
freeze, including 36 generated process histories. Insert replay at seed 20261022,
path 0:0:0:1, and update replay at seed 20261022, path 0:0:0:0:0, pass with their
operation-specific selectors. The source acceptance, snapshot, ownership and
backend evidence below distinguishes independent source inspection and fresh
review execution from the author's hostile-control calibrations.

## Requirement outcomes

| Requirement | Snapshot | Ownership | Bridge, including cold source | Real backend receiving owner |
| --- | --- | --- | --- | --- |
| ORC-001, authority and limits | Complete keyed snapshots and select follow the public adapter guide. Transport and mutation timing are separate boundaries. | The concrete-options claim follows the established LocalStorage policy and documented adapter ownership. Arbitrary Collection lifecycle is excluded. | The guide promises ordered mutation then source acceptance, with terminal application errors and retryable post-confirmation sync failure. Storage/leadership stay with offline-engine owners. | Convex transactions and the application's atomic receipt contract authorize one application per durable key. Finite pagination must equal an independent unpaginated query. Cloud availability, multi-tab leadership, and power-loss writes are excluded. |
| ORC-002, independent judgment | Last valid input array and pairwise duplicate-key judgment do not compute adapter sync operations. The selected reference applies the explicit input transformation. | Identity and materialization form determine admission; no production claim flag or sync state is imported. | A dependency prefix determines stage traces. Cold source expectations depend on whether a valid snapshot was delivered, not adapter state. | Expected task state comes from the operation and draft. An unpaginated server query judges range results, and a counter distinguishes equal final rows after duplicate writes. |
| ORC-003, literate responsibilities | Opening prose explains contract, validity model, grammar, production path, comparison, and exclusions. | Opening prose maps identity forms and checkpoints to admission and mutation confirmation. | Separate prose explains stage-prefix judgment and cold source acceptance, their histories, cuts, and limits. | Opening prose separates pagination and process-replay judgments, SIGKILL cuts, server and Collection observations, and excluded boundaries. |
| ORC-004, grammar controls | Keys a/b/c, text up to 12, optional text up to 6, 0-5 rows and 1-30 snapshots. Empty, changed, absent, duplicate, reordered and reintroduced keys are reconstructible. Raw/projected variants distinguish missing projection. Duplicate snapshots are rejected atomically rather than admitted as valid rows. | Four identity forms cross idle/ready/cleaned-up and text up to 16. Direct/shallow forms must reject, fresh/descriptor forms must admit. Removing reuse or sibling cleanup loses distinct ownership witnesses. | Stage failure chooses none/args/mutation/sync, with keys/text up to 15. Cold histories choose idle/pending/startup-error and empty/rows/error/cleanup delivery. Rejected durable acceptance crosses empty/nonempty snapshots, 1-4 unchanged/changed callback retries, and a cleanup/restart cut. Delivery is irrelevant after failed startup, which is explicitly terminal at that cut. Empty success and rejected startup distinguish readiness from nonempty rows. | Insert/update/delete cross acknowledgement known/uncertain, text up to 12, rank -50..50, native signed int64/special float/0-12 bytes on insert/update. Delete has no payload. One pending transaction excludes batch and shared-key leadership histories. Child checkpoints enforce admission before offline SIGKILL and server acceptance before uncertain SIGKILL. |
| ORC-005, path and checkpoint | Real Collection plus adapter receive controlled callbacks; keyed public rows and error presence are checked after each delivery. | Real constructors, DbClient materialization, adapters, optimistic transactions and public rows run. Actual SDK sibling tests receive the provider multi-listener premise separately. | The stage driver runs the public bridge with explicit collaborators. The cold driver runs the public bridge with actual Collections and proves pending settlement and one subscription before delivering source data. The acceptance-rejection driver defers actual core commit behind durability, matching persistence's withAcceptedReceipt boundary, and checks rejection before and after retries, then successful fresh-run rows. | Both actual SDK clients run against the isolated local backend. Process replay uses fresh child processes and disk storage. Parent reads the durable key independently; child checks public fields only at replay completion. |
| ORC-006, calibration | Omitting projection is rejected at public row comparison, seed 20261022/path 0:1:1:0:3:4:3:7:7:7:7:7:6. Existing deletion and full-row mutants separately calibrate omitted keys/fields. | Original reuse failed at admission, seed 20261022/path 2:0:0; the two-owner confirmation regression additionally exposed stale first-owner rows. | Original argument failure escaped terminal classification, seed 20261022/path 5:1:1. Original cold acceptance resolved before delivery, seed 20261023/path 0:0:0. Removing terminal durable-failure guards fails at rejection observation, seed 20261023/path 0:0. | Duplicate effects with one receipt fail at applicationCount, insert seed 20261022/path 0:0:0:1. A substituted durable key fails at receipt-key equality, update path 0:0:0:0:0. Dropped replay-only payload fails child public-row deepStrictEqual at the same update path. |
| ORC-007, parity and replay | Identical property runs 150 fixed and 150 random histories; CONVEX_SNAPSHOT_ORACLE_SEED/PATH directly selects replay. | Identical property runs 60 fixed and 60 random histories; CONVEX_OWNERSHIP_ORACLE_SEED/PATH directly selects replay. | Stage, cold source, and rejected-acceptance properties each run 60 fixed and 60 random histories. CONVEX_OFFLINE_ORACLE, CONVEX_OFFLINE_SOURCE_ORACLE, and CONVEX_OFFLINE_ACCEPTANCE_ORACLE keep their seed/path bindings separate. | Each operation runs six fixed and six random histories against the same driver. CONVEX_BACKEND_INSERT_ORACLE, CONVEX_BACKEND_UPDATE_ORACLE, and CONVEX_BACKEND_DELETE_ORACLE each own their seed/path, preventing another operation's grammar from interpreting a recorded path. |
| ORC-008, model state | Retained last-valid rows are needed: a duplicate-key rejection followed by observation distinguishes replacement from preserving prior rows. No queue or transport state enters the model. | No stateful reference machine is introduced; admission is a direct identity-form judgment. Lifecycle checkpoints are production driver conditions. | The prefix computation is stateless. The cold source judgment distinguishes no valid source from a delivered valid source; these states allow different successful settlements. Rejected acceptance has failed-run/restarted-run reference states: cached or changed callbacks do not restore authority, while cleanup/restart does. | No stateful reference machine is introduced. The expected operation result and counter increment are recomputed independently from one logical write. |
| ORC-009, vocabulary | Source input and public Collection rows are named separately; retained expected rows mean the latest valid source snapshot. | Concrete owner identity, sync-run cleanup and DbClient materialization are explicitly distinct. | Source acceptance is distinct from visibility held by an optimistic transaction. Idle/pending/startup-error are declared driver starts, not a replacement Collection status enum. | Offline replay is distinguished from pagination replacement. Admission, server acceptance, replay completion, receipt key and application counter name concrete process/server observations. |
| ORC-010, failure fidelity | Shared withTestCleanup retains the primary failure and secondary release errors. | The helper enumerates admitted Collections at cleanup time and attempts every release. | The real-Collection driver's cleanup uses the same preservation helper; the stage driver owns no disposable resource. | The shared preservation helper protects backend bodies and attempts both client close and temporary storage removal. Child timeout/runtime failures are setup/process failures, not successful mutant kills. |
| ORC-011, second formulation | No concrete shared semantic-fault hypothesis remains after pairwise validity and direct source-array comparison; another copy is not needed. | No named shared semantic-fault hypothesis calls for another identity formulation. Real SDK support is a receiving witness, not a second ownership model. | No named shared semantic-fault hypothesis remains for the dependency prefix; the real-Collection receiving path repairs the prior stub assumption at a different boundary. | Equal final task rows could hide duplicate applications. The non-idempotent counter is the independent distinguishing formulation, while durable receipt-key equality also rejects key substitution. |

## Bug-class boundary and calibration

The original cold-replay defect violated source acceptance at
`bridge × idle/pending/failed startup × real Collection adapter × replay settlement`.
The repaired source driver rejects premature fulfillment before the first valid
snapshot, accepts empty snapshots, and distinguishes provider-error same-run
recovery from cleanup invalidation. Independent review found an adjacent hole:
a rejected durable proposal could leave the identity fast path clearing its
error on the same cached rows. The receiving fixture now defers core commit
behind durability rather than artificially rejecting after core acceptance.
Empty/nonempty proposals, one to four unchanged/changed retries, and a fresh
cleanup/restart distinguish terminal failed-base authority from provider recovery.
The nonterminal-guard mutant fails at the rejection checkpoint and repaired
fixed/random campaigns and direct replay pass. No known reachable counterexample
remains in these declared cells; no universal concurrency proof is claimed.

Backend calibration rejected all three hostile controls at intended observations:

- Applying a write twice while retaining one receipt fails the non-idempotent
  application counter, insert seed 20261022/path 0:0:0:1.
- Substituting `wrong-durable-key` fails equality with the admission record's key,
  update seed 20261022/path 0:0:0:0:0.
- Omitting payload only from the replay child's select projection fails its
  complete public-row comparison, with server payload still correct, using that
  same update replay path.

These were assertion failures after the legal target checkpoint, rather than
setup failures or timeouts. The author restored every mutant in finally and
reran the repaired operation-specific direct replays. The parent independently
reads durable bytes and server effects; the replay child observes its Collection.

## Remaining limits and verdict

The cold source driver establishes real Collection acceptance with a controlled
provider, not a cloud or local-backend cold replay. The backend replay fixture
preloads its Collection. SDK listeners receive the actual SDK cache and listener
ownership premise. None of these observations claims cross-Collection atomic
publication, continuous unbounded pagination, native browser storage power-loss
atomicity, or arbitrary coordination histories.

No confirmed contract defect remains within the reviewed boundaries. This is a
bounded verdict, not a proof of every legal provider or scheduler history.

## Additional numbered requirements

| Requirement | Snapshot | Ownership | Bridge, including cold source and rejected acceptance | Real backend receiving owner |
| --- | --- | --- | --- | --- |
| ORC-012, exact-head review evidence | This versioned record names the reviewed head and every applicable outcome above. Missing projection was challenged by a hostile control, not only by a new happy-path example. | The record separates concrete admission from SDK receiving evidence and bounds the claim to the generated identity forms and checkpoints. | The bug-class boundary, original early success, adjacent rejected-durable-base counterexample, wrong-design rejection and remaining provider limits are explicit. No unresolved reachable in-scope trace is known. | The record names the real host, legal SIGKILL cuts, independent effects, exact calibration observations, replay bindings and excluded coordination/power-loss boundaries. |
| ORC-013, distinguishing reusable boundaries | One valid key is admitted; two equal keys reject the complete snapshot and preserve the prior valid array. An absent optional field removes it after a prior present field, rejecting partial-row retention. Nonidentity projection rejects an identity-selector implementation. | Same concrete owner rejects before and after cleanup; fresh options and separate DbClients admit at those same checkpoints. The cleaned-up reuse case rejects the wrong rule that cleanup retires the options owner. | Pending first source cannot fulfill, while valid empty source does. Argument/mutation errors are terminal while post-confirmation sync errors remain retryable. Provider error can recover on a later valid result; rejected durable acceptance stays failed across unchanged/changed retries until a fresh run. Removing the terminal guards is rejected. | Two server attempts with one durable key produce one logical application. One receipt alone is not sufficient: the duplicate-effect mutant still leaves one receipt yet fails the counter. A same-count wrong-key receipt fails exact key comparison, and a server-correct/public-stale payload fails the child's public-row comparison. |
| ORC-014, controlled-premise handoff | Controlled arrays and successful projection exercise the adapter semantic boundary. SDK tests receive actual Convex decoding and listener delivery; backend select projection receives real documents. They are narrower receiving examples, not copies of this full generated source grammar. The source-array owner does not claim provider scheduling coverage. | The controlled fixture supplies cached data before the scheduled callback. Both actual SDK clients receive that cache window in sdk.test.ts. New sibling tests clean up either listener, then supply the next protocol transition and check the survivor, supplying the exact multi-listener premise the controlled fixture cannot. | Stub stage traces claim collaborator ordering/classification only. Cold and rejected-acceptance drivers use real Collections with controlled callback and receipt boundaries. The receipt fixture delays actual core commit behind durability, matching persisted.visibleAfterDurable. These drivers do not claim native SQLite failure or backend cold-replay coverage. SDK tests separately receive query/mutation timestamp ordering. | This owner receives actual local Convex query and mutation behavior and actual process death/storage reads. Its online and single-leader collaborators deliberately limit the coordination premise; native multi-tab election and OS online detection are not claimed. It does not reuse the bridge's stage-prefix model because durable restart, counter effects and server receipts are a different law and observation boundary. |

The SDK receiving examples use fixed protocol histories to observe the SDK's
cache, mutation timestamp and listener ownership premises. They do not share the
snapshot generator because their purpose is to receive those timing/ownership
conditions rather than repeat the complete snapshot law. Their fixed expected
selected text is derived from the explicitly supplied server text and projection.
The drift risk is that these examples do not receive every generated snapshot
shape; the generated owner remains the authority for those shapes at its stated
adapter boundary. Real-backend pagination and durable rows add provider-boundary
coverage without claiming the SDK fixture proves cloud availability.

The manually deferred receipt is limited to the documented acceptance interface.
A Convex Collection wrapped by a real SQLite persistence adapter failing its disk
write has not been exercised by this integration. That native combination belongs
to the persistence receiving boundary, not a claim made by this controlled driver.
The coverage map retains the persistence and offline-engine owners for their
storage, leadership and settlement laws.

