# Stage 6 loss audit: v0.2 to v0.3, source 01

## Assay scope

- Assigned source coverage: `tanstack-trust-rfc-v0.2.md`, lines 1–256 inclusive.
- Frozen reduction coverage: full `tanstack-trust-rfc-v0.3.md` (930 lines).
- Frozen reduction SHA-256: `f3c246b7393beb8767931aa8465aecd49beb8d972cdfd82aefadef289f891904` (verified).
- Recovery criterion: supported consequential ideas in the assigned source segment that are absent or materially weakened in the frozen reduction.

## Recovered loss

### 1. Cheap code generation increases the volume and durability burden of guarantee work

**Exact source passage (v0.2, lines 64–68):**

> The important change in agentic software development is not merely that agents
> can generate whole features. It is that code production stops being the main
> constraint. More candidate implementations mean more claims to evaluate, more
> checks to run, more exceptions to understand, and more repairs whose effects
> have to survive beyond the session that made them.

**Exact v0.3 vanishing point:** v0.3 lines 64–74 replace this causal scaling argument with a list of judgments that remain human (`What behavior matters?`, applicability inputs, replay, and permission). Lines 108–110 then mark the amount of human work removed and resulting outcomes as unmeasured. The reduction retains that guarantee work remains difficult, and later sections retain evidence and repair history, but it no longer states that cheaper generation creates *more candidate implementations* and therefore multiplies claims, checks, exceptions, and cross-session repair obligations.

**Drop mechanism:** compression.

## Coverage result

One supported consequential idea was materially weakened in the assigned segment. No explicit rejection of that idea appears in v0.3.

## Limitations

This pass used only v0.2 lines 1–256 and the full frozen v0.3 reduction. It did not inspect v0.2 beyond line 256, source traces, concept grammars, the field log, sibling probe outputs, or validation artifacts. The result therefore makes no claim about losses originating outside the assigned source segment.
