---
id: QueueStrategyOptions
title: QueueStrategyOptions
---

# Interface: QueueStrategyOptions

Defined in: packages/db/src/strategies/types.ts:50

Options for queue strategy
Processes all executions in order (FIFO/LIFO)

## Properties

### addItemsTo?

```ts
optional addItemsTo: "front" | "back";
```

Defined in: packages/db/src/strategies/types.ts:56

Where to add new items in the queue

***

### getItemsFrom?

```ts
optional getItemsFrom: "front" | "back";
```

Defined in: packages/db/src/strategies/types.ts:58

Where to get items from when processing

***

### maxSize?

```ts
optional maxSize: number;
```

Defined in: packages/db/src/strategies/types.ts:54

Maximum queue size (items are dropped if exceeded)

***

### wait?

```ts
optional wait: number;
```

Defined in: packages/db/src/strategies/types.ts:52

Wait time between processing queue items (milliseconds)
