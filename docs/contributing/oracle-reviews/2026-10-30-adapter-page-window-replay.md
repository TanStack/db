# Preserve the framework driver during window replay

CodeRabbit review `5718063990` examined parent
`cc058b802ed6921f692f234399437c5a4e663991` and supplied two valid minor
findings. Inline `4428012904` identified an overbroad unbounded-transition
sentence. Inline `4428012910` identified a replay-integrity defect.
The [manifest](2026-10-30-adapter-page-window-replay-manifest.json) records
source hashes, exact owners, replay coordinates, execution counts and log hashes.
This repair changes test machinery and evidence prose, with no product change.

## Law and experiment

ORC-007 requires a replay to run the original property, recorder and comparison.
The guarded replay contract also requires its exact production owner to execute.
Framework scheduling belongs to that path: a shared independent model does not
make React a substitute for a failing Solid, Vue or other framework driver.

The earlier three `framework.*` property names erased the driver distinction.
The manifest assigned each to React. Its green checks covered registry
membership and source names, while allowing this host substitution.
The previous preparation record's canonical-React claim was therefore too broad.
Its eighteen successful commands remain historical target-execution evidence;
they do not establish replay of failures in the other frameworks.

Before repairing routing, the protocol suite gained an independent finite
matrix of seven drivers and three history families. The drivers include all six
adapters and the separate React dependency-list entry point. Every cell requires
its exact owner. The unchanged routing failed all **21 comparisons**.
The command from `packages/db` was:

```sh
pnpm exec vitest run tests/oracle-replay.test.ts \
  -t 'keeps the originating driver' --maxWorkers=1 --coverage.enabled=false
```

Each property now includes its driver, for example
`framework.solid.pending-window-history`. All three families use the scoped name
for registration and replay options. Each manifest entry selects the actual
conformance file and the shared model source. Fixed examples, run budgets,
generators, recorders, comparisons and reach declarations remain unchanged.
The two React entry points also stand aside during each other's path replay.

The full protocol suite passes **63 tests**. All **21 real guarded commands**
pass with seed `2291`, path `0`, the exact property and owner, nonzero execution
counts and no failed witness. Ordinary-window replay executes eight comparisons
for each React/Preact driver and two for each reactive driver. Pending and
publication replay execute one each. These are **46 completed comparisons**.
For example, run this command from `packages/solid-db`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=framework.solid.pending-window-history \
TANSTACK_DB_ORACLE_SEED=2291 TANSTACK_DB_ORACLE_PATH=0 \
node --import tsx ../db/tests/oracle-replay.ts tests/conformance.test.tsx \
  --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
```

A hostile manifest that substitutes React for all three Solid owners fails
**three exact-owner assertions**. These are intended comparison failures,
not setup errors or timeouts. A permanent negative child-process check also
requests the Solid property through React's actual conformance file. It rejects
that invocation with `executions: 0` and `oracle replay target never executed`.
Existing protocol checks retain seed/path, nonzero-run, filter, property-error
and cleanup-error enforcement.

Normal fixed and seedless-fresh campaigns also pass **106 tests**: React 44,
Preact 22 and ten each for Vue, Solid, Angular and Svelte. The manifest retains
all 92 per-lane reach dictionaries and their counts. Every declared state was
reached. Core TypeScript, changed-file lint and whitespace checks pass. The
first scratch campaign probe exceeded its output buffer because warnings filled
it; rerunning with file-backed output produced these completed results. That
probe error supplies no product RED evidence.

## Documentation correction and review accounting

The resolver requires an old explicit limit but validates finiteness only on
the target. Thus explicit `.limit(Infinity)` can retain a Collection when moving
to a finite safe-integer target. The original evidence now states this exception.
Its finite-window guarantee remains unchanged. Source inspection suffices for
this documentation mismatch; this review claims no Infinity receiving witness.

The lossless scratch ledger accounts for **26 source occurrences**: two
`fixed-now` findings, fifteen duplicates and nine rejected optional
recommendations. The raw body, both inline comments, AI-prompt repetitions,
mutable summary, risk assessment, warnings, finishing suggestions and tips
were reread after repair. No finding remains confirmed-open or deferred.

| Items | Judgment and destination |
| --- | --- |
| CR02, CR03 | Both actionable findings fixed as described above. |
| CR01, CR05–CR14, CR17–CR18, CR21–CR22 | Duplicate occurrences preserved and linked to their canonical findings or recommendation. |
| CR04 | Extra review CLI is optional; existing skills, executable checks and fresh independent review supply verification. |
| CR15 | Real-provider limits remain explicit. Issue #2118 concerns sync-adapter conformance and excludes framework render timing. Its related portfolio idea survives at that issue. |
| CR16 | Suggested human reviewers supply no technical finding; no unsolicited review request was sent. |
| CR19 | Low merge risk is a reviewer judgment, not permission to leave replay integrity broken. Both findings were repaired. |
| CR20 | The reported docstring percentage is unverified. No repository 80-percent threshold or concrete undocumented obligation was identified. Blanket generation is unnecessary; explanatory law and mechanism prose remain. |
| CR23 | Generic unit-test generation identifies no missing law. The primary protocol checks, real receiving commands and hostile controls cover the concrete gap. |
| CR24–CR26 | Bot autofix, social promotion and a bot help comment are optional workflow suggestions. They introduce no technical requirement. No such external action was taken. |

Hire recommendation: **yes for this bounded review**. Both actionable findings
were accurate, low in scope and paired with suitable repairs. Static inspection
found a receiving-path distinction the earlier review missed. Generic tooling
and docstring suggestions add noise; the merge-risk label supplies no independent
readiness evidence.

A fresh oracle reviewer inspected the repair, independently parsed all 21
completed logs, and found no remaining source-level finding. It identified the
stale current coverage guidance, which this repair corrects. That review ran no
new tests and supplied no independent runtime result.

## Evidence boundaries

- **Law:** Preserve the original framework production driver, property,
  seed/path and comparison during direct replay (ORC-007 and guarded replay).
- **Reach:** Every cell of the finite seven-driver × three-family routing
  grammar completed its real guarded comparison. Existing product reach
  declarations and all history axes remain in place.
- **RED:** The extended owner matrix failed all 21 comparisons on unchanged
  parent routing before the identity repair.
- **GREEN:** The complete protocol suite passes 63 tests and all 21 exact-owner
  guarded commands pass, with the execution counts recorded in the manifest.
- **Mutant:** React-for-Solid routing fails three owner comparisons; the real
  wrong-driver invocation is rejected for nonexecution.
- **Limits:** This evidence establishes routing for these registered drivers and
  families. It does not reproduce an arbitrary provider schedule or claim a
  new product law. Seed/path zero is an execution witness, not a captured
  product counterexample. The original R2-5/G1 oracle-first process gap remains
  disclosed for maintainer disposition.

ORC-001–007 apply through the law, independent owner matrix, finite grammar,
real drivers, negative controls and direct replays above. ORC-008 requires no
new state model; ORC-009 retains existing vocabulary. ORC-010's protocol
regressions remain green. No shared semantic fault requires an ORC-011 second
formulation. This versioned record supplies ORC-012 evidence. Distinct drivers
and the wrong-driver control distinguish the conditional replay rule for
ORC-013. No provider handoff is claimed under ORC-014. Existing product reach
is retained under ORC-015; the added routing matrix is bounded enumeration.
The ordinary protocol test file supplies supplemental checks rather than placing
unit tests inside the shared generated-history owner (ORC-016).
