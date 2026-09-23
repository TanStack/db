---
id: LiveQueryObserverListener
title: LiveQueryObserverListener
---

```ts
type LiveQueryObserverListener<T, TKey> = (changes) => void;
```

Defined in: [packages/db/src/live-query-observer.ts:53](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L53)

Listener payload: changes, `[]` for an internal layout-only publication, or
`undefined` for a synthetic status/ready notification.

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Parameters

### changes

[`ChangeMessage`](../interfaces/ChangeMessage.md)\<`T`, `TKey`\>[] | `undefined`

## Returns

`void`
