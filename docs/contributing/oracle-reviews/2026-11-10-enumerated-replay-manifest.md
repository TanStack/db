# Enumerated oracle campaign commands

Reviewed code: `bee143805816d687fb43bd8cadc81fe952470c29`.
Parent: `3b186f3d0d11d9ca17549fa191bd699049297e35`.
This changes test tooling only. It changes no shipped package behavior.

## Law and boundary

`oracleProperty` registers enumerated histories as named finite cases, followed
by calibrations and determinism. They have no generated campaign, campaign seed
or shrink path. The guarded replay contract requires a completed generated
property at the requested seed/path; it cannot witness an enumerated campaign.
Authority: the installed `@tanstack/oracles` enumerated-history API, its
`enumeratedTests`/`enumeratedTest` definitions, and the guarded replay contract in
`packages/db/tests/oracle-replay.ts`.

The manifest now marks explicitly registered finite properties as
`enumerated-campaign`. Their command selects that property's finite tests
directly and clears inherited replay coordinates. Its environment list is
empty. The guarded runner rejects this status before spawning a child and
provides the direct command. Generated properties keep their existing guarded
seed/path behavior. Literal owner discovery and the requirement that every
registered property has an owner remain unchanged.

## RED, GREEN and calibration

The new fixture has two selected cases and one case in a similarly named
neighbor. Its input integer is the independent expected value. The real Vitest
child runs the manifest command; the comparison judges its recorded value.

The initial regression ran before changing manifest status or guard behavior:

```sh
pnpm --filter @tanstack/db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/oracle-replay.test.ts -t 'enumerated cases|finite cases directly'
```

Both checks failed. The old manifest reported `assertion`, advertised the
seed/path wrapper and three replay variables, then launched a child that
skipped all five fixture tests. The wrapper reported zero executions. The
unchanged tooling was at `a014980ff`; the intervening parent commits changed
only the unrelated Preact literal-ID receiver and its evidence.

A second RED witness retained exported seed/path/property variables while
running the initial direct Vitest command. Vitest exited zero with all five
tests skipped. The regression rejected this result because three selected
tests had to pass. Clearing the three variables in the advertised command
made that witness GREEN.

The final command runs two cases and determinism: three passed, two neighbor
tests skipped. A neighbor that throws proves the selector excludes that
property. A wrong value fails the selected `finite value` comparison. The
test requires that law failure and a nonzero exit, not merely a process error.

Final validation on the reviewed code:

```sh
pnpm --filter @tanstack/db exec vitest run --maxWorkers=2 --coverage.enabled=false tests/oracle-replay.test.ts tests/replay-enumerated-oracle.fixture.test.ts
```

All 123 tests passed, with no type errors, in 127.57 seconds. The final focused
manifest/finite group also passed all 71 selected tests. The complete run
includes existing generated guard, filtering, exact-coordinate, failure,
cleanup and source-discovery checks. Formatting, normal ESLint and targeted
oracle lint passed. Whole-branch `pnpm lint:changed` reported only the inherited
`preact.window-render` budget-key removal, explained by its conversion record;
it exited nonzero for that report and showed no oracle rule violations.

## Review requirements and limits

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | Enumerated API authority and the absence of seed/path semantics are stated above and beside the manifest status. |
| ORC-002 | The fixture predicts a scalar from its input, without using framework routing or production semantic helpers. |
| ORC-003 | Fixture prose identifies its finite grammar, model, real child command, observations and value comparison. |
| ORC-004 | No generated grammar is added. The finite calibration enumerates two selected inputs and one neighboring input in full. |
| ORC-005 | The advertised command itself executes in a real child. Three selected tests pass; the two neighbor tests stay skipped. |
| ORC-006 | Wrong scalar output fails `finite value`; the throwing neighbor and exported-coordinate cases distinguish routing failures. |
| ORC-007 | Existing generated replay checks pass unchanged. New finite cases have no random campaigns or shrink paths. |
| ORC-008 | No stateful reference state is added; the fixture uses stateless scalar equality. |
| ORC-009 | The fixture integer is a calibration observation, not a runtime Collection or framework binding. |
| ORC-010 | The existing guard's failure/cleanup tests pass. The fixture owns no resources beyond its synchronously awaited child processes. |
| ORC-011 | No concrete shared semantic fault requiring a second formulation was identified. This is not an exhaustive search. |
| ORC-012 | This record identifies the exact implementation and all applicable requirements. |
| ORC-013 | A similarly named neighbor distinguishes the exact property selector from a prefix selector. No numeric threshold law is claimed. |
| ORC-014 | Real Vitest supplies the finite API premise. No provider or framework binding behavior is inferred from this fixture. |
| ORC-015 | No generated property is added or changed, so declared generated reach does not apply. The finite cases execute directly. |
| ORC-016 | The calibration fixture contains only `oracleProperty` registrations using its shared model and comparison. Supporting replay assertions remain in the existing tooling test file. |

This support adds direct finite campaigns, not guarded execution witnesses or
seed/path semantics for enumerated histories. Future receivers must register
their own literal IDs, actual receiving owner and enumerated status. No new
framework, provider or mutation-coverage claim follows.

The isolated worktree reused the integration checkout's dependency links.
Installation attempts added local-only overrides for blocked or unavailable
versions: `@tanstack/query-core` 5.107.1 to 5.106.1, `fake-indexeddb` 6.2.8 to
6.2.7, and `eslint-plugin-solid` 0.19.0 to 0.18.1. That fresh installation did
not complete; those overrides are uncommitted and are not the dependencies
used for this validation. Existing overrides were preserved.
