# O26 finite reach inventory (read-only, 2026-10-28)

Scope: all tracked changed and untracked source/test files in the RC oracle working tree relative to HEAD `858b174a65f160d13d01f0324c7481cc8e4eba3a`. Source inspection found 36 createOracleReach call sites in 24 files: 28 default-policy sites in 19 finite-owner files; eight explicit `replaying:false` sites in five files. Pure models and support drivers do not add their own counters.

## Confirmed mechanism and experiment

`packages/db/tests/oracle-reach.ts:31-38` interprets any shared seed OR path as replay unless overridden. None of the 28 finite lanes below has a direct seed/path selector: they enumerate ordinary `.each` inputs. Other randomized properties in the same Electric/Offline/optimistic files do have replay support and must retain their existing policy.

Executed receiving experiment: Preact bound-options file, selector `Preact retains bound options.*getKey`. With seed/path/property unset: two native tests pass but the suite exits 1 for missing schema/both reach. With only `TANSTACK_DB_ORACLE_SEED=1`: the identical two native tests pass, ten tests skip and the suite exits 0. Logs: `o26-preact-partial-seed-none.log` and `o26-preact-partial-seed-1.log`. This independently confirms that file's missing-lane bypass; other rows are source-inspected, not separately executed.

## Default-policy finite counter sites

| File | Lines / finite scope | Existing entered-campaign handling |
| --- | --- | --- |
| packages/db/tests/live-query-cache-lifecycle-oracle.test.ts |80; claimant aggregate |Global afterAll unconditionally checks every claimant; checker-only selection also owns no native history. No zero-native guard. |
| packages/db/tests/live-query-cache-options-oracle.test.ts |54; claimant/path aggregates |`executedRoutes` gates each route. Correctly ignores unentered routes, but a partially entered route loses all required-state checks under shared seed. |
| packages/db/tests/mutation-handler-types-oracle.test.ts |319; public handler type aggregate, minimum6 |afterAll is inside native-only `public handler result admission` describe; checker controls are outside, so fully unselected describe does not enter its hook. Partial native describe is still exempt under seed. |
| packages/db/tests/optimistic-history-outcomes-oracle.test.ts |320; external-completion per-history cuts |Counter is constructed/asserted inside each finite history. No unentered counter, but seed disables even its local required cuts. Earlier random optimistic-outcomes campaign is separate. |
| packages/db/tests/query/virtual-row-fields-oracle.test.ts |239 root;840 union;1228 timeline;1690 facade;2035 nullable facade |Five global aggregates, unconditional afterAll hooks. File contains checker-only controls and unrelated finite families; no native-entry guards. Keep all required cells of each entered campaign; do not blanket-exempt partially selected families. |
| packages/db/tests/query/virtual-row-fields-types-oracle.test.ts |74; generated public-type aggregate |Global unconditional afterAll plus checker-only controls. No zero-native guard. |
| packages/electric-db-collection/tests/electric-oracle.property.test.ts |134 mutation aggregate;153 per-history mutation cuts |Aggregate afterAll is in native-only mutation describe; local counter is inside a native history. Existing random/replay properties elsewhere are distinct. |
| packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts |1017; restored-outbox aggregate |afterAll is inside native-only restored-history describe. Earlier and later random settlement/retry campaigns are distinct. |
| packages/preact-db/tests/bound-options-oracle.test.ts |28; retained-options aggregate |Global unconditional afterAll plus in-place-replacement checker controls. No zero-native guard. Executed seed bypass above. |
| packages/preact-db/tests/bound-schema-options-oracle.test.ts |21; mutation-schema aggregate |Existing `ran` boolean correctly ignores a wholly unentered native campaign. Partial entered campaign still exempt under seed. |
| packages/query-db-collection/tests/optimistic-ordered-refetch-oracle.test.ts |79 ordered-history aggregate;91 per-history cuts |Aggregate afterAll is in native-only describe; checker controls are outside. Local counter exists only within entered history. |
| packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts |1677 mutation aggregate;1693 local cuts;1941 post-handler aggregate |Mutation describe is native-only. Post-handler describe includes checker controls under the same afterAll and has no native-entry guard, so checker-only selection reaches an unrelated aggregate assertion without seed. |
| packages/react-db/tests/bound-schema-options-oracle.test.tsx |31; per-hook mutation-schema aggregate |Existing `ran` boolean per hook correctly ignores wholly unentered live/Suspense campaigns. Partial entered hook campaign still exempt under seed. |
| packages/react-db/tests/cache-first-registration-oracle.test.tsx |63; first-registration per-history cuts |Counter constructed/asserted inside each finite history; no unentered aggregate. Seed disables local required cuts. |
| packages/react-db/tests/cache-options-oracle.test.tsx |41; per-path cached-options aggregate |Global unconditional afterAll across client/server paths. File currently contains native histories only. A partial selected path is seed-exempt; no separate calibration lane currently requires a zero-native guard. |
| packages/react-db/tests/descriptor-start-release-oracle.test.tsx |30; descriptor-start per-history cuts |Constructed/asserted inside `checkHistory`; checker-only controls do not construct it. |
| packages/react-db/tests/source-id-reuse-oracle.test.tsx |103 inline-option local cuts;599 descriptor-release local cuts |Both counters are per-history; no unentered aggregate. Existing unrelated fixed native cases/controls do not construct these counters. |
| packages/svelte-db/tests/cache-options-oracle.svelte.test.ts |26; cached-options aggregate |Global unconditional afterAll. File currently has native histories only. Partial history selection is seed-exempt; no current checker-only lane needs an entry guard. |
| packages/svelte-db/tests/descriptor-start-release-oracle.svelte.test.ts |24; descriptor-start per-history cuts |Constructed/asserted inside `checkHistory`; no unentered counter. |

## Explicit-policy sites inspected; do not sweep-change

- `packages/db/tests/query/virtual-row-fields-effect-oracle.test.ts:313`: now explicit false, plus `enteredEffectHistories >0`; preserves every required finite lane once any native Effect history enters.
- `scripts/eslint-plugin-oracle/replay-observation-oracle.test.js:116`: explicit false and `campaignEntered`; retained checker-only subprocess control passes. A partially entered source campaign still owes all source states.
- `scripts/publish-history-oracle.property.test.js:40`: explicit false per finite command history.
- `scripts/publish-http-oracle.property.test.js:62`: explicit false per finite HTTP history.
- `scripts/release-history-oracle.property.test.js:114,120,147,251`: explicit false. This finite owner genuinely implements canonical direct replay: property selects a family, path chooses the authored case, local required cuts always remain enforced. Its aggregate afterAll is intentionally skipped only when `oracleReplayRequested()` is true. Seed-only runs still require aggregate reach. Preserve this policy.

## O26 receiving checks to add later

For each distinct aggregate policy: (1) no native campaign entered, checker-only controls run; (2) partially entered finite campaign with missing required lanes; (3) full finite campaign; run each with shared seed unset and irrelevant seed 1. Require the same reach verdict with either seed. A missing local-cut mutant must also fail with either seed for per-history counters. Keep existing direct replay receiving tests for the release owner and fixed/random shrink replay owners unchanged. An entered flag must be set before native setup, not only after a successful comparison. Do not let a per-route/per-hook guard borrow another receiving path's reach or silently shrink the declared domain.

No repository files or production code were edited. This inventory is not a claim that every listed file has been independently executed under both environments.

## Source fingerprints at inventory capture

This is a pre-repair source-inspection snapshot. Later oracle edits invalidate affected rows until rechecked.

| File | SHA256 |
| --- | --- |
| `packages/db/tests/live-query-cache-lifecycle-oracle.test.ts` | `c9da8b274c8402d2eb374d1a2cd4865f53095a9dce7423d6b1f616c4c45ff8fa` |
| `packages/db/tests/live-query-cache-options-oracle.test.ts` | `7ebf875a183111904b46d7905de3572287ccee5f28af9c7267f9969c9b7d60aa` |
| `packages/db/tests/mutation-handler-types-oracle.test.ts` | `59afc1991c1ffd2362922ca3e8a1ce7ee307ca3b7bc40cb05e9ffd3bad699ca3` |
| `packages/db/tests/optimistic-history-outcomes-oracle.test.ts` | `ee937b8c3191d3c827be4420e42a157d28a068a9fc2a6a6e82df940f9d33b523` |
| `packages/db/tests/query/virtual-row-fields-oracle.test.ts` | `c925791e375f2f2a0941e0ab35b965cabe89570fb13a981b14826b874eaca98f` |
| `packages/db/tests/query/virtual-row-fields-types-oracle.test.ts` | `65508306911b9c1082181cad2b7467a858a86823bc33228665f2affe5f1edfe4` |
| `packages/electric-db-collection/tests/electric-oracle.property.test.ts` | `adce4010e6406d428404a3c4e1745e00bd89baf7a0612b09e1748ea3f1294e2c` |
| `packages/offline-transactions/tests/transaction-settlement-oracle.property.test.ts` | `83eb5551300ebb702e119174a2352c985ad6086cefa18042cc5c947c3c89e91a` |
| `packages/preact-db/tests/bound-options-oracle.test.ts` | `208d617b276b5fd0f1975884d2c337dc26313b94b71b208f9bcd890a974b374a` |
| `packages/preact-db/tests/bound-schema-options-oracle.test.ts` | `97c32b831caf5e7d4c6349197e356594fffee0c0b4cfc113a479717fe3a76f0c` |
| `packages/query-db-collection/tests/optimistic-ordered-refetch-oracle.test.ts` | `462f432f7b20797b8326dc50ae9feb9db177354c802c40d3aad53a46e65a493d` |
| `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts` | `d9699cf0554bcc58bc9966be51d0b5f8c622b9f6f14e61344fce05420535029b` |
| `packages/react-db/tests/bound-schema-options-oracle.test.tsx` | `8d4707534b5962b8f249885b10104045869a86d9e86faf8c8e0ac289866b41c6` |
| `packages/react-db/tests/cache-first-registration-oracle.test.tsx` | `2247d32fc1e47c95136dafcf796f6c6a8dd8b93124d05b7981043156dafdd9e5` |
| `packages/react-db/tests/cache-options-oracle.test.tsx` | `7a4a85db8fa822fd96b28e2de6da53a5feeb057ef26d79956c878215faed1f6d` |
| `packages/react-db/tests/descriptor-start-release-oracle.test.tsx` | `46c4264fa4dd1e8b7d46d4983b064317cc790f4ee05f2d8c9167561d99c44974` |
| `packages/react-db/tests/source-id-reuse-oracle.test.tsx` | `af236fff80f7d21be7d458b0be70416ec48d08f8fb26c3f762f2f3e91a9d28a0` |
| `packages/svelte-db/tests/cache-options-oracle.svelte.test.ts` | `2ecf6deca78f7c347719f81cb640a7b5e78f236e9f7df51a90bd12e862180627` |
| `packages/svelte-db/tests/descriptor-start-release-oracle.svelte.test.ts` | `98268189dbb4a4591ebdc983e3aa994509daa48dd24a73cf1ba38b9ce656ea8b` |
