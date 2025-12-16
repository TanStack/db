---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:762](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L762)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:764](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L764)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:766](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L766)

Pre-compiled expression for filtering changes
