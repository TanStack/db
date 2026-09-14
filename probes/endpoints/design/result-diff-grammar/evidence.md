# Evidence and controls

This is a source inspection and analytical design pass. It implements no protocol and runs no new oracle campaign. Previous executed witnesses are labeled as previous evidence. Source digests are in [source-freeze.json](source-freeze.json).

## Source ledger

| ID | Source and observed fact | Limit / role |
| --- | --- | --- |
| E1 | [Client runtime](../../integrated-todo/src/runtime.ts): separate confirmed state and pending operations; retained instances include those without subscribers; topology/epoch checks; validation before coordinated publication and settlement. | Static inspection. The current keyed Todo representation is not an arbitrary lossless SQL result codec. Supplies M1/M2/M6 and the source part of M3. |
| E2 | [Registry](../../integrated-todo/src/registry.server.ts) and [compiler](../../integrated-todo/bound-transform.mjs): registered definitions and context bound query instances; optional revision metadata cache; compiled registration does not supply revision readers. | Static inspection. Existing cache entries do not store complete result rows. New F1 cache/handle semantics are proposed structure, not existing behavior. Trusted context in this prototype is not proof of production authentication. |
| E3 | [Refresh helper](../../integrated-todo/src/refresh.server.ts): validates recipients before invoking the handler; catches handler errors and still attempts reconciliation; reads complete results with retries, retaining handler outcome on read failure. | Static inspection. Separate Promise.all reads do not establish a common PG snapshot. The helper has an optional reuse hook; the scoped reconstruction covers the current compiled path without revision readers, not every possible caller of that hook. |
| E4 | [Snapshot encoder](../../integrated-todo/src/snapshot-encoding.server.ts): pools equal complete typed row representations within one response and emits per-result indexes; falls back to full results. | Its fingerprint contains a serialized representation, not a short probabilistic hash. Supported value domain and client unique-ID validation limit applicability. JSON byte estimate is not actual compressed transport measurement. |
| E5 | [Ground Condition](../optimization-ground-condition.md) and [raw evidence](../optimization-ground-condition-evidence.json): nine earlier executed witnesses, including B1 baseline interval gaps, B7 exact base versus target eligibility, B8 separate read snapshots and B9 DML-CTE visibility. | Eight SQL cases and one finite-map case, previously run on PGlite/PostgreSQL 17.5. B7 is narrow unique-key integer evidence. These informed extraction; none is an independent range test. No rerun claimed here. |
| E6 | [RFC 3229, sections 7 and 10](https://www.rfc-editor.org/rfc/rfc3229.html): delta transfer names a particular prior instance, with client/server retention and base selection concerns. | Primary protocol precedent for explicit base correspondence. It does not supply Endpoints authorization, optimistic settlement or concurrent publication rules. F1/F2 assembly is inference. |
| E7 | [Tridgell and Mackerras, The rsync algorithm](https://rsync.samba.org/tech_report/): reconciliation when sender and receiver do not hold both complete files together. | Primary mechanism precedent for summary-assisted transfer; not a query collection protocol or proof of absolute equality for all short summaries. No old checksum choice is recommended. |
| E8 | [Goodrich and Mitzenmacher, Invertible Bloom Lookup Tables, v3](https://arxiv.org/html/1101.2245v3), sections 1.3 and 3: database reconciliation, probabilistic listing behavior and checksum checks. | Primary research. Detectable capacity/listing failure and possible erroneous hash agreement are distinct. This work supports a conditional mechanism, not a zero-error Endpoints implementation. |
| E9 | [Relational algebra survey](../../RELATIONAL-ALGEBRA-SURVEY.md), especially C15–C18. | Earlier research ledger separates representation differences from incremental maintenance and freshness. Broader survey claims are not re-proved by this pass. |

## Control results

**C1 — Source reconstruction: accounted for within the declared scope.** The manual trace in [process.md](process.md) reconstructs the current compiled full/shared-result path, including rejected/stale/error exits. No cache of prior results is needed for that path. The new M3 transport identity and F1–F3 machinery are therefore extensions, not discoveries in existing code. This is an analyst judgment, not an integration-test result.

**C2 — Compression/ablation: semantic roles retained; duplicate axioms pruned.** Six units retain distinct roles. Seven directed relations restate rules and are demoted to diagram annotations, rather than falsely counted as independent laws. Cache, acknowledgment and checksum were rejected as standalone primitives. Per-item outcomes are recorded in Process. Minimality is a local pruning judgment, not a proven smallest grammar.

**C3 — Independent range: untested.** No independently sourced marginal case was supplied. No executor received one. E5 was used during extraction and cannot fill this slot. The three generated forms are also not range evidence.

**C4 — Nearby negative: a correctly decoded obsolete response is excluded.** E5/B7 keeps the matching old base but changes eligible authority from a=1 to a=2. Decoding a=1 remains correct as reconstruction; publication is rejected by R5/M6. A grammar equating successful decode with authority would admit this negative. The control is a manual application to an earlier witness, not a new runtime test.

**C5 — Lost-response exclusion: no adoption by send.** Analyst trace: client has B0; server sends T1 but response is lost; next request names B0. A sender that assumes T1 was adopted may encode against the wrong base. R6 requires the named retained base or full fallback. Unknown outcome for the first write remains unresolved until closure evidence; sending the next request is not that evidence. This is a constructed protocol counterexample.

**C6 — Summary collision boundary: unresolved exact branch.** For a fixed summary that is non-injective over the accepted result domain, two distinct bases share a summary. That summary alone cannot certify which full base the receiver has. This excludes hash-agreement-only reuse under R4; it does not prove all compact or interactive protocols impossible. F3 needs more exact evidence, an expressly accepted probabilistic assumption, or full fallback. R4 wins only because exactness is in the provisional contract; no probabilistic relaxation is adopted. This is an information argument, not an implemented attack or measured collision rate.

**C7 — Forms generated, not validated implementations.** F1 changes custody to server memory; F2 changes custody to request-carried client data; F3 weakens the offered base evidence and exposes an unresolved proof obligation. These are three different rule combinations. F3's server-piece lookup branch is explicitly an F1 hybrid, not a fourth candidate.

## Destabilized claims and remaining limits

- “A baseline token proves the collection is fresh” is unsupported: E5/C4 separates correspondence from authority.
- “The server can remember the last response as the client's base” fails C5 without adoption evidence.
- “Compact summaries retain the same exactness guarantee for free” fails C6; detectable fallback alone does not address silent false matches.
- “The current confirmed map is already the complete transport base” is unproved: codec, ordering, immutable capture and bag semantics remain U2.
- “Full refresh gives one common database snapshot” is contradicted by the limited E5/B8 witness and not established by E3.
- No new oracle, performance, cache-capacity, production-auth, distributed-worker or general SQL claim follows from these controls. U1–U5 and D1–D4 in Model remain live.
