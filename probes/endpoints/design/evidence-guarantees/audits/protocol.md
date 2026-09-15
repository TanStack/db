---
instrument: loss-audit
scanner: evidence_loss_protocol
date: 2026-09-15
reduction: ../02-research-survey.md
reduction_sha256: b31c3059af06b4afd40134577a60a50083c10f96b6088c4288eea35518e9e4b2
sources: [S12, S16, S17, S18, S23, S24, S25, S26, S19-Firestore-companion]
status: complete-bounded-pass
---

# Protocol and application-boundary loss audit

Nine assigned primary pages were reopened separately. Each source's candidate
losses were recorded before opening the next source. No sibling audit was read.
The frozen catalog's SHA-256 matched the supplied value. This file preserves
omissions; it does not rank them, select a design, or recommend restoration.

**Full** means the particular fact is absent. **Partial** means a broader claim
or source note survives while a condition, mechanism, or boundary is absent.
Locations below are named sections and line numbers in the web extraction on
2026-09-15; URLs remain moving documents. Each section identifies retained facts
to avoid counting them again as losses. Drop mechanisms are an inference from
the frozen reduction, not an observed history of the author's decisions. There
is no evidence here that majority voting or explicit rejection caused a loss.

## S12 — Replicache

[How Replicache Works](https://doc.replicache.dev/concepts/how-it-works).
Retained: server authority, rebase, legitimate client/server divergence (C8/E6).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P12a — Full | Different users must use different Replicache names to separate browser caches. *Clients, Client Groups, and Caches*, 64–72. | Category mismatch: C8 selects convergence; C10/C18 discuss authorization, omitting local data partitioning. |
| P12b — Partial | Server preserves each client's mutation order. Pull acknowledgments name mutations whose effects are included in the patch; those mutations are not replayed. *Local execution / Push / Pull*, 165–181. | C8 compresses settlement, dropping acknowledgment/effect coupling. |
| P12c — Partial | Mutators contain app-specific conflict policy, including rejecting a reservation already taken. *Conflict Resolution*, 198–205. | E6 retains intended semantics and differing state, but omits explicit concurrent-state conflict branches. |

**Transfer inference:** Inspection could establish user-to-cache key mapping,
an existing adapter's acknowledgment contract, or authored conflict behavior.
Ordering and rebase still require the protocol. No external exactly-once effect
guarantee follows from its canonical key/value mutation guarantee.

## S16 — PowerSync

[Consistency](https://docs.powersync.com/architecture/consistency).
Retained: complete checkpoints, acknowledgment, priority caveat, and application
upload responsibilities (C11 and S16 note).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P16a — Partial | A failed write can block the FIFO upload queue and thereby prevent checkpoint advancement. Applications choose how failures are acknowledged: block, discard, or persist elsewhere for later processing. *Validation and Conflict Handling*, 181–200. | Completion-focused compression in C11 drops the failure/liveness obligation behind the generic upload-responsibility note. |

**Transfer inference:** For an existing upload endpoint, evidence could trace
each rejection path and state whether acknowledgment means applied, discarded,
or durably queued. It could also identify a permanently blocked path. These are
different claims even if all return HTTP success. A policy choice requires app
intent; a certificate does not create queue progress or checkpoint machinery.

## S17 — Electric

[Writes](https://electric.ax/docs/sync/guides/writes).
Retained: `matchWrite` waits for arrival before retiring optimism; example-only
status (C11/S17).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P17a — Partial | Shared-persistent example matches insert/update by `write_id`, deletion by row ID, and sends the write ID to the API. *Shared persistent*, `matchWrite`/`sendRequest`, 581–625. | C11 drops the concrete correlation predicate and transport obligation. |
| P17b — Full | Rejection handling may clear only causally dependent writes. The through-database example instead clears all local writes and loses original interaction context. *Implementation notes / Rollbacks*, 1014–1040. | Successful-arrival framing omits rollback dependencies. |
| P17c — Full | Component-scoped, nonpersistent optimism can disagree across components and disappear on unmount/reload. *Optimistic state / Drawbacks*, 505–512. | Completion framing omits ownership and lifetime. |

**Transfer inference:** Evidence could trace a write identifier through an
existing endpoint, identify rollback dependencies, or inspect optimistic-state
scope. These examples do not prove that matching a row ID uniquely identifies
an operation. This audit does not claim the examples implement a complete sync
or failure protocol.

## S18 — Meteor

[Meteor API](https://docs.meteor.com/api/meteor.html), displayed v3.5.2.
Retained: reconnect retries and result/cache-settlement distinction (C12).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P18a — Full | `Meteor.isServer` restricts execution, not delivery of source to clients; sensitive code belongs in the server directory. *Meteor.isServer*, 681–697. | C12 selects protocol behavior; placement/confidentiality disappears. |
| P18b — Full | Remote exceptions are sanitized unless explicitly exposed as `Meteor.Error`/`sanitizedError`; local server calls retain actual errors. *Meteor.Error / Meteor.call*, 1019–1055. | C13's output-validation category omits error disclosure. |
| P18c — Partial | Docs suggest unique call IDs checked by the server, or `noRetry`, for reconnect repeats. *Meteor.methods*, 900; *Meteor.apply*, 1171. | C12 retains the warning but drops positive app mechanisms; E5 covers only effect-free retry. |

**Transfer inference:** Ordinary TS inspection could establish error-mapping
paths, client import reachability, or an existing deduplication contract.
Deduplication would need its own atomicity and retention premises; the page's
suggestion alone does not prove them. Execution placement alone cannot establish
code confidentiality.

## S23 — RxDB

[Replication](https://rxdb.info/replication.html).
Retained: deterministic order, retained deletions, reconnect resync (C16).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P23a — Full | Push compares assumed master state and returns actual master states for conflicts; default resolution selects master. *Document/transfer level / Conflict handling*, 75–85, 147–153. | C16 selects read completeness, dropping write preconditions. |
| P23b — Partial | Backend must replace untrusted client `updatedAt` timestamps or use another field. *Security*, 421. | C16 preserves ordering but drops clock authority. |
| P23c — Full | Push/pull modifiers can repeat and should have no side effects. *replicateRxCollection*, 256–265, 330–334. | E5's endpoint-prefix framing omits adapter transform replay. |
| P23d — Partial | Failed sends retry even when processing succeeded; backend must tolerate duplicates, potentially using write IDs/timestamps. *Error handling*, 403–405. | Generic retry warning survives elsewhere; C16 loses this adapter obligation. |

**Transfer inference:** Evidence could inspect compare/update coupling, timestamp
provenance, modifier effects, and duplicate handling in existing TS adapters.
These require distinct claims. Ordering alone does not establish write safety;
bounded tests do not establish all conflict outcomes.

## S24 — Zero

[Mutators](https://zero.rocicorp.dev/docs/mutators).
Retained: divergence, cached client reads, impurity permitted (C8/S24).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P24a — Partial | Credentials belong in trusted context derived from validated request sessions, not client-controlled arguments. *Context*, 258–274; *Implementing the Endpoint*, 516–518. | C10/E2 keep policy analysis but omit identity provenance. |
| P24b — Full | Thrown mutation is skipped with structured error and optimistic reversal; endpoint HTTP failure follows retry/auth handling. *Handling Errors*, 519–550. | C8 compresses sync, omitting error-layer semantics. |
| P24c — Partial | Existing-key insert is a successful no-op; missing-row update/delete do nothing. Null and undefined have distinct insert/update meanings. *Insert / Update / Delete*, 140–199. | E6 retains generic intended-semantic comparison but drops specific comparison conditions. |

**Transfer inference:** Evidence could trace actor identity, distinguish failure
layers, and describe an opaque write helper's no-op/default semantics. Server
checks remain authored; these facts do not establish intended authorization.
The endpoint examples without context are explicitly public-mutator examples,
not an authenticated template.

## S25 — LiveStore

[Syncing](https://docs.livestore.dev/building-with-livestore/syncing/), docs 0.4.0.
Retained: global ordering, backend identity changes, and unfinished-documentation
caveat (C17/S25).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P25a — Partial | Mismatch behavior is configurable: reset storage and stop; stop retaining stale data; or ignore and continue with stale data, effectively offline. *Backend Reset Detection / Configuring the behavior*, 302–325. | C17 retains detection but omits the consumer response. |
| P25b — Partial | Merge conflict handling is explicitly unimplemented. *Merge conflicts*, 266–271. | S25's generic unfinished-areas caveat drops the named absent guarantee. |

**Transfer inference:** For an existing identity-aware adapter, evidence could
bind its configured mismatch action and permitted stale-state use. Detecting a
changed dependency does not itself establish that a consumer stops using old
evidence. The unfinished conflict section supports a limit, not a positive
conflict-resolution guarantee or an invitation to implement one.

## S26 — LiveView

[Security considerations](https://phoenix-live-view.hexdocs.pm/security-model.html),
displayed v1.2.11. Retained: mount and privileged event checks, domain policy
remains authored (C18).

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P26a — Partial | Same-session navigation bypasses HTTP plugs; `handle_params` and LiveComponent events are also authorization paths. *Authentication vs authorization / live_session*, 27–30. | C18 retains every-entry-path principle but compresses its concrete bypass to mount/events. |
| P26b — Full | Logout/revocation does not itself refresh permanent connections. `live_socket_id` disconnect can trigger reconnection and mount revalidation. *Disconnecting all instances of a live user*, 168–186. | Entry-check framing omits the temporal revocation path. |

**Transfer inference:** Agent inspection could enumerate middleware bypasses and
trace revocation from server action to active-session invalidation in an existing
TS application. Having checked authorization when a request began is distinct
from having a defined revocation response. Transport disconnection and fresh
policy evaluation remain runtime behavior.

## S19 companion — Firestore

[Transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions).
Retained: callback reruns and prohibition on application-state mutation (S19
companion note). Those are not new losses.

| Loss | Source-supported item and location | Where and how it vanished |
| --- | --- | --- |
| P19a — Full | Transaction reads must precede writes; offline transactions fail. Write batches need no read validation and execute offline. *Updating data with transactions*, 449–452; *Batched writes*, 1763. | Companion compressed to the rerun counter-check, omitting operation-specific preconditions. |
| P19b — Full | Mobile/web security rules can use `getAfter()` to validate related documents' post-operation state before commit, enforcing atomic paired updates. *Data validation for atomic operations*, 1766–1789. | Companion compression omits post-state invariants; C10 concerns access policy and E3 concerns transaction participation. |

**Transfer inference:** Evidence could describe an existing helper's read/write
order or verify an authored cross-row invariant inside an existing transaction.
Supplying the invariant requires app intent. Merely establishing that all writes
share a transaction does not establish the invariant, and ordinary TS evidence
does not supply Firestore's precommit enforcement.

## Access and confidence limits

All nine requested URLs returned primary documentation; no access failure was
encountered. Reads covered the cited guarantee-bearing sections and examples,
not every API method or linked implementation. No deployed runtime was tested.
The tools' extracted lines are retrieval locations, not permanent version pins.
Source authors' claims and illustrative code are preserved as such.

Each assigned source has a trace above; none produced a null in this bounded
pass. This does not claim exhaustive recovery. One fresh scanner handled these
nine sources sequentially with sibling agent notes hidden; earlier source reads
remained in its context. Shared model tendencies and the frozen catalog's labels
can correlate omissions across agents. Independent re-reading reduces direct
consensus pressure but does not provide independent empirical confirmation.

Replication, rebase, and new sync-engine implementation remain outside the task.
All transfer paragraphs are hypotheses about facts inspectable in existing code,
not certificates issued for Endpoints or restoration decisions.
