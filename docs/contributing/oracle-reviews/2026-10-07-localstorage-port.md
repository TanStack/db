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
Startup remains best-effort; an absent storage key is the only empty snapshot
for a new write or event. The final peer oracle passes both cases.
