# Persisted startup: all published eager source adapters

Review base: `736b167ec196f878288f631aff4e82180d9827a5`.
This amendment extends the [prior Query/Convex evidence](2026-11-09-issue-2367.md#shared-persistence-conformance-migration-2026-11-09).
The shared [persisted-startup oracle](../../../packages/db-adapter-conformance/tests/persisted-startup-oracle.ts)
keeps its law, independent set model, history grammar, comparisons and 80-history
run budget. Four receiving adapters now join Query and Convex. The earlier
statement that they were optional remaining work was incomplete: the public
SQLite guide supports wrapping another sync adapter in the same way.

## Law and receiving inventory

A complete eager source result replaces its persisted baseline at the source's
startup readiness cut. A scoped source replaces only its ownership and preserves
peer-supported rows. The SQLite guide's "Add persistence to a synced Collection"
section promises that the wrapper keeps the adapter's sync behavior. Without
`initialRender`, readiness waits for the source's `markReady()`. READY-3/PUB-7,
Query's scope-local omission law and persistence's durable acceptance contract
therefore also apply when persisted restore overlaps the first complete result.

| Adapter | Real receiving boundary | Result |
| --- | --- | --- |
| Query | QueryClient, including initialData/cache and scoped ownership | Existing repair retained |
| Convex | Installed JavaScript SDK over the controlled protocol socket | Passes unchanged |
| Electric | Installed ShapeStream over controlled HTTP responses, fresh offset -1 shape ending with up-to-date | Passes unchanged |
| TrailBase | Controlled RecordApi and native ReadableStream, complete eager list | Parent retains omitted persisted rows |
| RxDB | Real RxDB memory storage and its initial paged query | Parent retains omitted persisted rows |
| PowerSync | Real local PowerSync SQLite table, Node SDK and browser SDK | Parent retains omitted persisted rows |

All six use controlled wrapper storage and real Node SQLite. All six also run
through the same composition and comparison on real Chromium worker/OPFS.
PowerSync's source SQLite database is separate from the wrapper's OPFS database.
Its browser SDK is a test-only dependency. Fresh Electric shape replacement is
separate from resumed delta streams, which need not delete unmentioned rows.
TrailBase has no SDK-wire or deployed-server claim. Remote RxDB replication and
remote PowerSync replication are outside the local-source boundaries tested.
The external vendored Neon compatibility fixture is not a published TanStack
adapter. Built-in local-only/storage Collections are not another upstream source
for this complete-result family; their own persistence laws retain their owners.

## Experiment and repair

Before changing the three production adapters, the new generated receivers ran
against unchanged production on both Node hosts. The initial four-adapter run
had 32 comparison failures and 20 passes: RxDB failed 12 of 13 checks,
TrailBase 10 of 13, and PowerSync 10 of 13. Electric passed all 13. The real
OPFS receiver then ran before the production repairs, including PowerSync's
browser SDK, and rejected 10 startup snapshots: RxDB four, TrailBase three,
PowerSync three. Setup failures during dependency recovery are not RED evidence.

The smallest fixed history retains durable `a`, receives complete `b` before
restore, then finds both `a` and `b` at startup. Empty answers leave `a` too.
The generated grammar also varies overlap, omissions and both restore orders.
Every failure above is a shared `PersistedStartupViolation` at startup, not a
focused probe's private expectation. The parent sources are retained as the
original-defect mutants. Reintroducing their snapshot/sweep decisions is the
wrong implementation rejected by those comparisons.

RxDB and PowerSync previously chose snapshot mode from currently visible rows.
A persisted baseline can still be loading at that decision. Both now choose a
snapshot when the persistence capability exists, while retaining their prior
condition for unwrapped Collections. Metadata uses `null` for an absent
capability. An initial unconditional snapshot attempt broke RxDB's existing
pending-mutation receipt test; the final presence condition preserves that
unwrapped behavior, and its full suite passes without changing expectations.
TrailBase hydrates the baseline before its complete eager-list omission sweep,
keeps its change-event fence active, and rechecks cancellation after the await.
No new lifecycle state or persistent format is introduced.

The shared comparison checks public rows and durable rows after preload, before
a refresh can repair them; public rows inside refresh fulfillment; durability
afterward; and a local-only reopen. Each startup uses one full wrapper-row read.
Query additionally compares ownership and cache/fetch premises. Fixed histories
still contain no expected answers of their own.

## Measured reach and GREEN

Each adapter/host/campaign runs 80 generated histories. Every required state has
its own enforced reach per host and per campaign. The all-adapter run passes
86 checks in six files: 1,920 generated histories, 56 fixed histories, and six
checker calibrations. The four added adapters' final counts follow. Query and
Convex retain their separately measured counters from the same run.

| Adapter / host / campaign | Response before restore | Restore before response | Empty | Changed overlap | Omission |
| --- | ---: | ---: | ---: | ---: | ---: |
| rxdb / controlled / fixed | 37 | 43 | 46 | 27 | 64 |
| powersync / controlled / fixed | 37 | 43 | 46 | 27 | 64 |
| rxdb / controlled / random | 43 | 37 | 39 | 30 | 65 |
| rxdb / node-sqlite / fixed | 37 | 43 | 46 | 27 | 64 |
| rxdb / node-sqlite / random | 39 | 41 | 43 | 28 | 65 |
| electric / controlled / fixed | 37 | 43 | 46 | 27 | 64 |
| electric / controlled / random | 33 | 47 | 51 | 21 | 68 |
| electric / node-sqlite / fixed | 37 | 43 | 46 | 27 | 64 |
| electric / node-sqlite / random | 37 | 43 | 43 | 27 | 66 |
| trailbase / controlled / fixed | 37 | 43 | 46 | 27 | 64 |
| trailbase / controlled / random | 48 | 32 | 42 | 26 | 69 |
| trailbase / node-sqlite / fixed | 37 | 43 | 46 | 27 | 64 |
| trailbase / node-sqlite / random | 35 | 45 | 55 | 12 | 72 |
| powersync / controlled / random | 36 | 44 | 44 | 25 | 66 |
| powersync / node-sqlite / fixed | 37 | 43 | 46 | 27 | 64 |
| powersync / node-sqlite / random | 38 | 42 | 49 | 22 | 67 |

Each added adapter's four fixed histories separately reaches response first
three times, restore first once, empty once, changed overlap twice, and omission
four times on each Node host. Chromium receives eight Query histories and four
for each of the five other adapters: all 28 pass. Its comparison checks result
counts per adapter so one adapter cannot supply another's witness.

Surrounding validation preserves page/event, reload, cleanup and readiness laws.
RxDB passes all 36 runtime checks. TrailBase passes all 164. Electric passes
1,617 runtime checks; its initial full command also reported missing local
workspace type dependencies. After restoring those dependency links and building
Electric, its normal startup command and complete `tsc --noEmit` pass. PowerSync
passes 208 runtime checks initially; its declaration check first failed because
built artifacts were absent. Building the package and rerunning the declaration
and startup files passes all 14 checks. Its package typecheck also passes.
RxDB and TrailBase package typechecks pass. The replay-registry and cleanup
suites pass 119 checks.

All four new guarded replay IDs execute one successful comparison on each Node
host. Electric and PowerSync use seed 2367/path 0. RxDB replays its parent
counterexample with seed 73381209/path 0:0:0, and TrailBase with seed
247682822/path 0:0. The guard records exactly two executions for each. Fixed
histories and fixed campaigns stand aside during replay. Electric and TrailBase
also register the new receiving suites in their existing `test:oracles` commands.

## Review, calibration and limits

Independent review confirmed two issues: testing an absent null capability as
present, and missing oracle-command registrations. Both are repaired. A
simplifier also found cleanup chains that could mask a failure or skip a later
release. Executing the actual four teardown closures with rejecting resource
methods reproduced all four failures. Reusing `withOracleCleanup` makes all four
controls pass: each release runs and all errors survive in order. The ordinary
cleanup-helper tests remain the primary law owner. No user-visible law changed.
The final loss audit accounts for all three review items as fixed, with no
confirmed-open item. Reviewers found useful bounded issues and supplied valid
receiving/replay evidence. Hire recommendation: yes for this review scope.

Independent timing observations confirmed real RxDB and PowerSync source reads
completed before the held baseline released for empty, single-row and three-row
answers. PowerSync supplied the same premise in Node and Chromium. Gate release
alone is not presented as universal control over every provider schedule.

ORC-001/002/003/004: the accepted authority, independent set model and literate
shared grammar are unchanged. The new receivers cross the same legal histories.
Timing ablation loses the startup race, emptiness admits a nonempty-only repair,
overlap misses stale values, and the startup durable cut prevents refresh from
masking stale storage. Duplicate keys and peers for a whole-Collection source
remain excluded. ORC-005/006/013/014: the real receiving boundaries and original
comparison REDs above distinguish the repairs. ORC-007/015: fixed/random parity,
measured per-host reach and guarded replay pass. ORC-008 is inapplicable because
no model state changed. ORC-009 retains the existing source/peer abstraction;
whole-Collection sources expose no Query ownership. ORC-010 has teardown failure
controls and the shared failure-preserving cleanup. ORC-011 has no identified
shared semantic fault that needs a second formulation. ORC-012 is this versioned
record and the final implementation reference. ORC-016: the receiving wrappers
register only shared model/grammar/check executions, with no separate answers.

Limits remain eager initial complete replacement, three string keys and numeric
values, nonempty durable baselines, one wrapper persistence instance, no mutation
during initial fetch, and a refresh confirming the same answer. No on-demand
window, concurrent writer, failed-I/O, arbitrary metadata, remote provider
replication, or every intermediate-publication claim follows. Other lifecycle,
optimistic settlement and provider-resume laws retain their existing oracle
owners. Sampling is not a universal proof. No known reachable counterexample
remains in the declared complete-result startup domain.

The only local registry recovery overrides remain Query Core 5.107.1 to 5.106.0
and fake-indexeddb 6.2.8 to 6.2.7. Their override and lockfile changes stay
uncommitted. The committed lockfile adds only the test-only PowerSync browser
SDK and its dependencies, preserving every previous resolution.

Production gzip growth against merge-base ea3c920c1: Query +26 bytes, PowerSync
+18, RxDB +19, TrailBase +63. Combined package growth is 126 gzip bytes and
112 brotli bytes. The ordinary Query app scenario grows 47 gzip bytes. Source
comments and receiving tests do not ship in these package bundles.

Commands from the repository root:

```sh
pnpm --filter @tanstack/electric-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false tests/persisted-startup-conformance-oracle.property.test.ts
pnpm --filter @tanstack/trailbase-db-collection test --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/rxdb-db-collection test --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/powersync-db-collection build
pnpm --filter @tanstack/powersync-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false tests/portable-declarations.test.ts tests/persisted-startup-conformance-oracle.property.test.ts
pnpm --filter @tanstack/browser-db-sqlite-persistence exec playwright test --config playwright.opfs.config.ts persisted-startup-conformance-oracle.opfs.spec.ts
pnpm --filter @tanstack/db exec vitest run --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false tests/oracle-replay.test.ts tests/utils-cleanup.test.ts
pnpm size:compare --packages query-db-collection,powersync-db-collection,rxdb-db-collection,trailbase-db-collection --files
pnpm lint:changed
```

Final normal-command validation after dependency setup: Electric passes all
1,617 checks in 46 files and PowerSync passes all 209 checks in 14 files, with
no type errors or unhandled errors. Combined with RxDB's 36 and TrailBase's 164,
all four surrounding package commands pass 2,026 checks. Explicit ESLint has
zero errors and two require-await warnings in the Promise-returning PowerSync
host factories. Formatting, `git diff --check` and staged `pnpm lint:changed`
pass. No lowered or removed oracle run budget is reported.

The validated all-adapter implementation is commit
`a0d7d49e54d820ee342443fdb10f74dab23a55db`. This reference update changes prose
only. A later commit-hook automatic install also hit HTTP 403 for
`@tailwindcss/postcss` 4.3.5. An isolated install of the nearest earlier version,
4.3.4, succeeds. Its local override also remains uncommitted. The commit runs
the normal lint-staged hook with pnpm's automatic pre-run installation disabled;
no hook or check is skipped.
