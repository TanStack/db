---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:757](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L757)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:761](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L761)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:762](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L762)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:760](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L760)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:759](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L759)

Pre-compiled expression for filtering the current state
