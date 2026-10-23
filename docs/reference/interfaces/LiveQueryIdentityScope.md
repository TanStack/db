---
id: LiveQueryIdentityScope
title: LiveQueryIdentityScope
---

Defined in: [packages/db/src/live-query-adapter.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L120)

Where a binding that compares query identity checks a prepared query.

## Properties

### bindingName

```ts
bindingName: string;
```

Defined in: [packages/db/src/live-query-adapter.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L124)

***

### claims?

```ts
optional claims: LiveQuerySourceIdClaims;
```

Defined in: [packages/db/src/live-query-adapter.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L122)

This binding's claims; omit to check identity without claiming.

***

### client

```ts
client: DbClient | undefined;
```

Defined in: [packages/db/src/live-query-adapter.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L123)

***

### onUnboundDescriptor()?

```ts
optional onUnboundDescriptor: (alias) => never;
```

Defined in: [packages/db/src/live-query-adapter.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L126)

Report a descriptor source that no client bound.

#### Parameters

##### alias

`string`

#### Returns

`never`
