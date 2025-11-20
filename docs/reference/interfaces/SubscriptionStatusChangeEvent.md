---
id: SubscriptionStatusChangeEvent
title: SubscriptionStatusChangeEvent
---

# Interface: SubscriptionStatusChangeEvent

Defined in: [packages/db/src/types.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L212)

Event emitted when subscription status changes

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L215)

***

### status

```ts
status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:216](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L216)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:214](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L214)

***

### type

```ts
type: "status:change";
```

Defined in: [packages/db/src/types.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L213)
