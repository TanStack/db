# Evidence and guarantees: fracture scan

Date: 2026-09-15. Instrument: `fracture-scan`. Status: complete, bounded.

## Frozen position

Claim under examination: Endpoints can recover guarantees supplied by more
restrictive full-stack frameworks by accepting agent-provided evidence about
ordinary application code.

Premises supplied by the user and RFC v0.18:

- Application code, including opaque helpers and external APIs, remains legal.
- The compiler does not insert authorization or change application behavior.
- Static analysis, including build-time PostgreSQL catalog inspection, does the
  work it can already do. An agent can inspect additional implementation paths,
  write checks, and manually certify a rule with supporting reasoning.
- Evidence has scope, dependencies, and an out-of-date state. Checks, tests,
  measurements, and manual certifications are distinct kinds of support.
- An optimization may rely on an established fact; unresolved facts must not
  silently become proofs. The current prototype's SQL-only analysis is a
  narrower interim contract, not a complete application-effects proof.
- We are examining query/mutation correctness and the proposed evidence system.
  External-write discovery, offline replication, and compiler-authored auth are
  outside the requested product scope.

Success rule: an agent's work can supply missing facts that justify a concrete
compiler/runtime behavior, without weakening the promised data contract or
requiring a new application language.

Protected insight: a human or agent can understand a specific library path that
a bounded compiler does not model. This is useful knowledge, not automatically
an impossible whole-program proof obligation.

Sources: user discussion through 2026-09-15; RFC v0.18, sections “The collection
contract hidden in the query”, “A stale token during the write”, and “The model
behind the example”. RFC source path is in the survey's source ledger.

## F1: facts about code do not supply a missing ordering relation

Route: internal extension plus a constructed admissible case.

1. An agent correctly establishes that `applyShoppingItems({apply: true})` may
   write the shopping table, while the false branch does not.
2. The endpoint awaits the HTTP response, then refreshes the shopping query.
3. The API returns after accepting a job; its database write happens later.
4. The refresh can finish before that write. The browser remains stale after
   the job completes even though the write-set certificate is true.

This constructed case changes one free condition: whether API completion means
the relevant database effects have completed. It preserves ordinary code,
correct effect evidence, an opaque API boundary, and the same refresh algorithm.
It concerns a mutation-caused write, not an unrelated external writer.

Exposed condition: the evidence needed to refresh after an API call includes a
completion boundary, not just a relation set. An acknowledged background job is
not a settled database mutation. No static certificate creates that ordering.

Defeated consequence: that a correct write footprint alone is enough to recover
the refresh guarantee across every legal API. This does not defeat evidence
about synchronous effects or authorize adding sync infrastructure.

Weakening evidence: a documented and implemented contract that the API commits
all relevant writes before its response, or an explicit existing job-completion
channel that the app awaits. If the product contract stops at acknowledged
completion, the example exposes a narrower contract rather than violating it.

## F2: the same fact supports one optimization but not another

Route: internal extension plus a constructed admissible case.

1. The agent correctly certifies that `previewShoppingItems` never writes PG.
2. The call also sends a billable request or publishes a message elsewhere.
3. “No PG writes” supports skipping PG query refresh for this call.
4. Reusing that fact as “no effects” to authorize mutation replay can duplicate
   the external action.

The only changed condition is the *consumer* of the same true fact. The call,
inputs, and source stay fixed. Ordinary APIs with non-PG effects are in scope.

Exposed condition: a claim needs an effect domain and a named use. “Certified”
cannot be a universal success bit shared by refresh, retry, caching, and auth
rules. The RFC already distinguishes rules; this is a design constraint exposed
by the test, not a newly discovered contradiction in the full RFC.

Preserved insight: scoped manual evidence can justify selective refresh even
when it cannot justify replay. Requiring total purity would discard valid wins.

Weakening evidence: a typed rule system that cannot supply a PG-write result to
a replay rule, or separate evidence covering the other effect domains.

## F3: a local fingerprint is not necessarily the certificate's dependency set

Route: constructed admissible case, conditional design risk.

An agent inspects library code and a configured hook. The unchanged call site
and package version remain fixed, but the hook configuration changes. A record
that fingerprints only the import and package falsely remains current.

Exposed condition: invalidation must cover the premises actually used in the
reasoning. This is *not* evidence that source invalidation is impossible; the
RFC explicitly requires dependencies. It tests whether the implementation will
record enough of them. Remote service behavior can require a deployed contract
revision or other external premise, not just a local source hash.

Weakening evidence: a recorded and checked hook/config/source dependency closure
or a narrower claim independent of those settings. This fracture is absent when
those dependencies are already captured correctly.

## Controls

- Outside rebuttal rejected: “a custom language would be easier to verify”. It
  changes the user's ergonomic goal and does not show internal failure.
- Near-counterexample rejected: a separate cron job changes PG after refresh.
  Discovering unrelated external writes was explicitly excluded.
- Another near miss rejected: a lying agent invents a certificate. That tests
  evidence admission/review quality, not whether correctly supported scoped
  evidence can add useful knowledge.
- Unhelpful universal argument rejected: undecidability of arbitrary JavaScript
  does not defeat manual inspection of a bounded call and its premises.

## Hidden question handed to the survey

For each source framework guarantee, what facts and runtime mechanisms jointly
establish it, and which missing fact could an agent supply so that *an existing
Endpoints mechanism* can establish the same bounded guarantee?

For candidate claims, retain effect domain, completion/failure boundary, scope,
consumer, support method, and change dependencies. Do not assume these are the
final evidence schema.

## Limits

These are logical constructions, not observed API failures or executed tests.
The scan may overemphasize API effects because the demo supplied them. The
survey must also examine identity, serialization, transactions, permissions,
optimism, and query composition. It must preserve cases needing only ordinary
compiler work and cases needing an absent runtime mechanism.
