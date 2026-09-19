# Final evaluation — TanStack Trust API design grammar v4

## Verdict

The v4 grammar is a strong architecture map, but it is not ready to freeze as
the normative TypeScript or agent API. Its main decomposition survives review:
domain semantics, evidence, conditions, work, authority, policy, and adapter
projections should remain distinct. The review found several missing transition
laws underneath that decomposition, especially condition lifetime, editor
context ingestion, component lowering, admission authority, causal repair,
operation identity, and snapshot/cursor semantics.

This was an audit-only round. The frozen candidate and prototype were not
changed. `fixed-now` below means “clear documentary correction recommended for
the next repair artifact,” not “already edited in v4.”

- Evaluated HEAD: `4ad19815b44be533ac10f90b62aca4377f5138d2`
- Raw sources: Fracture Scan 6, Hostile Assay 12, semantic/loss audit 47,
  TypeScript/linter audit 52, adversarial audit 83
- Total raw items: 200
- Central ledger: `evaluation-ledger.md`

## What the added instruments changed

The Fracture Scan isolated three especially important seams:

1. a disabled rule needs separate condition occurrence/history and current
   active-condition membership;
2. edited source needs a legal context-ingest or overlay transition before a
   side-effect-free LSP read can report current state;
3. `defineRule()` needs deterministic per-component lowering, identity,
   dependency closure, and invalidation.

The blind Hostile Assay added twelve attacks. Its strongest contributions were
independently anchored admission authority, immutable definition facts versus
later admission/supersession edges, pure or persisted executable hooks,
cross-version repair relations, run-bound complete submission, retry identity,
source freezing, and non-circular ablation. It overreached on monotonic
revisions and adapter implementation, and it mixed returned-batch integrity
with exhaustive method coverage; those claims were corrected in evaluation.

## Canonical confirmed clusters

The 200 rows reduce to these principal repair areas without erasing duplicate
evidence or test ideas:

- condition occurrence/history versus current active conditions;
- editor-buffer/context transition before pure diagnostic reads;
- deterministic component lowering and invalidation beneath `defineRule()`;
- principals, capabilities, and independently anchored admission authority;
- versioned adequacy, applicability, presentation, and identity relations;
- fresh causal replay and authorized cross-version challenge/repair mapping;
- activation/configuration versus consumer severity and action policy;
- invalid-configuration bootstrap state;
- run-bound complete batches, declared coverage, and omissions;
- idempotency, atomic state changes, clock/race, override, work-lease, and
  snapshot/cursor laws;
- agent-facing error, diagnostic, schema, and action contracts shared across
  TypeScript, LSP, MCP, CLI, and Devtools;
- reproducible source/artifact freezing and executable analytical controls.

## Reproduced prototype defects

Focused same-path probes confirmed that the current bounded prototype can:

- accept an unrelated producer's observation as a challenge resolution;
- commit a callback-asserted `reached: true` result without touching production;
- commit a favorable partial returned batch;
- mutate dependencies and the run counter after failed or unreached checks;
- leave omitted dependencies current;
- duplicate observations when the same command is retried;
- hide routes and gaps behind a contradicted assessment;
- forward mutating LSP commands without authority;
- lose a write under concurrent service writers (15 of 20 observed attempts);
- return CLI exit 0 for contradicted findings;
- offer irrelevant LSP quick fixes and throw on malformed code-action input;
- expose weak MCP schemas and generic transport errors; and
- report repeated `init` calls as newly created.

The existing baseline still passes. That shows these regimes are absent from
the current assertions, not that the defects are harmless.

## Reviewer assessment

| Source | Assessment |
|---|---|
| Fracture Scan | High accuracy and very high signal. Its three fractures are model counterexamples, not runtime failures, and it says so. |
| Hostile Assay | High-value architecture pressure test. It needs better calibration between underspecification, contradiction, and acknowledged implementation absence. |
| Semantic/loss audit | Strong hire. Excellent preservation discipline, cross-layer tracing, and repair specificity; some duplicate and completeness-claim noise. |
| TypeScript/linter audit | Hire with calibration caveat. Strong API instincts and compile/conformance ideas, but raw severities often treated open API choices as frozen defects. |
| Adversarial audit | Hire for architecture/security review with calibration caveat. Excellent hostile tests; too many High findings and repeated confusion between proposed design and current implementation. |

## Changes and GREEN results

No candidate repair was applied, so there is no issue-specific GREEN claim.
Independent evaluation established the unchanged baseline:

- prototype tests: 21/21 pass;
- fault controls: all eight intended mutants detected;
- TypeScript check: pass.

## Refutations and surviving value

The main refuted family alleged that proposed use cases, façades, Devtools,
policy APIs, or adapter semantics were being presented as implemented. The
candidate repeatedly labels them model reconstruction and bounds the prototype,
so implementation absence does not refute the design. The proposed compile,
adapter, Devtools, override, and end-to-end fixtures remain useful acceptance
tests.

Other refutations corrected claims that monotonic history forbids semantic
applicability, that a generic decision key is inherently type-unsound for a
distribution, and that donor analogy controls prove transaction or authority
semantics. Their narrower config-slice, runtime-codec, and transfer-boundary
tests are retained in the ledger.

## Repair boundary

The next artifact should not silently mutate frozen v4. Use one of these named
destinations:

1. **v4 audit errata:** the 12 clear documentary corrections, including
   terminology, dependency-table, provenance-label, example, limits, and
   suppression-priority fixes.
2. **v5 semantic grammar:** the confirmed lifecycle, identity, authority,
   adequacy, repair, operation, work, and snapshot laws.
3. **API-profile decisions:** the unresolved façade/service/schema layering,
   runtime schema, config/module resolution, admission topology, suppression,
   policy aggregation, and hostile-loader boundary.
4. **Prototype implementation backlog:** the reproduced transaction,
   concurrency, challenge, CLI, LSP, MCP, and initialization defects.
5. **Conformance suites:** compile-only authoring fixtures and shared golden
   snapshot/diagnostic/error/action fixtures across every adapter.

## Evidence gaps

- No concrete F01/F02/F03 TypeScript façade, config resolver, admission
  authority, policy evaluator, Work API, or Devtools consumer exists yet.
- Hook purity needs a selected execution model before it can be tested.
- Exhaustive method coverage needs an explicit threat and coverage contract.
- The exact linter-derived list beyond package/local-rule enablement remains an
  analyst interpretation unless separately confirmed.
- The current candidate is untracked, so HEAD alone does not identify its
  bytes; the audit records content hashes.

## Final loss audit

| Disposition | Count |
|---|---:|
| `fixed-now` | 12 |
| `confirmed-open` | 67 |
| `already-fixed` | 4 |
| `stale` | 0 |
| `refuted` | 18 |
| `deferred` | 14 |
| `design-decision` | 19 |
| `duplicate` | 66 |
| **Total** | **200** |

`200 = 12 + 67 + 4 + 0 + 18 + 14 + 19 + 66`

Every raw ID is present exactly once in the final ledger appendix. Duplicate
chains are flattened there. When a duplicate points to a refuted canonical
finding, the link explicitly preserves only the surviving narrower test or
documentation idea; it does not inherit the refuted allegation.
