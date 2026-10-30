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
