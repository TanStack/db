---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: [packages/db/src/types.ts:222](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L222)

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:225](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L225)

***

### status

```ts
status: T;
```

Defined in: [packages/db/src/types.ts:226](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L226)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:224](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L224)

***

### type

```ts
type: `status:${T}`;
```

Defined in: [packages/db/src/types.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L223)
