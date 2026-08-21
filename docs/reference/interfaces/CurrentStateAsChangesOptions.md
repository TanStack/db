---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:909](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L909)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:913](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L913)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:914](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L914)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:912](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L912)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:911](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L911)

Pre-compiled expression for filtering the current state
