# Model layer — frozen exploratory grammar v3

The extraction target is the **authority handoff** from an on-demand persisted
cache claim through a provider-session restart to public and durable rows. The
source is the cache-eviction design, the project glossary, the reviewed PR
record, and the current SQLite, persistence-wrapper, Query, and Electric
implementations at `d3d617273`.

| ID  | Surviving unit and TLA+ projection                                                       | Why it survives ablation                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Persisted cache generation and one current head: `claim`, `head`, `lastGen`, `durable`.  | Without a head separate from a run's claim, private expiry recovery and a warm peer cannot coexist.                                                                  |
| M2  | Expiring persisted cache claim: `live`.                                                  | Without live authority, a read admitted earlier can publish after expiry and an expired claimant can advance the head.                                               |
| M3  | Run-local resume authority and whole-generation key-set evidence: `resume`, `certified`. | A claim permits access but does not certify rows; one partial source snapshot must not certify the full generation.                                                  |
| M4  | Distinct loss events and recovery starts: `lossSeq`, `lossKind`, `startedSeq`, `reason`. | Collapsing an enduring uncertified state with a new event created a phantom second rotation. `reason` retains the event being recovered while a later event arrives. |
| M5  | Provider-session provenance: `session`, each `job`'s captured session and claim.         | Without both captured identities, an old asynchronous response can be stamped into replacement storage.                                                              |
| M6  | Logical subset owner and request settlement: `owner`, `need`, `request`.                 | Ownership may outlive one completed request; a failed restart must settle a pending caller, and active ownership requires fresh work.                                |
| M7  | Awaited cache read: `read` captures the generation before its second authority check.    | A single atomic read cannot express expiry during the await.                                                                                                         |
| M8  | Separate public and durable observations, with violation flags.                          | A late cache read can corrupt only public state; a late provider response can corrupt both. Event flags retain transient failures after later repairs.               |

The active overlap is **M2 × M3 × M5**: a provider result is usable only if
its session is current, its captured claim still belongs to this run, and no
loss event is awaiting recovery. Generation retirement alone does not revoke
another run's live claim. The `job` is a model source-fetch token, not a
one-to-one production transport or acquisition lease. `reason`, `need`, and
the event counters are model abstractions, not Collection status values or
copies of production counters.

| ID  | Operative rule or constraint                                                                                                                                             | Authority and status                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A fresh claim attaches to a generation; one head accepts new claims, while a warm run may retain a live claim on a retired generation.                                   | Cache-eviction design, source-stated.                                                                                                                                  |
| R2  | Expiry or incompatible resume creates a loss event. The modeled event closes old-result admission before recovery awaits; a separate start retires the provider session. | Source-stated at the wrapper's recovery-entry boundary; mapping an upstream provider message to that entry is outside this model. The event/start split is model-only. |
| R3  | Rotation by a **live** head claimant may advance the head; an expired or stale claimant gets private empty storage.                                                      | SQLite rotation transaction, source-stated.                                                                                                                            |
| R4  | An awaited cache read rechecks its claim, resume authority, and generation before public use.                                                                            | Persistence and SQLite claim law, source-stated.                                                                                                                       |
| R5  | A provider result applies only for its captured run, claim, and current provider session. A successful demand needs applicable evidence.                                 | Query/Electric demand contract, source-stated.                                                                                                                         |
| R6  | One subset response does not certify the entire persisted cache generation.                                                                                              | Cache-eviction design, source-stated.                                                                                                                                  |
| R7  | A provider restart failure changes a pending request to error; abort ends ownership for that caller.                                                                     | Review repair law and established settlement contract, source-stated.                                                                                                  |

The model does not assign these units to independent software modules. Claim,
session, and demand authority intersect at publication and settlement; a
tree-shaped decomposition would erase that intersection.
It fixes the two initial runs' claims rather than modeling later new-run claim
registration. The head is observable in the model, but fresh claim routing is
a separate SQLite receiving obligation.

## Adjacent forms

| ID  | Transformation route                                                                  | Changed boundary and preserved properties                                                | Cost or loss                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Rule combination: expire A's claim while B remains warm.                              | A rotates privately; B retains its public row and claim. R1–R5 remain.                   | More generation storage until old claims release or expire; physical collection is outside this model.                                       |
| A2  | Rule combination: invalidate A's resume evidence while its claim is live on the head. | A advances the head; B's existing claim and row survive. R1–R6 remain.                   | Later new runs cannot claim B's old cache, even if B remains valid.                                                                          |
| A3  | Pattern unfolding: a second distinct loss after A's first recovery.                   | A's middle-session fetch is delivered after a second rotation and ignored. R2–R5 remain. | The model coalesces recovery calls that start before either storage rotation finishes; it does not count their physical storage or receipts. |
