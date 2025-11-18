---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:717](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L717)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:721](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L721)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:722](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L722)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:720](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L720)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:719](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L719)

Pre-compiled expression for filtering the current state
