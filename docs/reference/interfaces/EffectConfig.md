---
id: EffectConfig
title: EffectConfig
---

Defined in: [packages/db/src/query/effect.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L108)

Effect configuration

## Type Parameters

### TRow

`TRow` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/query/effect.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L113)

Optional ID for debugging/tracing

***

### onBatch?

```ts
optional onBatch: EffectBatchHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L128)

Called once per graph run with all delta events from that batch

***

### onEnter?

```ts
optional onEnter: EffectEventHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L119)

Called once for each row entering the query result

***

### onError()?

```ts
optional onError: (error, event) => void;
```

Defined in: [packages/db/src/query/effect.ts:131](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L131)

Error handler for exceptions thrown by effect callbacks

#### Parameters

##### error

`Error`

##### event

[`DeltaEvent`](../type-aliases/DeltaEvent.md)\<`TRow`, `TKey`\>

#### Returns

`void`

***

### onExit?

```ts
optional onExit: EffectEventHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L125)

Called once for each row exiting the query result

***

### onSourceError()?

```ts
optional onSourceError: (error) => void;
```

Defined in: [packages/db/src/query/effect.ts:138](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L138)

Called when a source collection enters an error or cleaned-up state.
The effect is automatically disposed after this callback fires.
If not provided, the error is logged to console.error.

#### Parameters

##### error

`Error`

#### Returns

`void`

***

### onUpdate?

```ts
optional onUpdate: EffectEventHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L122)

Called once for each row updating within the query result

***

### query

```ts
query: EffectQueryInput<any>;
```

Defined in: [packages/db/src/query/effect.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L116)

Query to watch for deltas

***

### skipInitial?

```ts
optional skipInitial: boolean;
```

Defined in: [packages/db/src/query/effect.ts:145](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L145)

Skip deltas during initial collection load.
Defaults to false (process all deltas including initial sync).
Set to true for effects that should only process new changes.
