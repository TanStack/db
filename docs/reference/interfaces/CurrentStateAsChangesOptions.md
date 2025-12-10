---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:741](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L741)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:745](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L745)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:746](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L746)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:744](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L744)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:743](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L743)

Pre-compiled expression for filtering the current state
