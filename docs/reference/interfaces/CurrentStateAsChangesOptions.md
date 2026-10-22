---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1157](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1157)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1161](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1161)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1162](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1162)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1160](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1160)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1159](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1159)

Pre-compiled expression for filtering the current state
