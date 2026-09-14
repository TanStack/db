# Ground-condition probe: combined full results

Completed 2026-09-11. Kyle authorized the disposable PGlite comparison and asked to examine its boundaries. This is a Ground-condition probe with an executed experiment; no additional Real-world check or Design Grammar was run.

**Bounded result:** The tested representation reconstructs all three results correctly within its declared range. Overlap changes its value: shared rows save bytes when results overlap, while references add bytes when they do not. Combining SQL and sharing the response are separate choices, and one database call is not always faster in this local test.

## What the candidate does

The baseline already returns all three results in **one mutation response**. This experiment adds no client round-trip saving to that baseline. It examines the server work and response representation inside that one response.

| Lane | Server evaluation | Experimental response |
| --- | --- | --- |
| Independent | Three independent SQL queries | Three complete ordered result arrays |
| Combined | One statement materializes a shared orders/customers join, then evaluates each query against it | The same three complete arrays |
| Shared | Exactly the Combined statement, followed by server-side row deduplication | One row pool and an ordered reference list for each collection |

Conceptually, if A needs rows X,Y and B needs Y,X, a shared payload can say:

```json
{
  "rows": [{"id":"X"}, {"id":"Y"}],
  "collections": [
    {"id":"A", "refs":[0,1]},
    {"id":"B", "refs":[1,0]}
  ]
}
```

The example abbreviates the row fields. References preserve each query's membership and order, including empty lists. The client follows those references; it does not guess filters or ordering from the row pool. This is result decoding, not a replacement for the user's DB-query requirement for client filtering.

This candidate first computes full results, then deduplicates them. It does **not** avoid producing repeated rows inside the SQL JSON result. That is an explicit limitation of the tested mechanism, chosen so Combined versus Shared changes only the response preparation/representation step. The SQL uses a shared join input; it does not join the three result lists to one another.

## Frozen conditions and matched boundary

The preparation was recorded before implementation in Field Log run 7. The ordinary case has three queries over the same bucket of orders. They join customers to project the customer label and use different orders and limits. The boundary case changes only the latter two bucket parameters so the queries select disjoint buckets.

At each size, both cases use the same database contents and SQL shapes. Buckets have equal row counts. Query 0 returns the whole selected bucket ordered by rank and ID; query 1 returns 80% ordered by descending rank and ID; query 2 returns 50% ordered by descending amount and ID. IDs break ties. All three select the same fields. Sizes are 10, 100, and 1,000 rows per bucket, with three buckets and nine customers.

- **Dynamics:** Evaluate full authoritative query results, encode them, then reconstruct each ordered result.
- **Constraints:** Stable identity within one scope, identical projected values for a shared row, exact per-query membership/order, and unchanged database state during each comparison. The candidate refuses conflicting rows with the same key; that guard is not a general query compatibility analyzer.
- **Boundary conditions:** Result overlap and result size. Row width is held at a 96-character synthetic customer label. Compression, query selectivity, support for unique output keys, and observation consistency remain separate conditions.

| Condition | Controller | Evidence and boundary consequence |
| --- | --- | --- |
| Result overlap | Query arguments and data | Measured: high-overlap cases have 1× bucket-size unique rows across 2.3× bucket-size result positions; disjoint cases have 2.3× unique rows. References cannot deduplicate disjoint output. |
| Shared evaluation work | SQL transformation and database execution | Executed plan: at the largest size the shared join produces 1,000 rows with overlap and 3,000 without. Each result still scans its CTE input and performs its own ordering. One statement does not remove those operations. |
| Compression | Transport encoding and data distribution | Measured gzip already compresses repeated full-array content. JSON savings substantially overstate compressed savings in some cases. |
| Compatible output identity and projection | Query/result contract | Enforced only for this specimen. Conflicting same-key projected values are refused. Arbitrary projections, many-to-many output identities, and cross-scope sharing are untested. |
| Usable observation boundary | Server transaction/protocol | Held fixed by allowing no writes between comparisons. No concurrent-snapshot or client-publication guarantee is inferred. |

## Executed correctness checks

The [rerunnable script](./result-sharing-probe.mjs) uses independent SQL statements as the reference, then compares Combined results and the JSON-round-tripped Shared reconstruction against them. No candidate-selected affected set enters the assertion.

- **30 generated histories, 131 mutation steps, 327 correctness checkpoints**, seed `912026`; no failure or shrinking. Each generated state is checked with overlapping and disjoint parameters. Operations include order upsert, deletion, bucket/rank/amount movement, and customer-label updates.
- **274 empty individual result observations** occurred across the correctness checkpoints.
- Explicit witnesses cover empty input, tied ranks, a customer update changing four untouched order results, and both movement and deletion requiring a replacement row in a limited result. The first witness setup was tightened before the final run because its limit initially included every row; it had shown departure but not replacement.
- Deliberately reversing a collection's order and dropping its membership were both detected. A conflicting same-key projection was refused.
- All three benchmark lanes were also checked against the reference during timing. Those additional comparisons are not included in the 327 correctness-checkpoint count.

The reference and candidate share the fixture and field projection definition. They do not share result-membership lists or SQL query generation. This can catch ordering, membership, join-result, limit, and reconstruction mistakes, but cannot independently establish that the common declared projection is the right product specification. This is not a general SQL optimizer oracle, compiler support classifier, optimistic-propagation test, or browser integration test.

## Measurements

Local in-memory PGlite 0.3.14, Node 22.13.1, Apple M1 Pro. Three warmups and 21 interleaved samples per lane/case. Total time includes database calls and JS result decoding, server payload preparation, JSON serialization, gzip, then local JSON parsing and reference reconstruction. It excludes network transfer, gzip decompression, browser collection application, and mutation work common to the alternatives. Small timing differences have no statistical confidence claim.

| Rows per bucket | Overlap | Full arrays, gzip bytes | Shared, gzip bytes | Independent total, median ms | Combined total, median ms | Shared total, median ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | High | 422 | 410 | 1.076 | 0.685 | 0.745 |
| 10 | None | 824 | 861 | 1.120 | 0.784 | 0.750 |
| 100 | High | 1,455 | 1,354 | 2.587 | 2.163 | 2.143 |
| 100 | None | 2,593 | 3,107 | 2.608 | 2.404 | 2.452 |
| 1,000 | High | 17,321 | 11,537 | 17.232 | 16.900 | 16.277 |
| 1,000 | None | 18,711 | 24,918 | 17.661 | 18.389 | 18.716 |

Independent and Combined have identical response bytes. At 1,000 rows per bucket, the high-overlap response shrinks about 33% with sharing; the disjoint response grows about 33%. At 100 rows with overlap, JSON falls from 40,231 to 18,218 bytes, but gzip falls only from 1,455 to 1,354 bytes. The compression control therefore changes the apparent benefit materially.

The largest disjoint case also changes the direction of the local time comparison: Combined is slower than Independent. This is one warm PGlite implementation, not a forecast for deployed PostgreSQL. The experiment does not isolate database network-call overhead or prove which plan a deployed server would choose.

Detailed per-stage medians/p95, payload sizes, version/source hash, correctness receipt, and combined execution plans are in [measurements](./result-sharing-measurements.json). Independent statements are explicit in the script. Reproduce from the repository root with `node probes/endpoints/design/result-sharing-probe.mjs` using existing dependencies; the script creates and closes its own in-memory database.

## Supported range and remaining choices

This comparison establishes a boundary in **benefit**, not a correctness failure within the tested range. Low overlap makes this shared encoding larger while exact reconstruction still passes. Different output identities or projections introduce a separate correctness/support boundary; this pass does not establish a general detector for it.

The observed results distinguish three conditional questions for the next grammar: can evaluations share work, can results share representation, and does either save enough under the actual cost conditions? Analyzability alone does not answer profitability. Independent full results remain available when either sharing step is excluded. No threshold, SQL rewrite family, wire format, or architecture is selected by this probe.

**Distortion:** Equal buckets, nine repeated customer labels, fixed projections, no concurrent writes, and warm local execution make this specimen cleaner than a general endpoint program. A materialized CTE plus post-query deduplication is only one candidate. Its losses must not become a claim against every combined-query or shared-payload design. The corrected witness and final rerun are disclosed; timing differences are not treated as statistically established winners.

The original aims remain: coherent active collections, explicit unsupported-analysis paths, immediate supported optimism, no hidden mutation queue, server/client separation, and fewer bytes and lower latency where demonstrated. None is settled by this encoding experiment. No second Design Grammar has run, and these now-visible examples cannot serve as fresh held-out evidence for it.
