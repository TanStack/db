# Reactive and sync systems: frozen source-track notes

Research/access date and cutoff: 2026-09-11. English public primary vendor documentation only. Read the frozen `research-brief.md` and Research Survey instrument before searching. Question: What keeps overlapping client query collections coherent during optimistic writes and reconciliation, and what information/delivery does it require? This is bounded source material, without design selection or ranking.

Claim typing: **Primary record** means the publisher's documented mechanism or example, not independent verification. **Model inference** marks an implication drawn from that mechanism. No implementation was run.

## S-SYNC-1 — Zero, Mutators

URL: https://zero.rocicorp.dev/docs/mutators

Date/version: undated live documentation, accessed 2026-09-11. Source allowance: 200 words; extracted prose below: under 100 words; no verbatim quotation.

**Primary record:** Local mutators change the client datastore and open queries. Client/server implementations may differ; server-only overrides are supported. Client mutator reads see only cached data. Server commits replicate through `zero-cache`, which sends changed query rows and applied-mutation information; confirmed local effects roll back. Registered mutators are called during conflict resolution. Mutator exceptions roll back their transaction; endpoint failures have separate error/retry handling.

**Boundary:** This page does not prove exact optimistic replacement rows for limited queries. Its async mutator API is not evidence of synchronous transaction semantics.

Locations: Architecture; Mutation lifecycle; Reading Data; Registration; Handling Errors; Server-Specific Code.

## S-SYNC-2 — Replicache, How Replicache Works

URL: https://doc.replicache.dev/concepts/how-it-works

Date/version: undated live documentation, accessed 2026-09-11. Source allowance: 200 words; extracted prose below: under 100 words; no verbatim quotation.

**Primary record:** Subscriptions compute over the local key/value Client View and rerun after relevant optimistic or synced changes. Mutator invocations persist in a queue with ordered client mutation IDs. Server implementations may differ. Pull returns a cookie, patch, and mutation acknowledgements. Rebase restores the prior server base, applies the patch, replays unconfirmed mutators, then reveals state atomically. Replay may produce different effects. Pokes merely prompt pulls.

**Boundary:** Local execution requires mutator/query code and Client View data. This overview does not establish completeness for arbitrary queries outside that view.

Evidence locations: Client View; Subscriptions; Local execution; Push; Pull; Rebase; Poke.

## S-SYNC-3 — Convex, Optimistic Updates

URL: https://docs.convex.dev/client/react/optimistic-updates

Date/version: undated live documentation, accessed 2026-09-11. Source allowance: 200 words; extracted prose below: under 100 words; no verbatim quotation.

**Primary record:** Mutation callbacks explicitly edit local query results. They rerun when local query results change and roll back after mutation completion and query updates. Examples condition edits on a loaded query and match its arguments. Temporary IDs and timestamps can differ from server results; authoritative results replace them. Updates must create fresh objects.

**Model inference:** Overlap coherence in this API requires callbacks that cover affected result sets; the example does not supply automatic entity-to-list membership propagation.

**Boundary:** Detailed concurrent callback ordering and cross-query server version guarantees were not established by this page.

Locations: lifecycle; examples.

## S-SYNC-4 — Convex, Paginated Queries

URL: https://docs.convex.dev/database/pagination

Date/version: undated live documentation, accessed 2026-09-11. Source allowance: 200 words; extracted prose below: under 100 words; no verbatim quotation.

**Primary record:** Server queries return cursor-based pages; the client hook manages continuation cursors and exposes loaded results plus loading/exhaustion states. Page results may be transformed on the server. Reactive pages can shrink after deletion or grow after insertion, so their size need not remain the requested count.

**Boundary:** This is server-maintained pagination. The page does not prove a client can find an unseen replacement row, infer transformed membership, or preserve a fixed-size optimistic top-k result from loaded pages alone.

Evidence locations: Writing paginated query functions; Transforming results; Paginating within React Components; Reactivity.

## S-SYNC-5 — Electric, Writes

URL: https://electric.ax/docs/sync/guides/writes

Original URL https://electric-sql.com/docs/guides/writes redirected to the URL above.

Date/version: undated live documentation, accessed 2026-09-11. Source allowance: 200 words; extracted prose below: under 100 words; no verbatim quotation.

**Primary record:** Electric supplies read-path sync; applications choose their write path. The optimistic example retains local state through the API request and shape-stream confirmation. Component-scoped state can leave other components inconsistent. A shared persistent store addresses that scope. Its example correlates non-delete echoes by write ID and removes failed requests from optimistic state.

**Boundary:** These are application patterns. They do not establish arbitrary overlapping-query membership or rebase semantics. The simpler example's row-ID matching is weaker evidence for concurrent same-row writes than mutation-specific acknowledgement.

Locations: Local writes; Optimistic state/Drawbacks; Shared persistent (`matchWrite`, `sendRequest`). Final sentence: **model inference**.

## S-SYNC-6 — Electric, HTTP API

URL: https://electric.ax/docs/sync/api/http

Original URL https://electric-sql.com/docs/api/http redirected to the URL above.

Date/version: undated live documentation, accessed 2026-09-11; page mentions future Electric 2.0 changes. Source allowance: 200 words; extracted prose below: under 100 words; no verbatim quotation.

**Primary record:** Clients materialize shape logs using offsets/handles. Full mode supplies initial shape data then changes; changes-only mode omits the base. `up-to-date` covers server knowledge for that request. `must-refetch` requires discarding and resyncing shape data. Subset snapshots support filtering, ordering, limit/offset; `snapshot-end` carries PostgreSQL visibility metadata so clients skip stream changes already included.

**Boundary:** Log pagination differs from a limited result snapshot. This page does not establish automatic replacement-row fetches after local edits or atomic publication across separate shapes.

Evidence locations: Shape Log; Initial sync; Control messages; Log modes; Subset snapshots.

## Search routes, controls, and stop

- Initial web-search routes: Zero mutators/query limits, Replicache rebase/subscriptions, Convex optimistic/paginated queries, Electric optimistic writes/shapes. Then opened the six mechanism pages above and read their supporting sections. Reopening sections did not add sources.
- Targeted pass 1 (contrary/thin): `site.zero.rocicorp.dev/docs optimistic "limit" "missing"`; `site.docs.convex.dev optimistic "paginated" "loaded"`. Found further leads for Zero partial-result status and Convex pagination helpers. They were not opened because six pages were already selected; search snippets are not used as support. This leaves those cells thin.
- Targeted pass 2 (contrary/thin): `site.electric-sql.com OR site.electric.ax "optimistic" "failure" "concurrent"`; `site.doc.replicache.dev "pull" "lastMutationID" "atomic"`. Search results drifted into unrelated concurrency material and an older Electric article. No additional source was admitted. Reinspection of selected pages supplied explicit scope/failure boundaries and Replicache's atomic reveal.
- Stop condition: six inspected sources plus two targeted passes reached the declared bound. Did not claim two-pass evidence saturation.
- Access: all six pages opened successfully; Electric redirected domains. No paywalls. No version-pinned source or historical docs snapshot checked. Search index dates are not publication dates. Excluded snippets, third-party commentary, old Electric architecture claims, and future-product implications from factual support.
- Coverage: shared-data propagation, explicit result edits, client/server code separation, reconciliation, and delivery metadata supported at documented-mechanism level. Limited-query replacement, transformed insert membership, arbitrary overlapping shapes, detailed concurrent histories, and bounded error recovery remain thin or unmeasured.
- Distortion: vendor descriptions and examples dominate; Zero and Replicache share a publisher. Shared search indexes and English public documentation favor visible successful designs. No prevalence, performance, robustness ranking, or empirical conflict-resolution validation follows.

## Handoff

S-SYNC-1/2 locate shared-data and replay mechanisms; S-SYNC-3 locates explicit result editing; S-SYNC-4/6 locate pagination and coverage boundaries; S-SYNC-5/6 locate separation between write acknowledgement and read-path delivery. Later work must retain the thin cells above.
