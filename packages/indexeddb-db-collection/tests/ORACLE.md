# IndexedDB oracle contract and audit

This suite replaces the original CRUD and cross-tab examples. Its design follows
the local-storage rejection/successful-suffix tests, SQLite persistence ledger
and restore oracles, and offline-transactions IndexedDB settlement owner.
Their laws inform this suite; their host guarantees do not transfer to fake-IDB.

## Owners and checkpoints

| Owner                               | Independent judgment                                                                                               | Production path and checkpoint                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| persistence-oracle.test.ts          | Two arrays of authored rows, keyed by store and typed key                                                          | Automatic CRUD, manual acceptance, clear/import, cleanup/restart and fresh restore. Compare public, subscription, peer, export, raw durable rows and version ownership after settlement and explicit message delivery.                           |
| settlement-oracle.test.ts           | Before/after snapshots selected by application decision; source deletion survives removal of an optimistic overlay | Held handlers, resolve/reject, clone failures at either position in a batch, IDB aborts, populated restore, remote delete/clear during pending local deletion. Observe handler entry, settlement, source delivery, successful suffix and reopen. |
| transport-oracle.test.ts            | Authored durable operation order; union of disjoint writes; exclusion of self/foreign messages                     | Delayed CRUD and replacement, inactive utility writers, database-wide deletion, and initial-load cleanup/restart. Compare raw durable rows, every affected Collection and fresh restore after controlled delivery.                               |
| compatibility-oracle.test.ts        | Authored rows per store; independent DbClient sync runs; untouched-store version ownership                         | Crypto capability, reusable descriptors and injected factories without ambient IndexedDB globals. Compare public, peer and durable rows after writes, cleanup, replacement and restore.                                                          |
| wrapper.test.ts                     | Callback success AND native transaction completion are separate obligations                                        | Request success followed by abort; callback settlement after transaction completion; exact error identity, multi-store rollback, request values, upgrades and deletion.                                                                          |
| api.test.ts and indexeddb.test-d.ts | Configuration, schema and type contracts                                                                           | Synchronous validation, reserved metadata store, transformed import inputs, duplicate rejection, utilities and precise API types.                                                                                                                |

harness.ts owns setup, raw IDB requests, controlled transport and cleanup. It
supplies the provider and transport, never expected product results. It removes
only the five documented virtual fields. Row comparisons preserve multiplicity,
typed keys, values and extra user fields. An absent optional property and the
same property with value undefined are equal in this model's value domain.
Object-property presence is not claimed.

The model combines source and optimistic snapshots only at settled checkpoints.
The boundary owner keeps the unresolved decision separate because resolve/reject
distinguishes it. Store and typed-key identity cannot be combined: same-key manual
transactions distinguish ownership. Versions are durable observations, not a
second version generator. Changed values require a new version; unrelated keys
preserve theirs. An authored no-op may preserve or refresh a version; no public
law specifies which.

## Grammar, reconstruction and calibration

Histories have 0–20 actions, one initially populated store and one empty store.
Keys are numeric 0/1 and string "0"/"1"; values range from -2 to 2; an optional
field is present or removed. Actions are write, delete, clear, import, reopen,
and manual acceptance. Write chooses a legal insert/update using model
membership. Empty-store delete first inserts. Import chooses empty or one-row
replacement. Manual acceptance writes overlapping keys with distinct values in
two stores. Every history ends with fresh restores.

The authored reconstruction history visits every action in both stores.
Pinned cases retain generated update/clear and repeated no-op histories.
Matrices reconstruct CRUD × decision, persistence-entry × bad-row-position,
and remote delete/clear × local rollback/commit. Transport cases retain the old
rapid/concurrent and routing coverage and add the twelve histories below.
Missing-key updates and duplicate imported keys have explicit rejection witnesses.

Each axis contributes independently:

- Typed keys distinguish number/string identity.
- Two stores distinguish ownership and clear isolation.
- Changed fields distinguish update/version and source-value laws.
- Replacement distinguishes empty/nonempty stores, reused keys and stale rows.
- Reopen distinguishes hydration and rejected-write leakage.
- Held decisions distinguish premature durability and broadcasts.
- Later bad rows distinguish atomic rollback from prefix commit.
- Pending local deletes distinguish source deletion from optimistic visibility.
- Raw durable reads reject optimistic-only false greens.
- Request/transaction cuts distinguish request success from persistence success.
- Delayed replacement crosses later disjoint writes before notification delivery.
- Idle and cleaned-up utility writers distinguish notification ownership from sync-run ownership.
- Database deletion distinguishes store-scoped replacement from effects on every store.
- Runtime capabilities and two DbClients distinguish ambient assumptions and shared closure state.

Permanent checker controls reject missing/duplicate rows, wrong key types and
extra user values. Original-source witnesses fail at public/durable checkpoints.
A per-row-transaction mutant reaches clone failure and fails durable-prefix
assertions for automatic and manual writes. An earlier partial-row sync mutant survived:
Collection edits represent removal with undefined, so partial and full updates
are equivalent for those bounded inputs. This survival is not proof for arbitrary
partial-row compatibility. The adapter declares full rows because it reads and
confirms whole durable snapshots.

Atomic failed replacement is an explicit repair decision: import preserves the
existing snapshot and versions if validation or persistence fails, strengthening
the original clear-then-write implementation. The test and README carry that
decision together. Separate per-Collection acceptance calls are not atomic
across Collections.

## Repaired boundary laws

The transport owner adds twelve legal histories: clear/import × FIFO/reverse/
duplicate delivery after a later disjoint receiver insert; idle/cleaned-up
writer × clear/import; manual acceptance after cleanup; and database deletion
with active same-store and sibling-store Collections. The authored storage order
predicts rows independently of notification order. Each case compares native
rows and a fresh restore before checking every affected public Collection.
All twelve failed at those public checkpoints on the prepared implementation
and pass after repair. FIFO alone establishes the delayed-replacement defect;
reverse and duplicate schedules are controlled challenges, not native-host claims.

Manual acceptance after cleanup uses a real transaction authored while active.
Public mutation authorship starts sync, so the grammar does not fabricate an
initially idle Collection with an already-authored mutation. The exclusion
witness gives storage an unseen row before sending self/foreign notifications;
wrongly receiving one must visibly change the public snapshot.

The compatibility owner crosses full crypto with getRandomValues-only crypto
through construction, persistence and notification. It materializes one
first-party descriptor in two DbClients, retires either sync run, then checks
the survivor and a fresh client. Injected-factory cases remove ambient indexedDB
and optionally IDBKeyRange, restore three stores with typed keys, and replace/
clear each store while checking untouched rows and version entries. An
unchanged-version superset case distinguishes requested stores from native stores.
These are finite compatibility cases, not server-side or browser-host evidence.

Three oracle repairs strengthen existing laws. Retained imported keys with
changed values now enter the version-change comparison. Production receives
copies of bounded scalar inputs, leaving authored model rows independent.
Every held-handler outcome gets an ordinary insert suffix and public/peer/raw/
fresh-restore checks before a separate full replacement can erase leaked data.
Old checker copies accepted retained wrong versions and mutated authored inputs;
new copies reject them. The old suffix grammar never activated the injected
ordinary-write leak; the new grammar reaches it and rejects all three rejected
CRUD outcomes. Accepted-handler controls remain green. See ORACLE-EVIDENCE.md
for exact receipts and the source-alias limits of those calibration runs.

API limits remain explicit. Store declarations add requested stores; omissions
do not remove existing stores. The descriptor lists requested names, while
getDatabaseInfo reports native names. Low-level wrapper failures use ordinary
or native errors. Contextual wrapper errors retain the native error as `cause`. Observed callback errors retain identity. Awaiting
unrelated work cannot keep an IDB transaction active, and a rejection after
native commit cannot roll back already durable rows. The readwrite late-callback
witness observes that durable boundary directly.

Open and database deletion settle only at native success/error. A blocked event
is nonterminal. The wrapper grammar crosses blocked/unblocked requests and
checks that a successful open transfers connection ownership to its caller.
Closing that returned connection must permit later native upgrade and deletion.
Native failed opens preserve durable rows and schema and permit successful next
use. The transport owner observes a real blocked utility deletion: caller
pending, every public snapshot retained, durable rows retained, and no deletion
notification. After native success, caller fulfillment and delivered deletion
empty every affected public snapshot and a fresh database. A factory failure
before deletion is issued preserves rows and sends no success notification.

These laws transfer the offline IndexedDB settlement distinction and OPFS
resource-ownership checks to the IDB request boundary. They do not transfer the
OPFS worker's cancellation mechanism: native IDB open/delete has no cancellation
API. This adapter has no deadline or automatic in-memory fallback. An unmanaged blocker
that never closes can leave the request pending indefinitely. The receiving
cases use fake-IDB and controlled notifications, not native-browser lock proof.

## Managed connection ownership

`createIndexedDB` closes its connection on native `versionchange`. This releases
managed peer connections so another context can upgrade or delete the database.
The wrapper's raw connections keep the separate blocked-request contract. Closing
a managed connection does not restart a Collection or invent a new Collection
status. Further persistence through that descriptor rejects; callers recreate
Collections with a new descriptor using the current database version.

The transport owner crosses two/three independent descriptors with upgrade/delete.
Source, same-store peer and sibling-store peer stay active until native completion.
Exact versionchange recipients establish the reach witness. A native blocked event
records a violation before fixture rescue closes the owned handles, so missing
automatic close fails a deterministic zero-blocked assertion instead of timing out.
Deletion then publishes empty snapshots. Upgrade retains rows/version, rejects
old-descriptor writes without optimistic leakage, and permits new-descriptor
restore and writes in retained and added stores. All four histories fail without
the listener and pass with it. Application notification APIs remain unspecified. The extension below receives
native scheduling and held read transactions; adapter writes already in flight
at versionchange remain a separate receiving boundary. No elapsed-time bound or automatic restart
is implied by these controlled histories.

## Campaigns and direct replay

The normal test command runs the same property, generator, recorder, driver and
30-run budget twice: fixed seed 1179001, then no supplied seed. Each campaign
reports its actual seed, run count and outcome. Fast-check reports counterexample
and shrink path; verbose output retains failed histories. A reduced trace proves
its reported checkpoint; do not label a reduction a reproduction of a different
facet without replaying both.

From this package directory:

```sh
INDEXEDDB_ORACLE_SEED=1179001 INDEXEDDB_ORACLE_PATH=0:1:0:0:2:2 \
  pnpm exec vitest run tests/persistence-oracle.test.ts \
  -t 'replay histories' --coverage.enabled=false --typecheck.enabled=false
```

Replay selects only that campaign without fixed/random execution first. This
uses an array arbitrary, not fc.commands, so command replayPath does not apply.
Those coordinates reproduced the original clear failure at the public snapshot
checkpoint and pass with the repair. The update/clear counterexample is also a
permanent authored case. Cleanup captures the primary error before releasing
Collections and database handles; secondary failures use AggregateError with
the primary as cause.

## Guide audit

| Requirement | Evidence                                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001     | Contracts and limits precede mechanics in executable owners. Authorities: Collection settlement, package APIs and IDB transaction semantics. Atomic failed replacement is documented above.                                                    |
| ORC-002     | Authored arrays, detached scalar inputs, decision-selected snapshots, disjoint union and separate settlement obligations do not reuse production semantic machinery. Raw IDB observes durability independently.                                |
| ORC-003     | Each owner explains contract, model, grammar, driver and refinement cuts; the mechanical companion is directly named.                                                                                                                          |
| ORC-004     | Bounded domains, reconstruction witnesses, axis ablations and nearby rejected inputs appear above and in tests.                                                                                                                                |
| ORC-005     | Exact rows, handler/message counts, transaction outcomes, status and durable versions are observed at named cuts. Each generated action plus startup reaches a checkpoint.                                                                     |
| ORC-006     | Wrong-snapshot controls, original red histories, prefix-commit mutant, retained-version and input-mutation controls, and ordinary-suffix leakage controls reject at named cuts. Old suffix non-reach and partial-row survival remain distinct. |
| ORC-007     | Fixed/random 30-run parity, actual completed-campaign output and checked direct seed/path replay.                                                                                                                                              |
| ORC-008     | Settled source/optimistic state collapses only where indistinguishable. Held decisions, source deletion, store and typed-key identity retain distinguishing next actions.                                                                      |
| ORC-009     | Shared vocabulary follows the glossary. Model projections are mapped in executable prose and above.                                                                                                                                            |
| ORC-010     | Cleanup preserves primary and secondary errors. Verbose histories retain original/reduced inputs; evidence distinguishes actual replay from setup errors and does not credit changed facets as the same failure.                               |
| ORC-011     | Named shared-fault risk: trusting adapter export as proof of storage. Raw native reads and fresh Collection restore are separately observed formulations of the same unordered keyed values, preserving multiplicity.                          |
| ORC-012     | This audit and ORACLE-EVIDENCE.md identify the reviewed snapshot, red/green observations, mutants and remaining cells. No universal bug-class closure is claimed.                                                                              |
| ORC-013     | Held versus released/rejected, request success versus abort/complete, first versus later bad row, and populated versus empty startup distinguish the bounded laws.                                                                             |
| ORC-014     | Claims stop at fake-IDB and controlled transport. Native browser scheduling, failure shapes and crash durability remain unresolved under this package's coverage-map ownership.                                                                |

## Remaining boundaries

These are coverage limits, not retired obligations. No universal bug-class
closure is claimed. The receiving owners need these distinguishing witnesses:

The original portfolio's gaps in three-owner acceptance, middle-row failure,
whole-row omission and raw/downstream observations are addressed by the bounded
extension below. Its remaining-boundaries section and the repository coverage
map are the current gap inventory.

Same-key concurrent writers still need an explicit conflict policy and receiving
witness. Separate per-Collection acceptance calls do not promise cross-Collection
atomicity. Nested input mutation requires its own copy/identity policy beyond
the bounded scalar model.

A known pre-existing core counterexample also remains open (HC005): numeric 0
and string "0" authored in one Collection transaction can collapse in the
mutation payload before this adapter receives it. The core payload owner is
packages/db/tests/optimistic-transaction-oracle.property.test.ts; its relevant
grammar uses numeric keys. It needs same-string-representation typed keys in one
transaction, exact handler payload multiplicity/keys, and public/durable
observations through an adapter. The package compatibility owner preserves typed
keys in restored/imported rows and separate accepted operations; it does not
claim this same-transaction boundary is closed. No adapter workaround is added.

## Concurrent-history extension

The executable companions keep distinct responsibilities:

| Owner                                                                            | Model and checkpoint                                                                                                                                                                          | Bound                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cross-tab-oracle.ts`, `cross-tab-driver.ts`, `cross-tab-history-oracle.test.ts` | Authored durable ledger and independent per-Collection public snapshots; whole read effects explain every raw publication in one increasing history                                           | 30 fixed + 30 fresh histories; three Collections/two stores, 0–20 operations; stress uses 300+300, five Collections, up to 100 operations                                  |
| `cross-tab-boundary-oracle.test.ts`                                              | Stale-peer admission, genuine optional-field omission, caught/spurious/obsolete status, overlap and atomic replacement                                                                        | Positive boundary witnesses, partial-row and status controls, serial-fixture non-reach; 16 sender/delivery schedules in the history owner                                  |
| `pending-history-oracle.test.ts`                                                 | One held multi-row intent, durable rows, exposed base, queued source batches and acknowledgement attribution; public/raw/downstream snapshots at handler entry, each peer step and settlement | 24 CRUD × peer action × decision cases, with all actual peer CRUD operations reached; 30+30 generated histories of up to four peer actions, 1–3 local rows; stress 300+300 |
| `persistence-oracle.test.ts`                                                     | Three distinct Collection owners, mixed deletes/inserts, two stores and version isolation after each acceptance                                                                               | All six acceptance orders; no cross-Collection atomicity or same-ID identity policy                                                                                        |
| `settlement-oracle.test.ts`                                                      | Failure before, within and after valid rows in a three-row native batch                                                                                                                       | First/middle/last clone failures × automatic/manual/import, with populated replacement rollback                                                                            |
| `e2e/cross-tab-oracle.spec.ts`                                                   | Native IndexedDB and BroadcastChannel, independent same-origin pages, runner-owned raw evidence                                                                                               | Chromium, Firefox and WebKit; pinned receiving matrix and 10 fixed + 10 fresh histories per engine                                                                         |

The transport model combines exposed base and public rows only when local
mutations have settled. The pending companion keeps them separate. It adapts
`packages/db/tests/optimistic-history-oracle.ts`: ordinary source work queues,
replacement drains, active whole-row intent overlays the source, and source
confirmation receives row attribution once per drain. A confirmation queued at
settlement remains eligible after an earlier replacement touched the key. An unchanged Collection update
authors no mutation; it cannot contribute a second acknowledgement. Accepted
writes in this grammar have an explicit durable order: peer persistence finishes
before the held local handler is released. This does not assign a winner to
unordered same-key writers.

A notification starts a new read of current durable values. Expectations use the
authored ledger at the read window, never observed payloads, versions or returned
rows. Several whole effects may coalesce. Every raw event must still be valid for
its subscriber's prior state, including key type, multiplicity, kind, value and
previous value; callback-time rows must agree. The pure checker rejects transient
partial publications even when a later publication repairs the final snapshot.
Collection status is observed independently of receiver promise fulfillment.

The old settled fixture awaited each callback and could not expose concurrent
readonly completion. `Channel.dispatch` and its completion receipts now separate
those cuts. A native readwrite transaction issues real requests while held; reads
queue behind its scope. No IDB transaction waits on an unrelated Promise.
Retained old callbacks execute after cleanup, so the fixture cannot supply the
adapter's invalidation guard for it. Failure cleanup retains the primary error.

### Defects exposed by the extension

- Import sent both replacement and targeted notifications. A targeted read could
  finish first and briefly publish the union of old and imported rows. The
  controlled publication witness and Chromium generated histories failed before
  repair. Import now sends one replacement notification.
- A delayed local insert could persist after a peer inserted the same key, then
  reject when source confirmation attempted a duplicate insert. The held-intent
  oracle failed at caller settlement. Confirmation now uses the existing full-row
  update contract, matching the adapter's accepted `put` snapshot. Controlled
  neighboring CRUD/replace histories and native ordered-peer witnesses receive
  the repair.

The first fix removes one notification; the second changes the confirmation
operation. Neither adds a queue, retry, fallback or lifecycle state.

### Native receiving and evidence

Native tests prove overlap with callback entry/completion and pending readonly
transactions. Two ordered imports are admitted before a test-owned blocker;
both notifications start real reads while that blocker remains live. A mutant
splits a replacement only after this overlap is reached, then repairs it. The
runner receives immutable raw events with document/instance/sync-run/sequence
identity before closing the page while its application handler is still pending.
The checker retains the original atomic-publication failure after page close;
dropping an export fails the evidence-capture control. Replay checks input
reconstruction, premise reach and the same law/checkpoint separately.

Other native witnesses cover delete/reinsert omission via an ordinary update,
startup subscriptions crossed with a peer write, managed versionchange with a
held test-owned transaction, an unmanaged deletion blocker, active/obsolete read
aborts, write abort after request progress, fresh restore, and accepted/rejected
held intent after peer persistence. A test-owned `abort()` exercises a real
native abort, not quota exhaustion. No public error status is invented for
versionchange itself. Closing a managed descriptor still requires recreation.

`campaign.ts` records seed/path, original and reduced histories, reached premises,
expected/actual mismatch, replay outcome, base commit, fast-check version and
fixture/engine identity in `test-results/oracles`. Reduction retains the original
law/checkpoint and required premises. A captured native failure remains a failure
if replay cannot recover its timing. Browser attachments retain raw events and
cleanup errors outside the page. CI uploads these artifacts even on failure.

```sh
pnpm test:oracles
pnpm test:oracles:stress
pnpm exec playwright install chromium firefox webkit
pnpm test:browser
# Direct selected history; fixed/fresh campaigns do not run first:
TANSTACK_INDEXEDDB_ORACLE_SEED=<seed> TANSTACK_INDEXEDDB_ORACLE_PATH=<path> pnpm test:oracles
TANSTACK_INDEXEDDB_PENDING_SEED=<seed> TANSTACK_INDEXEDDB_PENDING_PATH=<path> pnpm test:oracles
TANSTACK_INDEXEDDB_BROWSER_SEED=<seed> TANSTACK_INDEXEDDB_BROWSER_PATH=<path> pnpm test:browser --project=chromium
```

### Remaining boundaries

These are bounded refinement checks, not a proof against every interleaving.
The transport grammar completes writes before concurrent read windows; the
pending grammar has one local intent and ordered peer work. Reads straddling
unordered writes, several simultaneous local intents, adapter writes in flight
at versionchange, cleanup's pending mutation caller/confirmation policy, same-ID
manual ownership, lost notifications after suspension, post-durability send
failure (AUX01), nested mutable input identity, quota, eviction, physical crash
durability and uncontrolled page discard remain open. The controlled destruction
protocol does not observe an unacknowledged last event before a crash. HC005,
the core typed-key mutation-payload counterexample, remains under its core owner.
The coverage map names the needed witnesses; none is waived by random green.

## Local ordering and review boundary extension

The maintainer approved mutation-order persistence for automatic writes in one
Collection. `local-write-order-oracle.test.ts` keeps an independent fold of
whole-row effects in author order, omitting rejected handler positions. Its 146
bounded cases cross same/disjoint keys and delete/reinsert, all six completion
orders, all eight decisions, a held predecessor, and synchronous handler reentry.
Caller outcomes, raw durable rows, peers and fresh restore are separate cuts.
No manual or cross-Collection ordering follows from this law.

The compatibility owner adds id changes at options and Collection construction,
with automatic/manual acceptance and acceptance after cleanup. The transport
owner separates row membership from none/mixed/all initial version metadata,
checks duplicate delivery and typed keys, and excludes malformed protocol
messages before reading storage. An unseen durable row establishes that a valid
neighboring message still works. Connection-scoped deletion requires a native
deletion signal on the affected descriptor. Holding the old native success
callback across recreation checks that a fresh Collection keeps its own rows.

The wrapper owner compares native error causes, including request-error identity
and cross-realm synchronous failures. The settlement owner counts request
admission for empty/single/bulk import before the first write succeeds, while the
existing abort matrix proves atomicity. No elapsed-performance claim is made.

Native ordering and deletion/recreation witnesses run in all three engines.
The native omission witness uses two explicit manual acceptance calls to queue
both write transactions before a test-owned read blocker. It retains its
non-truncating full-row comparison. Automatic writes intentionally wait for
their predecessor; they can no longer supply that old fixture schedule.

Runtime/type tests resolve workspace source with no dependency build. The
separate package lane compiles published ESM/CJS consumers after complete builds.
The review evidence and guide audit are in
[`2026-10-05-indexeddb-xhigh.md`](../../../docs/contributing/oracle-reviews/2026-10-05-indexeddb-xhigh.md).
