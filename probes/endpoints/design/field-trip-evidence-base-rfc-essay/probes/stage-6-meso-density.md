# Stage 6 Meso-Level Density Assay

## Frozen specimen and control

- Draft: `drafts/tanstack-trust-rfc-v0.1.md`
- SHA-256: `95e0fce47cf051928f0b59eb3b072aedbf1737533cdbfcd8c38f6acd63f7d742`
- Compression target: at most 100 words
- Readers: two separate fresh contexts, with the summary handed to the close
  reader only after the first response was found usable
- Hidden from both: the Stage 4 reader promise, author-value account, source
  trace, validation history, desired answer, and later Reader Assay results

## Exact summary prompt

> Read only the frozen RFC. Return an accurate summary of at most 100 words. Do
> not evaluate it, infer the author's intention, or consult any other artifact.

## Fresh summary response

> TanStack Trust is a proposed base for domain-owned software guarantees. Domain
> packages define claims, rules, evidence adequacy, applicability, and omissions;
> the base records observations, evaluates support routes, tracks freshness and
> contradictions, preserves repair history, and exposes shared operations;
> consumers decide permission and fallback. The prototype includes a finite
> kernel, verified local storage, an Endpoints safe-skip-refetch check, and CLI,
> LSP, and MCP adapters with bounded tests. It separates evidence, execution
> reach, and policy, and requires applicable replay for repair. Applicability
> semantics, generic package APIs, explanation, security, multi-writer durability,
> broader-domain validation, and user outcomes remain unresolved, absent, or
> unmeasured.

The response is 97 words. It addresses the complete artifact, preserves the
headline architecture and status boundary, and was accepted without retry.

## Exact close-reading prompt

> Read only the frozen RFC and the supplied 100-word summary. Identify what, if
> anything, close reading provides that the summary cannot, cite exact headings
> or passages, and classify each difference as mechanism, sequence, evidence,
> particular, tension, cross-section connection, mere extra detail, unsupported
> inference, or material the summary should have retained. A null result is
> allowed.

## Verified close-reading differences

| Classification | Difference recovered only by close reading | RFC verification |
| --- | --- | --- |
| Summary omission | Workflows and interfaces are carriers, not additional semantic owners | `The authority map` explicitly defines three owners, two carriers, and denies carrier authority |
| Mechanism | AND within an argument route, OR across routes, and cycles requiring independent grounding | `Preserve the shape of support` gives the two-route example and finite-grounding rule |
| Tension | Registered rule code remains a trust root; structural verification cannot establish the right domain law | `Soundness remains outside the base` states the exact refusal |
| Mechanism | A thrown or unreached check fails outside evidence history rather than becoming unresolved evidence | `Keep observation separate from interpretation` states this recording boundary |
| Mechanism and tension | `a → b → a` does not revive evidence, but selective invalidation still depends on complete declared dependencies | `Make current authority explicit` states both sides |
| Sequence | Replay must be invoked after failure; earlier-started, same-batch, or cached passes cannot repair it; later context can expire resolution authority | `Retain contradiction and repair history` states each ordering rule |
| Sequence | Design, maintenance, and repair have distinct procedures; repair classifies, reproduces, reduces, repairs, reruns, and links exact replay | `Workflows carry maintenance obligations` supplies the choreography |
| Cross-section connection | Adapter parity is path consistency, not corroboration; LSP severity is adapter behavior, not universal policy | `Interfaces expose one service unevenly` reconnects transport to authority and policy |
| Evidence and particular | The Endpoints law's exact premises, excluded external writes, narrow independent oracle, 21 tests/eight mutations, and constructive-not-independent relationship to the grammar | `Endpoints is one bounded reconstruction` states and limits each item |
| Sequence | The proposed build order puts package semantics and explanation before generic operations, adapters, range, and operational hardening | `Proposed build sequence` provides the dependencies |
| Particular | Applicability is unresolved; generic authoring is absent; explanation is proposed; workflow and agent outcomes are unmeasured; policy is unselected | Point-of-use labels assign the statuses that the summary necessarily bundles |

Every close-reader claim above was found in the cited section. No unsupported
reader inference or contradiction was found. Minor CLI/LSP/MCP invocation
details were correctly treated as extra detail rather than density.

## Bounded reading

The assay is non-null. Close reading contributes mechanisms, causal order,
evidence bounds, and cross-section authority connections that an accurate
97-word summary cannot preserve. The sharpest contributions are the AND/OR
route topology, non-reach boundary, monotonic freshness witness, replay
causality and re-expiry, and the explanation of why Endpoints is not range
evidence.

The operation itself may reward details because it asks what compression loses.
The verification control limits the result to differences with exact text
support; it does not establish literary quality, ideal length, public value, or
that every reader will notice the same structure. Both readers share model
lineage and do not represent a reader population.

