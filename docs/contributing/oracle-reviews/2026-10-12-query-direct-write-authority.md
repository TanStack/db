# Query direct-write authority review — 2026-10-12

Reviewed executable revision: `d1a4d686373f3f6d57096c842b1bbeb6b7a2c8e2`. The external
medium-effort review read PR #2065 at `9fdcd2e48` and ran no tests. This
record covers the ownership-oracle and production repairs made after that
review; the earlier [review at `74e399150`](pr-2065-74e399-review.md) remains
evidence for that intermediate implementation, not this revision.

## Law, boundary, and limits

The [Query Collection guide](../../collections/query-collection.md#direct-writes-and-query-sync)
promises that an accepted direct write starts no Query request, changes its
Collection, and survives a fetch started before that write. A later successful
physical fetch may replace the written row. Query cache edits do not themselves
establish fetch authority. A subset result owns only its returned rows, and a
direct delete ends the old ownership lifetime. A fresh persisted Collection
that cannot order a durable direct row against a colliding retained Query cache
row requests a new result before accepting that cache. These laws apply to
Collections sharing a physical Query in one QueryClient. The guide describes
the separate dehydration limit.

The primary executable owner is
[`ownership-lifecycle.oracle.test.ts`](../../../packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts).
Its reference uses authored server rows, accepted direct writes, subset-owner
sets, and the order of those actions. It does not import Query Core's
classifiers, cache-version rules, or the production ownership maps. Its
histories use a real QueryClient and Collection, with controlled provider
responses and, for restart, real node SQLite persistence. Comparisons occur at
accepted-write, held-request, result-application, unload, cleanup/restart, and
caller-settlement cuts. They observe public Collection rows and errors, cache
rows, exact owner metadata, provider calls, and bounded scan work.

The fixed histories added for this review include a direct row surviving and
being deleted across two overlapping owners; same-Collection sync restart with
an old direct position; equivalent logical demands sharing one physical Query;
a peer that owns or later acquires the shared Query; directly selected response
properties; a failed late-peer replacement fetch; a retained direct cache patch
across the writer's sync restart; fresh persisted owned and ownerless rows; and
stable-empty versus cold-durable persisted baseline scans. Eager co-owners now
cross update, delete, upsert, and a genuinely new key; an older held fetch and
a later complete fetch distinguish write isolation from refusing server
authority. Disabled late peers in both modes, including an eager cold cache
seed, wait for explicit refetch. A held
persisted write crossed with refetch startup checks public and durable rows
before the new provider response in both modes. An empty explicit on-demand
refetch preserves an ownerless direct row, unlike the eager full snapshot. A post-write
provider fetch is the neighbor for histories that reject a stale cache edit.
The owner also has existing broader direct-write and refetch grammars.

The initial review found no test execution. Before repair, executed real
QueryClient oracles/probes exposed the stale restart row, aliased older-fetch
overwrite, late peer adopting a local edit, fresh persisted owned row adopting
old cache, repeated stable-empty scan, and an owned direct row overwritten by
`setQueryData`. The late peer's failed replacement fetch then failed the new
oracle at `lastError`: it rejected its load but hid the public error. These
were assertion failures at the named observation cuts. Eager shared-Query
update, delete, upsert, and late-acquisition histories were also RED on the
reviewed head. A held persisted write/refetch-start history was RED at its
public and durable row checkpoint before the provider response; disabled
late-peer histories were RED at the unwanted-request count. After repair, the
full Query DB package suite passes **1222 tests across 36 Vitest groups**,
including **470 ownership-oracle runtime and type tests**. Vitest reported no
type errors, and the package TypeScript check and production build passed. The
final-head run must be repeated after any further semantic edits.

Hostile controls rejected at the intended assertion include wrong persisted
owner identity with the same count, failure to propagate a physical fetch start
to aliased observers, omission of observer-attach fetch position, a cache patch
that depends on the writing Collection already owning the subset, a marker
restricted to raw arrays, and a marker that ignores the writer's sync-run
identity. The last two failed at the held replacement-request assertion
(`settled` instead of `request-started`); both mutants were removed. The
original owned-row `setQueryData` failure and the successful later-fetch
neighbor distinguish local cache edits from server results. The persisted
collision test now requires exactly one new request and the newer result;
allowing zero requests was a false-green oracle rule discovered in this pass.
Removing the eager shared-owner guard restores the original peer-leak RED at
the peer row and cache checkpoint. Removing the fetch-start replay guard
restores the held persisted-write RED before any new provider result.

## ORC-012 audit of the changed ownership laws

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Applicable. The guide supplies direct-write, fetch-order, cache-authority, ownership, and persisted-collision laws. The paragraph above bounds the same-QueryClient and controlled-response claim. Eager shared-Query isolation is a provisional PR choice pending maintainer confirmation. Cross-subset fetch-versus-fetch value precedence remains a separate open choice. |
| ORC-002 | Applicable. Authored rows, action order, and owner-set reference expectations are independent of Query Core cache and fetch classifiers. The driver alone uses production helpers. |
| ORC-003 | Applicable. The executable file opens with the contract and limits and places model, history, driver, observation, and checkpoint explanations beside the relevant code. The new histories explain their expected rows and distinguishing neighbor. |
| ORC-004 | Not triggered by these additions. They are finite `it.each` matrices and focused histories, not a generated property claiming a grammar beyond the enumerated cases. |
| ORC-005 | Applicable. The driver calls `utils.write*`, `loadSubset`, `refetch`, cleanup/restart, real QueryClient observers, and managed node SQLite. It checks rows, errors, owner identities, cache, requests, and scans at the stated cuts. |
| ORC-006 | Applicable. The original REDs and named hostile controls above reached their intended assertions; the raw-only and sync-run mutants failed at held-request comparisons, not at setup or timeout. |
| ORC-007 | Not triggered. The changed laws add no important generated property; the finite matrices have direct test-name replay. |
| ORC-008 | Not triggered by these additions. They do not add, split, or remove state in the existing reference model. The added authored-action histories compare distinct observations without copying a new production state. |
| ORC-009 | Applicable. The histories use glossary terms `sync run`, `physical Query`, `subset owner`, `publication`, and `checkpoint`. Their authored action order is a reference abstraction, not a production generation counter. |
| ORC-010 | Applicable to held requests and SQLite cleanup. Each new history settles held provider promises and registers cleanup; `runCleanups` aggregates cleanup failures. A forced simultaneous assertion-and-cleanup failure was not run for the new cases, so their failure-fidelity claim remains limited to this harness structure. |
| ORC-011 | No new shared semantic classifier was identified between the authored reference and production. Real Query Core plus node SQLite supplies a second receiving boundary for persisted rows; it is not claimed to duplicate a remote server. |
| ORC-013 | Applicable. Older versus post-write fetch, raw versus directly selected cache, writer versus late peer, eager co-owner versus sole owner, enabled versus disabled acquisition, same versus restarted sync run, owned versus ownerless persisted row, and stable-empty versus cold durable baseline distinguish conditional rules from nearby wrong ones. The mutants and original REDs above calibrate the critical boundaries. |
| ORC-014 | Applicable at the Query Core and node SQLite handoffs, which execute real implementations. Provider payloads and timing are controlled, so no actual network service, browser cross-tab transport, or dehydrated cache transfer is claimed. Those receiving paths remain outside this review. |

## Open choices and receiving limits

The PR now treats eager writes as Collection-local when another Collection
owns the physical Query. This resolves the observed peer leak under the
local-authority interpretation and qualifies the eager cache-patching guide;
the maintainer's answer to the explicit choice is still pending. Two
overlapping subset fetches can return the same key in reverse settlement
order; the guide orders fetches against direct writes but does not choose
fetch-versus-fetch precedence. That is an open design question, not an
established write-law violation. The guide now states the existing surgical
on-demand lifetime: an ownerless direct insert survives even an empty explicit
refetch until a result claims it or the caller deletes it. An adjacent eager
full-snapshot oracle gives the opposite prediction for eager mode.

The ownership oracle's controlled `queryFn` does not prove remote server order
or cross-process cache provenance. A dehydrate/hydrate probe confirmed that a
fresh QueryClient can import a local direct cache edit without its in-memory
provenance; the public guide now warns to refetch after hydration when the new
client needs server confirmation. `ownership-lifecycle.oracle.test.ts` owns any
future same-QueryClient refinement, while `ssr-dehydration-oracle.test.ts` owns
the serialized-cache receiving boundary if that behavior becomes a guarantee.
Other uncovered cells are same-run external durable writers, arbitrary
overlapping fetch schedules, and non-node persisted adapters. The coverage map
names those limits. A passing finite suite is not a universal proof and this
record does not claim the pending eager choice or fetch-versus-fetch policy is
settled.
