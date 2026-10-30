# Adapter page windows

Authority: the maintainer's 2026-10-30 decision for
[issue 2291](https://github.com/TanStack/db/issues/2291): changing only
`.limit()` and `.offset()` moves the same window. This repairs existing behavior
and adds no hook option. The earlier evaluation's proposed window API was
superseded by that decision.

Base HEAD: `c351fc04d7f70dc59bf92ecbed310f899b9511cd`. Evidence concerns the
working-tree sources identified in the [source manifest](2026-10-30-adapter-page-windows-manifest.json), not an unmodified
checkout of that commit.

## Law and boundary

An invalidated adapter-owned ordered list input with the same structured plan,
source objects and Collection options retains its live-query Collection and
upstream ownership when its finite outer offset or limit changes. Changed
predicates, order, projection, sources, nested bounds or Collection options
compile normally. An unchanged explicit key keeps its authored input.

A window move requires a committed host update and runs after any current
Collection publication. A speculative render cannot move the committed window.
Pending acquisitions retain the last settled page; superseded acquisition
settlement cannot publish an obsolete page. Core's window and publication laws
remain authoritative.

The shared owner is `packages/db/tests/conformance/window-history-oracle.ts`,
registered through all six real framework drivers. Its independent model sorts,
filters and slices complete numeric rows. Explicit scalar comparisons identify
authored plan changes; no production identity or transition helper computes the
expected answer. Rows, order, keyed-map values, Collection identity and the
retained Collection's upstream ownership are observed after each framework cut.

The ownership observation constrains the current retained Collection. An older,
replaced Collection may finish garbage collection during the same step. This
does not measure arbitrary CPU work or every internal compilation strategy.

React and Preact add receiving witnesses that reuse the shared model/checker.
React suspends and abandons a transition before committing another page.
Preact throws after the hook under a real error boundary. A public subscription
keeps its captured Collection active across the fallback.

## Experiment order

1. The original oracle extension ran against unchanged production. The saved
   preproduction gates record an empty production diff and oracle hashes.
   Every adapter rejected Collection replacement. The held-acquisition lane
   reached oldest settlement while the latest request remained pending before
   production changed. React reached suspended, cancelled and committed cuts.
2. Three independent reviewers used `oracle-review`. Their findings added direct
   and nested lanes, source swaps under one explicit ID, projection changes,
   source liveness, keyed state, ownership recording, stable/opaque key controls,
   and cleanup that preserves the original mismatch.
3. Production retained the existing Collection and called its existing
   `setWindow`. Later audits added initial-loading moves, Collection-option
   variation and Preact's aborted-render witness. These are late coverage:
   their GREEN and mutant results do not retroactively extend the first gate.
4. A new shared publication-callback history exposed `SetWindowReentrancyError`
   in Solid, Preact, Angular and Svelte before its repair. React and Vue passed
   that same history. Queuing committed moves after publication repaired it.
5. [Large numeric windows](2026-10-30-topk-numeric-windows.md) exposed the existing TopK numeric-range enumeration
   and partial-bound inheritance defects. Both the primary TopK owner and real
   framework receiving paths were extended before the TopK repair.

Setup errors are excluded from defect evidence. These include an early provider
fixture with unsupported ordering, nested React `act` scopes, and an initial
Preact subscription-cleanup mistake. A direct render-time mutation experiment
also hung and was terminated; the later single-fault injection supplies the
intended assertion failure instead.

## Grammar and observations

The shared grammar varies empty and nonempty sources, ties, direct and nested
queries, offset/limit including zero and out-of-range pages, predicates, order,
projection, nested bounds, source objects and source writes. Bare callback lanes
vary `gcTime` together with a page change. Stable keys and opaque keyed inputs
have separate controls. Large-window histories grow the source after a move,
so bounds clamped permanently to installed row count are distinguishable.

The pending grammar covers moves before initial readiness, an old acquisition
settling while the latest remains held, overlapping ready-page moves, final
settlement and unmount before completion. Its provider controls acquisition
settlement over already installed rows. It does not simulate delayed delivery.

The callback grammar changes offset, limit or both during a public Collection
change callback, proves that callback entry occurred on the publication stack,
then compares the retained Collection after the native update settles.

These axes reconstruct the reported page-change trace and adjacent wrong
designs. Removing any plan/source/option distinction admits unsafe reuse;
removing source writes loses liveness; removing pending or pre-commit cuts loses
temporal isolation. Bounds are nonnegative safe integers; negative and
fractional windows are excluded. Bounded runs do not prove all legal histories.

## Calibration and replay

Hostile edits were temporary and exact source bytes were restored in `finally`.

| Wrong design | Observed rejection |
| --- | --- |
| Rebuild for a page change | Collection-retention assertion |
| Compare source IDs without source objects | Wrong selected rows on a same-ID swap |
| Ignore Collection-option differences | Replacement assertion on an invalidated page input |
| Reuse only after initial readiness | Retention assertions during initial loading |
| Apply one move during React render | Wrong committed rows at the suspended cut |
| Apply the Preact move during render | Wrong captured rows after the aborted render |
| Apply synchronously during publication | Rejected callback update with `SetWindowReentrancyError` |
| Infer changed demand only from installed rows | Missing demand-message assertion |
| Recover an omitted limit from rounded end minus offset | Wrong rows after a partial move |
| Clamp stored bounds permanently to installed row count | Wrong rows after source growth |

Direct replay selected only fresh campaigns. The primary retained-window
failure replayed with seed `2121258135`, path `0`, property
`framework.window-history`, then passed after restoration. Pending and both
render properties also ran direct seed/path replays. The publication-callback
RED replay used seed `1915472220`, path `0`.

Example command, run at repository root:

```sh
TANSTACK_DB_ORACLE_PROPERTY=framework.window-history \
TANSTACK_DB_ORACLE_SEED=2121258135 TANSTACK_DB_ORACLE_PATH=0 \
pnpm --filter @tanstack/react-db exec vitest run tests/conformance.test.tsx \
  -t 'derived/direct window histories' --coverage.enabled=false \
  --typecheck.enabled=false --disableConsoleIntercept --silent=false
```

## Limits

DbClient/hydration and Suspense identify shared results by complete query
identity. This repair does not retarget those shared Collections. Supplied
Collections, opaque-plan optimization, unbounded transitions and `findOne` keep
their existing paths. Those are ownership and API boundaries, not evidence that
every existing API can reuse every compiled result.

The model covers finite numeric rows and selected projections, not every query
operator or arbitrary concurrent schedule. Core ordered-window owners retain
delivery, cancellation, failure, repair and progressive-includes obligations.
The controlled acquisition fixture supplies no real-provider conformance claim.
No whole-PR readiness or universal bug-class proof is asserted.

## Oracle audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Maintainer authority, existing identity law and core publication laws stated above; scope explicit. |
| ORC-002 | Scalar authored-plan comparison and full sort/filter/slice use no production classifier. TopK uses an independent rank predicate and exact requested bounds. |
| ORC-003 | Contract, model, grammar, real drivers and checkpoints have adjacent prose in executable owners. |
| ORC-004 | Reconstruction, ablation, bounded values and excluded invalid windows described above; primary TopK profiles isolate separate numeric failure modes. |
| ORC-005 | All six real hooks/injectors compare data, state, identity and ownership at native cuts. Suspended/aborted render and pending-acquisition premises are asserted. |
| ORC-006 | Original defects and the named hostile edits reach the intended comparisons; TopK nontermination is classified separately. |
| ORC-007 | Fixed/fresh campaigns share grammar, recorder, checker and budget. Seed/path replays select only their requested fresh targets. |
| ORC-008 | Settled and requested windows differ during acquisition; exact authored offset and limit differ after partial moves. The model retains those distinctions. |
| ORC-009 | Glossary terms reused; full recomputation abstracts the incremental graph explicitly. |
| ORC-010 | ScenarioLifetime preserves original and cleanup errors. Drivers aggregate later action errors with earlier comparison mismatches; numeric shrinking preserves observation and move boundary. |
| ORC-011 | No additional independent-formulation obligation identified by the three reviewers. Numeric rank membership specifically avoids shared end-point addition. |
| ORC-012 | This record, numeric evidence and source/reach manifests preserve the review and its limits. The late-coverage timing remains explicit. |
| ORC-013 | Page versus plan/source/options changes, zero/empty/beyond-source windows, source growth, partial options and pending cuts distinguish plausible wrong boundaries. |
| ORC-014 | Real framework drivers receive the shared model. Providers are controlled; no external-provider conformance is claimed. |
| ORC-015 | Each driver/form/campaign asserts declared reach. Exact final counts are in the accompanying reach record. |
| ORC-016 | Fixed regressions replay the same model, driver and checker; no standalone expected-answer examples added to the oracle owners. |

Three independent reviewers covered law/ownership, grammar/calibration, and
framework receiving cuts. Their supported enforcement findings are addressed in
the histories, observations and repairs described here. The initial unreviewed
proposal for a new API has no current implementation or authority.

## Final evidence block

- **Law:** finite structured outer page changes retain an adapter-owned window;
  authority and ownership boundary are stated above. Exact authored bounds also
  survive partial TopK moves, including large safe-integer values.
- **Reach:** [exact counts by path/form/campaign/state](2026-10-30-adapter-page-windows-reach.json).
  Shared ordinary campaigns run 13 histories each; pending states reach 7 each;
  publication callbacks run 9 each; pre-commit states reach 7 each. Numeric
  operator states reach 100 each in both operators and both campaigns.
- **RED:** `vitest run tests/conformance... -t 'window histor'` rejected original
  Collection replacement on unchanged base production in every adapter.
  Publication-callback RED preceded its queue repair. All six large-window
  receivers reported `RangeError: Invalid array length` and wrong empty rows
  before TopK changed, including both large moves and source growth. Primary
  numeric offset/width moves timed out after explicit move-entry markers;
  partial width produced the intended row assertion. Exact commands and error
  categories are preserved in the numeric record and supporting log hashes.
- **GREEN:** final selected suites passed 2,321 tests: React 711, Preact 126,
  Vue 109, Solid 70, Angular 64, Svelte 270, core 799 and TopK 172. These include
  the shared fixed/fresh campaigns, hook neighbors, hydration/Suspense neighbors,
  ordered work and deferred acquisition. TypeScript, Svelte checks, lint,
  package builds and whitespace validation passed.
- **Mutant:** the ten wrong-design edits listed above failed the intended
  row, identity, demand or callback-update checks. Exact seed/path RED/GREEN
  replays also passed. Source bytes were restored after every edit.
- **Limits:** the explicit ownership, provider, value-domain and observation
  boundaries above remain. Late coverage does not retroactively establish a
  wider original pre-edit gate.

Production-size comparison against the base adds 766 gzip bytes across the
seven measured core/adapter bundles with dependencies external. The typical
tree-shaken React app adds 539 gzip bytes. Svelte uses its own package/compiler
pipeline; the comparable compiled package bundle adds 110 gzip bytes. The size
script cannot build Svelte through Vite, so it was measured separately with the
same Svelte compiler and esbuild settings on both revisions.

## Subsequent independent review

A maintainer-requested [fresh four-reviewer audit](2026-10-30-adapter-page-windows-round-2.md)
found missing subscription-count, speculative-width, pending keyed-state and
failure-fidelity distinctions. The follow-up record preserves those findings,
their repairs and the exact later source snapshot. The manifest and results
above remain the historical pre-follow-up evidence; they are not a claim that
the earlier instruments already enforced those distinctions. Production did not
change during the follow-up. The late-coverage process gap remains explicit.
