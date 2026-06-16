---
id: SubscriptionStatusChangeEvent
title: SubscriptionStatusChangeEvent
---

# Interface: SubscriptionStatusChangeEvent

Defined in: [packages/db/src/types.ts:215](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L215)

Event emitted when subscription status changes

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:218](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L218)

***

### status

```ts
status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:219](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L219)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:217](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L217)

***

### type

```ts
type: "status:change";
```

Defined in: [packages/db/src/types.ts:216](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L216)
