# Field-lab loss audit: final PR #1909 graph consolidation

Frozen reduction: Effect routes startup and live changes through one handler; Collection replaces two graph drains with one fixed-point loop; direct compiler-map lookup removes redundant accessors. The before source is `f9d2407c`. The after source is code commit `450b9d3c`. Two independent read-only source scans examined the three relevant files separately. This ledger records supported distinctions absent from that reduction. It does not label them useful, harmful, or regressions.

| Source | Recovered distinction and pointer | Where dropped | Rule |
| --- | --- | --- | --- |
| Before | Effect buffers every source until all subscriptions exist, drains directly to D2, then runs one initial graph turn. Live callbacks schedule through `handleSourceChanges` (`effect.ts:523-535,575-598,737-792`). | “One handler” clause | Category mismatch |
| Before | Removing a startup buffer before draining makes reentrant callbacks live. Ordered batches notify the loader and split updates before D2 in both paths (`effect.ts:744-765,575-590`). | Effect clause | Compression |
| Before | Compiler callbacks capture mutable subscription objects, which must be filled before the graph runs (`effect.ts:391-405,477-489,613-614`). | Effect clause | Compression |
| Before | Effect has its own graph/loader fixed point and emits one batch after quiescence (`effect.ts:902-941`). | Collection-only graph clause | Category mismatch |
| Before | Effect holds ordered repair callbacks through prefix, tie, and refill, transfers a hold to truncate replay, and classifies against visible rows (`effect.ts:839-881,943-987,1187-1229`). | Effect clause | Category mismatch |
| Before | Collection reads where and order data by opaque source ID and normalizes the where path for the alias (`collection-subscriber.ts:54-67,418-434`). | Direct-map clause | Compression |
| Before | Initial subscription branches on ordered loading, lazy status, on-demand mode, and zero limit (`collection-subscriber.ts:113-138,273-315,333-358`). | Direct-map clause | Category mismatch |
| Before | Zero-change settlement schedules a graph turn, but revision advances only for D2 input. Ordered updates notify the loader and split (`collection-subscriber.ts:217-234,283-295`). | Graph clause | Compression |
| Before | Ordered truncate resets the cursor, keeps exact contributed rows, queues full-source loading behind replay publication, and fences success by sync run (`collection-subscriber.ts:303-330,363-385`). | Graph clause | Category mismatch |
| Before | Ordered `loadMore` waits for replacement unless a window operation is active, passes the window generation, and tracks its promise (`collection-subscriber.ts:387-416`). | Graph clause | Compression |
| Before | Collection checks sync-run identity after graph, loader, and flush steps; graph exceptions mark error; empty startup commits before readiness (`collection-config-builder.ts:559-630`). | Fixed-point clause | Compression |
| Before | Ordered load participants are sync-run-fenced; the final successful participant schedules a flush without rerunning loaders (`collection-config-builder.ts:462-499`). | Fixed-point clause | Compression |
| Before | Window failure, ordered loads, replay, and joined demand gate publication; child facades prepare before root commit and events follow state (`collection-config-builder.ts:894-982`). | “Before publication” clause | Category mismatch |
| Before | `setWindow` rejects reentry, copies options, waits for replay, runs mutation and graph work in one publication context, and settles afterward (`collection-config-builder.ts:270-369`). | Fixed-point clause | Category mismatch |
| Before | Readiness depends on all subscriptions, required sources, active route demand, and no live-query subset load (`collection-config-builder.ts:1103-1126,1163-1255`). | Fixed-point clause | Category mismatch |
| After | Effect startup removes each buffer before the shared handler drains it, then runs the graph once (`effect.ts:523,728-753`). | “One handler” clause | Compression |
| After | Effect owns subscriptions before lazy demand or ordered snapshot startup can throw, then releases acquired sources on failed startup (`effect.ts:596`). | Effect clause | Compression |
| After | The ordered Effect loader sees original changes and prior D2 rows before update splitting (`effect.ts:758`). | Effect clause | Compression |
| After | Effect retains its own graph loop and one callback batch per run (`effect.ts:882`). | Collection-only graph clause | Category mismatch |
| After | Effect holds callback deltas during ordered repair and initial `skipInitial`; aborted repair can transfer the hold to replay (`effect.ts:819`). | Collection publication clause | Category mismatch |
| After | Effect consumes a synchronous lazy-demand error only if the subscription already reported that exact error (`effect.ts:774`). | Effect clause | Category mismatch |
| After | Collection maps where/order data by source ID and normalizes where for the lexical alias (`collection-subscriber.ts:54`). | Direct-map clause | Compression |
| After | Subset-result tracking delays rejection one microtask so the subscription can mark error before loading completes (`collection-subscriber.ts:68`). | Direct-map clause | Category mismatch |
| After | Collection advances graph-input revision only for actual D2 entries but schedules a turn for zero-change settlement (`collection-subscriber.ts:219`). | Graph clause | Compression |
| After | Ordered truncate retains contributed rows, queues full-source replay, and fences success by sync run (`collection-subscriber.ts:305`). | Graph/publication clause | Compression |
| After | Builder checks current sync run after graph and loader steps; graph failure marks current query error (`collection-config-builder.ts:589`). | Fixed-point clause | Compression |
| After | Builder flushes once at quiescence, performs empty initial commit when needed, then evaluates readiness (`collection-config-builder.ts:626`). | Fixed-point clause | Compression |
| After | Graph quiescence alone does not release publication while window failure, ordered loads, replay, or joined work persists (`collection-config-builder.ts:914`). | Publication clause | Compression |
| After | Child facade state installs before root and events; preparation failure discards writes; both publication callbacks run (`collection-config-builder.ts:936`). | Publication clause | Compression |
| After | Ordered-load settlement is sync-run-fenced and final success schedules a flush without another loader run (`collection-config-builder.ts:491`). | Fixed-point clause | Compression |

No source shows explicit rejection of these distinctions in the frozen reduction. This instrument does not decide which distinctions belong in the final explanation or whether a behavior changed. The separate hostile graph-step mutant fails at a public second-child-demand checkpoint, so the post-loader graph step remains in production.
