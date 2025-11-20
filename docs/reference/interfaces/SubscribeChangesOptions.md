---
id: SubscribeChangesOptions
title: SubscribeChangesOptions
---

# Interface: SubscribeChangesOptions

Defined in: [packages/db/src/types.ts:720](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L720)

Options for subscribing to collection changes

## Properties

### includeInitialState?

```ts
optional includeInitialState: boolean;
```

Defined in: [packages/db/src/types.ts:722](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L722)

Whether to include the current state as initial changes

***

### whereExpression?

```ts
optional whereExpression: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:724](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L724)

Pre-compiled expression for filtering changes
