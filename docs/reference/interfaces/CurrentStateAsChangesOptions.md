---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1147](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1147)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1151](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1151)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1152](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1152)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1150](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1150)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1149](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1149)

Pre-compiled expression for filtering the current state
