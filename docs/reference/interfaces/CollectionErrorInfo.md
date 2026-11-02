---
id: CollectionErrorInfo
title: CollectionErrorInfo
---

Defined in: [packages/db/src/types.ts:822](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L822)

Detail about a Collection problem. Every field except `cause` is plain data,
so the value can be logged or sent as JSON; `cause` keeps the original value
and is omitted from JSON.

## Extended by

- [`HealthProblem`](HealthProblem.md)

## Properties

### at

```ts
readonly at: number;
```

Defined in: [packages/db/src/types.ts:827](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L827)

Epoch milliseconds when the problem was reported.

***

### cause

```ts
readonly cause: unknown;
```

Defined in: [packages/db/src/types.ts:828](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L828)

***

### code?

```ts
readonly optional code: string;
```

Defined in: [packages/db/src/types.ts:825](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L825)

***

### message

```ts
readonly message: string;
```

Defined in: [packages/db/src/types.ts:824](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L824)

***

### name

```ts
readonly name: string;
```

Defined in: [packages/db/src/types.ts:823](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L823)
