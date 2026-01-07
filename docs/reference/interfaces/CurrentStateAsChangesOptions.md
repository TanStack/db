---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:796](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L796)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:800](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L800)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:801](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L801)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:799](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L799)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:798](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L798)

Pre-compiled expression for filtering the current state
