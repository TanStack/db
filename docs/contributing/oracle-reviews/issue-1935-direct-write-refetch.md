# Issue #1935: direct writes and on-demand refetches

Reviewed implementation commit: `41b9043a76be8ce65fd3287009ae721201383c33`. The regression was
introduced after the prior public contract recorded at `fdcb078a0^`.

The pre-#1826 guide promised that direct writes “Do NOT trigger automatic query
refetches”; the `QueryCollectionUtils` comments made the same promise for each
`writeX` method. The report's PocketBase adapter uses one subscription per
on-demand subset and applies delivered events through direct writes. The user
confirmed that these utilities are sharp knives: they may leave a scoped Query
cache inconsistent. Exact scoped cache reconstruction is not the direct-write
contract. A later Query result may replace a direct write, and applications
that need exact server authority may explicitly refetch or use a sync engine.

The original implementation refetched all ten active equality subsets after
one `writeUpsert`. The ownership oracle's real `queryFn` recorder rejected that
implementation at the post-write request checkpoint: expected zero new calls,
observed ten. With this repair, the same check passes after each accepted
`writeUpsert`, `writeUpdate`, `writeDelete`, `writeInsert`, and mixed `writeBatch`
in the ten-subset fixture. An independent category filter computes expected
public rows after each action. The source path is `writeX` → accepted sync
commit → on-demand cache patch; the public observations are live-query rows
and `queryFn` calls. The law covers this bounded history and no automatic
request caused by those writes. It does not prove exact cache membership,
ordering, window replacement, or every lifecycle interleaving.

The old load-lifecycle case required a post-write fetch to become authoritative.
That was the removed policy, so the case was retired. Adjacent cases still
require explicit refetch to wait for deferred application and reject after final
acquisition release. The ownership oracle retains a direct-write race with an
older in-flight fetch and checks that a later explicit refetch can replace it.
The original production implementation is the hostile control for the no-fetch
comparison; it failed by assertion, not timeout or setup failure.

| Guide requirement | Review outcome |
| --- | --- |
| ORC-001 | Prior published no-refetch contract and the sharp-knife limit are stated above. |
| ORC-002 | Expected rows come from a standalone category filter; expected request count comes from the direct-write contract, not a Query cache classifier. |
| ORC-003 | The ownership oracle states its law and limits beside the witness, then places reference rows, real production calls, and post-acceptance comparisons together. The load-lifecycle oracle states its separate explicit-refetch law. |
| ORC-004 | Not triggered: this is a bounded fixed history, not a generated-history coverage claim. |
| ORC-005 | The witness calls public `writeX` utilities and compares public live-query rows and provider calls after each accepted write. |
| ORC-006 | The pre-repair all-active-refetch implementation failed the zero-request assertion with ten calls. |
| ORC-007 | Not triggered: the changed witness is fixed, not an important generated property. Existing generated properties are unchanged. |
| ORC-008 | Not triggered: the changed witness does not alter a stateful reference model. The retired post-write generation was production policy, not retained model state. |
| ORC-009 | The witness uses the glossary's Collection, row, and sync-commit terms; its category filter is only local test data. |
| ORC-010 | No shrinking or capture applies. The witness registers Collection and QueryClient cleanup with the existing harness. |
| ORC-011 | No plausible shared semantic classifier is used to judge request count. Scoped-cache correctness remains a separate law, with owners named below. |
| ORC-012 | This record separates the proved request law from the open scoped-cache questions and records each applicable requirement. |
| ORC-013 | The ten active subsets reach the reported all-active premise. All five write forms reject a repair that suppresses requests only for upsert; the old implementation rejects the request boundary itself. The claim remains limited to this bounded history. |
| ORC-014 | The observed boundary is the real QueryClient and its supplied `queryFn`; this record makes no claim about a real network or PocketBase server. |

The ownership oracle remains responsible for active/inactive and shared-owner
cache histories, including key-preserving edits, moves across scopes, and
observer retention. The cursor-pagination oracle owns a receiving witness for
limited or ordered windows. Those cache-shape risks are documented API limits;
their exact automatic repair is not a promised direct-write behavior.

The report's four source-order items are preserved in the task's evaluation
ledger. The subscription proposal remains a separate API design decision. The
reported `setQueryData` workaround was not executed here; it remains an
external adapter observation, not evidence for cache safety.

## Prep-PR review extension

The independent review of `ebde2066d` found two reachable histories outside
the ten-subset witness. The follow-up implementation commit is
`aaca3ec0af4d3c5ac74c95c1b23942a562d593dc`.

First, the documented `edges.map(edge => edge.node)` projection has no inverse
cache mapping. A direct write replaced `edges` with node objects. The new
ownership-oracle comparison failed on the envelope shape and production logged
`InvalidQueryResultError`. The repair updates a wrapped cache only when
`select` returns a direct array property by identity. The same oracle now
passes, while the new direct-property on-demand control preserves the patchable
case. A derived cache may be stale; it must remain valid input to `select`.

Second, a direct write under a held `deferDataRefresh` barrier made one provider
request after barrier release. The new ownership-oracle assertion failed at
that checkpoint with two total calls instead of one. The repair prevents a
direct-cache notification from scheduling the deferred refetch. The same
barrier history now passes. The adjacent replacement-Query case still checks
the cache-clear path through an explicit refetch.

For ORC-001 through ORC-006, the added laws are the existing no-refetch promise
at the barrier checkpoint and the documented read-only nature of derived
`select` projections. The authored envelope supplies the independent expected
shape. The production driver uses a real QueryClient and public direct write.
The assertions observe cache shape, public Collection row, and provider calls.
Both original faults failed at their intended assertions; the cache fault also
caused a logged application error. ORC-007 and ORC-008 remain inapplicable
because these are fixed histories without model-state changes. ORC-009 and
ORC-010 follow the existing vocabulary and cleanup harness. For ORC-011
through ORC-013, the directly selected wrapper control distinguishes safe
patching from the derived projection, and the held barrier distinguishes a
post-release request from the ordinary no-barrier case. The claim remains
bounded by these histories. Under ORC-014, `OfflineExecutor` supplies a real
`deferDataRefresh` barrier during reconnect replay, but no full
OfflineExecutor receiving witness ran. The offline-transactions owner retains
that integration check in the coverage map.

## CodeRabbit review follow-up

CodeRabbit review `5444119327` examined commit `c173d4bdc8e5fc2af360f65549ab362ddffd0db9`.
Its three comments are recorded in source order:

| ID | Claim | Verdict and action |
| --- | --- | --- |
| CR1 | The changeset implies every active on-demand cache is patched. | Confirmed; fixed the release wording to exclude derived `select` projections. |
| CR2 | Direct inserts have no Query row owner and can remain after subset unload; add ownership or retention. | The observation is true. It is the accepted direct-write contract: a caller may surgically insert a Collection row without establishing Query subset membership. The new ownership-oracle witness keeps that row after its fetched peer retires and removes it by explicit `writeDelete`. Documentation now names the caller's retention responsibility. |
| CR3 | A direct write evicts an unobserved cache entry under the base prefix even if this Collection has not yet observed it; gate eviction on `ownedCacheQueries`. | The observation is true, but the proposed gate contradicts the documented query-key prefix convention and the existing inactive-sibling oracle. A matching-prefix cache entry can seed a later subset; keeping stale data would let it revive a deleted row. The documentation and PR description now say matching-prefix entries rather than collection-owned entries. |

For CR2, the legal history loads one subset, accepts a direct insert, unloads
the subset, then explicitly deletes the inserted row. A standalone expected-key
set keeps the direct row and retires the fetched row. The real QueryClient and
public `writeInsert`/`writeDelete` path reaches all three public-row
checkpoints without a new provider call. A hostile mutant that assigned every
accepted direct key to the active Query owner failed at unload: it returned no
rows where the reference required the direct row. The restored implementation
passed. This bounded witness does not settle the lifetime of unowned direct
rows across persisted restore or every later Query result.

For CR3, three existing ownership-oracle cases establish that direct writes
evict inactive matching-prefix entries, including pre-sync and restart seeds.
They passed on the reviewed commit. CodeRabbit's proposed `ownedCacheQueries`
gate was run as a hostile mutant; all three failed at their cache observation
because the stale sibling remained. Restoring the implementation made them
pass. The check concerns Query cache entries under the Collection's declared
prefix, not arbitrary unrelated keys elsewhere in the QueryClient. A later
remount that proves the stale row would become public is a useful further
witness for the ownership oracle; the current tests assert the cache boundary.

ORC-001 rests on the prior direct-write promise and the documented query-key
prefix convention. ORC-002 uses an independent key set for CR2, while CR3's
expected cache absence follows from the prefix contract and the authored
stale response. ORC-003 places the direct-insert law, history, path, and
checkpoints beside its executable witness. ORC-004, ORC-007, and ORC-008 do
not apply: these are fixed histories and no reference-model state changed.
ORC-005 reaches real QueryClient and public Collection observations. ORC-006
has the two assertion-failing hostile mutants described above. ORC-009 uses
the glossary's Collection, row, and subset-owner terms. ORC-010 uses the
existing aggregate cleanup harness. ORC-011 adds no second formulation:
neither review claim named a fault the independent key set or authored cache
response could share with production. ORC-012 limits the claims to the named
histories and records the remount gap in the coverage map. ORC-013's nearby
distinction is fetched versus directly inserted row for CR2, and active versus
inactive matching-prefix entries for CR3. ORC-014 makes no cross-provider
claim; the boundary is the real QueryClient with an authored query function.
