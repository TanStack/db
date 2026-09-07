# Restart-contract loss audit

**Bounded null:** no supported loss of the selected runtime policy or existing tests was found between the frozen revisions. The candidate adds a four-cell test and seven architecture lines. Its fixture does not cover every part of the retained contract.

## Frozen inputs and control

- Baseline: `f902b213f503d6ebe83b390f3a5a5782484cab0b` (B).
- Candidate: `fcee49714d7c632011b1f04568733a0ba0f2f4e8` (C).
- Repository: `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`.
- Instrument: Field Lab **Hidden-signal recovery assay (`loss-audit`)**, one fresh static pass over the selected source bundle. Full skill, card, applicable repository instructions, and full candidate architecture were read before source analysis. No sibling audit outputs, prior review reports, or TODO contents were read. No tests or other checks were run.
- Pointers below use frozen `revision:path:line` coordinates. Runtime and old-test line numbers are identical at B and C.

The coordinator supplied **161 passed, 0 failed, zero skips; types and lint passed**. These are supplied measurements, not observations reproduced by this audit.

## Source-by-source preservation trace

| Source and supported item | Candidate trace | Loss reading |
| --- | --- | --- |
| B:`packages/db/src/query/live/collection-config-builder.ts:1230–1237`: manual source cleanup calls `transitionToError`. At `1288–1300` that sets the fatal flag and marks the query errored. Source-ready recovery at `1240–1248` excludes fatal errors; graph execution stops at `604–607`. | C retains the identical runtime file. C:`packages/db/src/query/live/ARCHITECTURE.md:623–628` names the terminal dependent-query boundary. C:`packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts:90–119` asserts continued live error and retained public data after source restart and either settlement. | No dropped policy. The fixture encodes the old fatal boundary rather than replacing it with automatic source-driven recovery. |
| B:`packages/db/src/query/live/collection-config-builder.ts:828–836` resets fatal and ordinary error state when the query's own sync starts. Cleanup at `861–881` clears session state and graph caches. | Identical at C. Architecture line `627` preserves the requirement to restart or recreate the query itself. | No runtime loss. Successful explicit query restart is outside the new fixture: it restarts only the source. The documentation's recovery route has retained code support, not a new four-cell execution check. |
| B:`packages/db/tests/db-client.test.ts:869–892` checks that client cleanup tears down live queries before sources without logging manual-source-cleanup errors. | Entire file retained byte-for-byte. The new fixture directly cleans up an active source, so it tests the other side of this boundary. | No removed test or weakened assertion. Client cleanup ordering is absent from the new fixture through explicit scope selection, but remains in the candidate's existing tests. |
| B:`packages/db/tests/live-query-observer.test.ts:131–171` registers SSR observer resources for client-owned cleanup and asserts no manual-source-cleanup error. Related status delivery checks at `950–967` and `1073–1085` preserve observer notifications through cleanup. | Entire file retained byte-for-byte. Neither the new fixture nor the seven-line paragraph reproduces SSR ownership and observer wakeup checks. | No test loss. Those source-specific controls would disappear if the four cells were treated as a replacement summary of cleanup coverage; the candidate does not remove them. |
| B:`packages/db/src/query/live/ARCHITECTURE.md:606–621` describes surviving direct demand detachment, fresh reacquisition, and rejection of stale-session effects. | Paragraph retained at C:`606–621`; clarification appended at `623–629`. Direct resolve/reject cells at C:test `24–29, 90–119` preserve old visible data while replacement is pending and publish exactly once only on direct success. | No textual contract loss. The added paragraph narrows the reader's attribution of direct restart; it does not delete that contract. |

Retention control: the B/C blob IDs match for the builder (`a4b7467946abfa6c08c52787c61a25ecb39a46ec`), db-client test (`a6a61bab813330a3ae6a6c3a15a0b2c99f43d40b`), and observer test (`0ff896381192863bf8450fbdfdd724c703e5fcaf`). The package diff contains only 107 added fixture lines and seven added architecture lines, with no deletions. Runtime files are unchanged. Existing refinement tests remain after the inserted fixture, beginning at C line 129 instead of B line 22.

## Fixture and assay limits

The four cells cross consumer (`direct`, `live`) with replacement settlement (`resolve`, `reject`), not with all cleanup states. They use one on-demand source, one unchanged string key, one row moving from version 1 to 2, synchronous initial success, and one deferred replacement. The source's installed array is separately checked at C:test `100–106`, while consumers retain the prior snapshot. The direct branch's `read()` and `readEvents()` both read the same event-built map (`64–68`); these are not independent direct-state observations. The live branch also reads `live.toArray`.

The fixture deliberately projects values to `{id, version}` (`65–66`) and permits cleanup publications with unchanged row data (`96–108`). This flattens metadata changes and does not test exact cleanup event counts. It checks exact publications after final settlement (`118`), but does not assert rejection error identity, subscription status sequences, explicit live-query restart, stale transport settlement from the discarded session, eager-source reconciliation, deletion of missing keys, nested includes, or multiple owners. These are bounded omissions from the added fixture, not evidence that the candidate deleted their contracts.

The architecture's truncate distinction at C:`628` is not a fifth control cell in this fixture. This audit's static reading cannot turn the supplied pass count into fresh behavioral proof. Selecting only the named cleanup sources also limits discovery of losses elsewhere; the shared fresh scanner context can flatten differences among the selected sources. The retained-source traces above keep client ordering, observer notification, and fatal graph behavior distinct. No restoration judgment, redesign, or recommendation follows from this result.
