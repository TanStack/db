---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

Defined in: [angular-db/src/index.ts:92](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L92)

Status, persistence, and health signals every `injectLiveQuery` result has.

## Extends

- [`InjectLiveQueryFlags`](InjectLiveQueryFlags.md)

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

Defined in: [angular-db/src/index.ts:99](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L99)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [angular-db/src/index.ts:98](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L98)

***

### health

```ts
health: Signal<HealthNode | undefined>;
```

Defined in: [angular-db/src/index.ts:62](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L62)

A signal containing the health tree for the query and its dependencies

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`health`](InjectLiveQueryFlags.md#health)

***

### isCleanedUp

```ts
isCleanedUp: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:58](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L58)

A signal indicating whether the collection has been cleaned up

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isCleanedUp`](InjectLiveQueryFlags.md#iscleanedup)

***

### isCrashed

```ts
isCrashed: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:56](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L56)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isCrashed`](InjectLiveQueryFlags.md#iscrashed)

***

### isIdle

```ts
isIdle: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:52](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L52)

A signal indicating whether the collection is idle

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isIdle`](InjectLiveQueryFlags.md#isidle)

***

### isLoading

```ts
isLoading: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal indicating whether the collection is currently loading

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isLoading`](InjectLiveQueryFlags.md#isloading)

***

### isLoadingError

```ts
isLoadingError: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:54](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L54)

The first load failed: there is nothing to show.

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isLoadingError`](InjectLiveQueryFlags.md#isloadingerror)

***

### isReady

```ts
isReady: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:50](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L50)

A signal indicating whether the collection is ready

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isReady`](InjectLiveQueryFlags.md#isready)

***

### isSyncError

```ts
isSyncError: Signal<boolean>;
```

Defined in: [angular-db/src/index.ts:60](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L60)

The data is shown, and a sync problem or failed request is in `health`.

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`isSyncError`](InjectLiveQueryFlags.md#issyncerror)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [angular-db/src/index.ts:97](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L97)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:46](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L46)

A signal containing the current status of the collection

#### Inherited from

[`InjectLiveQueryFlags`](InjectLiveQueryFlags.md).[`status`](InjectLiveQueryFlags.md#status)
