---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:701](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L701)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:703](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L703)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:705](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L705)

Pre-compiled expression for filtering changes
