# R03 targeted driver plan v2

Frozen proposal before implementation. This supplements plans b41b4ec0 and
8a9fbcb0. Confirmed-open production-to-account mapping/lifetime gaps remain open.
Pure checker calibration will not stand in for the real cuts below.

## Authority and fixed scope

Keep the own-replay earliest still-deciding Error law, exact normalized identity,
and shared publication law. Current ARCHITECTURE.md's normative law16 contains
request-error eligibility; use its section text, not historical numbering.
There is no source-global failure priority or native Promise timing deadline.
Keep production, builds, the old failedReplayCase arbitrary and its weights,
old native coordinates, all old budgets/365 keys/computed routes unchanged.
Only the new targeted campaign selects the opt-in additions below.

## Three minimal additive driver operations

1. **Same-turn settlement batch.** Add a command available only to the new
   arbitrary. At command entry select a finite generated list of existing
   held resolvers by oldest/newest choice (or their adapter receipt), remove
   those exact resolvers once, then invoke all selected resolvers synchronously
   with their generated outcomes. Snapshot selection before invoking any.
   There is no await between resolutions; retain the existing single flush at
   command end. This is an ordinary provider returning several requests in one
   turn, not an imposed completion order. Missing selections do not count as
   reach. Keep the original single-settle branch byte-for-byte where practical.

   Constructive target: the R03 hold/truncateMarkers/window prefix creates
   three held marker loads: A has two own loads and B has one new own load.
   Resolve the selected three in one batch, with failures on both own replays,
   varying resolver order and retained/successful coverage. At the existing
   window rejection callback measure whether both own verdicts have become
   eligible/completed, rather than assume the native microtask result. Also
   generate A locally draining with success while B still holds publication,
   then demand started on A before that shared hold ends. Local successful
   drain must remain distinct from completed successful replay.

2. **Explicit Error sharing.** Add an optional scenario allocator selected
   only by the new campaign. Default behavior keeps allocating each original
   fresh Error with its original message. The opt-in mode deliberately reuses
   one Error token for multiple chosen load failures within a history, including
   different opaque subscription owners. Existing inject/injectLoad bookkeeping
   uses WeakSets and can admit this without assigning an Error a unique owner.
   Cover the three existing load-fault allocation sites, not unload faults or
   AbortError creation. Allocate the intended Error before freezing a model
   failure verdict; the existing code currently updates settleParticipant before
   assigning load.error. The same Error is still thrown at the same adapter
   rejection site. This is test bookkeeping, not a product behavior change.

   Real target: the batch topology above, crossed with fresh/shared identities,
   has two own receipts owing the same object. The expected allowed set must
   derive receipt eligibility first and match Error identity afterward.

3. **Public callback reentry.** Add a one-shot generated arming command for an
   already observed adapter subscription. Register through the documented
   Subscription.on event interface and unregister in normal driver cleanup.
   The callback performs one existing ordinary source delete/mark operation
   synchronously, updating truth and source writes through the same helpers as
   ordinary history commands. It does not await or add a timer/microtask.

   Target the R03 B subscription: its single new-demand load has drained and its
   replay fails before its loadSubset:error event (measured109→110), while W's
   observer comes later115. An armed callback deleting root1 or changing the
   relevant marker can retire or replace that failed demand before W observes
   the rejection. Select the arming target by the input/adapter receipt and
   independent ownership account, not by production's chosen Error or replay
   classifier. Public status:ready of that same own-drained failed subscription
   is a bounded alternate trigger if the error event does not yield the cut.
   The event choice is generated and recorded explicitly.

   Do not treat loadSubset:error as universally post-verdict: A's event94 was
   before A's completion. Do not cast the exposed Subscription interface to
   call releaseSnapshot or mutate query-owned demand behind its owner: that
   interface exposes status, lastError and events only. Demand must change
   through a normal source mutation and the query's existing demand machinery.
   Listener execution alone is not reach. Require a matching actual adapter
   unload/replacement, with ownership linkage, before W's rejection callback.

## Staged constructive gate before final model work

First implement only these opt-in driver inputs, thin observation hooks, and
their finite targeted histories while preserving the original judgment.
Do not yet install the final verdict model or turn false RED into GREEN.
Freeze source/patch hashes and seek a bounded runtime admission for the finite
batch, sharing, and reentry witnesses. Retain the existing original comparison
and cleanup and classify its known false RED correctly. A diagnostic run that
ends in that old failure may still supply raw reach evidence; it is no product
defect claim and no test may be made green by swallowing it.

For each candidate retain the independent adapter/model account separately
from actual mapping observations. Record invocation/options/subscription/load
identity, source episode, participant settlement order, generated batch and
reentry action, callback entry/return, unload/replacement, and W observation.
Completed-replay lifetime claims require actual deciding-cut evidence, not only
an independently eligible account plus an error event that may precede verdict.
Use a separately frozen diagnostic overlay if first-settlement-site observation
is necessary; actual private identities may validate mapping but must never
compute the independent expected verdict. Native engine settlement stays
unobserved unless there is an actual instrument; no observer is relabeled.

Require these real witnesses before final-account admission:

- Existing same-own two deciding failures and exact R03 A0-pending, at W.
- Two distinct own failure completions from one selected resolver batch before
  the first W observer, with exact own Error receipts retained.
- The same real topology with one shared injected Error and independent owner
  identities preserved.
- A completed own failure followed by matching demand retirement or replacement
  from public callback reentry before W, while W keeps that completed receipt's
  Error. Record retirement and replacement separately; do not join them under a
  reach label that falsely implies both paths were witnessed.
- Locally successful own drain with sibling hold, then new own demand joins;
  do not prematurely freeze successful completion at that local drain.

If a proposed witness does not occur, report its exact trace and missing cut.
Try only the stated alternate public ready trigger or the generated ordinary
delete/mark choices, not a broad scheduler harness. No final closure while a
material mapping/lifetime gap remains. No silent exclusions of old histories.

After constructive admission, implement the independent own-episode/completed
receipt account from plan b41b4ec0, keeping publication separate. Derive allowed
completed own Errors without the actual observation and retain immutable
receipts across subsequent demand changes. Add the generated targeted campaign
at120 fixed and120 random histories (increase only if a justified measured need;
do not reduce existing budgets). Declare individual real reach dimensions, at
least5 generated histories each per campaign, and separate account/checker-only
sensitivity controls. Keep the same hostile wrong-identity calibrations.

## Lossless review notes and packaging

These are design/authority constraints, not new product findings:

- Reviewer: pure calibrations prove receipt algebra; they do not validate
  production-to-account mapping at batch/reentry/shared-Error cuts.
- Reviewer: two failing own receipts before W need same-batch settlement;
  separate settle commands flush W before the next command.
- Reviewer: current fresh allocation makes real shared Error identity
  impossible without an explicit opt-in fault-sharing axis.
- Reviewer: error event can precede an established replay's verdict, so use
  the measured drained-new-demand topology and actual pre-W ownership change.
- Reviewer: load.error is assigned after settleParticipant today; immutable
  expected receipts need the injected object before their failure cut.
- Reviewer: own successful drain while a sibling holds publication stays open
  to newly started demand and is not completed successful replay.
- Root: no final model before independent cut feasibility; no global priority,
  broad suppression, new timing deadline, production edit, or budget reduction.

Executable delta remains primary oracle plus additive config/manifest only;
coverage-owner documentation is a separate inert patch for later independent
composition. Freeze exact pre/post snapshots, key/budget preservation and all
evidence for C3 integration. No runtime, final-model implementation or publication
is authorized merely by this revised plan's freeze.
