---
id: usePacedMutations
title: usePacedMutations
---

# Function: usePacedMutations()

```ts
function usePacedMutations<TVariables, T>(config): (variables) => Transaction<T>;
```

Defined in: usePacedMutations.ts:93

React hook for managing paced mutations with timing strategies.

Provides optimistic mutations with pluggable strategies like debouncing,
queuing, or throttling. The optimistic updates are applied immediately via
`onMutate`, and the actual persistence is controlled by the strategy.

## Type Parameters

### TVariables

`TVariables` = `unknown`

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Parameters

### config

`PacedMutationsConfig`\<`TVariables`, `T`\>

Configuration including onMutate, mutationFn and strategy

## Returns

A mutate function that accepts variables and returns Transaction objects

```ts
(variables): Transaction<T>;
```

### Parameters

#### variables

`TVariables`

### Returns

`Transaction`\<`T`\>

## Examples

```tsx
// Debounced auto-save
function AutoSaveForm({ formId }: { formId: string }) {
  const mutate = usePacedMutations<string>({
    onMutate: (value) => {
      // Apply optimistic update immediately
      formCollection.update(formId, draft => {
        draft.content = value
      })
    },
    mutationFn: async ({ transaction }) => {
      await api.save(transaction.mutations)
    },
    strategy: debounceStrategy({ wait: 500 })
  })

  const handleChange = async (value: string) => {
    const tx = mutate(value)

    // Optional: await persistence or handle errors
    try {
      await tx.isPersisted.promise
      console.log('Saved!')
    } catch (error) {
      console.error('Save failed:', error)
    }
  }

  return <textarea onChange={e => handleChange(e.target.value)} />
}
```

```tsx
// Throttled slider updates
function VolumeSlider() {
  const mutate = usePacedMutations<number>({
    onMutate: (volume) => {
      settingsCollection.update('volume', draft => {
        draft.value = volume
      })
    },
    mutationFn: async ({ transaction }) => {
      await api.updateVolume(transaction.mutations)
    },
    strategy: throttleStrategy({ wait: 200 })
  })

  return <input type="range" onChange={e => mutate(+e.target.value)} />
}
```

```tsx
// Debounce with leading/trailing for color picker (persist first + final only)
function ColorPicker() {
  const mutate = usePacedMutations<string>({
    onMutate: (color) => {
      themeCollection.update('primary', draft => {
        draft.color = color
      })
    },
    mutationFn: async ({ transaction }) => {
      await api.updateTheme(transaction.mutations)
    },
    strategy: debounceStrategy({ wait: 0, leading: true, trailing: true })
  })

  return (
    <input
      type="color"
      onChange={e => mutate(e.target.value)}
    />
  )
}
```
