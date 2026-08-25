---
id: SubscriptionLoadSubsetErrorEvent
title: SubscriptionLoadSubsetErrorEvent
---

# Interface: SubscriptionLoadSubsetErrorEvent

Defined in: [packages/db/src/types.ts:239](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L239)

Event emitted when a subset requested by this subscription fails to load.

## Properties

### error

```ts
error: unknown;
```

Defined in: [packages/db/src/types.ts:243](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L243)

***

### options

```ts
options: LoadSubsetOptions;
```

Defined in: [packages/db/src/types.ts:242](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L242)

***

### subscription

```ts
subscription: Subscription;
```

Defined in: [packages/db/src/types.ts:241](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L241)

***

### type

```ts
type: "loadSubset:error";
```

Defined in: [packages/db/src/types.ts:240](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L240)
