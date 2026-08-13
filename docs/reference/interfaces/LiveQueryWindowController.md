---
id: LiveQueryWindowController
title: LiveQueryWindowController
---

# Interface: LiveQueryWindowController\<T, TKey\>

Defined in: [packages/db/src/live-query-window-controller.ts:511](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L511)

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

Defined in: [packages/db/src/live-query-window-controller.ts:522](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L522)

#### Returns

`void`

***

### fetchNextPage()

```ts
fetchNextPage: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:518](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L518)

Load one more page, resolving only after that page is committed.

#### Returns

`Promise`\<`void`\>

***

### getSnapshot()

```ts
getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:515](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L515)

#### Returns

[`LiveQueryWindowSnapshot`](LiveQueryWindowSnapshot.md)\<`T`, `TKey`\>

***

### preload()

```ts
preload: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:521](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L521)

#### Returns

`Promise`\<`void`\>

***

### reset()

```ts
reset: () => Promise<void>;
```

Defined in: [packages/db/src/live-query-window-controller.ts:520](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L520)

Reset to the first page, resolving after the smaller window is accepted.

#### Returns

`Promise`\<`void`\>

***

### subscribe()

```ts
subscribe: (listener) => () => void;
```

Defined in: [packages/db/src/live-query-window-controller.ts:516](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-controller.ts#L516)

#### Parameters

##### listener

() => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
