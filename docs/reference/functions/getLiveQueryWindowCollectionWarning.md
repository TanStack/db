---
id: getLiveQueryWindowCollectionWarning
title: getLiveQueryWindowCollectionWarning
---

```ts
function getLiveQueryWindowCollectionWarning(collection, expectedLimit): string | undefined;
```

Defined in: [packages/db/src/live-query-window-controller.ts:436](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L436)

**`Internal`**

Validate a pre-created infinite-query collection and describe any window
adjustment the adapter should warn about.

 Shared validation for infinite-query adapters.

## Parameters

### collection

[`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`\>

### expectedLimit

`number`

## Returns

`string` \| `undefined`
