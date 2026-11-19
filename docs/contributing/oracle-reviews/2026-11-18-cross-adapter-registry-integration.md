# Adapter campaign entry points and replay integration

The root commands `pnpm test:collection-adapters:oracles` and
`pnpm test:collection-adapters:oracles:browser` select the adapter receiving
portfolio. The first attempts ten Node groups; the second attempts five actual
Chromium groups. They retain every nonzero child exit, signal, missing status,
or spawn failure while attempting subsequent groups. They exit nonzero if any
group failed. `--list` prints the command manifest without running campaigns.
This review does not claim that the aggregate adapter campaigns are GREEN.

Package scripts name all Node owners for RxDB (10 files), native PowerSync (8),
Direct PowerSync (13), and TrailBase (8). Actual Vitest file discovery also
confirmed the intended Query (26), Convex (22), and Electric (12) script inputs.
Neon's explicit Node configuration discovers five files; its default package
configuration excludes these receivers. Browser configurations discover the
local-storage, Electric, RxDB, shared worker/OPFS, and Neon receiving files.
The named replay manifest integration passed 70/70 after adding Neon and
persisted-cursor routes. These are discovery and runner results, rather than
adapter behavior results.

## Independent runner review

The independent reviewer approved the runner and package wiring on 2026-11-18.
The reviewed runner SHA-256 is
`d048b720dfde9c4d40e9ed1d3640ecaa292a1d5080bf9ab6f0f95f719960ada0`.
The ordinary test SHA-256 is
`29f36ba8c58d7bdd51b7f56d6b74dfad9f8d5eeb9d20ed7c15cfa0472f872710`.

Its first pass reproduced a test portability defect: `URL.pathname` retained
`%20` in subprocess arguments when the checkout path contained spaces. Both
test call sites now use `fileURLToPath`. The reviewer reran all five ordinary
checks in the normal checkout and the same path-with-spaces fixture; each
passed 5/5. The runner already used native file paths and needed no behavior
change.

A separate actual CLI control installed a temporary pnpm recorder through
`npm_execpath`, without executing adapter campaigns. It made the first group
exit 13. The Node command attempted 10/10 groups, and the browser command
attempted 5/5; both exited 1. Every child used native Node 24.19.0 and the
repository root as its working directory. All referenced package names,
scripts, browser configurations and include patterns resolve. The review
found no removed prior test path or script, runtime declaration change,
Node 26 requirement, skip, or failure masking.

Local review logs are `/private/tmp/pr2377-aggregate-runner-final-review.log`,
`/private/tmp/pr2377-aggregate-runner-space-final-review.log`, and
`/private/tmp/pr2377-aggregate-cli-review-summary.json`. Repository-scoped
evidence includes `.review-2377/cross-adapter-registry-integration-final.log`,
the discovery logs, and `cross-adapter-registry-final-lint-changed.log`.
Scoped ESLint, `pnpm lint:changed`, and `git diff --check` passed.

## Reload provider-completion amendment

The shared reload production driver now requires an independent provider
completion barrier before recording its verdict. It must reach the raw check
for a complete empty result even when the adapter calls neither `commit()` nor
`markReady()`. The shared reload/snapshot and optimistic-settlement laws remain
unchanged. No production implementation changed in this amendment.

These four final receiving fixtures supply the premise:

| Receiving fixture | Actual delivery premise | Final SHA-256 |
| --- | --- | --- |
| `convex-db-collection/tests/eager-reload-driver.ts` | Pending complete `Transition` deliveries return after the real SDK socket handler consumes them; SDK turns drain finite scheduled callbacks. JavaScript, React and wrapped clients share the barrier. | `061dc0f09bfadc3f169d2cf6d032613b19db8391131a6368adce8da6a0a2320e` |
| `rxdb-db-collection/tests/eager-reload-driver.ts` | The actual source storage query returns its final empty page. A transparent source-only storage facade prevents fixture `RxQuery` reads from establishing that premise; the resolver is captured per sync run. Finite continuation turns follow exhaustion. | `5ea628e11c42c622c0d95d8e785929148556e9257e340f5fc8b7b79924a56b84` |
| `trailbase-db-collection/tests/sdk-eager-reload-driver.ts` | The actual SDK `RecordApi.list` fulfills after decoding JSON. The adapter requests that list only after consuming its actual SDK subscription. Three source keys fit one complete page, including an empty result; finite load/start continuations drain afterward. | `6739a57fd4b7ba2809fbafb53138bcba89621e4e78c4a5a606a6846b979bb6a0` |
| `db/tests/local-storage-eager-reload-driver.ts` | Storage read, decoding and source callbacks finish synchronously within source entry, so its barrier is an already fulfilled promise. | `100a986dec3b4ce5d1de9051eae173701bdc0dd2884dbd766b0f022103b8cce8` |

None of these barriers polls the tested Collection's readiness, public rows,
commit count or applied receipts. Delivery is the premise; task turns only
drain the identified finite continuations. The shared owner retains all eleven
declared states, randomized constructions, fixed seed and unseeded campaigns,
80-history run budgets, models and comparisons.

Affected Node campaigns passed: Convex 318/318 across its three clients, RxDB
106/106 on the final source-only facade, TrailBase SDK 106/106, and localStorage
106/106. The independent runtime reviewer reran Convex and RxDB. Earlier RxDB
evidence at `ff29699e...` is preliminary: that version also observed fixture
helper queries, and the source-only facade above supersedes its premise.

Six actual SDK controls pair the same fresh-empty history with a clean run and
a source-boundary mutation suppressing both `commit()` and `markReady()`.
Convex JavaScript/React/wrapped, RxDB, TrailBase and localStorage each accept
the clean neighbor. Every mutated run returns a pending raw observation, and
the shared checker rejects both `load pending after complete source
application` and `complete source submission not reached`. All six controls
passed. These are assertion rejections at the intended comparison, rather than
timeouts or setup failures. Local source and execution evidence is under
`.review-2377/reload-provider-barrier-controls.*`; the scratch test imports the
same production driver and judgment as the generated campaigns.

The independent enforcement reviewer inspected all four final fixture hashes
and the six paired controls, and approved this bounded amendment. Its verdict
establishes independence from the missing callbacks at the specified empty
delivery cut. It does not establish deployed-service behavior, arbitrary
continuation schedules, remote replication, persisted demand coverage or
cursor selectivity. Separate receiving owners and review records retain those
obligations. Per-fixture campaign logs are
`trailbase-reload-provider-barrier.log`,
`local-storage-reload-provider-barrier.log`, and
`shared-reload-source-only-final-independent-rxdb.log` under `.review-2377/`;
the shared runtime review records the Convex result.

After the final facade edit, package TypeScript checks passed for RxDB, Convex
and TrailBase, and scoped ESLint passed for all four receiving fixtures and the
runner portability repair. The runtime reviewer also reported a clean global
`pnpm lint:changed` result. No run budget changed.

## Neon removal replay registration

Registered `adapter.neon.idempotent-removal.sdk` with
`tests/neon-idempotent-removal-oracle.property.test.ts` and the explicit Neon
Node configuration. Registered `adapter.neon.idempotent-removal.sdk.chromium`
with the existing browser owner and `vitest.neon-browser.config.ts`. Both use
the canonical random-campaign replay route and seed/path/unit environment.
The author had already added the Node file to `vitest.neon.config.ts`; its
actual discovery now lists six files. The dedicated browser configuration
discovers the existing receiving owner. Existing portfolio commands select
these configurations, so no additional package-script change was needed.

The named manifest check passed 70/70, scoped ESLint passed, and both guarded
seed-2377/path-`0`/unit-`random seed: generated` replays witnessed exactly one
semantic execution. Both remain RED on the existing absent-removal bug:
`PUB-3/FID-4 (health error)` at shared checkpoint 1, reporting an unknown row
deletion. Node reached `{baseline:1, absent:8, value:-3, ordered:true,
repeats:3, path:"absent"}`; Chromium reached the equivalent absent-ID-10 history.
These are positive replay-routing witnesses and product RED results, not
repaired-adapter GREEN claims. The current vendored source hash was
`6e14db8bc37463918bae326cc5a89a730c07ca36ce1d2190f2dddab65b44b51d`.
No oracle source or production code changed in this registration task.

Logs are `.review-2377/neon-idempotent-removal-registry-manifest.log`,
`neon-idempotent-removal-node-discovery.log`,
`neon-idempotent-removal-browser-discovery.log`,
`neon-idempotent-removal-node-replay.log`, and
`neon-idempotent-removal-browser-replay-approved-host.log`. The initial browser
attempt could not bind localhost and recorded zero executions; it was a setup
failure. The approved-host retry above supplies the actual Chromium RED.
