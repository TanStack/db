---
id: IndexConstructor
title: IndexConstructor
---

```ts
type IndexConstructor<TKey> = (id, expression, name?, options?) => BaseIndex<TKey>;
```

Defined in: [packages/db/src/indexes/base-index.ts:325](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/base-index.ts#L325)

Type for index constructor

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Parameters

### id

`number`

### expression

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

### name?

`string`

### options?

`any`

## Returns

[`BaseIndex`](../classes/BaseIndex.md)\<`TKey`\>
