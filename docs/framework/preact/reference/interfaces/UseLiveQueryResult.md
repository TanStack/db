---
id: UseLiveQueryResult
title: UseLiveQueryResult
---

Defined in: [useLiveQuery.ts:83](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L83)

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

Defined in: [useLiveQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L91)

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.ts:90](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L90)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveQuery.ts:79](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L79)

#### Inherited from

```ts
LiveQueryResultFlags.isCleanedUp
```

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveQuery.ts:93](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L93)

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveQuery.ts:78](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L78)

#### Inherited from

```ts
LiveQueryResultFlags.isError
```

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveQuery.ts:77](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L77)

#### Inherited from

```ts
LiveQueryResultFlags.isIdle
```

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveQuery.ts:72](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L72)

#### Inherited from

```ts
LiveQueryResultFlags.isLoading
```

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [useLiveQuery.ts:75](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L75)

#### Inherited from

```ts
LiveQueryResultFlags.isPersistedReady
```

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveQuery.ts:73](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L73)

#### Inherited from

```ts
LiveQueryResultFlags.isReady
```

***

### persistedError

```ts
persistedError: unknown;
```

Defined in: [useLiveQuery.ts:76](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L76)

#### Inherited from

```ts
LiveQueryResultFlags.persistedError
```

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [useLiveQuery.ts:74](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L74)

#### Inherited from

```ts
LiveQueryResultFlags.persistedStatus
```

***

### state

```ts
state: ReadonlyMap<TKey, TResult>;
```

Defined in: [useLiveQuery.ts:89](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L89)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.ts:92](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L92)
