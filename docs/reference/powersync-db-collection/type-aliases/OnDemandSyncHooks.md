---
id: OnDemandSyncHooks
title: OnDemandSyncHooks
---

# Type Alias: OnDemandSyncHooks

```ts
type OnDemandSyncHooks = object;
```

Defined in: [definitions.ts:187](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L187)

On-demand sync mode hooks.
Called each time a subset is loaded or unloaded in response to live query changes.

## Properties

### onLoad?

```ts
optional onLoad: never;
```

Defined in: [definitions.ts:189](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L189)

***

### onLoadSubset()?

```ts
optional onLoadSubset: (options) => CleanupFn | void | Promise<CleanupFn | void>;
```

Defined in: [definitions.ts:198](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L198)

Called when a subset of data is requested by a live query.
Use this to set up external data sources for the requested subset
(e.g. subscribing to a sync stream with parameters derived from the query predicate).

#### Parameters

##### options

`LoadSubsetOptions`

#### Returns

`CleanupFn` \| `void` \| `Promise`\<`CleanupFn` \| `void`\>

A cleanup function that is called when the subset is unloaded.

***

### syncMode

```ts
syncMode: "on-demand";
```

Defined in: [definitions.ts:188](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L188)
