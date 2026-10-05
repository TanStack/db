import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'

interface Todo {
  id: number
  text: string
  projectID: number
  completed: boolean
  created_at: Date
}

export const todosCollection = createCollection(
  localOnlyCollectionOptions<Todo>({
    getKey: (todo: Todo) => todo.id,
    initialData: [
      {
        id: 1,
        text: 'Learn Angular',
        projectID: 1,
        completed: false,
        created_at: new Date(),
      },
      {
        id: 2,
        text: 'Build Todo App',
        projectID: 1,
        completed: false,
        created_at: new Date(),
      },
      {
        id: 5,
        text: 'Take out trash',
        projectID: 2,
        completed: false,
        created_at: new Date(),
      },
      {
        id: 4,
        text: 'Buy milk',
        projectID: 2,
        completed: false,
        created_at: new Date(),
      },
    ],
  }),
)
