# TrailBase receiving audit

The pre-edit production source is `src/trailbase.ts`, SHA-256
`a0608813edaa2bc966ca6fbdbeb747b9fc6fbd8dd08a9c6edabbfe75288d2cd7`.
This audit starts with tests and receiving paths. Production remains unchanged
until semantic RED evidence and independent review permit a repair.

## Laws and pre-edit receiving inventory

Authority is the public TrailBase collection guide, the lifecycle owner's
`tests/ORACLE.md`, and the glossary's readiness, reload, applied settlement,
cleanup, and optimistic transaction contracts. PowerSync-specific stream
subscriptions, priorities, cached table unions and retry policy do not apply.

| Boundary | Existing owner and receiving path | Audit work |
| --- | --- | --- |
| Eager rows, health, error identity and release | Shared eager owner through controlled RecordApi/native stream | Receive the same histories and comparison through installed TrailBase SDK routing and JSON/SSE decoding |
| Complete eager reload and terminal initial gate | TrailBase lifecycle examples; shared eager reload owner | Add installed SDK receivers; preserve empty-result freedom and explicit omission sweep |
| Initial receipt and cancellation | TrailBase lifecycle and held-page judgment | Audit accepted/applied cuts through actual SDK; no Direct-specific readiness receipt identity |
| Decode and refusal | TrailBase lifecycle parsing failures and public per-field parse/serialize contract | The new shared refusal model requires batch atomicity and preserved ids; those are not TrailBase's per-SSE-event or configurable getKey promises |
| On-demand lifecycle and mapping | TrailBase lifecycle/page-event models | Receive filtered list requests, listener admission, abort and applied settlement; no SDK-stream mapping/lease law |
| Mutations | Built-in CRUD handlers and lifecycle held-mutation cases | Audit response/event ordering and repeated keys through actual SDK; explicit-confirmation utility model is not the built-in API |
| Shared client | Each Collection acquires its own wildcard SSE stream | Judge independent ownership where applicable; passive shared table cache is absent |
| Persisted startup and retired hydration | Shared startup and TrailBase hydration models through controlled persistence/SQLite | Add actual SDK receiver with the same storage hosts and comparison; existing browser receiver remains its separate witness |

The installed SDK receiver controls `Client.fetch`, not RecordApi. The SDK
constructs wildcard, list and CRUD routes and decodes response bytes unchanged.
The controlled service authors complete SSE frames and makes no deployed-service
or arbitrary split-frame claim. Public Collection/query operations supply every
product observation.

## Baseline

Node `v24.19.0`, from `packages/trailbase-db-collection`:

```sh
node ../../node_modules/vitest/vitest.mjs run --coverage.enabled=false --maxWorkers=1
```

Before new receiving registrations: **812 tests passed in eight files**, with no
type errors. The existing lifecycle, page-event, hydration, eager conformance,
persisted startup and SDK boundary tests all passed. This baseline does not
establish laws missing from their histories or public comparisons.

## Shared-model portability questions

The shared eager reload judgment initially requires at least one submitted
commit for every result. A fresh empty TrailBase list can legally call only
`markReady()`, and an empty-to-empty reload can complete there too. Glossary
reload explicitly permits completion at `markReady()` with kept rows. Requiring
an invented empty sync transaction would be a model constraint, not a repair.
The shared owner must distinguish actual complete-result delivery from a
nonexistent receipt before this path supplies product evidence.

The existing snapshot/truncate replacement calibration cannot mutate TrailBase's
explicit omission sweep. Its receiver needs an omission-write corruption at the
actual public sync boundary. These are checker/receiver questions, not semantic
production RED results.

## Original-production receiving results

The source fingerprint above remains unchanged. The installed dependency is
`trailbase@0.14.3`; tests run under Node `v24.19.0`, jsdom and one Vitest worker.
All new receiving files are test instruments, not production changes.

The first three-file run registered 411 tests: **409 passed, two eager generated
campaigns failed**. The startup and initial-gate receivers passed. Investigation
separated two explanations rather than crediting both as adapter defects:

- `restart; snapshot []` answered an abandoned HTTP list instead of the list
  belonging to the current subscription. `SdkList.subscription` now attributes
  each response to its actual SDK source stream. The same minimal history then
  passes the unchanged shared comparison.
- `snapshot []; upsert {value: Number.MAX_VALUE}` remains RED at public rows.
  Calling the installed SDK directly reproduces `SyntaxError: Cannot convert
  1.7976931348623157e+308 to a BigInt` for both list JSON and SSE. Its JSON reviver
  classifies the finite integral double as an unsafe integer, then calls
  `BigInt(context.source)` on its exponent spelling. The adapter never receives
  that row. This is an SDK numeric-representation boundary; replacing adapter
  state or dropping the value kind would not repair that boundary. The owner is
  the installed-SDK eager receiving property, with the shared JSON fidelity
  judgment retained. No deployed-service numeric emission is established.

The second eager run gives **134 passed, two semantic failures**, both now
shrinking to the same SDK numeric parsing defect (one live SSE change and one
duplicate complete list). Logs are
`.review-2377/trailbase-sdk-eager-classified-original.log` and
`.review-2377/trailbase-sdk-precise-probes.log`. The latter records direct SDK
causes and the repaired restart receiver; its scratch test source is preserved
beside it with a `.test.ts.txt` suffix and is not registered as repository tests.

The generic reload checker initially rejected legal fresh-empty and
reload-empty results: zero rows and commits, an actual `markReady()` call, a
fulfilled gate, and empty final rows. Before the checker amendment, the full
reload run gave 13 failures and 90 passes, all failures attributable to the
invented nonempty-commit premise. The original raw observations remain in
`.review-2377/trailbase-sdk-reload-original.log`. The shared driver now records
`sourceReadyCalls` for its target run and permits this empty case only with
actual source readiness and the unchanged exact row comparison. The custom
TrailBase receiver delegates to that same driver and forwards this field.

After that instrument repair, this original-source command passes **378/378**:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  tests/sdk-eager-reload-conformance-oracle.property.test.ts \
  tests/sdk-eager-gate-conformance-oracle.property.test.ts \
  tests/sdk-persisted-startup-conformance-oracle.property.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Log: `.review-2377/trailbase-sdk-reload-gate-startup-original.log`. The reload
receiver's hostile calibration suppresses actual omission-delete writes at
the public sync boundary (`replacement: sweep`); it changes neither source
membership nor the model and is rejected by exact final rows. Gate histories
cross list/stream failure, fresh/reload/peer entry and subsequent source
recovery. Startup preserves the shared complete-result model and storage-host
limits; this package receiver supplies controlled persistence, rather than a
new real SQLite/OPFS claim.

## Built-in mutation response/event histories

`tests/mutation-events-sdk-oracle.ts` introduces the missing independent
two-obligation judgment. A built-in handler may release its optimistic overlay
only after its backend request completes and its new source event is accepted.
An older event for the key discharges neither new write. The source event's
accepted commit can remain unapplied while that mutation persists, so awaiting
that applied receipt inside its handler would create a dependency cycle.

Authority: the public collection guide's Mutation Handlers section promises
automatic persistence, its Real-time Subscriptions section promises reflected
source changes, and `tests/ORACLE.md` documents the adapter's own-event round
trip. The existing built-in handler comments additionally describe why return
must wait for subscription confirmation; those comments support the diagnosed
mechanism rather than independently create a product law. The shared
optimistic-history model supplies overlay removal at settlement. This judgment
does not claim that arbitrary unrelated same-key events identify a write:
the bounded service authors one new event per write and no concurrent writer.

The grammar crosses insert/update/delete, eager/on-demand, response-first or
event-first, a prior same-key event or none, an untouched peer or none, and
numeric coordinates 1 through 10,000. Coordinate renaming changes identifiers
and payload strings together. Removing the prior-event axis makes the stale
confirmation implementation indistinguishable. Removing response-first hides
premature completion; removing event-first loses the opposite accepted-before-
response boundary. CRUD changes both source event and public overlay semantics;
on-demand supplies a real public live query that acquires rows before mutation.
The construction builders retain unconstrained coordinates and return fresh
objects. Their declared state must appear in the driver's reach observations.
Illegal operation/mode/order tags are outside the enumerated grammar; update
and delete always start with an existing row. For insert, optional prior
Insert/Delete events make key reuse legal before its new insert.

The production driver invokes the built-in handlers through public
`collection.insert/update/delete`, forwards actual installed SDK CRUD results,
and delivers complete HTTP/SSE wire data. It records public rows, transaction
state, caller settlement, actual CRUD completion and actual source commit
entry after neither obligation, either first obligation, and both. The model
uses the shared pure mutation-row fold, not `seenIds` or its timestamp store.
The finite replay and both generated campaigns run that same driver and checker.

Original-production result: **43 failed, 145 passed**, log
`.review-2377/trailbase-mutation-events-original.log`. The named replay is an
eager update with an earlier same-key Update, then the new update's backend
response while its new event is held. At `first-obligation` it reports
`completed`/fulfilled and exposes the old row; the model requires
`persisting`/pending and the optimistic row. The later event eventually repairs
the rows, so the prior suites' after-both cuts were false green for this class.
The generated random campaign independently shrinks to update, eager,
response-first, prior event, no peer, coordinate 1 (seed `-1885627140`, path
`6:0:0`, unit `random seed: generated`). Both modes and other CRUD histories
also reject stale confirmation in the full run.

Some of those 43 failures are reach-calibration attempts whose selected clean
history already violates the production law. They are not mutant kills.
The clean fresh-event premature-settlement calibration passes and rejects its
wrong observation at the intended comparison. Independent review and a
production repair have not happened yet, and no mutation class closure is
claimed.

## Review gate and limits

New receiving files pass scoped ESLint; log
`.review-2377/trailbase-new-receivers-lint.log`. The independently reviewed
mutation slice will be fingerprinted before any source repair. Existing source
SHA-256 remains `a0608813edaa2bc966ca6fbdbeb747b9fc6fbd8dd08a9c6edabbfe75288d2cd7`.

The SDK eager and mutation properties remain RED for distinct reasons. An
initial applied-receipt cleanup receiver, native storage/browser receiving
hosts, filtered/aborted SDK subset schedules, parse refusal on the SDK path,
and two Collections sharing the installed SDK still require portfolio
decisions and their appropriate owners. Existing controlled lifecycle/page
tests are retained; they do not supply these new receiving premises.

## Mutation receiving amendment before production

Independent law review approved the two-obligation account within its
one-authored-write/event and no-concurrent-writer boundary. The first
instrument review found that cleanup could erase completed public cuts before
the shared checker ran. The driver now preserves those cuts, attaches each
cleanup error separately, and compares semantic mismatches before diagnostics.
Actual late-cleanup injection calibrates both the diagnostic-only result and
its coexistence with a semantic mismatch.

Independent enforcement review also identified a deadlock-shaped false test
path: awaiting transaction settlement before the final observation and again
before cleanup meant a handler awaiting its own held applied receipt could
time out without comparison or release. The driver now observes after actual
SDK CRUD completion and source acceptance plus bounded host propagation,
without awaiting transaction success. A pending transaction remains an
observable wrong result. Rescue rollback occurs only after immutable public
cuts were captured, then later query/Collection/SDK cleanup proceeds.
The actual handler-boundary own-applied-receipt mutant is rejected at that
comparison. All four selected sensitivity/cleanup controls pass on original
production; log `.review-2377/trailbase-mutation-failure-fidelity-original.log`.

The shared registration is now `tests/mutation-events-sdk-oracle-suite.ts`.
Both Node and actual Chromium import its unchanged model, grammar, comparison
and calibrations. The Chromium page imports only the production driver and
uses native `ReadableStream`, SDK JSON/SSE decoding and actual Collection APIs.
It captures append-only browser diagnostics through teardown.

Before the source repair, actual Chromium registers 191 tests: **49 fail and
142 pass**. Thirty selections reject stale confirmation at the intended cut;
19 other failures are calibration selections whose clean history is already
RED. The prior Node run's 43 failures split into 30 semantic selections and
13 such calibrations. These counts are repeated histories and controls, not
independent defect counts. The raw browser log is
`.review-2377/trailbase-mutation-events-browser-original.log`. Its first
sandboxed attempt could not bind a localhost port and skipped every test;
that setup failure supplies no behavioral evidence.

Both guarded original replays use seed `-1885627140`, path `6:0:0`, unit
`random seed: generated`; each executes exactly once and rejects the same
eager update's first-obligation comparison. Chromium reports `browserErrors:
[]`. Exact runner commands and witnesses are retained in
`.review-2377/trailbase-mutation-guarded-original.log` and
`.review-2377/trailbase-mutation-events-browser-guarded-original.log`.

The final test-only eight-file manifest is
`.review-2377/trailbase-mutation-amended-review-snapshot.sha256`, SHA-256
`80365c4fcc42d2dcfa2a0217174eb811b60c5bf5d0a636a7b7a1883d716d2ef7`.
It includes the model, driver, shared registrar, both registrations, SDK service
and Chromium page/HTML. The independent law reviewer checked all eight hashes
and approved this exact slice. The enforcement verdict remains required before
editing `src/trailbase.ts`. Full package TypeScript and scoped ESLint pass.

The SDK numeric repair remains a separate
[upstream proposal](2026-11-17-trailbase-sdk-numeric-json.md). An isolated copied
SDK with its one predicate amendment passes the full 136-test eager receiver;
the real installed dependency remains unchanged and its original failure stays
visible.

## Fixed-clock gate, scoped repair and final evidence

Before editing production, the author added the distinguishing neighboring
history: an older event and its new event can share one `Date.now()` tick.
A timestamp-based repair could pass histories whose transport turns advance
that clock, yet fail this legal case. The grammar now varies fixed versus
system wall time and declares `same-clock-prior-event`. Its provider deadline
uses independent `performance.now()`, and final cleanup restores `Date.now()`.
Expected public cuts remain the same two-obligation law.

The final clock-amendment manifest is
`.review-2377/trailbase-mutation-clock-review-snapshot.sha256`, SHA-256
`37e2e9b6d92280d46d244bc2157f4dc0756c831263d8a3a3ce133731b06a51d1`.
Both independent reviewers verified all eight unchanged executable hashes and
approved this pre-edit instrument gate while production was still
`a0608813edaa2bc966ca6fbdbeb747b9fc6fbd8dd08a9c6edabbfe75288d2cd7`.
The law reviewer approved authority, suitability and the same-clock amendment.
The enforcement reviewer independently ran Node and actual Chromium RED
replays and all four own-receipt/cleanup fault controls on each host. The
original harness findings were closed before the source repair.

On original source, Node reports **63 failures, 188 passes** in 251 tests;
Chromium reports **73 failures, 178 passes**. These split into 44 and 45
semantic selections, respectively, plus 19 and 28 already-RED calibration
baselines. Both guarded final replays use seed `-2084746265`, path `0:1:1`,
unit `random seed: generated`, and execute exactly once. They reject the same
fixed-clock, prior-event, eager insert at `first-obligation`; Chromium's host
errors are empty. Logs:

- `.review-2377/trailbase-mutation-clock-original.log`
- `.review-2377/trailbase-mutation-clock-browser-original.log`
- `.review-2377/trailbase-mutation-clock-guarded-original.log`
- `.review-2377/trailbase-mutation-clock-browser-guarded-original.log`

The production repair is deliberately small. Each observed source event gets
a fresh token carrying its existing expiry timestamp. Each built-in CRUD
handler captures the immutable token map before calling the backend.
Confirmation requires an existing token different from that captured token.
This accepts event-before-response and distinguishes same-tick events without
awaiting an applied receipt or adding another lifecycle.

Final `src/trailbase.ts` SHA-256:
`863c2564249e738c52056dea135ba5a27047ab6ab029674ca12d0d937789ee08`.
The frozen eight oracle fingerprints remain unchanged after the repair.
The final source patch is `.review-2377/trailbase-fresh-confirmation-source.patch`,
SHA-256 `0f2050059c2582102d57c3e92ffecc723cedb9c3033de0edcd56eebb4041cac9`.

Both full new receiving campaigns pass: **251/251 Node and 251/251 actual
Chromium**. Their fixed seed and fresh campaigns use the same 60-history
budget. All twelve declared states have five independently varied constructed
builders. Measured constructed-history reach has a minimum of 13 and 12 on
Node's fixed/fresh campaigns and 13 and 14 on Chromium. Exact per-state counts
are retained in [the reach record](2026-11-17-trailbase-mutation-reach.json).
Every state-missing calibration and the actual own-applied-receipt deadlock
and cleanup fault controls pass. Logs:
`.review-2377/trailbase-mutation-clock-green.log` and
`.review-2377/trailbase-mutation-clock-browser-green.log`.

Two isolated actual-source mutants distinguish the fix from plausible wrong
designs using the shared fixed history and unchanged comparison:

- Reinstalling the exact original source rejects `first-obligation`: a backend
  response completes the mutation before its new event. The loader prints
  the actual original source path; log
  `.review-2377/trailbase-original-mutant-kill.log`.
- Replacing fresh-token identity with a newer-timestamp test rejects
  `both-obligations`: both source event and response have arrived, but its
  same-tick handler remains pending. The recorder captures that wrong result
  and then rescues cleanup, without substituting a test timeout. Log
  `.review-2377/trailbase-timestamp-mutant-kill.log`.

The package-wide preserved run executes all 13 files, including ordinary
mutation tests, lifecycle/page-event oracles, controlled eager conformance,
persisted startup and the new receivers. It records **1,575 passes and two
failures in 1,577 tests**, with no type errors. Both failures are the unchanged
installed-SDK maximum-float parser defect described above. The attempted CLI
exclusion was not honored by the project configuration, so the log's historical
filename `.review-2377/trailbase-preserved-portfolio-green.log` does not mean
that this run was GREEN. Its two failures remain visible. Full package
TypeScript and scoped ESLint separately exit zero. There is no dedicated
120-second mutation-timeout or 300-second event-expiry test in this suite:
preservation of those predicates is source-inspection evidence, and
long-duration confirmation/expiry schedules remain outside the claim.

The exact-head shipped-size comparison reports gzip **2,680 to 2,708 bytes
(+28)** and brotli **+18 bytes**. Its app scenarios do not change. Command:
`node scripts/size-compare.mjs --base HEAD --exact-base --packages
trailbase-db-collection --files --rebuild`; log
`.review-2377/trailbase-production-size-comparison.log`.

The independent enforcement reviewer approved source `863c256…` after source
inspection, an independent eight-selection repaired Node run, both full host
GREEN records, both source-mutant semantic kills and the preserved portfolio.
It found no remaining source defect in the declared single-write class.
This approval excludes the separately open SDK numeric parser and does not
approve the entire TrailBase oracle portfolio.

The independent law reviewer also approved the final bounded source repair at
SHA-256 `863c2564249e738c52056dea135ba5a27047ab6ab029674ca12d0d937789ee08`
after verifying all eight frozen test hashes, both 251-test host GREEN results
and both semantic source-mutant kills. It found token identity captured before
the request suitable for the stated law, with time retained only for expiry,
and no supported source defect. Its approval preserves the one-handler premise
and excludes arbitrary concurrent-writer causality, cancellation and timeout
closure. The preserved package run supplies the executed ordinary
mutation/lifecycle compatibility evidence; long-duration expiry remains source
inspection only.

### Numbered rubric outcomes for the mutation instrument

| Requirement | Evidence and limit |
| --- | --- |
| ORC-001 | Law, exact authority, one-write/event premise and excluded paths are beside the independent model and recorded above. |
| ORC-002 | Model folds authored row roles and two obligations; it imports no adapter timestamp/token machinery. |
| ORC-003 | Contract/model/grammar live in the model module; driver explains actual SDK cuts; shared registrar explains comparison and fault controls. |
| ORC-004 | CRUD/mode/order/prior-event/peer/clock/coordinate axes, ablations, legal key-reuse reconstruction and nearby invalid tags are accounted for above; fixed regressions use the shared grammar and checker. |
| ORC-005 | Actual built-in CRUD HTTP consumption, source commit entry and public rows/state/settlement are recorded at each cut; guarded Node/Chromium replays establish the intended path. |
| ORC-006 | Original source, timestamp repair and own-receipt mutants reject at their intended semantic comparisons; baseline-broken calibration attempts are reported separately. |
| ORC-007 | Fixed seed 2377 and fresh campaigns share budget 60; guarded seed/path/unit replays execute once on each host. No commands arbitrary is used. |
| ORC-008 | The stateless two-obligation projection keeps order because either first obligation must leave the handler pending; source rows publish only after both. No adapter state machine is duplicated. |
| ORC-009 | Backend response consumption, source acceptance, applied settlement and optimistic transaction settlement remain separate; same-clock control supplies a host premise, not expected row truth. |
| ORC-010 | Completed immutable cuts survive secondary teardown failures; pending final cuts are representable before rescue rollback; both actual controls are executed. |
| ORC-011 | No additional shared-semantic-fault hypothesis requires a second model; the source implementation uses token identity while the oracle uses authored obligations. |
| ORC-012 | This append-only record binds gate verdicts and exact fingerprints to the evidence; no entire-adapter closure is claimed. |
| ORC-013 | Neither/first/both obligations, prior-event versus fresh event, either arrival order and same-tick versus system-clock neighbors reject original, timestamp and own-receipt wrong designs. |
| ORC-014 | Node and actual Chromium run identical law/model/grammar/checker through the installed SDK; no deployed-service, persistence or arbitrary SSE fragmentation premise is transferred. |
| ORC-015 | Twelve states, five fresh constructed objects per state, generated-builder WeakMap checks and missing-state controls enforce reach; per-host counts are linked above. |
| ORC-016 | Fixed inputs and all calibrations use the shared model/driver/checker; no standalone unit assertions occur in oracle files. |

**Scoped closure:** an older retained key observation cannot discharge a new
single-write built-in handler for the generated CRUD, eager/on-demand,
response/event order, prior-event, peer and fixed/system-clock histories, through
the installed SDK on Node and Chromium, at the three named public cuts.
Concurrent writers/handlers, failed backend responses, cancellation deadlines,
long-duration expiry, persistence wrapping, arbitrary identifier allocation,
deployed service delivery and fragmented SSE remain outside that claim.
