# Electric serializer and descriptor registration migration

This record accompanies the commit after `a64f37dde`. The serializer properties
and the two descriptor histories now register through `oracleProperty`.
Their existing independent checks, value domains, production paths, fixed
regressions, and calibration predicates stay. The native registration adapter
records the complete existing comparison's judgment; its model retrieves that
judgment and its check forwards it. This is no new product model or coverage
claim. Assertion failures retain their original error, stack, cause, and
secondary cleanup diagnostics. Other errors propagate as driver failures.

Serializer properties retain 100 generated inputs and fixed seed 20260930.
Descriptor tag histories retain 10 and seed 42712. Descriptor owner histories
previously ran 12 fixed and 20 fresh inputs; native fixed/fresh campaigns both
run 20, preserving the larger budget. Their seed remains 42711. The unchanged
raw fast-check omission/shrink/replay calibration now lives in
`pg-serializer-calibration.test.ts`, outside the oracle campaign file.

The law authority and limits remain in the serializer oracle's opening prose
and `runTagHistory`/`runOwnerHistory`. The shared finite-array comparison now
lives in `pg-serializer-property-oracle.ts`, which both the generated campaign
and ordinary calibration use. Replay manifest patterns select each native
random campaign. Two legacy exceptions are removed.

Validation used one worker, coverage disabled, and explicitly disabled type
checking because the local installation's source-resolution errors were
already recorded in the eager-receiver migration record. The final four-file runtime command passed all 150 tests in 3.45 seconds using
shared assertion transport `718e1f1e0` plus correction `da60ab854`. Those two
commits are prerequisites; the transport's seven ordinary tests run centrally.
The moved calibration retains its 25-candidate seed-90701 search and 100-run
replay options. Its options remain exported from the shared oracle companion so
run-budget accounting follows the moved execution.
The earlier
serializer-only run passed 137 tests in 2.30 seconds; the descriptor-only run
passed 13 in 2.13 seconds. Native replay-manifest checks passed 69 tests with no
type errors in 1.29 seconds. Targeted oracle lint and ESLint passed. The run-budget checker initially reported the moved calibration as removed; exporting its unchanged options from the imported oracle companion preserves its accounting key.

No production code changes, mutation census, state-reach improvement, new
real-provider claim, or bug-class closure is asserted. The existing controlled
ShapeStream boundary and finite serializer dialect limits remain. Canonical
installation/type checks run centrally on integration.
