---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

# Interface: CurrentStateAsChangesOptions

Defined in: [packages/db/src/types.ts:813](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L813)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:817](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L817)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:818](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L818)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:816](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L816)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:815](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L815)

Pre-compiled expression for filtering the current state
