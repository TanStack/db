# Loss audit: collated source traces

Three fresh source scanners independently compared a source output to the frozen representation grammar and implementation. Sibling source passes and other auditors' findings were hidden during each scan. This collation preserves their distinctions; it does not rank omissions or choose restoration work.

| Source output | Source-pass ledger | Recovered/dropped traces |
| --- | --- | --- |
| Detailed representation grammar: model, preservation, evidence, process, brief | [Grammar loss pass](./loss-grammar.md), LG1–LG8 plus full unit/relation/rule/control coverage | Mostly explicit deferrals. Independent server effects and malformed authoritative responses lack negative oracle coverage. |
| Multi-table ground conditions | [Multi-table loss pass](./loss-multitable.md), MT01–MT20 | Mutation read/write roles, possible/actual effects, partial-commit histories, permission/absence dependencies, positive supported joins, cross-terms, aggregate support and fanout details compressed or absent. |
| Result-sharing ground conditions and measurement receipt | [Cost loss pass](./loss-cost.md), C1–C12 | Within-one-response controls, overlap/compression reversals, residual SQL work, compatibility rules and distinct measurement/proof boundaries compressed out. |

## Dispositions that must remain separate

**Explicit first-draft deferrals:** arbitrary unanalysable-query execution, multi-table compiler/effect observation, lifecycle generations, concurrent response ordering, sibling-overlay evidence, empty/conflicting guesses and patch/share implementations. Their absence is real, but the draft states these limits. The audit does not turn them into newly discovered failures inside the supported slice.

**Supported source distinctions lost through compression:** mutation reads versus writes; endpoint function versus commit boundary; dependencies on absent rows and changing permissions; the positive case where a fully loaded joined result is enough; aggregate-specific state; simultaneous join-input cross-terms. “Unknown support” or “effects span tables” is broader wording that does not retain each distinction. The source ledgers preserve the original evidence levels: the multi-table source is analytical, not an executed broad oracle.

**Measured detail lost through abstraction:** correct shared encoding can save or add bytes depending on overlap; raw JSON savings differ from gzip savings; one SQL statement retains per-query work and can be locally slower. The newer browser request comparison is not contrary evidence: it changes both the comparison and measurement boundary. Current prose labels its decoded bytes and instrumented timings, while standalone JSON requires those labels from its surrounding documentation.

**Missing proof of retained rules:** LG7 (actual recipients independent of guessed recipients) and LG8 (malformed authoritative response rejection). These are within the current representation's obligations even though no current code fault was established by the static scan.

## Bounded executable addendum to LG7

After the isolated scan finished, the orchestrator ran [four controlled full-stack cases](./oracle-gap-check.md). Refreshing only optimistic recipients passes the ordinary matching-server insert but fails when the server independently changes membership. The current conservative selector passes both. This upgrades LG7 from static sensitivity analysis to a demonstrated generator gap. It is not evidence that current production read selection is wrong, nor a claim that every existing history was replayed under the mutant.

LG8 remains static test-gap analysis. No malformed-response campaign was run here. The independent hostile auditor's implementation faults remain in [its readout](./hostile-assay.md), rather than being retroactively inserted into the fresh source scans.

## Preservation and limits

The reduction retains the central distinction between guesses and authority, all non-GCed recipients within its stable-set scope, ordinary writable collections and synchronous actions, conservative unknown-effect reads, and separate safety/cost decisions. It also preserves broad deployment and concurrency disclaimers. Selection of a bounded implementation is disclosed as a later authorized action; it was not a result of the grammar or earlier measurements.

Scope is these three source outputs and the named reduction, not every sentence in the entire Field Log or all database prior work. Every selected source has a complete pass and dropped/preserved trace. No decision about which recovered item is useful enough to restore was made. No production implementation, frozen grammar, or existing oracle was changed.
