---
id: enableSolidDBExternalSource
title: enableSolidDBExternalSource
---

## Call Signature

```ts
function enableSolidDBExternalSource(): void
```

Defined in: [external-source.ts](https://github.com/TanStack/db/blob/main/packages/solid-db/src/external-source.ts)

Install the Solid v2 external-source bridge for TanStack DB observers. Call **once** at application startup, before a Solid computation first calls `trackSnapshot`.

### Returns

`void`

### Examples

```ts
// App entry point (once):
import { enableSolidDBExternalSource } from '@tanstack/solid-db'
enableSolidDBExternalSource()

// In any component or memo:
const snapshot = createMemo(() => {
  const observer = createLiveQueryObserver(collection, { mode: 'wholesale' })
  return trackSnapshot(observer)
})
```

After installation, `trackSnapshot` reads inside any Solid compute (memo, effect, component body) automatically subscribe to the observer and re-run when the snapshot changes — no manual `subscribe`/cleanup wiring required. The bridge does not affect `useLiveQuery`, which handles its own subscription.
