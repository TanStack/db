# Persisted startup: framework integration

This append-only record follows the gap-fill commit
`b26629dfe6fb2ff910cc7141fdc0d78e436f5b5a` and merge
`29de8a92e3aae74dc4c1c2c2d2d47e6edd44dc86`. The merge incorporates main's
`caa936d5a` and the exact oracle framework at
`e1fb5048c6d33e958643360d87e168c302e03bd1`. It changes no shipped production
source from the measured `5feb26616a8357853454c2f9ff2ce0b0adb9c908`.

## Campaign integration

Five campaign files now use `oracleProperty`: shared persisted startup,
shared eager reload, shared persistence-capability admission, Query persisted
write precedence, and Query retained-scope/cache provenance. Their existing
models, authorities, fixed histories, receiving paths, observation cuts and
base run budgets remain. No entry was added to the frozen legacy list.

The conversions retain generated variation in constructed histories, fresh
object identity, and a local obligation for each generated construction. Each
state has a missing-state control. Fixed histories supply no required reach.
The records below explain the pinned framework's generated-construction map
limitation and the local checks that prevent a false green.

- [Startup conversion](2026-11-10-startup-property-conversion.md): 710 checks
  across six adapters and two Node hosts; every state reached separately in
  all 24 host/campaign runs. The shared independent set judgment still runs
  at the original public and durable cuts.
- [Query conversion](2026-11-10-query-oracle-property-conversion.md): 400
  checks across three properties and both Node hosts; all seven previously
  rejected selected source operators still fail at their intended cuts.
  Eight distinct guarded replay coordinates pass on clean source and fail
  their respective source or generated-reach controls.
- [Reload/capability conversion](2026-11-10-adapter-reload-gaps.md#oracleproperty-conversion-after-main-merge):
  88 reload and 92 capability checks; both historical snapshot mutants remain
  rejected. A determinism failure exposed permitted SDK/optimistic settlement
  schedules. The unchanged raw checker judges each actual schedule before
  the framework records its verdict. Five pre-projection corruptions show
  that this abstraction preserves the original observation obligations.

The post-conversion Chromium run passes all 226 receiving histories in 3.1
minutes. It uses the existing Playwright witness, real Chromium, worker SQLite
and OPFS, the same shared judgments, and six separately checked reach groups:
104 precedence, 48 retained scope, two cached peer, 24 TrailBase hydration,
24 RxDB reload and 24 PowerSync reload. All required counters are positive;
the spec also checks browser errors and fixture cleanup. This is receiving
evidence, not a claim that importing the Vitest constructor converts a
Playwright registration. The log is
`.review-2367/gap-fill/opfs-after-framework.log`.

A separate read-only agent reviewed these conversions against `b26629dfe` and
found no supported enforcement regression. Its in-memory registration probe
checked 12,300 constructed outputs for grammar membership, fresh identity,
declared-state entry, retained variation and missing-state controls. Each
builder retained 8–100 distinct outputs over 100 generated inputs. This probe
checks instrument construction; it invokes no production and supplies no
replacement for the real-host or mutation evidence.

## Remaining ratchet work

Main's new policy requires a kill or explicit maintainer allowance for a gap
in a changed function. Bounded equivalence does not close it. The four prior
survivors therefore remain open: Query `M563`, `M1473`, `M1794`, and TrailBase
`M151`. No allowance has been requested or assumed. Two earlier full-package
Query timeouts also remain separate from assertion kills.

The five conversions above do not discharge the older ownership-lifecycle or
TrailBase lifecycle/eager-source owners. Before any further production edit,
their affected laws and required real-browser receiving paths must pass the
conversion gate. Removing a condition merely to improve a mutation score
would not supply that gate or establish a sound simplification.

The final same-seed CLI comparison is a separate experiment. Its stable-key
retention and current classifications will be appended here after completion;
the earlier audit's 49 initial kills plus six additive kills remain historical
executed results, not a substituted final CLI run.

## Startup cost

The [paired measurement report](2026-11-10-persisted-startup-measurements.md)
and its raw CSV remain applicable because the production source is unchanged.
They show a PowerSync 10,000-row matching-baseline median increase from 274.7
to 320.1 ms. At 50,000 rows, sampled heap maxima rise by 44.2 MiB for RxDB
and 71.7 MiB for PowerSync. Network-first fallback still becomes ready before
the held source in that measured scenario. These local measurements establish
neither performance parity nor browser paint times. No performance repair is
implemented by a test-framework conversion.
