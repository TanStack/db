---
id: LiveQueryIdentityScope
title: LiveQueryIdentityScope
---

Defined in: [packages/db/src/live-query-adapter.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L123)

Where a binding that compares query identity checks a prepared query.

## Properties

### bindingName

```ts
bindingName: string;
```

Defined in: [packages/db/src/live-query-adapter.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L127)

***

### claims?

```ts
optional claims: LiveQuerySourceIdClaims;
```

Defined in: [packages/db/src/live-query-adapter.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L125)

This binding's claims; omit to check identity without claiming.

***

### client

```ts
client: DbClient | undefined;
```

Defined in: [packages/db/src/live-query-adapter.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L126)

***

### deferredCollections?

```ts
optional deferredCollections: DeferredLiveQueryCollections;
```

Defined in: [packages/db/src/live-query-adapter.ts:129](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L129)

Sync starts the query's preparation deferred.

***

### onUnboundDescriptor()?

```ts
optional onUnboundDescriptor: (alias) => never;
```

Defined in: [packages/db/src/live-query-adapter.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L131)

Report a descriptor source that no client bound.

#### Parameters

##### alias

`string`

#### Returns

`never`
