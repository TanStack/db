# Evidence base handoff

Date: 2026-09-15. Repository: `TanStack/db`. Branch:
`codex/component-endpoints-prototype`. Local worktree:
`/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-component-endpoints-prototype`.

The base-system rebuild is runnable but not committed. It now has verified local
storage, dependency-selective applicability, a real Endpoints decision check and
one shared service exposed through CLI, LSP and MCP. The original 13 kernel tests
remain, one dependency-revision oracle was added, and seven rebuild tests cover
the new vertical slice.

## Resume

Start with [README.md](README.md), [DESIGN.md](DESIGN.md), the packaged
[design-check workflow](workflows/design-check.md) and the Oracle Guide captured
in the Endpoints evidence-guarantees source trail. Then run, from this directory:

```sh
npm test
npm run test:faults
npm run test:handoff
npm run typecheck
```

Node 22.13 or later is required for TypeScript stripping. Runtime code and tests
use Node builtins only; `tsc` requires TypeScript. No database, browser,
credentials or Kitchen AI checkout is needed for this probe.

## What exists

### Shared evidence engine

- Outcomes are `pass`, `fail` and `unresolved`; unknown analysis does not become
  a counterexample.
- Registered package rules own semantics. The base owns exact claim identity,
  argument traversal, alternative routes, conjunctive premises, challenge
  history, replay causality and current applicability.
- Dependencies carry a kind, stable name, fingerprint and monotonic revision.
  Changing a fingerprint invalidates only observations that captured it;
  returning to old bytes does not revive them.
- State export/import checks counters, references, challenges, resolutions,
  check contracts and dependencies before reconstruction.
- Storage wraps state in a package-bound, SHA-256-checked envelope and writes by
  temporary file plus atomic rename.
- Same-violation history shrinking retains the law, case and reached checkpoint.

### Real Endpoints vertical

The production-shaped claim is `endpoints/safe-skip-refetch@1`. Its check invokes
`probes/endpoints/integrated-todo/effect-verdict.mjs#canSkipRefetch`, which was
extracted from `sql-effects.mjs` and re-exported there for existing callers.

The check records support only when the query and mutation share a build
artifact, authority has a baseline, no optimistic or repair work remains, both
effect bounds are complete, and the query read set is disjoint from the mutation
write set. Overlap and absent authority fail. Incomplete effects and different
artifacts remain unresolved.

The package reports evidence; it does not enable an optimization or suppress a
refresh. Consumer fallback policy remains separate.

### Agent and editor interfaces

- `cli.mjs` accepts inline JSON, `@FILE` and stdin, persists through the shared
  service and reports top-level failures with nonzero status.
- `lsp-server.mjs` publishes claim diagnostics and exposes arbitrary shared
  operations through `evidence.request`. `Content-Length` framed messages are
  processed serially.
- `mcp-server.mjs` advertises six evidence tools over newline-delimited JSON-RPC.
  Malformed input returns a protocol error without poisoning the request queue.
- `service.mjs` serializes all operations in one process so every transport gets
  the same persistence and assessment behavior.

## Oracle Guide decisions to preserve

- A check contract states its law, domain, reference, trusted boundary,
  production path, checkpoint, observed data, omissions, reach witness, fault
  controls and exact replay method.
- Operational or reach failures record no observation. Application failure may
  still be the expected subject of a passing check.
- A bounded oracle pass is evidence for its declared domain, not universal proof
  and not proof that the checker or analyzer is sound.
- Known failures are captured by the runner. Agents cannot submit only green
  findings.
- Missing support, an unresolved observation and a counterexample are distinct.
- Repair evidence must be an applicable same-law, same-case replay invoked after
  the failure. Delivery order cannot manufacture replay causality.
- Applicability includes code, data, configuration, environment, method and
  external inputs, not code alone.
- Rule assessment and refresh policy are separate layers. The evidence package
  never silently decides an application action.

## Verification

The current suite has 21 passing tests:

- 14 kernel tests retain the generated forward-chaining, lifecycle,
  possible-worlds, explanation, repair-lifetime and delivery-order oracles and
  add a dependency-revision regression.
- Seven rebuild tests cover three-valued checks and reach failure, selective
  dependency invalidation, verified reload/tamper rejection, the real Endpoints
  verdict, unresolved effects, violation-preserving shrinking and shared
  CLI/LSP/MCP semantics.
- Eight fault controls mutate temporary copies and require the intended unchanged
  oracle to fail at an assertion: conjunct loss, circular support, epoch reuse,
  failure loss, route erasure, expired resolution reuse, delivery-order replay
  and dependency-revision reuse.

`verify-handoff.mjs` separately verifies frozen v1/v2 grammar artifacts, audit
snapshots, portable sources, recombination sources and the historical comment
archive against the canonical Field Log.

## Limits and next work

1. Broaden the independent evidence around the SQL effect analyzer. The current
   exhaustive oracle covers the small set-intersection decision, not analyzer
   completeness or wider PostgreSQL behavior. Some wider Endpoints probes need
   standalone parser/schema dependencies that are not packaged here.
2. Decide and test the consumer contract: unsupported or contradicted skip
   claims should lead to an explicit fallback, but the evidence engine should
   not own that policy.
3. Scope query/mutation analysis dependency names by endpoint or artifact when
   multiple endpoint packages must coexist. The current names are shared.
4. Make check execution and dependency-context updates transactionally explicit.
   `runCheck()` updates the in-memory dependency context before a reach failure;
   the service does not persist that state when the request fails.
5. Add multi-process coordination or a single daemon boundary. Atomic rename
   prevents partial files, but two independent writers can still lose updates.
6. Package real editor configuration and MCP registration, improve document
   ranges/schema validation, and decide how the interface is distributed.
7. Add signatures/authentication and hostile-plugin isolation before treating a
   store controlled by another actor as trusted evidence.

Other deferred work includes automatic dependency discovery, semantic claim
equivalence, scope subsumption, cross-version case mapping, alternate-strategy
repair, source-inspection admission, speculative challenges, graph performance,
policy levels and remote execution.

## Files

| Files                                                                   | Role                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `protocol.ts`, `kernel.ts`                                              | Shared contracts and evidence mechanics                 |
| `storage.mjs`, `oracle-tools.mjs`                                       | Verified persistence and history reduction              |
| `endpoints-real.mjs`, `../endpoints/integrated-todo/effect-verdict.mjs` | Real claim/check package and production decision helper |
| `service.mjs`                                                           | Serialized operation layer                              |
| `cli.mjs`, `lsp-server.mjs`, `mcp-server.mjs`                           | Agent/editor transports                                 |
| `kernel.test.mjs`, `rebuild.test.mjs`, `fault-controls.mjs`             | Oracles, integration tests and mutations                |
| `DESIGN.md`, `workflows/`                                               | Bounded check package and authoring workflows           |
| `verify-handoff.mjs`                                                    | Frozen-source and Field Log verification                |

## Complete source trail

The canonical Field Log is
`probes/endpoints/design/field-trip-optimistic-coherence/field_log.md` with its
JSONL source beside it. The grammar, audits, readouts and portable-source
manifest are under `probes/endpoints/design/evidence-guarantees/`. Historical
absolute paths and localhost URLs are provenance only.

The chronological archive at
`field-trip-optimistic-coherence/sources/user-comments-through-evidence-repair.json`
preserves the prior user-request record and is checked by
`verify-handoff.mjs`. Append to the canonical Field Log only through the Field
Lab writer; do not hand-edit its JSONL or rendered Markdown.
