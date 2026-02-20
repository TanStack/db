import { useState } from 'preact/hooks'
import {
  createCollection,
  debounceStrategy,
  localOnlyCollectionOptions,
  useLiveQuery,
  usePacedMutations,
} from '@tanstack/preact-db'

type Todo = {
  id: string
  text: string
  done: boolean
}

const todosCollection = createCollection(
  localOnlyCollectionOptions<Todo>({
    id: `preact-basic-todos`,
    getKey: (todo) => todo.id,
    initialData: [
      { id: `1`, text: `Read TanStack DB docs`, done: false },
      { id: `2`, text: `Build a Preact app`, done: true },
    ],
  }),
)

export default function App() {
  const [nextText, setNextText] = useState(``)

  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ todos: todosCollection })
      .select(({ todos }) => todos),
  )

  const addTodo = usePacedMutations<string>({
    onMutate: (text) => {
      const trimmed = text.trim()
      if (!trimmed) {
        return
      }

      todosCollection.insert({
        id: crypto.randomUUID(),
        text: trimmed,
        done: false,
      })
    },
    mutationFn: async () => {
      await Promise.resolve()
    },
    strategy: debounceStrategy({ wait: 150 }),
  })

  return (
    <main className="app">
      <h1>TanStack DB + Preact</h1>
      <p className="muted">
        Live query data updates immediately as mutations are applied.
      </p>

      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault()
          addTodo(nextText)
          setNextText(``)
        }}
      >
        <input
          value={nextText}
          onInput={(event) =>
            setNextText((event.target as HTMLInputElement).value)
          }
          placeholder="Add a todo"
        />
        <button type="submit">Add</button>
      </form>

      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <ul>
          {data.map((todo) => (
            <li key={todo.id}>{todo.text}</li>
          ))}
        </ul>
      )}
    </main>
  )
}
