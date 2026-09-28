# Temporal group-key oracle review

## Reviewed state and contract

- Base: `33a194941c8d51f8f98babb999fef2987dd6ff8b` (`origin/main`).
- Reviewed executable head: `6d3e58ec`.
- Owner: `packages/db-ivm/tests/temporal-group-key-oracle.test.ts`.

The user confirmed that db-ivm `groupBy` must keep different Temporal values in
different groups. This repair uses db-ivm's established hash key domain: a
Temporal kind and its string representation identify a key. The oracle checks
the public grouped result after one input batch. It covers the eight Temporal
kinds recognized by hashing, with two different values and matching fresh
values for each kind. The model counts those descriptors in a plain Map.

The original serializer treated each Temporal value as an empty plain object.
On the base commit, a public `groupBy` of January 15 and June 15 PlainDates
emitted one group with count 2. The new oracle failed at that public checkpoint
for all eight kinds: it observed one count-2 group where it expected two
count-1 groups. Eight matching-value controls passed. A direct serialization
control also failed because a Temporal value and `{}` both encoded as `{}`.

The fix shares the existing Temporal discriminator with the serializer. The
serializer uses a tagged kind-and-value tuple for Temporal values at any
supported structural depth. The existing hash rule is unchanged. The repair
adds seven net production source lines; tests and contract records are separate.

## Oracle requirements

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass. The explicit user decision permits Temporal group keys. Existing db-ivm hashing defines the bounded kind-and-string domain. The oracle and coverage map name the one-batch checkpoint and exclusions. |
| ORC-002: independent judgment | Pass within that domain. A plain Map counts fixture values by Temporal kind and string. The model calls no db-ivm hash, serializer, or operator. The established hash domain is the separately justified semantic base; native `.equals()` is a distinct unresolved policy. |
| ORC-003: visible responsibilities | Pass. The opening states the law and limits. `temporalCases` is the bounded grammar, `expectedGroups` is the model, `observedGroups` drives public D2 `groupBy`, and the tests compare after `graph.run()`. |
| ORC-004: generated grammar controls | Not applicable. The oracle enumerates a fixed matrix; it does not claim generated-history coverage. Every listed kind runs distinct and matching cases. |
| ORC-005: path and observation | Pass. The driver imports the package entry point and observes every group output. It compares group identity and count. Its recorder keeps each emitted row; it cannot hide the one-group collision by overwriting a key in a Map. |
| ORC-006: checker calibration | Pass. The unchanged serializer was the plausible wrong design. It reached public `groupBy` and failed eight value assertions, not setup or timeout. The object control failed separately. |
| ORC-007: campaigns and replay | Not applicable. No important generated property is added. The fixed cases are individually named and directly runnable. |
| ORC-008: stateful-model minimality | Not applicable. Expected groups come from stateless recomputation of one batch. |
| ORC-009: vocabulary mapping | Pass. A fixture value is a db-ivm relation key inside a record. The model's descriptor combines the established Temporal kind and string identity; it is not a production hash or serialized key. |
| ORC-010: failure and cleanup | Not applicable. The in-memory graph has no acquired external resource or shrinker. The failing assertion preserves the observed group and checkpoint. |
| ORC-011: independent second formulation | The review identified native `Temporal.equals()` as a plausible different equality policy. No db-ivm contract selects it. The coverage map retains this exact decision; an `.equals()` oracle would impose new behavior outside this repair. |

This record supplies ORC-012 evidence for executable head `6d3e58ec`.

## Verification and remaining scope

The focused oracle changed from 9 failed and 8 passed tests on the base commit
to 17 passed on the repaired head. The full db-ivm suite passed 576 tests in
40 files. Package TypeScript, changed-file ESLint, Prettier, Vite build, and
`git diff --check` passed. Vitest ran with at most two threads.

The oracle does not cover incremental retractions. Symbols and cyclic keys
remain unsupported by the serializer. Mutable `RegExp.lastIndex` does not
belong to this Temporal law. An independent reviewer reproduced another
boundary: two ZonedDateTimes with `[UTC]` and `[Etc/UTC]` satisfy native
`.equals()` but have different kind-and-string keys. The coverage map records
the native-equality decision. This PR does not change that hash behavior.
