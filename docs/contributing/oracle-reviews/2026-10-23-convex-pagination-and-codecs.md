# Convex pagination and mutation codec review

Reviewed source and test head: `6511ee4ed0940cd54ee58ceeba7202ca859344b3`.
This record reviews these owners against [ORC-001 through ORC-014](../oracle-rubric.md):

- `packages/convex-db-collection/tests/pagination-oracle.property.test.ts`
- `packages/convex-db-collection/tests/values-oracle.property.test.ts`
- The opt-in codec property in `packages/offline-transactions/tests/transaction-serializer-oracle.property.test.ts`

The pagination review is independent of its implementation author. The reviewer
also inspected the value models and codec dispatch independently, then repaired
replay routing and cleanup mechanics. That participation is not an independent
review of those harness repairs. This is not a new audit of every historical
serializer law. Source acceptance and snapshot ownership have separate reviews.

No known product counterexample remains in the bounded domains below. Passing
these histories does not establish an on-demand API, a lifetime resource bound,
or arbitrary storage and process behavior.

## Executed evidence

At the reviewed head, the reviewer ran the pagination and Convex values owners,
including their normal fixed and random campaigns. The pagination file has ten
checks, including cleanup calibration. The Convex values property runs 100
histories per campaign. The shared serializer file passes all 51 checks with
`OFFLINE_CODEC_ORACLE_SEED=20261022` and
`OFFLINE_CODEC_ORACLE_PATH=0:0:0:0`. This full-file command directly replays the
codec property without applying its path to unrelated properties.

Before the selector repair, the same path under the shared `OFFLINE_ORACLE`
prefix made four unrelated properties fail with `Unable to replay, got wrong
path`. That is a replay-routing failure, not a product mismatch or checker kill.
The dedicated prefix repairs that failure. Other legacy serializer properties
keep their existing selectors.

The pagination author recorded these assertion failures at their intended
observations, with repaired replays passing:

| Wrong behavior | Seed and path | Observation |
| --- | --- | --- |
| Reverse concatenated pages | `20261022`, `0:1:0:2:3:1:1:1` | Ordered rows received by `select` |
| Publish a prefix while another range is missing | `20261022`, `0:1:3:1:2:5:7:3:3:0:1:1` | Previous public snapshot while acquisition is pending |
| Copy incomplete prefixes during initial acquisition | `20261022`, `0:0:0:0` | Provider row reads at first exhaustion |
| Omit the accepted-row cap | `20261023`, `0:0` | Error and retained public rows after growth beyond the cap |

The prior codec calibration is recorded in the coverage map: a decoder that
leaves Convex scalar wire markers as JSON fails the typed-value observation at
`CONVEX_VALUES_ORACLE_SEED=20261022`, path `0:0`. This review inspected the
unchanged Convex encoding and observation boundary, and reran the repaired owner.
It does not claim to have rerun that production mutant after the head was frozen.

## Requirement outcomes

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001, authority and limits | Satisfied for the stated domains. Pagination follows the documented complete eager mirror, `maxRows`, and Convex's fixed `endCursor` and split semantics. The row-read check is a deliberately narrow acquisition cost guard, not a total complexity promise. Codec meaning follows the opt-in `MutationValueCodec` and version-4 wire contract. Metadata retains the existing version-3 contract. The Convex receiver uses its public scalar encoding. Limits are stated in the files and below. |
| ORC-002, independent judgment | Satisfied. Pagination expects authored rows in mathematical rank order, without using production cursor bookkeeping. The numeric interval provider answers requested intervals independently. Convex values are compared with their authored native trees through a type and byte observation. The shared codec fixture uses Node V8 serialization, while expected native values come directly from generated leaves. Neither codec model uses production dispatch to compute its expected result. |
| ORC-003, literate responsibilities | Satisfied within this scope. Pagination explains the complete snapshot law, range fixture, histories, public and select observations, pending cut, and work/cap comparisons beside the code. The Convex values opening distinguishes authored tree, storage driver, fresh reader, and typed comparison. The shared codec section separates its opt-in law, V8 fixture, native grammar, and storage/error comparisons from the older serializer model. |
| ORC-004, grammar controls | Satisfied within the declared bounds. Pagination varies 0-8 distinct rows, 1-10 snapshots, page sizes 1-4, both callback directions, and no/required/recommended splits. Work varies 3-40 pages and 1-8 rows per page. Cap histories vary limits 1-20, page sizes 1-6, and excess 1-6. Empty results distinguish readiness from nonempty data; row removal and movement distinguish complete replacement from append-only accumulation; split modes distinguish replacement from continuation; callback direction removes delivery-order dependence. Split cursors are asserted strictly inside the returned range, excluding the formerly illegal page-size-1 split. Convex values use depth-two trees, arrays up to three, bytes up to eight, bounded strings, signed int64s, special floats, undefined fields, and six marker-like field names. Removing a native leaf would remove evidence for that codec branch. Shared codec histories use 1-5 native leaves, bytes up to twelve, and each mutation kind, plus missing/wrong/throwing readers and a non-string encoder. Cycles, custom native objects, and arbitrary malformed server protocols are not legal histories in these grammars. |
| ORC-005, production path and observation | Satisfied. Pagination uses a real Collection and adapter with controlled provider cache callbacks. It compares public keyed rows and ordered `select` input after exhaustion, and both while a new range lacks a result. The pending pump drains scheduled flushes before checking, so it reaches incomplete acquisition rather than filling new ranges first. The work recorder counts numeric provider element reads before explicit cache refresh. Codec drivers use actual OutboxManager writes and fresh readers; all three mutation payloads are compared. The shared owner also checks registry identity, wire version/codec ID, metadata, mixed legacy records, and byte-for-byte retained storage after failed reads. No concrete missing-input hypothesis remains for these named cuts under the stated provider premises. |
| ORC-006, calibration | Satisfied with the recorded controls above. Pagination's wrong page order, premature prefix, extra row reads, and absent cap each fail the relevant assertion. The typed-value receiver rejects scalar-as-JSON normalization. The original default serializer's BigInt admission failure and repaired codec replay are recorded in the coverage map. Replay-routing failures are reported separately and are not counted as product calibration. |
| ORC-007, campaigns and replay | Satisfied. Each generated property normally runs matching fixed and random budgets. Pagination has separate `CONVEX_PAGINATION_ROWS`, `CONVEX_PAGINATION_WORK`, and `CONVEX_PAGINATION_BOUND` seed/path selectors, each with 60 runs. Values uses `CONVEX_VALUES_ORACLE`, with 100. New shared codec replay uses `OFFLINE_CODEC_ORACLE_SEED/PATH/RUNS`, defaulting to 60. Their direct replay branches bypass the normal two campaigns for the selected property. No reviewed property uses `fc.commands`, so command `replayPath` handling is not applicable. |
| ORC-008, state minimality | Satisfied for pagination. Its last accepted input array is necessary: a missing replacement range must preserve that array, and a later completed acquisition replaces it. Two different accepted snapshots are distinguished by the next pending-range observation. Provider slot/cache state drives production and is not the reference state machine. Not applicable to the value models, which compare one authored tree with one restored tree rather than reducing a stateful history. |
| ORC-009, vocabulary | Satisfied. Collection rows, public snapshot, source result, acceptance, and cleanup retain the glossary's meanings. Numeric rank intervals are an explicit fixture abstraction of opaque provider cursors, not production cursor parsing. The work recorder measures element reads, not network work or subscription count. Codec wire version and codec ID are distinct from the application's transaction version and named mutation function. No hidden production-state equivalence is introduced. |
| ORC-010, failure fidelity | Satisfied for the reviewed generated properties. Pagination uses the shared test cleanup instrument, whose double-fault calibration preserves the original comparison as AggregateError cause, keeps secondary failures, and attempts a later release after an earlier release throws. Values and new shared codec catch and rethrow the primary failure, then use the existing cleanupOfflineOracle instrument to attempt both Collection releases. That instrument logs secondary cleanup failures without replacing an existing primary. The reviewer inspected this control flow; the reviewed value properties do not inject cleanup failures themselves. |
| ORC-011, second formulation | Satisfied where a concrete shared-fault hypothesis applies. A numeric controlled provider could implement the same wrong cursor semantics as production, so the actual backend independently evaluates an unpaginated query and compares it with real cursor-range results, including actual split responses. A JSON-normalizing recorder could hide native value loss, so typed scalar/byte observation distinguishes that hypothesis, with native values also received by process/backend tests. No further specific shared semantic fault was identified that calls for another model. This is not an exhaustive absence claim. |
| ORC-012, review evidence | Satisfied by this versioned record tied to the exact reviewed source/test commit. It lists each requirement, concrete checks, controls, and remaining limits. The record reviews the pagination bug class at complete exhaustion, pending acquisition, ordered selection, initial element-read, and cap/error cuts. It reviews codecs at durable admission and fresh read, with all payloads and unreadable-record retention. Known limits below are not presented as closed classes. |
| ORC-013, distinguishing boundary witnesses | Satisfied within the promised boundaries. Generated cap histories first accept exactly `maxRows` rows, then reject excess, retain the previous snapshot, and recover after shrink. A separate pinned default test distinguishes 10,000 from 10,001, and invalid 0, negative, fractional, infinite, and NaN caps reject before subscription. Work's three-row/page-size-1 failure distinguishes copying an incomplete prefix from the one complete materialization. Codec histories distinguish valid binding from absent/wrong/throwing binding while requiring unchanged durable bytes. These are not claims about arbitrary resource thresholds. |
| ORC-014, controlled-premise handoff | Satisfied with explicit limits. The controlled pager assumes Convex fixed ranges and legal split responses; real local backend tests exercise both actual SDK clients, fixed ranges, and server-generated splits against an unpaginated query. The native tree/storage driver assumes preservation across serialization and fresh readers; backend crash tests receive native payloads on disk and across process death, now on insert and update. These receiving drivers use provider-specific controls and separate expected server queries/application state rather than literally reusing the numeric fixture grammar. Their shared law is documented, but arbitrary cloud scheduling and every generated native tree are not thereby received. |

## Remaining limits

The eager cap bounds accepted rows, not network bytes, peak memory, or lifetime
cursor ranges. A reactive range can itself return more than the cap. Old ranges
remain subscribed, so long-running insert/delete histories can accumulate ranges
even while the current row count remains small. Initial acquisition still scans
cached ranges repeatedly. Only row materialization, not total work, is bounded
by the work property. On-demand filtering, ordering, demand release, and a bounded
subscription policy need a separate API and receiving witnesses.

The numeric interval grammar assumes coherent source revisions and finite
acquisition. It does not prove continuous growth, cross-Collection publication,
or arbitrary contradictory cursor responses. The backend is a real local Convex
backend, not evidence for cloud availability or network latency.

The direct Convex value receiver uses one update-shaped mutation, checking
modified, original, and changes. Mutation kinds are crossed by the shared owner,
and CRUD is received by the backend process tests. This does not prove every
native tree through every operation and storage implementation. The reviewed
values are bounded acyclic trees; identity sharing, cycles, cross-realm natives,
custom objects, native Temporal, browser storage atomicity, and power-loss
atomicity are outside this evidence. These limits remain with the codec and
backend owners in the coverage map.

## CI type-check follow-up

CI exposed an omitted type-level selector entry in the shared config reader:
`OFFLINE_CODEC_ORACLE` worked at runtime but was absent from the accepted prefix
union. The offline package type check reproduced TS2820 before the repair.
Adding that exact prefix to the union makes the type check pass, and the same
full-file codec replay at seed 20261022/path 0:0:0:0 still passes all 51 checks.
This follow-up changes only a test configuration type, no production code,
model judgment, generated history, runtime selector routing, or comparison.
The exact-head semantic review above continues to refer to its stated source
revision rather than claiming a fresh independent audit of this type edit.
