---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

Defined in: [index.ts:81](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L81)

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

Defined in: [index.ts:88](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L88)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [index.ts:97](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L97)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [index.ts:96](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L96)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [index.ts:95](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L95)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [index.ts:90](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L90)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [index.ts:93](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L93)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [index.ts:91](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L91)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [index.ts:94](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L94)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [index.ts:92](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L92)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [index.ts:86](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L86)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [index.ts:89](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L89)
