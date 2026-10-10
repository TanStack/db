# Exploratory design grammar: on-demand cache authority

Source code was frozen at `d3d617273318573df9e15287d704dc1853a67337`.
This is an **exploratory** extraction. Its preservation list is provisional;
the user did not freeze an exact-equivalence contract for this formal model.
The executable model is [CacheAuthority.tla](CacheAuthority.tla). The separate
[Model](model.md), [Evidence](evidence.md), and [Process](process.md) layers
record the full extraction and controls.

## What this tells us

The decisive distinction is between **loss of authority**, **the event that
reports that loss**, and **a recovery that has started**. The first draft used
“resume unavailable” as both a durable trust state and a fresh recovery trigger.
That let TLC produce a second rotation without a second loss event, so the
apparently covered overlap was false. After separating loss events, TLC found a
second model error: invalid resume evidence followed by claim expiry could let
the expired run advance the shared cache head. The SQLite implementation
checks claim validity inside rotation and makes that recovery private. The
corrected grammar matches that rule.

The final safety model checks two sync runs, one demanded subset, two pending
source requests, and bounded cache generations. The two-run configuration
passed all safety invariants across **338,940 distinct states**. A separate
two-rotation configuration passed **10,653 distinct states** and a reachability
control delivered a callback from the middle provider session after the final
rotation; it was ignored. Eight deliberately weakened rules each produced the
expected invariant counterexample. These are checks of the abstraction, not
proofs about QueryClient, Electric, or SQLite execution.

## What it changes

- A recovery trigger must be counted separately from the cache's continuing
  uncertified state. Otherwise an overlap test can cover a phantom rotation.
- Admission closes at the wrapper's recovery entry, before an awaited provider
  restart or SQLite rotation. A weakened model admitted an old response in
  that gap and published it. The model does not prove how quickly an upstream
  provider signal reaches this entry.
- Head rotation must use the claim's validity **at the storage transaction**.
  Evidence seen earlier cannot let an expired run retire a warm peer's head.
- The receiving-oracle candidate became a composed wrapper and real-SQLite
  history with recovery entry, expiry before rotation, a warm peer, and a new
  claimant of the unchanged head. A wrong transaction-time claim rule fails
  there. The controlled source supplies recovery entry; Electric's own
  invalid-resume classification at this ordering remains separate.

## What it does not tell us

No new production bug was confirmed. The model makes source delivery, durable
write, public application, and demand success one atomic action. It therefore
cannot check the accepted-versus-visible receipt boundary beneath a persisting
optimistic transaction or the documented fail-stop case where a source row is
public before an expired claim makes SQLite reject its write. It also omits
physical garbage collection, indexes,
multiple overlapping subset predicates, shared QueryClients, and real SDK
cursor behavior or new-run claim routing. The separate
[receipt-settlement grammar](../cache-receipt-tla/README.md) checks a narrow
projection of the receipt distinction. This model checks safety, not eventual progress: without provider
response or scheduling assumptions, a pending demand may remain pending. One
partial subset fetch is deliberately forbidden from certifying the entire
cache; the model does not design positive subset certification or offline reuse.
Those boundaries remain with the named production oracles in the coverage map.

The neighboring valid forms are a private expiry rotation beside a warm peer,
a live head owner's incompatible-resume rotation, and two distinct recovery
events with a late middle-session response. An eager Collection is the nearby
negative case: it does not use managed on-demand cache claims, so this grammar
must not be read as its recovery law. No independent marginal system was
supplied for a range check; range transfer remains untested.
