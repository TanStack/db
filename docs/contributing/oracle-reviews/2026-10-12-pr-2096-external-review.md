# PR 2096 external review: persistence ownership and peer reloads

The review targeted 6c63fc88fb8c609b41b4b774d5a06d28a5386c71. Ten findings were evaluated in source order. The primary executable owner is packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts; the Electric descriptor owner checks its receiving boundary. The scratch intake at /private/tmp/pr2096-review-ledger.md preserves the review's original wording and every disposition.

## Laws, experiments, and repairs

**A hydrated seed has source precedence.** A DbClient hydration seed is already public but is not yet a durable source confirmation. An absent or older SQLite row cannot retract or replace it. The old oracle checked ordinary row correction after demand retirement, but had no seed dimension across complete validation and active replacement. Nine new histories cross complete demand, no-demand peer notice, bounded peer notice, and absent, older, or equal durable data. Four of the first six failed against the reviewed implementation at the public-row comparison; equal-row controls passed. The active bounded cases then exposed the replacement path. Production now skips hydrated keys in complete validation and preserves them while replacing an active snapshot.

A mixed history checks the other side of this rule: one protected seed survives while an ordinary row is replaced without stale fields, another is deleted, and a new row is admitted. A second peer notice presents an older durable version of the seed. The public seed remains unchanged. Temporarily disabling the active-replacement guard made this history fail on Stale cache versus Hydrated at the second notice. The initial version of that fixture did not start sync, so its missed notification was a setup failure and supplied no product RED evidence.

**A failed construction does not claim an owner.** A persisted options descriptor may create one Collection. A synchronous constructor failure before owner binding leaves that descriptor available for a corrected retry. The previous ownership histories began with successful construction. The new invalid-then-corrected history failed on the reviewed head because retry reported the one-owner error. The Collection constructor boundary now releases the claim on failure if the persisted runtime has not bound a Collection. The successful retry writes publicly and durably. A successfully bound owner keeps its claim through cleanup; async startup failure after construction is a different lifecycle.

**A complete notice cleans orphan row metadata.** A no-demand peer reload validates already public rows and collection metadata. Row metadata for a key outside the public base cannot survive complete validation merely because no row is public. The old history observed public rows but had no metadata-only orphan case. New zero- and one-public-row histories establish orphan metadata through a source transaction, deliver a full-reload notice, and inspect the sync metadata API at the settled checkpoint. Both failed on the reviewed head and pass after the no-demand path uses complete validation and clears orphan metadata.

**The Electric ownership fixture must distinguish storage identity.** The former fixture used two different storage IDs, so its green receipt check said nothing about a shared persisted storage target. The owner now crosses shared and distinct storage IDs with separate persisted wrappers, confirms the read targets, rejects direct reuse of one wrapper, and retains the first-owner acknowledgement assertion. The descriptor suite passes. This was a test-grammar gap, not an Electric production bug.

The runtime's three collection-metadata replacement loops now use one helper. The visible-key validation and full-snapshot equality check remain separate because they answer different questions.

## Other findings and contract boundaries

| ID | Disposition | Reason |
| --- | --- | --- |
| R1 | Fixed | Hydrated seeds survived the complete and active reload histories above. |
| R2 | Design decision | Reset currently restores an unconstrained baseline with zero demand. The public on-demand guide points toward demand-scoped rows. The earlier review record documents the broad read but says a narrower rule needs an authority decision. The user has been asked which public reset behavior to promise. |
| R3 | Fixed | Constructor failure releases an unbound descriptor claim. |
| R4 | Refuted on supported path | Collection sync always supplies metadata controls. An equal metadata-bearing row under a real peer notice emitted no change batch. The proposed null-controls path is not a supported core entry. |
| R5 | Fixed | Complete no-demand validation removes orphan row metadata with zero or one public row. |
| R6 | Accepted design; documentation repaired | Direct options reuse is intentionally rejected under the one-owner law. These packages are pre-1.0, and the repository changeset workflow uses patch for ordinary improvements. The patch changeset now gives direct-call migration guidance and states that DbClient descriptors remain reusable. |
| R7 | Accepted work cost | The current atomic resume snapshot reads the full durable table to validate visible-key absence. There is no O(visible) read budget. A keyed adapter read needs a new atomic snapshot contract and real SQLite work-count witness. |
| R8 | Refuted as duplication | The descriptor claim covers direct same-object and spread-copy admission. The runtime guard covers selected wrapped-sync fields that omit the claim. Existing oracle histories exercise both. |
| R9 | Fixed in the shared portion | Collection-metadata replacement uses one helper. The two row comparisons retain distinct laws. |
| R10 | Fixed | The Electric fixture now crosses shared and distinct storage identities and direct wrapper reuse. |

The reviewer found three confirmed correctness gaps, one lost fixture dimension, and an unresolved reset rule. The performance and duplication observations were useful. The null-metadata and duplicate-guard fixes missed legal entry paths. The review has strong signal; a senior reviewer should cite the authoritative law and legal entry path before prescribing a repair.

## Evidence boundary

The controlled adapter and Collection histories establish public rows, change batches, metadata, durable writes, and constructor admission at named settled checkpoints. They do not prove arbitrary browser, Electron, or native SQLite peer scheduling. The zero-demand validation still reads O(table) rows through the current atomic snapshot API. Schema reset still restores an unconstrained baseline under its separate accepted-source law. These limits are in the oracle coverage map. The #2065 review is separate and was still running during this evaluation.

## Verification and weight

The active-replacement seed mutant failed at the public-row assertion, and a
wrong-storage Electric fixture mutant failed at the shared-storage identity
assertion. These distinguish the repairs from two plausible false-green paths.
The new tests passed after both mutants were removed.

The full persistence-core suite passed 1,000 tests with one existing todo.
The full Electric suite passed 681 tests. Standalone TypeScript checks for DB,
persistence core, and Electric passed. All three package builds passed.
Changed-file ESLint passed with zero errors and existing require-await warnings;
Prettier and whitespace checks passed. A full DB run before the constructor
helper extraction passed 11,744 tests and found one production-bundle check
that rejected a try block inside the exported createCollection function. The
rollback was moved to a helper. The bundle test and 190 related DB tests then
passed. The final full DB suite passed 11,745 tests across 242 files.

The final production diff adds 23 net lines across DB and persistence core;
tests and contract documentation grow separately. The extra runtime logic is
confined to preserving seed ownership, releasing an unbound claim while
retaining the production bundle shape, and sharing metadata replacement.
