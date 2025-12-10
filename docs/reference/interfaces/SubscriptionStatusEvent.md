---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: [packages/db/src/types.ts:203](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L203)

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:206](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L206)

***

### status

```ts
status: T;
```

Defined in: [packages/db/src/types.ts:207](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L207)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:205](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L205)

***

### type

```ts
type: `status:${T}`;
```

Defined in: [packages/db/src/types.ts:204](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L204)
