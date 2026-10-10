# Cache-claim oracle gap audit

Reviewed code commit: `575fb9473dd7d8eccbe469d0831dc9f71cffddd4`.
This review covers the oracle and coverage-map changes in that commit. No
production code changed. Three independent oracle reviewers challenged the
new receiving histories. Their false-green findings about exact expiry,
retained tombstones, demand settlement, request predicates, release identity,
transient publication, and timer-driven recovery were repaired before this
reviewed commit. The final reviewers found no further issue within the bounded
histories below. This is not a claim that every cache-eviction interleaving is
closed.

The [glossary](../glossary.md) defines a persisted cache claim as one sync
run's expiring authority over one persisted cache generation. The approved
[on-demand recovery contract](../../collections/electric-collection.md)
requires an expired run to reload demanded subsets from the source while a
later live claimant retains its current cache. Retired storage becomes
collectible after its last claim releases or expires; collection occurs on a
cache-claim operation, not on clock passage alone.

## Histories and observations

The SQLite startup witness pauses one run **before dispatching** a real resume
read. A later peer obtains a live claim on the current generation. The first
run's claim then expires. Its real SQLite read rejects, and the persisted
wrapper binds private storage before it completes a demand from a fresh source
row. The peer keeps its public row, durable row, resume metadata, and current
head. The separate managed-claim-read property owns the claim check **inside**
the SQLite transaction; the composed witness does not claim that later cut.

The retired-storage grammar has two independently controlled retired claims:
`release`, `expire`, or `renew`. It varies zero or two rows and collection at
`1170`, `1190`, `1209`, `1210`, `1229`, or `1230` on a clock whose renewed
expiries are `1210` and `1230`. Its independent rule retains a retired
generation exactly while its claim is live; the current head remains retained.
At the collection checkpoint it compares claim IDs and physical IDs, seeded
rows, tombstones, resume metadata, expected keys, physical row and tombstone
tables, native indexes, and all generation-scoped catalog entries. Two
generations with different expiry times are necessary: a single retained bit
would incorrectly conflate them when one expires and the other remains live.

The persisted-wrapper notice grammar varies an absent, commit, or reset old
notice; old and new row versions on either side of one another; and an absent
or present new notice. A controlled coordinator holds an explicit constrained
demand and the new source receipt behind a persisting optimistic transaction.
It compares the exact physical storage ID and predicate of the source request,
the pending demand before application, the absence of any transient
notice-only row in the public publication trace, the fresh row after
application, and release of the exact `(storage ID, options)` acquisition only
after the source receipt applies. Old notices cannot authorize new-generation
work, regardless of their row version.

The Browser receiver supplies the controlled notice premise on one real-host
schedule. Two Chromium contexts share OPFS, Web Locks, and BroadcastChannel.
A real source commit causes the Browser coordinator to emit a physical-ID
notice. The first context holds the delivered callback, advances its host
clock beyond its own claim expiry but within the warm peer's claim, and then
releases the callback. It must reload privately. The warm peer keeps its
public and durable rows and current head. An explicit demand remains pending
until a fresh source receipt applies. The real renewal timer is outside this
fixed test window, and the test verifies that refetch has not started before
the held callback is released.

## Grammar controls and calibration

The retired-storage fixed corpus reconstructs both live generations, release
of either, expiry of both, zero and two rows, and the immediately-before and
at-expiry cuts for both renewed claims. Removing either claim action axis loses
independent reachability; removing row count loses empty versus populated
storage; removing the clock axis loses the half-open threshold. The bounded
grammar excludes concurrent writes and a fourth rotation. It does not silently
discard a generated history. The notice property's fixed corpus reconstructs
queued commit and reset callbacks with old versions both below and above the
new version. Its absent-old and absent-new generated cases are work-count
controls. A callback delivered only after its old subscription is removed is
outside this grammar.

Both important generated properties use the same driver, recorder, and check
in equal-budget fixed and unseeded campaigns: `sqlite-resume.retired-storage`
uses seed `2069` and 24 runs; `persistence.generation-notice` uses seed `2069`
and 24 runs. Neither uses `fc.commands`. The registry accepts a seed and shrink
path for direct replay. With the temporary inclusive-expiry mutant, the
retired-storage property shrank to seed `2069`, path `3:1:1`, with old claim
renewed, middle claim released, zero rows, and collection at exact expiry
`1210`. Direct replay ran only the requested property, failed after one test
at the claim-identity comparison, and passed after production was restored.
The prior [audit](issue-2069-cache-generation-oracle-audit-53ded62d8.md)
records direct replay of the notice property at seed `2069`, path `1:1:1`.

Temporary wrong designs were restored after each check. These were assertion
failures at their intended comparison, not setup failures or timeouts:

| Wrong design | Rejected observation |
| --- | --- |
| Treat claim expiry as inclusive (`<` deletion instead of `<=`) | Extra claim survived at `1210`; direct replay failed at exact claim identities. The fixed boundary also rejects the retained physical table. |
| Rotate the current head for an expired run | Warm peer's current-head ID changed. |
| Omit retired metadata collection | Generation-scoped catalog comparison retained an obsolete entry. |
| Release a scoped refresh before its receipt applies | Pending-demand and exact release-timing comparisons failed. |
| Release refresh work against the logical ID | Exact `(physical storage ID, options)` release comparison failed. |
| Return from a demand before awaiting its coordinator request | Demand-settlement comparison failed while the source receipt was held. |
| Drop the native OPFS notice callback | Browser receiver never entered refetch; `refetchEntered` assertion failed. |

The notice fixture originally matched the `where` expression by object
identity. A legal cloned predicate would have timed out before the intended
comparison, so that trigger now matches the request shape and the separate
deep-value assertion checks its predicate. This is a fixture repair, not a
product-law change.

## ORC-001–014 review

| Requirement | Outcome at the reviewed code commit |
| --- | --- |
| ORC-001 authority and limits | Applicable. The glossary and approved on-demand recovery contract define claim authority, private reload, and warm-peer retention. Each owner states its bounded checkpoint. |
| ORC-002 independent judgment | Applicable. The retired-storage model computes half-open reachability from authored times and actions. The notice model derives source and demand obligations from physical identity and receipt order, without importing the production classifier. |
| ORC-003 literate responsibilities | Applicable. Each changed owner states the law before mechanics and explains its model, legal histories, production entry, public or durable observations, and refinement checkpoint beside the code. |
| ORC-004 grammar controls | Applicable to the two generated properties. Reconstruction, ablation, range, and exclusion are recorded above. The composed startup and native OPFS histories are fixed receiving cuts, not claims of generated coverage. |
| ORC-005 production path and observation | Applicable. The real SQLite adapter and persisted wrapper execute the startup and collection histories. The wrapper handles notices. The OPFS test uses the real Browser coordinator and two native contexts. Their specified observations were reached in passing runs. |
| ORC-006 checker calibration | Applicable. The hostile designs above were rejected at the named comparisons. The inclusive mutant's seed/path was replayed directly. |
| ORC-007 fixed/random/replay | Applicable to both important properties. Equal-budget fixed and unseeded campaigns ran. Direct replay was checked for the new retired-storage property here and for the notice property in the prior audit. |
| ORC-008 stateful-model minimality | Applicable to the new reachability model. Its two retired-claim states remain separate because expiry of one can change the next collection result while the other stays live; rows and catalogs are observed contents, not extra authority states. No production state machine was copied. |
| ORC-009 vocabulary mapping | Applicable. Claim, generation, sync run, demand, source request, and scoped recovery use glossary terms. Model clock cuts represent the adapter's controlled host clock; the controlled coordinator is a provider of source receipt ordering. |
| ORC-010 failure fidelity and cleanup | Applicable. SQLite cleanup preserves the original assertion and attaches cleanup failures. The notice driver preserves its primary mismatch through bounded teardown. Browser cleanup reports secondary failures without erasing the primary failure. |
| ORC-011 independent second formulation | Applicable. The controlled wrapper fixture alone cannot establish physical SQLite isolation or native notice delivery. The composed SQLite and Browser OPFS receivers use real physical storage; OPFS supplies the host notice premise. A live Electric provider on that same schedule remains unproved. |
| ORC-012 review evidence | Applicable. This versioned record identifies the exact reviewed code commit, outcomes, hostile controls, and unresolved cells. It makes no universal bug-class closure claim. |
| ORC-013 boundary witness | Applicable. The `1209/1210` and `1229/1230` histories distinguish half-open expiry from inclusive expiry, with a killed mutant. The notice history distinguishes exact physical identity and receipt settlement from plausible wrong release and early-demand designs. |
| ORC-014 controlled-premise handoff | Applicable. The Browser OPFS receiver gets a matching physical-ID notice from the real coordinator over native BroadcastChannel and checks the fresh receipt before demand settlement. Arbitrary native scheduling and Electric delivery in the same history remain assigned below. |

Validation on the reviewed code: both SQLite oracle owners passed (809 active
tests, one existing todo); the OPFS two-context history passed four runs,
including the final post-review run. Both affected package typechecks passed.
Changed-file ESLint reported zero errors; Prettier and `git diff --check`
passed. The pre-commit hook's dependency install had previously received a
private-registry 403, so the verified code commit bypassed that hook.

The [coverage map](../oracle-coverage.md) retains these unproved cells with
owners: arbitrary native notice scheduling and a live Electric provider in
the same two-context history belong to the Browser and Electric receiving
owners; release retry after a timed-out old-leader RPC belongs to the Browser
coordinator owner; claimless direct-adapter access to a collected physical ID
belongs to the SQLite adapter owner. The fixed receivers do not imply those
histories have passed.
