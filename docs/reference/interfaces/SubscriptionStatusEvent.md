---
id: SubscriptionStatusEvent
title: SubscriptionStatusEvent
---

Defined in: [packages/db/src/types.ts:246](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L246)

Event emitted when subscription status changes to a specific status

## Type Parameters

### T

`T` *extends* [`SubscriptionStatus`](../type-aliases/SubscriptionStatus.md)

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:249](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L249)

***

### status

```ts
status: T;
```

Defined in: [packages/db/src/types.ts:250](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L250)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:248](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L248)

***

### type

```ts
type: `status:${T}`;
```

Defined in: [packages/db/src/types.ts:247](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L247)
