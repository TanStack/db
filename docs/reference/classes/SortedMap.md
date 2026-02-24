---
id: SortedMap
title: SortedMap
---

# Class: SortedMap\<TKey, TValue\>

Defined in: [packages/db/src/SortedMap.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L8)

A Map implementation that keeps its entries sorted based on a comparator function

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number`

The type of keys in the map (must be string | number)

### TValue

`TValue`

The type of values in the map

## Constructors

### Constructor

```ts
new SortedMap<TKey, TValue>(comparator?): SortedMap<TKey, TValue>;
```

Defined in: [packages/db/src/SortedMap.ts:19](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L19)

Creates a new SortedMap instance

#### Parameters

##### comparator?

(`a`, `b`) => `number`

Optional function to compare values for sorting.
                    If not provided, entries are sorted by key only.

#### Returns

`SortedMap`\<`TKey`, `TValue`\>

## Accessors

### size

#### Get Signature

```ts
get size(): number;
```

Defined in: [packages/db/src/SortedMap.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L157)

Gets the number of key-value pairs in the map

##### Returns

`number`

## Methods

### \[iterator\]()

```ts
iterator: IterableIterator<[TKey, TValue]>;
```

Defined in: [packages/db/src/SortedMap.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L166)

Default iterator that returns entries in sorted order

#### Returns

`IterableIterator`\<\[`TKey`, `TValue`\]\>

An iterator for the map's entries

***

### clear()

```ts
clear(): void;
```

Defined in: [packages/db/src/SortedMap.ts:149](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L149)

Removes all key-value pairs from the map

#### Returns

`void`

***

### delete()

```ts
delete(key): boolean;
```

Defined in: [packages/db/src/SortedMap.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L125)

Removes a key-value pair from the map

#### Parameters

##### key

`TKey`

The key to remove

#### Returns

`boolean`

True if the key was found and removed, false otherwise

***

### entries()

```ts
entries(): IterableIterator<[TKey, TValue]>;
```

Defined in: [packages/db/src/SortedMap.ts:177](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L177)

Returns an iterator for the map's entries in sorted order

#### Returns

`IterableIterator`\<\[`TKey`, `TValue`\]\>

An iterator for the map's entries

***

### forEach()

```ts
forEach(callbackfn): void;
```

Defined in: [packages/db/src/SortedMap.ts:208](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L208)

Executes a callback function for each key-value pair in the map in sorted order

#### Parameters

##### callbackfn

(`value`, `key`, `map`) => `void`

Function to execute for each entry

#### Returns

`void`

***

### get()

```ts
get(key): TValue | undefined;
```

Defined in: [packages/db/src/SortedMap.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L115)

Gets a value by its key

#### Parameters

##### key

`TKey`

The key to look up

#### Returns

`TValue` \| `undefined`

The value associated with the key, or undefined if not found

***

### has()

```ts
has(key): boolean;
```

Defined in: [packages/db/src/SortedMap.ts:142](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L142)

Checks if a key exists in the map

#### Parameters

##### key

`TKey`

The key to check

#### Returns

`boolean`

True if the key exists, false otherwise

***

### keys()

```ts
keys(): IterableIterator<TKey>;
```

Defined in: [packages/db/src/SortedMap.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L186)

Returns an iterator for the map's keys in sorted order

#### Returns

`IterableIterator`\<`TKey`\>

An iterator for the map's keys

***

### set()

```ts
set(key, value): this;
```

Defined in: [packages/db/src/SortedMap.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L92)

Sets a key-value pair in the map and maintains sort order

#### Parameters

##### key

`TKey`

The key to set

##### value

`TValue`

The value to associate with the key

#### Returns

`this`

This SortedMap instance for chaining

***

### values()

```ts
values(): IterableIterator<TValue>;
```

Defined in: [packages/db/src/SortedMap.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/SortedMap.ts#L195)

Returns an iterator for the map's values in sorted order

#### Returns

`IterableIterator`\<`TValue`\>

An iterator for the map's values
