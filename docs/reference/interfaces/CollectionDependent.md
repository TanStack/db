---
id: CollectionDependent
title: CollectionDependent
---

Defined in: [packages/db/src/types.ts:1218](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1218)

Something that reads a Collection, as listed by `collection.subscribers`:
a live query, an Effect, or a direct subscription.

## Properties

### active

```ts
readonly active: boolean;
```

Defined in: [packages/db/src/types.ts:1227](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1227)

Whether something still reads through this dependent: an Effect or a
subscription always does; a live query does while it has a subscriber.
`cleanup()` refuses only while an active live query or Effect remains.

***

### collection?

```ts
readonly optional collection: Collection<any, any, any, any, any>;
```

Defined in: [packages/db/src/types.ts:1221](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1221)

A live query's Collection; a pooled live query has none.

***

### end()

```ts
end: () => Promise<void>;
```

Defined in: [packages/db/src/types.ts:1232](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1232)

End this dependent: clean up the live query with its own dependents,
dispose the Effect, or end the subscription.

#### Returns

`Promise`\<`void`\>

***

### kind

```ts
readonly kind: "live-query" | "effect" | "subscription";
```

Defined in: [packages/db/src/types.ts:1219](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1219)
