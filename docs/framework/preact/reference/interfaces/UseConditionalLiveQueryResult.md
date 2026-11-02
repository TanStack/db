---
id: UseConditionalLiveQueryResult
title: UseConditionalLiveQueryResult
---

Defined in: [useLiveQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L86)

The result of a live query whose callback can disable it.

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
collection: TCollection | undefined;
```

Defined in: [useLiveQuery.ts:94](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L94)

***

### data

```ts
data: TData | undefined;
```

Defined in: [useLiveQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L93)

***

### isEnabled

```ts
isEnabled: boolean;
```

Defined in: [useLiveQuery.ts:96](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L96)

***

### state

```ts
state: ReadonlyMap<TKey, TResult> | undefined;
```

Defined in: [useLiveQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L92)

***

### status

```ts
status: UseLiveQueryStatus;
```

Defined in: [useLiveQuery.ts:95](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L95)
