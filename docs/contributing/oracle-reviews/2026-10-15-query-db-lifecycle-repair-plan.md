# Query DB lifecycle repair plan

This plan is anchored to PR #2158 at `b5c55a2a4` and the ten-finding review
audit. It is a plan, not evidence that the bugs are fixed. Three reentrant
ownership histories in issue #2160 and one public caller-abort history in issue
#2162 are expected failures at that commit. A passing run that includes their
`it.fails` markers does not close either bug class. PR #2134 has a divergent
tree and needs a separate integration check.

At planning time, the #2158 worktree also had staged, uncommitted changes.
They removed the #2162 witness, the signal-free request-shape check, the eager
cache-eviction check, and the persisted direct-write check, and made `signal`
enumerable again. The repair run saved that patch at
`/private/tmp/pr2158-pre-repair-staged.patch` and restored the six tracked files
to `b5c55a2a4`; no prior fix or witness was discarded.

## Progress

- [x] Restore the committed baseline and preserve the staged reversal patch.
- [x] Show all four expected failures as ordinary assertion failures at their
      public checkpoints on `b5c55a2a4` (four assertion failures, 2026-10-15).
- [x] Turn the three pinned reentrant ownership witnesses into ordinary passing
      tests; full load-lifecycle and ownership oracles pass (2026-10-15).
- [ ] Expand reentrant ownership histories and hostile controls before calling
      the #2160 bug class closed.
  - [x] Application callback grammar: 12 named histories and matching fixed
        and random 48-run campaigns vary `getKey` versus `write()`, no peer
        versus an existing or reentrant peer, and one versus two provider rows.
        A later filtered acquisition checks for hidden ownership after its
        final release. Running the grammar against `b5c55a2a4` failed three
        histories at that public-row checkpoint; the two-row `write()` case
        exposed a partially staged owner. Direct seed/path replay passed;
        an independent oracle reviewer found and helped remove two false
        outcome claims about retired adapter promises and nested peer loads
        (2026-10-15).
  - [x] Reentrant release grammar: 16 named histories and matching fixed/random
        48-run campaigns cross commit-abort and Query observer-removal callbacks,
        one/two equal-scope rows, one/two new peers, and both release orders.
        Four disjoint-scope histories distinguish which peer's observer lease
        remains. Every new load checks its promised row at settlement; the
        abandoned old transaction's receipt rejects with `AbortError`.
        An old-version run failed the equal-scope histories at public-row or
        load-settlement checkpoints. A wrong-owner unload mutant failed the
        reverse-order disjoint histories at the first peer-release row
        checkpoint. Direct seed/path replay passed. The independent reviewer
        found and helped close the
        pre-release cache-event reach gap, a missing old-receipt check, and
        the equal-scope identity false-green (2026-10-15).
  - [x] Post-acceptance callback reentry: eight named histories and matching
        fixed/random 48-run campaigns cross caller abort or unsubscribe, one
        or two rows, and a peer present before acceptance or acquired in the
        release callback. The peer remains pending behind the publication
        gate, then receives the accepted rows from the one provider result;
        the original applied receipt survives release. An observer-removal
        mutant that force-retires the reentrant peer failed both unsubscribe
        histories at the public-row checkpoint. Merely removing the outer
        refcount rechecks survived because the inner cleanup guard still
        protected the peer (2026-10-15).
  - [ ] Cover remaining reachable ownership cuts before closing #2160.
- [x] Repair public caller abort (#2162) and turn its witness green. Four
      sole/peer and consumed/ignored-signal histories, two pre-acceptance
      histories, and one accepted-receipt history pass (2026-10-15). The broader
      generated-history and hostile-control work below remains open.
- [x] Expand the listed generated histories and TLA+ publication/abort
      coverage; kill plausible wrong designs at the intended comparisons.
  - [x] Bounded publication model: 276 safe reachable states; eight hostile
        configurations reach the intended invariant or temporal violation,
        including row loss after either owner releases and failure to abandon
        an accepted pending receipt on Collection cleanup. A departed raw
        adapter load is unobserved; a new cleanup-claim snapshot proves active
        or caller-aborted pending loads still reject, and a hostile model that
        drops a claimed load fails that invariant.
        The [mapping and limits](query-db-publication-tla/README.md) keep this
        design result distinct from production-history coverage (2026-10-15).
  - [x] Generated production histories and public-checkpoint hostile controls.
    - [x] Initial-fetch caller/peer grammar: ten named histories plus matching
          fixed-seed and random 48-run campaigns cover six release/abort
          actions, peer ownership and early release, signal consumption, and
          source success or failure. The driver checks the original provider
          error and public rows between both final releases. Direct seed/path
          replay ran; removing the caller-abort listener failed at load,
          physical-signal, and public-row checkpoints. Two further production
          mutants, retaining an aborted caller's lease and stealing the peer's
          lease on a duplicate unload, failed at the physical-signal and
          intermediate public-row checkpoints (2026-10-15). The refetch
          caller-cancellation cell is covered separately below.
    - [x] Public refetch lease grammar: thirteen named histories and fixed/random
          48-run campaigns vary caller abort and unload order, Collection
          cleanup, baseline release before or after caller abort, equal-peer
          release, signal consumption, and
          provider success or failure. It compares load outcome, public rows,
          transient public change events, Collection status, physical signal,
          and the captured Query's observer count at release checkpoints.
          A positive baseline insert proves the event recorder is active;
          wrong-result controls reject a brief unowned insert and missed
          cleanup status. A same-subscription witness aborts only a held
          refetch while its baseline lease and row survive. Direct seed/path
          replay and the replay manifest pass;
          temporary early-fulfillment, caller-abort bypass, and skipped
          observer-unsubscribe mutants failed at their intended comparisons.
          The grammar does not check ignored-signal cache completion or an
          accepted transaction (2026-10-15).
    - [x] Pending-fetch callback reentry: twelve named histories and matching
          fixed/random 48-run campaigns cross caller abort versus Query-cache
          observer removal, one/two source rows, consumed versus ignored
          physical signal, and both release orders after caller abort. The
          callback peer receives the scripted keys and values at load
          settlement and keeps them until release. A replacement fetch returns
          distinct values so an old cancelled result cannot satisfy that
          comparison. The signal axis distinguishes one continuing request
          from a cancelled first request plus replacement. Direct seed/path
          replay passed. A forced-retirement mutant failed all four
          observer-removal histories at the peer-settlement row checkpoint;
          retaining an aborted caller's lease failed the four peer-first
          histories at the intermediate row and observer checkpoints; leaving
          a Query observer subscribed failed those histories at the observer
          checkpoint (2026-10-15). Source failure and two reentrant peers are
          outside this grammar.
    - [x] Accepted-commit release grammar: caller abort or unsubscribe after
          source-result acceptance, crossed with one/two rows and peer timing,
          runs eight named
          histories and matching fixed/random 48-run campaigns. The real
          applied receipt, first-load settlement, peer settlement, one
          provider call, public rows before/after the publication gate, and
          final release are checked. Direct seed/path replay passed. A
          temporary immediate-abort mutant failed both caller-abort histories
          at the held-gate, receipt, and public-row checkpoints; two
          unsubscribe controls passed. Reentrant peer acquisition at caller
          abort or Query-cache observer removal keeps the peer's accepted
          rows; a forced-retirement mutant failed at the row comparison.
          An independent oracle reviewer found and helped close timing,
          replacement-fetch, and early-publication false-greens (2026-10-15).
          Collection cleanup during this accepted interval has a separate
          four-history receiving witness: both receipt and every pending load reject
          with `AbortError`, and no source row appears before or after the
          optimistic gate opens. A temporary built-Core mutant that resolved
          the receipt on cleanup failed at the receipt comparison. The expanded
          witness crosses one/two source rows with one/two equal subscriptions,
          observes `cleaned-up` and zero Query observers as cleanup settles,
          and records load settlement without awaiting a stranded promise.
          Wrong-result controls reject a retained observer and pending load.
          It does not
          cover restart or persistence after cleanup (2026-10-15).
    - [x] Synchronous provider throw receiving witness: a second public
          acquisition joins inside the query function before its first call
          throws. Both loads reject the exact provider error; after the first
          owner releases, Query invalidation fetches and applies a new row for
          the surviving peer. Final peer release removes it. A mutant that
          retires every lease on the first unload failed at the provider-call
          checkpoint (2026-10-15).
- [x] Close the automatic-GC, hydration, repeated-options, request-shape,
      persistence, and cleanup-harness cells with tests or explicit contract
      decisions.
  - [x] Automatic Query GC: finite `gcTime` evicts an unobserved eager Query;
        `utils.refetch()` recreates it and applies a new row (2026-10-15).
  - [x] Cross-client hydration authority: a real dehydrated Query result older
        than a persisted direct write must wait for a new physical response on
        cold acquisition. The cold boundary has no shared order position, so
        revalidation supplies authority; disabling the guard made the load
        fulfill before the provider started (2026-10-15).
  - [x] Repeated direct acquisitions with one options object: retain the
        established multiple-lease contract. `unloadSubset(options)` retires
        the newest accepted lease for that exact object. A full/exact route
        split reaches distinct rows, and a FIFO-release mutant fails at the
        first post-unload public-row checkpoint. A held exact fetch also
        checks lease order before the newer promise settles; the FIFO mutant
        fails at its physical-signal checkpoint. Core's public path supplies
        distinct objects; direct same-object calls cannot name a specific
        caller beyond this order (2026-10-15).
    - [x] During startup retention maintenance, a returned pending load also
          owns a lease. Two same-object calls followed by one unload now
          reject the newer call and let the older call publish; the witness
          failed on the previous oldest-first release path (2026-10-15).
  - [x] Request shape: signal-free and explicit-signal requests check the
        physical signal, own keys, descriptor, cloning, JSON, and deletion.
        The new configurable-descriptor assertion failed before the one-line
        repair (2026-10-15).
  - [x] Retained persistence through final release during application: four
        histories cross prior marker present/absent with sole/peer ownership,
        then restart against an empty authoritative source. They check public
        and durable rows, owner metadata, and the marker. Skipping the
        persistence wrapper's upstream unload fails at the public fresh-row
        checkpoint; bypassing only Query DB's local owner checks survives
        because the wrapper independently fences this path (2026-10-15).
        The hot checkpoint now compares the complete public row set and exact
        `until-revalidated` marker.
  - [x] Cleanup failure fidelity across older fixtures.
    - [x] The shared checker now returns observations while preserving a
          primary mismatch and every secondary cleanup error. A dual-fault
          control proves the final cleanup step still runs. Four older
          identity, shared-fetch, peer-join, and retired-endpoint helpers use
          it; their full oracle file, typecheck, and lint pass (2026-10-15).
    - [x] Converted the remaining 28 older `finally` cleanup paths. A dual
          fault preserves the primary mismatch as the cause, retains separate
          cleanup errors, and reaches the final cleanup step. The combined
          lifecycle and ownership oracles pass 449 tests; package typecheck,
          affected-file lint, and whitespace checks pass (2026-10-15).
- [ ] Run independent oracle review, package verification, and CI; record the
      exact covered boundary and remaining limits.
  - [x] Repair the first review's refetch, accepted-cleanup, model, and contract
        gaps. The refetch grammar checks a later baseline release, transient
        public events, and status. The cleanup witness checks four row/subscriber
        combinations and prompt settlement. Contract prose names the cleanup
        exception; TLA+ distinguishes an unobserved raw load from a claimed
        load. The two primary oracles pass 522 tests, direct refetch replay and
        the 37-test replay manifest pass, and the safe model and eight hostile
        configurations reach their intended results (2026-10-15).
  - [x] Package verification: all 943 Query DB tests pass, both Query DB and
        DB TypeScript checks pass, and affected-file lint, formatting, and
        whitespace checks pass (2026-10-15).
  - [ ] Review the repaired exact head independently, record ORC-001–014
        evidence, and check CI outcome.
- [ ] Integrate the repaired #2158 behavior into #2134 and verify its combined
      tree.

## Contract and scope

Use the Collection sync-adapter contract, the Query Collection guide, the
project glossary, and the current oracle coverage map as authority. Query DB
owns the Query instances in scope. An unrelated direct `fetchQuery()` caller
does not acquire a Query DB observer lease.

| Law | Public consequence |
| --- | --- |
| An accepted acquisition keeps its own observer lease until its release. | Releasing one owner cannot retire a live peer or leave rows owned only by a departed owner. A fulfilled load has its promised row at the applied-settlement checkpoint. |
| A caller's abort and an explicit unload are distinct actions. | Before sync-transaction acceptance, an aborted acquisition rejects and cannot publish its unaccepted row. A peer keeps shared physical work alive. After acceptance, the transaction applies, while the aborted caller's load rejects after its receipt. Collection cleanup can instead abandon a pending accepted receipt and reject the pending load. |
| Query signal consumption is lazy. | A consumed physical signal aborts after the final Query DB observer leaves. A provider that never reads the signal may finish into Query cache, without republishing an unowned Collection row. |
| Request options preserve their supplied shape. | A signal-free request exposes the physical Query signal by property access without adding an enumerable or serialized field. |
| Direct cache edits do not certify a physical fetch. | A local cache edit cannot roll back a later accepted direct write; a later authoritative physical response may replace it. |
| An eager Collection can refetch after cache eviction. | `utils.refetch()` starts a new provider request and applies its result even with no public subscriber. |

Repeated direct acquisitions using the *same* options object remain supported.
`unloadSubset(options)` has no caller token, so it retires the newest accepted
lease for that exact object. This preserves the existing multiple-owner and
startup histories. A new full/exact route-split witness distinguishes LIFO
from FIFO release by the exact-only public row after the first unload; a
temporary FIFO mutant failed there. The public Core path creates a distinct
options object per acquisition. No claim of caller-specific identity is made
for direct same-object calls beyond this specified release order. Changing
that contract would need a separate adapter API decision.

## 1. Strengthen the independent account first

Extend the primary load-lifecycle oracle for acquisition, abort, and applied
settlement, and the ownership oracle for row authority and persistence. Keep
their expected rows derived from scripted provider snapshots and accepted
direct writes, not Query DB's `rowToQueries`, cache eligibility checks, or
release implementation. In each oracle, state the law, legal actions, real
entry point, public observation, comparison checkpoint, and limits beside the
model and driver.

The existing `QueryDbLeases.tla` covers three acquisitions, physical leases,
and signal consumption; it intentionally omits result application. Preserve
that small model. Add a separate bounded publication model, or a small
extension only if it remains independent, with two owners, one row, an
unaccepted/accepted/applied transaction, a callback that acquires during
release, and caller abort. Check these safety properties:

1. A released acquisition cannot be the sole reason a row remains public at
   the post-release checkpoint.
2. A live peer's lease and promised row survive another owner's release.
3. A load cannot fulfill before its establishing receipt applies.
4. An accepted transaction applies despite later abort; an unaccepted one
   cannot publish after final release.
5. A physical Query signal cannot abort while a Query DB observer lease remains.

Map model terms to the glossary. The model checks the rule; real QueryClient
and Collection histories below check that production refines it. Do not turn
the model into a copy of Query DB's state machine.

## 2. Expand the legal history grammar

Use fixed replays for the four current failures, then a bounded generated
grammar with the same model, recorder, and comparison in fixed-seed and random
campaigns. Support direct seed and shrink-path replay. Reconstruct each known
failure, show why each axis changes a possible observation, include adjacent
valid cases, and reject impossible histories such as an applied receipt before
acceptance. Choose distinguishing combinations rather than a blind Cartesian
product.

| Axis | Required witnesses | Observation checkpoint |
| --- | --- | --- |
| Release during result application | Final release from `getKey`, `write()`, commit-abort callback, Query-cache `observerRemoved`, and the existing temporary-listener cut; with no peer and with a peer acquired reentrantly. Include both release orders and a case where equal demands have split between full and exact Queries. | First load outcome; second load outcome; public rows after each settlement and final release; Query observer and cache state only as path evidence. |
| Commit boundary | Release or caller abort before `commit()`, while commit acceptance is held, and after acceptance while publication is held. | Receipt and load settlement before/after the gate; public rows after publication. The post-acceptance case must preserve the accepted write. |
| Caller cancellation | Caller signal abort alone, explicit unload alone, both orders, Collection cleanup, and an unrelated provider failure. Cross sole owner and equal peer, consumed and ignored Query signals, initial load and refetch. | Provider's physical signal, each caller promise, Query cache result, and public rows before and after the held provider/commit resolves. |
| Request metadata | No supplied signal and an explicit supplied signal. | Property access, own keys, descriptor, `JSON.stringify`, `structuredClone`, and signal identity before provider return. A lazy-signal control checks ignored-signal behavior. |
| Cache authority | A real persisted direct update followed by `setQueryData` without physical fetch; a later physical response as the contrast. | Public and durable row values, provider call count, and ownership after release/restart. |
| Retained ownership | A row with and without a retention marker, followed by final release during application and a cold restart. Keep a peer-owner control. | Public and durable rows, owner retirement, and marker state after the next authoritative response. |
| Cache eviction | Explicit `removeQueries` and automatic GC with a finite `gcTime` under controlled time, eager Collection, zero public subscribers. | Cache absence before `utils.refetch()`; provider call and applied public row after it settles. |

Cross-client hydration is a separate authority question, not an inferred
extension of the local `setQueryData` witness. Build a real dehydrate/hydrate
history with persisted direct-write data and an older Query result. First ask
what provenance survives the boundary and write rival predictions. If the
needed ordering fact is absent, record the information gap and decide the
product contract before changing an oracle expectation or adding recovery
code.

Repair the older lifecycle fixtures whose `finally` cleanup can mask a primary
oracle mismatch. Preserve the first failed law and checkpoint plus every
secondary cleanup error, and prove the final cleanup step still runs with a
dual-fault control. A reentrant synchronous provider throw also needs one
receiving witness because it crosses acquisition setup and release.

## 3. Prove that the oracle can reject wrong designs

Run the four pinned histories without `it.fails` against the original commit;
record their public assertion failures. For each new reusable law, run at
least one targeted hostile control at its intended checkpoint. Useful mutants
include: release by predicate hash, stage an owner after final release, drop a
reentrant owner's lease, abort the physical Query on one caller's signal while
a peer remains, ignore caller abort, fulfill before applied receipt, eagerly
consume `context.signal`, enumerate the derived signal, and treat a local cache
edit as a physical response. Classify assertion failure, timeout, setup
failure, unreached path, survival, or scoped equivalence; a crash in setup is
not a kill.

## 4. Repair production in bounded steps

1. Reconcile the staged coverage reversals and retain the already fixed
   request-shape behavior. Keep baseline and candidate evidence separate.
2. Fix issue #2160 using the three red public histories plus the broader
   release grammar. Prefer correcting current ownership/commit boundaries to
   adding another lifecycle state machine. Keep the accepted-transaction law.
3. Fix issue #2162 using caller-abort histories independent of unload. Keep
   the physical Query signal shared and lazy; do not add a Query Core API for
   callers outside Query DB ownership.
4. Close the automatic-GC, cross-client hydration, and repeated-object items
   according to their authority decisions. A refuted explicit-removal trace
   stays as a guard, not as proof about automatic GC.
5. Re-run both primary oracles and affected package tests after each repair.
   Remove an expected-failure marker only when its assertion passes normally.
   Compare production-code weight separately from test and contract growth.

## 5. Review and closeout

Have a fresh oracle reviewer attack enforcement, model independence, law
suitability, and interactions among the row, abort, and accepted-commit laws.
Give the reviewer the contract sources, changed oracles, and exact head without
the desired verdict. Run the relevant TLA+ safe and hostile configurations,
focused oracle campaigns, package tests, typecheck, and PR CI. A green run is
evidence only for the named histories and checkpoints.

Close #2160 and #2162 only when all four current failures are ordinary passing
tests, adjacent histories and hostile controls fail the old or deliberately
wrong implementation at public checkpoints, and no reachable in-scope
counterexample remains. Update the coverage map and a versioned review record
with the exact head, contract × history × production path × observation claim,
mutant outcomes, and remaining limits. Then carry the reviewed #2158 repair
into the divergent #2134 tree, re-run its applicable oracles, and review the
combined diff before claiming either PR ready.
