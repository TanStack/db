# TrailBase lifecycle oracle

`lifecycle-oracle.property.test.ts` runs the real adapter and collection against
a controlled RecordApi and native ReadableStream. The mock supplies requests and
already-decoded events at the RecordApi boundary; it bypasses the SDK's fetch,
SSE decoding, and wildcard subscription routing. Adapter, core, and native stream
lifecycle code execute unchanged.
An independent Map models rows; explicit gates control subscribe/list settlement.
The same interpreter runs a fixed corpus and generated histories.

## Laws and scope

- Published inserts, updates and deletes agree with the model after each event.
- Eager startup waits for its list; on-demand startup does not claim to load rows.
- A list starts only after the change subscription is established, in both
  modes, so a change committed during or after a fetch reaches the listener.
  An on-demand subset load that arrives before the listener runs waits until
  `start` reports that the listener runs or cannot start.
  Since #2115 a live query is ready when its subset load settles, not at the
  source's `markReady()`, so the load itself must carry this ordering. The
  wait still honors its caller: an abort rejects a waiting load with
  `AbortError`, cleanup ends it quietly, and a listener that cannot start
  rejects it with that failure instead of fetching. Because a load waits for
  the listener and not for the subscription, it does not depend on the order
  in which `start` and the load resume; a mutant that adds an await before
  `start` subscribes is equivalent.
- The early-demand lane checks that law with its own service model: `list`
  answers from the service rows at the moment it is called, and a change
  reaches only subscriptions that exist when it commits. Its 16 histories
  cross the subscription outcome (listen, subscribe rejects, reader fails,
  abort, cleanup), a service change committed before the subscription, and a
  real live query or the core subset boundary. Checkpoints after the demand,
  after the service change, after the outcome, and after a later change
  through the listener compare list calls, load or query state, status,
  first-ready rows, and current rows.
  Required startup failures reject. Later stream failures retain rows and report
  the error, matching the adapter's current policy.
- Once a page and every change event for its rows have arrived, the
  Collection's rows equal the service's rows. A page was read before any
  change that the listener applies while the page is in flight, so the page
  skips rows that such an event touched. Every page row is written as a
  full-row `update`, which creates a missing row and replaces a held one, so
  a page never collides with an event that core accepted but still holds. The page-event lane
  enumerates 15 histories: eager startup or an on-demand load; an update,
  delete, or insert; committed before the list call (on-demand only), while
  the page is in flight, or after it applies. It compares the Collection's
  rows with the service after the page settles and after a later change. A
  generated lane (`trailbase.page-event`) extends the same law: 258 service
  rows read in two pages of 256, cursor or offset paging, one or two
  overlapping on-demand loads, and up to four inserts, updates, and deletes
  among page releases. After every step a changed key holds the service's
  value; after the history drains, every returned or changed key does. Four
  named replays pin an update between pages, an update then a delete during a
  page, overlapping loads around an update, and offset paging with two
  updates. After the history drains, the Collection holds exactly the rows
  that a page returned or an event touched and that the service still has.
  The page fence orders events by a sequence that each sync run counts, so a
  fresh run never skips a row because of an earlier run's event. The fence
  keeps per-key sequences only while a load is in flight and clears them when
  the last load ends; no public observation measures that bound.
- Events for a change committed before a list call can arrive after the page
  applies, because the stream and the list are separate requests. An
  `Insert` event is a full row, so the listener writes it as an `update`: a
  late insert for a row that a page already holds no longer tears the stream
  down with `DuplicateKeySyncError`. The page-event lane crosses changes
  committed before the list with delivery at once, while the page is in
  flight, or after it applies, including an insert followed by an update;
  the generated lane delivers each change at once or later, in commit order.
  Both check that a later change still reaches the listener. A late older
  event shows its older value until the newer event that follows it arrives.
  The adapter has no row version to order an event against a page, so the
  lanes check a row only once every event for it has arrived.
- A page never fails a load for an older event that core accepted but holds
  while a user mutation persists. TrailBase mutation handlers wait for their
  own change event, so core holds sync commits for the round trip of every
  mutation. Four histories cross a persisting mutation (or none) with an
  older insert or update event queued before the list call and a page that
  lists a newer value. While the mutation holds commits the load stays
  pending; once the newer event and the mutation settle, the load is
  fulfilled and the rows equal the service.
- The adapter subscribes once per sync run and does not resubscribe. After the
  stream closes or fails, the Collection keeps its rows and stays ready, a
  later service change does not reach it, and a later on-demand load lists
  the service's current rows without waiting. The Collection's node shows an
  `error` from the end onward, with a stream failure as its cause, and only
  `reload()` or a restart clears it. Reconnecting is left to the TrailBase
  provider. A mutant that reports the end as a `failureReason` fails 29
  lifecycle cells. A separate lane checks that a reload after a failed startup
  settles on the new subscription's outcome while the Collection still shows
  `error`. Two histories make this limit
  executable; they do not claim it is the right product behavior. They pin
  one stream end followed by one change and one load. A page whose newer
  event never arrives because the stream ended keeps the value the fence
  allowed; that follows from the same no-resubscribe limit and has no cell.
- Graceful closure drains buffered events before releasing the reader.
- Processing failures cancel an open source. Terminal paths release readers and
  timers without detached rejections, including same-turn cleanup.
- A startup processing error rejects readiness before asynchronous cancellation
  settles. Two fixed controls hold cancellation through later list completion,
  then resolve or reject it; cleanup cannot turn failed startup into readiness.
- Cleanup clears the collection. Late work from an old Collection sync run
  cannot publish into, cancel, or report errors against a replacement sync run.
- A late acquired old stream is canceled once and stays unlocked, including when
  its native cancellation rejects. An unfinished old preload rejects with
  AbortError before late work settles; an already-ready on-demand preload stays
  fulfilled. Its direct subset promise settles as a canceled no-op after I/O.
- Error and detached-rejection observations are append-only through final gate
  release and cleanup. Epoch tags record when an observation arrives, not the
  hidden sync run that caused it. Exact console output checks pin the
  adapter's
  current compatibility policy, not a general service reporting contract.

Histories contain one to three Collection sync runs, eager/on-demand modes, delayed startup
and list resolve/reject, zero to eight row edits, five stream endings, and
immediate versus settled cleanup. Thirty-two fixed cases pin the boundaries;
ordinary runs add 50 fixed-seed and 50 fresh-seed histories with shrinking.
Additional controls cover rejecting late cancellation in both modes and mutate
provider-owned list, event, and buffered rows before parsing. Model rows derive
separately from command scalars, so provider mutation cannot change the answer.

This is not a model of filtered subsets, optimistic mutation
acknowledgements, or service reconnects. Offset paging takes updates only: an
insert or delete between pages moves rows across a position boundary at the
service, which the adapter cannot correct. An eager load cannot overlap an
on-demand one, because an eager source has no subset loader. The page lanes
use one change listener per run; more than two concurrent loads and pages
larger than two remain outside the generated grammar.
The generated event phase starts after loading; existing loading-time unit
matrices and the two held-cancellation startup controls remain valuable. Those
controls were both RED when listener failure awaited cancellation, and GREEN
when cancellation was observed separately. The lifecycle driver calls the core subset boundary;
the early-demand lane also drives a real live query. Service-backed E2E coverage remains separate.

## Run and replay

Run from `packages/trailbase-db-collection`:

```sh
pnpm test:oracles --coverage.enabled=false
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10 pnpm test:oracles --coverage.enabled=false --testTimeout=60000
```

For a failing random campaign, use its reported seed and shrink path:

```sh
TANSTACK_DB_ORACLE_SEED=123 TANSTACK_DB_ORACLE_PATH=0:1 TANSTACK_DB_ORACLE_PROPERTY=trailbase.lifecycle node --import tsx ../db/tests/oracle-replay.ts tests/lifecycle-oracle.property.test.ts --coverage.enabled=false -t 'random or replayed'
```

Use `TANSTACK_DB_ORACLE_PROPERTY=trailbase.page-event` and `-t 'generated page
histories with a random or replayed seed'` for the page lane.

Replace the example seed/path with the failure's values. The guarded runner
requires a witness that the named property executed with this seed and path;
wrong-property and zero-reach commands fail. Direct Vitest commands do not supply
that guard. Shared configuration lives in `packages/db/tests/oracle-config.ts`;
do not copy its replay parser.

## Evidence against false greens

The early-demand lane fails all 16 histories on the adapter from before the
listener wait (#2115's `main`): each history lists rows before the listener
runs. Four mutants of the wait fail it at assertions:

| Mutant of the wait                     | Failing histories |
| -------------------------------------- | ----------------: |
| Loads skip the wait                    |                16 |
| A start failure never settles the wait |                 4 |
| The wait ignores the caller's abort    |                 2 |
| Cleanup does not settle the wait       |                 2 |

The page-event and stream-end lanes fail on the adapter before this change:
an update during the fetch makes the page's insert collide with the row the
event wrote (`DuplicateKeySyncError`, so the load rejects), a delete during
the fetch brings the row back, and a later load that lists a changed row
collides the same way.

| Variant                              | Failing histories |
| ------------------------------------ | ----------------: |
| Adapter before this change           |                 6 |
| Pages ignore change events in flight |                 4 |
| Pages always insert                  |                 2 |

The held-commit lane fails on the adapter before this change: with a
mutation persisting, a page's `insert` for a row that a held event inserted
is a duplicate of the pending synced row, and the load rejects. Deciding
insert or update from the visible rows (`collection.has`) still fails that
history, because the held event is pending, not visible.

| Mutant of the page write or fence           | Failing tests |
| ------------------------------------------- | ------------: |
| Decide insert or update by `collection.has` |             1 |
| Always insert                               |             6 |
| No fence                                    |            10 |
| Wall-clock fence                            |             1 |
| Loads skip the listener wait                |            16 |
| Clear the fence when any load ends          |             1 |
| Record events only with two loads in flight |             9 |

The delivery dimension fails on the adapter before the listener change: an
insert and its update committed before the list call, delivered after the
page applies, make the listener's `insert` collide with the page's newer row.
The stream tears down, and a later change never arrives. A listener that
writes `insert` fails both the single-page history and the generated lane's
named replay at that assertion.

The generated lane and its four replays all fail on the adapter before the
fence and on the fence-less mutant; both properties shrink to one update while
the first page is in flight. Always inserting survives that lane, because a
page can only meet a different stored value after a missed event, which only
the stream-end lane produces. A wall-clock fence failed the fresh-run cell: an
earlier run's event in the same millisecond hid the row from the new run.
The 10x campaign passed 800 generated page histories.

Before the stale-startup fix, both campaigns independently shrank to: cancel a
pending subscription, restart and load a healthy stream, reject the old subscribe.
The old startup canceled the replacement reader. The fixed corpus pins this in
both modes and sends further edits through the replacement stream.

Five isolated source-transform mutations were each rejected by the fixed corpus:

| Reintroduced fault                                | Failing cases | Detecting assertion                               |
| ------------------------------------------------- | ------------: | ------------------------------------------------- |
| Unobserved `reader.closed.finally()` rejection    |             4 | No detached rejections                            |
| Release reader as soon as `closed` settles        |             2 | Buffered close reports no error                   |
| Omit source cancellation after processing failure |             2 | Underlying source canceled                        |
| Ignore cleanup's cancellation rejection           |             2 | Same-turn cleanup has no detached rejection       |
| Let abandoned startup cancel the current reader   |             2 | Replacement remains locked, uncanceled and usable |

These targeted mutations test known failure classes, not overall mutation
coverage or a proof of completeness. The 10× campaign passed 800 generated
histories (fixed seed 714203, random seed 127535183) plus the 32 corpus cases.
No service-backed E2E run is claimed.
