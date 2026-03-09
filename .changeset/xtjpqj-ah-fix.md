---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

fix(db): reject preload() promise when collection transitions to error state

Previously, `preload()` only resolved when the collection became ready. If
the collection transitioned to the `error` state while the promise was pending
(e.g. because the `queryFn` threw), the promise would hang forever, keeping
any `<Suspense>` boundary suspended indefinitely and preventing the error from
reaching an `<ErrorBoundary>`.

Now `preload()` subscribes to `status:change` events and rejects the promise
when the collection enters the `error` state. `useLiveSuspenseQuery` is also
updated to re-throw the actual error from `collection.utils?.lastError` instead
of a generic fallback message, so `<ErrorBoundary>` receives the original error.

Fixes #1343
