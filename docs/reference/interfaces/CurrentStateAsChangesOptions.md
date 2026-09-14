---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:979](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L979)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:983](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L983)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:984](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L984)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:982](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L982)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:981](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L981)

Pre-compiled expression for filtering the current state
