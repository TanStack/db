# Facade read snapshot spike

Status: **not accepted for production**. Production files were restored to
`fd06c647` after the experiment. The replayable
[patch](facade-snapshot-spike.patch) preserves the candidate; the three new
publication probes remain in `includes-functional-projection-oracle.test.ts`.
No prior tests or assertions were removed. No push.

## Question and candidate

Can a shallow copy of facade rows keep public reads stable while a staged
continuation prepares Collection-valued inputs for `fn.select()` in one D2
graph?

The candidate snapshots facade `entries()` into a Map, redirects public
get/has/size/iteration to that Map, and temporarily bypasses that snapshot
while the graph runs. Existing facade adapters prepare Collection inputs,
then a new input on the same graph resumes downstream operators. An existing
D2 reducer retains functional outputs so negative contributions do not rerun
the callback against changed facade contents. There is no second query graph
or deep row clone. There are additional boundary snapshots and a pending
publication list; this is not a demonstrated space reduction.

## Measurements

| Run | Passing | Failing | Scope |
| --- | ---: | ---: | --- |
| Original baseline | 129 | 21 | Existing 150 projection tests |
| Candidate before output reducer | 135 | 15 | Same 150 tests; remaining errors were public-key congruence |
| Candidate with output reducer | 150 | 0 | Same 150 tests |
| Candidate adjacent suites | 370 | 0 | Eleven includes, facade, and functional suites |
| Candidate isolation v1 | 1 | 1 | Held rows versus held index after callback failure |
| Candidate isolation v2 | 1 | 2 | Adds read of a held public handle inside the callback |
| Restored baseline, expanded oracle | 129 | 24 | Existing 150 plus three new probes |

No tests were skipped in these runs. These are test-cell counts, not counts
of distinct bugs. The three new baseline failures occur during initial preload
because the callback receives a null child value. They do not independently
prove that the baseline has the candidate's later isolation failures.

Candidate production delta: **228 added / 49 removed = +179 lines**, including
both new modules (114 lines). This excludes tests, Markdown, and this archived
patch. It does not remove the old deferred-projection path. No bundle or memory
benchmark was run. Before this candidate, executable package source was still
**+3,095 net lines against origin/main `68366eca`**; this spike does not achieve
the user's below-main size target.

Candidate TypeScript exited 2 with no diagnostics for the six candidate source
files or the then-separate isolation test. That is not a package-wide type
pass. ESLint returned six diagnostics, including import ordering and existing
code-path conditions; no clean-lint claim or complete baseline attribution.
The expanded final oracle file passes ESLint and Prettier.

## Isolation failures

All three probes preload parent 1 with child 10, retain its root row and child
Collection, and create an index on child ID. They move the parent to a route
containing child 20. The callback confirms it reads child 20 and throws the
exact sentinel error. The public root must remain the original object.

1. After failure, held facade row iteration returns child 10: passes.
2. After failure, the held index lookup for child 10 returns an empty Set:
   fails. Row-read masking does not mask index installation. Graph execution
   throws before the candidate's flush-local rollback catch.
3. Inside the failing callback, a closure reads the old, already-published
   facade and observes no children: fails. The draft-read bypass applies to
   that public handle too, not just the callback's supplied input.

These are two observation failures in one controlled route-change history,
not an exhaustive lifecycle matrix. The callbacks deliberately read a held
handle; the current test contract does not silently forbid that use.

## Decision and next gate

Do not ship the global read-mode switch. Preserve the successful staged graph
and D2-reduction experiment as evidence, not an accepted architecture change.
Before another broad implementation, test whether a distinct private input
view can leave public Collections and indexes untouched, then publish once.
That candidate must define handle identity and callback outputs that retain a
facade, including opaque wrappers; it cannot assume a generic output walk can
rewrite handles hidden inside closures. No API restriction has been approved.

Still unmeasured: pending async refinement, reentry across graphs, new
subscribers during staging, nested facade readiness, cleanup/retirement and
snapshot release, callback outputs holding draft views, memory bounds, the
940-cell lifecycle rerun, and the queued 100x campaign. Stop this candidate at
its failed isolation gate instead of adding patches to each reader.

## Raw local reports

- `/tmp/tanstack-facade-snapshot-spike-v1.json`
- `/tmp/tanstack-facade-snapshot-spike-v2.json`
- `/tmp/tanstack-facade-snapshot-spike-adjacent.json`
- `/tmp/tanstack-facade-snapshot-isolation-v1.json`
- `/tmp/tanstack-facade-snapshot-isolation-v2.json`
- `/tmp/tanstack-facade-snapshot-baseline-expanded.json`
- `/tmp/tanstack-facade-snapshot-spike-types.txt`

These reports are local temporary artifacts, not committed evidence bundles.
The archived patch applies cleanly to the restored production baseline.
