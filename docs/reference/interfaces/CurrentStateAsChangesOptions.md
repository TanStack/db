---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1291](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1291)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1295](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1295)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1296](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1296)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1294](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1294)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1293](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1293)

Pre-compiled expression for filtering the current state
