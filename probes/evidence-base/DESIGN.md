# Evidence base rebuild: one real Endpoints claim

This is the bounded package produced by the repository's `design-check`
workflow. It applies the Oracle Guide's test card to one production decision
without claiming that the evidence system or SQL analyzer is generally sound.

## 1. Promise

**Law:** `endpoints/safe-skip-refetch@1`.

For one retained query and one mutation, Endpoints may report that authoritative
refetch can be skipped only when both analyses belong to the same build artifact,
the collection has a confirmed baseline, it has no optimistic or repair
obligation, both dependency bounds are complete, and the query read bound is
disjoint from the mutation write bound. External writes are outside this law.

- Satisfying case: the query reads `users`, the mutation writes `recipes`, and
  every premise above holds.
- Violating case: the query reads `recipes` and the mutation writes `recipes`.
- Unresolved case: an imported helper has unknown write effects.

The check result reports support, contradiction or unresolved evidence. It does
not itself enable or disable an optimization; consumer policy is separate.

## 2. Boundaries

Matched controls vary one premise at a time: artifact identity, baseline,
optimism, repair need, complete reads, complete writes and set overlap. The
package trusts the build-time SQL effect analyzer, captured schema artifact and
the small set-intersection decision kernel. It excludes external writes,
deployment drift not represented by fingerprints, performance, result-value
correctness, auth, replica freshness and unknown transport outcomes.

Returning to an earlier fingerprint does not renew evidence: every dependency
change advances a monotonic revision. A caller still has to report relevant
dependencies; the base cannot discover omitted context by itself.

## 3. Evidence route

The initial route is a static certificate. The check invokes the same
`canSkipRefetch` function used by the Endpoints prototype and records its verdict,
premises, derivation, artifacts and unresolved effects. A registered package rule
admits only a current `skip` observation from that exact check and producer.

The independent test oracle enumerates small read/write sets and computes
disjointness directly. That comparison checks the decision kernel, not the SQL
analyzer that supplies its bounds. SQL breadth and PostgreSQL value correctness
remain separate evidence.

### Oracle Guide card

- **Law and source:** the law above; `V1-SCOPE.md` and the current Endpoints
  effect-decision implementation.
- **Domain and histories:** one query/mutation pair under one captured authority
  state; matched premise changes and all small table-set pairs.
- **Reference:** independently computed set intersection for complete bounds.
- **Production path:** `effect-verdict.mjs#canSkipRefetch`.
- **Checkpoint:** immediately after that function returns.
- **Observed:** verdict, premises, artifact/statement fingerprints, derivation
  and unknown effects.
- **Known omissions:** analyzer soundness, external writes, values, work and
  latency.
- **Reach witness:** the structured observation names the check and production
  path.
- **Fault controls:** overlap accepted, unknown effects accepted, missing
  authority accepted, stale dependencies reused and interface errors recorded.
- **Replay:** rerun the exact case after the challenged observation; delivery
  order cannot substitute for invocation causality.

## 4. Admission and diagnostic attacks

The package rejects a satisfying skip claim when its only evidence is stale,
from another producer/check, for another exact claim, or unresolved. An overlap
produces a counterexample. Unknown effects produce an unresolved observation,
not a false violation. Missing baseline, current optimism or repair need produce
a conservative refresh result.

The assessment preserves alternative argument routes and jointly required
premises. Interface parsing, missing files, inability to reach production and
checker exceptions remain operational errors and add no observation.

## 5. Checker tests

The suite keeps the original argument, lifecycle and replay oracles and adds:

- selective dependency invalidation, including return to old bytes;
- checksum and structural import rejection;
- export/reload equivalence;
- three-valued check outcomes and no evidence on failed reach;
- exhaustive small-set comparison against an independent disjointness oracle;
- reduction that preserves the original violation signature and checkpoint;
- CLI, LSP and MCP agreement through one shared service.

Fault controls mutate the system under test and require assertion failures, not
import or setup crashes. The exact production path and assertion must both run.

## 6. Package

- `protocol.ts`: shared check, dependency and outcome contracts.
- `kernel.ts`: argument evaluation, current applicability and verified state
  import/export.
- `storage.mjs`: checksummed atomic JSON storage.
- `endpoints-real.mjs`: this claim, check contract and package rule.
- `service.mjs`: the sole interface operation layer.
- `cli.mjs`, `lsp-server.mjs`, `mcp-server.mjs`: transport adapters.
- `oracle-tools.mjs`: same-violation history reduction.

This package is ready only for its declared bounded use. Rule/analyzer soundness,
consumer enforcement, durable multi-writer storage, dependency discovery,
signatures, remote execution and general policy remain open.
