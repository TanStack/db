# Next held-window validation plan, after A13

This is a source-only proposal. It authorizes no source implementation, product
execution, campaign, installation, production change, commit, push, or PR. Both
A13 runtime admissions are consumed. Each later preparation and execution needs
the coordinator's explicit admission under its resource protocol.

## Starting evidence and authority

The accepted law is `ORDERED-HELD-WINDOW-PRIORITY`: an imperative window move
already holding publication retains the prior complete public snapshot through
a later optimistic departure. A departure before that move remains immediate;
the move retains the snapshot public when it starts. A move completed before
departure grants no publication hold. Authority is the maintainer decision in
`external-reviews-2026-10-30/human-decisions-and-review-source-v1.json`
and `ARCHITECTURE.md`, “Atomic window publication,” including its ordinary
optimistic-departure exception. The applied-settlement and request-headroom
rules remain distinct laws.

The decision receipt SHA256 is
`e12e53f13adc3ee9d393501deb588e26d8a0aae1c9bb9191b86fb71cd634e142`.
The receipt path is relative to `docs/misfits-repairs/2026-10-29/`, not this
plan's directory.

A13's independently accepted C01 checked ten pure capacity controls. F01
checked one Core source-delete/root/ascending/rollback history. Its interim
snapshot stayed `[3]`, its completed target was `[3,2,1]`, and its following
window was `[2]`. Its first held request asked for two rows. At the held cut,
`submittedRows` was empty. The pending-receipt flag was a recorder placeholder.
Neither actual capacity-four acquisition nor queued applied-receipt behavior
was exercised. Reference `held-request-capacity-A13/independent-result-review-v1.md`
(SHA256 `1676c8e196ba3c7fd949158bee68e6a913694d933153c23850a0c3ab50d08827`).

The source manifest beside this plan binds the inspected files. It does not
freeze the whole worktree or replace a later reviewed execution packet. A9–A13
records and the append-only claims ledger remain unchanged.

## 1. Execute the remaining finite controls first

Under separate future admission, use the current Core owner
`packages/db/tests/query/ordered-work-oracle.property.test.ts`. Each selector
below selects one existing test. Use a suffix match, without a leading `^`,
because Vitest includes the enclosing describe name.

| Order | Existing selector | Production history and shared-checker challenge |
| --- | --- | --- |
| 1 | `rejects a stale or incomplete completed target after an overlay cycle$` | One rollback grammar sample, seed 20261107. Reject an early short row snapshot, early publication, wrong post-overlay held rows, stale/incomplete completed target, and stale following window. |
| 2 | `rejects blanket deferral after an ordinary departure$` | One ordinary base-predicate sample, seed 20261109. Reject retaining original rows with no immediate departure publication. |
| 3 | `rejects a stale short window after an applied root refill during a marker overlay$` | Existing anti-joined marker acknowledgement, ascending, width one. Reject stale refill rows and falsely pending root provider/receipt observations. |

These tests obtain lawful observations from production and feed altered
observations to the existing judgment. They establish checker sensitivity at
their actual cuts. They are not production-mutant kills or generated coverage.
Do not rerun A13 C01 or F01 merely because they are available; their accepted
evidence remains the starting point. Stop and classify a failed premise,
comparison, timeout, or guard stop before expanding execution.

## 2. Prepare a small recorder and reach repair

Before broader execution, propose an additive instrument-only change to the
existing owner and coverage-map limit. Keep all expected-row rules and the
ordinary `optimisticWindowViolations` body unchanged. Independently review the
exact delta and freeze a successor packet before runtime.

The current driver creates an attempt with `appliedReceiptSettled = false`
before it submits any answer. Both ordinary and held properties can therefore
credit `held applied receipt` without a receipt. Preserve the raw old flag for
historical interpretation, but require these recorded events for new credit:

1. The real provider entered for one immutable acquired request.
2. The provider actually submitted a nonempty answer for that request.
3. The driver's real `commit()` returned an applied-receipt Promise, rather
   than literal `true`; the return event is recorded only after commit returns.
4. That specific receipt remains unresolved and unrejected at the named cut.
5. The optimistic transaction persists, and the shared held/ordinary comparison
   succeeded at the corresponding public observation cut.

Record receipt identity, returned kind, submission, fulfillment, and rejection
separately. Keep a rejected receipt distinct from a fulfilled receipt. A thrown
commit grants neither acceptance nor applied-receipt credit. Preserve primary
mismatch and secondary cleanup diagnostics. Use the existing real commit
wrapping pattern in `ordered-base-receiving-oracle.ts`, not a manufactured
deferred receipt. Its current receipt record will need request/transaction
provenance for this law; its acceptance-only `writeUpsert` is insufficient.

Add independent reach for an entered but unanswered provider. That state grants
no receipt credit. Count all successful-comparison reaches only after the
relevant shared judgment passes, with history-local IDs preventing accidental
double credit. A reach failure diagnoses instrument reach, not a product law.

## 3. Require actual capacity-four acquisition evidence

A13's ceiling permits four for a direct-source target-three request issued
while one root overlay is active. That bounded fixture policy does not require
every lawful algorithm to ask for four. The pure calibration proves only the
checker accepts that observation and rejects five.

Declare the desired production reach from actual `loadSubset` issuance:

- Authored target width three has started and the root optimistic transaction
  has not completed its explicit settlement await.
- The actual acquired immutable request has ordered `limit = 4`, and its
  copied phase/scope context independently produces allowance four.
- Its real provider enters; the interim held rows/publications pass the shared
  judgment; its completed target and following window also pass.

Do not count a case flag, a capacity-four calibration, a derived allowance,
or a modified request as this reach. Keep requested capacity distinct from
actual returned-row transfer and source exhaustion.

The existing departure-before-target schedule can reuse an ordinary refill
issued before the wider target. Its actual limit can remain two or three.
Source inspection does not establish that its present grammar reaches four.
First review that legal schedule against actual issuance recording. If it
cannot reach the desired state, report a grammar gap and prepare a separate
additive schedule proposal. It must use public operations and preserve the
accepted law. Do not force an adapter limit, suppress ordinary acquisitions,
change production scheduling, or claim a speculative transaction schedule
works. If a lawful implementation never needs four within the stated domain,
limit the claim to capacity-policy calibration and actual requests observed.

## 4. Validate every timing and receipt variant

Preserve these existing property keys, fixed seeds, generators, and original
fixed/random run budgets. The ordinary property is a required neighboring
control. Do not replace either campaign with a finite selector or lower a
budget. Each existing test retains its 120-second timeout. Use direct replay
with property key, seed, and shrink path when an admitted failure needs replay.

| Existing property | Fixed seed | Budget per campaign | Required distinction |
| --- | ---: | ---: | --- |
| `ordered-work.optimistic-base-predicate` | 20261106 | 80 | No pre-existing barrier; root/marker, before/after answer, widths one/two, ordinary immediate departure and useful bounded refill. |
| `ordered-work.held-target-optimistic` | 20261103 | 80 | Target before departure; root response really queued behind its mutation; marker root response applies; explicit target completion during marker persistence. |
| `ordered-work.window-priority-timing` | 20261109 | 80 | Departure before target retains its already-short snapshot; completed move before departure preserves ordinary immediate behavior. |
| `ordered-work.held-target-overlay-rollback` | 20261108 | 80 | Overlay starts and ends while provider answer is withheld; interim hold, completed target, and following window across rollback ABA. |
| `ordered-work.held-target-overlay-cycle` | 20261107 | 80 | Acknowledgement plus rollback; authoritative ledger changes and marker restoration remain distinct from unchanged-base ABA. |

Run bounded preparations and admitted campaigns sequentially. Report source
update/delete, rank-plus-membership, source/joined/anti-joined, root/marker,
ascending/descending, acknowledgement/rollback, and each authored timing cut
separately where legal. Do not infer a complete Cartesian product from marginal
reach counts. Name any unmeasured interaction.

Two marker witnesses are required. First, a root receipt has applied while
marker persistence and another real required target acquisition remain held;
the public snapshot must stay held. Second, explicitly await full target
completion during marker persistence and compare the current complete window.
Provider submission alone permits scheduler progress and cannot select one
exact snapshot through a production pending flag.

The acknowledgement/continuation route still has an unresolved guard-eight
containment gap. Keep it declared. Before attempting its generated campaign,
prepare a finite legal continuation schedule and source-only containment
account. Require actual callback entry, a held answer, request-scope and
forward-progress recording, and completed comparison within guard eight. If
that cannot be obtained, stop with the gap open. Do not raise the guard, hide
the cell, narrow the checker, or classify a fixture guard stop as product RED.

## 5. Extract the canonical judgment before adding Query receiving

Create a future companion such as
`packages/db/tests/query/ordered-window-priority-oracle.ts`. Move the case and
observation types, independent reference functions, relevant legal grammars,
and shared comparisons without semantic edits. Keep their literate contract
and `declareOracle` registration visible. Both production drivers must invoke
the same exports. The common model still derives expectations from authored
ledger/overlay facts and event order, never loader pending flags.

Extract `referenceOptimisticWindow`, `referenceHeldPublicSnapshot`,
`referenceHeldRequestCapacity`, `optimisticWindowViolations`,
`heldTargetWindowViolations`, and `heldTargetOverlayCycleViolations` as the
same judgment. Preserve ordinary checks, boundary-tie judgment, source-predicate
and repeated-request progress checks. Keep independent request-answer
evaluation a provider mechanism; it supplies no expected public rows.

Freeze extraction separately from semantic or driver changes. Require exact
source review of old/new functions and a bounded equivalence plan: all legal
finite case shapes and the accepted/wrong observations must yield the same
ordered violations. Preserve fixed/random registration, replay routing, and
original budgets. Do not claim equivalence merely because imports compile.
Execute this equivalence gate only after admission.

Then inject a source factory or a small production-driver interface into the
shared history runner. The Core implementation retains its controlled sync
adapter. The Query implementation supplies the real `QueryClient`,
`queryCollectionOptions`, Collection mutations and live-query `setWindow`,
callback-owned provider holds, actual applied receipts, and cleanup. Do not
duplicate the history's expected rows in Query or reuse the separate expected
model in `refetch-ordered-prefix-oracle.test.ts`.

## 6. Preserve actual Query key and ownership provenance

The real adapter computes a function key's base by calling `queryKey({})`
before demand. Record that actual invocation and returned base. Derive keys
with the existing lawful pattern: undefined demand key returns `[id]`, and a
nonempty demand key returns `[id, demandKey]`. Do not synthesize a base from
a later nonempty demand, or use `[id, undefined]` for the empty base.

Record each actual callback input and returned key. Also record the actual
`queryFn` context's `queryKey` and `meta.loadSubsetOptions`. Check every derived
key extends the recorded base and matches the key for its actual request.
Join the records through an acquisition ID and immutable demand descriptor;
Query may copy metadata, so callback request identity alone is insufficient.
Keep cache-key identity, acquisition identity, and physical callback identity
separate. An unobserved association receives no ownership credit.

Wrap the real adapter `loadSubset`/`unloadSubset` to record exact request object
identity without rewriting it. Guard eight counts at real acquisition entry.
Track sync run, acquired request, callback, submitted rows, sync transaction,
actual receipt, and unload association. If a commit combines more than one
input, retain that relation rather than guessing a one-to-one association.
Preserve request data and signals and return the real receipts unchanged.
After cleanup, check exactly one matching unload per established acquisition,
no unknown/duplicate unload, no remaining active Query observer, and clear the
QueryClient. Retain all secondary cleanup failures and the primary mismatch.

The existing `ordered-base-receiving-support.ts` and ordered-prefix receiver
provide driver patterns. They do not already supply held-priority receiving
evidence. Use public `toArray` and `subscribeChanges` snapshots, including
interim events, as the shared judgment's observations.

## 7. Stage real Query receiving with the same law

First prepare one finite Query root-delete/rollback history matching A13 F01.
Hold the real callback's result before adapter delivery. Compare initial,
immediate, acquiring, post-overlay/pre-answer, completed, later-turn, and
following-window rows and publications through the canonical checker. Record
actual keys, acquisitions, receipt returns, and ownership throughout.

Next prepare finite root queued-receipt, marker root-applied/other-target-held,
marker target-completed-during-overlay, departure-before-target,
completed-before-departure, and actual capacity-four witnesses where reachable.
Replay the same wrong-publication and ordinary-deferral controls through the
shared judgment. Only then propose Query fixed/random registrations using the
same legal grammar, recorder meaning, checker, and 80-history budgets per
campaign for each corresponding Core property. Give each receiving property
a distinct Query key in `oracle-config.ts` and replay manifest. Those new keys
do not yet exist; source review must bind their exact selectors before runtime.

Preserve the neighboring real Query properties. Providers, held-release,
repopulation, and finite-boundaries keep 40 histories per campaign;
first-transfer-premises and first-transfer-growth keep 80. Their fixed seed is
20261029. The ordinary `optimistic-ordered-refetch-oracle.test.ts` keeps its
separate 24-cell mutation/refetch contract. These checks supplement the new
shared held-window receiver; they do not substitute for it.

## Admission, evidence, and stopping rules

Each runtime packet must bind exact source, dependencies, selector, campaign
budget, outer deadline, serial worker-one runner, and resource-slot admission.
Capture the actual selected-test count and commands, reach counts, primary
comparison payload, cleanup diagnostics, exit status, and original process
group emptiness. Freeze each result before another attempt. Do not silently
retry or run a broader selection after failure.

Unchanged-production GREEN can validate the corrected instrument and path.
It does not establish a production repair. Classify an eventual RED as a
production mismatch, wrong model/law, missing boundary information, unsuitable
checkpoint, setup failure, runtime failure, timeout, guard stop, or unreached
path before choosing a repair. A production edit still needs an accepted RED
at every required receiving boundary, repaired GREEN, and a relevant hostile
mutant rejected at the promised checkpoint.

All sixteen actual-row `N + 2P` transfer gates, original first-transfer
six-versus-five witness, old work/run budgets, and guard eight remain
unchanged and separately open. Capacity four supplies no transfer credit.
Internal applied-base reader selection, metadata/origin provenance, candidate
ordinal/discovery, certification/reverse phases, cross-epoch accounting,
historical containment uncertainties, and algorithm/class closure remain
outside this plan. No finding from A11 becomes an accepted public-reader defect
through this validation work.

## Source locations for preparation

Paths are relative to the ordered worktree recorded in the source manifest.

| File | Existing role to preserve or future change to review |
| --- | --- |
| `packages/db/tests/query/ordered-work-oracle.property.test.ts` | Current common judgment, Core driver, finite controls, five 80-history properties. |
| `packages/db/tests/query/ordered-window-priority-oracle.ts` | Proposed shared owner; absent at plan time. |
| `packages/query-db-collection/tests/ordered-base-receiving-support.ts` | Existing real Query key/acquisition wrapper pattern; no new held receiver yet. |
| `packages/db/tests/query/ordered-base-receiving-oracle.ts` | Existing real commit receipt observer; provenance must be adapted, not presumed. |
| `packages/query-db-collection/tests/refetch-ordered-prefix-oracle.test.ts` | Actual backend request evaluator, key/context and acquisition recording patterns; independent neighboring owner. |
| `packages/query-db-collection/tests/optimistic-ordered-refetch-oracle.test.ts` | Ordinary real Query 24-cell neighboring contract. |
| `packages/db/tests/oracle-config.ts`, `packages/db/tests/oracle-replay-manifest.ts` | Existing keys/budgets/replay route; add reviewed receiving registrations only. |
| `docs/contributing/oracle-coverage.md` | Keep unexecuted timing/receipt/Query/guard cells and their owners explicit. |
| `packages/db/src/query/live/ARCHITECTURE.md`, `packages/query-db-collection/src/query.ts` | Read-only authority and actual function-key base/prefix boundary. |
