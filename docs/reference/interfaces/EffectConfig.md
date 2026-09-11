---
id: EffectConfig
title: EffectConfig
---

# Interface: EffectConfig\<TRow, TKey\>

Defined in: [packages/db/src/query/effect.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L100)

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

Defined in: [packages/db/src/query/effect.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L105)

Optional ID for debugging/tracing

***

### onBatch?

```ts
optional onBatch: EffectBatchHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L120)

Called once per graph run with all delta events from that batch

***

### onEnter?

```ts
optional onEnter: EffectEventHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L111)

Called once for each row entering the query result

***

### onError()?

```ts
optional onError: (error, event) => void;
```

Defined in: [packages/db/src/query/effect.ts:123](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L123)

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

Defined in: [packages/db/src/query/effect.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L117)

Called once for each row exiting the query result

***

### onSourceError()?

```ts
optional onSourceError: (error) => void;
```

Defined in: [packages/db/src/query/effect.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L130)

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

Defined in: [packages/db/src/query/effect.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L114)

Called once for each row updating within the query result

***

### query

```ts
query: EffectQueryInput<any>;
```

Defined in: [packages/db/src/query/effect.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L108)

Query to watch for deltas

***

### skipInitial?

```ts
optional skipInitial: boolean;
```

Defined in: [packages/db/src/query/effect.ts:137](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L137)

Skip deltas during initial collection load.
Defaults to false (process all deltas including initial sync).
Set to true for effects that should only process new changes.
