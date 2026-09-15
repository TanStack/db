# Ground Condition: what lets evidence reduce risk?

Instrument: ground-condition. Status: complete, bounded constructions.
Frozen position and sources: [brief](00-brief.md). No runtime experiments ran.

## Baseline and material conditions

Ordinary baseline: a supported SQL mutation writes `recipes`; a retained query
reads `tags`. The compiler establishes complete, disjoint dependencies under its
supported catalog/handler assumptions. The framework can skip that read. Its
own oracle protects the general rule; no per-application evidence task is needed.

| Kind | Material condition | Controller / authority |
| --- | --- | --- |
| Dynamics | Edits and deployments change which claims apply; checks add observations; tasks expose remaining work. | Author, build/deployment system, check runner, evidence consumer. |
| Constraints | A check observes only its declared path and checkpoints; a refetch cannot include a write that has not happened. | Test method and actual API/DB behavior. |
| Constraints | Evidence may be bounded without being useless; an unsupported claim must remain visible. | Consumer acceptance rule and report rendering. |
| Boundary | Whether a helper is analyzed, exercised, mocked or unreachable. | Compiler support, source access and harness. |
| Boundary | Schema, helper/configuration version, actor scope, input domain and controlled schedule. | App/dependency owner and execution environment. |
| Boundary | Which consequence is at stake and whether a safe fallback exists. | Framework contract and authored product policy. |

## Matched cases

All pairs below are hypothetical. Their support comes from the mechanisms and
limits in S2–S4, not from new observations of production failure. Each varies the
named condition while keeping the endpoint operation and claimed law fixed as
far as possible.

| ID | Ordinary case → changed boundary | Sensitivity and missing fact | Controller and check that could settle it |
| --- | --- | --- | --- |
| G1 | Complete compiler-derived write bound → same behavior behind an unsupported helper. | Outcome need not change; the path to support does. “Not statically known” is not “incorrect.” | Compiler author can add a general rule; an agent can inspect/exercise the real helper. The consumer must state what evidence supports which domain. |
| G2 | Optimized/baseline oracle exercises the real helper → both use a mock that returns success without its possible writes. | The test now establishes client behavior under the mock contract, not the helper's real effects. A green result cannot close both questions. | Harness/adapter owner. A provider conformance check or inspection must separately support the mocked premise; retain the original partial test. |
| G3 | Oracle bypasses selective-refresh logic in the baseline → baseline shares the same dependency classifier. | Agreement loses sensitivity to a missing table. No amount of extra generated input repairs that semantic dependency. | Test author. Omit a known affected table in a deliberate mutant and show the real baseline still reads it while the optimized path diverges. |
| G4 | Helper writes before its awaited promise resolves → same helper queues the same write and returns before it commits. | Changes the causal path. Even full refetch can be too early; the optimization comparison may agree on stale data. | API owner/completion contract. Control the actual write event, observe settlement and later storage, or establish a real completion signal. Refetch is not a universal fallback. |
| G5 | Two valid facts describe the same deployment → a read fact describes deployment A and a write fact deployment B. | Neither fact becomes historically false, but their conjunction has no shared execution context. | Evidence consumer. Check compatible subject/environment/version bindings before combining; a green receipt count cannot establish compatibility. |
| G6 | Code is unchanged after a receipt → the comparator/generator is weakened while endpoint code remains unchanged. | The validity question concerns the check method and acceptance rule, not just the endpoint hash. Old results remain historical; new greens answer a changed question. | Check author and acceptance-control owner. Preserve method versions and comparison-law changes; review them under the RFC's control-change rule. |
| G7 | An observed defect can expose another user's data → the observed defect is a harmless display mismatch while an unresolved auth path may permit such exposure. | A categorical “all demonstrated bugs before unknowns” order can defeat the risk-reduction aim. This does not estimate the unknown's probability. | Product/engineering owner sets impact and urgency; tooling records exposure and current safeguards. Ask for a targeted check of the auth path rather than asserting it is vulnerable. |
| G8 | A schema/key claim is unchanged → an unrelated performance measurement becomes stale. | Only dependent conclusions should reopen. Marking the whole endpoint unsafe or rerunning every check invents coupling. | Dependency graph/consumer. Independently vary each fact; verify the affected use/task reopens while unrelated support remains available. |

G1 is not a rule that every opaque helper requires an oracle: source inspection
or a reusable analysis extension may be the smaller and stronger check. G2/G3
do not reject oracles; they identify the separate premises needed to credit them.
G4 stays in scope because the endpoint itself caused the delayed write. A cron
job unrelated to the endpoint would be an out-of-scope contrast.

## Supported range and residual questions

The theory fits when a claim has a specific consumer, its scope/assumptions are
retained, and the next task targets the missing condition. Evidence can reduce
uncertainty without changing code; implementation repairs reduce defects;
optimization evidence can enable less work. Those outcomes should remain
distinct in the assessment.

The boundaries reveal unresolved choices, not an implemented admission policy:

- Which consumer conditions allow application-specific oracle evidence, and how
  is its tested domain connected to the code path on which an optimization runs?
- What records establish compatibility when facts from multiple providers join?
- What minimum controls make a new test useful for the stated law, without
  requiring an expensive universal certification ceremony for every check?
- How are high-consequence unknowns ordered against observed lower-impact bugs,
  and who supplies the value/urgency assumptions?

Conditional question variants: with real provider access, what law can the
oracle test? Without access, what conditional result remains useful? With a
correct fallback, can we defer evidence cheaply? Without one, what behavior is
missing before further evidence could help?

## Reinserted values and controls

The user's aims remain: simple authored code, automatic wins where analysis
suffices, reusable oracle evidence, and useful agent work across many dimensions.
Distinguishing limited evidence does not justify refusing it; avoiding false
assurance does not require formal proof of arbitrary JavaScript.

The operation may overselect adversarial boundaries and understate ordinary
cases where static analysis is sufficient. No incidence, cost, likelihood or
correct prioritization formula was measured. Each pair is a diagnostic
construction; none certifies every case in its family. This pass stops at the
named missing facts and hands them to the already-selected fracture stage.
