# Query DB source reuse: exploratory design grammar

## What this tells us

One requested subset is not always one physical Query. A filter can first share
an applied full-source Query, then acquire its own Query when a full refresh is
failed. An explicit filtered refetch also uses its exact Query while a full
refresh is pending. Both acquisitions can be active at once. Their release
obligations therefore follow the Query each acquisition chose, even though
their predicates have the same hash. The same distinction explains why a
provider's cancellation signal must follow the physical Query: one Collection
acquisition can leave while another still observes that Query.

## What it changes

- The reuse decision is made for each new acquisition from the current full
  result's applied, successful, idle state. An existing acquisition keeps its
  chosen Query when that state changes.
- Release uses the accepted acquisition's lease. A predicate hash identifies a
  demand, but cannot identify its physical Query after a route split.
- Query Core's signal remains lazy. Consuming it lets final observer removal
  abort the fetch; ignoring it permits the provider to finish into cache.
- Persisted subset owners require revalidation when that subset next acquires,
  including a crash snapshot with no retention marker.

## What it does not tell us

The bounded model below checks lease and full-Query signal rules for three
acquisitions. It does not model result application, row values, persistence,
direct writes, arbitrary predicates, or unrelated same-key Query Core callers.
The oracle tests cover named examples of those other boundaries. No independent
range case was supplied, so range transfer is untested. At subset settlement,
either an authoritative full result or an exact subset response may reconcile
a retained owner; the grammar does not choose one mechanism.

## Concrete case

A full view and an older filtered view share the full Query. Its refresh
fails, so a new equal filtered view gets an exact Query. Releasing the new
view first must remove rows owned only by that exact Query while preserving
the older view. Releasing the older view first must preserve the new view.

## Model layer

The extraction target is **Query DB on-demand acquisition routing, ownership,
and cancellation under static-key full-source reuse**. This is an exploratory
run: the preservation list below is provisional rather than a user-confirmed
exact-equivalence claim. The user's decision limits Query ownership to Query DB
Collections; the [Query Collection guide](../../collections/query-collection.md)
and [sync-adapter contract](../../guides/collection-options-creator.md)
authorize the remaining observable rules.

| ID | Candidate unit or overlap | Role and source |
| --- | --- | --- |
| G1 | Requested demand and accepted acquisition lease | A logical need may have a physical lease; adapter release must match the accepted acquisition. Sync-adapter contract and `packages/db/src/collection/subscription.ts`. |
| G2 | Full and exact physical Queries | A current applied full result may serve a narrower demand. During a pending refresh, a new demand may wait for that result or use an exact Query; after a failed refresh, it needs a new response. Query Collection guide and `load-subset-lifecycle-oracle.test.ts`. |
| G3 | Observer ownership and physical signal | Any Query DB owner keeps the Query observed. The provider receives its lazy Query signal. Query Collection guide and `query.ts`. |
| G4 | Row owner and retained subset | Rows may have multiple Query owners; a retained subset may have durable owners without a retention marker. Query Collection guide and `ownership-lifecycle.oracle.test.ts`. |
| G5 | Source-order position | Overlapping fetched values use query-function invocation order; direct writes use acceptance order. Query Collection guide and ownership oracle. |
| O1 | Many demands, one Query | A full view and older filtered view share one observer path and physical signal. |
| O2 | One demand hash, multiple Queries | A later equal filter may use an exact Query while the older filter keeps the full Query. This active overlap forbids hash-only release. |
| O3 | Many Queries, one row | Releasing one owner must preserve a row while another still owns it; source order governs its value. |

### Provisional preservation properties

| ID | Property | Basis |
| --- | --- | --- |
| P1 | Only an active, current, applied, successful, idle full result can serve a new narrower demand. | Guide plus established applied-settlement law |
| P2 | A previously accepted acquisition keeps its physical Query when P1 later changes. | Sync-adapter lease law |
| P3 | Equal predicate hashes may overlap on full and exact Queries; each release retires only its own lease. | P2 plus failed-refresh witness |
| P4 | A row remains public while an accepted owner needs it; an omitted retained row is gone by its next subset acquisition settlement. | Guide and ownership law |
| P5 | A consumed physical Query signal aborts after final observer release; an ignored signal may let work finish. | Published Query Core behavior and guide |
| P6 | Fetched value precedence follows query-function invocation, including reentrant cache callbacks. | User decision and guide |
| P7 | Unrelated same-key `fetchQuery()` callers do not acquire Query DB ownership. | User scope decision |

The permitted transformations are: acquire from the eligible full Query or an
exact Query, or wait for pending full coverage; make full coverage ineligible
during a fetch or after failure;
apply a result; release one acquisition's recorded lease; consume or ignore
the physical signal; and reconcile a retained subset by a sound full or exact
response. A release may be repeated without affecting another lease.

### Reconstruction and ablation

The units reconstruct the source history: acquire full, acquire old filter on
full, start a full refresh, acquire equal new filter on exact, apply rows,
release either filter first, then release the other. G1 and G2 are both needed:
removing G1 makes O2's releases indistinguishable; removing G2 cannot express
the route split. Removing G3 loses the shared-versus-final cancellation
distinction. Removing G4 loses the markerless durable-owner case. Removing G5
cannot distinguish fetch-call order from reentrant provider invocation. O1,
O2, and O3 each change a public row or abort checkpoint when ablated.

The `fullSourceDependents` counter and retry-on-aborted-acquisition machinery
are implementation choices, not grammar units. The latter can be removed when
the provider receives the physical Query signal. The nearby excluded form is
an unrelated direct `queryClient.fetchQuery()` joining the same key: P7 does
not grant it a Query DB lease. This is an exclusion, not evidence about that
caller's cancellation policy.

## Evidence layer

The executable [TLA+ model](query-db-published-core-tla/QueryDbLeases.tla)
projects G1–G3 and O1–O2. `logical` records which of the full, old, and new
acquisitions remain active; `lease` records their chosen physical Query.
`eligible` represents P1's current coverage without modeling its internal
application proof. `fullSignalRead` distinguishes consumed from ignored
signals. The model intentionally omits G4–G5, which the production oracles
exercise at their own checkpoints.

TLC 2.19 checked all **148 distinct reachable states** in the bounded safe
configuration with no invariant violation. The deliberately wrong
[hash-only release](query-db-published-core-tla/wrong-hash-release.cfg)
violated `LeaseAgreement` after old and new equal filters chose full and exact
Queries, then the new filter released first. The deliberately wrong
[per-acquisition abort](query-db-published-core-tla/wrong-acquisition-abort.cfg)
violated `NoEarlyFullAbort` when the full owner released while the older filter
still observed the full Query. Both were assertion counterexamples at depth 5,
not timeouts or setup errors. Terminal states were allowed with TLC's
`-deadlock` switch; no liveness property or fairness claim was made.

The real Query DB oracle reproduced the mixed-lease error on the prior
implementation at the public `a2` row checkpoint. With the repair, failed
full refreshes pass both release orders. A pending-refresh witness permits
an exact response or a later applied full response. An explicit exact refetch
during a pending full refresh checks fetched row precedence in both release
orders. A separate real-storage
restart witness fails when the markerless-owner reuse guard is removed.

## Process layer

The source and preservation preview were frozen provisionally from the user's
ownership decision, the public guide, the sync-adapter contract, and the two
primary Query DB oracle owners. Source facts are G1's supplied-options release
path, G2's full-source reuse gate, G3's Query Core observer signal behavior,
G4's persisted owner metadata, and G5's reentrant provider-start witness.
The model's `eligible` combines success, idle status, current cache membership,
and applied result evidence; it is a declared abstraction rather than a
production state name. The `old` and `new` owners split one equal requested
scope by acquisition time.

The first TLC attempt reported a terminal deadlock, so the run explicitly
allows terminal states. A subsequent safe run exposed ambiguous quantifier
grouping in the model's signal transition; replacing it with the explicit
`nextFullObserved` local corrected the encoding. The final safe and two
weakened configurations were rerun after that correction. The pinned TLA+
tool JAR (`v1.7.4`, SHA-256
`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`)
ran with a portable Adoptium 21 JRE because the Docker daemon was unavailable.
The checked commands were `tlc2.TLC -deadlock -config safe.cfg QueryDbLeases`
and the same command with each weakened configuration. Model source and all
three configurations are retained in the linked directory.

Range remains untested because no independently sourced marginal case was
supplied. The adjacent forms generated by the grammar are: both filters on
full while P1 holds; the mixed route after a failed refresh; the mixed route
during a pending refresh when the new demand explicitly refetches; a pending
demand waiting for applied full coverage; and a markerless persisted subset
after restart.
These forms exercise different rules but are not independent range evidence.
The public brief's claims map to P1–P7 and the reconstruction above; the
specific lease and cancellation claims additionally map to the two TLC
counterexamples. Model checking establishes consequences of this abstraction,
not correspondence with every production schedule.
