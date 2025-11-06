---
id: ThrottleStrategyOptions
title: ThrottleStrategyOptions
---

# Interface: ThrottleStrategyOptions

Defined in: packages/db/src/strategies/types.ts:74

Options for throttle strategy
Ensures executions are evenly spaced over time

## Properties

### leading?

```ts
optional leading: boolean;
```

Defined in: packages/db/src/strategies/types.ts:78

Execute immediately on the first call

***

### trailing?

```ts
optional trailing: boolean;
```

Defined in: packages/db/src/strategies/types.ts:80

Execute on the last call after wait period

***

### wait

```ts
wait: number;
```

Defined in: packages/db/src/strategies/types.ts:76

Minimum wait time between executions (milliseconds)
