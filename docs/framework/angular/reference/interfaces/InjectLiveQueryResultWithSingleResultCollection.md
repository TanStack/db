---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

# Interface: InjectLiveQueryResultWithSingleResultCollection\<TResult, TKey, TUtils\>

Defined in: [index.ts:77](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L77)

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

Defined in: [index.ts:84](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L84)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [index.ts:83](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L83)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:90](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L90)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:89](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L89)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:88](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L88)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:86](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L86)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:82](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L82)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:85](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L85)
