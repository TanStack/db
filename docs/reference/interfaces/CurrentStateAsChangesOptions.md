---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:880](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L880)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:884](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L884)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:885](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L885)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:883](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L883)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:882](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L882)

Pre-compiled expression for filtering the current state
