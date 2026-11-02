---
id: UseLiveQueryResult
title: UseLiveQueryResult
---

Defined in: [useLiveQuery.ts:72](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L72)

The result of a live query that is always enabled.

## Extends

- `LiveQueryStatusFlags`

## Type Parameters

### TResult

`TResult` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

### TData

`TData`

### TCollection

`TCollection`

## Properties

### collection

```ts
collection: TCollection;
```

Defined in: [useLiveQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L80)

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.ts:79](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L79)

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveQuery.ts:82](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L82)

***

### state

```ts
state: ReadonlyMap<TKey, TResult>;
```

Defined in: [useLiveQuery.ts:78](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L78)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.ts:81](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L81)
