---
id: SyncOperation
title: SyncOperation
---

# Type Alias: SyncOperation\<TRow, TKey, TInsertInput\>

```ts
type SyncOperation<TRow, TKey, TInsertInput> = 
  | {
  data: TInsertInput | TInsertInput[];
  type: "insert";
}
  | {
  data: Partial<TRow> | Partial<TRow>[];
  type: "update";
}
  | {
  key: TKey | TKey[];
  type: "delete";
}
  | {
  data: Partial<TRow> | Partial<TRow>[];
  type: "upsert";
};
```

Defined in: packages/query-db-collection/src/manual-sync.ts:20

## Type Parameters

### TRow

`TRow` *extends* `object`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TInsertInput

`TInsertInput` *extends* `object` = `TRow`
