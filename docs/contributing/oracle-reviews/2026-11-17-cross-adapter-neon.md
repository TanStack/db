# Neon cross-adapter receiving audit

Review base: PR #2377 local branch `powersync-standalone-package`, original
head `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`. This is append-only evidence;
the source and receiver fingerprints below identify each phase.

## Pre-edit law and receiving inventory

The vendored `@neon/realtime-tanstack`0.1.1 source comes from neon-pkgs
`7ac55e3e7b9e491cc53fa6225bab29d700b729e2` and remains under its Apache 2.0
license. The installed provider is `@neon/realtime`0.2.0. Node 24.19.0 is used.

Applicable laws are complete eager initial/reload replacement, atomic committed
change batches, JSON row fidelity, terminal initial-gate failure, retained
post-ready rows plus terminal source health, source cleanup exactly once,
transaction-ID evidence, capability renewal, and independent subscription
lifetime on one client. Authority is the shared eager law set, the public sync
API and glossary, plus Neon's public RawLiveQuerySubscription contract. Its
`error` state says automatic recovery stopped; its `rows` update replaces the
whole query result. The adapter owns no stream-priority or on-demand API.
Application keys may project rows through `getKey`; Direct's immutable-provider
ID refusal policy does not transfer. The adapter itself exposes no decoder
option; SDK PostgreSQL parser rejection is a provider failure boundary.

Required paths before a source repair:

| Path | Premise | Observation cut |
| --- | --- | --- |
| Existing controlled raw subscription | Complete rows, change batches, terminal state, txid proof, renewal | Every shared eager step and final cleanup |
| Installed SDK with controlled v2 WebSocket | Actual frame validation, JSONB decoding, SDK state failure, callback lifecycle | Same shared eager comparison |
| Unwrapped reload | Real new raw subscription with changed complete source result | Before source, fulfillment and applied settlement |

The installed SDK path is a controlled transport witness, not a deployed Neon
service or authorization claim. No durable storage API belongs to this adapter.
The applicable-law inventory includes independent subscription lifetime, but
the current receiving inventory does not test two Collections sharing one
actual client. Each eager/reload fixture currently owns its own provider/client.
That is an open receiving gap under
`packages/db-adapter-conformance/tests/shared-client-oracle.ts`; the scoped
terminal-health and ordered-move gate below makes no shared-client closure
claim. A receiving witness must address each subscription independently on one
client and observe survivor delivery plus each peer's resource releases.

Pre-edit adapter SHA256:
`48a2da00349bdf13d705d644791740a1a23fcceb89d5017e5d8c3959447d841d`.
Existing raw driver SHA256:
`f3611cf1c3ad47a74462bd501055a97a84021accde9c2e916ad9291a28e88ae6`.

## Original baseline

Command, from `packages/db-adapter-conformance`:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Executed before any source edit:59 failed, 66 passed, 125 tests. Raw log:
`.review-2377/neon-pre-edit-baseline.log`. The comparison rejected READY-4
(loading stays loading after terminal provider failure) and HEALTH-1 (missing
terminal health cause). Source inspection identifies use of removed `markError`
instead of current `fail`. LIFE-10 remains behind those first mismatches.

EVID-2 failures require classification before a source change: the controlled
raw subscription's per-subscription evidence set never learns a prior run's
committed transaction IDs when a new complete baseline arrives. The real SDK
has MVCC baseline evidence. An independent law reviewer was asked whether the
repair belongs in this controlled premise. No expectation was changed.

No production repair has been authorized by an oracle review yet. Installed
SDK and reload witnesses, review verdicts, GREEN, mutants and reach are pending.

## Installed SDK pre-edit receiving results

The Node actual-SDK run first supplied complete-result/failure witnesses:
52 failures, 131 passes, 183 tests; reload was 103/103 GREEN. Log:
`.review-2377/neon-sdk-and-reload-pre-edit.log`. Actual Chromium supplied the
same first receiving slice:31 failures, 152 passes, 183 tests, with the same
READY-4/HEALTH-1 mismatches; log `.review-2377/neon-browser-pre-edit.log`.
The first browser launch could not bind localhost inside the sandbox and
skipped every history. Only the successful escalated localhost launch counts.

Inspection of the real 0.2 SDK boundary found another genuine incompatibility:
raw updates include `move`. The adapter treats every non-upsert as removal.
The ordered receiver now sends valid content changes followed by one move per
final row, using unique predecessor anchors. The independent keyed-row model
is unchanged: rearranging rows does not delete them. This dimension rejects
the old adapter with PUB-3/FID-4 after real SDK protocol validation.

The same receiving slice also now exercises `await-evidence`: its backend
commits txids in order, and a later baseline supplies actual SDK MVCC proof
with `xmin = xmax = committedThrough + 1`. That proof is delivered only at
baseline; a new subscription still waits before its own baseline.

Both plain and ordered SDK variants retain 80 generated histories per fixed
and random campaign and the primary owner's five constructed witnesses per
declared state. The existing controlled receiver retains its 400 budget.

Before any source edit, the expanded actual-SDK Node run rejected 139 tests
and passed 154 of 293. First mismatches were READY-4, HEALTH-1 and PUB-3/FID-4;
there were no EVID-2 mismatches before those first violations. Reload remained
103/103 GREEN. Log `.review-2377/neon-sdk-ordered-pre-edit.log`.

Actual Chromium on the same expanded slice rejected 97 and passed 196 of 293;
log `.review-2377/neon-browser-ordered-pre-edit.log`. Those are semantic
comparison rejections, not setup failures. Source SHA256 remains
`48a2da00349bdf13d705d644791740a1a23fcceb89d5017e5d8c3959447d841d`.

The law reviewer approved the controlled EVID-2 premise correction: remember
actually authored backend commits across subscriptions and grant their proof
only with the new baseline, as the actual SDK's MVCC path now receives. The
controlled driver's expectation and shared model stay unchanged. Its fresh
pre-edit run is recorded separately in
`.review-2377/neon-corrected-premise-pre-edit.log`.

An adjacent risk remains under investigation: the installed SDK clears its
transaction tracker on terminal failure, so a wait first registered after
failure can reject despite earlier applied evidence. Its own public docs say
failure rejects a wait when it happens before transaction application. The
current first health mismatch prevents the shared history from reaching that
later cut. No closure claim is made for that path.

## Amended resource observation and exact pre-edit gate

The historical fourteen-file snapshot is preserved. The amended
[twenty-file snapshot](2026-11-17-cross-adapter-neon-pre-edit-snapshot-v2.json)
has SHA256
`99cf91faa0dd78d8dc904387d14443780c4cfb36490859676fe43bf76245e402`.
It includes the shared resource comparison, browser observation bridge,
registration suites and host/configuration files. Every fingerprint matched
after both runs below; the vendored source remains the original
`48a2da00349bdf13d705d644791740a1a23fcceb89d5017e5d8c3959447d841d`.

The raw and actual SDK receivers now record every acquired update/state
listener and every invocation of its returned teardown, as well as each
subscription. Each record identifies its sync run. The wrappers forward all
calls without suppressing duplicate release or rescuing leaked resources.
The shared LIFE comparison judges each object independently. The shared reload
driver also preserves product observations when later cleanup reports an error;
that instrumentation amendment explains its changed fingerprint. No law,
comparison strength, campaign budget or production behavior was relaxed.

The exact Node gate, from `packages/db-adapter-conformance`, was:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

It rejected **194 tests and passed 224 of 418**, exit 1, in 61.81 s.
The raw receiver rejected 50 of 125; the two actual SDK variants rejected
144 of 190. The complete reload family passed all 103 tests. The first
semantic mismatches remain READY-4, HEALTH-1 and PUB-3/FID-4; no setup failure
or EVID mismatch supplied those results. Log:
`.review-2377/neon-ledger-pre-edit-node.log`.

The exact actual Chromium gate, from the same directory, was:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon-browser.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

With local listener/browser permission, it rejected **98 tests and passed 195
of 293**, exit 1, in 95.84 s. All 103 reload tests passed. Its first shared
comparison mismatches are the same three laws. Log:
`.review-2377/neon-ledger-pre-edit-browser.log`. The fixed seed remains 2118;
each run also prints its random campaign seeds and shrinking replay selectors.

Package TypeScript checking and scoped ESLint pass for this amendment. The
resource ledgers add observations, so the earlier runs remain historical
evidence rather than a substitute for these exact amended gates. Independent
law/enforcement review and the source-edit gate are still required before
repair. These RED campaigns stop at their first mismatch: they do not establish
closure or complete reach of neighboring evidence/failure histories.

The independent adversarial law reviewer approved this amended manifest for
the diagnosed READY-4, HEALTH-1 and move PUB-3/FID-4 repair. The reviewer
verified all twenty hashes, the unchanged source, legal ordered move frames,
new-baseline evidence and actual SDK MVCC path, and independent per-resource
release observations. Enforcement review and the root source-edit gate remain.

## Neighboring SDK evidence diagnostic

A supplemental public-SDK experiment, outside the frozen test files, confirms
the earlier tracker concern. An actual raw subscription receives a complete
baseline and a committed empty batch with txid `1`. `awaitTxId('1', 10)` first
fulfills. After an actual terminal protocol error, the same already-applied
wait rejects with `LiveQueryError`. This violates the SDK's own public
`awaitTxId` documentation: failure or close rejects when it precedes transaction
application. The SDK tracker currently checks its closed flag before known
evidence, and `close()` clears recent IDs and MVCC visibility.

Command, from the repository root:

```sh
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-sdk-evidence.vitest.config.mts --maxWorkers=1
```

The temporary ordinary diagnostic rejected one test at its after-failure
assertion in 7 ms, exit 1. Log:
`.review-2377/neon-sdk-evidence-original.log`. This isolates the provider
boundary; it does not replace the shared EVID receiving history or establish
its adapter repair. No installed SDK or vendored production source was changed.

## Corrected ordered protocol and additional receiving families

The first approved source repair changed removed `markError` to `fail`,
released callbacks/subscriptions once at terminal failure, fenced late callbacks
and receipts, and ignored ordering-only `move` changes. Its first Node campaign
passed 397 of 418 tests. Remaining actual-SDK failures exposed the independently
confirmed applied-evidence defect and a fixture protocol defect: ordered wire
programs reject duplicate content operations for one row key. Shared eager
histories lawfully describe several operations on one key inside an atomic
batch. The ordered receiver now encodes their final authored operation per key,
retaining the same final rows and txid before legal moves. The shared model and
comparison are unchanged. The law reviewer approved this wire translation;
original source was restored for fresh RED evidence.

Two receiving gaps are now exercised rather than deferred:

- The exact-query shared-client owner is
  `tests/neon/neon-shared-client-oracle.ts`. Its authority is the public reusable
  client/exact query configuration and subscription cleanup contracts. Two
  distinct query fingerprints share one actual client. Independent authored
  answers, joining before/after first readiness, either peer's cleanup and a
  later complete survivor answer determine four public snapshots. Every
  callback/subscription has an independent release record. Equal, overlapping,
  disjoint and empty row memberships remain distinct. This does not transfer
  Direct's table-union or passive-cache behavior.
- Initial asynchronous receipt cleanup reuses
  `powersync-direct-collection/tests/initial-receipt-oracle.ts` and its registrar.
  Standalone Neon always truncates its complete result, which core applies
  immediately even while an optimistic transaction persists. That path cannot
  establish an asynchronous receipt premise. Instead the real persisted wrapper
  receives the actual SDK baseline while its first controlled storage row read
  is held. This defers source admission and returns the wrapper's genuine
  asynchronous receipt. Cleanup before admission rejects it; the neighboring
  schedule applies it first. Neither receiver installs a synthetic receipt or
  rejection. Controlled memory storage proves no SQLite or durable reopen law.

The thirty-five-file [v3 snapshot](2026-11-17-cross-adapter-neon-pre-edit-snapshot-v3.json)
has SHA256
`59eb82a54f6a7afd7026e0c5c6f83f8696f74c51b77c63faa59a3522e937bb31`.
It binds the corrected wire and both new receiving families to original vendor
source `48a2da...`. The full Node and Chromium commands printed above produced:

| Original source, v3 | Result | Duration | Log |
| --- | --- | --- | --- |
| Node | 193 semantic failures, 301 passed, 494 total | 83.83 s | `.review-2377/neon-v3-original-node.log` |
| Actual Chromium | 95 semantic failures, 272 passed, 367 total | 98.33 s | `.review-2377/neon-v3-original-browser.log` |

The raw Node receiver rejected 51 of 125 tests; actual SDK variants rejected
142 of 190. First violations remain READY-4, HEALTH-1 and PUB-3/FID-4. New
shared-client and receipt families pass on original source in both hosts, as
does reload. All thirty-five hashes matched after both runs. The snapshot
already includes shared reload's liveness/propagation amendment at driver
`c7ecab...`, suite `fea780...` and model `f77417...`.

Independent review then found two receiving-instrument issues. A completed
receipt observation was discarded on nonzero child exit, and its mismatch
fault supplied a synthetic error string. The Node receiver now preserves a
completed observation with nonzero exit as separate cleanup diagnostics. Its
worker has actual exit-23 controls. The receipt production driver also emits
a real rejected Promise after actual provider disposal and throws a separate
teardown error. Node's native process recorder and Chromium's native rejection
event recorder remain active through eight further task turns. The receiving
production driver attaches no receipt rejection observer before those turns;
such an observer could conceal a missing production handler.

The [v4 snapshot](2026-11-17-cross-adapter-neon-pre-edit-snapshot-v4.json), SHA256
`ac459daf029d35ff7bfa3ee7edd9bea40459631fe221442c9d9430c859f24475`,
preserves original vendor source and amended native fault controls. Exact
receipt-only commands, from `packages/db-adapter-conformance`, are:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon.config.ts tests/neon-initial-receipt-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon-browser.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 -t 'adapter.neon.initial-receipt-cleanup.sdk.chromium'
```

Node passes all 30 tests in 17.59 s; Chromium passes all 30 selected tests in
5.57 s. Both include real native rejection and teardown controls. Logs are
`.review-2377/neon-v4-original-receipt-node.log` and
`.review-2377/neon-v4-original-receipt-browser.log`. All thirty-five hashes
matched before restoring the approved source repair. The independent law
reviewer approved this exact v4 instrument and its original-source gates;
the reviewer also approved the exact-query model and its original receiving
paths. This approval makes no source-repair or SDK-evidence closure claim.

## Independent reload delivery barrier

Final instrument review found that a reload receiver could wait for the very
Collection verdict under test. An empty complete source that omits both
`commit()` and `markReady()` then times out before the shared comparison.
The shared driver now requires each SDK receiver to establish actual provider
delivery independently of Collection readiness and receipt visibility. Neon's
receiver awaits every `deliverWireRows` promise: each waits for subscription
admission, then the real SDK synchronously consumes the complete baseline frames,
including an empty `baseline_sync_end`. The receiver supplies no Collection
verdict, rows, commit, or readiness call at that cut.

The [v5 barrier snapshot](2026-11-17-cross-adapter-neon-reload-barrier-snapshot-v5.json),
SHA256 `1b637602847fcdb721eeadf6988846841b1de28373459411f88ed9436ad74509`,
binds shared driver `3e178cd5...` and Neon receiver `b025ed29...` to the
previously approved first vendor repair `6e14db8b...`. Only those three files
differ from v4. No further production repair was made for this instrument change.
The shared model, comparison, budgets, v3 original-source gates, and v4 native
receipt fault controls remain unchanged.

Commands from `packages/db-adapter-conformance`:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon.config.ts tests/neon-reload-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon-browser.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 -t 'adapter.neon.eager-reload.sdk.chromium'
```

Node passes all 106 reload tests in 4.80 s. Actual Chromium passes all 106 selected
reload tests in 1.83 s, with 263 unrelated tests skipped by selection. Logs are
`.review-2377/neon-v5-reload-current-node.log` and
`.review-2377/neon-v5-reload-current-browser.log`. The first browser launch failed
to bind localhost inside the sandbox; only the successful permitted launch is
counted. Scoped ESLint passes. These are neighboring reload guarantees, not
closure evidence for the separate SDK transaction-evidence defect.

## Shared-client liveness amendment and raw removal gate

Enforcement review identified another promised-verdict wait: the shared-client
driver awaited both Collection preload promises after SDK answer delivery.
A source that skipped an empty result's commit and readiness call then timed
out before the model could judge either Collection. Dropping `markReady()`
alone is equivalent here because complete truncate/commit also establishes
readiness; the actual source probe completed in 22 ms. That result is preserved
in `.review-2377/neon-shared-liveness-original.log` rather than called a kill.

The stronger source omission skips both the empty result's commit and its
readiness call. Before the driver amendment it timed out at 750 ms; raw source
and log remain `.review-2377/neon-shared-empty-liveness-original-driver.ts` and
`.review-2377/neon-shared-empty-liveness-original.log`. After the amendment it
reaches the shared public-snapshot comparison and cleanup. The production
driver now observes pending preload rejection but does not await that verdict.
Actual SDK delivery supplies the cut, with no arbitrary task-turn substitute.
Generated empty-first and empty-peer constructions and their bound source
omission calibrations run on Node and Chromium. Both hosts pass all 53 tests;
logs are `.review-2377/neon-v6-shared-current-{node,browser}.log`. Independent
enforcement review also ran both actual source controls on both hosts and
approved driver 1789f9f1, model c7143261 and suite e50bea1e.

The earlier first vendor repair left an additional semantic counterexample:
an actual SDK `remove` for an absent opaque row ID stopped the adapter. The
public raw removal contract imposes no existing-ID precondition. The installed
SDK's materialized receiver applies the same operation with idempotent
`Map.delete`. Its ordered protocol also admits that operation after coalescing
a transient upsert/remove pair. Omitting such redundant provider operations is
a legal net encoding, but it would conceal this supported receiving defect.

The additive receiver in `tests/neon/neon-idempotent-removal-oracle.ts` maps a
redundant raw removal to an empty logical batch and reuses the shared eager
Map/phase model and every original public comparison. It records removal IDs
from the actual decoded raw SDK update before adapter entry. Generated states
cover empty/retained baselines, plain/ordered absent removals, repeated
publications, a transient row, and an ordered removal of a retained row. That
last adjacent witness rejects a repair that ignores all removals. IDs 1..2 and
absent IDs 8..12 are disjoint; masks 0..3, values -100..100 and one to three
publications bound the grammar. Repetition changes lifecycle after the first
no-op; order changes the SDK validator; transient/present paths preserve
ordinary deletion. A present-path baseline without key 1 is excluded.

The [v6 first-repair snapshot](2026-11-17-cross-adapter-neon-first-repair-test-snapshot-v6.json),
SHA256 `980c57dab19bd860365f0fbd7e862d96744bcaac12e55ede74c05f6e3439eaf6`,
binds all 40 files, including the amended shared-client instrument, both new
host registrations and registry routes, to the unchanged first vendor repair
`6e14db8bc37463918bae326cc5a89a730c07ca36ce1d2190f2dddab65b44b51d`.
All 40 hashes matched after both gates. Commands from
`packages/db-adapter-conformance`:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon.config.ts tests/neon-idempotent-removal-oracle.property.test.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.neon-browser.config.ts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 -t 'adapter.neon.idempotent-removal.sdk.chromium'
```

Node rejects 18 and passes 16 of 34 tests in 1.94 s. Actual Chromium rejects 19 and
passes 15 of 34 selected tests in 4.70 s. Both reach shared PUB-3/FID-4 at the first
removal checkpoint, reporting `Realtime deleted an unknown row ID`. Bound
calibrations whose clean source execution already fails report that separately;
those are not additional checker kills. Logs are
`.review-2377/neon-v6-removal-first-repair-{node,browser}.log`. Initial unknown
registry-ID setup attempts are not credited. TypeScript and scoped ESLint pass.
The registry reviewer also independently ran each new host's direct replay;
each executed exactly one history and reproduced the same semantic violation.
No additional vendor source repair preceded these gates. Review of the new
instrument and the source-edit gate remains required.

## Approved adapter repair and bounded evidence

Enforcement review independently checked all 40 v6 hashes against the unchanged
first repair and ran plain/ordered absent-removal RED witnesses plus an
ordered-present GREEN neighbor on both hosts. A second adversarial reviewer
checked the saved first-repair source against the manifest and parsed the gates.
The law reviewer inspected the same new owner/driver and supported the
formulation; that review did not independently execute a Neon campaign. The
additional source repair followed the executed pre-edit gate: an unknown
removal key now continues without a write. Known-key removal still deletes its
row. The complete upstream adapter proposal is
[the separate patch](2026-11-17-neon-realtime-tanstack-adapter.patch), SHA256
`46c1a21d5efe29ba76b3c8eb79c1af7482b54c50901766705e12217f7f7e7d51`.
It targets `neondatabase/neon-pkgs/packages/realtime-tanstack/src/collection-options.ts`
at the recorded upstream revision, with the local vendoring header excluded.
`git apply --check` succeeds against that original source.

The [v7 source/test snapshot](2026-11-17-cross-adapter-neon-final-test-snapshot-v7.json),
SHA256 `ae0ac9f9b3c37b519e8f101c1e1f689850c30950796de17d039e1fd4fdbe2b69`,
records final adapter source
`a995cbff72a3f25edddc31cf859089c5206bb3284c909416e6adf2919f0ae58b`.
Relative to the pre-edit v6 instrument, the new oracle owner only corrects its
prose to name the explicit present-removal path. The vendor header names the
idempotent removal repair; the only further executable source change is the
unknown-key guard. Enforcement review independently checked all 40 v7 hashes
and reran the whole new family:34/34 GREEN on Node and actual Chromium,
including every formerly invalid clean calibration baseline.

**Law:** a valid raw removal applies keyed-set deletion, including a no-op for
an absent identity. A present identity must still disappear. Authority is the
public raw SDK update contract and the shared eager PUB-3/FID-4 contract.

**Reach:** every normal campaign executes a randomized construction for each
of the seven declared states and checks fresh constructed outputs against actual
decoded SDK removals. The fixed 2377 campaign's 60 generated histories reached
empty/retained baselines 13/47 times, plain/ordered absent removal 15/14,
repeated absent removal 20, transient rows 15 and ordered present removal 7.
The final installed-SDK random campaign's corresponding Node counts were
12/48, 18/13, 22, 9 and 10; Chromium counts were 8/52, 9/10, 15, 14 and 19.
The construction checks enforce reach independently of these incidental hits.

**RED:** the exact v6 commands above reject the saved first adapter repair
at the intended public health/row checkpoint. This is separate from the earlier
original vendor's READY/HEALTH/move failures. No installation, registration,
timeout or invalid-clean-calibration result counts as a semantic kill.

**GREEN:** the same new-family commands pass 34/34 on each host after the guard.
The final installed portfolio passes reload 106, shared-client 53, initial
receipt 30 and raw-removal 34 on both hosts; the controlled raw eager owner
also passes all 125 Node tests. The installed SDK's remaining EVID failures are
recorded below and prevent a complete installed-portfolio GREEN claim.

**Mutant:** the original unknown-key throw is rejected by the pre-edit gates.
An actual temporary source mutant that ignores *all* removals is rejected by
the ordered-present construction at the shared step 1 row comparison: two
semantic failures per host, with the exact repaired source restored afterward.
Logs: `.review-2377/neon-v6-ignore-all-removals-mutant-{node,browser}.log`.
The independently inspected logs contain no setup or timeout kill.

**Limits:** the new removal family bounds keys, values, baseline membership and
publication count as stated above. The broader receiving portfolio uses a real
local SDK with controlled frames, not a deployed Neon service. It proves no
remote authorization, durable SQLite reopen or arbitrary concurrent-publication
law. These changes update a vendored test candidate and prepare upstream
patches; no released adapter or installed SDK was silently changed.

## SDK retention and application-before-callback proposals

The repaired adapter with the actual installed SDK 0.2 still rejects EVID-1/EVID-2
histories after terminal failure: Node 10 failures and 528 passes of 538 in 83.78 s;
actual Chromium 6 failures and 407 passes of 413 in 65.51 s. Logs are
`.review-2377/neon-final-installed-{node,browser}.log`. All remaining primary
violations concern already-applied transaction evidence, not the repaired
terminal-health, move, cleanup, replacement or raw-removal laws.

Two separate SDK patch artifacts target the actual production location under
`neondatabase/neon-pkgs/packages/realtime/src/client/`:

- [Retain existing proof after close](2026-11-17-neon-sdk-retained-evidence.patch),
  SHA256 `b966c730ef65f3bc442398d9b7ca818c35f78feb7ac6e23fe224bc234347ba64`:
  `transaction-tracker.ts` checks retained proof before its closed verdict and
  keeps the existing bounded 1,000-ID history and MVCC evidence after close.
- [Record batch proof at installation](2026-11-17-neon-sdk-applied-proof-order.patch),
  SHA256 `7a590e7ba6f3ebe92f0f150e130de4c1cf76dd64d69fd54d6dc9ce1abcb659e1`:
  `subscription.ts` records each batch's proof in its installer after snapshot
  assignment, before application callbacks can close this or a peer subscription.
  Decode/preparation failures and the pre-install closed guard grant no proof.
  Promise continuations run only after the synchronous installation phase.

The second patch followed another independent pre-edit gate. The unchanged
first SDK proposal rejected three actual public receiving histories in both
Node and Chromium: raw self-unsubscribe, materialized `onChange` self-close,
and one peer callback closing another already-applied target in the same
multi-target publication. Three distinguishing neighbors passed: a throwing
callback, one parser-refused target beside a healthy peer, and an uncommitted
publication abandoned before application. Every history also checked future
proof rejection. The amended copy passes the exact same six comparisons plus
all fifteen earlier retention/boundary checks on both hosts. The old copy stays
unchanged. The independent reviewer approved both exact patch hashes and
recorded the original and repaired sources, diagnostics and limits in
[the versioned SDK review](2026-11-18-neon-sdk-evidence-independent.md).
The proposed baseline logger reentry concern was withdrawn after checking that
public logger callbacks are queued after synchronous baseline proof; no MVCC
interface change was made. Both SDK patches pass `git apply --check`.

An isolated SDK distribution contains only those two changed JavaScript files.
Its public `dist/client.js` export supplies the same API as the installed SDK;
local-only aliases select it for these proposal runs. Installed dependencies
remain untouched. From the repository root:

```sh
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-sdk-complete-proposal.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-sdk-complete-proposal-browser.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

The same complete model/history/checker portfolio passes **538/538 Node** tests
in 83.10 s and **413/413 actual Chromium** tests in 66.10 s. Logs are
`.review-2377/neon-final-sdk-proposal-{node,browser}.log`. This is evidence for
the recorded upstream proposals, not a claim that installing SDK 0.2 is fixed
or that an upstream release exists. The installed-path counterexample remains
an explicit release blocker under the shared EVID owner until those upstream
changes are published and the released version passes the receiving portfolio.

The new receiving mechanism preserves ORC-001/002 authority and independence,
ORC-003 literate responsibilities, ORC-004 bounded grammar controls, ORC-005
actual decoded SDK entry and public comparison, ORC-006 calibrated controls,
ORC-007 fixed/random campaigns and checked direct host replays, ORC-009 vocabulary,
ORC-010 cleanup/failure fidelity, ORC-012 versioned evidence, ORC-013 absent/present
neighbors, ORC-014 actual SDK handoff, ORC-015 enforced reach and ORC-016 law-only
registration. ORC-008 introduces no row-model state; the local model stores only
constructed reach obligations. ORC-011 identifies no additional unresolved
shared-semantic fault after the public raw/materialized deletion relation and
the applied/unapplied SDK proof neighbors. This is bounded evidence, not an
exhaustive proof or a retirement of wider promises.

## Transitive cleanup-recorder amendment

After the full portfolio runs, a reviewer found that formatting an arbitrary
cleanup reason such as `Object.create(null)` could itself throw and erase a
completed raw observation. The shared helper's earlier 62e fingerprint was
retracted. Its guarded, cycle-safe and depth-bounded formatter is now
`23497e2b680f5a7be09d51944cd75cceb745aa9d57ac948079c5e2dedde3490b`;
the ordinary helper tests have their own fingerprint and all 11 pass, alongside
29 shared reload recorder controls. This changes no SDK fixture, law, model,
normal Error/Aggregate formatting, or provider operation.

The [v8 transitive snapshot](2026-11-17-cross-adapter-neon-final-test-snapshot-v8.json),
SHA256 `b85b5f1c5d98217bc2115ff95e44dac3e8276b205288d5dfc79f5eaf5e45c10d`,
supersedes v7 only for that helper and additionally records its ordinary tests.
The other 39 v7 entries are unchanged. The full normal-provider runs above
remain attributed to their actual v7 helper, not relabeled as executions at
the new hash. The exact shared amendment and its fresh review are owned by
[the shared receiving record](2026-11-17-cross-adapter-shared.md); the root's
final aggregate gate determines whether those normal-provider results carry.

## Final bounded verdict and recorder amendment

The independent adversarial reviewer approved the final raw-removal/source
boundary after inspecting both repaired 34-test host runs, the two semantic
ordered-present mutant failures per host, the exact vendor diff and the full
proposal logs. No additional counterexample was found within that boundary.
The independent enforcement reviewer separately approved carrying the normal
provider results over the shared total-formatter repair. The complete runs
remain executions of v7, with that precise amendment recorded separately.

A final diagnostic audit found the same conversion defect in the Node and
browser detached-rejection callbacks: `String(reason)` can throw before it
records an arbitrary rejection reason. Both callbacks now use the shared
`describeOracleCleanupError` export. The listener installation, removal,
provider operations, history grammar and public comparison cuts are unchanged.
Ordinary Error strings remain identical; aggregate details now remain visible.
The shared helper's export-only fingerprint is
`15317e3871120de3840160b070d902e765989fe070112fbbf3d14d87b84bf6bc`.

Before those two callback edits, an actual-source control extracted each
callback expression with the TypeScript AST and invoked it with an ordinary
Error, a null-prototype reason, a throwing-conversion proxy and a cyclic
aggregate. Four of eight comparisons failed: both callbacks lost the
null-prototype and throwing-conversion diagnostics. After the edits, the same
eight comparisons pass. The browser callback control also requires
`preventDefault()` to run. This is callback-source execution in Node, not a
browser-host claim. The ordinary shared-helper controls independently exercise
the formatter's totality, cyclic aggregates and completed-raw preservation.

The actual receiving import boundaries also ran again after the amendment:
**30/30 Node initial-receipt checks pass in 13.33 s**, and **30/30 selected
Chromium checks pass in 4.59 s**, with 383 unrelated browser checks skipped.
Logs are `.review-2377/neon-final-recorder-amendment-{node,browser}.log`.
Scoped ESLint, package TypeScript checking and `git diff --check` pass.
The independent enforcement reviewer verified all 41 final hashes and approved
normal-provider carry under this exact exception-only amendment.

The [v9 final snapshot](2026-11-17-cross-adapter-neon-final-test-snapshot-v9.json),
SHA256 `5efce8237590870603d1efdc200e3e07f932bcb323bea4ea1411bb9a80936f3d`,
differs from v8 only in the exported shared helper and the two diagnostic
callbacks. All 41 fingerprints match the final files. The
[final evidence record](2026-11-18-cross-adapter-neon-final-evidence.json)
preserves full-run log digests, per-campaign generated reach, the actual callback
control source and its original/repaired observations, patch fingerprints and
the separate post-amendment host runs. It does not relabel historical full
runs as executions at v9. All three upstream patches pass fresh
`git apply --check` against their separately preserved original sources.

The final SDK copy still differs from installed SDK 0.2.0 in exactly
`client/transaction-tracker.js` and `client/subscription.js`; the installed
files retain their original fingerprints. The repaired vendored adapter and
isolated combined SDK proposals have the bounded GREEN evidence above.
The actual installed SDK's 10 Node and 6 Chromium failing tests remain the
explicit upstream-release blocker. Publishing the adapter and SDK proposals,
then rerunning against their released packages, remains necessary before
claiming the installed receiving portfolio is GREEN.

## Final shared-wrapper dependency

The subsequent shared eager-wrapper audit repaired the same diagnostic class
at one transitive dependency. Its old catch path could throw while classifying
a raw Proxy or reading an AggregateError cause, replacing the original error.
Its nested `map(String)` could also lose a recognized conformance violation
while formatting secondary cleanup reasons. The wrapper now guards diagnostic
classification, rethrows an unclassified original failure by identity, and uses
the total formatter for a recognized aggregate. No law, model, history,
provider operation or scheduling checkpoint changed.

The final wrapper fingerprint is
`22422fb1e298cc643fd572e297eea13b51fbdd2bff9e9833ae29fae58a90f9ec`.
Actual exported-function controls pass four and fail four on the original,
pass six and fail two on the formatter-only intermediate, and pass all eight
on the final guard. They preserve the recognized law, checkpoint and raw
observation identity beside hostile secondary reasons. Unknown failures with
throwing prototype/cause access retain their original identity. These controls
run in Node; they do not claim another browser or normal-provider campaign.

The [v11 dependency snapshot](2026-11-17-cross-adapter-neon-final-test-snapshot-v11.json),
SHA256 `b65a9b7fc9e6edb9e6d1fd1526a874c8720f6095e12245b32157a0cb4898244e`,
differs from approved v9 only at that shared wrapper. The v10 snapshot preserves
the formatter-only intermediate. All 41 v11 hashes match the current files.
The final evidence JSON retains each original/intermediate/repaired control
and its executable control source. Full-provider results remain attributed to
v7 and the two real-host receipt import checks to v9. Final independent review
of this narrow dependency amendment remains pending at this entry.

The independent enforcement reviewer subsequently approved exact v11 carry
after verifying every hash and independently passing all eight actual-function
controls. That review confirms preservation of the known law/checkpoint/raw
identity and rethrow of unknown failures by identity. The reviewer confirmed
that the v7 removal verdicts and v9 recorder carry remain valid under this
exceptional-catch amendment. There is no new host-execution claim. The final
SDK-release blocker and bounded conclusions above remain unchanged.

The completed shared diagnostic audit also amended the eager conformance
source's rejection/console recorder, mismatch descriptions and JSON-description
fallback. Actual-function controls reject six original watcher cases and three
original violation-constructor cases; the amended functions pass all 18 watcher
and six constructor controls. Accepted comparison conditions, the reference
model, legal histories and observation timing are unchanged. The audit's final
source inventory is frozen in the
[shared diagnostic record](2026-11-18-receiving-cleanup-fidelity.md) and its
[snapshot](2026-11-18-receiving-cleanup-fidelity-snapshot.json).

The [v12 dependency snapshot](2026-11-17-cross-adapter-neon-final-test-snapshot-v12.json),
SHA256 `2da0dae9a0bab861e405dd6559bc36e51e3be8c88860c9cd82d08c1a82aabf95`,
differs from v11 only at `src/eager-live-source-oracle.ts`, now
`0529bec22b56bd9618acac3b8597d69b3e8d09a65bce4bee0b8a88fc1398d2e7`.
All 41 hashes match after the diagnostic owner stopped source edits.
The original v7 full runs and v9 focused host runs retain their actual source
attribution. Final independent carry review of this last description-only
dependency is pending at this entry.

The independent adversarial reviewer approved exact v12 after reconstructing
the original conformance source, reading the complete final diff, verifying
every frozen hash and reviewing the watcher/constructor controls. The reviewer
confirmed that only diagnostic formatting changed and retained the bounded
adapter verdict, shared-wrapper approval and installed-SDK release blocker.

The final lint correction replaces a redundant nullish fallback inside guarded
JSON description with `String(JSON.stringify(...))`. The owner reran the exact
watcher and constructor controls and scoped lint successfully. Enforcement
independently passed those 24 controls and another 24 combinations of hostile
expected/actual/history descriptions, preserving the law, checkpoint and raw
identities. This changes diagnostic descriptions only.

The final [v13 snapshot](2026-11-17-cross-adapter-neon-final-test-snapshot-v13.json),
SHA256 `7a4b729bc2be7f73fe8185f29bb16f106c108c477ff0866088c27951dc7751f1`,
records conformance source
`abc07901fc6ab979c6f41bade19b1211c3bf8db1c35d8857f98869b5050aea49`;
the other 40 v12 entries are unchanged. Enforcement independently verified the
manifest bytes and every current hash, then approved exact v13 carry of the
prior normal-provider evidence. Historical full results remain v7 executions;
the focused real-host receipt checks remain v9 executions. There is no claim
of fresh full runs at v13. The installed SDK evidence-after-close defect stays
open until an upstream release passes these receiving checks.
