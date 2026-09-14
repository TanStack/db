# Result diffs: three baseline designs

**We can separate two contracts: reconstruct exactly what the server read, then decide whether that result may replace client authority.** The old result may be stale relative to PostgreSQL and still be a valid diff base. What matters for decoding is that both sides mean the same exact confirmed representation. A baseline handle identifies that representation; it supplies no commit ordering or freshness proof.

This exploratory Design Grammar produces three unranked forms:

| Form | How it works | New cost or unresolved condition |
| --- | --- | --- |
| **Server retains the exact base** | Client names its published baseline. Server reads the complete new result and returns a diff against that retained base. A cache miss sends full data inline. | Bounded application memory, immutable copies, scoped handles and retention policy. Worker changes or restart may cause misses. |
| **Client sends the exact base** | Request carries the client's captured confirmed result. Server reads the authorized new result and returns a patch against the supplied representation. | Upstream bytes, parsing and temporary memory can consume the response savings. Uploaded rows are untrusted comparison data and never grant query or write authority. |
| **Client sends a compact summary** | Summary helps identify reusable pieces; server supplies new pieces. | Exact reuse still needs proof. Short hash matches alone cannot guarantee equality. Additional exact evidence, interaction or an explicitly accepted probabilistic assumption is needed; otherwise send full data. |

Explicit base selection has a protocol precedent in [HTTP delta encoding](https://www.rfc-editor.org/rfc/rfc3229.html). [Rsync](https://rsync.samba.org/tech_report/) and [IBLT](https://arxiv.org/html/1101.2245v3) provide summary-assisted mechanisms, but do not settle our client publication rules or the summary form's exactness requirement.

**A sent result is not an adopted baseline.** Suppose the client holds B0 and the server sends T1, but that response is lost. The next request can still name B0. The server must use that base or send full data. The client promotes T1's handle only when it publishes T1's confirmed rows, before retiring the relevant optimistic overlays.

Overlapping requests can both name B0. Each patch may decode correctly while still needing the existing stale-response repair. Collection GC/recreation, scope changes and codec changes can invalidate reuse. Losing the base on the server permits inline full delivery; losing it on the client after receipt may require a fresh read. Neither fallback bypasses publication checks. An unknown write outcome remains a separate recovery/error state and never triggers automatic mutation replay.

All forms preserve bare writable collections, synchronous transaction-returning actions, separate optimism, every retained non-GCed collection regardless of subscribers, and the server-only code boundary. They add no write queue or PostgreSQL infrastructure. This pass still reads complete fresh query results; it does not prune reads or infer complete mutation effects.

The [oracle laws](model.md#oracle-laws-for-any-later-implementation) cover exact reconstruction, stale targets, lost responses, eviction, restart, wrong bases, reentrant publication and injected summary collisions. Comparisons must count request **and** response bytes, fallbacks, memory and end-to-end latency on identical histories.

This is a design result, with provisional preservation requirements. Manual reconstruction accounts for the scoped current path; duplicate grammar relations were demoted to annotations. Independent range remains untested. No protocol was implemented or benchmarked. Exact codecs/order, wider SQL result shapes, memory policies and the summary proof remain open. The decomposition also hides some coupling between identity, retention and publication; the model records those intersections explicitly. Full result reads still do not establish a common database snapshot or close detached external writes.

[Model](model.md) · [Evidence and controls](evidence.md) · [Process and support map](process.md) · [Preservation contract](preservation.md) · [Frozen analytical state](analysis-freeze.json)
