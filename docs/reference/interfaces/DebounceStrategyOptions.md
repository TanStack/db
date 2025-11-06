---
id: DebounceStrategyOptions
title: DebounceStrategyOptions
---

# Interface: DebounceStrategyOptions

Defined in: packages/db/src/strategies/types.ts:30

Options for debounce strategy
Delays execution until after a period of inactivity

## Properties

### leading?

```ts
optional leading: boolean;
```

Defined in: packages/db/src/strategies/types.ts:34

Execute immediately on the first call

***

### trailing?

```ts
optional trailing: boolean;
```

Defined in: packages/db/src/strategies/types.ts:36

Execute after the wait period on the last call

***

### wait

```ts
wait: number;
```

Defined in: packages/db/src/strategies/types.ts:32

Wait time in milliseconds before execution
