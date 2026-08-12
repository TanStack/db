---
id: createLiveQueryWindowController
title: createLiveQueryWindowController
---

# Function: createLiveQueryWindowController()

```ts
function createLiveQueryWindowController<T, TKey>(collection, options): LiveQueryWindowController<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:726](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L726)

**`Internal`**

Create an internal forward-window controller for an ordered live query.

 This factory is unstable while RFC #1623 is being implemented.

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Parameters

### collection

[`Collection`](../interfaces/Collection.md)\<`T`, `TKey`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `T`\> | `null` | `undefined`

### options

[`CreateLiveQueryWindowControllerOptions`](../interfaces/CreateLiveQueryWindowControllerOptions.md) = `{}`

## Returns

[`LiveQueryWindowController`](../interfaces/LiveQueryWindowController.md)\<`T`, `TKey`\>
