# Evidence base prototype

A local argument checker with domain-owned rules. The first example package
contains three Endpoints claims: complete write bounds, complete read bounds,
and disjointness of those bounds. It uses fixture observations, not the production
compiler or a PostgreSQL instance. It does not decide whether to enable an
optimization.

This implements the [v2 repair contract](../endpoints/design/evidence-guarantees/base-grammar/revisions/v2/README.md)
following the original exploratory grammar and its two audits. Original frozen
designs and audit witnesses remain available; they describe the pre-repair code.
See the [handoff](HANDOFF.md) for decisions, open work and cross-machine setup.

## Run

Node 22.13 or later with TypeScript stripping; no runtime dependencies:

```sh
node --experimental-strip-types probes/evidence-base/demo.mjs
node --experimental-strip-types --test probes/evidence-base/kernel.test.mjs
node probes/evidence-base/fault-controls.mjs
tsc --project probes/evidence-base/tsconfig.json
```

The demo goes from missing premises to supported disjointness, then records a
counterexample to the write bound. The downstream argument becomes unresolved
with the counterexample in its explanation. It does not report a counterexample
to disjointness itself: its supporting premise failed.

## Boundary

`EvidenceBase` supplies registered-rule lookup, argument traversal, exact claim
identity, per-use freshness, immutable observation snapshots, direct failure
capture, explicit replay resolution and shared missing-premise reports.

A package supplies versioned laws, parameterized claims, admission predicates,
inference premises and side conditions. Its registered functions are trusted
semantic code. Passing those functions proves that the declared procedure
accepted the argument; it does not prove the procedure sound.

`run()` records every returned observation and creates challenges for failures
before returning to the caller. A thrown operational error creates no evidence.
Application failure can still be the expected subject of a passing check.

`propose()` adds an argument, not support. `assess()` returns support, gaps and
reasons. Its nested `routes` preserve alternatives and each route's required
premises. Flat `gaps` are only a deduplicated inventory; top-level observation and
rule lists describe one successful route, while all assessed routes remain
available. Direct challenge IDs are structured data, including inside premise
assessments. No severity, admission policy, aggregate confidence score, automatic
proof search or application action is embedded in the base.

## Prototype limits

- Context uses one explicit epoch. Call `advanceContext()` for a relevant change;
  returning to old bytes cannot restore an earlier observation. This is deliberately
  coarse and invalidates all observations. Dependency-specific invalidation,
  expiry and automatic fingerprint capture are not implemented.
- Exact JSON identity supports identical shared claims, not logical equivalence
  or scope subsumption. Packages must version laws and state their conditions.
- Same-claim counterexamples remain open across context changes until replay.
  This may overblock. Automatic cross-version mapping, narrower-scope exclusions
  and different-strategy resolution are not implemented.
- Resolutions are append-only replay references, not permanent closed flags.
  Every assessment checks whether a resolution's replay is current. When it
  expires, a fresh original-case replay can append a new resolution without
  discarding the old history.
- Replay compares the full supplied case data and claim identity. Packages must
  preserve the actual law/comparator and case semantics; a label alone proves
  neither. A replay check must be invoked after the failure was recorded. Run
  delivery order and within-batch order do not prove that relation. The runner
  captures its invocation boundary; trusted callbacks must execute the check,
  not return cached earlier measurements. Same-run repair is not supported.
  Fresh passing evidence does not resolve a challenge implicitly.
- State is in memory. Checked-in storage, import verification, incremental
  evaluation and durable runner delivery remain work. Nothing here protects
  against a hostile agent controlling the process, plugins or filesystem.
- Proposed arguments may contain cycles; these cannot establish their own
  support. Alternative grounded routes still work. Traversal is suitable for
  small examples; it can repeat shared work on large graphs.
- Source-inspection/rubric admission and speculative challenges are described
  by the grammar/workflows but not implemented by this first kernel.
- Endpoints currently consumes the base only through the runnable example.
  Production refresh planning and the existing SQL analyzer are unchanged.

## Checks and what they establish

Thirteen tests pass. The argument oracle compares backward evaluation with a separate
forward-chaining model over 60 generated clause sets and all 16 initial fact sets
for each. The lifecycle oracle checks 80 histories of 35 operations against a
small state model. A possible-worlds oracle enumerates actual read/write subsets
for all 64 pairs of bounds over three table names. These are bounded mathematical
fixtures, not broad PostgreSQL coverage.

The repair adds a public-explanation oracle over 60 clause sets and eight future
fact sets each, a resolution-lifetime oracle over 40 histories of 45 generated
operations after the failing prefix, and 30 reordered-delivery cases plus both
same-batch orders. All three failed on the old kernel and pass on the repair.
The older lifecycle model now retains historical failures and resolution epochs
instead of forgetting failures permanently after a replay.

Seven actual mutations of temporary kernel copies are detected by the unchanged
oracles: accepting one conjunct, circular self-support, ignoring freshness, and
dropping failure reports, erasing route explanations, retaining expired repair
authority, and admitting replay by delivery order. Initially the freshness fault escaped because low bits
of the test RNG produced repeating operation patterns. The generator was repaired
and now also requires all 16 adjacent operation pairs. All four fault controls
then failed at the expected assertions; the unchanged kernel passed. The audit
later found the distinct resolution-lifetime and causal-replay gaps; the new
controls cover those findings.

The generator is a small deterministic local generator, not fast-check. It has
replay seeds but no automatic shrinking. A broader kernel oracle should add
shrinking and generated rule/claim schemas before making wider coverage claims.

## Authoring checks

Start with the packaged [workflows](workflows/README.md). They guide claim/check
design, evidence production and rule repair. They are draft authoring procedures,
not a certification of checks produced by following them.
