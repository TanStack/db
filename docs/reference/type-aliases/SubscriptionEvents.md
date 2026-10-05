---
id: SubscriptionEvents
title: SubscriptionEvents
---

```ts
type SubscriptionEvents = object;
```

Defined in: [packages/db/src/types.ts:272](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L272)

All subscription events

## Properties

### loadSubset:error

```ts
loadSubset:error: SubscriptionLoadSubsetErrorEvent;
```

Defined in: [packages/db/src/types.ts:276](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L276)

***

### status:change

```ts
status:change: SubscriptionStatusChangeEvent;
```

Defined in: [packages/db/src/types.ts:273](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L273)

***

### status:loadingSubset

```ts
status:loadingSubset: SubscriptionStatusEvent<"loadingSubset">;
```

Defined in: [packages/db/src/types.ts:275](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L275)

***

### status:ready

```ts
status:ready: SubscriptionStatusEvent<"ready">;
```

Defined in: [packages/db/src/types.ts:274](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L274)

***

### unsubscribed

```ts
unsubscribed: SubscriptionUnsubscribedEvent;
```

Defined in: [packages/db/src/types.ts:277](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L277)
