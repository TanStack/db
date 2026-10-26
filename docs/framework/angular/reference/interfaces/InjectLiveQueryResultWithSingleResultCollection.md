---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

Defined in: [angular-db/src/index.ts:102](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L102)

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

Defined in: [angular-db/src/index.ts:109](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L109)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [angular-db/src/index.ts:108](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L108)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:118](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L118)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:117](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L117)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:116](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L116)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:111](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L111)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:114](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L114)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:112](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L112)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [angular-db/src/index.ts:115](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L115)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [angular-db/src/index.ts:113](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L113)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [angular-db/src/index.ts:107](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L107)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:110](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L110)
