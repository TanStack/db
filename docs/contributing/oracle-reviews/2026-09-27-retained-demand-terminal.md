# Retained-demand terminal failure oracle

- Reviewed semantic commit: `3c6e9df082f6a5db0c351a6f58631d9d72104d80`
- Comparison main: `f473a36201abe9af43d36a83492a2649668756d8`
- Owner: `packages/db-sqlite-persistence-core/tests/persisted.test.ts`, property `persistence.retained-demand`
- Runtime: local Node/Vitest 3.2.4; recording persistence adapter, not a browser or OPFS host

| Requirement | Result |
| --- | --- |
| ORC-001 | Pass. RFC #1659 invariant 7 and the existing terminal-failure load contract require a later exact retained demand to reject with the same terminal error. A cached row is not evidence that durability recovered. The oracle does not claim real-host behavior. |
| ORC-002 | Pass. The expected readiness comes from an independent set of retained demand names. After a failed source receipt, the expected result is its exact terminal error with no new upstream call; the model does not read production's hydrated-demand cache or terminal classifier. |
| ORC-003 | Pass. The file header states the contract and limit; the demand operation arbitrary and fixed terminal suffix form the grammar; the set plus absorbing failure rule form the model; the real persisted wrapper is the driver; result identity and upstream-call count are checked after the failure. |
| ORC-004 | Pass within this bounded grammar. The RED shrink reconstructed `[acquire one]`; acquire/release and inserted truncate positions retain the prior ownership/reset histories. Removing the terminal suffix lets the old fast-path defect survive. The range is 1–20 demand actions with at most four truncate insertions, two exact demand names, and one terminal source write. Unknown demand names are excluded; release without an active owner is a legal no-op. This does not generate concurrent host schedules. |
| ORC-005 | Pass. The driver calls the wrapper's `loadSubset`, retains a hydrated demand, fails a source commit through `applyCommittedTx`, then calls `loadSubset` again. It observes the applied-receipt error, the next load result, and absence of a new upstream call at that checkpoint. |
| ORC-006 | Pass. Before the production guard, the random property failed after one case and shrank to `[acquire one]`: the later load completed instead of rejecting, and the fast path called upstream. This was an assertion failure at the intended checkpoint, not a setup failure or timeout. |
| ORC-007 | Pass. Fixed seed `186001` and seedless random lanes run the same generator, driver, comparison, and 50-run budget. Guarded replay with property `persistence.retained-demand`, seed `186001`, and path `0` reached the named owner and passed. |
| ORC-008 | Pass. Healthy-retained and terminal-retained states cannot be combined: the next identical acquisition returns `true` in the first and rejects in the second. The model's terminal suffix keeps that distinction without mirroring the production cache. |
| ORC-009 | Pass. A demand is the request's exact predicate/window identity; the upstream-call counter observes acquisition dispatch, not the full lifetime of an acquisition lease. The terminal receipt is distinct from collection readiness. |
| ORC-010 | Pass. The RED shrink preserved the post-terminal acquisition mismatch. The driver cleans the collection in `finally`; cleanup does not replace the primary assertion. |
| ORC-011 | Not triggered. No plausible shared semantic classifier was identified. The separate sibling-live-query test covers healthy warm readiness; this property covers terminal rejection at the persisted wrapper, not React rendering. |
| ORC-012 | Pass. This versioned record accounts for ORC-001 through ORC-011 at the exact semantic commit above. |

The first candidate fix threw synchronously and failed four established terminal-load tests. The final guard returns a rejected promise, preserving that caller contract. Final local verification: the full persistence-core package passed 334 tests with one existing TODO; typecheck, build, staged lint, formatting, and guarded direct replay passed. The unrelated `@tanstack/db` random optimistic-history failure from PR CI is tracked separately; this record does not mark that check green.
