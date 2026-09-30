# Query DB SSR dehydration oracle review

Reviewed implementation: `84c9557053f3d477b89492679da47c2dae190e5f`.
Original implementation: `c0d123b86aeb2942d0a2a70a050bf10a3b3dda48`.
The oracle was added to the original implementation before the production fix.
This record follows the reviewed implementation commit.

## Claim and calibration

A successful on-demand Query collection can put a plain cached row into a
TanStack Start SSR payload. Its request options may contain IR classes, an
`AbortSignal`, and a custom comparator. Query functions must still receive
those original request values. The serialized Query state must carry the row
and enumerable user metadata without carrying the request options.

On the original implementation, the plain Query cache control passed. The
live query with two `where` clauses loaded and published row `1`, then failed
at `serializeRouterPayload(initial)` because Seroval rejected `Func and`.
The signal-only request loaded its row, then failed at the same stream
checkpoint because Seroval rejected `AbortSignal`. These were assertion
failures at the intended serialization boundary, not setup failures or
timeouts. Type checking passed. The original `query.test.ts` structured-clone
case also passed, which showed why it could not protect this boundary.

After the fix, all four SSR oracle cases passed. The added ordered cursor case
checks that a function-valued comparator and IR cursor still reach the query
function while the stream completes. A separate Seroval serialize/deserialize
round trip followed by Query Core `hydrate` restores the row and enumerable
user metadata, without request options. The surrounding `query.test.ts`,
`load-subset-lifecycle-oracle.test.ts`, and SSR oracle run passed 421 runtime
tests with no type errors. The run used
`pnpm exec vitest run tests/query.test.ts tests/load-subset-lifecycle-oracle.test.ts tests/ssr-dehydration-oracle.test.ts --coverage.enabled=false --pool-options.threads.maxThreads=2`
from `packages/query-db-collection`. TypeScript and Prettier checks passed.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001 Contract authority and limits | The issue's expected SSR behavior and the Query collection documentation require successful cached rows to survive dehydration. The owner stops at QueryClient, Seroval, and Query Core hydration; it does not run the TanStack Start host or resume a browser Collection. |
| ORC-002 Independent judgment | The expected plain row and user metadata come from the fixture and public cache behavior. No production request classifier or serialization helper computes the expected result. |
| ORC-003 Distinguishable responsibilities | The oracle opening states the contract and fixed request grammar. The row and metadata expectations are the model. Real Collection, QueryClient, and Seroval calls are the driver. Stream completion, row equality, runtime request identity, and hydration checks are the refinement observations. |
| ORC-004 Generated-history controls | Not applicable. The owner has fixed cases and makes no generated-history coverage claim. |
| ORC-005 Production path and observation | The on-demand live query and direct `loadSubset` requests use real Query collections. `dehydrate` and `crossSerializeStream` reach the reported boundary. The check observes the row before serialization and completion or failure of the stream; the separate hydration check observes the restored row and user metadata. |
| ORC-006 Checker calibration | The original implementation is the wrong-design control. Its compound predicate and signal-only cases fail at the stream assertion, while the plain cache control passes. The outcome is an assertion kill at the intended checkpoint. |
| ORC-007 Fixed/random replay | Not applicable. There is no important generated property. |
| ORC-008 Stateful-model minimality | Not applicable. The model is a fixed successful cache entry, with no reference state machine. |
| ORC-009 Vocabulary mapping | The oracle introduces no model-only state or action names. Query, request options, dehydration, and hydration match the production and documentation terms. |
| ORC-010 Failure fidelity and cleanup | `checkWithCleanup` retains the primary stream failure and reports each cleanup failure separately through `AggregateError` when needed. Each case releases its Collection and QueryClient. |
| ORC-011 Independent second formulation | No shared semantic classifier between the expected plain row and the serializer was identified. The ordinary Query cache control follows a second loading path and separates a general Seroval failure from request-metadata failure. It does not claim an alternate full Start formulation. |

The established boundary is: successful plain-row Query entries × the four
fixed request forms × Query collection → QueryClient dehydration → Seroval
stream, with Query Core hydration checked separately × row, runtime request
identity, stream completion, and restored row/user metadata. The original
compound and signal witnesses distinguish the repair from the original
design. The ordered cursor with a custom comparator is an adjacent witness
against removing only `where` and `signal`; that partial mutant was not run.

The coverage map assigns exact Router/Start versions, hydration of the emitted
stream in a browser, Collection resume/refetch, and cancellation across SSR to
a future Start integration owner. Subset and pagination oracles own predicate,
order, and cursor meaning. These remaining paths are outside this bounded
serialization claim.
