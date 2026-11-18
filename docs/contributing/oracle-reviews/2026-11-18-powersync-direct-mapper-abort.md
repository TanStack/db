# Direct request cancellation during subscription mapping

This instrument amendment precedes the production guard. The original source
window is `index.ts` SHA256
`a30e71beb96fade6c5714a300ea76628386dd0b9b1ea04ad60ccf3ee9ae074fa`
and `subsets.ts`
`00fb4cb1976ec8b384d01e1fbb483768204bc40b69a3dcc19ed21b4356b3e380`.
The [pre-edit snapshot](2026-11-18-powersync-direct-mapper-abort-snapshot.json)
binds the five amended instrument files, registrations, receiving compositions,
original production, actual protocol fixture and cleanup dependency. Its file
SHA256 is `466f2767fc466b83403c98a541131af6fd8cfbb0d8c6e9d946300dda5797a128`.

## Law and receiving inventory

`LoadSubsetOptions` explicitly keeps signal lifecycle live after submission.
The error-handling guide's “Honor the loadSubset signal” rule ends the load
when its signal aborts. The glossary and Collection lifecycle grammar separate
that cancellation from retiring its logical owner or ending its source sync
run. A mapper can therefore abort its request while leaving the Collection and
a ready peer active.

The source's rejection obligation is stronger than core's rule for ignoring an
obsolete outcome. `packages/db/src/query/live/ARCHITECTURE.md`, “Source
cancellation and applied settlement,” requires a source to reject an aborted
caller's load with `AbortError` after its accepted rows apply. That source
contract authorizes the rejected outcome at the second cut. Core accepting
either eventual physical outcome without changing its state does not authorize
the adapter to report source success for the canceled request.

The primary owner remains
`db-adapter-conformance/tests/on-demand-streams-oracle.ts`. Its existing
mapper-triggered Collection cleanup reaches `active = false`; it did not
exercise a request signal becoming aborted while that mapper runs. The new
request branch adds this missing transition without copying adapter logic.
Its independent ownership judgment permits no retained stream for a canceled
request, preserves the ready peer, and rejects a canceled request becoming a
success at the next real checkpoint. Acquisition totals stay visible as
diagnostics. A harmless transient acquisition that is immediately released is
not forbidden by this law.

The pre-edit inventory contains five receiving paths:

| Host and path | Controlled premise and public observation |
| --- | --- |
| Node 26, real standalone SDK | A public snapshot request beside a ready live-query peer; actual mapper entry, SDK leases/waits, subscription status and request outcome. |
| Node 26, public persistence with controlled storage | The same history and comparison, through the persisted wrapper. |
| Node 26, public persistence with native SQLite | The same history and comparison, with actual storage operations. |
| Actual Chromium, real standalone SDK | The same public request and actual SDK protocol delivery in the browser. |
| Actual Chromium, worker/OPFS persistence | The same history and comparison through the actual worker and durable adapter. |

All paths use the same model, history grammar, comparisons and existing
60-history fixed/random budgets. Four new states each have five fresh
constructed builders: `request-pre-aborted`, `request-mapper-aborted`,
`request-post-mapper-aborted` and `request-healthy`. Existing mapping-cleanup and
loaded-cleanup states remain. Generated coordinates retain one to three rows,
values from -20 to 20 and coordinates from 0 to 10,000.

The request's right owner is a public change subscription's snapshot request;
left remains the ready live-query Collection. Distinct authored streams make
ownership observable independently of SDK acquisition representation. The
histories abort before admission, synchronously inside the mapper, in the next
microtask after mapper return, or never. They exclude mutation of immutable
request data, malformed mapper returns and canceled-source restart.

The first cut follows actual mapper return. It records raw pending cancellation
instead of waiting for the verdict. It permits a persisted wrapper to finish
rejection asynchronously. The second cut follows an actual provider checkpoint,
actual source applied receipts and, for persistence, completed real storage
operations. The persistence recorder forwards method arguments and returns
unchanged, including adapters resolved per Collection. It drains issued storage
receipts and finite continuations; it does not await the tested load promise.
This distinguishes a late wrapper result from a missing cancellation result.

## Pre-edit evidence

Initial Node 24 setup attempts failed because installed standalone SDK 0.1.1
uses `Map.getOrInsertComputed`, unavailable in that runtime. The old priority
neighbor and a bare SDK/client fixture also failed there. Those setup failures
are not cancellation RED evidence. Node comparisons use the established
explicit Node 26 executable:

```text
/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node
```

An initial OPFS run encountered Vite dependency optimization terminating its
worker. A fresh retry reached actual comparisons. Its healthy neighbor exposed
that source application precedes the wrapper's coverage metadata I/O; the
storage-operation recorder above repairs that observation cut. None of these
setup or checkpoint repairs changed production or model expectations to match
the defect.

The original defect retains the canceled right stream after mapper return.
At the next checkpoint, unwrapped sources can fulfill that canceled request;
the persisted wrapper can reject it but still retains the upstream lease.
The shared comparison observes each violation before fixture cleanup rescues
resources. Detailed final commands, reach and captured results follow below.

## Scope and review obligations

This closes the missing request-abort transition beside one ready peer, once
its original RED, repaired GREEN and source-mutant evidence are complete. It
does not claim first-cache-replacement authority without a peer, arbitrary
reentrant mapper actions, remote service behavior, saved coverage durability,
or universal transport cancellation. The provider transport may remain active
for the peer. The rejection's message, identity and `AbortError` name remain
outside this comparison; its source-boundary claim checks the rejected outcome,
resource ownership and peer isolation.

ORC-001/002/003/005/008/009 use the public signal contract, separate ownership
model, literate grammar, public receiving cuts and explicit right-owner mapping.
ORC-004 reconstruction covers the reported request and the pre/post/healthy and
cleanup neighbors; removing the during-mapping axis loses the defect, while
removing the live-peer premise loses sibling isolation. Numeric bounds vary
coordinates without changing cancellation semantics. ORC-006 controls inject
a retained canceled lease, later false success and a crashed peer. ORC-007
retains the shared fixed/random campaigns and direct replay. ORC-010 keeps
the existing completed-cut/secondary-cleanup transport. ORC-014 lists all five
receivers above. ORC-015 retains five fresh constructions and missing-state
controls for each state. ORC-016 uses the same model and comparison for fixed
regressions and generated histories. No distinct second model is needed under
ORC-011: the diagnosed missing transition is in the grammar/receiving path,
rather than a competing cancellation law. ORC-012's exact review and final
evidence are appended after the pre-edit gate and repair.

## Frozen original-production comparison results

The frozen Node command, from `packages/powersync-direct-collection`, was:

```sh
/Users/kyle.mathews/.npm/_npx/bac97da9607b7ef2/node_modules/node/bin/node ../../node_modules/vitest/vitest.mjs run --coverage.enabled=false --maxWorkers=1 tests/on-demand-streams-conformance-oracle.property.test.ts tests/on-demand-streams-persisted-conformance-oracle.property.test.ts
```

It ran all three Node receiving registrations: **1,227 passed, 57 failed**,
with no type errors. Each path has twelve actual semantic comparison failures
in the mapper-abort branch and seven bound calibrations whose selected clean
source execution already fails. Those twenty-one calibration failures are not
additional mutant kills. No setup timeout occurred. Every five-construction
mapper-abort set executed in both campaigns for each receiving path; the
before/post/healthy and existing cleanup neighbors pass.

The frozen Chromium command, from
`packages/browser-db-sqlite-persistence`, was:

```sh
pnpm exec vitest run --config vitest.adapter-oracles.config.ts --coverage.enabled=false --maxWorkers=1 e2e/powersync-direct-subsets-oracle.browser.test.ts e2e/powersync-direct-persisted-subsets-oracle.browser.test.ts -t 'request-|snapshot request|mapping-cleanup|loaded-cleanup|generated$'
```

It ran both receiving paths: **226 passed, 34 failed**, with 596 unrelated
checks unselected. Each path has twelve actual mapper-abort comparison
failures and five missing-state controls whose clean source already fails.
Again, the ten calibration failures are not additional kills. Both hosts ran
the two normal generated campaigns, every new request construction, the
existing cleanup constructions and the fixed request neighbors. There were
no setup failures. Each of the five new mapper-abort constructions executed
in both campaigns on each host; every before/post/healthy construction passed.

The original canceled request retains `right-<coordinate>` at `request-mapped`
and `request-checkpoint`, while the model retains only the left stream.
Unwrapped receiving observations additionally show false fulfillment at the
second cut. Persisted receiving observations retain the lease even when the
wrapper rejects the canceled request. All source/peer status, rows and healthy
neighbor observations remain independently checked.

Captured logs and SHA256 values:

```text
786910dc601cc8442d78a6f129f1365276b3eb9930b5286675648667ff00db55  .review-2377/direct-mapper-abort-preedit-frozen-node26.log
a5978c3060b5ed6ebd0a8f921a87a895f581c297b89be811319bfe0f2866184c  .review-2377/direct-mapper-abort-preedit-frozen-browser.log
```

The package's strict TypeScript check and scoped ESLint passed. The pre-edit
source and all instrument hashes remain as frozen above. ORC-013's adjacent
distinction is explicit: a pre-aborted request invokes no mapper, a mapper-time
abort retains no right stream, a later abort releases an acquired right stream,
and a healthy request retains right and fulfills. The same comparisons enforce
each case, while the existing mapper-triggered Collection cleanup exercises the
separate ended-sync-run boundary.

Direct guarded replay also reproduced the failure on unchanged production in
Node and actual Chromium/OPFS. Both use seed `2377`, path `0:0:0`, and unit
`random seed: request-mapper-aborted construction 1`. The registry routes to
the existing owner; each replay reports `witnessMode: async`, one execution,
one failed witness, and the original ownership comparison at `result`.
No normal campaign ran before either replay. Log SHA256 values are
`fbf5d49aa7f38c48c9adbc6b0cc64e4220df05d1d3a78c4b73d9b30a49025e73`
for `.review-2377/direct-mapper-abort-replay-node26.log` and
`766146cb4ab9971c0457be7a3a39b6c12379b3c005e7ea227cb8781fc0cf9fe9`
for `.review-2377/direct-mapper-abort-replay-browser.log`.

## Receiving amendment after the first repair

Independent enforcement review accepted the original five-path RED instrument
and the source-cancellation authority above. Its first final-source run used
`index.ts` SHA256
`1ec1defd6f1584be75b647f243c820f31db0b1e03eaa7fabaf3185b27c4076c1`
and `subsets.ts`
`20f8ed310b98099604fd05ae32a269b6554b87b937e31300f8dca3ac3a019da3`.
All five paths stopped at the initial donor's receiving premise, before the
request branch: `SDK lease waits settled at a complete checkpoint`. These are
setup failures, not cancellation RED results or evidence against the repair.

The first complete replacement can retire its SDK transport and replay the
active demand through an actual successor HTTP request. The original service
answered only the retired transport. Its consumption check also read a mutable
controller, so a successor could stand in for the request actually answered.
The revised service binds the controller, signal and subscriptions for each
complete checkpoint. A neutral input ledger will answer each actual successor
with the same authored checkpoint and drain actual SDK waits, applied receipts
and storage operations. Public status, rows and request outcomes do not decide
whether that input barrier continues. The model, histories and comparisons stay
unchanged. Original-source RED and repaired-source GREEN must be repeated with
this receiving amendment before the final approval.

The separate diagnostic-only amendment uses the total cleanup-error formatter
in the request rejection callback and the completed-observation catch. The
source-extracted controls preserved the completed wrong-row observation and
prior cleanup diagnostics for six thrown-value forms: ordinary Error,
null-prototype object, throwing string conversion, throwing-prototype Proxy,
cyclic AggregateError and throwing `AggregateError.errors` getter. All six catch
and all six rejection controls pass. These AST-extracted controls establish
the exact callback/catch behavior; they are not receiving-path integration
evidence. Their versioned source snapshot is
[receiving cleanup fidelity](2026-11-18-receiving-cleanup-fidelity-snapshot.json).

## Explicit cold and confirmed-empty settlement histories

The first full repaired-source campaign exposed a second receiving gap. An
applied replacement may replay a demand after a deliberately held application
is released. The provider-only checkpoint must return while that receipt is
held. Its later continuation must answer actual successor requests with the
same last authored checkpoint, including its errors. The additive `continue`
method does this without sending an initial duplicate to the request already
answered. Existing `receive` and `drain` methods retain their behavior.

The initial continuation run made semantic comparisons pass but correctly
failed declared reach for some persisted cold histories. Initial replacement
had retired the original lease before the injected error. The SDK delivered
that error only to the successor after application. The cold history therefore
did not supply the claimed early-error premise. Its absence is recorded by the
unchanged actual-callback reach check, rather than inferred from authored
timing.

Both independent reviewers approved an explicit legal prehistory before the
grammar changed. The optional `baseline: confirmed-empty` branch starts a
distinct right equality demand and a distinct authored right stream. It
receives a complete empty checkpoint, settles publicly, and retires publicly.
The model checks both donor cuts, including empty rows, healthy source and no
retained stream after retirement. The driver never waits for that last expected
inventory. It then starts the judged left demand and requires fresh mapper
admission. It resets no acquisition, callback or observation count. Different
predicates prevent the donor's exact persisted coverage from authorizing left.

The original cold arbitrary and fixed history remain. The new warm arbitrary,
fixed replay, five `confirmed-empty-baseline` constructions, and five warmed
`stream-error-before-application` constructions all use the shared model and
comparison. The latter state requires an actual SDK error callback while an
actual receipt remains pending. A calibration rejects retention of the retired
donor. This extends history reach without changing an old expected answer.

An isolated diagnostic transform captured both cold and warm fixed histories
in the unwrapped Node SDK receiver and actual Chromium worker/OPFS receiver.
Each host passed four checks. The OPFS cold trace records a provider cut with
pending application, the public held cut and release boundary, then continuation
from delivered request 3 to actual successor 5 with no remaining receipts.
Its early callback count is zero, honestly recording the missing cold premise.
The warm trace records the retained left lease and one actual error while its
receipt is pending; continuation keeps the already answered request and drains
application without a duplicate delivery. Node supplies the adjacent retained
lease case. These transforms add observation only; canonical production,
histories, model and scheduling calls remain unchanged. Vitest console
interception is disabled so passing-test diagnostics remain in the logs.

## Final evidence and review snapshot

The [final source snapshot](2026-11-18-powersync-direct-mapper-abort-final-v4-snapshot.json)
contains seventeen source and receiving files; its SHA256 is
`9ab4adb78610d7c418eb785437c4f76e5e5ad795cfa6fdc9ca5eac1ea0858ca8`.
The [machine-readable evidence](2026-11-18-powersync-direct-mapper-abort-final-evidence.json)
retains per-path fixed/random constructed reach, actual loaded source hashes,
ordered handoff observations and artifact hashes. Its SHA256 is
`2fc4d1d6b8d0c3bffe1df03f17ac867da2fde560e61cfeb7efd6706853d0d025`.
The historical pre-edit and intermediate snapshots remain intact.

- **Law:** a snapshot request's signal remains live through mapping. A canceled
  request retains no provider resource and cannot later become successful;
  its ready peer remains usable. The public signal contract and architecture's
  source cancellation/applied-settlement rule authorize this judgment. Donor
  retirement and held application use the existing ownership and applied
  settlement laws.
- **Reach:** each of the four request states has five fresh randomized
  constructions in each normal campaign on each of the five receiving paths.
  The new empty-baseline and before-application state each also have five named
  constructions per campaign; both construction families reach both states.
  All twenty declared states meet their five-construction obligation, including
  missing-state controls. Both normal sixty-history campaigns also execute.
- **RED:** the final amended request and warm-neighbor selection, using the
  saved original source `a30e71be…` / `00fb4cb1…`, gives 342 passed and 48 failed
  Node checks, plus 228 passed and 32 failed Chromium/OPFS checks. There are
  eleven semantic mapper-abort failures per path: one fixed replay and ten
  constructed executions. The remaining five failures per path are calibrations
  whose selected clean run is already red; they are not additional kills.
  All warm, pre-aborted, post-mapper-aborted and healthy neighbors pass. Actual
  Vite load witnesses bind the original source on every receiving host. No
  setup failure is credited.
- **GREEN:** full normal commands give **1,353 Node checks** and **902 actual
  Chromium/OPFS checks**, all passing, including both campaigns, every fixed
  history, determinism, reach and checker calibrations. Node reports no type
  errors. These runs bind the v3 source snapshot. The only later executable
  edit renames one local `mapped` binding to `requestedBeforeStart` to remove a
  shadow warning; scheduling, paths, model and comparisons are unchanged.
  Scoped ESLint is repeated after that identifier-only edit.
- **Mutant:** an isolated source copy removes only the new post-mapper
  `options.signal?.throwIfAborted()` call. It keeps the initial signal guard,
  active-run fence and cache repair. Actual loaded source hashes are
  `1ec1defd…` / `07f180d4…`. The amended oracle rejects eleven semantic
  mapper-abort cases per path, with 216 healthy Node neighbors and 144 healthy
  browser neighbors passing. The five invalid-clean-run calibrations per path
  are again excluded from the kill count. Canonical source remains unchanged
  throughout the saved-source runs.
- **Limits:** this closes the mapper-time external abort transition beside a
  ready peer on the five named SDK/host paths. It does not establish error-name,
  message or identity fidelity, arbitrary mapper reentrancy, remote service
  behavior, saved-coverage durability, or universal transport cancellation.
  Cold replacement can retire its initial lease before a failure callback;
  its retained histories compare public semantics without claiming that missing
  early-error premise. The explicit warm histories supply that premise.

The final normal commands are the earlier Node command without a test filter
and the earlier Chromium command without `-t`. Original-source receiving runs
use the same registrations with the source-copy load plugins and select
`request-|snapshot request|confirmed-empty-baseline|stream-error-before-application|distinct empty donor`.
The precise guard mutant selects `request-|snapshot request`. Every source-copy
run logs the SHA256 of the code actually served; no installed dependency is
patched. The evidence JSON names the exact configurations and logs.

## Independent final review

The enforcement reviewer approved the final v4 mapper amendment after
verifying all seventeen current source hashes and the evidence artifact
hashes. Reversing the local `requestedBeforeStart` rename and applying the
unchanged formatter exactly reconstructs the v3 shared driver, establishing
the identifier-only evidence carry. Independent final warm and mapper-aborted
construction checks pass on all five paths: six Node checks and four actual
Chromium/OPFS checks. Every path reports the actual error callback while the
warm history's application receipt remains held. The independent logs are
`.review-2377/enforcement-direct-mapper-final-node.log` and
`.review-2377/enforcement-direct-mapper-final-browser.log`.

The exact reconstruction replaces both `requestedBeforeStart` occurrences
with `mapped`, then runs `pnpm exec prettier --stdin-filepath
packages/db-adapter-conformance/tests/on-demand-streams-driver.ts` on that
text. The result is saved as
`.review-2377/direct-mapper-v3-reconstructed-driver.ts`, SHA256
`e715acda32c8f6cbef34d07b59415ff3994f0e622c6666bedeb284e7b3dbcc4f`.
The longer binding name changes only the chain's formatter line wrapping.

This approval credits the original-source and precise guard-mutant semantic
failures and excludes invalid clean-baseline calibrations. It finds no
remaining actionable defect within the mapper, warm-baseline and continuation
boundary. It does not approve unrelated adapter behavior or the whole
receiving portfolio.

The adversarial reviewer also grants final bounded approval for the v4 source
snapshot and evidence above, against production `index.ts` `1ec1defd…` and
`subsets.ts` `20f8ed31…`. The reviewer independently verifies all seventeen
source/instrument hashes and sixteen evidence artifact digests, the raw full
GREEN counts, both semantic RED classifications, every declared reach's five
fresh constructions per campaign and receiver, and the actual cold/warm receipt
cuts. The reviewer approves the exact reconstructed v3-to-v4 identifier and
formatting carry. This verdict closes the mapper boundary only; arbitrary
parser-cause and cached-startup refusals remain separate investigations.
