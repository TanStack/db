---
instrument: research-survey
title: "shadcn/lint: diagnostics and agent evaluations"
question: "How does shadcn/lint construct actionable diagnostics, and what does its evaluation design establish or leave open?"
scope: "One public repository, its evaluation documentation, selected implementation files, and two external user issue reports; English sources available on 2026-09-15."
intended_use: "Source material for the evidence-tool and check-authoring inquiry; not validation of the base-system Design Grammar."
depth: quick
researched_at: 2026-09-15
source_cutoff: 2026-09-15
status: bounded
---

# shadcn/lint: diagnostics and agent evaluations

## Survey brief

- **Question:** How does shadcn/lint construct actionable diagnostics, and what does its evaluation design establish or leave open?
- **Intended use:** A focused donor record for agent-facing checks. No architecture selection or performance prediction for Endpoints.
- **Included:** Diagnostic construction, policy boundaries, paired-agent evaluation, validity checks, and reported failures.
- **Excluded:** A general linter survey, exhaustive code audit, execution of paid evaluations, independent reproduction, and validation of our developing evidence model.
- **Starting sources:** The user-supplied announcement and repository URL. The announcement supplied the question; repository sources carry factual support below.
- **Available source languages:** English.
- **Access limits:** Web retrieval failed for some source paths. Public GitHub API and raw-source retrieval recovered the selected code at commit `53de86f0e7dcc341a9cb45c383a9f2c454d1e958`. Raw evaluation outputs are untracked; this study did not obtain them.
- **Frozen coverage frame:** policy → diagnostic construction → experimental comparison → independent outcome checks → contrary cases. Quick depth: one source-following pass and one compact contrary-evidence pass.
- **Output:** `probes/endpoints/design/evidence-guarantees/shadcn-donor-study.md`.

## Orientation

The repository couples authored design-system policy with code-derived repair context. Its evaluation separates compliance with that policy from visual intent, and compares diagnostic feedback against a rules-only correction condition. These are different checks with different authorities; neither establishes overall application correctness. The final sentence is an inference from the measured boundaries, not a result reported by an independent experiment. [S3](#s3) [S6](#s6) [S8](#s8)

## Terms and distinctions

- **Contract:** Project-authored permission for classes on recognized components. It expresses a policy rather than inferring what the design team ought to allow. [S16](#s16)
- **Diagnostic:** A finding plus context for repair; its suggested repair remains separate from whether the finding is valid. [S8](#s8) [S10](#s10)
- **Convergence:** No remaining measured findings, within a bounded correction loop. [S3](#s3)
- **Fidelity:** A model judgment of preservation of task intent, under a rubric that permits snapping specified values to nearby design tokens. It is not pixel identity. [S6](#s6)

## Evidence landscape

### Diagnostic construction

- **C1 — Verdicts preserve the policy reason.** The contract engine distinguishes accepted, explicitly denied, and not-allowed classes. Failed verdicts retain the relevant entries, category and optional message. The last matching component contract applies; denial is checked before allowance. Invalid contract regexes and recognized near-miss entries produce configuration findings instead of applying the invalid policy. [S9](#s9)
- **C2 — Repair text is assembled from the local program.** `no-restyle` branches on class category, wrapper forwarding, source-file availability and available variants/sizes. Spacing guidance checks permitted margin, enclosing containers and other allowed primitives. Variants are loaded only after a failed verdict needs diagnostic context. Built-in messages do not propose weakening the policy; custom project messages can replace them. [S8](#s8) [S10](#s10)
- **C3 — The renderer is shared, while wording remains project-owned.** It supports common slots, per-contract overrides, rule messages, a project-wide note, and fallbacks for empty known slots. Unknown placeholders remain literal; likely spelling mistakes warn without changing the verdict. [S10](#s10)
- **C4 — Source-derived context has an analysis boundary.** Variant extraction reads factory objects and string-literal prop unions, follows limited same-file type aliases/intersections, and caches by modification time. Definition selection can fall back to the file's first factory. These are bounded syntactic mechanisms, not full TypeScript evaluation. [S12](#s12)
- **C5 — Suggestions include explicit heuristics.** Color suggestions use a distance cutoff, prefer role-appropriate token names and return a short list. Spacing suggestions rank nearby scale values. Those calculations identify candidates; they do not establish that a candidate meets product intent. The latter is a model inference about their scope. [S11](#s11)

### Evaluation design

- **C6 — The useful contrast is rules-only versus diagnostic correction.** The runner generates one starting output, then copies it into both correction conditions. Both receive the same rules and up to three rounds. The rules-only agent does not see findings, but a hidden lint pass determines continuation. Generation-versus-correction alone includes the effect of extra work. [S3](#s3)
- **C7 — Failure to produce usable output is included in findings.** The lint adapter checks expected files, incorporates component-read/build findings and parse failures, and adds an agent-error finding when a call fails. This prevents those conditions from appearing as clean lint output. [S4](#s4)
- **C8 — The measured policy is a particular configuration.** It enables five rules and disables three inside component files; `no-unknown-classes` is not in this paired runner's rule set. Thus success does not mean every available rule was exercised. [S5](#s5)
- **C9 — Reported savings are narrow measurements.** The evaluation report gives one rules-only control run per Claude model: diagnostic correction costs 10–48% less, with all eight tasks green in each diagnostic condition. It also reports earlier linter failures, a bounded red-team exercise with escapes, prompt/rule changes and untracked result directories. These are author reports, not recomputed results here. [S2](#s2)
- **C10 — Intent preservation has a separate, weaker authority.** The fidelity script renders before/after, takes three judge passes by default, reports a median score and majority intent decision, and retains individual pass outputs. Two empty renders become unjudgeable. Failed judge passes are excluded from scored aggregation; the score therefore does not imply all requested passes succeeded. [S6](#s6)
- **C11 — Outcome labels inspect code but are not semantic verdicts.** The classifier examines changed source against the fixture, detects suppression text, checks the task file for style workarounds, and compares extracted variant definitions. Its comments describe broader workaround inspection than the style-specific branch actually performs. This is a code-reading boundary, not a reproduced exploit. [S7](#s7)

## Positions and mechanisms

These are unranked donor mechanisms, not adoption recommendations.

| Mechanism | Material available | Boundary |
| --- | --- | --- |
| Authored policy plus discovered vocabulary | C1–C4: keep allowed operations explicit and populate explanations from current source | Discovery can be incomplete or choose the wrong source |
| Reason-bearing verdict | C1–C3: distinguish a denial, a missing allowance and invalid policy; tailor messages | Actionable wording does not prove a correct verdict |
| Matched correction conditions | C6: same initial output, rules and round budget; vary diagnostic access | Bounded tasks and runs, not a general productivity estimate |
| Several outcome checks | C7, C10, C11: output validity, lint result, transformation label, visual intent | Different measures have different blind spots |

## Disputes and conflicting evidence

- **C12 — Useful context can become misleading repair guidance.** Issue 3 reports a minified internal name in diagnostics and a suggested edit inside a dependency package. It includes a reduced reproduction. This challenges the correctness of the suggested destination, not the value of contextual messages in general. Not reproduced here. [S13](#s13)
- **C13 — Analysis failure can masquerade as many policy violations.** Issue 9 reports unresolved wildcard package exports preventing theme construction; bundled-grammar fallback then labels project utilities unknown. The author supplies a reproduction and proposed patch. This is a reported failure mode, not verified by this survey. [S14](#s14)
- **C14 — Documentation and current implementation cover different moments.** The report describes variant classification as limited to factory definitions, but the pinned extraction code also reads prop unions and the classifier calls that extractor. The current README also includes GPT results while the report's limitations discuss a Claude-only result set. These differences prevent treating every paragraph as one frozen experiment. [S1](#s1) [S2](#s2) [S7](#s7) [S12](#s12)

No independent replication of the cost claim was found in the bounded search. This is not evidence that none exists. The contrary cases do not invalidate the measured runs; they restrict transfer to other programs and configurations.

## Cases and timeline

The supplied announcement is dated September 14. Repository evaluation documentation describes runs from September 2–10; inspected user reports are dated September 14–15. The code is pinned to `53de86f0e7dcc341a9cb45c383a9f2c454d1e958`, retrieved September 15. This study did not reconstruct the exact source revision, prompt or pricing behind every reported historical run. [S2](#s2) [S13](#s13) [S14](#s14)

## Coverage and gaps

| Coverage cell | Status | Sources | Gap or limit |
| --- | --- | --- | --- |
| Authored policy and diagnostic construction | supported | S8–S12, S16 | Selected implementation path; not all rules or analyzers |
| Paired comparison and configuration | supported | S3–S5 | Code inspected, not executed |
| Published numbers and raw results | thin | S1, S2, S15 | Numbers reported; untracked raw runs unavailable |
| Visual and code outcome checks | supported | S6, S7 | Model judgment and syntactic classification are partial |
| Failures beyond author fixtures | thin | S13, S14 | Two user reports inspected; not reproduced |
| Cross-project effectiveness | unsearched | — | Outside focused donor scope |
| Endpoints/evidence-system benefit | unsearched | — | No transfer experiment or held-out validation |

## Claim-to-source ledger

| Claim | Kind | Support | Confidence | Limit |
| --- | --- | --- | --- | --- |
| C1 | primary record | S9 | solid | Code reading only |
| C2 | primary record | S8, S10 | solid | Selected diagnostic path |
| C3 | primary record | S10 | solid | Rendering is not repair correctness |
| C4 | primary record | S12 | solid | Bounded syntax extraction |
| C5 | primary record / inference | S11 | solid / plausible | Heuristics do not establish intent |
| C6 | primary record | S3 | solid | Runner not executed |
| C7 | primary record | S4 | solid | Delegated component checker not audited |
| C8 | primary record | S5 | solid | Specific paired policy |
| C9 | practitioner report | S2 | solid | Solid attribution, not independent result verification |
| C10 | primary record | S6 | solid | No visual judgments repeated |
| C11 | primary record / inference | S7 | solid / plausible | No exploit reproduced |
| C12 | practitioner report | S13 | solid | Solid attribution, unverified reproduction |
| C13 | practitioner report | S14 | solid | Solid attribution, unverified reproduction |
| C14 | primary record / inference | S1, S2, S7, S12 | solid / plausible | No historical revision attribution |

## Sources

### Primary and official

- <a id="s1"></a>**S1** — [README](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/README.md), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Official overview; result claims and component-policy interface.

- <a id="s2"></a>**S2** — [Evaluation report](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/docs/evals.md), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Author-reported dated measurements; raw run outputs are untracked.

- <a id="s3"></a>**S3** — [Paired evaluation runner](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/evals/run.mjs), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Inspected pinned implementation; not executed.

- <a id="s4"></a>**S4** — [Evaluation lint adapter](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/evals/lib/lint.mjs), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Inspected validity checks and findings format; not executed.

- <a id="s5"></a>**S5** — [Evaluation policy](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/evals/lib/policy.mjs), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Exact measured rule configuration, distinct from all available rules.

- <a id="s6"></a>**S6** — [Fidelity evaluation](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/evals/fidelity.mjs), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Inspected model-judge rubric and aggregation; no independent visual judgment.

- <a id="s7"></a>**S7** — [Outcome classifier](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/evals/lib/classify.mjs), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Inspected classification logic; its labels are not independent semantic judgments.

- <a id="s8"></a>**S8** — [no-restyle implementation](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/lint/src/rules/no-restyle.ts), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Diagnostic branching and repair context.

- <a id="s9"></a>**S9** — [Contract engine](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/lint/src/rules/contracts.ts), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Verdicts, policy precedence, and malformed-policy handling.

- <a id="s10"></a>**S10** — [Message renderer](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/lint/src/rules/messages.ts), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Project messages and placeholders.

- <a id="s11"></a>**S11** — [Suggestion helpers](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/lint/src/rules/suggest.ts), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Distance-based color and spacing suggestions.

- <a id="s12"></a>**S12** — [Variant extraction](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/lint/src/project/variants.ts), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Bounded source analysis and cached variant discovery.

- <a id="s13"></a>**S13** — [Issue 3: misleading name and repair path](https://github.com/shadcn-ui/lint/issues/3), shadcn-ui/lint issue author, 2026-09-14. **Used for / limit:** External user report with reproduction; not reproduced in this study.

- <a id="s14"></a>**S14** — [Issue 9: stylesheet resolution and degraded analysis](https://github.com/shadcn-ui/lint/issues/9), shadcn-ui/lint issue author, 2026-09-15. **Used for / limit:** External user report with reproduction; not reproduced in this study.

- <a id="s15"></a>**S15** — [Evaluation harness README](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/packages/evals/README.md), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Codex execution conditions and missing dollar-cost data.

- <a id="s16"></a>**S16** — [Design-system configuration](https://github.com/shadcn-ui/lint/blob/53de86f0e7dcc341a9cb45c383a9f2c454d1e958/docs/design-systems.md), shadcn-ui/lint, retrieved 2026-09-15. **Used for / limit:** Authored component contracts separate from component implementation.

### Scholarly and technical

No separate scholarly source was needed for this single-repository implementation study. The technical sources above share one publisher and are not independent corroboration.

### Field, critical, and secondary

S13 and S14 are external users' primary reports hosted by the same repository. Search results about other shadcn projects were excluded as wrong-product matches.

## Search and control record

- **Search routes:** Read supplied repository first; followed documentation links; retrieved its Git tree; inspected 11 selected source files at the pinned commit. Web query: `"shadcn-ui/lint" false positive diagnostics evals`. Followed the repository issue list to two relevant reports.
- **Prominence counter-search:** Examined small user reports with reduced reproductions rather than relying on the announcement or stars. Most generic search results concerned other products and were excluded.
- **Contrary-evidence search:** Inspected author-reported escapes and eval limitations; sought false positives, incorrect repair guidance and analysis failure. Found C12–C14. No new experiment performed.
- **Source-class coverage:** 16 cited documents/files/reports: 14 official repository sources and 2 external-user reports. Retrieval index and search-result pages are routes, not extra corroborating sources.
- **Recency check:** Pinned code; dated docs/reports; historical measurements separated from present code. GitHub HTML sometimes showed differing live counts; no star/issue count was used as evidence.
- **Saturation check:** Quick stop rule fired after one source-following pass plus one contrary-evidence pass. Last material additions were wrong repair destinations, degraded theme analysis and documentation/code drift. No broad saturation claim.

## Limits and unmeasured

- **Main artifact risk:** A detailed mechanism map can make a small, author-run evaluation appear more general than it is. Most evidence comes from one codebase and its authors.
- **Unmeasured:** Raw-run accuracy, sampling variance, current prices, real-project task success, accessibility/interaction correctness, correctness of all lint detections, and performance of any Endpoints adaptation.
- **Coverage claim:** A bounded quick Research Survey of this donor, not an exhaustive audit, independent replication or evidence that our base system works.

## Handoff index

- **Diagnostic mechanisms:** C1–C5 and the unranked mechanism table.
- **Experimental comparison and validity checks:** C6–C11.
- **Boundary and contrary cases:** C12–C14.
- **Claim and source ledgers:** Traceable inputs for later inquiry; no architecture selected here.

This index describes available material. It does not select or run another instrument.
