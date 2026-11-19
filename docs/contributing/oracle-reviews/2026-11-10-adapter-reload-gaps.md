# RxDB and PowerSync unwrapped eager reload gaps

Starting head: `5feb26616a8357853454c2f9ff2ce0b0adb9c908`.
Historical gap IDs: RxDB `M9`, PowerSync `M164`. These names identify the
earlier operand-negation mutations; operator IDs can move when source changes.
This is a self-review and receiving-oracle extension, not a source repair.

## Law and receiving boundary

A reload keeps the old public rows until the new run supplies its result. A
complete eager result then determines source membership and returned values.
Only the adapter's snapshot or truncate replaces retained rows; core cannot
infer replacement from reload. Authority: the glossary's reload/snapshot
contract, the core source-health owner's opt-in snapshot contract, and eager
source READY-3/PUB-7.

The shared persisted-startup owner already has the independent complete-result
set judgment. The new unwrapped eager-reload receiver reuses that judgment
rather than duplicating its row model. Core's source-health owner retains
status, health and arbitrary core reload histories. Its model is embedded in
its test runner; importing that runner as an adapter helper would register all
core tests. This receiver composes its established baseline-retention law with
the shared adapter result judgment at the real SDK boundary.

The persisted startup tests could not see either mutant: the persistence
capability alone selects snapshot mode, masking the retained-row operand. The
new receiver deliberately uses an unwrapped Collection. It retires the previous
sync run, holds the next run before adapter entry, changes the actual provider
rows while no current SDK subscription can deliver those changes, then invokes
the real sync adapter. A live delete event cannot repair a failed omission sweep.
RxDB uses its real memory-storage SDK. PowerSync uses local SQLite on Node, and
the browser export uses the web SDK.

## Grammar and observations

Fresh load has no previous source rows. Reload independently permits empty and
nonempty retained rows. Every next subset of three source keys is legal, with
changed values on overlap. A disjoint optimistic insert can persist across the
source submission. Twenty-four fixed histories and fixed/fresh generated
campaigns use the same SDK driver and comparison. Generated lanes independently
weight fresh, empty reload, and retained reload, avoiding rare empty-reload reach.

Before adapter entry, the public rows must retain the old baseline plus a
pending optimistic overlay. The load cannot fulfill before source entry. At
fulfillment, accepted source commits need not have applied while an optimistic
transaction is persisting. The source projection must be one coherent allowed
snapshot: the retained baseline or the complete result. Partial mixtures fail.
This follows the glossary's accepted-sync-transaction and reload/markReady
contracts; snapshot application can replace earlier, while ordinary committed
writes may remain queued. A still-pending optimistic row remains public until
its mutation settles. The driver records release of its external persistence
gate: before release the overlay is required; after release its presence can
race fulfillment. After mutation settlement and applied receipts, exact rows
must equal the complete result with no unconfirmed local row. Submitted
row/commit counts and completed acceptance receipts prove actual source entry.

The first instrument incorrectly compared full fulfillment rows with the
source-only answer. A second version required applied source rows at fulfillment,
but an empty-baseline reload can legally fulfill at markReady while accepted
writes remain queued behind an optimistic transaction. These were instrument
failures. The correction follows the existing optimistic-overlay, acceptance,
and reload contracts; no production edit followed either failure. Initial logs
remain preserved as instrument corrections, not product RED. The reference
allows whole source snapshots, rather than selecting an expectation from
production commit counts.

Removing reload loses the retained-row omission. Removing changed membership
loses stale omitted rows. Removing changed values loses overlap correctness.
Removing the mutation lane loses the empty-baseline scheduling boundary.
Fresh histories with retained source rows are constructively excluded. The
optimistic key cannot overlap the three source keys.

## Evidence

No source repair was needed. The expanded oracle passes unchanged production
on starting HEAD, and rejects both exact historical operand-negation mutants.
The new coverage closes a missing receiving distinction; it does not establish
a new product defect on this head.

- **GREEN:** `pnpm --config.verifyDepsBeforeRun=false exec vitest run packages/rxdb-db-collection/tests/eager-reload-conformance-oracle.property.test.ts packages/powersync-db-collection/tests/eager-reload-conformance-oracle.property.test.ts` passes 54 checks. Per adapter: 24 fixed histories, one hostile-declaration calibration, and fixed/fresh generated campaigns of 80 histories each. Log: `.review-2367/reload-gaps/green-node-final3.log`.
- **Reach:** every one of the 11 declared states is positive separately in each adapter and generated campaign. Fixed-seed 2367 counts, for each adapter, are fresh 29, empty reload 28, retained reload 23, empty result 15, omission 14, changed overlap 13, persisting mutation 34, no mutation 46, fresh-held 12, empty-reload-held 14, retained-reload-held 8. Fresh-seed campaigns independently meet every state.
- **Mutant RED:** copied each real adapter module, changing only `!collection._state.acceptedSyncedEntries().next().done` to the unnegated operand; absolute import rewrites let the unchanged receiver load the copy. `pnpm --config.verifyDepsBeforeRun=false exec vitest run --config .review-2367/reload-gaps/mutant.config.ts packages/rxdb-db-collection/tests/eager-reload-conformance-oracle.property.test.ts` rejects RxDB; the equivalent PowerSync path rejects PowerSync. Fixed generated seed 2367 reaches `{start: 'reload', previous: 1, next: 0, mutation: false}` and reports both fulfillment and final stale rows: observed `[{id: 'a', value: 1}]`, expected `[]`. This is a result mismatch after real source commit and acceptance, not a timeout. Logs: `rxdb-negation-mutant.log` and `negation-mutants2.log` under the same scratch directory. Initial import-resolution failures remain separately recorded as setup failures.
- **Real browser GREEN:** the shared Chromium receiving page passes 120 histories, including 24 RxDB and 24 PowerSync reload histories, with no page errors or remaining OPFS artifacts. Each reload receiver separately reaches fresh 6, empty reload 6, retained reload 12, empty result 8, omission 8, overlap 6, mutation 12, no mutation 12, fresh-held 3, empty-reload-held 3, retained-reload-held 6. Command: `pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/browser-db-sqlite-persistence exec playwright test --config playwright.opfs.config.ts eager-gap-conformance-oracle.opfs.spec.ts`. Log: `.review-2367/gap-fill/opfs-gap.log`. The browser shares the exact model, histories and comparison; RxDB uses its memory SDK and PowerSync its real browser SQLite SDK.
- **Replay:** `TANSTACK_DB_ORACLE_PROPERTY=adapter.rxdb.eager-reload TANSTACK_DB_ORACLE_SEED=42 TANSTACK_DB_ORACLE_PATH=0 node --import tsx packages/db/tests/oracle-replay.ts packages/rxdb-db-collection/tests/eager-reload-conformance-oracle.property.test.ts --coverage.enabled=false` reports one execution and one successful generated run. The analogous PowerSync property and receiving file also pass.
- **Types:** `pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/db-adapter-conformance exec tsc --noEmit` passes with these new shared files included. Both receiving packages also pass their own `tsc --noEmit` commands. The shared receiver type exposes only the common config fields, preserving each SDK schema and utilities in the runtime spread. Targeted ESLint results are recorded in `.review-2367/reload-gaps/eslint-final.log`. Required `pnpm --config.verifyDepsBeforeRun=false lint:changed` also passes (`lint-changed-final.log`) after copied diagnostic CLI source trees were moved out of the checkout; no lint rule was disabled.

The unchanged-source GREEN, exact negation-mutant RED, and whole-snapshot
comparison jointly supply sensitivity evidence. No production behavior or
existing run budget changed. The initial invalid instrument's RED results
are deliberately excluded from product-bug evidence.

## Limits

Three string keys and numeric values, one fresh load or one eager reload, one
disjoint optimistic insert, and local SDK storage. This receiving family does
not assert a new no-snapshot scheduling law on empty startup, remote provider
replication, persisted durability, arbitrary concurrent mutations, every
intermediate publication, or on-demand reload. The existing owners retain those
contracts. Worker/OPFS startup coverage remains a neighboring persisted path;
wrapping this receiver in persistence would mask the operand under judgment.

## oracleProperty conversion after main merge

Conversion base: `29de8a92e`, with exact installed `@tanstack/oracles` and ESLint
plugin pin `e1fb504`. No production function changed. The shared reload and
capability registrations now use `oracleProperty`; no legacy allowance was
added. Existing Chromium receivers still import the same raw models and
comparisons, and no observation cut or SDK path changed.

The pure row computation was extracted as `eagerReloadModel`. The raw checker
uses it by default, and the framework supplies that same model explicitly.
The capability framework similarly uses the existing `capabilityMustAccept`
model and passes its answer into the same raw admission checker. The capability
source remains a complete finite enumeration of 22 histories on each of the
controlled and Node SQLite hosts for each adapter. There is no new random
capability campaign.

The reload grammar retains the exact three equally weighted lanes, next masks
0..7 and mutation boolean. Its former dependent `chain/map` could not validate
any of the 24 external fixed histories with `canShrinkWithoutContext`; the
flattened full-record grammar validates all 24. This changes generator
representation, not legal histories. All 24 fixed histories stay. Each fixed
seed 2367 and fresh-seed campaign keeps its 80-run budget.

Eleven randomized constructed builders each require one original declared
state. They constrain only the premise coordinates and retain the remaining
generated membership/mutation coordinates. Each call returns a fresh object.
A local WeakMap records each built history's required state; the same check
requires that state from actual production-driver reach observations on both
the framework's example constructions and its generated construction branch.
This closes the pinned API's gap where generated map outputs lose their
builder association. Each builder also has a missing-state calibration, which
runs the real SDK driver and removes that state's observation before the same
check. Literal fixed histories do not supply required generated reach.

The first framework run passed 169 of 170 checks, including all row comparisons
and capability cases. PowerSync's determinism check exposed a lawful schedule
difference: on an empty reload, `markReady` after acceptance can fulfill before
or after the external optimistic gate releases. One raw trace included the
pending optimistic row at fulfillment, and the other did not after settlement.
Both satisfy the unchanged accepted-versus-applied and overlay laws. Waiting
unconditionally for `markReady` would instead deadlock RxDB's ordinary commit,
which awaits visibility behind that optimistic transaction.

The framework bridge therefore applies the unchanged raw law checker to every
actual raw observation before serialization. Successful allowed schedules
have one canonical checked record. Failed judgments retain every raw field,
and the framework check reruns the same raw comparison against the same pure
model before reporting them. This projection discards only differences the
existing law already permits after they have been checked. The real SDK driver
and raw browser comparisons remain unchanged. Five additional controls corrupt
raw before-source rows, fulfillment rows, final rows, a pending optimistic
overlay, and source acceptance before projection; each must still fail the raw
comparison. The exact historical source mutants are also tested after this
projection, so a canonical success cannot hide their stale rows.

Post-conversion evidence is recorded under `.review-2367/reload-migration/`.
The exact M9/M164 source copies still fail the same retained-row → empty-result
fixed history (`previous: 1`, `next: 0`, no mutation) with stale `a` at
fulfillment and final observation. See `exact-mutants-normalized.log`. The
counterexample, law and captured raw diagnostics survive the conversion.
Final conversion results:

- `pnpm --config.verifyDepsBeforeRun=false exec vitest run packages/rxdb-db-collection/tests/eager-reload-conformance-oracle.property.test.ts packages/powersync-db-collection/tests/eager-reload-conformance-oracle.property.test.ts` passes **88 checks** (`green-normalized.log`). Each receiver retains 24 fixed histories and the 80-run fixed/fresh campaigns, and passes determinism plus all 17 calibrations: 11 builder-state omissions, five wrong raw answers before projection, and the original inverted-snapshot source declaration.
- Each campaign runs its 11 seed-derived constructions in addition to 80 generated histories. Both fixed campaigns report the same positive counts: changed overlap 19, empty result 20, fresh 23, fresh-held 16, no mutation 37, omission 25, mutation 54, empty reload 32, empty-reload-held 14, retained reload 36, retained-reload-held 24. Both fresh campaigns also reach all 11 states; every required minimum remains one.
- `pnpm --config.verifyDepsBeforeRun=false exec vitest run packages/rxdb-db-collection/tests/persisted-capability-conformance-oracle.test.ts packages/powersync-db-collection/tests/persisted-capability-conformance-oracle.test.ts` passes **92 checks** (`capability-green.log`): all 22 cases and determinism separately for each adapter and each of the two hosts.
- Both registered reload properties pass guarded replay with seed 42/path 0, one actual property execution and one run. The replay selector now names the framework's `random seed` test. See `replay-rxdb.log` and `replay-powersync.log`.
- The shared conformance package and both receiving packages pass `tsc --noEmit`; targeted ESLint and `pnpm --config.verifyDepsBeforeRun=false lint:changed` pass. See `types-normalized.log`, `receiver-types.log`, `lint-normalized.log`, and `lint-changed.log`.
- Exact source-mutant command after conversion: `pnpm --config.verifyDepsBeforeRun=false exec vitest run --config .review-2367/reload-gaps/mutant.config.ts packages/rxdb-db-collection/tests/eager-reload-conformance-oracle.property.test.ts packages/powersync-db-collection/tests/eager-reload-conformance-oracle.property.test.ts -t 'fixed history:.*"previous":1,"next":0,"mutation":false'`. Both fail under law `complete eager result`, preserving the same raw stale-row witness as before conversion. This is the same historical operand-negation kill on each adapter, not an exception or equivalent-mutant allowance.

The parent run retains the existing real Chromium receiving gate and owns the
combined same-seed CLI comparison and final branch lint after the parallel
conversions. Those broader checks are separate from the 180 passing receiver
checks above. There are no pending edits to the models, drivers, suites, or
source for this conversion.
