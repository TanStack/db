# PR #1302: Vue publication review

- Raw source: [PR #1302](https://github.com/TanStack/db/pull/1302), head `de5f28d6fe9ee6f89dcf81a9d39fab90d51c4e99`. Its body contains eight proposed changes and detailed claims; GitHub returned no human issue or inline comments. The changeset bot comment is recorded below.
- Baseline reviewed: `ae2eb3fbf3a314a7f043f0d963fd336d8c1f1ec8` (`origin/main` on 2026-09-29).
- Repaired executable tree: `e11bedc7` on `codex/pr-1302-vue-publication`.
- Executable owner: [`useLiveQuery-publication-oracle.test.ts`](../../../packages/vue-db/tests/useLiveQuery-publication-oracle.test.ts). The shared conformance suite checks after Vue settles; this owner checks synchronous watcher observations during one source transaction.

## Contract, evidence, and decision

One source sync transaction must not expose an intermediate empty Vue `data` array when the source Collection has already published nonempty final rows. A synchronous `watch(..., { flush: 'sync' })` is a public Vue observation. The oracle copies source rows into a plain array and compares each hook callback with the old or final public snapshot at that callback. It requires one callback containing the final rows. Its bounded histories cross insert, update, and nonterminal delete with a supplied Collection and an identity live query. Empty final results, multi-change transactions, query recompilation, and other framework schedulers remain outside this owner.

The six oracle cells all failed on baseline main. Every cell recorded `[]` while the source already contained the final nonempty rows. The final checker fails first at the watcher count: baseline emits two callbacks, with `[]` then the final rows. An earlier checker order also failed directly on the forbidden `[]`. The same six passed after replacing `internalData.length = 0; internalData.push(...rows)` with one `ref.value = Array.from(rows)` assignment. The baseline implementation is the hostile wrong design: it reached the intended watcher checkpoint and failed by assertion, not by timeout or setup failure. The repaired cells each observed exactly one final `data` callback.

A separate focused RED found that a user query throwing `Error('__DISABLED_QUERY__')` was misclassified as disabled. Replacing the message match with a unique Symbol sentinel made that test GREEN. Null and undefined disabled queries still pass. The change also removes stack allocation for ordinary disable, while retaining a caught throw. It does not claim to fix debugger behavior for caught exceptions.

The array fix uses Vue `ref`, rather than the PR's proposed `shallowRef`. A temporary compatibility probe found that baseline `reactive` and repaired `ref` both expose deep reactive arrays, rows, and nested values; an in-place nested edit triggered a synchronous watcher in both. This behavior is not asserted as a supported Collection mutation path, but preserving it avoids a separate observable change. The old array spread is gone; the new `Array.from` assignment has no function-argument limit. Production diff at `e11bedc7`: 9 additions, 12 deletions, net **−3** lines. Test and coverage text weight is separate.

A baseline diagnostic also established that `markReady()` changed the Vue hook status to `ready` before returning and that stopping a standalone `effectScope` prevented a later source insert from changing hook data. The shared Vue `no-updates-after-unmount` conformance scenario reaches the same disposal path. These results do not prove every delayed callback schedule.

## Lossless PR claim ledger

| ID | Original claim or suggestion | Verdict and disposition | Durable destination |
| --- | --- | --- | --- |
| V01 | Broad Vue primitive refactor, no public API break | `design-decision`: two narrow defects confirmed; full refactor compatibility unproved | PR #1302 |
| V02 | Existing 30 tests, 18 new tests, shared utils, ~83→87% coverage | `stale`: historical PR counts; current suite differs | PR #1302 test plan |
| V03 | Deep Map proxying has O(N×M) cost and no utility | `deferred`: proxy wrapping is real; claimed cost unmeasured | PR #1302 performance proposal |
| V04 | Array clear+push exposes empty state; use `shallowRef` | `fixed-now`: six RED→GREEN cells; used deep `ref` to preserve behavior | Vue publication oracle |
| V05 | Sentinel throw/catch has stack, debugger, and string-match costs; use builder probe | `fixed-now` for collision and allocation via unique Symbol; debugger concern remains V16 | Focused Vue regression |
| V06 | `getCurrentInstance`/`onUnmounted` misses standalone scope cleanup and leaks | `refuted` on current main: scope stop disposes `watchEffect` observer | Vue conformance disposal scenario |
| V07 | Default GC retains ephemeral hooks; `gcTime:1` is preferable | `design-decision`: no leak witness or approved lifetime policy | PR #1302 |
| V08 | Shared duck typing risks false positives; Vue should use `instanceof` | `design-decision`: no false-positive witness; a Vue-only identity rule diverges from shared helper | `packages/db/src/live-query-adapter.ts`, PR #1302 |
| V09 | `nextTick` leaves one-tick ready/loading mismatch | `already-fixed`: current observer path updates status synchronously in diagnostic | Vue readiness conformance |
| V10 | Add `isEnabled` computed field | `deferred`: additive convenience API, not reproduced defect | PR #1302 API proposal |
| V11 | Keep computed wrappers for API stability | `already-fixed`: preserved | Vue public types |
| V12 | Keep manual initialization plus initial-state subscription as safety net | `already-fixed` as preservation claim; rationale not independently proved | Vue startup conformance, PR #1302 |
| V13 | Test plan repeats counts and coverage claim | `duplicate` of V02 | PR #1302 |
| V14 | Shallow Map tracks operations without deep-proxying values | `duplicate` of V03; behavior true, benefit unmeasured | PR #1302 |
| V15 | Array reference assignment gives one notification and avoids deep proxies | `duplicate` of V04; one callback verified; deep proxy removal intentionally omitted | Vue publication oracle |
| V16 | Caught sentinel causes debugger stops and middleware fragility | `deferred`: no wrapped-error path or measured debugger impact; Symbol still throws | PR #1302 |
| V17 | Standalone scopes, SSR, and utilities need `onScopeDispose` | `duplicate` of V06; scope disposal already works in tested path | Vue conformance |
| V18 | Config `gcTime` should override default; precreated collections preserve theirs | `duplicate` of V07 | PR #1302 |
| V19 | Cross-realm `instanceof` caveat can be revisited | `duplicate` of V08; cross-copy interoperability is unsupported by current AGENTS.md | Shared helper, PR #1302 |
| V20 | Synchronous status avoids skeleton frame; stale callback guard needed | `deferred`: sync part already fixed; stale callback schedule not supplied | PR #1302 |
| V21 | `isEnabled` completes status predicates | `duplicate` of V10 | PR #1302 |
| V22 | Force `startSync:true` after config spread | `already-fixed` on current main | Existing Vue config tests |
| V23 | Patch changeset exists | `already-fixed` in PR head; bot metadata, not a product finding | PR #1302 changeset |

**New finding S01 (outside the 23 raw claims):** An application error with the internal disabled-marker text was swallowed. Baseline focused regression failed because `useLiveQuery` did not throw; the same regression passed with the unique Symbol sentinel. Its durable owner is `packages/vue-db/tests/useLiveQuery.test.ts`.

## Oracle-guide audit

| Requirement | Outcome for the Vue publication oracle |
| --- | --- |
| ORC-001 | The law is the hook's coherent public `data` publication at a synchronous Vue watcher cut, motivated by the PR's explicit behavioral report. Six finite histories bound the claim; the omitted histories are named above and in the coverage map. |
| ORC-002 | Expected rows come from copied source Collection values, not the hook's array update, Vue ref, or observer classifier. |
| ORC-003 | The file names contract, model, grammar, production driver, and refinement check separately. |
| ORC-004 | Not triggered: fixed bounded matrix, no generated-history coverage claim. |
| ORC-005 | The driver invokes the real `useLiveQuery` overloads and source sync transaction; a synchronous public Vue watcher records every `data` callback and confirms source final state at each callback. |
| ORC-006 | Baseline clear+push is the hostile mutant. All six cells failed at the synchronous watcher count assertion and captured `[]` before final rows; repaired cells passed. |
| ORC-007 | Not triggered: no important generated property or random campaign. |
| ORC-008 | Not triggered: the independent model is stateless copied rows. |
| ORC-009 | `source Collection`, `sync transaction`, and public snapshot follow the glossary; plain copied rows are a test-only projection. |
| ORC-010 | The driver captures the primary assertion failure, attempts all cleanup steps, and aggregates separate cleanup errors without erasing the primary cause. No cleanup fault was injected. |
| ORC-011 | No plausible shared semantic fault between copied source values and hook array notification was identified. The alternate supplied-Collection and identity-query paths exercise different hook inputs, but are not called independent semantic formulations. |
| ORC-012 | This versioned record ties the executable evidence to `e11bedc7` and states contract × history × path × observation limits. The six-cell fix does not claim closure for untested Vue histories. |

## Verification and reviewer assessment

- Baseline `ae2eb3fb`: publication oracle **6/6 RED**; sentinel regression **RED**; same-turn readiness and scope-disposal diagnostic **GREEN**.
- Candidate `e11bedc7`: publication oracle **6/6 GREEN** with focused test typecheck; sentinel and existing disabled tests **GREEN**; all Vue runtime tests **106/106 GREEN**; production TypeScript check and formatting **GREEN**.
- Package-wide Vitest typecheck reports 149 existing cross-package `rootDir` errors from shared conformance imports. The runtime assertions pass; the focused oracle typecheck and production TypeScript check pass.

The PR author identified a real, high-signal Vue publication defect and offered a repair with the right atomic shape. Their other proposals mix API design, unmeasured performance claims, and claims already addressed on current main. A narrow `ref` assignment preserves more behavior than the proposed `shallowRef`. As a reviewer sample, this artifact alone is **insufficient to recommend hiring**: the core observation is strong, but prioritization and evidence for the broader refactor are weak.

Loss audit: **23 raw items = 2 fixed-now + 6 already-fixed/stale + 1 refuted + 4 deferred + 3 design-decision + 7 duplicates**. S01 is one additional, fixed-now finding. No raw item or bot comment was dropped. The deferred items have destinations in #1302; V20 specifically needs a held stale-callback schedule before any guard is justified.
