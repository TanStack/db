---
type: field-log
format: field-log/v1
event-stream: ./field_log.jsonl
generated-through: 424
title: "Endpoints: optimistic coherence and update delivery"
opened-at: 2026-09-11T16:54:36.780Z
updated-at: 2026-09-14T17:15:14.602Z
---

# Endpoints: optimistic coherence and update delivery

> Infer dependencies from visible SQL and supported schema effects. Explicit refresh requirements and general JS/auth-library call following are deferred. Kitchen's application code moves its SQL into endpoint handlers while preserving auth, validation, transactions, and execution order; no compiler-generated auth changes. Preserve authority for optimistic recipients and missing baselines across all retained collections. Inspect schema only at compilation, install no tracking infrastructure in application PostgreSQL, keep server code off the client, and leave external freshness to polling/events/sync. Kyle asks for a deterministic, mathematically grounded way to assess individual optimizations, avoiding both stale browser data and unnecessary restrictions. Broad PostgreSQL generation follows the Kitchen port. Research Survey and Design Grammar are being recommended for the effect-rule design; neither has been selected or run in this exchange.

## Opening question

What information and lifetime contracts let Endpoints discover affected active collections and update them correctly, optimistically and authoritatively, at a cost that beats simple full-result delivery?

## Current working question

What shared SQL/query-mutation representation can generate coherent guessed overlays and sufficient server/client update plans for every affected non-garbage-collected collection, with explicit unsupported exits and inline full-result fallback?

## Open Questions

- **How should query dependency metadata and the registry of non-garbage-collected instances handle collection creation and garbage collection while mutations are pending?**
- **Which query/mutation pairs have enough local support to evaluate the client guess coherently, and what is the behavior when that calculation is unsupported?**
- **How can authoritative effects include server transformations and indirect writes, and when should delivery use row effects, result deltas, inline full results, or refetch?**
- **What observation baseline and publication rule handles stale responses and mixed patch/refetch results without an implicit mutation queue?**
- **Which generated storage forms survive independent range tests, including projections, joins, scope isolation, and inverse writes?**
- **How should the oracle compare identical histories for correctness, bytes, server work, and latency against both refetch and inline full-result baselines?**
- **What rows and pending optimism should the UI retain after exhausted read retries while reporting a synchronization error?**
- **What read/write dependencies can the compiler establish, and what complete direct and indirect effect evidence can server execution supply?**
- **What transaction and publication boundaries are promised for multi-table, multi-commit, or external-service mutations?**
- **Which endpoint forms should remain executable when optimization analysis declines, and what conservative recipient scope and observation contract does that fallback require?**
- **What evidence and explicit assumptions authorize each optimization independently, including recipient selection, optimistic derivation, and authoritative patch application?**
- **When can compatible non-garbage-collected queries share server evaluation or response representation while preserving each exact result, and when is batching independent full evaluations cheaper?**
- **What exact confirmed representation can client and server identify and retain for inter-response diffs through initial load, response loss, overlap, garbage collection, scope changes and restart, while preserving target authority and full-result fallback?**

## Source shelf

- **SQL effects survey S28: Generated Columns** — https://www.postgresql.org/docs/17/ddl-generated-columns.html — Claim-specific source inspection for C13, version comparison. Scope and access status: Only stored generated columns in this version.
- **SQL effects survey S27: SQLsmith** — https://github.com/anse1/sqlsmith — Claim-specific source inspection for C21. Scope and access status: Documentation only; repository not built or run.
- **SQL effects survey S26: Transactional Consistency and Automatic Management in an Application Data Cache** — https://drkp.net/papers/txcache-osdi10.pdf — Claim-specific source inspection for C8. Scope and access status: Full paper; modified DBMS, different freshness contract.

[View all 95 sources](?file=field_log.md&page=artifacts&kind=source)

## Key Terms

_None recorded._

## Current tensions

_None recorded._

## Plan and open gaps

- **Design Grammar → parallel Fracture Scan and Hostile Assay** — Exploratory Design Grammar completed first; Fracture Scan and fresh Hostile Assay completed in parallel against a frozen candidate. No implementation or architecture selection.
- **Establish and implement authority coordination** — Ground Condition, state machine, fresh Hostile Assay, red/green coordinator and concurrent full-stack oracle completed. DB/adapter boundary tests pass. SQL schema generation and Endpoints on-demand mode remain explicit future coverage, not implemented claims.
- **Expand schema, PostgreSQL query and on-demand generation** — Use typed schema-first generators and a versioned capability manifest. Generalize full-result fallback beyond Todo, then add actual subset transport, window refill and lifecycle schedules to the same independent PostgreSQL full-stack oracle. Current coverage metadata explicitly marks these as not generated.
- **Ground auth behavior and boundary cases** — Ground condition completed with eight measured public API controls and a sourced boundary map.
- **Extract exploratory auth/dependency grammar** — Exploratory grammar v1 frozen; layered brief and controls saved. F2 frozen for independent parallel audits, not adopted.
- **Test the grammar candidate against its own promises** — Fracture scan completed on frozen candidate with an executed PGlite witness and scope controls.
- **Blind failure test of the grounded auth candidate** — Fresh hostile assay completed with dispositions for all material attacks and oracle gaps; no implementation.

## Synthesis

_No synthesis has been requested or recorded._

## Chronological log

### Kyle

_2026-09-11T16:54:36.939Z_

> **Kyle:** “start a field log to record all this”

### Kyle

_2026-09-11T16:54:36.941Z_

_Retrospectively recorded from the preceding design discussion, in original relative order. Recorded timestamps describe log creation, not historical turn times._

> **Kyle:** “I'm not sure what we can do about exhausted read retries — if the backend api is erroring then the client just needs to show an error

Optimistic changes not propagating between active endpoint collections is a known missing feature — we need to switch to design mode to explore how to solve this”

### Kyle

_2026-09-11T16:54:36.941Z_

_Retrospectively recorded from the preceding design discussion, in original relative order. Recorded timestamps describe log creation, not historical turn times._

> **Kyle:** “[$field-lab](/Users/kylemathews/programs/hegelian-dialectic-skill/SKILL.md) how about we run ground condition & design grammar on this to explore possible designs — maybe research survey too first to see if there's prior work on designing these sorts of things”

### Kyle

_2026-09-11T16:54:36.941Z_

_Retrospectively recorded from the preceding design discussion, in original relative order. Recorded timestamps describe log creation, not historical turn times._

> **Kyle:** “There's also the question of when we can return a small amount of update data from the server to update the client, or when it is impossible to know that and we should just have the client do a full refetch. This could depend on different queries, how they're set up, and the mutations, so there's a lot of possibilities here.”

### Kyle

_2026-09-11T16:54:36.941Z_

_Retrospectively recorded from the preceding design discussion, in original relative order. Recorded timestamps describe log creation, not historical turn times._

> **Kyle:** “This is another good test for the oracle. If an analog sequence is both corrected every time and transferring measurably less data over the wire with lower latency, we don't want to accidentally design very complex updating schemes that are slower than the client just re-fetching.

We need to try to calculate some realistic numbers here to bound different schemes. Of course, re-fetching for the client is two round trips, so it's almost always going to be faster to do more work on the server to figure out how to update the client when possible.”

### Kyle

_2026-09-11T16:54:36.941Z_

_Retrospectively recorded from the preceding design discussion, in original relative order. Recorded timestamps describe log creation, not historical turn times._

> **Kyle:** “ok just to be clear, are you evaluating both how to minimally patch the client & how to figure out which client collections need updated (both optimistically & to re-sync)?”

### Kyle

_2026-09-11T16:54:36.941Z_

_Retrospectively recorded from the preceding design discussion, in original relative order. Recorded timestamps describe log creation, not historical turn times._

> **Kyle:** “there's also the open question of how do we know in the client which collections are active — we'll need to calculate all collections that could be affected and then check against which ones are active (most likely)”

### 39 sources examined

_2026-09-11T16:54:36.942Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Bounded prior-work survey

_2026-09-11T16:54:36.942Z · research-survey_

Eighteen external primary sources and six local/user records separate identity, membership, coverage, replay, and authoritative observations.

### Information required for optimistic propagation and reconciliation

_2026-09-11T16:54:36.942Z · ground-condition_

An identical deletion payload cannot determine an unseen top-k replacement across indistinguishable client states; additional coverage or authoritative data can close that gap.

### Impact, update delivery, and collection activity

_2026-09-11T16:54:36.942Z · design-grammar_

The grammar separates optimistic recipient selection, local edits, authoritative recipient selection, payload choice, and activity/lifetime. Three storage forms and four delivery forms remain unranked.

### Measured local costs and conditional latency bounds

_2026-09-11T16:54:36.942Z_

# Performance bounds for reconciliation strategies

Requested during the design inquiry, 2026-09-11. This is a calculation plus a small local measurement, not a deployed benchmark or an oracle campaign comparing implemented strategies. [Raw measurements](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/performance-measurements.json), [reproducible script](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/performance-model.mjs).

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


### Status at log creation

_2026-09-11T16:54:36.942Z_

The three user-selected operations are complete. No architecture has been selected or implemented. The source artifacts and their qualifications are preserved above. The performance note contains local synthetic measurements plus assumed network bounds, not deployed end-to-end latency. The current question remains open; the return-to list records unresolved work rather than selecting new operations.

The critical performance comparison includes **inline full results in the mutation response**, which also takes one round trip. Recipient discovery and small-payload construction must be evaluated separately, for both optimism and authoritative resynchronization. The oracle must inspect every active collection even when a candidate strategy labels it unaffected.

### Kyle

_2026-09-11T17:16:50.671Z_

> **Kyle:** “Did this take into account multiple possible tables that are mutated and possible read/write to and other complicated setups? Of not another ground condition to dig into boundaries”

### 1 source examined

_2026-09-11T17:19:07.173Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Multi-table boundaries: reads, effects, and missing join partners

_2026-09-11T17:19:07.173Z · ground-condition_

Previous coverage was single-table. This pass distinguishes prediction reads, actual writes, query dependencies, local coverage, and commit/publication boundaries. Complete changed-row images can still miss unchanged join partners.

### Kyle

_2026-09-11T18:01:32.604Z_

> **Kyle:** “Yeah there's a huge range of possibilities. Ok anything else we should examine before running design grammar again?”

### Suggested preparation before a second Design Grammar

_2026-09-11T18:01:32.607Z_

Recommendation requested by Kyle; no additional operation selected or started.

Two bounded examinations would make the next grammar less dependent on assumed contracts:

1. **Term scan:** distinguish uses of correct, active, and synced through concrete pending/success/error/activation examples. In particular, separate consistency with declared optimistic intent from prediction of a server outcome based on unseen reads. This surfaces competing standards but does not choose policy; terminology alone can hide a material tradeoff.
2. **Substrate map:** trace one actual endpoint mutation from compiler output through transaction capture, server execution, response, refetch, and publication. Record what query identity, arguments/scope, dependencies, effects, baseline, and demand information exists at each handoff, distinguishing observed metadata from proposed additions. This exposes information gaps but the Todo baseline cannot establish general multi-table capability.

For a later selected grammar run, reserve concrete cases before extraction for range checks and keep their expected outcomes independent of the generated design. Prior visible examples cannot become fresh holdouts merely by renaming them. Further broad research and detailed performance experiments can wait until candidate mechanisms are concrete.

### Kyle

_2026-09-11T18:05:20.980Z_

_Accepts the suggested Term scan and Substrate map before another Design Grammar, adding an explicit requirement to recognize unsupported analysis and exclude dependent optimizations._

> **Kyle:** “Yeah those are good. We won't be able to get everything supported at first so we'll want to cover a good range and be able to recognize when something isn't analyzable and exclude that from anything clever”

### 1 source examined

_2026-09-11T18:06:40.744Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Correctness, activity, and bounded analysis

_2026-09-11T18:06:40.744Z · term-scan_

Different uses of correct, active, synced, and supported imply different evidence and fallback choices. The extractor checks a narrow grammar; compilation acceptance is not a general optimization certificate.

### 1 source examined

_2026-09-11T18:07:56.706Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### What crosses the mutation boundary today

_2026-09-11T18:07:56.706Z · substrate-map_

The narrow client path carries declaration identity, scope, ordering, RPCs, and local intent. General dependency/effect/coverage evidence and database observation revisions are absent from this path. Unsupported query analysis currently becomes a compiler error.

### Kyle

_2026-09-11T18:13:51.562Z_

_Confirms analysis-gated optimization with full query evaluation and result delivery as the authoritative fallback._

> **Kyle:** “Yeah, this makes sense. It's basically we analyze and then if we can optimize, we optimize, and if we don't, it's then just sort of a full refetch and send back.”

### Kyle

_2026-09-11T18:15:04.830Z_

> **Kyle:** “Also, to optimize the full refetch on the server, we could probably do some sort of join query. If there's are three query collections which need updated. We can then send back a combined blob of data that gets us from one query and then separate that out on the client somehow. Perhaps that would work.”

### User-proposed candidate: combine full-result evaluation and delivery

_2026-09-11T18:15:04.831Z_

Kyle proposes obtaining results for several affected query collections through a combined server query and sending one payload that the client separates into its collection results. This is a candidate for the next Design Grammar, not a selected SQL transformation or measured optimization.

Keep three claims separate: batching work into one SQL statement/database call; sharing actual evaluation work across compatible queries; and avoiding repeated data in the response. One statement or one payload alone does not establish the other savings.

A candidate must preserve each collection’s identity, membership, projection, order, limits, scope, and usable observation contract when reconstructing results. Shared rows alone do not identify each collection’s result. Unsupported combinations can retain independent full evaluations packaged in the existing single mutation response.

No query rewrite, wire format, or client reconstruction mechanism has been selected or tested. Paired oracle comparisons should check each reconstructed collection independently and measure server work, database calls, response bytes, and end-to-end latency.

### Kyle

_2026-09-11T18:15:50.837Z_

> **Kyle:** “Okay, anything else we should do to test this before running design grammar again?”

### Recommended small check of combined-result delivery

_2026-09-11T18:15:50.838Z_

Recommend one disposable PGlite comparison before the next Design Grammar: independent full query results packaged together versus one candidate combined evaluation/shared payload and reconstruction. Use a small orders/customers fixture with three overlapping query results whose filters, ordering, and limits differ. Compare exact per-query results against independently executed SQL after seeded insert/update/delete sequences, including empty results, tied sort values with a deterministic tiebreaker, join fanout, and movement across a limit boundary. Freeze the baseline and vary one sharing mechanism at a time.

Measure database execution, serialization, full payload bytes, and reconstruction separately; vary overlap to include a case where sharing brings no benefit. This is a proposed bounded Real-world check (draft instrument, no documented completed uses), not a selected or started run. Local PGlite timings do not establish deployed PostgreSQL or network performance. The check addresses result sharing, not compiler analyzability or general optimistic propagation. Reserve fresh cases for a later grammar range check; do not promote the worked experiment into independent held-out evidence.

### Kyle

_2026-09-11T18:18:32.504Z_

_Authorizes the proposed disposable PGlite check and asks to frame it as a Ground-condition probe of boundaries, with an explanation._

> **Kyle:** “Yes good idea. Maybe explain too. Though maybe this is ground condition to see where boundaries are?”

### 3 sources examined

_2026-09-11T18:24:39.291Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Combined full results: overlap determines whether sharing pays

_2026-09-11T18:24:39.291Z · ground-condition_

Correct reconstruction passed. At the largest size, sharing cut compressed bytes about 33% with overlap and added about 33% without it. Combining SQL alone did not uniformly reduce local time.

### Kyle

_2026-09-11T18:27:44.609Z_

_Continue with the previously discussed second Design Grammar after the preparatory scans and executable Ground-condition probe._

> **Kyle:** “Ok perfect, continue”

### 8 sources examined

_2026-09-11T18:34:46.232Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Second Design Grammar: full results with justified shortcuts

_2026-09-11T18:34:46.233Z · design-grammar_

The full-result baseline remains available. Evidence and cost separately admit each shortcut. Read candidates differ from optimistic settlement participants; two ownership forms remain unranked, with explicit unsupported and unresolved boundaries.

### Kyle

_2026-09-11T18:39:32.734Z_

> **Kyle:** “Yeah optimistic updates are just a guess for what will happen on the server but the server might take a different direction depending on the latest state of data there. Which is why optimistic state is just an overlay and is dropped once the server data comes back. So we need to have I think some sort of SQL grammar and then each query/mutation combination can calculate from that the optimistic mutation, what info to send to the server to inform the update strategy and then calculate and execute the update on the server and client”

### Implications of the clarified overlay contract

_2026-09-11T18:39:32.734Z_

The client mutation supplies or derives a tentative effect under its declared supported semantics. A shared relational representation can describe how that effect changes each supported active query, which query arguments/scope/baseline or coverage information the server needs, and which authoritative response strategies are admissible. Server-side planning must use actual execution effects and current data rather than treating the client guess as authority.

When authoritative result data is incorporated, retire the matching transaction’s tentative effects while preserving other pending overlays. A mutation acknowledgement without the needed query data is not equivalent to that boundary. Existing DB transaction/overlay machinery remains the intended surface; this note does not introduce a replacement overlay engine or new public source handle.

A SQL/query representation does not by itself infer arbitrary business intent from an opaque handler. Authored optimistic intent and any mechanically derivable supported mutation semantics remain distinguishable. Whether the initial grammar uses an existing SQL/relational representation, its supported operators, metadata protocol, and execution adapters are still unselected. No new Design Grammar run or implementation was started by this record.

### Kyle

_2026-09-11T18:43:53.341Z_

> **Kyle:** “Yes, that's what needs figured out next. What instrument(s)? Also another decision is that every affected non gced query collection should be updated. This number is almost always just 1-2 so we shouldn't worry too much about optimizations like if it currently has a subscriber or not”

### Question answered: What defines an active instance: direct and indirect subscribers, preloads, pins, pending transactions, and garbage-collection grace periods?

_2026-09-11T18:43:53.342Z_

Kyle selects all affected not-yet-garbage-collected query collections as recipients, regardless of subscribers, preload status, or retention reason. Subscriber-based pruning is not a design objective. Creation/GC interactions with pending work remain a separate lifecycle question.

### Question answered: What optimistic reference state is promised when unseen server reads choose branches or rejection?

_2026-09-11T18:43:53.342Z_

Kyle clarified in the preceding turn: optimism is the client guess, represented as an overlay, and may differ from the server result based on newer data. Authoritative data replaces the corresponding guess. This does not remove the need for coherent evaluation of that guess across supported collections.

### Recommended next instruments for the executable query/mutation representation

_2026-09-11T18:43:53.342Z_

Recommendation only; no new run selected. Start with a focused Research Survey of reusable representation and analysis machinery, grounded first in the current TanStack DB query representation and Endpoints/Drizzle extraction path, then bounded primary-source material on relational update rules where needed. Its output is available structures, assumptions, gaps, and explicit unknowns—not a chosen implementation. Research Survey is marked draft in the current instrument catalog.

Follow with a Design Grammar targeted at the actual representation and transformations, not another general framework decomposition: query and guessed/actual mutation forms, supported operator rules, client overlay calculation, server context, authoritative plans, and unsupported exits. Demonstrate nearby forms on concrete query/mutation pairs while retaining the exact existing collection/Transaction surface and all non-GCed recipients. The risk is inventing an elegant representation that has no execution path.

Use a Ground-condition probe with an executable oracle check only if a concrete rule has an unresolved boundary, such as a join insertion or limited-result replacement. These are possible later checks, not a selected queue. The existing system-level grammar remains frozen and historical.

### Kyle

_2026-09-11T18:47:14.401Z_

> **Kyle:** “Ok go, I'll be driving for a while so just continue through the instruments to then first draft of oracle/model/implementation”

### Representation survey: reuse and evidence boundaries

_2026-09-11T18:56:21.914Z · research-survey_

Bounded local and PostgreSQL source map; no architecture selection.

### Representation grammar: separate claims, shared description

_2026-09-11T18:56:43.991Z · design-grammar_

Two ownership forms with explicit unsupported exits and inline authoritative fallback.

### First executable model/oracle/implementation: results and limits

_2026-09-11T19:15:16.385Z_

# First executable coherence draft

The first slice is implemented in the Endpoints probe. Bare query collections remain writable, actions still return a DB Transaction synchronously, and there is no mutation queue. The original two-query optimistic insert failure now passes.

## What runs

The compiler emits a small serializable query model: trusted relation identity, full-row membership (`all` or `completed = boolean`), and total ascending order. The client lowers membership into **TanStack DB's existing expression evaluator**. It does not serialize handlers or the full runtime QueryIR.

A mutation captures authored row guesses through the existing transaction. The runtime applies those full-row effects to other eligible query collections within that same transaction, including collections with no subscribers. An update can remove a row from one filtered result and insert it into another. Cleanup is the retention exit.

The mutation request carries retained query identities. A generated server-only dispatch table validates every identity before invoking the write. Actual write coverage remains unknown, so **every retained requested query is evaluated on the server**. The mutation returns full authoritative results. Query Collection's manual write utilities install them against tracked confirmed keys before DB retires the transaction overlay. The implementation does not start a preload inside mutation persistence.

Server-side reads retry three times with 1/2/4-second delays. The write is never retried by that loop. Exhausted reads produce a distinct “write committed; reads failed” result, recorded on the client and surfaced through the action's persistence error. The oracle checks that error and server commit separately, then checks convergence after a fresh load. It does not assert that unavailable data equals a guessed successful read.

This is the separate-result ownership form from the [grammar](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/grammar/brief.md), selected for this draft under the user's implementation authorization. The grammar itself did not rank its forms.

## Model, oracle, implementation

- Model and evaluator: [coherence.ts](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/src/coherence.ts).
- Client capture, fanout, retention and publication: [runtime.ts](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/src/runtime.ts).
- Compiler metadata and trusted read dispatch: [bound-transform.mjs](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/bound-transform.mjs).
- Server refresh/retry boundary: [refresh.server.ts](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/src/refresh.server.ts).
- Generated full-stack oracle: [tests/oracles](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/tests/oracles/README.md).
- Research and analytical controls: [survey](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/representation-survey.md), [grammar model](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/grammar/model.md), [evidence](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/grammar/evidence.md), [process](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/grammar/process.md).

The reference uses separate PGlite confirmed and visible worlds. It never imports the SUT's membership evaluator or its recipient selection. Every retained result and order is checked independently at initial, optimistic, held reconciliation/retry and settled checkpoints. The server can trim text while the client guesses the original text; independent SQL `btrim` supplies confirmed expectations.

## Evidence

The final full campaign used N=2 scenarios × X=2 fresh sequences per campaign, up to three operations per sequence, plus fixed controls. It built **8 programs, ran 18 sequences, 40 operations and 173 checkpoints**, and inspected 32 client artifacts. All four campaigns passed. A larger coherence-only run passed 3 generated programs, 12 sequences, 35 operations and 95 checkpoints. Random coverage is supplemented by a fixed all/active/completed fixture proving membership entry/exit, correction, rollback, zero-subscriber retention and GC exclusion.

The saved old failure was red before the implementation and green afterward. An isolated `omit-fanout` mutant restores that same failure. The `early-settlement` mutant is also rejected: the rendered optimistic row disappears before authority arrives ([receipt](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-mutant-settlement/report.json)). Compiler/server boundary unit tests passed (13 checks); TypeScript passed. The final retention/evaluator refactor also passed the fixed witness and a generated sequence ([receipt](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-retention-final/report.json)). The existing Todo browser lifecycle, binding and callback-error regressions passed against a disposable in-memory server, including scope isolation and persistence after reload. Each generated program also gets a production build: client artifacts and browser-delivered sources are scanned for server canaries and server dependency paths, with positive server witnesses and rejected raw/server-module requests. These checks cover the tested boundaries, not every possible leak.

Receipts: [all campaigns](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-final/report.json), [larger coherence run](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-coherence/report.json), [original red](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-red/report.json), [green replay](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-green/report.json), [fanout mutant](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-mutant-fanout/report.json), [Todo lifecycle](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-browser.json).

## Cost boundary

A fixed fixture with two full-result queries over 200 rows runs the same edit under each strategy, checked by the same PG oracle. Three fresh sequences per strategy:

| Strategy | Browser requests/op | Request body bytes | Decoded response body bytes | Local median elapsed | With 50 ms injected request delay |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inline full results | 1 | 562 | 106,069 | 146.10 ms | 181.01 ms |
| Client refetch | 3 | 755 | 106,010 | 162.28 ms | 246.58 ms |

[Raw measurement summary](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-wire-summary.json) and [fixed workload](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-wire-input.json) permit replay. Client refetch still propagates optimism correctly; only its authoritative delivery strategy changes in the disposable copy.

These are tiny local measurements with oracle gates, browser publication checks and instrumentation included. The 50 ms case adds a fixed delay before each browser POST, not a measured real network RTT. Body sizes exclude HTTP headers/compression. Fewer request phases help here; **full-result delivery does not save substantial payload bytes**. No patches, shared SQL, result deduplication, or production speed claim is implemented.

## Explicit first-draft limits

- **One trusted Todo schema and one authored module.** Only full rows, empty query arguments, scope, `completed` predicates and ascending `createdAt`/`id` order are recognized. Unsupported query shapes still get compiler diagnostics. General safe execution of arbitrary unanalysable queries with inline fallback remains future work. Opaque mutation handlers already use conservative full reads; target-row `RETURNING` is never treated as complete effects.
- **No complete multi-table effects observer.** The model distinguishes complete relation coverage from unknown; the runtime supplies unknown. The server helper can refresh multiple registered reads but that is not a multi-table Endpoints compiler implementation. Joins, aggregates, top-k, complex projections, codecs and collations remain outside this slice.
- **Nonempty, coherent authored guesses.** The existing zero-mutation restriction remains. An insert excluded from every retained query, an empty bulk write, or conflicting guesses for the same row needs a separate action/transaction contract. The generator now respects this supported precondition rather than silently claiming those cases pass.
- **Stable loaded query set during each operation.** Reads must finish loading before mutations. New endpoint creation during pending work fails explicitly. GC before a mutation is tested; restart/GC/initial-read races during work and generation-aware catch-up remain unresolved.
- **Concurrent response publication is unproved.** Actions are not queued or globally disabled, and existing DB snapshot ownership is preserved, but the generated sequences are sequential. No common PG snapshot, database revision, linearizability or atomic publication across result collections is claimed. Overlapping responses and conflicting authored effects need the next model extension.
- **No durable error recovery protocol.** Exhausted reads are visible errors; reload repairs confirmed state. Response loss after commit and app-wide query registries remain open.

## What the instruments changed

The [survey](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/representation-survey.md) established reusable local boundaries while separating them from PostgreSQL semantics and effect-observation limits. The [exploratory grammar](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/grammar/brief.md) kept guessed effects, query support and actual effects separate and preserved the user's non-GCed recipient rule. Neither supplied a proof of arbitrary SQL analysis. The executable draft turns the supported slice into a baseline against which selective reads and patches can be tested and measured.

No DB-core defect was established. The first expanded run exposed two harness gaps: inserted values could violate the selected filter and erase every captured mutation; redirect responses have no inspectable body. Both were corrected, with [initial failing receipts](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/representation-initial/report.json) retained. The former also made the existing empty-transaction limitation explicit.


### Kyle

_2026-09-11T19:19:10.127Z_

> **Kyle:** “Let's run fracture scan and hostile auditor and loss audit on the grammar and implementation”

### Fracture scan: handler rejection and committed effects

_2026-09-11T19:21:11.200Z · fracture-scan_

Reproduced commit-then-throw bypassing retained reads. Missing outcome condition; successful-handler coherence survives.

### Hostile assay: identity and handler-outcome failures

_2026-09-11T19:27:25.928Z · hostile-assay_

Fresh auditor reproduced post-commit failure without refresh and colliding endpoint identities. Unicode ordering is confirmed behavior with a conditional scope fault.

### Loss audit: source distinctions and proof gaps

_2026-09-11T19:28:01.466Z · loss-audit_

Three isolated passes recovered omitted semantic/cost distinctions and separated disclosed limits from missing oracle proof. An executable four-case check confirmed the guessed-versus-actual recipient generator gap.

### Kyle

_2026-09-11T19:50:54.485Z_

> **Kyle:** “Ok great, red/green the fixes”

### Audit fixes: red/green results and restored contracts

_2026-09-11T19:50:54.485Z_

# Audit fixes and restored design constraints

This revision implements the accepted fixes from the fracture scan, hostile audit and loss audit. The frozen grammar and audit receipts remain historical evidence. This document adds the revised contracts and restores distinctions the first draft compressed away; it is not a new Design Grammar run.

## Handler outcome and authority are separate

A handler is not a database transaction. It can commit one statement and fail on the next. The response now carries a handler outcome independently of its reconciliation outcome. Unknown effects still require every retained, non-GCed query to be read, even when the handler throws. Only reads retry, with three retries at 1/2/4 seconds.

| Handler | Reconciliation | Client behavior |
| --- | --- | --- |
| Completed | Complete snapshots | Install authority, then resolve persistence and retire the overlay. |
| Failed | Complete snapshots | Install authority, then reject persistence with the handler error and retire the overlay. Committed data remains. |
| Either | Exhausted reads | Surface a read error for every requested collection, preserve the handler outcome in the response, and reject persistence. A later fresh read restores authority. No rollback claim is made. |
| Either | Invalid response | Reject before installing any snapshot and mark the requested collections with a read error. |

A malformed response includes missing, duplicate or unexpected query identities, duplicate row keys, invalid row values, or an invalid envelope. Validation precedes all collection writes. This does not promise atomic publication across otherwise valid snapshots.

The existing transaction overlay still owns whole optimistic row snapshots. Authoritative writes occur through ordinary collection sync utilities; failure retires the guess rather than undoing database commits. Actions still return a Transaction synchronously, with no mutation queue.

## Declaration identity and ordering

Declaration identities include the module identity and lexical declaration ordinal as well as readable local names. Distinct scopes may repeat component, query and mutation names. The ordinal counts declarations with the same local names in lexical traversal order. Unrelated imports and test instrumentation cannot change it. Compiling the same source produces the same identities across renders; a compile-time duplicate guard rejects collisions. This is not an identity migration contract across source edits, builds or HMR.

The supported string ordering now follows Unicode code-point order, which agrees with UTF-8 byte order for valid Unicode strings under PostgreSQL `C` collation. Tests derive the expected order from PGlite, including BMP and supplementary-plane keys, and exercise both loaded and optimistic rows. Locale/ICU collations, invalid Unicode strings and other database codecs remain outside this slice. Deployments must not silently claim the `C` comparator supports other collations.

## Restored grammar distinctions

The [multi-table source](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/ground-conditions-multitable.md) and [loss ledger](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/representation/audit/loss-multitable.md) constrain later generalization:

- **Mutation reads, possible writes, observed effects and guessed effects are different facts.** Reads explain decisions and dependencies; possible writes bound conservative invalidation; observed effects describe what actually happened; guesses drive overlays. An observer is useful for skipping reads only when its coverage is complete across relevant tables, indirect writes and commit boundaries. An opaque handler error does not prove an empty effect set.
- **Dependencies include absence and authorization.** NOT EXISTS, outer joins and zero-count results can change when an absent row appears. Permission changes can alter visibility without changing a projected row. A set of loaded entity keys is not a complete dependency description.
- **Support can be sufficient or insufficient.** A fully loaded joined result can sometimes provide all data needed for an exact local update. Missing partners require more support or fallback. If both join inputs change, account for the cross-term between their deltas; do not miss it or count it twice.
- **Aggregates have different support needs.** Counts need multiplicity; distinct counts need per-value support; removing a minimum or maximum can require replacement candidates. A generic “aggregate supported” flag loses those distinctions. Limited queries similarly require replacement rows when membership or rank changes.
- **Small writes can cause large result changes.** A shared parent or permission update may affect many rows and collections. Payload size is bounded by result change, not mutation input size.

These are preserved design obligations, not new implementation claims. The current executable model still supports full Todo rows, all/completed predicates, ascending createdAt/id order, a stable loaded collection set, and sequential oracle histories. Multi-table compilation, effect capture, joins, aggregates, top-k, arbitrary fallback execution and lifecycle/concurrency protocols remain future work.

## Restore separate safety and cost decisions

Read selection, optimistic derivation, authoritative result derivation, delta encoding, shared SQL and shared result encoding each require their own evidence. Unknown analysis disables the dependent optimization; full authoritative results remain the baseline. Safe execution, safe optimization and a measured benefit are separate gates.

The [result-sharing experiment](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/ground-conditions-result-sharing.md) held delivery at **one browser response** and compared **3/1/1 database calls**. It did not measure browser round-trip savings. Its [receipt](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/design/result-sharing-measurements.json) found:

| Workload | Full gzip bytes | Shared gzip bytes | Observation |
| --- | ---: | ---: | --- |
| 1,000-row buckets, high overlap | 17,321 | 11,537 | About 33% smaller |
| 1,000-row buckets, disjoint | 18,711 | 24,918 | About 33% larger |

At 100 rows with overlap, raw JSON fell about 55%, while gzip fell only about 7%. The shared SQL candidate retained per-result scans and sorts and built repeated SQL results before deduplicating in JS. In the large disjoint case, local total medians were 17.661 ms for independent execution and 18.716 ms for shared execution. These are warm local observations, not a production winner or a profitability threshold.

Shared encoding also requires compatible scoped projections and values, correct output identity and multiplicity, ordered references, and exact empty results. Matching entity keys alone does not establish compatibility. Following already computed result references is decoding, not client query evaluation or shared query support.

The later inline-versus-refetch browser comparison measured **1 versus 3 browser requests**, decoded response bodies and harness elapsed time. It answers a different question. Neither those timings nor the earlier local SQL/encoding timings measure deployed end-to-end latency. The original sharing oracle covered 30 histories, 131 steps and 327 checkpoints for reconstruction; it did not prove compiler classification, optimism or browser publication. Preserve that evidence separately from the full-stack coherence oracle.

## Test gaps closed

| Audit finding | Why previous tests missed it | New coverage |
| --- | --- | --- |
| Commit followed by handler failure | Rejection was injected before SQL | Actual PGlite partial commit; client authority before rejection; generated post-commit errors crossed with read retries/failure |
| Repeated declaration names | One component and unique local names | Compiler regression and generated nested scopes with repeated names |
| Wrong Unicode order | ASCII-only keys | PGlite ordering regression and generated Unicode seed/insert keys |
| Recipient selection tied to guesses | Server mostly copied intent, only trimming text | Independent membership changes, other-row effects and no-ops; wrong-recipient negative control |
| Malformed authority | Server always returned valid snapshots | Deterministic corruptions and 100 generated malformed responses; no partial baseline replacement |

The expanded generator exposed a test-fixture error: initial and inserted Unicode IDs could share the same prefix and operation index. Seed and insertion namespaces are now separate. That failure occurred in the reference before invoking the SUT and is not counted as a framework or DB defect.

The existing Todo browser regression caught a second identity boundary during this work: byte offsets changed when preceding plugins inserted test instrumentation, causing client and server IDs to disagree. A failing compiler regression now covers that transformation; declaration ordinals replace byte offsets.

## Validation receipts

- [Initial red regressions](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-red.tap): post-commit authority loss, duplicate declaration identities, Unicode order, malformed response handling, and the revised handler envelope failed before fixes.
- [Instrumentation identity red](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-identity-red.tap) and [green](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-identity-green.tap): unrelated imports no longer change endpoint identities.
- [Final contracts](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-contracts-final.tap): 18 top-level checks passed, including a bundled runtime suite with four checks and 100 generated malformed responses. TypeScript and `git diff --check` passed.
- [Four full-stack campaigns](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-final/report.json): N=2 programs per campaign, X=3 sequences, up to 3 generated steps; 10 builds, 27 sequences, 73 operations, 316 checkpoints, 40 client artifacts. Controls, retry recovery, coherence and exhausted reads all passed. This run started before the final identity refinement.
- [Final identity/coherence campaign](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-identity-oracle/report.json): 4 builds, 8 sequences, 23 operations, 77 checkpoints, 16 client artifacts passed with declaration ordinals. Includes repeated lexical names and independent server-effect witnesses.
- [Wrong-recipient negative control](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-recipient-mutant/report.json): deliberately failed the first independent membership-change checkpoint. The correct conservative selector passed that witness in both successful campaigns.
- [Generator repair replay](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-generator-replay/report.json): the saved ID-collision sequence passed after separating ID namespaces.
- [Client-refetch comparison control](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-refetch-control/report.json): passed one independent-effect operation over two collections with three browser requests. This is a correctness/control check, not a new speed comparison.
- [Todo browser regression](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-final-browser.json) and [binding regression](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/evidence/audit-fixes-final-identity.json) passed after the identity refinement. Callback-error/empty-transaction checks also passed against the isolated in-memory server.

Each generated program receives a production build and server/client artifact checks. The tests still execute browser behavior against a dev server. No DB-core defect, broad SQL support, concurrent settlement proof or production performance gain is claimed.


### Kyle

_2026-09-11T20:10:29.762Z_

> **Kyle:** “This is actually a pretty important design, so let's do a thorough job on this before starting implementation. First, run design grammar, and then in parallel, fracture scan and hostile auditor.”

### 1 source examined

_2026-09-11T20:10:29.762Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Stale authority: Design Grammar

_2026-09-11T20:15:44.694Z · design-grammar_

The proposal needs separate knowledge of handler completion, read coverage and transaction retirement. Quiet reads are conditional, with lifecycle, publication and unknown-outcome mechanisms still open.

### Fracture Scan: qualified quiet-read route and its limits

_2026-09-11T20:20:01.040Z · fracture-scan_

The qualified local route survived 34,650 constructed schedules. Generation equality alone fails ordinary-read coverage; progress and visible retirement remain separate unresolved conditions.

### Hostile Assay: coverage history and ownership boundaries

_2026-09-11T20:22:17.690Z · hostile-assay_

A fresh audit found no defeat of all qualified premises, but named five unimplemented obligations. Real core behavior distinguishes pending manual siblings from persisting Endpoint siblings on failure.

### Plan completed: Design Grammar → parallel Fracture Scan and Hostile Assay

_2026-09-11T20:22:17.690Z_

Exploratory Design Grammar completed first; Fracture Scan and fresh Hostile Assay completed in parallel against a frozen candidate. No implementation or architecture selection.

### Kyle

_2026-09-11T20:32:08.570Z_

_Accepted Ground Condition on adapter/publication/lifecycle/outcome contracts, precise state machine, fresh Hostile Assay, concurrent oracle, then implementation against red tests._

> **Kyle:** “Ok I like the plan go”

### ground-condition

_2026-09-11T20:35:46.217Z · ground-condition_

Actual adapter and Collection probes establish stale queued refetch, cross-collection notification, and same-object lifetime boundaries.

### Authority state machine v1

_2026-09-11T20:35:46.217Z_

# Authority coordinator v1: frozen implementation candidate

This specifies the conservative single-client, single-authority-domain slice. Query analysis still selects optimistic recipients with DB predicates; unknown actual effects conservatively select every retained endpoint collection. No mutation serialization. Normal isolated actions retain the inline response fast path.

## State

Client has a monotonic write epoch; a publication AbortController; retained query registrations with sync lifetime counters; and operation entries separate from Transaction state. Each operation is `running`, `closed(success|handler-error)`, or `unknown`. Entries also retain a persistence completion waiter. Covered entries may retire, but the accepted epoch/publication generation never resets. Query lifetimes hold RPC, model, confirmed rows and accepted epoch. A cleaned-up lifetime contributes no coverage obligation; starting sync on the same object creates a new lifetime.

## Transitions

1. **Start:** register the operation and increment epoch before calling authored optimistic code. Invalidate all previously issued ordinary-read publication permits and cancel their Query requests. Apply authored mutation and DB-predicate fanout under a synchronous collection publication batch. Return the real Transaction synchronously and start its server request immediately. A synchronous authored exception sends no request and does not create an unknown remote handler.
2. **Ordinary/initial read:** obtain a quiet read through the coordinator, not an independently admitted raw RPC. If any handler is running, wait for its envelope, never its persistence receipt. If any handler is unknown, reject with an explicit unknown-outcome error. Snapshot current epoch and retained lifetimes, execute registered raw reads, retry reads with exponential backoff, validate full rows, and install only if epoch and lifetimes still match and all handlers are known. A stale attempt triggers another read; it cannot update confirmed state. A new registration during a read forces coverage repair. Do not preload a collection inside mutation persistence.
3. **Query adapter admission:** add an optional result-application AbortSignal provider, captured when the observer delivers a result and combined with the adapter's own application signal. Invalidating a permit prevents already-queued rows and readiness from publishing. Query cancellation prevents older transport results replacing cache data. Manual authority cache mirrors also receive the current publication permit, so a queued mirror cannot regress later authority. Existing adapter users without a provider keep their behavior.
4. **Envelope:** validate outcome and the complete requested snapshot set before installing anything. A valid outcome establishes handler closure independently of read success. Use inline snapshots only if this was an isolated operation for its entire interval, epoch is unchanged, and retained lifetimes match. Otherwise wait for all running handlers to close and perform a quiet full read. This read uses raw endpoint RPCs; the first implementation may require one request per registered read in the overlap fallback. It must report that cost, not claim the future batched-read optimization.
5. **Publish and settle:** invalidate obsolete applications; defer publication on every affected collection; install all validated authority with immediate adapter write batches; synchronously settle exactly the covered transactions in creation order before releasing notifications. Success completes its Transaction; handler error sets its error and performs normal rollback after authority installation. Retire only closed covered operation entries. Resolve/reject receipts under this synchronous boundary, so promise callbacks resume after publication. Preserve whole-row snapshots of other persisting Endpoint operations. Release all deferrals even if a listener throws, and keep dependent graph work in one outer publication context. Reentrant actions begin against the fully installed baseline and remaining overlays; their normal synchronous fanout must also be batched. They cannot reopen the already selected settlement cohort.
6. **Read exhaustion:** keep the known handler outcome and dirty coverage, mark read errors, and fail affected persistence receipts without claiming server rollback. A later explicit read or healthy action may establish fresh authority and clear those errors. Do not retry a write. A receipt failure alone does not erase the operation's closure/coverage facts.
7. **Unknown envelope/transport:** fail receipts and expose an unknown-outcome error while retaining an unresolved remote-write obligation. Later reads cannot discharge it. Other writes are not serialized or automatically retried, but no affected state may be labelled reconciled while this obligation remains. Durable server operation lookup/recovery is outside this first slice; no reload or local rollback is claimed to prove remote closure.
8. **Cleanup/restart:** invalidate the old lifetime's read permits, remove its obligation, and clear obsolete Query cache on cleanup. Restart, including `preload()` on the same object, enrolls a new lifetime before its initial read. New lifetimes remain loading until a covering result applies; collection creation is allowed during pending writes. The transaction's publication cohort includes every retained lifetime at the final installation boundary. Registrations made by callbacks after installation join the next read boundary.

## Observation contract

Confirmed baseline never regresses to a read issued before the latest accepted coverage. Visible rows are that baseline under DB's owned whole-row snapshots; tentative rows need not equal current server rows. At each externally delivered source event and each persistence receipt, all affected registered collections must reflect one installed authority batch plus supported overlays. Event payloads, direct reads and dependent queries must agree under reentrant actions; this is a required executable test, not a conclusion from the primitive probe. Loading lifetimes need not report ready before receipt settlement, but their installed rows must be covered, and readiness must never be established by a stale response.

## Verification and bounds

Generate endpoint scenarios, then concurrent schedules over operations and collection lifetimes. Use independent PostgreSQL tables for confirmed rows and tentative whole-row snapshots. Observe every notification and receipt, not just selected frames. Include reverse responses, old reads after retirement, overlap reads invalidated by new actions, handler partial commits, manual pending versus persisting siblings, cleanup/restart, late creation, local rollback and unknown outcomes. Keep server-code exclusion checks. Demonstrate red tests and failed mutants for admission, coverage and publication. Do not count a permitted explicit error as convergence. External writes, backend snapshots across separate changing authorities, auth changes and durable unknown-outcome recovery are not supported by this slice.


### hostile-assay

_2026-09-11T20:40:25.917Z · hostile-assay_

Fresh audit reproduced causal event inversion and torn public rollback; identified empty-action and unsent-exception boundaries.

### Authority coordinator implementation contract v2

_2026-09-11T20:40:25.917Z_

# Authority coordinator v2: implementation contract

This revision keeps v1's operation knowledge, persistent coverage, read admission, lifecycle and conservative reconciliation rules. It repairs the observation contract using the fresh audit's actual-source traces. V1 and its freeze remain unchanged.

## Publication and event history

Synchronous row state is installed for the whole affected collection set before change callbacks run. A callback may synchronously start another action; that action installs its whole fanout before returning its real Transaction. Reentrant source notifications enter a FIFO owned by the outer publication context, after notifications already queued for the previous change. Every subscriber therefore receives old changes before new ones. After all source delivery and graph work drains, dependent queries agree with the final source state.

An event is a historical change, not a snapshot accessor. If an earlier subscriber has made another action, a later subscriber can receive the older event while reading the complete newer state. V1's stronger equality of event payload and direct current reads under reentry was impossible with synchronous reentrant mutation. This revision does not weaken the requirement that current collections remain mutually coherent or that event consumers converge. Both causal event order and current cross-collection reads are separate test laws.

The publication boundary must cover ordinary public `Transaction.rollback()` and its pending-manual cascade, not only coordinator settlement. Core gets a synchronous internal settlement helper shared by normal commit and coordinated acknowledgement. Core's existing publication scheduler gets ordered source notification delivery; runtime gets an internal DbClient batch entry point. No alternate public collection or transaction type is introduced. No mutation request waits for a prior mutation request.

## Read admission and lifetime

An adapter result application captures a cancellation permit at observer delivery and combines it with the adapter's commit signal. Runtime invalidates permits and cancels Query requests before an action begins and before authoritative installation. Cancellation is not remote handler closure. Manual writes keep Query cache data aligned with the installed baseline. Tests must cross fetch-start/cancel success notifications, queued applications, structural sharing, and retired actions; observer-time admission alone is not a proof.

An endpoint ordinary read joins a coordinator-owned raw read, whose coverage check precedes immediate authoritative installation. The query function then returns the currently installed rows as the adapter/cache mirror. All raw reads have one retry owner (three retries at 1/2/4 seconds), including overlap repair. Waiting for a coordinator read never preloads a collection inside persistence. Initial sync registers before demand; cleanup invalidates its lifetime and removes cached rows so restart cannot seed readiness from the old lifetime. On restart the same Collection object has a new logical lifetime.

## Explicit bounds

- The existing nonempty optimistic-target requirement remains. A no-op authored callback is rejected before remote dispatch; DB automatically completes an empty transaction without calling its mutation function. Server-only/no-op optimistic actions require a later dispatch contract, not a fake row write.
- Unknown transport outcomes remain explicit unresolved errors; neither rollback, a read, nor reload is closure evidence. Durable server status lookup is not implemented in this slice.
- The overlap fallback may issue one raw read request per retained collection. Isolated actions keep inline authoritative results. Wire measurements must distinguish these paths.
- Manually pending DB transactions retain DB's documented conflict cascade. Other persisting Endpoint actions retain their owned whole-row snapshots.

Red tests now reproduce stale ordinary reads after retirement, early settlement of overlapping actions, torn optimistic fanout, forbidden late creation, and reentrant event inversion in the current implementation. Further lifecycle/rollback/error and generated full-stack schedules remain required before reporting completion.


### Authority coordinator implemented and checked

_2026-09-11T21:28:17.513Z_

# Authority coordination: implementation and evidence

The coordinator preserves bare writable query collections and synchronous real
Transaction actions. Isolated actions install their inline authoritative results.
Overlapping actions run concurrently, then settle as a covered group after every
handler outcome is known and a fresh read covers all retained collections.

## What changed

- Ordinary and initial reads use the same authority admission boundary. Write
  epochs and collection lifetimes invalidate obsolete attempts even after older
  Transactions retire. Obsolete transports cannot block replacement reads.
- DB installs coordinated state before change callbacks. Reentrant notifications
  preserve causal order; public rollback restores all recipient collections before
  notifying. Existing whole-row optimistic ownership and manual pending rollback
  cascades remain intact.
- The Query adapter accepts an optional data-bound application signal. Aborting it
  prevents obsolete queued rows and readiness from publishing. Runtime separately
  cancels Query requests and mirrors approved authority into its cache.
- Cleanup/restart works through the same Collection object. Late collections join
  coverage. A local rollback does not erase a still-running remote operation.
- Handler closure, read success and local persistence receipts are separate.
  Known read failures can recover without retrying writes. Unknown remote outcomes
  stay explicit errors; a later successful read cannot discharge them.

Runtime implementation: `../../integrated-todo/src/runtime.ts`. Small supporting
changes live in DB's publication scheduler, Transaction and DbClient, and Query
Collection's result-application boundary. These use internal batch/settlement
helpers; the authored Endpoint API is unchanged.

## Design trace

The accepted plan ran in order: [Ground Condition](ground.md),
[state machine v1](state-machine-v1.md), [fresh Hostile Assay](hostile-v1.md),
[revised contract](state-machine-v2.md), then red/green implementation.
`freeze-v1.json` preserves the initial artifacts. The existing
[Field Log](../field-trip-optimistic-coherence/field_log.md) records the selections,
readings and implementation receipts.

The hostile audit exposed causal event inversion and unbatched public rollback.
Its repair distinguishes historical event payloads from current reads after a
reentrant action. Graphs agree after the outer publication context drains.
The broader existing oracle also caught a regression introduced by queued
notifications: cleanup must invalidate a prepared child-collection callback.
That now uses a publication lifetime token, and its original test passes.

The adapter probe showed why a generic permit must belong to the result data:
a retained-cache success notification must not acquire fresh authority merely
because a new read started. The adapter supplies the data to its permit callback.
The Endpoint runtime's ordinary Query results are mirrors of already admitted
coordinator state; its publication permit cancels queued mirror applications.

## Verification

Receipts under `../../integrated-todo/evidence/`:

| Check                           | Result / receipt                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original failures               | `authority-red.tap`, `authority-reentry-red.tap`: overlap, stale read, torn fanout, late creation, event inversion                                                                                       |
| Actual runtime                  | `authority-runtime-final.tap`: authority/overlay, read repair, lifetime, local rollback, unknown outcome and authoring failure regressions                                                               |
| DB and adapter                  | `authority-boundary-oracles-final.tap`: 352 tests across 12 suites, including existing lifecycle, ownership, scheduler, optimistic and child-collection oracles                                          |
| Existing contracts              | `authority-contracts.tap`: 18 top-level checks; includes compiler/server-boundary and runtime suites                                                                                                     |
| Generated concurrent full stack | `authority-concurrent-siblings/report.json`: 3 programs × 3 sequences, 25 operations, 81 source notifications, 84 checkpoints; 12 production client artifacts inspected                                  |
| Three-query controls            | `authority-sibling-controls/report.json`: 3 sequences, 6 operations, 20 notifications, 21 checkpoints; all/active/completed views, reverse server/response order, partial failure and insert dependency  |
| Negative controls               | `authority-mutant-inline`: accepting overlapping inline responses fails early-settlement assertion. `authority-mutant-publication-final`: unbatched fanout fails notification-level PostgreSQL equality. |
| Existing sequential path        | `authority-sequential-controls`: inline update and server-code exclusion controls pass                                                                                                                   |

The concurrent oracle executes generated, compiled endpoint code in Chrome over
actual Start requests, Drizzle and the application PGlite. A separate PGlite
database computes tentative and confirmed results. It checks every recorded
source notification, independently folds event history, checks receipts, and
checks rendered consumers. Server execution and response delivery have separate
gates. Fast-check records the actual final shrunk counterexample for replay.

From the app directory:

```sh
ENDPOINT_ORACLE_SCENARIOS=3 ENDPOINT_ORACLE_SEQUENCES=3 npm run test:oracles:concurrent
node --experimental-strip-types tests/oracles/concurrent.mjs --replay tests/fixtures/authority-siblings.json
npm run test:contracts
```

## Bounds and cost

The generated concurrent campaign currently uses waves of 2–4 operations, then
retires the covered cohort together. More complex lifecycle, repair interruption,
local rollback and reentry schedules are actual-runtime regressions, not yet
dimensions in the full-stack generator. This is a foundation, not an exhaustive
concurrency proof.

An isolated mutation keeps one response round trip. The conservative overlap
fallback presently makes one raw read request per retained collection after
closure. For example, two writes with three retained queries used five POSTs.
Combining those repair reads into one server response remains an optimization.
Byte counts measure decoded bodies; harness timings do not establish latency wins.

The Todo query grammar and nonempty optimistic-target restriction remain.
Tables and column schemas are not generated yet, and Endpoints does not implement
on-demand subset loading. The [SQL and on-demand coverage plan](../../SQL-COVERAGE-PLAN.md)
defines that expansion. The pinned embedded oracle is PostgreSQL 17.5.
External writers, replicas with stale reads, auth changes, cross-tab coordination
and durable unknown-outcome recovery are outside this implementation's guarantee.


### Plan completed: Establish and implement authority coordination

_2026-09-11T21:28:17.517Z_

Ground Condition, state machine, fresh Hostile Assay, red/green coordinator and concurrent full-stack oracle completed. DB/adapter boundary tests pass. SQL schema generation and Endpoints on-demand mode remain explicit future coverage, not implemented claims.

### Kyle

_2026-09-11T21:28:17.517Z_

> **Kyle:** “How are we generating the tables and schemas for SQL and the types of queries? Having full coverage of what Postgres supports is necessary to make sure we know what we can support.”

### Kyle

_2026-09-11T21:28:17.517Z_

> **Kyle:** “Have we looked at support on demand queries? I.e. loading subsets?”

### Kyle

_2026-09-11T21:28:17.517Z_

_Continue the ongoing coordinator/oracle work while accounting for schema/query breadth and on-demand subset coverage._

> **Kyle:** “continue”

### 1 source examined

_2026-09-11T21:28:17.517Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Schema-first generation and on-demand coverage plan

_2026-09-11T21:28:17.517Z_

# PostgreSQL and on-demand coverage for the Endpoints oracle

The current Endpoints oracle does **not** generate database schemas. Its database
fixture fixes Todo columns (`text` keys/text, boolean completion, timestamp and
scope). It generates query declarations, predicate/order combinations, mutations
and schedules. Passing that oracle establishes this slice, not PostgreSQL support.

The pinned PGlite 0.3.14 reports PostgreSQL **17.5**, `server_version_num=170005`.
PostgreSQL's current documentation describes **18**. Record engine versions and
capabilities in each campaign; a missing embedded-engine feature is not evidence
that PostgreSQL rejects it or that Endpoints handles it safely.

## Generate the schema before the endpoint program

Replace the Todo-specific specification with a typed, shrinkable program:

```text
engine capabilities
  → schema (tables, columns, keys, constraints, relationships)
  → valid initial rows
  → typed query and mutation ASTs
  → endpoint declarations and client collection demands
  → operation / I/O / lifecycle history
```

The SUT renderer creates real schema definitions, Drizzle declarations, endpoint
handlers and client code. The reference renderer independently produces DDL and
SQL from the specification. Neither reads compiler output to decide expected
types, affected queries, loaded extents or permissible updates. Keep the same
full-stack driver and PostgreSQL authority; don't replace them with SQL-only tests.

Shrink dependencies together: removing a column must repair or remove expressions
that use it; removing a parent table must repair foreign keys and joins; shrinking
rows must preserve valid fixtures unless a constraint failure is the intended
command. Invalid programs form a separate rejection generator.

## Inventory the whole language surface; label evidence precisely

Use versioned PostgreSQL documentation as the inventory, not the current compiler's
grammar. Each feature needs a status and a test witness. A large random run count
cannot substitute for an unvisited feature family or combination.

| Axis                | Required families / boundary values                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema              | Multiple tables; primary/composite/unique keys; nullable fields; foreign keys and cascades; defaults and generated columns; checks; views/materialized views; partitions; schema-qualified and quoted names                                                                              |
| Types and transport | Integers/big integers; exact numeric; floating point including special values; character/collation; boolean/NULL; binary; date/time/time zone/interval; UUID; JSON/JSONB; arrays; enums; composites; domains; ranges/multiranges; remaining built-in families and extension/custom types |
| Expressions         | Three-valued predicates; casts/coercions; arithmetic; CASE/COALESCE; text/pattern operations; JSON/array operations; stable and volatile functions; subqueries and correlated expressions                                                                                                |
| Queries             | Projection and aliases; joins including outer/lateral; grouping/HAVING/grouping sets; DISTINCT; set operations; window functions; CTEs and recursive CTEs; ordering/null placement/ties; LIMIT/OFFSET/FETCH; row locks                                                                   |
| Mutations           | INSERT/UPDATE/DELETE; UPSERT; MERGE; RETURNING; insert-from-query; multiple statements; data-modifying CTEs; trigger/cascade/generated effects; constraint failures before/after earlier committed statements                                                                            |
| Authority           | Transactions and isolation; rollback/partial commit; other writers; trigger dependencies; schema changes; privileges/RLS; sequences and non-table effects; connection/version/extension capabilities                                                                                     |

Sources for the inventory: PostgreSQL 18 [queries](https://www.postgresql.org/docs/18/queries.html),
[SELECT grammar](https://www.postgresql.org/docs/18/sql-select.html),
[data types](https://www.postgresql.org/docs/18/datatype.html), and
[data manipulation](https://www.postgresql.org/docs/18/dml.html).
These are inventory anchors, not proof that a generated test or optimization exists.

Record separate capabilities for each query/mutation combination:

1. Can it execute and round-trip its values through Endpoints?
2. Can optimistic effects be interpreted soundly?
3. Can the complete potentially affected relation/query set be proved?
4. Can an authoritative result patch be proved complete?
5. Can a loaded subset/window be maintained without refill?

Statuses must distinguish **tested optimized**, **tested full-result fallback**,
**explicitly rejected**, **not tested**, and **unavailable on this engine**. Today,
most rows in the table are not tested by Endpoints, and the compiler rejects many
shapes outside its checked Todo grammar. Do not label those as working fallback.
An unrecognized expression or hidden write dependency must never be silently
classified as safe for a patch or skipped refresh.

For extensible functions/types/operators, test the unknown boundary explicitly.
Then add configured extension profiles with versioned witnesses. Arbitrary user
code is an open set; recognizing that it is opaque is part of complete surface
classification, not proof of its semantics.

## On-demand queries are a separate missing Endpoints boundary

Existing DB/Query adapter tests cover subset acquisition and ownership, and were
included in the coordinator checks. Endpoints itself currently eagerly loads
whole query results. It has no generated subset request transport or oracle.

For on-demand mode the reference tracks **requested extents and completeness**,
independently of what the SUT says it loaded. For a collection, run each retained
subset query separately in reference PostgreSQL; derive resident membership from
their result-key union and declared retention policy. Keep visible window results
separate from underlying resident rows. Limits, offsets and ordering prevent a
simple union of WHERE predicates from representing those results.

The reference still has complete server data even when the client doesn't. This
lets it detect a row entering from outside the loaded extent. Unknown/unloaded is
distinct from absent, and an empty response is distinct from proved exhaustion.

| Dimension   | Commands / assertions                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demand      | Acquire predicate subset; acquire overlapping/disjoint subset; release one owner; retain an idle collection; cleanup/restart; change demand while a response is held                                      |
| Windows     | Limits 0/1/N; offset boundaries; cursor and tie rows; advance/replace window; explicit exhaustion; stable key tie-breakers                                                                                |
| Mutations   | Edit inside/outside loaded rows; move across a predicate or sort boundary; delete the last/first visible row; insert ahead of a window; affect several tables and query collections                       |
| Repair      | Server correction differs from optimism; refill from unseen rows; stale partial response after full replacement; full result followed by obsolete subset; failed/cancelled subset and successful retry    |
| Ownership   | Shared row remains until its last applicable owner retires; one subset's absence is not a collection-wide delete; old lifetime cannot establish new readiness                                             |
| Optimism    | Owned whole-row guesses over loaded rows; incomplete local knowledge; initial load during pending actions; transaction error and local rollback; no invented guess for unseen rows without a defined rule |
| Observation | Every publication and receipt; event-history replay; loaded coverage and readiness; downstream DB query windows; no successful receipt before required replacement is installed                           |

The fallback must state its extent. Recomputing and sending the exact requested
subset is different from promoting the collection to a full-table load. Measure
both requests and bytes; don't call the latter an on-demand optimization.

## Implementation order

1. Add an executable capability manifest and make every campaign report visited
   schema/query/mutation/demand cells, rejected cells and unmeasured cells.
2. Generate small related schemas and typed scalar queries first; retain hand-checked
   controls for nulls, exact numbers, timestamps, collation and key identity.
3. Generalize the full-result transport and collection identity beyond Todo. Prove
   opaque-query fallback before extending patch or invalidation analysis.
4. Add demand/extent state and actual `loadSubset` transport. Begin with predicates,
   then ordered finite windows and refill, crossed with the concurrent schedules.
5. Expand query and mutation families against the versioned inventory. Use PGlite
   for the fast loop and PostgreSQL-version/extension profiles where needed.

This is the next coverage expansion. None of these planned generators or Endpoints
on-demand contracts should be reported as implemented by the current passing tests.


### Kyle

_2026-09-11T21:39:42.274Z_

_Potential server-response evidence for safely applying updates from overlapping mutations._

> **Kyle:** “the manifest would have the LSN e.g.”

### Kyle

_2026-09-11T21:39:42.275Z_

> **Kyle:** “yes — but just put this in the log as a potential optimization for now”

### Potential optimization: LSN-based response coverage manifests (deferred)

_2026-09-11T21:39:42.275Z_

Record only; no implementation or new instrument run is selected. The user proposed carrying an LSN in the server response manifest so the client could potentially prove an update safe despite overlapping mutations and avoid an extra reconciliation read.

The candidate manifest would need trustworthy evidence tying returned query results to covered commits. A mutation's commit position and a query result's visibility coverage are distinct. Sampling pg_current_wal_lsn() after a query does not by itself prove the query saw every commit through that position. A patch would also need its required baseline and affected query coverage. The exact protocol and proof remain open.

Keep the current conservative fresh-read fallback unchanged. Revisit this optimization later using the independent PostgreSQL oracle to check correctness under reordered overlapping operations, and measure transferred bytes and latency against the fallback. No performance benefit has yet been established.

Reference context: PostgreSQL [WAL functions](https://www.postgresql.org/docs/18/functions-admin.html) and [snapshot semantics](https://www.postgresql.org/docs/18/transaction-iso.html).

### Kyle

_2026-09-11T22:15:42.000Z_

> **Kyle:** “ok let's continue with expanding sql coverage in the oracle & then trying out some optimizations for loading data”

### 1 source examined

_2026-09-11T22:15:42.001Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Schema-first oracle and adaptive shared-row transport implemented

_2026-09-11T22:15:42.001Z_

Implemented 2–3 generated tables with 1–3 extra integer/text/boolean columns, variable nullability, optional ON DELETE SET NULL foreign keys, scalar predicates, and direct/multi-table mutations. The SUT renderer generates Drizzle and endpoint code; a separate reference renderer generates SQL. Concurrent parent deletion can produce a PostgreSQL-decided FK rejection, which the oracle now checks as an expected handler outcome.

Final generated campaigns passed 59 sequential operations (187 checkpoints) and 27 concurrent operations (80 notifications, 90 checkpoints), plus an isolated two-operation FK conflict control. Misrouting optimism across relations fails the oracle. Selected-column omission has a red/green regression. Compiler/runtime contracts pass; generated production client artifacts continue to be checked for server-code exclusion.

The first loading experiment shares complete equal typed rows across response snapshots, preserving per-query order and membership. It changes neither SQL execution nor authority admission. Separate-relation and disjoint-key fast paths skip needless encoding. In the 80-row, three-overlapping-view fixture, decoded response bytes fell 58.9%, with one mutation RPC in both strategies. Offline gzip estimates fell 59.8%. Disjoint fixtures kept the same decoded size. CPU and browser timing samples were noisy, so this is evidence of a byte reduction, not a general latency win. An additional two-view measurement is being recorded in the linked report.

The schema/type surface remains bounded by required base row fields and trusted fixture types/imports. Joins and LIMIT have explicit compiler rejection controls; wider SQL families, schema-derived client TypeScript inference, subset loading and LSN manifests remain unimplemented. The existing broader expansion plan stays open. Full report: ../../SQL-COVERAGE-RESULTS.md.

### Two-view measurement complete

_2026-09-11T22:17:12.002Z_

The common two-collection case (full result plus incomplete-only view) passed PostgreSQL state checks under full and adaptive encodings. Across 12 measured mutations per strategy, decoded response bytes fell from 1,953,448 to 1,319,930 (32.4%); offline gzip estimates fell 33.2%. Both used one mutation RPC and had a 13.7 ms median browser action-to-persistence time. Encoder/JSON median increased from 0.26 ms to 1.68 ms. The demonstrated gain is bandwidth, with no localhost latency improvement claimed. Receipt: ../../integrated-todo/evidence/loading-two-views/report.json. The final comparison and explicit limits are recorded in ../../SQL-COVERAGE-RESULTS.md.

### Kyle

_2026-09-11T22:42:35.525Z_

> **Kyle:** “ok great, let's do that — we also need to catalog a lot of more exotic side effects that can happen during mutations to account for”

### Kyle

_2026-09-11T22:42:35.525Z_

> **Kyle:** “hmm yeah mutation functions probably need to know about all queries so they can trigger updates to any of them as needed”

### Kyle

_2026-09-11T22:42:35.525Z_

> **Kyle:** “yeah the client might need to just send all active query collections as part of mutations”

### 1 source examined

_2026-09-11T22:42:35.525Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Trigger oracles pass; registry and join-coverage boundaries remain explicit

_2026-09-11T22:42:35.525Z_

Added six full-stack trigger controls: BEFORE rewrite, suppression, rejection, AFTER recipient fanout, statement transition tables and deferred constraint execution. Sequential effects passed 28 operations/94 checkpoints with 28 production client artifacts inspected. Generated concurrency passed 18 operations/48 notifications/60 checkpoints; only rejection acquired a trigger witness there. A deterministic trigger-fanout/peer-edit overlap passed 3 operations/12 notifications/10 checkpoints. The unsafe optimistic-recipients-only mutant fails at the first confirmed fanout. A delayed external commit remains stale without a signal and repairs after explicit refetch; no push/API integration is claimed.

The independent DB/PGlite join experiment passed 500 changes/1,025 checkpoints with complete input relations. A separate hidden-child witness proves that joined output alone cannot establish enough source coverage for optimistic entry. Compiled Endpoints still rejects joins; joined writes and incomplete coverage are not silently accepted.

The combined read-only SQL experiment preserves all results/order/empty sets and reduces 2–3 SQL calls to one, but saves no result bytes. At 1,000 rows, two overlapping reads cost 5.75 ms separately versus 7.29 ms combined; three with joins cost 8.77 versus 11.13 ms. These are in-process PGlite query/encoding medians, not browser or real-network measurements. The two-read break-even estimate is about 1.54 ms saved database RTT on a sequential connection. Candidate remains experimental.

Next: build-wide query definitions and retained parameterized instance descriptors, including cross-module/lazy definitions, server authorization, late registration and GC/recreation tests, before affected-set pruning. Current transform knows all queries in the same module (not only component), but no other modules and only empty inputs. Full receipts, commands and bounds: ../../SQL-COVERAGE-RESULTS.md and ../../MUTATION-EFFECTS-CATALOG.md. Contracts and TypeScript checks pass. No core runtime/compiler optimization was enabled in this pass.

### Kyle

_2026-09-12T00:32:57.460Z_

_Authorization to implement the cross-module server query registry and retained parameterized query-instance descriptors._

> **Kyle:** “Ok go”

### 1 source examined

_2026-09-12T00:32:57.464Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Cross-module registry and retained parameterized instances implemented

_2026-09-12T00:32:57.464Z_

Mutations now send every retained query instance as definition, source version, canonical instance ID and scalar parameters. A server-only registry discovers endpoint source files across sibling and nested modules independently of the client import graph. It validates the whole requested read set before starting the mutation. Query parameters use `query({ input: schema, params, handler })` and still return the bare writable collection. Supported parameters are required boolean, string and safe integer fields in a literal Zod object.

Red/green work caught two boundary gaps: rejected admission could poison a later healthy mutation, and incompatible projections could enter cross-module optimistic propagation. The runtime now classifies admission as not-started and rejects projection mismatch before creating a recipient. Lifetime tests cover no subscribers, cleanup/restart, stable parameter identity and a new instance during an in-flight mutation.

Validation passed: 32 top-level contracts including 22 bundled runtime cases, TypeScript checks, 12 sequential full-stack mutations, 27 generated concurrent mutations across three schemas and nine histories, and a three-mutation server-trigger overlap control. The latter updates parameterized recipient collections in another module. Production client artifacts and raw-source boundaries were checked for sibling and nested modules. Receipts and replay commands are in ../../QUERY-REGISTRY-RESULTS.md.

Limits remain explicit: fixture request scope is not production authentication; discovery uses source-tree endpoint filenames and relative prototype imports; imported schemas, arbitrary packages/barrels, richer inputs and compiled joins remain unsupported. Source versions do not fingerprint all transitive dependencies or database DDL. No affected-set pruning, new partial authority patches, subsets or LSN optimization was enabled.

### Kyle

_2026-09-12T02:16:11.617Z_

_Authorization to define proof rules, expand the oracle, implement narrow refresh pruning and measure it against full refresh._

> **Kyle:** “Perfect, go”

### 1 source examined

_2026-09-12T02:16:11.621Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Selective refresh works within its proof contract; default remains full refresh

_2026-09-12T02:16:11.621Z_

Implemented server-issued baseline tokens and explicit unchanged entries. A token binds a query definition/version, scope, parameters, instance and captured dependency revision. Capture occurs before the authoritative row read. Missing, evicted, foreign-scope or unknown proofs cause full reads. Client publication requires exactly one snapshot or matched unchanged token per retained instance; overlap/lifetime repair still takes fresh authority and clears old tokens.

A disjoint write set alone cannot show that an earlier client baseline is current. The first adapter therefore observes actual committed relation revisions with transactional statement triggers, instead of claiming static inference of arbitrary mutation effects. Its installation is explicit in disposable PGlite fixtures. It requires fixed schema/protected observers, primary reads, scalar public heap tables and stable fixture auth. General DDL, arbitrary auth/session dependencies, replicas, subsets and LSNs remain excluded. Normal Todo app does not install it.

Tests passed: 42 top-level contracts and TypeScript; 30 generated SQL histories with 276 checkpoints and 483 skipped reads; 91 browser mutations/204 checkpoints across full/selective comparisons, typical one/two-query clients, parameterized sibling/nested modules, trigger/deferred fanout and concurrent trigger replay. Production client source boundaries pass. The deliberately broken recipient revision shrinks to two source-table UPSERTs (seed 911051, path 0:0:0:0:0:0:0:0).

Red/green found that pinned Seroval changes quoted object keys, breaking a certificate map keyed by parameterized JSON IDs. Certificates now travel as arrays of id/token entries; an installed-serializer regression covers the boundary. It also found same-named tables in other schemas could borrow public revision readers; qualified schema exclusion is now tested. The effect browser harness needed to hold the optimistic phase before server triggers ran; this was a phase mismatch, not a correctness repair in the SUT.

Measured local medians, full to selective: one query 5.5 to 7.0 ms, two queries 12.4 to 12.2 ms, six queries 9.8 to 11.4 ms, nine queries 27.0 to 26.5 ms. Total request/response bytes fall roughly 48% for two larger collections and 61% for nine, but proof SQL and observer writes have costs. One query transfers more data. Eight measured mutations per case/strategy cannot establish tiny latency differences as wins; no WAN or multi-connection contention result is claimed. Full measurements, limits and replays: ../../REFRESH-PRUNING.md.

### Kyle

_2026-09-12T02:31:51.080Z_

_Correction to interpreting local full-refresh versus selective-refresh latency measurements._

> **Kyle:** “Fewer bytes almost certainly turns into latency wins. You're measuring on loopback”

### Kyle

_2026-09-12T02:31:51.080Z_

_The experimental adapter installed PostgreSQL revision counters and statement triggers in disposable oracle databases._

> **Kyle:** “We can't modify people's postgres”

### Database observer removed; no PostgreSQL modifications allowed

_2026-09-12T02:31:51.080Z_

Kyle ruled out modifying user PostgreSQL databases. Removed the experimental revision-trigger adapter, its compiler hook, dedicated PG observer tests, benchmark source renderer/runner and concurrent-oracle mode. The implementation had only run in disposable PGlite fixtures, never the ordinary Todo app. Generic baseline proof, transport serialization and client overlap regressions remain; compiled endpoints supply no revision authority and refresh all retained instances.

The earlier experiment report now starts with the rejection and hard constraint, retaining historical receipts rather than presenting the observer as an opt-in deployment option. Loopback results cannot establish that fewer bytes lack a real-network latency benefit; network measurements remain unperformed. The adapter is rejected for violating the database constraint, not because its byte savings lack value.

Verification: 38 remaining top-level contracts and TypeScript checks passed. No references to the removed observer/compiler hook remain in executable source or test runners. Current evidence: integrated-todo/evidence/no-postgres-changes-contracts.tap; historical report: ../../REFRESH-PRUNING.md.

### Kyle

_2026-09-12T02:48:35.164Z_

_User chose foundational research before further optimization instruments; modifying user PostgreSQL remains excluded._

> **Kyle:** “This looks great but let's first do a research survey to relational algebra etc. to get a good sense of what operations are doable”

### 1 source examined

_2026-09-12T02:48:35.165Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Relational algebra survey: possible operations and required information

_2026-09-12T02:48:35.165Z · research-survey_

Mapped relational delta rules, required auxiliary state, affected-region recomputation and baseline-dependent result transfer across 24 primary sources. PostgreSQL observation limits remain separate from algebraic feasibility; no design or implementation selected.

### Kyle

_2026-09-12T03:11:11.417Z_

_Accepted the proposed Ground Condition pass: research-linked optimization applicability table, required information/location, breaking conditions and minimal counterexamples before design._

> **Kyle:** “Ok great go”

### 1 source examined

_2026-09-12T03:11:11.417Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Optimization boundaries: exact bases, complete effects and snapshot scope

_2026-09-12T03:11:11.417Z · ground-condition_

Nine controlled witnesses passed on PostgreSQL 17.5; four existing encoder tests passed. Complete fresh outputs allow representation optimization without a complete mutation log, but exact-base correspondence and target authority remain separate requirements. No runtime optimization changed.

### Kyle

_2026-09-12T04:42:33.128Z_

_Accepted Design Grammar for server-retained exact bases, client-supplied exact bases and compact summaries; lifecycle, fallbacks and oracle laws before selection/implementation._

> **Kyle:** “Ok go”

### 1 source examined

_2026-09-12T04:42:33.131Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Result diffs: baseline custody is separate from publication authority

_2026-09-12T04:42:33.131Z · design-grammar_

Three unranked baseline forms and twelve proposed oracle laws. Server retention costs memory; exact upload costs upstream bytes; compact summaries need an explicit equality proof. Response loss cannot imply adoption. No runtime changes.

### Kyle

_2026-09-12T05:22:12.176Z_

_Accepted a networked PostgreSQL adapter experiment comparing pipelined post-mutation reads against ordinary reads through the oracle._

> **Kyle:** “Ok great go”

### 1 source examined

_2026-09-12T05:22:12.177Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Pipelined full reads work; Drizzle preparation is the adapter boundary

_2026-09-12T05:22:12.177Z_

The networked PostgreSQL experiment passed 1,200 generated response comparisons across five adapter paths, plus 17 controls and 21 existing contract tests. A dropped-result mutant failed as intended. The JSON binding fixture error found by the oracle was corrected and retained as a shrunk replay.

With three small reads and 20 ms nominal injected RTT, the complete mutation/refresh response took 106.5 ms on a non-pipelined connection, 53.2 ms pipelined on one connection and 55.2 ms through a three-connection pool. A server-delay control favored the pool. These are controlled local TCP measurements, not WAN or browser latency.

Drizzle 0.45.1 calls Postgres.js unsafe without preparation. The default parameterized read path had one execution outstanding; an experimental prepared-read wrapper had three, while preserving Drizzle binding and result mapping. The wrapper is not installed in the application. All full reads and existing authority rules remain. Compression belongs to the app server; Query Collection/core already avoid unchanged row notifications.

[Results and limits](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/pipelined-reads/RESULTS.md) · [Reproduce](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/pipelined-reads/README.md) · [Raw oracle](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/pipelined-reads/evidence/oracle.json) · [Raw benchmark](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/pipelined-reads/evidence/benchmark.json)

The disposable PostgreSQL container was stopped and removed. Application/runtime/compiler source hashes remain unchanged. Browser oracle integration, other drivers, cold deployments, transaction/pooler compatibility, contention and disconnect cases remain outside this experiment.

### Kyle

_2026-09-12T14:31:26.567Z_

_Accepted integrating the prepared Postgres.js adapter._

> **Kyle:** “Ok do that”

### Kyle

_2026-09-12T14:31:26.573Z_

_Questioned the separate opt-in read adapter._

> **Kyle:** “Why opt in?”

### Kyle

_2026-09-12T14:31:26.573Z_

_Set the prototype policy for configuration choices._

> **Kyle:** “Options are for successful projects. We're just prototyping. Only add options now if there's some genuine splits in how something is done. If the option is just because it doesn't always work or something like that then we should probably skip it for now”

### Prepared execution becomes the prototype adapter default

_2026-09-12T14:31:26.573Z_

The shared Postgres.js adapter now enables prepared execution through one ordinary Drizzle database. There is no Endpoints optimization flag or separate read client. Kyle set the rule that prototype options should represent real design alternatives, not incomplete support. Existing driver settings and pool ownership pass through unchanged. Transaction and reserved-client methods retain native behavior; those scoped paths may not pipeline.

The independent PGlite oracle passed 1,440 responses across six adapter paths and 18 controls, including pooled Drizzle and the driver preparation setting. Three adapter contract tests passed, covering 100 generated argument cases, pool/lifecycle identity and server/client build boundaries. Adapter and Todo type checks passed. The identity-adapter red control failed on missing preparation defaults before implementation. The earlier latency benchmark remains a historical measurement, not a new performance claim. The disposable PostgreSQL container was stopped.

[Adapter and limits](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/POSTGRES-ADAPTER.md) · [Verification](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/pipelined-reads/evidence/adapter-checks.json)

### Kyle

_2026-09-12T15:19:01.399Z_

> **Kyle:** “Ok great. Next let's try converting kitchen ai, a project on this computer that's currently DB + electric to just DB endpoints to see how it works there”

### Kitchen AI trial: eight collections, real sessions and embedding cost

_2026-09-12T15:19:01.404Z_

Kitchen AI now has an isolated conversion on codex/db-endpoints. Its eight Electric collections and transaction-ID confirmation paths are replaced by Endpoints declarations and same-response full reads. Existing business procedures run in-process on the server; the browser tRPC client and HTTP route are removed. Client DB queries remain, including recipe-card aggregates. Real Better Auth sessions are verified for every read and mutation, and collections are bound per session user. Shopping-list writes also pass through Endpoints because they update PostgreSQL after Trello succeeds.

The trial required application row schemas and non-fixture scope strings in the shared runtime. Wrong-type authority is still rejected before installation. Schema-validated handlers outside the bounded scalar grammar get independent full snapshots, with no inferred cross-query optimistic propagation. This records an implementation trial, not a new instrument reading.

Production build, application and framework type checks, and the runtime/compiler/registry regressions pass. The browser oracle made 232 collection comparisons across three generated histories (seed 20260912), plus multi-table optimism, comment IDs, rollback, overlapping writes, cascades and anonymous rejection. Thirty-four client JavaScript files contained none of the checked server implementation markers; direct client loading of the database server module was rejected before source delivery.

A read-only aggregate check of the existing local database found 124 rows totaling 520,097 bytes of PostgreSQL row JSON. Raw embedding strings account for 482,333 bytes, about 93%. This is a payload-size estimate, not compressed HTTP traffic or latency. The initial app binding retains all eight collections and refetches all eight after writes.

Electric background push synchronization is removed: other writers become visible on a later endpoint mutation or reload. Live AI and Trello calls were not exercised, and credentials were not copied. Disposable write-test services were stopped; the existing app data, services and uncommitted Caddyfile change remain intact. No deployment, commit or push was performed.

[Migration notes](/Users/kylemathews/programs/kitchen-ai/.worktrees/codex-db-endpoints/ENDPOINTS-MIGRATION.md) · [Checks](/Users/kylemathews/programs/kitchen-ai/.worktrees/codex-db-endpoints/tests/endpoints/evidence/checks.json)

### Kyle

_2026-09-12T15:28:13.851Z_

> **Kyle:** “Yeah we shouldn't worry about external writes as discovering those isn't our concern. That's covered by either polling, an external event system (triggering a poll) or a proper sync engine. So we do need to expose the refetch utils for query collection endpoints”

### Expose refetch; separate external freshness from mutation reconciliation

_2026-09-12T15:28:13.852Z_

Query endpoint signatures now retain QueryCollectionUtils on the bare collection, so listTodos.utils.refetch({ throwOnError: true }), error state, and clearError are typed. The existing runtime already had these utilities; its public Collection type erased their signatures. A red type test showed invalid refetch options were accepted before the change; the typecheck passes after preserving the utility type. A runtime regression checks an external row replacement stays invisible until explicit refetch, then appears without a mutation.

This does not implement selective reads. The shared coordinator still reads all retained collections. Follow-up dependency matching must include all affected retained collections and indirect mutation effects, falling back when effects are unknown. External writes into a selected collection are naturally included by its full snapshot, but unrelated collections need no incidental refresh. Earlier oracle cases asserting unrelated external freshness describe the broad fallback, not a constraint on selective refresh. Keep stale-response, overlapping mutation, rollback, and affected-collection authority laws intact when updating the oracle.

### Kyle

_2026-09-12T15:49:46.324Z_

> **Kyle:** “Ok let's do the dependency matching next oracle style”

### Dependency matching with a generated PostgreSQL oracle

_2026-09-12T15:49:46.325Z_

The server registry now selects mutation reads from complete server-owned read and write footprints. Unknown footprints fall back to full refresh. Query admission still precedes writes; all affected retained instances participate regardless of subscribers. Optimistic recipients and collections without a confirmed baseline require authority even when server writes are disjoint. Responses explicitly account for skipped instances as unaffected, and the client rejects incomplete/duplicate/unknown coverage before publishing. Unaffected rows are not reinstalled. Overlap and lifetime changes retain full fresh-read recovery.

This implements the matching layer and protocol, not automatic footprint discovery. Compiled handlers and Kitchen AI's opaque service calls still have unknown footprints and continue to refresh all retained collections. The fixture's footprint facts cover its actual SQL effects; no PostgreSQL tracking objects or public endpoint options were added. Trigger and FK DDL exists only in disposable oracle databases.

The generated in-process stack runs real Drizzle reads, the registry, serialization, optimistic DB collections and independently rendered PostgreSQL oracle queries. Seed 9122601 passed 30 generated schemas with three histories each, plus a trigger control: 494 operations, 3,967 optimistic and 3,967 authority comparisons, 2,908 reads executed and 1,059 reads skipped. It varies two to five tables, schema-qualified same-name tables, filters, joins, aggregates, unknown effects, changed server targets, multi-table writes, partial errors and unrelated external writes. A separate executed ON DELETE SET NULL control passes. Deliberately omitting either trigger or FK effects fails against PostgreSQL. Only full base views participate in this fixture's optimistic propagation; joins and aggregates settle authoritatively.

Fast-check found the prototype rejected an action when its optimistic update changed no row. The minimal counterexample was two identical updates. A focused red/green repair now executes and tracks the server operation even with an empty optimistic overlay, preserving DB's ordinary empty-transaction behavior. A separate red/green check ensures skipped collections are not needlessly reinstalled.

Typecheck and 45 top-level contract tests pass (the runtime contract contains 31 regression tests). The companion browser registry oracle passed two compiled programs, 12 operations, 38 checkpoints and server-code checks on eight client artifacts. That browser campaign exercises the default unknown-footprint path, while selective matching is exercised in process and with the actual transport serializer. The synthetic read savings do not measure footprint-discovery cost or app latency.

Next boundary: safely deriving complete footprints for real handlers, including indirect effects and authorization dependencies. Until then, retain unknown and full refresh. [Implementation and limits](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/DEPENDENCY-MATCHING.md).

### Kyle

_2026-09-12T16:01:51.678Z_

_The assistant had begun an unintegrated runtime catalog preflight and transaction/lock guard for dependency discovery._

> **Kyle:** “We should only do the schema check at compilation time, not at runtime. It'll be super slow if we did that at runtime.”

### Removed the runtime schema-proof experiment

_2026-09-12T16:01:51.679Z_

Removed the unintegrated analyzed-refresh.server.ts experiment and its registry hooks. It would have queried catalogs and acquired table locks in a short transaction; it was never connected to generated handlers. No application database was changed. Compilation-time handler candidate analysis remains in handler-dependencies.mjs, with three focused tests. It is not yet wired into compilation or backed by a compile-time schema snapshot. Typecheck and 16 focused compiler/registry/matcher tests pass. The next implementation must generate complete footprints during compilation and keep runtime work to dependency matching plus the selected result reads.

### Kyle

_2026-09-12T16:29:02.776Z_

_Proceed with compilation-time schema inspection and automatic dependency discovery._

> **Kyle:** “Ok go”

### Compile-time footprints: generated endpoints and PostgreSQL oracle

_2026-09-12T16:29:02.776Z_

Implemented the first bounded compiler path from direct Drizzle handlers plus a build-time PostgreSQL catalog snapshot to server-owned read/write footprints. The CLI uses the build environment's DATABASE_URL and named db module, emits no credentials, and removes stale evidence on absent configuration or failed inspection. Generated requests only match precomputed sets; no catalog queries, schema locks or proof transactions run during mutations. No application PostgreSQL objects were installed.

The static grammar accepts single-statement select/insert/update/delete handlers, primitive inputs and simple expressions. Imported database/table bindings and reexports resolve to schema-qualified physical identities. Catalog analysis expands FK actions transitively; triggers, policies, views, unsupported types/constraints/indexes and other unknown effects retain full refresh. Runtime column hooks, helper/auth calls, branches and multi-statement handlers are unknown. This is a bounded analysis under standard unmodified Drizzle/driver behavior, not a whole-program proof. Snapshots must match the deployed database/schema/configuration and be rebuilt on changes; runtime does not detect drift.

The generated-program oracle now infers footprints from actual compiled endpoint source and inspected disposable schemas rather than supplying fixture footprints. A separate PGlite database executes independent SQL for expected values. Seed 9122602 passed 20 scenarios times three histories plus a trigger control: 301 operations, 946 authoritative collection comparisons, 402 result reads and 544 skipped reads. Immediate optimistic values are also checked. SQL traces contain zero runtime catalog queries and reject added locks/transactions. Deliberately ignoring a real trigger causes stale rows and is caught by the PostgreSQL oracle.

The actual browser/HTTP campaign passed two generated builds, six operations, 18 comparisons, 11 reads and seven skipped reads; eight client artifacts passed server-boundary checks. All 52 top-level contract tests and the application typecheck pass. Red compiler receipts and final contracts are preserved with oracle reports. The build catalog logic is exercised through PGlite; the CLI's pg TCP connection path has not been tested against a user database. Counts describe synthetic workloads, not app latency.

Kitchen AI's opaque service handlers remain outside the grammar and still use full refetch; no Kitchen database capture or traffic savings are claimed. This is an implementation update, not a new instrument reading. No commit or push performed.

[Compiler setup, support and evidence](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/COMPILED-DEPENDENCIES.md).

### Kyle

_2026-09-12T16:58:55.287Z_

> **Kyle:** “Ok let's implement following functions to find SQL code as that's very normal and we want to get kitchen ai working”

### Kyle

_2026-09-12T16:58:55.288Z_

> **Kyle:** “We want queries and mutations converted to endpoints. So no need to keep trpc”

### Follow ordinary functions; remove Kitchen AI tRPC wrappers

_2026-09-12T16:58:55.288Z_

The compiler now follows local and imported functions, reexports and namespace aliases, returned service objects, closure/callback parameters and database handles passed through transaction callbacks. It collects the union of writes across multiple statements, branches and error paths, including writes before failure. Supported pure Zod transforms and Drizzle-Zod schemas can be followed. Recursion, reassigned functions, unsupported external calls, effectful validators, raw SQL and executable SQL argument objects retain unknown/full refresh. The analyzer executes no application code and has a bounded analysis budget. It assumes standard unmodified library/driver behavior, not whole-program purity.

A generated multi-module oracle varies direct versus service handlers and hidden second-table writes. Seed 9122602 passed 20 scenarios times three histories plus two controls: 269 operations, 755 authority comparisons, 403 result reads and 352 skipped reads, with zero runtime catalog queries. Immediate optimistic rows are also checked. Omitting a helper's second-table effect causes stale data that the independent PGlite oracle catches. Two helper browser builds passed six operations, 18 comparisons and eight client artifacts. All 63 framework contract tests and the prototype typecheck pass.

The Kitchen AI worktree now calls ordinary typed services through Endpoints. The tRPC routers, caller, client/route remnants and package dependency are removed. AST comparisons verified preservation of all 22 existing procedure bodies and input schemas; the sole output validator remains. Session verification, ownership checks, service error code/message/cause, transactions and AI/Trello business logic remain. Original modified files were backed up and hashes verified before applying. Automatic approval review rejected the first unbacked bulk apply; the backed-up, verified application succeeded without overwriting newer edits.

Kitchen passes typecheck, targeted ESLint, production build and its browser/PostgreSQL oracle: 232 collection comparisons, seed 20260912, including optimism, rollback, multi-table tags, overlapping writes, cascades and anonymous rejection. Thirty-four production client JavaScript files contain none of the checked database/auth-adapter/service/AI implementation markers. Live AI/Trello calls were not run. The temporary Vite server and PostgreSQL container/volume were cleaned up; no deployment, commit or push occurred.

Two integration gaps were found and repaired red/green. Vite 8 treats transform addWatchFile dependencies as module imports, which tried to import the build schema into the client; compiler inputs now use the dev-server watcher. The pg driver returns PostgreSQL name[] as text, unlike PGlite; the catalog query now casts search_path to text[]. A real build-CLI control passes against disposable PostgreSQL, filling the adapter gap that PGlite alone could not cover.

Selective refresh is NOT yet enabled for Kitchen: actual compile-time diagnostics against its disposable schema report unknown for all eight queries and ten actions, chiefly at the Better Auth factory, with ingredient creation also blocked by an enum factory. Its schema also contains types/defaults outside the classifier. No application schema snapshot was installed, no auth checks were bypassed, and no Kitchen read savings are claimed. The next boundary is complete effects for external auth/service libraries and supported application schema features. This is an implementation update, not a new instrument reading.

[Compiler support and evidence](/Users/kylemathews/.codex/worktrees/e079/tanstack-db/probes/endpoints/integrated-todo/COMPILED-DEPENDENCIES.md) · [Kitchen migration](/Users/kylemathews/programs/kitchen-ai/.worktrees/codex-db-endpoints/ENDPOINTS-MIGRATION.md).

### Kyle

_2026-09-12T17:06:13.081Z_

_Select ground condition, then exploratory design grammar, then fracture scan and a fresh hostile failure assay in parallel for the auth design._

> **Kyle:** “ok go”

### 1 source examined

_2026-09-12T17:14:03.153Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Auth checks can renew or delete sessions

_2026-09-12T17:14:03.153Z · ground-condition_

The boundary is permission, payload value, and side effects; cache revocation policy remains a choice.

### Plan completed: Ground auth behavior and boundary cases

_2026-09-12T17:14:03.153Z_

Ground condition completed with eight measured public API controls and a sourced boundary map.

### 1 source examined

_2026-09-12T17:19:48.954Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Auth grammar: permission does not imply payload refetch

_2026-09-12T17:19:48.955Z · design-grammar_

Three unranked forms preserve distinct boundaries; per-query split frozen for selected audits.

### Plan completed: Extract exploratory auth/dependency grammar

_2026-09-12T17:19:48.955Z_

Exploratory grammar v1 frozen; layered brief and controls saved. F2 frozen for independent parallel audits, not adopted.

### 1 source examined

_2026-09-12T17:20:20.626Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Full refresh does not close auth side effects

_2026-09-12T17:20:20.627Z · fracture-scan_

One admitted fracture: an opaque query guard can write after another collection is sampled.

### Plan completed: Test the grammar candidate against its own promises

_2026-09-12T17:20:20.627Z_

Fracture scan completed on frozen candidate with an executed PGlite witness and scope controls.

### 2 sources examined

_2026-09-12T17:23:05.415Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Auth split must also cover repair, fallback and failure closure

_2026-09-12T17:23:05.415Z · hostile-assay_

Fresh blind assay returned two bounded composition undercutters and an error-path hypothesis; all-proven protocol survived direct attacks.

### Plan completed: Blind failure test of the grounded auth candidate

_2026-09-12T17:23:05.415Z_

Fresh hostile assay completed with dispositions for all material attacks and oracle gaps; no implementation.

### 1 source examined

_2026-09-12T17:23:31.566Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Auth audit scope qualification

_2026-09-12T17:23:31.567Z_

The PGlite witness establishes an unsafe schedule in the existing full-refresh fallback. It does not refute a new protocol that actually completes every guard effect before every covered payload read. Fracture FRC1 and hostile A2 concern whether that protocol can preserve the expressly allowed opaque fallback and every-retained guarantee in mixed batches. Hostile A1 separately shows the inherited client repair path has no such barrier. A3 is an unexecuted error-path closure hypothesis. No app implementation, policy choice, or performance result follows from these instrument returns.

Saved in auth-design/audit-scope.md. Selected runs22–25 are complete; no auth implementation changes were made.

### Kyle

_2026-09-14T14:42:43.637Z_

_Corrects the compiler/application authority boundary; prior compiler auth restructuring is rejected._

> **Kyle:** “no the complier shouldn't be inserting auth stuff — that's super dangerous and unreliable — we should be *linting* the code & suggesting ways the agent can improve it & then extracting whatever guarantees the code provides to drive the system”

### Kyle

_2026-09-14T14:42:43.637Z_

> **Kyle:** “ok let's start over on the design with these parameters clear”

### Auth design reset: code defines guarantees

_2026-09-14T14:42:43.637Z_

Kyle's correction replaces the compiler-generated guard/payload architecture. The application owns auth and execution order. Analysis extracts evidence; linting explains gaps and suggests reviewable source edits. The earlier universal fresh-query-auth premise is withdrawn. Existing source observations remain evidence, and the earlier artifact index now marks that direction superseded.

The user-requested first draft is [Code-first guarantees and linting](auth-design-reset/DESIGN.md). It separates source facts, optimization obligations and diagnostic content; includes ordinary-code examples and an oracle-led first implementation slice. No public API, automatic auth refactor, framework implementation, or new instrument result is claimed.

### Kyle

_2026-09-14T14:44:25.222Z_

_Selects a fresh Design Grammar with application-owned behavior, lint suggestions, and guarantees extracted from existing code._

> **Kyle:** “yes”

### 1 source examined

_2026-09-14T14:49:42.667Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Design Grammar: code evidence drives diagnostics and permitted optimizations

_2026-09-14T14:49:42.667Z · design-grammar_

Four candidate units, six compiler controls, two unranked composable extensions; application behavior remains author-owned.

### 1 source examined

_2026-09-14T14:49:55.387Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Kyle

_2026-09-14T15:01:58.134Z_

> **Kyle:** “yeah, we're starting with just understanding raw sql and its implications. Following function calls & understanding common libraries is future work”

### Kyle

_2026-09-14T15:01:58.135Z_

_Confirms raw SQL/schema analysis, dependency-driven refresh selection, explicit additional refresh requirements and diagnostics; function/auth-library analysis deferred._

> **Kyle:** “yes”

### V1 scope fixed: SQL first, explicit additional refresh targets

_2026-09-14T15:01:58.135Z_

Recorded the agreed boundary in [V1-SCOPE.md](V1-SCOPE.md). Raw SQL and supported schema implications drive inferred refresh targets. Explicit requirements add targets. Function-call and auth-library understanding are deferred; no auth restructuring. Updated the broader draft's scope notice without changing frozen instrument artifacts. No implementation or new tests changed in this exchange.

### Kyle

_2026-09-14T15:36:52.385Z_

> **Kyle:** “let's just move kitchen's sql into the endpoint functions (assuming that's not too weird?)”

### Kyle

_2026-09-14T15:36:52.386Z_

> **Kyle:** “ok once the kitchen ai port is done, let's circle back to finding a good way to do truly broad pg generation”

### Kyle

_2026-09-14T15:36:52.386Z_

> **Kyle:** “yeah, this restriction isn't needed — we need a better way for you to analyze what's safe or not — you keep going far beyond what relational algebra supports. Is there some sort of deterministic script you can use to analyze things that we could write?”

### Kyle

_2026-09-14T15:36:52.386Z_

> **Kyle:** “ok this is a very very critical thing to get right — both to ensure correct data in browser but also not miss out on easy optimizations that are safe — should we go deeper? Research survey/design grammar? Or wait until the full pg run later after getting kitchen ai working”

### Kitchen inline SQL verified; support-rule design needs a stronger foundation

_2026-09-14T15:36:52.386Z_

Moved all ten Kitchen mutation paths into endpoint handlers. Removed unused service factories; AI and Trello helpers now return data without database access. Preserved ownership checks and transaction boundaries. Fixed a compiler rejection of ordinary console logging with a red/green boundary test. Added direct-statement/inline-transaction dependency extraction with explicit diagnostics for uninspected calls. Build snapshots recognize native enums/JSON/defaults and some built-in expression indexes. These passing cases do not resolve Kyle's criticism of table-wide readable/writable classifications.

Verification: Kitchen browser oracle passed 232 collection comparisons, including real auth and rollback. A companion compiled Kitchen test exercised all ten actions with stubbed external services and 96 PG comparisons; ingredient edits refreshed one of eight collections and recipe deletion refreshed four. Production build and type checks passed; 34 client JS artifacts contained none of the checked server markers. Disposable test server/database were stopped; no production app database was changed.

SQL dependency oracle: 495 operations, 3,975 optimistic and 3,975 authority comparisons, 1,057 skipped reads. Removing a write dependency fails on stale join results. Latest compiled generator: 258 operations, 715 authority comparisons, 328 skipped reads, zero runtime catalog queries. Generator variation includes auth prefixes, transactions, native defaults/types, built-in vs custom expression indexes, triggers, FK actions, and CRUD histories; it is still template-based rather than broad PostgreSQL grammar generation.

[Proposed deterministic rule checker](../../SQL-EFFECT-RULES-PLAN.md) separates table dependency pruning from client expression evaluation and row-patch proofs. It calls for metamorphic laws that fail on needless support restrictions as well as mutants that fail on missing effects. No new Field Lab instrument ran; the next recommendation is a focused research survey followed by a grounded design grammar. Evidence: [Kitchen compiled paths](../../integrated-todo/evidence/kitchen-inline-sql/report.json), [SQL oracle](../../integrated-todo/evidence/sql-dependencies-final/report.json), [compiled oracle](../../integrated-todo/evidence/sql-rules-final/report.json).

### Kyle

_2026-09-14T15:38:40.237Z_

_Accepts the proposed focused Research Survey, then Design Grammar and executable checker with two-sided tests, before broad PostgreSQL generation._

> **Kyle:** “ok go”

### 28 sources examined

_2026-09-14T15:49:53.741Z_

Source activity is folded here for readability. [Browse the complete source record](?file=field_log.md&page=artifacts&kind=source).

### Research Survey: SQL effects and justified refetch pruning

_2026-09-14T15:49:53.741Z · research-survey_

28 source records; independence is narrower than patch correctness. Operation-specific effects and independent precision tests replace the rationale for table-wide bans.

### Kyle

_2026-09-14T15:49:53.741Z_

_Resolves the design premise: analyze PostgreSQL routine bodies and their effects; declarations alone do not certify user-defined routines. General Node.js/helper analysis stays deferred._

> **Kyle:** “yeah we should analyze PG functions”

### Design Grammar: operation-specific SQL effects and PG function bodies

_2026-09-14T15:56:06.268Z · design-grammar_

The checker separates SQL effects, independence, and browser authority. PG bodies contribute effects; declarations alone do not certify them. Two-sided oracle controls remain the next implementation task.

### SQL effect design artifacts and clarified scope

_2026-09-14T15:57:01.518Z_

The selected Research Survey and Design Grammar are complete. PostgreSQL function bodies/calls are included; general JavaScript/helper analysis stays deferred. The new checker is not implemented yet.

Use these artifact paths from the Field Log: [primary grammar reading](sql-effects-grammar/BRIEF.md), [model](sql-effects-grammar/MODEL.md), [evidence and controls](sql-effects-grammar/EVIDENCE.md), [process](sql-effects-grammar/PROCESS.md), [preservation contract](sql-effects-grammar/PRESERVATION.md), [survey](../../SQL-EFFECTS-SURVEY.md), and [implementation sequence](../../SQL-EFFECT-RULES-PLAN.md). The preceding readout reproduces the standalone brief; its short support links are relative to the brief’s own directory.

### Oracle guide loss audit: six gaps in test evidence

_2026-09-14T16:24:47.522Z · loss-audit_

The fresh audit preserves six losses, eight retained groups and six deferrals without claiming production defects.

### SQL effect kernel red/green: independent values and precise refetch obligations

_2026-09-14T16:29:02.336Z_

The initial SQL effect kernel and PostgreSQL oracle now have separate value and precision evidence. The legacy analyzer reaches real registry/client settlement with correct values but fails the read-count law after a SQL function write. The new kernel follows SQL routine bodies/calls, keeps relation/event derivations, and supplies specific effects to the real registry and client collections.

The green campaign ran 12 generated programs × 3 histories plus four fixed histories: 40 histories and 137 mutations. Independent reference PG checks immediate optimism and settled rows; independent fixture semantics check exact refetch obligations. There were 371 result reads and 314 skips, with 16 build catalog calls and zero runtime catalog calls. Seventeen new/existing contract tests passed.

Removing a hidden body read fails on stale client values. Introducing an index-based fallback preserves values but fails the read-count law. A generated hidden-read fault shrank ten times while preserving its violation; six proposed shrinks into a different read-count failure were rejected. The saved history reproduces the original violation with the fault and passes without it.

The fresh guide audit remains a separate frozen reading. The new oracle addresses independent expectations, semantic shrinking/replay, cleanup diagnostics and per-law reach receipts for its own path. Older runners still need those repairs; the concurrent browser snapshot and rendered-value gaps remain open. No fresh browser, HTTP, bundle-exclusion, latency or full-PostgreSQL evidence is claimed.

This is the initial kernel and integration oracle, not the compiler rollout. Existing compiler consumers still use the legacy analyzer. General SQL binding, unsupported PG languages/dynamic bodies, exact source spans, and richer context/deployment evidence remain open. Unknowns are implementation gaps, not relational-algebra prohibitions or permanent table eligibility policy.

[Implementation and all receipts](../../integrated-todo/SQL-EFFECT-RULES-RESULTS.md) · [Updated plan](../../SQL-EFFECT-RULES-PLAN.md) · [Fresh loss audit](oracle-guide-loss-audit/AUDIT.md)


### Older oracle repairs: independent state, complete observations, preserved failures

_2026-09-14T16:55:39.997Z_

The older audited oracles now use independent admitted baselines, preserve the concurrent invocation snapshot, and compare rendered text alongside ordered IDs. Test-only wrong-baseline, immediate-snapshot and rendered-text controls passed the old observers and fail the intended repaired comparisons. The saved browser failure reproduces with its fault and passes without it.

Shared evidence handling preserves the first failure through shrinking/replay, records named comparisons and fault reach, captures provenance before execution, attempts all cleanup and writes the verdict afterward. A cleanup fault fails the final report even when assertions pass. Actual fast-check controls reject a shrink from a row failure into a build error. A new nested-runner regression caught and fixed an error in the shared wrapper: only the outer scenario may accept or reject a shrink; inner sequences must propagate their first failure.

Validation: all 77 contract tests pass. Final compiled, dependency, concurrent browser, SQL browser and E2E campaigns pass with 71, 149, 4, 11 and 20 operations respectively (255 total). The final campaigns record no cleanup errors. Controls, retries, coherence, exhausted retries and existing client/server boundary checks ran; this is a bounded repair campaign, not broader PostgreSQL generation.

The consumer assertion covers ordered IDs and rendered text at named checkpoints after two animation frames. Every intervening React commit and unrendered columns remain outside this observer. Auxiliary registry/loading/compiled-browser callers received finalization changes because they share the driver; their entire campaigns were not rerun. Production mutation behavior is unchanged.

[Repairs, controls and receipts](../../integrated-todo/ORACLE-REPAIR-RESULTS.md) · [Updated oracle plan](../../ORACLE-PLAN.md) · [Original frozen loss audit](oracle-guide-loss-audit/AUDIT.md)


### Fresh oracle-guidance loss audit

_2026-09-14T17:15:14.602Z · loss-audit_

Ten recovered losses; nine explicit deferrals, twelve preserved obligations and four evidence limits kept separate.

### Oracle audit feedback evaluated against executable probes

_2026-09-14T17:15:14.602Z_

[Evaluation](oracle-guidance-reaudit/EVALUATION.md), [lossless ledger](oracle-guidance-reaudit/EVALUATION-LEDGER.jsonl), and [probe receipts](oracle-guidance-reaudit/PROBE-RESULTS.json).

The evaluate-review skill confirms eight harness/reporting gaps and one missing cold-collection history. OG-01 is narrowed to optional named labels because source-bound counters and later checkpoints already prove some assertions ran. Nine loss findings remain confirmed-open; one is deferred. All 25 supporting scope/preservation/limit items remain accounted for.

Six retained probe scripts demonstrate the exact bounded gaps, and all seven existing helper tests still pass. The real SQL-effect replay also shows a selected conditional mutant can yield an ordinary green despite not applying. Other probes use real helper or extracted caller code with controlled I/O; they do not claim new browser or Endpoints data bugs.

Recommended next repair order: preserve first failure/trace and all async diagnostics across real callers; unify mutant evidence and executable provenance; then add witnessed client receipt processing and a cold retained collection history. No implementation changes, commit, or push in this evaluation.
