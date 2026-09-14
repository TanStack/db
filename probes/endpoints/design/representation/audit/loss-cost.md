# Loss audit: result-sharing cost source

The reduction preserves separate safety and cost admission, full-result fallback, and limits on production and concurrency claims. It omits the source's measured overlap and compression reversals, its within-one-response comparison, and the work that its shared representation still performs. The implementation explicitly defers sharing. Its newer browser-delivery measurements answer a different question and do not contradict or replace the omitted experiment.

This readout records supported omissions and their dropping mechanisms. It does not judge their usefulness or decide whether to restore them.

## Scope and method

One isolated source pass under `reference/instruments/loss-audit.md`. Sole source output: [ground-conditions-result-sharing.md](../../ground-conditions-result-sharing.md), including its linked [result-sharing-measurements.json](../../result-sharing-measurements.json). Sibling earlier sources and other audit outputs were not read. The linked experiment script was not read or rerun; claims about that experiment are bounded by the supplied report and receipt.

Frozen reduction inspected: [grammar/model.md](../grammar/model.md), [grammar/preservation.md](../grammar/preservation.md), [grammar/brief.md](../grammar/brief.md), [implementation-draft.md](../implementation-draft.md), and [representation-wire-summary.json](../../../integrated-todo/evidence/representation-wire-summary.json). The allowed [oracle driver](../../../integrated-todo/tests/oracles/driver.mjs) was inspected only to resolve measurement units and timing boundaries. No production files changed.

Pointers below use source/reduction line numbers at inspection. JSON pointers use zero-based array positions. `S` means the source Markdown; `J` means its measurement receipt; `M`, `P`, `B`, `I`, `W`, and `D` mean the model, preservation contract, brief, implementation draft, wire summary, and driver respectively. All are linked above.

“Compression” and “category mismatch” below describe the observable reduction, not a claim about the author's intent. The inspected artifacts establish where detail is absent, but not a private historical decision to remove it. No majority-agreement mechanism can be established from this isolated pass.

## Source ledger and disappearance trace

### C1 — Browser request count, database call count, and representation sharing are different controls

**Source support:** S:9–15 and J:`/controls/lanes`: all three lanes already deliver one mutation response. Independent uses three SQL calls; Combined uses one statement and returns the same full arrays; Shared uses that exact Combined SQL followed by row deduplication. J:`/measurements/*/lanes/*/databaseCalls` records 3/1/1. The source claims no client round-trip saving.

**Reduction trace:** M:25 and B:11 retain separate SQL/encoding admission. I:38–47 instead compares inline delivery with client refetch: one versus three browser requests for two queries. Neither I's cost section nor M's R9 carries the old matched baseline or identifies the earlier 3/1/1 figures as database calls.

**Disposition/mechanism:** Partial preservation; omitted empirical control through compression and replacement of the comparison category. This is not a measured regression. The current table correctly labels browser requests, so it does not itself conflate the units. The absent distinction is that the earlier SQL/encoding result held browser delivery fixed.

### C2 — The measured byte advantage reverses with overlap while reconstruction remains correct

**Source support:** S:37,45,69–76,84; J:`/measurements/4` and `/measurements/5`. At 1,000 rows per bucket, each case has 2,300 result positions. High overlap has 1,000 unique result rows and gzip falls 17,321→11,537 bytes (about 33%); disjoint output has 2,300 unique rows and gzip grows 18,711→24,918 bytes (about 33%). The source's correctness checks pass in both cases. Sizes 10/100/1,000 and both overlap settings were exercised.

**Reduction trace:** M:25 retains “cost more,” P:13 separates safety and benefit, and B:11 preserves the abstract principle. No inspected grammar file names overlap or its observed sign reversal. I:38–47 uses one fixed workload and no shared representation, so its near-equal decoded byte counts do not retest this boundary.

**Disposition/mechanism:** Supported empirical distinction omitted by compression into generic cost admission. Sharing implementation is explicitly deferred at I:47; that deferral is separate from the missing existing measurement.

### C3 — JSON savings and gzip savings can differ sharply

**Source support:** S:41,47,65,76; J:`/measurements/2/lanes/{combined,shared}`. At 100 rows with overlap, JSON falls 40,231→18,218 bytes (about 54.7%), whereas gzip falls 1,455→1,354 bytes (about 6.9%). The 96-character synthetic labels and repeated customer labels are controlled fixture properties, not a row-width or entropy sweep (S:37,41,88).

**Reduction trace:** M:25/P:13/B:11 retain cost admission without a compression condition. I:40 correctly says “Decoded response body bytes”; I:47 explicitly excludes compression. W's `responseBytes` has no standalone compression/decoded-body label. D:372–379 measures response body buffers and POST data rather than packet or header sizes. The current receipt does not provide compressed bytes.

**Disposition/mechanism:** Compression-sensitive benefit and its fixture dependence are omitted through generic cost compression and a change of measured unit. The implementation prose preserves its own body-size limit, so there is no supported claim that it reports transferred compressed bytes. The JSON summary depends on that surrounding prose for the limit.

### C4 — Combining execution retains scans, sorts, and repeated SQL result production

**Source support:** S:31,46; J:`/measurements/4/combinedPlan/0/QUERY PLAN/0/Plan` and the corresponding `/measurements/5` plan. The shared CTE produces 1,000 rows for overlap and 3,000 for disjoint parameters. Each result has its own CTE scan and sort; in the disjoint plan each scan returns 1,000 rows and removes 2,000 by filter. SQL still constructs all repeated full result rows before the Shared lane deduplicates them in JS. This candidate shares a join input, not joins between result arrays.

**Reduction trace:** M:25/36 and B:11 retain “share SQL” and “shared result encoding” as options. They omit which work the measured candidate shared and which work remained. I:47 says shared SQL and deduplication are not implemented.

**Disposition/mechanism:** Explicit implementation deferral, plus omitted candidate mechanism and residual work through abstraction. No inspected text falsely says one statement eliminates all per-query work.

### C5 — One SQL call was locally slower in the large disjoint case

**Source support:** S:65,74,78,88; J:`/measurements/5/lanes`. Local total medians are Independent 17.661 ms, Combined 18.389 ms, Shared 18.716 ms. Query-stage medians are 14.456, 15.592, and 15.611 ms. These are warm local observations without a statistical winner claim. The experiment does not isolate database network-call overhead or predict a deployed PostgreSQL plan.

**Reduction trace:** P:16 and I:47 preserve no production speed claim; M:25 allows full results when optimizations cost more. The concrete direction reversal and distinction between database-call overhead and query work disappear. I:42–47 instead reports lower harness elapsed for fewer browser request phases in its fixture.

**Disposition/mechanism:** Empirical reversal omitted through compression and a changed benchmark category. The source does not support rejecting every combined-query plan, and the reduction does not make that rejection.

### C6 — The two timing columns called local elapsed measure different work

**Source support:** S:65,80 and J:`/controls/timing`, `/host`, `/versions`, `/measurements/*/lanes/*`. Original measurements use PGlite 0.3.14, Node 22.13.1, Apple M1 Pro, three warmups, and 21 interleaved samples per lane/case. Stages are query including JS decoding, payload preparation, serialization, gzip, and local parsing/reconstruction. Each has median/p95/sample count. Total excludes network, gzip decompression, browser collection application, and common mutation work.

**Reduction trace:** I:38–47/W report three fresh sequences per strategy, total elapsed, request/response bodies, and optional 50 ms request delay. D:432–440 starts elapsed before oracle arming and visible-reference application; D:575–604 ends after the settled checkpoint and response-body collection. Thus current elapsed includes control/oracle/browser work that the source excludes. D:345–361 injects delay before each browser fetch POST, not into the database call. I:47 states the instrumentation and simulated-delay limits but does not map the old timing boundary to the new one. W alone omits these limits and any p95 or stage breakdown.

**Disposition/mechanism:** Both reports bound their own times; no direct comparability claim was found. The original measurement decomposition is absent through benchmark replacement. Milliseconds alone do not make the two elapsed columns comparable. No missing p95 is inferred to invalidate the current three-sample result.

### C7 — Shared-row support requires output compatibility, not just matching entity keys

**Source support:** S:29–31,40,48,58,84; J:`/controls/supported`, `/controls/excludes`, `/correctness/controls`. Sharing is supported for identical scoped projections with unique order IDs and a many-orders-to-one-customer inner join. Conflicting same-key values are refused. References carry exact membership, order, and empty results. The conflict guard is not a general compatibility analyzer. Many-to-many multiplicity, arbitrary projections, and cross-scope sharing remain untested.

**Reduction trace:** M:7/23, P:10/15, and B:9 retain general identity/result support; M:36 names shared encoding without its output-compatibility contract. I:51–52 explicitly narrows implementation to full-row Todo queries and excludes joins, complex projections, codecs, and collations.

**Disposition/mechanism:** General support law preserved and broader implementation explicitly deferred. Encoding-specific same-key conflict behavior, many-to-many output identity, and ordered-reference contract disappear through category mismatch with the ownership grammar. They were not refuted.

### C8 — Decoding a shared result is not query evaluation or shared client support state

**Source support:** S:29–31,39: authoritative ordered lists are already computed. The client follows references without deriving membership or order from the pool. This mechanism does not satisfy the separate requirement to use DB queries for client filtering.

**Reduction trace:** M:32–36 distinguishes separate-result and shared-support ownership forms and explicitly permits result encoding in either form. I:7 identifies DB expression evaluation for optimistic membership. The source's operational distinction between ordered-reference decoding and query evaluation is absent, although the grammar preserves its consequence that encoding is not a third ownership form.

**Disposition/mechanism:** Partial preservation; concrete decoding boundary omitted through abstraction. No evidence of an asserted equivalence between decoding and local query evaluation.

### C9 — Reconstruction evidence has a separate scope and count from coherence evidence

**Source support:** S:53–61 and J:`/correctness`: 30 histories, 131 mutation steps, 327 checkpoints, 274 empty individual-result observations, seed 912026; no failure or shrink. Tests compare independent SQL with Combined and JSON-round-tripped Shared, without candidate-selected affected sets. Reversed order and lost membership are detected, conflicting same-key values refused. Witnesses include unchanged orders affected by a customer update and top-k replacement after movement/deletion. The replacement fixture was corrected before the final run. Shared fixture/projection definition limits oracle independence; this does not test compiler classification, optimism, browser publication, or general optimization.

**Reduction trace:** B:13/P:16 preserve limits on analytical controls and independent range. I:26–34 introduces a different coherence oracle and its own receipts/counts; none of the original counts or controls survive. I:51–55 explicitly excludes joins/top-k and concurrent claims. Those exclusions concern this executable slice, not a denial that the old encoding specimen reconstructed joined/limited results.

**Disposition/mechanism:** Prior evidence receipt and narrower proof target omitted through focus on current implementation evidence. Explicit unsupported implementation range remains. This pass does not identify a false correctness assertion or claim the current oracle must cover unimplemented sharing.

### C10 — Observation and deployment limits survive

**Source support:** S:40,49,61,65,78,88–90; J:`/controls/isolation`, `/controls/excludes`, `/scope`: no concurrent writes, no common-snapshot or browser-publication inference, one warm local candidate, no production or general analyzer claim, no fresh held-out evidence from now-visible examples.

**Reduction trace:** M:28/41/43–46, P:16, B:13, I:47/51–55 explicitly retain these kinds of boundaries. The source's exact fixture distortions remain absent, recorded under C3/C6/C7/C9.

**Disposition/mechanism:** Preserved at the claim level; no hidden loss of the concurrency or production disclaimer. Current broader browser evidence has its own boundary and does not purport to retroactively expand the earlier experiment.

### C11 — No threshold or architecture was selected; full results remain legal

**Source support:** S:84–86: compatibility, shared work, shared representation, and profitability require separate answers. No threshold, SQL rewrite family, wire format, or architecture is selected. Full independent results remain an available fallback.

**Reduction trace:** M:21/25/30–36 and B:7/11 preserve full results, unranked ownership forms, and separate optimization admission. I:15 discloses selection of one ownership form under implementation authorization; I:47 explicitly defers SQL/encoding optimizations. No profitability threshold or compression scheme is presented as validated.

**Disposition/mechanism:** Preserved principle and explicit later implementation choice. No hidden architecture selection can be inferred from this source pass.

### C12 — Cost aims remain conditional alongside the other product aims

**Source support:** S:90 retains coherence, explicit unsupported paths, immediate supported optimism, no hidden mutation queue, server/client separation, and fewer bytes/lower latency where demonstrated. It says the encoding experiment settles none of those wider aims.

**Reduction trace:** M:17–26/P:5–16/B:3–13 carry those aims and boundaries; I reports a bounded implemented slice and says full-result delivery saves no substantial payload bytes in the new fixture (I:47). The source's conditional cost aim survives even though the supporting old byte/cost boundaries do not.

**Disposition/mechanism:** Preserved; no hidden loss assigned.

## Measurement-unit control

| Quantity | Source experiment | Current implementation evidence | Limit preserved in reduction? |
| --- | --- | --- | --- |
| Calls | Database calls: 3/1/1; client response count fixed at one | Browser fetch POST count: 1 inline, 3 refetch | Current table labels browser requests correctly; the old fixed-delivery control is omitted. |
| Response size | Experimental JSON and gzip bytes; explicitly not Start wire protocol (`J /controls/payload`) | Decoded response-body bytes from `response.body()`, 106,069 vs 106,010 | I:40/47 labels decoded bodies and excludes headers/compression; W alone omits those units. |
| Request size | Not the measured source comparison | POST-body bytes summed per operation, 562 vs 755 | I labels request bodies; D:378–380/602 supports body-only sums. |
| Time | Warm local query/encoding/reconstruction, including gzip, excluding browser application and common mutation work | Harness elapsed through browser/oracle checkpoints, three sequences per strategy | Both bounded in prose; not directly comparable; old stages/p95 absent. |
| Added delay | No measured network transfer or isolated DB-network overhead | 50 ms before each browser fetch POST | I:47 explicitly calls it injected delay rather than measured RTT. |
| Workload | Three joined/limited results, overlap/disjoint, 10/100/1,000 rows per bucket | Two full-result queries over 200 rows, same fixed edit | Different workload stated; old overlap and compression controls omitted. |

The source receipt preserves both JSON and gzip measurements and all six cases. The current summary preserves exact browser request counts and body totals but relies on the draft and driver for measurement boundaries. Its filename does not establish transferred wire bytes.

## Readout boundary

The recovered material is concentrated in C1–C9: concrete experiment controls, overlap/compression reversals, retained server work, output-compatibility limits, and distinct measurement/proof targets. The reduction carries the general laws and openly defers sharing. This is evidence compression and a shift to another cost question, not evidence that the current implementation violates the earlier experiment's contract.

No ranking, restoration decision, code change, or new benchmark was made. One source pass is complete.
