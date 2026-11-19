# Persisted demand receiving coverage across adapters

This follow-up belongs to PR #2377 at
`92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`, with the working-tree instruments
identified by the adjacent versioned snapshots. The earlier all-adapter audit
omitted durable saved-demand receiving paths. That omission was a coverage
gap, not a maintainer decision to exclude the adapters.

## Law and applicability

The authority is the SQLite persistence guide, [On-demand Collections
offline](../../guides/sqlite-persistence.md#on-demand-collections-offline),
and the glossary's persisted demand coverage law. An exact demand that settled
online with durable rows can resume from those rows after its own wait or
upstream failure. A completed empty demand is covered too. Rows from a
different window, an unfinished load or a failed load establish no coverage.
Restored source rows must remain publicly available while readiness waits.
These startup histories supply no provider replacement or reset evidence;
adapter construction alone cannot erase the restored rows or saved coverage.

The independent judgment remains
`db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle.ts`.
Its expected computation and comparison are unchanged. The observation type
now admits every public Collection status so a crash cannot become an
apparently valid loading observation.

| Adapter | Receiving profile |
| --- | --- |
| Query | Actual QueryClient and queryFn, fresh client per storage session |
| Electric | Actual ShapeStream, controlled HTTP snapshot protocol |
| Native PowerSync | Actual SQLite SDK with its public subset hook held or rejected |
| TrailBase | Installed RecordApi over controlled JSON/SSE service input |
| Convex | Actual ConvexClient pagination over controlled WebSocket transitions; numeric leading-order windows |
| Direct PowerSync | Separate completed receiver and evidence in the [Direct review](2026-11-17-powersync-direct-persisted-demand.md) |

RxDB, local-only/localStorage and the vendored Neon adapter acquire eagerly.
They have no applicable physical subset-acquisition profile for this law.
Their eager startup/reload receiving evidence remains in the shared portfolio.
This exclusion follows their acquisition contract; it is not an untested
on-demand variant assumed to pass.

## Histories, production paths and observation cuts

The initial shared receiving suite enumerated twenty histories. Six first-run premises
(covered, empty, never requested, overlapping window, pending, failed) cross
zero wait, nonzero wait and early provider rejection. Two additional histories
deliver an identical late answer to covered and never-requested demand. Four
distinct ascending numeric ranks support a two-row ordered query and its
tie-boundary acquisition. The overlapping first demand requests three rows.
The changed-value amendment below retains these histories and adds three,
bringing the current profile to 23 histories and 30 checks per adapter/host.

Both hosts use fresh SDK instances and physically close/reopen storage:
file-backed `node:sqlite` with a fresh connection, and actual Chromium with a
fresh worker/OPFS connection. The browser runs the same production recorder,
history grammar, primary model and comparison as Node. Service input authors
the expected row facts. Adapter-generated startup truncates are diagnostics;
they are not independent provider authority to erase the saved demand.

The recorder checks durable rows before startup, raw live-query status,
ordered IDs when ready, preload settlement, public source `collection.base`
rows while loading, durable rows after each cut, and cleanup/browser errors.
Every offline run positively witnesses an actual SDK acquisition. Four bound
calibrations reject an uncovered crash, false readiness, missing restored
source rows before the deadline, and missing durable rows.

The instrument review corrected three concrete recorder errors before any
Convex production edit. It initially started clocks at raw SDK entry after
hydration, copied different request objects across the two boundaries, and
converted synchronous returns and throws into promises. The final recorder
tracks public persisted admission and raw source entry separately, shares one
request-data snapshot per attempt, and forwards original returns and throws.

Chromium then exposed premature cuts. Public admission can precede the
runtime's timer origin during startup. Raw provider settlement can also
precede wrapper-owned coverage metadata commits and graph continuations.
The recorder now observes core receipts from the outer persisted wrapper as
well as provider receipts. It schedules post-deadline observations
conservatively after raw source entry plus the configured wait, and drains
admitted operations/receipts across a bounded 100ms stable-input interval.
No loop polls readiness, expected rows or load settlement. The initial cut
still supplies the separate before-deadline witness. These observations do
not establish exact millisecond timer precision or universal quiescence.

Clock readings and storage-operation counts are diagnostic only. The semantic
trace retains each load's before/after-wait relation, every public observation,
provider facts, acquisition identities and cleanup errors. Diagnostics are
attached to a violation, outside the deterministic trace. No model rule or
comparison was relaxed to repair a browser failure.

## Review and execution record

The enforcement reviewer and independent law reviewer used `oracle-review`.
Both approved the v6 observation projection and bounded checkpoint design by
source inspection. The final pre-edit driver is `05b9365a...`, suite
`4d25e610...`; the [v6 snapshot](2026-11-18-other-adapters-persisted-demand-pre-edit-v6-snapshot.json)
records complete hashes, including original Convex production.

The original Convex source at `options.ts` has SHA-256
`8e1989d2d54605f1566c7e5ad867195cb8aa22876f9b2d5016bd992ff8a1ed81`.
Its lazy startup calls `receive([])`, sending a synthetic result through the
same first-result `truncate()` used for provider-authoritative replacement.
The receiving histories distinguish that reset from a genuinely empty online
result. No production repair preceded the corrected host comparisons.

Earlier v3/v4 browser failures were unclassified timing failures, not evidence
of additional adapter defects. Both v5 hosts passed all non-Convex semantic
comparisons; added numeric diagnostics alone failed determinism. The v6
projection corrects that diagnostic representation without weakening a law.
Calibrations with already-RED Convex baselines are reported separately and
never counted as mutant kills.

Commands, from the respective package directories:

```sh
# packages/db-adapter-conformance
pnpm exec vitest run tests/persisted-demand-receiving-oracle.test.ts \
  --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false --testTimeout=20000

# packages/browser-db-sqlite-persistence
pnpm exec vitest run --config vitest.adapter-oracles.config.ts \
  e2e/adapter-persisted-demand-oracle.browser.test.ts \
  --coverage.enabled=false --maxWorkers=1
```

The initial host gate registers 26 tests per adapter: twenty histories, declared reach,
four calibrations and determinism. The package/root adapter portfolio and the
named replay manifest include all ten new adapter/host profiles. The manifest
check passes 70/70. An initial broader replay run also reached an unrelated
native-module setup failure (`better-sqlite3` has no Node 24 binding in this
checkout); that setup failure is not product evidence.

## Scope and remaining receiving work

The initial family judged startup retention, saved exact/empty demand coverage,
overlap, unfinished/failed demand, per-load waits, early upstream failure and
identical late answers. The amendment below adds changed-value late replacement.
The family does not establish live source deletion/row-count invalidation, changed ordered membership,
Query retention expiry, Electric completed progressive full-sync semantics,
arbitrary filters/cursors, multi-tab coordination or deployed services.

The primary persisted demand owner retains the broader persistence laws.
Its existing Query retention and Electric progressive witnesses remain useful
component evidence; their in-memory storage/mock transport do not supply this
follow-up's durable real-SDK receiving proof. Further durable receivers for
those histories remain with that primary owner and the corresponding adapter
driver. This is not a claim that every adapter oracle gap is closed.

## Rubric accounting

ORC-001/002/003: public authority, unchanged independent judgment and literate
layers are named above and beside the executable suite. ORC-004: the finite
grammar reconstructs exact/empty/unfinished/failed/overlap startup cases;
removing a premise merges completeness with row presence, removing the wait
axis loses before/after readiness, and removing rejection loses immediate
fallback. Bounds are four unique ranks, windows two/three and three schedules;
unsupported arbitrary Convex filters are not transferred into this grammar.
ORC-005/014: actual SDK delivery plus both real storage hosts supply the named
receiving boundaries. ORC-006: four bound calibrations use the shared checker;
an already-failing baseline is not calibration evidence. ORC-007 does not
apply to this exhaustive finite source. ORC-008: no model state changed.
ORC-009: request identity and separate admission/source clocks are documented;
source-window observation uses the glossary's exposed authoritative base.
ORC-010: dynamic cleanup retains semantic observations and separate diagnostics.
ORC-011: no additional shared-model semantic fault was identified; service
facts remain independent of adapter resets. ORC-012: this versioned report
and source fingerprints bound every verdict. ORC-013: empty versus never,
exact versus overlapping and before versus after wait distinguish plausible
wrong startup rules. Exact timer precision is not claimed. ORC-015: all twelve
required states are declared and measured per adapter/host. ORC-016: every
history and calibration reuses the model, driver and comparison; no separate
expected examples were added.

## Pre-edit gate and first repair attempt

Both independent reviewers inspected the completed v6 logs before the repair.
Each host reported 117 PASS / 13 FAIL. Every failure belonged to Convex:
ten semantic failures, one derivative missing-restored-rows reach state, and
two calibrations whose clean baseline was already RED. The other four
adapters passed all 26 checks per host, including every required state.
The Node log hash starts `5a65ed84`; Chromium starts `222825b0`.

Only then did `convex-db-collection/src/options.ts` change. Lazy startup now
calls `markValidReady()` and resolves the no-demand first-result wait without
calling `receive([])`. It leaves `initialized` false until real provider data
arrives. The first actual result, empty or nonempty, retains the existing
truncate/replacement and receipt path. An `!initialized` guard preserves that
receipt path if a result has already arrived. Supported lazy pagination
constructs no pages before demand, so this audit does not invent a synchronous
provider callback at that otherwise unreachable construction cut.

Both reviewers initially found no source-level regression in this minimal change.
The first-attempt options hash starts `3f9a9a2f`. `awaitSync()` with no demand
retains its permitted immediate completion; an active demand still waits for
the pager's current result and sync acceptance. Production size comparison
against HEAD reports a Convex package bundle of 4,363 to 4,365 gzip bytes
(+2), and +1 brotli byte. No new state variable or recovery path ships.

The first attempt passes all 130 new receiving checks on each host and all
335 primary persistence neighbor checks. It fails 16 existing Convex lazy
checks: eight bounded-work/publication checks, four optimistic-hold checks,
and four reentrant-receipt checks. These are production regressions, not
spurious receiving results. Delaying `initialized` makes the first actual
lazy result take the eager first-result truncate path. That path creates a
reset replay and forces application through optimistic holds.

At this first-attempt evidence cut, the repair remained open. The lazy owner was being extended with retained and
accepted-but-held baselines before the next production edit. Its independent
value, work, publication and receipt judgments remain in force. A finite
provider prefix also needs an explicit authority check before deleting
restored keys outside that prefix; the prior truncate is not authority for
such deletion. A final GREEN and mutant record must supersede this attempt
before this review can claim completion.

## Changed-value extension before the next repair

The next instrument preserves all twenty histories and adds three late online
answers with changed values at the same keys and ranks. The full public query
payload joins the existing source and durable payload observations. Its
expected rows still come from the primary persistence model. A bound
calibration replaces the late public values with saved values while retaining
the current source and durable facts. Virtual Collection fields remain outside
this model's declared payload; they are not copied into its observations.

Both hosts report 148 PASS / 2 FAIL, with all thirteen required states reached
on each adapter/host. Query, Electric, TrailBase and Convex each pass 30/30.
Native PowerSync has one stale-value mismatch and its consequently invalid
calibration baseline. The calibration is not counted as a mutant kill.
The first projection attempt copied virtual fields and failed determinism;
the corrected explicit payload projection is the v2 evidence. Source-based
annotation/prose changes after that execution do not claim a new host run.

The actual native SDK trace confirms a production defect. An unfiltered
ordered demand and its filtered boundary demand both fulfill without abort.
The tracking rebuild turns their union into `NULL OR rank = 2`, reads only
row 2, and writes only its new value. Row 1 stays at its saved value in the
source, public query and durable storage. An absent top-level predicate means
all rows; it is not a SQL NULL predicate inside an OR expression. The original
row-ID-only receiving projection could not distinguish this stale payload.
The native repair has not yet been made at this evidence cut.

The dedicated Convex peer receiver separately exercises a saved wider demand
whose hydration is accepted behind an optimistic hold while only a smaller
raw provider demand has entered. Its finite provider prefix must not erase the
wider demand's saved suffix. That path supplies the outside-prefix evidence
the four-row changed-value grammar does not establish.

## Convex authority and acceptance repair

The repair separates lazy startup readiness from provider result authority.
Lazy construction marks ready without manufacturing an empty provider result.
Eager authoritative replacement retains its existing truncate path. A lazy
result reconciles against accepted source rows, including accepted but unapplied
sync transactions, and ordered proposals deferred by a wrapping sync. It
removes an omitted row only when the provider previously supported that key or
the current result disproves its value within an authoritative scope. A finite
prefix has strict rank authority: its last tie group may be incomplete.

The [peer receiving record](2026-11-18-convex-persisted-demand-peer.md) retains
the real SDK/storage RED results and source gate for the larger accepted demand
outside a smaller returned prefix. Both hosts reject all eight original peer
histories. The [lazy baseline record](2026-11-18-convex-lazy-baseline-neighbors.md)
owns controlled applied/accepted/deferred baselines and optimistic publication
neighbors. The [later-support amendment](2026-11-18-convex-late-baseline-support.md)
adds later public hydration and provider attribution at a reference-identical
row. A newly provider-supported key needs a source write even when its object
equals the hydration seed, because later seeds must no longer overwrite it.
These use existing independent row, publication, coverage and version laws;
no new expected answer is derived from the reconciliation branches.

The final candidate at this cut is `options.ts` SHA-256 `872d94be...`,
`pagination.ts` `1328c4bf...`, and `subscription.ts` `375baafa...`. Both law and
enforcement reviewers approved the source and instrument changes, subject to
final mutation and integration evidence. The earlier failing first attempt is
historical evidence, not the final production disposition.

## Final integration and independent verdicts

The final common receiver passes **150/150 on Node 24.19.0** and **150/150
on Chromium worker/OPFS**: 30 checks for each of Query, Electric, native
PowerSync, TrailBase and lazy Convex. All thirteen required states reach on
every profile. Query, Electric and TrailBase need no production change for
these new histories. The initial browser integration attempt could not bind
its local HTTP server inside the sandbox; it ran no histories and is setup
evidence only. The permitted rerun supplies the Chromium result above.

Native PowerSync's [union review](2026-11-18-native-demand-union.md) records
the independent literal-set model, original both-host RED gate, minimal absent
predicate normalization to `TRUE`, 81/81 final checks per host, and the
release-publication observation gap found and closed during mutation review.
Its final package run passes 1,684 oracle checks across nine files with no
type errors; 74 existing ordinary on-demand checks also pass. Both independent
reviewers approved its exact final source and evidence.

Convex's [mutation review](2026-11-18-convex-baseline-mutations.md) records
30/30 common and 12/12 saved-peer checks per host plus 80/80 controlled
baseline checks. Enforcement approved the final source and instruments after
checking 84 evidence hashes and the raw semantic causes. Nine wrong designs
are rejected. The final full Convex package campaign passes **1,857 oracle
checks across 23 files**, with no type errors. The public-base mutant is rejected by the controlled owner;
its actual peer survival is stated separately. Ignoring proposal tombstones
is a permitted full-row alternative within the exercised successful FIFO,
no-metadata domain; this does not establish equivalence for arbitrary metadata
or cancellation histories. No write-kind law was invented to force a kill.

Primary persistence neighbors pass 356 checks with one existing skip and no
type errors. Shared conformance, browser persistence and Convex package
TypeScript checks pass. Replay discovery passes all 70 named-manifest checks;
the two new peer entries also resolve to twelve runtime-collected cases per
host with the right browser configuration. The five registry-runner checks
pass. Scoped ESLint reports no errors and one cosmetic `require-await` warning:
the Convex source factory intentionally retains an async rejection boundary.
Root `pnpm lint:changed` and `git diff --check` also complete with exit 0.

The production bundle comparison against exact HEAD, with dependencies
external, changes Convex from 4,363 to 4,576 gzip bytes (+213), and native
PowerSync from 7,245 to 7,343 (+98). These package totals include all changes
in this branch relative to HEAD, including the earlier native decoder repair;
they are not an isolated cost measurement for predicate normalization.

The remaining receiving limits above still apply. In particular, the real
persisted peer receiver proves finite-prefix preservation, not exhausted-empty
source deletion over an accepted restore or durable rows never hydrated into
the Collection. The [bounded assessment](2026-11-18-convex-lazy-baseline-neighbors.md)
names the primary owners and needed witness; that unexecuted hypothesis is
neither a confirmed defect nor proof of missing production information.
SDK release dependencies in the broader portfolio remain open. This work
closes the demonstrated startup/finite-prefix retention and native union
defects within the recorded histories and observations, not every possible
adapter oracle gap.

The [final integration inventory](2026-11-18-other-adapters-persisted-demand-final-evidence.json)
binds these results to source, instrument and log fingerprints, with the
earlier gate and per-owner manifests retained separately.
