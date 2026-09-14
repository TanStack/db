# Pipelined reads: results

**Pipelining removed waits between small full reads without a new Endpoints scheduler.** In this experiment it used one PostgreSQL connection and approached a three-connection pool's latency. It did not reduce result rows or browser response bytes. Slow independent reads still benefited from multiple backend connections.

## Latency

Postgres.js 3.4.9, v24.5.0, PostgreSQL 17.6 in a disposable Docker container. The table shows median milliseconds from mutation start through the existing refresh helper's confirmed response, with **20 ms nominal injected RTT** (10 ms proxy delay in each direction). Host timer scheduling and base Docker latency are additional; this is a controlled network-delay experiment, not a WAN measurement. Each cell has 20 warm samples; order rotates. Cold samples and p95 values are in [raw benchmark evidence](evidence/benchmark.json).

| Result size / server delay | Refresh queries | One connection, no pipeline | One connection, pipeline | Three-connection pool |
| -------------------------- | --------------- | --------------------------- | ------------------------ | --------------------- |
| 10 rows                    | 1               | 55.8                        | 55.1                     | 54.4                  |
| 10 rows                    | 2               | 76.2                        | 51.7                     | 53.1                  |
| 10 rows                    | 3               | 106.5                       | 53.2                     | 55.2                  |
| 1000 rows                  | 1               | 53.8                        | 55.2                     | 54.9                  |
| 1000 rows                  | 2               | 89.8                        | 62.0                     | 63.5                  |
| 1000 rows                  | 3               | 120.7                       | 66.2                     | 65.9                  |
| 15 ms pg_sleep per read    | 3               | 169.0                       | 114.9                    | 75.9                  |

One read showed no useful pipelining advantage. Two and three small reads saved intervening waits. The 15 ms `pg_sleep` control models time spent waiting inside each query; it is not a CPU-load benchmark. It exposes the one-backend execution limit: pipelining sends requests ahead, while the pool can run independent statements concurrently.

Every warm sample asserted zero statement Parse messages. The harness explicitly warmed every signature on every pool connection so late routing could not charge preparation only to the pool. The proxy counted real PostgreSQL Execute frames outstanding before earlier ReadyForQuery responses: one for the serial control, up to three on one connection for the pipeline, and one per connection for the pool. Request and response protocol bytes, connections, and encoded refresh-envelope sizes are retained. All three modes returned equal decoded results and equal final envelope sizes for each case.

## Drizzle adapter

Drizzle 0.45.1's installed Postgres.js session calls `unsafe(query, params)`. In Postgres.js 3.4.9 that defaults to unprepared execution. A parameterized query then requires a description exchange before execution, and the driver pauses further query dispatch at that boundary.

The [Drizzle control](drizzle.mjs) preserves Drizzle query builders, parameter serializers and result mappers. The shared prototype [Postgres.js adapter](../integrated-todo/POSTGRES-ADAPTER.md) supplies `{ prepare: true, simple: false }` to the driver call. On the wire:

| Warm three-query Drizzle read                    | Default | Prepared wrapper |
| ------------------------------------------------ | ------- | ---------------- |
| Parse messages                                   | 3       | 0                |
| Maximum outstanding executions on one connection | 1       | 3                |

Both Drizzle modes passed the same generated value and ordering comparisons. Thus the measured raw-driver improvement is conditional on the ORM actually taking a pipeline-capable path. A named Drizzle prepared-query object alone does not establish this: the inspected session still makes the same driver call. Prepared execution is now the prototype adapter default, with one ordinary Drizzle database and no Endpoints optimization flag. It preserves existing driver settings. Transaction/reserved clients delegate unchanged; wider driver and pooler compatibility remains untested. The latency table above remains the original raw-driver measurement; it was not rerun for this promotion.

## Correctness

The [oracle](oracle.mjs) passed **1440 response comparisons**: 20 scenarios × 3 histories, 240 operation steps, repeated through six adapter paths. Each run starts from the same generated initial state. Expected results come from an independent PGlite PostgreSQL instance. The adapter query grammar uses native SQL; the three Drizzle paths use separate query builders for the same semantics.

Coverage includes full/filtered/top-k results, left joins, grouping, deletion, empty results, NULL ordering, quoted and Unicode parameters, exact numeric strings, dates, JSON, parent-table changes and intervening writes absent from the endpoint mutation. The existing Endpoints refresh helper and same-response encoder execute in the system under test.

Eighteen controls also passed: three native protocol checks, three Drizzle protocol checks (including the driver's global preparation setting), read failure in each of three positions across three driver configurations, and committed-then-failed handler reconciliation in each configuration. Failed reads exhausted the existing four attempts; successful sibling reads ran once; mutations ran once; subsequent queries worked. Existing refresh, compiler-boundary and snapshot-encoding tests passed **21/21**.

The [dropped-result mutant](evidence/oracle-drop-result.json) failed as intended. The initial run also caught a **fixture binding error**, not a PostgreSQL or DB bug: passing pre-serialized JSON into Postgres.js caused another JSON encoding. The fixture now supplies the native object; the [shrunk replay](replays.json) remains in every generated run. [Original red evidence](evidence/oracle-json-red.json) is preserved.

## Scope and disposition

The experiment now imports the shared prototype adapter. Adapter contract tests pass (including 100 generated argument cases and client/server build boundaries), as do adapter and Todo type checks. The original [checks manifest](evidence/checks.json) records the earlier experiment; [adapter checks](evidence/adapter-checks.json) record this follow-up. It adds no database installation, shared result cache, mutation queue or read-pruning logic. Compression remains the app server's concern. The disposable container was stopped and removed after the runs.

The experiment does not instantiate the browser optimistic/publication state machine, measure HTTP delivery/rendering, prove one common database snapshot, or cover all SQL shapes, external concurrency, disconnect/cancellation behavior, pool contention and driver variants. The retained snapshots are still complete fresh reads. Driver preparation can make their transport cheaper; it does not supply permission to omit reads or change authority rules.

[Reproduction and source notes](README.md) · [Oracle evidence](evidence/oracle.json) · [Benchmark evidence](evidence/benchmark.json)
