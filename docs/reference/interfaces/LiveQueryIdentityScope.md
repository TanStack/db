---
id: LiveQueryIdentityScope
title: LiveQueryIdentityScope
---

Defined in: [packages/db/src/live-query-adapter.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L122)

Where a binding that compares query identity checks a prepared query.

## Properties

### bindingName

```ts
bindingName: string;
```

Defined in: [packages/db/src/live-query-adapter.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L126)

***

### claims

```ts
claims: LiveQuerySourceIdClaims;
```

Defined in: [packages/db/src/live-query-adapter.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L124)

This binding's source Collection ID claims.

***

### client

```ts
client: DbClient | undefined;
```

Defined in: [packages/db/src/live-query-adapter.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L125)

***

### onUnboundDescriptor()?

```ts
optional onUnboundDescriptor: (alias) => never;
```

Defined in: [packages/db/src/live-query-adapter.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L128)

Report a descriptor source that no client bound.

#### Parameters

##### alias

`string`

#### Returns

`never`
