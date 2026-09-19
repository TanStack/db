# TanStack Trust: Finding and Engineering Hardness

## What this tells us

TanStack Trust is both a **protocol workshop** and a **protocol runtime**. It
starts with a future condition someone values, then works backward to a
guarantee that can be created and maintained now.

Some hardness already exists. PostgreSQL refusing a duplicate key is native
hardness; an editor warning only predicts that future refusal. Protocols can
also create new hardness. Requiring a query to pass a production-backed check
before deployment makes an earlier transition depend on evidence in a way it
did not before.

LLMs make the search step much cheaper. They can propose many candidate
protocols, tests, proof routes and combinations of cloud operations. They should
not judge their own candidates. Trust instead places fast, independently
grounded verifiers in the loop and returns concrete counterexamples for the next
iteration.

```text
valued future → candidate protocol → verifier → counterexample → revision
                         │
                         └─ passing candidate → admission → enacted protocol
```

A passing candidate establishes only the properties its verifiers actually
tested. A separate authority admits the exact protocol version and chooses
among incomparable passing candidates.

## What it changes

**Protocol design becomes target-first.** A guarantee target names the future
event, affected subjects, value owner, required predicates, preferences and
unacceptable actions. Hard requirements remain separate from measurements such
as cost or time-to-evidence, so “great” does not become an opaque model score.

**Verification becomes a portfolio.** Visible inner-loop verifiers provide fast
counterexamples. Independently maintained admission verifiers test whether the
generator merely fit those examples. Runtime verifiers watch for expiry and
drift. Shared assumptions, coverage, applicability, calibration and statistical
limits remain visible; several checks are not presumed independent.

**Hardness becomes extensible.** Projects can define private targets,
primitives and protocols. Domain packages can publish reusable laws and
verifiers. Existing tests, oracles, constraints, performance gates, feature
flags, canaries and rollback remain reusable primitives. Providers can expose
bounded cloud primitives such as production
sampling, replay, shadow traffic, fault injection, staged rollout and
attestation. Registry publication, package installation, semantic admission and
production capability are four different transitions.

**Accepted designs become concrete TypeScript.** A representative protocol is
small at the authoring layer:

```ts
defineProtocol({
  target: productionReadyQuery,
  harden: sequence(
    run(neon.productionSample, { executions: 30 }),
    verify(latency.p99BelowTarget),
    gate(deploy.release),
  ),
  maintain: reverify({ when: sqlOrEnvironmentChanges }),
  soften: { fallback: disableQuery, exception: releaseException },
})
```

Provider authors define typed capabilities, plans, result schemas, evidence and
cleanup. The kernel lowers both layers into propositions, evidence,
qualification, hard points and authority. LSP, MCP, CLI and Devtools project the
same operations and structured counterexamples. Bead-style todos let agents
claim and continue searches without turning work state into evidence.

## Concrete case

A team requires every new query to execute successfully and remain below one
second p99 for seven days. An agent searches a palette containing PostgreSQL
analysis, an Endpoints model oracle, Neon production sampling, a feature flag
and a deployment gate. Fast verifiers reject unsafe candidates with replayable
counterexamples. A passing design receives clean admission verification, then
an owner admits it. Deployment consumes a decision token for the exact query,
build and evidence. Expiry opens new evidence work or another protocol search;
an authorized, expiring exception preserves a deliberate soft path.

## What it does not tell us

Iteration does not guarantee convergence or general quality. Trust cannot
decide what people should value, whether a verifier captures that value, or
whether an institution deserves authority. Fast machine feedback may favor
narrow proxies and intensify verifier overfitting. Local success is not industry
range evidence.

The executable implementation remains a finite Endpoints evidence kernel and
shared local interfaces. Protocol search, target APIs, verifier portfolios,
Neon cloud operations, registry behavior, Devtools and deployment-token
enforcement are proposed. No independent second domain has tested the design.

Support: [Model](./MODEL.md), [Evidence](./EVIDENCE.md), and
[Process](./PROCESS.md).
