---
id: UseLiveQueryResult
title: UseLiveQueryResult
---

Defined in: [useLiveQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L84)

The result of a live query that is always enabled.

## Extends

- `LiveQueryResultFlags`

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

Defined in: [useLiveQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L92)

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L91)

***

### health

```ts
health: HealthNode | undefined;
```

Defined in: [useLiveQuery.ts:80](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L80)

The health tree for the query and every Collection it depends on, or
`undefined` for a disabled query.

#### Inherited from

```ts
LiveQueryResultFlags.health
```

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L94)

***

### isSyncError

```ts
isSyncError: boolean;
```

Defined in: [useLiveQuery.ts:75](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L75)

The data is shown, and a sync problem or failed request is in `health`.

#### Inherited from

```ts
LiveQueryResultFlags.isSyncError
```

***

### state

```ts
state: ReadonlyMap<TKey, TResult>;
```

Defined in: [useLiveQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L90)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L93)
