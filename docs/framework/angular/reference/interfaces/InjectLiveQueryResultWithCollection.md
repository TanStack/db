---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

Defined in: [index.ts:80](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L80)

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

Defined in: [index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [index.ts:86](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L86)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:96](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L96)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:95](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L95)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:94](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L94)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:89](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L89)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [index.ts:92](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L92)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:90](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L90)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [index.ts:93](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L93)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [index.ts:91](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L91)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:85](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L85)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:88](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L88)
