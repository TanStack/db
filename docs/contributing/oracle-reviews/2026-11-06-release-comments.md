# Release notification selection: 2026-11-06

This is an author self-review. The source fingerprints below identify the
reviewed implementation and oracle in the commit that first adds this record.
No library package source or shipped JavaScript changes.

## Law and boundary

Each published package contributes PRs from its complete version's changelog
section only. A PR receives its contributed packages; a linked issue receives
the union of packages and PR references. Repeated references do not duplicate
notifications. Changelog links use the complete heading's GitHub anchor.

Authority: [the shared action README at the pinned revision](https://github.com/TanStack/config/blob/e4b48f16568324f76f467aa4c2aac2f05db632c3/.github/comment-on-release/README.md),
its documented Changesets integration, and the maintainer's 2026-11-06 decision
to use the repaired local copy. CONTRIBUTING.md records the local boundary.
The failed release selected `1.0.0` from a published `1.0.0-rc.1.4`; the complete
version could never match. Stable headings could also absorb neighboring RCs.

The new owner is `scripts/release-comments-oracle.property.test.js`.
The existing release-history owner judges version/publish planning, not
notification selection. A separate structured release ledger supplies the
independent notification judgment. It does not parse Markdown or import the
production parser. Its semantic version tokens also supply expected anchors.
The driver serializes that ledger, invokes the real script, supplies successful
GitHub API answers through a fake `gh`, and records every command. The comparison
checks comment targets, package/version/anchor links and issue PR references
at script exit. It preserves duplicate commands and ignores noncontractual
comment ordering and surrounding prose.

## Executed evidence

- **Reach:** All 67 finite histories ran. Stable 25; prerelease 42; build
  metadata 24; reversed sections 32; linked issues 35; no linked issues 32;
  no matching PRs 3. Every declared state has a failing minimum of one.
- **RED:** Before adding the local production copy or changing the workflow,
  the oracle ran against the exact script retrieved from pinned upstream
  `e4b48f16568324f76f467aa4c2aac2f05db632c3`. The Node campaign had 64 notification
  assertion failures and 3 passes. After moving unchanged semantics to the
  existing Vitest runner, the same source again had 64 assertion failures and
  3 passes. Both runs reached the intended comparison; neither was a setup RED.
- **GREEN:** `pnpm test:release` passed all 11 existing release tests and all
  67 notification histories. A final measured oracle run also passed all 67.
- **Mutant:** Self-generated prefix, section-leakage and anchor mutations each
  failed `checkNotifications` after successful script exit. These are value
  assertion failures, not crashes, timeouts or setup failures. All temporary
  mutants stayed outside the repository. The original parser is rejected too.
- **Limits:** Successful controlled API calls and no existing release comments
  are premises. This does not establish authentication, actual GitHub delivery,
  pagination, API errors/retries, cross-release duplicate suppression,
  concurrency, arbitrary Markdown or foreign-repository links. The coverage
  map assigns those extensions to this owner; real delivery needs a separately
  authorized host observation. No manual release comments were posted.

The pre-production RED used:

```sh
TANSTACK_DB_RELEASE_COMMENT_SCRIPT=/tmp/db-ci-2026-11-06/upstream-release-comments.ts \
  node --test scripts/release-comments-oracle.test.mjs
```

That filename was then moved to the repository's existing Vitest convention;
its judgment did not change. The current direct replay uses the same ledger,
driver and check as the full campaign:

```sh
TANSTACK_DB_RELEASE_COMMENT_CASE=9 pnpm exec vitest run \
  --config scripts/oracle-scripts.vitest.config.mjs \
  scripts/release-comments-oracle.property.test.js
```

`TANSTACK_DB_RELEASE_COMMENT_SCRIPT` selects an absolute temporary script for
RED or mutant runs. The original upstream source is available via
`git show` in TanStack/config at the pinned revision. Replay cases 0, 8, 9 and
21 cover stable section boundaries, prefix neighbors, the reported RC form
with linked issues, and build-metadata anchors with linked issues respectively.

| Mutant | Exact local edit | Replay | Result |
| --- | --- | --- | --- |
| Prefix | Replace `line.slice(3).trim() === version` with `line.slice(3).trim().startsWith(version)` | 8 | Extra neighboring PRs rejected |
| Section | Replace the next-section `break` with `continue` | 0 | Extra PRs, including Archive PR 999, rejected |
| Anchor | At both comment sites replace `/[.+]/g` with `/\./g` | 21 | Wrong package links rejected for PRs and issues |

## Oracle requirements

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Authority, scope and the script-exit checkpoint are stated above and in the executable owner. |
| ORC-002 | Expected notifications come from authored release records and sets; production scans Markdown. No semantic production helper is shared. |
| ORC-003 | Contract, model, grammar, driver and comparison each have adjacent explanatory prose. |
| ORC-004 | Reconstruction includes the reported RC and stable leakage. Eight version forms, two numeric cores, both section orders and linked/unlinked routing yield 64 histories; missing version, empty section and empty publication add three. Removing suffixes, neighbors, order, repeated links, shared packages or issue routing loses the corresponding witness. The numeric core 2.9.10 is the marginal multi-digit case. Unique plain version headings and same-repository PR links are constructed; duplicate headings and foreign links are excluded. |
| ORC-005 | The executable runs to exit against real temporary changelogs and a command recorder that retains duplicates. All needed release and issue facts are supplied by that cut; no concrete missing-input hypothesis remains within this boundary. |
| ORC-006 | Original parser plus three mutants fail the notification value comparison. |
| ORC-007 | No stochastic campaign applies: this finite grammar exhausts every case on each run and supports direct index replay. No random coverage is claimed. |
| ORC-008 | Not applicable: expected notifications are a stateless ledger recomputation, not a transition model. |
| ORC-009 | The ledger is model-only structured release input; serialization maps it to production changelogs and published-package environment variables. It does not model Collection lifecycle concepts. |
| ORC-010 | The primary comparison failure and secondary cleanup error remain distinguishable in AggregateError; temporary workspaces are removed. No shrinking changes the checkpoint. |
| ORC-011 | No independently motivated shared-fault hypothesis requires another formulation. Anchor normalization is independently derived from semantic tokens. Arbitrary GitHub heading rules remain outside the finite claim. |
| ORC-012 | This versioned self-review records evidence, scope and source fingerprints. |
| ORC-013 | Stable/RC neighbors, rc.1.4/rc.1.40, next-section Archive and plus/uppercase build forms distinguish nearby wrong rules. |
| ORC-014 | Claims stop at recorded gh arguments. Actual GitHub delivery is explicitly unresolved; no controlled-host result is credited as real delivery. |
| ORC-015 | A failing minimum guards all seven declared states; measured counts are above. |
| ORC-016 | All histories use one independent model, production driver and check. No separate expected answers or unit examples are in the owner. |

## Source fingerprints (SHA-256)

- `scripts/comment-on-release.ts`: `ff2f10019db887e05ad49b25b6a3149c0a5afc4db723912982aab38eb439fa62`
- `scripts/release-comments-oracle.property.test.js`: `17d0592e949bcd4acb52493f97b3150acabe8ca95e940c0bcb3ffbba8fb9b244`
- `.github/workflows/release.yml`: `197fbc9a86934f799e2982cc5be242b24486b36b8c73cdc8769dbdd756e19d5f`
- `package.json`: `2d495c2b15e37344aa5fd93f8ddece809f981b2a6847151ad03386f007522f0f`

## Follow-up: independent review and repair

The independent reviewers evaluated PR #2362 at
`6135cb7edc40b3c7989bb9214838fdd5eba848fd`. This append records the repair;
the fingerprints below identify its executable sources in the containing commit.
The earlier 67-history GREEN result was real, but did not justify all the claims
above. In particular, its per-PR routing and anchor judgment had false-green
gaps. This section supersedes those claims and the corresponding ORC outcomes.

### Law, experiment and inference

The notification law preserves recipient identity: repository plus issue number.
Each issue receives only the packages contributed by PRs that link to it, with
unambiguous links back to those PRs. Changelog links identify the selected
version heading even when an earlier heading reserved the same anchor. A failed
issue lookup logs its PR and cause; it does not suppress unrelated notifications.
The action README linked above and the maintainer's local-copy decision supply
the selection/aggregation authority. GitHub's rendered changelog HTML supplies
independent evidence for document-wide anchor suffixing: `0.11.0` has `#0110`,
whereas the later `0.1.10` has `#0110-1`. The warning preserves the inherited
lookup fallback and makes its failure observable.

The oracle keeps every original history and adds 38. Twenty-four cross two
numeric cores, stable/build targets, both section orders and three issue graphs.
The graphs have asymmetric package contributions, per-PR shared/disjoint/absent
edges and same-number foreign issues. Six histories fail one of three PR
lookups for each core. Eight select every position in a four-version anchor
collision chain, in both orders. The model chooses the first unreserved anchor
from a finite candidate list; production scans Markdown and reserves IDs in a
Set. Neither the model nor its expected issue edges come from production helpers.

Before any production repair, the expanded 105-history campaign rejected the
unchanged script in 27 intended notification/diagnostic assertions; 78 passed.
The unchanged script's SHA-256 matched the initial fingerprint above. A fixed-PR
lookup mutant, which survived every original history, was rejected by new case
67 while its unchanged baseline passed. Strengthening source-PR observations
also rejected unchanged production on case 69 before production edits.

The repaired script retains full linked-issue URLs through grouping, existing
comment lookup and posting. Issue comments use full source PR URLs. Changelog
parsing reserves allocated anchors as well as natural anchors, and failed issue
lookups warn with their PR and error. The same campaign now passes all 105
histories. `pnpm test:release` passes those histories and all 11 existing tests.

**Reach:** stable 41; prerelease 64; build metadata 36; reversed sections 48;
linked issues 73; no linked issues 32; no matching PRs 3; asymmetric contributions
30; disjoint issue edges 8; shared issue edges 54; foreign issue targets 8;
same-number foreign issues 8; lookup failure 6; colliding heading anchor 13.
All 14 states have a failing minimum of one. RED and GREEN reached the same counts.

The RED and GREEN campaign command is:

```sh
pnpm exec vitest run --config scripts/oracle-scripts.vitest.config.mjs \
  scripts/release-comments-oracle.property.test.js
```

For baseline or mutant replay, use the two environment variables documented
above. These six temporary semantic edits each reached the intended comparison
after successful script exit and failed a value assertion. None failed during
setup or by timeout.

| Mutant | Exact semantic edit | Replay | Rejected observation |
| --- | --- | --- | --- |
| Fixed PR | Call `findLinkedIssues(200, repository)` for every PR | 67 | Wrong issue recipients and unions |
| Global union | Merge all PR packages into each issue | 67 | Packages unrelated to that issue |
| Wrong recipient | Post using only the final number from the issue URL | 69 | Foreign issue becomes a DB issue |
| Relative PR | Replace full source PR URLs with `#PR` | 69 | Source references point into the recipient repository |
| No warning | Remove the lookup catch's warning | 79 | Missing diagnostic PR and cause |
| Per-base anchors | Count occurrences per natural slug, without reserving allocated suffixes | 101 | A generated suffix collides with a later natural slug |

### Finding dispositions

| ID and source | Diagnosis and test gap | Disposition |
| --- | --- | --- |
| R1, script reviewer, P2 | Number-only issue identity targets the wrong repository. The grammar/model lacked repository identity. | fixed-now: URL routing; foreign/same-number histories; wrong-recipient mutant. |
| R2, oracle reviewer, P2 | Identical issue answers conceal wrong-PR lookups. Asymmetric contributions and per-PR edges were absent. | fixed-now: PR-aware driver and graph grammar; fixed-PR/global-union mutants. No current production lookup bug was inferred from this test gap. |
| R3, oracle reviewer and script-review footnote, P2 | Model and production shared an incorrect document-independent anchor rule. | fixed-now: document-unique judgment and parser, both orders retained; collision-chain mutant. |
| R4, CodeRabbit review 5804829773/comment 4495969774, P3 | A failed lookup silently returned no issues. Diagnostics were unobserved. | fixed-now: warning and generated failure observations; no-warning mutant. |
| S1, sibling found during repair, P2 | Correct foreign recipients with bare `#PR` still link to the wrong repository. | fixed-now: source PR URLs and repository-aware reference observation; relative-PR mutant. |

Raw-source accounting is four findings fixed, none open, refuted, deferred or
discarded. R3 retains both sources. S1 is recorded separately from those four.
The nightly-CI reviewer found no actionable issue in PR #2361's three-file diff;
this repair does not alter that PR. The script and oracle reviewers merit a
hire: executable wrong-target evidence, a surviving mutant and real rendering
evidence exposed distinct gaps. CodeRabbit's one diagnostic finding was accurate
and useful, with less depth than the independent reviewers' findings.

### Conformance and limits after repair

| Requirement | Current outcome |
| --- | --- |
| ORC-001 | Authority and controlled command/diagnostic boundary stated above and in executable prose. |
| ORC-002 | Authored release ledger and PR-edge graph supply expectations; no production parser or semantic helper is shared. |
| ORC-003 | Contract, model, grammar, driver and exit comparison retain adjacent explanatory prose. |
| ORC-004 | The grammar reconstructs all four reported gaps and S1. Removing repository identity, per-PR edges, asymmetry, lookup failures or collision chains loses a distinguishing witness. All original numeric/version/order/empty boundaries remain. Unique plain version headings and source-repository changelog PRs are constructed; duplicate version headings, foreign changelog PRs and bracketed headings remain excluded. |
| ORC-005 | Real executable and temporary changelogs reach the exit comparison; commands retain duplicates, omissions, recipient identity and package/reference unions. Needed source facts are supplied by then. |
| ORC-006 | Unchanged production RED plus six semantic mutants fail intended assertions. |
| ORC-007 | Finite bounded enumeration executes all 105 histories; direct case replay uses the same model, driver and check. No stochastic campaign is claimed. |
| ORC-008 | No lifecycle state model is introduced; expected notifications are ledger recomputation. |
| ORC-009 | Structured releases and issue edges are explicitly model-only inputs serialized into changelogs and API responses. |
| ORC-010 | Primary assertion and secondary cleanup failures remain distinguishable; temporary resources are removed. |
| ORC-011 | GitHub-rendered HTML independently challenges the shared anchor assumption. Semantic-token base anchors plus document-wide allocation replace the faulty judgment. No separate delivery formulation is claimed. |
| ORC-012 | This append preserves initial evidence, corrections, dispositions, calibration and current fingerprints. |
| ORC-013 | Same-number foreign issues, shared/disjoint/absent edges, individual lookup failures and allocated-suffix collision chains distinguish plausible narrow repairs. |
| ORC-014 | Command arguments/stderr are the claimed boundary. Actual GitHub delivery and foreign-token authorization remain outside it; rendered HTML establishes the anchor premise only. |
| ORC-015 | All 14 failing reach minima pass with the measured counts above. |
| ORC-016 | Every history reuses one model, production driver and comparison; no separate handwritten expected answers were added. |

The bounded closure claim is exact version selection and per-recipient aggregation
over these finite release/issue graphs, through the executable script, observed
in recorded commands and lookup stderr at exit. It includes full repository
identity and document-unique version anchors. No known reachable counterexample
remains in that declared boundary. It is not a proof for arbitrary Markdown or
all possible graphs.

Comment operations succeed in the controlled driver and no earlier release
comments exist. Actual GitHub delivery, foreign-repository permissions, prior
comments, pagination beyond ten linked issues, retries, other API failures,
concurrent releases and alternative Markdown remain outside this evidence.
The coverage-map owner tracks those extensions and their needed receiving
witnesses. No real release comment was posted. No shipped package source changes.

Follow-up source fingerprints (SHA-256):

- `scripts/comment-on-release.ts`: `3293bdebd25bcc359f6be794812a8843e71d0f745aaa5066f2ed866f3425784c`
- `scripts/release-comments-oracle.property.test.js`: `7dd58425eba0d3c235dd2f3352a211f9921f5d9a17040addfc7bfe4cbc429c8a`
- Workflow and package manifest fingerprints remain unchanged from the initial record.
