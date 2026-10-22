---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1284](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1284)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1288](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1288)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1289](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1289)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1287](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1287)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1286](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1286)

Pre-compiled expression for filtering the current state
