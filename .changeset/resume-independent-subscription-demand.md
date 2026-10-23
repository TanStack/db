---
'@tanstack/db': patch
'@tanstack/react-db': patch
'@tanstack/svelte-db': patch
'@tanstack/react-router-with-db': patch
---

Resume Collection sync when a new subscriber follows a suspended render, while preserving cleanup during startup.

Reject ordinary subscriptions and deferred acquisition resumption during active cleanup. Effects created during that interval still return disposed handles.

Release partial observer and pooled-query subscriptions when setup fails or cleanup interrupts startup. Resumed subscriptions release abandoned render deferrals without restoring retired ownership. Admission checks retain an existing cleanup promise until a replacement sync run starts.

Subscribers that survive cleanup during admission retain demand for an explicit restart. Cleanup in a first-demand callback does not start a replacement implicitly.

Keep ordinary hook errors readable when deferred sync startup records an error. Explicit preloads still report source startup failures. Release channels acquired before synchronous cleanup registration or observer attachment fails.

Reject SSR reads of incidental server-only rows or readiness with an actionable preparation error. Preserve cold loading and normalized source hydration, consume prepared infinite-query snapshots, and register warm Suspense results for streaming.

Capture prepared SSR query rows and readiness at render time. Keep loading captures separate from completed preloads, preserve pending streams, and allow browser writes before hydration. Support prepared non-streaming Suspense, require portable opaque query identity, and include limit and offset in explicit-key result identity.

Keep an ordinary reader's initial loading view when a Suspense sibling completes the same streaming query. Forward replacement query records through the Router stream without discarding the earlier hydration view.

Preserve server snapshots for later-hydrating boundaries after a sibling commits. Wait for missing streamed results instead of rendering local rows during hydration.
