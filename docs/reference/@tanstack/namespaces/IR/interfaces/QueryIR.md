---
id: QueryIR
title: QueryIR
---

Defined in: [packages/db/src/query/ir.ts:11](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L11)

## Properties

### distinct?

```ts
optional distinct: true;
```

Defined in: [packages/db/src/query/ir.ts:21](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L21)

***

### fnHaving?

```ts
optional fnHaving: (row) => any[];
```

Defined in: [packages/db/src/query/ir.ts:27](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L27)

#### Parameters

##### row

[`NamespacedRow`](../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### fnSelect()?

```ts
optional fnSelect: (row) => any;
```

Defined in: [packages/db/src/query/ir.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L25)

#### Parameters

##### row

[`NamespacedRow`](../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### fnWhere?

```ts
optional fnWhere: (row) => any[];
```

Defined in: [packages/db/src/query/ir.ts:26](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L26)

#### Parameters

##### row

[`NamespacedRow`](../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### from

```ts
from: From;
```

Defined in: [packages/db/src/query/ir.ts:12](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L12)

***

### groupBy?

```ts
optional groupBy: GroupBy;
```

Defined in: [packages/db/src/query/ir.ts:16](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L16)

***

### having?

```ts
optional having: Where[];
```

Defined in: [packages/db/src/query/ir.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L17)

***

### join?

```ts
optional join: Join;
```

Defined in: [packages/db/src/query/ir.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L14)

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/query/ir.ts:19](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L19)

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/query/ir.ts:20](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L20)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/query/ir.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L18)

***

### select?

```ts
optional select: Select;
```

Defined in: [packages/db/src/query/ir.ts:13](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L13)

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: [packages/db/src/query/ir.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L22)

***

### where?

```ts
optional where: Where[];
```

Defined in: [packages/db/src/query/ir.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L15)
