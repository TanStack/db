---
id: liveQueryWindowMatches
title: liveQueryWindowMatches
---

```ts
function liveQueryWindowMatches(collection, requiredLimit): boolean;
```

Defined in: [packages/db/src/live-query-window-controller.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L107)

**`Internal`**

Whether a window collection may start from its current window. An adapter
may then start the collection, or reuse one it started, during render, as
useLiveQuery does. That holds for exactly the requested rows from offset 0,
whose first published rows are already correct. It also holds for an
unbounded window, which the controller cannot narrow before its source
request anyway. Any other window waits for the controller to adjust it when
the subscription commits: a shifted or narrower window would publish the
wrong rows first, and a wider finite one would request rows from an
on-demand source that the hook does not need.

 This contract is unstable while RFC #1623 is being implemented.

## Parameters

### collection

[`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`\>

### requiredLimit

`number`

## Returns

`boolean`
