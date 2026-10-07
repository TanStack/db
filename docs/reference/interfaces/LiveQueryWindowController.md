---
id: LiveQueryWindowController
title: LiveQueryWindowController
---

Defined in: [packages/db/src/live-query-window-controller.ts:517](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L517)

**`Internal`**

This contract is unstable while RFC #1623 is being implemented.

## Type Parameters

### T

`T` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number`

## Properties

### dispose()

```ts
dispose: () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:528](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L528)

#### Returns

`void`

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:524](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L524)

Load one more page, resolving only after that page is committed.

#### Returns

`Promise`\<`void`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:521](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L521)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:527](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L527)

#### Returns

`Promise`\<`void`\>

***

### reset()

```ts
reset: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:526](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L526)

Reset to the first page, resolving after the smaller window is accepted.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:522](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L522)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
