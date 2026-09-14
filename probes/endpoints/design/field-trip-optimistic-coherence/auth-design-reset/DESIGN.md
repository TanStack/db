# Code-first guarantees and linting

> **Scope narrowed after this draft.** See [Endpoints v1 scope](../V1-SCOPE.md): raw SQL analysis and explicit additional refresh requirements. Function-call and auth-library analysis are future work.

Draft, 2026-09-14. This restarts the design under Kyle's corrected boundary. It supersedes the compiler-generated auth/guard split as a proposed direction. Earlier source observations and witnesses remain evidence, but their proposed architecture is not inherited.

## Fixed parameters

Application code owns authentication, authorization, effects, and execution order. The compiler must not insert, remove, lift, memoize, or split auth calls. It must not infer an auth policy from a function name or from an endpoint's data tables.

The compiler may inspect ordinary functions and extract evidence for a specific optimization. A linter explains missing evidence and suggests explicit source changes an agent can review and test. Suggestions are not compiler transformations, and suppressing a lint is not proof.

Keep the earlier requirements: all affected retained collections matter; optimistic recipients and missing baselines need authority; schema inspection happens only at build time; no added PostgreSQL infrastructure; external freshness belongs to polling/events/sync. Server code and evidence containing server details stay outside client bundles. No new public options are proposed here.

The earlier blanket requirement to rerun every query's auth check is withdrawn. Whether auth runs at a request boundary, inside each query, or elsewhere is an application decision. The system must not invent a fresh-permission guarantee for cached data or change the configured session policy.

## The unit of analysis is ordinary code

This remains one function, executed as written whenever it is invoked:

```ts
async function listRecipes(req) {
  await requireUser(req)
  return db.select().from(recipes)
}
```

If analysis cannot resolve `requireUser`, it may still know that the later SQL reads `recipes`. It does not know the complete effects or dependencies of the whole function. The known suffix is useful diagnostic evidence, not permission to treat the function as a pure recipes read.

Here is a different function an application author could write:

```ts
async function readRecipesForOwner(ownerId: string) {
  return db.select().from(recipes).where(eq(recipes.ownerId, ownerId))
}
```

Within supported SQL/schema/driver assumptions, this may provide a complete read footprint and a result dependency on `ownerId`. It does not authenticate `ownerId`. The actual caller and request path still determine authority. Extracting or renaming this helper does not itself prove that skipping its enclosing endpoint is safe.

An agent may suggest moving session work into an explicit application request handler, or changing a query that performs writes. Such a proposal must show the before/after source, permission scope, error behavior, and changed timing. Moving auth is never an automatic lint fix. We have not chosen an application refactor or a request-context API in this draft.

## Separate facts from permission to optimize

Maintain source-traced summaries rather than one `safe` boolean. Read knowledge, write knowledge, non-database dependencies, and completion knowledge can fail independently. A known-empty write set differs from an unknown write set.

| Extracted fact | What it can support | What it does not establish |
|---|---|---|
| Complete mutation may-write footprint | Match potentially affected payload dependencies | Which branch executed, transaction atomicity, permission |
| Complete query read footprint | Determine potential data overlap | Purity or permission to omit the handler |
| Complete absence of observable effects beyond reads | Consider whole-result reuse with the other requirements | Stable result when inputs, context, time or external state change |
| Input/context values used by the result | Bind cached results to those values | Authenticity of caller-supplied values |
| Awaited completion of covered writes | Order subsequent reads after those writes | Closure of detached tasks or arbitrary library callbacks |
| Unknown call or unsupported schema behavior | Explain why a particular proof is unavailable | Empty effects or permission to guess |

Existing relation-set analysis is a starting point, not proof of all these claims. In particular, code that can throw based on permission, access the clock, or consult external state cannot be called dispensable merely because its SQL reads are disjoint from a mutation.

Each runtime optimization must have a named obligation. For recipient pruning, establish that the covered mutation cannot change the cached endpoint result and that skipping the invocation is permitted under the actual application contract. For response deduplication after a handler has run, the obligation differs: its code and checks have already executed. Do not collapse these into the same decision.

When evidence is missing, decline that optimization and use ordinary execution. If ordinary execution itself cannot meet a claimed cross-collection freshness/completion law, report the unsupported guarantee separately. “Full refetch” is an execution fallback, not a proof that arbitrary writing queries converge.

## Diagnostics should explain a concrete obstruction

Proposed diagnostic content—not an implemented CLI or API:

```text
Cannot prove this endpoint invocation is safe to omit.

listRecipes → requireUser → auth.api.getSession

Known: the payload SELECT reads recipes.
Unknown: complete effects and result/control dependencies of getSession.
Consequence: whole-handler reuse is unavailable.

Inspect the helper/configuration, or make a source-level change that
exposes a provable boundary. Merely adding an annotation is insufficient.
```

A distinct diagnostic applies when a write is actually established:

```text
This query can write during refresh.

Source: the session-renewal call reached from requireUser.
Consequence: refreshing all collections once does not establish that
all snapshots include every write made by the refresh itself.
```

The first reports incomplete analysis; the second reports a demonstrated behavior. Do not claim the second merely because a library is unknown. Each diagnostic should carry the call path, source spans, affected optimization or guarantee, and evidence needed to discharge it. Ordinary unsupported code remains usable; unresolved support for a stronger guarantee must be explicit.

## Oracle-led first slice

Start with the analysis/diagnostic boundary before adding execution optimizations:

1. Extend the existing generated endpoint oracle with ordinary functions that vary inline/helper calls, pure reads, session-like writes, permission rejection, context changes, and detached work. Preserve some minimal witnesses as replay cases.
2. Assert source-traced classifications: unknown calls cannot become empty effects; known payload tables cannot be mistaken for a complete handler footprint; permission is never inferred from a caller's ID.
3. Execute the real generated application code through compiled and ordinary paths. Compare allowed results, errors, and observable writes. Use an independent PGlite model for final payload values. Assertions must detect inserted, moved, duplicated, or omitted application checks—not model a guard stage that the source never defined.
4. Vary inline responses, explicit refetch, retries and overlap repair. Include the prior late-writing-query witness; classify unsupported completion guarantees honestly instead of declaring success because every query was selected.
5. Check production client artifacts with synthetic server-only sentinels. Demonstrate that deliberately dropping an unknown effect or moving an auth call makes the expanded oracle fail.

No fixes or new oracle campaign ran in this design pass. The next implementation target proposed here is richer proof diagnostics over the existing analyzer, tested by the generated oracle. Whole-handler skip rules and any application refactor still need a concrete contract and evidence before implementation.

## Open design decisions

- How does the integration expose application-owned request context and its lifetime without making authorization claims for it?
- What exact observable contract permits whole-handler reuse, including denial, retries and context changes?
- Which callback/library behaviors can be proven under versioned build assumptions, and which stay unknown?
- How should a diagnostic distinguish lost optimization from an unsupported endpoint-system guarantee?

These are the remaining design work. Compiler auth rewriting is not an option within the corrected scope.
