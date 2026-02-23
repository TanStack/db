---
id: SubscriptionEvents
title: SubscriptionEvents
---

# Type Alias: SubscriptionEvents

```ts
type SubscriptionEvents = object;
```

Defined in: packages/db/src/types.ts:241

All subscription events

## Properties

### status:change

```ts
status:change: SubscriptionStatusChangeEvent;
```

Defined in: packages/db/src/types.ts:242

***

### status:loadingSubset

```ts
status:loadingSubset: SubscriptionStatusEvent<"loadingSubset">;
```

Defined in: packages/db/src/types.ts:244

***

### status:ready

```ts
status:ready: SubscriptionStatusEvent<"ready">;
```

Defined in: packages/db/src/types.ts:243

***

### unsubscribed

```ts
unsubscribed: SubscriptionUnsubscribedEvent;
```

Defined in: packages/db/src/types.ts:245
