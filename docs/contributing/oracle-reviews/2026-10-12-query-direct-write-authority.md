# Query direct-write authority review — 2026-10-12

The external medium-effort review read PR #2065 at `9fdcd2e48` without running
tests. This record evaluates all ten claims against that revision and the
repair commit `99c1758e2b451065c88be0c30ebd782678ebf026`. The earlier
[review of `74e399150`](pr-2065-74e399-review.md) describes an intermediate
implementation; its provisional law choices do not govern this commit.

## Laws, experiments, and inference

The [Query Collection guide](../../collections/query-collection.md#direct-writes-and-query-sync)
and the maintainer's explicit decisions supply three laws. The Query cache is
the source of truth: compatible eager Collections sharing an exact physical
Query project representable direct cache edits. For a returned key shared by
overlapping on-demand subsets, the later-started successful fetch controls
its value even if an older request settles last. A successful complete
on-demand response may retire an omitted ownerless direct row in its scope;
subset unload or a disjoint, windowed, failed, or pre-write result cannot.
Direct writes themselves start no Query request. A physical fetch started
before an accepted write cannot undo its claimed keys. A local cache edit is
not a physical fetch for an on-demand peer that has not acquired the scope.

The primary executable owner is
[`ownership-lifecycle.oracle.test.ts`](../../../packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts).
Its reference folds authored fetches and direct writes by position and tracks
subset owners independently of Query Core's cache-version and event
classifiers. Real QueryClient observers, public Collection rows, provider call
counts, selected cache envelopes, and managed node SQLite provide the driver
and observations. The cursor integration oracle separately receives eager
empty-cache seeding. Histories compare the write cut, held-request cut,
result application, both subset-release orders, cleanup/restart, and durable
storage after a complete fetch. Those intermediate cuts matter: final row
equality alone would miss a peer briefly adopting an unverified cache edit.

The reviewed implementation was RED for reverse-settled overlapping fetches,
complete ownerless-row omission, and several eager shared-cache histories.
The added histories also exposed a reentrant notification bug: Query Core
notifies observers before its QueryCache success listener, so an observer can
write directly to the cache between the physical success action and that
listener. The old listener recorded the now-mutated cache state as fetched.
A late on-demand peer then settled on the local row without a request. The
new history was RED at the peer's held-request checkpoint and GREEN when the
listener used the success action's payload as fetch identity and retained the
local-edit marker. A real SQLite restart history verifies that the complete
empty provider response runs and removes an ownerless row from both public
state and durable storage. Offset, cursor, limited, disjoint, nonempty, and
failed-result neighbors distinguish complete omission from broad deletion.

The eager composition history writes different keys from A and B while B's
result application is held. It requires the shared cache to contain both
edits, preserving unrelated rows and `{ items, tag }` envelope metadata;
raw-array and direct-select variants pass. A proposed assertion that B must
still show both edits *after* releasing `deferDataRefresh` was rejected:
release starts a new physical fetch, which may authoritatively replace them.
The held cache and unblocked A are the appropriate composition checkpoint.
The overlap model verifies values after each settlement and ownership after
releasing older and newer subset claims in both orders. The original code
failed three reverse-settlement histories. Hostile controls for alias fetch
positions, raw-only cache patch provenance, and sync-run marker identity
reached their intended public-row or held-request assertions. These are
finite instruments, not proof for every possible schedule.

## Lossless finding ledger

| ID | Reviewed claim | Evidence and disposition | Durable value |
| --- | --- | --- | --- |
| R1 | Old ownerless direct-write positions survive restart and suppress cached server rows. | **Fixed now.** A real QueryClient restart/cached-peer history was RED on the reviewed code and GREEN after retiring positions at run boundaries. | The owner checks insert/delete and cache-reacquisition neighbors. |
| R2 | Eager A's direct write reaches eager B through a shared Query. | **Accepted design.** The maintainer chose shared Query-cache projection. Raw and selected-wrapper composition histories enforce that choice. | The guide names representable edits and compatible peers. |
| R3 | An older subset fetch can replace a newer fetch's shared row. | **Fixed now.** Reverse-settlement histories were RED; accepted per-row positions preserve the later-started result's value while allowing the older subset to claim ownership. | Seven histories check prior ownership, both settlement orders, equal values, direct writes, and symmetric release. |
| R4 | A metadata gate always forces a nonpersisted ownerless-row refetch. | **Refuted as a behavioral claim.** A same-path nonpersisted probe kept its position and made no extra request. | Cold persisted collision and stable-empty scan histories cover the meaningful receiving boundary. |
| R5 | Direct `setState` sends no cache event and its counter use is wrong. | **Refuted as stated.** QueryCache emits `updated` with a `setState` action; success-only listeners intentionally do not treat the local edit as a fetch. | The reentrant success and local `setQueryData` histories guard fetch provenance. |
| R6 | The Query Core peer minimum rises from `^5.0.0` to `^5.90.15` in a patch. | **Accepted design.** This is factual; the maintainer explicitly chose to keep the patch. 5.90.15 passed the full package suite; 5.90.14 and 5.85.2 failed authority/error witnesses. | The changeset and coverage map state the minimum and reason. |
| R7 | Empty retained subsets repeat full persisted scans. | **Fixed now.** A controlled scan-count witness failed before the guard and passes afterward; a cold durable-owner control still scans. | Work is bounded for a stable empty retained baseline. |
| R8 | Ownerless direct inserts and positions can outlive subset unload. | **Accepted design** for the row's surgical lifetime after unload. A later successful complete matching response now claims or retires it; the reviewed code was RED for explicit empty refetch. | The guide and scope matrix state the exact settlement boundary. |
| R9 | Hot-path select and accepted-row work repeats per direct write. | **Fixed now.** Source comparison shows one changed-row snapshot and reuse of the inspected selected array. | No new latency law is inferred from a source-only cleanup. |
| R10 | A WeakMap holds an old fetched array; a version number would suffice. | **Refuted as an equivalent remedy.** One array is retained per live Query; `setState` deliberately does not bump `dataUpdateCount`, so a count alone loses fetched-payload identity. | Measure retained live-Query payloads before changing provenance storage. |

The review comparison footnote that the prior `writingDirectCache` ownership
findings disappeared is accurate for that intermediate implementation. The
claim that R1/R3/R4/R7/R8 were new is provenance, not a separate defect.
Earlier parallel-agent findings are retained in the primary oracle and
coverage map rather than merged into these ten source-order IDs.

## Sibling findings and oracle audit

The fresh oracle reviewers found five useful enforcement gaps. The repaired
oracle now checks wrapped eager composition, offset and cursor exclusions,
durable persisted retirement and provider execution, and both ownership
release orders. The reentrant success history is a newly confirmed product
bug with its own RED/GREEN witness. A cursor integration history caught a
separate eager cache-seeding regression introduced during composition work:
an undefined raw cache entry received only the changed delta, losing other
rows. Seeding it from the accepted full snapshot restored that contract.
Source inspection also found that per-row accepted positions survived a
sole-owner unload after the public row was deleted. Cleanup now retires that
position after accepted deletion and the late fetch microtask checks that
the row still exists. This internal memory bound has no public-size assertion;
its proof is the map's insertion and deletion paths plus the passing ownership
suite, not a claimed heap benchmark.

The oracle's law, reference, history, driver, and checkpoint are separated in
its literate prose and tests. Its expected rows come from authored actions and
owner sets, not production's event classifier. The real Query Core and node
SQLite paths are receiving witnesses; the provider payloads and timing remain
controlled. The final Query DB package run passed **1,247 tests in 36 files**,
including 321 ownership-oracle runtime tests and 174 Vitest type tests, with
no type errors. Package TypeScript and build passed; ESLint had no errors and
ten warnings. Prettier and `git diff --check` passed.

The finite claim excludes incompatible eager selects, larger overlapping
fetch schedules, a newer complete omission followed by an older same-key
response, same-run external durable writers, non-node persisted adapters,
and local-patch provenance after Query cache dehydration into a different
QueryClient. The [coverage map](../oracle-coverage.md) assigns these
receiving boundaries. No known reachable counterexample remains within the
accepted returned-key and complete-scope laws exercised here.

The reviewer found important real ordering and work gaps, especially R1, R3,
and R7, and prioritized several meaningful risks. It also inferred a missing
cache event, an unwanted nonpersisted refetch, and an equivalent version-stamp
optimization that did not survive same-path checks. It ran no tests and did
not separate policy questions from confirmed bugs. **Hire for exploratory
review, with reproduction required before sign-off**: its counterexamples
were valuable, but its conclusions were not independently reliable.

The raw-item audit is complete: four fixed now (R1, R3, R7, R9), three
accepted designs (R2, R6, R8), and three refuted claims (R4, R5, R10).
There are no deferrals or unresolved product decisions in these ten items.
PR readiness still depends on verifying the pushed head and its CI; this
review record alone does not grant merge readiness.
