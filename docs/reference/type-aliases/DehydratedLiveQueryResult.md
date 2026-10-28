---
id: DehydratedLiveQueryResult
title: DehydratedLiveQueryResult
---

```ts
type DehydratedLiveQueryResult<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L150)

## Type Parameters

### T

`T` *extends* `object` = `object`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### rows

```ts
rows: DehydratedCollectionRow<T, TKey>[];
```

Defined in: [packages/db/src/client.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L154)

***

### status?

```ts
optional status: "loading" | "error";
```

Defined in: [packages/db/src/client.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L156)

An initial SSR view may precede query readiness. Omitted means ready.
