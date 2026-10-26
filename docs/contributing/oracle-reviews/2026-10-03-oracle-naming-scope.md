# Oracle naming scope correction — 2026-10-03

Reviewed implementation: [fe40ab59191d046bda12cc9563cdc4a82b5fd97c](https://github.com/TanStack/db/commit/fe40ab59191d046bda12cc9563cdc4a82b5fd97c).
Classification evidence refers to `134b7e8bacce5999ab7e06da96d5dbe9989820f5`, before the reverse moves.
The [classification ledger](2026-10-03-oracle-naming-scope.json) names each evidence path and its line numbers, final path, role, and naming decision.

## Corrected scope

The earlier claim of 251 executable oracle owners and dedicated companions was too broad.
The audit category included ordinary examples, type assertions, harness tests, fixtures, and documentation.
Converting that category directly into a rename list was incorrect.
This record supersedes the naming inventory in [the original review](2026-10-02-glossary-alignment.md).
Its 39 terminology resolutions remain intact.

This correction restores 101 original filenames and their imports, commands, replay references, and current documentation links.
The PR retains 63 moves: 57 files that execute an independent oracle and six model, grammar, or checker definitions.
Each retained move has a named mechanism and source evidence in the ledger.
Existing filenames that already contained `oracle` before this PR remain unchanged.

| Role in the original 251-file review scope | Files |
| --- | ---: |
| Executes an independent model, comparison, or generalized checker | 121 |
| Defines an independent model, checker, or its history grammar | 10 |
| Ordinary example, regression, or concrete type-assertion tests | 67 |
| Drivers, fixtures, registration, or supporting declarations | 34 |
| Harness, checker-calibration, or prototype tests | 17 |
| Documentation | 2 |

These are file roles within the previous inventory, not a count of distinct oracles across the repository.
Several files execute the same model, and a mixed test file can contain multiple oracle mechanisms.
The classification is conservative for borderline cases. It does not declare all pre-existing oracle names correct.

## Naming evidence

A retained owner executes an independent expected-result computation, state model, differential comparison, metamorphic relation, or reusable law checker.
A definition owns that model, checker, or its history grammar and names its receiving owner.
Random generation is not required. Fixed histories can execute an independent model, as the optimistic settlement histories do.
Ordinary fixed assertions and parameterization alone are insufficient.
Coverage-map entries and opening comments do not substitute for executable evidence.

Examples of restored names include `transactions.test.ts`, `query.test-d.ts`, the framework `conformance.test` entrypoints, and `trace-runner.ts`.
They contain fixed assertions, registration/driver mechanics, or generic execution plumbing.
Examples of retained names include `SortedMap-oracle.test.ts`, which compares against native Map plus full sorting,
and `proxy-oracle.test.ts`, which contains a native-value differential callback model alongside ordinary examples.
The test-only no-peek candidate returns to `no-peek.ts`; the independent filter/sort/slice reference remains `model-oracle.ts`.

The contributor guidance now states this distinction and requires separate counts for owners, definitions, and support.
It does not add a CI linter or introduce new product contracts.

## Preservation checks

An independent content comparison accounted for all 2,164 tracked files before final whitespace formatting.
It found 2,048 unchanged blobs, 114 files with mapped path-reference substitutions, and the two naming-policy documents.
The correction preserves glossary definitions, identifier/prose fixes, assertions, model rules, and campaign inputs.
Final formatting changes only whitespace around shortened paths.

Static checks found all 101 restored paths and all 251 classified files present and indexed.
They checked 672 relative imports, 68 explicit command paths, five browser script entries, and 42 replay targets.
Replay title selectors remained valid. No stale restored-name references or escaped filename patterns remained in current files.
Historical review records and immutable revision links retain their original paths.

## Validation after the correction

| Runtime check | Passed | Files |
| --- | ---: | ---: |
| DB | 7,962 | 210 |
| IVM | 704 | 44 |
| Offline | 242 | 18 |
| SQLite core | 375 | 9 |
| Node SQLite | 109 | 5 |
| Browser SQLite | 242 | 9 |
| Electron SQLite | 97 | 3 |
| Electric | 629 | 13 |
| Query DB affected no-peek suites | 18 | 2 |
| React, Vue, Solid, Svelte, Angular receiving suites | 290 | 9 |
| Total | 10,668 | 322 |

SQLite core also reports one todo. Scoped ESLint passed for 166 changed TypeScript files.
Formatting and `git diff --check` passed.
These runs used the same installed dependencies described in the original record, with coverage and integrated typechecking disabled.
The direct command was `node <installed-vitest>/vitest.mjs run --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1 --reporter=dot`.
DB used two workers. Framework and Query DB checks selected only the affected receiving files.

The earlier locked-dependency, integrated-typecheck, and intermittent Query DB baseline limits remain.
This correction did not rerun the full Query DB package, package builds, or external-provider/native-host E2E campaigns.
No new typecheck or real-host claim follows from the runtime passes.
