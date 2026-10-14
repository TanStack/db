# PR #2134 identity and persisted-key oracle review

**Current evidence, 2026-10-13:** The append-only final reviews below supersede
the earlier scope, calibration counts, proxy-collision premise, and ORC-014
status in this record. They review code heads
`de5d4189bc906cd8375ad174357c027bcfea98cf` and `5239c25c2`.
The earlier sections remain as the history of how the oracle and repair changed.

Reviewed PR head: `5e224075f`. Semantic repair: `9092cbf26`, 2026-10-13.
The initial record correction changed no production code or executable oracle.
The review supplied a ref-proxy identity collision, a persisted key change,
and gaps in both oracle owners. The [coverage map](../oracle-coverage.md)
records their bounded owners.

## Laws and owners

The IR identity law requires equal keys only when expressions have the same
evaluation for every legal row in the claimed value domain. A reference proxy
inside an IN list is a literal runtime object; it is not a row reference.
Distinct byte arrays with equal contents compare equally. The
`ir-stable-identity-oracle.test.ts` owner tests these through evaluation and
public identity functions.

The Query Collection retention law requires a successful revalidation to
replace the old logical demand's row ownership. A failed fetch cannot retire
it. The `ownership-lifecycle.oracle.test.ts` owner models row-to-demand edges
and observes public rows, durable rows, exact owner IDs, and retention markers
after application. Its historical key is a fixed pre-PR serialized fixture,
not a value computed by the new encoder. The production path uses a real
QueryClient and a controlled persistence adapter.

## Why green oracles missed the cases

The identity owner previously covered singleton primitive IN values and a
byte-array case using the same instance on both sides. Its input grammar did
not include separately created literal reference proxies with the same path
inside `Value` operands, or separately created byte arrays with equal contents
at the evaluator checkpoint. The repaired oracle crosses two operators (`eq`,
`in`) with two proxy paths (`value`, `other`). In each of these four cases, a
row containing the first proxy matches that proxy and does not match the
distinct second proxy, yet the original path-based literal encoder gave the
two predicates the same identity. The old canonicalizer fails the key
comparison in this matrix.

The initially reported builder pair, `inArray(a, [b])` versus `eq(a, b)`,
does evaluate differently: `b` is a literal object inside the IN list and a
row reference in EQ. It did **not** have the same identity at the reviewed PR
head, so it is not a RED collision witness. The oracle retains this pair as a
semantic boundary check. The collision witness above uses two *literal*
proxies of equal path in separate `Value` operands.

The ownership owner generated current-format hashes for both the persisted
seed and the reacquisition. It could not reach a cold row and retention marker
written under the previous singleton-IN key. The initial failure was absent
history grammar, not a wrong ownership model or a weak settled-row assertion.

## Calibration and observations

- Before the migration repair, the sole-owner and shared-row old-key histories
  failed at their post-application comparison. The old marker and owner
  remained, and the sole-owner stale row remained public and durable after an
  empty provider result. The same-version control histories use the current
  hash and pass.
- The repaired four-case matrix crosses old/current keys with sole/shared
  ownership. A nonempty result transfers the old owner to the current key;
  unloading records only the current retention marker. An EQ-first demand
  followed by singleton IN reaches the same physical Query and revalidates
  the old owner. A failed provider fetch leaves the old row, owner, and marker.
- An independent oracle-review agent verified the historical key against the
  previous encoder, challenged the peer-owner premise, and ran a hostile
  mutant that removed only legacy-marker deletion. Both old-key empty cases
  rejected that mutant at the marker comparison; same-version controls passed.
  The agent also found avoidable double encoding on nonpersisted requests;
  the final gate requires persisted metadata.
- After repair, the full Query DB package suite passed 534 tests and the IR
  identity suite passed 69. Both package builds and changed-file ESLint passed.
  These are bounded executed checks, not a proof for every query expression
  or adapter.

## ORC-001–014 audit of these extensions

This audit concerns the new identity and historical-owner witnesses, not every
older property in the two large oracle files. `A` means applicable; `N/A`
names a trigger absent from these extensions. An unresolved item is not
silently counted as a pass.

| Requirement | Outcome and evidence |
| --- | --- |
| ORC-001 authority and limits | **A, met.** The identity law follows the exact-demand request-collapsing contract in the TanStack DB 0.5 post and `live/ARCHITECTURE.md`; Query Collection docs make exact subset keys the cache identity. The ownership law preserves a demand's row claim through persisted revalidation. Both oracle comments and the scope below bound the claim. |
| ORC-002 independent judgment | **A, met for the tested domain.** The proxy reference rule is `Object.is`, and the byte-array rule uses equal bytes, independently of the key encoder. The ownership reference is a row-to-demand edge graph; the historical key is fixed old bytes, not computed by the current encoder. The real compiler and Query Collection are the production drivers. |
| ORC-003 literate responsibilities | **A, met for these extensions.** The identity oracle explains its finite value grammar beside evaluation and key comparisons. The ownership oracle explains old/current owner edges, controlled cold storage, the real QueryClient path, public and durable observations, and the post-application checkpoint beside the cases. |
| ORC-004 generated grammar controls | **N/A.** The new four-case operator/path matrix and ownership histories are bounded fixed enumerations, not generated properties claiming an open grammar. Their dimensions and omissions are stated below. |
| ORC-005 production path and observation | **A, met within the controlled boundary.** The identity tests call the real compiler and public key/hash functions. The ownership tests reacquire through a real QueryClient and Query Collection, then compare public rows, durable rows, exact owner IDs, and markers after application. No earlier readiness claim is made. |
| ORC-006 checker calibration | **A, met.** The original literal-proxy encoder fails the four-case identity matrix at key comparison. The pre-migration implementation fails old-key empty histories at public-row, owner, and marker comparisons. A marker-deletion mutant reaches the intended checkpoint and fails the old-key marker assertion; it is an assertion kill, not a timeout or setup failure. |
| ORC-007 fixed/random replay | **N/A.** These extensions add no important generated property. Existing generated identity campaigns are outside this audit. |
| ORC-008 state minimality | **A, met.** The ownership graph keeps old and current owner IDs distinct: successful revalidation retires the old edge and installs the current one, while failure preserves the old edge. A peer edge remains after the singleton edge retires. These next actions distinguish the states. |
| ORC-009 vocabulary mapping | **A, met.** A model edge is one persisted `queryCollection.owners[queryHash]` claim; a retention marker is separate collection metadata. The fixed old hash and current hash identify two encodings of one logical demand, not two physical acquisitions. |
| ORC-010 failure fidelity and cleanup | **A, partly evidenced.** The identity cases need no resource cleanup. The Query DB harness releases all registered resources with `Promise.allSettled` and aggregates cleanup errors. A simultaneous assertion-plus-cleanup failure was not injected for these new histories, so preservation of both diagnostics remains uncalibrated. |
| ORC-011 second formulation | **N/A for a new formulation.** The review identified the original proxy-path collision and missing value classes, rather than a named fault shared by the independent reference and production that requires a second semantic formulation. The real evaluator versus `Object.is` and byte-content expectations already separates result semantics from key encoding for the tested values. Broader runtime values remain open. |
| ORC-012 review and closure | **A, met as a bounded audit.** This table records every ID. Contract × history × path × observation is exact identity over the stated values and retained primitive singleton-IN ownership after cold revalidation through Query Collection, observed at evaluation/key comparison and post-application rows/metadata. The original and adjacent witnesses and wrong-design kills are above; unresolved cells and owners are below and in the coverage map. This record does not claim universal bug-class closure. |
| ORC-013 boundary witnesses | **A, met within the finite domain.** Non-null singleton IN and EQ share a key; nullish members and distinct opaque literals distinguish overbroad normalization. The four proxy cases reject path-only literal identity. Old/current keys with sole/shared owners distinguish migration from stale-owner retention or peer deletion. |
| ORC-014 controlled-premise handoff | **A, unresolved for real SQLite.** The ownership fixture supplies a historical row, owner hash, and retention marker to controlled storage. No real SQLite upgrade/restart witness supplies that same premise yet. The coverage map assigns this receiving gap to Query DB ownership and SQLite persistence; this record cites only the controlled Query Collection boundary. |

## Scope and remaining work

Migration is checked for a static on-demand key, primitive literal singleton
IN, an old retained marker, empty or surviving source results, one shared
peer, and one EQ-first acquisition order. The controlled adapter represents
the Query Collection boundary; the joined-demand test separately establishes
that a one-key join emits the same IN demand shape. Real SQLite upgrade,
custom query-key functions, TTL expiry, nested predicates, and arbitrary
overlapping application schedules still need receiving witnesses.

Historical reference-proxy keys cannot be reconstructed safely. The old
encoder represented a literal proxy as a row path and could collide with a
valid row-reference query. The independent reviewer compared that old key
with the repaired encoder's legacy output and found them different. Current
object-valued identities also carry a
per-runtime nonce and cannot identify the same object after a cold restart.
An old `until-revalidated` marker in those classes can remain indefinitely.
Any broad invalidation or cache-format policy needs a separate contract
decision and an oracle for that decision.

The repair location was production code for the accepted ownership law and
oracle history grammar for the missed upgrade path. The proxy ambiguity is a
contract and cache-policy question, not an assertion to silently relax.

## Final review of `de5d4189b`

The exact ref-proxy collision asserted in the external review was false on the
reviewed head: literal `inArray(a, [b])` retains a `val` wrapper, whereas
`eq(a, b)` uses a row reference. The first three of four original
joined-demand tests passed on `origin/main`; only direct equality followed by
a singleton join failed there. The real identity defect was narrower and
different: separately created literal reference proxies with the same path
had the same key while the evaluator distinguished them. The repaired identity
oracle compares independently created proxies and equal-content, distinct
byte arrays at evaluation and identity checkpoints. The exact direct/join
acquisition matrix checks both orders, each first-owner release, one provider
request, and surviving public rows. Removing the singleton equivalence in a
hostile mutant made those receiving tests fail at provider count.

The persisted-owner law is now exercised across a cold key-format change. A
fixed historical serialized key supplies the old owner; the current encoder
does not compute that premise. The model tracks old and current owner edges
separately. Its grammar crosses old/current keys, equality/membership
reacquisition, retained markers present/absent, sole/shared rows, and
empty/surviving/failed provider results. It compares public rows, durable
rows, exact owner IDs, and retention markers before and after application.
An empty successful result retires every equivalent historical owner, while
a failed fetch preserves it. Two distinct nested old keys that converge on
one current key must both retire. A malformed same-prefix key remains foreign;
removing the parser's extra-field guard in an isolated mutant failed at the
durable row, owner, and marker assertions.

A warm current-key Query result cannot stand in for revalidation of an old
owner. A held provider result leaves that owner and marker intact until
application, and two equal acquisitions share one physical fetch. The
pre-repair warm-cache gate made a second provider request; the corrected
oracle caught it at the call-count checkpoint. Releasing one peer leaves the
other's pending revalidation and eventual row ownership intact. After final
unload, a new acquisition starts new work. A separate public LiveQuery
preload/cleanup/remount witness checks that the retired preload rejects with
`AbortError` before either endpoint settles, and the remount waits for its
fresh result. This witness uses a provider that consumes `context.signal`;
the raw internal `_sync.loadSubset` settlement is not a public claim here.

The finite-TTL witness compares a historical owner with a current-key control:
after failed revalidation and final unload, each renews to the configured
deadline, retains its row before that deadline, and expires at it. A real
file-backed SQLite restart matrix supplies the historical owner through
durable storage and checks markerless interruption, shared rows, and a warm
current cache with a different matching row. This closes the earlier ORC-014
receiving gap for these exact histories. The pre-repair marker-gated path left
a markerless old owner durable after a successful empty fetch. A separate
empty historical proxy-demand witness retires ambiguous old EQ and IN markers
after a matching proxy demand applies, preserves them on fetch failure, and
leaves them alone for a genuine row-reference demand. The old encoder
distinguished literal proxies from row references but collapsed distinct
literal proxies with the same path. The accepted policy retires such an
ambiguous old key after matching revalidation; it can discard an old owner of
a different same-path proxy. No legal proxy-owned-row restart history has
been established, so that migration case is outside the claim.

The implementing agent ran 70 identity-oracle tests, 570 ownership tests, and
121 related lifecycle/direct-write tests, with build, type, lint, and diff
checks passing. An independent oracle reviewer reran 70 identity and 375
ownership runtime tests on this head, confirmed the SQLite and finite-TTL
checkpoints, and found no reachable counterexample inside the finite grammar.
These runs and the mutants calibrate the named laws; they are not a universal
proof for arbitrary predicates, adapters, or schedules.

### Final ORC-001–014 disposition and limits

The identity and ownership laws and their limits are stated next to independent
evaluation and owner-edge models (ORC-001–003, ORC-009). Fixed, bounded
operator/value and upgrade histories are used; no generated campaign or
shrinker is claimed (ORC-004, ORC-007). Real QueryClient, Query Collection,
LiveQuery, and SQLite paths reach the named public and durable checkpoints
(ORC-005). Original-code failures and hostile mutants reached assertions,
including provider count and malformed-key owner/marker comparisons
(ORC-006). Distinct old/current edges remain necessary until application or
expiry (ORC-008). Cleanup aggregates normal test failures, but no injected
simultaneous assertion-plus-cleanup fault was checked (ORC-010). Evaluator
results, literal reference identity, fixed old serialized bytes, and a real
SQLite restart give independent formulations of the checked premises
(ORC-002, ORC-011, ORC-014). The finite matrix distinguishes nullish and
non-null singleton members, proxy values, equal-content byte arrays,
acquisition order, ownership overlap, warm cache, and failure (ORC-012–013).

Custom query-key functions, other key-format changes, arbitrary nested
values, legal proxy-owned rows after cold restart, signal-ignoring public
remount, and overlapping expiry with alias discovery need separate receiving
witnesses. One metadata scan is requested per sync run, but SQLite still
decodes row values, and later eligible demands parse candidate owner and
marker hashes. The current bound is roughly
`O(demands × (owners + markers))` parsing work; no latency budget is proved.
If an old finite-TTL marker meets a new `persistedGcTime: Infinity` setting
after failed revalidation, the old deadline remains binding. Whether the new
setting should extend that historical owner is an unresolved cross-version
retention-policy decision, not a confirmed implementation defect. These
remaining cells are owned by the Query Collection ownership oracle and its
SQLite receiving path in the coverage map.

## Full-source handoff follow-up at `5239c25c2`

The accepted on-demand ownership rule assigns an absence claim to its Query
scope. A complete, applied full-source result therefore does not silently
retire an old filtered owner. The new fixed history keeps the full Query active
with an unrelated `detail` row, while a historical singleton-filtered owner
retains `shared`. It crosses retention marker present/absent; the latter is a
legal interrupted-unload state. After the filtered demand loads, its public
row has retired at the immediate applied-settlement cut, and durable rows,
exact owners, and markers agree after persistence settles. The full-source
row keeps its exact owner. The oracle permits either an exact filtered fetch
or safe reconciliation from the applied full result; it does not require a
provider call count for this handoff.

Both variants passed on #2134 alone and in a scratch merge with #2135 head
`d429e0dd8`. An independent oracle-review agent confirmed the law, model
independence, and immediate checkpoint, then ran both revised variants with no
type errors. Two isolated mutants calibrated the merged path. Removing
historical pending revalidation from the full-source reuse gate left `shared`
public after the filtered load settled in both variants. Discovering old
aliases from retention markers alone failed the markerless variant at that same
assertion while the marked control passed. Both mutants were restored; neither
was committed. This closes the identified cross-PR handoff for static keys,
one applied full result, and these two durable metadata shapes. Concurrent
cache rotation, another Collection's shared Query, and custom query-key
functions remain outside this witness. The #2135 guide and changeset clarify
that a retained persisted scope uses an exact request under the current
implementation; that provider-work choice is not an oracle requirement.

## Historical window identity review at `bd6ac95d3`

An independent reviewer attacked the migration parser with four one-field
mutants. Before this follow-up, dropping a historical `limit`, `offset`,
`orderBy`, or `cursor` left all 70 identity-oracle tests green. Each edit could
collapse distinct old window keys. The revised fixed-key comparison rejects
all four mutants at the normalized-key assertion; the unmodified parser passes.
The order witness uses a typed direction and null placement. These assertions
test persisted bytes from the previous encoder, not a second call to the
normalizer to construct the expected key.

The ownership oracle now drives a historical limit-1 owner through the real
persisted Query Collection path. An unrelated limit-2 empty result leaves its
durable row, owner, and marker intact. The matching limit-1 result retires
them at applied settlement. The unmodified path passes. In an isolated scratch
checkout, dropping `limit` from the legacy parser left the stale durable row
after the matching request, so this receiving check rejects the mutant at its
row assertion. The storage fixture supports a fixed-order finite prefix for
this witness. Offset, ordering, and cursor migration have key-level checks but
still need durable receiving histories; arbitrary old key shapes remain outside
the finite grammar.

## Independent design attack after `77b43ecc4`

The initial ownership oracle missed two boundaries. A marker for the old
literal-proxy path `other` must survive successful revalidation of `category`.
A path-erasing matcher mutant passed all 378 prior ownership tests; the new
two-path durable-marker witness rejects it at the metadata comparison. The
four-case public preload history also shows that releasing the creator of a
shared equality/singleton-IN fetch aborts its surviving peer on `77b43ecc4`.
The original implementation fails both creator-release cases at the survivor's
preload; the other two cases pass. A primary ownership-oracle witness now
crosses the same two-owner release order and checks the surviving public row.

A proposed lazy physical-Query metadata signal made the four shared-fetch
cases pass, but it broke a separate legal history. A sole public
`requestSnapshot({ where, signal })` may abort its caller signal before the
owner calls `releaseSnapshot`. Core retains that acquisition and marks its
signal aborted. With the proposed physical signal, the provider still sees a
live signal and can publish a late row after caller cancellation. The original
code passes the sole-abort signal check, but another scratch history shows
that an ignoring provider can still publish a late row on that original code.
The prototype fails the signal and public-row checkpoints. Two Collections
sharing one Query also reproduce premature metadata abort on the original
code when the creator cleans up. A retry after the first fetch aborts can restore the survivor's
rows, but the architecture also requires already-shared work to remain alive
while another owner needs it. The retry does not meet that work law.

The signal repair is **open**. A compatible design must cover sole abort while
owned, first-owner release with a surviving peer, final release, late peer
arrival, and shared Queries across Collections. No composite owner-aware
signal has passed that grammar. The physical-signal code and related docs in
the local worktree are an uncommitted prototype and must not be published as
the completed #2134 repair.

The local primary oracle now drives a filtered public `requestSnapshot` with a
caller signal through abort while its acquisition lease remains retained. It
captures the load result and waits for settlement. The provider reads both the
metadata and Query Core signals but ignores cancellation and returns a late
row. On the physical-signal prototype, the comparison fails with
`{ aborted: false, outcome: 'fulfilled', publicRow: true }` instead of
`{ aborted: true, outcome: 'AbortError', publicRow: false }`. On the original
code, a separate scratch probe observed
the signal abort but still found the late public row. Query Core may keep the
result in cache; the sync adapter must not install request-scoped rows after
cancellation. This follows the adapter signal contract in `types.ts` and the
stale-demand law in the live-query architecture. The provider's refusal to
cancel does not grant it Collection row ownership.

An independent reviewer found a false-green route in that sole-abort witness:
an isolated mutant discarded the late provider row but fulfilled the aborted
load as an empty baseline. The prior signal and row checks passed. The
load-subset transaction refinement oracle requires `AbortError` at every
adapter cut of an aborted load, including before a write. Adding the caller
outcome to the same post-provider comparison rejects that mutant at settlement.
The local physical-signal prototype fails all three observations together:
the metadata signal stays live, the load fulfills, and the row becomes public.

A second public history creates two source Collections backed by one QueryClient
and one physical Query. It proves that both Query observers have joined before
the first source's live query retires, then requires the original provider
signal to remain live, one provider call total, and the surviving live query
to receive the row. The physical-signal prototype passes this bounded case;
the original first-owner signal behavior failed an isolated cross-Collection
probe. Explicit cleanup of the first source Collection is outside this witness
because that API can cancel shared Query keys. A late peer after sole abort and
two separately aborted logical signals were the next boundaries. The
primary oracle now crosses one or both public snapshot callers aborting while
their acquisition leases remain retained. One signal-ignoring provider response
serves the physical Query. The both-aborted branch requires two `AbortError`
outcomes and no public row; the local physical-signal prototype instead
fulfills both and publishes the row. The targeted runtime check fails at the
combined outcome and row comparison with no type errors. A peer that arrives
after sole abort still needs a public receiving history before an owner-aware
composite can claim closure.

## Owner-aware cancellation repair after the design attack

The repair represents each logical load as an acquisition separate from the
shared Query observer. Its caller signal determines that caller's outcome and
whether its rows may be published. A physical Query fetch has one provider
signal across Collections. An active eager or independent Query Core observer
can also own that fetch. Its signal aborts when the final live owner leaves.
A provider that ignores cancellation may finish into Query Core's private
cache; an ownerless result cannot enter Collection rows. After ordinary unload,
a fast remount can reuse that cached result. After an aborted caller retains
its lease, a successor starts fresh work instead of adopting the canceled fetch.

The primary ownership oracle adds three receiving histories. A held
persisted-owner metadata scan followed by caller abort must reject with
`AbortError` without starting a provider request or changing the old durable
row, owner, or marker. Before the repair, releasing the scan started the
provider. A successor arriving after sole abort but before the old provider
settles must start a second fetch; the first response cannot settle the
successor or become public. Before the repair, only one fetch started. A fetch
started by a caller without a signal must still expose a physical provider
signal when a signal-bearing peer joins. That signal survives creator release
and aborts when the peer aborts; an ignored late response remains private.
Before the last wrapper correction, the provider signal was `undefined` at the
first checkpoint. Each history failed at its named checkpoint before its code
change and passed afterward, with type checking enabled.

Together with the earlier sole-abort, two-caller, four live-query release
orders, and two-Collection shared-Query histories, these witnesses exercise
the owner-set rule across caller abort, lease release, metadata suspension,
and late succession. The acceptance comparison uses caller outcomes, provider
signal state and call count, public rows, and durable ownership at specified
settlement cuts. The model is the set of live logical owners; it does not
derive expected rows from Query Core's observer or cache state. The repair
removes redundant acquisition flags and uses set membership and physical
Query association as its two lifecycle facts. Its remaining state tracks
logical callers and physical fetches, which Query Core's observer refcount
does not represent.

The evidence does not cover every schedule. A later receiving history drives
source Collection cleanup while another Collection retains the same physical
Query, using one static key and the same query function. Custom query-key
functions and shared Queries with different query functions remain open.

## Metadata signal and external Query Core ownership boundary

The five demand-identity forms in `load-subset-lifecycle-oracle.test.ts` used
an exact comparison of every `loadSubsetOptions` property. It treated absent
`signal` as part of immutable demand identity because the fixture's direct
calls did not supply a caller signal. That was a fixture assumption, not the
documented demand-key law. The revised oracle asserts that each on-demand
provider call receives a live native physical signal as an own data property,
then compares every
remaining request field, query call count, public row, and owner transition.
This retains the identity law while checking the provider signal separately.
The Query Collection guide and live-query architecture now state the physical
signal contract, including a no-signal creator.

An outside Query Core observer can retain a Query after its final Query
Collection acquisition unloads, or while an aborted caller still holds a
lease. A three-case ownership history holds an explicit external refetch after
a no-signal creator, an aborted-and-unloaded creator, and an
aborted-but-retained creator. At the provider boundary,
`meta.loadSubsetOptions.signal` must be a live Query Core signal; after the
held response, the Query cache must contain its new row and have idle fetch
status. Before the external-path repair, metadata signal was absent in the
first case and inherited the aborted creator signal in the second. The
acquisition-count gate failed the retained case: it started a physical
controller and immediately aborted it because no caller was live. A hostile
mutant that starts an owner-driven physical signal with zero acquisitions
failed the live-signal check with no type errors. The repaired no-live-owner path
passes Query Core's signal as a native metadata data property and leaves its
transport under Query Core ownership. This history does not promise public
Collection rows without a logical acquisition.

A getter that returns the same native signal passed the earlier two oracle
files (444 tests) even though the Query Collection guide promises a data
property. The provider-boundary assertions now inspect the own `signal`
descriptor for acquisition-driven demand forms and external refetch forms.
They require the descriptor's `value` to be the live signal and its `get` to be
absent; they do not constrain writable or configurable flags. The getter
mutant was executed on the later review cut and failed at those descriptor
assertions, demonstrating that the provider-boundary oracle kills this shape
of contract violation.

An active Collection-origin physical fetch can also gain an independent Query
Core observer before the Collection caller aborts. The new oracle witness
first checks two distinct QueryObserver identities and one provider call. It
then aborts the Collection caller. Before repair, the provider signal aborted
at that checkpoint even though the outside observer still owned the work.
After repair, the outside observer receives the row through Query Core while
the Collection stays rowless. This separates the physical owner set from
Collection row ownership. A second witness lets that outside observer leave
while the canceled Collection lease remains. Before the observer-removal hook,
the provider signal stayed live with no owner; after repair it aborts at that
checkpoint. A provider that ignores this abort may still update Query cache,
but it cannot publish the ownerless row. The two witnesses passed with the
repair along with all 1,406 tests in the package-local Query DB suite's 40
test files. A subsequent Collection-cleanup witness checked that cleaning up
source A preserves source B's shared physical fetch, signal, and public row
with one provider call. The full package-local suite then passed 1,408 tests
in 40 files without type errors. The React pagination and hydration pair
passed 100 tests before that final oracle-only addition.

The raw historical-owner reacquisition history initially required F2 to start
before the ignored-abort F1 provider promise settled, then still required F2
after F1 settled. Neither call count is a product law: ordinary unload may let
an ignored-abort F1 finish into Query cache for the successor. The revised
history checks that the successor remains pending and the old owner stays
durable before any applicable response. It then accepts either F1's distinct
fresh row or F2's empty result, but requires the public row, Query cache,
durable row, current owner, and retired historical marker to agree. The public
preload history retains the F2-specific route because Query Core cancels F1
when the provider reads `ctx.signal` and its final live owner retires.

The cancellation guide now distinguishes eager `ctx.signal` from on-demand
`ctx.meta.loadSubsetOptions.signal`. Both on-demand pagination examples pass
the latter signal to their provider or cursor pager.

An external review found a separate persisted-wrapper caller-settlement bug
after a historical owner unloaded. A's caller signal aborted after F1 started,
F1's provider rejected on its physical signal, and A unloaded while B acquired
the same predicate. B applied an empty F2 result and retired the historical
owner, but A's load incorrectly fulfilled. The primary Query Collection
ownership oracle now records A's `AbortError`, B's successful load, public
empty rows, and retired durable row and marker. It checks A's rejection while
B's replacement result remains held. The persisted-wrapper oracle
crosses the same post-source-entry cut with an independent source: abort then
unload must reject, while direct unload without a signal may suppress a late
upstream error. Its controlled source rejects after unload in all cases; the
Query Collection witness covers a provider that rejects on physical abort.
Both paths leave a later subset load usable. The old unconditional suppression
failed both new abort witnesses at the caller-outcome assertion, while the
direct unload control passed. The repair makes release suppression conditional
on the caller signal remaining live. `@tanstack/db-sqlite-persistence-core`
receives its own patch changeset; no Query Collection map deletion or source
proxy-import change is involved.

After rebuilding `@tanstack/db`, the Query DB package suite passed 1,410 tests
in 40 files with no type errors. The persistence-core suite passed 1,568 tests
in 27 files with two existing todo cases and no type errors. Literal-proxy
identity tests intentionally import the built `@tanstack/db` module because
the Query Collection test runtime also uses that build. A source-only mutant
run without rebuilding is not evidence of an oracle survivor.

A fresh oracle review found that an aborted load with a custom signal reason
returned that raw `Error` instead of `AbortError`. The new persistence case
reached the same post-source-entry, abort, unload, and upstream-rejection
checkpoint and failed with `Error` on the first repair. The wrapper now creates
`LoadSubsetOperationAbortedError` at its load-settlement boundary. The
admission waiter's internal rejection still passes through that boundary. The
three-case matrix passes with type checking. A direct unload
without a signal remains the control; Collection subscription release aborts
its generated acquisition signal before adapter unload, so that control does
not claim public release fulfillment.

A proposed mid-history assertion that the historical row stays public while
B's replacement result is held failed in the current implementation. It is not
part of the accepted on-demand law: the Query Collection guide promises
continuous public visibility while a loaded subset owns the row, and the cold
historical-owner oracle starts with a durable owner but no public row. A's last
loaded subset has unloaded before B starts. The witness therefore preserves
the historical durable owner and marker until B applies, without requiring an
intermediate public row.

Query Core notifies observers before cache listeners. A distinct observer can
start F2 synchronously while F1's reverted cancellation is still notifying.
The held replacement witness reaches that order and checks F2's live provider
signal before releasing its response, then its public row and Query cache.
Before the terminal-event guard, F1's old `setState(idle)` notification aborted
F2's controller. The guard compares the Query's current fetch status with the
old event before aborting a controller or retiring fetch-application records;
the witness now passes. The same guard applies to old error notifications.

The external-success successor schedule revealed another missing history. A
caller loaded v1, aborted while retaining its lease, and an independent Query
Core observer fetched v2 with no live Collection owner. Only after F2 had
settled did a new caller acquire the same fresh Query. The old oracle acquired
that caller before F2 settled. Before repair, `unpatchedCacheVersions` treated
the fetched v2 as a local cache edit and started F3; the probe's rejecting F3
made the caller fail while Query cache held v2. Removing that marker stopped F3
but left a false success: the still-subscribed Collection handler had declined
v2 when it had no owner, and the caller returned the old v1 settlement. The
primary ownership oracle now checks the post-F2 acquisition cut, provider
call count, public row, and Query cache. Reacquisition replays a current fetched
result only when it has no result-specific application settlement, then waits
for that application's settlement. With infinite stale time and no
intervening edit, the caller applies v2 without F3.

The ordinary-unload witness's two-call assertion is specific to a provider
that rejected after honoring F1's abort: its new caller needs fresh work.
The accepted contract also permits an ignored-abort F1 result to remain in
cache after full release; it does not require every such successor to make or
avoid a particular number of provider calls.

The production diff adds 389 lines and removes 46 in `query.ts` at this review
cut; tests and contract prose are counted separately. The persistent facts
serve different observable boundaries:

- `acquisitionsByHash` distinguishes same-key callers and their release order.
  A logical caller can abort while the Query observer stays subscribed.
- Each acquisition's `physicalQuery` and the shared
  `queryCollectionPhysicalAcquisitions` set identify the live callers of one
  Query across Collections. A logical hash alone cannot represent that sharing.
- `queryCollectionPhysicalFetchControllers` supplies one provider signal for
  Collection-origin work. It must be separate from each caller's signal and
  Query Core's external-fetch signal.
- `queryCollectionObserverModes` distinguishes eager Collection ownership from
  an on-demand observer whose acquisition has aborted, and from an independent
  Query Core observer. Observer count alone merges these cases.
- `queryCollectionFetchStartedWithOwner` remembers the current fetch origin.
  A paused old Collection fetch and a later external Query Core refetch require
  different signal and restart decisions even when their current observers are
  the same.

The two recovery paths have different premises. A retained canceled lease
cannot pass its old result to a successor, so that path cancels and restarts.
After ordinary unload, an ignored-abort result may still be used; only the
old Query's actual fetch rejection starts one retry. The retry checks that the
rejection is the Query's current error, so an application failure remains a
failure. A fresh oracle review should challenge this code weight and each
state distinction before closure.

## Premerge Collection cleanup and outside-observer handoff (Query Core 5.90.20)

The accepted signal law follows the Query Collection cancellation guide and
the acquisition/transport distinction in the project glossary. Collection
cleanup releases its own acquisition leases. An independent Query Core observer
can keep the same physical fetch alive, so its provider metadata signal stays
live until the last physical owner leaves or Query Core terminates that fetch.
The cleaned-up Collection cannot apply the late result. A later outside-only
refetch uses Query Core's signal, not the former Collection fetch's controller.

The prior ownership histories stopped at final subset unload or cleaned up one
Collection while another Collection still owned the Query. They did not end the
*last* Collection sync run with a held provider response and an independent
Query Core observer. The production cache listener was removed at that cut,
leaving no observer-removal notification to abort the private provider signal.
The new ownership histories hold the response across cleanup, release one or
the final outside observer, cancel or remove the Query, and replace F1 with a
different outside query function while F2 remains held. They observe the
provider signal before response settlement, the retired load's outcome, public
rows, and, for a historical owner, durable row/owner/marker metadata after the
late cache result. The persisted-baseline load may settle `ready` at cleanup;
its late result still has no authority to change that Collection's rows or
durable owner. This is a bounded result for that fixture, not a general claim
that every canceled load fulfills.

Query Core's silent, nonreverting cancellation emits no QueryCache event in the
installed 5.90.20 version. The owner now observes the current physical Query
promise's `CancelledError` without reading Query Core's lazy signal. A
temporary QueryCache listener handles the remaining outside-observer release
and Query removal after Collection cleanup, and releases itself when its
controller aborts or its fetch settles. The listener belongs to the held F1;
it does not abort a replacement F2. The installed Query Core behavior permits
an abort-ignoring provider whose `context.signal` was never read to populate
Query cache after Collection cleanup; the oracle's rowless-Collection check is
the product boundary, while its cache assertion characterizes that specific
controlled provider path.

Calibration used frozen pre-repair diff
`7c7f2dd6d9902e611ceadbd5da593167e0a58a5e3b5d41bfb26415a7976495a1e0bffeba2f9`.
Before the handoff repair, the held outside-observer history failed because
the provider signal remained live after final release. On the frozen diff,
the silent-cancellation history failed with Query
Core's signal aborted and the provider signal live. A neighboring active
Collection history exposed the same missing notification. The distinct
outside-query-function replacement history caught an additional leak: after
F1 was canceled and F2 started, one temporary cache listener remained until a
later cache event. Removing the controller's abort-listener cleanup as a
hostile mutant reproduced that leak at the held-F2 listener-count assertion;
restoring it yielded zero. These failures reached the intended signal or
listener checkpoint, not a setup timeout.

The full Query DB run passed 891 runtime and 538 type tests in 20 files each,
for 1,429 tests in 40 files. A separate TypeScript check passed on the repaired
worktree. The coverage map records the exercised boundaries.
Other Query Core versions, custom query functions beyond the replacement
history, and arbitrary cleanup/refetch schedules remain outside this claim.

### Reentrant success and terminal durability follow-up

Fresh code and oracle reviewers examined full diff
`d96fb6256d40053510668f69525a33a561db2dc18d237806fa18a906c1ec7f61`
against base `5dec299528c02bac3d462d2a83f39905ac2f80be`. The code reviewer
reproduced a held F1 succeeding after cleanup while an outside observer's
synchronous success callback started held F2. Query Core called the observer
before its cache listener. The handoff listener inspected the shared Query's
current `fetchStatus`, saw F2 fetching, and stayed subscribed until F2 ended.
The earlier replacement test canceled F1; its promise-rejection path detached
the listener, so it did not cover successful reentry.

The new ownership history drives that exact order through a real QueryClient,
holds F2, and compares the temporary listener count while F2 is pending. It
failed on the reviewed implementation with one retained listener and no type
errors. The repair attaches detachment to F1's captured Query promise, rather
than the shared Query's later state. The focused history then passed. The full
suite exposed a second issue in the repair: a promise settlement and cache
event could both call `stop`, making the instrumented unsubscribe count `-1`
in the preexisting replacement history. An idempotent `stop` repaired that
double release; the full Query DB run passed 1,431 tests in 40 files, including
type tests.

The oracle reviewer found that the historical late-result test previously
compared durable state after observing Query cache data. Query Core writes
cache data before observer notification and fetch settlement, so that cut
could miss later Collection application. The revised history awaits F1's
physical promise, the outside observer's successful result, and QueryCache's
nonmanual success event. It then lets the event's queued application work
enter the controlled persistence adapter, awaits every started commit, and
compares the number of commits after cleanup with public rows, durable row,
exact historical owner, and retention marker. This reaches the terminal
Query/observer and known-adapter-write boundary for the exercised history.
No separate delayed late-application mutant was executed, so arbitrary later
timer-scheduled work remains outside this calibration.

For ORC-012, the current executable code/test delta from base
`5dec299528c02bac3d462d2a83f39905ac2f80be` is identified by SHA-256
`b4a458827864acd7dda61dbdb8d934e9bdca043928145519df47bf47fcec1ae0`
over `git diff --binary -- packages/query-db-collection/src/query.ts
packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`.
This excludes the review record itself so its identifier does not change when
the record is appended. The new F1-success history has a RED listener-count
failure and a GREEN repair at the held-F2 checkpoint; the historical durable
assertion has a later terminal checkpoint but no independent late-write mutant
kill. These are bounded claims, not universal cleanup-schedule coverage.

## Integration with Query Core fetch attribution and PR #2143

The merge with #2143 at `8048b906bc8b31e976b53d9030ac381a8eb77f2a`
replaced the earlier physical-acquisition implementation described above with
sequence-scoped physical fetch operations. The preceding results remain an
audit of earlier review cuts; the integrated tests use Query Core attribution
source `877655c66`, whose `fetchCancelled` event identifies even a silent
nonreverting cancellation. The published 5.90.20 package lacks that API, so
the current peer range does not yet describe a runnable released combination.

The integration restored the cleanup/outside-observer histories, including
held F1 success that starts outside F2 synchronously, and the same-turn eager
F1/outside-F2 signal witness. All 13 restored cases passed. A separate eager
behavior invokes F1's query function before Query Core installs its retryer.
On the merged pre-repair code, silent cancellation aborted F1's metadata
signal but a later acquisition never invoked F2; the test failed at its second
provider-call checkpoint. Recording Core cancellation on F1's physical
operation makes that caller start F2 and apply its row. The same-turn outside
F2 witness remains green, so F1's cancellation does not abort its successor.

Startup retention maintenance exposed a separate pending-token ownership gap.
The old completion could delete a new pending set when the same options object
was released and acquired again before maintenance settled. The new history
requires the first caller's `AbortError` and the second caller's applied row.
A mutant that deletes the map entry without checking its set identity failed
at the second caller's outcome (`AbortError` instead of `ready`); the repaired
path passes. The literal-proxy tests now import the same DB source instance as
Query Collection, removing a cross-copy test artifact from the earlier setup.

The integrated Query DB runtime suite passed 1,029 tests in 20 files, and the
package typecheck passed, both against the attribution source. The executable
source/test diff from #2143 head hashes to SHA-256
`008e8d39e808eb66e32e0c7cb6c5076c016920f9cfb85dfdf85da04cd851671e`.
These checks cover the named static-key, Query Core observer, and controlled
persistence histories; they do not establish arbitrary custom behaviors or a
published Query Core integration.

## ORC-012 audit of the reviewed merge head

The reviewed executable head is merge commit
`5874c70781fcb9488f88bc661f39cc0f2e7217e8`, with parents
`5dec299528c02bac3d462d2a83f39905ac2f80be` (#2134) and
`8048b906bc8b31e976b53d9030ac381a8eb77f2a` (#2143). SHA-256 of the
raw file bytes at that head identifies the two executed owners:

| File | SHA-256 at `5874c7078` |
| --- | --- |
| `packages/query-db-collection/src/query.ts` | `94374cb34cd00c34e545ec06b050ec1b95bd7339087ec37e6a0886995ee97057` |
| `packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts` | `40407533156b5699d27f9e1f69bde425b067c2922249c447a7b557f385ec8b30` |

The SHA-256 of `git diff --binary <parent> 5874c7078 --` for those two paths
is `7c4231f9763a27bbfe84048364660e038cbfce1f7f26f4901dc600321a5d394f`
from the #2134 parent and
`008e8d39e808eb66e32e0c7cb6c5076c016920f9cfb85dfdf85da04cd851671e`
from the #2143 parent. The second value is the earlier integration-section
diff hash. The file hashes bind that diff to the exact merge result.

The accepted law is the Query Collection request-signal and ownership promise
in the guide and live-query architecture: each live acquisition keeps its
physical work, cancellation ends its own caller outcome, and a later fetch
cannot inherit an older fetch's signal or source authority. The oracle uses
real Query Core observers and Query Collections, controlled held providers,
and the public `requestSnapshot` and Collection row boundaries. Its fixed
history grammar covers caller abort and release, silent Core cancellation,
outside-observer replacement, Collection cleanup, and startup retention
maintenance. The checkpoints distinguish provider metadata signals, caller
settlement, public rows, Query cache rows, and durable owner metadata where
that boundary applies.

- The eager `QueryBehavior.onFetch` witness invokes F1's query function while
  its Query still reports `idle`, then silently cancels F1 and acquires F2.
  On the merged pre-repair implementation, F1's metadata signal aborted but
  the second provider call never occurred. At the reviewed head, F1's signal
  is aborted, F2 is invoked, the replacement caller settles `ready`, and its
  row is public before the ignored F1 response is released.
- The same-turn outside-observer witness starts held F2 from an eager F1
  before F1's retryer exists. The premerge #2134 candidate failed at F1's
  still-live metadata signal after F2 replaced it. At this head, F1's signal
  aborts while F2 is held; F2 then settles into Query cache. This witness
  checks the outside cache result, while the adjacent public snapshot and
  successor histories check Collection rows and caller outcomes.
- The public `requestSnapshot` signal matrix crosses a provider that observes
  abort and one that ignores it. Before release, both canceled callers reject
  with `AbortError` and neither late row becomes public. A separate successor
  history holds the ignored F1 response: its canceled caller rejects, F2's
  provider signal stays live, F1's row remains absent, and F2's row appears
  only after the successor load settles. The cleanup histories check the
  remaining outside observer's signal, Query cache, public row absence, and
  exact durable historical owner after terminal F1.
- Reusing one options object during startup maintenance exercises a different
  ownership transition. The old call rejects with `AbortError`; the new call
  settles `ready` and publishes its row. A mutant that deletes the new pending
  registration when the old callback runs fails at the second caller's
  `AbortError` outcome. The reviewed implementation passes that same cut.

This is a bounded RED/GREEN account for the named histories and public
checkpoints. The ownership oracle is assigned the next DB receiving witness:
a custom Query behavior that omits `fetchSequence` and forwards Query Core's
lazy signal getter after the Core attribution repair stabilizes. The existing
eager-behavior cases do not exercise that combination. The current Query DB
package still permits published Query Core 5.90.20 through its peer range,
while the reviewed source requires attribution APIs available only in the
unpublished Core source used for these tests. Release compatibility remains
open until a compatible Core version is published and declared.

### CI formatter provenance and repeated receiving run

After the review of `5874c7078`, CI bot commit
`c0341dce590f96d179f090f455e03c438f7c6989` changed only the layout of
two `query.ts` expressions and one oracle union type. The normal merge
`c274d5aff5743a64f63f6c2ac30b759127899d44` has parents
`0b7829ec527000b5908b3aa3b6e7ec89e7e9595b` (this review record) and
`c0341dce590f96d179f090f455e03c438f7c6989`. The binary source/test diff
from `5874c7078` to `c274d5aff` has SHA-256
`76cd79e3f5214c4e19eb06b28e8b77b8c9c51d885b2210984782b314153fac2f`;
its inspected changes are formatting only. At `c274d5aff`, raw SHA-256 is
`ccf06c6858b47c72bf51ab4a8d98608a88b0e7f4818a613725e23c7f67368125`
for `query.ts` and
`d984c02e45696c594cb57c948dc7d038573714bc2c7e0de2b809bd1d2956a85d`
for the ownership oracle. A repeated Query DB run at that exact merged head
passed 1,029 runtime tests in 20 files and typechecked against attribution
source `877655c66`. This later record-only edit leaves those executed files
unchanged.

### Current-head ORC-001–014 disposition

This table audits the executable files at `c274d5aff`, unchanged by the
subsequent record-only commits. It supersedes the earlier table's scope and
ORC-014 status for the integrated #2134/#2143 result. The fixed histories
establish only the named schedules and checkpoints above.

| Requirement | Current disposition |
| --- | --- |
| ORC-001 authority and limits | **Met within scope.** The live-query architecture's ownership and request-signal laws supply the contract; the exact histories and omitted schedules are stated above. |
| ORC-002 independent judgment | **Met within scope.** The owner-edge model and caller/physical-fetch expectations do not use Query DB's ownership decisions; fixed historical key bytes do not come from the current encoder. |
| ORC-003 literate responsibilities | **Met within scope.** The executable owners state their laws, models, fixed histories, real QueryClient and Collection paths, observations, and settlement cuts beside the checks. |
| ORC-004 generated grammar controls | **N/A.** These additions are fixed, bounded histories; they claim no generated-history grammar. |
| ORC-005 production path and observation | **Met for the named cuts.** Real Query Core and Query Collection paths reach provider-signal, caller-settlement, public-row, cache-row, and durable-owner comparisons where each law requires them. |
| ORC-006 checker calibration | **Met for the named faults.** The pre-repair eager cancellation fails at F2's provider call; the pending-registration mutant fails at the second caller's outcome. Earlier identity and ownership mutants fail at their key, row, or marker comparisons. |
| ORC-007 fixed/random replay | **N/A.** No important generated property is added to this bounded audit. |
| ORC-008 stateful-model minimality | **Met for the changed owner-edge model.** Old/current owner edges remain separate because successful revalidation retires the old edge, while failure preserves it; a shared peer edge survives either transition. |
| ORC-009 vocabulary mapping | **Met.** The model's owner edges map to exact persisted claims; caller outcomes, physical fetches, and Collection publication remain separate observations. |
| ORC-010 failure fidelity and cleanup | **Partial.** The harness releases resources and retains ordinary cleanup diagnostics, but no injected simultaneous assertion-plus-cleanup failure proves that both reports survive. |
| ORC-011 second formulation | **N/A to a new formulation.** No named fault shared by the independent owner model and production requires another semantic model in this audit; evaluator, fixed historical bytes, and SQLite restart provide separate checks of their stated premises. |
| ORC-012 review evidence | **Met as a bounded audit.** The exact merge and formatter provenance, RED/GREEN checkpoints, relevant mutants, and unresolved receiving cells are recorded here and assigned in the coverage map. No universal schedule or release-compatibility closure is claimed. |
| ORC-013 boundary witnesses | **Met within the finite matrix.** Eager pre-retryer cancellation and same-turn replacement distinguish stale-signal reuse; same-options reacquisition distinguishes deletion of a new pending registration; old/current and sole/shared owners distinguish migration errors. |
| ORC-014 controlled-premise handoff | **Open in two receiving cells.** Real SQLite restart supplies the historical-owner premise. The coverage map still assigns a custom Query behavior that omits `fetchSequence` and forwards Core's lazy signal getter, and the current peer range still admits published Query Core 5.90.20 without the required attribution API. These need a receiving witness and a compatible published release, respectively. |
