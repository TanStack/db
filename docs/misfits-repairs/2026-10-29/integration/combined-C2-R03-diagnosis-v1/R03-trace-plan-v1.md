# R03 trace plan — unexecuted

This document specifies an artifact-only diagnostic overlay for the exact registered R03 history. It is not an executable transform and grants no execution authority. Root must admit the reviewed executable transform, config, input identities and command in a separate record before any trace runs. The replay author owns the executable overlay. This integration epoch changes no production, oracle model, history grammar, comparison, replay registration, budget, cleanup or built output.

## Question and authority

The accepted law is that a move waiting on a failed truncate replay rejects with that replay's own Error, its earliest failure that still decides it. The frozen architecture states this maintainer decision at lines1396–1403 and requires normalized Error identity across the replay event, `lastSubsetError` and waiting move at1526–1529. The independent review, `../combined-C2-post-R02-v1/R03-independent-law-model-review-v1.md` (SHA256 `661a47480ff4a9a76bd1198a27c4097684be57018f9aece4b3ac508fcce3d7c9`), distinguishes each subscription's failed replay verdict from shared source publication retention. It found no authority for an earliest Error across separate subscription replay completions.

R03 is unclassified. The current primary model uses one `Barrier` per source, which combines loads from separate subscriptions. The trace must test that abstraction, the actual replay's Error selection, and the comparison checkpoint without assuming which account is wrong. No synthetic source-wide replay verdict may stand in for actual production completion objects.

The history is the registered property `replay.ordered-failed-replay`, seed `-290401844`, path `208:4:3:3:4:3:3`. Its shrunk commands are hold, truncateMarkers, window(offset0,limit1), reject newest without `keepHolding`, then reject oldest with `keepHolding:false`. Omitting `keepHolding` on the first rejection disables holding before that load releases; immediate retries may run before the last explicit rejection. Scenario `joined:"none"` is the LEFT anti-join branch. With `includes:true`, it also uses an include subscription to the same marker Collection. There is no peer. Exact history and source identities remain in `input-freeze-v1.json`; the shape correction is in `R03-shape-and-status-addendum-v1.md`.

## Immutable receiving inputs

The candidate is `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-combined-c0-s004-gate-v1`, HEAD `9cfa11fc712866f8f276e85762865ebb8bd49cbe`. The source freeze is `input-freeze-v1.json`, SHA256 `18416689930b9f7d065dd633f1ccf03bb9cace99c1ae062cbdedfe01e951c9bc`. The copied existing-build census is `effective-build-dependency-freeze-v1.json`, SHA256 `5d0443e6dbea07c1f70e701546c6201f66839d92b481a8a8d549b56bf897629e`. That census is not a new build, and its external dependency census identifies manifests and versions rather than every external code byte.

The three receiving source files are unchanged:

| Path relative to candidate | SHA256 |
| --- | --- |
| `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts` | `6790750c9b3546e4f08b71e5a1a07b668387611488596791ad183b1902eef10c` |
| `packages/db/src/collection/subscription.ts` | `03958e379c00257cf735e0bee57b6d9187e7d3ec3fa974eb5eeed8e11aad9f61` |
| `packages/db/src/query/live/collection-config-builder.ts` | `bbe18e7e5f3fb1e3342ecd0b5b13abf85460f1a6951fb51998dcac95c6abc623` |

Future admission must bind the executable plugin, separate diagnostic config, trace sink, every input source, exact anchor text/counts, generated transformed modules and their hashes. Before invoking the test, reject an absent, duplicated or changed anchor, unexpected receiving module, changed input or changed original comparison. Record the actual runtime import chain. A source overlay cannot claim to trace frozen minified internals unless an independently reviewed receiving mechanism binds those exact built modules. Initial execution scope remains the original exact source coordinate only unless root separately authorizes another path.

## Stable identity ledger

Use one diagnostic ledger shared by all admitted modules in the test process. Give each object one stable identity through a WeakMap; allocate a distinct monotonic event `seq`. IDs are opaque tokens, not Error messages, source names, array positions or elapsed times. Separate ID namespaces may improve readability, but one object must never acquire different IDs at different boundaries. Do not attach fields to production objects. Snapshot only immutable primitive values and arrays of identity tokens; do not retain mutable Maps, Sets, getters or lazy closures as the evidence.

| Identity | Required mapping |
| --- | --- |
| Error | injected Error, raw rejection, normalized Error and existing cause reference; preserve each distinct object even when messages match |
| Model load | `Load`, its exact request-data/options object, source, epoch, issue order, evaluated keys and ordered flag |
| Acquisition attempt | production acquisition record, request data, signal and sync-run generation; associate the model load only by the exact observed request-data reference |
| Subscription and demand | production subscription, exact logical demand, request data, acquisition and explicit `replaces` edge |
| Production truncate replay | actual ReplayState, ReplayAttempt, completion Deferred and its promise; retain the owning subscription |
| Model barrier | the model-only `Barrier`; explicitly list the loads, subscriptions and actual replay IDs that it combines, without treating the barrier as one production replay |
| Window operation | command index, requested offset/limit, returned promise, captured subscription replay promises and aggregate recovery promise |

Each event has `runId`, `seq`, `phase`, `event`, source anchor and available identity fields. Use `unknown` for an unavailable association; do not infer ownership from matching predicates, source or Error text. Include module identity in the run header. Keep a trace write failure separate from the original test failure and stop interpretation if the ledger is incomplete.

## Observation points and event ordering

Instrument only existing synchronous statement or callback boundaries. Preserve original expression evaluation count, argument identities, ordering, Promise combinators, returns and thrown values. Do not add a `.then`/`.catch` observer, microtask, timer, await, wrapper promise, provider call, changed mock or extra settlement. Do not re-read an effectful getter to discover an ID. Capturing a local value already evaluated by production is preferred. Where a required boundary cannot be observed under these constraints, declare it missing and seek a revised reviewed plan; never substitute observer entry for first settlement.

| Existing anchor | Event and primitive snapshot |
| --- | --- |
| Primary commands, including settle around1968 and window2098 | command enter; holding before/after; selected held load; rejection injection Error ID; request/command index |
| Primary `requestSnapshot` spy798 and marker Error creation1279 | request-data and subscription identity; model load issue; immediate or held path; exact injected Error ID; preserve the existing spy |
| Primary `raiseBarrier`597, `joinBarrier`633, `settleParticipant`661–713, `retireParticipants`715 | model barrier raise/join; failure-history append order; failures/pending/own before and after; retirement; successful coverage facts and exact request-data IDs |
| Subscription `trackTruncateReplayParticipant`654–701 | actual subscription/replay/attempt/demand binding; raw rejection and normalized Error IDs; failure insertion and own participant removal |
| Subscription removal703, verdict715–750 | abort/release/retirement facts; explicit replacement edges; held demand and pending/setup counts; candidates admitted/excluded for the actual verdict and recorded reasons from the existing computation |
| Subscription `abandonTruncateReplay`752–775 | completion pending flag before original reject; candidate Error IDs in original order; first rejection Error ID and completion/promise IDs; publication failure call and Error IDs separately |
| Subscription completion creation160, success779, replay attempt942 and pending getter978 | creation and ownership; existing resolve/reject invocation; whether first pending settlement; success waiting sibling replay IDs where already available |
| Builder `setWindow`366–435 and `pendingSourceRecovery`792 | the exact subscription completion promise values already captured before original Promise.all; ordered member IDs and returned aggregate ID; window captures aggregate; existing await rejection/resume with exact Error ID and run-abort facts |
| Builder admitted window467 and existing operation settlement around500 | returned/deferred window promise identity and existing producer settlement path; preserve the authorized unconditional reset and all tracking |
| Primary original window `settled.then`2145 onward | entry of existing fulfillment or rejection observer; actual Error ID; window promise ID; sequence of entry relative to producer settlement |
| Primary `checkReplayError`1575–1618, called2179–2186 | entry snapshot; actual Error lookup; each waited/newly-raised model barrier; ordered failure history with Error and load IDs; for every earlier entry, the exact existing `stillDecides` result and facts used to accept or exclude it; original stored violation unchanged |
| Existing replay event, `lastSubsetError` and health paths | public event Error IDs and existing health observation; retain source and subscription association only when observed; do not use health recency as replay priority |
| Primary finally2482 onward | cleanup start, original held-load release, unsubscribe and each existing cleanup settlement/rejection, flush and mock restoration as a separate phase |

The output must distinguish acquisition issue order, injected rejection order, model failure-history append, normalization, demand retirement, actual replay's first completion reject, aggregate/window producer settlement and existing window observer entry. `seq` supplies observed statement order only; it is not an invented native Promise settlement timestamp. Completion reject invocation while `completion.isPending()` was true identifies the actual replay's deciding settlement. A native Promise.all aggregate or async return may lack a directly observable first settlement without an extra observer. Mark that boundary unavailable and bound any checkpoint conclusion accordingly. An existing window observer supplies observer-entry order, not by itself first-settlement order.

Capture eligibility at the actual replay verdict before subsequent callbacks change held demands or replacements. Capture the model separately at `checkReplayError`, then compare the two ordered snapshots. Preserve the intermediate events between them. Record whether the first settle caused unheld retry loads, and bind any success that is said to replace an earlier failure to that exact demand and applied result. Adapter release, signal abort and transport termination are separate facts; this plan does not infer one from another.

## Acceptance and interpretation

An admissible future trace must preserve exactly one matching replay witness (`numRuns:1`, `failed:true`) and the original error-identity assertion. Setup/type errors, zero tests, altered or missing assertion, a different first mismatch, changed inputs, unresolved IDs or incomplete trace stop interpretation. Record cleanup results separately even if they occur after the deciding assertion. No normal-campaign, reach-count, mutant, cleanup-completeness or whole-PR credit follows from an exact diagnostic trace.

| Observed distinction | Bounded conclusion |
| --- | --- |
| The exact actual replay captured by the window rejects EA, but the window exposes distinct EB through the traced chain | Candidate production Error substitution under the accepted own-replay law |
| One actual replay selects a later Error while an earlier failure of that same replay still decides its verdict | Candidate production Error-selection defect; validate actual demand eligibility before classification |
| The window faithfully exposes RB's EB, while `checkReplayError` demands EA from separate RA combined into the source barrier | Candidate model abstraction defect; preserve earliest-own-replay identity and shared publication laws |
| The comparison relies on eligibility facts arising after the deciding settlement | Candidate checkpoint/recorder defect, only to the extent first settlement and intervening events were observed |
| Ownership, normalization, first settlement or replacement eligibility remains missing | R03 remains unclassified; name the missing observation |

The same-subscription two-failure control and cross-subscription delayed-verdict neighbor would distinguish general rival laws, but they are not authorized here. A retirement/replacement control, any reset mutant, model/production repair, new generated campaign or traced own-minified run also requires a separate root decision. Do not convert the original observation into a product verdict from message equality or shared source membership.

## Current execution status

No trace overlay has been created or executed by this integration task. The two completed exact replays in this epoch establish unchanged reproducibility through core source and already-built own-minified DB. Each reaches the original identity mismatch with one guarded input. Their logs lack stable expected/actual Error tokens and actual replay ownership, so they cannot choose a row of the interpretation table. The frozen C2 stop packet is preserved; this document and the shape/status addendum are separate later artifacts.
