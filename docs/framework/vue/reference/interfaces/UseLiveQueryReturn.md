---
id: UseLiveQueryReturn
title: UseLiveQueryReturn
---

Defined in: [useLiveQuery.ts:72](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L72)

Status, persistence, and error refs every `useLiveQuery` result has.

## Extends

- [`UseLiveQueryFlags`](UseLiveQueryFlags.md)

## Type Parameters

### TContext

`TContext` *extends* `Context`

## Properties

### collection

```ts
collection: ComputedRef<Collection<{ [K in string | number | symbol]: ResultValue<TContext>[K] }, string | number, {
}, StandardSchemaV1<unknown, unknown>, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveQuery.ts:77](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L77)

***

### data

```ts
data: ComputedRef<InferResultType<TContext>>;
```

Defined in: [useLiveQuery.ts:76](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L76)

***

### health

```ts
health: ComputedRef<HealthNode | undefined>;
```

Defined in: [useLiveQuery.ts:69](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L69)

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`health`](UseLiveQueryFlags.md#health)

***

### isCleanedUp

```ts
isCleanedUp: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:66](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L66)

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isCleanedUp`](UseLiveQueryFlags.md#iscleanedup)

***

### isCrashed

```ts
isCrashed: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:65](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L65)

Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover.

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isCrashed`](UseLiveQueryFlags.md#iscrashed)

***

### isIdle

```ts
isIdle: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:61](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L61)

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isIdle`](UseLiveQueryFlags.md#isidle)

***

### isLoading

```ts
isLoading: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:59](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L59)

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isLoading`](UseLiveQueryFlags.md#isloading)

***

### isLoadingError

```ts
isLoadingError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:63](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L63)

The first load failed: there is nothing to show.

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isLoadingError`](UseLiveQueryFlags.md#isloadingerror)

***

### isReady

```ts
isReady: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:60](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L60)

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isReady`](UseLiveQueryFlags.md#isready)

***

### isSyncError

```ts
isSyncError: ComputedRef<boolean>;
```

Defined in: [useLiveQuery.ts:68](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L68)

The data is shown, and a sync problem or failed request is in `health`.

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`isSyncError`](UseLiveQueryFlags.md#issyncerror)

***

### state

```ts
state: ComputedRef<Map<string | number, { [K in string | number | symbol]: ResultValue<TContext>[K] }>>;
```

Defined in: [useLiveQuery.ts:75](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L75)

***

### status

```ts
status: ComputedRef<CollectionStatus>;
```

Defined in: [useLiveQuery.ts:58](https://github.com/TanStack/db/blob/main/packages/vue-db/src/useLiveQuery.ts#L58)

#### Inherited from

[`UseLiveQueryFlags`](UseLiveQueryFlags.md).[`status`](UseLiveQueryFlags.md#status)
