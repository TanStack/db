---
id: toBoundaryError
title: toBoundaryError
---

```ts
function toBoundaryError(cause): Error;
```

Defined in: [packages/db/src/live-query-observer.ts:815](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-observer.ts#L815)

**`Internal`**

The Error an adapter sends to an error boundary for a failed first load or
a crash: the cause itself when it is an Error, otherwise an Error with the
problem's message (as in `health.error.message`) whose `cause` is the value
the sync adapter reported.

 Shared by TanStack DB's official framework adapters.

## Parameters

### cause

`unknown`

## Returns

`Error`
