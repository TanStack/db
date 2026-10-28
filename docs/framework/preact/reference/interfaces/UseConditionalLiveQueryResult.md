---
id: UseConditionalLiveQueryResult
title: UseConditionalLiveQueryResult
---

Defined in: [useLiveQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L98)

The result of a live query whose callback can disable it.

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
collection: TCollection | undefined;
```

Defined in: [useLiveQuery.ts:106](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L106)

***

### data

```ts
data: TData | undefined;
```

Defined in: [useLiveQuery.ts:105](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L105)

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
isEnabled: boolean;
```

Defined in: [useLiveQuery.ts:108](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L108)

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
state: ReadonlyMap<TKey, TResult> | undefined;
```

Defined in: [useLiveQuery.ts:104](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L104)

***

### status

```ts
status: UseLiveQueryStatus;
```

Defined in: [useLiveQuery.ts:107](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L107)
