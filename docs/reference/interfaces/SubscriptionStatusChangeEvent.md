---
id: SubscriptionStatusChangeEvent
title: SubscriptionStatusChangeEvent
---

# Interface: SubscriptionStatusChangeEvent

Defined in: [packages/db/src/types.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L193)

Event emitted when subscription status changes

## Properties

### previousStatus

```ts
previousStatus: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L196)

***

### status

```ts
status: SubscriptionStatus;
```

Defined in: [packages/db/src/types.ts:197](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L197)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L195)

***

### type

```ts
type: "status:change";
```

Defined in: [packages/db/src/types.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L194)
