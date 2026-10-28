# Convex integration with Collection health, October 28

This record binds PR parent `969078c19d4a4e7a888d4d4466e3d0d99a1372cc`
and main parent `7d9ed02e085d11e871e4b6424d47e3c0d7073023`, plus the
source hashes below. Main merged #2168, the maintainer's new Collection status,
health, reload and cleanup contract. This is a normal merge, without rewriting
published history. The only textual merge conflict was the DB oracle command;
its union retains main's hydration owner and the PR's joint replay owner.

## Law and repair

Authority: `.changeset/source-health-channel.md`, the project glossary's status
and health terms, and live-query architecture laws 14, 16 and 17 from #2168.
A failed first load is final for its sync run and recovers through `reload()`.
After readiness a recoverable provider or projection failure preserves rows,
reports `failureReason`, and a valid observation clears it. A rejected source
acceptance remains terminal and needs a new sync run. Reload must use its own
run's readiness, since public Collection status can still describe the prior
run. The adapter uses the new fail/reportError/reportHealthy controls and folds
terminal first-load failure into the existing rejected-acceptance slot.

The existing snapshot owner was false green for health because it observed
rows and getSyncError only. Before the production edit, it gained status and
health comparisons. Its initial-invalid recovery driver now explicitly reloads,
under the maintainer's new contract. All typed-key, cardinality, field-removal,
deletion, atomic duplicate rejection and recovery comparisons remain.
The offline source owner likewise reloads after a failed first load.

The core joint replay model previously waited for obsolete provider promises.
Law 16 now says abort ends the load for core immediately. The model drops those
participants while retaining every accepted receipt obligation. A generated
history observes the new replacement while the aborted provider promises stay
pending. The failure, ordinary-write hold, surviving peer and restart comparisons
remain. The terminal-graph models now expect `crashed`, preserving their exact
last-row comparisons. Component and actual-backend drivers use internal lifecycle
teardown to exercise that internal boundary. Public cleanup admission is checked
separately and must reject under an active dependent. A synchronous adapter throw
is now checked as a rejected load, as law 16 specifies. No history is skipped.

## Reach and RED

On the unchanged Convex adapter after merging main:

- `pnpm --filter @tanstack/convex-db-collection typecheck` rejected removed
  `markError` use.
- `pnpm --filter @tanstack/convex-db-collection exec vitest run tests/snapshot-oracle.property.test.ts tests/offline-oracle.property.test.ts`
  rejected a missing health failure reason at seed 20261022, path
  `0:0:0:0:0`, snapshot `[0, "", [[]]]`. This is a semantic comparison failure
  after ready, independently of the startup removed-method runtime errors.
- The full adapter run had 24 failures among 112 cases, including removed-method
  errors and changed cleanup/throw contracts.
- The unchanged joint replay model failed at seed 20261027, path `0:0:0:0:0`,
  at public publication during held-receipt application. It predicted the old
  rows while current work had completed and obsolete work was aborted. This
  exposed a model contract migration, not a reason to restore obsolete waits.

## GREEN and calibration

- Full adapter suite: 112 cases in 21 files, no type errors.
- Snapshot owner: fixed and random 150-history campaigns each reached all 13
  declared states 150 times, including initial duplicate rejection and recovery.
- Offline source and acceptance owners retain their fixed/random campaigns.
- Core ordered-work owner: all 272 cases pass. Joint replay owner: fixed and
  random 35-history campaigns each reach all five declared states 35 times.
- All 302 offline cases pass; all four React receiving cases pass.
- All 23 actual backend cases in eight files pass on the final adapter, using
  isolated local backends, both SDKs and pinned official application functions.
  No production cloud infrastructure is used.
- Frozen lockfile install, both Convex/offline typechecks and changed lint pass.
- Doc sweep: 790 examples, zero new failures; 272 unchanged baseline failures,
  including 61 parse failures.

A temporary production mutant omitted reportError after readiness. Snapshot
replay at seed 20261022/path `0:0:0:0:0` rejected it at the health comparison,
expected true and observed false. The mutant was removed. A separate joint
checker calibration changes an observed row's version and must fail its exact
publication comparison. It is a wrong-observation control, not a production
mutant or a claim about native provider behavior.

## Weight and limits

`pnpm size:compare --base HEAD --exact-base --packages convex-db-collection`
compares the published PR parent with the merged working tree. Convex grows
from 4106 to 4145 gzip bytes (+39), and +32 brotli bytes. The migration reuses
one terminal-failure slot rather than adding a parallel failure machine. Its
one new run-readiness bit is required because reload retains public status;
using that status would misclassify a new run's first failure. App scenario
sizes also include incoming main's health implementation, about +3069 gzip
bytes for the app scenario; they are not attributed to Convex alone.

These generated health comparisons cover the controlled callback boundary,
finite arrays, raw/projection paths and accepted/rejected receipts. The actual
backend suite supplies receiving regressions for authentication, paging,
reconnect, writes and interruption. It does not establish arbitrary cloud
failures, OAuth browser flows, all framework schedules or universal histories.
Core's source-health owner remains primary for health-tree composition and
public cascade cleanup. CI on the pushed merge still needs independent
verification before this head can be declared ready.

## Guide outcomes

ORC-001: #2168, the glossary and architecture laws 14/16/17 authorize the changed
predictions and limits above. ORC-002/003: snapshot expectations still come from
input arrays and pairwise key equality; the joint model retains only authored
snapshots, current obligations and accepted receipts, with updated local prose.
ORC-004: constructive valid/invalid starts and duplicate/recovery prefixes remain;
raw/selected paths, all three typed-key lanes and generated suffixes remain.
The joint grammar retains both obsolete outcomes, both owner settlement orders,
1-4 rows, 1-3 ordinary writes, peer retirement before/after acceptance, and
cleanup before/after receipt release. Removing abort loses the changed boundary;
request-scoped writes after abort remain excluded. ORC-005: real Collection
callbacks and typed entries compare at each delivery/publication; the recorded
RED and controls prove the checkpoints ran. No missing-input hypothesis is used
to excuse an earlier result. ORC-006: production reporting mutant and joint
wrong-observation control fail at their intended assertions. ORC-007: matching
fixed/random campaigns and direct seed/path replays pass after restoration.
ORC-008/009: obsolete load completion no longer distinguishes public readiness,
but accepted receipts remain separate because their application still does.
Terms follow the glossary. ORC-010: existing withTestCleanup/withOracleCleanup
retains primary and secondary failures. ORC-011: no new shared-semantic-fault
hypothesis requiring another independent formulation was identified.
ORC-012: this record binds the reviewed sources and scopes the claim.
ORC-013: first-invalid versus ready-invalid and current-complete versus
obsolete-pending histories distinguish the changed boundaries. ORC-014: health
comparison is controlled-boundary evidence; the actual backend receiving suite
is separate regression evidence, not a cloud health-tree closure claim.
ORC-015: normal campaigns enforce the measured reach counts reported above.
ORC-016: no standalone example or type assertion was added to an oracle file;
existing shared drivers and comparisons carry the changed judgments.

## Source binding

- `packages/convex-db-collection/src/options.ts`: `d3194929c80c16cc6f3240ed573030de80592cbb7d6a87a415df7713fe512449`
- `packages/convex-db-collection/tests/snapshot-oracle.property.test.ts`: `c4607e12ac1b48cf9b894ae5ef28875cc9689219460f84b5408d69d5463acfd2`
- `packages/convex-db-collection/tests/offline-oracle.property.test.ts`: `308607afafbe503159a524328950a5116d899d43cd5506863e0293f7412369a3`
- `packages/convex-db-collection/tests/lazy-paging-model-oracle.ts`: `a410a4c81af20a4ffa27718631237401049567504daed29b22c1a172f8420dcb`
- `packages/convex-db-collection/tests/lazy-paging-oracle.property.test.ts`: `08a477e3605d37011408f57636f0ec5c47c4b5ee3503a026adb28b29467de57a`
- `packages/convex-db-collection/tests/lazy-paging-failure-history-oracle.property.test.ts`: `1953376c011658befdd11d29ba911c7dfad9b5dfa5a02abdb6b5c29b84ca5bd6`
- `packages/convex-db-collection/tests/lazy-paging-receipt-oracle.property.test.ts`: `f56ab7ca6deaebc60d331d99edaa3504134582b71ae80ded9073c2b76c7a9bbf`
- `packages/convex-db-collection/e2e/lazy-boundary-oracle.test.ts`: `4c0815a68426233a3860c52ca307779a98a79179bccccdd855947ea1023283de`
- `packages/db/tests/query/load-subset-joint-replay-oracle.property.test.ts`: `93efd32d76d74d4cd815659e9adb4a0e29183041369dac1fff350a9e58f34a54`
