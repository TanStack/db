# No-peek experiment: result and limits

The narrow design works in the tested domain. An authoritative continuation
fact can replace the extra output row when the backend prefix maps directly to
the published query prefix. It is not safe as a collection-wide boolean.

This is test-only experimental code, validated on merge head `3c54e89ae` with
rebuilt core and db-ivm packages. No production changes or public API are added.

## Measured benefit

For a three-row UI window and three-row backend pages over nine rows:

| Path                                         | Initial output demand | Backend page calls | Displayed rows | Has next |
| -------------------------------------------- | --------------------: | -----------------: | -------------- | -------- |
| Current production window controller         |                     4 |                  2 | 0, 1, 2        | true     |
| Experimental session and narrow graph bridge |                     3 |                  1 | 0, 1, 2        | true     |

Both paths use the same opaque-page adapter logic and real collection graph.
These are request counts, not latency or bundle-size benchmarks. When the
backend page already contains the extra row (page sizes four or fifty in the
protocol comparison), both paths make one call. At authoritative exhaustion
after exactly three rows, both make one call too: the cursor adapter already
knows it has reached the end, even if the loader requests a further slice.

## The independent oracle

The model remains the full relation filtered, sorted and sliced, with next-page
truth determined by its total length. It has no cursors, stamps, lease state or
fallback state. The transport fixture derives its continuation only from opaque
backend pages and its retained tail, not from that model.

Generated histories vary source size, filter, direction, backend page size,
consumer count/window size, peer release and metadata omission. Every session
publication is checked against each consumer's reference window. Fixed probes
add reset during held delivery, missing/mismatched facts, fact-only changes,
metadata withdrawal, acquisition/fallback failure and healthy peer recovery.

## What the failures taught us

The first candidate used the latest response's `hasMore` for all consumers and
treated missing metadata as false. It failed seven of nine tests. Seed `863`
shrunk one failure to two source rows, backend page size one, a one-row window,
and missing metadata. It incorrectly announced the end.

The tested repair has four rules:

1. A real output row beyond a consumer's window proves continuation, regardless
   of a deeper consumer's terminal fact.
2. Otherwise, accept only a fact for the same complete publication and matching
   prefix boundary, with a transparent source-to-output mapping.
3. Missing or inapplicable facts acquire `N+1`. Keep this requirement on that
   consumer's lease, so a peer's departure cannot silently remove its witness.
4. A new continuation fact changes the session snapshot even if rows are equal.
   Do not publish response-time metadata while the corresponding output is held.

Reset rejects old-generation completions. Failed requests preserve the previous
snapshot and do not poison later reads. These are rules of the test candidate;
they are not new guarantees supplied by the current production API.

## Real production boundary tested

The integration probe runs an on-demand source through a real live query. The
test-only bridge admits its fact after `setWindow` and `preload` complete, and
reads actual public rows. It compares the candidate to the unchanged production
window controller for source sizes zero, three, four and nine. A held transport
response proves no candidate snapshot is published merely because the fact has
arrived. The bridge is deliberately restricted to an immutable source with a
unique-id order. It supports the loader's offset and id-equality refinements.

An opaque local filter preserves order but changes membership: the raw source
prefix says more rows exist while the complete filtered query has no next page.
The ineligible candidate correctly requests `N+1` output rows. The existing
compiler chooses full-source loading for this filter; the experiment does not
replace that path or claim it is cheap.

## What remains unproven / unimplemented

- Generic eligibility detection. Matching order alone is insufficient. The
  backend must also describe the same result membership and row cardinality.
  Joins, aggregates, local filters and optimistic changes require rejection or
  an independently justified transfer rule. Simple one-to-one projections need
  not be excluded merely because field names change.
- General fact transport through QueryCollection, graph refinement and shared
  window publication. The bridge here is test-only and manually scoped; it is
  not production metadata plumbing and does not cover mutable multi-source
  graphs or all response/application interleavings.
- Automatic metadata-only notification and snapshot-cache invalidation in the
  existing framework controller. The candidate demonstrates the required law;
  the current controller still derives continuation solely from output rows.
- Automatic invalidation on local writes/refetch and ownership/cleanup wiring.
  The protocol tests explicitly drive refresh and reset. They do not prove that
  all production events trigger those actions.
- Incorrect backend claims or incomplete load fulfillment. A successful public
  prefix must still obey the existing request-completion contract. A `hasMore`
  flag is not a remedy for arbitrary adapters silently returning partial data.

The prototype's publication stamp is a test identity witness, not a proposal
for a new global token registry. Production should reuse existing publication
and ownership boundaries where possible. Its small controller is not a full
replacement for the production controller's lifecycle and error handling.

## Verification

- First red: seven assertion failures, two passes; no setup failure or timeout.
- Final fixed-seed campaign: all 66 tests across both experiments passed.
  The new no-peek property ran 15,000 histories at multiplier 100, seed `863`;
  the preceding cursor experiment ran another 35,000 generated cases.
- A separate default random-seed run covers the no-peek files.
- Package TypeScript and lint on all experiment TypeScript passed.

From `packages/query-db-collection`:

```sh
TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=100 TANSTACK_DB_ORACLE_SEED=863 \
  ../../node_modules/.bin/vitest run \
  tests/cursor-pagination.no-peek.test.ts \
  tests/cursor-pagination.no-peek.integration.test.ts \
  tests/cursor-pagination.oracle.test.ts \
  tests/cursor-pagination.integration.test.ts \
  --typecheck.enabled=false --maxWorkers=1
```

Recommendation: retain the cursor adapter independently. If proceeding with
no-peek, start with explicitly eligible single-source queries, publication-bound
facts, and per-consumer fallback. Do not implement the original global setter
shortcut, and do not build a general metadata/coverage platform for this benefit.
