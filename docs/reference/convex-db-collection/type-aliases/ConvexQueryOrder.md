---
id: ConvexQueryOrder
title: ConvexQueryOrder
---

```ts
type ConvexQueryOrder<TRow> = object;
```

Defined in: [paginated-options.ts:22](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/paginated-options.ts#L22)

Leading numeric order of the fixed server query. Trailing DB order terms
are local: each acquisition establishes the complete leading-value tie.

## Type Parameters

### TRow

`TRow`

## Properties

### direction

```ts
direction: "asc" | "desc";
```

Defined in: [paginated-options.ts:27](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/paginated-options.ts#L27)

***

### field

```ts
field: { [K in keyof TRow]-?: TRow[K] extends number ? K : never }[keyof TRow] & string;
```

Defined in: [paginated-options.ts:23](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/paginated-options.ts#L23)
