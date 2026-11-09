# CI follow-up: boundary-only metadata

This append-only successor records work after reviewed/pushed head
`066d0dd26d9cf7829c986b5d3af1d76c1634e8a5`. The companion source manifest's
`ciFollowups` entry binds the repaired files. Earlier evidence and verdicts
remain historical and unchanged.

## Law, experiment, inference and limits

Inline wrapper choice changes construction syntax, not the materialized value
shape. Array wrappers expose arrays; a singleton also permits absence.
Authority: the live-query architecture's Nested materialization contract and
November 5 boundary-only decision. The public-type oracle now crosses three
conditional choices with all 24 independently declared row descriptions:
array/array control, array/materialized array, and array/singleton. Each source
runs actual public construction before native compilation. The same independent
shape law judges QueryRef functional inputs and published Collection results.

The first fixture lacked required correlation and failed admission. It receives
no product RED credit. After adding a parent/child equality, unchanged production
fails all 24 consumers with TS2344 shape constraints only. Every one of the
259 declared states reaches 24 times, including the three new states and legal
construction. The repair routes the wrapper union through the existing generic
value extractor, which distributes over each alternative. The full owner passes
33 checks. Restoring the original mapping on the repaired tree fails the first
row description at those same constraints; restoring the repair passes it.
The type module's emitted JavaScript is identical (11 bytes, SHA256
`8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881`).

The earlier owner generated each wrapper separately. It could not distinguish
a non-distributing indexed conditional from correct value extraction. The new
grammar supplies that missing dimension, without changing the reference type
law. It excludes uncorrelated includes at admission, keeps array/array as an
identity control, and distinguishes singleton absence from arrays. Arbitrary
unions of scalar, opaque and Collection-valued wrappers remain outside this
bounded claim. This is native source-export evidence; installed-package and
framework types are separate receiving paths.

CI also exposed a grouped-row example asserting the retired source attribution.
A grouped object projection receives output Collection metadata under the
approved rule. Its count still includes a held source insert. The publication
owner now recomputes grouped and ungrouped aggregate counts from authored rows,
through direct and QueryRef receivers, at initial, held insert, settlement
without confirmation, and remote insert cuts. These four histories add sixteen
declared states/comparisons to the previous 72 states and 408 comparisons.
Each metadata field is separately corrupted with the former source observation;
the shared comparison rejects all sixteen wrong observations. This is
retrospective coverage for the already approved runtime change, with no new
runtime production edit and no claim of pre-edit product RED for this addition.
The old unit expectation is revised with the same authority. Existing
source-return controls still require genuine source attribution.

The other CI repairs register the payload property and exact replay selector,
update supplemental Ref/QueryRef type expectations, preserve the runtime
absent-key case with an explicit negative type assertion, and widen only model
carrier annotations. Exact model contents and comparisons remain intact.
The cleanup helper's parameter now permits synchronous checks, matching its
existing awaited body and preserving error/cleanup semantics. Comparator text
now says every repetition; thresholds and decision logic are unchanged.

Validation on the repaired tree:

- Full DB source/test/config TypeScript: zero diagnostics with a 12 GB heap.
  The earlier default-heap OOM remains recorded and is not passing evidence.
- Public-type owner: 33 checks pass; original mapping mutant fails with TS2344;
  repaired single-shape replay passes.
- Publication plus subscription examples: 1,758 tests pass. The final publication
  owner with four calibration histories passes 1,714 tests.
- Route-context and callback-input owners: 5,126 tests pass.
- Replay-manifest controls: 117 pass. Direct payload replay at property
  `includes-work.projection-payload`, seed 42, path `0` passes one selected test.
- Comparator CLI controls: all 19 pass. ESM and CJS declaration builds pass.

Commands use `pnpm --dir packages/db exec vitest run --maxWorkers=2
--coverage.enabled=false --typecheck.enabled=false` with the named owner files.
Native mutant/repaired replay selects the first generated row description.
TypeScript uses `NODE_OPTIONS=--max-old-space-size=12288 pnpm --dir packages/db
exec tsc --noEmit --pretty false`. The full repository test command remains
unrun locally; CI is the separate receiving witness.

ORC audit: authority and limits (001), independent declared shape/count models
(002), local prose and distinct model/grammar/driver/check (003), finite
reconstruction/ablation/range and admission exclusion (004), real native/public
construction and Collection reads at named cuts (005), original/reverted mapping
and single-field wrong observations (006), unchanged exhaustive finite campaigns
with direct selected replay (007), no new model state (008), canonical terms
(009), existing failure-preserving cleanup (010), no new named shared-semantic
fault requiring another formulation (011), this source-bound evidence (012),
array identity and singleton neighbors (013), bounded native/core claims with no
provider handoff (014), measured required reach (015), and shared type/count laws
without independent example expectations (016). No run budget is reduced.

## First remote paired benchmark

[Run 42087213348](https://github.com/TanStack/db/actions/runs/42087213348) passed.
The candidate artifact names merge commit `88544ac64ba66e66407f7aac7473221ab5ed266b`,
with base parent `8feab6ea3eaae4456f738da39fa93508ddd5cc01` and PR parent
`066d0dd26d9cf7829c986b5d3af1d76c1634e8a5`. Both sides used Node 24.8.0 on the
same Linux AMD EPYC runner, one harness, 84 cases, three fresh-fixture repetitions,
100 measured writes and 20 warmups. Downloaded artifact hashes are bound in the
source manifest. The original comparator also passes when replayed locally.

Overall candidate/base ratios are 0.65× writes and 0.51× cold. Across all nested
query cases they are 0.096× writes and 0.031× cold. At 10,000 issues specifically,
these are ratios of each configuration's three-repetition medians:

| Indexes | Writes | Base cold ms | PR cold ms | Cold ratio | Write ratio |
| --- | --- | ---: | ---: | ---: | ---: |
| none | synced | 4617.718 | 162.347 | 0.0352× | 0.0406× |
| none | optimistic | 4621.722 | 132.707 | 0.0287× | 0.2100× |
| manual | synced | 4621.407 | 124.650 | 0.0270× | 0.0400× |
| manual | optimistic | 4628.366 | 112.942 | 0.0244× | 0.2122× |

The same-harness local pre-2312 bracket already recorded the following 10,000
issue configurations, also with three fresh fixtures per side:

| Indexes | Writes | First base cold ms | PR cold ms | Second base cold ms | Cold ratio first / second | Write ratio first / second |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| none | synced | 63.124 | 67.367 | 65.224 | 1.067× / 1.033× | 0.952× / 0.941× |
| none | optimistic | 50.606 | 86.135 | 80.985 | 1.702× / 1.064× | 1.087× / 0.908× |
| manual | synced | 61.459 | 88.529 | 58.343 | 1.440× / 1.517× | 1.312× / 1.433× |
| manual | optimistic | 50.854 | 85.505 | 65.056 | 1.681× / 1.314× | 1.127× / 1.071× |

These local observations preserve visible variation and some residual cold
increases. They do not establish zero overhead or a noise ceiling. The earlier
whole-suite first comparison fails and the second passes; neither is discarded.
CI uses merge-base sources, while the diagnostic bracket uses pre-2312 sources.
All 504 remote repetition observations are retained in
`../../../scripts/bench/boundary-only-ci-2026-11-05.csv`; the local 756 observations
remain in the existing prep-bracket CSV. The remote run demonstrates execution
of the hard gate once, not its long-term false-positive rate.

## CodeRabbit 5790313417 evaluation

Reviewed commit: `066d0dd26`. The raw review and append-only lossless ledger remain
in task-local scratch evidence. Twenty source occurrences account for inline,
additional, pre-merge, repeated and optional suggestions.

The two concrete findings are correct: the cleanup callback's type is wrong,
and all-three wording disagrees with the >=3 gate. Both are repaired and checked.
The generic report-only suggestion conflicts with the user's explicit hard-fail
policy; keep enforcement and the documented noise limit. The scope comment needs
a clearer causal explanation: empty grouping must not invent a QueryRef key,
and visible aggregates must retain generated keys when ordinary intermediate
fields stop receiving automatic row metadata. The depth cutoff was introduced
by the new aggregate inference; the empty-grouping issue was a reachable neighbor
that repository policy requires fixing or bringing to the maintainer. Both have
existing independent native RED/GREEN and hostile-mutant evidence. They remain
in this approved change, with this rationale added to the PR.

The generic docstring threshold comes from an unconfigured bot default and names
no deficient function. Source and literate oracle/architecture prose already
explain the laws and boundaries. No boilerplate is added to satisfy that metric.
The useful request for explicit same-harness 10k and remote evidence is completed
above. Optional CLI, blanket unit-test generation and autofix prompts add no
specific enforcement gap beyond the findings already addressed.

Loss audit: 20 = 4 fixed-now (CR07/08/10/12) + 3 accepted-design
(CR01/06/14) + 11 duplicates (CR02/03/04/05/13/15/16/17/18/19/20) + 2 refuted
requirements/readiness claims (CR09/11). No finding is deferred or left confirmed-open. This is accounting and
bounded repair evidence, not whole-PR readiness. The initial reviewed head has
failed DB checks, which the successor CI run must verify.

Reviewer assessment: useful supplemental review, with accurate local typing and
wording findings. It did not identify the replay registration, conditional-wrapper
type gap or grouped contract mismatch. Its CSV filters and unavailable source
tools weakened the performance/scope assessment. I would not use it as the sole
reviewer for this change; its two precise repairs and request for explicit remote
measurements are valuable.
