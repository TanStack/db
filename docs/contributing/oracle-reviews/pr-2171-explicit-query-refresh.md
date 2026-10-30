# Query Collection explicit mutation refresh

This record applies to the change that contains it, after merge commit
`621833269`. The first-RC API decision removes automatic refetch after mutation
handlers. Handlers return `Promise<void>` and synchronize explicitly.

## Distinguishing observations

The ownership oracle adds a bounded table over insert, update, and delete,
with no confirmation, an explicit refetch, or a direct write. The backend starts
empty for insert and with one row for update and delete. A gate keeps the
optimistic transaction persisting until its optimistic public rows are checked.
The backend then accepts the edit. At transaction settlement:

| Handler confirmation | Query calls, including initial load | Public rows |
| --- | --- | --- |
| None | 1 | Initial synced rows |
| Explicit refetch | 2 | Confirmed server rows |
| Direct write | 1 | Confirmed server rows |

The old automatic-refetch implementation fails all nine cases at the exact
fetch-count comparison. In particular, an explicit refetch produces three calls.
After removing it, all nine cases pass. Expectations come from the initial and
confirmed row arrays and the declared confirmation action, without production
ownership or fetch classifiers.

Existing ownership and ordered-refetch assertions remain intact. Their handlers
now refetch explicitly where the old wrapper supplied the request. Obsolete
opt-outs disappear from handlers that already refetch or write confirmed data.

## Evidence and rubric scope

- ORC-001, ORC-002, ORC-003: the migration decision supplies authority. The
  table's prose explains its independent reference, finite histories, real
  Collection and QueryClient driver, and public observations.
- ORC-004, ORC-007: no generated grammar or campaign changes. The new table
  exhausts its nine declared histories. Existing ordered-prefix fixed and
  random campaigns run in the package suite.
- ORC-005, ORC-006: the real transaction reaches both the persisting and
  settled checkpoints. The old implementation fails all nine cases by
  assertion, rather than timeout or setup failure.
- ORC-008, ORC-009: no stateful model or vocabulary changes. Initial and
  confirmed rows denote public data, not production bookkeeping.
- ORC-010: cleanup releases the gate and disposes the Collection and QueryClient.
  The table has no shrinker or failure capture that can replace its assertion.
- ORC-011: no shared-classifier fault hypothesis requires a second model.
- ORC-012: this record bounds the added evidence. It does not claim universal
  closure of ownership or scheduling defects.
- ORC-013: no confirmation and explicit confirmation distinguish the boundary
  at settlement for each mutation. The explicit-refetch case also rejects
  duplicate fetching. Claims cover these finite cases only.
- ORC-014: a controlled backend supplies complete arrays. The test proves the
  Collection and QueryClient contract, not HTTP transport or backend ordering.

Verification: Query Collection's complete suite passes with no type errors
(42 files, 1466 assertions/tests reported by Vitest). The first-RC release
fixtures cover a stable minor bump and reject a stable major bump. The merged
LocalStorage value-fidelity oracle passes 234 cases after migrating its wait to
`when('settled')`. The Node Browser reload driver passes all 29 fixed histories
after the same API migration; native Chromium and Electron reload drivers were
not rerun for this mechanical change.

Excluded: independent Query polling, focus, reconnect, and external invalidation
triggers. The coverage map names the existing ownership and ordered-refetch
owners for their broader lifecycle laws.
