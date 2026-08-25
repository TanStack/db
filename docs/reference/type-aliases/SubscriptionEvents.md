---
id: SubscriptionEvents
title: SubscriptionEvents
---

# Type Alias: SubscriptionEvents

```ts
type SubscriptionEvents = object;
```

Defined in: [packages/db/src/types.ts:257](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L257)

All subscription events

## Properties

### loadSubset:error

```ts
loadSubset:error: SubscriptionLoadSubsetErrorEvent;
```

Defined in: [packages/db/src/types.ts:261](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L261)

***

### status:change

```ts
status:change: SubscriptionStatusChangeEvent;
```

Defined in: [packages/db/src/types.ts:258](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L258)

***

### status:loadingSubset

```ts
status:loadingSubset: SubscriptionStatusEvent<"loadingSubset">;
```

Defined in: [packages/db/src/types.ts:260](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L260)

***

### status:ready

```ts
status:ready: SubscriptionStatusEvent<"ready">;
```

Defined in: [packages/db/src/types.ts:259](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L259)

***

### unsubscribed

```ts
unsubscribed: SubscriptionUnsubscribedEvent;
```

Defined in: [packages/db/src/types.ts:262](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L262)
