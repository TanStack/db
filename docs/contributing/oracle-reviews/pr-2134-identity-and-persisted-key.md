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
