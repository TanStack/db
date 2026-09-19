# Stage 6 Meso-Level Density Assay — TanStack Trust RFC v0.3

## Frozen input and compression target

- Draft: `drafts/tanstack-trust-rfc-v0.3.md`
- SHA-256: `f3c246b7393beb8767931aa8465aecd49beb8d972cdfd82aefadef289f891904`
- Length: 7,091 words
- Compression target: no more than 100 words
- Execution: one fresh summary reader followed by a separate fresh close reader

Neither reader saw the author-value account, Stage 4 reader promise, blind
cartography, source trace, other reader results, or a preferred verdict.

## Summary attempt

The first fresh reader returned this usable 92-word summary:

> TanStack Trust is a draft architecture for domain-owned, bounded software guarantees. Domain packages define claims, authorized checks, applicability, and omissions; Trust maintains evidence graphs, provenance, freshness, contradictions, exact-replay repairs, expiry, and explanations; consumer policy alone decides action, while workflows and interfaces only carry operations. The current bounded prototype includes a finite kernel, verified file storage, one Endpoints safe-skip check, and shared CLI, LSP, and MCP service. Trust will incubate inside Endpoints, not as a separate product. It cannot establish domain-rule or checker soundness, complete dependencies, production correspondence, generality, or permission to ship.

Usability check: it addresses the supplied RFC, stays within the target, keeps
Trust as the subject, preserves the authority split and temporal lifecycle,
names the bounded implementation and Endpoints incubation, and states major
limits. “Shared CLI, LSP, and MCP service” compresses three adapters over one
service but does not change the claim. No replacement summary was needed.

## Fresh close-reader comparison

The separate reader identified the following candidate differences before the
orchestrator checked them against the text:

1. AND-within-route, OR-across-route, and no-cycle evidence topology.
2. Separate evidence, reach, operational-failure, and consumer-action axes.
3. External rule/checker admission as the concrete agent self-certification
   boundary.
4. Historical freshness: monotonic revisions, no revival, selective
   invalidation, and incomplete-dependency limits.
5. Causal repair order, exact replay, append-only resolution, and later expiry.
6. Explanation as a structured operation over routes and gaps rather than
   verdict prose.
7. The consumer-policy tension between universal veto and inferred permission,
   including the fact that full refetch is not always safe.
8. Different evidence forms and their limits rather than one strength ladder.
9. The narrow meaning of verified local storage.
10. Exact Endpoints test counts and safe-skip premises.
11. Adapter operation names and diagnostic mapping.
12. The dependency-ordered build sequence.

It reported no unsupported statement in the 92-word summary. It warned that a
reader who expands “verified file storage” into authenticated or tamper-proof
storage would exceed the RFC.

## Text verification and classification

| ID | Verified location | Classification | Disposition |
| --- | --- | --- | --- |
| MD1 | §3, “Within an argument route, premises are conjunctive…routes are alternatives”; cycle paragraph | **Mechanism; material summary omission** | Supported. “Evidence graphs” alone does not preserve the graph's central semantics. |
| MD2 | §4 four-question table and operational-failure paragraphs | **Mechanism and tension; material summary omission** | Supported. The summary keeps consumer action separate but loses production reach and the no-correctness-observation rule. |
| MD3 | §§2 and 7 admission paragraphs | **Cross-section connection** | Supported. “Authorized checks” names the boundary but close reading adds proposal versus admission and the need for ownership, versioning, capability, and revocation. |
| MD4 | §4 `a → b → a` sequence and selective-invalidation paragraphs | **Mechanism and sequence** | Supported. The summary says freshness; the body defines historical no-revival behavior and its dependency-discovery limit. |
| MD5 | §5 `t1`–`t4` sequence and resolution-history paragraphs | **Sequence and mechanism** | Supported. “Exact-replay repairs” preserves the headline; close reading adds causal ordering, same-case applicability, append-only history, and expiring authority. |
| MD6 | §6 route example, explanation inventory, and task paragraphs | **Mechanism and cross-section connection** | Supported. The summary names explanations but loses route-preserving gap work and the task-is-not-evidence boundary. |
| MD7 | §9 universal-veto/permission pair and fallback paragraph | **Tension** | Supported. This is stronger than the summary's general consumer-policy boundary. |
| MD8 | §3 evidence-form table and formal-donor paragraphs | **Tension and mechanism** | Supported. Close reading preserves incomparable evidence access methods and their distinct failure boundaries. |
| MD9 | §8 persistence paragraphs | **Qualification; material summary caveat** | Supported. The summary is literally accurate, but close reading prevents “verified” from acquiring authentication, signatures, hostile-writer resistance, or multi-process safety. |
| MD10 | §10 safe-skip premises, oracle boundary, and “21 local tests and eight mutation controls” | **Evidence and particular** | Supported and functional. These details calibrate what the bounded vertical actually tested rather than merely adding volume. |
| MD11 | §8 capability table and adapter behavior | **Mere extra detail for the compression target** | Supported, but the 100-word summary's one-service statement performs the same architectural job. |
| MD12 | §11 “Build by dependency” | **Sequence** | Supported and functional for an RFC reader evaluating implementation order; the summary was not asked to preserve roadmap detail. |

## Result

The result is non-null. The 92-word summary preserves the architecture's
subject, authority handoff, broad temporal lifecycle, bounded implementation,
incubation decision, and strongest scope limits. Close reading adds verified
functions that compression cannot carry: evidence-graph logic, independent
state axes, historical freshness, causal repair, route-preserving explanation,
admission governance, method-specific evidence limits, exact implementation
evidence, and dependency order.

Two omissions—route topology and execution reach as a separate axis—are central
enough that an unconstrained short overview should try to retain them. That is
a statement about the compression, not a revision instruction for the RFC.

## Distortion and unmeasured remainder

The close reader used the full 7,091-word RFC and may reward detail simply for
being present. The verification ledger therefore rejects adapter enumeration as
mere extra detail and retains only text-supported functional differences. Both
fresh readers share model lineage and do not represent TanStack maintainers.
The assay does not measure prose quality, novelty, reader preference, or whether
the document should be shorter.
