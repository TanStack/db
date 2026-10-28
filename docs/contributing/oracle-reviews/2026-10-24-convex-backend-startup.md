# Local backend startup review

Reviewed source and test commit: `4b37df090402469cafed0cf9f5e16b9528dae60f`.
This follows the [public-app receiving review](2026-10-24-convex-public-apps.md)
and [auth dependency update](2026-10-24-convex-auth-dependency-update.md).
It concerns test setup and workspace discovery, not an adapter production defect.
There is no shipped adapter production code change.

The root agent reported that the browser CI job exited before test collection
with the official Convex CLI error `Requested port 43330 is not available`.
That establishes an unavailable requested port. It does not establish which
process occupied it or why. The fixture had imposed that machine-wide port
requirement itself.

## Contract and repair

Without a user port override, the fixture should start an isolated local backend
on available ports rather than require its former fixed numbers. The reviewer
inspected all three setup call sites and the installed Convex 1.47 CLI source.
Its anonymous deployment path calls `chooseLocalBackendPorts`, which delegates
to `detect-port`: explicit requested ports are mandatory, while defaults and
suggestions can select other available ports. The default search starts at
3210. The test does not calculate or promise the allocator's exact result.

All three setups now omit mandatory port arguments by default. The existing
`CONVEX_TEST_PORT` override still supplies an explicit port to the main fixture.
The shared launcher retains strict loopback URL validation and verifies the
exact requested port when one was supplied. No custom free-port allocator,
retry loop, or silent fallback for an explicit override was added.

A separate workspace discovery issue was also repaired. Auth setup creates an
ignored `auth-app/runtime/package.json`, which the broad `packages/**` workspace
glob could discover during concurrent pnpm checks. An exact exclusion now keeps
that generated runtime out of the workspace project set. The real auth fixture
remains a workspace package. This changes configuration, not dependency versions
or lockfile resolutions.

## Witness and execution evidence

`e2e/backend-startup-oracle.test.ts` supplies an independent resource judgment:
while the old public fixture port 43320 is occupied, setup must fulfill and
provide another loopback port serving a fresh empty upstream messages query.
It invokes the actual pinned public-app setup and queries the real backend.
Expected startup success and empty data do not come from copying CLI selection
logic. An explicit startup-fulfillment assertion precedes the URL and query
observations.

The reviewer inspected that test, the setup changes, cleanup paths, workspace
exclusion, and installed CLI implementation. The following execution evidence
comes from the author and root agent, it is not presented as an independent
rerun by this reviewer:

- Restoring the former fixed 43320 setup argument failed the startup-fulfillment
  assertion in 292 ms with `Requested port 43320 is not available`. This is the
  intended startup outcome comparison. The later query checkpoint was not
  reached, so this is not a failure at a data comparison.
- Restoring default allocation passed in 1.05 seconds and reached the actual
  upstream empty-page query, including `isDone: true`.
- The first combined 18-test run passed with normal allocation. A second run
  held port 43330 from before pnpm and global setup began, matching the occupied
  auth-port condition from CI, and all 18 tests passed in 33.69 seconds. The root
  agent verified and terminated its own blocker afterward. Only this second
  run establishes the specifically occupied auth-port condition.
- Final package typecheck and ESLint passed. With a synthetic generated runtime
  package present, `pnpm list -r` succeeded and excluded it. The synthetic runtime
  was removed afterward.

The fixed startup witness runs in the normal backend suite. It releases its own
listener and backend independently through the existing failure-preserving
cleanup instrument. `EADDRINUSE` is accepted as an observation of an existing
external owner at bind time, that owner's lifetime is not leased by the test,
and the test never closes it.

## Scope

This closes the fixture's mandatory-default-port assumption for the reviewed
serial setup paths. The public fixture regression observes the shared startup
boundary directly; the complete suite also receives the auth setup under its
formerly required occupied port. The source inspection confirms that all three
call sites delegate their default choice to the same supported CLI path.

This is a fixed native startup witness, not a generated port-allocation model
or a proof against every concurrent bind race. It does not promise startup when
no ports are available, override an occupied port explicitly requested by a user,
or identify the owner of the original CI port. Network access and backend
availability remain setup prerequisites. Existing public-app, auth, pagination,
and offline contracts and their recorded limits are unchanged.
