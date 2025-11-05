---
id: SubscriptionEvents
title: SubscriptionEvents
---

# Type Alias: SubscriptionEvents

```ts
type SubscriptionEvents = object;
```

Defined in: [packages/db/src/types.ts:221](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L221)

All subscription events

## Properties

### status:change

```ts
status:change: SubscriptionStatusChangeEvent;
```

Defined in: [packages/db/src/types.ts:222](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L222)

***

### status:loadingSubset

```ts
status:loadingSubset: SubscriptionStatusEvent<"loadingSubset">;
```

Defined in: [packages/db/src/types.ts:224](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L224)

***

### status:ready

```ts
status:ready: SubscriptionStatusEvent<"ready">;
```

Defined in: [packages/db/src/types.ts:223](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L223)

***

### unsubscribed

```ts
unsubscribed: SubscriptionUnsubscribedEvent;
```

Defined in: [packages/db/src/types.ts:225](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L225)
