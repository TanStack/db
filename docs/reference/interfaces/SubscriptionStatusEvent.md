---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: [packages/db/src/types.ts:225](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L225)

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:228](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L228)

***

### status

```ts
status: T;
```

Defined in: [packages/db/src/types.ts:229](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L229)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L227)

***

### type

```ts
type: `status:${T}`;
```

Defined in: [packages/db/src/types.ts:226](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L226)
