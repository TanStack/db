# Targeted intake: #2337–#2342

Six issues captured with complete bodies and all conversation comments (zero each). This extends the cumulative ledger from 155 to 161 (137 issues, 24 PRs), without refreshing the prior 144-open-item census. Two join existing clusters and four stay standalone; no new cluster is created.

The four correctness follow-ups retain historical evidence and require current-main revalidation. The two receiving gaps are instrument work, not new production REDs or product feature requests. The worker artifact taxonomy has no coverage-gap value, so #2341/#2342 use `artifactType: unclear` with explicit `productClassification: oracle-coverage-gap` in the primary assignments. That enum limitation does not make their stated work unclear.

| Issue | Primary classification | Session | Work kind |
| --- | --- | --- | --- |
| [#2337](https://github.com/TanStack/db/issues/2337) | Subquery literals / undefined and empty records (standalone) | B27 | historical runtime and type correctness follow-up |
| [#2338](https://github.com/TanStack/db/issues/2338) | Callback metadata / static receiving types (standalone) | B25 | historical compile-time correctness follow-up |
| [#2339](https://github.com/TanStack/db/issues/2339) | Public types / inferred Collection declaration emission (standalone) | B28 | historical installed-artifact type portability follow-up |
| [#2340](https://github.com/TanStack/db/issues/2340) | Collection mutations / generated fields and read-write payloads (existing cluster) | B06 | historical mutation-input type correctness follow-up |
| [#2341](https://github.com/TanStack/db/issues/2341) | SQLite persistence / Electric multi-tab coordination (existing cluster) | P8 | oracle durable-boundary observation gap |
| [#2342](https://github.com/TanStack/db/issues/2342) | Adapter receiving / applied receipts and lazy child readiness (standalone) | B29 | two retained oracle receiving gaps |

## #2337: Subquery literals / undefined and empty records

Historical P11/P12: raw undefined becomes null and selected empty records disappear. Root/QueryRef runtime, correlated receiving and source-public types have separate retained evidence, requiring fresh current-main revalidation. Local subquery literal-value semantics need their own judgment; #2187 concerns a remote RefProxy wire contract and is not evidence of the same defect. Retain standalone rather than merging by the word literal.

Coordination: B25: shared query/type owners; issue:2187: separate remote wire boundary.

[Source](https://github.com/TanStack/db/issues/2337): “These are historical results, not new executions on current main.”

## #2338: Callback metadata / static receiving types

Historical callback receiving-type leaks remain separately bounded from #2312 runtime repairs: 672 ordinary-metadata and 12 discriminant-specific union-spread REDs, with 6,240 declared states and 43 controls. No current compiler campaign was run when filed. Shares callback metadata vocabulary with standalone #2312, while the new issue concerns actual callback parameter types and union/spread receiving. Coordinate B25 without turning runtime GREEN into static closure or broadening a framework cluster.

Coordination: PR:2312: runtime callback contract context; B06 / issue:2340: mutation input receiving; B27 / issue:2337: distinct literal semantics.

[Source](https://github.com/TanStack/db/issues/2338): “These are historical results. No new current-main compiler campaign was run for this issue.”

## #2339: Public types / inferred Collection declaration emission

Historical strict NodeNext declaration emission failed for exported inferred live-query factories and Collection values in ESM and CommonJS (TS2742/TS4058/TS4023). This is a library declaration boundary, with no runtime failure established. The installed inferred-export declaration boundary differs from callback input types and runtime query behavior. Keep this standalone; closed #1012/#393 are historical context, not proof their repairs failed.

Coordination: B25 / B06: shared public types only; issue:1012 / issue:393: closed historical context.

[Source](https://github.com/TanStack/db/issues/2339): “This concerns libraries that emit declarations. It does not establish a runtime failure.”

## #2340: Collection mutations / generated fields and read-write payloads

A no-select live-query Collection historically required computed virtual read metadata in an authored business-row insert (TS2345). The separate reusable full-handler symptom depends on compiler checking order and is not a stable CLI RED. Shares the existing cluster's read shape versus insert/update input distinction and handler admission workflow. This specific required-metadata witness is a historical correctness follow-up, separately scoped from older requests for new schema/default capabilities.

Coordination: B25 / issue:2338: callback static receiving; B19 / issue:2264: demoted handler-type test restoration.

[Source](https://github.com/TanStack/db/issues/2340): “These are historical results. Reproduce on current main before changing production.”

## #2341: SQLite persistence / Electric multi-tab coordination

The metadata read-hold/abandonment lanes retain source-facing comparisons but lack direct durable transaction observations. The required receiver must reject a wrong durable write followed by repair at the boundary where it becomes observable. Uses the existing sync-metadata session oracle and persisted/native drivers in the persistence/metadata cluster. It is a durable observation obligation, distinct from #2317 controlled source reads and #2272 broader real-coordinator receiving.

Coordination: P6 / P3: shared metadata and native receivers; issue:2317: distinct source-facing notice witness; issue:2272: broader real-coordinator receiving; issue:2281: distinct row resurrection.

[Source](https://github.com/TanStack/db/issues/2341): “This is a recorded test-instrument gap, not a newly demonstrated production defect.”

## #2342: Adapter receiving / applied receipts and lazy child readiness

Release P08 needs the actual custom-adapter fenced callback while it holds an establishing applied receipt before load settlement. Release P14 needs the actual lazy child-ready outcome compared with the source-health model. Each cut requires current-main revalidation. Keeps two concrete retained release receiving cuts visible as a standalone coverage task. #2118 is the broader adapter conformance proposal; release P08 is unrelated to the metadata P8/#2317 session identifier.

Coordination: issue:2118: broader adapter conformance proposal; P4: applied receipt/replay coordination; P7: source-health coordination; P8 / issue:2317: identifier distinction only.

[Source](https://github.com/TanStack/db/issues/2342): “**Release P08:** exercise the actual custom-adapter fenced callback while it holds an establishing applied receipt before load settlement.”

## Evidence and limits

[Primary assignments](supplement-2337-2342/assignments.json), [capture and preservation receipt](supplement-2337-2342/intake.json), [four-issue extraction](supplement-2337-2342/batch-001-ledger.md), [two-issue extraction](supplement-2337-2342/batch-002-ledger.md), and their attributes/snippets preserve exact source quotations and caveats. Linked source records, local snapshots, production and compiler behavior were not independently validated by this intake. No tests or production were changed, and no closure is claimed.

## Fresh revalidation completed

[Origin/main revalidation](../misfits-investigations/revalidate-2337-2342/summary.md) at `baabf57a0f110d57ad9bb7b81148466b18fbe0d1` leaves all six issues open with public updates. The retained empty-record runtime cases in #2337 and 12 union-spread cases in #2338 now pass; their remaining failures survive. #2339/#2340 reproduce through installed receivers. #2341 remains a durable observation gap. #2342 adds an executed documented-callback receipt violation while both generated receiving cuts remain open. No production repair, new census, inventory-count change or closure is claimed. Exact per-issue dispositions and public links are in [revalidation.json](supplement-2337-2342/revalidation.json).
