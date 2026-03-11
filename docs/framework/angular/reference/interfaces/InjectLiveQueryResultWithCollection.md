---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

# Interface: InjectLiveQueryResultWithCollection\<TResult, TKey, TUtils\>

Defined in: [index.ts:55](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L55)

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
  | Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>
| null>;
```

Defined in: [index.ts:62](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L62)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [index.ts:61](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L61)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:68](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L68)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:67](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L67)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:66](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L66)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:64](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L64)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:65](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L65)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:60](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L60)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:63](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L63)
