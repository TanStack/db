# TanStack Trust API Design Grammar v5

## Product shape

TanStack Trust is a domain-extensible system for turning claims about software
into inspectable obligations, gathering the evidence those obligations require,
and explaining what remains before a consumer can rely on the result. Its first
and only implementation is part of TanStack DB Endpoints.

Trust should feel like linting for agents. Packages and projects define rules in
ordinary TypeScript; configuration selects the active rules; source diagnostics
point to structured explanations and legal next actions; CI receives a stable
report and exit decision. Unlike a conventional linter, a clean report is not
itself evidence. Trust retains the claim, support routes, method, captured input,
observation, applicability, authority, counterexample, and consumer decision
that justify or limit each result.

## One system, three layers

v5 selects the three v4 API forms as layers:

1. **Authoring:** `defineTrustModule`, `defineSourceProvider`, `defineRule`, and
   `TrustRuleTester` give domain and project authors an idiomatic linter-style
   extension surface.
2. **Service:** `trust.query.*` contains side-effect-free snapshot reads;
   `trust.command.*` contains capability-checked, idempotent state changes with
   typed receipts.
3. **Protocol:** every service operation has one versioned input, output, and
   error schema. TypeScript, CLI, LSP, MCP, CI, and Devtools project those
   schemas without creating adapter-specific meanings.

The authoring layer lowers into the service model. The protocol layer serializes
the same operations. None of the layers is a second source of truth.

## The agent loop

A diagnostic identifies one active condition and includes stable references,
its immediate cause, affected claim uses, known limits, the authority boundary,
and currently legal actions. An agent can ask for a deeper explanation, open or
claim the associated work, obtain a version-bound evidence plan, execute or
submit the method's complete result, and request a fresh report. Work closure,
an applied edit, and successful command delivery do not clear the condition;
only the recomputed evidence state can do that.

Trust records distinct outcomes for missing evidence, inconclusive observation,
unreachable observation point, inapplicable or expired evidence, open
counterexample, invalid configuration, unadmitted semantics, unresolved
identity, method failure, and cleanup/resource failure. Every interface uses
these codes and the same structured recovery actions.

## ESLint transfers incorporated in v5

- content-addressed module manifests with capability maps, compatibility,
  deprecation, and replacement metadata;
- deterministic named configuration layers plus `resolve` and `inspect`;
- runtime-validated rule options and versioned message/action catalogs;
- deterministic rule lowering and atomic collision-checked registration;
- a canonical `TrustRuleTester` for semantic, diagnostic, action, and hostile
  fixtures;
- source providers that discover domain subjects, ingest editor overlays, and
  remap diagnostics/actions to versioned physical source;
- a strict diagnose → preview → authorize → apply → re-evaluate sequence;
- stable report DTOs, formatters, and CLI exit classes;
- explicit override list/create/renew/revoke/expire/prune/inspect operations;
- inspectable cache, invalidation, timing, cost, and concurrency metadata; and
- a deliberately small task-oriented MCP facade.

ESLint severity, suppression, cache hits, installed plugin code, successful
autofix, and a current clean report do not become Trust evidence or authority.

## Six product workflows

1. An agent receives an LSP diagnostic, follows its stable condition reference
   through MCP, gathers and submits evidence, and confirms the recomputed source
   state is clean.
2. A scheduled agent queries ready work caused by expired evidence, claims it
   with a fenced lease, gathers replacement evidence, submits it, and creates a
   PR for any resulting repository changes.
3. CI calls `trust ci --profile ci`; exit `0` means policy allows the frozen
   snapshot, `1` means policy blocks it, and `2` means Trust could not produce a
   valid decision because configuration or operation failed.
4. Devtools reads one snapshot, follows its cursor, and lets a human browse
   claims, evidence, conditions, work, admissions, overrides, and explanations.
5. An authorized operator creates a narrow, expiring endpoint deployment
   override. The blocking action changes; the condition and evidence history
   remain visible. Deployment uses a decision token and revalidates expiry.
6. A project compares its current configuration and policy with a sealed
   candidate bundle for a stricter global level. The preview reports newly
   active obligations, reusable evidence, missing evidence, and hypothetical
   work without mutating the live store.

## Scope and remaining uncertainty

v5 is a normative design candidate, not an implemented API. It repairs the v4
model and selects enough API shape for usability simulation. The Endpoints
prototype still lacks most of this surface. The exact persistence engine,
remote execution, signatures, hostile-code sandbox, distributed transport,
probabilistic calibration program, and second domain remain outside the tested
range. Fresh-agent simulations can expose usability and missing-contract
problems; they cannot prove semantic correctness or implementation safety.
