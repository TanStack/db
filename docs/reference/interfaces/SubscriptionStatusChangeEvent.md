---
id: SubscriptionStatusChangeEvent
title: SubscriptionStatusChangeEvent
---

# Interface: SubscriptionStatusChangeEvent

Defined in: [packages/db/src/types.ts:162](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L162)

Event emitted when subscription status changes

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L165)

***

### status

```ts
status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L166)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L164)

***

### type

```ts
type: "status:change";
```

Defined in: [packages/db/src/types.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L163)
