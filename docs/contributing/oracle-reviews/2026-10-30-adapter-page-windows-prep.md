# Page-window PR preparation review

This addendum preserves the later preparation review separately from the
[original evidence](2026-10-30-adapter-page-windows.md) and
[second oracle review](2026-10-30-adapter-page-windows-round-2.md).
The reviewed starting HEAD was `c351fc04d7f70dc59bf92ecbed310f899b9511cd`,
with the page-window changes still uncommitted. Five independent code-review
angles, independent confidence checks, and a separate simplifier supplied the
raw material. Their source-inspection judgments did not establish new runtime
results. The preparation evaluation supplies executable evidence separately.

## Accepted law and review findings

The maintainer decision for #2291 is unchanged: an invalidated adapter-owned
ordered list query whose structured plan changes only its finite outer
`.limit()`/`.offset()` moves the same window. It retains its live-query
Collection and upstream subscriptions. No hook option or public API is added.

| Item | Evaluation and action |
| --- | --- |
| H1 | Fixed oracle-first: a module-stable server/client effect choice removes the React 18 warning and retains client layout commit. The [SSR record](2026-10-30-react-ssr-effects.md) gives pre-edit RED, GREEN, hostile rejection and the three-reviewer reconciliation. |
| G1 | Duplicate of R2-5: initial-loading, Collection-option and Preact aborted-render coverage entered after the first production edit. Current coverage cannot repair that historical order. The qualification remains for maintainer disposition. |
| G2 | Required shipped-size rationale is given below; measurements and actual reductions are distinguished from suggestions. |
| B-L1 | The resolver checks finite target bounds, while its old limit only needs to be present. The comment and current coverage entry now state that distinction. |
| C1 | Independent duplicate of B-L1, retained separately in the raw audit. No replacement-identity law for explicit Infinity-to-finite moves was established. |
| S1 | Optional small Vue/Solid wrapper simplification: move the constant GC option into each wrapper. Angular has a varying pool option and is excluded. User disposition and validation belong to the subsequent preparation step. |
| I1 | Integrated main normally at `bfd1da1a7e752d66fd667adfd3cdf54f60732b22`. The combined tree passed the focused Effect, SSR and window checks below. |

The finite generated window domain remains the scope of the retention
evidence. An explicit Infinity limit is present and can pass the resolver's
old-bound check before moving to a finite target. The prior phrase “unbounded
transitions keep their existing paths” was too broad. No public contract
requires replacement identity outside the guaranteed finite domain, and no
wrong rows were demonstrated by this review. This clarification changes no
guard, oracle expectation, or product behavior. It does not claim an executed
Infinity receiving witness.

## Why shipped bytes still grow

The original measurement added 766 gzip bytes across seven separately bundled
packages, including 377 in core and 22 in db-ivm. The typical tree-shaken React
app added 539 gzip bytes. Svelte's separate compiler pipeline added 110 gzip
bytes. These are the earlier measured snapshot, not measurements of later
effect or wrapper edits.

The implementation adopted two reductions in the existing machinery. Plan,
source-object and Collection-option matching live in the shared resolver;
the six adapters retain only their native input and commit integration rather
than each implementing that comparison. Moves use the existing `setWindow`
path and preserve existing observers where the adapter supports that, instead
of adding another public window controller or compiling a parallel query.
TopK stores the authored limit in place of the stored end and computes the end
when needed. Its installed-range clamp replaces the earlier special Infinity
branches rather than adding a second range representation for that case.

The remaining growth pays for distinguishing ownership and timing that the
previous rebuild path did not need. A binding must identify its own previous
Collection; shared cached results cannot be moved by peers. A speculative
render must retain a proposed move until commit. A committed callback must
wait until the current Collection publication ends. Exact authored bounds must
survive a partial move even when installed rows are empty.

Actual simplification experiments also bound the available reductions. Applying
the move synchronously from the publication callback removed the scheduling
step but failed with `SetWindowReentrancyError`. Recovering an omitted width
from end minus offset removed exact width storage but failed the numeric
partial-move row comparison. Permanently clamping stored bounds to installed
rows failed when the source later grew. Deriving demand changes only from
installed deltas failed for changed empty ranges. These were executed hostile
reductions, not successful refactors or independent byte measurements; their
failures are recorded in the original and numeric evidence. Removing source
and option guards also failed the corresponding receiving comparisons.

The simplifier did not recommend a broader resolver factory, allocating
object-rest comparisons, combined receiving drivers, or TopK representation
rewrites: none had a demonstrated local benefit, and the receiving drivers
encode different host cuts. Those were source-inspection decisions, not
claimed executed refactors. The optional constant-options cleanup is tracked
as S1. No bundle-cost claim depends on deleting useful comments or weakening
tests. Test and contract-document growth is separate from shipped production
bytes.

## Reviewer assessment and loss accounting

The code-review team found one concrete compatibility defect that a React 19
test runtime could miss, distinguished a historical process failure from a new
product bug, and retained its two low-confidence scope observations without
inventing authority for replacement identity. Its source reasoning was
accurate and well prioritized. Hire recommendation: yes for this bounded
review; the source-only finding still needed independent executable evidence.

The simplifier proposed one small, behavior-preserving cleanup and correctly
excluded Angular's varying options. It preserved independent oracle models,
receiving checkpoints and historical evidence. Hire recommendation: yes for
focused maintenance work; it did not claim to have executed validation.

The scratch audit retains all raw items, duplicate sources, six considered
simplifications, four comments-angle nonfindings, and twelve prior-review
checks. Nonfindings retain their original source limits; they are not evidence
of exhaustive behavioral closure. No suggestion was silently applied and no
confidence threshold erased an item. Final dispositions and final-tree
validation are appended after the preparation decisions.


## Final local integration and evidence

Main integrated by fast-forward with autostash `1bc0686d0`, which reapplied
cleanly. A pre-integration binary patch and SHA256 inventory protected the dirty
task files. Every inventoried file except the coverage map was unchanged;
that map gained the disjoint upstream Effect text. No unmerged file or reverse
deletion of the upstream work remains. No task implementation commit or push
has occurred at this preparation checkpoint.

On `bfd1da1a7e752d66fd667adfd3cdf54f60732b22` plus the task edits:

| Focused check | Result |
| --- | --- |
| Core Effect owner/ordinary Effect/disposal/failure-fidelity | 391 tests passed |
| React Effect/window/SSR effects/runtime-error handoff | 154 tests passed |
| Shared React window histories | 44 tests passed |
| Total distinct tests in this integration run | 589 passed |
| Core and React TypeScript | Both passed |
| Changed-file lint and whitespace | Passed |

All Vitest commands used at most two workers with file parallelism disabled.
The SSR source, receiving program and oracle hashes match the frozen sources in
its evidence record. Its [measured reach](2026-10-30-react-ssr-effects-reach.json)
contains 24 runtime/path/campaign records, 35 render comparisons each (24
generated plus 11 fixed), and two separately identified disabled replays.
The original-effect mutant fails all six React 18 fixed campaigns; seed 2291,
path 0 reproduces its ordinary-provider diagnostic failure directly. The
existing real client receiver preserves 24 committed/suspended/cancelled tests.
The prior all-framework and numeric evidence remains bounded by its original
source snapshots and recorded limits; this integration run does not pretend to
rerun all of those tests.

The final size command was:

```sh
pnpm size:compare --packages db-ivm,db,react-db,preact-db,vue-db,solid-db,angular-db --files
```

Against the new main merge-base, the seven package bundles add **791 gzip
bytes** (683 brotli), and the typical tree-shaken React app adds **561 gzip
bytes** (415 brotli). React's package contribution is 106 gzip bytes, including
the server-safe effect choice. These replace the earlier seven-package/app
numbers for this checkpoint. The separately measured Svelte result remains
110 gzip bytes; its adapter source and external-dependency compiler path have
not changed since that measurement. Svelte was not rebuilt by this final Vite
size command. The shared comparison, ownership and commit distinctions above
explain the residual growth; the unsupported reductions were tested rather
than silently removing those distinctions.

Production shipped bytes are separate from the generated-history, receiving,
failure-fidelity and contract/evidence files. Exact React 18 aliases and their
32 lockfile lines are development-only receiving dependencies, not runtime API
or an installation workaround. No local override was introduced.

The final loss audit accounts for 35 original preparation items and 13 new
SSR-oracle review/driver items: 17 fixed now, 27 bounded nonfindings or rejected
broader recommendations, 3 separately retained duplicates, and 1 optional
simplification awaiting user disposition. No confirmed product enforcement gap
remains open in this bounded audit. The canonical historical R2-5 process gap
remains disclosed for maintainer disposition; it is not repaired by these
results. The optional S1 cleanup still awaits the prep-pr walkthrough.

Local implementation and integration checks are complete at this checkpoint.
The [checkpoint manifest](2026-10-30-adapter-page-windows-prep-manifest.json)
identifies 28 source hashes and 11 evidence-log hashes.
Whole-PR readiness remains unproven until the user preparation decisions,
commits, pushed-head checks and CI workflow are completed. No external PR
review or CI result is claimed here.


## Accepted simplification S1, 2026-10-30

The user accepted S1 after the technical evaluation. Vue and Solid now put
`gcTime: DEFAULT_GC_TIME_MS` inside their local `resolveNext` wrappers. The
wrappers no longer accept or spread an options argument, and their four call
sites pass only the query value. Every earlier call supplied that same constant.
The owner, previous Collection and resolver calls are unchanged. Angular keeps
its varying pool option. No product law, oracle model, history grammar,
comparison, run budget or public API changed.

Validation used the existing real Vue and Solid shared window owners:

```sh
pnpm --filter @tanstack/vue-db exec vitest run tests/conformance.test.ts \
  -t 'window histor' --maxWorkers=2 --fileParallelism=false \
  --coverage.enabled=false --typecheck.enabled=false \
  --disableConsoleIntercept --silent=false
pnpm --filter @tanstack/solid-db exec vitest run tests/conformance.test.tsx \
  -t 'window histor' --maxWorkers=2 --fileParallelism=false \
  --coverage.enabled=false --typecheck.enabled=false \
  --disableConsoleIntercept --silent=false
```

Both passed 10 tests, for 20 affected-path tests. Both package TypeScript checks,
changed-file lint and whitespace validation passed. The other 26 source hashes
in the preceding checkpoint manifest remain unchanged, so its earlier core,
React, SSR and numeric conclusions retain their recorded scope. The two updated
source hashes are:

| File | SHA256 |
| --- | --- |
| `packages/solid-db/src/useLiveQuery.ts` | `69c375e78cbd034602a40c9024ac817dce9271fdcf44808933b99c66730b195a` |
| `packages/vue-db/src/useLiveQuery.ts` | `20ada3082bbc11d23abd0ea7c20ea878b17794b81f824c728f836f9c2c9b8bf9` |

`pnpm size:compare --packages vue-db,solid-db --files` rebuilt both adapters
against the same main baseline. Vue adds 33 gzip bytes rather than 43; Solid
adds 36 rather than 46. This accepted refactor removes 20 gzip bytes from the
seven-package total, leaving **771 gzip bytes** (660 brotli) of total growth.
The typical React app remains **561 gzip bytes** (415 brotli) above main.
Svelte's separately measured 110 gzip bytes remain unchanged. This supplies an
additional adopted refactor and measured outcome for G2's size rationale.

The seven validation logs have these hashes; verdict-critical results and
commands are stated above rather than depending on local log availability:

| Log | SHA256 |
| --- | --- |
| `prep-s1-lint.log` | `ec4182d730ce311d890924a35a5e282747fa1350561b28cec7df03c773184dfd` |
| `prep-s1-size.log` | `c1a95124033cf8d99ae9fd5249bf1d8a7d3eca2367963031823d53a1bbf15935` |
| `prep-s1-solid-types.log` | `4abfd87bbb5257122676e2e2470cc8e23a96d6529112c225f186e0dfcdb06dbb` |
| `prep-s1-solid-windows.log` | `aa96acb23d5c853d10cd9a83720d1db6502ec5f0e64d3b0b814f284de1817b34` |
| `prep-s1-vue-types.log` | `bd345ce7c920924e75f922a89027b1fb57042b09687b3b281fd4fdd13d7ce00e` |
| `prep-s1-vue-windows.log` | `63f200cda8608d7df49d009068a6d87e50aaeecc08b45c295a12973549ee6c0f` |
| `prep-s1-whitespace.log` | `3d4d50cd32af92c6d4df37c1df74a96622fca8cfb5643a155c91f034a42f2068` |

S1 is now fixed and accepted. The preparation audit totals are 18 fixed-now,
27 bounded refuted recommendations/concerns and 3 preserved duplicates: all
48 original/follow-up items are accounted for, with no remaining optional
suggestion. The historical R2-5 qualification remains disclosed. The next step
is the prep-pr workflow's final user confirmation before commits, changeset
and PR-body work. No task commit, push or PR has been created at this checkpoint.


## Approved publication checkpoint, 2026-10-30

The user approved commits, the changeset and PR publication after S1. Before
publication, main advanced to `0531c50ad419a1b51ad3e27e3632e70be3c6bdb3`
(the distinct hash-collision repair). A normal fast-forward with autostash
integrated that commit. The coverage-map append conflict retained both owners.
The task's tracked source bytes stayed unchanged except the combined coverage
map and oracle-config additions. Historical manifests above remain unchanged.

Verification on this integrated tree passed 1,251 tests: the full IVM package
(657), six selected core files (396), five React files (154), and React shared
window histories (44). The selected core files include the upstream distinct
collision and Effect tests; the React files include the SSR runtime handoff
owner. Each Vitest command used at most two workers with file parallelism off.
IVM, core and React TypeScript checks, `pnpm lint:changed` and
`git diff --check` also passed. The full root monorepo test command was not run.

The exact commands are the first lines of these logs. Hashes preserve this
checkpoint without changing older evidence:

| Log | SHA256 |
| --- | --- |
| `publish-final-changed-lint.log` | `ec4182d730ce311d890924a35a5e282747fa1350561b28cec7df03c773184dfd` |
| `publish-final-core-integration.log` | `70b4e99973ad61f6e7bf8247d4a1cc444dd8572aa1ef02ba1e2426d060a29d00` |
| `publish-final-db-types.log` | `07a23be87a598a26bdfab6304f0ff2dfcd4ed39642e1b2c8214237565ca6790f` |
| `publish-final-ivm-integration.log` | `db7b49d0c99d61dc0a08e919cf037b00a3755ae97b4981d64f2ed9de24dd5bba` |
| `publish-final-ivm-types.log` | `7ae8481162b2401099262bce31f2e09ccbfd9b93060a1f6630c1c8638ef497a4` |
| `publish-final-react-integration.log` | `dfb17f1ecfd8660bf44e247ac070c14164d1b74d2de6b3d342571565314a5d76` |
| `publish-final-react-shared-windows.log` | `1fbb1880af2e184d5aeca80ecf5c8f6a81d3d9724d0a28d55df0e60e957ed3b3` |
| `publish-final-react-types.log` | `00cb5d0046a00ec92dadbe1fc7c10ac3080f8c5332605e5f3cfbcf59e374d1a8` |
| `publish-final-whitespace.log` | `3d4d50cd32af92c6d4df37c1df74a96622fca8cfb5643a155c91f034a42f2068` |


The final size comparison uses that same `0531c50ad` main baseline:

```sh
pnpm size:compare --packages db-ivm,db,react-db,preact-db,vue-db,solid-db,angular-db --files
```

The seven-package sum grows by **775 gzip bytes** and **664 brotli bytes**.
The typical React app scenario grows by **543 gzip bytes** and **502 brotli
bytes**. These replace the prior checkpoint's totals for the final integration.
The unchanged Svelte source retains its separate compiler measurement of
110 gzip bytes; this command did not rebuild Svelte. Compression differences
from the preceding checkpoint follow the upstream IVM integration. No new
runtime branch was added for this measurement. The final log SHA256 is
`5bcb5bd9103154ce65824a39aaa754d80e635f0b691d03c84d7f32122cbcd2b8`.


### Commit-hook cleanup

The normal pre-commit hook rejected a redundant `!owner` conditional: the
previous retained-owner check already excludes an absent owner. It also sorted
one import. Removing the redundant branch changes no reachable behavior. The
oracle laws, histories, comparisons and budgets are unchanged. Explicit ESLint,
core TypeScript and all 24 React window-render tests passed after this cleanup.
The final source SHA256 for `packages/db/src/live-query-options.ts` is
`7426405067121706cb02b382f658aa312668d55278378d41182f012d2d62cb8a`.

A fresh size comparison on these final bytes reports **772 gzip / 626 brotli
bytes** of growth across the seven packages and **540 gzip / 515 brotli bytes**
for the typical React app. These supersede the preceding size totals. Svelte's
separate unchanged-source measurement remains 110 gzip bytes.

| Final cleanup log | SHA256 |
| --- | --- |
| `publish-hook-eslint-fixed.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `publish-hook-types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `publish-hook-window.log` | `46b22d5f974616b8b271ca236491ee19a96377787e17e90dc66c161109eac5a2` |
| `publish-committed-size.log` | `930c14c6a11d60a4e74d1d098b29933d7ee98db2ebfe939c951ae403532f53cf` |


## Published CI repairs, 2026-10-30

PR #2316 initially published implementation `38422ac61` and changeset
`9b09f1e7`. CI's IVM tests and test-source types passed; its final dependency
check failed because the two React 18 development aliases were not sorted.
`pnpm test:sherif` reproduced that metadata error. Commit `3ef2e5fe7` sorts the
aliases, and the same command passes. Dependency versions and the lockfile did
not change. CI then passed the IVM/offline job.

The DB replay job exposed a second integration omission: all eighteen new
property names were registered but lacked manifest owners. On unchanged
`3ef2e5fe7`, the full replay suite returned one intended manifest assertion
failure and forty passes. This is a replay-routing defect, not a product row
mismatch. The existing guard correctly rejected the incomplete registry.

The repair maps the shared framework properties to the React conformance
receiving file and names the shared model module as their source. React and
Preact render, twelve SSR runtime/path cells and numeric TopK have their own
owners. Direct selectors choose fresh/random campaigns. The source checker
recognizes SSR's computed property template and independently checks its
runtime and path literals. It keeps every prior manifest assertion.

The full replay suite now passes all forty-one tests:

```sh
pnpm --filter @tanstack/db exec vitest run tests/oracle-replay.test.ts \
  --maxWorkers=2 --fileParallelism=false --coverage.enabled=false \
  --typecheck.enabled=false
```

Every new entry's manifest command was also run from its declared directory
with `TANSTACK_DB_ORACLE_PROPERTY`, seed `2291` and shrink path `0`, one worker
and coverage/typecheck disabled. The guarded runner reported these exact,
nonfailed executions. Each witness reported `numRuns: 1`:

| Property | Completed executions | Log SHA256 |
| --- | --- | --- |
| `framework.window-history` | 16 | `baeab34ac392593a1eac89f1eda36b9d8bb321f3e1ab4d1bee96897d9adbd7eb` |
| `framework.pending-window-history` | 2 | `0d580e6b6dcb23dabfee3a4dd355062bd101c7c9e71a8cdfea49bc769cc81eb1` |
| `framework.publication-window-history` | 2 | `80b14b353c2b0af0a1bbebe129ba6fc764907aba94d1694d86e1af450bec6096` |
| `react.window-render` | 12 | `53483a4300727b16a0a4fec7dd64cff9c75183ff748520c460d580472f7ace13` |
| `preact.window-render` | 12 | `3f7c4ed0cab91398e4db3ab41b72322ab2b8e7c9b1b5ae4f48b601e3aefbbad1` |
| `react.ssr-effects-react18-ordinary-provider` | 1 | `6502a2f6ed5d2b61ae93f88acbab3c222eac8dd083a925069553842dacf0a2c5` |
| `react.ssr-effects-react18-ordinary-explicit` | 1 | `ea264bf8907dc8ab1d3273850e7f0b6a145f78bf819f3148b2e7ef63626272ed` |
| `react.ssr-effects-react18-suspense-provider` | 1 | `7b01b01f59d1fa55a4ea1dfa2c7affbc61d2ad35e50c3be5b2147bdc9cc5e288` |
| `react.ssr-effects-react18-suspense-explicit` | 1 | `a2f60529df6cc88d4ae5182cd2a6516f502a264368ba924d80005522c5977655` |
| `react.ssr-effects-react18-standalone` | 1 | `d5173740c1d3eaee46e659c51835f82bb8efebe908e99956c3e64c382c2d2d2e` |
| `react.ssr-effects-react18-supplied` | 1 | `e07e0d08e5f001180dc2d1b76392e616aac84ed7eed1fc744028b0cb52c07616` |
| `react.ssr-effects-current-ordinary-provider` | 1 | `d186447a8d714d5ac5ff019f1960c91fc020058a8af502212ab67e9293366dbc` |
| `react.ssr-effects-current-ordinary-explicit` | 1 | `0b017317df2e0dd9b7b5fee1f00fa1e59caa22ef7fa3cc0d11156fef15f063c9` |
| `react.ssr-effects-current-suspense-provider` | 1 | `61beea4e2906b3d6ab82df42b4eb519f90cb37dbac4b9a62bb425483d2acf993` |
| `react.ssr-effects-current-suspense-explicit` | 1 | `e8657a5e80ffcae9d46e28c9704f3557b7b7eb22214b40e63212c929f19b52a3` |
| `react.ssr-effects-current-standalone` | 1 | `7df3090ad98872dd46cb56f5d42c96bd1810fa9c35f475d50d3e5d88563a9935` |
| `react.ssr-effects-current-supplied` | 1 | `2de45c888925e0f9a5b0340dc5763c75dac9ae00bc2b03d914f65cd12e0da763` |
| `ivm.topk-numeric-window` | 8 | `f3021933e75830ccf2089b027515701615a373d78dac45c8cf2d9940729c4e77` |

The numeric owner's guarded runner first attempts asynchronous instrumentation,
then uses its established synchronous retry. Its final eight comparisons and
witnesses pass; the earlier mode failures are not product evidence.
A focused independent oracle review checked all mappings, source overrides,
selectors and eighteen raw witness summaries and found no actionable issue.
It made no edits and ran no tests concurrently with these checks.

**Law:** ORC-007 and the existing guarded-replay protocol require a registered
property to route to its executing owner with the requested seed/path.
**Reach:** Eighteen requested property routes completed the counts above.
**RED:** The original missing-owner manifest failed its existing assertion,
with forty neighboring replay checks passing.
**GREEN:** All forty-one replay checks and all eighteen guarded commands pass.
**Mutant:** The original registry is the rejected wrong routing; the unchanged
suite also rejects wrong files, filters, skipped/zero runs and changed replay
coordinates. No new product mutant or product-law change is claimed.
**Limits:** These commands establish replay routing, not universal product
correctness. React is the canonical shared-framework guarded route; the other
framework drivers keep native seed/path replay. Existing model, grammar,
comparison, receiving and budget limits remain. No production source or oracle
run budget changed in this repair.

Explicit ESLint, core TypeScript, changed-file lint and whitespace checks pass.
The original production chronology qualification remains unchanged.

| Verification log | SHA256 |
| --- | --- |
| `ci-sherif-red.log` | `e7f30af9fc951e95404e2ceace024d177943170ca31075d012057a69b4120996` |
| `ci-sherif-green.log` | `3bf3b69d6ee18726ce8a3b964c7ad3c5593ca5e2391888ea440b909377c1b988` |
| `ci-db-replay-local.log` | `557f5c576a66994f2f75e89c6be187fce6e97f7e18b7953ef0bfc0fe9e00f1e1` |
| `ci-db-replay-green.log` | `1dd8ea18fa377e28889c300c0a5a15e62a570b38249feaf5106425c28703c513` |
| `ci-replay-manifest-green.log` | `4e791ad197488e5a8a454fb97f4d50aa9d6b6973d74e5d64d36b277daf8a3841` |
| `ci-replay-eslint.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `ci-replay-types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `ci-replay-changed-lint.log` | `89d7da780deb04850db632f478bc4155d23659849c0e5bec6d114c74dc9d5168` |

Final routing source hashes:

| Source | SHA256 |
| --- | --- |
| `packages/db/tests/oracle-replay-manifest.ts` | `936a42065fb4031e67410dbb530e3d566a3c7ce75c7e739c199d69aa3d375901` |
| `packages/db/tests/oracle-replay.test.ts` | `c624c7cd6e58fff27e9e488af270887fc1bdf9de36913f3303005291b855dfd0` |


## Correction after the CodeRabbit replay review

The canonical-React routing claim above described parent
`cc058b802ed6921f692f234399437c5a4e663991`. It did not preserve the originating
framework driver and is superseded by the
[driver replay review](2026-10-30-adapter-page-window-replay.md). The earlier
eighteen commands prove only their named target executions on that parent.
Current property IDs include one of seven driver identities, including React's
dependency-list path, with a separate owner for each of three history families.
The new independent matrix first failed all 21 comparisons before routing was
repaired. All 21 guarded commands then passed; a React-for-Solid mutant failed
three owner comparisons and a real wrong-driver invocation reported zero
executions. The complete protocol suite passes 63 tests. Source hashes and
per-route witnesses are in the linked review manifest. No shipped source,
product expectation or oracle run budget changed in this correction.


## Production simplification after the size review

The user requested a net-negative implementation. This follow-up removes
intermediate rank arrays and the unused half-open-range helper, shares TopK's
insertion/deletion boundary calculation, and searches indexed rows without a
synthetic lookup tuple or a fresh comparator closure. The resolver now has one
builder/config compilation path and one query-config reader. Existing semantic
identity, exact-source, option, ownership, publication, and commit guards remain.
Vue, Solid, and Angular delegate callback preparation and disablement to that
resolver, and use their existing resolver closure as the binding identity.
Angular projects the shared observer snapshot instead of keeping parallel copies.
React uses one optional profiling timestamp and excludes development counters
from production; its environment probe preserves bundled development and
unbundled-browser behavior. No public API, oracle law, grammar, comparison,
replay route, or run budget changed.

An attempted Angular data projection short-circuited the current input and
returned stale rows after compilation failed. The unchanged conformance suite
rejected it in `grouping-operator-switch` and `compile-error-after-rerender`.
The retained projection reads the current Collection before its cached snapshot;
the same two cases and all ten window histories then pass. Direct environment
checks and permanently disabled profiler allocation were also rejected during
inspection because they would change supported development diagnostics.

`pnpm size:compare --packages db-ivm,db,react-db,preact-db,vue-db,solid-db,angular-db --files`
compares the final sources with main `0531c50ad`. The typical app changes from
**+540 to -15 gzip bytes** and from **+515 to +126 brotli bytes**. The seven-package
sum changes from **+772 to +83 gzip bytes**, and from **+626 to +35 brotli bytes**.
Thus the typical gzip scenario is net negative; all measurements are not.
The remaining guards enforce distinctions that existing receiving tests reject
when removed. Svelte's adapter source is unchanged, and its separate package
measurement remains +110 gzip bytes. These figures exclude tests and evidence.
The original RED/GREEN/mutant records and R2-5/G1 chronology qualification remain
unchanged; a behavior-preserving refactor supplies no new oracle-first claim.

Final window receiving checks pass 106 tests across React (44), Preact (22),
Vue (10), Solid (10), Angular (10), and Svelte (10). The complete IVM suite
passes 657 tests. Four focused resolver/cache/pooling suites pass 4,446 tests;
the five React development, hook, Suspense, render and SSR suites pass 145.
Vue and Solid full suites pass 152 and 132 tests respectively. IVM, core,
React, Angular, Vue, and Solid TypeScript checks pass. Explicit ESLint,
changed-file lint, formatting, and whitespace checks pass. The root test
command was not run. These checks preserve the existing bounded evidence;
they do not extend its closure claim.

The follow-up removes 217 net production lines from the published version;
the complete branch removes 82 net production lines relative to main.
Shipped-byte measurements above, rather than these line counts, determine
production weight.

| Verification log | SHA256 |
| --- | --- |
| `reduction-size-23.log` | `379c08a502c21abcb4a6b7cd91db6ed395e19bf06670cae819f8f8b281a7c75c` |
| `reduction-ivm-verified.log` | `1dc19af4313e94afb18d0b3763af72603bd526398f0890cfab44908c3729d07c` |
| `reduction-core-verified.log` | `c1d4b3927d9d7dac741dae9283dca2c6ccb05b41c0165c304f6f0672c902502c` |
| `reduction-react-verified.log` | `edea08e3ee5afe412cb55a17b50ab6cc9f28256ea03bb6805fe4a1e970e5469c` |
| `reduction-react-windows.log` | `7cd3c265d3cf208b295d0877e8cd75af94aad16ad93d9263f537641dbb008a99` |
| `reduction-preact-windows.log` | `52b9195d842501faf8eb8da7f08950f66b27321b3ac7d28cec10b00887294eb3` |
| `reduction-vue-windows.log` | `743df5ec99bf5fbd5a6f86245a6207d794b67bab2e93516ed7f662dc436947a0` |
| `reduction-solid-windows.log` | `05a1319bbc71c67d8cee0b93a3159fb543181ae68a082885ef5b5bcb9e5ae5e9` |
| `reduction-angular-windows.log` | `9afb4e92151a9b63f66dc1fc652677850cf6159cc21ef05dcc99a4071dbf1f19` |
| `reduction-svelte-windows.log` | `abd368f953a4d7a73fb9b4456f2c4beff5dcea8cc6c693c87dc53e477cd59227` |
| `reduction-eslint-verified.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `reduction-changed-lint-verified.log` | `89d7da780deb04850db632f478bc4155d23659849c0e5bec6d114c74dc9d5168` |
