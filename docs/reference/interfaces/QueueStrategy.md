---
id: QueueStrategy
title: QueueStrategy
---

Defined in: [packages/db/src/strategies/types.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L73)

Queue strategy that processes all executions in order
FIFO: { addItemsTo: 'back', getItemsFrom: 'front' }
LIFO: { addItemsTo: 'back', getItemsFrom: 'back' }

## Extends

- [`BaseStrategy`](BaseStrategy.md)\<`"queue"`\>

## Properties

### \_type

```ts
_type: "queue";
```

Defined in: [packages/db/src/strategies/types.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L8)

Type discriminator for strategy identification

#### Inherited from

[`BaseStrategy`](BaseStrategy.md).[`_type`](BaseStrategy.md#_type)

***

### cleanup()

```ts
cleanup: () => void;
```

Defined in: [packages/db/src/strategies/types.ts:30](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L30)

Clean up any resources held by the strategy
Should be called when the strategy is no longer needed

#### Returns

`void`

#### Inherited from

[`BaseStrategy`](BaseStrategy.md).[`cleanup`](BaseStrategy.md#cleanup)

***

### execute()

```ts
execute: <T>(fn, onAdmit?, onCommit?) => boolean | void | Promise<void>;
```

Defined in: [packages/db/src/strategies/types.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L76)

Explicit false rejects the transaction; void preserves custom strategies.

#### Type Parameters

##### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

#### Parameters

##### fn

() => [`Transaction`](Transaction.md)\<`T`\>

##### onAdmit?

() => `void` \| [`Transaction`](Transaction.md)\<`T`\>

##### onCommit?

() => `Promise`\<`unknown`\> \| `undefined`

#### Returns

`boolean` \| `void` \| `Promise`\<`void`\>

#### Overrides

[`BaseStrategy`](BaseStrategy.md).[`execute`](BaseStrategy.md#execute)

***

### options?

```ts
optional options: QueueStrategyOptions;
```

Defined in: [packages/db/src/strategies/types.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L74)
