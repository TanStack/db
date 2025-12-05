---
id: BaseStrategy
title: BaseStrategy
---

# Interface: BaseStrategy\<TName\>

Defined in: [packages/db/src/strategies/types.ts:6](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L6)

Base strategy interface that all strategy implementations must conform to

## Extended by

- [`DebounceStrategy`](./DebounceStrategy.md)
- [`QueueStrategy`](./QueueStrategy.md)
- [`ThrottleStrategy`](./ThrottleStrategy.md)

## Type Parameters

### TName

`TName` *extends* `string` = `string`

## Properties

### \_type

```ts
_type: TName;
```

Defined in: [packages/db/src/strategies/types.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L8)

Type discriminator for strategy identification

***

### cleanup()

```ts
cleanup: () => void;
```

Defined in: [packages/db/src/strategies/types.ts:23](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L23)

Clean up any resources held by the strategy
Should be called when the strategy is no longer needed

#### Returns

`void`

***

### execute()

```ts
execute: <T>(fn) => void | Promise<void>;
```

Defined in: [packages/db/src/strategies/types.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L15)

Execute a function according to the strategy's timing rules

#### Type Parameters

##### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

#### Parameters

##### fn

() => [`Transaction`](./Transaction.md)\<`T`\>

The function to execute

#### Returns

`void` \| `Promise`\<`void`\>

The result of the function execution (if applicable)
