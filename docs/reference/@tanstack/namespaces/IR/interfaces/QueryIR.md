---
id: QueryIR
title: QueryIR
---

# Interface: QueryIR

Defined in: packages/db/src/query/ir.ts:9

## Properties

### distinct?

```ts
optional distinct: true;
```

Defined in: packages/db/src/query/ir.ts:19

***

### fnHaving?

```ts
optional fnHaving: (row) => any[];
```

Defined in: packages/db/src/query/ir.ts:25

#### Parameters

##### row

[`NamespacedRow`](../../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### fnSelect()?

```ts
optional fnSelect: (row) => any;
```

Defined in: packages/db/src/query/ir.ts:23

#### Parameters

##### row

[`NamespacedRow`](../../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### fnWhere?

```ts
optional fnWhere: (row) => any[];
```

Defined in: packages/db/src/query/ir.ts:24

#### Parameters

##### row

[`NamespacedRow`](../../../../../type-aliases/NamespacedRow.md)

#### Returns

`any`

***

### from

```ts
from: From;
```

Defined in: packages/db/src/query/ir.ts:10

***

### groupBy?

```ts
optional groupBy: GroupBy;
```

Defined in: packages/db/src/query/ir.ts:14

***

### having?

```ts
optional having: Where[];
```

Defined in: packages/db/src/query/ir.ts:15

***

### join?

```ts
optional join: Join;
```

Defined in: packages/db/src/query/ir.ts:12

***

### limit?

```ts
optional limit: number;
```

Defined in: packages/db/src/query/ir.ts:17

***

### offset?

```ts
optional offset: number;
```

Defined in: packages/db/src/query/ir.ts:18

***

### orderBy?

```ts
optional orderBy: OrderBy;
```

Defined in: packages/db/src/query/ir.ts:16

***

### select?

```ts
optional select: Select;
```

Defined in: packages/db/src/query/ir.ts:11

***

### singleResult?

```ts
optional singleResult: true;
```

Defined in: packages/db/src/query/ir.ts:20

***

### where?

```ts
optional where: Where[];
```

Defined in: packages/db/src/query/ir.ts:13
