# Ordered-source state loss audit

No lost behavior, changed callback order, overstated added source comment, or false baseline assertion was found in the admitted bundle. This is a static null result, not a runtime pass or a claim about the full branch.

## Frozen scope and control

- Baseline: `7a17c3f00ec6207a8862139e0ca2b6c102499679` (B).
- Candidate: `340250bdc36f8022a063cd68fe9dd137fa7539e9` (C).
- Source L: `packages/db/src/query/live/ordered-source-loader.ts`, read in full at both commits.
- Source T: candidate `packages/db/tests/query/ordered-source-loader.test.ts`, added six reset/dispose × obsolete resolve/reject/AbortError cells, their diff, and necessary fixture helpers. Other tests were not audit inputs.
- Intent supplied for comparison: clarify private names without changing behavior.

Pointers below use `B:L:line-range`, `C:L:line-range`, and `C:T:line-range`; the full hashes and repository-relative paths above freeze each pointer. The checkout was `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`.

Before live-code analysis, I read the full Field Lab skill, loss-audit card, applicable repository and worktree AGENTS instructions, and worktree `packages/db/src/query/live/ARCHITECTURE.md`. Architecture supplied constraints, not evidence that the implementation passes them. No TODO, plan, sibling report, old output, broad history, outside implementation, or runtime test result entered this comparison. No source edits or tests were run.

I scanned the baseline, then the candidate and added controls in one fresh delegated context. No further agent was used. The two versions necessarily shared this scanner's context; this is not an independent blind reading of each version.

## Source-level preservation trace

| Original distinction and support | Candidate location | Static reading and dropped trace |
| --- | --- | --- |
| Settlement, boundary, recovery need, and full-source demand occupy separate fields (`B:L:19-35`). | `C:L:19-40` | The same fields remain. Four private names change: `hasEstablishedSourceCoverage` → `hasSettledSourceRequest`; `sourceBoundary` → `settledSourceBoundary`; `fullSource` → `hasFullSourceDemand`; `invalidateSourceCoverage` → `requireFullSourceRecovery`. Their references change consistently. No field or distinction vanishes. |
| Reset removes pending work and cursor markers, but leaves the settlement flag and recovery need intact (`B:L:204-219`). | `C:L:209-224` | Preserved. The new reset comment does not claim that reset erases settlement. The flag is not a provider-extent proof. |
| A successful non-boundary request sets the settlement flag. A finite request reads its exact options and retains the old boundary when the read has no last row (`B:L:299-315`). | `C:L:304-320` | Preserved. The added empty-page comment describes the nullish fallback. It does not claim exhaustion or that every successful request supplies a boundary. |
| Finite success does not clear recovery need; current full-source completion does (`B:L:316-319`, `395-399`). | `C:L:321-324`, `400-404` | Preserved. The new comment separating finite success from full-source recovery matches these assignments. |
| Full-source demand is marked before request startup. Current async failure keeps the mark; synchronous failure clears it (`B:L:161-178`, `330-345`, `424-433`). | `C:L:166-183`, `335-350`, `429-438` | Preserved. The added comment distinguishes retained demand from success. This source proves the loader's flag behavior; actual subscription replay was not inspected. |
| Obsolete success returns after the active/generation guard. Obsolete failure checks active status, invalidates coverage, then checks generation (`B:L:296-299`, `330-345`). | `C:L:301-304`, `335-350` | Preserved asymmetry. A reset loader can acquire recovery need from an obsolete rejection or AbortError without recording a current request failure or replacing its release callback. A disposed loader returns before that invalidation. Nothing supports flattening all obsolete outcomes into “no state effect.” |
| Both settlement handlers clear pending state only when it still equals their tracked promise (`B:L:297`, `331`). | `C:L:302`, `336` | Preserved. An obsolete handler cannot clear a distinct replacement promise through these assignments. |
| Failure ownership advances before releasing an old lease; the requesting guard surrounds release, and disposal is checked afterward (`B:L:102-122`). | `C:L:107-127` | Preserved callback order. |
| Synchronous request callbacks are captured before observation. Failure state precedes provisional release. Observation installs the tracked promise before calling `onResult`; ordered completion starts boundary work before its own tracked promise settles (`B:L:320-357`, `401-521`). | `C:L:325-362`, `406-526` | Preserved statements, branches, and call order. The renamed helper retains the same three assignments. |

For source L, the recovered/dropped list is empty. The observed reduction consists of renaming and added explanation, with no identified compression, rejection, or category merge that removes baseline behavior.

## Added control trace

The six cells are explicit in `C:T:323-328`. The fixture uses real deferred Promises, an empty ordered snapshot, one indexed ascending order, offset zero, limit one, and `dataNeeded: () => 0` (`C:T:24-59`, `339-358`).

For reset, the controls start a replacement page before settling the obsolete page. They assert a fresh offset-zero request without `minValues`, unchanged replacement-promise identity after obsolete settlement, and no releases (`C:T:360-384`). For obsolete rejection and AbortError, they then settle the finite replacement and expect a full-source request on the next explicit load. For obsolete resolution, they expect no such request (`C:T:386-404`). For disposal, they assert that no replacement or later load starts (`C:T:406-408`). These assertions match the baseline's active/generation ordering and separate recovery flag.

`await obsolete` is consistent with the baseline: obsolete rejection returns from the failure handler before its final throw, so the tracked promise fulfills. The tests do not assert that the original transport promise fulfilled (`B:L:330-347`; `C:T:374-384`). No false baseline assertion was found.

The final no-extra-request assertion does not independently prove that full-source success cleared recovery need. `hasFullSourceDemand` can itself stop later loading before that flag is read (`C:L:129-136`; `C:T:401-404`). The clearing assignment is direct static evidence at `C:L:321-324`. Treating that assertion alone as proof of the assignment would overstate the control; the source comparison does not require that inference.

For source T, the recovered/dropped list is empty. Its added comment preserves the baseline distinction between finite success and unrepaired source uncertainty. No admitted assertion contradicts that baseline.

## Limits and stop

This audit selected one loader and six controls. It hides caller behavior, subscription ownership, actual source writes, public publication, and replay integration. Empty snapshots suppress ties, nonempty boundaries, and partial writes. The controls select obsolete settlement before replacement settlement; they do not enumerate the reverse order or callback reentry. The tables flatten complete paths into state transitions and could hide interactions across those omitted dimensions.

Behavioral equivalence is an inference from the unchanged expressions and callback order after private-name substitution. Test execution, transport compliance, and full-system correctness remain unmeasured. No ranking, restoration decision, redesign, or repair follows from this null result. The bounded loss audit stops here.
