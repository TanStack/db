---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: [packages/db/src/types.ts:231](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L231)

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:234](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L234)

***

### status

```ts
status: T;
```

Defined in: [packages/db/src/types.ts:235](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L235)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:233](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L233)

***

### type

```ts
type: `status:${T}`;
```

Defined in: [packages/db/src/types.ts:232](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L232)
