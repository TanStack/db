---
id: resolveLiveQueryWindowInput
title: resolveLiveQueryWindowInput
---

# Function: resolveLiveQueryWindowInput()

```ts
function resolveLiveQueryWindowInput<TContext>(input): ResolvedLiveQueryWindowInput<TContext>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:59](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L59)

**`Internal`**

Resolve a supported infinite-query input and invoke a query callback once.
A function may resolve to a collection for framework getter compatibility.
Nullable/disabled and config-object inputs are intentionally not supported.

 This contract is unstable while RFC #1623 is being implemented.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### input

`unknown`

## Returns

[`ResolvedLiveQueryWindowInput`](../type-aliases/ResolvedLiveQueryWindowInput.md)\<`TContext`\>
