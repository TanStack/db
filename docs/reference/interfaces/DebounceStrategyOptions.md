---
id: DebounceStrategyOptions
title: DebounceStrategyOptions
---

Defined in: [packages/db/src/strategies/types.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L37)

Options for debounce strategy
Delays execution until after a period of inactivity

## Properties

### leading?

```ts
optional leading: boolean;
```

Defined in: [packages/db/src/strategies/types.ts:41](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L41)

Execute immediately on the first call

***

### trailing?

```ts
optional trailing: boolean;
```

Defined in: [packages/db/src/strategies/types.ts:43](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L43)

Execute after the wait period on the last call

***

### wait

```ts
wait: number;
```

Defined in: [packages/db/src/strategies/types.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L39)

Wait time in milliseconds before execution
