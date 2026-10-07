# TLA+ checks of the IndexedDB deletion proposal

> Historical design evidence: the results below predate implementation. The
> [refinement audit](../../docs/contributing/oracle-reviews/2026-10-06-indexeddb-tla-refinement.md)
> records the selected finish policy, executable translation, production repair,
> mutation checks and native-browser validation. The formal models are unchanged.

TLC checked two bounded formal models of the proposed contract. The result
narrows the earlier design: **closing admission and invalidating old read
callbacks must preserve sync transactions that core already accepted.** A blanket
ban on later publication contradicts that existing obligation.

The models are design checks, not a verification of the TypeScript adapter. They
do not approve either proposed policy or replace the receiving oracle suites.

## Results

All 21 configurations produced their expected outcome using the checksum-pinned
TLA+ 1.7.4 distribution (TLC 2.19) and Temurin Java 21.0.12.1+1.

| Configuration                                               | Distinct states | Result                                                                |
| ----------------------------------------------------------- | --------------: | --------------------------------------------------------------------- |
| Finish confirmations for native-admitted writes             |         333,984 | All 10 safety invariants hold                                         |
| Suppress confirmations not yet accepted when closure occurs |         386,688 | All 10 safety invariants hold under its weaker confirmation contract  |
| One-operation conditional settlement progress               |           3,496 | Every caller eventually settles under the stated fairness assumptions |
| Delete / recreate / delete queue                            |              22 | All five safety invariants hold                                       |

The four rows count type invariants as well as product-law invariants. The two
large runs explore separate policy graphs; adding their counts would not count
unique real-world histories. TLC exhausted each positive graph (zero queued
states remaining). Exact commands, exit codes, model/configuration hashes and
raw counterexamples are retained in [results.json](results/results.json) and logs.

Eleven deliberately incorrect model variants violated the intended invariant:
late-read publication, truncate-driven readiness, missing explicit-close
notification, false late-startup readiness, admission after closure, discarded
accepted work, rejection after native commit, premature mutation success,
old-deletion publication, deletion while blocked, and premature deletion success.
The bundled checker positive/negative controls also behaved as expected.

Four stronger claims were deliberately tested and rejected:

1. **No publication after closure.** A write commits, its sync transaction is
   accepted, the connection closes, then its persisting handler finishes. The
   accepted transaction still applies while Collection status remains error.
   [TLC trace](results/challenge-stop-all-publication.log).
2. **Suppress late confirmations without changing the success observation.**
   Native commit, close, suppression, then successful caller settlement leaves
   that write unconfirmed in the old Collection. This is the suppression policy's
   explicit contract loss, not a false persistence outcome.
   [TLC trace](results/challenge-suppression-keeps-confirmation.log).
3. **Deletion stays bound to the old descriptor's dataset.** The second queued
   delete selects the recreated database by name. Native name semantics cannot
   provide the stronger guarantee.
   [TLC trace](results/challenge-instance-bound-delete.log).
4. **Callers always eventually settle without scheduling assumptions.** An
   unresolved application decision is a permitted infinite stuttering behavior.
   Progress requires the declared external/local scheduling assumptions; no
   timeout or automatic in-memory fallback follows from this model.
   [TLC trace](results/challenge-unconditional-progress.log).

The old-deletion negative control reaches the specific known failure: lifetime B
still exists, its unmanaged connection blocks the newer deletion, and delivery
of A's old success changes B's public row to empty.
[Exact state trace](results/fault-old-receipt.log). Removing that completion's row
publication authority prevents this modeled failure without a stored identity.

## What this requires of a possible implementation

Both policy graphs assume that managed close prevents further native admission,
affected Collections report error, and obsolete reads cannot publish. Neither
silently discards an already accepted sync transaction or fabricates failure after
native commit. The `suppress` policy only declines **new** confirmations after
closure; it is not the earlier literal “stop every later publication” wording.

The `finish` policy additionally requires replacement publication that preserves
error status. **The current truncate helper does not supply that behavior.** Its
existing implicit readiness transition is the `truncateReady` negative control.
The passing formal transition is a required semantic capability, not an existing
implementation or a claim that this capability is cheap to add.

The model chooses managed explicit close to notify affected Collections. That
is an analyzed scope choice, not approval. An alternative caller-disposal rule
could intentionally exclude that path. Raw-handle close is outside this model.

## One refinement witness through the real adapter

[accepted-before-close.test.ts](accepted-before-close.test.ts.txt) checks that the
first counterexample's gap exists through public APIs. A manual transaction awaits
`acceptMutations()` and then remains persisting in application code. Its native
row is already updated; the Collection's exposed authoritative base is still old.
An upgrade closes the descriptor and the test's versionchange seam marks error.
Releasing the handler publishes the accepted row and fulfills `isPersisted`,
while status stays error. The probe passed using current adapter/core source and
fake-IDB. [Output](results/accepted-before-close.txt).

This avoids assuming that browser tasks interleave two adjacent automatic-handler
microtasks. It establishes one public manual-transaction path, not every timing
in the abstract graph. The prior hostile assay supplies additional fake-IDB
read/clear/import witnesses. No new native-browser test was run in this task.

## Model boundaries and source mapping

See [mapping.md](mapping.md) for model variables, transition authority, invariant
traceability, assumptions, omitted histories and development corrections.

- [retirement_oracle.tla](retirement_oracle.tla): two operations, each in a distinct
  Collection sharing one descriptor; all pairs of put/delete/clear/import;
  resolve/reject, native commit/abort, captured read, late startup, three closure
  origins and every admitted ordering. An admitted queued transaction may abort
  before an older transaction finishes; commits retain native queue order.
- [deletion_queue_oracle.tla](deletion_queue_oracle.tla): one database name, two
  lifetimes, managed connections, unmanaged blockers, one old native transaction,
  and a fixed delete/open/delete queue with independently delayed caller receipts.

These models omit row-value equality, schemas, core cleanup/restart, arbitrary
numbers of Collections, multiple optimistic transactions in one Collection,
full subscription replay, browser crashes and permanent lost notifications.
They do not prove the bug class closed in production. Collection retirement is
not a new public status and is not core cleanup.

## Replay

Use the exact checked JAR and Java runtime listed in [toolchain.json](toolchain.json).
The JAR and Java binaries are not committed and no system runtime was installed.

```sh
python3 run_checks.py --java /path/to/java --jar /path/to/tla2tools.jar --output /tmp/indexeddb-tlc-results
```

The runner verifies the JAR checksum, runs every retained configuration, and
rejects parser errors or unexpected violations. An expected invariant failure
must name that exact invariant. Terminal finite states are valid, so TLC's
deadlock diagnostic is disabled; progress is tested separately as a temporal
property. Default safety configurations impose no fairness. The optional progress
configuration assumes eventual application decisions, eventual native terminal
outcomes, and scheduling of enabled local continuations; it imposes no timeout.

The companion Vitest probe retains the source-root paths used for its observed
run; its configuration needs updating when replayed in a different checkout.

The historical Vitest probe and config are saved with `.txt` suffixes to preserve their exact source without registering or linting them. Remove that final suffix and update the recorded checkout paths to replay.
