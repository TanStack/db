# Process — TanStack Trust API Design Grammar v5

## Status

v5 is a repair-and-selection artifact. It starts from the v4 preserved model,
the lossless 200-item audit evaluation, and ESLint donor run 64. It fixes
confirmed contradictions, selects the API decisions needed for a coherent
candidate, and records unresolved implementation boundaries. It does not claim
that an API implementation or conformance suite exists.

## Inputs

- v4 `BRIEF`, `MODEL`, `EVIDENCE`, `PROCESS`, and `PRESERVATION`;
- v4 Fracture Scan 62 and Hostile Assay 63;
- the semantic, TypeScript/linter, and adversarial audits plus final lossless
  evaluation ledger;
- ESLint donor readout 64;
- the Trust RFC, earlier design grammar, Protocols Institute survey, distant
  donor perturbation, Oracle Guide, TypeSafe System One Models article, and the
  bounded Endpoints evidence-base prototype already traced by v4; and
- the user's six workflows and instruction to test the condensed design with
  fresh agents.

`EVIDENCE.md` and `freeze.json` bind the exact v5 source and artifact set.

## Repair method

1. Preserve every PC4 property unless the evaluated audit found a contradiction
   or a v4 claim exceeded its source.
2. Promote every canonical `fixed-now` and semantic `confirmed-open` item that
   can be resolved without claiming an implementation.
3. Use ESLint transfers only where they repair a named Trust problem; retain an
   explicit negative-transfer boundary.
4. Select previously open API-profile choices only where the six workflow tests
   need one coherent interface to exercise.
5. Keep security, persistence, transport, calibration, and cross-domain claims
   bounded where no source or implementation closes them.
6. Separate the normative design from the condensed agent-test packet. The
   latter may omit detail but cannot add behavior.

## Structural changes from v4

| v4 | v5 |
|---|---|
| F01/F02/F03 left unranked | selected as authoring, service, and protocol layers |
| one stable `TrustCondition` projection | `ConditionOccurrence` plus explicit activation history and separate current/history queries |
| executable hooks could be read-time | executable hooks run only in frozen command contexts; queries consume persisted values |
| definition envelope retained mutable admission/supersession facts | definition-only envelope plus append-only lifecycle edges |
| authority was a record-shaped assertion | authenticated actor session and external capability verification are required |
| `defineRule` lowering was prose | normalized deterministic lowering manifest and atomic registration |
| rule tuples combined enablement and severity | activation/options/levels and consumer policies are separate |
| editor source appeared without a transition | transient versioned context commands precede pure diagnostic reads |
| complete returned batch was detached from an expected universe | run plan/ticket binds intended cases, coverage, cardinality/stopping rule, and submission |
| operation phases were descriptive | command intent, attempt, commit, delivery, cleanup, idempotency, and reconciliation are explicit |
| challenges lacked sufficient causal repair | repair requires changed cause, affected use, exact versions, and fresh post-failure non-cache replay |
| probability threshold ownership remained contradictory | admitted domain adequacy and consumer action thresholds are separate |
| adapter outputs were semantic sketches | canonical diagnostic, report, action, error, decision, and snapshot DTOs constrain every adapter |
| override behavior lacked precedence and deploy binding | strict aggregation, exact scoped overrides, evaluation instant, and decision token |
| no normative author test harness | `TrustRuleTester` is part of the ecosystem contract |

## Six source-level reconstructions

These are design reconstructions, not executed results. Each is deliberately
restated without relying on v5 component names so later factorization controls
can compare alternate models.

### W1 — Editor repair

Given an unsaved endpoint edit, the system must evaluate that exact document
version, identify why an active guarantee is unsupported, direct an agent to
the required evidence, accept only a complete version-bound result through an
authorized operation, and report the post-submission state without treating
work or an edit as proof.

**v5 route:** source context command → diagnostic query → explanation/work →
run plan → execute/submit → fresh snapshot and diagnostics.

### W2 — Scheduled renewal

Given an observation whose captured evidence-relevant dependency is expired, a
scheduled agent must discover one deduplicated ready item, claim it without a
late worker overwriting a newer lease, gather replacement evidence, and learn
whether the original condition remains.

**v5 route:** active/work query → fenced claim → run plan/submit → guarded close
and fresh report.

### W3 — CI gate

Given a repository snapshot and named consumer profile, CI must obtain one
coherent, side-effect-free decision whose output distinguishes allowed,
policy-blocked, and unable-to-evaluate states.

**v5 route:** `trust ci --profile ci` → `TrustReport` and decision token → exit
0/1/2. No hidden method execution occurs.

### W4 — Human inspection

Given a live project, a human must inspect current and historical claims,
evidence, conditions, work, admission, configuration, policy, and overrides
without adapters constructing contradictory states.

**v5 route:** snapshot query → cursor changes → shared explanation/report DTOs.

### W5 — Temporary endpoint downgrade

Given one blocked endpoint and authorized emergency intent, the system must
allow a narrow action change for a bounded time while keeping the unresolved
condition visible and rejecting deployment after the decision's inputs expire.

**v5 route:** explain authority boundary → create exact override → evaluate →
deploy with decision token → re-evaluate or reject after expiry/change.

### W6 — Stricter-level preview

Given a proposed global Endpoints level, the system must show newly active
obligations and evidence work—including definitions not active in the live
configuration—without mutating live conditions, work, or evidence.

**v5 route:** seal candidate module/config/policy bundle → pure compare →
hypothetical conditions and work with reuse explanations.

## Negative cases retained

- Closing or upvoting work cannot support a premise.
- Disabling or hiding a diagnostic cannot create a clean evidence history.
- A typed model result cannot admit itself or become a universal confidence.
- A later unrelated pass cannot repair a prior challenge.
- A caller cannot submit only the favorable part of a planned run.
- A failed or unreachable run cannot change observations or captured dependency
  revisions.
- A stale editor action, lease, override, decision token, or snapshot-bound
  command must return a typed conflict.
- Two adapters cannot assign different meanings to the same condition code.

## Candidate comparison control

v5 no longer claims that removal-only ablation proves minimality. Three nearby
factorizations remain legitimate comparison candidates:

1. merge conditions and work into one task graph;
2. merge admission, adequacy, and policy into one rule verdict;
3. expose only one generic operation protocol with no typed service resources.

The six workflows supply distinguishing histories: work closure must not change
support; action permission must not change adequacy; and typed discovery/errors
must remain usable without an arbitrary request tunnel. The upcoming agent
simulations test usability of the selected factorization, not logical
minimality against these alternatives.

## Agent usability control

All six agents receive the same frozen condensed packet and only one workflow.
They receive no v4 history, audit findings, design rationale, or sibling
transcripts. Each must write the TypeScript/config and adapter interactions it
would use, trace expected state changes, identify friction, and enumerate APIs
or rules it had to invent. The orchestrator will compare the six readouts only
after all are complete.

This procedure can overstate coherence because the packet is authored from the
same model it tests. It can also overstate friction when a deliberately
condensed packet omits details present in `MODEL.md`. Multiple model families,
repeated trials, and an implemented prototype remain later controls.

## Remaining decisions

- concrete authority-provider, signature, delegation, and review topology;
- trusted-process versus sandbox/worker/remote method execution;
- evidence store, multi-writer serialization, retention, and migration;
- dependency discovery completeness guarantees for each domain provider;
- exact probability calibration metrics and drift program;
- transport paging, subscriptions, cursor retention, and resynchronization;
- public package names and compatibility support windows; and
- whether later evidence supports extraction from Endpoints into a standalone
  TanStack Trust package.
