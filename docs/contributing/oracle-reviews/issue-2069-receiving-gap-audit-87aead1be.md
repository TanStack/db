# Cache-rotation receiving-gap audit

Reviewed code commit: `87aead1be5730481152a10849008287755c0ff16`.
This commit adds oracle histories and a Browser receiving path; it changes no
production code. The accepted cache-claim and subset-demand laws come from the
[glossary](../glossary.md), the [Electric on-demand recovery contract](../../collections/electric-collection.md), and the Query Collection's
[shared-cache contract](../../collections/query-collection.md). The fixtures
judge those laws at named boundaries. They do not establish every cache-eviction
interleaving or turn an unsupported direct-adapter call into a product promise.

## Histories and observations

The Browser coordinator owner accepts one remote subset acquisition, then drops
its old leader's release response **after** the owner unloads. Leadership
transfers while the caller's actual RPC timer remains pending. After the timer
expires, production retries and the public release settles. At that checkpoint
the old owner has unloaded once, the new owner has loaded and unloaded zero
times, and no outbound acquisition remains. The model is one exact acquisition
lease with one release obligation; a response lost in transport cannot revive
the retired demand. Web Locks and BroadcastChannel are deterministic seams,
so this is a coordinator result rather than proof of native scheduling.

The Query owner gives two on-demand Collections one QueryClient with distinct
exact keys and overlapping prefixes. The first claim starts at 1000 and expires
at 11000. The second starts at 5000 and remains live at the 11001 checkpoint.
A disjoint demand makes the first Collection rotate and fetch fresh rows. The
independent two-claim rule predicts no change to the warm Collection. The driver
uses real QueryClient and Node SQLite, then compares the first public rows and
the second public row, Query cache entry, durable row, current storage ID, and
fetch count. This history does not redefine the documented effect of explicit
cleanup on another consumer of the *same exact* Query key.

The Browser OPFS owner reuses its native two-context notice history with an
installed Electric SDK in the expired tab. Controlled HTTP supplies one initial
up-to-date message, the old subset row, a held old subset request, and a fresh
subset response held after private rotation. The warm tab's deterministic
source commits a durable peer row; the real coordinator emits and native
BroadcastChannel delivers the physical-ID notice. At the held notice cut, the
expired claim has passed its half-open expiry and the warm claim remains live.
Before delivery, no refetch starts. After delivery but before the fresh response,
the explicit demand remains pending, the expired public and private durable
cache are empty, and the warm peer retains its public and durable rows under
the unchanged head. After the response, the demand fulfills and only the fresh
row appears in the expired public and durable cache. This receives the installed
SDK and native host premises together, with controlled HTTP rather than a live
Electric service.

## Checker calibration

These temporary mutants were restored after each run. Every killed mutant
reached the stated assertion, not setup failure:

| Wrong design | Result |
| --- | --- |
| Release does not set `releaseRequested` before old-leader timeout | The new owner unexpectedly loaded the retired demand. |
| Rotation removes every Query entry matching its base prefix | The warm Collection's distinct Query cache entry was absent. |
| The held native notice callback is dropped | The Electric/OPFS history failed at the refetch-entry poll. |

A first Browser fixture mutant changed the *ordinary* callback path while the
history held and later invoked a different callback. It survived. That outcome
was an unreached-path calibration result, not evidence that the notice was
unnecessary. Mutating the held callback itself produced the failure above.

## ORC-001–014 review

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Applicable. The three existing contracts above authorize the expected results. Each owner states its bounded path. Claimless direct-adapter access and live Electric service delivery remain open. |
| ORC-002 independent judgment | Applicable. One lease's release, two independently timed claims, and source-row replacement predict the results without importing the production retry, Query ownership, or cache-rotation classifiers. |
| ORC-003 literate responsibilities | Applicable. Each edited owner explains law, small independent rule, legal history, production path, observation, and checkpoint beside the test. The Browser fixture names its controlled provider. |
| ORC-004 grammar controls | Not triggered. All three additions are fixed receiving histories; no generated grammar changed. |
| ORC-005 production path and observation | Applicable. The coordinator executes its real RPC timer; Query uses real QueryClient and SQLite; Playwright runs two Chromium contexts over native OPFS and BroadcastChannel with the installed SDK. Call counts, public rows, cache entries, durable rows, and demand settlement are compared at the named cuts. |
| ORC-006 checker calibration | Applicable. The table records three assertion failures and the separate unreached-path survivor. |
| ORC-007 fixed/random/replay | Not triggered. No important generated property was introduced or changed. Existing generated owners remain separate. |
| ORC-008 stateful-model minimality | Not triggered. The fixed histories use existing lease and cache-claim concepts; no reference-model state was introduced or collapsed. |
| ORC-009 vocabulary mapping | Applicable. Persisted cache claim and generation, acquisition lease, demand, sync run, provider session, applied receipt, and public snapshot follow the glossary. The controlled HTTP response is provider input, not publication. |
| ORC-010 failure fidelity and cleanup | Applicable. The OPFS receiving test retains a primary mismatch separately from page cleanup failures. The existing coordinator and Query owners release their test resources in teardown. No shrinking or failure serialization was added. |
| ORC-011 independent second formulation | Applicable. Native OPFS and installed SDK receive premises previously supplied separately by controlled coordinator and Node SQLite tests. The controlled HTTP service is still a narrower formulation than a live Electric service. |
| ORC-012 review evidence | Applicable. This record is tied to the reviewed code commit and lists every requirement, mutant outcome, and remaining boundary. It makes no universal bug-class closure claim. |
| ORC-013 distinguishing boundary witness | Applicable. The Query history puts one claim past expiry and one later claim before expiry at the same clock cut; the broad-eviction mutant fails. Existing SQLite expiry grammar owns exact-at-expiry calibration. The coordinator history reaches actual RPC timeout and rejects demand replay. |
| ORC-014 controlled-premise handoff | Applicable. The Browser receiver gets a physical-ID notice from real native delivery and an installed SDK source snapshot. The remaining live-service and arbitrary-schedule handoffs are explicit below. |

The Browser coordinator oracle passed all 166 tests, and the Query ownership
oracle passed all 173 tests. Both OPFS receiving variants passed. Both affected
packages typechecked. Changed-file ESLint had no errors (19 pre-existing
warnings); Prettier and `git diff --check` passed. The branch's pre-commit
hook had previously tried a private-registry install and received 403, so the
verified code commit bypassed that hook.

The [coverage map](../oracle-coverage.md) retains the remaining cuts: arbitrary
native notice schedules, a live Electric service in this same two-tab history,
custom Query provider restarts and arbitrary retention schedules, and direct
claimless access after a collected physical ID loses its catalog identity.
The latter has a scratch reproduction of orphan registry and row recreation;
rejecting that path while allowing arbitrary eager Collection IDs needs a
durable identity distinction and therefore a separate design decision.
