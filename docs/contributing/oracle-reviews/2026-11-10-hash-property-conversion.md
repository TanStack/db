# Structural hash campaign conversion

This test refactor converts the graph and failed-retry owners to `oracleProperty`. Production is unchanged. The baseline is `8aaedb47bd0def762780ae33c6baeee3af30a8b1`; [the companion JSON](2026-11-10-hash-property-conversion.json) binds the reviewed source blobs, seed, complete census, selected stable keys, and final outcomes.

## Laws and independent judgments

A failed structural traversal preserves the source error and reads only the prefix through its rejecting getter. Retrying rereads that prefix; success agrees with a plain structural copy, and cached root reuse reads no getter. The arithmetic read-count model remains independent of production caching.

A root-reachable cycle rejects on both serial attempts. An acyclic shared graph has the digest of its independently unfolded tree. Kahn's algorithm supplies the topology judgment independently of production's active-path traversal. Authority for both owners is the established structural-value contract in [Structural values and ordered primitives](../oracle-coverage.md).

The retry grammar retains 0..3 completed siblings, 0..2 untouched tail getters, 1..3 failures, and values -20..20. Its budget remains 100 with fixed seed 205206 and a matching random campaign. The graph grammar retains one to six nodes, zero to three ordered edges per node, and its budget 300 with fixed seed 1657019 and a matching random campaign. Generated numeric label offsets preserve randomness in forced small topologies. Fixed histories use the same model, driver, and check. Supplemental topology and replay controls remain in the ordinary calibration file.

## Constructed states and failure fidelity

Every builder returns a fresh history. A local WeakMap records each builder's declared states on every invocation, including generated and shrunk results. The model carries those obligations to the check, which compares them with the driver's independently recorded reach. This closes e1fb504's initial-example-only association gap without changing the generated language or budgets. Semantic comparisons run before missing-tail or required-state checks. A missing constructed state uses the virtual `constructed states` checkpoint, which a driver never records. It cannot replace an earlier driver error with an invented observed violation.

Executed controls distinguish both repairs:

- A temporary graph driver omitted reach only for constructed histories whose generated offset was 0, absent the initial examples of seeds 1657019 and 42. Native initial-only enforcement passed both 300-run campaigns. The shared check rejected the miss; final direct replay 42/path37:0 reports `constructed reach` at `constructed states`.
- The real graph driver then recorded its actual hash results and first reach, followed by a sentinel error before a later required reach. The old recorded `reach` checkpoint misreported a named completeness violation with the error as cause. The virtual checkpoint preserves the original sentinel error. The intentionally faulted test still exits nonzero; the repaired result is correct error classification.
- A temporary wrong source-error observation in the retry driver shrank and directly replayed at 42/path0:0:0:0:0, retaining `atomic failure cut` at `failed attempt 1`.

All temporary driver edits were restored byte-for-byte before final mutation verification. Each owner also retains a normal calibration that drops a required state and must be rejected by the shared check.

## Mutation preservation

Only the explicit-prefix cold pair is acceptance evidence. Earlier cache-recovery diagnostics defaulted to `ORACLE`, while DB reads `TANSTACK_DB_ORACLE`. Those diagnostics were withdrawn. e1's disk-cache identity omits the prefix, so both accepted runs omit `--daemon` and use the documented in-memory evidence store. The reports record zero reused units; runtime state independently records `TANSTACK_DB_ORACLE_SEED=42`.

Commands run from the worktree root:

```sh
pnpm_config_verify_deps_before_run=false NODE_OPTIONS=--max-old-space-size=8192 pnpm exec oracle-gaps --package packages/db-ivm --source src/hashing/hash.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --out packages/db-ivm/.oracle-gaps/recovery-2026-11-10/correct-prefix-before
pnpm_config_verify_deps_before_run=false NODE_OPTIONS=--max-old-space-size=8192 pnpm exec oracle-gaps --package packages/db-ivm --source src/hashing/hash.ts --env-prefix TANSTACK_DB_ORACLE --seed 42 --contexts 1 --only <the 148 IDs in the companion JSON> --out packages/db-ivm/.oracle-gaps/recovery-2026-11-10/correct-prefix-after-final
```

The BEFORE contains every 234 static site: 144 killed, 54 survived, 22 unowned, 12 crashed, and 2 unreached. AFTER selects all 144 prior kills plus four earlier same-anchor siblings, preserving repeated-anchor stable-key numbering. Each selected key also matches source position, operator, original/replacement text, function, and full anchor. The validator requires semantic rejection; a constructed-reach-only kill does not count. Final results and report hashes are in the companion JSON.

## Validation and limits

The normal focused command passed 49 tests across both owners, graph supplemental calibrations, and existing graph/retry regressions. TypeScript and changed-file lint pass. The companion JSON records per-state fixed/random counts and all controls. Independent read-only review found no supported loss in the read-count, error-identity, digest/cache, graph-unfolding, or repeated-cycle laws.

| Guide requirement | Evidence |
| --- | --- |
| ORC-001–003 | Established contract and explicit limits; arithmetic/Kahn/unfolding judgments; prose keeps grammar, model, production driver and comparison distinct. |
| ORC-004 | Existing fixed topologies and getter boundaries reconstruct through the shared judgment. Every bounded axis changes a read count, rejection or structural relation. Empty/out-of-range adjacency lists are excluded by the inverse. |
| ORC-005–007 | Real `hash` entry, serial return/throw checkpoints, wrong-observation calibrations, complete prior-kill comparison, unchanged fixed/random budgets and checked graph/retry seed-path failures. |
| ORC-008–009 | No product state added; construction metadata records declared obligations. Model adjacency nodes and getter-count vectors have explicit mappings to the production values. |
| ORC-010 | Recorded semantic mismatch precedes completeness; same-path late-error and direct-replay controls retain the intended failure. |
| ORC-011 | No new shared-fault hypothesis requires another formulation; the existing graph-unfolding relation remains independent. |
| ORC-012–013 | This record and exact source blobs bind the evidence. Acyclic/cyclic neighbors, first/last getters, and one/repeated failures distinguish nearby laws. |
| ORC-014 | Not applicable: no provider or host premise is transferred; the owners call the value-level hasher directly. |
| ORC-015–016 | Five retry and nine graph states are constructed and measured. Fixed histories use the shared judgments; ordinary category/replay assertions stay outside oracle files. |

This establishes preservation for the two converted owners and the prior killed mutants in `hash.ts`. Unchanged legacy owners still account for unnamed assertion kills. The unchanged baseline gaps remain gaps; this conversion does not claim their closure. Other graph carriers, pre-cached descendants, reentry, hash collision freedom, imported Murmur code and unrelated operator/host behavior remain separate owners.

The focused verification command, from `packages/db-ivm`, was:

```sh
../../node_modules/.bin/vitest run tests/hash-graph-oracle.property.test.ts tests/hash-failure-retry-oracle.property.test.ts tests/hash-graph-calibration.test.ts tests/hash-graph.test.ts tests/hash-failure-retry.test.ts --maxWorkers=2 --coverage.enabled=false
```

The final cold AFTER completed all 148 selected sites: 144 killed, 2 survived, and 2 crashed. All 144 prior semantic kills and all 148 stable identities match. Both runs have zero reused units, no exclusions, and no nondeterministic owners. The final-source hash comparison checked 3600 files.
