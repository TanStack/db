---
id: DeltaEvent
title: DeltaEvent
---

# Type Alias: DeltaEvent\<TRow, TKey\>

```ts
type DeltaEvent<TRow, TKey> = 
  | {
  key: TKey;
  metadata?: Record<string, unknown>;
  type: "enter";
  value: TRow;
}
  | {
  key: TKey;
  metadata?: Record<string, unknown>;
  type: "exit";
  value: TRow;
}
  | {
  key: TKey;
  metadata?: Record<string, unknown>;
  previousValue: TRow;
  type: "update";
  value: TRow;
};
```

Defined in: [packages/db/src/query/effect.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L38)

Delta event emitted when a row enters, exits, or updates within a query result

## Type Parameters

### TRow

`TRow` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Type Declaration

```ts
{
  key: TKey;
  metadata?: Record<string, unknown>;
  type: "enter";
  value: TRow;
}
```

### key

```ts
key: TKey;
```

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

### type

```ts
type: "enter";
```

### value

```ts
value: TRow;
```

Current value for the entering row

```ts
{
  key: TKey;
  metadata?: Record<string, unknown>;
  type: "exit";
  value: TRow;
}
```

### key

```ts
key: TKey;
```

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

### type

```ts
type: "exit";
```

### value

```ts
value: TRow;
```

Current value for the exiting row

```ts
{
  key: TKey;
  metadata?: Record<string, unknown>;
  previousValue: TRow;
  type: "update";
  value: TRow;
}
```

### key

```ts
key: TKey;
```

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

### previousValue

```ts
previousValue: TRow;
```

Previous value before the batch

### type

```ts
type: "update";
```

### value

```ts
value: TRow;
```

Current value after the update
