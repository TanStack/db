# Sync metadata session: borrowed laws and independent transactions

Base revision: `30175be48` (`main`). Opened by
[issue #2220](https://github.com/TanStack/db/issues/2220). Every lane below
is RED on the base revision. The same pull request repairs production; see
"Production repair" for the evidence block.

## Decisions

The maintainer made five decisions on 2026-10-22; the fifth replaced an
encoding the author had extended without asking. Three more followed on
2026-10-23; the sixth withdrew the second:

1. **Borrow standard theory.** "this is a clear case where we borrow laws";
   "Generally we want to follow standard theory here". One sync run is a
   session.
2. **Closed nesting (withdrawn by decision 6).** "closed nesting is what the
   api suggests and what we're partially enforcing so let's go with that". A
   sync transaction begun while another is open was to be a closed-nested
   child of the innermost open one.
3. **Read your writes in its standard form.** A read includes the source's last
   surviving write: it returns that write or a write ordered after it.
4. **Seeds are older than every source write.** A hydration seed never
   supersedes a source write to the same object, whatever their arrival order.
5. **D5: a source insert replaces a seed, in either order.** The first K4
   question asked about a seed arriving while the source's open transaction
   had inserted the same row. The maintainer answered "yeah seeds are older".
   The author then extended that answer, without asking, to seeds arriving
   after the insert committed, and encoded it as timestamp order: the
   source's insert of a seeded row was an update, so the seed's metadata and
   fields survived it. A fresh adversarial reviewer showed that this reading
   went beyond the question asked, broke the monotonic-reads transfer (a read
   changed from absent to the seed's metadata with no new source write), and
   adopted a partial merge of stale fields that review R9 of 2026-10-08 had
   called speculative. The author put two arrival-independent readings to the
   maintainer: A, a seed as a base layer that the source's insert merges
   over; and B, a source insert that names the whole row and its metadata
   and so replaces any seed of that row. The maintainer asked how a seed could
   arrive after the insert. The realistic case is a `HydrationBoundary` that
   renders on a later navigation, while the collection already syncs the row.
   The maintainer chose "yup, b".

   Under B a seed supplies only objects that no surviving source write has
   written. A source insert replaces a seeded row and its metadata without a
   duplicate-key error; an update merges over it; an insert equal to a row
   only a seed supplied is an insert, not an equal re-insert.
   `docs/guides/ssr.md` ("Initial Data") is revised to say so.

   A third review round found that D5 implied two answers when a seed
   arrives after a partial source update of the same row: seeds beneath
   field by field (arrival-independent; a late seed can drop a field under
   a live row), or ignored once the source has written the row (a partial
   update merges over the row as it stood). The maintainer chose the second
   ("b"). A seed that arrives after a surviving source write to an object is
   ignored for that object; only a partial update's merge base depends on
   arrival order. Metadata is unaffected, because metadata writes name the
   whole object. The seed-order property therefore compares consumers' rows
   only under full row updates. The glossary gains "hydration seed".
6. **Independent transactions (2026-10-23).** A first closed-nesting repair
   passed every oracle in this record and broke eight existing tests in three
   files: `collection-truncate.test.ts`, `collection-sync-reentrancy-oracle.test.ts`,
   and `includes-collection-oracle.property.test.ts`. Each relies on a
   transaction begun inside an open one committing and applying on its own.
   Handler write-backs, change listeners, and live-query facades share the
   sync API with the source, and the API cannot tell their `begin` from a
   source's nested one. Under closed nesting a handler's confirmation would
   merge into the source's open transaction, and a handler that awaited its
   receipt could deadlock. The author put the conflict to the maintainer, with
   B (independent transactions) recommended. The maintainer answered: "yeah B
   is fine -- I don't have any real use case for nested transactions to begin
   with and you're right that to add this properly we'd need clear transaction
   ids to support the nesting".

   Every sync transaction is therefore independent. `write`, `truncate`,
   `commit`, and abort act on the innermost open transaction. Accepted
   transactions apply in commit order, and a hold delays application without
   changing that order. A read orders the session's writes by commit: accepted
   transactions in commit order, then the open transactions in begin order. An
   abort discards only its own transaction's writes. An inner transaction
   still reads the open writes of the transactions it began inside; the
   author's proposal said so, and the maintainer accepted it.
7. **Cover every nested history (2026-10-23).** The first encoding of
   decision 6 excluded an inner row write or truncate that conflicts with an
   enclosing open transaction's row writes. The maintainer asked to "cover
   everything with the grammar". The model now judges those histories. An
   open transaction's inserts follow the rows before them in commit order;
   a commit fixes their kinds. An outer insert that lands on a different row
   the source wrote makes its transaction invalid, as a duplicate-key insert
   would. No read includes an invalid transaction, it ignores later writes,
   and its commit rejects. Two rules came from existing authority, not from
   the maintainer. Later writes cannot revive an invalid transaction, a
   truncate included: core's own comment says so ("later writes cannot
   revive it"), and core's `truncate` contradicted it. A seed accepted after
   an insert was written cannot change the insert's kind, because a seed is
   older than every source write (D4).
8. **Cached rows are seeds, and wrapper inserts replace (2026-10-23).** The
   persisted wrapper wrote every source insert to core and storage as an
   update. The SQLite persistence plan (`PERSISTNCE-PLAN-SQLITE-ONLY.md`,
   2026-02-10, §D) gives the reason: a remote snapshot that overlaps the
   local cache must not raise `DuplicateKeySyncError`. Under partial row
   updates the update also merged a cached row's omitted fields under the
   insert. No document argued for that merge; the test that pins it
   (#2037) calls it pre-existing behavior. The maintainer chose option C: a
   cached row is a snapshot older than every source write, like a hydration
   seed, so a source insert replaces it and its metadata. While the change
   was being implemented, three existing persisted owners showed that the
   wrapper's inserts also replace rows the source itself wrote earlier in the
   run (the hydration FIFO and hydration-failure tests, and the persisted
   optimistic-history oracle). The maintainer then chose C1: in the wrapper,
   an insert replaces whatever row it lands on, never raises a duplicate-key
   error, and never invalidates its transaction. Its metadata still follows
   the 2026-10-05 rules: it clears unless it is an equal re-insert of a row
   the source wrote. Core keeps duplicates and invalidation.
9. **Cached rows are seeds in core too (2026-10-26).** The prep-PR review
   found that a later `DbClient` seed could not replace a persisted cache
   row: the wrapper loaded cached rows into core as ordinary adapter work, so
   core counted them as source rows. The maintainer confirmed that cached
   rows are seeds there too ("yeah they're seeds too"). A cache load
   happens at preload, so a `DbClient` seed arrives after it and wins, as a
   later seed does. The same review confirmed the metadata law that a kept
   value is not a write: an equal re-insert keeps metadata as an update
   does, so the latest seed still governs it until the source writes it.
10. **A merged write can carry a later seed into an insert's kind
    (2026-10-26).** Decision 7 said a seed accepted after an insert was
    written cannot change the insert's kind. Decision "b" lets that seed
    change a partial update's merge base. A random persisted campaign found
    the two meeting: an outer equal re-insert, then a later seed, then an
    inner partial update that merges over the seed and commits ahead. Core
    and the wrapper re-judged the re-insert against the row the inner update
    left, which differs, so core invalidated the outer transaction and the
    wrapper cleared its metadata; the model kept the re-insert. The
    maintainer chose production's reading ("2"): an insert's kind follows the
    row it lands on. A later seed alone does not change it, and neither does
    an open transaction's own write over the seed, but a transaction that
    commits after the seed and merges over it does.
11. **A peer's write in this run is a source write (2026-10-26).** A
    second high review found that rows a peer's source wrote in this run,
    which reach this tab through storage, were treated as seeds or skipped
    behind a `DbClient` seed. The maintainer adopted the recommendation that
    follows D4: such a row and its metadata are source-written for this
    session. It replaces a `DbClient` seed this tab holds, a later seed does
    not supersede it, and an equal re-insert of it keeps metadata. The rule
    of `origin/main` that "DbClient hydration seeds remain source-owned until
    confirmed by the source" now yields to a peer's notice of a write in
    this run; rows from a previous run stay seeds (decision 9). Eighteen
    persisted-oracle cases that held the seed against a peer's targeted
    notice were rewritten to this rule. Asked about them, the maintainer
    answered "LWW is a good general heuristic here": among source writes,
    the last one wins, and a seed is older than every source write (D4).
12. **A source transaction may stay open across a storage read
    (2026-10-26).** The new read-hold lane found that a commit threw "a
    persisted sync transaction cannot cross a hydration cycle" when an
    on-demand storage read started while the transaction was open. The
    maintainer chose to support it: a transaction binds to a storage read
    when it commits, not when it first writes, and writes during a read
    follow the same metadata rules as other writes: the last write for a key
    wins, so an insert without metadata clears an explicit write before it
    and a cached row's metadata. The wrapper's earlier rules, that such an
    insert kept an explicit write before it (on every path) and kept the
    metadata of rows the read supplied, and that a commit crossing a read
    threw, are retired; ten persisted-oracle cases were rewritten.
13. **Unknown authorship keeps what this tab holds (2026-10-26).** After a
    full-reload notice, a missed notice, or a truncate, this tab cannot tell
    which stored rows a source wrote in this run. The third high review
    asked which way that should cut. The maintainer first chose to count
    every such row as written, then, shown that a full reload would then
    delete or roll back every held `DbClient` seed that storage lacks or
    holds older (the persisted oracle's `keeps a DbClient hydration seed
    across … peer notice` cases), chose the rule the code already followed:
    a seed this tab holds stays, and a stored row this tab did not hold
    counts as a source write, so a later seed cannot replace it. A peer's
    write to a key this tab holds as a seed stays hidden until a notice
    names the key or the source writes it. Decision 15 extends the rule to
    every stored row.
14. **A commit fixes its inserts' kinds as it read them (2026-10-26).** The
    fourth high review asked whether an inner transaction's insert, judged
    against an enclosing open transaction's write it read, should be judged
    again against the row it lands on when it commits ahead. The maintainer
    kept the model's rule: a commit fixes its inserts' kinds in the order as
    the transaction read it, so an inner equal re-insert of the enclosing
    row keeps metadata and replaces the row it lands on. `30175be48` already
    let an inner insert over an enclosing open truncate replace the row it
    lands on. Decision 10's "an insert's kind follows the row it lands on"
    concerns the inserts of transactions still open.
15. **Under unknown writes, only a changed row is a source write
    (2026-10-26).** Decision 13 left the code's two paths disagreeing about
    stored rows when this tab cannot tell what a source wrote: a reload
    counted every stored row and its truncate as source writes, so later
    seeds were ignored for the rest of the run, while a validation read left
    unchanged rows alone. The maintainer chose the second: a stored row that
    differs from the one this tab holds was written; an unchanged seed stays
    one; a dropped row is a source's delete; and a reload's truncate is not a
    source truncate. A reset still is.
16. **Row metadata of a missing row stays until a source deletes the row
    (2026-10-27).** The peer lane found `begin rowSet(2) commit
    peer(1,row)`: SQLite stores row metadata on its row, so metadata a source
    writes for a row that does not exist is not durable, and a reload
    deleted it. Whether a notice reloaded decided whether it survived. The
    maintainer chose option C: this tab keeps such metadata for the rest of
    the run unless a source deletes the row; a restart loses it, as it was
    never durable. Three persisted-oracle cases that pinned the deletion
    (`… orphan row metadata after a no-demand peer reload`, twice, and the
    orphan check of `does not republish unchanged rows for a repeated
    reconciliation notice`) were rewritten.
17. **A write over a `DbClient` seed stores the row this tab shows
    (2026-10-27).** `seed(2) begin upsert(2) commit peer(1,row)`: seeds never
    reach storage, so an update merged over a seed stored only its own
    fields, and a reload or restart dropped the seed's fields. The
    maintainer chose option B: the first update a transaction makes to a row
    a `DbClient` seed holds stores the seed's row merged with the update.
18. **A reload after a named notice keeps a seed's metadata (2026-10-27).**
    `seed(2,narrow) begin upsert(2) commit seed(2) peer(1,row)`: the update
    kept the first seed's metadata, and a later seed replaced it in this tab
    (decision 9), but storage cannot follow a seed, so a reload put the
    first seed's metadata back. The maintainer chose option B: metadata no
    source wrote in this run stays as this tab shows it across reloads, and
    decision 17 stores only the row. Asked whether that holds after a
    full-reload notice too, where two `main` cases expect stored metadata to
    win, the maintainer chose the scoped form, B′: decision 18 governs
    reloads after notices that name their keys; when this run's writes are
    unknown, stored metadata that differs is a source write (decision 15).
19. **A reset's treatment of held seeds depends on the sync mode
    (2026-10-27).** M4 found that an on-demand reset beside a held
    `DbClient` seed skipped its truncate, so metadata of a missing row and
    rows a hold kept from `base` survived it. Asked which rule governs held
    seeds, the maintainer chose the mode-specific rule after a corrected
    premise (eager resets already truncate first): eager, a reset is a plain
    source truncate, seeds included; on demand, it keeps held seeds' rows and
    metadata until the replayed demand replaces them, so one publication
    replaces them without an empty view.
20. **An on-demand reset is a source truncate that keeps held seeds
    (2026-10-27).** The new lane then found a seed of row 2 that arrived
    after an on-demand reset beside a held seed of row 1: production
    applied it, because the reset deleted only rows it saw, while with no
    held seed the reset truncated and rejected the same seed. A reset that
    skipped its truncate also skipped the demand replay that the truncate
    drives. The maintainer chose a source truncate that exempts held seed
    keys: they keep their row, metadata, seed status, and seed authority;
    every other key is cleared and closed to later seeds; demand replays.
    A first answer ("seen objects only") was withdrawn after a corrected
    premise.

## Laws and sources

| Law | Source | Transfer to a sync run |
|---|---|---|
| Read your writes | Terry et al. 1994, §3.1 | Every read includes every accepted write of the run and every write of its open transactions, ordered by commit: accepted transactions in commit order, then open transactions in begin order |
| Monotonic writes; one current value | Terry §3.4; Moss 1981, p. 61 | A transaction's writes take effect at its commit. The last write in commit order, issue order within a transaction, is the value, for reads and for what applies |
| Monotonic reads | Terry §3.2 | The writes a read includes only grow, except at an abort. When an inner transaction commits, an enclosing open transaction's write to the same object is ordered after it, so a read can change without a new write |
| Own reads | Adya 1999, §3.1.2 | A transaction reads its own writes; the innermost open transaction's writes come last in the order |
| Aborted reads | Adya §3.1.2, G1a | Not guaranteed across open transactions: an inner transaction reads an enclosing transaction's open writes and can commit before that transaction aborts (decision 6). No read after an abort includes the aborted writes |
| Invalid transactions | decision 7; core's invalidation comment | A transaction whose insert lands on a different source row, in commit order, is invalid: no read includes it, later writes are ignored, and its commit rejects. Where inserts replace (the persisted wrapper, decision 8), the insert replaces that row instead |
| Termination order | the sync API | `commit` and abort act on the innermost open transaction; the API has no transaction handle |
| Monotonic atomic view | Bailis et al. 2014 (HAT), Def. 27 | Once a consumer observes any effect of a transaction, it observes all of its effects thereafter, across both stores. The comparison is stronger: `collection.base` must equal the model at every checkpoint |
| Applied receipt | `SyncConfig.commit` docs; glossary "applied receipt" | A receipt settles when its transaction applies |
| Sticky availability | HAT §5.1.3 | The persisted wrapper and core form one session |
| Thomas's write rule | Thomas 1979; Bernstein, Hadzilacos, and Goodman 1987, §4.2 | A seed's snapshot is older than every source write, so it is ignored for any object a surviving source write has written, in either arrival order |

Writes-follow-reads and PRAM follow from read-your-writes, monotonic reads,
and monotonic writes under commit-order apply; the oracle does not check them
separately. Two transfers are excluded. Session guarantees are per session, so consumers
(`collection.base`) keep the applied view. Adya allows version order to differ
from commit order; TanStack DB chooses commit order.

The research survey read the primary texts locally and verified 13
load-bearing quotes against the text or page images. The Thomas's-write-rule
row names the textbook rule; those texts were not read for this record. Moss is the only primary
source on nesting. Lynch, Merritt, Weihl, and Fekete's formal treatment was
not accessible.

## Executable owner

`packages/db/tests/sync-metadata-session-oracle.ts` holds the contract, an
event-log model, the history grammar, the driver contract, and the
comparison. Drivers:

- `sync-metadata-session-oracle.property.test.ts`: a `DbClient` Collection;
  lanes `flat`, `nested` (depth ≤ 3), `seeds`, `nested-seeds`, `seeds-full`
  (`rowUpdateMode: 'full'`), and `nested-conflicts`, which favours row
  writes to one row inside nested transactions so that inner writes land
  ahead of enclosing ones and transactions become invalid.
- `db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts`:
  `persistedCollectionOptions` over an in-memory adapter, with store and core
  holds; lanes `persisted-flat`, `persisted-nested`, `persisted-seeds`,
  `persisted-cached` (row 1 is in storage when the run starts; the model
  holds it as a seed accepted before any action), `persisted-conflicts`,
  `persisted-nested-seeds`, and `persisted-reads`, whose read hold keeps an
  on-demand storage read in flight while the source writes and commits
  (decision 12). The last crosses `DbClient` seeds with nesting
  and the cached row, with the conflict lane's weighting; its
  `keepsMetadata` flag favours writes that keep metadata over writes that
  clear it, without excluding any action, so a later seed often meets
  metadata that an accepted re-insert kept. Every persisted lane declares
  the one model difference of decision 8: an insert over a different row
  replaces it.

The row-metadata composition oracle keeps its base nested lane, which
already judged independent transactions: a transaction begun inside T1
applies first, and T1's inserts are reclassified against the rows it leaves.
This change adds a `held` variant of that lane (a hold cannot change commit
order) and applies D5 to its seed variant. Its held-window lane, added
earlier for this issue, stays.

The grammar generates every nested history (decision 7). The key
independence property skips histories in which the model invalidates a
transaction: invalidation is per transaction, so a row 2 conflict also
removes row 1's writes. That is atomicity, not a cross-key leak.

## RED evidence on `30175be48`

| Witness | Law | Observation |
|---|---|---|
| `hold, begin, collectionSet(cursor), commit, begin` | Read your writes | cursor reads absent in the open transaction |
| `hold, begin, rowSet(1), collectionSet(gc:a), commit, begin` | Read your writes | row and prefix list miss the held writes |
| `hold, begin, rowSet(1), begin, rowSet(1), commit, commit, release` | Commit order | the held inner commit stays after the open outer transaction: the read returns the inner write, and the release applies the outer write first, so the inner write wins |
| `hold, begin, begin, rowSet(1), commit, rowSet(2)` | Termination order | the outer transaction's write throws `SyncTransactionAlreadyCommittedWriteError` |
| `begin, rowSet(1), commit, seed(1)` | Seeds are older | the seed's metadata replaces the source's metadata-only write |
| persisted: `hold(core), begin, upsert(1), commit, begin, commit, begin, collectionSet(cursor), commit` | Read your writes | row 1's metadata reads absent; the store-hold neighbour passes |
| persisted: `hold(core), begin, collectionSet(cursor), commit, begin, upsert(1), commit` | Read your writes | the cursor reads absent once the wrapper has handed both transactions to core; the store-hold neighbour passes |
| persisted: `begin, rowSet(2), upsert(2)` | Own reads | the insert's implicit clear is not visible in the open transaction |
| `begin, upsert(1), seed(1), commit` | A source insert replaces a seed (D5) | production turns the open insert into an update over the late seed, so the seed's metadata survives the insert's clear and its other field survives in the row |
| `seed(1), begin, reinsert(1)` | A source insert replaces a seed (D5) | core treats the insert as an equal re-insert and keeps the seed's metadata; the persisted wrapper clears it, as D5 requires |
| composition nested lane, `immediate` and `held` | D5 seed variant; commit order under a hold | both variants fail; the held variant also applies the open outer transaction before the inner one |
| retention: `keeps an accepted insert when it commits ahead of an open truncate (held: true)` | Commit order | the inner insert applies after the outer truncate, so row 1 survives |

Witnesses written for closed nesting and then revised for decision 6 pass on
`30175be48`, which already applied independent transactions in commit order
when nothing was held: `outerAbortKeepsInnerCommit` and
`innerTruncateAppliesAtItsCommit`. The run against the base production files
(`sync.ts`, `state.ts`, `client.ts` from `30175be48`, with this branch's
tests) fails 51 of 186 tests in the session, composition, and retention
files.

## Calibration

- A temporary commit-order reader (walk every pending transaction newest
  first, stop at a truncate for rows, merge `list()` oldest first) made the
  core flat lane and both issue witnesses GREEN in three runs. The same edit
  left the nested and seed lanes RED, as their laws require more than a reader
  change. The edit was reverted.
- With that reader, a mutant that ignores the truncate stop fails the
  composition held-window lane's truncated variant, and a `list()` that merges
  only the newest transaction fails both held-window variants.
- A bounded exhaustive model check (outside the repository) found that
  readers which omit ancestors or read only the newest pending transaction
  violate the laws. It also judged today's independent nested apply against
  closed nesting; decision 6 superseded that part.
- The campaign reach test requires each lane to reach its declared states;
  "Production repair" lists the counts.

- A mutant gap hunt against the commit-order reader baseline, in a separate
  worktree: walking row reads oldest first, ignoring the row truncate stop,
  and merging `list()` newest first fail at the comparison. Walking
  collection reads oldest first fails both flat campaigns but survives the
  named witnesses and the composition held-window lanes. Returning a delete
  write's missing value is equivalent: a delete carries no value.
- Adding the receipt observation kept the core flat lane GREEN with the
  commit-order reader in three runs.
- Seeds. Under the first K4 encoding (reading A), `begin, upsert(1),
  seed(1), commit` passed on production, and a mutant that derived the
  implicit metadata write from the original `insert` failed it. Under D5
  the expectation reverses, and that witness is RED. While encoding A, the
  model briefly judged the insert's row presence after its own row write,
  which turned the wrapper's implicit-clear witness falsely GREEN. Under D5
  the clear is an ordinary write again, and the witness is RED.
- Paired formulations. Key independence and seed order fail on `30175be48`
  without consulting the model's reads.
  - Key independence, seeds lane: `hold, seed(1), seed(2), begin, cancel`.
    Row 1's held seed reads absent once row 2's seed follows; without
    `seed(2)` it reads as seeded. This is the issue's newest-transaction read
    in a cross-key form.
  - Seed order: a seed that arrives after a source's metadata write replaces
    it, while the same calls with the seed first keep the source's write.
    Under reading A, a reviewer found that a reordered run could throw on an
    equal re-insert, a false positive. Under D5 the insert replaces the seed
    in both orders, so the re-insert stays equal, and a throw would be a D5
    violation.
  - Calibration: with the commit-order reader, flat key independence passes.
    A mutant reader that stops at the newest transaction touching any row's
    metadata fails it on both flat campaigns. Nested key independence fails
    on the known closed-nesting throw. No correct production exists yet to
    calibrate seed order GREEN; with every seed already first, its two runs
    perform identical calls.
- Range (ORC-004). Two edge cases from outside the design work were added.
  - Collection keys `gc:` (equal to the prefix) and `gc` (a proper prefix of
    it) needed only new parameter values. With the commit-order reader, the
    core flat lanes and both issue witnesses stayed GREEN in three runs. The
    probe exposed one oracle artifact: the model listed keys in declaration
    order while the drivers sort them, which only matched for the old key set.
    The model now sorts.
  - A seed that carries a field the source never writes exposed a missing
    rule: under `rowUpdateMode: 'partial'`, a source update merges over the
    row before it, a seed included. The model now merges updates; an insert
    replaces the row (D5). `updateOverSeed` checks the merge and
    `updateOverSeedFullRows` checks replacement under a `seeds-full` lane;
    both pass on production.

## Production repair

The repair keeps the existing structures and changes these rules.

- **Reads.** `metadata.row.get`, `metadata.collection.get`, and `list()`
  walk every pending transaction, newest first, then applied state; a
  truncate hides older row metadata. The persisted wrapper reads every open
  transaction, innermost first, then its staged transactions, then core.
- **Commit order.** `acceptSyncTransaction` places a committed transaction
  after every accepted one and ahead of every open one; seeds use the same
  method. An inner commit during a hold therefore no longer leaves the queue's
  last transaction committed, so the outer transaction can still write and
  commit, and a release applies in commit order. A replay keeps an accepted
  transaction's operation kinds: an inner insert written over an outer open
  truncate replaces the row it lands on, as `30175be48` already did when
  nothing was held. An open transaction's inserts still follow the rows before
  it and can make the transaction invalid.
- **Seeds (D4, D5).** Row data and row metadata are judged separately against
  committed adapter work, including a wrapping sync's staged committed
  transactions. A seed replaces earlier seeds whole. A source insert over a
  row only a seed supplied is an insert; over a seeded row the source also
  wrote, it stays the re-insert the source wrote, so a later seed beneath an
  open update cannot make it a duplicate. An insert names its whole row even
  as an equal re-insert. A held seed's receipt has a rejection handler.
- **Wrapper metadata.** An insert without metadata stages a clear unless it is
  an equal re-insert of a row the source wrote; the last write for a key
  wins.
- **Query.** `getRowMetadata` no longer falls back to applied metadata, which
  read a staged clear as "no value".
- **Invalid transactions (decision 7).** Core's readers skip a transaction a
  replay invalidated, and `write` and `truncate` ignore it; `truncate` no
  longer clears the invalidation. Its metadata writes need no check: no read
  includes it, and it never applies (a mutant that lets them through is
  equivalent).
- **Seed authority across a hold.** The replay projection records which keys
  accepted source transactions wrote. An accepted source write makes a row
  the source's, as its application does, so a seed no longer exempts that
  row while the transaction is held. Before, an inner commit during a hold
  kept the outer transaction valid, and the same history without the hold
  invalidated it.
- **Wrapper inserts (decisions 8 and 9).** A source insert replaces the row
  it lands on. The wrapper judges its metadata when the source writes it and
  hands it to core as an update that names the whole row
  (`originalSyncType: 'insert'`, core's own form for an equal re-insert), so
  core replaces the row and only the wrapper's metadata writes change its
  metadata: an insert that clears staged a delete, and an equal re-insert
  keeps the value without writing it. Before, the wrapper wrote the kept
  value back as explicit metadata, which made the source its owner, and a
  delete then the insert over a different row. In storage it is an `insert`
  mutation, which the SQLite adapter upserts.
  The wrapper records the keys its source transactions handed to core in this
  run; any other row came from the cache or a seed, so an insert equal to it
  still clears metadata. After an inner commit, the wrapper re-judges each
  enclosing transaction's implicit metadata clears on the keys the inner
  transaction wrote, as core's replay does, and an inner re-insert keeps its
  metadata when it lands where the row is absent. The wrapper keeps, per key,
  every insert without metadata since the last write that named the key's
  metadata, and re-judges them all: if any no longer re-inserts the row it
  lands on, the key's metadata clears; otherwise the write before them
  stands. An update without metadata keeps that judgment open, because the
  inserts before it still decide the row's metadata.
- **Duplicate inserts.** A seed exempts a source insert from the duplicate
  check only over a row that only seeds supplied; over a row the source
  wrote, it is judged like any insert, whatever holds or seeds there are. In
  the replay, a seed beneath an open insert of a row the source also wrote
  keeps that insert's kind.
- **Cached rows (decisions 9 and 11).** A storage read marks a row it
  applies as a seed unless core holds it as a source row or a source wrote
  it in this run, which the runtime records from this tab's handoffs and
  peers' notices (a truncate or a full-reload notice makes every stored row
  count as written). The read stays one transaction; core keeps seed status
  only for its seed keys, and every other write of the read, a validation
  delete included, is adapter work. A `DbClient` seed holds against stored
  rows only until a source writes its key in this run.
- **Writes during a storage read (decision 12).** They follow the ordinary
  metadata rules, and a transaction binds to a read when it commits.

### Evidence block

- **Law:** read your writes, monotonic writes in commit order, own reads,
  monotonic atomic view, applied receipts, invalid transactions, and D4/D5
  seed authority, as stated above, with the wrapper difference of decision
  8. Authority: decisions 1 and 3–8.
- **Reach:** declared with `createOracleReach` in each fixed campaign
  (ORC-015); a campaign fails below its minimum. Core lanes: 11, or 5 for
  states that need a seed and a source write on one row, or a write after an
  invalidation. Persisted lanes: 5. The prep-PR round added the states
  `duplicate source insert` (and its hold and seeded forms) and `seed under
  a kept re-insert`, and raised the seeds and nested-conflicts campaigns to
  150 and 450 histories; every fixed campaign meets its minimums. Counts in
  the fixed campaigns before that round:

  | State | flat | nested | seeds | nested-seeds | seeds-full | nested-conflicts |
  |---|---|---|---|---|---|---|
  | read with two held transactions | 18 | 37 | 16 | 20 | 12 | 65 |
  | open transaction over a held transaction | 51 | 61 | 36 | 47 | 30 | 136 |
  | truncate during a hold | 30 | 31 | 22 | 24 | 15 | 69 |
  | nested commit | | 59 | | 52 | | 158 |
  | nested commit during a hold | | 43 | | 36 | | 107 |
  | abort keeps an inner commit | | 11 | | 9 | | 24 |
  | inner write to an enclosing row | | 7 | | 10 | | 92 |
  | transaction invalidated | | 2 | | | | 28 |
  | commit of an invalid transaction | | 2 | | | | 15 |
  | write to an invalid transaction | | 1 | | | | 16 |
  | seed under a source insert | | | 37 | 27 | 24 | |
  | seed under an open update | | | 10 | 5 | 7 | |

  `nested-conflicts` runs 300 fixed histories; the others run 100. Persisted
  lanes: `persisted-conflicts` (150 histories) reaches an insert that
  replaces a different row 18 times and an inner write to an enclosing row
  50 times; `persisted-cached` (80) reaches a source insert over the cached
  row 25 times and a source update over it 14 times.
- **RED:**
  - `30175be48` production with this branch's tests, as listed under "RED
    evidence": 51 of 186 tests fail in the session, composition, and
    retention files.
  - Decision 7, on the production before its repair: 7 failures in the
    session oracle (reads include an invalid transaction's staged metadata
    and a collection write made after its invalidation; a hold changes
    whether a seed exempts a row). Two more were model and grammar faults,
    fixed before the production change: key independence compared histories
    that invalidate a transaction, and the model kept a transaction's row
    writes from before its own truncate.
  - Decision 8, on the wrapper before its repair: the `persisted-cached` lane
    fails because a source insert merges over the cached row and keeps its
    `seeded` field; the persisted lanes fail on nested conflicts.
- **GREEN:** `packages/db`: 286 files, 13,917 tests pass; the session oracle
  file passes 78 of 78 twice. `packages/db-sqlite-persistence-core`: 33
  files, 1,732 tests pass (2 skipped, 2 todo); the persisted session file
  passes three runs in a row. Query DB, node, browser, and Electric suites
  pass with their receiving expectations updated for decision 8.
- **Mutant:** each fails the oracle.
  - Commit in place (no commit-order move): 17 failures, including
    `commitOrderDuringHold`, `outerContinuesAfterInnerDuringHold`, nested hold
    invariance, and the nested campaigns.
  - Replay reclassifies accepted transactions and throws on a duplicate, as
    `30175be48` did: both variants of the retention witness. A variant that
    marks the accepted transaction invalid without throwing changes only the
    internal projection and survives; no public checkpoint observes it.
  - Seed exemption only for seed-only rows: `seedUnderOpenReinsert`. The fixed
    campaigns do not catch it; random campaigns did, twice, before the witness
    existed.
  - An equal re-insert that merges under partial row updates instead of
    replacing its row: `seedUnderOpenReinsert`.
  - Readers that include an invalid transaction: the nested and conflict
    campaigns. A truncate that revives an invalid transaction: the nested and
    conflict campaigns and the conflict lane's reach.
  - Wrapper, earlier rules: reading only the innermost open transaction;
    keeping an earlier explicit write over an insert's clear; clearing on
    every insert; hiding staged transactions from seed authority. Each fails
    at least one persisted lane.
  - Wrapper, decision 8: an insert that merges over a held row (12 persisted
    hydration cases and the hydration FIFO test); storage that receives
    inserts as updates (the sync-config and hydration cases); a cached row
    counted as source-written (`persisted-cached`); enclosing implicit clears
    left unjudged (`persisted-conflicts`). An inner re-insert that loses its
    kept metadata survives every campaign; the pinned witness `keeps an inner
    re-insert's metadata when it commits ahead of the row it re-inserted`
    kills it.
  - Decision 9 (prep-PR round): the original handoff on `743a6ce14` fails
    all four new witnesses and `persisted-nested-seeds`; writing the kept
    value only when core would not keep it fails the inner re-insert
    witness; loading cached rows as source rows fails the cached-row witness
    and `persisted-nested-seeds`; a core that ignores a wrapper's
    `originalSyncType` merges over seeded rows and fails `persisted-seeds`
    and `persisted-cached`; dropping the insert's judgment at a later update
    fails `rejudges an enclosing re-insert that a later update kept`; re-judging
    only a key's last insert fails the two chain witnesses.
- **Limits:** under partial row updates the seed-order property drops
  `reinsert` from both runs, because decision "b" lets a moved seed change a
  re-insert's planned row. Key independence skips histories that invalidate
  a transaction. The `persisted-reads` and `persisted-peers` lanes' adapter
  keeps durable rows, so storage reads and reloads within a run are
  exercised there; the other persisted lanes' cached row is readable only
  until the run's first durable commit. Since the eighth round, a peer is a
  grammar dimension of `persisted-peers`, played by the driver through the
  coordinator (see "Eighth round"). The error an invalid commit rejects
  with, and restart and resume, stay outside this oracle.

### Code weight

Eighth round, against `7e46f81ad`: `app` grows 125 bytes, 20 fewer than
before, because `_syncedRowMetadataKeysOutsideBase` left the Collection
class; the staging check for preserved keys and the metadata reader's check
for a status-keeping truncate cost less than it saved. Persistence reaches
+1,206 (204 more): the stored-row status rule, whole-row reload writes, the
seed bases that decision 17 stores, and the held-row checks.

`pnpm size:compare` against `427a7c31e` (`origin/main` after the second
merge): the typical `app` scenario grows 126 bytes gzip. The second high
review's repairs cost `app` 9 bytes: the internal whole-row marker and
readers that skip invalidated transactions in place. The marker is a bare
`Symbol()`, because its `Symbol.for` description string alone cost 31
bytes and the wrapper imports the symbol from `@tanstack/db`. Seed status
became a key set on every seed transaction (a `DbClient` chunk passes its
keys), so per-key storage reads cost no extra check. `@tanstack/db` as a
whole package grows 375, `db-sqlite-persistence-core` 849, and
`query-db-collection` shrinks 14. In persistence, the second high review
went from 876 to 699 because removing the operation walk and the
hydration-deferred metadata path paid for its rules; the third added 150
for the per-object record of writes in this run, judging open inserts
again after internal writes, and the `begin` guard. `app` did not change
in the third.

The seventh round: against `6c1ca8f8f`, `app` grew 124 bytes, two fewer
than before, because the projection's accepted-source key set became a local
of its rebuild, and persistence 933 (84 more: the internal apply's written
keys and the first reload repair). Against `b8d8ee07c`, after two merges,
the pushed head measures `app` +135 and decision 15 adds 10 more (+145):
core's truncate keeps authority and seed status for a transaction that
marks seed keys. Persistence reaches +1002 (69 for decision 15: the shared
stored-seed rule and the dropped rows' deletes). A first repair that
validated reloaded rows in place, with no core change, failed the three
exact-shape witnesses, because only a truncate republishes rows that change
events consider equal.

Earlier rounds: the private-member mangle cache now
covers the branch's new private methods. Removing Query's owner supplement
saved 9 bytes, and tracking peer writes and judging enclosing inserts again
after an abandoned transaction added 91 to persistence.

The prep-PR round changed these numbers. Decision 9 costs core 12 minified
bytes (a wrapper's `originalSyncType` passes through `write`), paid for by
the state rebuild that `reset()` now reuses; `app` stayed at +111. The
duplicate-insert repair (B, C) adds 14 bytes to `app`. H first added 19
bytes as a delete-and-return pair of set updates; merging the two
`DbClient` key sets into one map cut that to 6. In persistence, decision 9
removed the kept-value lookup and the delete-then-insert handoff and added
the cached seed marking and the per-key chain of implicit inserts (+83);
the per-transaction staged rows that make a write-time read linear (D) add
the rest. Each addition has a witness or mutant that fails without it.

- Core, paid by every app: the readers' loops over every pending
  transaction and their skip of invalid transactions, commit-order
  acceptance, the source-key sets that tell a seed-only row from a
  source-written one, and the insert-replaces-its-row rule.
- `DbClient` only: per-object seed authority, including a wrapping sync's
  staged transactions. It lives in `client.ts`, so an app without `DbClient`
  does not ship it.
- Persistence only: the staged-row fold, the re-insert judgment, the record
  of implicit metadata clears and their re-judgment after an inner commit,
  the source-written key set, and the insert handoff to core and storage.
  Each has a mutant that fails a persisted lane or witness.

Refactors made to pay for it: the seed authority lookups moved out of the
state class into `client.ts` (`app` +240 to +111); the seed acceptance method
became the single acceptance method for commits and seeds; the two seed
authority lookups became one loop; the base invariant throw for an accepted
duplicate is gone; guards on an invalid transaction's metadata writes were
removed once a mutant showed them unobservable; decision 8 removed the
wrapper's invalidation and duplicate-key paths. Two refactors were tried and
reverted because they grew gzip: one shared reader for `row.get` and
`collection.get` (gzip compresses the two loops better than the helper), and
moving the wrapper's deferred-key predicate into core (it moved bytes from
persistence into every app).

## Review ledger

Three loss-audit scanners and three oracle reviewers examined this change.

| Finding | Disposition |
|---|---|
| G1a was cited as permitting child reads | Fixed: the laws table cites relative commit and delayed commit |
| Monotonic atomic view dropped "thereafter" | Fixed: stated, with the stronger per-checkpoint comparison |
| Writes-follow-reads and PRAM uncited | Fixed: stated as consequences, not checked separately |
| Receipt checkpoint for a nested child undefined | Fixed: receipts are an observation; the law follows from the existing receipt contract |
| Adjacent form F2 (nested truncate during a hold) not pinned | Fixed: witness added |
| Adjacent form F3 (consumer sees a seed, then the source) not pinned | Fixed by D5: the order is legal, and `seedUnderOpenInsert` checks it |
| Source and consumer seed layers differ without explanation | Fixed: model prose explains the two layers |
| Reach test does not ablate generator dimensions | Fixed: see "Reach ablation" below |
| Derived checks (hold invisibility, unrelated-action invariance) and the bounded model check live outside the repository | Fixed: three production-against-production properties (hold invariance, key independence, seed order); the bounded model check stays outside |
| Mutant "collection reads oldest first survives" | Refuted on re-run: both flat campaigns kill it |
| The issue's held-cursor history passed through the wrapper | Checkpoint artifact: actions ran back to back, so transactions stayed in the wrapper's staging. With continuations drained between actions (the receipt `flush`), the core-hold variant fails |
| `list()` presence of a key set to `undefined` | Fixed: core lanes store `undefined`; `get` reads it as absent and `list()` keeps it |
| Equal re-inserts not generated | Fixed: `reinsert` action |
| Reach ablation | Fixed: removing each axis removes its regime |
| No second formulation in the repository | Fixed: hold invariance compares production with and without holds |
| Nesting and seeds through the wrapper not driven | Fixed: `persisted-nested` and `persisted-seeds` lanes |
| Stale runs and writes without a transaction | Fixed: boundary witnesses |
| Restart and resume reads | Owned elsewhere: SQLite resume-snapshot and Electric resume owners |
| Truncate across several keys | Covered: the session model has two row keys; truncate clears both |

## Second review round

Three fresh reviewers examined the changes made after the first round: an
adversarial review of the seed laws, a mutant gap hunt in a separate
worktree, and a tension scan of the Query witnesses.

| Finding | Disposition |
|---|---|
| The K4 encoding extended the maintainer's answer to committed inserts, broke the monotonic-reads transfer, and adopted the partial merge that R9 called speculative | Fixed by decision D5 (reading B), asked of and chosen by the maintainer |
| `runSeedOrderInvariance` could throw on an equal re-insert after reordering | Fixed by D5: an insert replaces a seed in both orders, so the re-insert stays equal |
| Seed-order invariance cannot choose between arrival-independent readings | Accepted: the witnesses and D5 carry that choice; the property checks arrival independence only |
| The hydration-authority owner runs only full row updates and no metadata | Fixed: it crosses full and partial modes, adapter inserts and updates with and without metadata, and seeds carrying metadata and an extra field, `initialData` rows with an extra field, and a metadata-only source write; it reads metadata through `client.dehydrate()`. After the third review round, 19 of its 52 grid cells and one pinned production case fail on `30175be48`: an insert keeps a seed's metadata or merges its field (including over `initialData`); a late seed's metadata is dropped after an update that wrote none; a later seed overwrites a metadata-only source write; a second seed merges over the first; a metadata-less later seed keeps the earlier seed's metadata |
| Seed-to-seed merge versus replacement is not distinguished | Fixed: narrow seeds omit the extra field; `laterSeedReplacesSeed` fails on `30175be48`, where a second seed merges over the first |
| Reader mutants for a missing truncate stop, `list()` ignoring a pending delete, and prefix matching that is too loose or too strict died only in generated campaigns | Fixed: the named witnesses `openTruncateHidesHeldRow`, `openDeleteHidesHeldListEntry`, and `prefixBoundary` each kill their mutant and pass with the commit-order reader |
| A full-mode update merged only in the accepted projection survived: no checkpoint observes the accepted row | Fixed: an upsert that names metadata carries a field `m`, so row shapes differ; `fullUpdateThenEqualInsertDuringHold` kills the mutant with a duplicate-key throw at the equal re-insert, and production passes |
| A merge keyed on the original sync type, at the projection only, died only in one random run | Covered by the same witness's observation (the projection's row); not separately re-run |
| The Query retention witness did not separate "drop the fallback" from a full repair, and its prose blamed the fallback | Fixed: prose corrected; a peer-owner witness keeps the row, so the claim is an update and the stale owner comes from the claim's read of applied owners |
| A held removal of a hydrated row, then a claim, should clear the seed's metadata | Fixed: witness added; it fails on production and passes with the fallback dropped |
| Query witnesses read `_state.syncedMetadata` | Fixed where a `DbClient` exists: they read `client.dehydrate()`; the others say why they keep the internal read |
| Mutant: Query owners ignore accepted in-memory edges (`rowToQueries` supplement in `getOwnersFromMetadata`) | On production the new witness `publishes a held owner beside a later claim of its row` fails before the mutant matters. With the commit-order reader and the `??` fallback dropped, the mutant passes all 402 ownership tests. Probably equivalent there: each application that adds an edge also stages the owner set, and the reader then finds it. Open: a history with an in-memory edge but no staged owner write would separate them; none was found. If none exists, the repair may delete the supplement |
| Mutant: Query retires owner tracking before staging the cleanup | Equivalent by source inspection: no read occurs between the early retirement and the commit |
| Mutant: Query never retires owner tracking at cleanup | Killed by a sibling test (`keeps a released row and fails loudly when its release commit fails`), not by the retention witness |

## Third review round

Three fresh reviewers examined the D5 encoding, the Query and hydration
tests, and a mutant campaign in a separate worktree.

| Finding | Disposition |
|---|---|
| D5 implied two answers for a seed that arrives after a partial source update | Fixed by the maintainer's choice "b" (decision 5); the session model places seeds by arrival, and seed order compares rows only under full updates |
| A later seed without metadata keeps the earlier seed's metadata; seeds always carried metadata | Fixed: bare seeds; `bareLaterSeedClearsMetadata` fails on `30175be48` |
| No fresh source insert over a seed-only row | Fixed: `insertOverSeed` action; `insertOverSeedReplaces` fails on `30175be48` |
| Seeds were never crossed with closed nesting | Fixed: `nested-seeds` lane |
| A late seed after a partial update was unwitnessed | Fixed: `partialUpdateThenLateSeed` fails on `30175be48` (the late seed's metadata is dropped) |
| A late seed erases Query's owner edges on a hydrated row Query claimed by a metadata-only write | Fixed: `ignores a late hydration seed for a row whose metadata a claim has published` fails on `30175be48` |
| An adapter insert over an `initialData` row merges its field; the hydration grid could not see it | Fixed: `initialData` rows carry a field and stay present in insert-first histories |
| The hydration grid had no metadata-only source write, and its reference cleared metadata on an equal re-insert of a source row | Fixed: the action is added and the clear is scoped to seed-only rows |
| Query tests matched the opaque owner-key encoding | Fixed: owner counts plus public-behaviour identity siblings (release and hydrated-release checks) |
| Stale counts, missing "hydration seed" glossary term, SSR omissions | Fixed |
| Mutants against a scratch D5 seed implementation: equal insert over a seed stays an update; replace only applied seeds; replace only pending seeds; metadata authority from row writes only; seed replacement in full mode only | Killed (by `equalInsertOverSeed`; seed-lane properties; hydration insert cells and `seedUnderOpenInsert`; `seedUnderMetadataOnlyWrite`; `laterSeedReplacesSeed` and partial hydration cells) |
| Mutant: Query owner supplement deleted | Survives with or without the fallback; probably equivalent, as recorded above |
| Mutant: Query fallback removed | Repairs exactly the fallback witnesses with no new failures |
| The persisted equal-insert witness is insensitive to core seed mutants | Accepted: it checks the wrapper's own clearing; core seeds are judged by the core lanes |
| A scratch D5 seed implementation still leaves seed lanes RED on histories with deletes, releases, and truncates between seeds | Open: diagnose during the production fix |

## Fourth review round (prep-PR)

A code review, a simplification pass, and 10× random campaigns examined the
branch before its pull request. Items B to H were then taken through one
plan of oracle changes before any repair: one grammar action for B and C, a
late-abort probe for E, a scaling experiment for D, and a churn count for H.

| Finding | Disposition |
|---|---|
| A: a seed's metadata returns through the wrapper after an accepted equal re-insert (`persisted-seeds`, random seed -387838471) | Fixed: the wrapper hands inserts to core as whole-row updates (decision 9). Witness `lets a later seed replace metadata that an accepted re-insert kept` fails on `743a6ce14` |
| A sibling: an inner re-insert of an enclosing row commits ahead onto a seeded row; core classifies it `insert` and the kept value again claims the metadata | Fixed by the same change. Witness `lets a later seed replace metadata that an inner re-insert kept`; it alone kills the narrow fix that writes the kept value only when core would not keep it |
| A gap: no persisted lane crossed seeds with nesting or with the cached row | Fixed: `persisted-nested-seeds`, with reach `seed under a kept re-insert` (minimum 5) |
| Cached row versus a later `DbClient` seed: the seed could not replace the cached row or its metadata | Fixed (decision 9). Witness `lets a later seed replace a cached row's metadata` |
| An update without metadata after an enclosing insert dropped the insert's re-judgment, so an inner commit could not make it clear metadata (found by the 10× campaign) | Fixed. Witness `rejudges an enclosing re-insert that a later update kept` |
| The wrapper re-judged only a key's last insert without metadata against the value saved before it, so an earlier insert whose kind an inner commit changed was missed, in either direction (found by a second 10× campaign) | Fixed: each key keeps its chain of such inserts. Witnesses `rejudges every enclosing re-insert of a key, not only the last` and `lets an enclosing clear become an equal re-insert after an inner commit` |
| B: a hold hides a duplicate source insert (`acceptSyncTransaction` refreshes the projection only when a transaction moves) | Fixed. The grammar never wrote a different insert over a row the source wrote; the `conflictingInsert` action does, and the model expects core's duplicate-key error (decision 8 keeps duplicates in core). On `743a6ce14` plus decision 9, 26 core tests fail, every seeded lane among them, including hold invariance. Core's classifier now exempts only a row that only seeds supplied; a seed beneath an open insert keeps that insert's kind in the replay instead |
| C: a seed hides a duplicate insert in the same or an enclosing transaction | Fixed by the same change and caught by the same action (`seed(1) begin upsert(1) conflictingInsert(1)` was accepted) |
| D: the wrapper's staged-row fold is O(N²) per transaction | Fixed. 4000 inserts in one transaction took 48 ms against 0.8 ms on `origin/main`. Each staged transaction now keeps its row per key, so a write-time read folds one entry per transaction; 16000 inserts take 6 ms. A mutant that drops partial updates' merge base fails three witnesses and four persisted campaigns. No oracle measures work; the scaling run is the evidence |
| E: an aborted staged transaction leaves enclosing implicit metadata judged against it | Refuted for a store-held transaction: `commit` says that aborting after acceptance has no effect, and its inner transaction still applied. Confirmed and fixed for a transaction buffered behind a storage read, which an abort abandons before acceptance: when a deferred transaction leaves without reaching the Collection, the wrapper judges the enclosing inserts again. Witness `judges enclosing inserts again when a buffered inner transaction is abandoned` fails without it. A durable failure ends the run with a terminal error, outside this law |
| A storage read marked every row the Collection did not hold as a seed, including a row a peer's source wrote in this run and that this tab loads for a new demand | Fixed: the runtime records the keys that peer notices name as written in this run, and stops marking seeds after a notice or catch-up that needs a full reload, because it names no keys. Witnesses `keeps a row another tab wrote this run when a later seed arrives` (named keys, full reload) fail on `e4b562448`; a mutant that ignores a full reload fails the second |
| Query owner supplement (`rowToQueries` in `getOwnersFromMetadata`) | Removed. Each edge Query adds stages its owner set in the same sync transaction, and Query rolls edges back when that transaction fails, so the supplement only covered owner metadata that held transactions hid from reads. The commit-order reader makes it redundant; all 1,486 Query tests pass without it |
| F: Query's owner read lost its applied-metadata fallback for a sync without `metadata` | No action: core always supplies `metadata`, and no wrapper in the repository drops it |
| G: state internals are public for `client.ts` | Accepted design: the seed authority lookups moved to `client.ts` so that an app without `DbClient` ships 130 fewer gzip bytes |
| A later seed merged into an outer re-insert's row by an inner update that commits ahead (random seed 50521469; also fails in core on `743a6ce14`) | Decision 10: the model now counts such a seed in the insert's kind. Witnesses `lateSeedUnderMergedUpdate` and `heldLateSeedUnderMergedUpdate` (core) and `lets an inner update merged over a later seed change an enclosing re-insert` (persisted). The held witness kills a core that keeps the insert's kind after the accepted inner write; without a hold the inner write applies and clears the seed mark, so that mutant is invisible there |
| H: `appliedAdapterMetadataKeys` grows with every deleted key | Fixed: the deleted-key and metadata-key sets became one map, `appliedAdapterKeys`, from each key whose metadata an applied adapter write fixed to whether that write deleted the row. After 5000 keys were inserted and deleted it holds 5000 entries instead of 10000 across two sets; the deleted keys remain, as D4 requires. The hydration authority grid gains `delete,update` cells, which a mutant that loses the returning key's authority fails. `sourceWrittenKeys` in the wrapper is unchanged |
## Fifth review round (second high review)

A high review of `ad966ec12` raised ten items. The plan of oracle changes
came first: per-key storage-read witnesses (peer metadata, a peer delete, a
held seed, an equal re-insert), a read hold in the persisted grammar with
the `persisted-reads` lane, a public-message witness, and scaling runs.

| Finding | Disposition |
|---|---|
| R1: a storage read marked as seeds for its whole transaction lets a later seed replace a peer's metadata | Fixed. The read stays one transaction; core keeps seed status only for the keys it lists (`preserveHydrationSeedKeys` may be a key set). Witness `keeps a row another tab wrote this run…` now checks metadata; it failed on `749079331` and passes with the `origin/main` wrapper |
| R1b: a DbClient seed held against a peer's write in this run | Fixed by decision 11; witness `treats a row a peer wrote this run as a source row (replaces a held seed)` |
| R2: validation deletes inside a seed transaction lost delete authority | Fixed by the same per-key rule; witness `keeps a row a peer deleted absent when a later seed arrives` |
| R3: a committed enclosing transaction stays judged against an abandoned buffered write | Refuted on the same path: the outer commit threw the hydration-cycle error, and after decision 12 the inner transaction either flushes or is dropped before the outer one commits |
| R4: writes during a storage read used older metadata rules | Fixed by decision 12: one write path. Witness `clears an explicit metadata write with a later insert during a storage read` and the `persisted-reads` lane (reach `write during a storage read`) fail on `749079331` and on `origin/main` |
| R5: `prependHydrationRows` did not shift partial-update indexes read by the staged-row walk | Resolved by removing the walk: each insert keeps its transaction's row from just before it |
| R6: core honoured `originalSyncType` from any public write | Fixed: the wrapper marks a whole-row update with the internal `syncWriteNamesWholeRow` symbol. Witness `merges a public partial update whatever fields the message carries` |
| R7: seed keys entered `sourceKeys` while staged | Refuted as unreachable: no caller classifies a seed-only row then |
| R8: two sets of keys written in this run | Fixed: the runtime keeps one record, fed by this tab's handoffs and peers' notices. Witness `treats a row a peer wrote this run as a source row (keeps metadata on an equal re-insert)` |
| R9: re-judgment was quadratic | Fixed by the same change as R5: 8000 implicit inserts re-judge in 2.5 ms (2000 took 18 ms). A mutant that judges against the transaction's whole row fails two witnesses and three campaigns |
| R10: readers copied the pending queue on every read | Fixed: they skip invalidated transactions in place |
| S1 (sibling): a commit threw when an on-demand read started during its transaction | Fixed by decision 12; the `persisted-reads` lane found it |

## Sixth review round (third high review)

A high review of `ff80a31c3` raised nine items. The oracle changes came
first: a peer-route witness grid (metadata-only notice, a missed notice, a
peer row during an open insert) and stored rows for the `persisted-reads`
lane's read hold, with reach `storage read of a stored row`.

| Finding | Disposition |
|---|---|
| H1: a peer's metadata-only notice did not count as a source write | Fixed: the runtime records row keys and metadata keys apart (D5 judges them separately). Witness `treats a peer's write in this run as a source write (metadata-only notice over a held seed)` failed on `ff80a31c3` |
| H2: the gap-recovery fallback and term-fence reloads left the run's writes known | Fixed: both mark them unknown. Witness `… (write whose notice was missed)` failed on `ff80a31c3` |
| H3: rows a peer's notice or a storage read landed ahead of an open wrapper insert did not judge it again | Fixed: every internal apply judges the open transactions' inserts again. Witness `… (peer row during an open insert)` failed on `ff80a31c3` |
| H4: a held seed ignores the unknown-writes state that seed marking honours | Accepted design (decision 13): under unknown authorship, what this tab holds wins. The persisted oracle's seed-across-peer-notice cases with absent, older, and equal durable data witness it; a trial that let unknown rows replace held seeds failed eight of them |
| H5: the read lane's storage read returned no rows | Fixed in the oracle: the holding adapter keeps durable rows; the lane reaches `storage read of a stored row` and passes |
| H6: the storage read assumed `begin` opened the transaction it marks | Fixed: it marks seeds only when `begin` opened one |
| H7: the staged-row fold copied the queues on every read | Fixed: it iterates them in place |
| H8: re-judgment scanned every implicit insert on each inner commit | Fixed: it looks up the inner transaction's keys |
| H9: `syncWriteNamesWholeRow` was exported without `@internal` | Fixed |

## Seventh review round (fourth high review)

A high review of `e4b81558b` raised ten items. The oracle change came first:
a reload-route grid in the persisted oracle, `keeps previous-run rows seeds
across a reload a peer's notice causes`, which crosses the three reloads a
named-key notice can cause (no `DbClient` seed held, so the reload
truncates core; a held seed, so it rewrites rows in place; more keys than a
targeted update allows) with a full-reload neighbour, and observes a later
seed of a previous run's row, of the row the notice named, and of a key
storage never held.

| Finding | Disposition |
|---|---|
| F1: a follower merges a targeted insert's row over its own and keeps a removed field | Refuted on the same path: a follower that shows the key reloads it from storage, and `follows durable same-key order for targeted insert replacement` (active and retired demand) passes |
| F2: an inner insert is judged against the enclosing open transaction's row, though it commits ahead onto another | Accepted design (decision 14). Production and the model agree (`nested`, `nested-conflicts`); a probe of the reported trace keeps metadata with no error. The mutant that re-judges accepted inserts, as `30175be48`'s replay did, fails both retention witnesses (fourth round) |
| F3: reloads a peer's notice causes rewrote previous-run rows as source writes, and the reload's truncate counted as a source truncate | Fixed (decisions 9, 11, and 15). A reload marks its transaction's seed keys: rows no source wrote, and under unknown writes rows storage left unchanged. Core keeps authority and seed status across that transaction's truncate, and the reload deletes each dropped row as a source write. The truncate stays, because it publishes each durable row's exact shape (three exact-shape witnesses need it). The grid failed three of four variants on `5013e5aba`; a later seed of a never-stored key was ignored after a truncating reload. Decision 15 added a full-reload variant followed by a new demand's storage read and a row the peer deleted; both full-reload variants failed on `44ef0c2d0`. Mutants: core treating the truncate as a source truncate (four variants fail), no unchanged-seed exemption under unknown writes (both full-reload variants), and no per-key delete of a dropped row (four variants). An earlier repair that validated rows in place lost the exact-shape publication |
| F4: every internal apply re-judged every open implicit insert | Fixed: the runtime passes the keys the internal apply's transaction wrote (every key after a truncate). Ten storage reads beside 4000 open inserts re-judged 40000 times, now none. A mutant that re-judges no keys fails `… (peer row during an open insert)`; no generated lane catches it |
| F5: staging adds a storage read's seed keys to the source-key set that a rebuild excludes | Refuted as unobservable, as R7: a mutant that always rebuilds at acceptance changes no persisted session lane, persisted-oracle case, or core session lane; the wrapper's only classifier call skips keys no source wrote in this run |
| F6: metadata reads scan every pending transaction | Accepted cost of read-your-writes: 10000 reads take 0.7 ms with no held transaction and 4.2 ms with 100 |
| F7: the run's written-key sets grow, and the internal-apply listener outlives cleanup | No action: the sets keep deleted keys because D4 and decision 11 need them, as H; cleanup empties the arrays the listener reads, and the next run replaces it |
| F8: a redundant deleted-key check, and a stored `acceptedSourceKeys` only the rebuild reads | Fixed |
| F9: state internals are public for `client.ts` | Duplicate of round 4's G (accepted design); `any` follows `client.ts`'s own `AnyCollection` convention |
| F10: seed keys are marked before the read's commit | Refuted: the read's begin, writes, and commit run synchronously, its commit takes no signal, a retired run's `begin` opens no transaction to mark (H6), and an accepted transaction always applies |

## Eighth round (the peer dimension)

After the fourth high review, the maintainer asked for the next oracle
improvement before another review: a peer in the persisted session grammar.
Every real finding since the fifth round had sat on a peer or reload route
that only pinned grids covered.

- **Law.** A peer's write in this run is a source write, accepted when this
  tab applies its notice, after every accepted transaction and beneath the
  open ones (decision 11). A full-reload notice keeps a held `DbClient` seed
  (decision 13) and makes stored rows and metadata that differ source
  writes (decisions 15 and 18). Reloads keep metadata of a missing row
  (decision 16); a write over a seed stores the row this tab shows
  (decision 17).
- **Grammar and model.** The `peer` action sends one of four notices: a
  named row with its metadata, metadata alone, a delete, or a full reload.
  It is legal only when no store hold or read hold is active, so every
  accepted transaction of this tab is durable and the notice is the next in
  the stream. The model tells cached rows from `DbClient` seeds and keeps
  what a reload restores per row: storage's row and metadata, which each of
  this tab's commits sets to what this tab shows (decisions 16 to 18).
- **Driver.** A `SingleProcessCoordinator` that delivers the `tx:committed`
  shapes the Browser and Electron coordinators send; the holding adapter
  keeps rows and collection metadata.
- **Lane and reach.** `persisted-peers` (seeds, the cached row, nesting to
  depth 2, store holds, 150 fixed histories). A 150-history sample with the
  fixed seed reaches each named notice kind 44 to 69 times, a named write
  over a held seed 42, a full reload over a held seed 19, a peer write during
  a hold 46, and during an open insert 17; the declared minimum is 5. A
  declared state for a full reload that reveals a hidden peer write was
  dropped: a write of the row by this tab stores its row over the peer's
  (decision 17), so only a named notice reveals it, which `named peer write
  over a held seed` covers.

| Finding | Disposition |
|---|---|
| P1: a reload's held-seed set came from `base`, so it truncated over a seed accepted during a hold (`hold seed(2) peer(1,row)`) | Fixed: held seeds come from core's hydrated keys |
| P2: a named notice for a row only held transactions wrote merged the peer's whole row over this tab's held row (`hold begin upsert(2) commit peer(2,row)`) | Fixed: a row in `base` counts as ambiguous, and so does a held row that the notice would change, so the notice reloads. The first fix checked held rows only and regressed `begin remove(1) hold commit peer(1,row)`; the lane found it at once. The second counted every held row and broke the real-host reload-class oracle's law (e), "a commit the tab already knows never makes it reread rows", on its Browser and Electron drivers: the notices it rerouted carried exactly the held row. A third version reloaded only when the notice's merge changed the held row; a peer's whole row that kept the held `v` and dropped its other fields then kept them. The grammar's row notice now has a variant that keeps this tab's `v` (`peer(…,row,keeps)`), and the replay `a notice whose row keeps a held row's value still replaces it` failed on that version. The final check reloads unless the notice carries exactly the held row, and the reload-class oracle passes on both drivers. Generated histories reach that premise too rarely to declare it (none in 300); the replay holds it |
| An in-place reload merged a stored row over a held seed (`hold seed(2) seed(1,narrow) peer(2,row)`) | Fixed: reloads write each stored row whole |
| A reload deleted again a row a held delete removed, dropping metadata written after it | Fixed: a dropped row is deleted only while core holds it, judged before the reload's truncate |
| F5 (seventh round, refuted as unobservable): staging counted a reload's preserved keys as source writes | Reachable after all: `seed(2,bare) begin reinsert(1) hold peer(2,reload)` judged the open re-insert equal. Fixed in core: staging skips preserved keys, as the rebuild does |
| L1, L2, and the later-seed metadata case | Decisions 16, 17, and 18 (B′) |
| A reload counted unchanged rows' writes as source writes, so metadata a seed governs lost that status | Fixed: a reload's write of an unchanged row keeps its status. A truncate in a storage read that keeps statuses keeps row metadata in core, and `metadata.row.get` reads through it; `_syncedRowMetadataKeysOutsideBase` left core |
| A named row notice did not mark its metadata as written in this run, so decision 18 kept a held seed's metadata over the peer's | Fixed: a peer's row comes with its metadata (decision 11) |
| Driver: the holding adapter dropped collection metadata, and cleared it on truncate | Fixed in the test adapter |

Evidence:

- **RED.** Each shrunk history above failed on the production before its
  fix; the survey of 2,000 generated histories before any fix found P1 in
  22 and P2 in 9.
- **GREEN.** Four surveys of 1,000 generated histories (seeds 77, 91, 105,
  133) find no mismatch; the fixed and random `persisted-peers` campaigns
  and the shrunk histories, kept as replays through the same model, pass.
- **Mutants.** P1 reverted fails both peer campaigns; P2 reverted fails the
  fixed one; B′ collapsed to B fails seven cases, two `main` full-reload
  cases among them; decision 11's metadata keys removed fails `treats a row
  a peer wrote this run as a source row (replaces a held seed)`. Three
  mutants survive every campaign and fail only their replay: no seed base
  (decision 17), storage metadata always winning (decision 18), and a
  dropped-row delete without the held check. The campaigns reach their
  premises too rarely; the replays keep them. In core, staging that counts
  preserved keys (F5) fails its replay; a status-keeping truncate that
  clears row metadata fails nine cases, both peer campaigns among them; and
  a metadata reader that stops at such a truncate fails two `replaces a
  hydrated seed and metadata with a peer's targeted …` cases.
- **Limits.** The peer is the driver; no second Collection or real
  coordinator delivers its notices, so the claim stops at the controlled
  coordinator (ORC-014). The next receiving witness is a second production
  driver of this oracle with two coordinators over a real channel
  (issue #2272). Missed
  notices and notices over the targeted key limit are not generated; the
  persisted oracle's grids cover them. The adapter is in memory, and restart
  stays outside this oracle.

## Ninth round (medium review)

A medium review of `2156c9c57` raised ten items. Planned together, they
asked for three oracle changes before any production edit: a peer lane
under full row updates (M1), a reset notice (M4), and a Query storage-scan
witness (M10).

- **Law.** A durable write stores the row this tab shows, so storage after
  settlement equals the model's storage, which a restart reads. Under full
  row updates an update replaces its row there too. A reset is a source
  truncate; eager it takes held seeds, on demand it keeps them with their
  objects' authority (decisions 19 and 20). A notice in a reset's term may
  predate the reset, so this tab reloads storage for it (the wrapper's
  reset fence).
- **Grammar and model.** The peer notice gains `reset`, which empties
  storage. The model's truncate may keep a set of keys, and a reset on
  demand keeps the `DbClient` seeds it holds. After a reset every notice
  reloads storage. New lanes: `persisted-peers-full` and
  `persisted-peers-on-demand`, the second with a demand for every row.
- **Observation.** The peer lanes now compare the holding adapter's stored
  rows with the model's after settlement. Before, storage was seen only
  when a reload read it back.
- **Reach.** The full-row lane declares `accepted update drops a field`;
  the on-demand lane declares `reset over a held seed` with the peer
  states. A reset over metadata of a missing row reached 1 in 150
  histories, so a replay holds it instead of a declared state.

| Finding | Disposition |
|---|---|
| M1: decision 17's seed merge ignored `rowUpdateMode: 'full'` | Confirmed and wider: the wrapper stored every sync update as a merge, so under full rows a reload or restart brought back fields an update dropped, with or without a seed (`main` too). Fixed: only a partial update merges in storage; every other write replaces its row |
| M2: seed marks added at a read's begin | Refuted, as F10 |
| M3: seed metadata applies over a rejected row | Accepted: row and metadata are separate objects (D5) |
| M4: a reset beside a held seed kept orphan metadata | Confirmed and wider: the reset also kept rows a hold kept from `base` and skipped the demand replay its truncate drives; a reload deleted only `base` rows that storage lacked. Fixed: a reset is a source truncate that keeps held seeds (decisions 19 and 20), and a reload deletes every accepted row that storage lacks |
| M5: a status-keeping truncate keeps flags of dropped keys | Refuted: a dropped key is outside the read's preserved keys, so its delete is a source write and clears its flags (the grid's `gone` row) |
| M6: an accepted inner equal insert keeps its kind | Accepted (decision 14) |
| M7, M8 | Duplicates of F9 and F7, accepted earlier |
| M9: the commit wrapper reads the newest pending transaction on every commit | Harmless: `withInternalApply` resets the key set before each use |
| M10: Query's storage-scan owners omit accepted edges | Open; see "Open" |
| Lane: a reset kept a held seed but cleared the authority a peer's metadata write had fixed over it, so a later seed's metadata replaced the peer's | Fixed: the reset's truncate keeps the authority entries of kept keys |
| Survey: a source row write after an on-demand reset closed the kept seed's metadata to a later seed | Fixed: a kept key stays exempt for its metadata; a row write fixes row authority through the applied row |
| Survey: after a full-reload notice, a named notice that the wrapper turns into a reload erased a seed's metadata of another row (`peer(1,reload) seed(2) begin upsert(2) commit peer(1,row,keeps)`, also on `2156c9c57`) | Fixed: a notice that names no keys makes writes unknown per key, not for the rest of the run. A key is known again once this tab's source writes it, and a storage read records each row it finds changed as this run's source write. This tab's own truncate still makes every later write unknown. Ending the unknown state with the reload instead failed two `persisted-oracle` witnesses: an on-demand reload with no demand reads no rows, so a row it never read must still beat a later seed. Marking keys known before the read wrote them failed both oracles widely. Mutants: not recording changed rows fails the fixed campaigns of all three peer lanes; no knowledge from this tab's writes fails the family's replay; knowledge kept across a later full-reload notice fails 16 cases. Knowledge from a read's rows too survived every case and was removed |

Evidence:

- **RED.** On `2156c9c57`'s production, ten cases fail: the five new
  replays and the fixed and random campaigns of both new lanes. A
  replay of the kept-authority case failed on the first M4 repair.
- **GREEN.** Every persisted session lane and replay passes at the
  configured runs. Two surveys at four times the runs found two families,
  one on the reset path and one that `2156c9c57` already had; both are
  fixed and pinned, and two more surveys at four times the runs pass.
- **Mutants.** Killed: an update over a seed merging under full rows; no
  seed base for partial updates (now by both partial campaigns, through the
  storage check); every update replacing; a reset that keeps no seeds; no
  rewrite of a kept seed's row; reload deletes from `base` only;
  authority that ignores kept keys; a truncate that clears kept metadata.
  For the scoped unknown writes, the committed sticky flag fails the
  family's replay, and not recording changed rows fails the fixed
  campaigns of all three peer lanes. Survived: a session reader that stops
  at the reset's truncate for kept keys. A truncating transaction applies at once, so no read sees it
  pending; the reader change was removed.
- **Limits.** The reset's term fence is exercised only through the
  driver's single-term peer. The full-row and on-demand lanes cover the
  peer grammar, not the other lanes' holds and reads.

## Open

- **Held-cleanup retention witnesses race on CI.** `does not publish a
  retention-cleaned owner through a claim made during the cleanup hold` and
  `hydrated clients drop a held-cleanup row once its peer and claimant
  release it` (Query ownership lifecycle) sometimes see no expiry
  transaction staged within 5 seconds of the unload while an optimistic
  blocker holds sync. They failed on CI at `1c7624710` and `9ec84d81c` and
  passed on the rerun of `9ec84d81c`, at `c065ab5ec`, and at `bc8f5f3d2`;
  locally they pass five times in five at load average 43. The witnesses
  without a hold pass in under 120 ms. Refuted: a Node timer firing before
  the entry's wall-clock deadline (a timer set after a 50 ms busy task fired
  12 ms later), and a wait on a held receipt (no step of the expiry awaits
  one). The witnesses now trace each timer Query DB sets during the test
  (where it was set, whether it fired, what cleared it) and each Query
  fetch, and a failed retention wait prints that trace. With it, the
  witnesses passed on CI at `543d29066` and in four local runs of CI's
  collections command. Deferred by the maintainer on 2026-10-27: the pull
  request merges with the race open ("it'll eventually fail at which point
  we can fix it"). Resume when a failure reports its trace; the trace
  names the step to fix, in production if a valid expiry was cancelled, or
  in the witness if only its timing raced.

- **Query storage-scan owners (M10).** `getOwnersFromMetadata` no longer
  adds this tab's accepted edges, which matters only where it reads a
  storage scan: `loadPersistedBaselineForQuery` for a retained Query whose
  known rows are not all in the Collection. Three witnesses (a held scan
  beside another Query's claim; a retained Query with a stored row, and with
  a row moved out of its predicate) each took the in-memory baseline, which
  includes the claim. The scan and every storage hydration hold the apply
  lock, so a claim during a held scan waits. Not excluded: a claim
  committed during a storage read, which the wrapper buffers (decision 12),
  with a retained Query's scan before the buffer flushes. That history is
  the missing witness; no production change without its RED.

Nothing else in this bug class is known to be open. The limits in the
evidence block still apply.

## Oracle guide requirements

| Requirement | Outcome |
|---|---|
| ORC-001 | Met: decisions and sources above; limits in the module's opening prose. |
| ORC-002 | Met: the model folds an event log; production scans queued write sets. |
| ORC-003 | Met: contract, model, grammar, driver contract, and comparison are separate sections with prose. |
| ORC-004 | Met: witnesses are reconstructed by the grammar; the ablation test shows each axis is needed for its regime; range probes added prefix-boundary keys (new values only) and a seed field (a missing merge rule, now modelled); exclusions (`remove` or `reinsert` of an absent row) are stated. |
| ORC-005 | Met: real sync API, `DbClient.hydrate`, and the persisted wrapper; observations at each checkpoint. |
| ORC-006 | Met: production on `30175be48` and the temporary reader mutants. |
| ORC-007 | Met: fixed and random campaigns per lane with replay properties registered in `oracle-config.ts`. |
| ORC-008 | Met: frames, accepted queue, seeds, and hold each change an observation (see the witnesses). |
| ORC-009 | Met: frames are sync transactions, each independent (decision 6); the model's serialization order is the order a read and an application use. |
| ORC-010 | Met: the runner preserves the mismatch and aggregates a cleanup failure. |
| ORC-011 | Met: three properties compare production with itself, without the model's reads: hold invariance (holds removed), key independence (row 2's actions removed), and seed order (seeds performed first, decisions D4 and D5). A shared fault in the model's reads cannot pass them. |
| ORC-012 | This record. |
| ORC-013 | Met for hold kind (store-hold neighbour passes, core hold fails on `30175be48`) and nesting (inner commits during a hold fail on `30175be48`; outer aborts and unheld inner truncates pass there). |
| ORC-014 | Met: the persisted lanes receive the flat, nested, and seed laws through the wrapper. Restart and resume belong to other owners. |
