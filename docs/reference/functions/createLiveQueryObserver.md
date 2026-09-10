---
id: createLiveQueryObserver
title: createLiveQueryObserver
---

# Function: createLiveQueryObserver()

```ts
function createLiveQueryObserver<T, TKey>(collection, options): LiveQueryObserver<T, TKey>;
```

Defined in: [packages/db/src/live-query-observer.ts:878](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L878)

**`Internal`**

Create a [LiveQueryObserver](../interfaces/LiveQueryObserver.md) for a resolved live-query collection, or a
disabled observer when `collection` is `null`/`undefined`.

 This is an unstable contract shared by TanStack DB's official
framework adapters. It is exported so the adapter packages can use it, but
it is not a public extension point yet: its API may change in any release
without a semver major.

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Parameters

### collection

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `T`\> | `null` | `undefined`

### options

[`CreateLiveQueryObserverOptions`](../interfaces/CreateLiveQueryObserverOptions.md) = `{}`

## Returns

[`LiveQueryObserver`](../interfaces/LiveQueryObserver.md)\<`T`, `TKey`\>
