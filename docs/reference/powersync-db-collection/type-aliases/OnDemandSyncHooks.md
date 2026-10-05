---
id: OnDemandSyncHooks
title: OnDemandSyncHooks
---

```ts
type OnDemandSyncHooks = object;
```

Defined in: [definitions.ts:189](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L189)

On-demand sync mode hooks.
Called each time a subset is loaded or unloaded in response to live query changes.

## Properties

### onLoad?

```ts
optional onLoad: never;
```

Defined in: [definitions.ts:191](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L191)

***

### onLoadSubset()?

```ts
optional onLoadSubset: (options) => CleanupFn | void | Promise<CleanupFn | void>;
```

Defined in: [definitions.ts:200](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L200)

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

Defined in: [definitions.ts:190](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L190)
