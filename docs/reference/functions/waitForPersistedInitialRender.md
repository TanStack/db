---
id: waitForPersistedInitialRender
title: waitForPersistedInitialRender
---

```ts
function waitForPersistedInitialRender(__namedParameters): object;
```

Defined in: [packages/db/src/persisted-readiness.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/persisted-readiness.ts#L56)

Resolve when network data is ready, or when the network deadline passes or
the network fails while every persisted source has restored. Reject with
the network error when no persisted fallback may render.

## Parameters

### \_\_namedParameters

[`PersistedInitialRenderInput`](../interfaces/PersistedInitialRenderInput.md)

## Returns

`object`

### cancel()

```ts
cancel: () => void;
```

#### Returns

`void`

### promise

```ts
promise: Promise<void>;
```
