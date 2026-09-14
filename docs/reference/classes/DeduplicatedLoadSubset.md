---
id: DeduplicatedLoadSubset
title: DeduplicatedLoadSubset
---

# Class: DeduplicatedLoadSubset

Defined in: [packages/db/src/query/subset-dedupe.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L8)

Deduplicates exact canonical demands without inferring broader coverage.
Requests follow the immutable LoadSubsetOptions contract; no copies are made.

## Constructors

### Constructor

```ts
new DeduplicatedLoadSubset(options): DeduplicatedLoadSubset;
```

Defined in: [packages/db/src/query/subset-dedupe.ts:13](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L13)

#### Parameters

##### options

###### loadSubset

[`LoadSubsetFn`](../type-aliases/LoadSubsetFn.md)

###### onDeduplicate?

(`options`) => `void`

#### Returns

`DeduplicatedLoadSubset`

## Methods

### loadSubset()

```ts
loadSubset(options): true | Promise<void>;
```

Defined in: [packages/db/src/query/subset-dedupe.ts:20](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L20)

#### Parameters

##### options

[`LoadSubsetOptions`](../type-aliases/LoadSubsetOptions.md)

#### Returns

`true` \| `Promise`\<`void`\>

***

### reset()

```ts
reset(): void;
```

Defined in: [packages/db/src/query/subset-dedupe.ts:64](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L64)

#### Returns

`void`
