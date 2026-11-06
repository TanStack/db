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

## Follow-up: fresh review of repository and package distinctions

A fresh subagent reviewed clean head
`348403c0883f3ef8a68cdc5bdccf6aea82869163`. It confirmed no production defect,
but demonstrated three oracle gaps. Each mutant below passed the prior owner
on case 69 after successful script exit. These surviving mutants are the RED
evidence for the oracle repair; production remains unchanged.

| ID | Surviving wrong design | Missing distinction | Disposition |
| --- | --- | --- | --- |
| R7, P2 | Query `TanStack/query` instead of the authored source repository | Fake GraphQL ignored owner/repo and returned the source PR's edges anyway | fixed-now: repository-aware fixture and alternate source histories |
| R8, P2 | Add `--repo TanStack/query` to numeric PR comment commands | Recorder discarded explicit repository selection | fixed-now: recipient interpretation retains `--repo` and `-R` |
| R9, P2 | Parse every package with `publishedPackages[0].version` | Every publication used one version across all packages | fixed-now: independent package versions and document anchors |

These are enforcement gaps in the existing per-package selection and recipient
identity laws, not proposals to extend delivery or authorization promises. The
action contract says each published package contributes its own released PRs.
GitHub CLI's `gh pr comment --help` documents `--repo`/`-R` as selecting another
repository. The fresh reviewer merits a hire for producing distinguishing
semantic mutants and separating oracle gaps from production defects.

All 105 prior histories retain their indexes. Eight new histories vary the
source repository across stable/build releases, both orders and disjoint/foreign
issue graphs. Eight more publish packages at independently selected numeric,
prerelease and build versions, across both source repositories and orders.
Their different release documents also require different anchors. The model
selects each package's authored version and source repository. The fake API
returns edges only for the requested source repository; the recorder resolves
numeric recipients using the supplied repository flag or the checkout's
repository. Expected notifications still come from the independent ledger.

**GREEN:** `pnpm test:release` passes all 11 existing tests and all 121 histories.
The executable script's fingerprint remains unchanged. ESLint has no errors
(two inherited `require-await` warnings); changed-file lint, configured formatting
and whitespace checks pass.

**Reach:** stable 52; prerelease 77; build metadata 44; reversed sections 56;
linked issues 89; no linked issues 32; no matching PRs 3; asymmetric contributions
46; disjoint issue edges 12; shared issue edges 54; foreign issue targets 24;
same-number foreign issues 20; lookup failure 6; colliding heading anchor 13;
alternate source repository 12; independent package versions 8. All 16 failing
minima pass. Mixed publications may reach both stable and prerelease states;
the missing-version case is now classified from its actual prerelease target.

The same campaign and replay commands documented above apply. Six temporary
mutants each failed `checkNotifications` after successful script exit:

| Mutant | Replay | Rejected value |
| --- | --- | --- |
| Force lookup repository to `TanStack/query` | 69 | Missing source issue notifications |
| Hardcode lookup repository to `TanStack/db` | 105 | Missing alternate-source issue notifications |
| Add `--repo TanStack/query` to PR posting | 69 | Wrong PR recipient URLs |
| Add `-R TanStack/query` to PR posting | 69 | Wrong PR recipient URLs |
| Select `publishedPackages[0].version` for every package | 113 | Omitted second-package contributors |
| Reuse the first stored package anchor for every package | 113 | Wrong second-package changelog links |

All failures are intended notification assertions, not setup errors, runtime
crashes or timeouts. The original script is GREEN with the same driver and
comparison. The new grammar distinguishes the reported mistakes and plausible
narrow repairs that hardcode the usual repository or reuse package data.

The prior conformance table remains applicable with these corrections:
ORC-004 includes alternate source repositories and independent package releases;
ORC-005 retains repository flags in recipient observations; ORC-006 includes
the six new mutant rejections; ORC-007 exhausts 121 histories with unchanged
prior replay indexes; ORC-013 includes wrong-source and wrong-package neighboring
rules; ORC-015 measures all 16 reach minima. ORC-001/002/003/009/010/011/012/014/016
retain the stated outcomes. ORC-008 remains inapplicable to this stateless model.
The controlled command boundary and real delivery limits remain unchanged.
No reachable in-scope counterexample remains known in the declared finite domain.

Final oracle SHA-256:
`664ea4f98fa5551bf9f087b5c502ba2e5fc95cc76270ca96cc0dba8bb22e7b7e`.
The script remains
`3293bdebd25bcc359f6be794812a8843e71d0f745aaa5066f2ed866f3425784c`.

## Follow-up: source references and existing-comment pages

CodeRabbit review 5805246017 at348403c0883f3ef8a68cdc5bdccf6aea82869163 added
three inline findings and two separate suggestions. This append records all of
them, plus the fresh reviewer's prose correction, without replacing prior results.
The final executable fingerprints below supersede the earlier source identities.

| ID/source | Judgment and action | Evidence |
| --- | --- | --- |
| R10, inline 4496287004 | fixed-now: derive linked reach from selected expected issue notifications, not all input edges | No-selected replay64 previously reported linked1; now reports0. All 20 reach minima pass. |
| R11, inline 4496287019 | fixed-now: filter changelog references by source repository and use the URL's PR number | Twelve histories cross two source repositories, both orders, foreign-plus-local, label mismatch and foreign-only references. |
| R12, inline 4496287037 | fixed-now: request every comment page and aggregate its release-marker counts | Sixteen histories vary PR/issue recipients, source repositories, early/later markers and all-zero pages. |
| R13, same inline's failure-policy suggestion | design-decision: skip or attempt posting when an existing-comment check fails | Existing fallback logs a warning and posts; it is preserved while the maintainer chooses. No silent policy change or completed-closure claim. |
| R14, same inline's process-invocation tool note | fixed-now as preventive cleanup; no injection defect or exploit is claimed | All four gh invocations use execFileSync argument arrays. The command-boundary oracle validates routing and literal arguments. |
| R15, fresh reviewer | fixed-now: qualify the pagination exclusion as linked-issue pagination beyond ten | Source prose now distinguishes covered comment pagination from excluded linked-issue pagination. |
| R16, review pre-merge-check prose | fixed-now: document remaining fixture/ordering helpers | Added source documentation; the remote docstring percentage awaits recomputation. No runtime semantics changed. |

The accepted laws remain exact per-package selection and recipient identity.
Changelog labels cannot redirect a contributing source PR; incidental foreign
references cannot notify an unrelated local PR. Successful existing-comment
checks suppress repeat posts regardless of which page contains the release
marker. The shared action's documented duplicate avoidance, source-release
integration and GitHub URL identity provide authority. Failed checks have no
new policy authority; the requested maintainer decision is separate.

Before production edits, the extended 149-history oracle ran against unchanged
script 3293bdebd25bcc359f6be794812a8843e71d0f745aaa5066f2ed866f3425784c:
20 intended notification assertions failed and129 passed. Every reference case
and later-page case failed; early-page/no-marker controls passed. This was not
a setup, timeout or runtime RED. Production now filters source URL identities,
reads all comment pages and aggregates every count. GH calls use argv directly.
The same command and histories give GREEN:149 plus 11 existing release tests.
No prior history or budget was removed.

Reach: stable 80; prerelease 77; build metadata 44; reversed sections 62; linked
issues 110; no linked issues 32; no matching PRs 7; asymmetric contributions 70;
disjoint issue edges 12; shared issue edges 54; foreign issue targets45; same-number
foreign issues 38; lookup failure 6; colliding heading anchor 13; alternate source
repository 26; independent package versions 8; foreign changelog reference 12;
label disagrees with PR URL4; existing release comment 12; later-page release
comment 8. All 20 states have a failing minimum of one; RED and GREEN counts agree.
The no-matching-PR counter uses selected contributions, so suppressed comments
cannot masquerade as a release with no contributing PRs.

Four additional semantic mutants reach the notification comparison after
successful script exit and fail value assertions:

| Mutant | Replay | Wrong observation |
| --- | --- | --- |
| Accept foreign repository PR URLs | 121 | Unrelated local PR notification |
| Filter repository but take the displayed label | 122 | Wrong source PR recipient |
| Omit --paginate | 128 | Duplicate post despite a later-page release marker |
| Request all pages but parse only the first count | 128 | Same duplicate through a plausible narrow repair |

The earlier twelve routing/anchor/package mutants were adapted to the final
argv source and rerun. All fail intended notification/diagnostic assertions.
Sixteen rejections therefore apply to the final production fingerprint, with
unchanged baseline controls in the 149-history GREEN campaign.

Conformance: ORC-001 states the unchanged authority and new controlled page
boundary; ORC-002 uses authored contributions and per-recipient page counts,
not production parsing or JQ; ORC-003 keeps adjacent prose; ORC-004 reconstructs
foreign-only/mixed references, misleading labels, early/later/all-zero pages
across both recipient types and repositories. Removing any new axis loses its
witness. Unique plain headings remain constructed; alternate Markdown is excluded.
ORC-005 checks full recorded notifications at exit and preserves duplicates;
ORC-006 records the 16 mutant assertions; ORC-007 exhausts149 cases with direct
index replay and no stochastic claim; ORC-008 remains inapplicable to stateless
recomputation; ORC-009 maps authored references/pages to Markdown/API fixtures;
ORC-010 retains cleanup failure fidelity; ORC-011 retains independent rendered
anchor evidence; ORC-012 preserves all stages here; ORC-013 distinguishes URL
identity and later-page narrow fixes; ORC-014 limits evidence to controlled gh
arguments, page counts and stderr; ORC-015 measures 20 failing minima; ORC-016
keeps all cases on one independent model, driver and comparison.

The fresh reviewer found no introduced implementation/model defect. It correctly
identified the stale unqualified pagination exclusion (R15). CodeRabbit's reach,
foreign-reference and page findings were technically useful; its earlier claim
that #2361's P22 mutant was a no-op was refuted by an exact-target probe. #2361's
PR description now includes the template structure, coverage owner and current
review status; no #2361 source changed in this pass.

Limits: controlled successful comment calls and authored comment-marker counts
establish neither raw GitHub/JQ reception nor actual posting. Authentication,
foreign authorization, linked-issue pagination beyond ten, retries, concurrent
releases and alternative Markdown remain outside this finite claim. Failed
existing-comment checks retain the old warning/attempt-post fallback. R13 is
open as a design decision, with this oracle owner responsible for failed-check
histories and calibration after the maintainer answers. No real notification
was posted. Whole-PR readiness is not established while this decision and new
head CI are pending. Shipped npm JavaScript remains unchanged.

Final source fingerprints (SHA-256):

- `scripts/comment-on-release.ts`: `f174e6812edc0e5a3fa2124091c5107baf507e7ff5c251e2cb3d3a564e21ef4b`
- `scripts/release-comments-oracle.property.test.js`: `9da4b7bc5a58a0ff2c915bd46d25727ad83ab9ef170bfab84af6d1998caee92d`

## R13 decision: attempt posting and retain debugging context

The maintainer answered on 2026-11-06: attempt posting when the existing-comment
lookup fails. Possible duplicates are acceptable and can be investigated; add
context to the logs. This resolves R13 as accepted-design and supersedes the
pending-decision notes above. There is no remaining policy blocker from this
review. The warning now includes the recipient URL, full process error and
"attempting to post anyway". The existing false fallback is unchanged.

The primary owner adds eight histories after the original 149 indexes: both
source repositories, PR/issue recipients and failures before/after a page
response. Failed checks permit the post even with an unseen existing marker;
a neighboring successful check still suppresses its existing notification.
The model derives expected recipients from the independent release ledger and
marks only the authored failed checks. The fake gh supplies the failure and
stderr/partial stdout. No real comment is posted.

- **Law/authority:** The maintainer's explicit choice permits possible duplicates
  after failed checks and requires debugging context. Successful checks retain
  the existing duplicate-suppression law.
- **RED:** Before production edits, direct replays 149-156 on unchanged parent
  dd5c256 all failed the existing-comment diagnostic assertion after script
  exit. Their notification comparisons already passed: posting and sibling
  suppression match the chosen policy. These are diagnostic value failures,
  not setup errors. The production source matched its recorded parent SHA.
- **GREEN:** `pnpm test:release` passes all 157 histories and 11 existing tests.
- **Mutants:** Changing the failed-check fallback to skip fails notifications
  on replay 150. Removing the logged error object fails the cause assertion
  on replay 151. Both scripts exit successfully before the intended assertion.
- **Reach:** Failed PR check 4, failed issue check 4, partial response before
  failure 4. All 23 failing reach minima pass. Current counts: stable 88,
  prerelease 77, build 44, reversed 62, linked issues 118, no linked issues 32,
  no matching PRs 7, asymmetric contributions 78, disjoint edges 12, shared edges
  54, foreign issues 51, same-number foreign issues 42, issue lookup failure 6,
  heading collision 13, alternate source 30, independent versions 8, foreign
  changelog reference 12, label mismatch 4, existing comment 20, later-page
  comment 12. No history or prior minimum was removed.
- **Limits:** Eight controlled single-recipient failures; no guarantee against
  duplicates after a failed check. Actual delivery/authentication, concurrent
  releases, retries and raw GitHub/JQ conformance retain their earlier limits.

The existing conformance evidence remains applicable. ORC-001 now has explicit
maintainer authority for the failed-check rule; ORC-004 adds that missing failure
dimension; ORC-005 observes posting and recipient/cause warnings at exit;
ORC-006 includes both rejecting mutants; ORC-007 exhausts 157 cases; ORC-015
measures 23 states. ORC-008 remains inapplicable to this stateless computation.
The other numbered outcomes retain the earlier independent model, literate
structure, vocabulary, failure fidelity and controlled-boundary limits.

The review ledger now has 14 fixed items, one refuted claim and one accepted
design, plus the separately fixed sibling S1. No review decision remains open.
This does not substitute for final-head CI or a whole-PR readiness check.

Source fingerprints (SHA-256):

- `scripts/comment-on-release.ts`: `404e380684afeb237e28beeaaecf299270e5fac3287bc762ee6f3a717b761452`
- `scripts/release-comments-oracle.property.test.js`: `472ffb7364f969fdd7cf6bd7e0a2b160dc963cdfa58a0caeb2ace2c1a3abc33c`

## R17: positive partial response after a failed duplicate check

Review5805686967 at1edf65b131219c8b75b311781f93550e8aa07cf1, inline4496583160,
correctly found a grammar gap: every partial failure response contained zero.
The maintainer's attempt-post rule applies regardless of incomplete stdout.
The model, production script, failure driver and exit comparison stay unchanged.

- **Law:** Failed checks log recipient/cause and permit posting, even after a
  partial response reports an existing comment. Authority is the R13 maintainer
  decision. A successful positive check still suppresses its notification.
- **RED/calibration:** A warning-preserving mutant that parses error.stdout
  passed the unchanged157-history owner. After the grammar extension, direct
  replays157–160 each reject it at the notification value assertion after
  successful script exit. The mutant incorrectly omits the failed recipient.
  This is a demonstrated oracle gap, not a baseline production defect.
- **GREEN:** pnpm test:release passes161 histories plus11 existing tests. A
  later local variable rename/formatting changes no generated input or judgment.
- **Reach:** Four added histories cross PR/issue recipients and both source
  repositories with positive first-page output before failure. Positive partial
  response4; any partial response8; failed PR check6; failed issue check6.
  All24 failing minima pass; every prior history/index/minimum remains.
- **Limits:** Controlled gh stdout/errors and recorded notifications at exit;
  no real comment or delivery/authentication claim. Earlier limits remain.

Grammar reconstruction retains absent, zero and positive partial responses.
Removing positive output loses the distinguishing witness. Negative marker
counts remain outside the legal count domain. ORC-001–007 and009–016 retain
prior conformance with the new grammar/reach and rejecting calibration above;
ORC-008 remains inapplicable to the stateless model. No shared semantic-helper
fault or missing production input is introduced.

R17 is fixed-now. Summary-only R18 asks whether full local pnpm test ran; the
PR description now explicitly distinguishes targeted local validation from
full remote CI. CodeRabbit is accurate and useful here: hire for identifying a
plausible surviving implementation and the smallest distinguishing history.
Final ledger accounting:16 fixed,1 refuted,1 accepted-design, plus fixed sibling
S1. No item or policy decision remains open. Final-head CI and review remain
separate merge gates.

Source fingerprints (SHA-256):

- `scripts/comment-on-release.ts`: `404e380684afeb237e28beeaaecf299270e5fac3287bc762ee6f3a717b761452`
- `scripts/release-comments-oracle.property.test.js`: `d1be2b1750738944ddcc5a47a558dac912143fb02185988f800ce27296cdb5ec`
