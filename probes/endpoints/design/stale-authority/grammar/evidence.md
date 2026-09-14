# Grammar evidence and controls

Version 1. Source-local analysis, not an empirical concurrency claim. Stable IDs below are used by the projection and later audit. No external case was supplied or sought as range evidence.

## Observation and inference ledger

E1 — **Source-stated proposal:** S1's isolated inline path, generation check, quiet read after handlers return, matching-instance requirement and read error exit. This supplies F0's intended sequence but not a complete implementation.

E2 — **Observed code:** runtime `pending` removes entries on `transaction.isPersisted.promise`, while core commit awaits `mutationFn` before resolving that promise. R4/I5 therefore require a separate handler-knowledge set. This is a static dependency fact, not an executed deadlock in the current code.

E3 — **Observed code:** server helper captures handler success/error, then reads, then returns both in one envelope. The client currently cannot observe an earlier handler-completion event. Network loss can hide both. S4's envelope is evidence of known completion when received; absence is not such evidence.

E4 — **Observed code:** initial QueryCollection queryFn directly records the response; mutation installation writes collections independently; collection creation is guarded during pending work. Proposed shared admission/lifetimes must cross these paths. No adapter capability was assumed or tested.

E5 — **Observed code:** rollback cascade targets `pending` conflicting transactions. Immediate Endpoints dispatch calls commit, putting siblings in `persisting`. It would be incorrect to claim every failure automatically rolls back every in-flight sibling. Publication/retirement are still separate and U3 remains.

E6 — **Prior evidence:** audit-fixes describes passing sequential histories, malformed envelopes and server/client exclusion. It explicitly does not prove concurrent response publication, initial-load support or lifetime-aware catch-up.

E7 — **Analyst inference:** F, the M/O distinction, captured target lifetimes, effect coverage and explicit B2/B3/B5 make causal links visible. These are candidate structure introduced by extraction. They are traced to preservation properties, not claimed to exist in code.

## Reconstruction controls

RC1 isolated: M starts, O appears, handler finishes, own result read completes, no competing local mutation or target-life change, R admitted, baseline installed, own O retires with its handler outcome. Reconstructs S1 under B2/B3. No concurrency proof follows.

RC2 overlap: A starts, B starts, B envelope arrives, A envelope arrives; both handler records known, neither uncertain inline snapshot taken as newer merely by arrival. A fresh R captures current epoch, A/B coverage and retained lifetimes; with no new action, install and retire covered records. Reconstructs the source's worked example; the order in which A and B actually commit is deliberately not inferred from starts or receipts.

RC3 invalidated read: quiet R starts; C mutation starts and advances epoch; R returns. Reject its values, retain obligations, await relevant handler knowledge, issue another R. Reconstructs the source's retry-after-new-work clause. Continuous repetition is the unresolved progress boundary B5/U2.

RC4 partial commit/error: A commits a statement then throws. Its received error envelope is a known handler outcome, not proof of rollback. A covering R installs the committed state before O is rejected. Reconstructs both S1 and the prior implementation's tested outcome split.

RC5 GC/recreation: R targets q/lifetime1. q is GCed, q/lifetime2 is registered. R cannot install into lifetime2 or discharge that instance's catch-up need. It may still cover other captured valid targets. Reconstructs the instance distinction; whether the entire response or only obsolete targets are discarded is an open policy, not a chosen priority.

RC6 new/loading query: C joins while A is pending. L2/I4 retain its need for authority; its own eligible read can satisfy it later. This reconstructs a catch-up obligation only. Exact optimistic values before support arrives and immediate mutations against it remain U4, not a reconstructed capability.

RC7 ordinary read: an initial/refetch response is an R, with no exemption from identity, epoch or observation coverage. The conceptual reconstruction passes; how to prevent the existing adapter from publishing before admission remains U6.

RC8 lost response: M remains outcome-unknown, so no read is silently stamped “after M finished.” This excludes unsupported authority but does not reconstruct a recovery mechanism. The source supplies none; U1/U8 mark that boundary rather than inventing an operation-status API.

## Ablation ledger

Every admitted unit, relationship and rule is checked; “breaks” below means a source relation or required distinction is lost, not a measured production failure.

| Item removed | Consequence | Control verdict |
| --- | --- | --- |
| C | Cannot distinguish q1 lifetime1 from q1 lifetime2 or track unloaded retained targets | Keep: P2/P9, RC5/6 |
| M | Handler-finished and receipt-settled collapse; unknown outcomes disappear | Keep: P3/P10, RC4/8 |
| O | No whole-snapshot ownership or per-action receipt to preserve | Keep: P1/P6, RC1/4 |
| R | Results lose observation and coverage provenance; admission reduces to arrival | Keep: P4/P5, RC2/3 |
| F | New actions cannot invalidate attempts or retain dirty obligations | Keep: P5/P11, RC3 |
| L1 | Handler wait can depend on persistence wait | Keep: I5, E2 |
| L2 | Late C or unknown actual recipients can vanish from catch-up | Keep: P2/P7, RC6 |
| L3 | A complete response may be mistaken for coverage of an unobserved effect | Keep: P5, RC2/8 |
| L4 | Same-key sibling snapshot can be treated as a field patch or erased | Keep: P6, U3 |
| L5 | Old result can attach to recreated identity | Keep: P9, RC5 |
| L6 | Atomicity is silently inferred from a loop of installs and retirements | Keep: P11, E4/U3 |
| R1 | No immediately dispatched action/epoch invalidation | Keep: P1, RC3 |
| R2 | Handler error or transport error becomes rollback/finished proof | Keep: P3/P10, RC4/8 |
| R3 | Lose source's isolated inline route | Keep: P8, RC1 |
| R4 | No post-overlap observation covering finished handlers | Keep: P5, RC2 |
| R5 | Source lifetime distinction cannot ensure new instance catch-up | Keep: P2/P9, RC5/6 |
| R6 | Stale/wrong-life/malformed data can enter authority | Keep: P5/P9, RC3/5 |
| R7 | Authority and overlay retirement can invert or erase sibling ownership | Keep: P3/P6, RC4 |
| R8 | Ordinary reads escape the claimed protocol | Keep: P9, RC7 |
| R9 | Errors can falsely close knowledge or retry committed writes | Keep: P10, RC8 |
| I1–I8 | Respectively lose local/server order, non-arrival admission, effect coverage, retained obligations, acyclic wait, conservative selection, immediate dispatch, or whole-snapshot constraint | Keep: P1–P11; each has a distinct excluded transition |
| B2/B3/B5 | Local quietness is silently promoted to server visibility or unconditional progress | Keep as boundary annotations, not new primitives |

A separate “cohort,” retry-manager primitive and server-version primitive were rejected: cohort/retry add no independent reconstruction work, while a usable server-version contract is unsourced. F1 is merged into F0 when potential dependencies are unknown. No modular substitution is claimed.

## Exclusion and range

NC1 constructed nearby negative: A's read observes value1; B writes value2 and a covering response installs it; A's older response arrives and overwrites value2 solely because it arrived last. R6/I2 exclude this state transition when local epoch/coverage exposes the older observation. This is a source-derived exclusion control, not independent range evidence.

NC2 constructed negative: a response for a GCed lifetime clears the recreated instance's dirty state. R5/I4 exclude it even if the endpoint declaration name matches.

NC3 constructed negative: HTTP rejection is treated as proof the handler cannot commit later. R2/I3 exclude the inference. Handling its liveness consequences remains unresolved.

RG1 range: **untested**. Every example here was used to reconstruct or explain the proposal. The queued fracture and hostile operations can test this frozen design but cannot retroactively become held-out grammar range validation.

## Generated forms

GF0 reconstructs global quietness from S1 under R1–R9. GF1 changes the impact/observation intersection using the already sourced distinction between complete dependency knowledge and unknown effects (S3 and prior grammar R4/R9). Unknown coverage collapses GF1 to GF0. Domain classification/merge state and its value remain unimplemented/unmeasured. No supported third transformation is present.
