# Installed-SDK campaign registration migration

The four main installed-SDK properties and twenty-eight resume-checkpoint
receiving cells now use `oracleProperty`. Their original independent source,
membership, listener, retry, and persisted-cursor comparisons and real installed
ShapeStream/controlled-HTTP paths remain. Snapshot, rotation, and source-release
campaigns retain forty runs; membership retains twelve; every resume cell
retains eight. The fixed seeds and scaled thirty-second campaign timeout remain.

The existing `sameViolation` first-checkpoint shrinking predicate is unchanged.
Each native test resets it once before its histories run, as the former
campaign wrapper did. Rejected histories retain its original-checkpoint/history
diagnostic when the native adapter transports the comparison's judgment. Fixed
calibrations, cleanup checks, resource release, and primary-error handling stay.

The old minimum-one campaign state checks now use local observed-state Sets
reset before each test and checked after successful fixed/random campaigns.
The same snapshot, rotation, and release state names are required. Native
determinism checks do not acquire those full-campaign census obligations.
Per-history resume cuts keep their original required states and logged binary
counts. Path replay retains its prior census exemption. This preserves the
existing checks without claiming new constructed-history reach guarantees.

All 122 runtime tests pass with coverage and type checking disabled and at most
two workers. The named replay manifest passes all 69 selected checks. Guarded
seed-42/path-0 replay of the tagged cursor/empty-second/held checkpoint cell
passes one test, skips 121, and reports one matching completed witness.
The existing `snapshot-rows` fault switch rejects the same snapshot replay with
one failed witness under the named snapshot law, preserving the original
`AssertionError:snapshot 0 applied rows` checkpoint and history diagnostic.
Removing that switch passes the same replay.

Targeted ESLint, Prettier, and `git diff --check` pass. The direct TypeScript
check reports only the same seven local dependency-resolution errors recorded
for the main Electric migration, with no diagnostics in the changed SDK owner.
Canonical installation and type checking run on integration. The run-budget
check's shared-seed alias warning is explained in the main migration record.

The replay manifest selects native random tests for all SDK properties and the
last assigned Electric legacy exception is removed. There is no production
change, mutation census, stronger provider claim, or bug-class closure.
