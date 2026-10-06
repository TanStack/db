# Remote subset validation work follow-up

Baseline: `e61cda19997c169a59b6e345197a36eca9e75ec7`.
This follow-up supersedes the open HE-008 disposition in the bounded review.
The user authorized encoding the work law before implementing the repair.

## Law and repair

Remote admission validates request data without constructing a discarded wire
snapshot. Each coordinator attempt may construct at most one detached payload
snapshot. Demand retired during hydration needs no payload snapshot. Validation
retains the existing accepted domain, exact rejection paths, and read-only input
behavior. Coordinator snapshots remain detached and fresh at each projection
call; local signal/subscription references and acquisition identity remain local.

The three persisted admission guards now use `validateRemoteSubsetOptions`.
Validation and projection share the existing traversal and checks. Validation
retains source nodes only as per-call cycle markers and skips writes and payload
construction. A zero-length typed-array view checks ArrayBuffer detachment
without copying its bytes. Only the coordinator constructs the wire snapshot.
There is no request cache, new retry state, wire-format change, or new value kind.

This removes duplicate copying, not the validation traversal at separate
admission and coordinator boundaries. It does not claim a latency bound or zero
allocation: path strings, descriptors, visit maps, and zero-length detachment
checks remain. Future traversal reuse would need a separately justified ownership
boundary; it is not necessary to close the discarded-projection finding.

## Oracle evidence

The persisted owner previously protected rejection and snapshot semantics but
had no construction-work assertion. The new bounded matrix uses follower load,
leader-to-follower hydration, one transient failure plus retry, abort during
hydration, release during hydration, and retained-demand gap recovery. Each runs
with 0, 1, and 33 byte payloads. The independent schedule predicts 0, 1, or 2
coordinator attempts. A controlled coordinator uses the real wire encoder.

The check counts backing-buffer copies and ordinary-record property copies,
including copies descended from an earlier copy. A direct encoder positive
control calibrates both observation seams. At request settlement it checks the
attempt count, detached bytes, shared backing-buffer identity, signal exclusion,
and copy budget. Frozen input and the existing later-call snapshot witness
protect read-only validation and fresh projection behavior.

The Browser coordinator owner applies its existing independent hostile-value,
exact-path, and incompatible-schema-role fixtures to validation-only admission.
Its rich local/follower receiving witness also validates a frozen graph containing
cycles, aliases, maps, sets, dates, RegExp, views, and every supported typed-array
kind before checking delivered semantics and exact lifecycle release identity.
These are controlled Node transport seams, not real-browser/OPFS claims.

| Experiment | Result at the intended checkpoint |
| --- | --- |
| Initial test-first matrix on unchanged production | 12 copy-count failures; value and isolation observations passed. |
| Final matrix with original persisted guards loaded from the baseline | All 18 cases reject excess copies: success 2 versus 1, retry 4 versus 2, cancelled demand 1 versus 0. |
| Current production | All 774 tests pass across 11 affected suites, with one existing TODO. |
| Omit validation-only admission | 49 assertion failures: 45 independent rejection/path checks and four native admission histories; two string controls pass. |
| Omit detached-buffer validation | Three expected-rejection assertions fail; detached DataView remains a passing control because its own accessor check still rejects. |

All mutant runs use scratch source-loader substitutions with reached-file
receipts. No production source was left mutated. An initial Browser run failed
before setup because the scratch configuration lacked a subpath alias; that run
is not RED evidence. The corrected alias runs the real coordinator sources.

TypeScript passes with cached dependency and Vite worker declarations. ESLint
reports zero errors and 32 pre-existing require-await warnings across the two
owners. Prettier CLI and whitespace checks pass.

## Guide audit and limits

- ORC-001/002: the authorized work bound and established wire/ownership contracts
  supply the law. Schedule counts, literal bytes, and named error paths supply
  independent expected observations.
- ORC-003/005: prose beside the new matrix separates law, bounded histories,
  production path, observations, and settlement checkpoint. Positive controls
  and observed coordinator entry establish reach.
- ORC-004/007/008: not applicable to the new checks. The matrix exhausts its
  declared fixed schedules and sizes; it adds no generated property or stateful
  model. Existing generated owner campaigns run unchanged.
- ORC-006: original guards and the two hostile mutants fail at the intended
  assertions, with passing controls. No timeout is counted as an assertion kill.
- ORC-009: demand retirement, coordinator attempt, request data, and snapshot
  remain distinct. Counts concern coordinator calls, not packets or publications.
- ORC-010: the new matrix uses the owner's failure-preserving cleanup and restores
  global spies before cleanup diagnostics. Other receiving fixtures retain their
  existing resource cleanup.
- ORC-011: a shared-validator fault is challenged by independently specified
  hostile values and exact paths, not merely validator/encoder agreement.
- ORC-013: cancelled/live demand, first/retried attempts, and valid empty/detached
  buffers distinguish nearby wrong boundaries. Frozen requests reject input
  rewrites; the existing later-call witness rejects global identity caching.
- ORC-014: construction credit is limited to the persisted wrapper and real
  encoder behind a controlled coordinator. Browser receiving tests use real
  coordinator code and structuredClone with controlled host seams. Actual browser,
  Electron, and native-host scheduling remain with their existing owners.

The closed class is discarded full request snapshots in the three persisted
admission guards across this bounded history matrix. Validation traversal cost,
arbitrary third-party coordinator work, and runtime latency are not measured.
No known counterexample remains within the stated boundary.

## Code weight and receipts

Production adds 153 lines and removes 83 (net +70). Tests add 304 lines and remove
one across two existing owners; there is no new oracle owner. The extra branches
select copy construction in one traversal instead of duplicating validation or
introducing a prepared-request lifecycle.

Final production blob IDs:
- `packages/db-sqlite-persistence-core/src/persisted.ts`: `d8b6ad58093d2387487642886256e3830a27b65e`
- `packages/db-sqlite-persistence-core/src/remote-subset-wire.ts`: `b40804f1fe5c202856f089fe1cd16941bcb11a0d`

Scratch receipts under `/private/tmp`:
`temporal-wire-work-red.json`, `temporal-wire-old-guards-final-red.json`,
`temporal-wire-no-admission-red.json`, `temporal-wire-no-detachment-red.json`,
`temporal-wire-work-surrounding.json`, `temporal-wire-work-types.log`, and
`temporal-wire-work-eslint.log`. Each mutant has a matching `*-reach.json`.
