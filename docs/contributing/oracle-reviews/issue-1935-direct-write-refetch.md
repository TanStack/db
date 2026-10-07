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
