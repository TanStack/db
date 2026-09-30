---
id: OptionalExtractedTable
title: OptionalExtractedTable
---

```ts
type OptionalExtractedTable<TTable> = OptionalIfUndefined<{ [K in keyof ExtractedTableColumns<TTable>]: WithUndefinedIfNull<ExtractedTableColumns<TTable>[K]> }> & object;
```

Defined in: [helpers.ts:53](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/helpers.ts#L53)

## Type Declaration

### id

```ts
id: string;
```

## Type Parameters

### TTable

`TTable` *extends* `Table`
