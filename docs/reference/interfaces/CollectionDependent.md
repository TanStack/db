---
id: CollectionDependent
title: CollectionDependent
---

Defined in: [packages/db/src/types.ts:1182](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1182)

Something that reads a Collection, as listed by `collection.subscribers`:
a live query, an Effect, or a direct subscription.

## Properties

### active

```ts
readonly active: boolean;
```

Defined in: [packages/db/src/types.ts:1191](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1191)

Whether something still reads through this dependent: an Effect or a
subscription always does; a live query does while it has a subscriber.
`cleanup()` refuses only while an active live query or Effect remains.

***

### collection?

```ts
readonly optional collection: Collection<any, any, any, any, any>;
```

Defined in: [packages/db/src/types.ts:1185](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1185)

A live query's Collection; a pooled live query has none.

***

### end()

```ts
end: () => Promise<void>;
```

Defined in: [packages/db/src/types.ts:1196](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1196)

End this dependent: clean up the live query with its own dependents,
dispose the Effect, or end the subscription.

#### Returns

`Promise`\<`void`\>

***

### kind

```ts
readonly kind: "live-query" | "effect" | "subscription";
```

Defined in: [packages/db/src/types.ts:1183](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1183)
