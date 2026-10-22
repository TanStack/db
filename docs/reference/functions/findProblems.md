---
id: findProblems
title: findProblems
---

```ts
function findProblems(health): HealthNode[];
```

Defined in: packages/db/src/collection/health-tree.ts:77

Every node in a health tree that shows a problem of its own, in tree order:
a `failureReason` or an `error`. A node whose only problems are below it is
not listed; its descendants are.

## Parameters

### health

[`HealthNode`](../interfaces/HealthNode.md)

## Returns

[`HealthNode`](../interfaces/HealthNode.md)[]
