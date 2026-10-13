# PR #2096 four-oracle review

Review intake: `/private/tmp/pr2096-four-oracle-review-ledger.md`. Four independent
reviewers challenged the persisted durable-row, demand/peer, ownership/LocalStorage,
and Electric recovery oracles at `6d5128545e83836410bb8ea307fae987b439db19`.
The append-only intake retains all seventeen reviewer items and the sibling
violation found during evaluation. This record states the law-level findings;
the intake keeps the source-order claims and per-item dispositions.

## Laws, experiments, and inference

| Law and authority | Original oracle gap | Decisive experiment and inference | Repair and remaining enforcement |
| --- | --- | --- | --- |
| A peer database change validates a previously public row even when an unrelated filter is active; a DbClient seed stays source-owned. The user explicitly chose retained visible rows and the persisted oracle's demand law distinguishes row admission from validation. | Mixed-demand histories covered targeted and full-reload notices, but never reset. Reset truncated before it captured the public keys or seed authority. | A controlled A-outside/B-inside history had callback snapshots `[]`, then `[B new]`, while durable A remained. A protected C seed also vanished. Three primary reset histories failed at the callback snapshot; the expanded notice × A-state × seed-cache matrix passes eighteen histories after the repair. | On-demand reset no longer eagerly truncates. The independent model authors complete durable rows and protected seeds; every callback and final Collection is compared. Eager reset remains an adjacent control. Paginated mixed demand, atomic multi-subset reads, and a write between sequential reads still need separate witnesses. |
| A targeted peer notice cannot change row metadata owned by an unconfirmed DbClient seed. DbClient hydration authority covers row and metadata together. | Seed histories checked values and change keys, but not metadata set/delete. | Eighteen route × row-change × metadata-operation histories failed at the seed metadata assertion on the original code and pass after the guard. | The persisted owner now checks public seed row and metadata at publication. Same-key accepted source work racing peer delivery remains unmodeled. |
| One mutable options runtime belongs to the successful Collection constructed from those options. Direct/spread admission already held this ownership law. | A selected `sync` copy lacked the descriptor marker. Persisted tests started the original first; LocalStorage tests never selected only `sync`. | Lazy wrapped-source copy-first and both LocalStorage startup orders were RED on original code. They pass when runtime binding checks the Collection's original options claim before changing sync controls. Original-owner write, receipt, public/durable rows, and listener observations remain correct. | The persisted runtime and LocalStorage sync enforce the same construction owner at start. Local-only persisted options force startup and are a neighboring control. Module-held options still strongly retain a cleaned-up restartable Collection; no collectability promise is established by these tests. |
| A durable same-key insert replaces the complete row; update merges omitted fields. A targeted notice contains no operation identity, so the receiver cannot infer field presence from its changed value alone. Real SQLite adapter mutation algebra and complete-row persistence contract are authority. | The Electric recording fixture merged inserts, and its publisher generated updates for existing keys. The receiver's exact-row assertion could not see an omitted field. | The fixture-algebra check failed for insert before repair. The expanded generated history shrank to two same-key inserts, with `obsolete` present then absent; the old receiver kept `obsolete` publicly. The primary persisted owner's insert histories fail at exact public rows when the durable-read guard is removed, while two-update and delete/update controls distinguish merge and deletion. | The fixture replaces on insert, the grammar varies operation and removable field, and a public changed key triggers an authoritative durable read. The checked boundary is a controlled adapter and coordinator; real SQLite sender construction and browser delivery remain receiving limits. |
| Changed public rows publish a subscriber event containing the callback-time snapshot. The glossary defines publication through rows and events. | The Electric trace checker accepted a subsequence with only manual snapshots. | Suppressing the event recorder made four fixed histories fail at the new event assertion; ordinary histories pass. | Electric publication histories require an event when authored rows change. Equal-row notices may emit none. Callback count for arbitrary native schedules is not claimed. |

The suspected redundant reconciliation event beside an absent or older seed did
not reproduce on a same-position controlled reload. Both variants reached the
reload, preserved row and seed metadata, and emitted zero public row events.
That refutes the proposed public-event defect on its stated path, while leaving
unmeasured internal replacement work outside the claim.

## Loss audit and reviewer calibration

The ledger accounts for EB-01–04, DP-01–05, DR-01–05, OL-01–03, and sibling
EB-05: eight fixed now, one refuted, one resource-contract design question,
one bounded positive readiness assessment, and seven open coverage or receiving
limits. Those seven are uncertainties, not demonstrated product defects. None
silently closes the native sender, browser delivery, pagination, concurrent
same-key source/peer, or multi-read atomicity classes. The coverage map names
their executable owners and missing witnesses.

The demand/peer reviewer found two executed reset violations and a useful
missing product of grammar dimensions; strong hire recommendation. The durable
rows reviewer found the metadata ownership gap and also supplied a plausible
event claim that the same-path experiment refuted; hire recommendation with
calibration to distinguish source-level work from public publication. The
ownership reviewer found both selected-field escapes and correctly separated
resource retention from an accepted contract; strong hire recommendation. The
Electric reviewer identified a false-green fixture and event observer; both
produced sensitive repairs and one sibling product bug, with careful separation
of inspected and executed evidence; strong hire recommendation. Their proposed
work was valuable, but a green controlled oracle is not a native-host proof.

## Validation scope

Before repair, reset, seed metadata, selected-sync ownership, fixture insert
algebra, and same-key insert histories failed at their intended assertions.
The event-suppression and durable-read-removal mutants also failed at public
comparison checkpoints. On the repaired tree, the full database suite passed
12,080 tests across 277 files, the SQLite persistence core passed 1,559 tests
across 25 files, and Electric passed 1,088 tests across 28 files. Their
configured type projects reported no errors. The LocalStorage peer oracle
passed 57 tests and Electric recovery passed 74 tests in their package
environments. Both changed packages built. Changed-file lint, formatting,
whitespace checks, generated error docs, and ESM/CommonJS production-error
checks passed. These are finite, controlled histories. Final pushed-head CI
and intended native integration require separate verification before a
whole-PR readiness verdict.
