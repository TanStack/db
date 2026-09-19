# Reader Assay v0.3 — reader 03

## Execution boundary

Fresh sibling-hidden model context. The reader saw only the frozen RFC, the
target-reader description, and the neutral eight-question prompt recorded in
the Field Log. It inspected no other artifact.

## Raw response

## 1. Claim and proposal

The RFC proposes TanStack Trust as an internal Endpoints architecture for maintaining bounded software guarantees. Domain packages define claims and valid evidence; Trust records and assesses evidence, applicability, freshness, contradictions, and repair history; consumer policy alone decides action.

It explicitly does not claim universal proof, checker soundness, safe deployment, or agent self-authorization.

## 2. Recovered system map

The main flow is:

`domain meaning → evidence graph/lifecycle → consumer decision`

CLI, LSP, MCP, and workflows merely carry operations across that boundary.

Within the graph, premises in one argument are jointly required, while multiple arguments are alternative support routes. Evidence is captured as observations, assessed for reach and applicability, invalidated through dependency revisions, challenged by contradictions, and restored only through causally linked replay. Structured explanation then exposes completed routes and remaining gaps.

## 3. Present versus incomplete

Present in the local prototype:

- A finite kernel with claims, observations, rules, arguments, and challenges.
- Selective freshness using captured dependency revisions.
- Exact-case challenge/replay linkage and append-only repair history.
- Verified local file storage.
- One Endpoints safe-skip check and contract.
- One shared service exposed through CLI, LSP, and MCP.
- Twenty-one local tests and eight mutation controls.

Still proposed or absent:

- Stable package, extension, and explanation contracts.
- Generic rule/check registration, observation ingestion, argument proposal, package discovery, and task projection.
- Admission and revocation governance.
- Formal-tool and rubric integration.
- Packaged editor/agent deployment, authentication, signatures, and coordinated writers.

Unresolved:

- Applicability ownership and whether its result is Boolean or three-valued.
- Semantic identity across versions, richer repair, operational-failure storage, distributed clocks, and storage coordination.

Intentionally unselected:

- Severity, permission, fallback, confidence aggregation, evidence ranking, and investigation priority.

Unmeasured:

- Generality beyond Endpoints, agent usability, human effort reduction, checker effectiveness, scale, and deployment outcomes.

## 4. Confusion or weak persuasion

- Section 3 calls applicability one of “six candidate primitives,” but Section 4 leaves its ownership and result shape unresolved. I could not tell whether it is ultimately a stored object, a domain operation, or an assessment result.
- Section 7 says the workflows are “implemented as documentation.” That stretches the RFC’s earlier definition of **Implemented**, which sounded like executable prototype functionality.
- The architecture depends heavily on admitted rules and checkers, yet admission governance is absent. The RFC acknowledges this clearly, but it leaves the present kernel’s practical authority quite conditional.
- Section 10 says Endpoints is constructive rather than independent evidence of generality, while no second implementation is planned. The architectural range therefore remains plausible but largely asserted.

## 5. Three details retained most clearly

1. Evidence support and permission to act are separate decisions.
2. Evidence verdict, production-path reach, operational execution failure, and consumer action are four distinct axes.
3. A contradiction is repaired only by a fresh, applicable, causally later replay of the same law and case; history is never erased.

## 6. What the draft now enables

I can now explain why Trust is an evidence-history layer rather than a trust score, trace an unresolved claim through alternative and joint routes, identify what would make evidence expire, and outline the exact repair obligation after a failure. I could also attempt the proposed Endpoints build sequence or review a domain package for missing scope, dependencies, reach controls, and omissions.

## 7. Generic or predictable portions

The shared-service/multiple-adapter pattern, atomic-file persistence caveats, “agents must not approve themselves,” formal-methods disclaimers, and roadmap items for authentication, scale, packaging, and evaluation are broadly familiar.

The more architecture-specific material is the AND/OR route structure, separation of reach from findings, revision history that prevents byte-identical evidence revival, and exact causal replay semantics.

## 8. Possibly unsupported inferences

- I inferred that each domain package will eventually have a machine-readable manifest, although its shape is not chosen.
- I inferred that consumer policy may run at runtime; the RFC only assigns authority, not necessarily execution location.
- I inferred dependency revisions are maintained per named dependency, though the exact counter model is not fully specified.
- I inferred unresolved check outcomes do not open challenges; the Endpoints table suggests this, but I did not see it stated as a universal rule.
- I inferred the same rule could support several claims, which the graph model permits but does not explicitly require.
