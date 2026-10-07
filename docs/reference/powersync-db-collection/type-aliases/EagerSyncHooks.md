---
id: EagerSyncHooks
title: EagerSyncHooks
---

```ts
type EagerSyncHooks = object;
```

Defined in: [definitions.ts:173](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L173)

Eager sync mode hooks.
Called once when the collection sync starts and stops.

## Properties

### onLoad()?

```ts
optional onLoad: () => CleanupFn | void | Promise<CleanupFn | void>;
```

Defined in: [definitions.ts:181](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L181)

Called when the collection sync starts.
Use this to set up external data sources (e.g. subscribing to a sync stream).

#### Returns

`CleanupFn` \| `void` \| `Promise`\<`CleanupFn` \| `void`\>

A cleanup function that is called when the collection sync is cleaned up.

***

### onLoadSubset?

```ts
optional onLoadSubset: never;
```

Defined in: [definitions.ts:182](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L182)

***

### syncMode?

```ts
optional syncMode: "eager";
```

Defined in: [definitions.ts:174](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L174)
