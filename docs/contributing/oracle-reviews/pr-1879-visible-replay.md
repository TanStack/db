# Visible web replay under a false online hint

Baseline: `ae2eb3fbf3a314a7f043f0d963fd336d8c1f1ec8` (`origin/main`,
2026-09-29). Review source: [PR #1879](https://github.com/TanStack/db/pull/1879)
at `accea99a8d4fd860d4daf9b05e248290bea54a7f`. This record describes the
focused oracle added in the PR follow-up. It does not establish real browser
connectivity.

The contract is eligibility to **attempt** a provider call. A visible elected
web executor can try its durable outbox despite a false `navigator.onLine` hint.
A hidden executor with the same hint waits. Provider success removes the outbox
row and settles the transaction. Real request failure retains the normal retry
policy; visibility does not guarantee connectivity.

The focused oracle admits a durable write while hidden with a false hint,
then changes visibility and signals either `visibilitychange` or explicit
`notifyOnline()`. It compares provider calls, public `peekOutbox()` contents,
and caller settlement at both checkpoints. On baseline `main`, both histories
failed at the visible checkpoint: expected one provider call, observed zero.
With the detector change, both pass. The pre-fix detector is the hostile control
for this observation; both failures were assertion failures at the intended
checkpoint, not setup failures or timeouts.

Guide audit:

| Requirement | Evidence |
| --- | --- |
| ORC-001 | The policy above is the PR's proposed public behavior, grounded in the package's documented automatic retry contract. The fixture judges attempts only when the controlled provider can succeed. |
| ORC-002 | Expected zero/one provider calls and durable-row retention/removal come from that policy and the successful provider response, not the detector predicate or queue implementation. |
| ORC-003 | The oracle header identifies the contract, independent observation model, two-event history grammar, real production driver, and checkpoint comparison. |
| ORC-004 | Not triggered: the two histories are fixed, not generated. |
| ORC-005 | The driver uses real `OfflineExecutor`, `WebOnlineDetector`, transaction commit, and storage. The provider callback and public outbox/caller observations are reached. |
| ORC-006 | Baseline `main` is a hostile implementation: both cases fail with zero provider calls at the intended visible checkpoint. |
| ORC-007 | Not triggered: this is a fixed regression, not an important generated property. |
| ORC-008 | Not triggered: no stateful reference model changed. |
| ORC-009 | The model's hidden/visible cuts map directly to browser visibility; the durable row is the outbox entry. No model-only state is introduced. |
| ORC-010 | The test bounds persistence and commit observations, rejects any unfinished caller in cleanup, and releases executor, Collection, and global stubs. |
| ORC-011 | No different semantic formulation was needed for a named shared model/production fault. The direct browser detector truth table is an adjacent check. |
| ORC-012 | This record ties the RED observation to the exact baseline. The test and coverage map state its contract, scope, and limits. |

The test uses controlled browser globals and fake storage. It does not exercise
Chromium's actual network hint, native storage, genuine offline retry timing,
React Native, or leadership transfer. Existing leadership and retry owners cover
their respective rules. The complete offline package suite passed after the
change: 199 tests in 16 files, plus package typecheck.
