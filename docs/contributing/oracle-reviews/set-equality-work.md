# Object-Set equality work in Effect publication

## Law and repair boundary

PR #2301 makes unordered Effects compare old and new projected values. Review
of head `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba` found that the existing
object-Set matcher retries permutations when several members have equal contents
and another member differs. A scalar source row can project those Sets, so this
new Effect cost does not already occur in source-Collection comparison.

Preserve change-event equality: Set order does not matter, each member matches
once, and distinct objects with equal contents retain their multiplicity.
The glossary and `deepEquals` API supply the authority. A keyed class matches
a plain record with equal fields, but two different classes differ. Matching
must permit reassignment; greedy pairing changes the accepted law.

The maintainer accepted this performance repair after independent review.
Its engineering requirement removes factorial assignment work under AGENTS.md's
algorithm-efficiency guidance, without adding a numerical latency API promise.
Flat one-field members permit at most `2*n*m` leaf reads per direct comparison.
Each core one-row replacement permits `16*(n+1)^2` reads, allowing repeated
comparisons at fixed bookkeeping boundaries. Both bounds were stated before
changing production. They do not promise quadratic total runtime or bound
arbitrary graph complexity.

## Instrument and pre-edit gate

The primary `utils-oracle.property.test.ts` owner imports the descriptor judgment
in `set-equality-oracle.ts`. That model enumerates compatible assignments with
memoized subsets. It neither reads production objects nor uses production
equality. Production instead finds augmenting paths through cached candidates.
Each candidate starts with the same active ancestors; recursive comparisons
remove their own pairs before returning. Another member's assignment therefore
does not change a cached candidate's context.

The generated family exhausts ordered two-member words over plain records and
two keyed classes in five homologous shapes: flat, self-cycle, owner-cycle,
nested owner-cycle, and shared acyclic leaf. Payloads range from -100 to 100.
Right-word reversal repeats already exhausted permutations; it adds no claimed
class case. Flat duplicate families use sizes 1, 2, 4, 6 and 8 with equal copies,
one late changed leaf, and different cardinality. Removing duplicate values
loses the performance witness; removing class/plain overlap loses the greedy
counterexample; removing ancestor shapes loses cycle-context evidence.
Members are distinct objects. Repeated references would collapse in a real Set
and are excluded from this multiplicity grammar.

The appended property is `utils.41`; selectors 1–40 stay unchanged. Fixed seed
20260911 and a fresh seed each run 100 instances of the same property and budget.
The extension `query/set-equality-receivers-oracle.test.ts` reuses that equality
judgment for 20 finite histories on each of three actual core paths: Collection
change events, unordered Effects and ordered Effects. Effect sources contain
only scalar `id` and `tick` fields; their projection constructs the Set.
Equal, reordered, late-mismatch and changed-multiplicity replacements are checked
at startup, replacement and next use. Event multiplicity, selected member values,
row ID and previous values remain observable.

Before production edits, the extended owners had **134 passes and 11 work
assertion failures**: two generated campaigns and nine receiving histories.
Returned equality and public deltas remained correct. Four flat members needed
128 reads against a bound of 32. At eight members each late-mismatch receiver
needed 219,200 reads against 1,296. The neighboring utils, proxy-revert, Effect
and startup suites passed **474/474**, including all 216 startup-owner tests,
before the matcher changed.

An initial run exposed a missing replay-registry entry, then registration order
shifted existing selectors. Both instrument issues were repaired before final
RED; neither setup failure is product evidence. Two test-only generic/union
annotations were also corrected after targeted type checking.

## GREEN, calibration, and replay

The matcher caches each candidate result and reassigns existing matches when
necessary. Unused candidates are preferred to retain the inexpensive aligned
equal-Set path. Draft and persisted-snapshot comparisons retain their ordered
branch. No startup predicate, assertion, exclusion or existing budget changed.

| Experiment | Result |
| --- | --- |
| Extended direct and receiving owners | 145 passed |
| Combined equality, receiver and neighboring run | 619 passed, zero skipped |
| Original matcher restored as mutant | 134 passed, 11 intended work failures |
| Greedy matcher without reassignment | 143 passed, 2 equality assertion failures |
| Original-mutant direct replay | One work failure; seed -310527886, path `0:0` |

Each of eight new direct reach states counts 200 in GREEN. Each of 180 finite
receiver/path/history/cut cells counts 1. The unchanged scalar startup owner
retains its 5,512 cells, each count 1. The greedy mutant fails class/plain
assignment; missing later reach follows that early semantic failure and is not
another claimed mutant kill.

The guarded replay-witness channel records one failing `utils.41` replay.
The same requested replay passes once on repaired production.
The repaired public probe measures 30 reads at eight members, versus 219,200
before repair. Its plain ten-member replacement measured 0.081 ms, versus
1,859.882 ms before repair on this machine. These single local elapsed samples
are diagnostic; no test asserts timing.

Tests use Node 24.19.0 and installed Vitest 3.2.4, at most two workers, with
coverage disabled. Targeted TypeScript checking passes. No install, lockfile
change or full build was required. Raw configs, reports, replay witness,
subjects and logs remain under
`/private/tmp/effect-startup-delta/prep-pr/set-repair/`.

The ordinary package command, from the repository root:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false \
  --maxWorkers=2 tests/utils-oracle.property.test.ts \
  tests/query/set-equality-receivers-oracle.test.ts tests/utils.test.ts \
  tests/proxy-revert-oracle.property.test.ts tests/effect.test.ts \
  tests/effect-disposal-oracle.test.ts \
  tests/query/virtual-row-fields-effect-oracle.test.ts
```

Replay uses `TANSTACK_DB_ORACLE_PROPERTY=utils.41`,
`TANSTACK_DB_ORACLE_SEED=-310527886` and `TANSTACK_DB_ORACLE_PATH=0:0`, selecting
`41:`. Full finite receiving execution remains independent of seed replay.

## Rubric review and limits

This table is the author's self-review. A fresh independent reviewer also
inspected the matcher, model, driver and raw evidence and found no supported
implementation defect. That review ran no tests. Its redundant-reversal
observation is accounted for above; reversal adds no independent class coverage.

| Requirement | Evidence |
| --- | --- |
| ORC-001 | Accepted equality authority and separate engineering work bounds are stated above. |
| ORC-002 | Authored descriptors supply expected equality independently of production. |
| ORC-003 | Literate shared model and receiving drivers state law, grammar, observations and limits. |
| ORC-004 | Reconstruction, ablations, bounds, reversal redundancy and duplicate-reference exclusion are stated above. |
| ORC-005 | Direct helper, public Collection changes and both core Effect paths compare at named cuts. Scalar sources isolate projected-value work. |
| ORC-006 | Original and greedy mutants fail the intended work and equality assertions. |
| ORC-007 | Same property and 100-run budget in fixed/fresh campaigns; one-run seed/path replay executed. |
| ORC-008 | No product lifecycle state added; the used-member subset enforces one-to-one assignment. |
| ORC-009 | Descriptors abstract authored values/prototypes and homologous links; cuts use glossary terms. |
| ORC-010 | Receivers retain causal failures at each cut, continue to next use and preserve cleanup errors. |
| ORC-011 | Subset enumeration challenges augmenting paths on non-equivalence class compatibility; arbitrary topology remains outside the model. |
| ORC-012 | Baseline identity, fingerprints, experiments and limits accompany the repair. |
| ORC-013 | Equal/reordered copies distinguish changed leaves and multiplicity; class/plain words reject greedy matching. |
| ORC-014 | Claims stop at eager controlled core sources; no provider/framework handoff is inferred. |
| ORC-015 | Eight direct states count 200; all 180 receiving cells count 1 in GREEN. |
| ORC-016 | All histories and receiving paths share the descriptor judgment. |

The work claim covers flat members at the stated sizes and one-row eager core
receivers. It does not bound arbitrary recursive graphs, nested-Set complexity,
changing getters, proxies, large Sets, real providers/frameworks, or every
comparator caller's total work. Class/cycle evidence covers two-member words
with matching link shapes, not general graph isomorphism or all cross-member
topologies. Existing broader equality laws remain with their owners.
Fixture-construction exceptions precede the cleanup wrapper; those setup
failures are outside the cleanup evidence.
The receiving ledger observes batch delivery. Rich named-callback metadata and
opaque-key calibration remain with the Effect metadata owner. Its separate
[continuity calibration repair](effect-startup-delta.md#key-interval-checker-calibration)
does not extend this Set-work observation boundary.

Reviewed identity is parent `a7ea76cddf7ab2fe03f49d84c6d596dd598fedba` plus
these SHA256 fingerprints:

| File | SHA256 |
| --- | --- |
| `packages/db/src/utils.ts` | `6ee964e4cd4ef93131ce5d287dc5910cbfc218dc62cf65ee2c8897eb12d1ef28` |
| `packages/db/tests/set-equality-oracle.ts` | `d2654eb35cb3d86c9aefd7969afdb68d7ae230138da93a0c43abd89efcf592b2` |
| `packages/db/tests/utils-oracle.property.test.ts` | `5349e7dd770d73058aaf7d07f83fd81a0873a5f15e8a995b89d1a65eaa68acbb` |
| `packages/db/tests/query/set-equality-receivers-oracle.test.ts` | `1532a4b14b64503fd8dc032b73c5b82f1563547b9419fd24ad9c2a809790e9db` |
