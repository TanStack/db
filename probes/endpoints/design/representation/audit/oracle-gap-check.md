# Executable follow-up: guessed recipients do not certify actual recipients

This bounded check tests LG7 from the isolated [grammar loss pass](./loss-grammar.md). It does not change the frozen implementation or its original oracle generator. All mutations happen in the driver's disposable copies.

One supported program has all, active, and completed queries. The completed query is retained with zero subscribers. The client guesses an active insert. The extra server branch inserts that same row as completed instead. The independent PG reference changes only its confirmed operation; the tentative operation remains the client's active-row guess.

A deliberately wrong client selector requests only collections present in the optimistic transaction. The current implementation instead requests every retained collection because actual effect coverage is unknown.

| Selector | Server outcome | Existing row/order oracle | Meaning |
| --- | --- | --- | --- |
| Current conservative selector | Matches active guess | Pass | Ordinary positive control |
| Optimistic recipients only (mutant) | Matches active guess | Pass | Existing-style history does not expose wrong selection |
| Optimistic recipients only (mutant) | Inserts completed instead | Fail at successful settlement | Completed query wrongly remains empty |
| Current conservative selector | Inserts completed instead | Pass | Production draft already handles the added branch |

[Executable probe](./recipient-gap-probe.mjs) · [four-case receipt](./recipient-gap-probe.json).

The check runs the actual compiler, server RPC, browser collections, transaction runtime and separate PGlite reference through the existing Driver. Each case builds its own disposable program and scans production client artifacts. The injected faulty selector exists only in the disposable copy. The altered server body remains server-only.

**Disposition:** confirmed oracle generator gap, not a current read-selection defect. The existing-style positive case can pass under an invalid selector. An independent server membership branch is enough to expose it without introducing joins, additional tables, concurrent operations, lifecycle races or unsupported predicates. These four cases do not claim to run every old generated history under the mutant.

The smallest missing generator dimension is an actual server effect independent of guessed membership/identity; the reference must retain the tentative-versus-confirmed distinction. A request-set assertion can also check the current unknown-coverage policy, but does not replace row-result comparison when selective reads become legal. No restoration decision or production change was made.
