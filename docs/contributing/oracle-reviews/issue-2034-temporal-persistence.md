# SQLite Temporal persistence reproduction

Issue: [#2034](https://github.com/TanStack/db/issues/2034).
Owner: [SQLite typed-value oracle](../../../packages/db-sqlite-persistence-core/tests/sqlite-temporal-value-oracle.test.ts).

## Revision and scope

Recorded 2026-10-05 against production commit
`84dc899bfc8d6a16487c1584dbb1cb177109aacc` (`origin/main`).
Branch: `codex/temporal-persistence-oracle`.
The oracle is an uncommitted diagnostic addition with SHA-256
`ec38aeca3145a6b51561247d3dc3996ab50a05317414d070147728130ffd656b`.
Production code is unchanged. This is a reproduction, not a bug-class repair.

The requested Temporal preservation behavior comes from the issue. Existing
core tests establish Date/BigInt preservation but do not establish a complete
Temporal support policy. Explicit rejection remains an alternative product
choice. These tests deliberately expect preservation and remain RED; they are
not expected-failure tests and must not be presented as passing CI.

The independent model assigns two fixture ordinals to earlier/later values.
It predicts literal type/text observations and query keys without production
serialization, comparison, or SQL helpers. It does not prescribe stored bytes.

## Execution receipt

Runtime: macOS arm64, Node 24.19.0, SQLite 3.53.3, Vitest 3.2.4,
`temporal-polyfill` 0.3.0. The issue used polyfill 0.3.2; this reproduction uses
the repository's existing locked version.

The full bounded matrix ran 21 tests: **13 passed, 8 failed**, exit 1.
All 16 production cases reached a file-backed SQLite close/reopen.
Eight Date/ISO-string control cases and five checker-calibration tests passed.
All eight Instant/PlainDate cases failed at public value checkpoints.

| Observation after reopen | Temporal result |
| --- | --- |
| `loadSubset` hydration and `scanRows` | Direct and nested values restored as `{}`; inline and separate row metadata also lost their type and value. |
| `loadCollectionMetadata` | Direct and nested values restored as `{}`. |
| `pullSince` from the previous committed position | Row values, separate row metadata, and collection metadata in the replay payload restored as `{}`. |
| Equality at the earlier value | `[]` instead of the earlier row's key. |
| Greater-than the earlier value | `[]` instead of the later row's key. |
| Ascending one-row windows, offsets 0 and 1 | Insert order happens to match; after the values swap, both pages retain the old order and fail. |

Both index configurations produce these results. Indexed cases verify that
`ensureIndex` installed a real SQLite index and that it survives reopen. They
do not assert optimizer index use. The existing expression-index owner retains
that responsibility. Query failures on corrupted values do not independently
establish a compiler defect with correctly encoded Temporal values.

The selected `PlainDate / update / indexed=false` replay ran one test, skipped
20, and failed all eight named checkpoints (exit 1). Its hydration diff includes:

```text
expected stamp: { kind: "PlainDate", text: "2026-01-02" }
actual stamp:   {}
expected equality keys: ["a-late"]
actual equality keys:   []
expected first page:    ["a-late"]
actual first page:      ["z-early"]
```

The normal package configuration includes this new `*.test.ts` file. With a
complete dependency installation, its standard focused command is:

```sh
pnpm --filter @tanstack/db-sqlite-persistence-core test \
  tests/sqlite-temporal-value-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false
```

The fresh installation could not complete: the configured package proxy returned
403 for Rollup 4.64.0, and the public registry returned 503. The stalled retry
was stopped. The standard command above was therefore not the local receipt.
Local execution used cached test tools, a temporary Vite configuration, and
explicit aliases to **this worktree's** DB, db-ivm, and persistence source.
External libraries came from the existing checkout. No prebuilt DB distribution
or mocked persistence adapter supplied the result.

Exact local commands:

```sh
/Users/kyle.mathews/programs/tanstack-db/node_modules/.bin/vitest run \
  --config /private/tmp/temporal-persistence-vitest.config.mjs \
  --reporter=json --outputFile=/private/tmp/temporal-persistence-final.json

/Users/kyle.mathews/programs/tanstack-db/node_modules/.bin/vitest run \
  --config /private/tmp/temporal-persistence-vitest.config.mjs \
  -t 'PlainDate.*update.*indexed=false'
```

The JSON report and selected replay log are local scratch receipts at
`/private/tmp/temporal-persistence-final.json` and
`/private/tmp/temporal-persistence-replay.log`. The results above preserve the
verdict-critical evidence without depending on those temporary files.

TypeScript checking of the oracle and its imported source passed (exit 0), using
a temporary config with source and cached dependency aliases. ESLint passed
without warnings (exit 0); Prettier formatting passed. A full package test run
and a full frozen-lockfile installation are not claimed.

## Why previous tests missed it

The shared core adapter's typed-value test supplies Date and BigInt. The Node
expression-index grammar supplies scalar values, Date, and BigInt. Neither
supplies real Temporal objects or observes their type plus text across reopen.
More runs over those domains cannot reach the issue.

The new owner adds that missing value domain and explicit native-type
observation. Its file-handle lifecycle is separate from the shared contract's
injected harness because an adapter recreation alone does not prove physical
SQLite close/reopen. Existing tests and expectations are preserved.

## Oracle guide evidence

| Requirement | Outcome |
| --- | --- |
| ORC-001 authority and limits | Established Date controls; requested Temporal extension explicitly identified as diagnostic, with support/rejection policy unresolved. |
| ORC-002 independent judgment | Literal type/text model and ordinal-based key expectations; no production semantic helpers. |
| ORC-003 responsibilities | Opening law/limits, expected-value and expected-row model, 16-cell grammar, real SQLite driver, and named public comparisons are in the oracle. |
| ORC-004 grammar controls | Four kinds × insert/update × absent/present index; unique-cell/count calibration. Each axis's contribution is stated in the header. Two adjacent ISO days bound the range. Unique keys and increasing positions exclude duplicate inserts and stale transaction positions. |
| ORC-005 production reach | Each test commits through the real adapter, replaces the SQLite handle and adapter, verifies index presence/absence, and checks hydration, scan, metadata, replay, and query results. |
| ORC-006 calibration | Five passing checks reject empty-object loss, ISO-string type erasure, same-kind wrong values, omissions, duplicates, and reversed output through the same checker. Unmodified production itself fails at the intended checkpoints; no production mutant was installed. |
| ORC-007 campaigns/replay | Random-campaign requirement does not apply to bounded enumeration. All 16 cells execute. Selected-name replay was checked and reproduces the same mismatch. |
| ORC-008 state minimality | No state machine added. A pure recomputation retains kind, value ordinal, key, and insert/update history because each changes a checked output. |
| ORC-009 vocabulary | Uses adapter transaction, row metadata, collection metadata, replay, and checkpoint terms. Type/text records are explicitly model-only observations. |
| ORC-010 failure fidelity | Soft assertions retain all reached mismatches before teardown; Vitest separately reports afterEach failures. Registered harness cleanup closes the handle and removes its owned temporary directory. No shrinking. |
| ORC-011 second formulation | No shared semantic comparator is used: the query model uses fixture ordinals. No separate formulation is claimed or needed to identify this serialization loss. |
| ORC-012 review evidence | This record names the production revision, oracle hash, outcomes, execution limitations, and open scope. No closure claim. |
| ORC-013 distinguishing boundary | Same-type distinct dates, equality versus strictly greater, swapped values, both page offsets, and index presence distinguish empty-object/type-erasure designs within the finite grammar. No arbitrary-value or threshold proof. |
| ORC-014 host handoff | SQLite itself stores the file and supplies reopen results; Temporal comes from a real polyfill. The thin sequential driver does not claim production Node-driver, Expo, OPFS, or native mobile conformance. |

## Open scope and ownership

Issue #2034 and this typed-value owner retain the support/rejection decision,
other Temporal kinds, native constructors, precision/calendar variations,
truncate/delete and longer histories, compatibility with old bytes, and host
receiving witnesses. A future support repair must cover literal encoding and
index/comparison behavior in the expression-index owner as well. The current
reachable counterexamples keep the bug class open.


## Current-main replay and design follow-up

On 2026-10-05 the worktree was fast-forwarded without conflicts to
`e21c280f3c4e56f6c0d05ec0eed87db29c623489`, including #2002. The unmodified
Temporal oracle again ran 21 tests: 13 passed, 8 failed, exit 1, using the same
cached-tool/source-alias setup. Its captured report is
`/private/tmp/temporal-persistence-current-main.json`. This extends the RED
receipt; it does not supersede the original revision record above.

The exploratory [design grammar and stress readings](issue-2034-design/README.md)
map the proposed value-domain repair to current primary oracle owners. They do
not implement a fix, revise established lifecycle laws, or claim closure.


## Implemented v2 follow-up — 2026-10-05

The [v2 design grammar](issue-2034-design/v2.md) now specifies and implements
native Instant/PlainDate preservation, shared SQL/index representations and
remote-demand admission limits. Existing owners were extended before the repair;
original-production and hostile controls demonstrate distinguishing failures.
The final affected suite has 471 passing tests, one existing TODO and no failures;
TypeScript and lint pass (25 existing lint warnings). The linked evidence keeps
exact source hashes, receiving limits and separate production/test/doc weight.
This supersedes the open implementation status above while preserving its RED
receipts. It does not establish native multiprocess or untested host support.
