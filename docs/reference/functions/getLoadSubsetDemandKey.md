---
id: getLoadSubsetDemandKey
title: getLoadSubsetDemandKey
---

```ts
function getLoadSubsetDemandKey(options): DemandKey | undefined;
```

Defined in: [packages/db/src/query/ir-stable-identity.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir-stable-identity.ts#L105)

Returns the exact semantic identity of a loadSubset request.

Abort signals and subscriptions are owners of a request, not part of the
requested data, and therefore do not affect the key. `refetch` controls
whether to start another acquisition attempt for that data and likewise does
not affect identity. A demand generation scopes one asynchronous attempt
rather than the data it requests. Code that rejects stale work compares this
key alongside its generation; query-db uses the key alone so equivalent data
demands can reuse one cache entry across generations.

## Parameters

### options

[`LoadSubsetOptions`](../type-aliases/LoadSubsetOptions.md)

## Returns

[`DemandKey`](../type-aliases/DemandKey.md) \| `undefined`
