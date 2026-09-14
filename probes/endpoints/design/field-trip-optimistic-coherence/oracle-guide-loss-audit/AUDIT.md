# Guide loss audit

The frozen candidate preserves the guide's main semantic rules: independent expected results, ordered comparisons where order is promised, coherent publications, separate authority obligations, and precision assertions that can reject needless refetches. Six narrower requirements are missing or weaker in parts of the proposed test portfolio. These are losses in test design or evidence, not demonstrated Endpoints production bugs.

## Scope and method

- Sole source: [GUIDE.md](GUIDE.md), gist revision `5d9c035943dea8063b140267ef4206f46c28f102` in [manifest.json](manifest.json).
- Candidate: only the 18 files under `frozen/` listed in that manifest. The guide and all 18 candidate hashes matched the manifest.
- One fresh-context source pass using the Field Lab `loss-audit` instrument. No sibling research or agent findings informed this reading. The SQL grammar documents were read as frozen candidate material, not as independent support for the guide.
- Static inspection only. No production changes, test execution, or mutant run. Imported files outside the frozen set were not inspected; absence of their evidence here does not establish absence elsewhere.
- Mechanisms below describe the observable reduction. Unless a candidate states a deferral, the mechanism is an inference from its structure, not a claim about an author's intent.

Paths in the ledger are relative to `frozen/probes/endpoints/`. `oracles/` abbreviates `integrated-todo/tests/oracles/`; `grammar/` abbreviates `design/field-trip-optimistic-coherence/sql-effects-grammar/`. Line numbers refer to the unchanged frozen files. IDs are stable labels, not a ranking.

## Supported losses

### LA-01 — Shrinking preserves a red exit, not the original violation

**Guide:** “Test the test—and keep the same failure,” especially [lines 255–274](GUIDE.md). Preserve the violated law, checkpoint and distinguishing evidence; retain original and reduced traces; distinguish reproduction from setup failure.

**Candidate:** `ORACLE-PLAN.md:161–175` asks for shrinking, replay and the first bad checkpoint, but does not require an invariant failure predicate. `SQL-EFFECT-RULES-PLAN.md:105–107` compresses this to saving seeds and shrink paths. `oracles/sql.mjs:102–117` and `oracles/concurrent.mjs:356–403` submit the entire execution to `fc.check` and accept its failing counterexample without comparing the failure's law or phase with the first failure. `oracles/compiled-dependencies.mjs:296–325` and `oracles/dependencies.mjs:477–501` similarly use `fc.assert` with arbitrary thrown errors. Direct replay at `sql.mjs:96–98` and `concurrent.mjs:352–354` has no original-failure identity to validate.

**Exact loss:** A shrink that changes a row mismatch into a compilation, readiness, gate or cleanup error still counts as a failing property. The final counterexample is correctly selected in the concurrent runner, but that does not establish that it reproduces the same accusation. SQL saves attempted scenarios before their execution (`sql.mjs:57–70`), which preserves useful inputs, yet the report does not pair an original failure identity with a reduced failure identity. Compiled runners retain a generic error report, not the guide's explicit original/reduced trace and replay-verdict structure.

**Mechanism:** Compression of semantic reproduction into fast-check's failure/replay machinery.

**Evidence status:** The missing predicate is directly visible in the inspected runners. Failure drift has not been induced. Code/dependency revision and relevant environment are also not consistently present in these runner reports, limiting the provenance requested at guide lines 268–273.

### LA-02 — Cleanup loses its separate failure and resource obligations

**Guide:** “Preserve the violation,” [lines 261–274](GUIDE.md), distinguishes primary failure, secondary cleanup diagnostics, and releasing resources.

**Candidate:** `ORACLE-PLAN.md:107,136–139` requires reliable teardown but does not carry those three obligations separately. `oracles/driver.mjs:731–742` suppresses control-release errors and awaits `context.close()` in `finally`; a close error can replace the assertion and prevent the subsequent `Promise.allSettled`. `driver.mjs:790–795` closes browser, server, reference and directory serially, so an earlier rejection prevents later cleanup. `oracles/concurrent.mjs:267–275` suppresses gate and route errors and can replace the original failure with unroute/close errors. `oracles/compiled-dependencies.mjs:253–262` has the same error-replacement and early-abort shape. SQL/concurrent reports are written before `driver.close()` (`sql.mjs:132–139`, `concurrent.mjs:417–424`).

**Exact loss:** A useful primary mismatch can become a teardown failure; some cleanup failures are discarded; a report can say `ok: true` before a later close fails. There is no separate cleanup diagnostic channel in those reports and no guarantee that all release attempts occur after an earlier cleanup error.

**Mechanism:** Category collapse: cleanup is treated as a `finally` block rather than three distinct responsibilities.

**Evidence status:** These control-flow properties follow from the code. No actual resource leak or failing cleanup run was observed.

### LA-03 — Some optimistic expectations borrow the state they should judge

**Guide:** “Start with agreement, then the model,” [lines 72–74](GUIDE.md), and “Know where the expected answer comes from,” [lines 141–151](GUIDE.md). Keep expected records and semantic reasoning independent and state which world determines the observation.

**Candidate:** `ORACLE-PLAN.md:37–43,61–74` preserves the stronger rule explicitly. In `oracles/compiled-dependencies.mjs:155–158,190–205`, however, `before` comes from actual client collections and then supplies expected optimistic rows and membership. No independent baseline comparison occurs between preload and that capture. In `oracles/dependencies.mjs:204–217,281–298`, actual collection state likewise determines optimistic expectations and the baseline retained for unselected queries.

**Exact loss:** The compiled runner cannot reject a wrong initial row retained in an untouched collection at its immediate optimistic checkpoint: the same wrong row is copied into the expected side. A wrong pre-action presence/absence can also determine whether expected insert/update optimism appears. Later independent PostgreSQL comparisons still protect settled compiled results; this loss is specific to the immediate law. The dependency runner intentionally preserves unrefreshed baselines in the presence of unrelated external writes (`dependencies.mjs:219–229`), so substituting current server truth everywhere would change its contract. The lost requirement is an independently tracked admitted baseline, not mandatory freshness after every external write.

**Mechanism:** SUT-state borrowing replaces part of the independent reference state.

**Evidence status:** The shared authority for expected values is explicit in the code. No observed wrong baseline or production failure is claimed.

### LA-04 — The concurrent path drops the available same-turn observation

**Guide:** “Control the event, not just its returned Promise,” [lines 161–174](GUIDE.md), and “Check incremental results and publication separately,” [lines 217–225](GUIDE.md). A later settled read cannot recover a synchronous mismatch repaired before it runs.

**Candidate:** `ORACLE-PLAN.md:88–97` promises immediate optimistic effects and named observable boundaries. `oracles/program.mjs:127–132` captures `rows:snapshot()` inside the synchronous `invoke` call. The sequential driver passes that capture into its comparison (`oracles/driver.mjs:510–525`). The concurrent runner receives the same result but checks only `isPromise` and `hasPersistence` before calling a later checkpoint (`oracles/concurrent.mjs:157–163`). That checkpoint awaits reference SQL before reading SUT state (`concurrent.mjs:104–108`, `driver.mjs:373–376`).

**Exact loss:** Concurrent histories have no assertion over the invocation snapshot already captured by the fixture. Source-notification recording remains valuable and can catch bad publications, but it does not necessarily observe a wrong immediately readable state that changes before a notification. The sequential path retains this distinction; its coverage does not give the concurrent path the same credit.

**Mechanism:** Observation loss at a shared driver boundary: the captured value is discarded while two callers appear to use the same checkpoint machinery.

**Evidence status:** Directly demonstrated omission in the harness. No same-turn production defect was injected or observed.

### LA-05 — Consumer equality is reduced to IDs after rendering

**Guide:** “Observe what the contract promises,” [lines 201–207](GUIDE.md), distinguishes membership, values, order and downstream views; “Check incremental results and publication separately,” [lines 219–225](GUIDE.md), keeps their observation points explicit.

**Candidate:** `ORACLE-PLAN.md:95–97` says every active collection and consumer agrees with reference rows and order. `oracles/driver.mjs:373–382` compares complete collection rows, but `driver.mjs:383–406` reads the React consumer only after two animation frames and compares `data-row` IDs to expected IDs. `oracles/concurrent.mjs:63–64` names React consumers in its scope and delegates to this same check at line 128.

**Exact loss:** The downstream assertion protects eventual membership/order at that checkpoint, not projected consumer values or every visible render. A consumer that displays stale text for the correct IDs can pass this comparison even if collection values are correct. Source-notification row checks protect a different path and cannot establish that React rendered the right values. The broad consumer claim has no matching value observer or explicit narrowed statement at this boundary.

**Mechanism:** Projection and checkpoint compression: full consumer equality becomes an ID list after a publication turn.

**Evidence status:** Assertion scope is visible in code. No stale React rendering was observed; no additional notification-count or error-identity promise is inferred.

### LA-06 — Proposed fault controls do not yet have per-law execution receipts

**Guide:** “Make the comparison prove its usefulness,” [lines 102–108](GUIDE.md), and “Test the test,” [lines 239–253](GUIDE.md). Property selection, path reach, comparison execution and rejection of the intended wrong answer are separate claims; distinguish value rejection, timeout, setup failure, unreached code and survival.

**Candidate:** `SQL-EFFECT-RULES-PLAN.md:79–107,121–136` specifies useful omitted-effect and needless-fallback mutants and separate expected verdicts. `ORACLE-PLAN.md:167–185` retains transition witnesses and rejection for the expected reason. The frozen compiled runner records aggregate compilation, operation, authority and read counts (`oracles/compiled-dependencies.mjs:38–48,242–251`) and a generic exception (`:324–326`). Its mutation hooks at `:81–99` do not record which changed operation ran or which assertion rejected it. The SQL/concurrent runners report a generic exception and aggregate counts (`sql.mjs:121–139`, `concurrent.mjs:393–424`). The new grammar correctly describes its controls as analytical, with independent range untested (`grammar/EVIDENCE.md:3–5,70–73,89–90`).

**Exact loss:** The test proposal retains the intended controls but does not yet specify or implement the evidence record that distinguishes a relevant assertion rejection from an incidental red run for each new rule/authority cell. A campaign-level count cannot establish that a particular hidden-read, empty-output, cold-baseline or unknown-effect cell reached and exercised its named comparison. Existing README receipts for `omit-order` and `early-settlement` (`oracles/README.md:170–182`) are narrower positive evidence, not receipts for the new effect checker.

**Mechanism:** Compression from per-law reach and sensitivity into campaign totals and generic failure reporting.

**Evidence status:** Missing executable evidence/receipt contract in this frozen candidate. The checker is explicitly unimplemented; this finding does not relabel analytical controls as failed tests or establish an unreached mutant.

## Preserved requirements

| ID | Guide requirement | Frozen candidate preservation |
| --- | --- | --- |
| LP-01 | State the promise, production path, reference, checkpoint and limits; a partial oracle can be useful (`GUIDE:15–43`). | `ORACLE-PLAN:10–46,86–116,187–192`; `SQL-EFFECT-RULES-PLAN:12–25,66–75`; `dependencies.mjs:15–20,48–53` names its in-process transport boundary. The compiled runner's Start stub at `compiled-dependencies.mjs:123–140` is not evidence for real HTTP. |
| LP-02 | Use independent expected reasoning and complementary formulations (`GUIDE:61–74,227–237`). | `ORACLE-PLAN:37–46`; `SQL-COVERAGE-PLAN:42–46`; `SQL-EFFECT-RULES-PLAN:105–107`; `reference.mjs:3–13,85–112`; `effect-reference.mjs:24–53` spells out trigger consequences separately. LA-03 identifies a scoped exception, not a loss of every reference. |
| LP-03 | Distinguish worlds and relevant ownership/state (`GUIDE:124–151`). | `ORACLE-PLAN:61–84` separates confirmed truth, whole-row optimism and ownership. `grammar/MODEL:12–15,27–28,43–45` keeps effect proof and collection authority separate. Neither a server commit nor a missing baseline is reduced to a row snapshot alone. |
| LP-04 | Generate legal transitions and control actual events (`GUIDE:98–100,153–199`). | `reference.mjs:114–142` chooses rows from reference state; `driver.mjs:507–530` arms the write boundary; `concurrent.mjs:172–210` independently varies write and response order. `SQL-COVERAGE-PLAN:48–51` requires dependent shrinking and separate invalid-input generation. |
| LP-05 | Preserve order, bags and permitted nondeterminism (`GUIDE:59,205,215,225,233`). | `ORACLE-PLAN:95–97`; `SQL-EFFECT-RULES-PLAN:100–103`; `grammar/MODEL:73–74`. The new proposal explicitly avoids pretending that an index-preserving relation footprint fixes the members of an underordered LIMIT. |
| LP-06 | Compare accumulated incremental events and publication snapshots separately (`GUIDE:209–225`). | `program.mjs:122–135` keeps a raw event list; `concurrent.mjs:104–129` compares captured complete rows, folds changes, then checks final collections. Canonicalizing the folded unordered membership check does not erase the separate ordered row check. |
| LP-07 | Test both values and optimization claims; passing one is not passing the other (`GUIDE:104–106,205–207,237`). | `SQL-EFFECT-RULES-PLAN:92–107,121–124`; `grammar/MODEL:62`; `grammar/BRIEF:41–44`; `compiled-dependencies.mjs:233–248` contains separate row and read-count assertions. The proposed needless-restriction mutant is a real preservation of this distinction. |
| LP-08 | Separate observed evidence, limits and open promises; do not treat used design cases as held out (`GUIDE:276,278–310`). | `SQL-COVERAGE-PLAN:20–27,74–92`; `grammar/EVIDENCE:3–5,70–90`; `grammar/BRIEF:46–60`. Kitchen is explicitly source material, range remains untested, and no measured performance claim follows from the proposed calculus. |

## Explicit deferrals and scope limits

These requirements remain visible. Their absence from current execution is not a silent loss or a reason to restore them during this audit.

| ID | Guide concern | Candidate disposition |
| --- | --- | --- |
| LD-01 | Distinguish support owners, unloaded versus absent, window results versus resident rows (`GUIDE:124–139,153–159`). | On-demand transport is explicitly deferred in `SQL-COVERAGE-PLAN:94–127`; the future model keeps extents, ownership, completeness, stale responses and readiness. No current Endpoints subset oracle is claimed. |
| LD-02 | Reach histories after recovery and across overlapping lifetimes (`GUIDE:155–159,176–191`). | `concurrent.mjs:65–68,336–341` explicitly excludes interleaved cohort retirement and refers lifecycle/reentry to separate runtime tests. Those external tests were not frozen, so their coverage is unverified here. The guide's illustrative early-rejection schedule is not imposed on this candidate's stated cohort settlement contract. |
| LD-03 | Preserve needed state without inventing an implementation-sized universal model (`GUIDE:126–151,288–294`). | `ORACLE-PLAN:82–84,153` defers derived writes and later query shapes pending semantics. `grammar/MODEL:64–77,81–89` states table-level precision limits, unresolved binder/language support and deployment matching. |
| LD-04 | Check real provider/adapter boundaries and credit only that path (`GUIDE:193–199,284–286`). | `oracles/README:184–204` states original browser and publication bounds; lines 36–39 and the concurrent runner supply later notification coverage. It is wrong to treat the historical “not every publication” sentence as a blanket current absence, or the current concurrent coverage as covering every other runner. |
| LD-05 | Do not infer universal freshness or durable behavior from a finite successful run (`GUIDE:205–225,300–310`). | `ORACLE-PLAN:187–192` retains separate durability/browser/auth/deployment concerns. `grammar/PRESERVATION:25`, `grammar/MODEL:75–77`, and `driver.mjs:684–708` preserve the external-write signal and continued-read-failure limits. |
| LD-06 | Keep untested language families and unsupported environments visible (`GUIDE:284–286,296–310`). | `SQL-COVERAGE-PLAN:53–92,129–149`; `SQL-EFFECT-RULES-PLAN:125–136` distinguishes supported, unknown, invalid and proved-independent work. No PostgreSQL-wide coverage is claimed. The proposed checker and its new metamorphic tests remain unimplemented (`SQL-EFFECT-RULES-PLAN:3–6`). |

## Non-findings and boundaries of the reading

- The guide's examples are not universal product laws. This audit does not demand all possible observables, a fixed run count, universal error identity, exact callback counts, or a particular completion order.
- `program.mjs:121,130–131` stores Promise outcome state by token. A Promise already has a once-only settlement contract. That alone does not establish that a required duplicate protocol-completion observer has been lost.
- `compiled-dependencies.mjs:50–53` normalizes `id/value` rows. Its generated queries at `compiled-program.mjs:49` have no promised ordering, so sorting that result is not itself an ordering bug. The broad full-stack ordered comparisons are different evidence.
- The compiled SUT and reference share `ddl(program)` (`compiled-program.mjs:8–40`, `compiled-dependencies.mjs:76`). This is a shared semantic fixture dependency and limits how independently those tests validate schema construction. It does not by itself make PostgreSQL's effects on that actual schema an invalid authority or prove a missing-effect bug.
- The old compiled read-count expectation explicitly requires broad fallback for an opaque expression index (`compiled-dependencies.mjs:218–232`), while its body is `lower($1)` (`compiled-program.mjs:19–26`). The new proposal explicitly rejects that restriction (`SQL-EFFECT-RULES-PLAN:7–10,81–94`). This is a disclosed old-versus-proposed contract conflict, not an unnoticed preservation of the old rule. No implementation fix was selected by this audit.
- No priority, repair ranking or decision to restore each recovered item follows from this reading. The single source has been traced through preserved requirements, six supported losses and explicit deferrals; the loss-audit stops here.
