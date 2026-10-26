---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

Defined in: [angular-db/src/index.ts:83](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L83)

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

Defined in: [angular-db/src/index.ts:90](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L90)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [angular-db/src/index.ts:89](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L89)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:99](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L99)

***

### isError

```ts
isError: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:98](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L98)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:97](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L97)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:92](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L92)

***

### isPersistedReady

```ts
isPersistedReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:95](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L95)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:93](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L93)

***

### persistedError

```ts
persistedError: Signal<unknown>;
```

Defined in: [angular-db/src/index.ts:96](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L96)

***

### persistedStatus

```ts
persistedStatus: Signal<LiveQueryPersistedStatus>;
```

Defined in: [angular-db/src/index.ts:94](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L94)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [angular-db/src/index.ts:88](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L88)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:91](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L91)
