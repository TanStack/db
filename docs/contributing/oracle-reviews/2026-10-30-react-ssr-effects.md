# React server effect review, 2026-10-30

This records prep-pr finding H1 on parent `c351fc04d7f70dc59bf92ecbed310f899b9511cd`
plus the uncommitted page-window change. It is separate from the historical
page-window records. Later main integration and verification append their own
evidence; they do not change the order reported here.

## Law and repair

React DB supports React >=18 and prepared server rendering. The SSR guide and
#2229 establish ordinary cold/loading and explicitly prepared server views.
React18 diagnoses `useLayoutEffect` during a server render because that hook
cannot run there. An ordinary legal server render must not acquire that warning
merely because client page moves now have a commit callback.

The accepted client window law still requires a committed update. Its layout
commit schedules the move; a provider acquisition can remain pending afterward.
The repair chooses `useEffect` on the server and `useLayoutEffect` in a browser,
once when the module loads. Both hooks keep stable ordering. It changes no
public hook API, query identity, preparation judgment or window expectation.

The original review was source inspection. The previous green SSR comparisons
used React19 and observed rows/status rather than the React18 diagnostic. That
missing receiving runtime and observation explain the test gap.

## Oracle and real receiving paths

`packages/react-db/tests/ssr-effects-oracle.test.ts` reuses the shared
`ssr-snapshot-admission-oracle.ts` grammar and independent preparation model.
The server projection removes later server writes and browser actions. The
ordinary grammar retains 26 preparation/source-state/row-count shapes, with
zero through three rows. Completed-query/ready Suspense and standalone source
inputs retain row-count variation. Query preload while idle remains excluded.

Every runtime has separate campaigns and reach for these receiving paths:

- ordinary hook under `DbProvider`;
- ordinary hook with its explicit client option;
- prepared non-streaming Suspense under `DbProvider`;
- prepared non-streaming Suspense with its explicit client option;
- standalone builder over a concrete source Collection;
- supplied Collection without a client.

A disabled hook has one fixed replay through the same driver and checker. It
is not repeated as a generated property. A checker calibration accepts an
unrelated diagnostic and rejects React18's layout-effect diagnostic.

Ordinary client-backed paths compare rejection or selected rows and status
with the shared preparation model. Suspense exposes no hook status field, so
its prepared receiving path compares selected rows only. Standalone, supplied
and disabled paths judge return and the diagnostic, without adding a transport
or hydration promise. The recorder projects the authored `id`/`name` columns,
as the existing SSR receiving owner does, and rejects malformed selected fields.
Virtual metadata remains outside this shared row judgment. Every diagnostic
stays recorded, while the law rejects only the client-layout diagnostic.

`ssr-effects-driver.tsx` invokes the real React server renderer in an isolated
Node subprocess. esbuild bundles current production sources and redirects all
React imports, including the renderer's internal imports, to one matched
runtime. Every observation asserts both actual versions: React/ReactDOM18.3.1
or the installed React/ReactDOM19.2.4. The package aliases are exact development
dependencies; pnpm's ReactDOM18 peer link is not used by the isolated bundle.
No override or installation workaround was required.

Each path has fixed-seed 2291 and fresh campaigns with 24 generated histories
plus the same 11 shared replay inputs. Each campaign declares reach and requires
its fixed inputs to reach the declared states. Ordinary paths distinguish cold,
prepared ready, source-prepared loading and rejected views. Each other path
requires an actual renderer invocation. Failure fidelity preserves the first
law, path and input through shrinking; cleanup failures stay secondary.

## Experiment order and results

Before any SSR production repair, the expanded receiver and the existing real
client window receiver ran on unchanged production:

```sh
pnpm --filter @tanstack/react-db exec vitest run \
  tests/ssr-effects-oracle.test.ts tests/window-render-oracle.test.tsx \
  --maxWorkers=2 --fileParallelism=false --coverage.enabled=false
```

**RED:** 13 assertion failures, all at `SSR client-layout diagnostic`: the six
React18 receiving paths in both campaigns, plus its disabled replay. Each
receiving path ran independently, so the first failure hid no later path. The
cold ordinary replay was `{preparation:"none", sourceState:"idle", rows:[]}`.
The actual diagnostic began:

> Warning: useLayoutEffect does nothing on the server, because its effect
> cannot be encoded into the server renderer's output format.

The other 38 tests passed: every React19 receiving campaign and disabled replay,
the diagnostic calibration, and all 24 existing client window receiving tests.
Those client histories include committed, suspended and cancelled render cuts,
with eager/on-demand sources and derived/explicit identity. Thus the receiving
gate covered both the new server diagnostic and the neighboring client law
before the repair.

**GREEN:** after the isomorphic effect repair, the same selected tests passed:
51 tests in two files. The source comparison and types remained unchanged in
meaning. Later recorder typing and reach-accounting refinements are described
below; the parent runs the complete combined tree after main integration.

**Mutant:** restoring the original unconditional layout hook on the final
receiver rejected all six fixed React18 campaigns at the intended diagnostic
comparison: six failed, 21 skipped. This was an assertion rejection, not a
setup failure or timeout. The correct source was restored afterward.

```sh
pnpm --filter @tanstack/react-db exec vitest run \
  tests/ssr-effects-oracle.test.ts --maxWorkers=2 --fileParallelism=false \
  --coverage.enabled=false --disableConsoleIntercept --silent=false \
  -t 'react18 .*fixed'
```

**Direct replay:** while that hostile mutant was active, this replay selected
only the requested ordinary-provider history: one diagnostic failure, 26 tests
stood aside. It preserved the original tagged law/path and exact warning.

```sh
TANSTACK_DB_ORACLE_PROPERTY=react.ssr-effects-react18-ordinary-provider \
TANSTACK_DB_ORACLE_SEED=2291 TANSTACK_DB_ORACLE_PATH=0 \
pnpm --filter @tanstack/react-db exec vitest run \
  tests/ssr-effects-oracle.test.ts --maxWorkers=2 --fileParallelism=false \
  --coverage.enabled=false --disableConsoleIntercept --silent=false
```

The final React package `tsc --noEmit` and explicit ESLint on the two receiver
files and hook passed. Changed-file lint also passed. Production mutation had
ended before main integration began.

## Review reconciliation and experiment limits

Three fresh oracle reviewers challenged authority, grammar/fidelity and the
real receiving boundary. Their repairs were incorporated as follows:

- Filter the specific layout diagnostic rather than promising silence for every
  unrelated message; retain raw messages and calibrate both cases.
- Add explicit-client, prepared Suspense, standalone, supplied and disabled
  receiving paths. Separate campaigns ensure every required path runs in RED.
- Preserve first-failure identity and secondary cleanup diagnostics. Use equal
  fixed/fresh budgets, direct per-path replay and fixed-input reach.
- Observe Suspense's actual rows rather than inventing a hook status field.
- Keep disabled coverage as a fixed replay, and count `prepared-loading` only
  when source preparation actually supplied that state.

Intermediate experiments found driver defects before the final evidence:
Suspense has no public status field, and source cleanup needed to end dependent
queries. A later type repair briefly recorded whole public rows, whose virtual
metadata disagreed with the shared selected-column model. That run failed 16
row comparisons and was not GREEN. Restoring the same selected-column recording
with explicit unknown-value checks restored all 51 passes. These were recorder
repairs; no product expectation was changed to match production. Final type and
reach-accounting refinements require the parent's combined-tree verification.

This evidence covers Node server rendering without DOM globals, through
`renderToString`, at completed render/diagnostic observation. It does not prove
streaming Suspense discovery, hydration equality, arbitrary concurrent schedules,
server execution with browser DOM polyfills, every React release, or absence of
all server-side work. Existing admission, hydration and window owners retain
those laws. No new missing-input hypothesis arose for this diagnostic: the
renderer receives the hook call directly.

## Oracle rubric record

| Requirement | Evidence or limit |
| --- | --- |
| ORC-001 | Supported React peer and established prepared SSR; bounded diagnostic and host scope above. |
| ORC-002 | Shared preparation judgment and diagnostic contract do not reproduce resolver/effect branches. |
| ORC-003 | Executable prose states law, projection, grammar, driver, observation and checker. |
| ORC-004 | Shared 26-shape grammar reconstructs cold RED; each axis/path contributes a distinct preparation, data or host boundary; impossible preload/idle combinations excluded. |
| ORC-005 | Actual matched server renderers invoke the public hooks; selected fields and raw diagnostics observed at return. |
| ORC-006 | Unconditional-effect mutant and scoped diagnostic calibration rejected the intended wrong result. |
| ORC-007 | Same 24+11 fixed/fresh campaigns; direct seed2291/path0 replay demonstrated. No command-model replay path applies. |
| ORC-008 | No new stateful reference state; shared stateless preparation judgment unchanged. |
| ORC-009 | Server projection explicitly removes later actions; path names identify real public entry points. |
| ORC-010 | Shared first-failure fidelity plus marked comparisons and secondary cleanup diagnostics. |
| ORC-011 | No plausible shared semantic-classifier fault needing a second model identified; actual renderer versions directly supply the disputed diagnostic. |
| ORC-012 | This chronological record, exact commands and source hashes tie evidence to reviewed sources; final combined reach is appended separately. |
| ORC-013 | Cold/prepared, ready-empty/nonempty, rejected/admitted neighbors; React19 control and unrelated-diagnostic calibration distinguish the boundary. |
| ORC-014 | Both actual installed renderers supply the warning/no-warning premise; real client window owner supplies commit/abandonment neighbors. |
| ORC-015 | Separate runtime/path reach and fixed-input requirement; numeric combined-tree counts appended by the parent. |
| ORC-016 | Fixed replay and calibration use the shared checker; no standalone expected-answer tests added to the oracle. |

## Frozen sources before main integration

| File | SHA256 |
| --- | --- |
| `packages/react-db/src/useLiveQuery.ts` | `ffa5a4fa3e68e9dfbfea2ff3b988db852ecc14f688aeeabbad5ac1a79a09b6e9` |
| `packages/react-db/tests/ssr-effects-driver.tsx` | `9cf27fdbe6f1fbd72629d9ba11880ab650421feb58d82ad174891043b53845c5` |
| `packages/react-db/tests/ssr-effects-oracle.test.ts` | `4052260aa9b192c3773e3147a6d31b568152f563ea869f195f9b602ad66555ce` |
| `packages/react-db/package.json` | `2136a1486e15558a8cd8ec57615db17f6aa5e4032b1afe803404bdd83d99ec0a` |
| `pnpm-lock.yaml` | `aad3ef34e9f98129d6929b4b9c46880b8c9758971da14a5686f479824d1549f4` |
| `packages/db/tests/oracle-config.ts` | `c2c3269f5ce27662cf0eb8e5a2b972c6df307d33482b85b7abda0581e8432d63` |

## Combined-tree verification after main integration

Main integrated normally at `bfd1da1a7e752d66fd667adfd3cdf54f60732b22` after all
mutants were restored. The frozen source hashes above remained unchanged.
The parent then ran the real receiving suite with console interception disabled:

```sh
pnpm --filter @tanstack/react-db exec vitest run \
  tests/effect-callback-oracle.test.tsx tests/useLiveQueryEffect.test.tsx \
  tests/window-render-oracle.test.tsx tests/ssr-effects-oracle.test.ts \
  tests/ssr-runtime-error-handoff-oracle.test.tsx \
  --maxWorkers=2 --fileParallelism=false --coverage.enabled=false \
  --typecheck.enabled=false --disableConsoleIntercept --silent=false
```

**GREEN:** all 154 receiving tests passed, including the 27 SSR effect tests,
24 client window tests and adjacent SSR runtime-error handoff witnesses. Core
integration checks passed 391 tests, and the separate shared React window
selection passed 44: 589 tests total. Core and React TypeScript checks passed
separately from the runtime command.

The [durable reach record](2026-10-30-react-ssr-effects-reach.json) contains all
24 runtime/path/campaign cells. Every cell measured 35 renderer invocations:
24 generated histories and 11 fixed inputs. This gives 840 compared server
renders, plus the two disabled fixed replays. Every declared minimum and each
fixed-input reach requirement passed. Ordinary source-prepared loading counts
refer only to actual source preparation; other admitted empty/loading histories
still run the shared comparison and contribute to `rendered`.

| Runtime | Ordinary path | Campaign | Cold | Prepared ready | Prepared loading | Rejected |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| React18 | Provider | Fixed | 4 | 8 | 10 | 13 |
| React18 | Provider | Fresh | 5 | 10 | 6 | 13 |
| React18 | Explicit client | Fixed | 4 | 8 | 10 | 13 |
| React18 | Explicit client | Fresh | 2 | 8 | 9 | 11 |
| React19 | Provider | Fixed | 4 | 8 | 10 | 13 |
| React19 | Provider | Fresh | 6 | 6 | 7 | 12 |
| React19 | Explicit client | Fixed | 4 | 8 | 10 | 13 |
| React19 | Explicit client | Fresh | 4 | 10 | 8 | 10 |

The bounded H1 enforcement gap is repaired under the law, histories, real paths
and observations described here. This does not remove the stated host/version
limits or change the original page-window work's historical process finding.
