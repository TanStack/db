# PR #2134 identity and persisted-key oracle review

Review target: `5e224075f` and the follow-up on the same PR branch, 2026-10-13.
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
not include a literal reference proxy inside the IN array or separately
created byte arrays with equal contents at the evaluator checkpoint. The
old proxy-to-path canonicalization therefore made `inArray(a, [b])` share
identity with `eq(a, b)` even though the evaluator gave different answers.

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
- After repair, the full ownership oracle passed 521 checks, the IR identity
  oracle passed 69, and joined-demand deduplication passed 13. These are
  bounded executed checks, not a proof for every query expression or adapter.

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
