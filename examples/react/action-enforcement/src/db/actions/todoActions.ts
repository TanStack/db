import { createOptimisticAction } from '@tanstack/react-db'
import { todoCollection } from '@/db/collections/todoCollection'
import { createTodo, toggleTodo as persistToggleTodo } from '@/db/server/fakeTodoApi'

type AddTodoPayload = {
  id: string
  text: string
}

const addTodoAction = createOptimisticAction<AddTodoPayload>({
  onMutate: ({ id, text }) => {
    todoCollection.insert({
      id,
      text,
      completed: false,
      createdAt: new Date(),
    })
  },
  mutationFn: async ({ id, text }) => {
    await createTodo({ id, text })
    await todoCollection.utils.refetch()
  },
})

export function addTodo(text: string) {
  const trimmedText = text.trim()
  if (!trimmedText) {
    throw new Error('Todo text is required')
  }

  return addTodoAction({
    id: crypto.randomUUID(),
    text: trimmedText,
  })
}

export const toggleTodo = createOptimisticAction<{ id: string }>({
  onMutate: ({ id }) => {
    todoCollection.update(id, (draft) => {
      draft.completed = !draft.completed
    })
  },
  mutationFn: async ({ id }) => {
    await persistToggleTodo(id)
    await todoCollection.utils.refetch()
  },
})
