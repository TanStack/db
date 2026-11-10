# c-query-subset-errors: investigation at the frozen baseline

Mode: **INVESTIGATE**. Baseline: `07bfc0eb2584fd83a3efc14ec1fb452954a829ea`. Sources: #540, #2270, #2271, their complete captured comments, and the historical material in [input-packet.json](input-packet.json). Production is unchanged. No commit, push, GitHub mutation, installation workaround, or production mutant was made.

The experiments establish current source-boundary behavior, not a product-bug-class closure. They found and repaired one oracle comparison defect. They did not establish a current product violation. The original report package versions were not replayed.

## Laws and rival predictions

[The law matrix](laws.md) records the full contract × path × checkpoint audit. The primary authority is [live-query ARCHITECTURE laws 16 and 17 at the baseline](https://github.com/TanStack/db/blob/07bfc0eb2584fd83a3efc14ec1fb452954a829ea/packages/db/src/query/live/ARCHITECTURE.md), the [glossary health/status terms](https://github.com/TanStack/db/blob/07bfc0eb2584fd83a3efc14ec1fb452954a829ea/docs/contributing/glossary.md), [Query Collection Error Tracking and Reloading](https://github.com/TanStack/db/blob/07bfc0eb2584fd83a3efc14ec1fb452954a829ea/docs/guides/error-handling.md), current Query Collection utilities, and merged #2168. Issue proposals and old production behavior are not authority for new expectations.

1. A failed observed Query refetch after readiness is source sync health. Every live-query source node mirrors the source, while the live query keeps ready status and rows. This differs from a failed subset request the live query itself started, which belongs to its own node. A policy putting a passive failure only on one view's own node would need a new promise.
2. A source health frame lists the distinct Error values still held by failing Queries, in order. Recovering one Query removes only values no other failing Query holds. The listed causes retain identity; recovery with a shared Error must not erase another Query's failure.
3. A failed first live-query load is final for that sync run. A successful source refetch can fill source rows without restarting the failed live query. Its own `reload()` is the explicit new-run recovery path. Automatic same-run recovery is a different policy.
4. Current manual `refetch()` targets the owned Queries and bypasses `enabled: false`; with no created observer/sync it has no work. The old `type: 'active'` no-op proposal does not describe today's disabled manual-refetch contract.

The rival “no view can see a passive failure” is rejected by the live health observations. The rival “only recreation can recover initial failure” is rejected by the same-object own-reload witness. The rival “an older Error may be replaced by an equal-message clone” exposed a false green in the old listed-causes comparison.

## Experiments and measured reach

Exact commands, cwd, timestamps, runtime, exit codes, and raw log names are in [experiments.jsonl](experiments.jsonl). All runtime commands used Node24.19.0, pnpm11.1.0, Vitest4.1.12, QueryCore5.90.20, jsdom, and one worker. Package manifests are DB1.0.0-rc.1 / QueryDB1.5.0. The task-local [config](vitest.source.config.mjs) aliases DB and db-ivm to this worktree's TypeScript sources because their dist exports were unavailable. These are **source-runtime** receiving witnesses, not a packaged/dist compatibility result. The reports used DB0.15.2 / QueryDB1.4.8 / QueryCore5.104.5.

| Experiment | Result | What it establishes |
| --- | --- | --- |
| E01 | 2/2 adapted issue workflows passed | Initial baseline run. Default console interception omitted diagnostic lines; E04 reran with direct console output. |
| E02 | 13 selected tests passed; 197 skipped | Original plain/persisted source histories plus new plain/persisted live receivers; existing exact targeting, disabled manual refetch, no-observer no-op, and concurrent-success example. This was before identity-checker strengthening. |
| E03 | 603/603 source-health oracle and neighboring ordinary tests passed | Existing independent core health/status/reload/request laws remained green. Normal fixed/random required-history campaigns ran with every declared reach; both 26-state maps are in the raw log. No budgets were changed. |
| E04 | 2/2 adapted issue workflows passed with public observations logged | #2270 prefix invalidation leaves both views ready with rows and source failure visible on both; successful refetch clears it. #2271 source refetch leaves error/empty; the same live-query object's own reload becomes ready with two rows. |
| E05 | 4 selected existing overlap/direct-write tests passed | Focused persisted accepted-result ordering and stale-refetch/direct-write protection. These are not generated concurrent error/recovery coverage. |
| E06 | Calibration RED: one intended assertion failed | Old deep equality accepted a cloned older Error while newest cause stayed correct. This is a checker false green, not production RED. The pre-repair test diff is preserved. |
| E07 | 2 calibration tests passed | Length plus per-entry identity rejects hidden failure and cloned older cause; lawful lists are accepted. |
| E08 | `pnpm lint:changed` passed | No oracle lint report or lowered/removed run budget. |
| E09 | Final 7 selected tests passed; 204 skipped | The final strengthened checker is green against unchanged production across **all 5,184 histories** and both calibrations; 38.54s. E02 does not substitute for this post-change run. |
| E10 | Integrity checks passed | HEAD remains baseline; approved test/map edits only; production source diffs and untracked-source lists empty; `git diff --check` clean. |

Each of the four finite paths runs all 1,296 histories: four fetches, two Queries, success/fresh Error/shared Error. The two added live receivers each perform 10,368 source-node list comparisons, one per view after each settled fetch. Reach counters count histories, not raw transitions:

| Declared live-receiver state | Plain | Persisted |
| --- | ---: | ---: |
| Later fetch failure reaches both source nodes | 1,280 | 1,280 |
| Recovery leaves another Query failure visible | 528 | 528 |
| Successful fetch leaves both trees healthy | 700 | 700 |

Each counter is asserted with `createOracleReach`. The original source paths and their 1,296-history budgets are retained. The model itself is unchanged and independent: latest failing Error per Query, plus the ordered values still held. The live receiver changes only acquisition/refetch entry points and observations, not expected semantics.

## Inferences by source

**#2270:** Current health supplies the general visibility missing from the old error-utility report. The failed view stays ready and keeps its rows, as accepted law requires. Both views mirror the shared source failure. The healthy peer keeps ready status, rows, and a null own request error, but its **source health node does change**. The broad phrase “other subsets' live queries are unaffected” must not be silently narrowed to only the passing status/own-error assertions. C20's append-only review correction preserves those partial successes and cross-links strict healthy-peer health isolation to C18's design decision. A feature request for exact subset-local passive failure attribution remains useful; it is not disproved by general health visibility. The original-version failure result remains unverified.

**#2271:** The report's source-refetch-then-error/empty observation still occurs at baseline, and it follows accepted sync-run finality. The stronger assertion that recreation is the only recovery is false at baseline: the same live-query Collection recovers through its own `reload()`. Automatic recovery after a later source fetch would revise the initial-gate law; the explicit-retry option already has a current public route. The original versions remain unverified.

**#540:** Removed `clearError`, `errorCount`, `isError`, and `lastError` expectations are stale. Existing focused exact-targeting, disabled imperative-refetch, and no-created-observer tests already pass, so the maintainer comment's “still open” testing statement is broader than the baseline evidence supports. That does not close all timing/concurrency work. Existing concurrent-success and accepted-write ordering examples do not generate failing-refetch overlap, replacement, cancellation, and recovery schedules. Those remain coverage work, with no product failure demonstrated here.

**Discovered sibling D01:** The original list comparison used `toEqual`, which accepts equal-message Error clones. The newest displayed cause had a separate `toBe`, but an older listed cause could escape. The shared comparison now checks length and each cause with `toBe`. E06 establishes the old false green; E07 and E09 establish checker sensitivity and production GREEN. This is an authorized oracle/harness repair, not a production fix.

## Remaining enforcement work and decisions

- The source-health owner and its QueryDB receiver should generate controlled overlapping passive refetch failure/recovery histories, including replacement/cancellation and peer failure retention. Existing ordinary success/persisted-write examples do not close this dimension. Keep this ahead of optional attribution features.
- Add a generated QueryDB receiving path for failed initial demand → source refetch → own reload. E04 is a focused source workflow, while E03 protects the underlying core law; this does not establish generalized adapter-boundary closure.
- Preserve the stronger attribution proposal separately: should a passive provider failure be attributable to a particular held demand, and should healthy peers' health summaries exclude it? Current fixed-shape source nodes mirror the Collection. The `reportError(error)` boundary carries a source failure value, not a per-consumer verdict. A policy change needs a specified attribution boundary and acceptance observations; do not change the current model merely to obtain the requested UI behavior.
- Original packaged versions, packaged/dist baseline exports, framework hooks, external server behavior, retry/backoff schedules, and browser hosts were not replayed. No claim crosses those boundaries. The QueryDB source receiver uses a real QueryClient/QueryObserver and controlled queryFn promises; the persisted receiver uses the existing in-memory persistence test adapter, not SQLite/OPFS.
- The new live receiver reads settled source-node lists, retained rows, status, and own error. It does not add a live-query health-event/identity assertion or an intermediate-fetch observation. Existing core owners cover those laws on their named paths; no broader QueryDB event-path claim is made.
- `query.test.ts` already mixes ordinary tests with an independent model and has no oracle filename/declaration. Its classification/extraction debt remains tracked in #2264. This task extends the established owner in place under coordinator file ownership; it does not claim law-only-file conformance or create a competing model.

The coverage-map annotation records the expanded source receiver scope and remaining overlap, generated first-load receiver, framework, and package witnesses. No production repair plan is justified until a current accepted-law counterexample is obtained. Feature work needs the attribution/recovery policy decision described above.

## Oracle evidence and rubric audit

**Law:** Source sync health mirrors through live-query source nodes; still-failing Query causes retain identity and peers clear independently. Authority: architecture laws16/17, glossary, merged #2168, current error-handling/Query Collection docs.

**Reach:** E09 measures 1,280 later-failure / 528 partial-recovery / 700 healthy histories separately for both live receiving paths. All 5,184 histories ran with original budgets.

**RED:** E06 calibration fails because the old checker accepts the cloned older cause. There is no current production RED in this investigation.

**GREEN:** E07 checker calibration, E09 final unchanged-production campaign, E03 core neighbors, and E04 focused workflows pass.

**Mutant:** Wrong observations hide a source failure or clone its older Error cause. The shared check rejects both; lawful neighboring observations pass. No production mutant was needed or applied.

**Limits:** Finite serial fetch grammar, controlled source runtime, two subsets, four fetches; no universal bug-class closure, old-version replay, generated prefix-overlap or first-load receiver, package exports, frameworks, retry timing, or real storage/provider claim.

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Authorities and bounded checkpoints above; source proposals distinguished from accepted law. |
| ORC-002 | Existing independent model unchanged; no production classifier imported into expected health computation. |
| ORC-003 | Existing law/model/history prose retained; new receiver prose explains source versus request error and comparison cuts. |
| ORC-004 | #2270 later fetch premise reconstructed in the serial receiver; its broad prefix invalidation is separately replayed by E04, not generated overlap closure. Removing peer/fresh/shared/success axes loses peer retention/replacement/shared-value/removal distinctions. Bounds: two Queries/four fetches; fetch-before-preload and post-cleanup requests excluded, initial-gate policy owned separately. |
| ORC-005 | Public equality-demand preloads and real Query invalidation; after settled fetch compare public view status/rows/health, and original source frame/identity/events. No missing source information hypothesis is needed for the accepted shared-node contract; per-consumer attribution is a different proposed boundary. |
| ORC-006 | E06 proves old comparison weakness; E07/E09 reject hidden list and cloned older cause at the shared checker, accept lawful identities. |
| ORC-007 | New work is exhaustive bounded enumeration, not a random important generated property requiring seed parity. Existing E03 random/fixed campaigns and budgets unchanged; no replay parser was altered. |
| ORC-008 | No model state introduced, removed, combined, or split. Only receiving driver/observation and checker identity changed. |
| ORC-009 | A model subset maps to an observed Query; live-query Collections receive the same source model. No copied QueryObserver machine. |
| ORC-010 | No shrinking added; original finally cleanup retained and all runs settled. Simultaneous comparison plus teardown failure was not injected, so dual-failure fidelity is not claimed. |
| ORC-011 | No unaddressed shared semantic fault identified for the accepted source-mirroring rule; the concrete identity-check fault was distinguished independently by a wrong observation. No second model added. |
| ORC-012 | This report, frozen hashes, patches, and raw commands bind review evidence to baseline plus exact test diff. No comprehensive subsystem or bug-class closure claim. |
| ORC-013 | Failure versus success, peer retained versus last failure cleared, and shared versus fresh errors are exhaustive within the finite grammar. Broader lifecycle/overlap boundaries remain open. |
| ORC-014 | Real QueryClient receiving paths supplied; persistence remains the existing controlled adapter. Package/framework/provider/storage claims explicitly withheld pending their witnesses. |
| ORC-015 | Separate live plain/persisted createOracleReach counters and E09 measurements; original source reach retained. |
| ORC-016 | Established mixed `query.test.ts` debt remains #2264; new standalone source workflows stay in an ordinary test file. Checker calibrations use the same shared comparison. No law-only-file conformance claim. |

## Artifacts, integrity, and complete ledger

[oracle.patch](oracle.patch) contains only the coverage-map annotation, QueryDB test extension/checker repair, and new ordinary public-workflow tests. SHA256: `db35847da3fad3539e78223858bbd62564fff26515ef5d77cddc305fe39d7172`. [pre-identity-repair.patch](pre-identity-repair.patch) preserves the E06 old-checker state. [frozen-artifacts.json](frozen-artifacts.json) binds all six test/map/config/patch artifacts for independent review. Production source diffs are empty in E10. Reports and append-only claim corrections may change after that freeze.

[loss-audit.json](loss-audit.json) verifies all 91 stable IDs have canonical final fields, every nonempty nonstructural-heading source line is retained, all six frozen hashes still match, and the patch reverses cleanly against the current test-only tree. Source retention does not prove every interpretation; the independent-review C20 correction remains append-only.

There are **91 source-accounting records**, including headings, composite parents, atomic splits, and one discovered checker defect. Latest dispositions: 25 accepted-design, 17 stale, 10 already-fixed, 9 duplicate containers, 7 open coverage-gap records, 7 design-decision feature records, 4 current-baseline refutations, 11 unverified historical/provenance records, and 1 repaired harness defect. These totals are not counts of independent product bugs. Every original report-package runtime verdict remains unverified.

The complete lossless text and event history are in [claims.jsonl](claims.jsonl); [claim-summary.json](claim-summary.json) is the latest-event tally. The full stable-ID disposition index follows.

Canonical synthesis categories: **76 non-behavioral, 7 coverage-gap, 7 feature-request, 1 model-harness-defect**. The metadata-only normalization appends 91 category-normalization events and 91 compatible final snapshots; prior labels remain in `categoryDetail`. Technical verdicts and all six frozen code/test/map/config/patch artifacts are unchanged.

### Full claim disposition index

Verbatim source text, parent splits, and append-only events are retained in [claims.jsonl](claims.jsonl). Every created ID appears below; headings and composites remain source-accounting records, not a product-bug count. All original report-package runtime validity remains unverified. C20 explicitly preserves passing peer rows/status axes and the unresolved stricter healthy-peer health-isolation request, cross-linked to C18.

Categories use the canonical synthesis schema. Each category-normalization event and refreshed final snapshot preserves the prior human label in `categoryDetail`; technical validity, disposition, action, durable value, evidence strength, and rationale are unchanged.

| ID | Category | Disposition | Baseline validity / action | Evidence and durable value |
| --- | --- | --- | --- | --- |
| 540/C01 | non-behavioral | accepted-design | source metadata, test sketch, or heading; retain source accounting | captured source; source context |
| 540/C02 | non-behavioral | duplicate | mixed source container; child verdicts retained; follow atomic claim records without treating whole issue as one verdict | claims.jsonl and cited child evidence; lossless source qualifications |
| 540/C03 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C04 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C05 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C06 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C07 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C08 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C09 | non-behavioral | already-fixed | focused exact-key witnesses exist and pass; retain existing exact-target tests | E02: two existing exact-target tests passed; exact ownership witness |
| 540/C10 | non-behavioral | already-fixed | focused exact-key witnesses exist and pass; retain existing exact-target tests | E02: two existing exact-target tests passed; exact ownership witness |
| 540/C11 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C12 | non-behavioral | duplicate | composite: split current disabled and no-observer boundaries; follow 540/C42 and C43; obsolete clearError part remains stale | current docs plus E02; preserved mixed policy request |
| 540/C13 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C14 | coverage-gap | confirmed-open | no-observer no-op is supported; broad unobserved-error histories remain unverified; define inactive-but-owned observer cases and generate error/recovery paths under source-health owner | E02 no-sync witness; static limits audit; missing receiving history dimension |
| 540/C15 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C16 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C17 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C18 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C19 | coverage-gap | confirmed-open | partial bounded coverage; overlap/error timing not closed; extend source-health QueryDB receiving driver with controlled overlapping refetch failure/recovery schedules | E02/E05 plus grammar audit; generated overlap and receiving-boundary gap |
| 540/C20 | coverage-gap | confirmed-open | partial bounded coverage; overlap/error timing not closed; extend source-health QueryDB receiving driver with controlled overlapping refetch failure/recovery schedules | E02/E05 plus grammar audit; generated overlap and receiving-boundary gap |
| 540/C21 | non-behavioral | accepted-design | source metadata, test sketch, or heading; retain source accounting | captured source; source context |
| 540/C22 | coverage-gap | confirmed-open | partial bounded coverage; overlap/error timing not closed; extend source-health QueryDB receiving driver with controlled overlapping refetch failure/recovery schedules | E02/E05 plus grammar audit; generated overlap and receiving-boundary gap |
| 540/C23 | non-behavioral | already-fixed | current bounded witnesses satisfy this quality goal; retain deterministic provider-controlled examples and shared model receiver | E04/E09; E02 prior to identity strengthening; controlled isolated success/failure observations |
| 540/C24 | non-behavioral | accepted-design | optional testing technique; use a real QueryClient with controlled queryFn instead of requiring a mocked QueryClient | test-source inspection; receiving fidelity |
| 540/C25 | non-behavioral | already-fixed | current bounded witnesses satisfy this quality goal; retain deterministic provider-controlled examples and shared model receiver | E04/E09; E02 prior to identity strengthening; controlled isolated success/failure observations |
| 540/C26 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C27 | non-behavioral | accepted-design | current API migration and reloading field supported; retain migration/reload guidance | docs; E03 603 neighboring tests passed; health/reload vocabulary |
| 540/C28 | non-behavioral | duplicate | mixed source container; child verdicts retained; follow atomic claim records without treating whole issue as one verdict | claims.jsonl and cited child evidence; lossless source qualifications |
| 540/C29 | non-behavioral | duplicate | mixed source container; child verdicts retained; follow atomic claim records without treating whole issue as one verdict | claims.jsonl and cited child evidence; lossless source qualifications |
| 2270/C01 | non-behavioral | unverified | historical/provenance material preserved; old versions not replayed; retain source and missing exact-version replay | captured sources; adapted E04 is different runtime; historical trace and linked lineage |
| 2270/C02 | non-behavioral | accepted-design | source heading or reproduction introduction; retain source accounting | captured source; source context |
| 2270/C03 | non-behavioral | duplicate | mixed observation/proposal container; see atomic children; follow 2270/C18-C25 and C21-C22 | E04/E09 and source audit; preserved visibility versus attribution distinction |
| 2270/C04 | non-behavioral | unverified | historical/provenance material preserved; old versions not replayed; retain source and missing exact-version replay | captured sources; adapted E04 is different runtime; historical trace and linked lineage |
| 2270/C05 | non-behavioral | accepted-design | source heading or reproduction introduction; retain source accounting | captured source; source context |
| 2270/C06 | non-behavioral | accepted-design | source heading or reproduction introduction; retain source accounting | captured source; source context |
| 2270/C07 | non-behavioral | unverified | historical/provenance material preserved; old versions not replayed; retain source and missing exact-version replay | captured sources; adapted E04 is different runtime; historical trace and linked lineage |
| 2270/C08 | non-behavioral | stale | old error utility observations cannot be read on current API; preserve original for exact-version replay; use health observations at baseline | current declarations; E04 adapted workflow; API migration witness |
| 2270/C09 | non-behavioral | accepted-design | source heading or reproduction introduction; retain source accounting | captured source; source context |
| 2270/C10 | non-behavioral | duplicate | mixed observation/proposal container; see atomic children; follow 2270/C18-C25 and C21-C22 | E04/E09 and source audit; preserved visibility versus attribution distinction |
| 2270/C11 | non-behavioral | accepted-design | source heading or reproduction introduction; retain source accounting | captured source; source context |
| 2270/C12 | non-behavioral | accepted-design | conceptual observer/request boundary agrees with current contract; old line numbers unverified; retain distinction and current authority | architecture/docs plus E04; source observer versus request error boundary |
| 2270/C13 | non-behavioral | unverified | historical/provenance material preserved; old versions not replayed; retain source and missing exact-version replay | captured sources; adapted E04 is different runtime; historical trace and linked lineage |
| 2270/C14 | feature-request | design-decision | user need preserved; current health solves general visibility but not exact subset attribution; preserve use case and proposed oracle-backed implementation; obtain attribution decision | source statement; E04; paged-view failure attribution use case |
| 2270/C15 | feature-request | design-decision | user need preserved; current health solves general visibility but not exact subset attribution; preserve use case and proposed oracle-backed implementation; obtain attribution decision | source statement; E04; paged-view failure attribution use case |
| 2270/C16 | non-behavioral | unverified | historical/provenance material preserved; old versions not replayed; retain source and missing exact-version replay | captured sources; adapted E04 is different runtime; historical trace and linked lineage |
| 2271/C01 | non-behavioral | unverified | historical versions/trace/links preserved; report runtime not replayed; retain original package replay as explicit missing witness | captured source; E04 adapted baseline workflow; historical source provenance |
| 2271/C02 | non-behavioral | accepted-design | source heading, reproduction introduction, or offered remedy; retain source accounting; do not interpret offered PR as authorization | captured source; source context and proposed contribution |
| 2271/C03 | non-behavioral | duplicate | mixed observed persistence and recovery proposal; follow 2271/C17-C22 | E04 and current reload authority; preserved recovery-policy distinctions |
| 2271/C04 | non-behavioral | unverified | historical versions/trace/links preserved; report runtime not replayed; retain original package replay as explicit missing witness | captured source; E04 adapted baseline workflow; historical source provenance |
| 2271/C05 | non-behavioral | accepted-design | source heading, reproduction introduction, or offered remedy; retain source accounting; do not interpret offered PR as authorization | captured source; source context and proposed contribution |
| 2271/C06 | non-behavioral | accepted-design | source heading, reproduction introduction, or offered remedy; retain source accounting; do not interpret offered PR as authorization | captured source; source context and proposed contribution |
| 2271/C07 | non-behavioral | unverified | historical versions/trace/links preserved; report runtime not replayed; retain original package replay as explicit missing witness | captured source; E04 adapted baseline workflow; historical source provenance |
| 2271/C08 | non-behavioral | accepted-design | reported first-load persistence reproduced at current checkpoint; retain explicit own-reload recovery guidance | E04; E03; ARCHITECTURE law16; error-handling.md Reloading; failed first-load sync-run finality witness |
| 2271/C09 | non-behavioral | accepted-design | source heading, reproduction introduction, or offered remedy; retain source accounting; do not interpret offered PR as authorization | captured source; source context and proposed contribution |
| 2271/C10 | non-behavioral | duplicate | mixed observed persistence and recovery proposal; follow 2271/C17-C22 | E04 and current reload authority; preserved recovery-policy distinctions |
| 2271/C11 | non-behavioral | accepted-design | source heading, reproduction introduction, or offered remedy; retain source accounting; do not interpret offered PR as authorization | captured source; source context and proposed contribution |
| 2271/C12 | non-behavioral | accepted-design | conceptual new-run reset matches law; old internal lines unverified; retain public boundary explanation; avoid reliance on obsolete line numbers | ARCHITECTURE law16; E04; public recovery boundary |
| 2271/C13 | non-behavioral | unverified | historical versions/trace/links preserved; report runtime not replayed; retain original package replay as explicit missing witness | captured source; E04 adapted baseline workflow; historical source provenance |
| 2271/C14 | non-behavioral | refuted | only-recreation / no explicit recovery false at current baseline; document and use live.reload(); preserve old-version claim as unverified | E04: source refetch error/empty, then own reload ready/two rows; own reload receiving witness |
| 2271/C15 | non-behavioral | accepted-design | source heading, reproduction introduction, or offered remedy; retain source accounting; do not interpret offered PR as authorization | captured source; source context and proposed contribution |
| 2271/C16 | non-behavioral | unverified | historical versions/trace/links preserved; report runtime not replayed; retain original package replay as explicit missing witness | captured source; E04 adapted baseline workflow; historical source provenance |
| 2270/C17 | non-behavioral | duplicate | mixed observation/proposal container; see atomic children; follow 2270/C18-C25 and C21-C22 | E04/E09 and source audit; preserved visibility versus attribution distinction |
| 540/C30 | non-behavioral | accepted-design | source metadata, test sketch, or heading; retain source accounting | captured source; source context |
| 540/C31 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C32 | non-behavioral | stale | old API absent; retain historical source; do not add obsolete API tests | current declarations and #2168 / maintainer comment; migration record to health/reload |
| 540/C33 | non-behavioral | accepted-design | current API migration and reloading field supported; retain migration/reload guidance | docs; E03 603 neighboring tests passed; health/reload vocabulary |
| 540/C34 | non-behavioral | accepted-design | source metadata, test sketch, or heading; retain source accounting | captured source; source context |
| 540/C35 | non-behavioral | already-fixed | 1,296 source histories per plain/persisted path pass; retain model and counts; strengthen identity assertion | E09 final GREEN; E06/E07 calibration; independent still-failing Queries model |
| 540/C36 | non-behavioral | already-fixed | named baseline reload/abort witnesses exist; not all selected for runtime here; retain named tests; do not infer broader closure | static test audit; E03 neighboring core suite; existing reload retention and abort witnesses |
| 540/C37 | non-behavioral | already-fixed | named baseline reload/abort witnesses exist; not all selected for runtime here; retain named tests; do not infer broader closure | static test audit; E03 neighboring core suite; existing reload retention and abort witnesses |
| 540/C38 | non-behavioral | accepted-design | source metadata, test sketch, or heading; retain source accounting | captured source; source context |
| 540/C39 | non-behavioral | already-fixed | focused exact-key witnesses exist and pass; retain existing exact-target tests | E02: two existing exact-target tests passed; exact ownership witness |
| 540/C40 | coverage-gap | confirmed-open | partial bounded coverage; overlap/error timing not closed; extend source-health QueryDB receiving driver with controlled overlapping refetch failure/recovery schedules | E02/E05 plus grammar audit; generated overlap and receiving-boundary gap |
| 540/C41 | coverage-gap | confirmed-open | partial bounded coverage; overlap/error timing not closed; extend source-health QueryDB receiving driver with controlled overlapping refetch failure/recovery schedules | E02/E05 plus grammar audit; generated overlap and receiving-boundary gap |
| 2270/C18 | feature-request | design-decision | own-node passive failure expectation exceeds current source-health contract; decide subset-local passive-refetch attribution law before implementing it | ARCHITECTURE laws16/17; E04/E09; candidate per-demand attribution law |
| 2270/C19 | non-behavioral | already-fixed | rows/status/own request-error expectations supported; retain live receiver comparisons | E04 and E09 plain/persisted live receivers; ready rows and own-node isolation witness |
| 2270/C20 | feature-request | design-decision | partly satisfied: ready/rows/own request error unchanged; strict healthy-peer health isolation not satisfied and differs from accepted source mirroring; preserve partial E04/E09 status/row/own-error result; route healthy-peer source-health isolation to 2270/C18 maintainer decision | E04/E09 plus independent loss audit; explicit split of unaffected peer axes from shared source-health isolation proposal |
| 2271/C17 | non-behavioral | accepted-design | reported first-load persistence reproduced at current checkpoint; retain explicit own-reload recovery guidance | E04; E03; ARCHITECTURE law16; error-handling.md Reloading; failed first-load sync-run finality witness |
| 2271/C18 | non-behavioral | refuted | only-recreation / no explicit recovery false at current baseline; document and use live.reload(); preserve old-version claim as unverified | E04: source refetch error/empty, then own reload ready/two rows; own reload receiving witness |
| 2271/C19 | feature-request | design-decision | automatic same-run recovery differs from accepted finality; decide whether to revise initial-gate finality; no automatic recovery implementation here | architecture/glossary/docs plus E04; candidate automatic recovery law and rival |
| 2271/C20 | non-behavioral | already-fixed | explicit recovery option available as own reload; retain own-reload witness and docs | E04; error-handling.md Reloading; compatible explicit recovery route |
| 2271/C21 | non-behavioral | refuted | only-recreation / no explicit recovery false at current baseline; document and use live.reload(); preserve old-version claim as unverified | E04: source refetch error/empty, then own reload ready/two rows; own reload receiving witness |
| 2270/C21 | non-behavioral | unverified | historical/provenance material preserved; old versions not replayed; retain source and missing exact-version replay | captured sources; adapted E04 is different runtime; historical trace and linked lineage |
| 2270/C22 | feature-request | design-decision | own-node passive failure expectation exceeds current source-health contract; decide subset-local passive-refetch attribution law before implementing it | ARCHITECTURE laws16/17; E04/E09; candidate per-demand attribution law |
| 2271/C22 | non-behavioral | accepted-design | reported first-load persistence reproduced at current checkpoint; retain explicit own-reload recovery guidance | E04; E03; ARCHITECTURE law16; error-handling.md Reloading; failed first-load sync-run finality witness |
| pilot/D01 | model-harness-defect | fixed-now | confirmed old checker false green; repaired checker rejects clone; keep length/per-entry identity comparison and wrong/lawful controls | E06 RED, E07 calibration GREEN, E09 production GREEN; identity-sensitive oracle comparison |
| 2270/C23 | non-behavioral | accepted-design | ready status persists as accepted law requires; retain status/health separation | E04/E09; ARCHITECTURE law16; status versus sync health law |
| 2270/C24 | non-behavioral | stale | old error utility observations cannot be read on current API; preserve original for exact-version replay; use health observations at baseline | current declarations; E04 adapted workflow; API migration witness |
| 2270/C25 | non-behavioral | refuted | general no-visible-signal allegation false at current baseline; use live health tree for general refresh visibility; preserve finer attribution proposal | E04/E09 decisive source-boundary execution; current public health visibility witness |
| 540/C42 | feature-request | design-decision | no-op for disabled manual refetch conflicts with current imperative contract; maintainer decision only if changing manual enabled:false behavior | query-collection.md Utilities; E02 disabled test passed; preserved rival policy |
| 540/C43 | coverage-gap | confirmed-open | no-observer no-op is supported; broad unobserved-error histories remain unverified; define inactive-but-owned observer cases and generate error/recovery paths under source-health owner | E02 no-sync witness; static limits audit; missing receiving history dimension |
