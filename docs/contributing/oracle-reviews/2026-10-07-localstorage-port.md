# LocalStorage oracle port audit

Reviewed implementation commit: `1c31dfe1ac897143743d222aebcf16de23261504`.
This record reviews the two new executable owners and the LocalStorage source
in that commit. A later documentation-only commit may carry this record.

## Laws and evidence

The LocalStorage guide promises direct persistence and peer synchronization.
Collection settlement and cleanup supply the shared boundaries. The order
owner folds accepted whole-row effects in mutation author order. Its finite
grammar crosses same/disjoint keys, both handler completion orders, all four
decision pairs, and update followed by delete. It compares caller settlement,
public rows, durable rows, and fresh restore. The original adapter fails both
second-handler-first update histories before it reaches the final comparison:
the later write reaches storage before the earlier decision. The new owner
rejects that wrong design at the held durable checkpoint.

The peer owner folds authored rows with typed IDs. It holds storage-event
delivery across two serialized disjoint writes. The original adapter loses the
first row for both numeric/string orders at the durable checkpoint. The same
owner checks manual acceptance with two initialized Collections sharing an ID;
the original adapter writes both rows into both stores. A controlled listener
host exposes the original cleanup leak at cleanup settlement and checks one
listener after restart. A pending local insert beside an accepted peer insert
checks that confirmation does not publish a duplicate source insert. That
check failed with the original insert confirmation after the mutation-order
change made the overlap reachable. All five peer cases pass in the reviewed
implementation. The production paths are `localStorageCollectionOptions`,
ordinary Collection mutation methods, `acceptMutations`, storage-event
delivery, cleanup, and restart.

## Oracle guide audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Both files state the public authority, promised law, checkpoint, and limits before mechanics. |
| ORC-002 | Expected rows come from authored scalar rows and accepted decisions. Neither model reads the adapter cache, stored values, or its classifier. |
| ORC-003 | Opening prose and nearby comments distinguish contract, model, finite history grammar, production driver, and refinement comparison. |
| ORC-004 | Not triggered: both grammars use finite enumeration rather than an important generated property. Same/disjoint keys, opposite completion orders, four decisions, and typed-key orders define their stated bounds. |
| ORC-005 | Each case invokes the real Collection adapter and compares promised public or durable observations at named held, settlement, event-delivery, restart, and restore checkpoints. |
| ORC-006 | Original-production RED runs reject out-of-order persistence, overwritten peer rows, equal-ID ownership, and leaked listeners at their intended assertions. The old confirmation also fails the pending-insert receiving case. |
| ORC-007 | Not triggered: neither owner claims a generated property. |
| ORC-008 | Not triggered: each expected result is a stateless fold of authored rows and decisions. |
| ORC-009 | Model typed IDs map to Collection row keys; authored arrays combine accepted source and public rows only at settled checkpoints. The pending-insert case observes them separately before settlement. |
| ORC-010 | Both owners use `withHistoryCleanup`; a primary mismatch and any cleanup failure remain distinguishable. No shrinking occurs. |
| ORC-011 | No plausible shared semantic fault requiring a second formulation was identified. Fresh restore provides a separate public observation, while authored rows remain the sole expected source. |
| ORC-012 | This record is tied to the reviewed implementation commit and accounts for each applicable guide requirement. |
| ORC-013 | Second-handler-first, delayed peer event, equal-ID Collections, and cleanup/restart each distinguish a plausible weaker boundary rule. |
| ORC-014 | No native-browser scheduling claim is made. The controlled host establishes adapter response to delivered storage events, not whether or when a browser delivers them. |

The registered `@tanstack/db` oracle campaign passed 67 files and 4,539 tests.
The affected LocalStorage suites passed 83 tests with typechecking; targeted
ESLint and the package build passed. These results cover serialized writes in
the controlled host. Simultaneous cross-tab read-modify-write races cannot be
made atomic with localStorage. Manual acceptance before the first sync run still
uses the existing ID fallback because the adapter does not yet have a Collection
reference. Arbitrary long histories and native browser event scheduling remain
outside these owners, as recorded in the coverage map.

## Prep review follow-up

The prep review found that a write-time storage or parser read failure was
treated as an empty snapshot. The two controlled failure histories reject that
implementation at the caller-settlement checkpoint: `isPersisted` fulfilled
while the previously durable row was replaced. The repaired adapter rejects the
write, retains the durable row, accepts a later independent write, and restores
both accepted rows in a fresh Collection. The same histories deliver a storage
event under a failed read and check that the public snapshot remains intact.
At that reviewed commit, startup remained best-effort; an absent storage key
was the only empty snapshot for a new write or event. The medium-review
follow-up below changes startup to fail on an unreadable snapshot.

The final `@tanstack/db` oracle campaign passed 67 files and 4,542 tests.
The full package suite passed 254 files and 9,103 tests with no type errors.
The package build, lint check, and changed-file formatting check passed.

The prep reviewer also identified a nested-handler dependency cycle. A
controlled probe admitted a second automatic write from the first handler,
then awaited the second receipt. Both transactions stayed `persisting` and
storage stayed empty until a separate signal released the first handler. The
mutation-order contract already chosen for this adapter makes that await
impossible to satisfy. The public guide names the limit. A neighboring oracle
history admits a nested write without awaiting it, then checks the held storage
cut and both ordered snapshots after release.

## Medium-effort review follow-up

Review intake head: `cd4b707beb533e278697981b7bcf05519c1b43b0`.
Reviewed repair head: `b94fea53c20b4ff89d891898d6792175cbc53f8a`.
The reviewer reported eight code-reading findings and ran no verification.
The user approved three contract decisions: fail malformed persisted restore
without changing stored bytes; make manual acceptance awaitable and ordered;
and publish removal of accepted rows when `clearStorage()` returns.

| ID | Technical verdict and evidence | Disposition and durable value |
| --- | --- | --- |
| M1 | Confirmed: a malformed value yielded a ready, empty, permanently unwritable Collection. Legacy arrays, empty strings, and one invalid row beside a valid row reproduced it. | `fixed-now`. Startup now rejects before readiness, preserves exact bytes, and can restart after explicit repair or clear. The peer oracle owns malformed and transient-read histories. |
| M2 | Confirmed dependency cycle when an earlier handler awaits a later same-Collection persistence receipt. A never-settling handler also holds the ordered slot. | `accepted-design`. Strict mutation order was approved earlier; the guide names the cycle and the order oracle checks legal nested fire-and-forget admission. No timeout or cancellation recovery contract exists. |
| M3 | Confirmed: manual acceptance could settle and write a newer value ahead of a held automatic handler, then the older value replaced it. | `fixed-now`. `acceptMutations()` returns `Promise<void>` and enters the same write order; callers await it. The order oracle crosses same/disjoint keys and both earlier-handler decisions. |
| M4 | Confirmed: handler-free insert, update, and delete returned before synchronous Storage was updated. | `fixed-now`. The order oracle checks each direct return boundary and a later handler-free write held behind an earlier handler. |
| M5 | The reported throws occur, but `null` is the Storage API's missing-key value. An existing empty string is malformed data; `undefined` violates the declared `StorageApi` type. | `refuted` as a bug. The peer oracle distinguishes null from empty content and requires failed writes to preserve the empty bytes. Treating empty as absent would lose data. |
| M6 | Confirmed: a later failed handler's receipt and optimistic rollback waited for an unrelated earlier handler. | `fixed-now`. The order oracle checks prompt failure and rollback at the held-handler checkpoint for same and disjoint keys. |
| M7 | Confirmed: `clearStorage()` removed durable rows but left them publicly visible, including after a later write. Direct same-tab raw Storage edits also have no browser event. | `fixed-now` for the supported utility; it now publishes removal locally, with a peer delivery and fresh-restore witness. Direct raw edits are outside the adapter's event contract and the guide says so. A pending optimistic mutation remains visible and may later persist under the Collection's existing contract. |
| M8 | Confirmed work count: a present-key write parses one full snapshot and stringifies another. No latency threshold or measured user regression was supplied. | `accepted-design`. Each write rereads storage to preserve intervening peer rows and reject read failures. Sharing a parsed snapshot across writes without detecting peer changes would break that law; no cache state was added. |

The primary order oracle derives expected rows from authored operations and
application decisions; it does not read the adapter's queue. Its driver reaches
the direct-call, held-handler, transaction-receipt, durable, public, and fresh-
restore checkpoints. The primary peer oracle classifies absent, valid, and
malformed bytes independently of the adapter parser and controls peer event
delivery. It checks startup status and byte preservation, clear publication,
peer publication, later settlement, and restore. These are bounded finite
histories, not a claim about simultaneous cross-tab read-modify-write races,
native event timing, or arbitrary long histories. The coverage map retains
those limits and the pre-sync manual identity fallback.

The original implementation failed M1 at the startup-readiness assertion, M3
at manual settlement while the predecessor was held, M4 at direct call return,
M6 at prompt failure settlement, and M7 at public/durable agreement after
clear. The repaired oracles pass 29 order and 15 peer cases, including nearby
accepted/rejected and same/disjoint regimes. The full `@tanstack/db` suite
passed 254 files and 9,119 tests with no type errors. The package build,
changed-file ESLint, Prettier, and whitespace checks passed. The docs link
checker reported 12 links outside `/docs` that already exist in the intake
head; this follow-up introduced none of them.

The review was high-signal for an unverified medium-effort pass: five real
product bugs, one useful invalid-data distinction, and two genuine trade-offs.
Its suggested missing-key fallback and shared-read optimization would weaken
data safety. Recommendation: retain this reviewer for code-reading discovery,
with executable verification required before accepting fixes. Loss audit:
eight raw items equal five `fixed-now`, two `accepted-design`, and one
`refuted`; no item is deferred or omitted.
