---
id: EffectConfig
title: EffectConfig
---

Defined in: [packages/db/src/query/effect.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L113)

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

Defined in: [packages/db/src/query/effect.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L118)

Optional ID for debugging/tracing

***

### onBatch?

```ts
optional onBatch: EffectBatchHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L133)

Called once per graph run with all delta events from that batch

***

### onEnter?

```ts
optional onEnter: EffectEventHandler<TRow, TKey>;
```

Defined in: [packages/db/src/query/effect.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L124)

Called once for each row entering the query result

***

### onError()?

```ts
optional onError: (error, event) => void;
```

Defined in: [packages/db/src/query/effect.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L136)

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

Defined in: [packages/db/src/query/effect.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L130)

Called once for each row exiting the query result

***

### onHealthChange()?

```ts
optional onHealthChange: (health) => void;
```

Defined in: [packages/db/src/query/effect.ts:154](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L154)

Called after the effect's initial-query readiness whenever its health tree
changes. A sync problem after initial-query readiness does not dispose the
effect; read the health tree to decide what to do.

#### Parameters

##### health

[`HealthNode`](HealthNode.md)

#### Returns

`void`

***

### onSourceError()?

```ts
optional onSourceError: (error) => void;
```

Defined in: [packages/db/src/query/effect.ts:147](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L147)

Called when a source crashes, fails its first load before the effect's
initial-query readiness, or is cleaned up while the effect reads it, and
when a subset load the effect requests from a source, or its release,
fails, before or after that readiness. A cascade cleanup that ends the
effect does not call it.
The effect is automatically disposed after this callback fires. If not
provided, the error is logged to console.error.

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

Defined in: [packages/db/src/query/effect.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L127)

Called once for each row updating within the query result

***

### query

```ts
query: EffectQueryInput<any>;
```

Defined in: [packages/db/src/query/effect.ts:121](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L121)

Query to watch for deltas

***

### skipInitial?

```ts
optional skipInitial: boolean;
```

Defined in: [packages/db/src/query/effect.ts:161](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L161)

Skip deltas during initial collection load.
Defaults to false (process all deltas including initial sync).
Set to true for effects that should only process new changes.
