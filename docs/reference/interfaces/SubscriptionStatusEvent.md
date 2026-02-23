---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: packages/db/src/types.ts:223

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: packages/db/src/types.ts:226

***

### status

```ts
status: T;
```

Defined in: packages/db/src/types.ts:227

***

### subscription

```ts
subscription: Subscription;
```

Defined in: packages/db/src/types.ts:225

***

### type

```ts
type: `status:${T}`;
```

Defined in: packages/db/src/types.ts:224
