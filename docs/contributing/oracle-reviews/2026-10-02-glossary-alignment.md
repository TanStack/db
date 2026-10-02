# Oracle glossary alignment — 2026-10-02

Reviewed implementation: [f993daf838da4905d3a327cf6c66d8bdf16d106b](https://github.com/TanStack/db/commit/f993daf838da4905d3a327cf6c66d8bdf16d106b).
Implementation base: `b940a363a7631c49e14dc67e2adeda0a96dc366c`. Original glossary audit: `06cab6fc7b808acfbfb3af1eb2fc1fdc3c9f0fa8`.

This review resolves 39 retained terminology findings: 18 substantive and 21 minor.
The inventory contains 251 executable oracle owners and dedicated companions.
All filenames contain `oracle`, after 164 moves. Generic fixtures and utilities retain their existing names.

The [companion ledger](2026-10-02-glossary-alignment.json) preserves every retained finding, its original evidence,
its resolution, the complete owner inventory, and the old-to-new path map.
Original line numbers refer to the audit revision. Current paths refer to the reviewed implementation.
Historical review records and immutable revision links remain unchanged.
Later changes require a new record or an append-only entry tied to their own revision.

## Scope and result

Shared terms now name the same boundaries in model declarations, driver observations, and glossary prose.
Model abstractions explicitly describe combined or split production concepts.
The changes preserve model rules, assertions, grammar domains, and campaign budgets.
They also update imports, test commands, replay selectors, coverage links, and browser entry modules after the moves.
Production runtime behavior is unchanged. The only production TypeScript edit corrects a draft-extraction comment.

This is an ORC-009 vocabulary review and a filename-discovery change.
It does not reassess full ORC-001–014 conformance or close any runtime bug class.
Earlier coverage gaps and review findings outside terminology retain their prior status.
Two stack-checkpoint regexes now match their renamed comparison and Electric SDK oracle filenames.
Their existing checkpoint and shrinking tests verify those path adjustments.

## Resolution map

| Domain | Findings | Canonical distinctions |
| --- | ---: | --- |
| Collection lifecycle | 3 | Failed replay versus publication, unsubscribe versus sync run, tentative versus accepted acquisition |
| Optimistic state and values | 2 | Draft extraction versus publication, observation mutant versus runtime fault |
| Includes | 3 | Mutation-handler gate versus startup, bucket versus route, acquisition fulfillment versus initial-query readiness |
| Acquisition and pagination | 5 | Load result versus applied receipt, response processing versus fulfillment, request shape, subscription readiness |
| Core query | 3 | Mutants, equality-partition identity, graph publication versus promise settlement |
| D2 and comparison | 4 | Weighted deltas versus messages, index observations, snapshot cut, comparison domains |
| Query DB | 4 | Compressed model actions, Query fetch versus acquisition, qualified generations, fulfillment-only observations |
| Providers | 3 | Sync run versus provider session, persistence fulfillment, provider control and persistence boundaries |
| SQLite core | 3 | Wrapped sync receipt, adapter reopen, Collection readiness |
| Browser and Electron | 3 | Layered acquisition ownership, committed-message posts, composite promise chain |
| Offline transactions | 4 | Caller success boundary, observation mutants, executor restart and outbox replay, promise fulfillment |
| Frameworks | 2 | Input/window changes and fulfilled page fetches |

## Validation

These are unique runtime results from package runs, except the selected framework receiving suites.
The final DB run includes its renamed replay, checkpoint, and oracle files.

| Package or receiving suites | Passing tests | Files | Result |
| --- | ---: | ---: | --- |
| DB | 7,962 | 210 | Passed |
| DB IVM | 704 | 44 | Passed |
| Offline transactions | 242 | 18 | Passed |
| SQLite persistence core | 375 | 9 | Passed, one todo |
| Node SQLite persistence | 109 | 5 | Passed |
| Browser SQLite persistence | 242 | 9 | Passed |
| Electron SQLite persistence | 97 | 3 | Passed |
| Electric | 629 | 13 | Passed |
| TrailBase | 67 | 3 | Passed |
| PowerSync | 176 | 9 | Passed with local native SQLite |
| Query DB | 557 | 16 | One intermittent baseline failure |
| React, Vue, Solid, Svelte, Angular receiving suites | 290 | 9 | Passed |

The final supplementary no-peek model rename also passed its 18 affected tests across two files.
The Electric SDK checkpoint follow-up passed all nine tests in that file.
These focused repeats are not additional unique test counts.

Builds passed for DB, IVM, Offline, Query DB, SQLite core, Node, Browser, Electron, Electric, TrailBase, and PowerSync.
Standalone TypeScript checks passed for IVM, Offline, and Query DB.
Selected framework runs reported no type errors. They were not full framework-package campaigns.
ESLint checked the changed TypeScript files directly in package groups.
Scoped formatting and `git diff --check` passed.
Static checks covered all renamed paths, relative imports, explicit commands, replay targets, and browser script entries.

### Commands and environment

Validation used the installed Node, Vite, Vitest, TypeScript, and ESLint entrypoints directly.
The shell hook invokes pnpm, which attempted dependency installation with the reused dependency tree.
The equivalent scoped ESLint check ran directly before commit instead.
Runtime reruns used the following arguments from each package directory:

```sh
node <installed-vitest>/vitest.mjs run --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot
node <installed-vite>/bin/vite.js build
node <installed-typescript>/bin/tsc --noEmit
```

DB used two workers. IVM, Offline, and selected framework runs retained their normal integrated typecheck setting.
The environment used Node 24.19.0, Vitest 3.2.4, TypeScript 5.9.3, and Vite 7.3.2.
The package mirror refused some locked dependencies, and the public registry was unavailable.
Validation reused installed dependencies with workspace links directed at the isolated implementation checkout.
For example, installed Seroval was 1.5.0 while the lockfile requires 1.6.8. The lockfile is unchanged.

### Limits and baseline evidence

Default integrated Vitest typecheck lanes are not green under the available dependencies.
They report cross-package `rootDir` diagnostics against unchanged source/configuration boundaries.
Some persistence lanes also report existing generic-cast diagnostics in `persisted.ts` at lines 4976 and 5098.
Those sources remain unchanged. No full baseline typecheck campaign establishes their root cause.
Runtime-only passes do not establish type correctness for those lanes.

Query DB's unchanged `awaits persisted server responses in update handlers` test intermittently fails its terminal-row assertion.
It expects revision 3 and `$synced: true`, but observes revision 2 and `$synced: false`.
The complete original test file reproduces the same failure under the installed dependencies.
A full original-package control passes 558 tests, and the isolated original test also passes.
The changed-package repeat passes 557 tests with that same failure. All Query DB oracle suites pass.
The test executes before the changed oracle files, and the original-file control fails independently of those files.
This supports an intermittent baseline classification. Its root cause remains unestablished.
The baseline copy preserves original sources and filenames, with four external helper imports adapted to their renamed paths.

No external-provider, browser-host, Electron-process, or native-device E2E campaign ran.
Local SQLite paths and controlled runtime fixtures executed within the package suites.
Static entrypoint checks establish path consistency only.
