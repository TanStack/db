# Process layer — source, preservation, and loss audit

## Frozen source and extraction target

The source snapshot is Git `d3d617273318573df9e15287d704dc1853a67337`.
The extraction target is the on-demand persisted cache **authority handoff**
across two sync runs, claim loss, source results, and one demanded subset.
Source pointers: `docs/contributing/glossary.md` (sync run, provider session,
cache generation, claim, demand, publication, and applied receipt);
`docs/contributing/oracle-reviews/issue-2056-cache-eviction-design.md`;
`docs/contributing/oracle-reviews/issue-2069-review-51563046.md`;
`packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts:1693-1800`;
`packages/db-sqlite-persistence-core/src/persisted.ts:2097-2260`;
`packages/query-db-collection/src/query.ts:3157-3204`; and
`packages/electric-db-collection/src/electric.ts:2799-2840`.

The checked TLA+ file has SHA-256
`a9c37c37e3622a3cb29ddfd4fccf30c96e0ac0c535569924cb14241d0ed349ed`.
The run is exploratory. This preservation preview is **provisional**, not a
user-confirmed exact-equivalence list:

| ID  | Property to preserve                                                                                     | Basis                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P1  | One current persisted cache generation accepts new claims; live old claims may continue.                 | Source-stated.                                                                          |
| P2  | Claim expiry revokes durable admission without globally revoking a warm peer.                            | Source-stated.                                                                          |
| P3  | A private expired recovery cannot advance the head, even when its remembered storage ID equals the head. | Source-stated in SQLite and design.                                                     |
| P4  | An invalidation event stops old-result admission before awaited recovery work.                           | Source-stated; the event/start split is analyst modeling.                               |
| P5  | A result from an obsolete provider session cannot publish or write under the replacement claim.          | Source-stated.                                                                          |
| P6  | Active demand may outlive a physical fetch; successful settlement needs applicable evidence.             | Source-stated.                                                                          |
| P7  | An awaited cache read must be revalidated before use.                                                    | Source-stated.                                                                          |
| P8  | Partial subset evidence cannot certify a whole persisted cache generation.                               | Source-stated.                                                                          |
| P9  | Provider restart failure settles a pending caller with error; abort retires that caller's ownership.     | Source-stated.                                                                          |
| P10 | Accepted and visible sync transactions are distinct; applied receipts govern subset success.             | Source-stated, but excluded from this TLA projection and explicitly retained as a loss. |

## Observation, inference, and reconstruction

Observed source parts are a current head, per-run claim, per-run provider
session, run-local resume evidence, pending source snapshots, cached reads,
logical subset owners, public rows, durable rows, and caller settlement. The
source also has transaction acceptance/visibility, physical collection, index
declarations, and coordinator routes; those are **observed but excluded** from
this model. Analyst-inferred modeling units are event numbers, two reusable
fetch slots, one row/subset, and violation flags at the observation cut. They
are not proposed product state.

Reconstruction checks used the grammar to reach: warm reuse; A's private
expiry beside B's live claim; live incompatible evidence advancing the head;
a read held through expiry; a fetch held through rotation; two distinct loss
events with a middle-session response; failure and abort settlement. The
`cover-middle-session.cfg` counterexample is the explicit reachability receipt
for the last history. The model cannot reconstruct optimistic receipt holding,
physical collection, or index DDL; those losses are not called pass results.

## Ablation and compression

| Unit or relation removed/weakened             | Consequence                                                   | Control                                                                          |
| --------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Head distinct from run claim                  | Private recovery clears a warm peer.                          | `fault-global-clear.cfg`                                                         |
| Claim validity at awaited read completion     | Expired read publishes.                                       | `fault-late-read.cfg`                                                            |
| Claim validity at head rotation               | Expired run moves shared head.                                | `fault-expired-head.cfg`                                                         |
| Immediate loss-event admission fence          | Old response publishes before restart begins.                 | `fault-invalidation-gap.cfg`                                                     |
| Captured source-result authority              | Old response enters new public and durable state.             | `fault-late-fetch.cfg`                                                           |
| Demand evidence at success                    | Stale post-rotation cached result settles.                    | `fault-reuse-cache.cfg`                                                          |
| Failure settlement                            | Caller remains pending after restart failure.                 | `fault-pending-restart.cfg`                                                      |
| Whole-generation evidence distinction         | One subset write certifies all cached rows.                   | `fault-partial-certification.cfg`                                                |
| Distinct event and enduring uncertified state | A phantom second recovery makes overlap coverage false green. | v1-to-v2 model correction; v3 reachability control requires two `Expire` events. |
| `finishedSeq` bookkeeping candidate           | No action, legal transformation, or assertion changed.        | Removed from v3; final state counts remained unchanged.                          |

The initial model v1 conflated the durable `resume = FALSE` state with a new
recovery event. v2 added `lossSeq`, `lossKind`, and `startedSeq`. v2 then failed
P3 when evidence and expiry overlapped; v3 checks `live` at `FinishRecovery`.
Both corrections preceded the final safe and mutant runs. No rule was silently
weakened to make a failing safety configuration green.

## Range, exclusion, and remaining loss

Dynamics are loss events, recovery starts/finishes, cache reads, source fetch
delivery, request settlement, and abort. Constraints are P1–P9. Boundary
conditions are two runs, one subset, two fetch slots, up to one loss per run
in `safe.cfg`, and up to two loss events for A in `safe-overlap.cfg`. The
model's terminal states are legal because the bounded event/generation budget
can be exhausted. No progress fairness is asserted.

An eager Collection is the near negative: it has no managed cache claim and
uses a different replacement contract. The grammar does not generate it.
No independently supplied marginal case was evaluated, so **range is
untested**. The three generated adjacent forms and their separate costs are
in [model.md](model.md); they are variations of the source arrangement, not
evidence of transfer to another system.

Material decomposition loss remains: `DeliverFetch` combines provider
delivery, SQLite write, applied receipt, publication, and demand success.
Thus P10 has no TLC invariant here. In particular it cannot represent a row
already public when claim expiry makes a later SQLite write fail; the approved
durability contract permits fail-stop at that cut. The one-subset abstraction cannot express
overlapping predicates, row provenance, deletion, or positive subset
certification. There is no physical table collection, claim-renewal timer,
native multi-tab route, QueryClient shared-cache semantics, index DDL,
installed Electric SDK cursor, new-run claim registration, or unbounded progress.
A safe TLC result is
limited to the stated state graph and model-to-source mapping.

## Projection support map

| Primary brief claim                                    | Support                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| False overlap coverage from conflated trigger/state    | M4, v1-to-v2 correction, final middle-session reachability receipt.                                                            |
| Expired-head model error and production distinction    | P3, R3, `fault-expired-head.cfg`, `challenge-expired-head.cfg`, SQLite rotation source.                                        |
| Immediate admission boundary                           | P4, R2, `fault-invalidation-gap.cfg`.                                                                                          |
| Safe bounded checks and hostile calibration            | [evidence.md](evidence.md) run table, exact TLA source hash above.                                                             |
| No new confirmed production bug and receiving boundary | SQLite code, the later mixed-event receiving witness, and its remaining controlled-source limit in [evidence.md](evidence.md). |
| Limits and negative case                               | P10 and range/loss paragraph above.                                                                                            |
