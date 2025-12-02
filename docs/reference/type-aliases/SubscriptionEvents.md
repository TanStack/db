---
id: SubscriptionEvents
title: SubscriptionEvents
---

# Type Alias: SubscriptionEvents

```ts
type SubscriptionEvents = object;
```

Defined in: [packages/db/src/types.ts:240](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L240)

All subscription events

## Properties

### status:change

```ts
status:change: SubscriptionStatusChangeEvent;
```

Defined in: [packages/db/src/types.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L241)

***

### status:loadingSubset

```ts
status:loadingSubset: SubscriptionStatusEvent<"loadingSubset">;
```

Defined in: [packages/db/src/types.ts:243](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L243)

***

### status:ready

```ts
status:ready: SubscriptionStatusEvent<"ready">;
```

Defined in: [packages/db/src/types.ts:242](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L242)

***

### unsubscribed

```ts
unsubscribed: SubscriptionUnsubscribedEvent;
```

Defined in: [packages/db/src/types.ts:244](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L244)
