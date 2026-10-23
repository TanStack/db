---
id: UseConditionalLiveQueryResult
title: UseConditionalLiveQueryResult
---

Defined in: [useLiveQuery.ts:91](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L91)

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

Defined in: [useLiveQuery.ts:99](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L99)

***

### data

```ts
data: TData | undefined;
```

Defined in: [useLiveQuery.ts:98](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L98)

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
isEnabled: boolean;
```

Defined in: [useLiveQuery.ts:101](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L101)

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
state: ReadonlyMap<TKey, TResult> | undefined;
```

Defined in: [useLiveQuery.ts:97](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L97)

***

### status

```ts
status: UseLiveQueryStatus;
```

Defined in: [useLiveQuery.ts:100](https://github.com/TanStack/db/blob/main/packages/preact-db/src/useLiveQuery.ts#L100)
