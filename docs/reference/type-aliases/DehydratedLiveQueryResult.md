---
id: DehydratedLiveQueryResult
title: DehydratedLiveQueryResult
---

```ts
type DehydratedLiveQueryResult<T, TKey> = object;
```

Defined in: [packages/db/src/client.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L157)

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

Defined in: [packages/db/src/client.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L161)

***

### status?

```ts
optional status: "loading" | "error";
```

Defined in: [packages/db/src/client.ts:163](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L163)

An initial SSR view may precede query readiness. Omitted means ready.
