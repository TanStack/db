# Evidence and controls — frozen v1

E1: S1/S2/S10 reconstruct G followed by D, with full table payloads and mutation services capturing authenticated user context. Source observation.
E2: S4–S9/S19 refute read-only auth and immediate-revocation assumptions. Eight observed API path controls. Memory adapter only.
E3: S11 shows skipped handlers and revision reuse bypass auth today; structural admission does not repair that. Source observation, not an exploit demonstration with compiled Kitchen (its proofs are currently unknown).
E4: S12/S13 show committed-error reconciliation and generic read-error handling. Typed auth denial/identity erasure is a proposed contract gap, not tested current support.
E5: S3/S7/S16 pin one hook-free application configuration; arbitrary hook support has not been proven. The social-provider profile callback is not evidence that getSession invokes that callback.
E6: Reconstruction: U1 supplies req/context, U2 executes existing checks, U3 executes rows/map/service payload, U4 remains unknown for auth factory, U5 receives full snapshots or error. Current all-read behavior is recovered without new primitives. Partial success: reconstructs final control/value/effect categories; does not encode complete event timing or cookie delivery.
E7: Exclusion: `guard returns owner; body performs a second ownership check after SQL` cannot become a pure payload module by deleting that second check. R3 rejects it or keeps the whole handler. This is a constructed near-negative within ordinary app code, not an independent observed range case.
E8: Range untested; all eight path scenarios informed extraction. No fresh range executor was used or claimed.
E9: Source compression: provider brand, header field and fingerprint were demoted to parameters/output/encoding; neither session tables nor subscribers are standalone safe boundaries.
E10: Generation gives three distinct execution/analysis transformations. F1 changes model recognition, F2 changes phase boundaries while retaining guard count, F3 changes ownership/lifetime of auth invocation. Each incurs stated coordination cost and loss. None is a recommendation or implementation result.

## Ablation ledger

Each row tests removal from reconstruction or legal transformations; analytic controls, not executed tests.

| Removed | Break / reason to retain |
|---|---|
| U1 | Cannot distinguish same query/input with different authenticated context (P2/P8) |
| U2 | Renewal, denial and permission outcomes disappear (E2) |
| U3 | Cannot distinguish permission from payload table dependence or reconstruct rows (E1) |
| U4 | Unknown hook becomes empty writes; no justified skip (P4/P6) |
| U5 | No distinction between baseline, missing rows and optimism (P1/P9) |
| L1 | Identity can float between guard and old rows (P8) |
| L2 | Guard-chosen tenant/projection lost (P2/R3) |
| L3 | Session maintenance vanishes from covered writes (E2) |
| L4 | A returned value need not correspond to the settled collection (P1/P9) |
| R1 | Disjoint table skip omits permission (E3) |
| R2 | Unseen callbacks can write any relation without invalidation (E5) |
| R3 | The near-negative loses its second permission check (E7) |
| R4 | Missing/optimistic/different-binding rows can be reused (P1/P8) |
| R5 | Refresh retry can rerun committed mutations/effectful guards (E4) |
| R6 | F2/F3 acquire false timing-equivalence claims (C1/E6) |
| R7 | A denial or stale response can authorize unrelated live state (P8/C3) |

Ablation of each P property changes at least one named lawful form or excluded behavior: P1→R4, P2→R1, P3→C2, P4→R2, P5→R2 compile-time limit, P6→R3 fallback, P7→U1 server boundary, P8→L1/R7, P9→R5/U5, P10→scope excludes external discovery. No rule is proven universal by surviving this analyst control.
