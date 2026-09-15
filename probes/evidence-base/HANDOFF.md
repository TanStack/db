# Evidence base handoff

Date: 2026-09-15. Repository: `TanStack/db`. Branch:
`codex/component-endpoints-prototype`.

The reusable evidence base, its draft check-authoring workflows, and the Endpoints
fixture package are runnable. Fracture Scan and a fresh Hostile Assay exposed
three contract gaps. The grammar and prototype now repair them, with red/green
oracle checks. Production Endpoints code was not changed by this repair.

## Resume on another machine

Fetch `origin`, switch to `codex/component-endpoints-prototype`, and pull with
`--ff-only` in a clean checkout. Do not rebase or force-push this published branch.
Start here, then read the [prototype boundary](README.md) and
[current grammar v2](../endpoints/design/evidence-guarantees/base-grammar/revisions/v2/README.md).

From the repository root, using Node 22.13 or later:

```sh
node --experimental-strip-types probes/evidence-base/demo.mjs
node --experimental-strip-types --test probes/evidence-base/kernel.test.mjs
node probes/evidence-base/fault-controls.mjs
node probes/evidence-base/verify-handoff.mjs
tsc --project probes/evidence-base/tsconfig.json
```

The runtime, tests and verification use Node builtins only. `tsc` additionally
requires TypeScript. No database, Kitchen AI checkout, workspace dependency
installation, local browser server or credentials are needed to run the probe.
This machine used Node 22.13.1 and a separately installed TypeScript compiler.
`pnpm exec` tried to bootstrap the whole workspace and hit a network failure;
that was not a probe test failure. No dependency or lockfile change resulted.

## What the repair changes

1. **Preserve alternatives in explanations.** An assessment now retains all
   submitted routes and each route's required premises. `(A AND B) OR C` no longer
   collapses to a flat to-do list that looks like `A AND B AND C`. Flat `gaps`
   remain a deduplicated inventory; they are not a completion plan.
2. **Recheck repair evidence on every use.** A challenge retains an append-only
   list of replay references. An old resolution stops clearing it when its replay
   becomes stale. A later applicable replay can clear it again without deleting
   the failure or previous resolutions.
3. **Require a causally later replay.** The runner records the observation boundary
   when a check starts. A repair must come from a separate check invoked after
   the failure was recorded. A previously started check cannot qualify merely by
   finishing later. Same-run/batch repair is conservatively rejected. Trusted
   callbacks must perform fresh measurements, not return cached old results.

The original v1 artifacts, captured prototype and failing audit witnesses remain
unchanged. V2 is a repair specification, not a new full Design Grammar run. The
two instruments have not been independently rerun against the repaired code.

## Validation and its limits

All 13 tests pass, strict typechecking passes, and seven mutations of temporary
kernel copies are detected at assertions. The three added oracles first failed
on the old code, then passed with the repair:

- Public route completion: 60 generated clause sets and eight future fact sets.
- Repair lifetime: 40 histories with a failing prefix and 45 generated operations.
- Replay causality: 30 reordered-delivery cases and both within-batch orders.

The older lifecycle oracle now retains historical failures and resolution epochs;
its former scalar model incorrectly forgot resolved failures forever. It covers
80 histories of 35 operations and requires all 16 adjacent operation pairs.
Earlier low-bit RNG selection produced repetitive histories and missed a freshness
fault; that generator defect was fixed before the audits. The argument and
possible-worlds oracles remain in place. These use a deterministic local generator,
not fast-check, and have no automatic shrinking.

The audit witness scripts assert the old bad behavior against frozen snapshots.
Their exit status is not a test of whether the repaired kernel still has the bug.
Use `kernel.test.mjs` and `fault-controls.mjs` for the current implementation.

## Decisions to preserve

- The base supplies argument/evidence mechanics. Packages own versioned claims,
  checkers, admission rules and inference rules. Endpoints will consume the base
  plus its domain claims; the current package only uses fixtures for complete
  read/write bounds and disjointness.
- The base checks that registered procedures accepted an argument. Arbitrary
  semantic rule code remains trusted. A bounded oracle pass is evidence within
  its scope, not a universal proof or proof that the checker itself is sound.
- Ship Field Lab-inspired workflows for designing claims/checkers as well as
  maintaining evidence. Ground conditions and hostile examples belong in that
  design process. The workflows are drafts, not empirically validated procedures.
- Applicability depends on code, versions, configuration, data, environment and
  method. Code is not the only test dependency. Reverting code does not renew old
  evidence. Rubric-only reassessment may reuse evidence that remains applicable.
- Oracle mismatches must be recorded automatically by the runner. An agent must
  not get to choose whether to submit a known failure. Relevant contradictions
  require fallback for the affected use; this does not contact deployed clients.
- Preserve original failure cases and repair history. An inconclusive note does
  not close an investigation. Same-agent production and rubric assessment are
  allowed; independent audits may help but are not mandatory authority roles.
- A check that cannot run is a CI error, not evidence about correctness. Do not
  turn infrastructure errors into correctness claims or evidence-log events.
- Missing evidence is not itself a contradiction. Diagnostic severity, check
  levels, overrides and whether unsupported optimization is permitted remain
  policy questions. Do not silently settle them in the base.
- The compiler must not insert auth behavior or rewrite application auth. Normal
  identity consistency is an app prerequisite; the framework must preserve its
  boundaries. Retain known partial SQL effects without calling them complete.
- Beads and shadcn/lint are donors, not dependencies. Shadcn sharpened the split
  between diagnostic validity and repair validity, and between eliminating
  violations and preserving intent. Its reported cost wins are not our results.
- External writes require polling, an external event channel or a sync engine.
  Broad PostgreSQL generation and subset loading remain separate future work.

## Deliberate prototype limits and next work

State is in memory. One explicit global epoch invalidates all observations.
Claims use exact JSON identity, not semantic equivalence or scope subsumption.
Historical same-claim failures conservatively reopen across context changes.
The caller must advance context; fingerprints are not captured automatically.
The base does not decide application actions or optimization policy.

The next implementation should make these choices explicit before broadening them:

1. Define checked-in storage, import validation and replayable history. Decide
   which dependencies an evidence record must identify, and how their current
   applicability is checked. Include data/environment/method inputs.
2. Extend the oracle to serialization/reload and dependency-specific invalidation;
   add shrinking. Use the current three repaired laws as required invariants.
3. Connect one real Endpoints claim/checker, retaining partial SQL knowledge and
   the boundary between missing support and an observed contradiction. Do not
   infer production refresh policy from the fixture's `supported` result.
4. Exercise the draft authoring workflow on that claim, including hostile cases,
   comparison against an independent authority and repair validity. A fresh
   post-repair audit remains useful; none is claimed here.

Other open work: source-inspection/rubric admission, speculative challenges,
durable runner delivery, dependency-selective expiry, cross-version case mapping,
scope exclusions, alternate-strategy repair, graph performance, and policy levels.
Nothing here protects against an actor controlling the process, plugins or files.

## Files and complete record

| Files                                                       | Role                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `kernel.ts`, `endpoints.ts`, `demo.mjs`                     | Generic in-memory base and runnable Endpoints fixture                                              |
| `kernel.test.mjs`, `fault-controls.mjs`                     | Independent bounded models and seven fault controls                                                |
| `package.json`, `tsconfig.json`                             | Private probe metadata and strict compile check                                                    |
| `workflows/`                                                | Draft claim design, evidence maintenance and rule repair procedures                                |
| `verify-handoff.mjs`                                        | Check frozen hashes, portable captures and user-comment completeness                               |
| `../endpoints/design/evidence-guarantees/`                  | Research, reviewed guide-word sweep, process grammars, recombination, v1/v2 design and both audits |
| `../endpoints/design/evidence-guarantees/portable-sources/` | RFC and instrument cards previously outside this checkout, with hashes                             |
| `../endpoints/design/field-trip-optimistic-coherence/`      | Canonical Field Log, rendered log and chronological user-request archive                           |

The [Field Log](../endpoints/design/field-trip-optimistic-coherence/field_log.md)
contains the research, decisions, audit findings, repair outcomes and handoff.
Entries 94–95 cover the original grammar/prototype, 96 the shadcn donor,
99–101 the two audits and their overlap, 102 the donor synthesis, and 103 the
complete comment recovery. Later entries record this repair and Git handoff.

The [chronological archive](../endpoints/design/field-trip-optimistic-coherence/sources/user-comments-through-evidence-repair.json)
preserves all 273 user requests available through the handoff instruction, with
original timestamps and repeated replies. Injected environment/browser context
was excluded. Missing occurrences were appended to the journal as historical
recovery, not backdated or treated as new authorizations. This supersedes earlier
notes that comment recovery was selective. It does not mean every historical
implementation claim was independently reverified during this repair.

Read the log as Markdown or JSONL on any machine. To append, use the Field Lab
event writer; do not hand-edit its canonical JSONL or generated Markdown.
Historical absolute paths and localhost reader URLs are provenance, not startup
requirements. The portable-source manifest maps external files to checked-in
copies. Selected Kitchen AI passages are embedded in the Process Grammar source
capture; the separate Kitchen AI app is not needed for this probe.
