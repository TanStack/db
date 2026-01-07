---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:778](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L778)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:780](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L780)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:782](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L782)

Pre-compiled expression for filtering changes
