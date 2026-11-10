# PR #2302 external retirement review evaluation

No law change needs a decision. The asserted public stale-window defect did not reproduce at the current PR head, with every stated reentry premise reached through real Collection and Effect consumers. Three useful coverage/comparison gaps are repaired in a test-only working diff. No production code was changed.

Reviewed and current remote head: `5e3cb22a4c94c9c64889bc6537976a62b8341dcf`; base `bea84cd4554b7bd49df50cb0c569a34d8b2cd915`. Final remote read reports the same head and updatedAt `2026-10-29T21:03:45Z`. Worktree: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/review-pr-2302`.

Final oracle SHA256: `d14d6e0690619dc5456423449406e68b251987795bbca3032df405b4e96d1187`. Production loader SHA256 remained `1dfb9733f02c56807b1deb7904d24e6331b815a8b12386fef7bdbf691fe6ea2a` throughout normal runs. Temporary mutants were restored in `finally`. `oracle-repair-v1.patch` contains the only repository change. Main checkout, published history, PR state and coordinator ledgers were untouched.

## Laws, experiments, and inference

| Law and authority | Original evidence | New decisive evidence | Result |
| --- | --- | --- | --- |
| A qualifying newer ordering invalidation must be repaired before replacement publication. ARCHITECTURE.md, Ordered requests/continuation/recovery and Atomic window publication; Effect callback gate. | Directed request ledger checked a later authoritative start. Real Collection receiver checked final rows and one publication after drain. It did not cover Effects or a held newer answer. | Shared event-ordered epoch/start-before-publication relation; real Collection and Effect paths; held replacement retains previous window and emits no callbacks; final rows from independent full-provider sort; no later external graph input. All pass on unchanged production. A public-method probe confirmed reentrant loadMore inside 99/99 Collection and 103/103 Effect unload histories. | The review's same-path stale-publication consequence is refuted within these bounds. Recursive immediate dispatch is not required: scheduled graph work preserves the public gate. Missing receiving coverage is fixed. |
| Retirement callback invalidation must compose with existing release, failure, reset/disposal, replay and continuation laws. Same architecture plus existing primary owner. | The callback was a boolean in the case type but absent from the broad arbitrary; the directed lane varied parameters around one history. | Broad callback axis plus constructive retirement prefix and generated command suffixes, crossing existing scenario flags. Per-campaign reach counts below. Original-debt-clearing and delayed-one-pass mutants fail. | Missing grammar composition confirmed and fixed. Original property was generated, not literally one pinned input; its history shape was too narrow. |
| Cursor reset discards boundary provenance; pre-reset work belongs to replay; replay bookkeeping is not a graph pass. ARCHITECTURE.md Ordered requests and staged-continuation paragraphs, not resetCursor implementation. | Current driver kept continuationOwed across replay bookkeeping, cleared it on truncate and staged it only from current-generation settlements. | Existing handoff/reset generated lane and shared fixed replay pass. Restoring bookkeeping consumption fails all three selected checks at the shared no-leak comparison. Inline prose now identifies the field as model-only request-classification provenance and cites the contract. | Model-hacking accusation refuted. The correction changes the driver's attribution of a later request, not the product law or an expected row. No production resource-leak claim follows. |

The shared checker rejects wrong observations before invalidation, in the old observer epoch, and after publication. The original boolean helper accepts adversarial old-epoch and after-publication observations. The controlled request ledger has no public callback observation; its progress result is deliberately combined with the real consumers' publication comparison. An observer epoch describes source events at request issue, not an inspection of production's internal request stamp.

Neighboring obligations remain explicit: complete full-source coverage absorbs ordering invalidation; reset transfers old requests to truncate replay; disposal ends loader obligations; an unanswered authoritative request retains the documented no-timeout limit; the loader's own failure can wait for explicit retry. Broad callback generation initially made the new progress premise too broad in these regimes. The v2/v3 failing logs record this oracle-premise error; they are not product RED evidence. The final check follows the unchanged contract and runs after explicit retry. The quiet-report premise also excludes the newly introduced callback side effect, consistent with that law's existing opening prose.

## Lossless finding ledger

Raw source and its SHA256 are retained in the original creation events of `claims.jsonl`, including item 2's duplicate/garbled paragraph. Latest verdicts are append-only events.

| ID suffix | Technical validity | PR action/disposition | Durable value |
| --- | --- | --- | --- |
| 01 | The missing Effect/held-answer coverage is real. The alleged public failure does not occur in the same-path bounded probes, including actual reentrant loadMore. | `fixed-now` for coverage. No production repair or recursive dispatch. | Real consumer gate coverage, held-answer and no-later-external-input witnesses. |
| 02 | Helper was too weak by itself; the whole receiver already had a separate publication assertion. The review did not provide an executable delayed-pass mutant. | `fixed-now`: event/epoch/publication ordering and adversarial calibration. | Delayed-one-pass mutant is rejected by both progress paths; event faults are retained. |
| 03 | Broad arbitrary omitted releaseInvalidates; the directed property had one command-history shape. | `fixed-now`: broad callback axis, generated suffixes, measured cross-regime reach. | Adjacent lifecycle histories, including later chains. |
| 04 | No unauthorized product-law rewrite found. Architecture independently supports reset and graph-continuation provenance. | `refuted`; added inline mapping/citations and coverage proposal. | Keep the handoff/reset generator and bookkeeping-ablation calibration. |
| 05 | Original finite domains were 8 and 32 inputs, with repeated samples. Enumeration would be a valid optional optimization. Setting random numRuns equal to domain size does not give equivalent coverage. | `stale` after history expansion; no budget reduction or optional enumeration refactor. | Deterministic sample evidence: at seed20261029, 8 draws reached5/8 receiver cases; 32 draws reached21/32 controlled variants; 200 reached8/8 and32/32. Current receiver has64 cases, and controlled suffix grammar is much larger. |

Totals: 5 raw items = 3 fixed-now + 1 refuted + 1 stale. No item was erased or merged. No new production sibling violation was found. No authorized implementation work is being deferred. The optional enumeration idea remains here as a durable source-level improvement, not as an unclosed bug.

## Verification and reach

`experiments.jsonl` records exact argv, cwd, head, selected environment, before/after source hashes, exit, raw log path and log hash for frozen experiments. Earlier exploratory logs are retained separately and are not substituted for final hash-bound evidence.

- `final-neighbors-v3`: 4 files, 104 tests GREEN, one worker and no file parallelism; final bytes exactly match the hash above. It covers the complete state owner, ordered-source-loader oracle, ordinary demand retirement suite and load-subset replay refinement owner.
- `scoped-types-v2`: GREEN on final oracle and transitive imports. v1 found a real optional-narrowing error in the new successor-chain diagnostic; corrected without changing a product expectation.
- Final lint receipt is `lint-changed-final-v2`; initial `lint-changed-v1` was GREEN. Prettier and git diff --check pass; no lint suppression or run-budget change was added.
- `mutant-original-debt-clear-v2-both-consumers`: four selected tests fail at progress/held-start assertions, including independent held Collection and Effect replay failures. Source is restored afterward.
- `mutant-delayed-one-pass`: both selected fixed campaigns fail at progress comparison. This artificial delay is not claimed to be an exhaustive model of every scheduler defect.
- `mutant-replay-consumes-continuation`: shared fixed replay and both generated handoff campaigns fail at the existing no-leak comparison. No setup error or timeout is cited as a mutant kill.
- Permanent calibration rejects old-epoch, pre-invalidation and after-publication start observations through the same checker.

Final-neighbors-v3 counts (completed generated histories, fixed/random):

| Declared state | Fixed | Random |
| --- | ---: | ---: |
| Directed retirement callback | 90 | 81 |
| Real Collection unload | 98 | 103 |
| Real Effect unload | 102 | 97 |
| Broad retirement callback | 3596 | 3412 |
| Broad callback + release error observed | 1558 | 1410 |
| Broad callback + reentrant truncate observed | 606 | 595 |
| Broad callback + disposal observed | 645 | 605 |
| Broad callback + reentrant pass observed | 743 | 721 |
| Broad callback + offset one | 1783 | 1705 |
| Broad callback + timer-enabled scenario | 1775 | 1679 |
| Broad callback + full-source plan | 88 | 113 |
| Broad callback + multiple later authority starts | 860 | 835 |
| Replay deferred-refill | 11 | 8 |
| Replay reset-continuation | 30 | 30 |

Timer-enabled reach does not prove an executed backoff retry in that same history. Full-source-plan reach does not imply complete held full-source coverage at the callback. Reset/disposal overlap counts mean both events occurred in the history; they do not establish every possible ordering. The real callbacks do not compose failures, truncate or disposal inside unload. The coverage proposal replaces the old statement that every directed campaign reached200 callbacks; that is no longer true after widening the grammar.

## Reviewer assessment

Hire recommendation: yes for test-gap and invariant review, with reservations about unexecuted correctness conclusions. Items2/3 identify concrete, useful comparison/grammar weaknesses, and item1 identifies a receiving-path omission. The production prescription in item1 was not justified by a same-path counterexample; it would add recursive work without evidence it is needed. Item4 overlooks independent architecture authority. Item5 correctly notices repeated finite sampling, but treats equal run count as enumeration. Prioritization usefully put publication first; fix quality is mixed. Future reviews should distinguish a deficient isolated check from the complete oracle chain and execute proposed mutants before claiming survival.

## Oracle audit and limits

An independent read-only agent reviewed the final test hash and retained experiments and found no actionable oracle defect. Its bounded assessment is retained in `independent-audit-v1.md`; it ran no tests or mutations.

ORC accounting: 001–003 are supplied by existing architecture authority, independent provider sort/event relation, and literate inline explanations. 004 uses constructive prefix + suffix and existing bounds; disposal/full-source/reset neighbors distinguish valid exceptions, while pre-invalidation/old-epoch/late-publication observations are rejected. 005–006 have real receiving-path reach, actual reentry probe and hostile mutations. 007 retains fixed/random parity, property identities and all run budgets; existing seed/path replay selection remains, and fixed shared-model regression covers the historical handoff despite the expanded arbitrary's changed sampling. 008–009 map continuationOwed to model-only provenance; retained reset versus bookkeeping histories distinguish its states. 010 keeps full raw failures/secondary logs and finally restoration; the real receiver does not inject cleanup faults. 011 uses provider full sort beside event progress to reject a request that starts but returns the wrong window. 012 is this head/hash-bound review record. 013 distinguishes retired-lease eviction from qualifying invalidation, held versus completed replacement, and current versus reset continuation. 014 supplies actual Collection/Effect subscription unload; no network-provider extrapolation. 015 separately measures each new receiving path and broad interaction. 016 retains shared model/driver/comparison for pinned replays and calibrations; no new unit-answer table or concrete type assertions are added.

Bounds: one qualifying invalidation inside each real callback, distinct finite numeric ranks, ascending root order, one source, one consumer, width1/2 and offset0/1. Provider-specific transports, arbitrary callback composition, framework rendering and obsolete later cursor-demand retirement (#2223) are not established. Random GREEN is not a proof for every history. No public resource leak was reproduced.

## Integration and PR readiness

The item accounting and scoped evaluation/repair are complete. `oracle-repair-v1.patch` and `coverage-proposal-v1.md` are ready for coordinator integration. No commit, push, PR comment, PR-body change or history rewrite was performed. Offline frozen install needed no override and changed no tracked dependency input.

Whole-PR readiness remains **unproven by this subtask**: the test-only repair and coverage proposal are uncommitted and not integrated, and this task did not own final CI/combined-tree verification. Prior published readiness is historical. No confirmed production blocker under these five findings remains within the tested domain.
