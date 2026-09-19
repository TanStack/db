# Design amendment: TanStack Trust incubates inside Endpoints

## User decision

TanStack Trust will remain part and parcel of TanStack DB Endpoints for the
foreseeable future. The implementation should keep the Trust mechanics and
Endpoints domain semantics separate enough to understand and maintain their
authority boundary, but it should not pay the product, packaging, or validation
cost of extracting Trust into an independent library before there is a concrete
reason to do so.

There is no near-term plan to build a second domain implementation. A second
domain is therefore not a milestone or prerequisite for Endpoints to receive
value from Trust. Independent range remains unmeasured and must stay labeled as
such.

## What changes in the approved RFC design

### Product shape

Before: TanStack Trust could read as a reusable base package with Endpoints as
one downstream consumer.

After: TanStack Trust is first an **internal architectural layer and evidence
contract inside Endpoints**. Endpoints owns the first complete product
experience. Reuse is a design direction and extraction option, not the current
distribution shape.

### Meaning of separation

The authority split remains unchanged:

- Endpoints domain code owns claims, rules, checks, applicability, and evidence
  adequacy.
- Trust code owns reusable evidence mechanics.
- Endpoints consumer/runtime policy owns permission and fallback.

For now these layers may share a repository, release, and product surface.
Separation means clean semantic ownership, modules, tests, and interfaces—not
independent packages or organizations.

### Meaning of Endpoints

Endpoints is no longer described merely as “one consumer” in the near-term
product story. It is the **incubation host** in which the Trust mechanics are
built, exercised, and changed against real domain needs.

Endpoints still cannot serve as independent range evidence because it helped
shape the grammar. This is an epistemic limit, not a demand to produce another
implementation now.

### Roadmap

The second-domain range test moves out of the active build sequence. The revised
sequence is:

1. Build the Endpoints trust workflow end to end: domain rules and checks,
   evidence mechanics, consumer policy, and agent-facing use.
2. Keep the internal domain/Trust/policy seams explicit in types, modules,
   explanation, tests, and status labels.
3. Add the missing authoring, registration, execution, argument, evidence,
   explanation, and repair operations needed by Endpoints agents.
4. Ship the CLI, LSP, and MCP experience around that Endpoints-owned system and
   evaluate real design, maintenance, and repair work.
5. Harden persistence, security, and scale according to Endpoints' actual
   deployment model.
6. Revisit extraction only when another use, release boundary, ownership need,
   or repeated friction makes the benefits concrete.

If extraction is later selected, independent-domain work can test the claimed
range then. Until that decision, the RFC must not imply that a second domain is
planned.

## Sections affected

- **Abstract and product opportunity:** state that Trust initially lives inside
  Endpoints and is not launching as a separate overarching product.
- **Authority map:** distinguish semantic separation from package/deployment
  separation.
- **Domain package:** use Endpoints as the current owner, not as an example of a
  stable generic plugin API.
- **Interfaces:** prioritize the operations Endpoints agents need; genericity is
  an internal contract discipline rather than a separate-package requirement.
- **Endpoints walkthrough:** describe Endpoints as incubation host while keeping
  every “not range evidence” qualification.
- **Decision register:** add extraction timing and distribution shape; preserve
  independent range as unmeasured.
- **Build sequence:** remove the near-term second-domain milestone and move
  extraction behind demonstrated need.

## What does not change

- Domain meaning remains outside the generic evidence mechanics.
- Consumer permission and fallback remain outside evidence assessment.
- Applicability, checker admission, identity, repair, and public operation gaps
  remain unresolved.
- Endpoints does not validate portability beyond its domain.
- Completeness remains the engineering goal for the Endpoints-hosted system.
- Publication and extraction remain separate future decisions.

## Validation consequence

The v0.1 readers' concern that generality is not established remains accurate,
but the product response is not to manufacture another implementation. The
revised RFC should ask whether the internal boundary makes Endpoints more
inspectable and maintainable while preserving an honest extraction option.

Because this changes the public product shape and roadmap, the v0.1 Reader Assay
and pending Semantic Drift Assay cannot approve the revised draft. The affected
draft passages and reader checks must be rerun after this amendment is approved.

