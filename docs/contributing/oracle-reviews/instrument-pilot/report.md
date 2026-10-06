# Oracle instrument pilot — 2026-10-06

The small library was usable in three bounded agent tasks. It produced new
law proposals, an executable D2 check, a confirmed public-contract discrepancy,
and a proposed reorganization of cleanup laws. This is evidence of useful
outputs in these cases, not proof that the skills improve agent performance.

Source baseline: `5688e232eff34eeac555f2586a34672bad25865b`.
The [manifest](manifest.json) records initial and final instruction hashes,
preselected evaluation criteria, and replay outcomes. Production and existing
oracle files were unchanged. The new witnesses are pilot artifacts outside the
normal package suite; no proposed contract was silently adopted.

## Setup and evaluation

Three fresh agents received realistic tasks, the local skills, the repository,
and a scratch-output directory. They did not receive the earlier interview
findings, this implementation discussion, or an intended answer. They could
choose cards within the task. Repository edits, package installation, external
messaging, and further delegation were excluded. Prior review reports were
excluded from the source corpus.

| Task | Cards used | Observable result |
| --- | --- | --- |
| Extend D2 execution laws beyond the existing bounded owner | Law discovery | Three candidate laws with authority status; a bounded executable extension with both a wrong and a valid alternative scheduler. |
| Review the paced-mutation oracle and its public promises | Adversarial review; tension scan | Two failing concurrency witnesses and a passing queue probe separating a capacity proposal from an unresolved spacing contract. |
| Reorganize cleanup, admission, and settlement obligations | Law restructuring; tension scan | An old-to-new obligation map and concrete preservation examples; several apparent tensions dissolved without dropping obligations. |

The checks sought sourced laws, independent rival predictions, legal witnesses,
implementation freedom, separation of evidence from hypotheses, justified
contract criticism, and preservation of original obligations. The outputs addressed these criteria; the clean preservation check below
identified two narrow repairs before an unqualified preservation claim. The author explicitly marked broad DAG behavior as a supported
extension requiring acceptance before advertising a universal promise. The
reviewer separated a contract discrepancy from a proposed change to queue
capacity semantics. The restructuring agent labeled its work a trace audit.

This was not a controlled effectiveness comparison. There was no untreated
baseline agent, the tasks were selected by the designer, and all agents shared
the same model family and instruction environment. Their claims that the
skills helped are self-reports. The existing oracle guide already contains
substantial scientific-method guidance.

The restructuring run accidentally received historical-review excerpts through
an incorrectly excluded broad search. It corrected the search and disclosed
the error. A summary of its design output is retained, but that run is contaminated and is
not evidence of a blind reconstruction. The other two agents reported excluding
prior review files. Fresh context is a separation control, not statistical
independence.

## Authored laws and executable discrimination

The candidate laws were:

1. **Drain queued work through a finite pipeline.** For the tested synchronous
   map/concat/output graph, all queued messages reach the output before `run()`
   returns, regardless of registration order. This extends the existing reversed
   pair witness; arbitrary DAGs and custom operators remain outside the evidence.
2. **A drained graph stays silent until new input.** An idle rerun emits nothing;
   a later active run emits the new changes without replaying earlier messages.
3. **Finalization closes graph construction.** Later input/operator registration
   rejects, while existing inputs remain usable. The README supplies this
   promise; the proposed extra histories were not executed in this pilot.

Authority: [the existing D2 owner](../../../../packages/db-ivm/tests/d2-work-oracle.test.ts),
[the package README](../../../../packages/db-ivm/README.md), and the direct reader
contract in [graph tests](../../../../packages/db-ivm/tests/graph.test.ts).
The broader draining formulation is a supported extension, not a newly approved
universal product contract.

The [D2 witness](d2-drain-oracle.ts) uses an independent arithmetic message
model and a five-operator graph with fan-out and reconvergence. It executes all
120 registration orders through five run checkpoints: **600 production
comparisons pass**. A one-pass topological scheduler also passes all orders,
showing the assertions preserve that implementation freedom. A deliberately
wrong two-pass scheduler reaches the output comparison with no output instead
of four messages and is rejected there. It does not fail during setup or time
out. Idle reruns also pass; no separate replay mutant was executed.

These are finite source-level checks, not random campaigns, distribution tests,
performance measurements, or universal termination proofs.

## Review findings

**Confirmed discrepancy under the documented public contract, tracked in
[issue #2058](https://github.com/TanStack/db/issues/2058).** The
[mutations guide](../../../guides/mutations.md) promises one pending and one
persisting transaction at a time for debounce/throttle. With `wait: 10`, both
edges enabled, a first successful write held, and a second call at time 1:

| Strategy | Observed callback starts | States at time 21 |
| --- | --- | --- |
| Debounce | 0, 11 | persisting, persisting |
| Throttle | 0, 10 | persisting, persisting |

Both [new witnesses](paced-witness.test.ts) fail the at-most-one-persisting
assertion. The existing oracle's **42 tests pass**. Its ordinary timing driver
immediately fulfills persistence; its held debounce/throttle cases drop the
second call. Neither exercises an admitted second write reaching its timer
edge while a previous write is held. Final settlement hides that distinction.

A follow-up should extend the existing paced owner with successful hold/release
histories and observe concurrency at the relevant edges. The accepted public
promise currently supports serialization. A different promise would require an
explicit contract decision, not merely weakening the failing assertion. This
pilot does not choose or implement the repair or claim bug-class closure.

**Queue capacity proposal and unresolved spacing contract.** With queue
`maxSize: 1`, `wait: 10`, and the first write held, eight calls spaced ten
milliseconds apart are admitted. After release at time 80, callback starts are
`[0,80,80,80,80,80,80,80]`. The third witness passes this observation.

Waiting-queue capacity is the documented `maxSize` boundary. Bounding all
unsettled transactions would change accepted admission behavior and remains a
design proposal. No memory benchmark or provider failure was run.

Spacing has conflicting authority. The public upload example says “Process
each upload sequentially with 500ms between them”; `QueueStrategyOptions.wait`
describes time between processing items. The existing paced owner permits
same-clock callback starts after a held write settles. Its timing model covers
immediately fulfilled writes, where queue processing and handler starts coincide.
Current acceptance does not settle that public promise. A three-call held-write
history distinguishes callback spacing from timer eligibility. The existing
paced owner needs start-time observations across release if callback spacing is
confirmed; the public guide needs clarification if eligibility is intended.
This pilot retains the conflict and chooses neither policy.

## Law restructuring result

The proposed common principle is: **strategy cleanup preserves obligations
already incurred under that strategy's timing and grouping policy**. Keep
admission, timing/grouping, and settlement separately stated. Queue cleanup
closes new admission; the reviewed contract leaves new debounce/throttle calls
after cleanup outside the supported admission rule. Promise settlement is also
distinct from remote durability unless the handler waits for that durability.

Reasoned preservation checks retained delayed debounce/throttle edges, queue
ordering and serialization, rollback reasons, receipt identity, and separate
Collection cleanup. They rejected cancellation, early flushing, and a universal
minimum callback-spacing law. Stopping new calls and draining old ones were
classified as compatible obligations. The original trial had no independent preservation validator. These were
source-based predictions, and its queue-spacing conclusion did not settle the
public wording conflict above.

## Clean restructuring trial and independent check

A fresh author received only a frozen 25-file source packet. It contained the
instructions, public contracts, existing owners, and relevant implementation.
It excluded prior candidates, review reports, the issue, and pilot conclusions.
The [input manifest](clean-restructure/input-manifest.json) records every hash
and source commit `322a48ad6fc37ed7ecbd517d57598a124b533b46`. Reconstruct the packet
from that commit, not a later checkout. Absolute scratch paths in the raw reports
identify the original experiment location.

The [original candidate](clean-restructure/candidate-original.md) and
[author's mapping](clean-restructure/analysis-original.md) remain unchanged.
A separate reviewer received the source packet and candidate, without the
mapping or author's intended verdict. Its [original review](clean-restructure/preservation-original.md)
identified two repairs: preserve explicit `false` as custom queue rejection,
and scope call-local rollback to admission rejection rather than shared-batch
persistence failure. The reviewer disclosed generic platform and original
repository instructions in its context; it reported no earlier substantive
verdict or historical review input. This is source separation, not statistical
independence or a completely instruction-free context.

The PR review exposed a third problem: both clean agents treated the existing
queue tests as settling the public upload-spacing promise. The
[revised candidate](clean-restructure/candidate-revised.md) retains that authority
conflict and applies the two local repairs. The [narrow follow-up](clean-restructure/preservation-followup.md) accepts those
edits against the same frozen sources and withdraws the original queue-authority
conclusion. No product law has been adopted or test
expectation changed. The author independently identified the batch-concurrency
interaction by source inspection; that is not a new executed reproduction.

These artifacts supply inspectable obligation mappings and reasoning witnesses.
They also show why a fresh reviewer is useful but insufficient: two agents can
share an authority mistake. The restructuring card now explicitly preserves
conflicting public and executable claims until a design decision resolves them.
That final reminder received source review, not another behavioral trial.

## Feedback applied and remaining limits

Two narrow changes followed the trials:

- Reviewers now follow an oracle's authority claim to the nearest public source
  and inspect neighboring promises. The omitted concurrency promise demonstrated
  why the oracle's own opening summary is insufficient.
- Authoring closeout now scopes owner/coverage-map updates to changes in
  repository coverage. A scratch law-design task records proposals and limits.

Those instruction edits received static checks; the three behavioral trials
used the initial version. The saved executable witnesses were replayed after
path normalization and formatting, with the same outcomes. No broader skill
improvement is inferred from that replay.

Subsequent maintainer feedback added issue tracking for confirmed discoveries.
The concurrency report is filed as [#2058](https://github.com/TanStack/db/issues/2058),
with its runnable reproduction and test gap. The affected production files match
the default branch when checked at filing. The queue-capacity concern remains
a design proposal; callback spacing remains an unresolved contract conflict. This follow-up policy was not part of the three agent trials.

Required reading was the largest cost reported by the agents. This pilot keeps
the existing reading policy intact; it does not establish which portions could
safely be skipped. The instrument cards did not require a fixed sequence, report
template, extra approval, or mandatory delegation.

Both skills pass YAML metadata/name/description/scaffold validation and local
links resolve. The bundled Python validator could not import PyYAML in either
available Python environment; equivalent checks used the existing Node YAML
parser. No dependency was installed. Whitespace checks pass.

## D2 guide applicability and outcomes

The source audit started at `322a48ad6fc37ed7ecbd517d57598a124b533b46`.
The manifest records the reviewed revision and final executable artifact hash.
This account concerns the retained bounded D2 oracle, not adoption into package
coverage or closure of a production bug class.

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Satisfied for the named graph: authority and limits are in the opening comment and authored-laws section above. Arbitrary DAGs remain a proposal. |
| ORC-002 | Satisfied: expected messages use arithmetic substitution, independently of the production queues and scheduler. |
| ORC-003 | Satisfied: law, model, bounded histories, driver, and comparison have adjacent explanatory prose in the executable file. |
| ORC-004 | No generated-history coverage claim; the experiment enumerates one bounded grammar. Every registration permutation appears once; the reversed order reconstructs the hostile case. Removing registration variation hides the scheduling fault, and removing later active/idle turns loses stale-replay observations. The only values are 2 and 3, with the stated weights; duplicate registration is explicitly rejected. |
| ORC-005 | Satisfied for the finite claim: 600 real `D2.run()` boundaries compare output messages. Copies retain omissions, duplicates, weights, and message boundaries; message order is deliberately excluded. |
| ORC-006 | The important-generated-property and repair triggers do not apply. The executed mutant still triggers outcome classification: two-pass fails the first active output assertion. The valid topological alternative passes all orders. |
| ORC-007 | Not applicable: bounded enumeration, not an important generated property or random campaign. |
| ORC-008 | Not applicable: expected-message recomputation is stateless; no reference state is introduced or merged. |
| ORC-009 | Satisfied: the model comment maps `Message` to the D2 recorder value and distinguishes it from a Collection change message. |
| ORC-010 | The mutant catch preserves the exact output checkpoint and rethrows other errors. There is no shrinker, external resource, asynchronous cleanup, or reduction that can replace the mismatch. |
| ORC-011 | Not triggered: review identified no shared semantic fault needing a second reference. The topological scheduler checks implementation freedom; it is not claimed as an independent semantic oracle. |
| ORC-012 | This versioned record and manifest provide each outcome and provenance. No bug-class closure is claimed. |
| ORC-013 | Claim limited to the named graph and five checkpoints. The reversed path rejects two-pass draining; adjacent idle and later-input cuts check silence and fresh delivery. No general topology, depth threshold, or separate replay-mutant result is claimed. |
| ORC-014 | Not applicable: real synchronous D2 operators run directly, with no transfer from a controlled provider to a real-provider or host claim. |

The maintained owner remains `packages/db-ivm/tests/d2-work-oracle.test.ts`.
Promoting this experiment would require that owner's scope and the coverage map
to change together. This record does not claim that integration has occurred.

## Replay

From a checkout with the workspace dependencies installed:

```sh
node --import tsx docs/contributing/oracle-reviews/instrument-pilot/d2-drain-oracle.ts
node node_modules/vitest/vitest.mjs run --config docs/contributing/oracle-reviews/instrument-pilot/vitest.config.ts
```

The D2 command exits 0 after accepting production and the valid alternative and
rejecting the wrong scheduler. The Vitest command currently exits **1**:
**43 pass, 2 fail** (42 existing tests, one new observational pass, and the two
expected concurrency failures). A future repair or approved contract change
should cause this historical result to be reevaluated.

The saved Vitest configuration uses Node with fake timers, source imports and
coverage/typechecking disabled. It is a component experiment, not the package's
normal jsdom/coverage/typecheck CI configuration. The local replay reused
Vitest 3.2.4, pacer-lite 0.2.1, and existing dependencies through a temporary
worktree overlay. Production files remained unchanged.
