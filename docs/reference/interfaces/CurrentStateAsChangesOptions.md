---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:678](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L678)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:682](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L682)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:683](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L683)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:681](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L681)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:680](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L680)

Pre-compiled expression for filtering the current state
