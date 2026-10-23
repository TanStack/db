# Sync metadata session: borrowed laws and independent transactions

Base revision: `30175be48` (`main`). Opened by
[issue #2220](https://github.com/TanStack/db/issues/2220). Every lane below
is RED on the base revision. The same pull request repairs production; see
"Production repair" for the evidence block.

## Decisions

The maintainer made five decisions on 2026-10-22; the fifth replaced an
encoding the author had extended without asking. A sixth, on 2026-10-23,
withdrew the second:

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

## Laws and sources

| Law | Source | Transfer to a sync run |
|---|---|---|
| Read your writes | Terry et al. 1994, §3.1 | Every read includes every accepted write of the run and every write of its open transactions, ordered by commit: accepted transactions in commit order, then open transactions in begin order |
| Monotonic writes; one current value | Terry §3.4; Moss 1981, p. 61 | A transaction's writes take effect at its commit. The last write in commit order, issue order within a transaction, is the value, for reads and for what applies |
| Monotonic reads | Terry §3.2 | The writes a read includes only grow, except at an abort. When an inner transaction commits, an enclosing open transaction's write to the same object is ordered after it, so a read can change without a new write |
| Own reads | Adya 1999, §3.1.2 | A transaction reads its own writes; the innermost open transaction's writes come last in the order |
| Aborted reads | Adya §3.1.2, G1a | Not guaranteed across open transactions: an inner transaction reads an enclosing transaction's open writes and can commit before that transaction aborts (decision 6). No read after an abort includes the aborted writes |
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
  lanes `flat`, `nested` (depth ≤ 3), `seeds`, and `seeds-full`
  (`rowUpdateMode: 'full'`).
- `db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts`:
  `persistedCollectionOptions` over an in-memory adapter, with store and core
  holds; lanes `persisted-flat`, `persisted-nested`, `persisted-seeds`.

The row-metadata composition oracle keeps its base nested lane, which
already judged independent transactions: a transaction begun inside T1
applies first, and T1's inserts are reclassified against the rows it leaves.
This change adds a `held` variant of that lane (a hold cannot change commit
order) and applies D5 to its seed variant. Its held-window lane, added
earlier for this issue, stays.

The session grammar does not generate an inner transaction's row write or
truncate after an enclosing open transaction has written that row or
truncated (a truncate: after it has written any row). Committing first puts
the inner write ahead of the outer one, so the outer insert's kind can
change, or the outer transaction can become invalid, which the session model
does not judge. The composition oracle's nested lane owns those histories for
one key; the coverage map records the gap for several keys.

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

The repair keeps the existing structures and changes four rules.

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
  wins. Under partial row updates the wrapper hands core an insert as an
  insert unless core would reject it as a duplicate of a stored row.
- **Query.** `getRowMetadata` no longer falls back to applied metadata, which
  read a staged clear as "no value".

### Evidence block

- **Law:** read your writes, monotonic writes in commit order, own reads,
  monotonic atomic view, applied receipts, and D4/D5 seed authority, as
  stated above. Authority: decisions 1 and 3–6.
- **Reach:** the fixed campaigns (100 histories per lane) reach these
  declared states. The reach test fails below its minimum: 11, or 5 for the
  two states that need a seed and a source write on one row.

  | State | flat | nested | seeds | nested-seeds | seeds-full |
  |---|---|---|---|---|---|
  | read with two held transactions | 18 | 37 | 16 | 22 | 12 |
  | open transaction over a held transaction | 51 | 62 | 36 | 48 | 30 |
  | truncate during a hold | 30 | 25 | 22 | 21 | 15 |
  | nested commit | | 59 | | 52 | |
  | nested commit during a hold | | 43 | | 36 | |
  | abort keeps an inner commit | | 11 | | 9 | |
  | seed under a source insert | | | 37 | 26 | 24 |
  | seed under an open update | | | 10 | 5 | 7 |

  The persisted lanes declare their own states in
  `sync-metadata-session-persisted.test.ts`.
- **RED:** `30175be48` production with this branch's tests, as listed under
  "RED evidence": 51 of 186 tests fail in the session, composition, and
  retention files.
- **GREEN:** `pnpm vitest run` in `packages/db`: 285 files, 13,902 tests
  pass. The session oracle file passes 67 of 67 in three consecutive runs.
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
    replacing its row: `seedUnderOpenReinsert`, whose first seed is narrow and
    whose late seed carries a field the re-insert omits. Every campaign and
    the other owners pass this mutant.
  - Wrapper: reading only the innermost open transaction; keeping an earlier
    explicit write over an insert's clear; clearing on every insert; handing
    every insert to core as an update; hiding staged transactions from seed
    authority. Each fails at least one persisted lane.
- **Limits:** the session grammar excludes an inner row write or truncate
  that conflicts with an enclosing open transaction's row writes (see
  "Executable owner"). Under partial row updates the seed-order property
  drops `reinsert` from both runs, because decision "b" lets a moved seed
  change a re-insert's planned row. Invalidated transactions, a read of an
  invalidated transaction's metadata writes, and restart and resume stay
  outside this oracle.

### Code weight

`pnpm size:compare` against `30175be48`: `@tanstack/db` grows 178 bytes gzip
(`collection/state.js` +658 minified bytes, `collection/sync.js` +78,
`client.js` +10), `db-sqlite-persistence-core` grows 203 bytes gzip
(`persisted.js` +729), and `query-db-collection` shrinks 5. The growth is
commit-order acceptance, per-object seed authority (including the wrapper's
staged transactions), the source-key set that tells a seed-only row from a
source-written one, the readers' loops, and the wrapper's re-insert
classification. Refactors made to pay for it: the seed acceptance method
became the single acceptance method for commits and seeds; the two seed
authority lookups became one loop; the base invariant throw for an accepted
duplicate is gone. The closed-nesting attempt was net negative because it
deleted reclassification and invalidation, but decision 6 keeps both.

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

## Open

- **Reads of an invalidated transaction.** A replay can invalidate an open
  transaction when an inner transaction commits a conflicting row first. Its
  later row writes are ignored, but `metadata.row.set` still stages, and the
  readers include those writes until its commit rejects. No oracle generates
  the conflict; the composition oracle's nested lane covers one key without
  reads.
- **Query owner supplement.** The `rowToQueries` supplement in
  `getOwnersFromMetadata` survived every mutant run; it may be removable.
  Not attempted in this change.

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
