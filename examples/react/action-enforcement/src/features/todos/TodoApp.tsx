import { useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { addTodo, toggleTodo } from '@/db/actions/todoActions'
import { todoCollection } from '@/db/collections/todoCollection'

export function TodoApp() {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { data: todos = [], isLoading } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.createdAt, 'desc'),
  )

  async function handleAddTodo() {
    const submittedText = text
    try {
      setError(null)
      await addTodo(submittedText).when('settled')
      setText((current) => (current === submittedText ? '' : current))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add todo')
    }
  }

  return (
    <section className="todo-card">
      <form
        className="todo-input-row"
        onSubmit={(event) => {
          event.preventDefault()
          void handleAddTodo()
        }}
      >
        <input
          className="todo-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add a todo"
        />
        <button className="todo-button" type="submit" disabled={isLoading}>
          Add
        </button>
      </form>

      <ul className="todo-list">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={`todo-item ${todo.completed ? 'done' : ''}`}
          >
            <span className="todo-text">{todo.text}</span>
            <button
              className="todo-toggle"
              disabled={todo.$hasPendingWrites}
              type="button"
              onClick={() => {
                void toggleTodo({ id: todo.id })
              }}
            >
              {todo.completed ? 'Undo' : 'Done'}
            </button>
          </li>
        ))}
      </ul>

      {error ? <p className="error-text">{error}</p> : null}

      <p className="tip">
        Direct collection reads are allowed in features. Direct writes like{' '}
        <code>todoCollection.insert(...)</code> fail lint and must go through
        <code> @/db/actions/*</code>.
      </p>
    </section>
  )
}
