---
id: LiveQueryWindowController
title: LiveQueryWindowController
---

Defined in: [packages/db/src/live-query-window-controller.ts:553](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L553)

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

Defined in: [packages/db/src/live-query-window-controller.ts:564](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L564)

#### Returns

`void`

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:560](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L560)

Load one more page, resolving only after that page is committed.

#### Returns

`Promise`\<`void`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:557](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L557)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:563](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L563)

#### Returns

`Promise`\<`void`\>

***

### reset()

```ts
reset: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:562](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L562)

Reset to the first page, resolving after the smaller window is accepted.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:558](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L558)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
