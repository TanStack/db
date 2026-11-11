# Persisted on-demand scope and cached-claim gaps

Production source: `5feb26616a8357853454c2f9ff2ce0b0adb9c908`.
`packages/query-db-collection/src/query.ts` SHA256:
`6bbf1542e6daa38f33315445c5bb0ae3fbbf90d907cd388cb5d13f41c3b37cc5`.
This amendment adds receiving coverage. It changes no production code or
accepted product law. The [current CLI audit](2026-11-10-startup-gap-current-head.md)
preserves the initial survivor classifications separately from these additive
experiments.

## Laws and independent judgments

The SQLite persistence guide's **Persist a collection** section promises that
an on-demand Collection restores active demand rather than every saved row.
Query's **QueryFn and Predicate Push-Down** and **Direct Writes and Query Sync**
sections make complete-result omission local to the matching scope. A limited
response cannot prove an ownerless direct row absent. Those laws distinguish
persisted eager replacement from on-demand restoration.

The shared model in `retained-scoped-hydration-oracle.ts` uses set selection
over two disjoint authored scopes. Its first judgment selects the demanded
saved rows, replaces only the scope certified by a complete unbounded result,
and preserves the other durable scope until demand acquires it. A limited
result overlays its returned rows without retiring a broader retained owner
or proving an ownerless row absent. It imports no production owner classifier,
hydration helper, queue, or persistence scan implementation.

The same file separately judges cached first claims. Query's documented
per-key fetch order gives a continuously owned row the value from its later
physical fetch. A manually edited cache establishes no physical fetch order;
an older fetched cache establishes an older one. Neither may replace that
row merely because another Query first claims it. A later physical refetch
can replace it. The independent expected values come directly from these
three authored values and their causal order, never production's clocks or
observed rows. The primary ownership oracle remains the owner of this law;
these are its persisted receiving histories.

## Grammar, paths and observations

Each controlled and real Node SQLite host runs:

- 48 scope histories, then the same property in fixed-seed 1481 and fresh
  campaigns of 60 histories each;
- two cached-claim histories, then fixed-seed 1376 and fresh campaigns of
  60 histories each;
- one wrong-observation calibration for each judgment.

The scope grammar crosses first scope, all/one-row window, both saved and
returned masks from 0 through 3, ownerless-row scope, and values from -10 through
10. The fixed histories reconstruct unrequested saved rows, complete omission,
and ownerless rows restored into a limited demand. Removing the limited-window
axis loses the witness for `M558/M559`; removing the second durable scope loses
the scope-leak witness for `M1481`. Empty and nonempty masks and negative/equal
values are legal marginal cases. The driver rejects a demand without the
authored equality predicate instead of silently assigning it a scope.

The cached-claim grammar crosses a manual cache entry or an earlier physical
fetch, three independent values from -10 through 10, and a later explicit
refetch. Removing cached provenance leaves only ordinary fetched results,
which cannot distinguish `M1376/M1377`. Equal values remain legal; declared
unequal-value reach prevents an all-no-op campaign. Reversing the order so
that the cached fetch starts later would authorize its value and is outside
this particular cached-first-claim grammar.

The real QueryClient, Query Collection and persistence wrapper receive both
properties. Scope histories seed two retained scopes through a real earlier
Collection, clean it up, and reopen with a fresh QueryClient. They acquire one
demand while its real response is held, then release that response and acquire
the other demand. The controlled adapter supplies only predicate/limit
evaluation on its stored facts; Node SQLite evaluates the real demand.

Scope comparisons inspect public rows while the first response is pending,
public rows inside each demand's fulfillment callback, and durable rows after
each fulfillment. Cached-claim comparisons inspect the first peer's value,
public/durable values at cached acquisition, and public/durable values after
explicit refetch. Request counts prove cached acquisition did not start a
physical fetch. Optional hydration/scan counters are diagnostics: the comparison
does not invent a prohibition on redundant optional capability calls.

The browser receiving page uses these same models, histories, drivers and
comparisons with real Chromium worker SQLite/OPFS. It receives 48 scope and
two cached-claim histories, requires each declared state, and removes database
artifacts after close. The final parent integration run passes all 226 histories
in 50.6 seconds, with every receiver's declared reach positive, no page errors
and no leftover fixture artifacts. The two cached histories supersede the
earlier 224-history registration.

## Declared reach and clean results

The final local Node run passes all 16 registrations. Every state is required
separately for each host and campaign. Exact counts from that run follow;
`C` means controlled storage and `N` means real Node SQLite.

| Scope state | Fixed histories, C/N | Fixed campaign, C/N | Fresh C | Fresh N |
| --- | ---: | ---: | ---: | ---: |
| first-a | 24 | 25 | 22 | 27 |
| first-b | 24 | 35 | 38 | 33 |
| empty-result | 24 | 17 | 11 | 21 |
| nonempty-result | 24 | 43 | 49 | 39 |
| unrequested-saved-rows | 48 | 41 | 41 | 49 |
| omitted-owned-row | 24 | 25 | 27 | 27 |
| ownerless-first | 16 | 22 | 24 | 16 |
| ownerless-other | 16 | 25 | 23 | 15 |
| no-ownerless | 16 | 13 | 13 | 29 |
| unbounded | 24 | 31 | 29 | 29 |
| limited | 24 | 29 | 31 | 31 |
| limited-ownerless-restored | 8 | 12 | 16 | 8 |

| Cached-claim state | Fixed histories, C/N | Fixed campaign, C/N | Fresh C | Fresh N |
| --- | ---: | ---: | ---: | ---: |
| manual | 1 | 41 | 31 | 32 |
| older-fetch | 1 | 19 | 29 | 28 |
| different-cached-value | 2 | 54 | 57 | 59 |
| later-value-change | 2 | 58 | 56 | 58 |

Query and browser package TypeScript checks pass. Scoped ESLint, Prettier and
the parent's final `lint:changed` checks pass. Query's `test:oracles` command includes the new runner. Both
property IDs have guarded replay registration and distinct random-campaign
selectors.

## Exact hostile mutants and checked replay

Each experiment transforms an immutable source copy in a separate Vitest
process. The transformer checks the original operator and position, logs the
applied SHA256, disables filesystem module caching, and gives each mutant a
distinct plugin/cache identity. It never overwrites the shared source file.

| Exact current mutant | Intended wrong behavior | Rejected observation |
| --- | --- | --- |
| `M558`, `M559` | Broaden ownerless-row inclusion outside eager persisted reconciliation. | A limited empty result deletes a restored ownerless direct row. Both first public and durable cuts reject it; the loss remains at the second demand. |
| `M1481` | Always call unconstrained baseline hydration before scoped reconciliation. | First demand publishes saved rows from the unrequested other scope. The first public cut rejects it while those rows correctly remain durable. |
| `M1376`, `M1377` | Broaden eager first-claim update authority to cached on-demand claims. | Acquiring a manually edited cached Query replaces a continuously owned later-fetched value. Both claimed public and durable cuts reject it. |

All five exact mutants fail the intended comparison on both Node hosts.
These are assertion rejections, not setup failures, timeouts or inferred
kills. The following shrink coordinates replay those same violations:

| Property | Mutants | Seed | Shrink path | Reduced distinction |
| --- | --- | ---: | --- | --- |
| `query.retained-scoped-hydration` | `M558/M559` | 1481 | `0:0:1:1:1:1:2` | One-row demand; only saved row is ownerless in the first scope; both source results empty. |
| `query.retained-scoped-hydration` | `M1481` | 1481 | `1:0:0:0:1:1` | First scope empty; only saved row belongs to the other scope. |
| `query.cached-peer-claim` | `M1376/M1377` | 1376 | `1:0:1:0:1` | Manual cached value 0, continuously owned fetched value -1; cached acquisition must preserve -1. |

The guarded replay records two failed executions for each mutant, one per host,
at the intended comparison. Current production passes every coordinate, with
two successful executions per replay. A later refetch returns the expected
new value even under the cached-claim mutants, so comparing only after that
refetch would hide the defect.

From `packages/query-db-collection`, the clean cached-claim replay is:

```sh
TANSTACK_DB_ORACLE_SEED=1376 TANSTACK_DB_ORACLE_PATH=1:0:1:0:1 TANSTACK_DB_ORACLE_PROPERTY=query.cached-peer-claim node --import tsx ../db/tests/oracle-replay.ts tests/retained-scoped-hydration-oracle.test.ts --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false
```

From the worktree root, normal coverage runs with:

```sh
pnpm --config.verifyDepsBeforeRun=false --filter @tanstack/query-db-collection exec vitest run --maxWorkers=2 --coverage.enabled=false --typecheck.enabled=false tests/retained-scoped-hydration-oracle.test.ts
```

Exact transforms, applied-source hashes, original/shrunk mismatches, replay
witnesses and validation logs remain under `.review-2367/gap-fill/`, including
`query-scoped-M*-replay.log` and `query-scoped-final-green.log`.

## Review and limits

This amendment enforces accepted laws with two small stateless judgments.
ORC-001/002/003 identify authority, independent models and literate roles.
ORC-004 grammar controls and ORC-005 public checkpoints are described above.
ORC-006 uses wrong-observation calibrations and five exact hostile mutants;
ORC-007 has parity campaigns and checked replay. ORC-008's stateful-model
trigger does not apply. ORC-009 uses authored scopes, demands and checkpoints
with their stated mapping. ORC-010 uses error-preserving cleanup and verifies
the same violation at replay. No concrete shared semantic-fault hypothesis
requiring an ORC-011 second formulation was identified; this is not a claim
that no such hypothesis exists. This record supplies ORC-012 evidence.
ORC-013 distinguishes all/limited demand, demanded/other scope, cached claim
and later physical fetch. ORC-014 reuses the same judgments for real storage;
ORC-015 requires the counts above. ORC-016 fixed histories and calibrations
use the same reusable judgments without separate expected answers.

The finite domain is one cold reopen with two disjoint scopes or one
continuously owned overlapping key, successful I/O, and numeric values.
Overlapping arbitrary predicates, cache rotation, peer writers, optimistic
transactions, failed storage and arbitrary intermediate publications remain
outside these added histories. The existing ownership, scoped recovery,
startup and direct-write-window owners retain their separate laws. This
amendment does not convert capability-call counts into a work or latency
promise. The [startup measurements](2026-11-10-persisted-startup-measurements.md)
judge resource cost separately.
