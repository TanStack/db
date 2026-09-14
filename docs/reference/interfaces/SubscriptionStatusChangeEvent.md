---
id: SubscriptionStatusChangeEvent
title: SubscriptionStatusChangeEvent
---

# Interface: SubscriptionStatusChangeEvent

Defined in: [packages/db/src/types.ts:221](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L221)

Event emitted when subscription status changes

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:224](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L224)

***

### status

```ts
status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:225](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L225)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L223)

***

### type

```ts
type: "status:change";
```

Defined in: [packages/db/src/types.ts:222](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L222)
