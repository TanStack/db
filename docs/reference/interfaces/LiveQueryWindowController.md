---
id: LiveQueryWindowController
title: LiveQueryWindowController
---

# Interface: LiveQueryWindowController\<T, TKey\>

Defined in: [packages/db/src/live-query-window-controller.ts:273](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L273)

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

Defined in: [packages/db/src/live-query-window-controller.ts:284](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L284)

#### Returns

`void`

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:280](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L280)

Load one more page, resolving only after that page is committed.

#### Returns

`Promise`\<`void`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:277](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L277)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:283](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L283)

#### Returns

`Promise`\<`void`\>

***

### reset()

```ts
reset: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:282](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L282)

Reset to the first page, resolving after the smaller window is accepted.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:278](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L278)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
