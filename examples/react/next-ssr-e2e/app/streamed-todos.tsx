'use client'

import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { streamedTodoQuery } from './ssr-fixture'

export function StreamedTodos() {
  const { data: todos } = useLiveSuspenseQuery(streamedTodoQuery)

  return (
    <ul data-testid="streamed-todo-list">
      {todos.map((todo) => (
        <li data-testid={`streamed-todo-${todo.id}`} key={todo.id}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
