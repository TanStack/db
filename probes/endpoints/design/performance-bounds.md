# Performance bounds for reconciliation strategies

Requested during the design inquiry, 2026-09-11. This is a calculation plus a small local measurement, not a deployed benchmark or an oracle campaign comparing implemented strategies. [Raw measurements](./performance-measurements.json), [reproducible script](./performance-model.mjs).

## Separate the baselines

The present acknowledgement-then-refetch path has two sequential request/response phases. Multiple refetches can run concurrently; that does not require one RTT per query, though backend work and aggregate bytes still grow.

Returning complete affected query results **in the mutation response** also needs only one round trip. It is therefore a separate baseline from compact patches. A delta scheme should not receive credit for an RTT saving that the inline-full-result baseline also obtains.

Use this simplified warm-connection model:

```text
R       = network round-trip time
W       = common mutation execution cost
Q       = effective server critical-path work to produce the full affected results
A       = server critical-path work to identify recipients and produce update data
F, D    = transferred full-result and delta bytes
V       = transfer rate in bytes per millisecond
Cf, Cd  = client application and publication work

client refetch:       2R + W + Q + F/V + Cf
inline full results:   R + W + Q + F/V + Cf
compact update:        R + W + A + D/V + Cd
```

Against client refetch, the compact path has room for:

```text
A - Q < R + (F - D)/V + Cf - Cd
```

Against inline full results, the condition is stricter:

```text
A - Q < (F - D)/V + Cf - Cd
```

These inequalities bound **extra server time beyond producing full results**, not total server time. They omit request sizes, framing, connection startup, compression CPU, streaming overlap, queueing, and retries. They are a model for locating measurements, not a claim of exact network behavior. “More server work is almost always faster” cannot follow without bounding that work and choosing the comparison path.

## Local measurements

Host: Apple M1 Pro, Node 22.13.1, PGlite 0.3.14. Warm in-memory database; primary-key index only, matching the prototype's absence of a createdAt index. Each query received three warmups and 21 timed repetitions. Timing includes JS decoding; it excludes ORM, browser and network. The p95 estimate from 21 samples is descriptive, not a stable tail estimate.

Each synthetic Todo contains a UUID, boolean, timestamp, and twelve words chosen deterministically from a 24-word vocabulary. Compression may be better than real user text. Payloads are plain JSON bodies, **not measured Start wire envelopes**. The compact example is one full row plus illustrative mutation/revision metadata and deleted-key list; it assumes that data is sufficient for the recipient.

| Rows in full result | Plain full JSON | Gzip full body | Gzip one-row body | Full-query median / sample p95 | Filtered-query median | One-row UPDATE RETURNING median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 19,443 B | 4,822 B | 218 B | 0.98 / 1.24 ms | 0.73 ms | 0.37 ms |
| 1,000 | 194,604 B | 43,096 B | 218 B | 5.29 / 20.32 ms | 3.53 ms | 0.33 ms |
| 10,000 | 1,945,093 B | 423,861 B | 218 B | 44.17 / 55.23 ms | 29.20 ms | 0.29 ms |

The update timing is context for a simple server operation; it is **not** a measurement of an impact classifier, complete mutation-footprint capture, delta generation, or reconciliation. None of those proposed implementations exists yet.

## Illustrative break-even budgets

Below, RTT is an assumed 50 ms, bodies use the measured gzip sizes, and client application costs are assumed equal. The script also calculates assumed RTTs of 5 and 150 ms. These are scenario inputs, not measurements of deployment networks.

| Rows | Assumed bandwidth | Maximum extra server work vs client refetch | Maximum extra server work vs inline full result |
| --- | ---: | ---: | ---: |
| 100 | 100 Mbps | 50.37 ms | 0.37 ms |
| 100 | 10 Mbps | 53.68 ms | 3.68 ms |
| 1,000 | 100 Mbps | 53.43 ms | 3.43 ms |
| 1,000 | 10 Mbps | 84.30 ms | 34.30 ms |
| 10,000 | 100 Mbps | 83.89 ms | 33.89 ms |
| 10,000 | 10 Mbps | 388.91 ms | 338.91 ms |

For the 100-row/100-Mbps case, compact updates save little transfer time against an inline full result. A sophisticated classifier/differ can lose that margin. For 10,000 rows on the assumed 10-Mbps link, avoiding the large body creates a much larger allowance. This is sensitivity to payload and network assumptions, not an architecture ranking. A patch derived cheaply from already available mutation output may also avoid Q; a patch found only after requerying must pay that query work.

“Small payload” is data-dependent. A one-row source mutation can affect many joined results or many active queries. Payload duplication, result encoding, gzip, client query work, and recipient discovery must all be counted. A conservative recipient superset may be cheaper than proving the mathematically smallest set.

## Paired oracle/performance comparison contract

This is a proposed evaluation design, not an implemented test change.

1. Freeze the same generated program, initial data, operation sequence, server transformations, and failure schedule. Run each implemented strategy from an independent reset against the same independent PG reference.
2. Check **all active collections** at optimistic and authoritative boundaries, including those the strategy classified unaffected. Correctness cannot depend on its own target-selection output. Keep sync error/recovery cases separate from successful-sync comparisons under the user's corrected requirement.
3. Record optimistic recipient selection/local edits separately from authoritative recipient selection/payload choice. Diagnose missed targets separately from wrong patches. Count conservative extra targets as work, not automatically as correctness failures.
4. Compare acknowledgement + parallel refetch, inline full query results, mutation-effect updates, and server-computed query deltas where implemented. A full result returned in the mutation response is not a delta even when it avoids a second request.
5. Measure complete request and response bytes under the actual serialization/compression, request counts, mutation-to-coherent-success latency, p50/p95 across enough samples, synchronous optimistic application time, server query count/rows/work, and client apply/publication work. Fast failures do not count as low-latency successful synchronization.
6. Keep compilation, initial hydration, warmup, and artificial correctness gates outside the mutation timing window. Use a separate controlled network pass with the same semantics. Hold warm/cold state, connection reuse and network settings fixed across paired runs; report loaded-backend effects separately.
7. Vary result size, row width, number of active queries, overlap, affected fraction, query/mutation shape, projections, window boundary movement, and backend/client/network cost. Current oracle generation covers only the narrow Todo subset; the extra dimensions are future work.

No threshold or winner is selected here. These measurements and bounds identify where extra design complexity can erase its own byte or round-trip savings. Production CPU saturation, memory/retention cost, and maintainability remain unmeasured even if a local latency test passes.
