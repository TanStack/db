---
id: StrategyOptions
title: StrategyOptions
---

# Type Alias: StrategyOptions\<T\>

```ts
type StrategyOptions<T> = T extends DebounceStrategy ? DebounceStrategyOptions : T extends QueueStrategy ? QueueStrategyOptions : T extends ThrottleStrategy ? ThrottleStrategyOptions : T extends BatchStrategy ? BatchStrategyOptions : never;
```

Defined in: [packages/db/src/strategies/types.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L122)

Extract the options type from a strategy

## Type Parameters

### T

`T` *extends* [`Strategy`](./Strategy.md)
