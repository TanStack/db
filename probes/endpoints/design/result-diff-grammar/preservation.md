# Provisional preservation contract

Mode: exploratory. The user selected the three-approach Design Grammar pass with “Ok go”. These properties normalize prior user requirements and the current source; they are not a newly user-approved exact-equivalence specification. No implementation or candidate ranking is selected.

Source: the current Endpoints retained-query response path, frozen in [source-freeze.json](source-freeze.json). Target: how that path can reuse earlier confirmed results while preserving separate publication authority. Research and earlier witnesses constrain this extraction; they are not independent range tests.

| ID | Preservation property | Basis |
| --- | --- | --- |
| P1 | Bare writable collections; actions synchronously return transactions; no write queue or automatic replay of writes. | User-required; runtime. |
| P2 | Every retained non-GCed instance participates regardless of subscribers; creation/GC and lifetime replacement remain visible. | User-required; runtime retention/topology. |
| P3 | Optimism remains a separate guess; only matching confirmed state is a diff base. Install eligible authority before retiring its overlays. | User-required; runtime confirmed map/publication. |
| P4 | Reconstruction preserves the complete supported result: values/types, membership and applicable order. Identity and bag limitations remain explicit. | User-required; validation/encoding; analyst extension to a lossless transport contract. |
| P5 | Exact reconstruction does not grant publication authority. Keep operation closure, local overlap repair and stale-response guards. No token is an LSN. | Source-stated; prior authority decisions. |
| P6 | No user PostgreSQL modifications. This pass always computes complete new query results; it adds no read pruning or input-delta maintenance. | User-required constraint; selected extraction scope. |
| P7 | Server registry and trusted authorization determine executable queries and scope. Client baseline claims never grant read/write authority. Server-only code stays server-only. | User-required; registry/compiler. |
| P8 | Unavailable optimization evidence falls back; missing closure, exhausted reads and invalid authority remain errors/recovery states, not success or permission to retry the mutation. | User/source. |
| P9 | Baseline loss, eviction, process restart and representation-version mismatch may cost transfer but cannot silently corrupt a result. Cache memory must be bounded. | Analyst-inferred from source's optional cache and fallback contract. |
| P10 | Correctness, bytes and latency are separate laws. Preserve limits: no common-PG-snapshot or external-write observation guarantee is invented, and no performance gain follows from the grammar. | User/source/evidence limit. |

Anything outside these ten properties may still matter. The exploratory preservation list is provisional; passing reconstruction below is not a completeness claim.
