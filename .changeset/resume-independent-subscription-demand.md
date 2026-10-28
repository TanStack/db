---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
'@tanstack/react-router-with-db': patch
---

Start the required Collection sync run when an ordinary subscriber follows an abandoned suspended render. Deferred acquisition still starts no idle source sync run or acquisition attempt.

Ordinary subscription admission and deferred acquisition resumption throw during cleanup, including automatic GC. Effects created then return disposed handles. Failed setup releases partial ownership, and throwing callbacks cannot prevent healthy observers receiving cleanup status. Subscribers surviving cleanup retain demand for an explicit restart.

SSR captures each reader's rows and Collection status. Hydration preserves that view through browser preloads, runtime errors, sibling commits, and delayed streamed records. Missing records reject when transport ends. Known pending results survive normal record-stream close. A new stream after client cleanup starts independently of prior failures.

Empty loading SSR needs no preload. Rendering rows or readiness requires matching query preparation or explicit source Collection preparation. Streaming Suspense prepares its result. Unsupported preparation throws with guidance. Prepared non-streaming Suspense remains supported. The DbClient query hash includes an infinite query's initial limit and offset.

Apps without `DbClient` exclude its SSR implementation. Its API stays unchanged.

Svelte roots initialized with `hydrate()` must set `hydrating` on `DbProvider`. Nested providers inherit it. Each provider clears initial hydration after mount so new children read live rows.
