---
id: CollectionLike
title: CollectionLike
---

# Interface: CollectionLike\<T, TKey\>

Defined in: [packages/db/src/types.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L15)

Interface for a collection-like object that provides the necessary methods
for the change events system to work

## Extends

- `Pick`\<[`Collection`](Collection.md)\<`T`, `TKey`\>, `"get"` \| `"has"` \| `"entries"` \| `"indexes"` \| `"id"` \| `"compareOptions"`\>

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### compareOptions

```ts
compareOptions: StringCollationConfig;
```

Defined in: [packages/db/src/collection/index.ts:643](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L643)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`compareOptions`](../classes/CollectionImpl.md#compareoptions)

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/collection/index.ts:279](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L279)

#### Inherited from

[`CollectionImpl`](../classes/CollectionImpl.md).[`id`](../classes/CollectionImpl.md#id)

***

### indexes

```ts
indexes: Map<number, BaseIndex<TKey>>;
```

Defined in: [packages/db/src/collection/index.ts:628](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L628)

#### Inherited from

```ts
Pick.indexes
```

## Methods

### entries()

```ts
entries(): IterableIterator<[TKey, WithVirtualProps<T, TKey>]>;
```

Defined in: [packages/db/src/collection/index.ts:519](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L519)

Get all entries (virtual derived state)

#### Returns

`IterableIterator`\<\[`TKey`, [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>\]\>

#### Inherited from

```ts
Pick.entries
```

***

### get()

```ts
get(key): 
  | WithVirtualProps<T, TKey>
  | undefined;
```

Defined in: [packages/db/src/collection/index.ts:479](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L479)

Get the current value for a key (virtual derived state)

#### Parameters

##### key

`TKey`

#### Returns

  \| [`WithVirtualProps`](../type-aliases/WithVirtualProps.md)\<`T`, `TKey`\>
  \| `undefined`

#### Inherited from

```ts
Pick.get
```

***

### has()

```ts
has(key): boolean;
```

Defined in: [packages/db/src/collection/index.ts:486](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L486)

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
