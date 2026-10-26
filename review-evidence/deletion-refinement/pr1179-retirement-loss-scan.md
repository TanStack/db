# Retirement source loss audit against frozen candidate

This is one isolated, read-only source scan using the loss-audit instrument. It compares the source model with the frozen executable candidate. It does not judge whether to restore each item, run tests or mutants, establish a production defect, or claim overall closure. The sibling deletion-queue model and candidate were not read. Harness and native-driver files were read only to verify mechanics.

## Inputs and provenance

- **S:** `/Users/kyle.mathews/.codex/worktrees/pr-1179-review/tanstack-db/review-evidence/deletion-tla/retirement_oracle.tla` — SHA-256 `022908fa65f28d9e368f0c42d0806f2c873628e55b792142cdec84c975e2a749`.
- **R:** `/tmp/pr1179-loss-audit-frozen/retirement-oracle.test.ts` — SHA-256 `d4b7fc0d20d2158c0bf9a039b3f0f84a04a9cecc692c4a940d960ebce09cd224`.
- **T:** `/tmp/pr1179-loss-audit-frozen/truncate-readiness-oracle.test.ts` — SHA-256 `cd35e64c340135fe6699c4956961243af973eacfaf7722976f34365fcae7aa49`.
- Mechanics: `packages/indexeddb-db-collection/tests/idb-driver.ts` and `harness.ts` in the same review worktree. These were not part of the frozen candidate; their observed hashes were respectively `d0c2c3233aacb258d67f9018357846833822f16aca610e4182e714fa129ccf59` and `ad02c00f44836fb6eeff5d9052ad9c0b130b7447a3e7548fb8312251aa279b0e`.

Line references below refer to these exact inputs. Subsequent remediation outside the frozen directory is outside this audit.

## Recovered omissions

### R1. Per-caller truth and publication checks became joint terminal checks

**Source:** S149–160 makes caller settlement a distinct transition. S209–219 requires native commitment and, for accepted work or the finish policy, publication whenever that caller is fulfilled. `PrematureCaller` explicitly challenges fulfillment while the native transaction remains active.

**Frozen candidate:** R47–53 records only the caller's state and rejection reason inside its promise callback. R122 waits for both callers before R127–130 checks either caller, its native outcome, or its Collection rows. R197–200 similarly checks the accepted-work example after awaiting the caller rather than capturing its snapshot inside the fulfillment observer.

**Loss:** Checkpoint compression. An operation can settle too early, finish its missing confirmation while the other caller remains pending, and meet the pair's final assertions. The test can reject a permanently missing confirmation, but does not preserve the native/publication facts at each caller's first observed fulfillment.

**Related native-active interval:** R114–115 checks pending callers while the shared store gate still blocks all requests. After R121 releases that gate, there is no caller-time native snapshot or checkpoint between a request succeeding and its transaction completing. The native driver records only eventual `complete`/`abort` status (driver 41–61). Thus the frozen test's initial pending check is sensitive to immediate premature success but does not establish sensitivity to treating request success as transaction commitment. This is the same checkpoint loss, not a claim that request success is an additional source action: S104–107 explicitly says it is not modeled as commitment.

### R2. Mixed per-operation cuts disappeared when the graph became separate scenario families

**Source:** S162–174 allows each operation's decision, admission, native outcome, confirmation, handler completion, and caller settlement to advance independently, subject to S108–115's native FIFO/abort constraint. The two operations own different Collections on one descriptor (S7–11).

**Frozen candidate:** R90–137 exhausts kind pairs, native admission orders, native outcomes, and closure reasons, but closes only after both operations are admitted and before either native transaction finishes (R102–121). R175–203 holds already accepted sync work in a separate one-Collection scenario. R140–173 holds an application decision in another separate scenario. R245–269 places explicit closure at one native-complete continuation for a single operation.

**Lost legal source witness:** Operation 1 commits and accepts ordinary confirmation while its handler remains held; operation 2 is still awaiting its application decision, or is native-active; close the shared descriptor; operation 2 rejects or aborts and settles; operation 1 then completes its handler and publishes before success. The source permits this history. No frozen scenario combines those cuts on two Collections.

Other absent combinations include one operation already published or settled while the sibling is awaiting admission/outcome, and close after one operation's native commitment but before the sibling's admission. The candidate's local scenario coverage cannot establish these cross-operation histories merely because every individual cut appears somewhere.

**Loss:** Schedule compression and decomposition of interacting histories into separate categories. This is a concrete loss relative to graph enumeration; it does not establish that any such history fails production.

### R3. Application rejection is represented only after retirement and only through update

**Source:** `Decide(i, rejected)` is enabled independently of closure (S89–102). The modeled operation must then be not admitted and eventually reject, regardless of the other operation's progress.

**Frozen candidate:** The only explicit rejecting user handler is an `onUpdate` gate released after closure (R140–163). The pair matrix has no rejecting application handler. There is no open-connection rejection witness, no rejection-before-close witness, and no rejecting application handler mixed with an admitted sibling.

**Loss:** Category compression: application rejection and closed-connection refusal share one test outcome. In the tested rejecting case, closure already provides a separate reason not to admit a native transaction. That case cannot distinguish a wrong open-connection rule that ignores application rejection.

**Scope caution:** Do not mechanically demand rejecting user-handler cases for clear/import. Those utility paths do not expose the same user-handler admission API in this candidate. The source's common `Decide` abstraction needs a production mapping; its formal cross product alone does not create such an API.

### R4. The full retired-status invariant became a weaker event assertion

**Source:** `ClosedConnectionsDoNotBecomeReady` actually requires every existing Collection's status to equal `error` while the descriptor is closed, in addition to forbidding late startup readiness (S201–202).

**Frozen candidate:** R62–69 retains status-event strings, then checks the final status is `error` and the accumulated list contains no `ready`. It does not require the post-retirement event suffix to contain only `error`. A transient `loading` after retirement followed by `error` is not rejected by that predicate. Late startup at R168–170 has only final rejection/status checks and no event recorder.

**Loss:** Predicate weakening and loss of the retirement boundary in the event trace. The source's explicit fault switches mostly produce `ready`, so this is broader invariant coverage missing from the candidate, not a claim that the named `lateReady` fault would survive its final check.

### R5. Admission-before-error ordering has no callback-boundary witness

**Source:** S62–71 explicitly says retirement changes admission before exposing error. `Close` changes `open`, retirement, and statuses in one modeled step.

**Frozen candidate:** The status callback only appends a string (R62–65). New clear/import attempts occur after the close helper has returned and after the first caller settles (R164–167). No status-error callback tries a utility or late startup while retirement notification is being exposed.

**Loss:** Observation-boundary compression. Checking after `close()` returns cannot distinguish an implementation that notifies consumers of error before closing admission and fixes admission before returning. This is a missing refinement witness for the source's stated ordering, not an assertion that such reentry is currently broken.

### R6. Publication safety is mostly observed as final rows

**Source:** `OnlyCommittedWritesPublish` is a safety invariant at every modeled state (S214). `accepted`, `pendingSync`, and `published` separately retain the confirmation/application obligation (S120–147, S213).

**Frozen candidate:** R129–130 compares base/public rows after both callers settle; R191 does verify an already accepted ordinary confirmation remains queued while its handler is held. There is no base-row or change-event recorder during the pair's native-active and abort intervals.

**Loss:** Unobserved intermediate output. A wrongly published source confirmation that is later undone can agree with the final aborted rows. The candidate records status events, not the row-publication history. Optimistic visible rows are deliberately allowed before commitment; the distinguishing observation would concern authoritative base/application, not a blanket ban on optimistic public values.

The existing late-read cases do retain meaningful coverage: their deliberately changed snapshots and final base checks reject a persistent stale publication, and the status trace rejects the source's named `lateRead` readiness effect. This finding does not erase that credit.

## Transition correspondence

| Source transition                            | Frozen driver/checkpoint                                                            | Boundary retained or lost                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Init` (S37–60)                              | Two preloaded Collections in R99–100; separate initial-read case R205–233           | Two distinct owners retained. Initially loading plus concurrent writes is not crossed into the pair matrix.                                      |
| `Close` (S64–71)                             | All three reasons through R74–87                                                    | Explicit close and native versionchange paths retained. Callback-boundary admission ordering is unobserved.                                      |
| `FinishRead` (S73–78)                        | Held initial/replacement/targeted reads, R205–240                                   | Native readonly reach, final rows, startup outcome, and status events checked. Source read kinds retained; targeted read is additional coverage. |
| `RegisterLate`, `FinishLateStartup` (S80–87) | R168–171                                                                            | Final rejection/error and zero successful native admissions checked. Event history omitted.                                                      |
| `Decide`, `Admit` (S89–102)                  | Default accepting pair starts R110–115; delayed update decision R140–163            | Closed refusal retained; open rejection and mixed decision phases absent.                                                                        |
| `FinishNative` (S108–115)                    | Reverse-order abort calls R118–120; real gated transactions; terminal outcomes R128 | Commit/abort outcomes and FIFO durable fold retained. Caller-time native facts and independently scheduled local continuations omitted.          |
| `Confirm` (S120–133)                         | Final base rows; explicit close in native-complete listener R245–266; core T26–68   | Finish policy and replacement readiness have concrete paths. Source's arbitrary independent confirmation scheduling is not enumerated.           |
| `FinishHandler` (S138–147)                   | Explicit held handler R183–200                                                      | One-owner accepted-work continuation retained; mixed sibling phases absent.                                                                      |
| `SettleCaller` (S149–154)                    | R47–53 and final comparisons                                                        | Outcome retained; row/native state at settlement omitted.                                                                                        |
| `PrematureCaller` (S156–160)                 | Pending checks R114–115 and R192                                                    | Pre-release premature success detectable; post-request/pre-completion interval lacks the corresponding observation.                              |

## Invariants and challenged claims

| Source claim                                   | Frozen evidence and limit                                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TypeOK` (S178–199)                            | Primarily model integrity. The executable candidate uses types and declared inputs; it need not reconstruct all internal TLA fields.                                                                                     |
| `ClosedConnectionsDoNotBecomeReady` (S201–202) | Final error plus no recorded ready; weaker than an all-error retired suffix.                                                                                                                                             |
| `ReadAuthority` (S203)                         | R205–240 checks blocked read completion cannot replace final base/public rows or restore readiness. No joint read/write schedule or row-event trace.                                                                     |
| `AdmissionAuthority` (S204)                    | R149–171 checks no successful native transactions after held update decisions and utility/late attempts. Retirement callback cut absent.                                                                                 |
| `NativeAdmissionAccounting` (S205–208)         | Native entry count and terminal status are checked. The source queue equality is internal model accounting, not an independent public product law demanding an identical queue in the oracle.                            |
| `TruthfulSettlement` (S209–212)                | Commit/abort results checked after joint completion; exact caller-time native state omitted.                                                                                                                             |
| `AcceptedWorkIsAccountedFor` (S213)            | Held ordinary confirmation is initially queued, then appears after handler release; no discard allowed in this one-owner witness. Intermediate accounting and mixed sibling continuation are not enumerated.             |
| `OnlyCommittedWritesPublish` (S214)            | Final abort/commit base rows checked; premature transient base publication unobserved.                                                                                                                                   |
| `AcceptedWorkPrecedesCaller` (S215–216)        | Final rows and held-work example support ordinary behavior; precise per-caller cut is lost.                                                                                                                              |
| `FinishPolicyConfirms` (S217–219)              | Candidate explicitly owns finish policy, and every committed kind has a confirmation check. Same settlement checkpoint limit applies.                                                                                    |
| `EverySuccessIsConfirmed` (S221–224)           | Required under the chosen finish policy. The suppress-policy counterexample is intentionally outside the candidate.                                                                                                      |
| `StrictPublicationSilence` (S226–228)          | Explicitly challenged, not a default invariant. R175–203 correctly preserves accepted work that publishes after closure while status remains error. Do not turn this challenged claim into a required silence assertion. |

## Progress assumptions

S230–242 states conditional liveness: application decisions and native outcomes eventually arrive, and each enabled admission, confirmation, handler-completion, and caller-settlement continuation receives weak fairness. It does not require an uncooperative user handler or unmanaged browser blocker to finish. It also does not add fairness for close, reads, or late startup.

The candidate supplies specific cooperative environments: it releases or rejects the application gate, releases the native gate, and then awaits caller completion. The held application case checks the caller remains pending before the decision arrives (R153), and the pair checks callers remain pending while native work is blocked (R114–115). The unmanaged inspector intentionally prevents administrative upgrade/delete completion until cleanup (R74–87); administrative success is not mistaken for Collection-write completion.

These are finite completion witnesses. A permanently missing continuation can produce a test timeout, but the candidate does not enumerate fair executions, prove eventual completion, or independently hold and release both owners' local continuations. Absence of browser-blocker progress is not a gap against this source. The source itself does not promise unconditional liveness.

## Fault controls and calibration

The following maps named source controls to candidate sensitivity by inspection. It is not an executed mutant result. No tests or mutants were run in this scan, and no external review record was inspected. Later RED evidence supplied to the parent is outside this frozen-file audit.

| Source fault                  | Nearby frozen witness                                           | Calibration conclusion                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explicitClose` (S67–71)      | Every explicit-close status assertion                           | Persistent missing retirement should fail final error checks.                                                                                                                                                                                  |
| `lateRead` (S75–78)           | R205–233                                                        | Changed stale rows and any restored ready should fail.                                                                                                                                                                                         |
| `lateReady` (S85–87)          | R168–170                                                        | Persistent late ready should fail final rejection/error checks.                                                                                                                                                                                |
| `admitClosed` (S97–102)       | R149–171                                                        | Successful native admission after closure should fail zero-entry checks. A real closed native descriptor can also independently reject admission; calling its transaction method and successfully admitting a transaction are different facts. |
| `truncateReady` (S132–133)    | Retired clear/import cases; T45–59 with final `markReady:false` | Both final error preservation and notification status have distinguishing cells. T47–48 says the pre-fix run can reach assertions, but the comment is not an executed result.                                                                  |
| `dropAccepted` (S141–147)     | R175–203                                                        | Persistent loss of accepted ordinary work should fail base-row assertions.                                                                                                                                                                     |
| `rejectCommitted` (S152–154)  | Committed pair outcomes R127; accepted work R198                | Invented rejection after commitment should fail outcome assertions.                                                                                                                                                                            |
| `prematureSuccess` (S156–160) | R114–115 before gate release                                    | Some early timings are sensitive; post-request/pre-completion success lacks caller-time native/publication capture.                                                                                                                            |

The frozen files contain normal commit/abort fault injection and controlled delays, but no executable wrong-answer comparison, deliberate wrong-design branch, or recorded killed-mutant result. Therefore the named source control set has not been carried into self-contained calibration evidence in these files. This is an evidence omission, distinct from a demonstrated inability of each assertion to detect its fault. Ordinary native abort is an allowed environment outcome, not by itself calibration against a wrong oracle or implementation.

## Finite matrix versus graph enumeration

R90–137 contains 150 kind/order/reason cells, each running four native-outcome combinations: 600 pair executions if the full suite completes. Additional families contain six held-decision executions, nine accepted-work executions, nine read executions, and five native-complete/explicit-close executions. T23–26 adds 54 core readiness cells. These counts describe authored finite schedules, not reachable-state counts or independent oracle definitions.

The source graph can interleave each operation's stages and close among those stages. The candidate fixes most event orders and covers extra cuts in isolated scenarios. Both native admission orders and all outcome pairs do not imply all local continuation orders, mixed cuts, or read/write overlaps. R17 honestly states that the schedules are not every TLC interleaving; the larger phrase “cover the semantic cuts” should be read with the concrete cross-operation omissions above.

## Exclusions that are not lost obligations

- The candidate explicitly chooses `Policy=finish` (R3–4). The source's suppress-policy cost is not an unimplemented candidate requirement.
- Strict publication silence is deliberately false for accepted work after closure. Preserving that publication is required, not a defect.
- Source operations own different Collections. Two optimistic writes inside one Collection are explicitly delegated away in S7–9.
- Source replacement confirmation publishes immediately (S117–133). A separate pending replacement-confirmation phase is not a source requirement merely because ordinary confirmation has one.
- Core cleanup, reconnect generations, repeated-close semantics, row CRUD admission, and arbitrary browser-blocker cooperation are outside the source's stated contract or grammar.
- The source combines insert/update into `put`; the candidate expands them. Its row fold and durable restore checks add evidence beyond the source's authority/receipt abstraction.
- The core truncate candidate supplies a real boundary for preserving error during replacement; ordinary later truncate recovery in T65–68 is compatible with core behavior. It does not authorize a retired adapter to issue new replacements that restore readiness.

The retained evidence is substantial but bounded. The recovered items identify where distinctions in this source were compressed or left unobserved in the frozen candidate; they do not establish closure or prescribe which omissions to restore.
