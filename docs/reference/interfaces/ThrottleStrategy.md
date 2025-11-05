---
id: ThrottleStrategy
title: ThrottleStrategy
---

# Interface: ThrottleStrategy

Defined in: [packages/db/src/strategies/types.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L86)

Throttle strategy that spaces executions evenly over time

## Extends

- [`BaseStrategy`](../BaseStrategy.md)\<`"throttle"`\>

## Properties

### \_type

```ts
_type: "throttle";
```

Defined in: [packages/db/src/strategies/types.ts:8](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L8)

Type discriminator for strategy identification

#### Inherited from

[`BaseStrategy`](../BaseStrategy.md).[`_type`](../BaseStrategy.md#_type)

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

#### Inherited from

[`BaseStrategy`](../BaseStrategy.md).[`cleanup`](../BaseStrategy.md#cleanup)

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

() => [`Transaction`](../Transaction.md)\<`T`\>

The function to execute

#### Returns

`void` \| `Promise`\<`void`\>

The result of the function execution (if applicable)

#### Inherited from

[`BaseStrategy`](../BaseStrategy.md).[`execute`](../BaseStrategy.md#execute)

***

### options

```ts
options: ThrottleStrategyOptions;
```

Defined in: [packages/db/src/strategies/types.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L87)
