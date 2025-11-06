---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: packages/db/src/types.ts:662

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: packages/db/src/types.ts:664

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: packages/db/src/types.ts:666

Pre-compiled expression for filtering changes
