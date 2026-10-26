---
id: UseLiveQueryResult
title: UseLiveQueryResult
---

Defined in: [useLiveQuery.ts:77](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L77)

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

Defined in: [useLiveQuery.ts:85](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L85)

***

### data

```ts
data: TData;
```

Defined in: [useLiveQuery.ts:84](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L84)

***

### isCleanedUp

```ts
isCleanedUp: boolean;
```

Defined in: [useLiveQuery.ts:73](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L73)

#### Inherited from

```ts
LiveQueryResultFlags.isCleanedUp
```

***

### isEnabled

```ts
isEnabled: true;
```

Defined in: [useLiveQuery.ts:87](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L87)

***

### isError

```ts
isError: boolean;
```

Defined in: [useLiveQuery.ts:72](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L72)

#### Inherited from

```ts
LiveQueryResultFlags.isError
```

***

### isIdle

```ts
isIdle: boolean;
```

Defined in: [useLiveQuery.ts:71](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L71)

#### Inherited from

```ts
LiveQueryResultFlags.isIdle
```

***

### isLoading

```ts
isLoading: boolean;
```

Defined in: [useLiveQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L66)

#### Inherited from

```ts
LiveQueryResultFlags.isLoading
```

***

### isPersistedReady

```ts
isPersistedReady: boolean;
```

Defined in: [useLiveQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L69)

#### Inherited from

```ts
LiveQueryResultFlags.isPersistedReady
```

***

### isReady

```ts
isReady: boolean;
```

Defined in: [useLiveQuery.ts:67](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L67)

#### Inherited from

```ts
LiveQueryResultFlags.isReady
```

***

### persistedError

```ts
persistedError: unknown;
```

Defined in: [useLiveQuery.ts:70](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L70)

#### Inherited from

```ts
LiveQueryResultFlags.persistedError
```

***

### persistedStatus

```ts
persistedStatus: LiveQueryPersistedStatus;
```

Defined in: [useLiveQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L68)

#### Inherited from

```ts
LiveQueryResultFlags.persistedStatus
```

***

### state

```ts
state: ReadonlyMap<TKey, TResult>;
```

Defined in: [useLiveQuery.ts:83](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L83)

***

### status

```ts
status: CollectionStatus;
```

Defined in: [useLiveQuery.ts:86](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L86)
