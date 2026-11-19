# Cross-adapter receiving review

This record extends PR #2377's Direct review to the other Collection adapters.
The law inventory precedes production repairs. A failure can indict a test
premise, an observation cut, the adapter, or its installed SDK.

## Shared law boundaries

Complete eager replacement applies to complete provider results. Local-only
reload keeps its sole user-owned copy and receives its existing lifecycle law.
Query may serve a complete cached result on reload. Convex ignores a cached
peer error while waiting for a fresh server verdict. Electric creates separate
ShapeStreams. The generic terminal-gate receiver therefore declares its entry
premises; its default fresh/reload/shared campaigns remain unchanged.

TrailBase supplied an executed distinguishing witness for empty completion:
fresh-empty and reload-empty each call `markReady()` once in the new run,
submit zero transactions, and expose the correct empty result. The earlier
checker rejected only the absence of a commit. The glossary explicitly permits
that completion. The recorder now counts actual source readiness calls and
accepts zero commits only for an empty result with that witness. Exact row,
acceptance and optimistic-overlay comparisons remain. Evidence is in
`.review-2377/trailbase-sdk-precise-probes.log` and the TrailBase review.

The shared reload checker now has bound replacement controls for snapshot,
truncate and receiver-owned sweep implementations. Wrong rows, omitted source
acceptance and missing optimistic state use bound raw controls. Budgets remain
80 histories per fixed and fresh campaign, with all eleven constructed states.

Cleanup diagnostics travel with completed raw observations through
`retainOracleCleanupObservation`. Product differences are judged before the
separate receiving-cleanup verdict. An actual Collection recorder control
retains wrong rows, a source-cleanup failure and an SDK-disposal failure while
attempting both releases. Gate and reload share that helper.

A second executed recorder defect suppressed only RxDB's actual `markReady`:
rows and a receipt applied, but the recorder indefinitely awaited the verdict
being tested. Independent review then reached an empty provider result whose
adapter omitted both readiness and commits; the earlier submission wait also
prevented comparison. Every receiver now supplies a required provider-consumption
barrier before that observation. It completes independently of the Collection's
readiness and commit calls, including an empty result. Actual receipt acceptance
and application still gate their respective observations. A second provider
barrier drains later-issued receipts, followed by finite promise continuations.
The comparison records pending readiness as a semantic difference and cleanup
still runs. A valid provider requiring twelve task turns passes through its
actual completion barrier; no universal four-turn provider latency is imposed.

Initial-receipt cleanup has an explicit authored outcome. A held receipt may
reject through abandonment or a real storage failure, or apply an admitted
transaction after cleanup. The latter must positively record settlement;
pending is not accepted as application. Both outcomes require an empty final
cleaned-up public snapshot and no detached rejection. Direct's existing
rejected-outcome campaigns retain their default behavior.

## Adapter evidence

| Adapter | Receiving review | Current production disposition |
| --- | --- | --- |
| Query | [Report](2026-11-17-cross-adapter-query.md) | Independent approvals; no production defect found in the receiving scope. |
| Convex | [Report](2026-11-17-cross-adapter-convex.md), [saved-demand follow-up](2026-11-18-other-adapters-persisted-demand.md), [mutation review](2026-11-18-convex-baseline-mutations.md) | Lazy startup reset and baseline reconciliation repaired; independent oracle/source/mutation approval within the recorded startup, finite-prefix and attribution scope. |
| Local-only / LocalStorage | [Report](2026-11-17-cross-adapter-local-stores.md) | Independent approval; Node and native browser comparisons pass. |
| RxDB | [Report](2026-11-17-cross-adapter-rxdb.md), [persisted receipt](2026-11-17-cross-adapter-rxdb-persisted-receipt.md) | Owned instruments and final receiving barrier independently approved, with actual Node/Chromium comparisons; production unchanged. |
| Electric | [Report](2026-11-17-cross-adapter-electric.md) | Final owned SDK/browser instruments independently approved, including empty-completion controls; production unchanged. |
| Native PowerSync | [Report](2026-11-17-cross-adapter-powersync.md), [independent production review](2026-11-18-native-powersync-production-independent-review.md), [demand union](2026-11-18-native-demand-union.md) | Fatal decoder handling and unrestricted-plus-filtered demand union repaired. The union owner additionally checks every publication while an unchanged unrestricted union survives retirement. Exact earlier and amended campaigns remain separately attributed. |
| TrailBase | [Report](2026-11-17-cross-adapter-trailbase.md) | Old same-key mutation evidence repaired and independently approved; installed SDK numeric JSON defect remains open. |
| Neon | [Report](2026-11-17-cross-adapter-neon.md), [independent SDK proposal review](2026-11-18-neon-sdk-evidence-independent.md) | Bounded vendored adapter repairs and final v13 dependency carry independently approved. Isolated SDK proposals pass 538 Node and 413 Chromium checks; installed SDK 0.2 remains RED on applied evidence after closure. |
| Direct PowerSync | [Saved-demand review](2026-11-17-powersync-direct-persisted-demand.md), [mapper cancellation](2026-11-18-powersync-direct-mapper-abort.md), [decoder review](2026-11-17-powersync-direct-decode.md) | Saved-demand/reopen, bounded cursor, mapper cancellation and decoder startup/thrown-value repairs independently approved within their recorded scopes. Checkpoint-event and maintained-Node SDK releases remain dependencies. |

These verdicts cover the recorded receiving slices; the installed-SDK portfolio
is not entirely GREEN. Per-adapter records retain exact source/test hashes,
commands, reach and mutant outcomes. Required real-host paths precede each
related production repair. Setup errors and timeouts do not count as semantic
RED results.

The [shared recorder amendment](2026-11-18-shared-reload-recorder-repair.md)
and its exact snapshot retain the independently reproduced hidden-wait defect,
the required provider barriers, ordinary recorder RED/GREEN, actual SDK mutant
controls and final receiving runs. The
[portfolio command review](2026-11-18-cross-adapter-registry-integration.md)
records package discovery and failure propagation separately from product
comparisons. The standalone SDK's
[maintained-Node compatibility proposal](2026-11-17-powersync-sdk-node-map-compatibility.md)
has an [independent review](2026-11-17-powersync-sdk-node-map-compatibility-independent-review.md):
Node 24 and 26 pass its isolated upstream tests; Node 22 remains unexecuted.

The [receiving diagnostic amendment](2026-11-18-receiving-cleanup-fidelity.md)
and its snapshot record a separate failure-fidelity audit. Independent review
approved the exact diagnostic-only changes and verified all 24 source hashes.
Earlier normal-provider results carry across those changes with their updated
dependencies; the earlier manifests and run attribution remain historical.
Actual-function fault controls establish diagnostic behavior only. They add no
SDK or host receiving evidence. Direct's transport/persistence
checkpoint amendments have separate renewed receiving results in their records.


## Final integration, 2026-11-18

The final Direct candidate is `index.ts` SHA-256
`6b0a8092fad1fe7032bce093063639120d4f16001068f03d6581fce5182054a0`
and `subsets.ts`
`20f8ed310b98099604fd05ae32a269b6554b87b937e31300f8dca3ac3a019da3`.
The decoder's new cause/cache paths pass 334 Node and 327 Chromium checks,
including all 72 states in both campaigns. Both isolated original faults fail
the shared comparison; an actual alternative readiness order passes. Independent
source and oracle reviewers approved the bounded repair.

Main saved-demand, cursor and mapper executions remain attributed to their
recorded earlier source. Independent source inspection permits carry within
those nonthrowing-parser and ordinary-Error domains: forwarding an Error to
`fail` preserves the same value; creating subset handlers early acquires no
resource or mapper work; the normal listener/status/lease and replacement paths
are unchanged. This carry supplies no arbitrary-cause or cached-refusal evidence;
the new decoder runs supply those witnesses.

The [dynamic cleanup-list audit](2026-11-18-receiving-cleanup-dynamic-list.md)
records a separate shared-helper repair. The original helper snapshotted teardown
callbacks before a recorder could register acquired resources. The new helper
collects them when recording exits. Thirty non-test call sites were inspected:
26 literal arrays, three forwarding wrappers whose callers supply literals,
and the one dynamic decoder path. Static callers retain their prior evidence
through inspected equivalent behavior; no additional host run is claimed for
them. The dynamic Direct receiver has the new actual Node/Chromium evidence.
The underlying cleanup executor and total formatter are unchanged.

### Shipped bytes

Both production comparisons pass: `pnpm size:compare --packages
powersync-direct-collection,powersync-db-collection,trailbase-db-collection --files`
and the same command with `--base HEAD --exact-base`. Dependencies remain external
and `NODE_ENV=production`, as the repository's size instrument specifies.

| Package | Current gzip bytes | Gzip delta from PR head | Brotli delta from PR head |
| --- | ---: | ---: | ---: |
| Direct PowerSync | 1,510 | +88 | +87 |
| Native PowerSync | 7,328 | +83 | +53 |
| TrailBase | 2,708 | +28 | +18 |
| Total | 11,546 | +199 | +158 |

Against `origin/main`'s merge-base `21c52a07e`, Direct is a new package:
0 to 1,510 gzip bytes and 0 to 1,383 brotli bytes. The other adapter deltas are
the same as above. The typical app and all seven additional app scenarios are
unchanged in both comparisons.

The repairs retain a small byte increase after reusing existing mechanisms.
Direct removes unsafe error normalization and reuses one configured handler
result for ordinary and stopped startup; one replacement flag and cancellation
guards remain necessary. Native PowerSync centralizes fatal decoding and uses
its existing abort/disposal path; retaining the failure is necessary to reject
later same-run work. TrailBase reuses its existing Map with event identity,
which distinguishes two events in one clock tick without another ledger.
The recorded merge-only, empty-mapper, missing-guard, health-only and stale-event
mutants reject removing these distinctions.

Tests and receiving support add about 0.95 MB of raw source, contract documentation
about 0.02 MB, and versioned review evidence about 4 MB. These are unshipped
source/evidence weights, separate from the compressed production bytes above.
Local `.review-2377` scratch files are excluded from those figures. Exact size
logs and non-production inventory remain in that local evidence directory.

The [integration fingerprint](2026-11-18-cross-adapter-integration-snapshot.json)
records the final changed-source inventory and dated evidence hashes. It is an
integration fingerprint, not a fresh execution of every portfolio command.
Per-adapter manifests retain execution attribution, bounded source carries and
remaining limits. No commit, push or installed-SDK patch is part of this work.

Root verification completed with `pnpm lint:changed` and `git diff --check`, both
exit 0. Package-specific type, lint, formatting and receiving results remain
attributed to their owner records, including their explicit limits. The shared
dynamic-list applicability audit received final independent acknowledgment;
no further source changes were pending at that integration cut. The subsequent
[saved-demand follow-up](2026-11-18-other-adapters-persisted-demand.md) adds
durable receiving coverage for the five other on-demand adapters and exposes
Convex startup/baseline and native PowerSync predicate-union defects. Both
repairs have independent oracle/source approval; the follow-up records final
integration results and narrower remaining receiving obligations. The open SDK
release and Node 22 validation gates above remain open.
