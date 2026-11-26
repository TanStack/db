# Replay retirement checkpoint in PR #2481

Reviewed code head: c6efb395a34e3f9b0689b3b186f0435bbf2581f2.

The oracle judged finite lease retirement before its premise held. CI seed
`332327919`, path `9283:0:0:0:0:5:5:9:10:9`, fails on `c647da132` at
`ordered-source-loader-state-oracle.test.ts:2135`. The exact local replay
reports the same `no leak: requests [1] are still held after authoritative
request 3 succeeded` difference.

The ledger shows replay pending, successful finite request 1, unanswered
current finite request 2, and successful full-source request 3. Request 3's
transport success does not complete replay while request 2 participates.

## Law and decision

ARCHITECTURE.md, "Ordered requests, continuation, and recovery", requires
finite covering retirement to wait for original settlement and active replay
completion. "Replay participants and failure" requires every acquisition
started during replay to join that barrier. An explicit retry may replace
failed demand; disposal ends the loader's retirement obligation.

Decision `ordered-loader-replay-retirement-checkpoint-2026-11-26`: the
maintainer approved fixing this checkpoint and delegated model, history, and
check repairs under unchanged laws. This corrects the comparison premise.
It changes no product behavior and grants no resource-leak allowance.

The old check predicts a leak immediately after transport 3 succeeds. The
corrected check permits retention while replay remains pending and demands
retirement after covering recovery. It also rejects premature covering
retirement of the finite leases observed inside active replay.

## Model, grammar, and checkpoints

The existing request ledger remains the independent judgment. It records
request options, issue order, settlement, release callbacks, and replay
boundaries. A set remembers finite leases observed held inside replay so a
newer truncate cannot erase their eventual retirement obligation. No private
loader state supplies the expected result.

The driver records public `loadMore` arguments through synchronous and
asynchronous continuations. A continued window operation keeps its permission
to replace failed demand. A bounded repair-chain step gets no such permission.
An early broad release assertion rejected a valid resumed retry; the public
argument observation corrected that driver premise without changing the law.

`ordered-loader.replay-retirement` constructs two schedules. The first keeps a
successful finite lease while an unanswered finite acquisition blocks replay.
The second keeps a superseded failed lease while an authoritative tie is held.
A later truncate supersedes the unanswered work, and the shared comparison
requires finite retirement after covering replay or subsequent full-source
recovery. Disposal variants keep the existing no-post-disposal-release law
and stop demanding retirement from the disposed loader.

The grammar varies unload errors, reentrant passes, disposal versus completion,
and successful-history width 1/2 and offset 0/1. The failed history starts at
width 1, offset 0 so its bounded prefix produces the held tie. Indexed sources,
other failure-window shapes, and public consumer timing are not claimed here.
The existing broad oracle continues to exercise its original wider grammar.

Reconstruction retains the original five-command CI history as a fixed
regression through the same ledger. Each directed history keeps its schedule's
required reach. Removing replay loses blocked retention; removing only the
successor truncate and completion loses completed retirement. Both builders
have bound controls for both omissions. A separate bound calibration retains
only superseded failed-lease observations and fails the completion comparison.
Fresh construction objects preserve the framework's builder association.

## Executed evidence

- **RED:** the exact CI replay above fails on `c647da132` while replay is pending.
- **GREEN:** the same seed, path, property, and generated unit pass with the
  corrected checkpoint. The original shrunk history also passes as a fixed
  regression through the shared comparison.
- **Reach:** each normal fixed/random campaign has two builders with five fresh
  histories each. Each builder enters its blocked-retention state and completed
  retirement five times. Each generated history must enter its branch's blocked
  state; histories that complete must enter completed retirement. Disposal ends
  that obligation. Normal campaign counts are recorded below.
- **Mutants:** whole-owner run `b1a9e5792202` passes 158 tests in each of two
  baselines and rejects four authored mutants: remove the successful-retirement
  replay guard; remove the failed-retirement replay guard; retain successful
  finite leases; retain superseded failed leases. All four are comparison
  failures, with no timeout, setup, or unrelated crash counted as a kill.
- **Refined failed schedule:** directed-only run `2b1307945c56` exposed a gap:
  the failed history's extra explicit retry could retire its failed lease before
  replay completion. Removing that retry closes the gap. Run `1ecbf79a7c6a`
  passes both 16-test baselines and rejects the same retained-failed mutant
  in the failed construction at `finite retirement after replay`. This is
  independent evidence at the new completion checkpoint, beyond the older
  fixed history that supplied the whole-owner run's first kill.
- **Final checks:** exact replay, named replay-manifest tests, DB test TypeScript,
  ESLint, formatting, changed-file lint, and the final whole-owner mutation run
  are recorded below. No existing oracle run budget is lowered or removed.

The gap command uses a temporary Vitest config that merges the package's
`vite.config.ts`, includes only `**/ordered-source-loader-state-oracle.test.ts`,
and disables coverage/typecheck with two workers. The directed-only probe adds
`testNamePattern: 'ordered-loader.replay-retirement'`. Temporary configs and
mutants are not shipped. Authored mutant replacements are:

| Mutant | Replacement |
| --- | --- |
| Early successful retirement | Replace the pending-replay clause in `retireSettledFiniteAcquisitions` with `false`. |
| Early failed retirement | Replace `if (this.subscription.hasPendingTruncateReplacement) return` with `if (false) return`. |
| Retained successful lease | Replace `: this.coversSource() ||` with `: false ||`. |
| Retained failed lease | Replace `(_, { superseded }) => superseded` with `() => false`. |

## Rubric and limits

ORC-001/002/003: authority, independent request ledger, and adjacent prose define
the law, grammar, driver, and comparison. ORC-004: fixed reconstruction, branch
bounds, and the four omission controls distinguish the legal schedules.
A builder cannot take an invalid window or unsupported ending back into its
arbitrary. ORC-005/006: real loader calls and release callbacks reach the cuts;
production mutants and bound observation corruption reject wrong results.
ORC-007: the same 100-history grammar and comparison run fixed and random,
with direct seed/path replay. ORC-008/009: the remembered finite leases retain
release identity across replay boundaries; `blockedReplayLeases` is test-only
observation provenance, not another production state machine.
ORC-010: existing comparison/cleanup capture retains primary mismatch and
separate cleanup diagnostics. ORC-011: no new shared-semantic-fault hypothesis
calls for a second formulation; accepted architecture distinguishes the old
and new checkpoint. ORC-012/013: this versioned record and adjacent blocked/
completed cuts bound the claim. ORC-014: no real-provider transfer is claimed.
ORC-015: two builders, required per-history reach, and bound omission controls
preserve generated reach. ORC-016: fixed regressions and calibrations use the
shared model, driver, and comparison through `oracleProperty`.

This repair establishes the controlled retirement checkpoint and its adjacent
lease observations. It does not establish public window timing, real-provider
scheduling, all replay callback compositions, or universal absence of leaks.
The required real-host witnesses remain unchanged. The mutation run is targeted,
not a full source audit. No production function changes, release changeset,
or new product law belongs to this patch.

### Final validation at the reviewed code head

Final whole-owner oracle-gaps run `735fc1f57f00`: 160 tests pass in each
baseline (20.1 and 19.3 seconds), no nondeterministic tests, four authored
mutants and four comparison kills, no targeted gaps. Its scope is the four
listed mutants, not all possible source edits.

A normal run without seed/path overrides passes all 16 directed tests. The
fixed campaign's generated histories reach successful retention 100 times,
failed retention 48, and completed retirement 47. The random campaign reaches
those states 100, 52, and 34 times. Each campaign's two constructed builders
reach their promised retention and completion states five times each.
The generated completion counts differ because disposal ends that obligation.

The exact CI replay passes (one selected test, 159 deliberately skipped).
The 70 named replay-manifest tests pass. DB test TypeScript, ESLint, formatter,
`git diff --check`, the commit's oracle-lint hook, and unchanged run budgets
pass. The shared no-leak check is still calibrated against retained failed
observations at completion. The final grammar differs from the first
whole-owner mutant run by removing the extra failed-history retry, adding
its bound completion calibration and the original fixed CI regression, and
adding TypeScript annotations and prose. No production bytes changed.
