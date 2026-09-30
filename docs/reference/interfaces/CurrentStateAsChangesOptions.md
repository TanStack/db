---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1137](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1137)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1141](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1141)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1142](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1142)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1140](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1140)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1139](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1139)

Pre-compiled expression for filtering the current state
