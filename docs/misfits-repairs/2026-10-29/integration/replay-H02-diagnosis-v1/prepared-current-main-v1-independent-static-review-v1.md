# H02 prepared current-main: independent static review

Verdict: **not accepted for runtime in these exact bytes**. Repair the three instrument gaps below. No production defect or oracle RED is established. No law change or human decision is needed.

Reviewed HEAD: `9cfa11fc712866f8f276e85762865ebb8bd49cbe`, detached worktree `.worktrees/codex-misfits-h02-progress-main-v1`. Packet SHA256 `ab66afc91261bfda22438fc81389e3e478f2ab99ae2a132000344e50d6147b95`; source freeze `9be9bc3846ebdcf3bfb2b5c82b0bc6a5eaaaa4601d6f230d82a098c263b71781`; handoff `cd9fa595d066d8bf0ec725e5ee113b7a420aba6d8ee297b3babb397a4d310ee7`. Independently hashed all 22 packet members, 511 production files, 11 instrument files and 11 shared imported/config files: no mismatch. Production identity `39dc1e0516c3ae10ecad9be17befcad1616209572ddd054cddc6823c49459451`.

This review read the relevant AGENTS instructions, oracle-review skill, glossary, oracle rubric, full live-query architecture, coverage-map ownership/limits, subscription grammar opening/model boundary, Query ownership reacquisition law, replay owner contract, accepted H02 plan, shared retained-publication model, every new instrument/driver/checker/config, and relevant installed Vite/Vitest registry/evaluator source. Reads and hashing only: no tests, receiver, verifier, production, build, install, or source edits. Author's static tool successes are author evidence, not independently rerun here.

## Findings

### H02-PREP-R01 — P2: approved instrument modules deterministically fail provenance classification

Source: `scripts/h02-progress/verify-bindings.mjs:87–103`; `source-binding.setup.ts:39–80`; receiving runner and driver imports.

The verifier selects every module whose path is under `packages/{db,db-ivm,query-db-collection}/`, then treats every selected path without `/src/` as outside/stale production. The actual evaluated-module registry necessarily contains the receiving test, driver, progress oracle and imported test helpers. Those approved files are instrument/shared files in the freeze. They are not production substitutions, but this branch rejects them. The setup recorder hashes original bytes only for production, so the approved-instrument path also needs a matching original-byte observation if it receives equivalent binding checks.

Evidence: deterministic source-level branch reach for those imports; not an executed verifier failure. Installed EvaluatedModules retains imported modules in idToModuleMap; capture exports that full registry. This is a setup/provenance blocker, not a product RED.

Repair: retain the complete raw registry, classify exact normalized root production source separately from exact frozen instrument/shared allowlists, bind original and loader/V8 bytes for observed relevant entries, and fail closed for outside-root source, stale dist and unapproved substitutions. Do not solve this by silently dropping all non-src entries. Preserve evaluated=false observations without executed credit; require positive evaluated proof for required receiving production and executing driver/model paths. The child's evaluated oracle module does not prove parent checker invocation. Parent frozen call sites and separate pure checker calibration supply that narrower evidence; a new parent inspector is not required for this admission.

Next calibration: authored fixture only—approved production plus approved instrument bindings should qualify; outside/stale production, unapproved package module, changed original/code bytes, missing required evaluated path, and transform-only evidence must fail with the intended provenance reason. This calibration must not import production or execute Query.

### H02-PREP-R02 — P2: public publications after provider release are recorded but unjudged

Source: `queued-answer-progress-driver.ts:493–499`, `:545–567`; `queued-answer-progress-oracle.ts:170–208`; supervisor receipt selection.

Every callback emits public-change. Only callbacks while some pending provider record is still pending also emit retained-publication. The queued callback clears every pending flag before promise application and graph publication. After that point, public-change is ignored by checkProgressValue and is not retained by the supervisor's semantic receipt subset. A torn intermediate snapshot or bad change payload can therefore be followed by the correct final value without this checker rejecting it. Logging raw payloads does not enforce their fidelity.

Authority: accepted preservation of atomic publication; architecture law 9, shared-source replay barrier and coherent-publication rules. The repair location is observation/comparison, not production or contract. This is a source-confirmed assertion gap; no false-GREEN execution or production violation was run.

Repair: judge every public-change between reload-start and cleanup-start against the same independent complete prior/final values, preserve stricter named held-answer cuts, and disallow return to prior after final publication. Preserve raw changes and fold their finite id/rank/markers observations against the preceding public state; compare that event-derived state with the callback read. Reject duplicate/omitted/invalid operations rather than normalizing them away. The fold records observations; it is not another relational model. Keep child/parent model computation unchanged.

Next calibration: feed the shared checker a wrong transient public-change after all provider flags cleared, followed by a valid final publication. It must reject at the transient cut. Separately corrupt a payload while keeping callback rows valid; the event/read comparison must reject. These are pure observation fixtures, not driver/Query runs.

### H02-PREP-R03 — P2: the synchronous initial control observes after an extra public preload call

Source: `queued-answer-progress-driver.ts:113–128`.

The sync-initial control subscribes, then calls preload, and only then records immediate-publication. Architecture's literal-true initial cut applies when the initiating subscriber call returns. A design that delays subscriber initialization until a later preload can pass this later observation. No additional await is needed to mask that earlier cut: another synchronously active public call is enough.

Authority: architecture “Mutation boundaries and initial readiness”, literal-true synchronous initial cut; accepted H02 plan forbids blanket yielding. This is a source-level checkpoint gap, not an executed product defect.

Repair: capture and compare immediately after subscribeChanges returns, before preload. Keep the literal-true establishing receipt premise and later preload/final checks. A pure receipt calibration may verify that the shared checker rejects an incorrect immediate snapshot; a real control execution remains a later runtime gate.

## Supported design and limits

The accepted law is conditional queued-answer progress. The model imports finite independent filtering/sorting/slicing and does not copy demand/cache controller logic. The driver uses real QueryClient and lawful function keys extending its actual empty-options callback. The resolving request is selected from actual key atoms and old nonempty/newer empty answer versions, not a fetch ordinal. Actual host queue return precedes answer-queued; answer-executed is the callback's first action. This is an appropriate prepared distinction, but every runtime premise remains unmeasured.

The external supervisor contains a separate process group and distinguishes wall/RSS/heap termination. The parent checks provenance before assigning bounded progress rejection. Numeric containment is not a product deadline or infinite-loop proof. Final cleanup and independent root group inspection remain required on an admitted run. No final semantic or coverage credit belongs to a killed worker. Cached observer ownership stays with the existing ownership oracle; this witness does not replace its mandatory control. Permanently conflicting caches remain outside the decision.

The current five-root/offset1/width1 grammar is enough to prepare the smallest witness. Translation, rank scale, scheduler, prior-value shape and compatible-cache/include/window ablations are present. Wider offset/width/pivot and empty-width neighbors from the accepted plan remain future coverage work before class closure. No generated campaign, reach minimum, mutant kill, seed/path replay or receiving equivalence has run. Property/manifest/coverage registration is explicitly pending.

## ORC accounting for this static preparation

- ORC-001: accepted H02 decision supplies authority; finite boundaries are explicit. No new law inferred from source output.
- ORC-002: independent public model and callback progress distinction present by source review.
- ORC-003: law/model/grammar/driver/checker are directly named and explained. Publication scope must be corrected by R02.
- ORC-004: reconstruction and ablation dimensions prepared; range/exclusion execution and wider neighbors remain unmeasured.
- ORC-005: real driver prepared; effective binding blocked by R01 and publication/initial cuts by R02/R03. No execution credit.
- ORC-006: no calibration executed; pure controls and later current-main/mutant experiments remain required.
- ORC-007: matching fixed/random campaign bodies and shared controls prepared; registration, runs and direct replay remain pending.
- ORC-008: progress splits queued/executed/finite-result observations; no copied production state machine. Prior/final values are stateless recomputations. New publication recorder state is not yet authored.
- ORC-009: canonical terms and model-only receipts are explained. Observed provider release does not mean applied settlement.
- ORC-010: raw trace/primary/cleanup separation and group containment prepared; execution and release verification pending.
- ORC-011: no additional shared relational-semantic fault identified; no second model required by this static review.
- ORC-012: this exact versioned record gives requirement outcomes; no closure or readiness claim.
- ORC-013: strict premise and neighboring controls prepared; reached boundary and sensitivity unmeasured.
- ORC-014: Node/jsdom with real QueryClient and controlled finite provider is explicitly scoped; native/browser/provider handoff unproved.
- ORC-015: declared reaches prepared; counts absent and registration pending. Per-path control reach remains a later gate.
- ORC-016: fixed replay and campaigns share model/driver/checker; receiving runner states no expected answer.

## Disposition and next step

Three source-level instrument findings, all confirmed-open pending authorized repair/calibration; zero production findings. Accounting complete for this review, implementation and runtime evidence incomplete. Root may authorize an instrument-only successor, static checks and pure fixtures. Return that successor for exact static review before any real receiver run. No runtime admission, production edit, commit, push, PR update, or closure is granted by this report.
