---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

# Interface: SubscriptionStatusEvent\<T\>

Defined in: [packages/db/src/types.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L172)

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:175](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L175)

***

### status

```ts
status: T;
```

Defined in: [packages/db/src/types.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L176)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L174)

***

### type

```ts
type: `status:${T}`;
```

Defined in: [packages/db/src/types.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L173)
