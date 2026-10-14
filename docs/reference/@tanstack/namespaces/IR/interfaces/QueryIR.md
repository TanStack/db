---
id: QueryIR
title: QueryIR
---

Defined in: [packages/db/src/query/ir.ts:13](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L13)

## Properties

### distinct?

```ts
optional distinct: true;
```

Defined in: [packages/db/src/query/ir.ts:23](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L23)

***

### fnHaving?

```ts
optional fnHaving: (row) => any[];
```

Defined in: [packages/db/src/query/ir.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L29)

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

Defined in: [packages/db/src/query/ir.ts:27](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L27)

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

Defined in: [packages/db/src/query/ir.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L28)

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

Defined in: [packages/db/src/query/ir.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L14)

***

### groupBy?

```ts
optional groupBy: GroupBy;
```

Defined in: [packages/db/src/query/ir.ts:18](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L18)

***

### having?

```ts
optional having: Where[];
```

Defined in: [packages/db/src/query/ir.ts:19](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L19)

***

### join?

```ts
optional join: Join;
```

Defined in: [packages/db/src/query/ir.ts:16](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L16)

***

### limit?

```ts
optional limit: number;
```

Defined in: [packages/db/src/query/ir.ts:21](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L21)

***

### offset?

```ts
optional offset: number;
```

Defined in: [packages/db/src/query/ir.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L22)

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: [packages/db/src/query/ir.ts:20](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L20)

***

### select?

```ts
optional select: Select;
```

Defined in: [packages/db/src/query/ir.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L15)

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: [packages/db/src/query/ir.ts:24](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L24)

***

### where?

```ts
optional where: Where[];
```

Defined in: [packages/db/src/query/ir.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir.ts#L17)
