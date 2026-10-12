---
id: ThrottleStrategyOptions
title: ThrottleStrategyOptions
---

Defined in: [packages/db/src/strategies/types.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L87)

Options for throttle strategy
Ensures executions are evenly spaced over time

## Properties

### leading?

```ts
optional leading: boolean;
```

Defined in: [packages/db/src/strategies/types.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L91)

Execute immediately on the first call. Defaults to true unless trailing is explicitly true.

***

### trailing?

```ts
optional trailing: boolean;
```

Defined in: [packages/db/src/strategies/types.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L93)

Execute on the last call after wait period. Defaults to true. Disabled trailing rejects skipped optimistic calls.

***

### wait

```ts
wait: number;
```

Defined in: [packages/db/src/strategies/types.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/types.ts#L89)

Minimum wait time between executions (milliseconds)
