---
id: CollectionLike
title: CollectionLike
---

# Interface: CollectionLike\<T, TKey\>

Defined in: [packages/db/src/types.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L12)

Interface for a collection-like object that provides the necessary methods
for the change events system to work

## Extends

- `Pick`\<[`Collection`](../Collection.md)\<`T`, `TKey`\>, `"get"` \| `"has"` \| `"entries"` \| `"indexes"` \| `"id"` \| `"compareOptions"`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### compareOptions

```ts
compareOptions: StringSortOpts;
```

Defined in: [packages/db/src/collection/index.ts:516](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L516)

#### Inherited from

[`CollectionImpl`](../../classes/CollectionImpl.md).[`compareOptions`](../../classes/CollectionImpl.md#compareoptions)

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L210)

#### Inherited from

[`CollectionImpl`](../../classes/CollectionImpl.md).[`id`](../../classes/CollectionImpl.md#id)

***

### indexes

```ts
indexes: Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:501](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L501)

#### Inherited from

```ts
Pick.indexes
```

## Methods

### entries()

```ts
entries(): IterableIterator<[TKey, T]>;
```

Defined in: [packages/db/src/collection/index.ts:425](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L425)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, `T`\]\>

#### Inherited from

```ts
Pick.entries
```

***

### get()

```ts
get(key): T | undefined;
```

Defined in: [packages/db/src/collection/index.ts:390](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L390)

Get the current value for a key (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

`T` \| `undefined`

#### Inherited from

```ts
Pick.get
```

***

### has()

```ts
has(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:397](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L397)

Check if a key exists in the collection (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

`boolean`

#### Inherited from

```ts
Pick.has
```
