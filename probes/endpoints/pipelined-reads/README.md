# Pipelined refresh reads

This experiment runs the existing Endpoints refresh helper against networked PostgreSQL. It tests whether independent full reads can share one connection without waiting for each preceding result. It adds no application cache, write queue, SQL rewrite, database extension. It now checks the shared prototype Postgres.js adapter used in ordinary server database setup.

[RESULTS.md](RESULTS.md) records the measured outcome. [Oracle evidence](evidence/oracle.json) and [benchmark evidence](evidence/benchmark.json) retain the raw checks, seeds, samples, protocol counts and limits.

## Reproduce

Use Node 22 with type stripping, or a newer compatible Node. The harness uses only the disposable database at `127.0.0.1:55479/endpoints_pipeline`. It drops and recreates its fixture tables there. Do not point it at application data. The trust authentication below is for this local disposable container only.

```sh
docker run --detach --rm --name endpoints-pipeline-e079 \
  --publish 127.0.0.1:55479:5432 \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --env POSTGRES_DB=endpoints_pipeline postgres:17-alpine
```

Wait for `docker exec endpoints-pipeline-e079 pg_isready -U postgres -d endpoints_pipeline` to succeed. In this directory:

```sh
npm ci --ignore-scripts
npm run test:adapter
npm run typecheck
npm test
npm run bench
```

The oracle and benchmark run sequentially. Afterward:

```sh
docker stop endpoints-pipeline-e079
```

Configuration: `PIPELINE_SCENARIOS` (default 20), `PIPELINE_HISTORIES` (3), `PIPELINE_SEED` (20260912), `PIPELINE_PATH` (fast-check replay path) and `PIPELINE_SAMPLES` (20 benchmark samples). The checked-in shrunk JSON parameter replay runs with every oracle campaign. Keep scenario/history settings unchanged when replaying a seed/path.

The following negative control deliberately drops one pipelined result and **must exit with failure**:

```sh
PIPELINE_MUTANT=drop-result PIPELINE_SCENARIOS=2 npm test
```

Its report is separate from the passing oracle report. An expected failed control is not a passing test campaign.

## Adapter and controls

- `adapter.mjs`: Postgres.js 3.4.9, parameterized extended-protocol queries and normal result decoding. The existing refresh helper still invokes the mutation once, then schedules full reads with `Promise.all` and its existing read retry policy.
- `drizzle.mjs`: Drizzle 0.45.1 query builders and mappers, using the shared [Postgres.js adapter](../integrated-todo/POSTGRES-ADAPTER.md), which enables prepared execution by default. It preserves Drizzle mapping and the app pool. The unadapted path remains a test baseline.
- `oracle.mjs`: N generated scenarios × X histories. Six adapter paths read the same operations independently checked against PGlite SQL. Generated filters, joins, grouping, order, limits, empty results, NULLs, dates, exact numeric strings, JSON and quoted/non-ASCII text remain in scope. Read failures cover every position in a three-query response; committed handler failures remain distinct from read failures.
- `wire.mjs`: local plaintext PostgreSQL proxy. It counts Execute messages sent before prior ReadyForQuery replies, connections and protocol bytes. It adds a fixed one-way delay without logging SQL, rows or parameters. It does not simulate bandwidth, loss, TLS or production load.
- `benchmark.mjs`: three modes, alternating measurement order, separate cold samples, every query signature explicitly warmed on every pooled connection, and an assertion that measured warm samples contain no Parse messages. It measures mutation-through-confirmed-envelope latency, including driver row decoding and server same-response encoding. It does not measure client decoding, browser rendering or HTTP transport.

| Mode           | Maximum connections | Extra queued pipeline capacity |
| -------------- | ------------------- | ------------------------------ |
| Serial control | 1                   | 0                              |
| Pipeline       | 1                   | 100                            |
| Pool control   | 3                   | 0 per connection               |

These are test configurations, not recommended production pool sizes. The queue is the PostgreSQL driver's normal connection scheduling, not a new Endpoints mutation queue. No transaction wrapper was introduced around the reads: each retains ordinary statement snapshot semantics.

The prototype has no pipelining flag or separate read client. Driver settings are passed through; serial and unadapted modes exist only as measurement controls.

## Evidence boundaries

This adapter oracle uses the actual server refresh helper and response encoder. It does not instantiate the browser optimistic/authority state machine, which remains unchanged. Existing refresh, encoding and compiler boundary tests were also checked. Wider deployment testing still needs pool contention, disconnects/cancellation, other drivers and transaction modes, arbitrary query/codec support and the full browser oracle through this network adapter.

Pipelining avoids some waits; it does not make queries execute in parallel on one backend or reduce the rows read. A pool may outperform it for slow independent queries. Parameterized cold queries can need a description exchange before execution; warm prepared-query results cannot be presented as cold-query performance.

Compression remains an app-server concern. This experiment adds none.

## Sources

- [Postgres.js transaction pipelining and reserved connections](https://github.com/porsager/postgres#transactions). The experiment instead uses its ordinary pool scheduler, with configuration verified in installed 3.4.9 `src/index.js` and `src/connection.js` and observed on the wire.
- [Installed Drizzle 0.45.1 PostgreSQL session](node_modules/drizzle-orm/postgres-js/session.js), available after `npm ci`. The session calls `unsafe(query, params)`; Postgres.js defaults that call to unprepared. The installed Drizzle driver also owns date/JSON serialization, which is why the wrapper retains its mapping path.
- [PostgreSQL pipeline concepts](https://www.postgresql.org/docs/17/libpq-pipeline-mode.html). This supplies protocol context, not a claim that Postgres.js uses libpq or has the same API.
