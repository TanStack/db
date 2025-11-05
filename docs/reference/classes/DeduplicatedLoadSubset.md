---
id: DeduplicatedLoadSubset
title: DeduplicatedLoadSubset
---

# Class: DeduplicatedLoadSubset

Defined in: [packages/db/src/query/subset-dedupe.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L34)

Deduplicated wrapper for a loadSubset function.
Tracks what data has been loaded and avoids redundant calls by applying
subset logic to predicates.

## Param

The options for the DeduplicatedLoadSubset

## Param

The underlying loadSubset function to wrap

## Param

An optional callback function that is invoked when a loadSubset call is deduplicated.
                             If the call is deduplicated because the requested data is being loaded by an inflight request,
                             then this callback is invoked when the inflight request completes successfully and the data is fully loaded.
                             This callback is useful if you need to track rows per query, in which case you can't ignore deduplicated calls
                             because you need to know which rows were loaded for each query.

## Example

```ts
const dedupe = new DeduplicatedLoadSubset({ loadSubset: myLoadSubset, onDeduplicate: (opts) => console.log(`Call was deduplicated:`, opts) })

// First call - fetches data
await dedupe.loadSubset({ where: gt(ref('age'), val(10)) })

// Second call - subset of first, returns true immediately
await dedupe.loadSubset({ where: gt(ref('age'), val(20)) })

// Clear state to start fresh
dedupe.reset()
```

## Constructors

### Constructor

```ts
new DeduplicatedLoadSubset(opts): DeduplicatedLoadSubset;
```

Defined in: [packages/db/src/query/subset-dedupe.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L67)

#### Parameters

##### opts

###### loadSubset

(`options`) => `true` \| `Promise`\<`void`\>

###### onDeduplicate?

(`options`) => `void`

#### Returns

`DeduplicatedLoadSubset`

## Methods

### loadSubset()

```ts
loadSubset(options): true | Promise<void>;
```

Defined in: [packages/db/src/query/subset-dedupe.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L85)

Load a subset of data, with automatic deduplication based on previously
loaded predicates and in-flight requests.

This method is auto-bound, so it can be safely passed as a callback without
losing its `this` context (e.g., `loadSubset: dedupe.loadSubset` in a sync config).

#### Parameters

##### options

[`LoadSubsetOptions`](../../type-aliases/LoadSubsetOptions.md)

The predicate options (where, orderBy, limit)

#### Returns

`true` \| `Promise`\<`void`\>

true if data is already loaded, or a Promise that resolves when data is loaded

***

### reset()

```ts
reset(): void;
```

Defined in: [packages/db/src/query/subset-dedupe.ts:198](https://github.com/TanStack/db/blob/main/packages/db/src/query/subset-dedupe.ts#L198)

Reset all tracking state.
Clears the history of loaded predicates and in-flight calls.
Use this when you want to start fresh, for example after clearing the underlying data store.

Note: Any in-flight requests will still complete, but they will not update the tracking
state after the reset. This prevents old requests from repopulating cleared state.

#### Returns

`void`
