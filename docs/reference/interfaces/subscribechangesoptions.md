---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:662](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L662)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:664](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L664)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:666](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L666)

Pre-compiled expression for filtering changes
