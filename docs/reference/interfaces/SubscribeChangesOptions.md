---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:739](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L739)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:741](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L741)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:743](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L743)

Pre-compiled expression for filtering changes
