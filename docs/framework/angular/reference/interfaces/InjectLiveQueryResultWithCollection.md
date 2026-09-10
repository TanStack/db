---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

# Interface: InjectLiveQueryResultWithCollection\<TResult, TKey, TUtils\>

Defined in: [index.ts:61](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L61)

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

Defined in: [index.ts:68](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L68)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [index.ts:67](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L67)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:74](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L74)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:73](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L73)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:72](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L72)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:70](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L70)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:71](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L71)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:66](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L66)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:69](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L69)
