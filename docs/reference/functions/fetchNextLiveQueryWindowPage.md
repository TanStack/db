---
id: fetchNextLiveQueryWindowPage
title: fetchNextLiveQueryWindowPage
---

# Function: fetchNextLiveQueryWindowPage()

```ts
function fetchNextLiveQueryWindowPage(controller): Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:532](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L532)

**`Internal`**

Run an adapter-facing page fetch. The controller records failures in its
snapshot; consuming the rejection here keeps event handlers safe while the
returned promise still settles with the request.

 This contract is unstable while RFC #1623 is being implemented.

## Parameters

### controller

`Pick`\<[`LiveQueryWindowController`](../interfaces/LiveQueryWindowController.md)\<`object`, `string` \| `number`\>, `"fetchNextPage"`\>

## Returns

`Promise`\<`void`\>
