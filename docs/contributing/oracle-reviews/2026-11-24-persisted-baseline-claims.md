# Persisted hydration baselines and cache claims

The external review at `c366c65d323ded1ef60ceddc0827d91da2f930f9`
identified a source-commit admission gap (N01), repeated baseline reads (N02),
and duplicated binding-limit selection (N15). This record distinguishes those
claims. The claim/FIFO oracle is in
`packages/db-sqlite-persistence-core/tests/persisted-source-fifo-oracle.ts`;
its browser-safe production driver is `persisted-source-claim-driver.ts`.

## Laws and the missing composition

A persisted cache claim authorizes one sync run's durable access. The approved
[cache-generation design](issue-2056-cache-eviction-design.md) requires a resumed
run whose claim expired to reject old source work and reacquire demanded data.
An ordinary I/O failure under a live claim remains terminal: the coverage map's
“Electric recovery demand and scoped persisted restore” section records that
neighboring law. The review's suggestion that any transient baseline-read error
should recover would change this policy. The source's complete partial-update
baseline remains necessary even if its public accepted row exists: an ordinary
sparse update can leave public state without hidden durable fields.

The old FIFO grammar crossed hydration, source order, partial rows and abort,
but did not move a managed claim clock. The claim owner crossed expiry with
ordinary source commits and storage reads, but did not place a diverted partial
commit behind an ordinary predecessor at its FIFO turn. Both narrower checks
could therefore be green while their composition crashed the Collection.

The new grammar uses the same law and comparison on controlled storage, actual
Node 22 `node:sqlite`, and actual Chromium worker/OPFS. It holds a real subset
read and commits one to three partial successors during that read. An earlier
ordinary source commit becomes durable under the live claim, then stays held
before returning, so the successors have not reached their FIFO turns. After
that positive premise, the grammar selects one of fifteen cuts:

- `live`: repeat partial updates to the same successfully hydrated row.
- `expired`: move the host clock to exact expiry or up to three milliseconds
  after it, before the successor's turn.
- `expired-during-baseline`: expire at actual baseline-read admission, after
  the turn started; an admission check alone cannot repair this schedule.
- `queued-expired-during-baseline` and `queued-recovery-pending`: omit the
  outstanding ordinary predecessor, fail the request-local read, and cross its
  actual replay queue with expiry or pending recovery. These transactions carry
  receipt callbacks; diverted single transactions instead reject by throwing.
- `recovery-pending`: begin scoped recovery before independent successors run.
- `recovery-during-renewal`: finish but hold the actual host's renewal, start
  scoped recovery during that await, then return the renewal result.
- `ordinary-recovery-during-renewal` and `ordinary-recovery-after-renewal`:
  ordinary source work crosses recovery during the host renewal and after its
  result returns, before application resumes.
- `ordinary-expired-after-renewal` and `ordinary-expired-after-live-check`:
  expire a claim in the caller continuation, both after actual renewal and
  after the no-renew fast path. The continuation controls require an absent
  public row and pending receipt when authority changes; a schedule that misses
  that premise fails reach rather than proving the old work was abandoned.
- `ordinary-expired-at-turn` and `ordinary-recovery-pending`: hold an ordinary
  predecessor after actual durability and change authority before the next
  turn. These controls do not wait for a renewal callback, so deleting admission
  entirely cannot evade the premise.
- `dependent-recovery-pending`: two or three same-key successors preserve the
  existing abort-graph law: a dependent aborted suffix fails stop. A one-row
  history is illegal for this cut and the grammar rejects it.
- `live-read-error`: fail the baseline read under a live claim and retain the
  original error and terminal Collection state.

Titles vary from empty to twelve characters. Other cancellation cuts use
independent keys; same-key dependencies have their explicit control. Two fresh
constructed histories per cut preserve randomness. Each constructed campaign
unit runs its construction plus four generated histories, so each cut is
reached ten times in each fixed and random campaign on each receiving host.
The seed is `18530111`; ordinary generated campaigns keep their four-run budget.
Missing-reach calibrations cover every builder, including generated outputs.

## Observations and independent judgment

The model derives three distinct results from the accepted laws: a live partial
update retains the cached row's hidden field; expired authority rejects old
commits, clears their old public base and recovers; a live I/O failure, or the
explicit dependent-abort composition, crashes. It does not reproduce the
production queues, claim renewer or snapshot reconstruction logic.

At source settlement, the checker judges each receipt, Collection status,
shared row and rotation count. At ordinary next use it judges the new receipt,
public row, status, actual durable row returned by `store.read()`, and whether
that write addressed the storage target of the current claim. Successful
receipts alone do not prove those last observations.

Both completed prefixes are captured before the later durable read. An
execution failure retains the completed settlement and next-public facts. The
checker judges those prefixes before reporting the later failure. Two dual-fault
calibrations corrupt an earlier row and fail the later read; each must report
the earlier violation with both diagnostics. Another calibration represents an
acknowledged next write missing from durable storage. Cleanup failures remain
separate and all cleanup actions receive a turn.

This single-run grammar observes recovery, old-row clearing and new storage
use. Healthy-peer isolation and the private/current-generation policy remain
with the existing cache-generation and rotation owners. It establishes no new
multi-tab, mobile-host, universal latency or unbounded-history claim.

## RED, repair and GREEN

Production stayed at `c366c65d3` until controlled storage, Node SQLite and
Chromium/OPFS all ran the extended expiry cuts. Node's two hosts reported
30 failed and 62 passed; Chromium reported 15 failed and 31 passed. Expired
baseline access rejected with the storage claim error, left status `crashed`,
made no rotation, and refused next use. The intended comparison rejected that
observation. Bound calibrations for expired histories also failed because their
clean subject was RED; those are calibration precondition failures, not extra
production defects. Live, independent pending-recovery and live-I/O controls
passed. Earlier browser startup failures were setup failures, not RED evidence.

The initial repair shared the buffered-commit admission rule with baseline
reconstruction. A read that rejected after claim expiry reused that rule to
abort and recover. Live-claim I/O failures kept their existing policy. Later
queued and ordinary continuation histories below challenged that repair.
No cross-transaction row-completeness cache, new state machine or retry policy
was introduced.

Node 22 controlled/SQLite FIFO, claim-boundary and resume-projection checks
passed **819 tests** after the repair. Independent review then strengthened the
next-write observations and added the renewal/dependency compositions without
another production change. The seven-cut instrument then passed **130 Node tests**
and **65 Chromium/OPFS tests**; those counts precede the later queued and
ordinary continuation extensions below. Every builder's missing-state calibration and
the receipt, acknowledged-write and two failure-fidelity calibrations pass.

Commands, from the repository root (prepend the Node 22.23.5 installation to
`PATH`):

```sh
pnpm --dir packages/db-sqlite-persistence-core exec vitest run \
  --coverage.enabled=false --typecheck.enabled=false \
  tests/persisted-source-fifo-sqlite-oracle.test.ts \
  tests/persisted-oracle.test.ts tests/sqlite-resume-snapshot-oracle.test.ts \
  -t 'source-claim-boundary|source-fifo-order|sqlite-resume.managed-claim-read|sqlite-resume.row-projection' \
  --maxWorkers=1
CI=1 PLAYWRIGHT_CHANNEL=chrome \
pnpm --dir packages/browser-db-sqlite-persistence exec vitest run \
  --config vitest.adapter-oracles.config.ts \
  e2e/persisted-source-fifo-oracle.browser.test.ts \
  -t source-claim-boundary --maxWorkers=1
```

The original complete `persisted.ts` from `c366c65d3` was temporarily restored:
all eight selected fixed expiry units failed the receipt/recovery comparison.
A narrower mutant retained the new admission check but removed the expired-read
catch: four pre-baseline units passed while all four during-baseline units failed.
These initial mutant runs preceded the later next-write/fidelity observer
extensions; the production path and expiry law were unchanged. They show the
need for both admission cuts, not universal coverage of the large functions.

Independent review also ran the final dual-fault Node calibrations and a direct
repaired replay, selecting only property
`sqlite-persistence.source-claim-boundary.node-sqlite`, seed `18530111`, path
`0:1:1`, unit `random seed: expired-during-baseline claim cut 1`. The selected
replay passed and reached the expiry state three times.

## Queued replay and ordinary continuation follow-up

A bounded gap report selected thirteen operators: four on the initial
pre-baseline guard, six on the expired-read catch, and three on binding-limit
selection. It ran the actual Node SQLite FIFO and resume owners without
changing campaign budgets: ten mutants were killed and three remained gaps.
All three exposed the missing default replay queue, where a rejection returns
`false` through receipt callbacks instead of throwing from a diverted single
transaction. The two queued histories above passed unchanged current production
on all three hosts (162 Node and 81 Chromium tests).

A paired deletion of the earlier baseline guard was then RED: the commit's
only remaining renewal await moved into application admission, and recovery
could begin during it while the old commit still fulfilled. An ordinary-source
history reproduced that same gap directly. Both during-renewal and
post-renewal-continuation histories were RED on the unchanged first repair:
24 failed/8 passed selected Node units and 12 failed/4 passed Chromium units.
The two expiry continuation controls independently had the same RED totals.
They reached the required pre-application premise; real SQLite rejected only
after the old row had already published, causing a terminal durability failure.

The final boundary rule requires a synchronous currentness check immediately
before application, after awaited renewal/admission returns. A check only at
the async helper's tail leaves the Promise continuation gap. That synchronous
check includes terminal/lifecycle status, admitted storage identity, pending
scoped recovery, and known claim expiry, with the existing reject-or-throw
semantics and the existing recovery scheduler. It adds no new authority state.

With that actual application boundary protected, removing the earlier baseline
check preserved every queued and ordinary case: 958 surrounding Node and
113 Chromium tests passed. A further bounded report selected 24 operators; its
broad anchor also selected the unchanged numeric queue threshold. Eight results
finished before the run was stopped: five kills, two redundant-catch survivors,
and a 434-second timeout from changing `length > 0` to `length >= 0`. The timeout
is not an oracle kill. The impossible empty-item `continue` and numeric threshold
were removed together by taking queue items in the for-loop condition; this
preserves work appended during an await. The expired-read catch now invokes the
shared synchronous currentness check directly. The two surviving async-catch
branches were deleted, not waived.

The final precisely scoped report selects four expired-read predicates, the
post-await admission OR/AND mutant, omission of known expiry, and three binding
fallback mutants. Run `a234effe468e` reports nine reproducible named-law kills,
zero crashes and zero gaps. It runs the full claim-boundary and
`sqlite-resume.managed-claim-read` campaigns, with their unchanged budgets, over
real Node SQLite. Its private config filters these laws rather than repeating
unrelated FIFO campaigns for every mutant. The normal surrounding campaigns
run separately. This is evidence for the named guard decisions, not a claim
that every operator in the large runtime functions has been surveyed. The
private config was removed from the package after the run.

## Final bound verification

The final fifteen-cut campaigns passed **990 surrounding Node tests** and
**129 actual Chromium/OPFS tests**. A lint-only move of an asynchronously updated
boolean into the existing mutable premise record was followed by the same
**258 Node claim tests**, **129 Chromium claim tests**, and the nine-operator
report again. Scoped TypeScript and ESLint checks pass.

A manifest-guarded replay also passed with one execution and two runs:
`sqlite-persistence.source-claim-boundary.node-sqlite`, seed `18530111`, path
`0:1:1`, unit `random seed: queued-expired-during-baseline claim cut 1`.
Unlike a discovery run, the replay runner checked its private execution witness.

The final instrument rejects these production mutants at their intended
comparisons (each was restored after execution):

| Mutant | Result | Distinguishing observation |
| --- | --- | --- |
| Exact complete `persisted.ts` from `c366c65d3` | 34 failed / 28 passed selected fixed units | Wrong receipt/recovery under expired authority; adjacent ordinary continuations. |
| Baseline admission only, no expired-read classification | 8 failed / 4 passed | During-baseline expiry fails while before-baseline expiry passes. |
| Check currentness only at async admission's tail | 12 failed | Recovery/expiry between helper return and application. |
| Omit the synchronous known-expiry check | 8 failed | Renewed and no-renew caller continuations. |
| Remove application admission entirely | 8 failed | Independently held ordinary expiry/pending turns. |
| Acknowledge without issuing the next durable write | 4 failed | Receipt/public prefix cannot establish storage use. |
| Real SQLite acknowledges after dropping only the next-row mutation | 2 failed | Receipt/public/target prefix passes; `ordinary next source durability` rejects the missing row. |

The last SQLite mutant specifically calibrates durable row content, rather than
only resource routing or receipt success. Earlier mutant counts above retain
their earlier instrument scope and are not substituted for this final run.

| File | Final SHA-256 |
| --- | --- |
| `src/persisted.ts` | `e555b19d053ef3712d54ec575d3dabc18209a151bfcd294a60931db88229c23b` |
| `src/sqlite-core-adapter.ts` | `267b1c315654fe1e624bc9f4b3e7def984330a2407843ba2bed46597b3b05b94` |
| `tests/persisted-source-claim-driver.ts` | `da1e8cd71077601dfff49adef06ee0417e2e035537ccdbab931c25198f9d0fe7` |
| `tests/persisted-source-fifo-oracle.ts` | `67d99a09c5a5d96d1b238747c9c5160211d2e3f56da675d630374dd660585ea6` |

## Efficiency and reuse

N02's work observation is real: one, two and three diverted live partial
successors perform one, two and three projected baseline snapshot round trips,
even after the read succeeded. This is deterministic work evidence, not a
measured latency regression. The FIFO owner already records work but deliberately
excludes it from semantic equality; it promises complete rows, not zero reads
for a publicly present row. The rejected presence shortcut would lose hidden
durable fields after a sparse ordinary update. This repair adds no cache without
an independent completeness certificate.

For N15, a pure `getBindLimit(driver, fallback)` now shares transaction-driver
limit, root-driver limit and `999` fallback between projected reads and subset
query admission. `replacementBatchSize` remains separate: each replacement row
binds four values, and its root-derived chunk limit is not a one-bind-per-key
read limit. The real SQLite projection owner still checks smaller transaction
limits, typed/signed keys, duplicate keys across chunks and materialized row work.

The production refactor shares rejection/recovery scheduling and currentness,
deletes the redundant baseline guard and async catch checks, replaces the
impossible empty-item branch with sentinel queue iteration, and shares binding
limit selection. Against the reviewed `c366` tree, core gzip is 49,287 → 49,383
bytes (**+96**), brotli grows **40** bytes; the persisted module adds 413 minified
bytes while SQLite adapter minified bytes drop 15. All eight typical-app
scenarios are unchanged. The remaining growth pays for the synchronous
post-await authority and known-expiry enforcement demonstrated by the RED
histories. Tests and contract documentation are separate from shipped weight.

## Rubric audit

| Requirement | Evidence |
| --- | --- |
| ORC-001,002,003 | Approved claim/abort/I/O laws above; independent outcome model; literate owner and driver. |
| ORC-004 | Fifteen legal cuts, random titles/expiry margin/successor count, exact-expiry boundary, explicit invalid one-successor dependent history; each cut has a distinct consequence or await boundary. |
| ORC-005,014 | Actual source begin/write/commit, host read/write gates and host clock, common model/checker on all three hosts; no private-generation isolation transfer from this single-run test. |
| ORC-006 | Original and admission-only production mutants; receipt, missing durable write, reach and dual-fault comparison calibrations. |
| ORC-007 | Fixed/random parity, same four-run budget, registered replay routes and independently executed direct replay. |
| ORC-008,009 | ORC-008 is not triggered: the model is a stateless expected-outcome computation. Its history distinctions map to ordinary, diverted and queued commits and public checkpoints; glossary terms are consistent. |
| ORC-010 | Completed settlement and next-public prefixes survive later read failure; cleanup diagnostics retained separately. |
| ORC-011 | No separate shared semantic fault requiring a second formulation was identified; independent cache-claim and FIFO owners supply neighboring laws. |
| ORC-012 | This record binds the reviewed parent, law, source, receivers, original failures and finite limits. |
| ORC-013,015 | Exact expiry, live-I/O and renewal-await neighbors, two constructions per cut, generated-builder reach checks and missing-state calibrations. |
| ORC-016 | No ordinary expected-answer tests added to oracle files; calibration and all receiving paths reuse the shared model/check. |
