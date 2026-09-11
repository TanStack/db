import { useEffect } from 'react'
import { endpointRuntime } from '../src/runtime'
import type { DbClient, Transaction } from '@tanstack/db'
import type { bindQuery } from '../src/runtime'

type TodoInput = { id: string; text: string }

export function useTodoProbe(
  dbClient: DbClient,
  listTodos: ReturnType<typeof bindQuery>,
  addTodo: (input: TodoInput) => Transaction,
) {
  useEffect(() => {
    const probe = {
      client: endpointRuntime(dbClient),
      collection: listTodos,
      view: listTodos,
      add: addTodo,
      listTodos,
      addTodo,
    }
    const target = window as Window & { todoProbe?: typeof probe }
    target.todoProbe = probe
    return () => {
      if (target.todoProbe === probe) delete target.todoProbe
    }
  }, [dbClient, listTodos, addTodo])
}
