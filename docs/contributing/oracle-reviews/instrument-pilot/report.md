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
| Review the paced-mutation oracle and its public promises | Adversarial review; tension scan | Two failing concurrency witnesses and a separate passing probe supporting a design objection. |
| Reorganize cleanup, admission, and settlement obligations | Law restructuring; tension scan | An old-to-new obligation map and concrete preservation examples; several apparent tensions dissolved without dropping obligations. |

The checks sought sourced laws, independent rival predictions, legal witnesses,
implementation freedom, separation of evidence from hypotheses, justified
contract criticism, and preservation of original obligations. All appeared in
the outputs. The author explicitly marked broad DAG behavior as a supported
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
the error. Its design output is retained, but that run is contaminated and is
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

**Supported design objection, not a failing accepted law.** With queue
`maxSize: 1`, `wait: 10`, and the first write held, eight calls spaced ten
milliseconds apart are admitted. After release at time 80, their callback
starts are `[0,80,80,80,80,80,80,80]`. The third witness passes this observation.
Queue-stage capacity does not bound all pending transactions, and timer
eligibility does not guarantee spacing between actual callback starts after a
stall. This matters to the guide's rate-limited API advice. Redefining capacity
or wait would reject or delay currently accepted work, so it is a design
proposal with migration costs. No memory benchmark or provider failure was run.

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
classified as compatible obligations. No executable restructuring check or
independent preservation validator ran; these are source-based predictions.

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
a design proposal. This follow-up policy was not part of the three agent trials.

Required reading was the largest cost reported by the agents. This pilot keeps
the existing reading policy intact; it does not establish which portions could
safely be skipped. The instrument cards did not require a fixed sequence, report
template, extra approval, or mandatory delegation.

Both skills pass YAML metadata/name/description/scaffold validation and local
links resolve. The bundled Python validator could not import PyYAML in either
available Python environment; equivalent checks used the existing Node YAML
parser. No dependency was installed. Whitespace checks pass.

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
