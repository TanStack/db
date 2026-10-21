# Ordered loader request authority: TLA+ control

This directory holds the bounded TLA+ control from the design-grammar run on
`OrderedSourceLoader` (#2191). It checks the internal consequences of the
grammar's rules for request authority and acquisition retirement. It does not
show that production refines the model. The generated request-authority lane in
`packages/db/tests/query/ordered-source-loader-state-oracle.test.ts`
(`ordered-loader.request-authority`) owns that claim. It drives the real loader
and checks the same three laws.

## Frozen preservation list

The user confirmed these properties before extraction. They come from
ARCHITECTURE.md, "Ordered requests, continuation, and recovery", and the
loader source.

| ID  | Property                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Request shapes: first page or prefix, tie, continuation, bounded repair (`refetch: true`, `limit = offset + limit`), and full-source read.        |
| P2  | Settlement proves only the exact request. The boundary is the last source-derived row.                                                           |
| P3  | The loader's own failure blocks ordinary refills until an explicit window move or the bounded backoff retry.                                       |
| P4  | A request issued before an ordering invalidation proves no current coverage. It cannot clear a failure, change a repair, or retire newer reads. |
| P5  | A repair chain is fenced by its invalidation epoch, and its replaced acquisitions retire only after the chain succeeds.                            |
| P6  | Authoritative work with ordering debt holds publication.                                                                                          |
| P7  | A report is ignored for full-source coverage or a window inside its own first page.                                                               |
| P8  | An overlap after the first settlement starts the bounded repair at once.                                                                          |
| P9  | One request runs at a time; a staged continuation waits for the graph turn that processes its rows.                                             |
| P10 | Every acquisition is released exactly once. A successful full-source read retires every settled finite acquisition.                              |
| P11 | Window operations carry a generation.                                                                                                            |
| P12 | The loader's public methods and the existing oracles stay unchanged.                                                                              |

## Grammar to model trace

| Grammar item                                                           | TLA+ element                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------- |
| Debt lattice: none, bounded, full (`needsOrderingRepair`, `canRepair…`) | `debt`, `Invalidate`                               |
| Work slot: idle, repair chain at an epoch, full-source read             | `phase`, `chainEpoch`, `StartRepair`, `StartFull`  |
| Request stamp and classification                                         | `req[i].ep`, `epoch`                               |
| Supersession by later authoritative work (P8)                           | `req[i].sup`, `Supersede`                          |
| Own and superseded failures (P3)                                         | `failure`, `Fail`                                  |
| Explicit window retry, atomic with its full-source start (P3)           | `ExplicitRetry`                                    |
| Ledger and the coverage epoch (P5, P10)                                  | `req[i].st`, `coverEpoch`, `Normalize`             |

Invariants:

- `ChainHeld`: a finished repair still holds its own acquisition (P4, P10).
- `NoLeak`: once loading is quiet, nothing older than the coverage epoch is
  held (P10).
- `NoStrandedStaleFailure`: a superseded request's failure always has
  recovery running (P3, P8).

The `Rules` constant selects the rule set:

| Configuration                     | `Rules`            | Meaning                                                    |
| --------------------------------- | ------------------ | ---------------------------------------------------------- |
| `safe-unified.cfg`                | `unifiedMin`       | Superseded failures raise debt only; one epoch normalization. Passes the model but did not transfer (see Limits). |
| `safe-patched-cases.cfg`          | `unified`          | The same superseded rule, with the per-case retirement rules kept. The shipped rule set. |
| `weak-main-before-2191.cfg`       | `current`          | The rules on main before #2191.                            |
| `weak-stale-prefix-retires.cfg`   | `oldRetire`        | A stale prefix retires the repair's prefix.                |
| `weak-stale-held.cfg`             | `oldLeak`          | A stale request that settles after the repair stays held.  |
| `weak-no-recovery.cfg`            | `oldRecover`       | A superseded failure starts no recovery.                   |
| `weak-no-normalize.cfg`           | `unifiedMinNoNorm` | The unified rules without the normalization step.          |

## Results

TLC 2.19 (rev 5a47802) through the Field Lab container, `MaxEpoch = 2`, four
request slots, deadlock check off (full coverage is terminal):

| Configuration                   | Result                                              |
| ------------------------------- | --------------------------------------------------- |
| `safe-unified.cfg`              | No error, 26,048 distinct states, exhaustive        |
| `safe-patched-cases.cfg`        | No error, 25,172 distinct states, exhaustive        |
| `weak-main-before-2191.cfg`     | `NoStrandedStaleFailure` violated in 9 steps        |
| `weak-stale-prefix-retires.cfg` | `ChainHeld` violated                                |
| `weak-stale-held.cfg`           | `NoLeak` violated                                   |
| `weak-no-recovery.cfg`          | `NoStrandedStaleFailure` violated                   |
| `weak-no-normalize.cfg`         | `NoLeak` violated                                   |

The 9-step trace on main: a page is superseded by a bounded repair, the repair
finishes, a newer invalidation's reaction is deferred, and the old page fails.
The loader recorded the failure as its own and blocked refills. The loader
state oracle reproduced this on main before the fix.

Four encoding corrections were made during the run; none weakened a frozen
property:

1. The strand invariant covers only superseded failures, since the failure law
   allows an unsuperseded failure to block.
2. The leak and held invariants measure from the coverage epoch, since an
   overlapped full-source read still clears the debt.
3. An authoritative failure counts as the loader's own failure.
4. An explicit retry starts its full-source read in the same step.

## Limits

The single normalization rule (`safe-unified.cfg`) passed this model but failed
the real loader, and was reverted. The model stamps a request with the epoch it
is issued in and never issues a finite request while repair debt is pending. In
the loader, a stale finite chain can issue a tie in the new epoch before the
repair starts, and a repair's staged continuation can be issued after a newer
invalidation. Retiring by epoch kept both; retiring everything outside the repair
chain releases both. The request-authority lane found these once it generated
self-invalidating pages and synchronous repair answers.

The model leaves out the scheduler (staged continuations, deferred refills, and
the graph-revision check), cursor and boundary values, tie and refill sub-steps,
same-epoch prefix supersession, truncate replay, and publication holds. Two of
the four flag-interaction bugs found in #2154 lived in parts it leaves out. A
passing bounded run says nothing about states outside these bounds.

## Run

```sh
~/.claude/skills/field-lab/scripts/tlc . -config safe-unified.cfg LoaderLedger
```


## Run 2: the shipped state machine

`LoaderAuthority.tla` models the loader after #2194's review fixes, and it
is the model the `work` and `debt` representation follows. It adds what run 1
left out: a page's own delivery invalidating ordering, a current page's tie
issued while repair debt is pending, a repair prefix that answers at once with
its step staged, the scheduler's `pending` request, retirement by repair-chain
membership, superseded failed leases, and an explicit retry whose release
throws.

| Grammar item | Loader field | TLA+ element |
| --- | --- | --- |
| Work slot: idle, repair chain at an epoch, full-source read held, complete or failed | `work` | `work` |
| Debt: none, bounded, full | `debt` | `debt` |
| Request stamp at issue | `RequestStamp`, `standing()` | `req[i].ep`, `Stale` |
| Own and superseded failures | `failedRequest`, `failedAcquisitions[].superseded` | `own`, `req[i].sup` |
| Repair-chain membership | `settledFiniteAcquisitions[].chain` | `req[i].chain`, `RetireOutside` |
| Scheduler: one request, staged repair step | `pending`, `stagedContinuation` | `pending`, `staged` |

Invariants: `ChainHeld`, `NoLeak` (including superseded failed leases, and
pages issued under debt), `NoStall` (no held repair with nothing in flight or
staged), and `OwnIsGrounded` (an own failure comes from a request that nothing
superseded).

| Configuration | Weakened rule (one bug fixed in #2194) | Result |
| --- | --- | --- |
| `run2-safe.cfg` | none | No error, 290,401 distinct states |
| `run2-weak-lateStamp.cfg` | Stamp the epoch when the request returns | `NoLeak` violated |
| `run2-weak-epochRetire.cfg` | Retire by issue epoch (the reverted rule) | `NoLeak` violated |
| `run2-weak-ownSuperseded.cfg` | A superseded failure counts as own | `OwnIsGrounded` violated |
| `run2-weak-pendingBlocks.cfg` | A repair waits behind a superseded `pending` | `NoStall` violated |
| `run2-weak-dropStaged.cfg` | A finite failure drops staged repair work | `NoStall` violated |
| `run2-weak-stepReleases.cfg` | A chain step releases failed leases | `NoStall` violated |
| `run2-weak-noLeaseCollect.cfg` | Recovery leaves a superseded lease held | `NoLeak` violated |

Three weakened rules first passed this model. Each pass exposed a gap that was
closed before the results above: the model let no current page continue under
pending debt, it stamped chain steps by chain under the reverted rule, and its
grounding check accepted any failure. Four encoding corrections were also
made; none weakened a frozen property.

A review found one history the model could not generate: a request that
throws while it starts (`request()` throws synchronously). The code records it
as the loader's own failure and counts no supersession. `FailOnStart` now
models it; the safe rules still pass, and every weakened rule still fails.

Two mutants of the code survive every oracle and are equivalent within the
tested domain: keeping a completed full-source read `complete` across
`resetCursor`, and not clearing the debt when a full-source read succeeds.
Once a full-source read completes, the work slot never returns to `idle`
before a reset or replay, so those values are not observed. A witness would
need a path from `complete` back to `idle`, or a report that a replay window
must not ignore.

Loss audits of the loader code, ARCHITECTURE.md, and the fix history found
these loader rules outside this model, in addition to the limits below: the
optimistic-overlay refill (`needsOptimisticRefill`), the unexpressible-boundary
fallback, leading-column cursors and optimistic headroom, the
window-generation retry gate, report handling and the first-page skip, the
graph-revision check, and synchronous-settlement eligibility. Query DB's report
gate and the coverage law belong to the query-db refetch oracle.

Limits: boundary and cursor values, tie and refill as separate steps,
joined-demand deferral, truncate replay, publication holds, the backoff timer,
and release faults outside an explicit retry are not modeled. The
request-authority lane and the existing loader oracles check the real loader.

```sh
~/.claude/skills/field-lab/scripts/tlc . -config run2-safe.cfg LoaderAuthority
```

## Run 3: the transition table

`LoaderTable.tla` extends run 2 with the loader's transition table
(#2194 after a66163f94). It adds a cursor reset by truncate, the replay that
settles it, the incarnation each request is issued in, a window move that
starts owed work while a replay is pending, and four checks:

- `Coherence`: complete coverage owes no debt, a repair owes some, and a
  failed full-source read owes a full-source read.
- `Table`: an action property. Each step keeps the work state or makes one
  of the moves the loader's `moveWork()` allows.
- `OwnIsGrounded`, strengthened: an own failure cannot come from a request
  whose demand a replay reacquired.
- `NoStall`, `NoLeak`, and `ChainHeld` allow a pending replay, which owns
  the requests from before the truncate and finishes a running chain.

A repair chain is still identified by its epoch. A new chain needs new debt,
and new bounded debt needs an epoch move, so the epoch names the chain in
this model. The loader uses the authority generation for the same purpose.

| Configuration | Weakened rule (one defect fixed in this round) | Result |
| --- | --- | --- |
| `run3-safe.cfg` | none | No error, 9,368,122 distinct states, depth 17 |
| `run3-weak-noAbsorb.cfg` | A full-source failure after a covering replay becomes own | `OwnIsGrounded` violated in 6 steps |
| `run3-weak-noAbsorb-table.cfg` | The same, checking only the table | `Table` violated in 6 steps |
| `run3-weak-replayKeepsDebt.cfg` | A replay keeps the failed read's full debt | `Coherence` violated in 5 steps |
| `run3-weak-chainOwnsAfterFinish.cfg` | A chain request owns authority after a replay finished its chain | `OwnIsGrounded` violated in 8 steps |
| `run3-weak-debtUnderCoverage.cfg` | A failure raises debt under complete coverage | `Coherence` violated in 5 steps |

All seven run-2 weakened rules still fail under run 3 with five request
slots. With four slots, `lateStamp` and `epochRetire` pass, so run 3 uses
five.

Three encoding corrections were made; none weakened a property. `NoStall`
first flagged a running chain whose staged step a truncate had cleared, which
the pending replay finishes. `chainOwnsAfterFinish` first passed because no
action could start a chain while a replay was pending; the explicit window
move does that in the loader. The safe rules then flagged a replaced chain's
request that settled after full coverage, which the loader now retires; the
model's settle rule now retires it too.

Run 1 (`LoaderLedger.tla`) is kept as history. Its two gaps that a review
noted, a superseded failed lease held after a full-source read and a strand
invariant that holds vacuously under `unifiedMin`, are closed in run 2 by
`NoLeak` and `OwnIsGrounded` and carried into run 3.

```sh
~/.claude/skills/field-lab/scripts/tlc . -config run3-safe.cfg LoaderTable
```
