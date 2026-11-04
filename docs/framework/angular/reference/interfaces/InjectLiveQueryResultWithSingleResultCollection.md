---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

Defined in: [angular-db/src/index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

The status and flag signals every `injectLiveQuery` result has.

## Extends

- [`InjectLiveQueryFlags`](../type-aliases/InjectLiveQueryFlags.md)

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

Defined in: [angular-db/src/index.ts:94](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L94)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [angular-db/src/index.ts:93](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L93)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [angular-db/src/index.ts:92](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L92)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:45](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L45)

A signal containing the current status of the collection

#### Inherited from

```ts
InjectLiveQueryFlags.status
```
