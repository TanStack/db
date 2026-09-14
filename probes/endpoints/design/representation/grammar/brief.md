# A shared description needs separate claims

The representation can connect queries and mutations without treating a client's guess as a complete account of the server's effects. It needs to describe a scoped query, row effects with their provenance, the transaction that owns a guess, the retained collection instance, and the authoritative response. Local propagation and server read selection use different evidence even when they refer to the same rows.

Every affected collection that has not been garbage-collected participates, whether or not it has subscribers. Both generated forms preserve ordinary writable collections, synchronous actions, existing transaction snapshots, and server-code separation. Neither introduces a mutation queue.

Two ownership forms remain possible. One keeps separate query results and applies a supported guessed row effect to each result through normal DB transactions. The other factors shared supporting relation state beneath writable query results. The first adds coordination and baseline bookkeeping; the second adds coverage, support retention and inverse-write obligations. These are unranked forms, not proven interchangeable modules.

The useful boundary is support, not merely syntax. An inserted full row can determine membership in a simple row predicate. Deleting a top-k row cannot reveal an unseen replacement. A join can need unchanged rows absent from the client. In those cases exact local propagation remains unsupported; server evaluation can still return full authoritative results with the mutation.

Unknown actual effects require conservative read selection. Returned target rows alone do not certify that other tables were untouched. The independent choices to skip reads, derive results, send patches, share SQL or share response rows need their own evidence. Correctness also does not establish a cost benefit. A write that committed before reads exhausted their retries must remain distinguishable from a rejected write.

This grammar reconstructs the current probe and exposes its missing cross-query propagation. Its controls are analytical walkthroughs and exclusions, not implementation proofs. No independent range case was available. Creation or GC during pending work, concurrent responses, trusted dispatch across modules, SQL type equivalence, and exact optimism for complex queries remain open. A single response does not itself prove a common database snapshot or atomic publication across collections. Splitting the design into records can hide those coupled obligations.

[Model](./model.md) · [Evidence](./evidence.md) · [Process and claim map](./process.md) · [Preservation contract](./preservation.md)
