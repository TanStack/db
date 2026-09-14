# Design grammar — Evidence, version 2

Support for [Model v2](./design-model.md). These are source readings, analytic controls, and a separately requested local measurement. They are not implementation validation. The [Process layer](./design-process.md) owns the run sequence and projection map.

## Evidence register

- **EV1 — Runtime observation:** Frozen local source L1, especially options/bindQuery/run. Direct-target capture, separate declaration caching, comparator metadata, RPC/refetch lifecycle, synchronous Transaction, default read retries.
- **EV2 — Compiler observation:** L2. Trusted Todo/order extraction and server/client separation. Broader lineage and client query predicates are absent from emitted metadata.
- **EV3 — Public composition contracts:** L5/L6/L7. Query snapshot domains, direct synced writes, multi-collection transaction capture, and local DB derivation. These support variation points, not automatic transfer of guarantees.
- **EV4 — Known feature-gap receipt:** L3/L4. One optimistic insert reaches one of two identical active query collections. Existing tests execute it; this design run did not rerun it.
- **EV5 — User requirements:** Conversation constraints recorded in local notes, plus added queries about partial server updates, performance, and optimistic/authoritative recipient selection. Latest user correction supersedes the old oracle interpretation of exhausted read failures.
- **EV6 — Information boundary:** Constructed matched top-k comparison in ground-conditions.md. Analytic indistinguishability, not an executed test or independent range case.
- **EV7 — Prior-work evidence:** The Research Survey records mechanisms with source/access limits. It is contextual evidence; no vendor system is used as an extra extraction source or a proof of Endpoints behavior.
- **EV9 — Activity API source:** L8 exposes subscriberCount and subscribers:change. No endpoint active registry, preload policy or transaction-pin definition is inferred as implemented.
- **EV8 — Local measurement and model:** performance-measurements.json contains the measured host, versions, query timings and body sizes. performance-bounds.md contains assumptions and formulas. These do not measure implemented impact selection, patch generation or wire latency.

## Reconstruction control RC1

Analytically rebuild the actual baseline using M1–M5 and E1–E4:

0. The generated component subscribes to both endpoint collections. M5/E4 records both as demanded for this source case; other lifetime classes remain outside this receipt.

1. Two different declaration IDs create Q1/Q2 with separate H1/H2 (EV1/EV2). Both read the same fixture scope and both start empty.
2. The authored callback inserts row A into H1 under T. R2 preserves immediate action behavior; E2 has only the direct H1 edge. H2 has no such edge (EV1).
3. At the optimistic action boundary H1 contains A and H2 is empty. This reproduces EV4 without inventing a shared-entity registry or assuming missing propagation already exists.
4. Write acceptance supplies one O. The runtime subsequently fetches only the directly touched collection. R4 distinguishes those observations. A successful snapshot updates H1 and permits T settlement (EV1).
5. A write error fails T. An exhausted read error also currently fails it. This reconstructs source behavior without interpreting every failed read as an implementation defect after the user's correction (EV5).

**Result:** Structural/source reconstruction passes for the narrow case. It does not prove all runtime timing, garbage collection, serialization, or subscriber publication behavior.

## Component and relation ablations AC1

Each removal is tested against a concrete reconstruction, preservation, or exclusion consequence. “Fails” here means the reduced account loses that consequence, not that executable software was mutated.

| Remove | Observable or representational loss | Disposition |
| --- | --- | --- |
| M1 query contract | Cannot distinguish equivalent rows under different filters/order, or name what an authoritative snapshot covers | Retain. |
| M2 held state | Cannot represent H1 containing A while H2 remains empty, or distinguish a pending overlay from the authoritative state | Retain. |
| M3 local transaction | Cannot attribute optimistic effects to one pending operation or express separate rollback ownership | Retain. |
| M4 authoritative observation | Cannot distinguish write acceptance from successful refetch or failed read | Retain. |
| M5 demand/lifetime | Cannot distinguish a retained but unobserved collection from a demanded instance; recipient selection and activation testing collapse into cache existence | Retain after target extension. |
| E4 demand/lifetime relation | A subscription transition cannot alter eligible recipients while Q/H otherwise remain unchanged | Retain. |
| E1 read derivation | A shared row update no longer specifies how any query result obtains membership/order | Retain. |
| E2 transaction ownership | The same local intent has no defined direct or propagated recipients; RC1 cannot express why H2 remains empty | Retain. |
| E3 reconciliation | Accepted/pending effects cannot transition according to the read observation contract | Retain. |
| R1 scoped identity | An equal key can merge unrelated Alice/Bob/source-domain state; NC1 exclusion fails | Retain. |
| R2 synchronous action boundary | Returning an awaited RPC becomes an admitted transformation despite P2 | Retain. |
| R3 defined propagation edges | The grammar can assume arbitrary fanout with no membership or identity evidence, hiding EV4 | Retain. |
| R4 matching observation/retirement | Any read response can retire another pending write or conflate write success with sync success | Retain. |
| R5 snapshot/patch domain | An empty scoped response can erase another query's still-owned rows | Retain. |
| R6 sufficiency | Deleted ID A can falsely determine unseen replacement B in EV6 | Retain. |
| R7 write interpretation | A join/projection edit gains an unexplained inverse mapping | Retain as exclusion; general inverse policies unresolved. |
| R8 no hidden queue (subpart) | A form can silently serialize all mutations to manufacture an ordering guarantee | Retain. |
| R8 server boundary (subpart) | A form can solve missing client semantics by shipping the handler and its captured dependencies | Retain. |
| R9 unresolved/error outcome | An unsupported patch or failed read can be labeled exact without additional evidence | Retain. |

### Pruned candidates AC2

- Separate “normalized entity registry” primitive: demoted to an implementation of identity attributes on M1/M2 and E2. It adds no independent semantic operation.
- Separate “impact index” primitive: demoted to an implementation of E1/E2 and I1/I3; exact versus conservative selection remains an algorithmic choice.
- Separate “capability certificate” primitive: demoted to evidence for R6 rather than treated as a magic answer-producing object.
- Separate request transport primitive: demoted to the adapter carrying O; it matters for measured cost, but is not needed to reconstruct the state distinction.
- Separate count of affected queries: demoted to a work metric, not a causal unit.
- UI component tree as ownership model: rejected because active row/query overlaps do not follow one component parent. Consumers remain part of the observation boundary.

This is a description-length pruning heuristic. Alternative equally compact grammars may exist; no uniqueness result is claimed.

## Overlap and dependency control OC1

A1–A5 remain explicit. F1 changes which Qs share H; F2 changes which Hs a T owns; F3 factors H and adds E1 derivations. None is described as a clean modular swap for the whole framework. Only the existing cache lookup offers a narrow substitution boundary. Fanout/shared-state changes still need integration tests for publication, rollback, loading and lifecycle.

The actual row-state version scheme, effect provenance, loaded subset ownership, and cleanup lifetimes are not inferred from the high-level graph. This is a material decomposition loss.

## Range and exclusion controls

**RG1 — Range status: untested.** No independent marginal case was held out before extraction. The oracle case, pagination thought experiment and survey material were already visible. Sending one of those to a fresh agent now would not make it an independent source-extraction control. No cross-system or arbitrary-query validity is claimed.

**NC1 — Nearby negative:** Two collections share an id string but differ in tenant/scope or source relation. R1 rejects unification without compatible provenance. A candidate that shares those records merely by id is outside the grammar. This is an analytic exclusion, not a new security test.

**NC2 — Unsupported inverse:** A projected/aggregated result has no unique source row or edit policy. R7 rejects treating a view-row update as an unexplained source mutation. Explicit mapping policy would require additional source/design input.

**NC3 — Insufficient payload:** Top-k deletion returns only the deleted key while the replacement row is absent. R6 rejects an exact local patch claim. Extra authoritative information can change the case; the result is not a blanket prohibition on small responses.

**NC4 — Unsupported no-effect claim:** An active query has unknown dependencies or mutation footprint. I3/R6 reject classifying it as unaffected merely because it was not a direct optimistic target. A conservative refresh can remain admissible.

## Generated-form control GC1

| Form | Distinct changed relation | Source-backed part | Added/conditional structure | Boundary or loss |
| --- | --- | --- | --- | --- |
| F1 | Query identity maps two equivalent Qs to one H | Existing runtime cache/compiled identifiers | Checked semantic descriptor and option compatibility | Does not solve genuinely different queries. |
| F2 | One T owns result changes in several query-owned Hs | Existing multi-collection transaction composition | Complete recipient discovery, per-query result edits, grouped reconciliation | Copies and coordination remain; publication guarantee untested. |
| F3 | Compatible H is shared; Q results derive through E1 | Keyed collections and local DB queries | Provenance, coverage ownership, writable overlay mapping and lifetime policy | Independent eager snapshots cannot simply replace the shared relation. |

D1/D2/D3 change observation delivery rather than duplicating F1/F2/F3. D1 and D2 remain distinct because deriving effects without executing a query and diffing a fully recomputed result have different information/work requirements. A full inline result is not relabeled a patch. A conservative affected-set superset is not relabeled minimal.

## Quantitative control QC1

The local measurement was rerunnable and isolated from application data. The network model displays assumed RTT, bandwidth and equal client-apply cost. It compares both two-phase refetch and one-phase inline-full baselines. It does not measure actual wire framing, browser apply time, recipient discovery, deployed database CPU, load, or concurrency. Those omissions materially prevent a latency winner or complexity recommendation.

## Takeaway-changing uncertainty

U1–U6, RG1, and QC1 remain in the primary brief. Ordinary-case reconstruction, logical exclusions, and a local payload/SQL micro-measurement do not certify any candidate implementation. The source's narrow compiler grammar can make the apparent design space cleaner than the eventual general framework.

## Activity control LC1

Analytic contrast: hold a query's arguments and cached rows fixed while its final subscriber leaves. L8 changes subscriberCount and schedules GC; cached identity and readiness are not the same signal. A created-collection Map cannot alone represent demand.

Second contrast: hold the original active set fixed at invocation, then activate a matching collection while T remains pending. A registry that never considers this transition has no rule to initialize its pending effects. This is a prospective oracle case, not an executed failure. Which zero-subscriber preloads or transaction pins warrant eager sync remains U6.

Version 2 repeats reconstruction/ablation with M5/E4 and adds this control before projection. The original four-unit candidate was insufficient once the user made lifetime selection an explicit extraction target.
