---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

Defined in: [index.ts:78](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L78)

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

Defined in: [index.ts:85](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L85)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [index.ts:84](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L84)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:94](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L94)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:93](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L93)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:92](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L92)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [index.ts:90](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L90)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:88](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L88)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [index.ts:91](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L91)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [index.ts:89](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L89)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:83](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L83)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:86](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L86)
