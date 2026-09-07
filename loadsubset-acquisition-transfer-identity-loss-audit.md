# Replay handoff identity: bounded loss audit

**Result: bounded null.** No original assertion or cleanup step is lost in the corrected four-cell matrix. The reference-based index projection preserves the original case’s two pre-unsubscribe unload identities, exact length, and order. It also checks the final retry’s identity more strictly than the original deep-equality array assertion.

## Frozen scope and method

One fresh delegated Hidden-signal recovery assay (`loss-audit`) compared these frozen specimens in `packages/db/tests/collection-subscription-replay-oracle.property.test.ts`:

- Original: `89d3ba2bbd6cbbaf86f0dff2eec1e61814fbd4c8`, lines 3249–3306.
- Candidate: `aa1ffcf3ed302737219f4baf2d5b3c9b6952b36e`, lines 3249–3319.

The original is the source law; the matrix is the frozen reduction under audit. The scan used the test bodies and relevant imports. It read Field Lab’s full skill and loss-audit card and the worktree’s AGENTS.md. No production source was inspected. The architecture prerequisite did not apply: this scan neither read live-query implementation nor changed tests. Production being unchanged since `2a489848` is supplied scope context, not an independently checked result.

Prior audit outputs, TODOs, plans, sibling reports, and broad history remained hidden. The initial line-range extraction also displayed adjacent tests; they were excluded from support and analysis. No tests ran and no repository files changed. Only this requested record was written.

## Source law and transfer trace

| Original support | Candidate support | Trace |
| --- | --- | --- |
| Lines 3273–3278 record every unload; the first exact old-options release reenters `releaseSnapshot(where)` and throws. | Lines 3279–3284 use the same identity guard and action order when both parameters are true. | The original failure scene remains the `releaseDemand=true, failRelease=true` cell. |
| Lines 3290–3294 request a snapshot, begin, truncate, commit, then flush promises. | Lines 3296–3300 retain that sequence. | No trigger or observation checkpoint disappears. |
| Line 3296 requires exactly two loads. | Line 3302 retains the same assertion. | No count loss. |
| Lines 3297–3299 require exactly two unloads and `unloads[0] === loads[0]`, `unloads[1] === loads[1]`. | Lines 3304–3306 require the full mapped array to equal `[0, 1]` in the original cell. | No identity, count, or order loss. `map` preserves array positions and length; `indexOf` matches object references, so an unrecorded clone maps to `-1`. |
| Lines 3300–3301 unsubscribe and compare the entire unload array to `[loads[0], loads[1], loads[0]]` with `toEqual`. | Lines 3308–3313 unsubscribe and require the complete reference-index array `[0, 1, 0]` when release fails. | The retry count and order survive. The candidate requires the last unload to be the original options reference; the original last-slot check used deep equality. |
| Lines 3302–3304 always call unsubscribe again and await collection cleanup. | Lines 3314–3316 retain both operations in `finally`. | No cleanup step disappears. Neither version asserts the unload array after these final calls. |

If both recorded loads reused the same object, `indexOf` would map both to zero. The candidate’s required index `1` would fail. That does not admit a false success or weaken the original assertions; it adds a distinct-reference requirement where the original could accept aliasing.

## Candidate’s four cells

These are assertion expectations read from lines 3302–3313, not observed runtime results. Index 0 means the first recorded load options object; index 1 means the second.

| Release demand | Fail release | Unloads before unsubscribe | Second signal aborted | Unloads after first unsubscribe |
| --- | --- | --- | --- | --- |
| false | false | `[0]` | false | `[0, 1]` |
| false | true | `[0, 1]` | true | `[0, 1, 0]` |
| true | false | `[0, 1]` | true | `[0, 1]` |
| true | true | `[0, 1]` | true | `[0, 1, 0]` |

The indexOf comment at line 3303 correctly describes reference comparison. The debt/prior-owner comment at lines 3309–3310 names internal ownership explanations. The admitted test supports their stated unload consequences but does not directly observe those internal states. This is an unmeasured claim boundary, not a supported finding that the comment is false. “Success never retries it” is checked through the first unsubscribe in this fixture, not after final cleanup or across arbitrary later actions.

## Controls and limits

The scan selected assertion transfer from one source test. That selection can hide unrelated missing behavior; this null does not certify the broader suite or production. Flattening unloads into indexes omits options fields and timing inside the interval between checkpoints. The original assertions did not independently check those fields or internal timing either, and both fixtures retain the actual option references in their recorded arrays.

This is static reasoning about test expression strength. It does not establish that any matrix cell passes, that cleanup causes no extra unload, or that the internal debt/owner explanation is correct. No lost item was recovered, so no dropping rule is assigned. No usefulness judgment, ranking, redesign, or repair follows from this assay.
