# GC retention: size after main integration

This record supplements [the earlier size refactor](pr-2258-gc-size-refactor.md).
Its measurements remain historical. This record evaluates the complete PR
against `origin/main` at merge-base
`6c1ca8f8f9efe437d3cea61b5b9d0a086e2a5e34`, after a normal merge at
`80159c9ec`. The evaluated revision is the commit that first adds this record.
`sizeIntegration.sha256` in [the source record](pr-2258-gc-retention.sources.json)
binds its production sources and unchanged oracle drivers.

## Preserved behavior and simpler state reads

The final integration adds no product law, oracle rule, history, assertion or
run budget. The original GC defect, authority, RED/GREEN evidence and limits
remain in the retention reviews. This is an internal refactor, so the initial
GREEN implementation is not evidence of another product defect.

Current and prior optimistic layers now share one keyed-row lookup. Current
and prior virtual-property snapshots share one computation, replacing separate
sync-status and attribution helpers and an override wrapper. Every supplied
prior state contains its three required maps, while current snapshots default
to the state manager. Local-only rows remain local and synced. Existing virtual
fields on upstream rows still take precedence during enrichment. Prior rows
are enriched before current rows so the cache retains the published value.
Collection identity compares directly, and mutation application reads each
incoming global key once. Removed private members leave the mangle cache.

The preceding refactor also shares transaction completion, mutation merging,
GC renewal, idle cleanup and queue dispatch, and prunes settled transactions
with deferred sorted-map deletion. These reductions pay for persisting holds
without changing cleanup error identity, settlement order, handoff deadlines,
last-unsubscribe delay or pending-rollback deadlines.

## Executed evidence

The final source passes **636 tests across 18 files**, with no type errors.
This retains the earlier 608-test selection and adds the row-metadata
composition, metadata publication and virtual-row-field owners. It covers
GC, mutation admission, ownership, queue behavior, cleanup/restart, optimistic
payloads, composition, outcomes, publication and settlement boundaries.
The fixed and random GC campaigns retain all declared reach requirements.

A hostile mutant discards supplied prior maps by assigning `state = this` at
snapshot creation. The existing publication oracle rejects it at the raw
subscriber's prior-row semantics, and the metadata publication owner rejects
its callback event batches. The four-file run reports 41 failures and 35
passes. Six of the failures are checker-calibration prerequisites and are not
independent mutant kills. The metadata property shrinks to seed `1805001`,
path `1:2:2:2:3:3`: two same-key committed edits with metadata set then delete.
These are assertion failures, not setup errors or timeouts. Row-metadata
composition and virtual-row-field owners pass under this mutant and receive
no kill credit. The exact source bytes are restored, then all **76 tests in
these four files pass**. The preceding ordinary-deletion mutant remains in
the earlier record.

Native Chromium passes **3/3 histories**. Real Electric/Postgres passes
**12/12 paths** using the freshly built DB package, including both sibling
settlement orders and a SQL-open survivor beyond the first-release deadline.
These remain separate host and provider witnesses. They do not establish a
combined browser/provider schedule or expand the earlier bounded claims.
DB source/test TypeScript, focused ESLint, Prettier, private-member cache and
whitespace checks pass. Logs remain under `/private/tmp/pr-2258-size`, with
`final18-` prefixes, `candidate18-size.log`, `prior-state-mutant-red.log` and
`prior-state-restored-green.log`.

## Whole-PR shipped bytes

`pnpm size:compare --packages db --files` uses the normal production minifier,
app scenarios and compression settings against merge-base `6c1ca8f8f`.
Every measured output decreases in both formats:

| Production output | gzip delta | Brotli delta |
| --- | ---: | ---: |
| DB bundle | -180 B | -165 B |
| Typical app | -173 B | -59 B |
| App with Effect | -156 B | -121 B |
| App with groupBy | -137 B | -246 B |
| App with includes | -172 B | -178 B |
| App with join | -171 B | -98 B |
| App with LocalStorage | -169 B | -186 B |
| App with optimistic action | -155 B | -64 B |
| App with paced mutations | -174 B | -164 B |

No names, comments, formatting, compression settings, scenario definitions or
minifier options change to obtain this result. Tests and contract documentation
are separate from these shipped-byte measurements. This integration changes
no test expectations and adds only this evidence and source binding.

The local-only install workaround remains uncommitted:
`baseline-browser-mapping@2.11.32` returns HTTP 403, `2.11.31` is unavailable,
and `2.11.30` installs. Both comparison trees use that override. Existing
overrides remain intact; neither workspace nor lockfile changes enter the PR.

## CI follow-up

CI on `a8b047cb5` passes every completed runtime shard except the frozen
error-site source-template check. That check records the interpolation
identifier as well as the message literals. Restore its original `_exhaustive`
identifier without changing the runtime message, error code or diagnostic
parameter key. All **19 production-error oracle tests pass** without changing
an expectation. A fresh size comparison retains every byte delta above.

The documentation snippet check also identifies one obsolete suppression:
`packages/db/skills/db-core/persistence/SKILL.md#81435553635b5b53` now compiles.
Delete only that baseline entry. The complete check then retains the other
279 known failures across 757 examples, with no new failure or stale entry.
No documentation example or oracle expectation is weakened. The final source
binding is `sizeCiFollowup.sha256`; earlier bindings retain their historical
commit meanings.


## Main integration at 1640de834

A normal merge integrates main `1640de834bca0588f91432ea80a0f4569157e9dc`
with published head `bb188e6eff58d850091766e930aa2bb2e4978772`.
The only textual conflicts are the private-member cache and replay selectors.
The replay registry retains both branches' entries. The official mangle
writer starts from main's assignments, drops removed private helpers and
assigns `gcGraceUntil` the free name `aP`. Main's lifecycle change resets the
cleanup promise only when a replacement run actually enters `loading`.
The GC retention refactors remain intact. No model, history, comparison,
expected result or run budget changes in this resolution.

The fresh production comparison against this main revision reports:

| Production output | gzip delta | Brotli delta |
| --- | ---: | ---: |
| DB bundle | -170 B | -39 B |
| Typical app | -182 B | -72 B |
| App with Effect | -159 B | -200 B |
| App with groupBy | -129 B | -130 B |
| App with includes | -169 B | -297 B |
| App with join | -160 B | -124 B |
| App with LocalStorage | -182 B | -198 B |
| App with optimistic action | -169 B | -183 B |
| App with paced mutations | -172 B | -176 B |

This measurement uses `pnpm size:compare --packages db --files --exact-base`
before the merge commit, so its baseline is the fetched main revision rather
than the older HEAD merge-base. The temporary baseline uses the same local
`baseline-browser-mapping@2.11.30` override as the candidate. The override and
lockfile remain uncommitted.

Native Chromium passes 3/3 histories and Electric/Postgres passes 12/12 paths
on the merged production sources. DB source and test TypeScript, changed-file
lint, mangle validation, conflict-file formatting and whitespace checks pass.
The replay manifest's three registry checks pass. The first expanded test run
finishes its 21 core files, but its additional guarded replay subprocess
campaign stalls and is interrupted. That run is not credited as a clean GREEN.
A separate core run supplies the final suite result below. Logs use the
`main164-` prefix under `/private/tmp/pr-2258-size`.

The separate core run passes **1,033 tests across 21 files**, with no type
errors. It includes the updated cleanup/restart and subscription-lifecycle
owners from main. The source binding is `main164Integration.sha256`.
