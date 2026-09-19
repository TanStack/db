# TanStack Trust: In Search of Hardness

## What this tells us

Hardness is a dependable point across time: something stable enough that people
or agents can coordinate around it. PostgreSQL refusing a write that violates a
constraint is hard in this sense. A test result, production measurement or
written requirement may help create such a point, but none is automatically
hard on its own.

Software teams currently assemble guarantees from scattered facts by hand.
They decide what must be true, gather evidence, check that it still applies,
connect it to a release decision and repair the guarantee when the world
changes. TanStack Trust is an architecture for safely automating that work
across product requirements, code, builds, deployments and production.

The architecture separates three things:

1. A **grounding source** resists wishful thinking: a database, compiler,
   reference model, production environment or authorized owner.
2. A **protocol** gives that source stable domain meaning, exposes its limits
   and defines how other packages can build on it.
3. A **hard point** connects current, qualified grounding to a concrete
   coordination purpose and a boundary that records, commits, accepts or
   refuses an action.

This distinction prevents an evidence record from masquerading as a guarantee.
A CI report that says `block` while deployment can ignore it is only the
appearance of hardness. A real deployment hard point makes the release depend
on a current decision for the exact build.

## What it changes

**Trust should model reliance, not just findings.** Every hard point names what
people may rely on, its grounding and authority, when it applies, what consumes
it and what would invalidate it. Native database refusals, Endpoints
derivations, model-based oracle campaigns, production observations and product
requirements remain distinct paths rather than levels in a trust score.

**Hardness needs complementary softness.** Unknown states, conservative
fallbacks, challenges, revisions and authorized, expiring exceptions let the
protocol adapt without rewriting history. Hardness can be insufficient,
excessive or placed at the wrong moment; more refusal and more permanence are
not automatically better.

**Ordering can be part of the guarantee.** Evidence is planned, gathered,
committed and qualified before Trust may issue a decision token. A downstream
boundary consumes that exact token before proceeding. This turns a check from
advice into a dependable transition while preserving an explicit exception
path.

**Agents and humans use one operation model.** LSP can identify a requirement
while an agent edits code; MCP can explain it, traverse related subjects, claim
a todo and gather evidence; CLI can evaluate a pinned CI snapshot; Devtools can
show the same claims, evidence, hard points, limits and history. Packages and
agents may propose new sources or proof routes, but a separate authority admits
them. Local declarations may tighten but cannot weaken higher-authority
requirements.

## Concrete cases

- **Endpoints:** the compiler can derive whether a mutation may skip a refetch
  from SQL effects, artifact identity and collection authority. The current
  prototype records this certificate but does not enact refresh policy. A
  future runtime hard point would refuse `skip` without current support and use
  authoritative refetch as the conservative path.
- **Neon:** a provider could run a new query in production under a bounded
  sampling plan and return latency evidence. A team requirement such as “p99
  below one second” becomes hard only when a release boundary requires adequate,
  current evidence. Repetition alone does not establish statistical confidence
  without explicit sampling, dependence, stopping, calibration and uncertainty
  semantics. Expiry reopens the evidence work.
- **Product requirements:** an authorized checkout requirement can link to a
  feature, endpoint, query, build and deployment, with both acceptance-oracle
  and production-funnel evidence. Editing code or closing a todo does not
  establish it; the actual acceptance or rollout boundary must enforce it.

## What it does not tell us

Trust cannot decide whether a requirement is legitimate, a model captures what
users care about, an analyzer is sound or telemetry is representative. Its
typed representation may make contested judgments look cleaner than they are.
The executable evidence covers a finite Endpoints kernel and shared local
interfaces; PostgreSQL packaging, Neon execution, product integration and an
unbypassable deployment token are proposed. No independent second domain has
tested the architecture's range.

Support: [Model](./MODEL.md), [Evidence](./EVIDENCE.md), and
[Process](./PROCESS.md).
