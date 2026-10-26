# Optional persisted index serialization

The [law enforcement audit](issue-2034-law-enforcement.md) strengthens the
original witnesses below and supersedes their earlier completeness claims.

CodeRabbit review 5422905753 identified an escaping serializer exception on
`e61cda199`. The oracle reproduced it on `5d97c7790` before production changes.

## Law and repair

Persisted indexes are optional query accelerators. Failure to construct their
persistence specification belongs to the same best-effort boundary as failure
to store them. It must not fail Collection startup or leak an unhandled runtime
rejection. A healthy sibling index and subsequent ordinary Collection reads
remain usable. This extends the existing local-index-failure witness to the
previously untested serializer boundary; it introduces no recovery policy.

Both calls to `buildPersistedIndexSpec` now execute inside their existing
`try` blocks. Existing warnings and local completion markers handle failure.
There is no new state, retry, or fallback. Unsupported native row values still
reject: the optional index fixture stores ordinary rows and uses native values
only in index metadata.

## Oracle and calibration

The persisted owner previously injected adapter failure after adapter entry.
It did not reach a native serializer failure before that entry. Its new finite
matrix crosses startup/runtime index addition with supported Instant,
unsupported ZonedDateTime and Duration, and Instant without global constructors.
A rejecting index precedes a healthy sibling. The independent expected admission
set comes from the approved persistence domain, not the serializer's output.

The real Collection and persisted wrapper drive all cases. At startup, preload
must resolve. After queued index work settles, assertions compare readiness,
exact rows, exact local and coordinator index signatures, and warning paths and
error classes. A subsequent ordinary subset load must retain the exact row.
Supported controls require both indexes and no warnings. Runtime unhandled
rejections are also reported by the test runner.

| Subject                                            | Result                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Original source, before the fix                    | Six failures: three startup rejections and three runtime warning mismatches; two supported controls pass. |
| Only the local spec builder moved inside its catch | Six failures remain, including runtime one-warning-versus-two assertions; two supported controls pass.    |
| Both existing catches cover spec construction      | All eight new cases and the existing failed-local-completion witness pass.                                |
| Surrounding affected owners                        | 782 tests pass in 11 files, zero failures, one existing TODO.                                             |

The partial-fix mutant uses a scratch source-loader substitution with a reached
receipt. No setup failure or timeout counts as a kill. The tests restore global
Temporal and warning instrumentation with failure-preserving cleanup.

This closes the escaping-spec-construction class at both wrapper boundaries
within the declared startup/runtime histories. The real SQLite index and native
value owners retain their separate receiving claims and passed in the surrounding
run. This witness does not establish browser scheduling or arbitrary third-party
coordinator behavior. No known in-scope counterexample remains.

## Validation and weight

TypeScript passes. ESLint has zero errors and 22 existing warnings in the changed
files. Prettier and whitespace checks pass. Production adds two and removes four
lines (net minus two); the existing oracle gains 113 lines. No oracle owner is
added. The coverage map and changeset record the strengthened boundary.

Scratch evidence: `/private/tmp/temporal-cr3-index-red.json`,
`temporal-cr3-coordinator-red.json`, `temporal-cr3-coordinator-reach.json`,
`temporal-cr3-index-green.json`, and `temporal-cr3-surrounding.json`.
The complete lossless review evaluation is in
`/private/tmp/temporal-cr3-evaluation.md`: nine items, one fixed and eight
duplicates of that fix or previously evaluated guidance and accepted limits.
