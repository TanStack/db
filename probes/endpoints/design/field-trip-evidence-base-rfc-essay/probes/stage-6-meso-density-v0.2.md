# TanStack Trust RFC v0.2 — Meso-Level Density Assay

## Frozen input and control

- Draft: `drafts/tanstack-trust-rfc-v0.2.md`
- SHA-256: `c4abd5aba9496538ba7feab2b7fff1f17b87fe9cb8134ffb4fefc1300d880d28`
- Compression target: no more than 100 words
- Summary contexts: one fresh reader, accepted without retry
- Close-reading contexts: one separate fresh reader
- Boundary: neither reader received the author-value account, Stage 4 reader
  promise, validation history, source trace, desired verdict, or any reader-assay
  response.
- Correlation limit: both fresh readers used the same model family. Their
  responses are generated samples, not evidence about a reader population.

## Exact summary prompt

> Act as the fresh summary reader for a Meso-Level Density Assay. Read only this
> frozen RFC. Do not inspect any other project files, source trace, validation
> history, or conversation context. Produce an accurate summary of the supplied
> RFC in no more than 100 words. Do not evaluate the writing or infer author
> intent. Return only the summary followed by the word count.

## Exact summary response

> TanStack Trust is proposed as an internal evidence-mechanics layer within
> TanStack DB Endpoints. Domain packages define guarantees, authorized rules,
> checks, applicability, and omissions; Trust records observations, evaluates
> structured evidence routes, tracks dependencies, freshness, contradictions,
> and repair replays; consumer policy decides permission, severity, and fallback.
> The prototype includes a finite kernel, verified local storage, one bounded
> safe-skip-refetch check, and shared CLI, LSP, and MCP adapters. It does not
> establish checker soundness, generality across domains, production safety, or
> measured agent outcomes. Priorities include completing the Endpoints trust
> loop, explanations, agent operations, validation, deployment hardening, and
> deferring extraction until justified.

Word count: 97. The response was usable and accurate. It preserved the product
home, three-owner authority split, core evidence lifecycle, bounded prototype,
major non-claims, and Endpoints-first build direction.

## Exact close-reader prompt

> Read only the frozen RFC and the 97-word summary. Identify what, if anything,
> careful reading of the full RFC provides that this summary cannot, and cite
> the exact RFC sections or distinctive phrases that provide it. Separate:
> functional differences such as mechanism, sequence, evidence, particular,
> tension, cross-section connection, or felt texture; mere extra detail;
> unsupported inference; anything the summary should have retained; and a null
> result if no functional difference exists. Do not score the essay or recommend
> revisions.

## Exact close-reader response

### Functional differences

- **Support has logical shape.** Section 4 specifies conjunctive premises within
  a route, disjunctive alternative routes, and says, “A flat gap list is only a
  deduplicated inventory; it is not a completion plan.” Cyclic support also
  “does not create grounding.” “Structured evidence routes” alone does not
  recover these semantics.
- **Evidence, execution reach, and policy are independent axes.** Section 2
  distinguishes a violated application claim, a checker that did not run or
  reach production, and a consumer denial. Section 4 adds that a throw or missed
  checkpoint creates no observation rather than a synthetic failure. This is
  stronger than the summary’s ownership split.
- **Freshness is historical, not content-addressed.** Section 4 says an
  `a → b → a` dependency transition does not revive old evidence because “the
  old execution has not happened again in the current history.”
- **Repair has strict causal sequencing.** A resolution requires a fresh,
  applicable replay of the same law and case, invoked after the failure was
  recorded. An earlier-started pass, a same-batch pass, cached data, or unrelated
  green result cannot repair it. Resolution is append-only and may expire,
  making the original challenge relevant again.
- **Applicability remains architecturally unresolved.** Section 3 contrasts the
  proposed rule-owned relation with the current private boolean dependency
  comparison and explicitly leaves open both ownership and
  boolean-versus-three-valued semantics.
- **The Endpoints claim is highly particular.** Section 8 requires the same
  artifact, an authority baseline, no pending optimistic or repair obligation,
  complete effect bounds, and disjoint query-read/mutation-write sets. Its
  independent oracle checks only set intersection over small subsets; it does
  not validate SQL analysis, PostgreSQL behavior, external writers, or
  production policy.
- **The prototype is not independent range evidence.** Section 8 explains why:
  Endpoints helped form the grammar, so it is “a constructive example, not an
  independent test.” The summary states the lack of generality but loses this
  evidentiary reason.
- **Shared adapters are not corroboration.** Section 6 calls them “path
  consistency, not independent corroboration” and distinguishes “an agent can
  call the demo” from participation in the evidence lifecycle.
- **Consumer-policy separation contains two concrete warnings.** Section 7
  rejects both “unresolved claim as a universal veto” and “absence of a
  counterexample as permission”; even full refetch is not universally safe.
- **The motivating texture matters.** Section 1’s question—“What would justify
  relying on this change … and what would make that justification expire?”—
  connects the thesis to freshness and repair. The conclusion defines success
  as a later agent understanding claims, routes, context, contradictions,
  replay, limits, and authority without reconstructing the project.

### Mere extra detail

- The exact count of 21 local tests and eight mutation controls.
- CLI input forms, the number of MCP tools, and current LSP severity choices.
- Individual donor names and formal-tool examples.
- Temporary-file/atomic-rename implementation details.
- The exhaustive inventories of future operations, validation studies, and
  deployment concerns.

### Unsupported inference the summary must not induce

- Generic domain-package authoring or rule registration exists.
- Applicability semantics are settled.
- Verified storage implies authentication, signatures, hostile-process safety,
  or multi-writer durability.
- CLI/LSP/MCP availability establishes real agent use or independent
  corroboration.
- A passing safe-skip observation permits the optimization.
- The checker validates SQL analysis or production behavior.
- Complete typed explanations or generic evidence ingestion are implemented.
- Trust is currently a standalone product or package roadmap.

### Highest-semantic-load omissions

1. AND within a route, OR across routes, and non-grounding cycles.
2. Separate evidence/reach/policy axes and the rule that checker failure
   produces no evidence.
3. Post-failure, fresh, same-case repair replay with expirable authority.
4. Applicability’s unresolved ownership and result shape.
5. The exact safe-skip law and why Endpoints is not independent range evidence.
6. “Path consistency, not independent corroboration.”

### Null result

Not applicable: the full RFC provides substantial functional content beyond the
summary.

## Orchestrator verification ledger

| Close-reading difference | RFC location | Classification | Verification |
| --- | --- | --- | --- |
| AND within routes, OR across routes, cycles do not ground | §4, “Preserve the shape of support” | Mechanism | Exact and supported |
| Evidence, execution/reach, and policy remain separate | §2, “Three axes”; §4, “Keep observation separate” | Cross-section connection | Exact and supported |
| `a → b → a` cannot revive old evidence | §4, “Make current authority explicit” | Mechanism | Exact and supported |
| Replay must be fresh, same-case, and invoked after failure | §4, “Retain contradiction and repair history” | Causal sequence | Exact and supported |
| Applicability ownership and value shape remain open | §3, “Applicability is part of meaning” | Tension | Exact and supported |
| Safe-skip law and oracle boundary | §8 | Evidence particular | Exact and supported |
| Endpoints helped form the grammar | §8 | Evidence-role distinction | Exact and supported |
| Shared adapters are path consistency, not corroboration | §6 | Cross-section connection | Exact and supported |
| Unresolved is neither veto nor permission | §7 | Policy tension | Exact and supported |
| Opening question returns through conclusion criteria | §1 and conclusion | Cross-section connection | Exact and supported |

No unsupported close-reader inference was accepted as RFC content. The
retention-critical list describes what compression loses; it is not evidence
that the accurate 97-word summary failed its assigned target. The assay is
non-null without treating length, quantity of detail, or ornate wording as
value.

## What remains unmeasured

The assay does not establish ideal length, literary quality, novelty, public
value, human comprehension, delayed recall, or whether every target reader will
find the added mechanisms worth the reading cost.
