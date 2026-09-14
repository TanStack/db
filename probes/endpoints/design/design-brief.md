# Endpoints design space: impact, updates, and activity

## What this tells us

There are **four separate jobs**: find the collections affected by an optimistic change; compute their local changes; find the collections affected by the actual server outcome; and choose sufficient update data for each. The optimistic guess and authoritative footprint may differ. A storage arrangement does not answer all four jobs. [Model: I1–I5](./design-model.md#separate-impact-selection-from-payload-selection).

Activity adds a lifetime question. DB already exposes `subscriberCount` and `subscribers:change`. Those can track subscribed instances, but cached existence is different from current demand. Preloads, indirect consumers, pending transactions and late activation still need explicit policies. “Potentially affected ∩ active” is a useful set relation; it does not require scanning all declarations before checking activity. [Activity model](./design-model.md#activity-and-dependency-selection).

## What it changes

**Propagation has three adjacent forms to examine, with different coverage:**

| Form | Changed arrangement | Main limit or cost |
| --- | --- | --- |
| Coalesce proven-equivalent queries | Identical contracts share one collection state | Addresses duplicate queries, not different filters/projections. |
| Coordinate query-owned collections | One transaction applies supported edits across affected results | Requires recipient discovery and per-result changes; copies and coupled settlement remain. |
| Shared row ownership with query overlays | One row change feeds several DB queries | Requires explicit response coverage, retention and write mapping; query snapshots cannot each replace shared state. |

These are generated forms, not ranked solutions. Each retains the **bare writable collection** and **synchronous Transaction** surface conditionally on its internal contracts. [Forms and losses](./design-model.md#adjacent-storagepropagation-forms).

**Server delivery is a separate axis.** One query might accept authoritative row changes; another need a server-computed result delta; another receive a full result inline or require client refetch. A small result delta may still require the server to rerun the entire query. Unknown impact must not be called “unaffected.” [Delivery routes](./design-model.md#orthogonal-authoritative-response-variations).

**The same query can take different paths for different mutations.** Given a complete current top-k result, total order and one known insertion, the client can rank the extra row against the loaded k. Removing a member can require an unseen replacement. A deleted key alone cannot reveal it; extra server information can. This is a constructed information comparison, not an executed test. [Ground-condition result](./ground-conditions.md#matched-coverage-comparison).

**Performance has two baselines.** Acknowledgement followed by refetch costs two request/response phases; returning full query results with the mutation costs one. Compact patches must earn their advantage against that second baseline too. Local synthetic measurements found 4,822 gzip bytes for 100 Todo rows versus 218 bytes for an illustrative one-row update. At an assumed 100 Mbps, the transfer saving permits only **0.37 ms extra server work beyond producing the full result**, assuming equal client apply cost. For 10,000 rows, that budget was about **34 ms**. These are bounds, not deployment latency measurements. [Measurements and comparison contract](./performance-bounds.md).

## What it does not tell us

No architecture is selected or implemented. The grammar reconstructs the narrow prototype and its known missing propagation, but has **no independent held-out range validation**. Scope isolation, server-code exclusion and no implicit mutation queue remain requirements. Inverse writes through projections/joins, stale-response handling, mixed patch/refetch publication, and activation during pending work remain unresolved. Exhausted reads may surface an error; retained-row policy is open.

The extraction may make identity, effects, demand and observations look cleaner than their real coupling. Vendor docs dominate the survey; the top-k example isolates one information limit. The measurement excludes actual wire envelopes, browser work, deployed load and the proposed algorithms themselves. The oracle must still inspect every active collection, including those a strategy labels unaffected, and add activity transitions before it can validate the broader designs.

Support: [Model](./design-model.md), [Evidence and controls](./design-evidence.md), [Process and claim map](./design-process.md), [source survey](./optimistic-coherence-research-survey.md). Analytical layers were [frozen before this brief](./design-freeze.json).
