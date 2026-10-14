# Query source reuse oracle review — 2026-10-13

The reviewed code head is `b9f7afaba36a3e30dfc29cdc7cf966fcb6247aff`,
following the first repair at `52c8c04b4102fd9aae091e896acc3ba3de92b3d3`.
This record covers the bounded full-source reuse, retained-subset, and shared
signal additions in the Query DB lifecycle and ownership oracles. The record's
follow-up commit updates review evidence and coverage limits without changing
the reviewed code.

## Law, path, and checkpoints

The [Query Collection guide](../../collections/query-collection.md) and the
Collection [sync-adapter contract](../../guides/collection-options-creator.md)
authorize the laws. An applied complete full-source Query may serve a narrower
on-demand demand while its Query remains owned. Query Core success before
Collection application, an incomplete source, a failed source, or a retained
subset awaiting revalidation cannot establish that narrower demand. A row
remains public and durable while any committed Query owner needs it. Releasing
one acquisition aborts its signal, while another observer may keep the same
physical Query and provider transport alive. A provider that ignores the Query
signal can finish into Query cache after final observer release.

The [load lifecycle oracle](https://github.com/TanStack/db/blob/b9f7afaba36a3e30dfc29cdc7cf966fcb6247aff/packages/query-db-collection/tests/load-subset-lifecycle-oracle.test.ts)
drives real QueryClient observers and Collection acquisitions. It checks
provider scope and call counts, public rows, acquisition settlement, error
state, and cached rows at named application, invalidation, release, and
held-fetch checkpoints. The
[ownership oracle](https://github.com/TanStack/db/blob/b9f7afaba36a3e30dfc29cdc7cf966fcb6247aff/packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts)
uses controlled persisted storage and compares public rows, durable rows,
retention markers, and row owners when a retained subset reacquires. These
expected results come from complete source rows and ownership leases. They do
not copy the adapter's reuse gate, Query Core option selection, or retention
classifier.

## Distinguishing evidence

- The original #2135 code fetched a new filtered Query despite an applied,
  active full result. The settled-full witness failed at the provider-call
  checkpoint before the first repair and passed afterward. Initial and
  replacement full-result histories reject settling a filtered demand before
  Collection application; the replacement cut rejects relying on old applied
  rows while new result application is pending.
- A controlled persisted `until-revalidated` subset remains independently
  marked until its scope is reconciled. Omitted, unchanged, and moved row
  histories check public and durable rows and marker removal at acquisition
  settlement. The omitted case was RED before the first repair. An executed
  hostile deletion of the moved row after its old subset owner retired failed
  both public and durable row comparisons; a retained old owner fails the
  moved-row owner comparison.
- Equal full and filtered peers, full-source dependents, and two Collections
  sharing one Query distinguish logical acquisition signals from physical
  Query ownership. Held initial and refetch histories put an equal filtered
  peer before or after fetch start, then release the creating acquisition.
  Before the second repair, three late-peer cases were RED at the public-row
  checkpoint. Exact, custom, and fresh `AbortError` cancellation now reach the
  peer; a no-peer release starts no replacement call. An initial ordinary
  provider error rejects the pending peer and sets `lastError`; a refetch
  error retains the prior applied snapshot and records `lastError`.
- The recovery-specific ignored-signal history was RED at the Query cache row
  checkpoint when the recovery guard read Query Core's lazy signal. Removing
  that read made it GREEN. Separate full-source and equal-filtered ignored
  signal controls show that final unload can leave a provider result cached.
  The SSR oracle keeps the sole direct request's exact metadata signal.
- Independent in-memory mutants reached their intended comparisons. Retrying
  every provider error failed the unrelated-error public-row check. Retrying
  only the exact signal reason failed both fresh-`AbortError` public-row
  checks. An eager lazy-signal read failed the recovered-cache check. These
  were assertion failures, not setup failures or timeouts. No mutant was
  checked into the repository.

The affected runtime and type suites passed **618 tests in six Vitest test files**
with no type errors. The Query DB package build passed. Changed-file ESLint
had no errors and ten warnings outside the changed lines. The finite matrix
and mutants establish only the named contract, histories, production paths,
and checkpoints; they are not a proof for arbitrary predicates or schedules.
The focused rerun command is `pnpm --filter @tanstack/query-db-collection exec
vitest run --coverage.enabled=false tests/load-subset-lifecycle-oracle.test.ts
tests/ownership-lifecycle.oracle.test.ts tests/ssr-dehydration-oracle.test.ts`.
The documentation link check still reports 32 existing links outside `docs`;
this record adds none of them.

## ORC-001–014 audit

| Requirement | Outcome for these additions |
| --- | --- |
| ORC-001 authority and limits | Pass within the documented on-demand Query and controlled persistence boundary. Complete-source provider behavior remains a premise, not a fact proved for every backend. |
| ORC-002 independent judgment | Pass. Expected rows and owners derive from the authored source and lease graph, not production's reuse or retention branches. |
| ORC-003 literate responsibilities | Pass. Opening and local prose name the law, model rule, legal timing, real production path, observation, and settlement checkpoint. |
| ORC-004 grammar controls | Not triggered. These are fixed, bounded timing and value matrices rather than a generated-history claim. |
| ORC-005 path and observation | Pass. Real QueryClient and Collection paths reach provider, public-row, public-error, cache, and durable-row comparisons at the stated cuts. |
| ORC-006 calibration | Pass for the bounded claims. Original code and the hostile mutants above fail at their intended comparisons. |
| ORC-007 campaign and replay | Not triggered. No important generated property was added or changed. |
| ORC-008 model-state minimality | Not triggered. The reference ownership state was not split, combined, or expanded. |
| ORC-009 vocabulary mapping | Pass. Prose separates logical demand, acquisition signal, observer lease, physical Query, transport, applied settlement, and durable row owner. |
| ORC-010 failure fidelity | Partial. `try/finally` cleanup and caught pending loads release resources, but no injected cleanup fault proves that a cleanup exception cannot replace a primary mismatch. The fixed witnesses do not shrink or capture generated histories. |
| ORC-011 second formulation | No second semantic formulation was required within the controlled boundary. Real provider completeness and abort shape need receiving witnesses under ORC-014. |
| ORC-012 review evidence | This versioned record ties the audit and mutant results to the reviewed code head; open cells are assigned below and in the coverage map. |
| ORC-013 boundary witness | Pass for the bounded laws: pending/applied full result, sole/shared and before/after fetch-start ownership, exact/fresh abort versus ordinary error, and omitted/unchanged/moved retained rows have distinguishing neighbors. |
| ORC-014 controlled handoff | Open. The controlled provider and storage do not prove real network abort shape, complete unfiltered responses, or native SQLite cold retained replay. The coverage map assigns receiving witnesses. |

## Scope that remains open

The adapter cannot distinguish a fresh `AbortError` caused by the creator's
signal from an unrelated fresh `AbortError` delivered after that same abort.
Its one-retry policy favors the surviving peer and can retry the latter once.
A stronger causal guarantee needs provider provenance; the oracle does not
claim one. A synchronous provider throw after reentrant peer acquisition has
no separate witness. The external `queryClient.cancelQueries` pending-load
settlement policy needs a public acquisition/status witness and is not a
confirmed bug from the current signal-state probe. The late-peer matrix
checks the surviving peer's promise; its retired creator's raw internal
`_sync.loadSubset` promise can fulfill after release. The guide's explicit
abort-then-reject rule addresses a request-scoped `commit(signal)` receipt,
and the existing public LiveQuery retirement oracle tests a different timing
cut. A public live-query preload witness for this late-peer cut and an explicit
raw adapter-settlement policy remain open.

The [coverage map](../oracle-coverage.md) owns further witnesses for arbitrary
predicate containment, function-built Query keys, TTL and native SQLite
retention, real network cancellation, cross-Collection Query option selection,
and the policy for an equal demand arriving after failed full revalidation.
The requirement that an unfiltered on-demand provider return the complete
source remains a maintainer contract and versioning decision. Source reuse
may retain and refetch a complete source rather than doing narrow work; this
finite correctness oracle does not establish a memory or request-efficiency
bound.

## Follow-up review of direct-write request scope

CodeRabbit review `5510417620` on head `486eac00a` found that the direct-write
witness at `load-subset-lifecycle-oracle.test.ts:449` filtered its provider-call
record to `full` requests. Its name claimed full-source reuse, while the test
could pass after an exact filtered request. The independent oracle reviewer
ran the real QueryClient path and observed `[full, filtered]`, with the promised
`a1` and `b1` rows public after preload. This is permitted by the Query
Collection guide: a direct cache patch is not a new fetched result for an
unacquired scope. The original settled-full witness, with no intervening direct
write, separately requires `[full]` and establishes reuse at that cut.

The oracle correction at code head
`a16fc95e42811ef25b457c86fab89059813851f5` names the direct-write law and
compares the entire request sequence. Its bounded history permits `[full]` or
`[full, filtered]`: one new filtered demand, a successful provider, and no
retry, invalidation, or explicit refetch need no second request. A hostile
production-path mutant called the filtered provider twice; the corrected test
failed at the request-sequence assertion on `[full, filtered, filtered]`. The
unmodified path passed **98 runtime and type tests** in the load-lifecycle file
with no type errors, and changed-file ESLint passed. No production code changed.
This correction strengthens ORC-003, ORC-005, ORC-006, and ORC-013 for the
direct-write witness. It makes no claim about every later demand or about
reuse after a direct write.

## Retained ownership exception and companion handoff

The guide's initial full-source reuse sentence omitted an accepted exception:
a narrower scope with retained persisted ownership needs revalidation before
its old row and owner can retire. The current adapter makes an exact-scope
request for that case. This follow-up clarifies the guide and changeset; it
does not change #2135 production code or the existing same-version retained
subset oracle. That oracle already crosses omitted, unchanged, and moved rows
after an applied full result and checks public rows, durable owners, and the
retention marker at subset settlement.

Companion #2134 code head `5239c25c2` adds a fixed historical-key handoff
with an active applied full Query. Marker-present and markerless variants both
pass on #2134 and in a scratch merge with #2135 head `d429e0dd8`. In that
merge, removing historical pending revalidation from the reuse gate fails
both variants at the immediate public-row assertion. Discovering old aliases
from markers alone fails only the markerless variant; the marked control
passes. The #2134 versioned review records the independent oracle challenge
and full evidence. The test permits either an exact request or safe
reconciliation from the applied full result, so exact request scope is not an
oracle requirement.

The follow-up law review found that exact request scope was stronger than the
retained-owner obligation. A complete full fetch started after retention and
applied before acquisition can also reconcile a current subset owner; an older
full result cannot. The matrix now permits either post-retention provider scope
and checks public and durable rows, owners, and markers at settlement and
release. A companion history first applies a fresh full result with a row
outside the subset, then acquires the subset and checks that the outside row
keeps only its full Query owner through a later invalidation. Explicit refetch
remains exact. The current adapter still uses an exact request for retained
current-key owners.

Removing the retained-revalidation gate in a scratch production mutant made
all eight stale-full matrix cases fail at the acquisition comparison. The
mutant reused the older full result, left the old detail row public and
durable with its subset owner and marker, and skipped the new provider call.
The unchanged implementation passed the 347-test ownership suite and the
Query DB type check. The new fresh-full history accepts an exact revalidation
after the full result; it does not prove that the current adapter can skip it.
A separate full-payload mutant sent an unfiltered result into an exact Query;
the fresh-full history rejected it at the list-only row's owner comparison.
The matrix allows extra successful provider attempts when their scopes are
valid, because this guide sets no one-transport bound.
An isolated full-route probe retired the old owner after the newly applied
complete full result and let the later subset share that full Query. The
fresh-full history passed; this fixture-specific probe is not a general
production repair.

A held-old-exact timing probe began an exact fetch, retired its owner into
persisted retention, then acquired the same scope while that fetch was still
pending. The acquisition stayed pending through the old response; a later
exact response applied before its owner and marker retired. Two freshness-gate
mutants also passed because this path started the later request for another
reason. This timing remains open in the ownership oracle. The guide states
that both exact and full revalidation require a fetch started after retention.

## Signal and cancellation design attack

The local physical-Query signal prototype passes the shared-owner histories,
but fails a legal sole public `requestSnapshot({ where, signal })` cancellation.
The caller can abort while its acquisition remains owned. The prototype leaves
the metadata signal live and can apply a late provider row. The previous
`#2135` fallback has a different failure on that same public path: after the
provider rejects `AbortError`, it mistakes the creator's own retained observer
for a surviving peer and starts a second provider call. The physical-only
patch and the old retry are both insufficient. This signal repair remains
uncommitted and requires a cross-Collection owner-aware cancellation oracle.

A separate public `utils.refetch({ throwOnError: true })` probe fulfilled with
the previous Query result after external `queryClient.cancelQueries()` canceled
its pending fetch. An isolated prototype rejected `AbortError` and passed 398
related tests, but the guide promises `AbortError` for application cancellation
and does not clearly specify external QueryClient fetch cancellation. The
cancel-A/start-B race is also untested. This is a bounded finding and a
contract decision, not closure of the broader cancellation class.

The direct-adapter same-options-object mixed-route diagnostic is red, but core
subscriptions create a distinct options object for each acquisition and pass
that same object to release. Its public receiving path has not been shown to
fail. The load-lifecycle oracle now states that identity premise instead of
adding route state for a direct-only ambiguous release.

## Public oracle challenge after the local prototype

The primary ownership oracle now drives `requestSnapshot({ where, signal })`
through caller abort with the acquisition lease still retained. A provider
that observes the metadata signal finds it live on the physical-signal
prototype. A provider that ignores cancellation returns a late row, which the
adapter installs publicly before `releaseSnapshot`. Both are red at their
named comparisons. The comparison also requires each aborted load to reject
with `AbortError`, as the load-subset transaction refinement oracle specifies
for every adapter cut. Both currently fulfill on the physical-signal prototype.
Query Collection is the sync adapter bound by the
request-scoped cancellation law in `types.ts`; a user query function may still
finish into Query cache, but its aborted request cannot install a Collection
row. A cross-Collection held-fetch witness verifies two observers share one
Query and the survivor receives the same provider response when one live query
retires. It passes the prototype and does not exercise explicit source
Collection cleanup, which can cancel a shared key.

A separate sole-snapshot history has a signal-honoring provider that rejects
`AbortError` on caller abort. The old `#2135` retry path starts a second request
with no peer and fulfills the load; this deterministic public witness passes
on the PR base and fails on `3502d3eca` in isolated scratch runs. On the local
physical-signal prototype, it fails earlier because the metadata signal does
not abort. Another public history lets two snapshot acquisitions share one
held Query. After the first caller aborts, the peer receives the row but the
aborted caller's load also fulfills. That settlement defect reproduces on the
PR base, so it is adjacent in-scope debt rather than a regression introduced
by #2135. A second branch aborts both callers while their leases remain
retained. After the ignored-signal provider returns one row, the local
physical-signal prototype fulfills both loads and publishes the row. The
primary oracle expects two `AbortError` rejections and no public row at that
checkpoint. This branch distinguishes logical request ownership from Query
observer count. Its targeted runtime check fails at the combined outcome and
row comparison with no type errors; a peer arriving after sole abort remains
outside this grammar.

An isolated hostile design supplies per-caller abort rejection but cancels the
physical Query only when its local owner and observer counts suggest no peer.
It passes the sole-abort, one-live-peer, and cross-Collection controls. When
both callers abort while their leases remain, both reject with `AbortError`,
but the late row still becomes public. The new branch rejects that mutant at
its public-row comparison, with one provider call. The focused scratch run had
five passes and one intended assertion failure. Scratch dependency links
prevented a valid typecheck there, so this is runtime calibration; the shared
candidate's focused typecheck reports no errors. The mutant is not a repair.

Fresh review also found two false-green assertions in the retained-owner
tests. When one provider call serves two equal live-query preloads, the second
must fulfill; the test now checks it. Failed exact revalidation must not
recover by reusing the older full result. The recovery history now holds a
new provider response and checks the old public row, durable row, and marker
while the load remains pending, then checks retirement after application.
Both corrected focused cases pass on the local candidate. Hostile mutants for
these two corrections also fail at their intended checkpoints in an isolated
checkout. One mutant rejects the joining preload after its peer's shared
provider call succeeds; the second-settlement assertion rejects it. A second
mutant fulfills a recovery acquisition before its held fresh response applies;
the pending-settlement assertion rejects it. A third clears the retained marker
in a valid storage transaction while that response is held; the pending
metadata comparison rejects it. The unchanged focused tests pass. The marker
mutant used a valid transaction because a direct metadata deletion violates
the persistence boundary and would be setup failure, not calibration.
