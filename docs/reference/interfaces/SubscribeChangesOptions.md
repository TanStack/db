---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:723](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L723)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:725](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L725)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:727](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L727)

Pre-compiled expression for filtering changes
