---
id: LiveQueryWindowController
title: LiveQueryWindowController
---

Defined in: [packages/db/src/live-query-window-controller.ts:546](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L546)

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

Defined in: [packages/db/src/live-query-window-controller.ts:557](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L557)

#### Returns

`void`

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:553](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L553)

Load one more page, resolving only after that page is committed.

#### Returns

`Promise`\<`void`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:550](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L550)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:556](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L556)

#### Returns

`Promise`\<`void`\>

***

### reset()

```ts
reset: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:555](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L555)

Reset to the first page, resolving after the smaller window is accepted.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:551](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L551)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
