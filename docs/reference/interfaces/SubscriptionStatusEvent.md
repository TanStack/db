---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: packages/db/src/types.ts:172

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: packages/db/src/types.ts:175

***

### status

```ts
status: T;
```

Defined in: packages/db/src/types.ts:176

***

### subscription

```ts
subscription: Subscription;
```

Defined in: packages/db/src/types.ts:174

***

### type

```ts
type: `status:${T}`;
```

Defined in: packages/db/src/types.ts:173
