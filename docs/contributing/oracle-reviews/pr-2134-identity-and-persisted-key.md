# PR #2134 identity and persisted-key oracle review

Reviewed PR head: `5e224075f`. Semantic repair: `9092cbf26`, 2026-10-13.
This record correction changes no production code or executable oracle.
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
