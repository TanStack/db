---
id: CurrentStateAsChangesOptions
title: CurrentStateAsChangesOptions
---

Defined in: [packages/db/src/types.ts:1132](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1132)

Options for getting current state as changes

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/types.ts:1136](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1136)

***

### optimizedOnly?

```ts
optional optimizedOnly: boolean;
```

Defined in: [packages/db/src/types.ts:1137](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1137)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/types.ts:1135](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1135)

***

### where?

```ts
optional where: BasicExpression<boolean>;
```

Defined in: [packages/db/src/types.ts:1134](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L1134)

Pre-compiled expression for filtering the current state
