---
id: SubscriptionEvents
title: SubscriptionEvents
---

# Type Alias: SubscriptionEvents

```ts
type SubscriptionEvents = object;
```

Defined in: [packages/db/src/types.ts:190](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L190)

All subscription events

## Properties

### status:change

```ts
status:change: SubscriptionStatusChangeEvent;
```

Defined in: [packages/db/src/types.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L191)

***

### status:loadingSubset

```ts
status:loadingSubset: SubscriptionStatusEvent<"loadingSubset">;
```

Defined in: [packages/db/src/types.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L193)

***

### status:ready

```ts
status:ready: SubscriptionStatusEvent<"ready">;
```

Defined in: [packages/db/src/types.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L192)

***

### unsubscribed

```ts
unsubscribed: SubscriptionUnsubscribedEvent;
```

Defined in: [packages/db/src/types.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L194)
