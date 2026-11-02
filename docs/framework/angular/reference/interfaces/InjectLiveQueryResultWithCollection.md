---
id: InjectLiveQueryResultWithCollection
title: InjectLiveQueryResultWithCollection
---

Defined in: [angular-db/src/index.ts:80](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L80)

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
  | Collection<TResult, TKey, TUtils, StandardSchemaV1<unknown, unknown>, TResult>
| null>;
```

Defined in: [angular-db/src/index.ts:87](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L87)

***

### data

```ts
data: Signal<TResult[]>;
```

Defined in: [angular-db/src/index.ts:86](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L86)

***

### state

```ts
state: Signal<Map<TKey, TResult>>;
```

Defined in: [angular-db/src/index.ts:85](https://github.com/TanStack/db/blob/main/packages/angular-db/src/index.ts#L85)

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
