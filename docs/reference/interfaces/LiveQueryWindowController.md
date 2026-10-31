---
id: LiveQueryWindowController
title: LiveQueryWindowController
---

Defined in: [packages/db/src/live-query-window-controller.ts:555](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L555)

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

Defined in: [packages/db/src/live-query-window-controller.ts:567](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L567)

#### Returns

`void`

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:563](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L563)

Load one more page, resolving only after that page is committed.

#### Returns

`Promise`\<`void`\>

***

### getServerSnapshot()

```ts
getServerSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:560](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L560)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:559](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L559)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:566](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L566)

#### Returns

`Promise`\<`void`\>

***

### reset()

```ts
reset: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:565](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L565)

Reset to the first page, resolving after the smaller window is accepted.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:561](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L561)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
