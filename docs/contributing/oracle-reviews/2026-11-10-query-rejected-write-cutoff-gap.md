# Query first-result cutoff gap evidence

This receiving extension closes a source-mutation gap; it found no clean-production
cutoff defect. Keep the production cutoff lookup. The first experiment used
immutable candidate inputs; the final section records the integrated receiver
against the separately repaired Query source.

## Law and authority

A missing-key direct update/delete rejects without an accepted row edit. A stale
observer notification does not turn an unchanged successful fetched response
into a local cache edit. A new on-demand peer with `staleTime: Infinity`, no
invalidation and no accepted direct write can acquire that cached response
without a new provider request.

Authority is the Query guide's **Understanding the Data Stores**, item 1 and
**Direct Writes and Query Sync**, together with its `staleTime` option and the
primary ownership owner's existing `runDirectWriteOrderHistory` judgment:
`cacheStillFetched` permits acquisition without a request. The guide describes
update as editing an existing item, distinguishes accepted writes from fetched
responses, and keeps retained response reuse under `staleTime`/`gcTime`. This
candidate extends that established law across a rejected write and an observer's
own stale timeout. It does not derive expected behavior from the cutoff Map.

The independent model has one fetched response, no accepted direct write, and
one peer acquisition. It predicts the authored first row, one source owner, and
exactly one physical request. Production clocks, cache markers and branch
classifiers do not appear in the model.

## History and observation cuts

Histories generate raw/direct-wrapped response arrays, missing-key update/delete
rejection before fetch or during hydration, and a no-write neighbor. Values and
finite stale deadlines vary independently. Nine constructed builders retain
random neighboring values and enforce actual entered states.

1. Create an eager persisted Collection with a disabled observer and empty saved baseline.
2. Start a physical fetch through QueryClient after sync installed its cache listener.
3. Hold `hydrateBaseline()` after its real work completed; reject the authored write at its selected cut.
4. Release hydration and await first preload. Compare public/durable rows and source ownership, rejection and fetch count.
5. Deliver the actual scheduled Query stale callback through the explicit Query timer provider. Cross a native host task, await every returned public applied receipt until the list stays stable, and compare public/durable rows and unchanged fetch freshness.
6. Acquire a new on-demand peer with `staleTime: Infinity`. Compare peer rows/owners, source rows/durable rows and exact fetch count.

The clock abstraction changes `Date.now` and only Query Core's timer provider.
SQLite, worker and host timers remain real. It executes Query's actual scheduled
callback, not an invented observer update. A stale-only notification owes no
extra sync commit: commits/receipts are recorded as settlement evidence and
count diagnostics, with no positive-count product obligation. Cleanup restores
the provider after client cleanup and rejects leaked Query timers.

Product observations are judged in trace order. Missing terminal observations
are judged after recorded facts. The browser envelope forwards raw facts before
rethrowing reconstructed failure diagnostics. Detached page errors use a cursor;
errors that arrive between histories are consumed once by the next history.
The selected primary difference retains secondary browser diagnostics.

## Exact mutation and result

Frozen source SHA-256:
`6bbf1542e6daa38f33315445c5bb0ae3fbbf90d907cd388cb5d13f41c3b37cc5`.
Head when the final source SHA was checked: `0e86c1fdae85520aff142f141f71ccf46a8ee8bd`.
The source bytes are unchanged from the earlier frozen head.

Exact `query.ts:M1794`, value-undefined at frozen line 3327/position 121514,
replaces `fetchStartGenerations.get(hashedQueryKey)` with `undefined`, retaining
the direct-write fallback. Applied mutant SHA:
`8b1e6da9ea67aa7f5db33725a9ccab07481849748372b31f423f06f524a99150`.
The immutable transform verifies the original anchored substring, logs the
served SHA, uses distinct plugin/cache identities, and disables fsModuleCache.
No production file is overwritten.

The mutation loses the stored physical cutoff after a rejected write during
hydration. It leaves an older cutoff in the Map. The stale observer notification
then takes an unnecessary merge path and marks the still-fetched cache as a
local direct patch. The new peer refetches. Clean production makes one request;
the exact mutation makes two.

- Final controlled + actual Node SQLite: **30 checks GREEN**, `oracle-clean-final-4.log`.
- Final actual Chromium worker/OPFS: **15 checks GREEN**, `browser-clean-final-2.log`.
- Actual Chromium receiving-fidelity controls: **11 GREEN**, `browser-fidelity-final-2.log`.
- Exact Node mutation replay: **2 product assertion RED**, `oracle-M1794-replay-final-2.log`; base ID, seed1794, path `0:1:1:1`.
- Exact browser mutation replay: **product assertion RED**, `browser-M1794-replay-final.log`; distinct `.chromium-opfs` ID, same seed/path.
- Clean browser exact counterpart: **1 GREEN**, `browser-clean-replay-final.log`.
- Clean Node exact counterpart: **2 GREEN**, `oracle-clean-replay-final.log`.
- Generated-only missing-reach control: **2 RED** at `constructed states`, `generated-omission-replay-final.log`; base ID, seed1794/path `7`.
- Clean exact omission counterpart: **2 GREEN**, `generated-omission-clean-replay-final.log`.
- Strict TypeScript and typed ESLint: **GREEN**, `typescript-final.log`, `eslint-final.log`.

The final browser mutation's first violation is `peerFetches: expected 1,
observed 2`. It also retains a secondary closed-worker persistence diagnostic
from cleanup after the mutation's extra work. This is a recorded product
assertion RED with separate secondary runtime evidence. It is not a runtime-only
kill, and that diagnostic is not presented as a second independently diagnosed
production defect.

A prior clean browser rerun had 13 passing checks and one OPFS cleanup
`NoModificationAllowedError` (`browser-clean-final.log`). The final fixture
retries only that exact busy exception after awaited database close across real
host tasks, retaining each retry in `opfsCleanupRetry`; persistent failures still
throw and final artifact absence is required. Actual-browser controls calibrate
transient success, permanent failure, and preservation of an earlier product
mismatch through permanent cleanup failure. The original failed run remains
retained as cleanup evidence.

## Reach

Each campaign runs 20 generated histories plus nine randomized constructed
histories. Every state is enforced independently per host/campaign. Counts below
come verbatim from final logs; fixed histories are not used for reach credit.

- **controlled/fixed1794**: `{"before-rejected-write":9,"delete-rejection":8,"during-rejected-write":11,"no-write":9,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":12,"wrapped":13}`
- **controlled/random**: `{"before-rejected-write":7,"delete-rejection":10,"during-rejected-write":12,"no-write":10,"peer-acquired-fetched-cache":29,"raw":17,"stale-callback-delivered":29,"update-rejection":9,"wrapped":12}`
- **node-sqlite/fixed1794**: `{"before-rejected-write":9,"delete-rejection":8,"during-rejected-write":11,"no-write":9,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":12,"wrapped":13}`
- **node-sqlite/random**: `{"before-rejected-write":8,"delete-rejection":9,"during-rejected-write":17,"no-write":4,"peer-acquired-fetched-cache":29,"raw":15,"stale-callback-delivered":29,"update-rejection":16,"wrapped":14}`
- **chromium-opfs/fixed1794**: `{"before-rejected-write":9,"delete-rejection":8,"during-rejected-write":11,"no-write":9,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":12,"wrapped":13}`
- **chromium-opfs/random**: `{"before-rejected-write":11,"delete-rejection":6,"during-rejected-write":12,"no-write":6,"peer-acquired-fetched-cache":29,"raw":14,"stale-callback-delivered":29,"update-rejection":17,"wrapped":15}`


## Limits

One eager empty-baseline startup, one successful row response and one later
on-demand peer share a QueryClient. The fetched result is raw or an array
exposed directly by select. The peer remains unpersisted while the source uses
controlled storage, actual Node SQLite or actual browser worker/OPFS. There is
no arbitrary failed-I/O, accepted direct mutation, limit/cursor, concurrent tab,
remote server or every-scheduling-path claim. OPFS handle-release retries concern
fixture teardown, not a new database.close product law. A bounded source mutant
rejection closes this anchored gap; it is not a universal equivalence or whole-PR
readiness claim. Parent owns integration and a regenerated gap CLI report.


## Integrated current-source verification

The candidate was integrated into normal package commands after the independent
review. The source now includes the separate direct-insert/later-returned-value
repair. At working head `0e86c1fdae85520aff142f141f71ccf46a8ee8bd`, the tested
Query source SHA-256 is
`1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b`.
This section supplements the frozen-source evidence; it does not rewrite it.

The first normal Node run revealed that the package defaults to server runtime:
Query schedules no stale timeout there. The receiving wrapper now explicitly
uses Vitest jsdom, matching the controlled client premise. The Node SQLite
storage remains native. The first normal browser fidelity run revealed a
missing ready-function argument after reuse of the generic Chromium helper:
it waited for the default TrailBase entry. The bootstrap control now names
`runCutoffCandidate`. Neither repair changes the model or comparison.
An intermediate unprivileged browser attempt failed setup with loopback `EPERM`;
the authorized loopback-server runs below are the receiving evidence.

Normal commands, from the worktree unless otherwise noted:

```sh
# From packages/query-db-collection:
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/persisted-rejected-write-cutoff-oracle.test.ts --coverage.enabled=false
# From worktree root:
node node_modules/vitest/vitest.mjs run --config packages/browser-db-sqlite-persistence/vitest.adapter-oracles.config.ts packages/browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff-oracle.browser.test.ts packages/browser-db-sqlite-persistence/tests/query-rejected-write-cutoff-browser-fidelity.test.ts
```

- Normal controlled + native Node SQLite: **30 GREEN**, `integration-node-2.log`.
- Normal actual Chromium worker/OPFS plus fidelity: **26 GREEN** (15 oracle and 11 controls), `integration-browser-3.log`.
- Strict scoped TypeScript: **GREEN**, `integration-typescript.log`.
- Typed ESLint after relative-import ordering: **GREEN**, `integration-eslint-2.log`.

The exact operator was reanchored at current line 3326/position 121475. It still
replaces only `fetchStartGenerations.get(hashedQueryKey)` with `undefined`.
Both immutable receivers logged applied mutation SHA-256
`59922ebe9a534c8272fabe9503676c495830aeeed4db0a3d5cc85eff914502e6`.
They retain separate plugin/cache identities and `fsModuleCache: false`.
The earlier old-anchor attempt `oracle-M1794-replay-final-3.log` is a setup
anchor mismatch, not a kill.

Current-source direct replay commands:

```sh
QUERY_CUTOFF_CANDIDATE_MUTANT=query.ts:M1794 TANSTACK_DB_ORACLE_PROPERTY=query.persisted-rejected-write-cutoff TANSTACK_DB_ORACLE_SEED=1794 TANSTACK_DB_ORACLE_PATH=0:1:1:1 node node_modules/vitest/vitest.mjs run --config /private/tmp/tanstack-db-2394-query-cutoff-candidate/integration-mutant.config.ts
QUERY_CUTOFF_INTEGRATION_RECEIVER=browser QUERY_CUTOFF_CANDIDATE_MUTANT=query.ts:M1794 TANSTACK_DB_ORACLE_PROPERTY=query.persisted-rejected-write-cutoff.chromium-opfs TANSTACK_DB_ORACLE_SEED=1794 TANSTACK_DB_ORACLE_PATH=0:1:1:1 node node_modules/vitest/vitest.mjs run --config /private/tmp/tanstack-db-2394-query-cutoff-candidate/integration-mutant.config.ts
```

Remove `QUERY_CUTOFF_CANDIDATE_MUTANT` for each exact clean counterpart.

- Integrated Node mutant: **2 assertion RED**, `integration-node-M1794.log`; both fail `peerFetches`, expected 1/observed 2.
- Exact clean Node counterpart: **2 GREEN**, `integration-node-clean-replay.log`.
- Integrated real Chromium mutant: **1 assertion RED**, `integration-browser-M1794-2.log`; same checkpoint and difference.
- Exact clean Chromium counterpart: **1 GREEN**, `integration-browser-clean-replay-2.log`.

The current browser mutant also preserves the secondary closed-worker
persistence diagnostic. The first failure remains the recorded physical-request
count assertion. This is not a runtime-only mutation rejection.

Current normal campaign reach, verbatim:

**controlled and node-sqlite**

```text
query.persisted-rejected-write-cutoff fixed seed 1794 reach {"before-rejected-write":9,"delete-rejection":8,"during-rejected-write":11,"no-write":9,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":12,"wrapped":13}
query.persisted-rejected-write-cutoff random seed reach {"before-rejected-write":8,"delete-rejection":8,"during-rejected-write":13,"no-write":8,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":13,"wrapped":13}
query.persisted-rejected-write-cutoff fixed seed 1794 reach {"before-rejected-write":9,"delete-rejection":8,"during-rejected-write":11,"no-write":9,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":12,"wrapped":13}
query.persisted-rejected-write-cutoff random seed reach {"before-rejected-write":9,"delete-rejection":9,"during-rejected-write":12,"no-write":8,"peer-acquired-fetched-cache":29,"raw":14,"stale-callback-delivered":29,"update-rejection":12,"wrapped":15}
```

**chromium-opfs**

```text
query.persisted-rejected-write-cutoff.chromium-opfs fixed seed 1794 reach {"before-rejected-write":9,"delete-rejection":8,"during-rejected-write":11,"no-write":9,"peer-acquired-fetched-cache":29,"raw":16,"stale-callback-delivered":29,"update-rejection":12,"wrapped":13}
query.persisted-rejected-write-cutoff.chromium-opfs random seed reach {"before-rejected-write":13,"delete-rejection":7,"during-rejected-write":14,"no-write":2,"peer-acquired-fetched-cache":29,"raw":11,"stale-callback-delivered":29,"update-rejection":20,"wrapped":18}
```

Integrated file SHA-256 values after import-order lint repairs:

```text
5213eab0a015540fa56cb4b52ced862c428aa494d963b4b63ad3de2b08e8706e  packages/query-db-collection/tests/persisted-rejected-write-cutoff-oracle.ts
7125e59272f591c940335e59fcefc4faaba687deaea7b160269c8c6d0af4d8d9  packages/query-db-collection/tests/persisted-rejected-write-cutoff-oracle.test.ts
f2d47cad12d8b0892714f0c756b88403a064296217cda1054b93a13729bd0287  packages/browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff-oracle.browser.test.ts
2d9e94072d125e911c3d511739f040f9380a04868f58272d272721a5328b5309  packages/browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff.opfs.ts
bc217494ee30536e8942b4ee398411fc5f2720fb52c636c90c5a9ea52b86b014  packages/browser-db-sqlite-persistence/e2e/query-rejected-write-cutoff-cleanup.ts
b24f2dc1c266395a35f1ccd4277b16f4a6ed0dc264bc072fb20ee1f2fb4269c5  packages/browser-db-sqlite-persistence/tests/query-rejected-write-cutoff-browser-fidelity.test.ts
```

The stated limits remain in effect. This closes the anchored M1794 gap; it does
not establish whole-PR readiness. The parent owns the regenerated gap report,
coverage-map integration, and branch-wide lint.
