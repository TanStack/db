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
