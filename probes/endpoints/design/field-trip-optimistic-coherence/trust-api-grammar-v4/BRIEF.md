# TanStack Trust API Design Grammar v4

## What this tells us

TanStack Trust should feel like **linting for agents** without reducing trust to
a lint result.

The familiar outer model is right: libraries ship rule packages; a project
enables and configures the rules it wants; project teams can write local rules;
editors show source diagnostics; CI gets machine-readable output and a stable
exit decision. This gives Trust an idiomatic TypeScript extension model rather
than a central catalog that TanStack must author forever.

Internally, however, a rule cannot be one callback returning `error`, `warning`,
or `off`. Trust must lower an authored rule into independently identifiable
claims, alternate and joint support routes, evidence methods, applicability,
and presentation. That extra structure lets agents discover what evidence is
missing, run or propose an appropriate method, submit its full result, and see
whether the original obligation is now satisfied.

The other decisive structure is a policy-free condition. Missing evidence, an
expired observation, an open counterexample, an unreachable observation point,
an unadmitted evaluator, and invalid project configuration each exist once as
structured state. LSP, MCP, CLI, Devtools, CI, and work queues render or select
that state differently without inventing their own meanings.

## What it changes

- **Rules become ordinary code modules.** `defineTrustModule` packages rules and
  checks; `defineRule` gives authors one coherent linter-style unit; registration
  preserves the claim, route, method, and admission identities underneath it.
- **Project configuration becomes evidence-relevant history.** Installed,
  enabled, configured, admitted, and permitted-to-deploy are separate states.
  Changing `trust.config.ts` creates a new configuration revision; it never
  rewrites observations produced under the old one.
- **Checking and reporting split.** Running a check is a transactional command
  that may append observations. Reporting, explanation, policy comparison, and
  CI evaluation are side-effect-free queries over one coherent snapshot.
- **Model judges become evidence methods.** A Jev-like evaluator can return a
  typed probability distribution, but Trust records its evaluator and schema
  version, input, calibration basis, coverage, omissions, and reach. Type-safe
  output proves shape, not correctness or authority.
- **Agent work remains coordination.** Conditions and work cases leave useful
  traces for later agents, but claiming or closing work never supports a claim.
  Agents may propose rules, checks, proofs, and repairs but cannot admit their
  own trust roots. An open counterexample survives until an authorized,
  applicable, causally later repair addresses the same law and case.
- **Different changes keep different clocks.** Immutable history, evidence
  freshness, applicability, configuration revisions, work leases, and policy
  expiry cannot be reduced to one stale/current flag.
- **Lint suppressions become explicit protocol acts.** A project-wide `off`
  changes the configured obligation set. A temporary endpoint exception changes
  consumer action through a scoped, authorized, expiring override. Neither
  deletes the condition or manufactures favorable evidence.

## What it does not tell us

This run does not select among the linter-first facade, resource-oriented
query/command service, and schema-first operation protocol. They may be layers:
friendly authoring over a precise service over a shared wire schema.

It also leaves open the exact config syntax, package loader and sandbox,
project-local admission authority, probabilistic threshold boundary,
suppression syntax, persistence model, and polling-versus-streaming transport.
Endpoints remains the only implementation. Linter ecosystems constrain the
extension model but do not demonstrate that Trust works in another domain.

## Concrete cases

```ts
export default defineTrustConfig({
  modules: [endpointsTrust, projectTrust],
  rules: {
    'endpoints/safe-skip-refetch': ['error', { level: 'standard' }],
    'project/orders-preserve-ledger': 'warn',
    'endpoints/experimental-rule': 'off',
  },
})
```

An editor diagnostic for `safe-skip-refetch` can lead an agent to the exact
missing evidence through MCP. A daily agent can query expired-evidence work,
claim it, run the admitted method, and submit a complete observation. CI can
evaluate the same resulting condition under its profile. If one endpoint must
ship, an authorized expiring override changes deployment action while Devtools
continues to show the unresolved evidence condition.
