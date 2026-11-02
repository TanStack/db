---
id: InjectLiveQueryResultWithSingleResultCollection
title: InjectLiveQueryResultWithSingleResultCollection
---

Defined in: [angular-db/src/index.ts:90](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L90)

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

Defined in: [angular-db/src/index.ts:97](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L97)

***

### data

```ts
data: Signal<TResult | undefined>;
```

Defined in: [angular-db/src/index.ts:96](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L96)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [angular-db/src/index.ts:95](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L95)

***

### status

```ts
status: Signal<CollectionStatus | "disabled">;
```

Defined in: [angular-db/src/index.ts:48](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L48)

A signal containing the current status of the collection

#### Inherited from

```ts
InjectLiveQueryFlags.status
```
