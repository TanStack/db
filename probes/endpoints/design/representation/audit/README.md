# Grammar and implementation audits

Three selected instruments ran against the [frozen scope](./scope.md): the orchestrator's fracture scan, a fresh hostile auditor shown only the implemented candidate, and three isolated source passes for loss audit. The implementation remains unchanged; [hash verification](./freeze-check.json) checks the frozen specimen.

## Reproduced behavior

**Handler failure after committed effects.** A handler can commit its first SQL statement and then fail. The server helper skips retained reads; the client fails its optimistic transaction, losing the visible row while the server retains it. The special committed-write/read-error classification does not cover this path. The fracture probe used actual PGlite and the server helper; the independent hostile probe also exercised the actual runtime. This exposes an unrepresented outcome condition, not a contradiction in coherence after successfully completed handlers. Existing rejection tests throw before a database write.

**Distinct declarations can receive the same endpoint identity.** Two component functions named `TodoApp` in separate lexical scopes, each declaring `rows`, compile to the same module/owner/name key despite different active/completed predicates. The runtime returns the same handle for both. Current generators emit one component with distinct local endpoint names, so they miss this collision. Compiler acceptance and runtime aliasing were both reproduced.

**Unicode ordering boundary.** The hostile audit reproduced a disagreement between JavaScript UTF-16 string comparison and default PostgreSQL C-collation ordering for U+E000 and U+10000 IDs. The draft expressly excludes general collation equivalence but accepts these strings. Treat this as a confirmed behavior with an unresolved admission/scope boundary, separately from the two failures above; it does not establish every string sort is wrong.

[Hostile readout and repair conditions](./hostile-assay.md) · [fracture scan and controls](./fracture-scan.md) · [compiler receipt](./repros/compiler-report.json) · [runtime receipt](./repros/runtime-report.json) · [PGlite post-commit receipt](./repros/pg-postcommit-report.json).

The fracture scan rejected an offline-first requirement as an outside standard and a top-k replacement case as outside the declared executable slice. No logical contradiction was established in the grammar's conditional support rules. Unknown support and admitted concurrency limits must not be relabeled as newly discovered in-scope failures.

## Oracle coverage

The loss scan identified a missing independence dimension: server effects never change membership independently of the guessed effect. A four-case executable check confirmed the consequence:

| Case | Outcome |
| --- | --- |
| Current selector, server follows guess | Pass |
| Wrong selector: refresh optimistic recipients only, server follows guess | Pass |
| Wrong selector, server changes membership instead | Fail: completed query stays empty |
| Current selector, server changes membership instead | Pass |

This is an oracle-generator gap, not a current recipient-selection bug. The extra branch stays within the supported single-table, full-row, sequential scope. See [probe and control details](./oracle-gap-check.md) and [receipt](./recipient-gap-probe.json).

The grammar source pass also found no malformed-authoritative-response dimension. Existing request validation tests do not establish client rejection of missing, duplicate, or wrong-identity snapshots. That finding is static test-gap analysis; no malformed-response mutant was run in this audit.

## Recovered source material

The three loss passes retain full source-to-reduction ledgers, without deciding what to restore:

- [Detailed grammar → implementation](./loss-grammar.md): most reductions are disclosed. Unknown-query fallback, generation-aware catch-up, sibling overlays, empty actions, multi-table discovery and patch/share strategies remain missing or deferred. Independent server effects and malformed responses are narrower unadvertised proof gaps.
- [Multi-table ground conditions → grammar and implementation](./loss-multitable.md): mutation reads versus writes; possible versus actual writes; multi-commit endpoint histories; permission and absence-sensitive dependencies; maintainable loaded joins; aggregate-specific support; simultaneous join-input cross-terms; unavoidable result fanout.
- [Result-sharing measurements → grammar and implementation](./loss-cost.md): overlap can reverse a correct sharing scheme from roughly 33% gzip savings to roughly 33% growth; raw JSON savings can differ greatly from gzip savings; one SQL statement still does scans/sorts and can be slower. These measured distinctions were compressed into generic cost admission.

The newer one-versus-three **browser request** comparison does not replace the earlier fixed-one-response **SQL/encoding** comparison. Both remain bounded by their own workloads and measurement units. The cost scan found omitted evidence, not a contradiction between those measurements.

## Limits and disposition

These are audit findings, traces and repair conditions. No production code, grammar rule, or original oracle was repaired. Current successful cases and tested server-code boundaries survive; the audits do not certify arbitrary SQL, concurrent response ordering or app-wide dispatch. The prior sources' broader requirements and the draft's explicit exclusions remain separately labeled.
