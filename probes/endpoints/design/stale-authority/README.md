# Stale-authority design examination

The selected sequence is complete: exploratory Design Grammar, then Fracture Scan and a fresh Hostile Assay in parallel. No implementation was started. Findings are kept separate below; this record does not select a revised architecture.

## Design Grammar

[Primary brief](./grammar/brief.md) · [Model](./grammar/model.md) · [Evidence](./grammar/evidence.md) · [Process](./grammar/process.md)

The grammar distinguishes handler completion, evidence that a read covers its effects, and retirement of the optimistic transaction. Client generations are one admission input; they do not supply server ordering or coverage by themselves. It reconstructs a conditional global quiet-read path and a conditional independent-domain variation, without ranking them. Unknown effects collapse the domain variation to the global path.

The preservation list is provisional/exploratory. Initial-load support, outcome recovery, publication/retirement, adapter admission and external authority remain unresolved. Formalizing the proposal introduced explicit state and assumptions that are not implemented mechanisms. Independent range is untested.

## Fracture Scan

[Full reading](./audit/fracture-scan.md) · [Constructed probe](./audit/fracture-probe.mjs) · [Receipt](./audit/fracture-probe.json)

No internal stale-baseline counterexample was found with all qualified coverage and authority assumptions enforced in a finite model. The model enumerated 34,650 three-operation schedules; the candidate interpretation had zero failures, while arrival-wins and largest-invocation controls failed 10,344 and 6,708 schedules.

These are source-derived model histories with immediate coherent quiet reads, not actual concurrent Endpoints executions or PostgreSQL range evidence. Epoch-only ordinary-read admission and waiting for persistence receipts are excluded simplifications. Continuous traffic exposes the stated progress condition; separately retiring overlays can expose older guesses without regressing the server baseline. The scan rejects external-writer and unconditional latency objections as outside the frozen claim.

## Hostile Assay

[Full reading](./audit/hostile-assay.md) · [Source-backed diagnostic](./audit/hostile-repros/source-boundaries.json) · [Constructed schedules](./audit/hostile-repros/scheduler-models.json)

The fresh auditor saw one frozen candidate and named implementation traces. It did not see sibling variants or the Fracture Scan. It found no counterexample against every enforced candidate predicate. It returned five concrete obligations or scope questions:

1. **Accepted coverage outlives pending operations.** Once an operation retires, its removal cannot make an older ordinary/duplicate response eligible to replace newer authority. Admission must reach both baseline bookkeeping and query-adapter/cache publication.
2. **New retained lifetimes need coverage.** Matching the lifetimes captured by a request does not prove coverage of a collection retained after target capture. Rejecting a GCed lifetime does not fetch the replacement's data.
3. **Publication needs an observation contract.** Per-collection installation and per-overlay retirement can expose mixed results or older guesses. The actual notification boundary, including callbacks that dispatch more work, is untested.
4. **Sibling ownership has a scope conflict.** Actual core execution confirms that failure cascades into conflicting pending manual transactions while preserving persisting Endpoint siblings. The candidate's broad “other transactions survive” language does not distinguish these cases. This is not a new DB-core defect.
5. **Reads do not prove handler closure.** Actual helper execution confirms that a combined response withholds handler knowledge while its read is held. Missing transport outcome remains unknown; a later read alone cannot prove a still-running handler will not commit afterward. Receipt state and local rollback are not remote completion evidence.

Each finding includes repair conditions and the missing oracle law, schedule or assertion. The source-backed diagnostic uses real transaction/refresh code with stub collection notification; it does not prove real collection or browser publication. Constructed failure scenes are negative controls and must not be reported as implemented failures.

## Records and boundaries

[Source](./source.md) · [Provisional preservation](./grammar/preservation.md) · [Frozen candidate](./audit/candidate.md) · [Freeze verification](./audit/freeze-check.json)

The grammar was frozen before its primary brief and the audit handoff. The two audit readouts are addenda; they do not retroactively alter that grammar. Their checks leave the currently implemented sequential behavior untouched. The existing Field Log records all three runs and their limits.
