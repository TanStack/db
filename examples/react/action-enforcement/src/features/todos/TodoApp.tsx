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
    try {
      setError(null)
      // Valid
      await addTodo(text)

      // Invalid: direct mutation from feature code (intentional lint violation).
      todoCollection.insert({
        id: crypto.randomUUID(),
        text: 'this should fail lint',
        completed: false,
        createdAt: new Date(),
      })
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add todo')
    }
  }

  return (
    <section className="todo-card">
      <div className="todo-input-row">
        <input
          className="todo-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add a todo"
        />
        <button
          className="todo-button"
          type="button"
          onClick={handleAddTodo}
          disabled={isLoading}
        >
          Add
        </button>
      </div>

      <ul className="todo-list">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={`todo-item ${todo.completed ? 'done' : ''}`}
          >
            <span className="todo-text">{todo.text}</span>
            <button
              className="todo-toggle"
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
