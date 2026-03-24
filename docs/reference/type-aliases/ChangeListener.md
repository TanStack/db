---
id: ChangeListener
title: ChangeListener
---

# Type Alias: ChangeListener()\<T, TKey\>

```ts
type ChangeListener<T, TKey> = (changes) => void;
```

Defined in: [packages/db/src/types.ts:879](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L879)

Function type for listening to collection changes

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Parameters

### changes

[`ChangeMessage`](../interfaces/ChangeMessage.md)\<`T`, `TKey`\>[]

Array of change messages describing what happened

## Returns

`void`

## Examples

```ts
// Basic change listener
const listener: ChangeListener = (changes) => {
  changes.forEach(change => {
    console.log(`${change.type}: ${change.key}`, change.value)
  })
}

collection.subscribeChanges(listener)
```

```ts
// Handle different change types
const listener: ChangeListener<Todo> = (changes) => {
  for (const change of changes) {
    switch (change.type) {
      case 'insert':
        addToUI(change.value)
        break
      case 'update':
        updateInUI(change.key, change.value, change.previousValue)
        break
      case 'delete':
        removeFromUI(change.key)
        break
    }
  }
}
```
