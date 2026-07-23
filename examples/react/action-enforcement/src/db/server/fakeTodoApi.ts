import type { Todo } from '@/types/todo'

interface CreateTodoInput {
  id: string
  text: string
}

const serverTodos = new Map<string, Todo>([
  [
    'seed-1',
    {
      id: 'seed-1',
      text: 'Review action-only mutation boundaries',
      completed: false,
      createdAt: new Date('2026-02-01T10:00:00Z'),
    },
  ],
])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function listTodos(): Promise<Array<Todo>> {
  await sleep(80)
  return Array.from(serverTodos.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )
}

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  await sleep(120)
  const todo: Todo = {
    id: input.id,
    text: input.text,
    completed: false,
    createdAt: new Date(),
  }
  serverTodos.set(todo.id, todo)
  return todo
}

export async function toggleTodo(id: string): Promise<void> {
  await sleep(80)
  const todo = serverTodos.get(id)
  if (!todo) {
    throw new Error(`Todo ${id} not found`)
  }

  serverTodos.set(id, {
    ...todo,
    completed: !todo.completed,
  })
}
