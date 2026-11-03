# Client-backed pages and independent Suspense outputs

[Issue #2345](https://github.com/TanStack/db/issues/2345), evaluated on
2026-11-03. Base and current HEAD: `1443dc92e5417394acbdc98b782caa9802848ce6`.
This record concerns the uncommitted working tree identified by the companion
[source manifest](2026-11-03-client-suspense-page-ownership-manifest.json).
No PR exists; PR readiness and remote CI are **not assessed**.

## Law, authority, and enforcement

A page is the ordered view selected by the outer offset and limit. The shared
adapter contract owns its meaning. DbClient and Suspense are receiving modes;
they do not require a framework-specific page model.

The 2026-10-30 decision for #2291/#2316 retained a binding's Collection on a
finite outer-page change, but explicitly excluded client-backed and Suspense
paths. R1 therefore identifies an unsuitable limit of that accepted contract.
The maintainer extended it in this task and explicitly directed removal of
implicit mutable Suspense Collection sharing. The contract, executable owners,
coverage map, and React overview now record that decision. It supersedes the
compatible-sharing expectation in the earlier local-option/indexing decision.
It does not retire DbClient preload admission rules.

| Law and authority | Previous enforcement gap | Repair and decisive comparison |
| --- | --- | --- |
| Equal query-input bindings own distinct derived Collections; a supplied Collection can be shared explicitly. Maintainer decision, 2026-11-03. | Suspense intentionally reused successful outputs. Ordinary peer page histories were absent. | Shared independent-peer histories compare both outputs through declarative/imperative moves, source writes, and retirement. Successful Suspense results claim exclusive ownership of retry resources. |
| Invalidated inputs that differ only in finite outer offset/limit retain the binding's Collection and upstream subscriptions, including DbClient and Suspense. Same decision extends #2291. | Shared histories had no client/Suspense receiving modes. Svelte had the same exclusion. | React ordinary/Suspense × client/no-client and Svelte client drivers execute the same page owner. Changed plans still replace Collections. |
| Speculative renders cannot move the committed page or acquire its proposed rows. Existing shared adapter contract. | React receiver omitted client and Suspense modes. | Actual React suspended, cancelled, and committed cuts reuse the shared row/identity comparison and check acquisition counts before commit. |
| A successful Suspense binding cannot subsequently adopt another binding's output. Initial retry progress remains owed across discarded refs. Maintainer ownership decision plus existing Suspense loading/error contract. | Removing a cache entry only at success leaves a mounted suspended binding holding an entry subsequently claimed by a peer. | A mounted replacement is blocked before its hook; a peer becomes ready first; the replacement resumes and moves independently. The `missing-peer-claim` mutant fails there. |
| Hook page lookup and preload/hydration use the same page-specific identity; old transported snapshots retain their meaning. Existing SSR contract. | React keyed hooks omitted the outer page from their transport hash. | JSON server-preload receiver compares first/moved seeds before local readiness, local handoff, peer isolation, return, immutable server snapshots, and a same-source client switch. |
| An unchanged explicit query key retains the authored input. Existing shared comparing-identity contract. | Svelte client driver was absent, concealing re-preparation of stable-key input. | Shared stable-key histories now receive Svelte DbClient; changing options/input behind the same key cannot change the authored query. |

The source registry is not a registry of ordinary hook Collections. Re-registering
a moving local Collection is unnecessary. Each binding retains its Collection;
a client-backed move creates an observer for the requested page's transport
hash. That preserves old preload/hydration snapshot identities.

Suspense retains a short-lived cache of **unclaimed preloads** because React can
discard hook refs before commit. Returning a ready result claims that Collection
and removes it from retry lookup. A resolver ownership token follows an adopted
compiled plan; a peer claim forces a fresh output. The existing failure retry
and abandoned-preload cleanup remain exercised.

## Experiment order and RED evidence

The append-only scratch ledger was created from the raw issue before tests or
edits. R1/R3 were grouped around adapter reuse and R2 around transport identity.
The owner and receiving paths were extended before production changed. After
the maintainer expanded the scope, the Suspense ownership and Svelte receiving
extensions also ran before their production changes.

| Preproduction experiment | Result on unchanged implementation | Saved log in `/private/tmp/` |
| --- | --- | --- |
| React render receiver, original client extension | 24 no-client cells passed; 72 provider/explicit/descriptor cells failed retention. Speculative acquisition neighbors were observed. | `2345-complete-red.log` |
| Corrected JSON page receiver | 6 failed, 2 passed: ordinary derived retention failed at moved seed; keyed ordinary/Suspense lookup failed at first seed. | `2345-client-red-valid.log` |
| Expanded ownership/options contract | 272 failed, 1,153 passed; independence and page retention rejected. | `2345-suspense-contract-red.log` |
| Real React Suspense/render and shared page receivers | 124 failed, 421 passed. | `2345-suspense-receiving-red.log` |
| Mounted replacement resumes after peer readiness | All 8 campaigns failed exclusive output identity at `resumed binding owns its output`. | `2345-retry-owner-red.log` |
| Svelte client receiver | 18 failed, 6 passed; 130 unrelated tests unselected. Retention and stable-key rows failed. | `2345-svelte-receiving-red.log` |

Early missing-import/selector errors were repaired before production edits and
are not RED evidence. A cache-deletion simplification failed async initial
progress; those interrupted experiments are not completed RED campaigns.

## Grammar, model, paths, and checkpoints

The primary owner remains
`packages/db/tests/conformance/window-history-oracle.ts`. Its independent rule
sorts, filters, and slices complete numeric source rows. It contains no production
hash, graph, cache, resolver, or incremental classifier. Explicit authored-plan
fields distinguish page changes from plan changes. Public ordered rows, keyed
map values, Collection identity, upstream owner continuity, and subscription
count transitions reach comparisons after each driver's native flush.

The shared grammar retains direct/nested queries; derived/changing/stable/opaque
keys where supported; empty rows, ties, zero widths, jumps beyond the end;
filter/order/projection/nested-window/source/Collection-option changes; and source
updates and growth after reuse. Sources contain up to 12 rows with ranks 0–20;
ordinary offsets are 0–12 and widths 0–6, with compulsory adjacent moves and
safe-integer maximum witnesses. It excludes non-finite bounds from its claim.
A stable key is deliberately not interpreted as a new authored page.

Pending histories hold real subset acquisitions: initial page move before
readiness, obsolete settlement while the latest stays pending, initial readiness,
overlapping moves, obsolete settlement, final latest rows, and unmount while
pending. Before an initial Suspense result succeeds, the receiver checks actual
fallback and absence of a returned Collection. Retention begins at first success.
Publication-callback histories require actual callback entry before changing the
parameter and check the retained Collection after the native host settles.

New peer histories construct two equal declarations, move one declaratively and
imperatively, update their shared source, retire one, and move its surviving peer.
Widths 1–3 and jumps 1–4 vary independently. These histories run in all six
adapters; React adds ordinary/Suspense/client modes and Svelte adds client mode.

React's render receiver crosses ordinary/Suspense, no-client/provider/explicit/
descriptor scope, eager/on-demand, keyed/derived, and offset/limit/both moves.
Every cell reaches suspended/cancelled/committed cuts. A separate retry schedule
crosses client/no-client and keyed/derived ownership after peer-first readiness.
The JSON receiver crosses keyed/derived and ordinary/Suspense hooks with source
counts 1–12, starting offset 0–4, width 1–4, jump 1–4. It compares server-seeded
rows before source readiness, rather than waiting until local rows hide lookup
errors. Client switching uses the same concrete source to distinguish client
scope from source identity.

Reconstruction: compulsory moves reproduce R1; imperative peer moves reconstruct
R3; seeded first/moved pages and retained server snapshots reconstruct R2's
identity concern and sibling S1. Svelte stable-key histories reconstruct S2.
The ownership retry schedule reconstructs the peer-first counterexample that a
simple cache eviction misses. The issue's exact heavy grouped-join timing
benchmark was not rerun; the reusable admission defect is reproduced directly.

Ablation: removing client modes loses R1/S2, keyed seeds lose S1, held readiness
loses the seed/local distinction, peer actions lose mutable-output isolation,
client switch loses scope separation, and speculative cuts lose precommit
mutation/acquisition checks. Offset/limit/both and zero/large bounds distinguish
narrow page patches. Removing changed-plan and stable/opaque controls would
incorrectly admit retention where the contract requires recompilation or keeps
the authored query. Negative/non-finite bounds and arbitrary external schedules
are outside this grammar; it does not classify them as successful page moves.

The model retains independent authored inputs, source rows, and prior output
identities because a next move or source write distinguishes each. It has no
retry-cache state. “Peer” is a second framework binding over the same source;
“page” maps to the glossary's outer window. No speculative hook object identity
is promised before initial success.

## Mutation calibration and replay

Every mutant below failed by the intended assertion, with shrinking preserving
the named law and checkpoint. None was counted from a timeout or setup failure.
All mutations were restored before final verification.

| Mutant | Rejected observation |
| --- | --- |
| Restore React client reuse exclusion | `outer window retains Collection`, moved preloaded page before local readiness |
| Keep the old observer on a client page move | `ordered window rows`, moved preloaded page before local readiness |
| Permit retention across clients | `changed plan replaces Collection`, same-source client scope switch |
| Restore old keyed hash | `ordered window rows`, first preloaded page render |
| Keep claimed Suspense outputs in retry lookup | Independent peer Collection identity before page move |
| Remove peer-claim invalidation | Independent resumed output after peer-first readiness |
| Restore Svelte client reuse exclusion | Collection retention at input 1 |
| Re-prepare Svelte stable-key input | Ordered rows at input 1 |

Representative commands:

```sh
pnpm --filter @tanstack/react-db exec vitest run tests/client-window-oracle.test.tsx -t 'derived/ordinary/fixed' --coverage.enabled=false
pnpm --filter @tanstack/react-db exec vitest run tests/window-render-oracle.test.tsx -t 'retry ownership/client/derived/fixed' --coverage.enabled=false
pnpm --filter @tanstack/svelte-db exec vitest run tests/conformance.svelte.test.ts -t 'window history :: svelte \(DbClient\).*stable/direct window histories \(fixed\)' --coverage.enabled=false
```

Checked direct replay with the client-exclusion mutant:

```sh
TANSTACK_DB_ORACLE_PROPERTY=react.client-window TANSTACK_DB_ORACLE_SEED=2345 TANSTACK_DB_ORACLE_PATH=0 pnpm --filter @tanstack/react-db exec vitest run tests/client-window-oracle.test.tsx -t 'derived/ordinary/fresh' --coverage.enabled=false
```

It ran directly and rejected the same moved-seed retention law. Fixed and fresh
campaigns use the same property/driver/comparison and budget. Fixed seeds are
2291 for shared/render campaigns and 2345 for client/peer/retry campaigns.
No oracle run budget was lowered or removed.

## Lossless issue ledger

Raw source: the issue body, no comments as retrieved on 2026-11-03. Reported
revision: rc.1.2 / `1443dc92e`. The issue supplies a Bun 1.4.0 / React 19.3.1 /
happy-dom production benchmark with 5,000 orders, 20,000 items, grouped sum plus
join/filter, width 20 and ten page changes over three runs.

| ID | Original claim and remedy | Technical verdict and action | Durable value/destination |
| --- | --- | --- | --- |
| R1 | `forSuspense || dbClient` prevents previous-Collection reuse; provider/Start and descriptor paths rebuild every page. Reported 11 Collections vs 1, 113–120 ms vs 5.5–5.7 ms. Expected automatic setWindow reuse. | Functional claim confirmed by preproduction retention failures; **fixed-now** under maintainer's contract extension. Numeric timing and exact workload were not independently measured. | Shared client/Suspense mode registration, real React descriptor/provider/explicit cuts, and Svelte client receiving path. |
| R2 | Registry hash includes outer page and is used by preload/dehydrate/hydrate. Suggest re-registering the moved Collection under the new hash. | Identity concern valid; re-registration is unnecessary because ordinary outputs are local. **accepted-design**: preserve snapshots and rebind the observer. S1's separate hash mismatch is repaired below. | JSON seeded-page histories, immutable server snapshots, peer independence, and same-source client switch. |
| R3 | A stable key plus layout-effect imperative setWindow retains one client-backed Collection; window engine works and adapter admission is missing. Reported 5.6–6.5 ms. | Imperative behavior confirmed by shared client peer histories; **accepted-design**. Timings not independently measured. Automatic invalidated-page reuse repaired under R1. | Declarative and imperative moves judged by the same model; stable-key authored-input control retained. |
| S1, discovered sibling | React keyed hook hash omits outer page, missing keyed preload seeds. | **fixed-now**; first-seed RED and keyed-hash mutant reject the defect. | React JSON page receiver; canonical public transport hash on invalidation. |
| S2, discovered sibling | Svelte DbClient re-prepares a stable-key authored query. | **fixed-now**; shared stable-key RED and mutant fail ordered rows. | Shared stable-key client driver, retained authored prepared input. |
| U1, maintainer extension | Independent Suspense calls must not share mutable derived outputs. | **fixed-now**; ownership/peer-first RED and both sharing mutants reject. | Shared peer owner, local-options/indexing ownership comparisons, real React retry schedule. |
| U2, maintainer extension | Svelte already supports DbClient; future adapters should receive the same law. | **fixed-now** for current Svelte/React modes; portable shared contract and driver API for future implementations. | Shared page owner, no React-specific expected page model. |

Raw accounting: 3 items = 1 fixed-now + 2 accepted-design; no dropped items,
refutations, deferrals, unresolved product decisions, or confirmed-open functional
items. Siblings/extensions are separate from the three raw items. Exact timing
claims remain unverified measurements and are not used as a performance promise.
The final loss audit returned to the raw body and reconciled the code fragment,
benchmark, workaround, expected behavior, registry hypothesis, and proposed fix.

Reviewer assessment: the reporter found the exact admission guard and supplied
an unusually useful reproducible benchmark. Accuracy and signal were high;
priority was appropriate. The proposed registry repair was a hypothesis rather
than a demonstrated necessity. They missed Svelte, keyed seed lookup, and mutable
Suspense ownership. **Lean hire for debugging**, based on this narrow sample;
this issue alone does not establish broader review or engineering performance.

## Oracle rubric outcomes

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Law authority is recorded above and beside the owners. User-approved extensions are distinct from existing seed/key/scheduling obligations. |
| ORC-002 | Independent authored-plan comparison and full sort/filter/slice; no resolver/hash/cache machinery computes expected output. |
| ORC-003 | Opening/local prose identifies law, model, grammar, production entry, and comparisons. Receiving drivers name the shared judgment. |
| ORC-004 | Reconstruction, ablation, finite range, and exclusions are recorded above. Known heavy-workload timings are explicitly outside the executed evidence. |
| ORC-005 | Actual six-framework paths, React Suspense fallback and render cuts, Svelte client, seeded first render, and per-path reach. Before local readiness the receiver supplies the exact seed; later rows do not stand in for earlier lookup. |
| ORC-006 | Eight intended assertion failures and checked replay, classified above. Core indexing comparison also rejects oversharing. |
| ORC-007 | Fixed/fresh campaign parity; checked seed/path replay. No `fc.commands` grammar, so command replayPath is inapplicable. |
| ORC-008 | Only authored source/input/prior identity is modeled; next move/write distinguishes it. No production cache state was copied into the model. |
| ORC-009 | Framework binding, Collection, source, readiness, window, and checkpoint use glossary meanings; page/peer mapping is explicit. |
| ORC-010 | Existing failure-fidelity wrapper and ScenarioLifetime preserve primary law/cut and distinguish cleanup errors. Mutation shrink/replay retained the intended failures; driver-scoped clients are cleaned after the suite. |
| ORC-011 | No concrete semantic fault shared by the scalar model and production was identified. A second formulation is not triggered; agreement alone is not claimed as evidence. |
| ORC-012 | This versioned record, source manifest, reach, ledger, and limits identify the exact evaluated tree and all numbered outcomes. |
| ORC-013 | Offset-only/limit-only/both; zero/large bounds; stable/changing/opaque identities; peer-first retry; and same-source client switches distinguish nearby wrong boundaries. |
| ORC-014 | Real framework drivers receive controlled source/acquisition premises and share the same judgment. JSON transport uses real DbClient/server/browser-hook paths. No real Electric, hydrateRoot, or network transport claim follows. |
| ORC-015 | Declared reach fails on missing states and is measured below separately per receiving mode/campaign. |
| ORC-016 | Generated/fixed receivers use the shared model/checker. Supplemental lifecycle examples stay in the ordinary uncommitted-render test file. |

## Limits and code weight

Evidence bounds closure to the stated finite history × actual adapter mode ×
public checkpoint domain. It does not prove all schedules, arbitrary query
operators, non-finite bounds, the original elapsed-time benchmark, actual Start
routing, hydrateRoot, or a live Electric service. Core acquisition/window and
materialization owners retain those contracts; no files under `query/live/`
changed. No known reachable violation remains in the exercised domain.

Three existing lifecycle examples required sharing. They now preserve async
first-load retry, independent later success, surviving-peer liveness, and source
cleanup obligations. An independent later query must receive a legal completion
from its source; the old fixture's never-completing second request cannot prove
that promise. Already-loaded demand now completes synchronously with `true`.

`pnpm size:compare --base 1443dc92e --exact-base --packages react-db` measured
React's production package at 4,297 → 4,404 gzip bytes (**+107**), brotli **+99**.
The typical tree-shaken app grew 96,397 → 96,632 gzip bytes (**+235**), brotli
**+132**. Independent ownership and canonical transport identity account for
the added shipped state. Removing the retry cache caused initial async hooks
to keep suspending; that simplification was rejected. Redundant stream-identity
state was removed instead.

The size script assumes Vite entry points and cannot build Svelte's package
format (`index.html` missing). Both Svelte trees were therefore built with their
normal `svelte-package` command, compiled with the same production Svelte
compiler, then bundled/minified with esbuild and dependencies external. Package
size changed 2,367 → 2,431 gzip bytes (**+64**) and 2,144 → 2,203 brotli bytes
(**+59**). That added state keeps client scope and stable-key authored input.
Neither comparison counts test or report text as shipped bytes.

## Measured reach

Counts below are histories entering each declared state, not action totals.
The normal fixed and fresh campaigns both include the owner's fixed witnesses.
Minimum reach remains one per declared state, with fixed-example reach required.
React/Svelte detail comes from runs with `--disableConsoleIntercept` so passed
test output is retained. Other adapters' peer-only runs collect the same counters.

| Receiver | Campaign cells | Reach for every declared state in each cell |
| --- | --- | --- |
| render | 192 | 7 histories per state per cell |
| client window | 8 | 7 histories per state per cell |
| retry | 8 | 7 histories per state per cell |
| peer | 22 | 7 histories per state per cell |
| pending | 14 | 7 histories per state per cell |

Render states: suspended move, cancelled move, committed move. The 192 cells
are all ordinary/Suspense × four client scopes × eager/on-demand × keyed/derived
× offset/limit/both × fixed/fresh. Client states: first seed, moved seed, local
handoff, peer isolation, returned page, client scope switch, in all eight
keyed/derived × ordinary/Suspense × fixed/fresh cells. Retry states: replacement
suspended, peer ready first, replacement resumed, page isolated, in all eight
client/no-client × keyed/derived × fixed/fresh cells.

Peer states: independent outputs, declarative isolation, imperative isolation,
source write isolation, peer survives retirement. Each listed mode reached all
five states seven times **in each** of its fixed and fresh campaigns:

- `angular`
- `preact`
- `react`
- `react (DbClient)`
- `react (dependency list)`
- `react Suspense`
- `react Suspense (DbClient)`
- `solid`
- `svelte`
- `svelte (DbClient)`
- `vue`

Pending states: initial loading move, initial oldest settled while latest pending,
initial ready, overlap pending, oldest settled while latest pending, settled
latest, unmounted pending. The modes are React ordinary, React dependency-list
registration, React Suspense, React DbClient, React Suspense DbClient, Svelte,
and Svelte DbClient, each fixed/fresh. The dependency-list name is a retained
registration/replay label, not another current production API path.

All 100 normal window campaign cells reached every declared state 13 times,
except stable-key source writes listed below. Window cells are direct/nested ×
applicable derived/changing/stable/opaque forms × fixed/fresh: 16 per React mode
and Svelte DbClient; four for reactive Svelte. State sets are explicit in the
owner: derived includes page/plan/option changes, writes/growth; changing omits
option changes; nested adds nested-window changes; opaque omits page-retention
claims and adds opaque-key change; stable declares stable-key and source-write
only. Every stable-key state reached 13 histories. Writes are conditional on
available modeled rows; exact source-write counts follow.

| Stable-key receiving cell | Source-write histories |
| --- | --- |
| react Suspense/stable/direct/fixed | 13 |
| react Suspense/stable/direct/fresh | 13 |
| react Suspense/stable/nested/fixed | 13 |
| react Suspense/stable/nested/fresh | 11 |
| react (DbClient)/stable/direct/fixed | 13 |
| react (DbClient)/stable/direct/fresh | 13 |
| react (DbClient)/stable/nested/fixed | 13 |
| react (DbClient)/stable/nested/fresh | 12 |
| react Suspense (DbClient)/stable/direct/fixed | 13 |
| react Suspense (DbClient)/stable/direct/fresh | 9 |
| react Suspense (DbClient)/stable/nested/fixed | 13 |
| react Suspense (DbClient)/stable/nested/fresh | 12 |
| react/stable/direct/fixed | 13 |
| react/stable/direct/fresh | 12 |
| react/stable/nested/fixed | 13 |
| react/stable/nested/fresh | 13 |
| react (dependency list)/stable/direct/fixed | 13 |
| react (dependency list)/stable/direct/fresh | 9 |
| react (dependency list)/stable/nested/fixed | 13 |
| react (dependency list)/stable/nested/fresh | 9 |
| svelte (DbClient)/stable/direct/fixed | 13 |
| svelte (DbClient)/stable/direct/fresh | 13 |
| svelte (DbClient)/stable/nested/fixed | 13 |
| svelte (DbClient)/stable/nested/fresh | 10 |

Every publication-callback campaign reached callback entry and callback update
settlement in nine histories. Offset/limit request reach varies with the chosen
move; exact counts are below. Each declared state also has a fixed witness.

| Mode/campaign | Offset request | Limit request | Entry and settlement, each |
| --- | --- | --- | --- |
| react Suspense/fixed | 6 | 5 | 9 |
| react Suspense/fresh | 5 | 7 | 9 |
| react (DbClient)/fixed | 6 | 5 | 9 |
| react (DbClient)/fresh | 6 | 5 | 9 |
| react Suspense (DbClient)/fixed | 6 | 5 | 9 |
| react Suspense (DbClient)/fresh | 6 | 6 | 9 |
| react/fixed | 6 | 5 | 9 |
| react/fresh | 5 | 5 | 9 |
| react (dependency list)/fixed | 6 | 5 | 9 |
| react (dependency list)/fresh | 7 | 5 | 9 |
| svelte (DbClient)/fixed | 6 | 5 | 9 |
| svelte (DbClient)/fresh | 5 | 6 | 9 |
| svelte/fixed | 6 | 5 | 9 |
| svelte/fresh | 8 | 7 | 9 |

## GREEN and closeout checks

| Check | Result |
| --- | --- |
| Full React package: `pnpm --filter @tanstack/react-db exec vitest run --coverage.enabled=false` | 39 files, 4,729 tests passed; no type or unhandled errors (`2345-react-all-green-two.log`) |
| Full Svelte package, same Vitest command/filter | 15 files, 532 tests passed; no type errors (`2345-svelte-all-final.log`) |
| React affected owner/receiving campaign | 1,669 passed before supplemental lifecycle example updates (`2345-exclusive-green-two.log`) |
| Core indexing checker calibration | 245 passed; no type errors (`2345-indexing-checker-green.log`) |
| Preact conformance | 138 passed |
| Vue conformance | 133 passed |
| Solid conformance | 97 passed |
| Angular conformance | 88 passed |
| Per-adapter peer reach reruns | 2 tests each passed in Preact/Vue/Solid/Angular; unrelated tests unselected |
| Svelte production package build, baseline and repaired trees | Both passed |
| Svelte `test:types` | 0 errors, 0 warnings |
| React explicit TypeScript check | Passed before supplemental lifecycle update; final full Vitest typecheck also passed |

The first complete React attempt identified three obsolete sharing expectations.
A later test-fixture edit returned `undefined` where the typed subset API requires
`true`; its run had passing runtime assertions but unhandled type errors. It is
not GREEN evidence. The corrected final run above exited cleanly. Existing
non-fatal source-cleanup/index advice and React act warnings in some controlled
receivers do not supply product evidence; declared reach and comparisons do.

Final Svelte conformance rerun after driver-client cleanup: 154 tests passed,
no type errors (`2345-svelte-conformance-last.log`). Full explicit ESLint on all
changed TypeScript files passed; the last supplemental lifecycle edit also
passed ESLint. Final `pnpm lint:changed` exited 0, and `git diff --check` passed.
All 18 source-manifest hashes matched the tested tree at closeout. No changeset,
commit, follow-up push, or PR was created.


## Production simplification and focused safety review, 2026-11-03

The maintainer requested net-negative production code after the repair. This
append-only entry supersedes the earlier code-weight measurements for the
current source. The earlier evidence remains historical. Its manifest digest
is `1972e2bfdc64b61c11996f50db5c0afc5433cdb50b028220a1d59166dccb1e55`;
the companion manifest preserves that complete snapshot in `priorManifests`.
The current manifest adds `useLiveSuspenseQuery.ts`, for 19 source files.

The accepted laws, independent models, history grammars, comparison checkpoints,
and oracle budgets did not change during this simplification. No test
expectations were changed. This is a focused self-review of the cuts, not a
new independent audit or an expansion of the original closure boundary.

### Structural reductions

- Move Suspense retry resources into `useLiveSuspenseQuery.ts`. The ordinary
  hook takes a type-only binding dependency, so ordinary apps omit the cache.
  One Suspense binding holds the previous output, readiness and preload promise
  in place of three separate refs plus ownership state in the ordinary hook.
- Remove the identity-error catch, stored field and wrapper metadata. Derived
  preparation already requires a stable identity; keyed inputs hash at their
  resolution boundary. The later streaming fallback could not receive a valid
  input that these earlier gates rejected.
- Hash only when query identity invalidates the authored input. Existing stable
  explicit-key behavior remains authoritative.
- Replace three cache status listeners and their remover array with one
  `status:change` listener. Keep first-load failures through React's immediate
  retry. Clear a failed preload at the wrapper's common error boundary.
- Remove the forwarding hook and single-use cache-map lookup helper. Share the
  absent-client scope token between retry resources and first-load errors.
- Use one previous-resolution record in Svelte instead of parallel Collection,
  client and keyed-input records. Delegate disabled-query resolution to the
  resolver, while preserving supplied-Collection ownership.

The retry cache itself remains necessary: its earlier removal prevented async
first mounts from progressing after React discarded their refs. A first
simplification reduced the React package by 89 gzip bytes but grew the typical
app by 165; moving retry machinery to the Suspense module resolved that cost.
A proposed Svelte hash-assignment consolidation grew its gzip/brotli size by
4/8 bytes and was dropped. An owned-output early return was also dropped:
using the common resolution path updates the retry resource when its output
changes, instead of retaining the old resource throughout the binding lifetime.

### Final shipped weight against the original base

React command:
`pnpm size:compare --base 1443dc92e --exact-base --packages react-db`.
Svelte uses the same production compilation/bundling method described above.
Tests and contract/review text are not included in these production measurements.

| Bundle | Base gzip | Current gzip | Gzip difference | Brotli difference |
| --- | ---: | ---: | ---: | ---: |
| React package, all exports | 4,297 | 4,253 | -44 | -56 |
| Svelte package, all exports | 2,367 | 2,410 | +43 | +34 |
| Sum of separately compressed adapter packages | 6,664 | 6,663 | -1 | -22 |
| Typical tree-shaken React app | 96,397 | 96,244 | -153 | -202 |

The adapter-package sum is almost unchanged; it is not one app bundle. Svelte's
remaining growth pays for client scope and stable-key authored-input retention.
Every other measured React app scenario also shrank (158–187 gzip bytes).
Relative to the initial successful repair, the two package bundles together
shrank by 172 gzip bytes. No comment or identifier shortening supplied a cut.

### Which oracles protect the cuts

The existing owners were extended for the original fix before production was
changed; unchanged older receiving paths alone did not cover the reported bug.
The simplification ran those same extended owners without expectation changes.

| Obligation | Instrument and observations | Evidence strength and limits |
| --- | --- | --- |
| Page reuse, changed-plan/client replacement, independent peers | Shared page sort/filter/slice model; React ordinary/Suspense and React/Svelte client receivers. Compare ordered rows, output identity and retained upstream subscriptions. | Generated fixed/fresh histories plus eight rejected semantic mutants. Finite pages/operators and controlled source delivery only. |
| No work or page mutation from an abandoned render; peer-first retry ownership | Actual React suspended/cancelled/committed render receiver with shared comparison. | The stale-ownership mutant fails after the peer renders first. It does not establish every concurrent React schedule. |
| Page-specific preload and hydration identity | JSON-transported server preload receiver, before local readiness and through local handoff/client switch. | Restoring the old keyed hash or observer fails at the corresponding public row checkpoint. No actual Electric, Start router or hydrateRoot claim. |
| Earlier identity rejection makes the deleted fallback redundant | Existing source-ID/deferred-release grammar, unhashable IR through the public Suspense hook, mount/rerender and four later readers. | Bypassing `identifyLiveQuery` with a constant identity makes all eight selected histories render `Query` instead of the required error boundary. Restoring production passes all eight. This is a bounded input grammar, not a proof over every JavaScript input. |
| Initial loading/error progress and cleanup | Full Suspense lifecycle examples, source-release grammar, stream-render receiver and pending peer histories. | Runtime assertions pass. Error-cache retirement/reset combinations have less generated-history coverage than page ownership; no comprehensive lifecycle-schedule claim follows. |

The last row is a coverage limit, not a demonstrated production counterexample.
The status-listener consolidation preserves the same Collection status cases;
no new lifecycle behavior was introduced. The earlier coverage-map limits,
including held commits beyond the GC floor, remain in force.

### Recalibration after relocation

All eight original semantic mutants were retargeted to the simplified source
and rejected at their intended comparisons. Each edit was restored in `finally`.
None was counted from a setup failure, timeout or unrelated crash.

| Mutant edit | Observed rejected law/checkpoint |
| --- | --- |
| Add `!dbClient` to React's previous-Collection admission | Collection retention, moved preloaded page before local readiness |
| Remove `!dbClient` from the observer-preservation condition | Ordered rows, moved preloaded page before local readiness |
| Remove client equality from previous-Collection admission | Changed-plan replacement, client scope switch |
| Replace keyed `getLiveQueryHash` with key-only `getStableValueHash` | Ordered rows, first preloaded page render |
| Disable successful `suspense.claim()` | Independent output identity, peer before move |
| Remove `suspense.ownedByPeer` invalidation | Independent output identity, resumed binding owns its output |
| Add `!dbClient` to Svelte's previous-Collection admission | Collection retention, input 1 |
| Disable Svelte's stable-key comparison | Ordered rows, input 1 |

The checked direct replay still rejects the original retention failure with
property `react.client-window`, seed `2345`, shrink path `0`. The upstream
validation calibration additionally replaced
`identityDeps: [`derived`, identifyLiveQuery(preparedValue, scope)]` with
`identityDeps: [`derived`, `incorrect-constant-identity`]`. The selected existing
source-release grammar rejected successful rendering in all eight cases,
with no type errors. That mutant attacks the upstream gate; it does not claim
that the deleted downstream fallback itself was reachable.

Commands and exact mutant edits are retained in the task-local
`2345-simplify-mutants.json` and `2345-simplify-mutant-upstream-identity.json`.
The original RED evidence and measured reach above retain their original run
identities; no new reach count is inferred from aggregate test totals.

### Verification on the simplified production

- Full React package: 39 files, 4,729 tests passed, no type errors
  (`2345-simplify-react-closeout.log`).
- Full Svelte package: 15 files, 532 tests passed, no type errors on the final
  Svelte source before the rejected hash experiment
  (`2345-simplify-svelte-final.log`). That experiment also passed the full suite
  and was restored exactly; it supplied no necessary correctness behavior.
- After all mutants were restored, the React page/preload/render receivers
  passed all 208 tests, and the targeted earlier-identity-rejection grammar
  passed all eight selected cases.
- Both production package builds passed. Svelte `test:types` reported zero
  errors and warnings. Explicit ESLint and `pnpm lint:changed` passed.

The work remains uncommitted, with no new push or PR. The report's earlier
controlled-boundary limits still apply. No model, comparison or budget was
relaxed to obtain these results.

## Prep review: finding evaluation and additional enforcement

This entry follows the earlier records; it does not replace their experiments.
Review base and HEAD remain `1443dc92e5417394acbdc98b782caa9802848ce6`.
The reviewed implementation was uncommitted. Two independent review roles ran
in parallel: a simplifier and a coordinator with five read-only review angles.
Their aggregate had nine candidate findings and six explicitly rejected
simplification ideas. Sixteen contextual nonfindings are accounted for below.
The review-input manifest pinned 21 paths, including this record and its
companion manifest. The new source manifest below identifies the later tree.
No review agent changed code or independently ran the author's experiments.

Before tests or edits, the evaluator preserved both complete raw reports in
an append-only task-local ledger, `2345-prep-evaluation-ledger.md`. That ledger
retains the original severity, confidence, anchors, proposed cures and caveats.
The grouped plan crossed keyed admission, client scope, transported-page
lookup and supplied-input ownership. The following entries reconcile claims
with executed evidence rather than treating the source review as instructions.

### Laws and the gaps the review exposed

| Law and authority | Earlier evidence and missing distinction | Extended instrument and promised cut | Result / repair |
| --- | --- | --- | --- |
| A disabled input admits no authored plan; first enablement admits one even under the same key. An already enabled stable key retains its authored input. Shared disabled/identity contract and disabled-transition scenario; clarified together in contract.ts. | Enablement had no nonempty-key intersection; stable-key page histories began enabled. | Shared window owner generates initially disabled → enabled with the same key → changed predicate with the same key → changed key. Real ordinary React, Preact and Svelte client receivers compare disabled state, ordered rows and Collection retention/replacement after their host cut. Count 2..10, offset 0..1. | H1: Svelte stayed disabled on first enablement. Require an admitted Collection before stable-key reuse. Removing all stable-key retention fails the next cut, so that narrower-looking cure is rejected. |
| The seeded observer shows its seed until local work settles, then announces the live snapshot. SSR guide “Prepare every server snapshot”, established hydration handoff tests, and observer hydration law 4. | Terminal-status grammar could not express an already-ready Collection whose subset work ends without a row/status event. | Existing observer hydration owner generates seed count 1..3, live count 0..3, version 0..3, both granular and wholesale. Compare current snapshot, last announced snapshot and rebuilt granular rows while held and after subset settlement. Real Svelte page receiver supplies the retained-output premise. | PREP-S1: seed remained after subset settlement. Observer now owns a loadingSubset:change listener that schedules seed handoff. Existing handoff readiness guard still prevents an early transition. No new state. |
| Each requested page has its own transported seed; moving one output cannot retarget a later old-page reader. Independent inputs own distinct Collections. Shared contract and SSR guide’s retained server snapshots. | Existing peer preceded the move; server dehydrate compared the untouched server, not a fresh browser lookup. Svelte had no transported page-move receiver. | Shared transported-page grammar feeds React and Svelte and uses the existing independent window judgment. Preload A/B, JSON transport, mount A and peer, move to B before browser readiness, mount 1..2 fresh A readers, release readiness, return A. Count 1..12, offset 0..4, width/jump 1..4, including empty pages. Compare ordered data, keyed state and distinct outputs at each named cut. | PR-HISTORY-001 and CMT-003: receiving coverage completed; extension exposed PREP-S1. Stable complete-record corruption is rejected at the fresh old-page rows comparison. No native hydrate/hydrateRoot or real Electric claim follows. |
| Changing DbClient scope replaces the binding even for the same concrete source. Existing scope/identity contract. | I1: all eight outer labels called the same ordinary unkeyed switch helper; original evidence overclaimed keyed/Suspense reach. | Pass actual keyed/derived and ordinary/Suspense modes into the explicit-client switch driver; switch once without a page change, then with one. Compare rows and replacement. | Eight later fixed/fresh mode campaigns pass and reject a missing-client-equality mutant. These runs do not retroactively broaden the original pre-edit scope. No DbProvider-context switch is claimed by this helper. |

The page row model remains a complete independent sort/filter/slice. The core
hydration lane reuses expectedView and changes its model phase only at the
explicit controlled settlement; no production classifier computes the answer.
No model rule was changed to forgive the observed failures. The original
source-ID, explicit supplied sharing, initial Suspense readiness, deferred
acquisition, cleanup and finite-domain limits remain authoritative.

### Pre-edit evidence and a corrected receiving driver

H1 first failed both selected Svelte fixed/fresh campaigns at `stable key first
admits enabled plan`: expected source rows, actual empty rows. React's 14
selected admission/transport neighbors passed on the unchanged prep production.
The Svelte transport extension initially used an observation before the
asynchronous handoff could settle; those failures were driver mistakes and
supply no product RED evidence. With a bounded settled cut, it exposed PREP-S1:
the source and query Collection were ready with browser rows while the hook
still showed server rows. The controlled core lane then failed all four
consumer-mode/campaign cells at `subset settled without rows or status changing`.
Only after those comparisons did the evaluator change production.

One setup experiment omitted includeInitialState on the external subscription,
and another used an unbound unsubscribe. Neither counts as RED. The corrected
core driver explicitly establishes and asserts held subset work before attach.
The diagnostic handoff spy, later removed, observed calls only while subset
work remained held and no retry at settlement.

The first Svelte receiving driver used a configuration getter accepted at
runtime but absent from the public typed overloads. A full run passed 538
runtime tests but exited nonzero for that driver's type error; it is not a GREEN
result. The driver was changed to the public config-object form with reactive
query and queryKey getters, without a cast. The previous prep production was
then restored temporarily, rebuilt and compared again: core 4/4 and typed
Svelte 6/6 selected tests failed at the same admission/handoff comparisons,
with no type errors (`2345-prep-typed-preedit-*.log`). Final source was restored
in finally and DB rebuilt. These later typed RED runs calibrate the corrected
path. They cannot retroactively satisfy the original gate's missing typed
public-overload witness; that chronological process gap remains recorded.

### Lossless candidate ledger

| ID | Original claim / proposed action | Executed or source evidence; technical verdict | PR action and durable destination |
| --- | --- | --- | --- |
| I1 (P3) | Client-switch reach mislabeled as keyed/Suspense/DbProvider. Parameterize or narrow attribution. | Source discrepancy confirmed; now actual hook/key dimensions execute, with same-page and changed-page switches. Client-equality mutant rejects replacement in all eight cells. | fixed-now; receiver and this corrected historical attribution. |
| B1 (withdrawn bug framing) | Derived C → supplied same C → derived page might retain old resolver permission and corrupt a peer. Consider retiring ownership at supplied input. | Public direct-Collection probes reach this transition in all four ordinary/Suspense × no-client/provider-client paths: C remains C and moves rows [0,1] → [2,3]. Explicit C peers intentionally share its future mutations. The reviewer withdrew the independent-peer corruption inference. No accepted law requires revoking the original binding's permission in this interval. | refuted as the alleged isolation bug; no fence added. Preserve the input-origin experiment here. A future stronger retirement policy would need maintainer authority and generated authored→supplied→authored histories; no such law is proposed for this repair. |
| H1 (P2) | Stable-key Svelte query initially disabled can never enable. Require an admitted Collection. | Confirmed first-enable RED; admitted-plan and changed-key neighbors distinguish retention from unconditional recompilation. | fixed-now; shared keyed-admission grammar, Svelte receiving path and production guard. |
| H2 (conditional P2) | Shallow saved keys alias nested mutated values; snapshot/hash if mutable nested key values are promised. | React and Svelte probes keep [0,1,2,3] after mutating params.minimum in an existing nested key; replacing the nested record produces [3]. This establishes the mechanism, not authority for deep mutable-key semantics. LiveQueryKey's readonly outer array does not decide the nested policy. | design-decision; retain exact ambiguity here. Mutated nested key support would need an identity law and generated lifetime/value dimension, with real Svelte reception. Do not silently add snapshot machinery. |
| H3 (no actionable severity) | Retained initial Suspense readiness may show an incorrect pending page. | Original reviewer found no distinguishing failure. Existing pending-page histories and all ordinary/Suspense transported-page cells pass the named finite ready→pending/seed→local cuts; page/hash and peer mutants fail their comparisons. | refuted within that named witness domain, without a universal readiness claim. Preserve broader retry/reset schedules as existing limits. |
| PR-HISTORY-001 (coverage hypothesis) | Svelte lacks transported A→B-before-ready receiving evidence. Add real host receiver. | Confirmed driver absence; shared grammar + real runes/native flush receiver added. Its handoff failure exposed PREP-S1; repaired typed path is recalibrated. | fixed-now; Svelte receiver and shared transported-page grammar. |
| CMT-001 (P3) | Overview promises replacement for every derived identity change. | Introductory universal claim contradicts accepted finite-page law; source check sufficient for prose. | fixed-now; qualify the overview. |
| CMT-002 (P3) | Svelte comment says every move retains observer. | Client page moves retain Collection but replace observer for the new page hash. Observer identity is internal. | fixed-now; comment describes ordinary/client branches correctly. |
| CMT-003 (coverage hypothesis) | Fresh browser lookup of old page after move unobserved. | Generated 1..2 late readers added to both host receivers. Complete stable browser-record corruption fails fresh-old-page rows. Earlier snapshot-only/index-guess faults do not establish all-mode sensitivity. | fixed-now; per-host declared fresh-lookup reach and calibrated comparison. |
| SIM-N001 | Consider collapsing wrapper Collection and retry entry. | No reduction proposed: wrapper-observed output transition and possibly borrowed resource ownership have distinct lifetimes. Collapsing them erases a needed distinction; no demonstrated smaller replacement. | refuted as a useful reduction; retain readiness/ownership distinction and future async/error retry calibration requirements in this record. |
| SIM-N002 | Consider removing retry cache once outputs become exclusive. | Rejected: React may discard initial suspended refs. Existing cache-removal experiment fails retry progress; exclusive successful ownership does not remove pending retry work. | refuted as a safe reduction; retain cache and its explicit schedule limits. |
| SIM-N003 | Consider removing resolver token or peer-ownership distinction. | Rejected: adopted pending plans and a resumed binding whose resource was claimed by a peer require distinct authority. Existing peer-first-resume mutant rejects stale ownership. | refuted as a safe reduction; retain token/exclusive claim and render receiver. |
| SIM-N004 | Consider merging supplied-Collection and compiled-query Svelte branches. | Rejected: caller-supplied ownership/start policy differs from compiled deferred-start ownership and retention. No materially simpler branch preserves both. | refuted as a useful reduction; preserve distinct paths; B1 keeps the separate origin-policy question visible. |
| SIM-N005 | Consider equivalent ternary or narrower inherited annotation. | No material state/control-flow or shipped-byte reduction; cosmetic churn lacks value for this repair. | refuted as a useful reduction; no edit. |
| SIM-N006 | Consider collapsing legacy receiving labels whose modern calls coincide. | They are explicitly labeled legacy registrations, not different production-path evidence. No production reduction; replay/discovery churn. | refuted as a useful reduction; preserve labels without lending them extra scope. |
| PREP-S1 (new sibling) | Subset-only readiness handoff must announce local rows on an already-ready seeded observer. | Core granular/wholesale RED and real Svelte handoff RED; missing-notification and premature-handoff mutants fail opposite cuts. Distinct from the original report's S1 keyed hash finding. | fixed-now; core hydration owner + Svelte receiver + owned subset listener. |
| PREP-CMT004 (new sibling) | Adjacent identity-change list and Suspense summary repeat universal replacement wording. | Same source/accepted-law contradiction as CMT-001. | fixed-now; update both neighboring explanations without adding behavior. |

No simplification was applied merely because it was suggested. The six SIM-N
items were rejected investigations, not six defects found in production.
No confirmed enforcement repair was offered as an optional user decision.

### Contextual nonfinding reconciliation

These sixteen source observations were preserved separately from the fifteen
candidate/simplification items. They carry no new product-defect allegation.

| Source ID | Original observation and disposition | Evidence limit / durable destination |
| --- | --- | --- |
| I-N1 | accepted-design: sharing expectation changes have explicit maintainer authority. | Contract, task decision and original law inventory; explicit supplied sharing stays. |
| I-N2 | accepted-design: peer grammar uses independent window judgment. | Source review corroborated by fixed/fresh receivers and calibrated peer faults; finite scope only. |
| I-N3 | accepted-design: pending Suspense observes fallback; identity retention starts at successful return. | Shared contract and pending host comparison; pre-success identity is not promised. |
| I-N4 | refuted as an oracle-form concern: no standalone unit example/type assertion identified in these oracle additions. | Declared grammar/checks, shared replay examples, fidelity and lint; source review alone was not runtime evidence. |
| I-N5 | stale as a complete evidence inventory after prep: original six RED/eight-mutant record remains historical. | This append adds prep defects and the typed receiving gap rather than rewriting old results. |
| I-N6 | accepted-design: finite pages and selected controlled host schedules bound the evidence. | Coverage map retains Electric/Start/hydrateRoot and arbitrary retry-schedule limits. |
| I-N7 | stale: earlier manifest is preserved as a prior snapshot; final prep manifest is recomputed. | No author-reported hash is treated as independently verified by the reviewer. |
| I-N8 | accepted-design: common owner and neighboring source-ID/release/GC laws remain. | Source inspection; changed receiving paths rerun without entering materialization internals. |
| PRIOR-N1 | accepted-design: old DbClient/Suspense exclusions are explicitly superseded by this task. | #2291/#2316 history and 2026-11-03 maintainer decision. |
| PRIOR-N2 | accepted-design: Infinity→finite capability is not generated finite-domain proof. | Existing coverage-map limit; no new unbounded promise. |
| PRIOR-N3 | accepted-design: replays must select the real adapter. | New prep replay commands name the receiving package and property. |
| PRIOR-N4 | already-fixed historically: validation/pooling concerns were prior resolver repairs. | Current hooks still disable pooling; no new pooled-output counterexample established. |
| PRIOR-N5 | accepted-design: Suspense first-load errors/reset preserve established contract. | Full React suite supplies current example coverage, not arbitrary lifecycle generation. |
| PRIOR-N6 | accepted-design: deferred acquisition and each server snapshot are neighboring obligations. | New held-readiness receiving cuts and existing source-release/SSR owners; no provider leak allegation confirmed. |
| PRIOR-N7 | accepted-design: indexing expectations change only where they depended on implicit output sharing. | Maintainer independence decision, existing option/index owners and full React verification. |
| PRIOR-N8 | stale historical prose, not an instruction: addressed machine-local path and superseded admission retry suggestion. | Retain cleanup-admission law; no bot text authorizes extra product changes. |

### Reviewer assessment

Hire the review team for this task. The historical reviewer found the concrete
H1 mechanism and separated it from unapproved key policy. The instruction
reviewer caught a real path-attribution error. The prior-PR and comment angles
supplied receiving experiments that exposed a second production bug. They
reported source hypotheses as hypotheses and kept lower-confidence ideas.
The initial B1 peer-corruption inference was wrong and was withdrawn; its
input-origin observation still has value. H3 supplied no counterexample.
Prioritization and proposed H1 repair were sound after checking the adjacent
stable-key law. The simplifier showed useful restraint and found no worthwhile
additional reduction. These judgments concern review quality, not independent
confirmation of the author's historical executions.

### Additional sibling PREP-S2: Preact first keyed admission

The first Preact conformance gate failed the two new keyed-admission campaigns
and passed 138 neighbors. The fresh reduced witness was count 2, offset 0,
seed 1402897452, path `0:0`; the failure was ordered window rows at first
enablement. Preact compared key identity while its previous Collection was
null, so it retained a disabled binding. This is the H1 law on another real
receiving path, not a reason to drop that registration as an older bug.
The existing typed ConditionalUseLiveQueryConfig accepts the driver's exact
configuration shape: a query callback may return null. Preact exposes no client
or Suspense path here. The extended owner had already produced this RED on
unchanged Preact before the production guard was changed. The guard now
resolves when no Collection has been admitted, retaining an enabled stable key.
PREP-S2 is a separately accounted fixed-now sibling, with original-guard replay
calibration and the same shared model/grammar/comparisons.

### Calibration outcomes and direct replay

| Wrong design | Observed outcome |
| --- | --- |
| Restore Svelte's disabled-result stable-key shortcut | Both selected campaigns fail first-enabled ordered rows. |
| Remove Svelte's stable-key shortcut entirely | Both fail stable admitted-plan ordered rows. |
| Remove observer subset listener | All four granular/wholesale × fixed/fresh cells fail subset-only handoff. |
| Remove subset readiness guard from handoff | All four fail the held-work seed cut. |
| Ignore client equality in React retained admission | All eight keyed/derived × ordinary/Suspense × fixed/fresh cells fail client-switch Collection replacement. |
| Retarget the complete stable browser old-page record, snapshot and initialSnapshot | React 8/8 and corrected typed Svelte 4/4 cells fail ordered rows at fresh old-page lookup before local readiness. |
| Restore Preact's identity-only admission guard | Captured direct replay fails first-enabled ordered rows; repaired replay passes. |

The browser-record fault chooses A by independently expected row IDs and
returns one stable corrupt record. Earlier index-zero guesses targeted the
wrong page in some cells. Snapshot-only corruption left ordinary initialSnapshot
intact and survived some paths. A newly allocated corrupt record on every
lookup caused a React maximum-update-depth failure outside the comparison.
Those attempts are not credited as all-path kills. The final stable complete
record fault reaches the intended row comparison without type errors.

Direct replay was checked in the real receiving package with
TANSTACK_DB_ORACLE_PROPERTY, TANSTACK_DB_ORACLE_SEED and
TANSTACK_DB_ORACLE_PATH. Each recorded mutant replay failed the original
comparison, then passed after restoration. No fixed campaign precedes these
explicit replays. These grammars do not use fc.commands.

| Property | Seed | Captured shrink path | Package, test file and selector |
| --- | --- | --- | --- |
| framework.svelte-DbClient.keyed-admission | 2345 | 0 | svelte-db; tests/conformance.svelte.test.ts; initial disabled keyed admission.*fresh |
| live-query-observer.hydration-subset-handoff | 2345 | 0:0 | db; tests/live-query-observer-hydration-oracle.property.test.ts; granular seeded ready-subset handoff.*fresh |
| svelte.client-window | 2345 | 0:0:0:0 | svelte-db; tests/client-window-oracle.svelte.test.ts; derived/fresh |
| framework.preact.keyed-admission | 1402897452 | 0:0 | preact-db; tests/conformance.test.ts; initial disabled keyed admission.*fresh |

For each row, run pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false
with the named file and -t selector from that package, setting the three
environment variables to the table's values. The capture and replay commands,
exit codes, and fault definitions remain in the task-local prep calibration
records; these tables preserve the verdict-critical inputs and observations.

### Additional oracle rubric accounting

This table supplements, rather than replaces, the original rubric assessment.

| Requirement | Prep outcome |
| --- | --- |
| ORC-001 | Disabled admission, stable authored input, independent outputs, transported page identity and announced hydration handoff are tied to the shared contract/SSR authorities above. Nested mutable-key support is unresolved policy, not an oracle expectation. |
| ORC-002 | Existing independent sort/filter/slice and expectedView models remain; adapter/core classifiers do not determine expected phases or rows. |
| ORC-003 | Opening/nearby prose describes admission lane, shared transport grammar, host cuts and subset lane. Shared model, grammar, driver and comparison stay distinct. |
| ORC-004 | H1 reconstructs the disabled→enabled witness and distinguishes deleting retention by its next stable-key step. PREP-S1 reconstructs ready+held→settled with no row/status change; removing hold loses early-handoff discrimination, removing settlement loses progress. Transport axes vary page shape/count and late-reader cardinality; removing held readiness or late readers loses the fresh seed lookup cut. Ranges are stated above; counts/offsets/widths are nonnegative finite integers, late readers are 1..2, and no enabled Collection is assumed for a disabled input. Negative widths, no late reader and settlement-before-hold are outside these grammars. |
| ORC-005 | Actual keyed/ordinary/Suspense/client host paths now execute under their correct labels. Svelte config getter correction and its chronological gap are recorded above. Missing source facts are not suspected: page seeds are explicitly transported; subset completion is controlled and asserted. |
| ORC-006 | The table above classifies intended assertion failures and the unsuccessful earlier fault designs separately. No timeout/setup/runtime-only failure supplies a semantic kill. |
| ORC-007 | Each new lane has equal-budget fixed/fresh campaigns, fixed seed2345 and fresh seed logging. Direct property/seed/path mutant RED and restored GREEN were checked as tabulated. |
| ORC-008 | No new reference state machine: core lane reuses Model/expectedView; the driver supplies explicit held/settled phases. The admitted-plan distinction changes first-enable legality and expected result. |
| ORC-009 | Host bindings, Collections, subset work, seed, settlement and window use glossary terms. The shared sort/slice model deliberately abstracts away graph/cache/subscription internals. |
| ORC-010 | Existing failure-fidelity and ScenarioLifetime preserve original law/checkpoint and secondary cleanup diagnostics. Shrunk failures retain the intended first-enable/handoff/fresh-lookup signature. |
| ORC-011 | No new plausible shared-semantic-fault hypothesis needs a second formulation: independent direct arithmetic and explicit controlled phase contrast the production cache/observer rules. Same-path policy probes for H2 supply no accepted model rule. |
| ORC-012 | This append records the added requirements and known limits. Manifest pins the final source; original manifests and process evidence remain historical. |
| ORC-013 | Disabled→enabled and stable-enabled→changed-input distinguish “reuse everything” from “compile everything”; held→settled rejects both missing and premature handoff. Same-page and changed-page client switches reject window-only client replacement. |
| ORC-014 | Real React/Preact/Svelte hooks receive the shared laws. Native Svelte runes/flush and settled handoff cut transfer the controlled subset premise; no new claim about browser hydration or Electric/Start provider delivery is made. |
| ORC-015 | New properties declare and assert per-mode reach; measured counts are reported below rather than inferred from test totals. |
| ORC-016 | Regressions use shared model/driver/comparison; new modules contain no separate expected-answer examples or standalone type assertions. |

### Measured reach and repaired-branch checks

Counts below came from successful normal runs with console interception disabled;
they are the actual createOracleReach counts for each cell. Fixed transported
examples count as histories in those receivers; their six additional random
histories are unchanged between fixed and fresh campaigns.

| Receiving property / modes | Declared states | Measured histories per state, separately in each campaign |
| --- | --- | --- |
| keyed admission: React ordinary, React legacy dependency-list label, React DbClient, Preact, Svelte DbClient | initial disabled; enabled under same key; stable admitted plan; changed key | 6 for every state in every named fixed/fresh cell |
| React transported page: derived/keyed × ordinary/Suspense | first seed; moved seed; local handoff; peer isolation; returned page; explicit client scope switch; fresh old-page lookup | 8 for every state in each of the eight mode/campaign cells |
| Svelte transported page: derived/keyed | first seed; moved seed; local handoff; peer isolation; returned page; fresh old-page lookup | 8 for every state in each of the four mode/campaign cells; no Svelte client-switch claim |
| core ready-subset hydration: granular/wholesale | ready while subset held; subset-only handoff | 8 for each state in all four mode/campaign cells |

Final repaired source passed the following executed gates. All Vitest commands
used at most two workers and ran sequentially; no mutant was active during a
credited GREEN run.

- React: pnpm exec vitest run --maxWorkers=2, 4,735 tests in39 files, no type
  errors (`2345-prep-react-full.log`). The first attempt collided with another
  probe's coverage directory and is invalid; only the later completed run is
  credited. After all prep mutants were restored, the selected client/admission
  receivers also passed14 tests and printed the reach above.
- Svelte: pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false
  --disableConsoleIntercept, 538 tests in16 files, no type errors on the
  corrected typed receiver (`2345-prep-typed-svelte-full.log`). The final
  restored transported-page receiver additionally passed all4 cells after its
  complete-record fault. Svelte test:types found zero errors and warnings.
- Core observer neighbors: pnpm exec vitest run --maxWorkers=2
  --coverage.enabled=false --disableConsoleIntercept over the six
  tests/live-query-observer*.test.ts files,119 tests passed, no type errors
  (`2345-prep-core-observer-neighbors.log`). This includes all13 hydration tests.
- Preact: full pnpm exec vitest run --maxWorkers=2 --coverage.enabled=false
  --disableConsoleIntercept,260 tests in8 files, no type errors after PREP-S2
  (`2345-prep-preact-full.log`). The initial140-test receiving run is RED,
  not a GREEN neighboring run.

The original full Vue/Solid/Angular receiving results remain those recorded
above; their source did not change in prep. No existing run budget was lowered
or removed. The new core listener increases subscription ownership only while
an observer has a client binding and is released with its other listeners.
It does not broaden the finite-page or provider delivery promises.

### Loss audit and readiness

The evaluator returned to both complete raw reports and reconciled their
candidate inventory, prose caveats, considered reductions and contextual
nonfindings against the final diff. Fifteen original candidate/simplification
items resolve to six fixed-now, eight refuted and one design-decision (H2).
The sixteen contextual observations resolve separately to eleven
accepted-design, three stale historical inventories/prose items, one historical
already-fixed item and one refuted oracle-form concern. Thus all31 raw items
are accounted for. The three new siblings PREP-S1, PREP-CMT004 and PREP-S2 are
fixed-now, recorded separately rather than folded into raw-review totals.
No confirmed in-scope counterexample was deferred or removed from comparison.

Implementation and oracle repairs for the accepted laws are complete within
the finite generated histories and host cuts above. H2 asks whether mutating a
nested object already used in queryKey must invalidate authored input, versus
requiring replacement of that nested value. The current accepted contract does
not decide that policy; it has not been encoded or silently excluded from an
existing mutable-key law. No stronger supplied-input retirement law is proposed
from the withdrawn B1 isolation allegation.

PR readiness remains unproven: there is no final commit, pushed final head,
PR or CI run yet. The prep skill's required user confirmation precedes those
steps. Local GREEN evidence is not a final-head integration verdict. The
historical missing typed pre-edit witness remains a process gap despite later
typed RED/GREEN calibration. Native hydration, Electric/Start integration,
nonfinite pages and arbitrary retry/error-reset schedules remain the earlier
explicit evidence limits; no universal bug-class proof is claimed.

### Final prep source identity and shipped weight

The companion manifest now pins24 changed source/contract/coverage files with
combined SHA256
`2c1e7f6caaacc77e2e7c51edf177820466b1cf15723e460116399fcb95517fdf`.
It excludes this report and the manifest itself to avoid self-reference. Its
two prior snapshots preserve the original18-file and simplified19-file trees.
No temporary probe, mutant, local install workaround or Superpowers artifact
is in the product diff. Explicit ESLint and Prettier checks on all changed
TypeScript sources passed; pnpm lint:changed and git diff --check passed.
DB/React/Preact size-compare builds and the final Svelte package build passed.

The final exact-base size comparison uses1443dc92e and NODE_ENV=production.
The typical React app shrinks136 gzip /155 brotli bytes; every other measured
React application scenario shrinks145..170 gzip bytes. The all-exports React
package shrinks44 gzip bytes, core grows17, Preact grows6, and Svelte grows48.
Svelte's corresponding brotli growth is39. The three non-core adapters together
grow10 gzip bytes; those separately compressed package sizes are not one app
bundle. The net-negative result is the measured React application, not every
individual package or the sum of all changed packages. PREP-S1's settlement
notification and first-admission guards were retained because their removal
fails accepted-law comparisons. No additional safe structural reduction was
identified by the simplifier. Commands: pnpm size:compare --base1443dc92e
--exact-base --packages db,react-db,preact-db (with a space after --base), plus
the same Svelte bundle probe used by the earlier entry.


## Maintainer-directed strengthening of Suspense lifecycle coverage

This entry appends evidence after the prep evaluation. The maintainer requested
stronger coverage for the previously weak areas. It adds no production repair
and makes no new nested mutable-key decision. All production source hashes
still match the prior 24-file prep snapshot. The new primary boundary owner is
`packages/react-db/tests/suspense-lifecycle-oracle.test.tsx`; the core
source-health/observer and shared page owners retain their distinct laws.
This is a self-review of the new instrument, not an independent reviewer verdict.

### Law, model, and production boundary

Authority: `docs/guides/error-handling.md`, “Using Suspense and Error Boundaries
(React)”; the hook's JSDoc; shared conformance query identity, retry progress and
exclusive successful output laws; and the existing public cleanup/request
recovery examples in `useLiveSuspenseQuery-recovery.test.tsx`.

A current initial load exposes a fallback until it settles. A first source or
query-preload failure reaches the ErrorBoundary with the original Error or a
wrapped non-Error cause. A stopped source after readiness keeps data and shows
its health problem, including an undefined cause. Cleanup/restart or a new
client request retires the prior initial-view obligation. Its late rejection
cannot poison the replacement. A settled initial load must make retry progress,
and successful independently authored queries expose distinct Collections.
The supplied-Collection overload intentionally permits explicit sharing.

The reference stores only the current model attempt ordinal, public phase,
rows/cause, boundary wrapping policy, and stopped-source health distinction.
The ordinal combines a boundary reset and the source sync run or client request
it now waits for; it is not an acquisition attempt. An old ordinal cannot
change the newest view. A source failure before readiness versus after it
requires different phase/health observations. Error versus non-Error values
require different identity/cause checks. Removing any of those distinctions
merges states with different promised observations. No production retry cache,
observer state machine, resolver token or subscription classifier is copied.
Expected rows are recomputed from history values separately from inserted rows.

Real React 19 ErrorBoundary and Suspense components record the committed host
phase, hook data/keyed state, caught error, Collection identity, and health.
Source histories cross no-client/provider/explicit-client and derived/keyed
receivers. Query-only preload histories use a supplied Collection without a
client or under a provider. That overload has no explicit-client config form.
Client-request histories register actual DbClient request records over a
supplied Collection. Query preload is held through its public method seam;
external provider behavior is not inferred. A source is started explicitly when
the seam holds its query preload. ScenarioLifetime and failure fidelity preserve
the primary mismatch, secondary cleanup diagnostics, and original/reduced trace.

### Driver corrections and calibration-led improvement

The first request driver incorrectly assumed registration replaces an existing
pending DbClient record. It actually deduplicates. Those failures are driver
premise errors, not production RED evidence. The corrected schedules follow the
established recovery examples: fail then reset; register in the old promise's
rejection reaction after its record fails; cleanup/unmount then reject before
registering; or register under another client before the old rejection.
Admission of the new pending record is asserted before comparing its fallback.

An attempted message comparison used the source health message. A derived
query has its own problem message (for example, a source-crash explanation), so
that observation was insufficient. No product defect followed. This owner
explicitly checks Error identity/wrapped cause and leaves message text to the
existing supplied-query boundary examples. The first preload fixture also
failed because it had not started its source and attempted an unsupported
explicit-client supplied-Collection config; both premises were corrected.
The initial TypeScript run found fixture-only type mistakes (fast-check's
inferred-history type, invariant Collection generics and sync key type). The
corrected fixture passes the full package's explicit TypeScript check.
No production change was made in response to any setup or model mistake.

The active-cleanup mutant first survived: the old root was unmounted, so its
late rejection did not render the new root before readiness cleared the error.
That exposed a missing observation cut. The generated driver now explicitly
rerenders the still-pending replacement after the late rejection. The baseline
passes and the mutant fails at that cut. A separate mutant that removes only
the preload-catch client fence survives because the render-time client-record
comparison clears its stale error; removing that latter guard fails. The
single-guard survivor does not show either guard is globally redundant.

### Campaigns and measured reach

The normal command runs 18 campaigns:12 source retry cells, 2 client replacement
cells, and 4 supplied-query preload cells. Each fixed-seed campaign uses 2345;
each fresh campaign chooses and reports its own seed. Both use the same grammar,
model, driver, comparison and run budget. There are 448 generated histories plus
52 fixed example replays, 500 histories total. Examples add to the budgets; no
existing run budget was lowered. Each declared state has minimum 1, and fixed
examples reach every declared state independently of random sampling.

Command from `packages/react-db`:
`pnpm exec vitest run tests/suspense-lifecycle-oracle.test.tsx --maxWorkers=2 --disableConsoleIntercept --coverage.enabled=false`.
Result: 18 passed, no runtime/type-runner failures. The explicit TypeScript check
is separate: `pnpm exec tsc --noEmit -p packages/react-db/tsconfig.json`, exit 0.
The logged reach below is from the final 500-history campaign.

For every retry row, new-attempt pending, retry progress, independent peer and
post-ready failure each reached 27 histories. Pending retirement equals abandon.
`false` means derived identity and `true` means explicit queryKey.

| Scope/key/campaign | fail | crash | abandon | root remount | boundary reset | initial fallback | first failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| none/false/fixed | 6 | 13 | 8 | 11 | 16 | 14 | 19 |
| none/false/fresh | 5 | 9 | 13 | 11 | 16 | 18 | 14 |
| none/true/fixed | 6 | 13 | 8 | 11 | 16 | 14 | 19 |
| none/true/fresh | 10 | 9 | 8 | 15 | 12 | 18 | 19 |
| provider/false/fixed | 6 | 13 | 8 | 11 | 16 | 14 | 19 |
| provider/false/fresh | 8 | 11 | 8 | 11 | 16 | 16 | 19 |
| provider/true/fixed | 6 | 13 | 8 | 11 | 16 | 14 | 19 |
| provider/true/fresh | 6 | 11 | 10 | 11 | 16 | 16 | 17 |
| explicit/false/fixed | 6 | 13 | 8 | 11 | 16 | 14 | 19 |
| explicit/false/fresh | 13 | 5 | 9 | 14 | 13 | 22 | 18 |
| explicit/true/fixed | 6 | 13 | 8 | 11 | 16 | 14 | 19 |
| explicit/true/fresh | 12 | 8 | 7 | 10 | 17 | 19 | 20 |

For each replacement campaign, first-request pending, replacement pending and
replacement ready each reached 36 histories. First-request failure equals the
failure-first count. Late rejection counts both replacement-in-reaction and
client-switch schedules.

| Campaign | failure-first | replace-first | cleanup-first | client-first | late rejection ignored |
| --- | ---: | ---: | ---: | ---: | ---: |
| fixed | 8 | 10 | 10 | 8 | 18 |
| fresh | 8 | 12 | 7 | 9 | 21 |

For each preload row, pending, restart pending and restart ready each reached 26
histories. The late-rejection count includes the forced still-pending render.

| Scope/campaign | failure before cleanup | rejection after cleanup |
| --- | ---: | ---: |
| none/fixed | 14 | 12 |
| none/fresh | 16 | 10 |
| provider/fixed | 14 | 12 |
| provider/fresh | 11 | 15 |

### Hostile mutations and exact replay

All five faults fail by assertion at their intended comparison, rather than by
timeout, setup failure or an unrelated crash. Every fault was restored. Each
captured seed/path was then replayed directly with the guarded runner: exactly
one completed witness was recorded for the selected property in RED and GREEN.
No normal campaign runs ahead of an explicit replay.

| Fault | Property suffix after react.suspense- | Seed | Shrink path | Rejected observation |
| --- | --- | ---: | --- | --- |
| omit pending cache insertion | retry-history | 533028291 | `0:0` | settled load remains pending instead of ready |
| leave claimed output borrowable | retry-history | 32230998 | `0:0` | peer returns the same successful Collection |
| keep errors on Collection cleanup | preload-restart-history | 600053472 | `0:0:0` | restarted query exposes old error instead of pending |
| disable replacement-record error clearing | replacement-history | -2134737032 | `0:0` | replacement exposes old client error instead of pending |
| keep retired preload active | preload-restart-history | -165799692 | `1:0:0:0:1` | forced pending render exposes retired preload error |

Example guarded replay, from `packages/react-db`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=react.suspense-preload-restart-history TANSTACK_DB_ORACLE_SEED=-165799692 TANSTACK_DB_ORACLE_PATH=1:0:0:0:1 node --import tsx ../db/tests/oracle-replay.ts tests/suspense-lifecycle-oracle.test.tsx --maxWorkers=2 --disableConsoleIntercept --coverage.enabled=false -t 'none preload restart \(fresh\)'
```

The replay manifest now names all three new property owners. Scratch logs are
`/private/tmp/2345-strengthen-{reach-final-v2,all-preedit-v2}.log`,
`2345-strengthen-guarded-replays.json` and each referenced guarded RED/GREEN log.
Direct unguarded discovery replays ran first; those logs are not the guarded
execution claim. The versioned tables above retain the verdict-critical results.

### Grammar controls and oracle review

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 | Laws and authorities above; limits below. No new mutable-key policy. |
| ORC-002 | Pure current-obligation model; expected rows derive from input values, not production state. |
| ORC-003 | Opening law/limits, local model, grammar, driver and comparison prose teach their distinct responsibilities. |
| ORC-004 | Reconstruction: fixed fail/crash/abandon examples cover empty and populated results, reset and remount; four replacement examples cover every legal schedule; two preload examples cover rejection on either side of cleanup. Ablation: counts/version distinguish empty/stale payloads; Error/record/undefined distinguish identity, wrapping and presence; rerenders exercise discarded refs; reset/remount exercise retained/discarded roots; client/key cells exercise distinct receiving paths; failure origins and schedules separate source status from wrapper/client errors. Range: rows 0..3, versions 0..3, pending rerenders 0..2, three cause classes. Exclusion: pending registration is never treated as replacement; no same-run readiness after fail/crash; no pre-success Collection-retention requirement. |
| ORC-005 | Actual React host phase plus committed data/keyed state/error/health/identity at named cuts. New-record pending and source-run/demand premises asserted. The late-preload survivor required a forced pending render. No concrete missing-source-fact hypothesis remains for these cuts. |
| ORC-006 | Five semantic faults rejected by assertions; one client-fence survivor classified as protected by a neighboring guard; initial active-cleanup survivor repaired with a new observation cut. |
| ORC-007 | Fixed 2345 and fresh campaigns with identical budgets; all five captured seed/path REDs reproduce and restored GREENs execute exactly one guarded witness. No commands arbitrary, so no commands replayPath applies. |
| ORC-008 | Attempt, phase, cause policy, rows/cause and health distinctions each have the distinguishing next observation described above. No cache/lifetime implementation state modeled. |
| ORC-009 | Model-only attempt explicitly combines initial-view obligations and is distinct from acquisition attempts. Failure events name source, preload or client origin. |
| ORC-010 | Shared failure fidelity keeps law/checkpoint and original/reduced trace; ScenarioLifetime releases resources and preserves secondary cleanup diagnostics. Five replays preserve the intended mismatch. |
| ORC-011 | No plausible shared semantic fault requiring a second formulation was identified. Public source/client signals come from separate paths and feed one boundary model; this is not claimed as a second formulation. |
| ORC-012 | This append-only record, source manifest and per-path tables carry the finite boundary claim and known limits. Earlier process gaps remain recorded. |
| ORC-013 | Failure before/after readiness, old/current ordinal, before/after cleanup, and still-pending/ready cuts distinguish the wrong boundary rules; zero rows remain different from a fallback. |
| ORC-014 | Real React host receives the controlled source/preload/request premises. No actual provider/native-hydration claim. |
| ORC-015 | Minimum1 plus fixed-example reach in each of 18 receiving campaigns; all actual counts above. |
| ORC-016 | Fixed examples use the same model/driver/checker as generated histories; no ordinary unit tests or standalone type assertions were added to the oracle. |

### Evidence block and limits

- **Law:** current initial-view progress, retired-failure isolation, boundary error/health behavior and exclusive successful outputs, from the authority above.
- **Reach:** 500 histories in 18 receiving campaigns; each declared state reached per mode as recorded above.
- **RED:** no new production defect was found in this strengthening pass. Unchanged production is GREEN; the five deliberately wrong branch mutations are assertion REDs with exact guarded replay evidence. Earlier issue/repair parent RED evidence remains in prior entries.
- **GREEN:** all 18 new campaigns pass; final integration checks are appended below.
- **Mutant:** lost retry resource, borrowable successful output, retained cleanup error, stale replacement error, and active retired preload all rejected at the named cuts and restored.
- **Limits:** finite one-source rows and explicit host task checkpoints in React 19/jsdom; no native hydrateRoot, real provider, React18 lifecycle receiver, arbitrary concurrent rendering, exact GC deadline, separately held failure-retirement timer or all error message text. Existing neighboring owners and boundary examples retain those contracts. The source retry lane disables GC so delayed cache eviction is outside its evidence. These are stated coverage limits, not retired product laws. The optional nested mutable-key policy remains undecided. No extra shipped bytes were introduced.


### Strengthening closeout checks and source identity

The full React package passes **4,753 tests in 40 files**, including the new 18
campaigns and existing page, render, local-option, indexing, source-ID, preload,
recovery and error-boundary neighbors. Explicit package TypeScript checking,
ESLint on the new oracle/registry/manifest, Prettier and `pnpm lint:changed` pass.
The five guarded RED/GREEN pairs were repeated after the final model/recorder
edits; each still records exactly one execution and the same intended mismatch.
All production files still match the earlier prep source hashes, so the measured
React application reduction remains 136 gzip /155 brotli bytes. This pass adds
only tests, replay registration, coverage documentation and evidence.

No production defect surfaced in the corrected legal histories. The strengthened
finite claim is protected against the five named wrong designs; it does not
remove the explicit native/provider/GC/concurrency limits above. No commit,
final push, changeset, PR or CI verdict exists yet. The prep workflow's required
confirmation remains the next step.

The refreshed manifest pins **26 source/contract/coverage files**, combined
SHA256 `d4899416d330bf345599932475fd273aa124e4ecb0f51ecf508162d87edc27d2`. It preserves the prior 24-file snapshot alongside
the earlier 18-file and 19-file snapshots. This report and the manifest remain
self-excluded. The unchanged base is `1443dc92e5417394acbdc98b782caa9802848ce6`.
