---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

Defined in: [index.ts:99](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L99)

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

Defined in: [index.ts:106](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L106)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [index.ts:105](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L105)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:115](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L115)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:114](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L114)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:113](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L113)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:108](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L108)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [index.ts:111](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L111)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:109](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L109)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [index.ts:112](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L112)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [index.ts:110](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L110)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:104](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L104)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:107](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L107)
