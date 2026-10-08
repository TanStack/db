# LocalStorage oracle follow-up review, 2026-10-08

Reviewed PR #2074 at `347e28207815e4a64a7a495e07e6b45bc2c97f12`.
This record reconciles four independent oracle reviews: receipt ownership,
peer synchronization, queue liveness, and parser recovery. The append-only
intake with the original claims and execution notes is
`/private/tmp/pr2074-final-review-ledger.md` in the review workspace.

## Reviewer assessment

The reviewers found eight actionable product or oracle defects and separated
three approved limits from defects. Their strongest observations used public
persistence receipts, method-return cuts, fresh restore, and a deliberately
hostile transaction-work mutant. The reports identified the missing history
dimension or assertion for each confirmed bug. One proposed custom Storage
return-value concern was correctly rejected because `StorageApi.getItem`
returns `string | null`. The default-JSON Date observation was real, but its
suggested normalization would change an established writer contract. Overall:
high technical accuracy, high analytical depth, strong signal-to-noise and
prioritization, and mostly precise repairs. **Hire recommendation: yes.**

## Lossless finding ledger

| ID | Claim and technical verdict | PR action | Durable value |
| --- | --- | --- | --- |
| R1 | Confirmed: a preloaded or cleaned-up direct owner could make module-level acceptance of a DbClient mutation fulfill without writing. P1. | `fixed-now`: route by recognized Collection utility and object identity, independent of direct sync state. | Order oracle covers idle, ready, cleaned-up direct owners; receipt, durable, public and fresh-restore cuts. |
| R2 | Confirmed: a peer write from a restore subscriber could be missed before same-tab registration and then overwritten by mirror initialization. P1. | `fixed-now`: seed mirror and subscribe before callback-capable restore commit. | Peer oracle checks nested receipt, ready receiver, and later update. |
| R3 | Confirmed: a custom parser could normalize an authored row without changing its version token, leaving the writer stale at a fulfilled receipt. P1. | `fixed-now`: read back custom-parser writes and confirm authored data from the stored form. | Peer oracle covers insert, update, peer, durable and fresh restore. |
| R4 | Confirmed: a synchronous handler failure left an empty queue slot for a microtask, violating the handler-free direct-write method-return promise. P2. | `fixed-now`: retire immediately when that slot has no predecessor. | Order oracle compares Storage at method return and after both receipts. |
| R5 | Confirmed oracle false green: the DbClient receipt witness accepted before `mutationFn`, outside work registration. P1 for test integrity. | `fixed-now`: accept inside `mutationFn` and check while its predecessor remains held, after registration. | An unregistered-work mutant fails the held-receipt assertion. |
| R6 | Confirmed pre-existing bug: encoded storage key and row `getKey` could disagree, allowing a deleted public row to reappear on restore. P2. | `fixed-now`: reject the malformed snapshot before readiness. | Peer oracle includes mismatched-key startup and preserves bytes; guide states key identity. |
| R7 | Confirmed pre-existing shape gap: a null version token was accepted. P2. | `fixed-now`: require a string token. | Peer oracle includes malformed startup. |
| R8 | Confirmed pre-existing shape gap: a null row event advanced the mirror without publication, hiding a same-token repair. P2. | `fixed-now`: validate object row data before mirror advancement. | Peer oracle checks invalid event, repair and zero `begin` calls for malformed startup. |
| R9 | Confirmed representation difference: default JSON keeps a writer-authored `Date`, while peers, durable bytes and restore hold an ISO string. | `accepted-design`: preserve the established native writer value; do not apply R3's custom-parser repair to default JSON. | Date limit witness in peer oracle and explicit guide text. |
| R10 | `refuted`: `undefined` for an absent key violates the typed `StorageApi.getItem(): string \| null` contract. | No production change. | Retain null-versus-empty sentinel coverage; malformed empty bytes still fail startup. |
| R11 | Confirmed dependency cycle when a handler awaits a later same-Collection receipt; head-of-line blocking follows from the single write order. | `accepted-design`: the public guide excludes this await cycle and permits fire-and-forget nested admission. | Existing nested-admission and held-predecessor order histories remain; changing queue policy needs a new contract. |
| R12 | Confirmed lack of cross-tab compare-and-swap and lack of coordination between distinct custom Storage wrappers. | `accepted-design`: both are explicit guide and coverage limits. | Keep as separate native coordination proposal; no claim of cross-tab atomicity. |

No item is deferred, and no design decision remains open. The original twelve
items equal eight fixed, three accepted designs and one refutation.

## Laws, gaps and enforcement

**Manual receipt and owner law (R1, R5).** The guide requires
`acceptMutations()` called inside `mutationFn` to join the actual Collection's
ordered write queue, and persistence receipts to wait for the durable write.
The order oracle previously omitted direct-owner lifecycle states and invoked
acceptance outside `mutationFn`. Its independent authored-row fold now reaches
idle, ready and cleaned-up direct owners with a DbClient materialization. The
driver compares durable bytes, active Collection rows and fresh restore after
the manual receipt. A separate held-predecessor cut observes the receipt after
work registration; disabling `registerTransactionCommitWork` makes that exact
assertion fail (`fulfilled` instead of `pending`). The original production
fails the ready and cleaned-up histories with empty durable Storage. These
assertions enforce the law for single-owner acceptance through the tested
direct and materialized paths. Multi-owner acceptance in one utility call is
outside this grammar; the API rejects mixing recognized owners.

**Peer agreement law (R2, R3).** The guide promises that active Collections
sharing one Storage object and key see an accepted same-tab write without a
browser event. The peer oracle's independent authored-row fold does not use
the adapter mirror. It now admits a peer write from nonempty restore
publication, then checks readiness, nested receipt, a later update, durable
bytes and both public snapshots. It also normalizes an authored row using a
custom parser while holding the version token fixed; insert and update
receipts compare writer, peer, durable and fresh restore. The original code
fails the receiver and writer comparisons respectively; the repaired code
passes. Default JSON rich values are an explicit exception: the writer retains
the authored native value until restore, and the Date witness checks that
limit. The finite histories do not prove arbitrary subscriber reentry or
simultaneous cross-tab writes.

**Direct-write and valid-snapshot laws (R4, R6–R8).** The guide promises a
handler-free write before method return when no earlier write can still use
Storage. The order oracle now places a synchronous failed handler immediately
before a handler-free insert and compares durable bytes at the return cut;
the old queue fails that assertion and the repair passes. The neighboring
settled cut and ordinary no-predecessor cases protect the conditional premise.
For restore and event delivery, only a valid whole snapshot can advance the
mirror or readiness. The peer oracle's absent/valid/malformed classifier now
includes null data, null token and key/row disagreement, while the driver
checks startup error, intact bytes, zero sync `begin`, invalid-event retention
and same-token repair. The old implementation accepts or advances these
malformed cases; the repair passes. This is shape and identity validation, not
arbitrary application-schema validation. Invalid writer key extractors and
direct raw same-tab edits remain outside this adapter's guarantees.

## RED and GREEN evidence

Oracle changes preceded production changes. On the original production,
the expanded order and peer owners ran 83 tests: 73 passed and nine intended
new comparisons failed. One additional default-Storage setup error came from
running the root Vitest invocation without the package's jsdom environment;
it is not counted as a product failure. The failing checkpoints were the
ready/cleaned manual durable receipts, restore-time peer receipt, parser-
normalized writer receipt, direct-write method return, malformed key and token
startup cases, invalid-event repair and null-row startup `begin` count.
The R5 hostile mutant was removed after it failed the repaired held-receipt
comparison; `transaction-commit-work.ts` has no diff.

With production repaired, the package-configured LocalStorage run passed four
files and 142 tests with no type errors. This includes the existing CRUD and
persistence-failure tests, plus the two primary oracles. Full-suite and build
results are separate from the RED evidence above. The full package runtime
suite passed 270 files and 11,665 tests. Standalone TypeScript checks for both
the package and test project, package build, changed-file lint, formatting,
generated error docs, and ESM/CommonJS production error checks passed.
Vitest's integrated type-check phase still reports an overload diagnostic in
unchanged `src/collection/index.ts:961` and exits nonzero. Its type-check-only
path reports the same diagnostic in a clean pre-fix review copy, while both
standalone TypeScript checks pass. This is an existing tool discrepancy, not a
green integrated gate. The docs link checker reports nine existing links that
point outside `/docs`; this record adds none.
