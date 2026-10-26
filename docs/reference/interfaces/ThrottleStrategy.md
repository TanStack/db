---
id: ThrottleStrategy
title: ThrottleStrategy
---

Defined in: [packages/db/src/strategies/types.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L99)

Throttle strategy that spaces executions evenly over time

## Extends

- [`BaseStrategy`](BaseStrategy.md)\<`"throttle"`\>

## Properties

### \_type

```ts
_type: "throttle";
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

Defined in: [packages/db/src/strategies/types.ts:20](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L20)

Execute a function according to the strategy's timing rules

#### Type Parameters

##### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

#### Parameters

##### fn

() => [`Transaction`](Transaction.md)\<`T`\>

The function to execute

##### onAdmit?

() => `void` \| [`Transaction`](Transaction.md)\<`T`\>

Optional synchronous preparation for an admitted call.
Built-in debounce/throttle strategies call it after reserving the current
edge but before invoking fn, and do not call it when returning false.

##### onCommit?

() => `Promise`\<`unknown`\> \| `undefined`

Optional promise for the actual commit attempt. It can
outlive the public persistence receipt after a manual rollback.

#### Returns

`boolean` \| `void` \| `Promise`\<`void`\>

The result of the function execution (if applicable)

#### Inherited from

[`BaseStrategy`](BaseStrategy.md).[`execute`](BaseStrategy.md#execute)

***

### options

```ts
options: ThrottleStrategyOptions;
```

Defined in: [packages/db/src/strategies/types.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L100)
