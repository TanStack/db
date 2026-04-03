---
id: EffectConfig
title: EffectConfig
---

# Interface: EffectConfig\<TRow, TKey\>

Defined in: [packages/db/src/query/effect.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L93)

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

Defined in: [packages/db/src/query/effect.ts:98](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L98)

Optional ID for debugging/tracing

***

### onBatch?

```ts
optional onBatch: EffectBatchHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L113)

Called once per graph run with all delta events from that batch

***

### onEnter?

```ts
optional onEnter: EffectEventHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L104)

Called once for each row entering the query result

***

### onError()?

```ts
optional onError: (error, event) => void;
```

Defined in: [packages/db/src/query/effect.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L116)

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

Defined in: [packages/db/src/query/effect.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L110)

Called once for each row exiting the query result

***

### onSourceError()?

```ts
optional onSourceError: (error) => void;
```

Defined in: [packages/db/src/query/effect.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L123)

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

Defined in: [packages/db/src/query/effect.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L107)

Called once for each row updating within the query result

***

### query

```ts
query: EffectQueryInput<any>;
```

Defined in: [packages/db/src/query/effect.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L101)

Query to watch for deltas

***

### skipInitial?

```ts
optional skipInitial: boolean;
```

Defined in: [packages/db/src/query/effect.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L130)

Skip deltas during initial collection load.
Defaults to false (process all deltas including initial sync).
Set to true for effects that should only process new changes.
