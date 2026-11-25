# TrailBase hydration calibration bindings

Self-review of source commit `7cd1d0a7128c276cea455d190b894e7942e39fbb`.
Scope: calibration selection in `lifecycle-hydration-oracle-suite.ts`.

The ten calibrations previously searched fixed and generated histories. Each
missing-state corruption applies only to its own generated construction. The
last state replayed 33 real Chromium histories to locate that premise. An
explicit binding executes one. The framework now requires that selected clean
trace to pass; it cannot search past a failing baseline. The missing-state
comparison also requires the exact state in the violation's difference.

The model, production driver, comparisons, 24 fixed histories, fixed/fresh
50-history campaigns, nine five-base constructions per campaign, and 90 units
per host remain. All nine reach states still have five required generated
entries in each campaign. This is a calibration-work refactor, with no shipped
production change or revised product law.

## Executed evidence

- Node 22 controlled storage and real Node SQLite: 180 units pass, with no type
  errors. Select the `trailbase.lifecycle.persisted-hydration.` properties in
  `tests/lifecycle-oracle.property.test.ts`.
- Actual Linux Chromium/OPFS: all 90 units pass in
  `tests/trailbase-hydration-oracle.test.ts` under the browser adapter config.
- The same isolated `old-row-omitted` calibration passes before and after:
  33 receiving calls become one. Recorded component times were 63.7s and
  1.24s on a busy supplementary host; these are not a stable speedup estimate.
- A checker mutant that replaces missing-state detection with an empty list
  fails the bound Chromium calibration: the corrupted trace passes the mutant,
  so the framework rejects it for failing to report `constructed builder reach`
  and `generated construction omitted old-row-omitted`. This is an assertion
  failure at the intended calibration checkpoint. The source was restored.

## Guide check

| Requirement | Binding-change evidence |
| --- | --- |
| ORC-001 | Existing cleanup authority and product-law limits remain. |
| ORC-002 | The independent row model and comparisons are unchanged. |
| ORC-003 | Prose explains selection, clean-run validation and corruption. |
| ORC-004 | Grammar and all its axes are unchanged; selected cases belong to its registered sources. |
| ORC-005 | All three existing production paths pass their shared checks. |
| ORC-006 | All ten bound calibrations pass; the missing-state checker mutant fails at the named law. |
| ORC-007 | Both 50-history campaigns and direct replay coordinates remain. |
| ORC-008 | No model state changed. |
| ORC-009 | No concept or observation was renamed. |
| ORC-010 | Bound clean failures propagate directly; cleanup machinery is unchanged. |
| ORC-011 | No shared semantic fault or alternate product formulation is proposed. |
| ORC-012 | This source-specific self-review records the refactor's evidence and limits. |
| ORC-013 | Each missing-state mutation binds the construction declaring that state; row loss uses a nonempty ready replacement. |
| ORC-014 | Controlled, Node SQLite and actual Chromium share the same model and comparison. |
| ORC-015 | All nine constructed-state obligations and five-base campaign checks remain. |
| ORC-016 | Calibration inputs and corrupted traces use the existing shared checker; no ordinary tests were added to an oracle. |

## Limits

The supplementary concurrency experiment recorded timeouts under substantial
shared CPU contention, including one in an ordinary generated campaign. Binding
calibrations does not establish closure of every timeout or cleanup cascade.
Those failed trials remain invalid performance evidence. This review establishes
selection and calibration sensitivity for the existing bounded contract; it
makes no universal lifecycle or full-CI timing claim.
