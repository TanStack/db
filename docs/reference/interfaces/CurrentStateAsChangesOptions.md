---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:983](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L983)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:987](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L987)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:988](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L988)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:986](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L986)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:985](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L985)

Pre-compiled expression for filtering the current state
