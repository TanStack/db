---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

Defined in: [index.ts:97](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L97)

## Type Parameters

### TResult

`TResult` *extends* `object` = `any`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TUtils

`TUtils` *extends* `Record`\<`string`, `any`\> = \{
\}

## Properties

### collection

```ts
collection: Signal<
  | Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult> & SingleResult
| null>;
```

Defined in: [index.ts:104](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L104)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [index.ts:103](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L103)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:113](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L113)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:112](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L112)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:111](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L111)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:106](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L106)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [index.ts:109](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L109)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:107](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L107)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [index.ts:110](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L110)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [index.ts:108](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L108)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:102](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L102)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:105](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L105)
