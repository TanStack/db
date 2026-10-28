# Convex lazy paging implementation evidence — 2026-10-26

This implements the maintainer-approved fixed-query lazy-paging design on PR
2230, starting at `8c24922026fb4a714cb54b992ac85faa2e876742`. The companion
[source manifest](2026-10-26-convex-lazy-paging-source.json) binds this record to
the reviewed working-tree files; it excludes the record itself and the preserved
local installation override. Earlier analytical design documents and their
63 TLA+ configurations remain frozen. Their original statements about work
not yet executed are historical; this record supplies implementation evidence.

## Law and boundary

`convexPaginatedCollectionOptions` supports `syncMode: 'on-demand'` using the
existing pager and subset protocol. One fixed server query declares its finite
numeric leading order. DB can order trailing terms locally because an acquired
window establishes every row tied at its leading boundary. Offset requests
establish the preceding prefix; whole-source requests may exhaust the query.
General query translation and arbitrary application filters/orders are outside
the initial public profile, as is array `select` in lazy mode.

Authority is the approved October 26 design, now stated in the
[collection guide](../../collections/convex-collection.md), the public
`LoadSubsetOptions`/`LoadSubsetFn` and applied-receipt contracts in
`packages/db/src/types.ts`, and ordered window publication in
`packages/db/src/query/live/ARCHITECTURE.md`.

A successful acquisition establishes its exact scope and waits for its actual
establishing writes to apply. Abort cannot withdraw accepted writes. No demand
or a zero limit starts no page. A new successor range needs delivered evidence
that an active scope remains incomplete. This is not a total call, memory,
network or scan budget. Cached completion, one batch and multiple actual batches
are legal. A live query retains its previous complete window while acquisition,
movement or repair is pending. Cleanup fences obsolete callbacks, including
after restart, and the old dependent graph stays terminal.

The independent model orders authored rows for value/coverage checks. Its
separate work relation sees only delivered rows and whole-source exhaustion;
it cannot consult the hidden suffix. Opaque cursor intervals belong to the
transport driver. Production cursor parsing, expression evaluation, pager
state and source Collection rows do not compute expected results.

## Grammar, observation and measured reach

Five properties each run 60 fixed-seed histories (`20261026`) and 60 histories
without a seed, using the same arbitrary, recorder, comparison and budget.
Every declared state below was reached by **60 histories in each campaign**;
`createOracleReach` enforces a per-campaign minimum of one. These are 600
property histories, not a universal proof.

| Family / replay prefix | Declared states |
| --- | --- |
| `CONVEX_LAZY_VALUES_ORACLE` | offset-crosses-page; scoped-unlimited-tie; continuation-scope; whole-source-exhausted; authoritative-empty; required-split; recommended-split; short-nonterminal; unsupported-shape-rejected; rejected-unload-preserves-peer |
| `CONVEX_LAZY_WORK_ORACLE` | no-demand; zero-limit; finite-with-unread-tail; gap-free-growth-across-page; shallow-read-during-growth; peer-survives-release; same-object-pending-attempts |
| `CONVEX_LAZY_PUBLICATION_ORACLE` | pending-initial-window; pending-window-move; pending-boundary-repair; completed-boundary-refill; coherent-cache-before-callback; refetch-cache-before-callback |
| `CONVEX_LAZY_LIFECYCLE_ORACLE` | actual-establishing-set-checked; abort-before-acceptance; abort-after-acceptance; stale-after-restart; same-run-reconnect-recovery; cleanup-start-fences-callback; held-cleanup-fences-callback; old-dependent-stays-terminal |
| `CONVEX_LAZY_RECEIPT_ORACLE` | reentrant-second-held-receipt; cached-load-waits-for-latest |

The arbitrary bounds source size to 16–32, provider page size to 1–5, base
offset/limit to 1–5, both directions and callback orders, 32 independently
authored texts of length 0–8, and a 0–8-step limit suffix with values 1–12.
Values use adjacent two-row ties, explicit scoped ties/continuations, a separate
empty source, and short/split scenes at page size four. The offset scene adds
the page size and observes successor work before crediting a crossed page.
Work uses unique ranks, page size four, top-three then top-six, a held deeper
tail and a healthy cached peer; its generated suffix moves finite limits.
Publication uses page size two and unique ranks to force held initial/moved
windows, deletion of all acquired rows and refill, then cache-only refetch.
Lifecycle uses generated page partitions and direction with two abort cuts,
reconnect, held cleanup and restart. The receipt family varies rows, text,
direction and page size, opening the second optimistic hold synchronously from
the first batch's actual public publication.

Not every shared arbitrary field contributes to every family: offset/limit and
reverse delivery belong to values; reverse also belongs to publication; the
suffix belongs only to work. No semantic credit is claimed for ignored fields.
Removing ties loses coverage-vs-display discrimination; removing holds loses
early settlement/publication; removing growth loses gap-free continuation;
removing reentry loses the older-receipt overwrite; removing cleanup/restart
loses run authority. Constructive prefixes preserve those witnesses under
shrinking. Invalid directions, counts, filters and cursor predicates are nearby
negative controls. Invalid numeric caps and malformed order declarations have
separate bounded configuration checks, including every startup status event.

The actual factory, Collection `_sync` normalization and ordered live-query
entry points run production. Every public live publication and checkpoint read
is retained. Completion checks reject a responsive-provider quiescent stall by
name. The fixture's nonquiescent turn guard is diagnostic, not a product cap.
`withTestCleanup` preserves primary failures and secondary cleanup diagnostics;
held gates and dependent resources are released on failing histories too.

## RED, repairs and hostile controls

The original eager runtime failed the new work oracle at the no-demand
comparison. A second calibration enabled only the proposed public type shape,
leaving runtime unchanged, and reproduced that semantic failure. This is RED
for a newly proposed capability, not a claim that the original public API
already advertised lazy mode. The log is `red-public-enabled.log`.

Further extended scenes produced semantic RED before their repairs:

- The split scene rejected an unbounded right split child as an unrelated new
  successor (`split-witness1.log`). Children now stay within the parent's
  returned interval. The existing eager oracle then caught missing continuation
  after bounded split children (`green-campaigns2.log`); eager exhaustion was
  restored without changing that oracle's expectations.
- Submitting the same immutable request object twice stranded its first waiter
  at the named progress comparison (`duplicate-red.log`). Pending duplicate
  attempts now share completion.
- A public callback opened a second optimistic hold and installed a newer
  source revision before the older receipt continuation ran. A cached third
  load incorrectly settled with the old row (`receipt-red.log`). The older
  callback now clears `visible` only if it still identifies that receipt.
- Invalid lazy startup emitted loading → ready → error before validating its
  cap (`invalid-cap-red4.log`). Subscription construction now precedes the
  empty initial acceptance. The first acquired page still does not replay an
  initial truncate. Earlier missing-import attempts were setup failures;
  assuming `preload` must preserve the adapter's RangeError class was an
  overly specific expectation. The final check preserves the adapter error and
  checks the actual readiness law.
- Malformed runtime order declarations failed rejection before validation
  (`order-runtime-red.log`). The type-level numeric-field check also first
  failed as an unused `@ts-expect-error` (`types-order-red.log`).

Seven temporary production mutants were each run, shrunk, replayed directly,
restored byte-for-byte, and checked with a repaired direct replay:

| Mutant | Intended failure |
| --- | --- |
| eager startup | no row range without demand |
| unbounded right split child | unrelated successor at the work comparison |
| settle at boundary without its full tie | missing/current row at coverage |
| skip applied receipt | load settled before accepted rows applied |
| older receipt overwrites newer held receipt | cached load skipped newer establishing receipt |
| overwrite pending same-object attempt | quiescent responsive provider left load pending |
| stop after first sealed page | same named progress comparison |

All seven were semantic comparison failures, not timeouts, setup failures or
unreached paths. All mutant direct replays failed and all repaired replays
passed. Each used seed `20261026` and this 34-component shrink path:

```text
0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0
```

For example, from `packages/convex-db-collection`:

```sh
CONVEX_LAZY_RECEIPT_ORACLE_SEED=20261026 \
CONVEX_LAZY_RECEIPT_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0 \
../../node_modules/.bin/vitest run tests/lazy-paging-oracle.property.test.ts \
  -t 'keeps the newer establishing' --coverage.enabled=false --typecheck.enabled=false
```

The audit's original findings and closure were checked independently by the
Query and lifecycle reviewers. Review also repaired timeout-only progress,
nonconstructive offset reach and a vacuous/final-only React publication check.
The current React recorder requires an actual committed ready target tuple.

## Receiving witnesses and validation

The SDK receiver feeds legal multi-query wire transitions through both real
SDKs and checks every callback against the shared publication relation. It
positively observes the callback comparison. This closes the coherent-cache
premise at the SDK boundary; it does not stand in for server cursor evidence.

The backend receiver uses Convex 1.47.0 and cached local backend
`precompiled-2026-10-10-72ce13c`. Both clients passed no-demand, finite unread
prefix, offset growth, live delete/move, required/recommended splits, a native
four-row leading tie with DB's independent trailing client-ID order, and real
TCP reconnect. Stable-source work checking observed three permitted successor
starts per client. The strengthened run observed eight/ten required-split
responses and four native tie rows per client. Response counts can repeat;
they are not a call or split-count guarantee.

React's actual `useLiveInfiniteQuery` receives the shared authored values for
provider page sizes 1–4, seven rows with ties and four displayed page counts.
Every committed ready data/page/parameter/lookahead tuple must be the complete
old tuple until the new one appears, then cannot revert; the target tuple must
actually occur. Settled fetching flags are also checked.

Executed validation:

- Complete adapter runtime: **10 files / 77 tests**, including all five
  fixed/random lazy campaigns and existing eager, snapshot, ownership, offline
  and native-value owners (`runtime-final1.log`).
- Full isolated backend suite: **5 files / 20 tests**, including 36 durable
  crash/replay histories, pinned public apps and real auth
  (`backend-full1.log`). The strengthened native-tie receiver subsequently
  passed both clients (`backend-native-ties.log`).
- Core replay, transaction, ordered lifecycle and cleanup owners:
  **5 files / 458 tests** (`core-owners.log`). This is delegated core evidence,
  not native Convex replay coverage.
- React receiver and existing infinite-query tests: **17 tests**
  (`react4.log`); the strengthened every-ready-tuple receiver passed its four
  cases (`react-final.log`).
- Package TypeScript including public type assertions:
  `tsc --noEmit --rootDir ../..` passed (`types-final.log`). Stock Vitest
  typechecking had the same workspace rootDir errors on baseline; runtime
  campaigns disable that runner and use this separate successful check.
- Changed-file ESLint, `pnpm lint:changed`, formatting and `git diff --check`
  passed. The oracle lint script prints a harmless missing local `main`
  diagnostic while successfully using `origin/main`.
- Both required minified size comparisons built successfully. Combined exports
  are **4,096 gzip / 3,700 brotli bytes**, versus no package at the origin/main
  merge base. Against the starting PR revision they grow **1,228 gzip /
  1,106 brotli bytes**. Existing app scenarios change by zero bytes. The exact
  baseline uses archived source and the same installed dependency versions.

The existing page chain and snapshot writer supply both modes; there is no
second pager, factory, mutation queue or recovery state machine. New bytes pay
for explicit capability parsing and coverage/waiter/receipt obligations. The
split, tie, progress and receipt mutants show why removing those distinctions
would violate the feature. Test/driver/documentation growth is outside the
shipped measurement.

Local install state was preserved byte-for-byte: the pre-existing
`baseline-browser-mapping` override selects **2.11.30 instead of 2.11.32**.
Neither the override nor lockfile changes belong in this implementation.
Missing test/build dependencies were reused at their declared installed
versions through ignored local links; no new dependency downgrade was made.

## ORC audit and limits

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Authority and excluded profile are beside the model and in the public guide. |
| ORC-002 | Authored array/window recomputation and delivered-only work knowledge import no pager semantics. |
| ORC-003 | Contract, model, grammar, driver and comparison prose remain in the directly named executable modules. |
| ORC-004 | Constructive witnesses, bounds, per-family axis use, ablations and invalid neighbors are documented above. |
| ORC-005 | Real Collection/live-query path, every publication/read, named pending cuts and positive receiving observations. Installed source facts are read before comparison; no concrete unresolved missing-input hypothesis remains within these cuts. |
| ORC-006 | Seven semantic mutants, direct replay and restored GREEN; wrong-result controls reject missing ties and transient windows. |
| ORC-007 | Same fixed/random property and budget; checked seed/path replay without a command replayPath because no fc.commands grammar is used. |
| ORC-008 | Value model is stateless recomputation. The work recorder retains delivered knowledge, exhaustion and exact active scopes because each changes next successor permission; public trace keeps whether the new window appeared because it changes allowed observations. |
| ORC-009 | Delivered evidence is provider-visible knowledge; applied receipts are actual core promises; transport cursor tables are authored intervals, not DB cursor state. Scope/coverage/publication remain separate. |
| ORC-010 | Shared cleanup helper preserves primary/secondary failures; gates, requests, dependents, sockets and backends release during shrinking. |
| ORC-011 | Shared hidden-suffix fault is challenged by paired suffix controls and delivered-only work judgment. Native cursors and local trailing ties use real server queries as receiving evidence. The frozen formal projections are distinct analytical formulations with their own limits, not a production equivalence claim. |
| ORC-012 | This versioned record, source manifest, findings/repairs, validation and explicit remaining limits bind the claim. |
| ORC-013 | Adjacent boundary ties, zero/nonzero, page-crossing growth, before/after acceptance, cached newer-held receipt and unchanged-source refetch distinguish the plausible wrong rules; mutants fail there. |
| ORC-014 | Real SDK cache scheduling, native splits/ties/reconnect and actual React ready tuples supply the named controlled-premise handoffs. Host replay/delayed cancellation remain delegated, not silently claimed. |
| ORC-015 | All 33 declared states reach 60 histories per fixed and random campaign, with enforced minima. |

No combined unbounded proof follows from these finite tests or the TLA+
projections. Continuous nonquiescent resealing has only a diagnostic guard.
Independent range loading, other framework receivers, general query
translation and broader provider/host timing remain outside this claim.

An arbitrary external truncate wrapper is incompatible with the snapshot
writer's private previous/initialized state and is not a native Convex reset
mechanism. It earns no replay coverage here. The primary core replay owners
cover failed replay gates, authoritative recovery and delayed participation.
The adapter supplies real batches and prompt cancellation; it does not invent
multiple progressive commits for every acquisition. Source restart can cause
an errored dependent's retained subscription to request the whole source;
its graph remains terminal. The cleanup driver explicitly accounts for that
actual demand and makes no zero-post-error-acquisition promise.
