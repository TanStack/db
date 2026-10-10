# On-demand cache eviction after resume authority loss

The agreed law applies to an on-demand Electric Collection whose persisted
resume evidence cannot authorize its cached rows. That Collection starts a
`changes_only` provider session, acquires only demanded source snapshots, and
retires the old durable cache. A valid on-demand resume and an eager Collection
retain their existing paths. Each later loss of resume authority retires the
generation claimed by that run. A run that still claims an older generation
gets private empty storage; it cannot retire a newer generation used by another
run. A cache eviction does not prove an empty source snapshot.

The original wrapper only called core `truncate({ markReady: false })` in
`startScopedRecovery`. It removed old public source rows but left old SQLite
rows available to new sync runs. The revised wrapper claims a distinct storage
ID before reading resume metadata and rotates that ID during scoped recovery.
Old rows remain for a warm run with a valid claim; a new claim sees the empty
generation with incompatible key-set evidence. SQLite drops retired storage
after its last claim releases or expires. A held registration race has a
separate test: late DDL must remove any recreated empty table and metadata.

An ordinary persisted truncate is not an eviction. SQLite treats
`PersistedTx.truncate` as a complete replacement: it clears rows and expected
keys, then sets `key_set_evidence_available = 1` and
`key_set_evidence_incompatible = 0`. That certifies an empty baseline which a
subset-only provider session has not established. The broadcast coordinator
also reports it as `tx:committed` with `requiresFullReload: true`. A warm tab
then reloads its active subset from the empty disk cache and loses a valid
source row. The hostile global-invalidation control detects that public-row
loss. It rules out simply persisting the existing truncate.

A safe eviction needs distinct durable authority and receiving semantics:

1. Atomically make the old cache unreadable to new runs and record that its
   key set is uncertified. Later partial source writes and resume metadata
   writes cannot turn that marker into a complete baseline. Only an actual
   complete source replacement may certify it.
2. Keep authority local to each sync run. Advancing the current persisted
   cache generation prevents new runs from claiming the old cache; it does not
   invalidate a different run's provider session or public snapshot. An
   existing run may keep reading its generation only while its own resume
   evidence and claim authorize it. Its own loss of authority stops further
   durable hydration and requires source snapshots for later demands.
3. Fence writes admitted under the retired cache authority. Otherwise a slow
   write can recreate stale rows after eviction. The coordinator's ordered
   transaction position alone does not identify the authority under which a
   write began.
4. Preserve a pending optimistic mutation's public state and any separate
   durable mutation obligation. A tab must not delete that obligation while
   its handler waits for provider confirmation. A refusal or error must be
   observable if the system cannot preserve it.

The approved storage design keeps successive persisted cache generations for
one on-demand Collection. Several sync runs may share a generation. Each
generation has a distinct storage ID. A sync run claims the current generation
before reading resume evidence. Invalid evidence advances the current
generation; a warm run keeps its old claim and public source snapshot, while a
new run sees only the new empty, uncertified persisted cache. If the warm run
later loses its own resume authority, its new generation remains private and
the current head stays available to new runs. Source commits
carry the claim that admitted them, and SQLite checks it inside the write
transaction. An older library writer knows only the public Collection ID. The
first new-format generation therefore uses a distinct storage ID too: older
writes may continue in legacy storage but cannot contaminate the new-format
cache. Bumping the existing `collection_registry` `schema_version` alone would
not fence that writer, because its default `sync-present-reset` policy may
reset and continue. The legacy storage ID is isolated, but its physical rows
are not collected by the new generation collector while an old library version
may still write there. That cross-version cleanup policy remains open.

“Retired” means unavailable to **new** claims. It does not itself revoke an
existing run's claim. A counterexample to global revocation is two live tabs
with different shape identities: the newer tab must discard its old resume
evidence, while the older tab still has a valid provider session for its
shape. A global persisted truncate or full-reload notification destroys that
older tab's valid public row. Conversely, an existing run that loses its *own*
resume authority must stop hydrating its old cache even if another claim to
the same generation remains. A hostile global-eviction control demonstrates
why the shared truncate law is wrong here. A separate two-run Browser receiving
history now checks that the warm run keeps its row while the recovering run
gets its own source owner and empty persisted cache.

The user approved expiring a long-paused run's claim so storage from crashed
runs can be reclaimed. Expiry must revoke the claim before a resumed run reads
or writes retired storage; that run then reacquires the current head and
reloads its demanded subsets. A timer by itself is insufficient because a
paused tab can resume before its next timer tick. The implementation uses a
five-minute default claim duration and renews active claims. Demand, explicit
scan, source-commit, and coordinator-message admission check for expiry;
SQLite checks read and write claims inside their transactions. A receiving
oracle delivers a peer notification before the timer runs and requires a new
source snapshot. There is no host-specific resume hook or synchronous fence
on arbitrary `Collection.get` calls.

The implementation carries the claim through subset, resume-snapshot,
row-scan, and collection-metadata reads. SQLite rejects unclaimed reads of a
generation and checks the claim again inside each read transaction. A held
registration lookup lets a second adapter release the claim after the first
check; removing the transaction check returns the stale row, while the fixed
path rejects. A second held-registration witness releases the final claim
before DDL finishes, then checks that neither a table nor its metadata is
resurrected. Coordinator stream-position, replay, and index operations now
carry the initiating claim for managed storage IDs. SQLite checks that exact
claim before registration and inside the transaction. A two-claim real-SQLite
oracle rejects the expired run while the warm peer can still use its index;
a public Collection index event checks that the expired run cannot remove the
warm peer's persisted index.

A later scoped rotation can overlap a pending old subset acquisition. The
old coordinator release previously waited for that acquisition's load promise,
while rotation waited for release inside the apply mutex. Both coordinator
implementations now offer unload before that promise settles. A two-run Browser
witness holds the old load during rotation, checks prompt recovery and exact
old acquisition release, and checks that the new demand reaches its new source
owner. A separate wrapper witness rejects a queued old source commit after
rotation and accepts a new one.

Only one generation is current for a public Collection ID. Two different shape
identities can therefore alternate the current generation across sequential
new runs. Existing claims remain isolated, but this design does not promise
indefinite reuse of both shape-specific caches. It may repeat demanded subset
work; it must never force a full-shape download because of that churn.

The coordinator also keys election, the one remote subset owner, transaction
positions, subscriptions, and invalidations by Collection ID. Sync runs using
different persisted cache generations can have distinct source owners and
transaction positions at the same time. A single coordinator key cannot
represent both: one owner would replace the other, and a broadcast full reload
from one cache could remove the other run's valid source row. Routing by
persisted cache generation is consequently part of the coordinator routing
key, with the public Collection ID unchanged. The cross-tab receiving oracle
checks that a warm run keeps its source row and remote demand while a run using
the new generation starts with an empty cache and acquires its own subset.
An automatic approval review rejected the first routing attempt because it
could disrupt cross-tab sync. A later two-run Browser production driver
demonstrated the misroute with the original implementation: a recovering
demand settled through the warm run's source. With generation routing, that
driver reaches the recovering source and retains the warm public row. The
controlled transport still needs a native multi-tab receiving witness.

A bounded TLA+ exercise checked the abstract claim rule and produced
counterexamples for global truncate, unfenced write, and unclaimed collection.
That exercise did not model Electric, SQLite, or mutation settlement, so
receiving oracles must establish those refinements.

The claim and resume evidence read occur as separate calls. SQLite validates
the claim at the read transaction, so a rotation between those calls cannot
return unclaimed rows. The persisted oracle now holds a hydration read and a
sequence-gap replay across claim expiry and checks that neither old result is
published. A held public row scan also retries against new private storage;
the startup oracle discards an expired resume-metadata read before the source
starts. Native multi-tab and OPFS receiving and cross-version deletion of
legacy storage remain unproven. Timed expiry permits
reclamation after a crashed or indefinitely paused run; its later reads and
writes must revalidate the claim. A test holds an optimistic mutation through
expiry and confirms that recovery does not settle its local obligation or
deadlock on the accepted truncate.

Oracle review then found an in-scope counterexample to the source boundary.
Offering unload no longer blocks rotation, but an old provider request may
ignore unload and later deliver its rows through the same source callback.
The wrapper originally recorded the cache generation when that callback
committed, so it stamped an old row with the new claim and published it. A
composed wrapper run reproduced both the public stale row and the durable
write into the new generation. The original demand could also stay pending
forever while the coordinator awaited its old load promise.

The installed Electric client injects `requestSnapshot` rows into its shared
stream after the fetch completes, with no request identity or cancellation
signal. Its standalone `fetchSnapshot` does not update the stream's snapshot
tracker and offset, so substituting it would change concurrent-change
semantics. The chosen repair gives a source sync result an explicit optional
`restartAfterScopedRecovery` capability with two phases. The persisted wrapper
calls it before rotation with a promise that settles after the accepted cache
clear. The source must retire old callbacks synchronously before returning;
Electric unsubscribes and retires its old lifecycle at that point. The
replacement changes-only stream starts only after the promise fulfills, then
pending demands acquire fresh snapshots. If rotation fails, the promise
rejects. This order is necessary: an executed hostile delivery between
rotation and a later one-phase restart put an old row in both the public
Collection and the new durable cache. The wrapper also rejects source commit
admission while recovery is pending, so a callback queued behind the apply
mutex cannot acquire the new cache generation.

The new Electric provider session does not reuse the old resume record or
certify the partial cache as a complete baseline. It forgets old txid and
snapshot acknowledgements, including those imported before initial scoped
recovery. Pending Electric txid/match waits reject with `StreamAbortedError`;
a new wait needs evidence from the replacement session. Cleanup aborts an
incomplete old stream transaction, releasing its reserved commit turn before
fresh demands run. The Electric oracle reached each of these checkpoints with
a RED witness before the repair. A managed custom source without the restart
capability is refused before rotation, and a managed persistence adapter must
supply claim, rotation, renewal, and release together.

Coordinator-only SQLite work now requires at least one live claim for a
managed generation, checked again inside its transaction. The new witness
fails on the original claimless stream-position read and checks replay and
index operations too. A read admitted before expiry can still finish
afterward, but the wrapper revalidates before using that result. An expired run now rotates
privately even if it remembers the current head, preserving another run's
ability to claim that cache. The storage and Browser oracles check both sides
of this rule.

An old-generation remote subset release cannot hold up the new generation.
The Browser oracle pauses the old leader's release message while delivering
all new-generation traffic; the new source demand must start first. Rotation
now requests old release without awaiting its acknowledgement. The broadcast
coordinator retains release debt and retries after transport failure. Its
timeout-and-retry behavior remains a direct receiving-oracle gap. Browser,
Node, Expo, and mobile factories now forward the public claim lifetime and
clock options to the core SQLite adapter. The runtime reads the same clock
before accepting a peer notification or scheduling claim renewal; a Browser
real-SQLite receiving history advances that clock and rejects an obsolete
peer row before reloading demanded source data.

One valid expiry cut remains fail-stop under the existing durability law.
If a source transaction becomes public before its SQLite write and the claim
expires before SQLite accepts that write, the receipt rejects and the
Collection enters terminal error. A real-SQLite hostile probe observed the
public row with no durable row. Automatic private rotation covers expiry
detected before source publication; compensating an already-public write
would need a distinct recovery law and publication witness.

The current sync-present wrapper does not expose the local-only
`acceptMutations` utility. Its accepted source writes can nevertheless be
held from publication beneath a persisting optimistic transaction. This
distinction must be preserved in the mutation witness; treating a local-only
Collection as an Electric sync-present tab would exercise the wrong path.

The final oracle review found four more cuts. An acquisition aborted while
the replacement Electric provider session waits for cache rotation must reject
promptly, even when another demand remains active. The descriptor oracle held
rotation and observed the old demand pending before the repair; it now observes
`AbortError`, then a fresh row for the sibling demand. A peer full-reload
notification can enter with a valid claim and finish its SQLite read after
expiry. The persisted oracle checks both a stale row returned by that read and
SQLite's second claim check rejecting it. Both outcomes discard old cache
evidence and reload demanded source data. A still-live claim with an unrelated
read failure remains terminal; expiry recovery must not hide that error.

Cleanup can release the original claim while SQLite rotation is held. If the
rotation then creates a private generation, its returned claim belongs to the
abandoned sync run and must be released as well. A claim-ledger oracle was RED
with the orphan claim and GREEN after the release guard. A separate real-SQLite
oracle exposed a valid eager Collection ID beginning with the internal physical
ID prefix; prefix matching alone wrongly treated it as managed storage. SQLite
now checks catalog membership for claimless access. The same review held the
interval between a managed read's first claim check and collection of its
generation. Passing the claim into registration prevents late DDL from
recreating the collected table. Direct claimless adapter access to a physical
ID after its catalog row has been collected is structurally indistinguishable
from an arbitrary public ID; managed runtime calls always carry a claim.

The full sqlite3 CLI suite exposed another host boundary: its subprocess API
cannot accept a NUL byte in a SQL argument. New physical IDs now use a
CLI-safe prefix. A CLI oracle writes and reads a claimed row through that
driver; the existing subset-failure cases still check their original public
and durable rows after seeding the claimed physical storage. A real-SQLite
control confirms that an eager Collection whose public ID starts with either
prefix remains usable. The internal prefix is only an allocation hint; catalog
membership and a claim decide whether storage is managed.

Two further held-await histories sharpen the lifecycle law. A subset demand
aborted while initial scoped rotation holds the wrapper's apply mutex must
reject promptly without canceling a sibling demand. Electric provider-session
restart has its own abort cut, and cleanup during a held rotation must settle
quietly after rotation returns and release any late claim. The composed
Electric oracle reached the cleanup failure before the repair. It does not
claim prompt cleanup while an uncancelable adapter rotation remains held.

Resume certification also reads SQLite under a claim. A read accepted before
expiry can return a consistent old key set afterward, or SQLite's second claim
check can reject it. The persisted oracle now requires private recovery in
both cases and retains terminal behavior for an unrelated live-claim I/O
failure. A real-SQLite temporary probe confirmed the late consistent result
was possible before the repair. Electric's installed SDK was separately driven
through a managed restart with a held old HTTP snapshot: the late old response
did not enter the new public or durable cache. That witness uses controlled
HTTP and Map storage; native multi-tab and real SQLite delivery remain outside
its scope.

The independent review then found a cold-restart counterexample to the reset
marker rule. Claim-expiry rotation passed no Electric reset metadata to SQLite.
After one demanded subset wrote a partial row, that generation had incompatible
key-set evidence but no resume record. A later cold Collection started a
changes-only stream and hydrated that row before its source snapshot; an empty
authoritative subset snapshot still left the stale row public. A real SQLite
and installed-SDK receiving witness was RED at the pre-response public-row
checkpoint and GREEN after Electric treated an incompatible managed cache as
fresh-source evidence even without a resume record. The new run therefore
rotates and keeps the stale partial row private. An untouched generation with
unknown evidence retains its normal startup path.

A second cold-restart challenge supplied an explicit Electric offset or handle.
Those options bypassed the original fresh-source predicate even though SQLite
reported an incompatible key set, and the stale row became public before the
source replied. The same real-SQLite and installed-SDK oracle now varies absent
and explicit source cursors. Both explicit cases were RED at the pre-response
public-row checkpoint and pass after the managed-cache incompatibility check
was made independent of source cursor selection. An explicit cursor still
controls the Electric stream; it cannot certify rows in an old cache.

The final composed review also exposed an abort-settlement error. The wrapper
raced every returned subset load against its signal, including an uncancelable
SQLite hydration already in progress. It could report `AbortError` before the
late cached rows became visible, allowing core to release an overlapping
replay barrier too early. The persisted Electric interleaving oracle now holds
the cache read, aborts the demand, and records both settlement and public rows
before releasing the read. Fixed and random campaigns were RED because the
load rejected before publication. The repaired wrapper races abort promptly
while startup, cache rotation, or mutex admission can still skip hydration.
Once the adapter starts the baseline read, it waits for its rows and applied
receipts, then reports `AbortError`. A composed follow-up probe also held an
Electric source request after local hydration and confirmed that its own
cooperative abort remains prompt.

The primary persisted owner is
`packages/db-sqlite-persistence-core/tests/persisted-oracle.test.ts`. Its
global-invalidation trace is a hostile control; the real-SQLite owner checks
generation rotation, physical collection, claim expiry, and uncertified
key-set evidence after a partial write. The Browser owner checks a recovering
demand beside an active warm tab and a peer notification delivered to an
expired receiver. The Electric descriptor owner checks restart, and the
installed-SDK owner checks subset-only network work. The remaining limits
above are recorded in the coverage map rather than inferred from green tests.
