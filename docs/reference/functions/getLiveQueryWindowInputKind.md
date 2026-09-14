---
id: getLiveQueryWindowInputKind
title: getLiveQueryWindowInputKind
---

# Function: getLiveQueryWindowInputKind()

```ts
function getLiveQueryWindowInputKind(input): LiveQueryWindowInputKind;
```

Defined in: [packages/db/src/live-query-window-controller.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L41)

**`Internal`**

Classify an infinite-query input without invoking its query callback.
Frameworks use this during lifecycle comparison so unchanged React renders
do not execute the callback again.

 This contract is unstable while RFC #1623 is being implemented.

## Parameters

### input

`unknown`

## Returns

[`LiveQueryWindowInputKind`](../type-aliases/LiveQueryWindowInputKind.md)
