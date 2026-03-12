---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

# Interface: InjectLiveQueryResultWithSingleResultCollection\<TResult, TKey, TUtils\>

Defined in: [index.ts:73](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L73)

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

Defined in: [index.ts:80](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L80)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [index.ts:79](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L79)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:86](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L86)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:85](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L85)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:84](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L84)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:82](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L82)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:83](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L83)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:78](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L78)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:81](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L81)
